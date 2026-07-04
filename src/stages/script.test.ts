import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scriptStage } from './script.js';
import { approveVoCommand } from '../commands/approveVo.js';
import type { PipelineContext } from '../pipeline/types.js';
import type { Manifest } from '../manifest/schema.js';

function makeManifest(): Manifest {
  return {
    total_duration_seconds: 12,
    generated_from: 'product_model.json',
    segments: [
      {
        id: 'intro',
        label: 'Introduction',
        start: 0,
        end: 6,
        vo_line: 'Welcome to the demo.',
        actions: [{ type: 'idle', at: 0 }],
        transition: 'fade_in',
      },
      {
        id: 'outro',
        label: 'Outro',
        start: 6,
        end: 12,
        vo_line: 'Thanks for watching.',
        actions: [{ type: 'idle', at: 0 }],
        transition: 'fade_out',
      },
    ],
  };
}

vi.mock('../scriptGen/generate.js', () => ({
  generateManifest: vi.fn(async () => makeManifest()),
  ManifestGenerationError: class ManifestGenerationError extends Error {},
}));

vi.mock('../scriptGen/domPreflight.js', () => ({
  scrapeSelectorInventory: vi.fn(async () => ({ items: [], finalUrl: 'https://example.com' })),
}));

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('vo_review_gate', () => {
  let projectDir: string;

  beforeEach(async () => {
    // The lazy LLM router constructs the default provider on first .forStage()
    // call, which requires the env var to exist (even though generateManifest
    // is mocked away below). Set a dummy value for the test.
    process.env['ANTHROPIC_API_KEY'] = process.env['ANTHROPIC_API_KEY'] ?? 'test-key';
    projectDir = await mkdtemp(join(tmpdir(), 'showrunner-gate-'));
    await mkdir(join(projectDir, 'scripts'), { recursive: true });
    // Write a minimal product_model.json so scriptStage doesn't bail early.
    await writeFile(
      join(projectDir, 'product_model.json'),
      JSON.stringify(
        {
          product_name: 'GateTest',
          tagline: 'tests the gate',
          primary_user: 'developers',
          confidence: 'high',
          source: 'documents',
          generated_at: new Date().toISOString(),
          core_flows: [],
          key_features: [],
          demo_recommendation: { suggested_flows: [], suggested_duration_seconds: 12 },
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('halts the pipeline when vo_review_gate is true and interactive mode is on; approve-vo resumes', async () => {
    const ctx = {
      config: {
        project: { name: 'GateTest' },
        script: {
          style: 'matter-of-fact',
          duration_target_seconds: 12,
          highlight_features: [],
          vo_review_gate: true,
        },
        recording: {
          target_url: 'https://example.com',
          viewport: { width: 1920, height: 1080 },
          browser: 'chromium',
          headless: true,
          output_dir: './segments/video',
          trace_dir: './segments/traces',
          cursor_highlight: true,
          cursor_min_motion_ms: 180,
          cursor_max_motion_ms: 700,
          cursor_post_arrival_ms: 100,
          cursor_chain_mode: 'strict',
          segment_buffer_ms: 200,
          preflight: true,
          state: {},
        },
        voiceover: {} as unknown,
        output: {} as unknown,
      } as unknown,
      configPath: join(projectDir, 'demo.yaml'),
      configDir: projectDir,
      runId: 'test-run',
      interactive: true,
      forced: new Set(),
      overrides: {},
    } as unknown as PipelineContext;

    const result = await scriptStage.run(ctx);
    expect(result.halt).toBe(true);
    expect(result.reason).toContain('vo_review_gate');

    const lockPath = join(projectDir, '.showrunner-lock');
    expect(await exists(lockPath)).toBe(true);

    const voScriptPath = join(projectDir, 'scripts', 'vo_script.txt');
    expect(await exists(voScriptPath)).toBe(true);

    // Edit the VO script — change the intro line.
    const original = await readFile(voScriptPath, 'utf8');
    const edited = original.replace('Welcome to the demo.', 'Hello and welcome.');
    expect(edited).not.toBe(original);
    await writeFile(voScriptPath, edited, 'utf8');

    // Write a minimal demo.yaml so approveVoCommand's loadConfig succeeds.
    await writeFile(
      join(projectDir, 'demo.yaml'),
      `project:\n  name: GateTest\nrecording:\n  target_url: https://example.com\nvoiceover:\n  voice_id: test\n`,
      'utf8',
    );

    await approveVoCommand({ config: join(projectDir, 'demo.yaml') });

    expect(await exists(lockPath)).toBe(false);

    const manifestPath = join(projectDir, 'scripts', 'manifest.json');
    const merged = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(merged.segments[0].vo_line).toBe('Hello and welcome.');
    expect(merged.segments[1].vo_line).toBe('Thanks for watching.');
  });
});
