import { chromium, firefox, webkit } from 'playwright-core';
import type { RecordingConfig } from '../config/schema.js';
import { SELECTOR_FOR_FN_SOURCE } from '../recording/selectorHeuristic.js';
import { logger } from '../util/logger.js';

const browserMap = { chromium, firefox, webkit } as const;

export interface SelectorInventoryItem {
  tag: string;
  selector: string;
  visibleText?: string;
  role?: string;
  dataTestid?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
}

export interface ScrapeOptions {
  targetUrl: string;
  recording: RecordingConfig;
  /** Network-idle ceiling. Falls back to load if it never fires. Default 3000ms. */
  networkIdleTimeoutMs?: number;
  /** Hard navigation timeout. Default 15000ms. */
  navigationTimeoutMs?: number;
  /** Maximum items returned (truncates from the end). Default 200. */
  maxItems?: number;
}

/**
 * Launches Playwright once, navigates to the target, and snapshots the
 * actionable DOM into a flat selector inventory. The LLM in the `script`
 * stage uses this as ground truth so it can't hallucinate selectors.
 *
 * Failure is non-fatal â€” caller should treat a thrown error as "skip preflight
 * and fall back to LLM-only generation," logging a warning.
 */
export async function scrapeSelectorInventory(
  opts: ScrapeOptions,
): Promise<SelectorInventoryItem[]> {
  const networkIdleMs = opts.networkIdleTimeoutMs ?? 3000;
  const navigationMs = opts.navigationTimeoutMs ?? 15000;
  const maxItems = opts.maxItems ?? 200;

  const browser = await browserMap[opts.recording.browser].launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: {
        width: opts.recording.viewport.width,
        height: opts.recording.viewport.height,
      },
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(navigationMs);
    await page.goto(opts.targetUrl, { waitUntil: 'load' });
    try {
      await page.waitForLoadState('networkidle', { timeout: networkIdleMs });
    } catch {
      logger.debug('domPreflight: networkidle did not fire within budget â€” proceeding');
    }

    const items = (await page.evaluate(
      buildScrapeScript(SELECTOR_FOR_FN_SOURCE, maxItems),
    )) as SelectorInventoryItem[];

    await context.close();
    return items;
  } finally {
    await browser.close();
  }
}

/**
 * Build the in-page scrape script as a string. Returning the function body as
 * a string lets us reuse the shared SELECTOR_FOR_FN_SOURCE and sidesteps the
 * tsconfig DOM-lib issue (the host project doesn't include DOM types).
 */
function buildScrapeScript(selectorSource: string, maxItems: number): string {
  return `(() => {
    ${selectorSource}

    var QUERY = 'button, a, input, textarea, select, summary, label, h1, h2, h3, [role=button], [role=link], [role=textbox], [data-testid], [data-test-id]';
    var nodes = Array.from(document.querySelectorAll(QUERY));
    var out = [];
    var seen = new Set();

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.nodeType !== 1) continue;
      var rect = el.getBoundingClientRect();
      var styles = window.getComputedStyle(el);
      var visible = rect.width > 0 && rect.height > 0 && styles.visibility !== 'hidden' && styles.display !== 'none' && styles.opacity !== '0';
      if (!visible) continue;

      var selector = selectorFor(el);
      if (!selector) continue;
      if (seen.has(selector)) continue;
      seen.add(selector);

      var item = { tag: el.tagName.toLowerCase(), selector: selector };
      var rawText = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      if (rawText) item.visibleText = rawText.slice(0, 80);
      var role = el.getAttribute('role');
      if (role) item.role = role;
      var tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
      if (tid) item.dataTestid = tid;
      var name = el.getAttribute('name');
      if (name) item.name = name;
      var placeholder = el.getAttribute('placeholder');
      if (placeholder) item.placeholder = placeholder;
      var aria = el.getAttribute('aria-label');
      if (aria) item.ariaLabel = aria;
      if (el.tagName === 'A' && el.href) item.href = el.href;
      out.push(item);
      if (out.length >= ${maxItems}) break;
    }
    return out;
  })()`;
}
