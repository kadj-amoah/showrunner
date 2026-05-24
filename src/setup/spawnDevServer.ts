import { spawn } from 'node:child_process';
import { probeUrl } from './targetProbe.js';

export interface SpawnResult {
  ok: boolean;
  pid?: number;
  command: string;
  args: string[];
  url: string;
  /** Reason set when ok=false. */
  reason?: string;
}

export interface SpawnOptions {
  command: string;
  args: string[];
  url: string;
  cwd: string;
  /** How long to wait for the URL to respond (default 60s). */
  waitTimeoutMs?: number;
  /** Probe interval (default 750ms). */
  pollIntervalMs?: number;
}

/**
 * Spawn the proposed dev-server command detached + unref'd so it survives
 * after the wizard process exits. Then poll the proposed URL until it
 * responds or the wait timeout elapses.
 *
 * On success: returns the child's pid so the user can kill it later.
 * On timeout/error: returns ok=false with a reason; the child is left running
 * (we don't know enough to safely clean it up — that's the user's call).
 */
export async function spawnAndWait(opts: SpawnOptions): Promise<SpawnResult> {
  const waitTimeoutMs = opts.waitTimeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 750;

  // On Windows, npm/pnpm shims need a shell — Linux/macOS doesn't.
  const useShell = process.platform === 'win32';

  let child;
  try {
    child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      detached: true,
      stdio: 'ignore',
      shell: useShell,
    });
    child.unref();
  } catch (err) {
    return {
      ok: false,
      command: opts.command,
      args: opts.args,
      url: opts.url,
      reason: `failed to spawn: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const pid = child.pid;
  const start = Date.now();
  let lastReason = '';

  while (Date.now() - start < waitTimeoutMs) {
    // If the child has already exited, the probe is going to keep failing — bail.
    if (child.exitCode !== null) {
      return {
        ok: false,
        pid,
        command: opts.command,
        args: opts.args,
        url: opts.url,
        reason: `child process exited with code ${child.exitCode} before the URL came up`,
      };
    }
    const probe = await probeUrl(opts.url, pollIntervalMs);
    if (probe.reachable) {
      return {
        ok: true,
        pid,
        command: opts.command,
        args: opts.args,
        url: opts.url,
      };
    }
    lastReason = probe.reason ?? `HTTP ${probe.statusCode ?? '?'}`;
    await sleep(pollIntervalMs);
  }

  return {
    ok: false,
    pid,
    command: opts.command,
    args: opts.args,
    url: opts.url,
    reason: `timed out after ${waitTimeoutMs}ms waiting for ${opts.url} (last: ${lastReason}). Child still running as pid ${pid}.`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
