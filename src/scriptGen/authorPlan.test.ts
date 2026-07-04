import { describe, it, expect } from 'vitest';
import { authorPlan, AuthorPlanError } from './authorPlan.js';
import { productModelSchema } from '../productModel/schema.js';

const FAKE_INVENTORY = [
  { tag: 'button', selector: '[data-testid="save"]', visibleText: 'Save', dataTestid: 'save' },
  { tag: 'a', selector: 'text=Dashboard', visibleText: 'Dashboard' },
];
const GOOD_MANIFEST = {
  total_duration_seconds: 30,
  generated_from: 'product_model.json',
  segments: [
    { id: 's1', label: 'Intro', start: 0, end: 15, vo_line: 'hi', transition: 'fade_in',
      actions: [{ type: 'navigate', url: 'https://x.test' }, { type: 'click', selector: '[data-testid="save"]' }] },
    { id: 's2', label: 'Outro', start: 15, end: 30, vo_line: 'bye', transition: 'cut',
      actions: [{ type: 'idle' }] },
  ],
};

describe('authorPlan', () => {
  it('authorPlan returns a grounded plan + the inventory it used', async () => {
    const res = await authorPlan(
      { target_url: 'https://x.test', instructions: 'Show saving.', duration_s: 30, product_name: 'X' },
      { scrape: async (input) => ({ items: FAKE_INVENTORY, finalUrl: input.targetUrl }), generate: async () => GOOD_MANIFEST as any },
    );
    expect(res.grounded).toBe(true);
    expect(res.inventory).toEqual(FAKE_INVENTORY);
    expect(res.manifest.segments.length).toBe(2);
  });

  it('authorPlan passes instructions through as guidance and the inventory to generate', async () => {
    let seenGuidance: string | undefined; let seenInv: unknown;
    await authorPlan(
      { target_url: 'https://x.test', instructions: 'Warm tone.', duration_s: 30, product_name: 'X' },
      { scrape: async (input) => ({ items: FAKE_INVENTORY, finalUrl: input.targetUrl }), generate: async (opts: any) => { seenGuidance = opts.guidance; seenInv = opts.selectorInventory; return GOOD_MANIFEST as any; } },
    );
    expect(seenGuidance).toContain('Warm tone.');
    expect(seenInv).toEqual(FAKE_INVENTORY);
  });

  it('authorPlan synthesizes a minimal valid product model when none is given', async () => {
    let seenPM: any;
    await authorPlan(
      { target_url: 'https://app.example.test/x', duration_s: 20 },
      { scrape: async (input) => ({ items: FAKE_INVENTORY, finalUrl: input.targetUrl }), generate: async (opts: any) => { seenPM = opts.productModel; return GOOD_MANIFEST as any; } },
    );
    expect(() => productModelSchema.parse(seenPM)).not.toThrow();
    expect(seenPM.product_name.length).toBeGreaterThan(0);   // derived from host when product_name absent
  });

  it('authorPlan raises a NAMED error when the target cannot be inspected (no blind plan)', async () => {
    await expect(authorPlan(
      { target_url: 'https://down.test', duration_s: 20 },
      { scrape: async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); }, generate: async () => GOOD_MANIFEST as any },
    )).rejects.toBeInstanceOf(AuthorPlanError);
  });

  it('authorPlan flags non-grounded when the inventory is empty (still returns, warnings set)', async () => {
    const res = await authorPlan(
      { target_url: 'https://x.test', duration_s: 20 },
      { scrape: async (input) => ({ items: [], finalUrl: input.targetUrl }), generate: async () => GOOD_MANIFEST as any },
    );
    expect(res.grounded).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/inventory/i);
  });

  it('authorPlan flags non-grounded when generate returns residual selector violations (non-empty inventory)', async () => {
    const BAD_MANIFEST = {
      total_duration_seconds: 30,
      generated_from: 'product_model.json',
      segments: [
        { id: 's1', label: 'Intro', start: 0, end: 15, vo_line: 'hi', transition: 'fade_in',
          actions: [{ type: 'navigate', url: 'https://x.test' }, { type: 'click', selector: '.made-up-selector' }] },
        { id: 's2', label: 'Outro', start: 15, end: 30, vo_line: 'bye', transition: 'cut',
          actions: [{ type: 'idle' }] },
      ],
    };
    const res = await authorPlan(
      { target_url: 'https://x.test', instructions: 'Show saving.', duration_s: 30, product_name: 'X' },
      { scrape: async (input) => ({ items: FAKE_INVENTORY, finalUrl: input.targetUrl }), generate: async () => BAD_MANIFEST as any },
    );
    expect(res.grounded).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/\.made-up-selector/);
  });

  it('returns needs_auth when the explore lands on a login page', async () => {
    const res = await authorPlan(
      { target_url: 'http://x/dashboard/1', duration_s: 10 },
      {
        scrape: async () => ({
          items: [
            { tag: 'input', selector: 'input[name="username"]', name: 'username' },
            { tag: 'input', selector: 'input[name="password"]', name: 'password' },
            { tag: 'button', selector: 'button:has-text("Sign in")', visibleText: 'Sign in' },
          ],
          finalUrl: 'http://x/auth/login',
        }),
        generate: async () => { throw new Error('should not author a manifest for a login page') },
      },
    );
    expect(res.status).toBe('needs_auth');
    if (res.status === 'needs_auth') {
      expect(res.auth_challenge.mode).toBe('form');
      expect(res.final_url).toBe('http://x/auth/login');
    }
  });

  it('returns status ok with a grounded manifest when the target loads', async () => {
    const res = await authorPlan(
      { target_url: 'http://x/dashboard/1', duration_s: 10 },
      {
        scrape: async () => ({
          items: [{ tag: 'button', selector: '[data-testid="kpi"]', dataTestid: 'kpi' }],
          finalUrl: 'http://x/dashboard/1',
        }),
        generate: async () => ({
          total_duration_seconds: 10, generated_from: 'x',
          segments: [{ id: 's1', label: 'L', start: 0, end: 10, vo_line: 'hi', transition: 'cut', actions: [{ type: 'wait_for', selector: '[data-testid="kpi"]' }] }],
        }) as never,
      },
    );
    expect(res.status).toBe('ok');
  });
});
