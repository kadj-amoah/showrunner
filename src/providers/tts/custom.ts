import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  TTSProvider,
  TTSSynthesisRequest,
  TTSSynthesisResult,
} from './types.js';
import { TTSProviderError } from './types.js';

export interface CustomTTSProviderConfig {
  modulePath: string;
  configDir: string;
  options?: Record<string, unknown>;
}

/**
 * Loads an operator-supplied module that default-exports either a TTSProvider
 * directly or a factory function. Same shape as CustomLLMProvider.
 */
export class CustomTTSProvider implements TTSProvider {
  readonly name = 'custom';
  // We can't know up-front whether the custom provider supports alignment.
  // Default to false; the actual provider it loads can advertise its own.
  readonly supportsAlignment = false;

  private inner: Promise<TTSProvider> | null = null;
  constructor(private readonly cfg: CustomTTSProviderConfig) {}

  async synthesize(req: TTSSynthesisRequest): Promise<TTSSynthesisResult> {
    const provider = await this.load();
    return provider.synthesize(req);
  }

  private async load(): Promise<TTSProvider> {
    if (this.inner) return this.inner;
    this.inner = (async () => {
      const absPath = isAbsolute(this.cfg.modulePath)
        ? this.cfg.modulePath
        : resolve(this.cfg.configDir, this.cfg.modulePath);
      let mod: { default?: unknown };
      try {
        mod = (await import(pathToFileURL(absPath).href)) as { default?: unknown };
      } catch (err) {
        throw new TTSProviderError(
          `Failed to load custom TTS module at ${absPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'custom',
          err,
        );
      }
      const exp = mod.default ?? mod;
      if (typeof exp === 'function') {
        const built = await (exp as (o?: unknown) => Promise<TTSProvider> | TTSProvider)(
          this.cfg.options,
        );
        if (!isTTSProvider(built)) {
          throw new TTSProviderError(
            `Custom TTS module at ${absPath} returned a value that is not a TTSProvider (missing synthesize)`,
            'custom',
          );
        }
        return built;
      }
      if (isTTSProvider(exp)) return exp;
      throw new TTSProviderError(
        `Custom TTS module at ${absPath} must default-export a TTSProvider or a factory function`,
        'custom',
      );
    })();
    return this.inner;
  }
}

function isTTSProvider(v: unknown): v is TTSProvider {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { synthesize?: unknown }).synthesize === 'function'
  );
}
