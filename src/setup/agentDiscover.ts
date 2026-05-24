import { z } from 'zod';
import { AgentBridgeLLMProvider } from '../providers/llm/agentBridge.js';
import { collectProjectSnapshot, renderSnapshot } from './projectSnapshot.js';

export const DevServerProposalSchema = z.object({
  command: z.string().min(1).describe('Executable name, e.g. "npm" or "pnpm".'),
  args: z.array(z.string()).describe('CLI arguments, e.g. ["run", "dev"].'),
  url: z.string().url().describe('URL the dev server will listen on once started.'),
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1).describe('One short sentence on why this is the right command.'),
});

export type DevServerProposal = z.infer<typeof DevServerProposalSchema>;

export interface DiscoverOptions {
  /** Override the claude binary on PATH (default: "claude"). */
  command?: string;
  args?: string[];
  /** Hard cap on the LLM call (default 90s). */
  timeoutMs?: number;
}

const SYSTEM_PROMPT = [
  'You are helping the Showrunner CLI identify how to start a project\'s development server.',
  'You will be given a project snapshot (package.json, README head, common framework config files, .env.example).',
  '',
  'Your job: identify the command + arguments to run the dev server, and the URL it will listen on.',
  '',
  'Rules:',
  '- Use the scripts in package.json as your primary signal. Prefer "dev" > "start" > "serve" when present.',
  '- For Vite default port = 5173; Next/CRA = 3000; Astro = 4321; Vue CLI = 8080; Django = 8000.',
  '- If the project explicitly sets a port (via env, config, or CLI flags), use that, NOT the framework default.',
  '- If the snapshot is too sparse to tell, set confidence to "low" and use your best guess for both command and URL.',
  '- "confidence" reflects how sure you are. "high" = explicit script + config-confirmed port; "medium" = explicit script, default port; "low" = guessing.',
  '- "rationale" is one short sentence, plain English. No marketing speak.',
  '',
  'Return only the structured output. No prose outside the JSON.',
].join('\n');

export async function discoverDevServer(
  projectDir: string,
  opts: DiscoverOptions = {},
): Promise<DevServerProposal> {
  const snapshot = await collectProjectSnapshot(projectDir);
  const rendered = renderSnapshot(snapshot);

  const provider = new AgentBridgeLLMProvider({
    mode: 'spawn',
    command: opts.command ?? 'claude',
    args: opts.args ?? ['-p', '--output-format', 'json'],
    timeoutMs: opts.timeoutMs ?? 90_000,
  });

  const userPrompt = [
    `Project directory: ${projectDir}`,
    '',
    'Project snapshot follows:',
    '',
    rendered,
    '',
    'Identify the dev-server command + args + URL.',
  ].join('\n');

  return await provider.generateStructured({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    schema: DevServerProposalSchema,
    schemaName: 'DevServerProposal',
  });
}
