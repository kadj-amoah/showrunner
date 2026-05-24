import { mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from 'playwright-core';
import type { RecordingConfig, VoiceoverConfig } from '../config/schema.js';
import type { Manifest } from '../manifest/schema.js';
import type { PipelineOverrides } from '../pipeline/types.js';
import { findWordStartTime, loadAlignment } from '../manifest/alignment.js';
import { logger } from '../util/logger.js';
import { buildAuthPlan, type AuthPlan } from './auth.js';
import { executeAction } from './actions.js';
import {
  ensureCursorInstalled,
  installCursorOverlay,
  moveCursor,
  verifyCursorMounted,
} from './cursorOverlay.js';
import {
  isChainedTarget,
  normalizeSelector,
  resolveSelector,
  type SelectorSpec,
} from './selector.js';

export interface RecordOptions {
  recording: RecordingConfig;
  voiceover: VoiceoverConfig;
  manifest: Manifest;
  configDir: string;
  overrides?: PipelineOverrides;
}

export interface SegmentSlice {
  id: string;
  t_start: number;
  t_end: number;
  status: 'ok' | 'failed';
  failure_reason?: string;
  failure_screenshots: string[];
  warnings: string[];
  trace_path: string;
}

export interface SlicePlan {
  recording_path: string;
  recording_started_at: string;
  segments: SegmentSlice[];
}

const browserMap = { chromium, firefox, webkit } as const;

export async function recordDemo(opts: RecordOptions): Promise<SlicePlan> {
  const { recording, voiceover, manifest, configDir, overrides } = opts;
  const videoDir = resolve(configDir, recording.output_dir);
  const traceDir = resolve(configDir, recording.trace_dir);
  const failureDir = join(traceDir, 'failures');
  const alignmentDir = resolve(configDir, voiceover.alignment_dir);
  await mkdir(videoDir, { recursive: true });
  await mkdir(traceDir, { recursive: true });
  await mkdir(failureDir, { recursive: true });

  const headless = overrides?.headed ? false : recording.headless;
  const authPlan = await buildAuthPlan(recording.auth, configDir);
  const browser = await browserMap[recording.browser].launch({ headless });

  try {
    const storageState = await resolveStorageState(browser, recording, authPlan);

    const contextOptions: BrowserContextOptions = {
      viewport: { width: recording.viewport.width, height: recording.viewport.height },
      recordVideo: {
        dir: videoDir,
        size: { width: recording.viewport.width, height: recording.viewport.height },
      },
      storageState,
    };
    const context = await browser.newContext(contextOptions);
    const tRecordingStart = performance.now();
    if (recording.cursor_highlight) {
      await installCursorOverlay(context);
    }
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const page = await context.newPage();
    if (recording.cursor_highlight) {
      page.on('console', (msg) => {
        const text = msg.text();
        if (text.startsWith('[showrunner-cursor]')) {
          logger.debug(`browser: ${text}`);
        }
      });
    }
    const startedAt = new Date();
    await page.goto(recording.target_url);
    if (recording.cursor_highlight) {
      await ensureCursorInstalled(page);
      const mounted = await verifyCursorMounted(page);
      logger.info(`cursor overlay mount check: ${mounted ? 'OK' : 'NOT FOUND'}`);
    }

    if (recording.preflight) {
      await preflightSelectors(page, manifest);
    }

    const tFirstSegmentStart = performance.now();
    const preSegmentOffsetSec = (tFirstSegmentStart - tRecordingStart) / 1000;
    logger.info(
      `pre-segment recording offset: ${preSegmentOffsetSec.toFixed(2)}s (page.goto + setup) â€” slice_plan will be offset by this amount`,
    );
    const t0 = tFirstSegmentStart;
    let cursorPos = {
      x: recording.viewport.width / 2,
      y: recording.viewport.height / 2,
    };

    const slices: SegmentSlice[] = [];

    for (const seg of manifest.segments) {
      await context.tracing.startChunk({ title: seg.id });
      const segStart = (performance.now() - t0) / 1000;
      const tracePath = join(traceDir, `${seg.id}.zip`);
      const warnings: string[] = [];
      const failureScreenshots: string[] = [];
      let failure: string | undefined;
      let lastTargetSelector: SelectorSpec | undefined;

      const alignment = await loadAlignment(join(alignmentDir, `${seg.id}.alignment.json`));
      const resolveAtForAction = (action: { at?: number; at_word?: string; at_occurrence?: number }):
        | number
        | undefined => {
        if (action.at_word) {
          if (!alignment) {
            warnings.push(
              `action references at_word="${action.at_word}" but no alignment data found for segment "${seg.id}"`,
            );
            return action.at;
          }
          const t = findWordStartTime(alignment, action.at_word, action.at_occurrence ?? 1);
          if (t == null) {
            warnings.push(
              `at_word="${action.at_word}" (occurrence ${action.at_occurrence ?? 1}) not found in VO of segment "${seg.id}"`,
            );
            return action.at;
          }
          return t;
        }
        return action.at;
      };

      logger.event({ stage: 'record', status: 'segment_start', segment: seg.id, t: segStart });

      let actionIndex = -1;
      for (const action of seg.actions) {
        actionIndex++;
        const resolvedAt = resolveAtForAction(action);
        const hasAt = resolvedAt !== undefined;
        const hasSelector =
          'selector' in action &&
          (typeof action.selector === 'string' || Array.isArray(action.selector));
        const actionSelector: SelectorSpec | undefined = hasSelector
          ? (action as { selector: SelectorSpec }).selector
          : undefined;
        const chainSameTarget = isChainedTarget(
          lastTargetSelector,
          actionSelector,
          recording.cursor_chain_mode,
        );
        let preMovedCursor = false;

        if (hasAt && hasSelector && recording.cursor_highlight && !chainSameTarget) {
          const sel = actionSelector!;
          let box: { x: number; y: number; width: number; height: number } | null = null;
          try {
            const locator = await resolveSelector(page, sel, { timeoutMs: 2000 });
            box = await locator.boundingBox({ timeout: 2000 });
          } catch {
            box = null;
          }
          if (box) {
            const targetX = box.x + box.width / 2;
            const targetY = box.y + box.height / 2;
            const distance = Math.hypot(targetX - cursorPos.x, targetY - cursorPos.y);
            const speedFactor = recording.cursor_speed_factor;
            const rawMs = (180 + 0.18 * distance) / speedFactor;
            let motionMs = Math.min(
              recording.cursor_max_motion_ms,
              Math.max(recording.cursor_min_motion_ms, rawMs),
            );

            const arrivalAt = resolvedAt!;
            const elapsedNow = (performance.now() - t0) / 1000 - segStart;
            let timeAvailableUntilArrival = arrivalAt - elapsedNow;

            if (timeAvailableUntilArrival * 1000 < motionMs) {
              const adjusted = Math.max(
                recording.cursor_min_motion_ms,
                Math.round(timeAvailableUntilArrival * 1000),
              );
              if (adjusted < motionMs) {
                warnings.push(
                  `cursor motion for action at ${arrivalAt}s clamped from ${Math.round(motionMs)}ms to ${adjusted}ms â€” manifest timing tight`,
                );
              }
              motionMs = adjusted;
              timeAvailableUntilArrival = motionMs / 1000;
            }

            const motionStartAt = arrivalAt - motionMs / 1000;
            const waitMs = Math.round((motionStartAt - elapsedNow) * 1000);
            if (waitMs > 20) {
              await page.waitForTimeout(waitMs);
            }
            await moveCursor(page, targetX, targetY, motionMs);
            cursorPos = { x: targetX, y: targetY };
            preMovedCursor = true;

            const elapsedAfterMove = (performance.now() - t0) / 1000 - segStart;
            const remainingToArrival = arrivalAt - elapsedAfterMove;
            if (remainingToArrival > 0.02) {
              await page.waitForTimeout(Math.round(remainingToArrival * 1000));
            }
            if (recording.cursor_post_arrival_ms > 0) {
              await page.waitForTimeout(recording.cursor_post_arrival_ms);
            }
          } else {
            const elapsedInSeg = (performance.now() - t0) / 1000 - segStart;
            const waitFor = resolvedAt! - elapsedInSeg;
            if (waitFor > 0.02) await page.waitForTimeout(Math.round(waitFor * 1000));
          }
        } else if (hasAt) {
          // chained same-target action, or no-selector action: just wait until at, no cursor ceremony
          const elapsedInSeg = (performance.now() - t0) / 1000 - segStart;
          const waitFor = resolvedAt! - elapsedInSeg;
          if (waitFor > 0.02) await page.waitForTimeout(Math.round(waitFor * 1000));
          if (chainSameTarget) preMovedCursor = true;
        }
        if (actionSelector) lastTargetSelector = actionSelector;

        const fireT = (performance.now() - t0) / 1000 - segStart;
        logger.debug(
          `action fire: seg=${seg.id} type=${action.type} resolvedAt=${
            resolvedAt !== undefined ? resolvedAt.toFixed(2) : 'none'
          } elapsed=${fireT.toFixed(2)} chain=${chainSameTarget}`,
        );
        const outcome = await executeAction(page, action, {
          cursorEnabled: recording.cursor_highlight,
          skipCursorPositioning: preMovedCursor,
          failureDir,
          segmentId: seg.id,
          actionIndex,
        });
        if (outcome.status === 'skipped') {
          warnings.push(`${action.type}: ${outcome.reason}`);
          if (outcome.screenshot) failureScreenshots.push(outcome.screenshot);
          logger.warn(`segment ${seg.id} â€” ${action.type} skipped`, {
            reason: outcome.reason,
            screenshot: outcome.screenshot,
          });
        } else if (outcome.status === 'segment_failed') {
          failure = outcome.reason;
          if (outcome.screenshot) failureScreenshots.push(outcome.screenshot);
          logger.error(`segment ${seg.id} â€” failed`, {
            reason: outcome.reason,
            screenshot: outcome.screenshot,
          });
          break;
        }
      }

      if (recording.segment_buffer_ms > 0) {
        await page.waitForTimeout(recording.segment_buffer_ms);
      }

      const allocated = seg.end - seg.start;
      const elapsedInSegment = (performance.now() - t0) / 1000 - segStart;
      const remaining = allocated - elapsedInSegment;
      if (remaining > 0.05) {
        await page.waitForTimeout(Math.round(remaining * 1000));
      } else if (remaining < -0.5) {
        warnings.push(
          `segment took ${elapsedInSegment.toFixed(2)}s but only ${allocated.toFixed(2)}s allocated â€” manifest timing tight for this segment`,
        );
      }

      const segEnd = (performance.now() - t0) / 1000;
      await context.tracing.stopChunk({ path: tracePath });

      slices.push({
        id: seg.id,
        t_start: segStart + preSegmentOffsetSec,
        t_end: segEnd + preSegmentOffsetSec,
        status: failure ? 'failed' : 'ok',
        failure_reason: failure,
        failure_screenshots: failureScreenshots,
        warnings,
        trace_path: tracePath,
      });

      logger.event({
        stage: 'record',
        status: 'segment_end',
        segment: seg.id,
        t: segEnd,
        outcome: failure ? 'failed' : 'ok',
        warnings: warnings.length,
      });
    }

    const videoHandle = page.video();
    await context.close();

    let recordingPath = '';
    if (videoHandle) {
      const original = await videoHandle.path();
      const dest = join(videoDir, 'master.webm');
      if (original !== dest) {
        await rename(original, dest);
      }
      recordingPath = dest;
    } else {
      logger.warn('Recording context did not produce a video file â€” recordVideo may have been ignored');
    }

    return {
      recording_path: recordingPath,
      recording_started_at: startedAt.toISOString(),
      segments: slices,
    };
  } finally {
    await browser.close();
  }
}

async function resolveStorageState(
  browser: Browser,
  recording: RecordingConfig,
  authPlan: AuthPlan,
): Promise<BrowserContextOptions['storageState']> {
  if (authPlan.storageState !== undefined) {
    return authPlan.storageState;
  }
  if (!authPlan.postLaunch) {
    return undefined;
  }

  logger.info('Running auth setup off-camera before recording');
  const authContext: BrowserContext = await browser.newContext({
    viewport: { width: recording.viewport.width, height: recording.viewport.height },
  });
  try {
    const authPage = await authContext.newPage();
    await authPage.goto(recording.target_url);
    await authPlan.postLaunch(authPage);
    return await authContext.storageState();
  } finally {
    await authContext.close();
  }
}

export class PreflightError extends Error {
  override readonly name = 'PreflightError';
  constructor(
    readonly failures: { segment: string; actionIndex: number; selectors: string[] }[],
  ) {
    const lines = failures.map(
      (f) => `  - ${f.segment}#${f.actionIndex} â†’ [${f.selectors.join(' | ')}]`,
    );
    super(
      `Pre-flight check failed â€” ${failures.length} selector(s) did not resolve on ${
        failures[0]?.segment ? `the live target page` : 'the page'
      }:\n${lines.join('\n')}\n\nFix the manifest selectors, or set recording.preflight: false to skip this check.`,
    );
  }
}

/**
 * Pre-flight checks the *first segment's* selector-bearing actions against the
 * just-loaded target page. This catches the common "URL changed / page didn't
 * load / class renamed" failure modes without false-positiving on selectors that
 * only become available after intermediate navigations or clicks. Deeper
 * selectors fail at action time with the resolver's full diagnostic.
 */
async function preflightSelectors(page: import('playwright-core').Page, manifest: Manifest): Promise<void> {
  const firstSeg = manifest.segments[0];
  if (!firstSeg) return;

  // Give SPAs a beat to hydrate before probing â€” best-effort.
  try {
    await page.waitForLoadState('networkidle', { timeout: 3000 });
  } catch {
    // pages with long-poll connections never reach networkidle; carry on
  }

  const checks: { segment: string; actionIndex: number; sel: SelectorSpec }[] = [];
  for (let i = 0; i < firstSeg.actions.length; i++) {
    const a = firstSeg.actions[i]!;
    if ('selector' in a && a.selector !== undefined) {
      checks.push({ segment: firstSeg.id, actionIndex: i, sel: a.selector as SelectorSpec });
    }
  }

  const failures: { segment: string; actionIndex: number; selectors: string[] }[] = [];
  for (const c of checks) {
    const candidates = normalizeSelector(c.sel);
    let resolved = false;
    for (const cand of candidates) {
      try {
        await page.locator(cand).first().waitFor({ state: 'attached', timeout: 3000 });
        resolved = true;
        break;
      } catch {
        // try next candidate
      }
    }
    if (!resolved) {
      failures.push({ segment: c.segment, actionIndex: c.actionIndex, selectors: candidates });
    }
  }

  if (failures.length > 0) {
    throw new PreflightError(failures);
  }
  logger.info('pre-flight selector check: first-segment anchors resolved', {
    checks: checks.length,
  });
}
