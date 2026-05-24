import { AgentBridgeLLMProvider } from '../providers/llm/agentBridge.js';
import { generateWithRetry } from '../providers/llm/withRetry.js';
import { logger } from '../util/logger.js';
import { productModelSchema, type ProductModel } from './schema.js';
import { ProductModelGenerationError } from './generate.js';

export interface GenerateViaAgentOptions {
  /** Working directory the agent will explore (defaults to process.cwd()). */
  projectDir: string;
  /** Override the agent binary on PATH (default: "claude"). */
  command?: string;
  args?: string[];
  /** Hard cap on the LLM call (default 180s — agent exploration can take a while). */
  timeoutMs?: number;
}

const DEFAULT_MAX_TOKENS = 8000;

const AGENT_SYSTEM_PROMPT = [
  "You are helping Showrunner build a product_model.json for a product demo recording.",
  '',
  'You have read-only filesystem tools (Read, Glob, Grep) and can explore the project freely.',
  'Use them — do NOT guess from the prompt alone.',
  '',
  'What to look for, in order:',
  '  1. package.json (or pyproject.toml, Cargo.toml, etc.) — name, description, scripts, deps',
  '  2. README.md / README.* at the project root — product description, primary user, features',
  '  3. docs/PRD.md or similar — explicit product brief if present',
  '  4. src/ tree (sample a few files) — what the product actually DOES, names of routes/pages/components',
  '  5. .env.example — hints at integrations and external services',
  '  6. Any framework config (next.config, vite.config, astro.config, etc.) — confirms what kind of app this is',
  '',
  'When you have enough signal, synthesize a product_model.json matching the requested schema.',
  '',
  'Rules:',
  '  - product_name: short, exact product name as branded. Take this from package.json "name" only if it looks human, else from README.',
  '  - tagline: one sentence, 8–15 words, plain language. Derived from README/PRD, not invented.',
  '  - primary_user: one short phrase. Inferred from the README\'s "who is this for" framing if explicit, else from the product\'s shape.',
  "  - core_flows: 2–4 user flows. Each has id (kebab-case), name, 3–6 imperative steps from the user's POV, optional entry_url. Ground these in the actual routes/pages the codebase exposes.",
  '  - key_features: 3–6 short bullets. No marketing fluff.',
  '  - demo_recommendation.suggested_flows: ids from core_flows, in demo order.',
  '  - demo_recommendation.suggested_duration_seconds: 60–90 typical.',
  "  - confidence: 'high' if you found explicit, clear sources; 'medium' if you had to infer; 'low' if the codebase was sparse and you mostly guessed.",
  "  - source: always 'documents' (this path counts as document-driven, just agentically discovered).",
  '  - generated_at: ISO-8601 timestamp.',
  '',
  'Output exactly the structured JSON. No prose, no commentary, no markdown fence outside the JSON.',
].join('\n');

export async function generateProductModelViaAgent(
  opts: GenerateViaAgentOptions,
): Promise<ProductModel> {
  const provider = new AgentBridgeLLMProvider({
    mode: 'spawn',
    command: opts.command ?? 'claude',
    args: opts.args ?? [
      '-p',
      '--output-format',
      'json',
      // Explicitly allow read-only filesystem tools so claude doesn't stall on
      // permission ambiguity in headless mode. Comma-separated per claude CLI syntax.
      '--allowedTools',
      'Read,Glob,Grep',
    ],
    // 90s cap — was 180s in v1.1.6, dropped here because failures should fail fast.
    timeoutMs: opts.timeoutMs ?? 90_000,
    cwd: opts.projectDir,
  });

  const userPrompt = [
    `Project directory: ${opts.projectDir}`,
    '',
    'Explore this directory with your filesystem tools, then synthesize a product_model.json.',
  ].join('\n');

  logger.debug('Generating product_model via agent', { projectDir: opts.projectDir });

  try {
    return await generateWithRetry(provider, {
      systemPrompt: AGENT_SYSTEM_PROMPT,
      userPrompt,
      schema: productModelSchema,
      schemaName: 'product_model',
      maxTokens: DEFAULT_MAX_TOKENS,
      retryRenderer: (errorText, prevUserPrompt) =>
        `${prevUserPrompt}\n\nYour previous output failed validation with this error:\n${errorText}\n\nRegenerate the product_model strictly matching the schema.`,
    });
  } catch (err) {
    throw new ProductModelGenerationError(err instanceof Error ? err.message : String(err));
  }
}
