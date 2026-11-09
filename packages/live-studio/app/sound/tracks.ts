// The sound lanes' tracks, CapCut style: audio.json "tracks" lists them top to bottom, each bed and one-shot names its own with
// "track", and two clips never overlap on one track. A film written before tracks (or an agent's entry without one) gets them
// here, packed in time order onto the first track of its kind with room. Muted tracks are left out of the mix by mix.py too.
// No browser or store imports: test/tracks.test.mjs runs this under node.
export interface Track { id: string; name: string; mute?: boolean; lock?: boolean; [k: string]: unknown }
export type List = "beds" | "sfx";
export interface Ref { list: List; i: number }
interface Entry { track?: string; [k: string]: unknown }
export interface Tracked { beds: Entry[]; sfx: Entry[]; tracks?: Track[]; [k: string]: unknown }
export type SpanOf = (r: Ref) => [number, number];

const KIND_NAME: Record<List, string> = { beds: "Bed", sfx: "SFX" };
const TOUCH = 0.02; // clips this close still count as end to end, not overlapping

export const refs = (l: Tracked): Ref[] => (["beds", "sfx"] as const).flatMap((list) => l[list].map((_, i) => ({ list, i })));
export const entry = (l: Tracked, r: Ref) => l[r.list][r.i];
export const same = (a: Ref, b: Ref) => a.list === b.list && a.i === b.i;
export const trackOf = (l: Tracked, r: Ref) => l.tracks?.find((t) => t.id === entry(l, r)?.track);

const newId = (l: Tracked) => `t${1 + Math.max(0, ...(l.tracks ?? []).map((t) => Number(t.id.slice(1)) || 0))}`;
// A new track at row `at` (end when left out), named after its kind with the first number not taken ("SFX", "SFX 2", ...)
export const addTrack = (l: Tracked, kind: List, at?: number): Track => {
  l.tracks ??= [];
  const taken = new Set(l.tracks.map((t) => t.name)), named = (n: number) => (n > 1 ? `${KIND_NAME[kind]} ${n}` : KIND_NAME[kind]);
  let n = 1;
  while (taken.has(named(n))) n++;
  const t: Track = { id: newId(l), name: named(n) };
  l.tracks.splice(at ?? l.tracks.length, 0, t);
  return t;
};

// Whether [s, e] fits on track id beside every clip already there, leaving out the ones in skip
export const fits = (l: Tracked, id: string, [s, e]: [number, number], spanOf: SpanOf, skip: Ref[] = []) =>
  refs(l).every((r) => {
    if (entry(l, r).track !== id || skip.some((k) => same(k, r))) return true;
    const [a, b] = spanOf(r);
    return e <= a + TOUCH || s >= b - TOUCH;
  });

// Collision intervals are displacements of the entire selection, so clips never drift apart.
export const placeShift = (l: Tracked, moved: Ref[], spanOf: SpanOf, want: number, [lo, hi]: [number, number]): number | null => {
  if (moved.some((r) => trackOf(l, r)?.lock)) return null;
  const still = refs(l).filter((r) => !moved.some((m) => same(m, r))), blocked: [number, number][] = [];
  for (const r of moved) {
    const [s, e] = spanOf(r);
    for (const other of still) if (entry(l, r).track === entry(l, other).track) {
      const [a, b] = spanOf(other);
      blocked.push([a - e, b - s]);
    }
  }
  const merged: [number, number][] = [];
  for (const interval of blocked.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && interval[0] < last[1] - 1e-6) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  const at = Math.max(lo, Math.min(hi, want)), blockedAt = merged.find(([a, b]) => at > a + 1e-6 && at < b - 1e-6);
  if (!blockedAt) return at;
  return blockedAt.filter((d) => d >= lo && d <= hi).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0] ?? null;
};

// Where a pasted clip goes: the track it came from while that has room, else the nearest free one of its kind (below, then
// above), so a paste fills a track that is there before it adds one (the dev's call); a new one just below only when none is
export const freeTrack = (l: Tracked, kind: List, sp: [number, number], spanOf: SpanOf, from: string) => {
  l.tracks ??= [];
  const ts = l.tracks, at = ts.findIndex((t) => t.id === from);
  const own = new Set(refs(l).filter((r) => r.list === kind).map((r) => entry(l, r).track));
  const near = [ts[at], ...ts.slice(at + 1), ...ts.slice(0, Math.max(0, at)).reverse()];
  const t = near.find((t) => t && (t.id === from || own.has(t.id)) && !t.lock && fits(l, t.id, sp, spanOf));
  return t ? t.id : addTrack(l, kind, at < 0 ? undefined : at + 1).id;
};

// Every clip on a track that exists; returns whether anything was given one
export const normalize = (l: Tracked, spanOf: SpanOf) => {
  l.tracks ??= [];
  const known = new Set(l.tracks.map((t) => t.id));
  // Beds before one-shots, each in time order, so a film's beds land on the tracks above its one-shots
  const homeless = refs(l).filter((r) => !known.has(entry(l, r).track as string)).sort((a, b) => a.list.localeCompare(b.list) || spanOf(a)[0] - spanOf(b)[0]);
  // Each kind's own tracks first, so beds and one-shots stay apart as the film had them
  const own = new Map<string, List>();
  for (const r of refs(l)) if (known.has(entry(l, r).track as string)) own.set(entry(l, r).track as string, r.list);
  for (const r of homeless) {
    const sp = spanOf(r);
    let t = l.tracks.find((t) => own.get(t.id) === r.list && fits(l, t.id, sp, spanOf));
    if (!t) { t = addTrack(l, r.list); own.set(t.id, r.list); }
    entry(l, r).track = t.id;
  }
  return homeless.length > 0;
};

export const shiftRoom = (l: Tracked, moved: Ref[], spanOf: SpanOf): [number, number] => {
  if (moved.some((r) => trackOf(l, r)?.lock)) return [0, 0];
  let lo = -Infinity, hi = Infinity;
  const still = refs(l).filter((r) => !moved.some((m) => same(m, r)));
  for (const r of moved) {
    const [s, e] = spanOf(r);
    for (const other of still) if (entry(l, r).track === entry(l, other).track) {
      const [a, b] = spanOf(other);
      if (b <= s + TOUCH) lo = Math.max(lo, b - s);
      else if (a >= e - TOUCH) hi = Math.min(hi, a - e);
      else return [0, 0];
    }
  }
  return [lo, hi];
};

// Tracks left with no clips go, as in CapCut
export const tidy = (l: Tracked) => {
  const used = new Set(refs(l).map((r) => entry(l, r).track));
  l.tracks = (l.tracks ?? []).filter((t) => used.has(t.id));
};
