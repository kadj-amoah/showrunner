import { spawn } from 'node:child_process';
import { request as undiciRequest } from 'undici';
import type {
  ShowrunnerConfig,
  LLMProviderConfig,
  TTSProviderConfig,
} from '../../config/schema.js';
import type { CheckResult } from '../types.js';
import { fixApiKeyMissing, fixElevenLabsVoiceId } from '../remediate.js';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
}

interface PingResult {
  ok: boolean;
  detail?: string;
  voices?: ElevenLabsVoice[];
}

export async function runFitnessChecks(
  config: ShowrunnerConfig,
  configDir: string,
  configPath: string,
): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const cache = new Map<string, PingResult>();

  // LLM default
  out.push(...(await llmFitness(config.llm.default, undefined, configDir, cache)));

  // LLM per-stage overrides
  if (config.llm.overrides) {
    for (const [stage, spec] of Object.entries(config.llm.overrides)) {
      if (!spec) continue;
      out.push(...(await llmFitness(spec, stage, configDir, cache)));
    }
  }

  // TTS
  out.push(...(await ttsFitness(config.voiceover.provider, configDir, configPath, cache)));

  return out;
}

async function llmFitness(
  spec: LLMProviderConfig,
  stage: string | undefined,
  configDir: string,
  cache: Map<string, PingResult>,
): Promise<CheckResult[]> {
  const stageSuffix = stage ? ` (${stage} override)` : '';

  if (spec.provider === 'anthropic' || spec.provider === 'openai') {
    const envVar = spec.api_key_env;
    const apiKey = process.env[envVar];
    if (!apiKey) {
      return [
        {
          status: 'FAIL',
          label: `llm provider=${spec.provider}${stageSuffix}, ${envVar} NOT set`,
          detail: providerDashboardHint(spec.provider, envVar, 'llm'),
          fix: () => fixApiKeyMissing(envVar, spec.provider, configDir),
        },
      ];
    }
    const cacheKey = `${spec.provider}:${apiKey}`;
    let ping = cache.get(cacheKey);
    if (!ping) {
      ping = spec.provider === 'anthropic'
        ? await pingAnthropic(apiKey)
        : await pingOpenAI(apiKey);
      cache.set(cacheKey, ping);
    }
    if (ping.ok) {
      return [
        {
          status: 'PASS',
          label: `llm provider=${spec.provider}${stageSuffix}, ${envVar} accepted by API`,
        },
      ];
    }
    return [
      {
        status: 'FAIL',
        label: `llm provider=${spec.provider}${stageSuffix}, ${envVar} rejected by API`,
        detail: ping.detail,
        fix: () => fixApiKeyMissing(envVar, spec.provider, configDir),
      },
    ];
  }

  if (spec.provider === 'agent_bridge') {
    const cacheKey = 'agent_bridge';
    let ping = cache.get(cacheKey);
    if (!ping) {
      ping = await pingClaudeCli();
      cache.set(cacheKey, ping);
    }
    if (ping.ok) {
      return [
        {
          status: 'PASS',
          label: `llm provider=agent_bridge${stageSuffix}, claude CLI usable`,
        },
      ];
    }
    return [
      {
        status: 'FAIL',
        label: `llm provider=agent_bridge${stageSuffix}, claude CLI not usable`,
        detail: `${ping.detail ?? 'unknown error'} — install Claude Code from https://github.com/anthropics/claude-code, or switch llm.default.provider to anthropic/openai`,
      },
    ];
  }

  // custom — no actionable fitness check
  return [];
}

async function ttsFitness(
  spec: TTSProviderConfig,
  configDir: string,
  configPath: string,
  cache: Map<string, PingResult>,
): Promise<CheckResult[]> {
  if (spec.name === 'elevenlabs') {
    const envVar = spec.api_key_env;
    const apiKey = process.env[envVar];
    if (!apiKey) {
      return [
        {
          status: 'FAIL',
          label: `tts provider=elevenlabs, ${envVar} NOT set`,
          detail: providerDashboardHint('elevenlabs', envVar, 'tts'),
          fix: () => fixApiKeyMissing(envVar, 'elevenlabs', configDir),
        },
      ];
    }
    const cacheKey = `elevenlabs:${apiKey}`;
    let ping = cache.get(cacheKey);
    if (!ping) {
      ping = await pingElevenLabs(apiKey);
      cache.set(cacheKey, ping);
    }
    if (!ping.ok) {
      return [
        {
          status: 'FAIL',
          label: `tts provider=elevenlabs, ${envVar} rejected by API`,
          detail: ping.detail,
          fix: () => fixApiKeyMissing(envVar, 'elevenlabs', configDir),
        },
      ];
    }
    const voices = ping.voices ?? [];
    const match = voices.find((v) => v.voice_id === spec.voice_id);
    const keyRow: CheckResult = {
      status: 'PASS',
      label: `tts provider=elevenlabs, ${envVar} accepted by API`,
    };
    if (match) {
      return [
        keyRow,
        {
          status: 'PASS',
          label: `elevenlabs voice_id ${spec.voice_id} present in account (${match.name})`,
        },
      ];
    }
    return [
      keyRow,
      {
        status: 'FAIL',
        label: `elevenlabs voice_id ${spec.voice_id} not in account's voice catalog`,
        detail: `account has ${voices.length} voice(s) available — pick one with --fix, or edit voiceover.provider.voice_id in demo.yaml`,
        fix: () => fixElevenLabsVoiceId(apiKey, configPath, spec.voice_id),
      },
    ];
  }

  if (spec.name === 'openai') {
    const envVar = spec.api_key_env;
    const apiKey = process.env[envVar];
    if (!apiKey) {
      return [
        {
          status: 'FAIL',
          label: `tts provider=openai, ${envVar} NOT set`,
          detail: providerDashboardHint('openai', envVar, 'tts'),
          fix: () => fixApiKeyMissing(envVar, 'openai', configDir),
        },
      ];
    }
    const cacheKey = `openai:${apiKey}`;
    let ping = cache.get(cacheKey);
    if (!ping) {
      ping = await pingOpenAI(apiKey);
      cache.set(cacheKey, ping);
    }
    if (ping.ok) {
      return [
        {
          status: 'PASS',
          label: `tts provider=openai, ${envVar} accepted by API`,
        },
      ];
    }
    return [
      {
        status: 'FAIL',
        label: `tts provider=openai, ${envVar} rejected by API`,
        detail: ping.detail,
        fix: () => fixApiKeyMissing(envVar, 'openai', configDir),
      },
    ];
  }

  // custom — no actionable fitness check
  return [];
}

async function pingAnthropic(apiKey: string): Promise<PingResult> {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: formatProviderError(err) };
  }
}

async function pingOpenAI(apiKey: string): Promise<PingResult> {
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });
    await client.models.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: formatProviderError(err) };
  }
}

async function pingElevenLabs(apiKey: string): Promise<PingResult> {
  try {
    const res = await undiciRequest('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
      bodyTimeout: 10000,
      headersTimeout: 10000,
    });
    if (res.statusCode === 200) {
      const body = (await res.body.json()) as { voices?: ElevenLabsVoice[] };
      return { ok: true, voices: body.voices ?? [] };
    }
    let bodyText = '';
    try {
      bodyText = await res.body.text();
    } catch {
      // ignore
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      return { ok: false, detail: `HTTP ${res.statusCode}: invalid API key` };
    }
    return {
      ok: false,
      detail: `HTTP ${res.statusCode}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function pingClaudeCli(): Promise<PingResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, detail?: string): void => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };
    let child;
    try {
      const useShell = process.platform === 'win32';
      child = spawn('claude', ['--version'], { stdio: 'ignore', shell: useShell });
    } catch (err) {
      finish(false, err instanceof Error ? err.message : String(err));
      return;
    }
    child.on('error', (err) =>
      finish(false, err instanceof Error ? err.message : 'claude not on PATH'),
    );
    child.on('exit', (code) =>
      finish(code === 0, code === 0 ? undefined : `exit ${code}`),
    );
    setTimeout(() => {
      if (!settled) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        finish(false, 'timed out probing claude --version');
      }
    }, 5000);
  });
}

function formatProviderError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403) {
      return `HTTP ${e.status}: invalid API key`;
    }
    if (e.status) {
      return `HTTP ${e.status}: ${e.message ?? 'request failed'}`;
    }
    if (e.message) return e.message;
  }
  return String(err);
}

const DASHBOARDS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
};

function providerDashboardHint(provider: string, envVar: string, slot: 'llm' | 'tts'): string {
  const dash = DASHBOARDS[provider];
  const dashHint = dash ? ` (get a key from ${dash})` : '';
  const altHint =
    slot === 'llm'
      ? ` — or switch llm.default.provider to "agent_bridge" in demo.yaml to use a local CLI agent (no API key needed)`
      : '';
  return `add ${envVar}=... to your project's .env file${dashHint}${altHint}`;
}
