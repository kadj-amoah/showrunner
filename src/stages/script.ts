import { stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Stage, StageResult, PipelineContext } from '../pipeline/types.js';
import { logger } from '../util/logger.js';
import { readProductModel, ProductModelError } from '../productModel/io.js';
import { readManifest, writeManifest } from '../manifest/io.js';
import { writePlaywrightSpec, writePlaywrightPreviewSpec } from '../manifest/playwrightCodegen.js';
import { writeVoScript } from '../manifest/voScript.js';
import { generateManifest, ManifestGenerationError } from '../scriptGen/generate.js';
import { scrapeSelectorInventory, type SelectorInventoryItem } from '../scriptGen/domPreflight.js';
import { resolveLLMProviderForStage } from '../providers/llm/resolveFromContext.js';

const LOCK_FILENAME = '.showrunner-lock';

export const scriptStage: Stage = {
  name: 'script',
  async run(ctx: PipelineContext): Promise<StageResult> {
    const start = Date.now();
    const warnings: string[] = [];

    const manifestPath = resolve(ctx.configDir, './scripts/manifest.json');
    const specPath = resolve(ctx.configDir, './scripts/playwright_demo.ts');
    const previewSpecPath = resolve(ctx.configDir, './scripts/playwright_demo.spec.ts');
    const voScriptPath = resolve(ctx.configDir, './scripts/vo_script.txt');
    const lockPath = resolve(ctx.configDir, LOCK_FILENAME);
    const productModelPath = resolve(
      ctx.configDir,
      ctx.config.project.product_model ?? './product_model.json',
    );

    const manifestExists = await fileExists(manifestPath);
    const forced = ctx.forced.has('script');

    let manifest;
    if (manifestExists && !forced) {
      logger.event({
        stage: 'script',
        status: 'reusing',
        reason: 'manifest.json present',
        path: manifestPath,
      });
      manifest = await readManifest(manifestPath);
    } else {
      if (!(await fileExists(productModelPath))) {
        return {
          stage: 'script',
          skipped: true,
          reason: `product_model.json not found at ${productModelPath} — run \`showrunner understand\` or restore the file`,
          durationMs: Date.now() - start,
        };
      }

      let productModel;
      try {
        productModel = await readProductModel(productModelPath);
      } catch (err) {
        if (err instanceof ProductModelError) {
          throw new Error(`script stage: ${err.message}`);
        }
        throw err;
      }

      // DOM preflight — scrape the live target so the LLM can't hallucinate selectors.
      // Failure is non-fatal; degrade gracefully to LLM-only generation.
      let selectorInventory: SelectorInventoryItem[] | undefined;
      try {
        logger.event({
          stage: 'script',
          status: 'dom_preflight',
          target_url: ctx.config.recording.target_url,
        });
        selectorInventory = (
          await scrapeSelectorInventory({
            targetUrl: ctx.config.recording.target_url,
            recording: ctx.config.recording,
          })
        ).items;
        logger.event({
          stage: 'script',
          status: 'dom_preflight_done',
          inventory_size: selectorInventory.length,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        warnings.push(`DOM preflight failed: ${cause} — falling back to LLM-only selector generation`);
        logger.warn(`DOM preflight failed: ${cause}`);
      }

      logger.event({ stage: 'script', status: 'generating', source: productModelPath });
      try {
        const provider = resolveLLMProviderForStage(ctx, 'script');
        manifest = await generateManifest({
          productModel,
          scriptConfig: ctx.config.script,
          provider,
          selectorInventory,
        });
      } catch (err) {
        if (err instanceof ManifestGenerationError) {
          throw new Error(`script stage: ${err.message}`);
        }
        throw err;
      }
      await writeManifest(manifestPath, manifest);
      logger.event({
        stage: 'script',
        status: 'manifest_written',
        path: manifestPath,
        segments: manifest.segments.length,
      });
    }

    const codegenInputs = {
      manifest,
      recording: ctx.config.recording,
      targetUrl: ctx.config.recording.target_url,
      videoDir: resolve(ctx.configDir, ctx.config.recording.output_dir),
      traceDir: resolve(ctx.configDir, ctx.config.recording.trace_dir),
    };
    await writePlaywrightSpec(specPath, codegenInputs);
    await writePlaywrightPreviewSpec(previewSpecPath, codegenInputs);
    await writeVoScript(voScriptPath, manifest, { projectName: ctx.config.project.name });
    logger.event({ stage: 'script', status: 'spec_written', path: specPath });
    logger.event({ stage: 'script', status: 'preview_spec_written', path: previewSpecPath });
    logger.event({ stage: 'script', status: 'vo_script_written', path: voScriptPath });

    if (ctx.config.script.vo_review_gate && ctx.interactive) {
      await writeFile(
        lockPath,
        JSON.stringify(
          {
            run_id: ctx.runId,
            stage: 'script',
            reason: 'vo_review_gate',
            vo_script_path: voScriptPath,
            created_at: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      logger.warn(
        `VO review gate engaged. Edit ${voScriptPath}, then run \`showrunner approve-vo --config ${ctx.configPath}\` to resume.`,
      );
      return {
        stage: 'script',
        skipped: false,
        reason: 'paused for vo_review_gate',
        durationMs: Date.now() - start,
        artifacts: {
          manifest: manifestPath,
          playwright_spec: specPath,
          playwright_preview_spec: previewSpecPath,
          vo_script: voScriptPath,
          lock: lockPath,
        },
        warnings,
        meta: { gate: 'vo_review_gate', segments: manifest.segments.length },
        halt: true,
      };
    }

    if (ctx.config.script.vo_review_gate && !ctx.interactive) {
      warnings.push('vo_review_gate is true in config but --no-interactive disabled it');
    }

    return {
      stage: 'script',
      skipped: false,
      durationMs: Date.now() - start,
      artifacts: {
        manifest: manifestPath,
        playwright_spec: specPath,
        playwright_preview_spec: previewSpecPath,
        vo_script: voScriptPath,
      },
      warnings,
      meta: { segments: manifest.segments.length },
    };
  },
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
