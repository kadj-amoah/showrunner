import type { LLMProvider } from './types.js';
import { LLMProviderError } from './types.js';
import { AnthropicLLMProvider } from './anthropic.js';
import { OpenAILLMProvider } from './openai.js';
import { AgentBridgeLLMProvider, type AgentBridgeConfig } from './agentBridge.js';
import { CustomLLMProvider } from './custom.js';

export interface AnthropicProviderSpec {
  provider: 'anthropic';
  model: string;
  api_key_env: string;
  max_tokens?: number;
}

export interface OpenAIProviderSpec {
  provider: 'openai';
  model: string;
  api_key_env: string;
  max_tokens?: number;
  base_url?: string;
}

export interface AgentBridgeProviderSpec {
  provider: 'agent_bridge';
  bridge: {
    mode: 'spawn' | 'file_poll';
    command?: string;
    args?: string[];
    cwd?: string;
    request_dir?: string;
    poll_interval_ms?: number;
    timeout_ms?: number;
  };
}

export interface CustomProviderSpec {
  provider: 'custom';
  module_path: string;
  options?: Record<string, unknown>;
}

export type LLMProviderSpec =
  | AnthropicProviderSpec
  | OpenAIProviderSpec
  | AgentBridgeProviderSpec
  | CustomProviderSpec;

export interface CreateContext {
  configDir: string;
}

export function createLLMProvider(spec: LLMProviderSpec, ctx: CreateContext): LLMProvider {
  switch (spec.provider) {
    case 'anthropic': {
      const apiKey = process.env[spec.api_key_env];
      if (!apiKey) {
        throw new LLMProviderError(
          `LLM provider 'anthropic' configured with api_key_env='${spec.api_key_env}' but that env var is not set. Set it (e.g. in your project .env) or switch to a different provider.`,
          'anthropic',
        );
      }
      return new AnthropicLLMProvider({
        apiKey,
        model: spec.model,
        maxTokens: spec.max_tokens,
      });
    }
    case 'openai': {
      const apiKey = process.env[spec.api_key_env];
      if (!apiKey) {
        throw new LLMProviderError(
          `LLM provider 'openai' configured with api_key_env='${spec.api_key_env}' but that env var is not set.`,
          'openai',
        );
      }
      return new OpenAILLMProvider({
        apiKey,
        model: spec.model,
        maxTokens: spec.max_tokens,
        baseURL: spec.base_url,
      });
    }
    case 'agent_bridge': {
      const bridgeCfg: AgentBridgeConfig =
        spec.bridge.mode === 'file_poll'
          ? {
              mode: 'file_poll',
              requestDir: spec.bridge.request_dir ?? `${ctx.configDir}/.showrunner-cache/llm-bridge`,
              pollIntervalMs: spec.bridge.poll_interval_ms,
              timeoutMs: spec.bridge.timeout_ms,
            }
          : {
              mode: 'spawn',
              command: spec.bridge.command ?? 'claude',
              args: spec.bridge.args ?? ['-p', '--output-format', 'json'],
              cwd: spec.bridge.cwd,
              timeoutMs: spec.bridge.timeout_ms,
            };
      return new AgentBridgeLLMProvider(bridgeCfg);
    }
    case 'custom':
      return new CustomLLMProvider({
        modulePath: spec.module_path,
        configDir: ctx.configDir,
        options: spec.options,
      });
  }
}

export type LLMStage = 'comprehension' | 'script' | 'instrument';

export interface LLMRouter {
  default: LLMProvider;
  forStage(stage: LLMStage): LLMProvider;
}

export interface LLMRouterConfig {
  default: LLMProviderSpec;
  overrides?: Partial<Record<LLMStage, LLMProviderSpec>>;
}

export function createLLMRouter(cfg: LLMRouterConfig, ctx: CreateContext): LLMRouter {
  // Lazy: only construct each provider on first access. This lets pipelines
  // that run a subset of stages avoid touching the env vars for providers
  // they don't need. Construction failures (missing env var, custom-module
  // import failure) surface when the stage actually tries to use the LLM.
  let cachedDefault: LLMProvider | undefined;
  const getDefault = (): LLMProvider => {
    if (cachedDefault) return cachedDefault;
    cachedDefault = createLLMProvider(cfg.default, ctx);
    return cachedDefault;
  };
  const overrideFactories = new Map<LLMStage, () => LLMProvider>();
  if (cfg.overrides) {
    for (const [stage, spec] of Object.entries(cfg.overrides) as [LLMStage, LLMProviderSpec | undefined][]) {
      if (!spec) continue;
      let cached: LLMProvider | undefined;
      overrideFactories.set(stage, () => {
        if (cached) return cached;
        cached = createLLMProvider(spec, ctx);
        return cached;
      });
    }
  }
  return {
    get default(): LLMProvider {
      return getDefault();
    },
    forStage(stage: LLMStage): LLMProvider {
      const override = overrideFactories.get(stage);
      return override ? override() : getDefault();
    },
  };
}
