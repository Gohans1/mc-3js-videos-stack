// Lip sync for the scene: the mouth shapes of the takes a character speaks (src/edit.json takes[].by), from the per-take
// Rhubarb cues bun run voice:lips gathers in src/timeline/mouth.json (voice seconds), moved the way the voice itself is
// heard in the scene: through the voice edit (voice.warp) and the narration clips of the sound timeline, as voice:cues does.
// The result is what mc-actor's mouthAt reads: [[scene second, "A".."H"|"X"], ...].
import { narrationLines } from "./narration.ts";
import { warp } from "./warp.mjs";

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
  const w = edit.voice?.warp ?? [];
  const lines = (edit.mouth?.takes ?? [])
    .filter((m) => mine.has(m.id) && m.cues?.length)
    .map((m) => {
      const words = m.cues.map(([s, shape], i) => ({
        w: shape,
        s: warp(w, m.at + s, 0, 1),
        e: m.cues[i + 1] ? warp(w, m.at + m.cues[i + 1][0], 0, 1) : Infinity,
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
