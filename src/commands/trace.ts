import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig, ConfigError } from '../config/loader.js';
import { readSlicePlan } from '../mux/slice.js';
import { runCommand, LifecycleScriptError } from '../recording/lifecycle.js';
import { logger } from '../util/logger.js';

export interface TraceOpts {
  config: string;
  segment?: string;
  all?: boolean;
}

export async function traceCommand(opts: TraceOpts): Promise<void> {
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

  const traceDir = resolve(loaded.configDir, loaded.config.recording.trace_dir);
  const videoDir = resolve(loaded.configDir, loaded.config.recording.output_dir);
  const slicePlanPath = join(videoDir, 'slice_plan.json');

  if (opts.all) {
    let plan;
    try {
      plan = await readSlicePlan(slicePlanPath);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      logger.error(`Could not read slice_plan.json at ${slicePlanPath}: ${cause}`);
      process.exit(1);
    }
    for (const seg of plan.segments) {
      const tracePath = seg.trace_path && isAbsolute(seg.trace_path)
        ? seg.trace_path
        : seg.trace_path
        ? resolve(loaded.configDir, seg.trace_path)
        : join(traceDir, `${seg.id}.zip`);
      logger.info(`Opening trace for ${seg.id}`, { path: tracePath });
      await openTrace(tracePath);
    }
    return;
  }

  if (opts.segment) {
    const tracePath = join(traceDir, `${opts.segment}.zip`);
    if (!(await fileExists(tracePath))) {
      logger.error(`No trace found at ${tracePath}`);
      process.exit(1);
    }
    await openTrace(tracePath);
    return;
  }

  const available = await listTraces(traceDir);
  if (available.length === 0) {
    logger.error(`No .zip traces in ${traceDir}. Run \`showrunner run\` first.`);
    process.exit(1);
  }
  process.stdout.write(`Available traces in ${traceDir}:\n`);
  for (const name of available) process.stdout.write(`  ${name}\n`);
  process.stdout.write(
    `\nRe-run with --segment <id> to open one, or --all to open every trace.\n`,
  );
}

async function openTrace(tracePath: string): Promise<void> {
  try {
    await runCommand({
      cmd: 'npx',
      args: ['playwright', 'show-trace', tracePath],
      label: 'trace',
      inherit: true,
    });
  } catch (err) {
    if (err instanceof LifecycleScriptError) {
      // exit code from show-trace can be non-zero on window close; not fatal
      logger.debug(`trace viewer exited`, { code: err.exitCode });
    } else {
      throw err;
    }
  }
}

async function listTraces(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith('.zip')).sort();
  } catch {
    return [];
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
