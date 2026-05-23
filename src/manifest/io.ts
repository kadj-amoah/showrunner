import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { manifestSchema, type Manifest } from './schema.js';

export class ManifestError extends Error {
  override readonly name = 'ManifestError';
  constructor(
    message: string,
    readonly issues?: z.ZodIssue[],
  ) {
    super(message);
  }
}

export async function readManifest(path: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ManifestError(`Failed to read manifest at ${path}: ${cause}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ManifestError(`Invalid JSON in manifest ${path}: ${cause}`);
  }
  return parseManifest(parsed);
}

export function parseManifest(input: unknown): Manifest {
  const result = manifestSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '<root>';
      return `  ${path}: ${i.message}`;
    });
    throw new ManifestError(`Manifest failed validation:\n${lines.join('\n')}`, result.error.issues);
  }
  return result.data;
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
