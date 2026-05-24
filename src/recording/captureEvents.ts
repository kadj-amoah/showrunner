import type { BrowserContext, Page } from 'playwright-core';
import type { Action } from '../manifest/schema.js';
import { logger } from '../util/logger.js';
import { SELECTOR_FOR_FN_SOURCE } from './selectorHeuristic.js';

export interface RecordedEvent {
  kind: 'click' | 'input' | 'keydown' | 'submit' | 'change' | 'scroll';
  selector: string;
  /** For input/change: the field's current value. For keydown: the key. For scroll: 'up'|'down'. */
  payload?: string;
  /** Wall-clock timestamp captured in the page. */
  ts: number;
  /** True if the field is a contenteditable (treat differently from inputs). */
  contenteditable?: boolean;
  /** For scroll events: accumulated deltaY since the last emit. */
  deltaY?: number;
}

/**
 * Install a small in-page script that listens for user interactions and posts
 * each one back to Node via the `__srRecordEvent` binding. Selector preference:
 *   1. [data-testid="X"]
 *   2. [name="X"] (form fields)
 *   3. [placeholder="X"]
 *   4. [aria-label="X"]
 *   5. #id (if id is stable-looking)
 *   6. text=<visible text> for buttons/links
 *   7. minimal CSS path
 */
export async function installCaptureBinding(
  context: BrowserContext,
  onEvent: (evt: RecordedEvent) => void,
): Promise<void> {
  await context.exposeBinding('__srRecordEvent', (_source, evt: unknown) => {
    if (!isRecordedEvent(evt)) return;
    onEvent(evt);
  });

  await context.addInitScript(IN_PAGE_SCRIPT);
}

function isRecordedEvent(value: unknown): value is RecordedEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kind === 'string' &&
    typeof v.selector === 'string' &&
    typeof v.ts === 'number'
  );
}

const IN_PAGE_SCRIPT = `
(() => {
  if (window.__srRecordingInstalled) return;
  window.__srRecordingInstalled = true;

  ${SELECTOR_FOR_FN_SOURCE}

  function send(kind, el, payload, extra) {
    const sel = selectorFor(el);
    if (!sel) return;
    const evt = Object.assign({
      kind: kind,
      selector: sel,
      payload: payload,
      ts: Date.now(),
      contenteditable: el && el.isContentEditable === true,
    }, extra || {});
    if (window.__srRecordEvent) {
      try { window.__srRecordEvent(evt); } catch {}
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    send('click', el, null);
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const value = (el.value !== undefined && el.value !== null) ? String(el.value) : (el.textContent || '');
    send('input', el, value);
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.tagName !== 'SELECT') return;
    send('change', el, String(el.value));
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'Tab') return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    send('keydown', el, e.key);
  }, true);

  document.addEventListener('submit', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    send('submit', el, null);
  }, true);

  // Scroll capture â€” debounce 250ms, coalesce within window, emit direction + accumulated deltaY.
  let scrollLastY = window.scrollY;
  let scrollAccum = 0;
  let scrollTimer = null;
  let scrollTarget = null;
  function flushScroll() {
    scrollTimer = null;
    if (scrollAccum === 0) return;
    const direction = scrollAccum > 0 ? 'down' : 'up';
    const deltaY = Math.abs(scrollAccum);
    scrollAccum = 0;
    const el = scrollTarget || document.scrollingElement || document.body;
    send('scroll', el, direction, { deltaY: deltaY });
  }
  document.addEventListener('scroll', (e) => {
    const target = (e.target === document ? (document.scrollingElement || document.body) : e.target);
    if (!target || target.nodeType !== 1) return;
    const currentY = target === document.scrollingElement || target === document.body
      ? window.scrollY
      : (target.scrollTop || 0);
    const delta = currentY - scrollLastY;
    scrollLastY = currentY;
    if (delta === 0) return;
    // Direction change â†’ flush the previous burst immediately.
    if (scrollAccum !== 0 && Math.sign(delta) !== Math.sign(scrollAccum)) {
      if (scrollTimer !== null) { clearTimeout(scrollTimer); scrollTimer = null; }
      flushScroll();
    }
    scrollAccum += delta;
    scrollTarget = target;
    if (scrollTimer === null) {
      scrollTimer = setTimeout(flushScroll, 250);
    }
  }, true);
})();
`;

/**
 * Stream of RecordedEvents â†’ coalesced Action[] suitable for a manifest segment.
 * Rules:
 *  - Contiguous `input` events on the same selector collapse into one `type`
 *    action carrying the final value.
 *  - `keydown:Enter` after an input on the same selector becomes a `press: Enter`.
 *  - Standalone `click` events become `click` actions, unless the next event is
 *    an input on the same selector (then the click is just focus â€” drop it).
 *  - `submit` is dropped (Enter or button-click already triggered it).
 *  - `change` on a `<select>` becomes `fill` with the value.
 */
export function coalesceEvents(events: RecordedEvent[]): Action[] {
  const out: Action[] = [];
  let pendingInputSelector: string | undefined;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i]!;
    const next = events[i + 1];

    if (evt.kind === 'click') {
      // If the next event is an input on the same selector, this click was
      // just focusing the field â€” drop it.
      if (next && next.kind === 'input' && next.selector === evt.selector) {
        continue;
      }
      out.push({ type: 'click', selector: evt.selector });
      pendingInputSelector = undefined;
      continue;
    }

    if (evt.kind === 'input') {
      // Find the last value across the run of consecutive inputs on this selector.
      let lastValue = evt.payload ?? '';
      let j = i;
      while (j + 1 < events.length) {
        const peek = events[j + 1]!;
        if (peek.kind === 'input' && peek.selector === evt.selector) {
          lastValue = peek.payload ?? '';
          j++;
          continue;
        }
        break;
      }
      i = j;
      out.push({ type: 'type', selector: evt.selector, value: lastValue });
      pendingInputSelector = evt.selector;
      continue;
    }

    if (evt.kind === 'keydown' && evt.payload === 'Enter') {
      // Press Enter on the field, attached to current selector if known.
      out.push({ type: 'press', key: 'Enter', selector: evt.selector });
      pendingInputSelector = undefined;
      continue;
    }
    if (evt.kind === 'keydown' && evt.payload === 'Escape') {
      out.push({ type: 'press', key: 'Escape', selector: evt.selector });
      continue;
    }
    if (evt.kind === 'keydown' && evt.payload === 'Tab') {
      out.push({ type: 'press', key: 'Tab', selector: evt.selector });
      continue;
    }

    if (evt.kind === 'change') {
      out.push({ type: 'fill', selector: evt.selector, value: evt.payload ?? '' });
      continue;
    }

    if (evt.kind === 'scroll') {
      // Coalesce consecutive scroll bursts on the same selector + direction
      // into a single scroll action. A direction change ends the run.
      const direction = evt.payload === 'up' ? 'up' : 'down';
      let j = i;
      while (j + 1 < events.length) {
        const peek = events[j + 1]!;
        if (
          peek.kind === 'scroll' &&
          peek.selector === evt.selector &&
          (peek.payload === 'up' ? 'up' : 'down') === direction
        ) {
          j++;
          continue;
        }
        break;
      }
      i = j;
      out.push({ type: 'scroll', selector: evt.selector, direction });
      continue;
    }
    // submit: dropped intentionally
  }

  void pendingInputSelector;
  return out;
}

/**
 * Watch navigations on the page and emit wait_for_url actions when the URL changes.
 * Returns a function that drains current navigation events into the action array.
 */
export function attachNavigationCapture(
  page: Page,
  pushEvent: (action: Action) => void,
): void {
  let lastUrl = page.url();
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (url === lastUrl) return;
    lastUrl = url;
    if (url === 'about:blank') return;
    pushEvent({ type: 'wait_for_url', pattern: url });
    logger.debug(`captured navigation`, { url });
  });
}
