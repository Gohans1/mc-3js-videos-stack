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

// After clips were moved: each one that lands on a clip it wasn't moved with goes to a new track just below, as CapCut does
export const resolve = (l: Tracked, moved: Ref[], spanOf: SpanOf) => {
  const placed: Ref[] = [];
  for (const r of [...moved].sort((a, b) => spanOf(a)[0] - spanOf(b)[0])) {
    const e = entry(l, r), sp = spanOf(r), others = moved.filter((m) => !placed.some((p) => same(p, m)));
    if (fits(l, e.track as string, sp, spanOf, others)) { placed.push(r); continue; }
    const row = l.tracks!.findIndex((t) => t.id === e.track);
    // A track this pass made already, if the clip fits there; else another one
    let t = l.tracks!.slice(row + 1).find((t) => t.made && fits(l, t.id, sp, spanOf, others));
    let at = row + 1;
    while (l.tracks![at]?.made) at++;
    if (!t) { t = addTrack(l, r.list, at); t.made = true; }
    e.track = t.id;
    placed.push(r);
  }
  for (const t of l.tracks ?? []) delete t.made;
};

// Tracks left with no clips go, as in CapCut
export const tidy = (l: Tracked) => {
  const used = new Set(refs(l).map((r) => entry(l, r).track));
  l.tracks = (l.tracks ?? []).filter((t) => used.has(t.id));
};
