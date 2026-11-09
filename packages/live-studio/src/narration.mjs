export const narrationLines = (lines, audio, duration, audible = false) => {
  if (!audio?.narration) return lines;
  const muted = new Set((audio.tracks ?? []).filter((t) => t.mute).map((t) => t.id));
  const out = [];
  for (const clip of audio.sfx) {
    if (clip.name !== audio.narration || (audible && muted.has(clip.track))) continue;
    const rate = clip.rate ?? 1, start = clip.start ?? 0, length = clip.length ?? (duration - start) / rate, end = start + length * rate;
    const at = (s) => clip.at + (clip.reverse ? end - s : s - start) / rate;
    const range = (s, e) => [at(Math.max(start, s)), at(Math.min(end, e))].sort((a, b) => a - b);
    for (const line of lines) {
      if (line.e <= start || line.s >= end) continue;
      const words = line.words.filter((w) => w.e > start && w.s < end).map((w) => {
        const [s, e] = range(w.s, w.e);
        return { ...w, s, e };
      }).sort((a, b) => a.s - b.s);
      const [s, e] = range(line.s, line.e);
      out.push({ text: words.length ? words.map((w) => w.w).join(" ") : line.text, s, e, words });
    }
  }
  return out.sort((a, b) => a.s - b.s);
};
