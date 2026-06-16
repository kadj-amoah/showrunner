import { spawn } from 'node:child_process';

export function parseG2pOutput(stdout: string): Record<string, string> {
  const parsed = JSON.parse(stdout) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`g2p sidecar returned a non-object: ${stdout.slice(0, 200)}`);
  }
  return parsed as Record<string, string>;
}

export interface PhonemizeOptions {
  python?: string;
  scriptPath: string;
}

/** Phonemize tokens grouped by espeak language in a single sidecar call.
 *  Returns {} on any failure (best-effort approach). */
export async function phonemizeByLanguage(
  groups: Record<string, string[]>,
  opts: PhonemizeOptions,
): Promise<Record<string, string>> {
  const total = Object.values(groups).reduce((n, ts) => n + ts.length, 0);
  if (total === 0) return {};
  return new Promise((resolve) => {
    const child = spawn(opts.python ?? 'python', [opts.scriptPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => resolve({}));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({});
        return;
      }
      try {
        resolve(parseG2pOutput(out.trim()));
      } catch {
        resolve({});
      }
    });
    child.stdin.write(JSON.stringify(groups));
    child.stdin.end();
  });
}
