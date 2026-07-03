import { describe, it, expect } from 'vitest';
import { renderManifestUserPrompt } from './prompts.js';
import { productModelSchema } from '../productModel/schema.js';

describe('renderManifestUserPrompt director guidance', () => {
  it('includes director guidance when provided', () => {
    const pm = productModelSchema.parse({ product_name: 'Acme' });
    const cfg = {
      style: 'matter-of-fact',
      duration_target_seconds: 30,
      highlight_features: [],
      vo_review_gate: false,
    };
    const prompt = renderManifestUserPrompt(pm, cfg as any, undefined, 'Emphasize the KPI cards, warm tone.');
    expect(prompt).toContain('Director instructions');
    expect(prompt).toContain('Emphasize the KPI cards, warm tone.');
  });

  it('omits the section when guidance is blank/absent', () => {
    const pm = productModelSchema.parse({ product_name: 'Acme' });
    const cfg = {
      style: 'matter-of-fact',
      duration_target_seconds: 30,
      highlight_features: [],
      vo_review_gate: false,
    };
    expect(renderManifestUserPrompt(pm, cfg as any)).not.toContain('Director instructions');
  });
});
