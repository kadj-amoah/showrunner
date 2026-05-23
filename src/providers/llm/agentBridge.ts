import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z, ZodTypeAny } from 'zod';
import { runCommandCapture } from '../../recording/lifecycle.js';
import { logger } from '../../util/logger.js';
import type {
  GenerateStructuredOptions,
  LLMProvider,
} from './types.js';
import { LLMProviderError } from './types.js';

export type AgentBridgeMode = 'spawn' | 'file_poll';

export interface AgentBridgeSpawnConfig {
  mode: 'spawn';
  /** Default `claude` */
  command: string;
  /** Default `['-p', '--output-format', 'json']` (Claude CLI headless mode). */
  args: string[];
  /** Kill the subprocess after this many ms. Default 300000 (5 minutes). */
  timeoutMs?: number;
  /** Run the child process in this directory. */
  cwd?: string;
}

export interface AgentBridgeFilePollConfig {
  mode: 'file_poll';
  /** Directory where request files are written and response files are awaited. */
  requestDir: string;
  /** Polling interval (ms). Default 500. */
  pollIntervalMs?: number;
  /** Give up after this many ms. Default 600000 (10 minutes). */
  timeoutMs?: number;
}

export type AgentBridgeConfig = AgentBridgeSpawnConfig | AgentBridgeFilePollConfig;

const FENCED_JSON = /```(?:json)?\s*([\s\S]*?)```/;

export class AgentBridgeLLMProvider implements LLMProvider {
  constructor(private readonly cfg: AgentBridgeConfig) {}

  async generateStructured<S extends ZodTypeAny>(opts: GenerateStructuredOptions<S>): Promise<z.infer<S>> {
    const jsonSchema = zodToJsonSchema(opts.schema, opts.schemaName ?? 'output');
    const prompt = renderBridgePrompt(opts.systemPrompt, opts.userPrompt, jsonSchema);

    let rawResponse: string;
    if (this.cfg.mode === 'spawn') {
      rawResponse = await invokeSpawn(this.cfg, prompt);
    } else {
      rawResponse = await invokeFilePoll(this.cfg, prompt);
    }

    const structured = extractJson(rawResponse);
    try {
      return opts.schema.parse(structured);
    } catch (err) {
      throw new LLMProviderError(
        `Agent bridge response did not match the expected schema: ${
          err instanceof Error ? err.message : String(err)
        }`,
        'agent_bridge',
        err,
      );
    }
  }
}

function renderBridgePrompt(systemPrompt: string, userPrompt: string, jsonSchema: unknown): string {
  return [
    'You are being called via a non-interactive bridge. Your job is to return ONLY a JSON object that conforms to the provided JSON Schema. No prose, no greeting, no markdown — emit just the JSON inside a single ```json fenced block.',
    '',
    '## System instructions for this task',
    systemPrompt,
    '',
    '## JSON Schema your response must satisfy',
    '```json',
    JSON.stringify(jsonSchema, null, 2),
    '```',
    '',
    '## Task',
    userPrompt,
    '',
    'Respond with exactly one ```json ... ``` block containing the structured output. Do not include any text before or after the fence.',
  ].join('\n');
}

async function invokeSpawn(cfg: AgentBridgeSpawnConfig, prompt: string): Promise<string> {
  const result = await runCommandCapture({
    cmd: cfg.command,
    args: cfg.args,
    cwd: cfg.cwd,
    label: `llm-bridge:${cfg.command}`,
    stdin: prompt,
    timeoutMs: cfg.timeoutMs ?? 300_000,
  });
  if (result.exitCode !== 0) {
    throw new LLMProviderError(
      `Agent bridge command \`${cfg.command}\` exited with code ${result.exitCode}\nstderr:\n${result.stderr.slice(-2000)}`,
      'agent_bridge',
    );
  }
  // Claude CLI in --output-format json mode emits a JSON envelope on stdout
  // with a `content` field (and other metadata like total_cost_usd). If we can
  // parse the envelope, prefer the content field; otherwise treat stdout as
  // the raw model output.
  const trimmed = result.stdout.trim();
  if (trimmed.startsWith('{')) {
    try {
      const envelope = JSON.parse(trimmed) as Record<string, unknown>;
      const content = envelope['content'] ?? envelope['result'];
      if (typeof content === 'string') return content;
    } catch {
      // Not a JSON envelope — fall through and treat stdout as raw text.
    }
  }
  return trimmed;
}

async function invokeFilePoll(cfg: AgentBridgeFilePollConfig, prompt: string): Promise<string> {
  await mkdir(cfg.requestDir, { recursive: true });
  const id = randomUUID();
  const reqPath = join(cfg.requestDir, `${id}.request.json`);
  const resPath = join(cfg.requestDir, `${id}.response.json`);
  await writeFile(reqPath, JSON.stringify({ id, prompt }, null, 2) + '\n', 'utf8');
  logger.info('Agent bridge: wrote LLM request, waiting for response', { reqPath, resPath });

  const pollInterval = cfg.pollIntervalMs ?? 500;
  const timeout = cfg.timeoutMs ?? 600_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await fileExists(resPath)) {
      const raw = await readFile(resPath, 'utf8');
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const content = parsed['content'] ?? parsed['response'];
        if (typeof content === 'string') return content;
        return raw;
      } catch {
        return raw;
      }
    }
    await sleep(pollInterval);
  }

  throw new LLMProviderError(
    `Agent bridge (file_poll) timed out after ${timeout}ms waiting for ${resPath}`,
    'agent_bridge',
  );
}

function extractJson(raw: string): unknown {
  const fenced = FENCED_JSON.exec(raw);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through to balanced-brace extraction
    }
  }
  // Find the longest balanced { ... } block.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new LLMProviderError(
      `Agent bridge response contained no parseable JSON. First 500 chars:\n${raw.slice(0, 500)}`,
      'agent_bridge',
    );
  }
  const candidate = raw.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new LLMProviderError(
      `Agent bridge response had JSON-like text but it didn't parse: ${
        err instanceof Error ? err.message : String(err)
      }\nFirst 500 chars:\n${raw.slice(0, 500)}`,
      'agent_bridge',
    );
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
