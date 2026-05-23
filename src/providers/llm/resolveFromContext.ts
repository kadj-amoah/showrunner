import type { PipelineContext } from '../../pipeline/types.js';
import type { LLMProvider } from './types.js';
import { LLMProviderError } from './types.js';
import {
  createLLMRouter,
  type LLMProviderSpec,
  type LLMRouter,
  type LLMStage,
} from './factory.js';
import type { LLMProviderConfig } from '../../config/schema.js';

/**
 * Build the LLM router for the current run. Pulls from `ctx.providers.llm`
 * when set (the pipeline pre-wires it for re-use across stages), otherwise
 * lazily constructs one from `ctx.config.llm` and caches via the WeakMap.
 */
const ROUTER_CACHE = new WeakMap<PipelineContext, LLMRouter>();

export function resolveLLMProviderForStage(
  ctx: PipelineContext,
  stage: LLMStage,
): LLMProvider {
  const router = getRouter(ctx);
  return router.forStage(stage);
}

export function resolveDefaultLLMProvider(
  ctxOrConfigDir: PipelineContext | { configDir: string; llm?: import('../../config/schema.js').LLMConfig },
): LLMProvider {
  // Convenience overload for `understand` / `instrument` commands that don't
  // have a full PipelineContext on hand — they pass `{ configDir, llm }` instead.
  if ('config' in (ctxOrConfigDir as PipelineContext) && (ctxOrConfigDir as PipelineContext).config) {
    return getRouter(ctxOrConfigDir as PipelineContext).default;
  }
  const standalone = ctxOrConfigDir as { configDir: string; llm?: import('../../config/schema.js').LLMConfig };
  const llm = standalone.llm ?? {
    default: { provider: 'anthropic', model: 'claude-opus-4-7', api_key_env: 'ANTHROPIC_API_KEY' },
  };
  const router = createLLMRouter(toRouterConfig(llm), { configDir: standalone.configDir });
  return router.default;
}

function getRouter(ctx: PipelineContext): LLMRouter {
  const pre = (ctx as PipelineContext & { providers?: { llm?: LLMRouter } }).providers;
  if (pre?.llm) return pre.llm;

  const cached = ROUTER_CACHE.get(ctx);
  if (cached) return cached;

  // ctx.config.llm gets a schema default, but tests sometimes hand-build ctx
  // without going through loadConfig — fall back to the same default rather
  // than throwing here.
  const llm = ctx.config.llm ?? {
    default: {
      provider: 'anthropic' as const,
      model: 'claude-opus-4-7',
      api_key_env: 'ANTHROPIC_API_KEY',
    },
  };
  const router = createLLMRouter(toRouterConfig(llm), { configDir: ctx.configDir });
  ROUTER_CACHE.set(ctx, router);
  return router;
}

function toRouterConfig(llm: import('../../config/schema.js').LLMConfig): {
  default: LLMProviderSpec;
  overrides?: Partial<Record<LLMStage, LLMProviderSpec>>;
} {
  return {
    default: configToSpec(llm.default),
    overrides: llm.overrides
      ? {
          ...(llm.overrides.comprehension && {
            comprehension: configToSpec(llm.overrides.comprehension),
          }),
          ...(llm.overrides.script && { script: configToSpec(llm.overrides.script) }),
          ...(llm.overrides.instrument && {
            instrument: configToSpec(llm.overrides.instrument),
          }),
        }
      : undefined,
  };
}

function configToSpec(cfg: LLMProviderConfig): LLMProviderSpec {
  // The config shape and the spec shape are aligned by design — same fields,
  // same discriminator. This adapter exists so callers don't import config
  // types into the factory and vice versa.
  switch (cfg.provider) {
    case 'anthropic':
      return {
        provider: 'anthropic',
        model: cfg.model,
        api_key_env: cfg.api_key_env,
        ...(cfg.max_tokens !== undefined && { max_tokens: cfg.max_tokens }),
      };
    case 'openai':
      return {
        provider: 'openai',
        model: cfg.model,
        api_key_env: cfg.api_key_env,
        ...(cfg.max_tokens !== undefined && { max_tokens: cfg.max_tokens }),
        ...(cfg.base_url !== undefined && { base_url: cfg.base_url }),
      };
    case 'agent_bridge':
      return {
        provider: 'agent_bridge',
        bridge: cfg.bridge,
      };
    case 'custom':
      return {
        provider: 'custom',
        module_path: cfg.module_path,
        ...(cfg.options !== undefined && { options: cfg.options }),
      };
  }
}
