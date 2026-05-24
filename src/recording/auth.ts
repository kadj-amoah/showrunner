import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page, BrowserContextOptions } from 'playwright-core';

type StorageState = BrowserContextOptions['storageState'];
import type { AuthConfig } from '../config/schema.js';
import { logger } from '../util/logger.js';

export class AuthError extends Error {
  override readonly name = 'AuthError';
}

export interface AuthPlan {
  storageState?: StorageState;
  postLaunch?: (page: Page) => Promise<void>;
}

export async function buildAuthPlan(
  auth: AuthConfig | undefined,
  configDir: string,
): Promise<AuthPlan> {
  if (!auth) return {};

  if (auth.type === 'setup_script') {
    return { postLaunch: await loadSetupScript(auth.path, configDir) };
  }

  if (auth.type === 'session') {
    return { storageState: await buildStorageState(auth.cookies_file, auth.local_storage_file, configDir) };
  }

  if (auth.type === 'form') {
    return { postLaunch: buildFormFill(auth) };
  }

  return {};
}

async function loadSetupScript(
  scriptPath: string,
  configDir: string,
): Promise<(page: Page) => Promise<void>> {
  const abs = isAbsolute(scriptPath) ? scriptPath : resolve(configDir, scriptPath);
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new AuthError(`Failed to load setup_script at ${abs}: ${cause}`);
  }
  if (typeof mod.default !== 'function') {
    throw new AuthError(
      `setup_script at ${abs} must default-export an async function (page: Page) => Promise<void>`,
    );
  }
  const fn = mod.default as (page: Page) => Promise<void>;
  return async (page) => {
    try {
      await fn(page);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new AuthError(`setup_script failed: ${cause}`);
    }
  };
}

async function buildStorageState(
  cookiesFile: string,
  localStorageFile: string | undefined,
  configDir: string,
): Promise<StorageState> {
  const cookiesAbs = isAbsolute(cookiesFile) ? cookiesFile : resolve(configDir, cookiesFile);
  let cookiesRaw: string;
  try {
    cookiesRaw = await readFile(cookiesAbs, 'utf8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new AuthError(`Failed to read cookies_file at ${cookiesAbs}: ${cause}`);
  }
  let cookiesJson: unknown;
  try {
    cookiesJson = JSON.parse(cookiesRaw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new AuthError(`Invalid JSON in cookies_file ${cookiesAbs}: ${cause}`);
  }

  if (!isPlaywrightStorageState(cookiesJson)) {
    throw new AuthError(
      `cookies_file at ${cookiesAbs} is not in Playwright storageState format (expected { cookies: [...], origins: [...] })`,
    );
  }

  if (localStorageFile) {
    const lsAbs = isAbsolute(localStorageFile)
      ? localStorageFile
      : resolve(configDir, localStorageFile);
    try {
      const lsRaw = await readFile(lsAbs, 'utf8');
      const lsJson = JSON.parse(lsRaw) as unknown;
      if (isOriginsList(lsJson)) {
        cookiesJson.origins = [...(cookiesJson.origins ?? []), ...lsJson];
      } else {
        logger.warn(
          `local_storage_file at ${lsAbs} is not a Playwright origins list â€” skipping. Use storageState() output format.`,
        );
      }
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new AuthError(`Failed to read local_storage_file at ${lsAbs}: ${cause}`);
    }
  }

  return cookiesJson as StorageState;
}

interface PlaywrightStorageState {
  cookies?: unknown[];
  origins?: unknown[];
}

function isPlaywrightStorageState(value: unknown): value is PlaywrightStorageState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['cookies']) || Array.isArray(v['origins']);
}

function isOriginsList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function buildFormFill(
  auth: Extract<AuthConfig, { type: 'form' }>,
): (page: Page) => Promise<void> {
  return async (page) => {
    const email = process.env[auth.fields.email.env];
    const password = process.env[auth.fields.password.env];
    if (!email) {
      throw new AuthError(
        `Form auth: env var ${auth.fields.email.env} is not set`,
      );
    }
    if (!password) {
      throw new AuthError(
        `Form auth: env var ${auth.fields.password.env} is not set`,
      );
    }
    await page.goto(auth.login_url);
    await page.fill(auth.fields.email.selector, email);
    await page.fill(auth.fields.password.selector, password);
    await page.click(auth.submit_selector);
    try {
      await page.waitForURL(auth.success_url_pattern, { timeout: auth.timeout_ms });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new AuthError(
        `Form auth: did not reach ${auth.success_url_pattern} within ${auth.timeout_ms}ms â€” ${cause}`,
      );
    }
  };
}
