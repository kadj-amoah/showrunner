export type QualityPreset = 'draft' | 'standard' | 'high';

export interface ResolvedQuality {
  /** ffmpeg `-crf` (lower is better; 18–28 is the useful range for libx264). */
  crf: number;
  /** ffmpeg `-preset` (slower = smaller file). */
  preset: 'veryfast' | 'medium' | 'slow';
  /** ffmpeg `-b:a` audio bitrate. */
  audioBitrate: string;
}

/**
 * Map a human quality knob to ffmpeg encoder params.
 *
 *  draft     fast iterations: ~5x smaller, visibly soft
 *  standard  shipping default (matches the previous hardcoded values)
 *  high      crisp text + smooth motion; ~2x file size, ~3x encode time
 */
export function resolveQuality(preset: QualityPreset): ResolvedQuality {
  switch (preset) {
    case 'draft':
      return { crf: 28, preset: 'veryfast', audioBitrate: '128k' };
    case 'high':
      return { crf: 18, preset: 'slow', audioBitrate: '256k' };
    case 'standard':
    default:
      return { crf: 20, preset: 'medium', audioBitrate: '192k' };
  }
}
