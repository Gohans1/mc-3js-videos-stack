// Rhubarb cues index native audio samples; narration clips place them on the scene clock.
// voice.warp places narrative anchors, never stretches mouth cues; mc-actor reads [[scene second, shape], ...].
import { narrationLines } from "./narration.ts";

type Cue = [number, string];
interface MouthTake {
  id: string;
  at: number;
  cues: Cue[];
}
interface LipsEdit {
  takes?: { id: string; by?: string }[];
  mouth?: { takes?: MouthTake[] };
  voice?: { warp?: [number, number][] };
  audio?: Parameters<typeof narrationLines>[1];
}

// Called every frame: kept until one of the lists it reads is replaced (the studio never edits EDIT's lists in place)
const memo = new Map<string, { of: unknown[]; cues: Cue[] }>();
export const mouthCues = (edit: LipsEdit, who: string): Cue[] => {
  const of = [edit.takes, edit.mouth, edit.voice?.warp, edit.audio];
  const kept = memo.get(who);
  if (kept && kept.of.every((x, i) => x === of[i])) return kept.cues;
  const cues = build(edit, who);
  memo.set(who, { of, cues });
  return cues;
};

const build = (edit: LipsEdit, who: string): Cue[] => {
  const mine = new Set((edit.takes ?? []).filter((t) => t.by === who).map((t) => t.id));
  const lines = (edit.mouth?.takes ?? [])
    .filter((m) => mine.has(m.id) && m.cues?.length)
    .map((m) => {
      const words = m.cues.map(([s, shape], i) => ({
        w: shape,
        s: m.at + s,
        e: m.cues[i + 1] ? m.at + m.cues[i + 1][0] : Infinity,
      }));
      return { text: m.id, s: words[0].s, e: words.at(-1).e, words };
    });
  const spans = narrationLines(lines, edit.audio, Infinity, true)
    .flatMap((l) => l.words)
    .sort((a, b) => a.s - b.s);
  // where a clip cuts a take short the mouth shuts, unless the next shape starts right there
  const cues = spans.flatMap((x, i) => {
    const next = spans[i + 1];
    const cue: Cue = [x.s, x.w];
    const cut = Number.isFinite(x.e) && x.w !== "X" && (!next || next.s - x.e > 1e-3);
    return cut ? [cue, [x.e, "X"] as Cue] : [cue];
  });
  return cues.filter((c, i) => i === 0 || c[1] !== cues[i - 1][1]);
};
