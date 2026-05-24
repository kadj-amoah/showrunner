import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright-core';
import type { RecordingConfig } from '../config/schema.js';
import { buildAuthPlan } from './auth.js';
import {
  ensureCursorInstalled,
  installCursorOverlay,
  verifyCursorMounted,
} from './cursorOverlay.js';
import { logger } from '../util/logger.js';

const browserMap = { chromium, firefox, webkit } as const;

export interface HeadedSessionOptions {
  recording: RecordingConfig;
  configDir: string;
  /** When true, record video to recording.output_dir. Defaults to false. */
  recordVideo?: boolean;
  /** When true, install the showrunner cursor overlay. Defaults to false. */
  withCursor?: boolean;
  /**
   * When true, run any pre-configured `auth` plan before returning the page.
   * Defaults to false â€” most interactive commands (capture-auth, record-actions)
   * want a fresh, unauthenticated browser so the operator can drive it.
   */
  applyAuth?: boolean;
}

export interface HeadedSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function launchHeadedSession(opts: HeadedSessionOptions): Promise<HeadedSession> {
  const { recording, configDir } = opts;
  const browser = await browserMap[recording.browser].launch({ headless: false });

  const contextOptions: BrowserContextOptions = {
    viewport: { width: recording.viewport.width, height: recording.viewport.height },
  };

  if (opts.recordVideo) {
    const videoDir = resolve(configDir, recording.output_dir);
    await mkdir(videoDir, { recursive: true });
    contextOptions.recordVideo = {
      dir: videoDir,
      size: { width: recording.viewport.width, height: recording.viewport.height },
    };
  }

  if (opts.applyAuth) {
    const authPlan = await buildAuthPlan(recording.auth, configDir);
    if (authPlan.storageState !== undefined) {
      contextOptions.storageState = authPlan.storageState;
    } else if (authPlan.postLaunch) {
      const authContext = await browser.newContext({
        viewport: { width: recording.viewport.width, height: recording.viewport.height },
      });
      try {
        const authPage = await authContext.newPage();
        await authPage.goto(recording.target_url);
        await authPlan.postLaunch(authPage);
        contextOptions.storageState = await authContext.storageState();
      } finally {
        await authContext.close();
      }
    }
  }

  const context = await browser.newContext(contextOptions);

  if (opts.withCursor) {
    await installCursorOverlay(context);
  }

  const page = await context.newPage();

  if (opts.withCursor) {
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[showrunner-cursor]')) {
        logger.debug(`browser: ${text}`);
      }
    });
  }

  return {
    browser,
    context,
    page,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

export async function ensureCursorForHeaded(page: Page): Promise<void> {
  await ensureCursorInstalled(page);
  const mounted = await verifyCursorMounted(page);
  logger.debug(`cursor overlay mount check: ${mounted ? 'OK' : 'NOT FOUND'}`);
}
