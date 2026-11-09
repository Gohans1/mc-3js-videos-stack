export interface BeatMarkers { beats?: number[]; beatMode?: 1 | 2; bpm?: number; beatSource?: string }

export const beatMarks = (c: BeatMarkers, duration: number) => (c.beats ?? []).filter((t) => t >= 0 && t < duration);
export const reverseBeats = (c: BeatMarkers, duration: number) => {
  if (c.beats) c.beats = c.beats.map((t) => duration - t).sort((a, b) => a - b);
};
