import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Stage, StageResult, PipelineContext } from '../pipeline/types.js';
import { logger } from '../util/logger.js';

export const comprehensionStage: Stage = {
  name: 'comprehension',
  async run(ctx: PipelineContext): Promise<StageResult> {
    const start = Date.now();
    const modelPath = resolve(
      ctx.configDir,
      ctx.config.project.product_model ?? './product_model.json',
    );

    const exists = await fileExists(modelPath);
    const forced = ctx.forced.has('comprehension');

    if (exists && !forced) {
      logger.event({
        stage: 'comprehension',
        status: 'skipped',
        reason: 'product_model.json already present',
        path: modelPath,
      });
      return {
        stage: 'comprehension',
        skipped: true,
        reason: 'product_model.json already present',
        durationMs: Date.now() - start,
        artifacts: { product_model: modelPath },
      };
    }

    logger.event({ stage: 'comprehension', status: 'pending' });
    logger.warn('Comprehension stage is not yet implemented — placeholder run.');

    return {
      stage: 'comprehension',
      skipped: true,
      reason: 'not yet implemented',
      durationMs: Date.now() - start,
      warnings: ['comprehension stage is a stub'],
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
