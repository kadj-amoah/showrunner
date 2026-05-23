import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { z, ZodTypeAny } from 'zod';
import type {
  GenerateStructuredOptions,
  LLMProvider,
} from './types.js';
import { LLMProviderError } from './types.js';

export interface CustomLLMProviderConfig {
  modulePath: string;
  configDir: string;
  /** Free-form provider options forwarded to the loaded module's factory. */
  options?: Record<string, unknown>;
}

/**
 * Loads an operator-supplied module that default-exports either an LLMProvider
 * directly or a factory function `(options) => LLMProvider`. The module is
 * resolved relative to `configDir` and cached for the lifetime of the process.
 */
export class CustomLLMProvider implements LLMProvider {
  private inner: Promise<LLMProvider> | null = null;
  constructor(private readonly cfg: CustomLLMProviderConfig) {}

  async generateStructured<S extends ZodTypeAny>(opts: GenerateStructuredOptions<S>): Promise<z.infer<S>> {
    const provider = await this.load();
    return provider.generateStructured(opts);
  }

  private async load(): Promise<LLMProvider> {
    if (this.inner) return this.inner;
    this.inner = (async () => {
      const absPath = isAbsolute(this.cfg.modulePath)
        ? this.cfg.modulePath
        : resolve(this.cfg.configDir, this.cfg.modulePath);
      let mod: { default?: unknown };
      try {
        mod = (await import(pathToFileURL(absPath).href)) as { default?: unknown };
      } catch (err) {
        throw new LLMProviderError(
          `Failed to load custom LLM module at ${absPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'custom',
          err,
        );
      }
      const exp = mod.default ?? mod;
      if (typeof exp === 'function') {
        const built = await (exp as (o?: unknown) => Promise<LLMProvider> | LLMProvider)(
          this.cfg.options,
        );
        if (!isLLMProvider(built)) {
          throw new LLMProviderError(
            `Custom LLM module at ${absPath} returned a value that is not a LLMProvider (missing generateStructured)`,
            'custom',
          );
        }
        return built;
      }
      if (isLLMProvider(exp)) return exp;
      throw new LLMProviderError(
        `Custom LLM module at ${absPath} must default-export an LLMProvider or a factory function`,
        'custom',
      );
    })();
    return this.inner;
  }
}

function isLLMProvider(v: unknown): v is LLMProvider {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { generateStructured?: unknown }).generateStructured === 'function'
  );
}
