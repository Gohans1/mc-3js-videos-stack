export interface NarrationWord {
  w: string;
  s: number;
  e: number;
}

export interface NarrationLine {
  text: string;
  s: number;
  e: number;
  words: NarrationWord[];
}

export interface NarrationAudio {
  narration?: string;
  voice?: boolean;
  sfx: {
    name: string;
    at: number;
    start?: number;
    length?: number;
    rate?: number;
    reverse?: boolean;
    track?: string;
  }[];
  tracks?: { id: string; mute?: boolean }[];
}

export const narrationClipLength = (
  clip: NarrationAudio["sfx"][number],
  duration: number,
): number => {
  const available = Math.max(0, (duration - (clip.start ?? 0)) / (clip.rate ?? 1));
  return Math.max(0, Math.min(clip.length ?? available, duration > 0 ? available : Infinity));
};

export const narrationLines = (
  lines: NarrationLine[],
  audio: NarrationAudio | null | undefined,
  duration: number,
  audible = false,
): NarrationLine[] => {
  if (!audio?.narration) return lines;
  const muted = new Set((audio.tracks ?? []).filter((t) => t.mute).map((t) => t.id));
  const out: NarrationLine[] = [];
  for (const clip of audio.sfx) {
    if (clip.name !== audio.narration || (audible && muted.has(clip.track ?? ""))) continue;
    const rate = clip.rate ?? 1,
      start = clip.start ?? 0,
      length = narrationClipLength(clip, duration),
      end = start + length * rate;
    if (length <= 0) continue;
    const at = (s: number) => clip.at + (clip.reverse ? end - s : s - start) / rate;
    const range = (s: number, e: number): [number, number] =>
      [at(Math.max(start, s)), at(Math.min(end, e))].sort((a, b) => a - b) as [number, number];
    for (const line of lines) {
      if (line.e <= start || line.s >= end) continue;
      const words = line.words
        .filter((w) => w.e > start && w.s < end)
        .map((w) => {
          const [s, e] = range(w.s, w.e);
          return { ...w, s, e };
        })
        .sort((a, b) => a.s - b.s);
      const [s, e] = range(line.s, line.e);
      out.push({ text: words.length ? words.map((w) => w.w).join(" ") : line.text, s, e, words });
    }
  }
  return out.sort((a, b) => a.s - b.s);
};

// What of the sound timeline shows in the picture: where the narration clips put the voice, which the mouths follow
// (lips.ts), and which tracks are muted. A video is built with this alone (render.mjs), so a gain, a bed or an effect
// changes no frame and keeps every chunk; render keeps it in <chunks>/seen-sound.json for stale.mjs to compare
export const seenSound = (audio: NarrationAudio | null | undefined) => ({
  beds: [],
  narration: audio?.narration,
  sfx: (audio?.sfx ?? [])
    .filter((c) => c.name === audio?.narration)
    .map(({ name, at, start, length, rate, reverse, track }) => ({
      name,
      at,
      start,
      length,
      rate,
      reverse,
      track,
    })),
  tracks: (audio?.tracks ?? []).map(({ id, mute }) => ({ id, mute })),
});
