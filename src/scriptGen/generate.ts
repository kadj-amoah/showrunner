import { parseManifest, ManifestError } from '../manifest/io.js';
import { manifestSchema, type Manifest } from '../manifest/schema.js';
import type { ProductModel } from '../productModel/schema.js';
import type { ScriptConfig } from '../config/schema.js';
import { logger } from '../util/logger.js';
import type { LLMProvider } from '../providers/llm/types.js';
import { generateWithRetry } from '../providers/llm/withRetry.js';
import type { SelectorInventoryItem } from './domPreflight.js';
import {
  MANIFEST_GENERATOR_SYSTEM_PROMPT,
  renderManifestUserPrompt,
  renderRetryPrompt,
} from './prompts.js';
import {
  renderSelectorRemediation,
  validateManifestSelectors,
} from './validateSelectors.js';

const DEFAULT_MAX_TOKENS = 16000;

export interface GenerateManifestOptions {
  productModel: ProductModel;
  scriptConfig: ScriptConfig;
  provider: LLMProvider;
  selectorInventory?: SelectorInventoryItem[];
}

export class ManifestGenerationError extends Error {
  override readonly name = 'ManifestGenerationError';
}

export async function generateManifest(opts: GenerateManifestOptions): Promise<Manifest> {
  logger.debug('Generating manifest via LLM provider');
  try {
    const parsed = await generateWithRetry(opts.provider, {
      systemPrompt: MANIFEST_GENERATOR_SYSTEM_PROMPT,
      userPrompt: renderManifestUserPrompt(
        opts.productModel,
        opts.scriptConfig,
        opts.selectorInventory,
      ),
      schema: manifestSchema,
      schemaName: 'manifest',
      maxTokens: DEFAULT_MAX_TOKENS,
      retryRenderer: (errorText) =>
        renderRetryPrompt(
          opts.productModel,
          opts.scriptConfig,
          errorText,
          opts.selectorInventory,
        ),
    });

    let manifest: Manifest;
    try {
      manifest = parseManifest(parsed);
    } catch (err) {
      if (err instanceof ManifestError) {
        throw new ManifestGenerationError(`Manifest validation failed: ${err.message}`);
      }
      throw err;
    }

    // Post-validation: only if we have an inventory to compare against. With
    // no inventory the manifest's selectors are best-effort regardless.
    if (opts.selectorInventory && opts.selectorInventory.length > 0) {
      const check = validateManifestSelectors(manifest, opts.selectorInventory);
      if (!check.ok) {
        logger.warn(
          `manifest selector check failed: ${check.violations.length} violation(s) — retrying with remediation`,
          { violations: check.violations.length },
        );
        for (const v of check.violations.slice(0, 5)) {
          logger.debug(`  ${v.segmentId}/${v.actionIndex}: ${v.reason} — ${v.selector}`);
        }

        const remediationUserPrompt = [
          renderManifestUserPrompt(opts.productModel, opts.scriptConfig, opts.selectorInventory),
          '',
          renderSelectorRemediation(check.violations),
        ].join('\n');

        const retryResult = await opts.provider.generateStructured({
          systemPrompt: MANIFEST_GENERATOR_SYSTEM_PROMPT,
          userPrompt: remediationUserPrompt,
          schema: manifestSchema,
          schemaName: 'manifest',
          maxTokens: DEFAULT_MAX_TOKENS,
        });

        let retried: Manifest;
        try {
          retried = parseManifest(retryResult);
        } catch (err) {
          // Retry returned schema-invalid output — fall back to the first manifest
          // (violations and all). The record stage will warn per-failed-action
          // rather than crashing the whole pipeline.
          logger.warn(
            `selector-remediation retry returned schema-invalid output — keeping original manifest`,
            { error: err instanceof Error ? err.message : String(err) },
          );
          return manifest;
        }

        const recheck = validateManifestSelectors(retried, opts.selectorInventory);
        if (recheck.ok) {
          logger.event({ stage: 'script', status: 'selector_retry_resolved', segments: retried.segments.length });
        } else {
          logger.warn(
            `selector-remediation retry still has ${recheck.violations.length} violation(s) — accepting anyway`,
            { remaining: recheck.violations.length },
          );
        }
        return retried;
      }
    }

    return manifest;
  } catch (err) {
    if (err instanceof ManifestGenerationError) throw err;
    throw new ManifestGenerationError(
      err instanceof Error ? err.message : String(err),
    );
  }
}
