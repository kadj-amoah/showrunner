import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import {
  generateProductModelFromDocs,
  generateProductModelFromInteractive,
  ProductModelGenerationError,
} from '../productModel/generate.js';
import { runInteractiveQA } from '../productModel/interactive.js';
import type { DocSource } from '../productModel/prompts.js';
import { resolveDefaultLLMProvider } from '../providers/llm/resolveFromContext.js';
import { logger } from '../util/logger.js';

export interface UnderstandOpts {
  config?: string;
  interactive?: boolean;
  output?: string;
}

export async function understandCommand(opts: UnderstandOpts): Promise<void> {
  let configDir = process.cwd();
  let outputRel = opts.output ?? './product_model.json';
  let sources: { path: string; type: string }[] = [];
  let llmConfig: import('../config/schema.js').LLMConfig | undefined;

  if (opts.config) {
    let loaded;
    try {
      loaded = await loadConfig(opts.config);
    } catch (err) {
      if (err instanceof ConfigError) {
        logger.error(err.message);
        process.exit(2);
      }
      throw err;
    }
    configDir = loaded.configDir;
    // Precedence: explicit --output > config.project.product_model > default.
    if (!opts.output && loaded.config.project.product_model) {
      outputRel = loaded.config.project.product_model;
    }
    sources = loaded.config.comprehension.sources.map((s) => ({ path: s.path, type: s.type }));
    llmConfig = loaded.config.llm;

    const envFile = resolve(loaded.configDir, '.env');
    try {
      process.loadEnvFile(envFile);
    } catch {
      // optional
    }
  }

  const outputPath = isAbsolute(outputRel) ? outputRel : resolve(configDir, outputRel);
  await mkdir(dirname(outputPath), { recursive: true });

  let productModel;
  const provider = resolveDefaultLLMProvider({ configDir, llm: llmConfig });
  try {
    if (opts.interactive) {
      const answers = await runInteractiveQA();
      logger.info('Generating product_model from interactive answers');
      productModel = await generateProductModelFromInteractive({ answers, provider });
    } else {
      if (sources.length === 0) {
        logger.error(
          'No `comprehension.sources` configured in demo.yaml. Add at least one source ' +
            '(prd, readme, codebase, etc.) or re-run with --interactive.',
        );
        process.exit(2);
      }
      const docs: DocSource[] = [];
      for (const src of sources) {
        const abs = isAbsolute(src.path) ? src.path : resolve(configDir, src.path);
        try {
          const content = await readFile(abs, 'utf8');
          docs.push({ path: src.path, type: src.type, content });
        } catch (err) {
          const cause = err instanceof Error ? err.message : String(err);
          logger.warn(`Skipping source ${abs}: ${cause}`);
        }
      }
      if (docs.length === 0) {
        logger.error('No comprehension sources could be read.');
        process.exit(2);
      }
      logger.info('Generating product_model from documents', {
        sources: docs.map((d) => d.path),
      });
      productModel = await generateProductModelFromDocs({ sources: docs, provider });
    }
  } catch (err) {
    if (err instanceof ProductModelGenerationError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  await writeFile(outputPath, JSON.stringify(productModel, null, 2) + '\n', 'utf8');
  logger.info('Wrote product_model.json', { path: outputPath });
}
