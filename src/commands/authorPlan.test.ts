import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorPlanCommand } from './authorPlan.js';
import { AuthorPlanError } from '../scriptGen/authorPlan.js';
import type { AuthorPlanResult } from '../scriptGen/authorPlan.js';

async function freshOut(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'author-plan-cmd-'));
}

const fakeResult: AuthorPlanResult = {
  manifest: { total_duration_seconds: 3, segments: [{ id: 's1', label: 'A', start: 0, end: 3, vo_line: 'Hi' }] },
  inventory: [],
  warnings: [],
  grounded: true,
};

const origExitCode = process.exitCode;

describe('authorPlanCommand', () => {
  afterEach(() => {
    process.exitCode = origExitCode;
  });

  it('writes the AuthorPlanResult to --out and exits 0 given discrete flags', async () => {
    const out = await freshOut();
    const outFile = join(out, 'plan.json');
    let seenInput: unknown;

    await authorPlanCommand(
      { targetUrl: 'https://example.com', instructions: 'show the dashboard', durationS: '30', out: outFile },
      {
        run: (async (input) => {
          seenInput = input;
          return fakeResult;
        }) as never,
      },
    );

    expect(process.exitCode).toBeUndefined();
    expect(seenInput).toEqual({
      target_url: 'https://example.com',
      instructions: 'show the dashboard',
      duration_s: 30,
    });
    const written = JSON.parse(await readFile(outFile, 'utf8'));
    expect(written).toEqual(fakeResult);
  });

  it('merges --intent file fields with discrete flag overrides', async () => {
    const out = await freshOut();
    const intentFile = join(out, 'intent.json');
    await writeFile(
      intentFile,
      JSON.stringify({ target_url: 'https://from-intent.test', duration_s: 60, instructions: 'from intent' }),
    );
    const outFile = join(out, 'plan.json');
    let seenInput: unknown;

    await authorPlanCommand(
      { intent: intentFile, instructions: 'override wins', out: outFile },
      {
        run: (async (input) => {
          seenInput = input;
          return fakeResult;
        }) as never,
      },
    );

    expect(seenInput).toMatchObject({
      target_url: 'https://from-intent.test',
      duration_s: 60,
      instructions: 'override wins',
    });
  });

  it('writes { error } and exits non-zero on AuthorPlanError — never a partial plan', async () => {
    const out = await freshOut();
    const outFile = join(out, 'plan.json');

    await authorPlanCommand(
      { targetUrl: 'https://unreachable.test', durationS: '10', out: outFile },
      {
        run: (async () => {
          throw new AuthorPlanError('could not inspect https://unreachable.test: net::ERR_CONNECTION_REFUSED');
        }) as never,
      },
    );

    expect(process.exitCode).toBe(1);
    const written = JSON.parse(await readFile(outFile, 'utf8'));
    expect(written).toEqual({
      error: 'could not inspect https://unreachable.test: net::ERR_CONNECTION_REFUSED',
    });
  });

  it('writes { error } and exits non-zero when neither --intent nor --target-url/--duration-s are given', async () => {
    const out = await freshOut();
    const outFile = join(out, 'plan.json');
    const guard = (async () => {
      throw new Error('run should not be called for missing input');
    }) as never;

    await authorPlanCommand({ out: outFile }, { run: guard });

    expect(process.exitCode).toBe(1);
    const written = JSON.parse(await readFile(outFile, 'utf8'));
    expect(written.error).toContain('target URL');
  });

  it('creates a not-yet-existing nested --out directory before writing the plan on success', async () => {
    const out = await freshOut();
    const outFile = join(out, 'nested', 'deeper', 'plan.json');

    await authorPlanCommand(
      { targetUrl: 'https://example.com', instructions: 'show the dashboard', durationS: '30', out: outFile },
      {
        run: (async () => fakeResult) as never,
      },
    );

    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(await readFile(outFile, 'utf8'));
    expect(written).toEqual(fakeResult);
  });

  it('writes { error } JSON to stderr and exits non-zero on failure when --out is omitted', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await authorPlanCommand(
        { targetUrl: 'https://unreachable.test', durationS: '10' },
        {
          run: (async () => {
            throw new AuthorPlanError('could not inspect https://unreachable.test: net::ERR_CONNECTION_REFUSED');
          }) as never,
        },
      );

      expect(process.exitCode).toBe(1);
      expect(stderrSpy).toHaveBeenCalled();
      const written = stderrSpy.mock.calls
        .map((call) => String(call[0]))
        .find((chunk) => {
          try {
            return JSON.parse(chunk).error !== undefined;
          } catch {
            return false;
          }
        });
      expect(written).toBeDefined();
      expect(JSON.parse(written as string)).toEqual({
        error: 'could not inspect https://unreachable.test: net::ERR_CONNECTION_REFUSED',
      });
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
