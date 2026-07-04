import {
  scrapeSelectorInventory,
  type ScrapeOptions,
  type ScrapeResult,
  type SelectorInventoryItem,
} from './domPreflight.js';
import { generateManifest, type GenerateManifestOptions } from './generate.js';
import { validateManifestSelectors } from './validateSelectors.js';
import { productModelSchema } from '../productModel/schema.js';
import {
  recordingSchema,
  scriptSchema,
  llmSchema,
  authSchema,
  type RecordingConfig,
  type ScriptConfig,
  type LLMConfig,
} from '../config/schema.js';
import { resolveDefaultLLMProvider } from '../providers/llm/resolveFromContext.js';
import type { Manifest } from '../manifest/schema.js';
import { logger } from '../util/logger.js';
import { detectAuthWall, type AuthChallenge } from './detectAuthWall.js';
import { buildAuthPlan, type AuthPlan } from '../recording/auth.js';

export interface AuthorPlanInput {
  target_url: string;
  instructions?: string;
  duration_s: number;
  /** Defaults to the URL host if absent. */
  product_name?: string;
  /** Optional; parsed with `productModelSchema` if given. */
  product_model?: unknown;
  /** Default 1920x1080. */
  viewport?: { width: number; height: number };
  /** Default 'chromium'. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** For provider resolution; default `process.cwd()`. */
  configDir?: string;
  /** Optional llm config; default agent_bridge spawning `claude`. */
  llm?: unknown;
  /** Optional auth for the explore browser; parsed with authSchema (form|session|setup_script). */
  auth?: unknown;
  /** If set, persist the post-login storageState here for reuse. */
  session_out?: string;
}

export interface AuthorPlanOk {
  status: 'ok';
  manifest: Manifest;
  inventory: SelectorInventoryItem[];
  warnings: string[];
  /** True iff a non-empty inventory backed the authoring. */
  grounded: boolean;
}

export interface AuthorPlanNeedsAuth {
  status: 'needs_auth';
  auth_challenge: AuthChallenge;
  final_url: string;
}

export type AuthorPlanResult = AuthorPlanOk | AuthorPlanNeedsAuth;

export class AuthorPlanError extends Error {
  override readonly name = 'AuthorPlanError';
}

export interface AuthorPlanDeps {
  scrape?: (opts: ScrapeOptions) => Promise<ScrapeResult>;
  generate?: (opts: GenerateManifestOptions) => Promise<Manifest>;
  buildAuth?: (auth: unknown, configDir: string) => Promise<AuthPlan>;
}

/**
 * Delegate capture-plan authoring: explore a live target's real DOM, then
 * author a capture manifest grounded in that inventory (`generateManifest`
 * runs its own validate/remediate loop against it). Never hands back a
 * guessed plan when the target can't be inspected — that failure is a hard
 * `AuthorPlanError`.
 */
export async function authorPlan(
  input: AuthorPlanInput,
  deps: AuthorPlanDeps = {},
): Promise<AuthorPlanResult> {
  const scrape = deps.scrape ?? scrapeSelectorInventory;
  const generate = deps.generate ?? generateManifest;
  const buildAuth =
    deps.buildAuth ??
    ((a: unknown, dir: string) => buildAuthPlan(a ? authSchema.parse(a) : undefined, dir));

  const recording: RecordingConfig = recordingSchema.parse({
    target_url: input.target_url,
    viewport: input.viewport,
    browser: input.browser,
  });

  const scriptConfig: ScriptConfig = scriptSchema.parse({
    duration_target_seconds: Math.round(input.duration_s),
  });

  const productModel = input.product_model
    ? productModelSchema.parse(input.product_model)
    : productModelSchema.parse({
        product_name: input.product_name ?? hostOf(input.target_url),
        demo_recommendation: {
          suggested_duration_seconds: Math.max(1, Math.round(input.duration_s)),
        },
      });

  // No raw ANTHROPIC_API_KEY is available in this environment — default to
  // the agent_bridge provider, which spawns the local `claude` CLI, rather
  // than relying on resolveDefaultLLMProvider's built-in anthropic default.
  const llmInput =
    input.llm ??
    {
      default: {
        provider: 'agent_bridge' as const,
        bridge: {
          mode: 'spawn' as const,
          command: 'claude',
          args: ['-p', '--output-format', 'json'],
        },
      },
    };
  const llm: LLMConfig = llmSchema.parse(llmInput);
  const provider = resolveDefaultLLMProvider({
    configDir: input.configDir ?? process.cwd(),
    llm,
  });

  let inventory: SelectorInventoryItem[];
  let finalUrl: string;
  try {
    // Building the AuthPlan lives in this same try/catch as the scrape call
    // itself: a malformed `auth` (bad authSchema shape, missing cookies_file,
    // etc.) is just as much a "couldn't inspect the target" failure as a
    // network error, and should surface the same named AuthorPlanError rather
    // than an untyped AuthError escaping authorPlan.
    const authPlan = input.auth
      ? await buildAuth(input.auth, input.configDir ?? process.cwd())
      : undefined;
    const scraped = await scrape({
      targetUrl: input.target_url,
      recording,
      auth: authPlan,
      sessionOutPath: input.session_out,
    });
    inventory = scraped.items;
    finalUrl = scraped.finalUrl;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new AuthorPlanError(`could not inspect ${input.target_url}: ${cause}`);
  }

  const challenge = detectAuthWall(input.target_url, finalUrl, inventory);
  if (challenge && !input.auth) {
    // Landed on an auth wall and no credentials/session were supplied — surface it.
    return { status: 'needs_auth', auth_challenge: challenge, final_url: finalUrl };
  }
  if (challenge && input.auth) {
    // Auth WAS supplied but we're still on the wall — login did not take.
    return { status: 'needs_auth', auth_challenge: { ...challenge }, final_url: finalUrl };
  }

  const warnings: string[] = [];
  let grounded = inventory.length > 0;
  if (!grounded) {
    warnings.push('DOM inventory was empty — plan is not grounded to real selectors');
    logger.warn(`authorPlan: DOM inventory for ${input.target_url} was empty — proceeding ungrounded`);
  }

  let manifest: Manifest;
  try {
    manifest = await generate({
      productModel,
      scriptConfig,
      provider,
      selectorInventory: inventory,
      guidance: input.instructions,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new AuthorPlanError(`could not author a capture manifest for ${input.target_url}: ${cause}`);
  }

  // generateManifest runs its own validate/remediate loop, but when the LLM
  // still emits out-of-inventory selectors after a retry, it logs a warning
  // and returns the manifest anyway (see generate.ts's "accepting anyway"
  // path). Re-check here so the single `grounded` boolean callers gate on
  // stays trustworthy — a plan with any ungrounded selector isn't grounded.
  if (grounded) {
    const check = validateManifestSelectors(manifest, inventory);
    if (!check.ok) {
      grounded = false;
      const badSelectors = check.violations.map((v) => v.selector).join(', ');
      warnings.push(
        `${check.violations.length} selector(s) not found in the live DOM inventory — plan is not fully grounded: ${badSelectors}`,
      );
    }
  }

  return { status: 'ok', manifest, inventory, warnings, grounded };
}

function hostOf(url: string): string {
  try {
    const host = new URL(url).host;
    return host || 'App';
  } catch {
    return 'App';
  }
}
