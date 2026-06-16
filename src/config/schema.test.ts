import { describe, it, expect } from 'vitest';
import { showrunnerConfigSchema } from './schema.js';

describe('g2p pronunciation config', () => {
  it('defaults the pronunciation-lexicon knobs', () => {
    const cfg = showrunnerConfigSchema.parse({
      project: { name: 'x' },
      recording: { target_url: 'https://e.com' },
      voiceover: { provider: { name: 'elevenlabs', voice_id: 'v' } },
    });
    expect(cfg.voiceover.g2p.proxy_language).toBe('sw');
    expect(cfg.voiceover.g2p.resolver_enabled).toBe(false);
    expect(cfg.voiceover.g2p.confidence_threshold).toBe(0.75);
    expect(cfg.voiceover.g2p.lexicon_path).toBe('lexicon.json');
  });
});
