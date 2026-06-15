import { z } from 'zod';

const projectSchema = z.object({
  name: z.string().min(1),
  product_model: z.string().optional(),
  /**
   * Path to the product's codebase, resolved relative to demo.yaml's directory.
   * Used by `understand --agent` to anchor the agent's exploration.
   * Defaults to `..` because the canonical scaffold layout places the
   * Showrunner project inside or beside the product directory.
   */
  codebase_root: z.string().optional(),
});

const comprehensionSourceSchema = z.object({
  type: z.enum(['prd', 'readme', 'codebase', 'openapi', 'changelog', 'custom']),
  path: z.string(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const comprehensionSchema = z.object({
  mode: z.enum(['documents', 'interactive']).default('documents'),
  sources: z.array(comprehensionSourceSchema).default([]),
});

const scriptSchema = z.object({
  style: z.string().default('matter-of-fact'),
  duration_target_seconds: z.number().int().positive().default(90),
  highlight_features: z.array(z.string()).default([]),
  vo_review_gate: z.boolean().default(false),
});

const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const stateSchema = z
  .object({
    seed_script: z.string().optional(),
    reset_script: z.string().optional(),
    teardown_script: z.string().optional(),
  })
  .default({});

const authSetupScriptSchema = z.object({
  type: z.literal('setup_script'),
  path: z.string(),
});

const authSessionSchema = z.object({
  type: z.literal('session'),
  cookies_file: z.string(),
  local_storage_file: z.string().optional(),
});

const authFormFieldSchema = z.object({
  selector: z.string(),
  env: z.string(),
});

const authFormSchema = z.object({
  type: z.literal('form'),
  login_url: z.string(),
  fields: z.object({
    email: authFormFieldSchema,
    password: authFormFieldSchema,
  }),
  submit_selector: z.string(),
  success_url_pattern: z.string(),
  timeout_ms: z.number().int().positive().default(5000),
});

const authSchema = z.discriminatedUnion('type', [
  authSetupScriptSchema,
  authSessionSchema,
  authFormSchema,
]);

const recordingSchema = z.object({
  target_url: z.string().url(),
  viewport: viewportSchema.default({ width: 1920, height: 1080 }),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(false),
  output_dir: z.string().default('./segments/video'),
  trace_dir: z.string().default('./segments/traces'),
  cursor_highlight: z.boolean().default(true),
  cursor_min_motion_ms: z.number().int().nonnegative().default(180),
  cursor_max_motion_ms: z.number().int().nonnegative().default(700),
  cursor_post_arrival_ms: z.number().int().nonnegative().default(100),
  cursor_speed_factor: z.number().positive().default(1.0),
  cursor_chain_mode: z.enum(['strict', 'smart']).default('strict'),
  segment_buffer_ms: z.number().int().nonnegative().default(200),
  preflight: z.boolean().default(true),
  state: stateSchema,
  auth: authSchema.optional(),
});

const postProcessSchema = z
  .object({
    debreath: z.boolean().default(true),
  })
  .default({ debreath: true });

const pausePlacementSchema = z
  .object({
    strategy: z.enum(['action_boundaries', 'trailing']).default('trailing'),
    min_silence_ms: z.number().int().nonnegative().default(250),
    snap_window_ms: z.number().int().nonnegative().default(1200),
  })
  .default({});

const normalizationSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({});

const gateSchema = z
  .object({
    policy: z.enum(['warn', 'fail']).default('warn'),
  })
  .default({});

const naturalnessSchema = z
  .object({
    enabled: z.boolean().default(false),
    floor: z.number().optional(),
    python: z.string().default('python'),
    script_path: z.string().default('scripts/utmos_score.py'),
  })
  .default({});

const elevenLabsTTSSchema = z.object({
  name: z.literal('elevenlabs'),
  voice_id: z.string().min(1),
  model: z.string().default('eleven_multilingual_v2'),
  api_key_env: z.string().default('ELEVENLABS_API_KEY'),
  endpoint: z.enum(['with_timestamps', 'basic']).default('with_timestamps'),
  stability: z.number().min(0).max(1).default(0.55),
  similarity_boost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.0),
  use_speaker_boost: z.boolean().default(true),
  speed: z.number().min(0.85).max(1.15).default(1.0),
  pronunciation_dictionary_id: z.string().optional(),
  pronunciation_dictionary_version_id: z.string().optional(),
  apply_text_normalization: z.enum(['auto', 'on', 'off']).default('off'),
});

const openaiTTSSchema = z.object({
  name: z.literal('openai'),
  voice: z.string().default('alloy'),
  model: z.string().default('tts-1-hd'),
  api_key_env: z.string().default('OPENAI_API_KEY'),
  base_url: z.string().optional(),
});

const customTTSSchema = z.object({
  name: z.literal('custom'),
  module_path: z.string(),
  options: z.record(z.unknown()).optional(),
});

const ttsProviderSchema = z.discriminatedUnion('name', [
  elevenLabsTTSSchema,
  openaiTTSSchema,
  customTTSSchema,
]);

const voiceoverSchema = z.object({
  provider: ttsProviderSchema,
  alignment_strategy: z.enum(['required', 'best_effort']).default('required'),
  output_dir: z.string().default('./segments/audio'),
  alignment_dir: z.string().default('./segments/alignment'),
  duration_drift_threshold_pct: z.number().nonnegative().default(15),
  drift_strategy: z.enum(['adjust_timing', 'resynthesize']).default('adjust_timing'),
  tail_padding_ms: z.number().int().nonnegative().default(500),
  post_process: postProcessSchema,
  pause_placement: pausePlacementSchema,
  normalization: normalizationSchema,
  gate: gateSchema,
  naturalness: naturalnessSchema,
});

const anthropicLLMSchema = z.object({
  provider: z.literal('anthropic'),
  model: z.string().default('claude-opus-4-7'),
  api_key_env: z.string().default('ANTHROPIC_API_KEY'),
  max_tokens: z.number().int().positive().optional(),
});

const openaiLLMSchema = z.object({
  provider: z.literal('openai'),
  model: z.string().default('gpt-4o'),
  api_key_env: z.string().default('OPENAI_API_KEY'),
  max_tokens: z.number().int().positive().optional(),
  base_url: z.string().optional(),
});

const agentBridgeLLMSchema = z.object({
  provider: z.literal('agent_bridge'),
  bridge: z.object({
    mode: z.enum(['spawn', 'file_poll']).default('spawn'),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    request_dir: z.string().optional(),
    poll_interval_ms: z.number().int().positive().optional(),
    timeout_ms: z.number().int().positive().optional(),
  }),
});

const customLLMSchema = z.object({
  provider: z.literal('custom'),
  module_path: z.string(),
  options: z.record(z.unknown()).optional(),
});

const llmProviderConfigSchema = z.discriminatedUnion('provider', [
  anthropicLLMSchema,
  openaiLLMSchema,
  agentBridgeLLMSchema,
  customLLMSchema,
]);

const llmSchema = z
  .object({
    default: llmProviderConfigSchema.default({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      api_key_env: 'ANTHROPIC_API_KEY',
    }),
    overrides: z
      .object({
        comprehension: llmProviderConfigSchema.optional(),
        script: llmProviderConfigSchema.optional(),
        instrument: llmProviderConfigSchema.optional(),
      })
      .optional(),
  })
  .default({
    default: {
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      api_key_env: 'ANTHROPIC_API_KEY',
    },
  });

const titleCardSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string(),
  duration_seconds: z.number().positive().default(2),
  font: z.string().optional(),
  font_size: z.number().int().positive().default(48),
  text_color: z.string().default('#FFFFFF'),
  background_color: z.string().default('#0F172A'),
  logo: z.string().optional(),
  logo_position: z.enum(['top_left', 'top_center', 'top_right']).default('top_center'),
});

const outroCardSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string(),
  duration_seconds: z.number().positive().default(2),
});

const brandingSchema = z
  .object({
    title_card: titleCardSchema.optional(),
    outro_card: outroCardSchema.optional(),
  })
  .default({});

const backgroundMusicSchema = z.object({
  path: z.string(),
  volume_db: z.number().default(-22),
});

const captionsSchema = z
  .object({
    enabled: z.boolean().default(false),
    format: z.enum(['srt', 'vtt', 'both']).default('srt'),
  })
  .default({});

const outputSchema = z.object({
  format: z.literal('mp4').default('mp4'),
  resolution: z
    .string()
    .regex(/^\d+x\d+$/, 'Expected WIDTHxHEIGHT (e.g. 1920x1080)')
    .default('1920x1080'),
  fps: z.number().int().positive().default(30),
  codec_video: z.string().default('h264'),
  codec_audio: z.string().default('aac'),
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  branding: brandingSchema,
  background_music: backgroundMusicSchema.optional(),
  captions: captionsSchema,
  output_path: z.string().default('./output/demo_final.mp4'),
});

export const showrunnerConfigSchema = z.object({
  project: projectSchema,
  comprehension: comprehensionSchema.default({ mode: 'documents', sources: [] }),
  script: scriptSchema.default({}),
  recording: recordingSchema,
  voiceover: voiceoverSchema,
  llm: llmSchema,
  output: outputSchema.default({}),
});

export type ShowrunnerConfig = z.infer<typeof showrunnerConfigSchema>;
export type ComprehensionConfig = z.infer<typeof comprehensionSchema>;
export type ScriptConfig = z.infer<typeof scriptSchema>;
export type RecordingConfig = z.infer<typeof recordingSchema>;
export type VoiceoverConfig = z.infer<typeof voiceoverSchema>;
export type OutputConfig = z.infer<typeof outputSchema>;
export type AuthConfig = z.infer<typeof authSchema>;
export type TTSProviderConfig = z.infer<typeof ttsProviderSchema>;
export type ElevenLabsTTSConfig = z.infer<typeof elevenLabsTTSSchema>;
export type OpenAITTSConfig = z.infer<typeof openaiTTSSchema>;
export type LLMConfig = z.infer<typeof llmSchema>;
export type LLMProviderConfig = z.infer<typeof llmProviderConfigSchema>;
