import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { authorPlan, AuthorPlanError, type AuthorPlanInput, type AuthorPlanResult } from '../scriptGen/authorPlan.js';
import { logger } from '../util/logger.js';

/**
 * CLI-facing options for `showrunner author-plan`. `--intent` supplies a JSON
 * file matching `AuthorPlanInput`; the discrete flags overlay/override it, so
 * either can be used alone or together (discrete flags win on conflict).
 */
export interface AuthorPlanCommandOpts {
  intent?: string;
  targetUrl?: string;
  instructions?: string;
  durationS?: string;
  out?: string;
}

export interface AuthorPlanCommandDeps {
  run?: typeof authorPlan;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * `showrunner author-plan --intent <file.json> --out <plan.json>` (and/or
 * discrete `--target-url --instructions --duration-s`) — explore a live
 * target and author a grounded capture plan via `authorPlan`. Writes the
 * `AuthorPlanResult` JSON to `--out` (or stdout) and exits 0 on success.
 * Any failure (bad input, or an `AuthorPlanError` from a failed inspection)
 * is written as `{ error }` JSON to `--out` (or stderr) with a non-zero
 * exit — never a partial/guessed plan.
 */
export async function authorPlanCommand(
  opts: AuthorPlanCommandOpts,
  deps: AuthorPlanCommandDeps = {},
): Promise<void> {
  const run = deps.run ?? authorPlan;

  try {
    const input = await resolveInput(opts);
    const result = await run(input);
    await emitSuccess(opts.out, result);
  } catch (err) {
    // AuthorPlanError (a failed target inspection) and a bad --intent/flags
    // input both land here: either way the caller gets a non-zero exit and
    // an `{ error }` payload — never a partial/guessed plan.
    const message = err instanceof AuthorPlanError ? err.message : errMsg(err);
    await emitFailure(opts.out, message);
    process.exitCode = 1;
  }
}

async function resolveInput(opts: AuthorPlanCommandOpts): Promise<AuthorPlanInput> {
  let base: Partial<AuthorPlanInput> = {};
  if (opts.intent) {
    const p = isAbsolute(opts.intent) ? opts.intent : resolve(process.cwd(), opts.intent);
    let raw: string;
    try {
      raw = await readFile(p, 'utf8');
    } catch (err) {
      throw new Error(`cannot read --intent file ${p}: ${errMsg(err)}`);
    }
    try {
      base = JSON.parse(raw) as Partial<AuthorPlanInput>;
    } catch (err) {
      throw new Error(`--intent file ${p} is not valid JSON: ${errMsg(err)}`);
    }
  }

  const target_url = opts.targetUrl ?? base.target_url;
  const instructions = opts.instructions ?? base.instructions;
  const duration_s = opts.durationS !== undefined ? Number(opts.durationS) : base.duration_s;

  if (!target_url) {
    throw new Error(
      'author-plan requires a target URL: pass --target-url, or --intent <file.json> with target_url set',
    );
  }
  if (duration_s === undefined || !Number.isFinite(duration_s)) {
    throw new Error(
      'author-plan requires a duration: pass --duration-s <seconds>, or --intent <file.json> with duration_s set',
    );
  }

  return { ...base, target_url, instructions, duration_s };
}

async function emitSuccess(outPath: string | undefined, result: AuthorPlanResult): Promise<void> {
  const json = JSON.stringify(result, null, 2);
  if (outPath) {
    const p = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
    await writeFile(p, json + '\n', 'utf8');
    logger.info('Wrote author-plan result', { path: p });
  } else {
    process.stdout.write(json + '\n');
  }
}

async function emitFailure(outPath: string | undefined, message: string): Promise<void> {
  const payload = { error: message };
  const json = JSON.stringify(payload, null, 2);
  if (outPath) {
    const p = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
    try {
      await writeFile(p, json + '\n', 'utf8');
    } catch (writeErr) {
      logger.error(`author-plan: could not write ${p}: ${errMsg(writeErr)}`);
    }
  }
  logger.error(message);
}
