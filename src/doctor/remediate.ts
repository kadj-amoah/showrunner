import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { confirm, isCancel, log, password, select } from '@clack/prompts';
import yaml from 'js-yaml';
import { request as undiciRequest } from 'undici';
import type { FixResult } from './types.js';
import { detectPackageManager, type PackageManagerName } from './packageManager.js';
import { resolvePlaywrightCoreCli } from '../setup/playwrightCli.js';
import { upsertEnv } from './envFile.js';
import type { ElevenLabsVoice } from './checks/fitness.js';

const FFMPEG_PACKAGE_BY_PM: Record<PackageManagerName, string> = {
  pacman: 'ffmpeg',
  apt: 'ffmpeg',
  dnf: 'ffmpeg',
  brew: 'ffmpeg',
  winget: 'Gyan.FFmpeg',
  choco: 'ffmpeg',
};

export async function fixFfmpegMissing(): Promise<FixResult> {
  if (!process.stdout.isTTY) {
    return {
      outcome: 'SKIPPED',
      detail: 'remediation requires an interactive terminal',
    };
  }
  const pm = await detectPackageManager();
  if (!pm) {
    return {
      outcome: 'FAILED',
      detail:
        'no supported package manager detected (pacman / apt / dnf / brew / winget / choco) — install ffmpeg manually',
    };
  }
  const pkg = FFMPEG_PACKAGE_BY_PM[pm.name];
  const proceed = await confirm({
    message: `Install ffmpeg via \`${pm.installCmd(pkg)}\`? (also provides ffprobe)`,
    initialValue: true,
  });
  if (isCancel(proceed) || proceed === false) {
    return { outcome: 'SKIPPED', detail: 'user declined' };
  }
  return runInstall(pm.installArgv(pkg));
}

export async function fixChromiumMissing(browserName: string): Promise<FixResult> {
  if (!process.stdout.isTTY) {
    return {
      outcome: 'SKIPPED',
      detail: 'remediation requires an interactive terminal',
    };
  }
  const proceed = await confirm({
    message: `Install Playwright ${browserName} now?`,
    initialValue: true,
  });
  if (isCancel(proceed) || proceed === false) {
    return { outcome: 'SKIPPED', detail: 'user declined' };
  }
  try {
    const cli = await resolvePlaywrightCoreCli();
    log.info(`running: playwright-core install ${browserName}`);
    return await runInstall({
      cmd: process.execPath,
      args: [cli, 'install', browserName],
    });
  } catch (err) {
    return {
      outcome: 'FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function runInstall({ cmd, args }: { cmd: string; args: string[] }): Promise<FixResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', (err) => {
      resolve({ outcome: 'FAILED', detail: err.message });
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ outcome: 'FIXED' });
      } else {
        resolve({
          outcome: 'FAILED',
          detail: `install exited with code ${code}`,
        });
      }
    });
  });
}

const DASHBOARDS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
};

export async function fixApiKeyMissing(
  envVar: string,
  provider: string,
  configDir: string,
): Promise<FixResult> {
  if (!process.stdout.isTTY) {
    return {
      outcome: 'SKIPPED',
      detail: 'remediation requires an interactive terminal',
    };
  }
  const dash = DASHBOARDS[provider];
  if (dash) log.info(`Get a ${provider} API key at ${dash}`);
  const value = await password({
    message: `Paste ${envVar} value (input hidden):`,
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'value cannot be empty';
      if (/\s/.test(v.trim())) return 'value must not contain whitespace';
      return undefined;
    },
  });
  if (isCancel(value) || typeof value !== 'string') {
    return { outcome: 'SKIPPED', detail: 'user cancelled' };
  }
  const trimmed = value.trim();
  const envPath = join(configDir, '.env');
  try {
    await upsertEnv(envPath, envVar, trimmed);
  } catch (err) {
    return {
      outcome: 'FAILED',
      detail: `failed to write ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  process.env[envVar] = trimmed;
  return { outcome: 'FIXED', detail: `${envVar} written to ${envPath}` };
}

export async function fixElevenLabsVoiceId(
  apiKey: string,
  configPath: string,
  currentId: string,
): Promise<FixResult> {
  if (!process.stdout.isTTY) {
    return {
      outcome: 'SKIPPED',
      detail: 'remediation requires an interactive terminal',
    };
  }
  let voices: ElevenLabsVoice[];
  try {
    voices = await fetchElevenLabsVoices(apiKey);
  } catch (err) {
    return {
      outcome: 'FAILED',
      detail: `failed to list ElevenLabs voices: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (voices.length === 0) {
    return {
      outcome: 'FAILED',
      detail: 'ElevenLabs account returned 0 voices — add a voice in the dashboard first',
    };
  }
  const picked = await select<string>({
    message: `Pick a voice (current: ${currentId} — not in account)`,
    options: voices.map((v) => ({
      value: v.voice_id,
      label: `${v.name}  —  ${v.voice_id}`,
    })),
  });
  if (isCancel(picked) || typeof picked !== 'string') {
    return { outcome: 'SKIPPED', detail: 'user cancelled' };
  }
  try {
    await rewriteVoiceId(configPath, picked);
  } catch (err) {
    return {
      outcome: 'FAILED',
      detail: `failed to rewrite demo.yaml: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { outcome: 'FIXED', detail: `voiceover.provider.voice_id → ${picked}` };
}

async function fetchElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await undiciRequest('https://api.elevenlabs.io/v1/voices', {
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
    bodyTimeout: 10000,
    headersTimeout: 10000,
  });
  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode}`);
  }
  const body = (await res.body.json()) as { voices?: ElevenLabsVoice[] };
  return body.voices ?? [];
}

async function rewriteVoiceId(configPath: string, newId: string): Promise<void> {
  const abs = isAbsolute(configPath) ? configPath : resolvePath(process.cwd(), configPath);
  const rawText = await readFile(abs, 'utf8');
  const doc = yaml.load(rawText) as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object') {
    throw new Error('demo.yaml did not parse to an object');
  }
  const voiceover = doc['voiceover'];
  if (!voiceover || typeof voiceover !== 'object') {
    throw new Error('demo.yaml has no `voiceover` block');
  }
  const provider = (voiceover as Record<string, unknown>)['provider'];
  if (!provider || typeof provider !== 'object') {
    throw new Error('demo.yaml has no `voiceover.provider` block');
  }
  (provider as Record<string, unknown>)['voice_id'] = newId;

  const newText = yaml.dump(doc, { lineWidth: 100, noRefs: true, sortKeys: false });
  await writeFile(abs, newText, 'utf8');
}
