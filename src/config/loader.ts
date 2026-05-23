import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { showrunnerConfigSchema, type ShowrunnerConfig } from './schema.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(
    message: string,
    readonly issues?: z.ZodIssue[],
    readonly configPath?: string,
  ) {
    super(message);
  }
}

export interface LoadedConfig {
  config: ShowrunnerConfig;
  configPath: string;
  configDir: string;
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const absPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to read config at ${absPath}: ${cause}`, undefined, absPath);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid YAML in ${absPath}: ${cause}`, undefined, absPath);
  }

  return validateConfig(parsed, absPath);
}

export function validateConfig(input: unknown, configPath?: string): LoadedConfig {
  const normalized = normalizeLegacyConfig(input);
  const result = showrunnerConfigSchema.safeParse(normalized);
  if (!result.success) {
    throw new ConfigError(
      formatZodError(result.error),
      result.error.issues,
      configPath,
    );
  }
  return {
    config: result.data,
    configPath: configPath ?? '',
    configDir: configPath ? dirname(configPath) : process.cwd(),
  };
}

const ELEVENLABS_FIELD_KEYS = [
  'voice_id',
  'model',
  'stability',
  'similarity_boost',
  'style',
  'use_speaker_boost',
  'speed',
  'api_key_env',
  'endpoint',
] as const;

/**
 * Reshape pre-v1.1 configs into the discriminated-union shape introduced in B3.
 *
 * Pre-v1.1:
 *   voiceover:
 *     provider: elevenlabs   # string
 *     voice_id: ...          # flat ElevenLabs fields
 *     api_key_env: ...
 *
 * Post-v1.1:
 *   voiceover:
 *     provider:
 *       name: elevenlabs
 *       voice_id: ...
 *       api_key_env: ...
 *
 * Triggered when `voiceover.provider` is missing (defaulted to elevenlabs) OR
 * a string equal to 'elevenlabs'. Modern configs whose `voiceover.provider`
 * is already an object pass through untouched.
 */
export function normalizeLegacyConfig(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const cfg = { ...(input as Record<string, unknown>) };
  const vo = cfg.voiceover as Record<string, unknown> | undefined;
  if (!vo) return cfg;

  const provider = vo.provider;
  const isLegacy =
    provider === undefined ||
    provider === 'elevenlabs' ||
    (typeof provider === 'string' && provider === 'elevenlabs');
  if (!isLegacy) return cfg;

  const elevenSpec: Record<string, unknown> = { name: 'elevenlabs' };
  for (const key of ELEVENLABS_FIELD_KEYS) {
    if (vo[key] !== undefined) elevenSpec[key] = vo[key];
  }

  const cleaned: Record<string, unknown> = { ...vo };
  for (const key of ELEVENLABS_FIELD_KEYS) delete cleaned[key];
  cleaned.provider = elevenSpec;

  cfg.voiceover = cleaned;
  return cfg;
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  ${path}: ${issue.message}`;
  });
  return `Config validation failed:\n${lines.join('\n')}`;
}
