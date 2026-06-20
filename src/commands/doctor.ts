import { logger } from '../util/logger.js';
import {
  runChecks,
  runFixLoop,
  summarize,
  type RunChecksOpts,
} from '../doctor/registry.js';
import type { CheckResult } from '../doctor/types.js';

export type { CheckResult, CheckStatus } from '../doctor/types.js';

interface DoctorOpts {
  config?: string;
  json?: boolean;
  fix?: boolean;
}

export async function doctorCommand(opts: DoctorOpts): Promise<void> {
  const runOpts: RunChecksOpts = { configPath: opts.config };
  let results = await runChecks(runOpts);

  if (opts.fix) {
    const anyFixable = results.some((r) => r.status === 'FAIL' && r.fix);
    if (anyFixable) {
      results = await runFixLoop(results, runOpts);
    }
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ results: stripFns(results), summary: summarize(results) }, null, 2) +
        '\n',
    );
  } else {
    for (const r of results) printRow(r);
    const summary = summarize(results);
    if (summary.fail > 0) {
      printFixOrder(results, opts.fix === true);
      logger.error(`doctor: ${summary.fail} FAIL, ${summary.warn} WARN, ${summary.pass} PASS`);
    } else if (summary.warn > 0) {
      logger.warn(`doctor: ${summary.warn} WARN, ${summary.pass} PASS`);
    } else {
      logger.info(`doctor: ${summary.pass}/${results.length} checks passed. ready to run.`);
    }
  }

  if (results.some((r) => r.status === 'FAIL')) {
    process.exit(1);
  }
}

/**
 * Back-compat entry point for `run`'s implicit preflight. Always report-only;
 * `run` decides what to do with the result.
 */
export async function runDoctorChecks(configPath: string): Promise<CheckResult[]> {
  return runChecks({ configPath });
}

function printRow(r: CheckResult): void {
  const tag = `[${r.status}]`;
  const line = `${tag} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`;
  if (r.status === 'FAIL') logger.error(line);
  else if (r.status === 'WARN') logger.warn(line);
  else logger.info(line);
}

function printFixOrder(results: CheckResult[], fixModeWasActive: boolean): void {
  const fails = results.filter((r) => r.status === 'FAIL');
  if (fails.length === 0) return;
  process.stdout.write('\n');
  logger.info('To fix:');
  fails.forEach((r, i) => {
    const hint = r.detail ? ` — ${r.detail}` : '';
    logger.info(`  ${i + 1}. ${r.label}${hint}`);
  });
  if (!fixModeWasActive && fails.some((r) => r.fix)) {
    logger.info('Re-run with `--fix` to be prompted through remediation for the fixable items above.');
  }
  process.stdout.write('\n');
}

function stripFns(results: CheckResult[]): Array<Omit<CheckResult, 'fix'>> {
  return results.map(({ fix: _fix, ...rest }) => rest);
}
