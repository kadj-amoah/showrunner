import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { errors as playwrightErrors, type Page } from 'playwright';
import type { Action } from '../manifest/schema.js';
import { moveCursor, pulseCursor } from './cursorOverlay.js';
import { resolveSelector } from './selector.js';

export type ActionOutcome =
  | { status: 'ok' }
  | { status: 'skipped'; reason: string; screenshot?: string }
  | { status: 'segment_failed'; reason: string; screenshot?: string };

export class SegmentFailedError extends Error {
  override readonly name = 'SegmentFailedError';
}

const CURSOR_SETTLE_MS = 280;

export interface ExecuteOptions {
  cursorEnabled: boolean;
  skipCursorPositioning?: boolean;
  /** When set, on-error screenshots will be written under this directory. */
  failureDir?: string;
  /** Owning segment id, used in the screenshot filename. */
  segmentId?: string;
  /** Index of the action inside the segment, used in the screenshot filename. */
  actionIndex?: number;
}

export async function executeAction(
  page: Page,
  action: Action,
  opts: ExecuteOptions = { cursorEnabled: false },
): Promise<ActionOutcome> {
  try {
    if (opts.cursorEnabled && !opts.skipCursorPositioning) {
      await positionCursorForAction(page, action);
    }
    switch (action.type) {
      case 'idle':
        return { status: 'ok' };
      case 'click': {
        if (opts.cursorEnabled) await pulseCursor(page);
        const locator = await resolveSelector(page, action.selector);
        await locator.click();
        return { status: 'ok' };
      }
      case 'fill': {
        if (opts.cursorEnabled) await pulseCursor(page);
        const locator = await resolveSelector(page, action.selector);
        await locator.fill(action.value);
        return { status: 'ok' };
      }
      case 'type': {
        if (opts.cursorEnabled) await pulseCursor(page);
        const locator = await resolveSelector(page, action.selector);
        await locator.pressSequentially(action.value, { delay: 60 });
        return { status: 'ok' };
      }
      case 'hover': {
        const locator = await resolveSelector(page, action.selector);
        await locator.hover();
        return { status: 'ok' };
      }
      case 'scroll': {
        const direction = action.direction;
        const locator = await resolveSelector(page, action.selector);
        await locator.evaluate((el, dir) => {
          const node = el as unknown as { scrollTop: number; scrollHeight: number };
          node.scrollTop = dir === 'down' ? node.scrollHeight : -node.scrollHeight;
        }, direction);
        return { status: 'ok' };
      }
      case 'navigate':
        await page.goto(action.url);
        return { status: 'ok' };
      case 'wait_for': {
        const locator = await resolveSelector(page, action.selector);
        await locator.waitFor({ state: 'attached' });
        return { status: 'ok' };
      }
      case 'wait_for_url':
        await page.waitForURL(action.pattern);
        return { status: 'ok' };
      case 'wait':
        await page.waitForTimeout(action.ms);
        return { status: 'ok' };
      case 'assert_visible': {
        const locator = await resolveSelector(page, action.selector, { state: 'visible' });
        await locator.waitFor({ state: 'visible' });
        return { status: 'ok' };
      }
      case 'press':
        if (opts.cursorEnabled) await pulseCursor(page);
        if (action.selector) {
          const locator = await resolveSelector(page, action.selector);
          await locator.press(action.key);
        } else {
          await page.keyboard.press(action.key);
        }
        return { status: 'ok' };
      case 'custom':
        await page.evaluate(action.js);
        return { status: 'ok' };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const screenshot = await captureFailureScreenshot(page, opts, action.type);

    if (action.type === 'assert_visible') {
      return {
        status: 'segment_failed',
        reason: `assert_visible failed: ${reason}`,
        screenshot,
      };
    }

    if (err instanceof playwrightErrors.TimeoutError) {
      return { status: 'skipped', reason: `timeout on ${action.type}: ${reason}`, screenshot };
    }

    return { status: 'skipped', reason: `${action.type} error: ${reason}`, screenshot };
  }
}

async function captureFailureScreenshot(
  page: Page,
  opts: ExecuteOptions,
  actionType: string,
): Promise<string | undefined> {
  if (!opts.failureDir || !opts.segmentId) return undefined;
  const idx = opts.actionIndex ?? 0;
  const path = join(opts.failureDir, `${opts.segmentId}-${idx}-${actionType}.png`);
  try {
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch {
    return undefined;
  }
}

async function positionCursorForAction(page: Page, action: Action): Promise<void> {
  if (!('selector' in action) || !action.selector) return;
  try {
    const locator = await resolveSelector(page, action.selector, { timeoutMs: 2000 });
    const box = await locator.boundingBox({ timeout: 2000 });
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await moveCursor(page, x, y);
    await page.waitForTimeout(CURSOR_SETTLE_MS);
  } catch {
    // selector might not exist yet; cursor stays where it was
  }
}
