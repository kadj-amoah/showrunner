import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const FILE_CAP_BYTES = 2048;
const README_LINE_CAP = 100;

const CONFIG_FILE_PATTERNS: RegExp[] = [
  /^vite\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^next\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^astro\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^nuxt\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^svelte\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^vue\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^webpack\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^remix\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^gatsby-config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^rsbuild\.config\.(?:js|mjs|cjs|ts|mts|cts)$/,
  /^manage\.py$/,
  /^pyproject\.toml$/,
  /^Cargo\.toml$/,
];

export interface ProjectSnapshot {
  projectDir: string;
  sections: SnapshotSection[];
}

export interface SnapshotSection {
  label: string;
  path: string;
  body: string;
}

export async function collectProjectSnapshot(projectDir: string): Promise<ProjectSnapshot> {
  const sections: SnapshotSection[] = [];

  // package.json — full file (truncate to cap, but rarely necessary).
  const pkg = await readFileSafe(join(projectDir, 'package.json'));
  if (pkg) sections.push({ label: 'package.json', path: 'package.json', body: pkg });

  // README — head only.
  for (const candidate of ['README.md', 'readme.md', 'README.MD']) {
    const r = await readFileSafe(join(projectDir, candidate), { lineCap: README_LINE_CAP });
    if (r) {
      sections.push({ label: 'README (head)', path: candidate, body: r });
      break;
    }
  }

  // .env.example — useful for spotting PORT / HOST / NEXT_PUBLIC_BASE_URL hints.
  const envEx = await readFileSafe(join(projectDir, '.env.example'));
  if (envEx) sections.push({ label: '.env.example', path: '.env.example', body: envEx });
  else {
    const envSample = await readFileSafe(join(projectDir, '.env.sample'));
    if (envSample) sections.push({ label: '.env.sample', path: '.env.sample', body: envSample });
  }

  // Common framework config files at project root.
  let topEntries: string[];
  try {
    topEntries = await readdir(projectDir);
  } catch {
    topEntries = [];
  }
  for (const entry of topEntries) {
    if (CONFIG_FILE_PATTERNS.some((re) => re.test(entry))) {
      const body = await readFileSafe(join(projectDir, entry));
      if (body) sections.push({ label: entry, path: entry, body });
    }
  }

  return { projectDir, sections };
}

export function renderSnapshot(snap: ProjectSnapshot): string {
  if (snap.sections.length === 0) {
    return `(empty or non-readable project at ${snap.projectDir})`;
  }
  const out: string[] = [];
  for (const s of snap.sections) {
    out.push(`### ${s.label} — ${s.path}`);
    out.push('```');
    out.push(s.body.trim());
    out.push('```');
    out.push('');
  }
  return out.join('\n');
}

async function readFileSafe(
  path: string,
  options: { byteCap?: number; lineCap?: number } = {},
): Promise<string | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
  } catch {
    return null;
  }
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  if (options.lineCap !== undefined) {
    const lines = text.split('\n');
    if (lines.length > options.lineCap) {
      text = lines.slice(0, options.lineCap).join('\n') + `\n…[truncated at ${options.lineCap} lines]`;
    }
  }
  const byteCap = options.byteCap ?? FILE_CAP_BYTES;
  if (Buffer.byteLength(text, 'utf8') > byteCap) {
    text = text.slice(0, byteCap) + `\n…[truncated at ${byteCap} bytes]`;
  }
  return text;
}

/** Convenience for callers that just want a relative path label. */
export function shortPath(projectDir: string, abs: string): string {
  return relative(projectDir, abs);
}
