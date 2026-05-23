import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { logger } from '../util/logger.js';

export class LifecycleScriptError extends Error {
  override readonly name = 'LifecycleScriptError';
  constructor(
    message: string,
    readonly script: string,
    readonly exitCode: number | null,
  ) {
    super(message);
  }
}

export interface RunScriptOptions {
  scriptPath: string;
  configDir: string;
  env: Record<string, string>;
  label: string;
}

export interface RunCommandOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  label: string;
  /** When true, child inherits stdio (for interactive viewers like trace UI). */
  inherit?: boolean;
}

/**
 * Spawn an external command, prefix stdout/stderr lines with the label, and
 * resolve on exit-code-0 or reject with a LifecycleScriptError. Bypasses any
 * file-existence check — use this for commands like `npx playwright show-trace`
 * where the binary is resolved via the user's PATH.
 */
export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const { cmd, args = [], cwd, env = {}, label, inherit = false } = opts;
  logger.debug(`spawn ${label}`, { cmd, args });

  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    if (!inherit) {
      const prefix = `[${label}]`;
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.length === 0) continue;
          process.stdout.write(`${prefix} ${line}\n`);
        }
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.length === 0) continue;
          process.stderr.write(`${prefix} ${line}\n`);
        }
      });
    }

    child.on('error', (err) => {
      rejectRun(
        new LifecycleScriptError(
          `Failed to spawn ${label}: ${err.message}`,
          cmd,
          null,
        ),
      );
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(
          new LifecycleScriptError(
            `${label} exited with code ${code}`,
            cmd,
            code,
          ),
        );
      }
    });
  });
}

export interface RunCommandCaptureOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Text to write to the child's stdin before it's closed. */
  stdin?: string;
  label: string;
  /** Kill the child if it hasn't exited by this deadline (ms). */
  timeoutMs?: number;
}

export interface CapturedRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn an external command, optionally pipe stdin to it, capture stdout +
 * stderr to strings, and return on exit. Unlike `runCommand` this does NOT
 * mirror stdio to the parent process — it's intended for one-shot helpers
 * (LLM agent bridges, ffprobe pipes, version checks) where the caller wants
 * to inspect the output programmatically.
 */
export async function runCommandCapture(opts: RunCommandCaptureOptions): Promise<CapturedRunResult> {
  const { cmd, args = [], cwd, env = {}, label, stdin, timeoutMs } = opts;
  logger.debug(`capture ${label}`, { cmd, args });

  return await new Promise<CapturedRunResult>((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        rejectRun(
          new LifecycleScriptError(
            `${label} timed out after ${timeoutMs}ms`,
            cmd,
            null,
          ),
        );
      }, timeoutMs);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      rejectRun(
        new LifecycleScriptError(
          `Failed to spawn ${label}: ${err.message}`,
          cmd,
          null,
        ),
      );
    });

    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      resolveRun({ stdout, stderr, exitCode: code ?? -1 });
    });

    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}

export async function runLifecycleScript(opts: RunScriptOptions): Promise<void> {
  const abs = isAbsolute(opts.scriptPath) ? opts.scriptPath : resolve(opts.configDir, opts.scriptPath);
  try {
    await stat(abs);
  } catch {
    throw new LifecycleScriptError(
      `${opts.label} script not found at ${abs}`,
      abs,
      null,
    );
  }

  logger.info(`Running ${opts.label} script`, { script: abs });

  await runCommand({
    cmd: abs,
    args: [],
    cwd: opts.configDir,
    env: opts.env,
    label: opts.label,
  });
}
