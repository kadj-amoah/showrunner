import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Action, Manifest, Segment, SelectorSpec } from './schema.js';
import type { RecordingConfig } from '../config/schema.js';

export interface CodegenInputs {
  manifest: Manifest;
  recording: RecordingConfig;
  targetUrl: string;
  videoDir: string;
  traceDir: string;
}

const HEADER = `// scripts/playwright_demo.ts
// GENERATED FILE — DO NOT EDIT DIRECTLY.
// Regenerated from scripts/manifest.json on every \`showrunner run\`.
// Edit the manifest instead, then re-run the script stage.
`;

export function renderPlaywrightSpec(inputs: CodegenInputs): string {
  const { manifest, recording, targetUrl, videoDir, traceDir } = inputs;

  const launchLines = [
    `import { chromium, firefox, webkit, type BrowserContext } from 'playwright-core';`,
    `import { mkdirSync } from 'node:fs';`,
    ``,
    `const VIDEO_DIR = ${JSON.stringify(videoDir)};`,
    `const TRACE_DIR = ${JSON.stringify(traceDir)};`,
    `const TARGET_URL = ${JSON.stringify(targetUrl)};`,
    `const STORAGE_STATE = process.env['SHOWRUNNER_STORAGE_STATE'] ?? undefined;`,
    ``,
    `mkdirSync(VIDEO_DIR, { recursive: true });`,
    `mkdirSync(TRACE_DIR, { recursive: true });`,
    ``,
    `const browserMap = { chromium, firefox, webkit } as const;`,
    `const browser = await browserMap[${JSON.stringify(recording.browser)}].launch({ headless: ${recording.headless} });`,
    `const context = await browser.newContext({`,
    `  viewport: { width: ${recording.viewport.width}, height: ${recording.viewport.height} },`,
    `  recordVideo: { dir: VIDEO_DIR, size: { width: ${recording.viewport.width}, height: ${recording.viewport.height} } },`,
    `  storageState: STORAGE_STATE,`,
    `});`,
    ``,
    `await context.tracing.start({ screenshots: true, snapshots: true, sources: true });`,
    ``,
    `const page = await context.newPage();`,
    `await page.goto(TARGET_URL);`,
    ``,
    `function logMarker(kind: 'start' | 'end', segment: string, t: number): void {`,
    `  process.stdout.write(JSON.stringify({ event: 'segment_' + kind, segment, t, wall_ms: Date.now() }) + '\\n');`,
    `}`,
    ``,
    `async function runSegment(ctx: BrowserContext, id: string, runner: () => Promise<void>): Promise<void> {`,
    `  await ctx.tracing.startChunk({ title: id });`,
    `  const t0 = performance.now();`,
    `  logMarker('start', id, t0);`,
    `  try {`,
    `    await runner();`,
    `  } finally {`,
    `    logMarker('end', id, performance.now());`,
    `    await ctx.tracing.stopChunk({ path: \`\${TRACE_DIR}/\${id}.zip\` });`,
    `  }`,
    `}`,
  ];

  const segmentBlocks = manifest.segments.map((s) => renderSegmentBlock(s)).join('\n');

  const tail = [
    `await context.close();`,
    `await browser.close();`,
    `process.stdout.write(JSON.stringify({ event: 'recording_complete' }) + '\\n');`,
  ];

  return [HEADER, launchLines.join('\n'), '', segmentBlocks, tail.join('\n'), ''].join('\n');
}

function renderSegmentBlock(seg: Segment): string {
  const head = `// segment: ${seg.id} (${formatRange(seg.start, seg.end)}) — ${seg.label}`;
  const actionLines = seg.actions.map((a) => `  ${renderAction(a)}`).join('\n');
  return [
    head,
    `await runSegment(context, ${JSON.stringify(seg.id)}, async () => {`,
    actionLines || '  // no actions',
    `});`,
    ``,
  ].join('\n');
}

function flattenSelector(sel: SelectorSpec): string {
  return Array.isArray(sel) ? sel.join(', ') : sel;
}

function renderAction(action: Action): string {
  switch (action.type) {
    case 'idle':
      return '/* idle — camera holds */';
    case 'click':
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().click();`;
    case 'fill':
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().fill(${JSON.stringify(action.value)});`;
    case 'type':
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().pressSequentially(${JSON.stringify(action.value)});`;
    case 'hover':
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().hover();`;
    case 'scroll': {
      const dy = action.direction === 'down' ? 'el.scrollHeight' : '-el.scrollHeight';
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().evaluate((el) => { el.scrollTop = ${dy}; });`;
    }
    case 'navigate':
      return `await page.goto(${JSON.stringify(action.url)});`;
    case 'wait_for':
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().waitFor({ state: 'attached' });`;
    case 'wait_for_url':
      return `await page.waitForURL(${JSON.stringify(action.pattern)});`;
    case 'wait':
      return `await page.waitForTimeout(${action.ms});`;
    case 'assert_visible':
      return `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().waitFor({ state: 'visible' });`;
    case 'press':
      return action.selector
        ? `await page.locator(${JSON.stringify(flattenSelector(action.selector))}).first().press(${JSON.stringify(action.key)});`
        : `await page.keyboard.press(${JSON.stringify(action.key)});`;
    case 'custom':
      return `await page.evaluate(async () => { ${action.js} });`;
  }
}

function formatRange(start: number, end: number): string {
  return `${start.toFixed(2)}s – ${end.toFixed(2)}s`;
}

export async function writePlaywrightSpec(path: string, inputs: CodegenInputs): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderPlaywrightSpec(inputs), 'utf8');
}

const PREVIEW_HEADER = `// scripts/playwright_demo.spec.ts
// GENERATED FILE — DO NOT EDIT DIRECTLY.
// Lightweight @playwright/test wrapper used by \`showrunner preview\` (UI Mode).
// Mirrors playwright_demo.ts but inside test() so Playwright's runner can drive it.
`;

export function renderPlaywrightPreviewSpec(inputs: CodegenInputs): string {
  const { manifest, recording, targetUrl } = inputs;
  const segmentBlocks = manifest.segments
    .map((s) => {
      const head = `  // segment: ${s.id} (${formatRange(s.start, s.end)}) — ${s.label}`;
      const lines = s.actions.map((a) => `  ${renderAction(a)}`).join('\n');
      return [head, lines || '  // no actions', ''].join('\n');
    })
    .join('\n');

  const usesExpect = manifest.segments.some((s) =>
    s.actions.some((a) => a.type === 'assert_visible'),
  );
  const playwrightImport = usesExpect
    ? `import { test, expect } from '@playwright/test';`
    : `import { test } from '@playwright/test';`;

  const body = [
    playwrightImport,
    ``,
    `test('preview', async ({ page }) => {`,
    `  test.setTimeout(120_000);`,
    `  await page.setViewportSize({ width: ${recording.viewport.width}, height: ${recording.viewport.height} });`,
    `  await page.goto(${JSON.stringify(targetUrl)});`,
    ``,
    segmentBlocks,
    `});`,
    ``,
  ];

  return [PREVIEW_HEADER, body.join('\n')].join('\n');
}

export async function writePlaywrightPreviewSpec(
  path: string,
  inputs: CodegenInputs,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderPlaywrightPreviewSpec(inputs), 'utf8');
}
