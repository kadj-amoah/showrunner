export interface SynthesizePayload {
  script: string;
  voiceId: string;
  model: string;
  normalize: boolean;
  gatePolicy: 'warn' | 'fail';
  naturalness: boolean;
}

export interface NormalizationDiff {
  from: string;
  to: string;
  rule: string;
}

export interface VoiceoverSummary {
  normalization: { enabled: boolean; substitutions: number; diffs: NormalizationDiff[] };
  freeze: { key: string; reused: boolean };
  gate: { ok: boolean; issues: string[] };
  naturalness: { available: boolean; score: number | null; floor: number | null; belowFloor: boolean };
  phonemes?: Record<string, string>;
}

export interface SynthesizeResponse {
  summary: VoiceoverSummary;
  audioUrl: string;
}

export async function synthesize(payload: SynthesizePayload): Promise<SynthesizeResponse> {
  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await res.json()) as SynthesizeResponse;
}
