import type { Locator, Page } from 'playwright-core';
import type { SelectorSpec } from '../manifest/schema.js';

export type { SelectorSpec } from '../manifest/schema.js';

export class SelectorResolutionError extends Error {
  override readonly name = 'SelectorResolutionError';
  constructor(
    readonly tried: string[],
    cause: string,
  ) {
    super(`None of [${tried.join(' | ')}] resolved: ${cause}`);
  }
}

export function normalizeSelector(sel: SelectorSpec): string[] {
  return Array.isArray(sel) ? sel : [sel];
}

export interface ResolveOptions {
  timeoutMs?: number;
  state?: 'attached' | 'visible';
}

export async function resolveSelector(
  page: Page,
  sel: SelectorSpec,
  opts: ResolveOptions = {},
): Promise<Locator> {
  const timeout = opts.timeoutMs ?? 5000;
  const state = opts.state ?? 'attached';
  const candidates = normalizeSelector(sel);
  const errors: string[] = [];
  for (const candidate of candidates) {
    const locator = page.locator(candidate).first();
    try {
      await locator.waitFor({ state, timeout });
      return locator;
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  throw new SelectorResolutionError(candidates, errors.join(' ; '));
}

/**
 * Heuristic chain detection. In 'strict' mode, only exact equality counts.
 * In 'smart' mode, also treat as chained when:
 *  - selectors share a `[name="..."]` or `[data-testid="..."]` attribute literal,
 *  - one selector string is a prefix of the other (e.g. `form input` vs `form input[name=email]`).
 * Selector arrays are reduced to their first entry for comparison â€” the resolver
 * picks the first match at runtime, so first-entry equivalence is the load-bearing signal.
 */
export function isChainedTarget(
  prev: SelectorSpec | undefined,
  cur: SelectorSpec | undefined,
  mode: 'strict' | 'smart',
): boolean {
  if (prev === undefined || cur === undefined) return false;
  const prevFirst = normalizeSelector(prev)[0]!;
  const curFirst = normalizeSelector(cur)[0]!;
  if (prevFirst === curFirst) return true;
  if (mode === 'strict') return false;

  const attrMatch = (a: string, b: string, attr: 'name' | 'data-testid'): boolean => {
    const re = new RegExp(`\\[${attr}=["']([^"']+)["']\\]`);
    const ma = re.exec(a);
    const mb = re.exec(b);
    return ma !== null && mb !== null && ma[1] === mb[1];
  };
  if (attrMatch(prevFirst, curFirst, 'name')) return true;
  if (attrMatch(prevFirst, curFirst, 'data-testid')) return true;
  if (prevFirst.startsWith(curFirst) || curFirst.startsWith(prevFirst)) return true;
  return false;
}
