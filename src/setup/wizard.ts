import {
  intro,
  outro,
  text,
  password,
  select,
  confirm,
  note,
  spinner,
  isCancel,
  cancel,
} from '@clack/prompts';
import type { DetectedEnvironment } from './detect.js';
import { probeUrl } from './targetProbe.js';
import { scanLocalPorts, type ScannedTarget } from './portScan.js';
import { discoverDevServer, type DevServerProposal } from './agentDiscover.js';
import { spawnAndWait } from './spawnDevServer.js';
import {
  RESOLUTION_PRESETS,
  type ResolutionPreset,
} from '../util/resolutionPresets.js';

export type LLMProviderChoice = 'anthropic' | 'openai' | 'agent_bridge';
export type TTSProviderChoice = 'elevenlabs' | 'openai' | 'custom';

export interface WizardResult {
  projectName: string;
  url: string;
  llm: LLMProviderChoice;
  tts: TTSProviderChoice;
  resolutionPreset: ResolutionPreset;
  /** Map of env var → value. Empty if no keys needed or user skipped. */
  collectedKeys: Record<string, string>;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

export async function runWizard(env: DetectedEnvironment): Promise<WizardResult | null> {
  intro('Showrunner setup');

  note(formatDetection(env), 'Detected on this machine');

  const projectName = await ask(
    text({
      message: "What's the project directory name?",
      placeholder: 'showrunner-demo',
      defaultValue: 'showrunner-demo',
      validate: (v) => {
        if (!v) return undefined; // default applies
        if (!SLUG_RE.test(v)) {
          return 'Use letters/digits/dash/underscore/dot, starting & ending with alphanumeric.';
        }
        return undefined;
      },
    }),
  );
  if (projectName === null) return null;

  const resolutionPreset = (await ask(
    select<ResolutionPreset>({
      message: 'Recording resolution preset?',
      options: [
        { value: 'low', label: 'low  (854×480) — draft / fast iteration' },
        { value: 'standard', label: 'standard  (1280×720) — recommended default' },
        { value: 'high', label: 'high  (1920×1080)' },
        { value: 'extreme', label: 'extreme  (3840×2160) — needs serious RAM' },
      ],
      initialValue: 'standard' as ResolutionPreset,
    }),
  )) as ResolutionPreset | null;
  if (resolutionPreset === null) return null;
  if (!RESOLUTION_PRESETS.includes(resolutionPreset)) {
    cancel('Invalid resolution preset.');
    return null;
  }

  // LLM provider — bias toward agent_bridge if claude CLI is on PATH.
  const llmDefault: LLMProviderChoice = env.claudeCli ? 'agent_bridge' : 'anthropic';
  const llm = (await ask(
    select<LLMProviderChoice>({
      message: 'Which LLM provider should drive comprehension + script?',
      options: [
        {
          value: 'agent_bridge',
          label: env.claudeCli
            ? "agent_bridge — uses your local `claude` CLI (detected). No API key required."
            : 'agent_bridge — uses a local headless agent CLI. No API key required.',
        },
        {
          value: 'anthropic',
          label: env.envVars.anthropic
            ? 'anthropic — Claude via API (ANTHROPIC_API_KEY already in env)'
            : 'anthropic — Claude via API (you\'ll paste an API key in a moment)',
        },
        {
          value: 'openai',
          label: env.envVars.openai
            ? 'openai — GPT via API (OPENAI_API_KEY already in env)'
            : "openai — GPT via API (you'll paste an API key in a moment)",
        },
      ],
      initialValue: llmDefault,
    }),
  )) as LLMProviderChoice | null;
  if (llm === null) return null;

  const collectedKeys: Record<string, string> = {};
  if (llm === 'anthropic' && !env.envVars.anthropic) {
    const key = await askKey('ANTHROPIC_API_KEY', 'https://console.anthropic.com/settings/keys');
    if (key === null) return null;
    if (key.length > 0) collectedKeys['ANTHROPIC_API_KEY'] = key;
  }
  if (llm === 'openai' && !env.envVars.openai) {
    const key = await askKey('OPENAI_API_KEY', 'https://platform.openai.com/api-keys');
    if (key === null) return null;
    if (key.length > 0) collectedKeys['OPENAI_API_KEY'] = key;
  }

  // TTS provider — prefer elevenlabs for alignment; if user has agent_bridge LLM and no
  // OpenAI key, default to `custom` so they aren't forced to fill another key.
  const ttsDefault: TTSProviderChoice =
    llm === 'agent_bridge' && !env.envVars.openai && !env.envVars.elevenlabs
      ? 'custom'
      : 'elevenlabs';
  const tts = (await ask(
    select<TTSProviderChoice>({
      message: 'Which TTS provider for voiceover?',
      options: [
        {
          value: 'elevenlabs',
          label: env.envVars.elevenlabs
            ? 'elevenlabs — best alignment (ELEVENLABS_API_KEY already in env)'
            : "elevenlabs — best alignment (you'll paste an API key)",
        },
        {
          value: 'openai',
          label:
            env.envVars.openai || llm === 'openai'
              ? 'openai — tts-1-hd (reuses your OpenAI key)'
              : "openai — tts-1-hd (you'll paste an API key)",
        },
        {
          value: 'custom',
          label: 'custom — plug in your own TTSProvider module. No API key required here.',
        },
      ],
      initialValue: ttsDefault,
    }),
  )) as TTSProviderChoice | null;
  if (tts === null) return null;

  if (tts === 'elevenlabs' && !env.envVars.elevenlabs) {
    const key = await askKey('ELEVENLABS_API_KEY', 'https://elevenlabs.io/app/settings/api-keys');
    if (key === null) return null;
    if (key.length > 0) collectedKeys['ELEVENLABS_API_KEY'] = key;
  }
  if (tts === 'openai' && !env.envVars.openai && !collectedKeys['OPENAI_API_KEY']) {
    const key = await askKey('OPENAI_API_KEY', 'https://platform.openai.com/api-keys');
    if (key === null) return null;
    if (key.length > 0) collectedKeys['OPENAI_API_KEY'] = key;
  }

  // Target URL: full Phase B+C cascade — direct probe → port-scan suggestion →
  // optional agent discovery → fallback to user-entered URL with warning.
  const resolved = await resolveTargetUrl({
    env,
    llm,
    projectDir: process.cwd(),
  });
  if (resolved === null) return null;
  const url = resolved.url;

  const proceed = await ask(
    confirm({
      message: `Scaffold ${projectName}/ with these choices?`,
      initialValue: true,
    }),
  );
  if (proceed === null || proceed === false) {
    cancel('Setup cancelled. Nothing written.');
    return null;
  }

  outro('Scaffolding now...');

  return {
    projectName,
    url,
    llm,
    tts,
    resolutionPreset,
    collectedKeys,
  };
}

async function askKey(envVar: string, dashUrl: string): Promise<string | null> {
  const value = await ask(
    password({
      message: `Paste your ${envVar} (or press enter to skip and fill .env later)`,
    }),
  );
  if (value === null) return null;
  return typeof value === 'string' ? value.trim() : '';
}

async function ask<T>(promptResult: Promise<T | symbol>): Promise<T | null> {
  const result = await promptResult;
  if (isCancel(result)) {
    cancel('Setup cancelled.');
    return null;
  }
  return result as T;
}

function formatDetection(env: DetectedEnvironment): string {
  const lines: string[] = [];
  lines.push(`claude CLI:    ${env.claudeCli ? 'found' : 'not found'}`);
  lines.push(`ffmpeg:        ${env.ffmpeg ? 'found' : 'NOT found  ← required for muxing'}`);
  lines.push(`ffprobe:       ${env.ffprobe ? 'found' : 'NOT found  ← required for muxing'}`);
  lines.push(`chromium:      ${env.chromium ? 'installed' : 'NOT installed  ← run `showrunner install-browser`'}`);
  lines.push('');
  lines.push('env vars:');
  lines.push(`  ANTHROPIC_API_KEY:  ${env.envVars.anthropic ? 'set' : 'unset'}`);
  lines.push(`  OPENAI_API_KEY:     ${env.envVars.openai ? 'set' : 'unset'}`);
  lines.push(`  ELEVENLABS_API_KEY: ${env.envVars.elevenlabs ? 'set' : 'unset'}`);
  return lines.join('\n');
}

interface ResolveTargetUrlInput {
  env: DetectedEnvironment;
  llm: LLMProviderChoice;
  projectDir: string;
}

interface ResolvedTarget {
  url: string;
  /** PID of a dev-server we spawned, if any. */
  spawnedPid?: number;
  /** Set when we ended up keeping the user's typed URL despite a failed probe. */
  warnedUnreachable?: boolean;
}

/**
 * Multi-step URL resolution. Returns null if the user cancels.
 *
 * Order:
 *  1. Ask URL; probe it.
 *  2. If unreachable, port-scan localhost; offer matches.
 *  3. If still nothing AND llm=agent_bridge AND claude detected, offer agent discovery.
 *  4. Fall through: keep user-typed URL with a warning.
 */
async function resolveTargetUrl(input: ResolveTargetUrlInput): Promise<ResolvedTarget | null> {
  const { env, llm, projectDir } = input;

  // Step 1: ask + probe.
  const initialUrl = await ask(
    text({
      message: 'What URL is your product dev server on?',
      placeholder: 'http://localhost:3000',
      defaultValue: 'http://localhost:3000',
      validate: (v) => {
        if (!v) return undefined;
        try {
          new URL(v);
          return undefined;
        } catch {
          return 'Must be a valid URL (e.g. http://localhost:3000).';
        }
      },
    }),
  );
  if (initialUrl === null) return null;

  const probeSpin = spinner();
  probeSpin.start(`Probing ${initialUrl} ...`);
  const directProbe = await probeUrl(initialUrl);
  if (directProbe.reachable) {
    probeSpin.stop(`${initialUrl} reachable (HTTP ${directProbe.statusCode}, ${directProbe.elapsedMs}ms).`);
    return { url: initialUrl };
  }
  probeSpin.stop(`${initialUrl} not reachable yet.`);

  // Step 2: port-scan localhost.
  const scanSpin = spinner();
  scanSpin.start('Scanning common dev-server ports on localhost...');
  let scanHits: ScannedTarget[] = [];
  try {
    scanHits = await scanLocalPorts('localhost');
  } catch {
    // best-effort — ignore scan failures
  }
  if (scanHits.length > 0) {
    scanSpin.stop(`Found ${scanHits.length} responding port${scanHits.length === 1 ? '' : 's'} on localhost.`);
    const pick = await ask(
      select<string>({
        message: 'Use one of the running servers?',
        options: [
          ...scanHits.map((h) => ({
            value: h.url,
            label: `${h.url}  (HTTP ${h.statusCode})`,
          })),
          { value: '__keep__', label: `No — keep what I typed (${initialUrl})` },
          { value: '__agent__', label: 'No — let the agent figure it out (only useful with agent_bridge + claude)' },
        ],
        initialValue: scanHits[0]?.url ?? '__keep__',
      }),
    );
    if (pick === null) return null;
    if (pick !== '__keep__' && pick !== '__agent__') {
      return { url: pick };
    }
    if (pick === '__keep__') {
      warnFallback(initialUrl);
      return { url: initialUrl, warnedUnreachable: true };
    }
    // pick === '__agent__' falls through to step 3.
  } else {
    scanSpin.stop('No common dev ports responding on localhost.');
  }

  // Step 3: agent discovery (only if applicable).
  const agentAvailable = llm === 'agent_bridge' && env.claudeCli;
  if (!agentAvailable) {
    if (scanHits.length === 0) {
      // Didn't already prompt in the scan-hit branch — explicit fallback.
      warnFallback(initialUrl);
      return { url: initialUrl, warnedUnreachable: true };
    }
    return { url: initialUrl, warnedUnreachable: true };
  }

  const useAgent = await ask(
    confirm({
      message: 'Want me to inspect this directory with the `claude` agent and propose a dev-server command + URL?',
      initialValue: true,
    }),
  );
  if (useAgent === null) return null;
  if (useAgent === false) {
    warnFallback(initialUrl);
    return { url: initialUrl, warnedUnreachable: true };
  }

  const discoverSpin = spinner();
  discoverSpin.start('Asking the agent to read your project...');
  let proposal: DevServerProposal;
  try {
    proposal = await discoverDevServer(projectDir);
    discoverSpin.stop('Agent returned a proposal.');
  } catch (err) {
    discoverSpin.stop('Agent inspection failed.');
    note(
      `${err instanceof Error ? err.message : String(err)}\n\nKeeping your typed URL for now. Start your server, then run:\n  showrunner set-target -c demo.yaml --url ${initialUrl}`,
      'Agent error',
    );
    return { url: initialUrl, warnedUnreachable: true };
  }

  note(formatProposal(proposal, projectDir), 'Agent proposal');

  const spawnIt = await ask(
    confirm({
      message: `Spawn \`${proposal.command} ${proposal.args.join(' ')}\` in ${projectDir} and wait for ${proposal.url}?`,
      initialValue: proposal.confidence !== 'low',
    }),
  );
  if (spawnIt === null) return null;
  if (spawnIt === false) {
    note(
      `OK — start the server yourself, then run:\n  showrunner set-target -c demo.yaml --url ${proposal.url}`,
      'Skipping spawn',
    );
    return { url: proposal.url, warnedUnreachable: true };
  }

  const spawnSpin = spinner();
  spawnSpin.start(`Spawning and waiting for ${proposal.url} (up to 60s)...`);
  const spawnResult = await spawnAndWait({
    command: proposal.command,
    args: proposal.args,
    url: proposal.url,
    cwd: projectDir,
  });
  if (spawnResult.ok) {
    spawnSpin.stop(`Dev server up at ${proposal.url} (pid ${spawnResult.pid}).`);
    note(
      `When you're done, stop it with:  kill ${spawnResult.pid}`,
      'Server running',
    );
    return { url: proposal.url, spawnedPid: spawnResult.pid };
  }
  spawnSpin.stop(`Spawn or wait failed.`);
  note(
    `${spawnResult.reason ?? 'unknown error'}\n\nKeeping ${proposal.url} as the configured target. If the server eventually comes up, no action needed; otherwise run:\n  showrunner set-target -c demo.yaml --url <actual-url>`,
    'Spawn issue',
  );
  return { url: proposal.url, warnedUnreachable: true };
}

function warnFallback(url: string): void {
  note(
    `That's fine — you can start your dev server later. When it's up, run:\n\n  showrunner set-target -c demo.yaml --url ${url}\n\nto re-probe and update the config.`,
    'Heads up',
  );
}

function formatProposal(p: DevServerProposal, cwd: string): string {
  return [
    `command:    ${p.command} ${p.args.join(' ')}`,
    `cwd:        ${cwd}`,
    `url:        ${p.url}`,
    `confidence: ${p.confidence}`,
    `rationale:  ${p.rationale}`,
  ].join('\n');
}
