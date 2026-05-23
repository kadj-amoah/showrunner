/**
 * The selector-preference heuristic used by `record-actions` (in-page event
 * capture) and `script` stage's DOM preflight (DOM scrape for selector inventory).
 *
 * Preference order:
 *   1. [data-testid="..."]
 *   2. <tag>[name="..."] for INPUT/TEXTAREA/SELECT
 *   3. <tag>[placeholder="..."]
 *   4. [aria-label="..."]
 *   5. #id (when id looks stable, not hash-like)
 *   6. <tag>:has-text("...") for BUTTON/A/SUMMARY/LABEL with visible text
 *   7. Minimal CSS path (tag.class:nth-of-type, walked up to 5 levels)
 *
 * This module exports the function body as a string so it can be embedded
 * verbatim inside `page.evaluate` / `addInitScript` payloads (which can't
 * import from outside the page context).
 */

export const SELECTOR_FOR_FN_SOURCE = `
function escapeAttr(v) {
  return String(v).replace(/"/g, '\\\\"');
}

function looksUnstable(s) {
  // hash-like ids and classnames are unstable. Examples:
  //   "css-1a2b3c"          - emotion/styled-components
  //   "x_abc123"            - generic
  //   "__variable_3eb911"   - Next.js compiled font/CSS variables
  //   "1a2b3c4d5e6f"        - bare hex hash
  // The leading "_*" tolerates one or more underscores at the start.
  return /^_*[a-z]+[-_][a-f0-9]{6,}$/i.test(s) || /^[a-zA-Z]?[a-f0-9]{8,}$/.test(s);
}

function selectorFor(el) {
  if (!el || el.nodeType !== 1) return null;
  const testid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
  if (testid) return '[data-testid="' + escapeAttr(testid) + '"]';

  const name = el.getAttribute('name');
  if (name && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
    return el.tagName.toLowerCase() + '[name="' + escapeAttr(name) + '"]';
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return el.tagName.toLowerCase() + '[placeholder="' + escapeAttr(placeholder) + '"]';

  const aria = el.getAttribute('aria-label');
  if (aria) return '[aria-label="' + escapeAttr(aria) + '"]';

  if (el.id && !looksUnstable(el.id)) return '#' + el.id;

  const textTags = new Set(['BUTTON', 'A', 'SUMMARY', 'LABEL']);
  if (textTags.has(el.tagName)) {
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (text.length > 0 && text.length <= 64) {
      return el.tagName.toLowerCase() + ':has-text("' + escapeAttr(text) + '")';
    }
  }

  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id && !looksUnstable(node.id)) {
      parts.unshift('#' + node.id);
      break;
    }
    const cls = (node.className || '').toString().split(/\\s+/).filter((c) => c && !looksUnstable(c));
    if (cls.length > 0) part += '.' + cls[0];
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (same.length > 1) {
        const idx = same.indexOf(node) + 1;
        part += ':nth-of-type(' + idx + ')';
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}
`;
