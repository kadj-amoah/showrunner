import { readFile, writeFile } from 'node:fs/promises';

/**
 * Upsert KEY=value into a .env file at `path`. Preserves existing lines
 * (including comments and blank lines) and replaces the first occurrence of
 * `KEY=...` if present. Creates the file if it does not exist.
 *
 * Value is written as-is (no quoting). Callers are responsible for handling
 * keys whose value would contain whitespace or special characters — for our
 * use case (API keys), values are URL-safe ASCII.
 */
export async function upsertEnv(path: string, key: string, value: string): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    // file doesn't exist — start fresh
  }

  const lines = existing.length > 0 ? existing.split('\n') : [];
  const matcher = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  let replaced = false;
  const updated = lines.map((line) => {
    if (!replaced && matcher.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!replaced) {
    // Append. If the existing content didn't end with a newline, the join
    // below will sit the new line directly after the last char — which is
    // correct because we still split on '\n' (empty last element when file
    // ends in newline). Add a trailing newline so the file remains POSIX-ish.
    if (updated.length > 0 && updated[updated.length - 1] !== '') {
      updated.push(`${key}=${value}`);
      updated.push('');
    } else {
      // Replace the empty trailing element with the new line + restore newline
      updated[updated.length === 0 ? 0 : updated.length - 1] = `${key}=${value}`;
      updated.push('');
    }
  }

  await writeFile(path, updated.join('\n'), 'utf8');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
