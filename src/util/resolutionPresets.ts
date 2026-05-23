export type ResolutionPreset = 'low' | 'standard' | 'high' | 'extreme';

export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  'low',
  'standard',
  'high',
  'extreme',
] as const;

export interface Resolution {
  width: number;
  height: number;
}

const PRESET_MAP: Record<ResolutionPreset, Resolution> = {
  low: { width: 854, height: 480 },
  standard: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
  extreme: { width: 3840, height: 2160 },
};

export function resolvePreset(value: string): Resolution {
  if (!RESOLUTION_PRESETS.includes(value as ResolutionPreset)) {
    throw new Error(
      `--resolution must be one of: ${RESOLUTION_PRESETS.join(', ')} (got "${value}")`,
    );
  }
  return PRESET_MAP[value as ResolutionPreset];
}

export function formatResolution(r: Resolution): string {
  return `${r.width}x${r.height}`;
}
