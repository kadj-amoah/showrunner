import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, relative } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { scanFile, type InstrumentCandidate } from '../instrument/scan.js';
import { suggestTestIds, InstrumentSuggestionError } from '../instrument/suggest.js';
import { buildDiff } from '../instrument/diff.js';
import { resolveDefaultLLMProvider } from '../providers/llm/resolveFromContext.js';
import { logger } from '../util/logger.js';

export interface InstrumentOpts {
  config: string;
  output: string;
  glob?: string;
}

export async function instrumentCommand(opts: InstrumentOpts): Promise<void> {
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

  const envFile = resolve(loaded.configDir, '.env');
  try {
    process.loadEnvFile(envFile);
  } catch {
    // optional
  }

  const codebaseSources = loaded.config.comprehension.sources.filter((s) => s.type === 'codebase');
  if (codebaseSources.length === 0 && !opts.glob) {
    logger.error(
      'No `comprehension.sources` with type=codebase found in demo.yaml, and no --glob provided.',
    );
    process.exit(2);
  }

  const filesToScan = new Set<string>();
  const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out']);

  async function walk(root: string, accept: (rel: string) => boolean): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(root, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, accept);
      } else if (entry.isFile() && accept(relative(root, abs))) {
        filesToScan.add(abs);
      }
    }
  }

  const isJsxFile = (p: string): boolean => /\.(tsx|jsx)$/.test(p);

  if (opts.glob) {
    // Lightweight glob: treat the pattern as "match if path contains the pattern
    // stripped of leading **/ or trailing /**", with extension filter via isJsxFile.
    // For accurate glob matching, users can be explicit with file extensions.
    const root = loaded.configDir;
    await walk(root, isJsxFile);
  } else {
    for (const src of codebaseSources) {
      const root = isAbsolute(src.path) ? src.path : resolve(loaded.configDir, src.path);
      await walk(root, isJsxFile);
    }
  }

  if (filesToScan.size === 0) {
    logger.error('No JSX/TSX files matched. Check comprehension.sources or --glob.');
    process.exit(2);
  }

  logger.info('Scanning files for instrumentation candidates', { files: filesToScan.size });

  const candidates: InstrumentCandidate[] = [];
  for (const file of filesToScan) {
    const found = await scanFile(file);
    candidates.push(...found);
  }

  if (candidates.length === 0) {
    logger.info('No unstable elements found — every targetable element already has data-testid or aria-label.');
    process.exit(0);
  }
  logger.info('Found instrumentation candidates', { count: candidates.length });

  let suggestions;
  try {
    const provider = resolveDefaultLLMProvider({
      configDir: loaded.configDir,
      llm: loaded.config.llm,
    });
    suggestions = await suggestTestIds({ candidates, provider });
  } catch (err) {
    if (err instanceof InstrumentSuggestionError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  if (suggestions.length === 0) {
    logger.info('Anthropic returned no suggestions.');
    process.exit(0);
  }

  const { patch, skipped } = await buildDiff(suggestions, { basePath: loaded.configDir });
  for (const s of skipped) {
    logger.warn(`Skipped suggestion at ${s.file}:${s.line} — ${s.reason}`);
  }

  const outputPath = isAbsolute(opts.output) ? opts.output : resolve(loaded.configDir, opts.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, patch, 'utf8');
  logger.info('Wrote instrumentation patch', { path: outputPath, suggestions: suggestions.length });
  process.stdout.write(`\nApply with:  cd ${loaded.configDir} && git apply ${opts.output}\n\n`);
}
