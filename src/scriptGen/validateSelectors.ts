import type { Action, Manifest } from '../manifest/schema.js';
import type { SelectorInventoryItem } from './domPreflight.js';

export interface SelectorViolation {
  segmentId: string;
  actionIndex: number;
  actionType: Action['type'];
  selector: string;
  reason: 'invalid_css_brackets' | 'not_in_inventory';
  hint?: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: SelectorViolation[];
}

/**
 * Tailwind class names with arbitrary-value brackets (e.g. `max-w-[1280px]`,
 * `bg-[#abc123]`) are common in modern CSS but are NOT legal CSS selectors —
 * Playwright will reject them with a SyntaxError. The LLM occasionally
 * synthesizes these when it walks up the DOM tree to build a fallback path.
 *
 * Match `.foo-[anything]` or `.foo[anything]` inside a CSS path segment.
 * (We don't ban legit attribute selectors like `[data-testid="x"]` — those
 * stand alone, not glued to a class name.)
 */
const BRACKET_IN_CLASS_RE = /\.[a-z0-9_-]+\[[^\]]+\]/i;

export function validateManifestSelectors(
  manifest: Manifest,
  inventory: SelectorInventoryItem[],
): ValidationResult {
  const inventorySet = new Set(inventory.map((i) => i.selector));
  const violations: SelectorViolation[] = [];

  for (const segment of manifest.segments) {
    for (let i = 0; i < segment.actions.length; i++) {
      const action = segment.actions[i]!;
      const selectors = extractSelectors(action);
      for (const sel of selectors) {
        if (BRACKET_IN_CLASS_RE.test(sel)) {
          violations.push({
            segmentId: segment.id,
            actionIndex: i,
            actionType: action.type,
            selector: sel,
            reason: 'invalid_css_brackets',
            hint:
              `Tailwind arbitrary-value classes like \`.max-w-[1280px]\` are not legal CSS selectors. ` +
              `Drop the bracket class from the path, or pick an inventory entry instead.`,
          });
          continue;
        }
        if (!inventorySet.has(sel)) {
          violations.push({
            segmentId: segment.id,
            actionIndex: i,
            actionType: action.type,
            selector: sel,
            reason: 'not_in_inventory',
            hint: 'This selector was not in the live DOM inventory. Pick one from the inventory list.',
          });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function extractSelectors(action: Action): string[] {
  // Actions without selectors (idle, navigate, wait, wait_for_url, custom) → skip
  switch (action.type) {
    case 'idle':
    case 'navigate':
    case 'wait':
    case 'wait_for_url':
    case 'custom':
      return [];
    case 'press':
      return action.selector ? toArray(action.selector) : [];
    default:
      return toArray(action.selector);
  }
}

function toArray(sel: string | readonly string[]): string[] {
  return typeof sel === 'string' ? [sel] : [...sel];
}

/**
 * Render a remediation prompt the LLM can use to fix a manifest whose
 * selectors didn't pass `validateManifestSelectors`.
 */
export function renderSelectorRemediation(violations: SelectorViolation[]): string {
  const lines: string[] = [
    'Your previous manifest passed schema validation but its selectors are not usable:',
    '',
  ];
  for (const v of violations) {
    lines.push(
      `- Segment "${v.segmentId}", action ${v.actionIndex} (${v.actionType}): selector \`${v.selector}\` — ${v.reason}.`,
    );
    if (v.hint) lines.push(`  ${v.hint}`);
  }
  lines.push('');
  lines.push(
    'Re-emit the manifest. Every click/fill/type/hover/scroll/wait_for/assert_visible selector MUST appear verbatim in the live DOM selector inventory section above. For `:has-text` selectors, copy the `visibleText` field from the matching inventory entry exactly.',
  );
  return lines.join('\n');
}
