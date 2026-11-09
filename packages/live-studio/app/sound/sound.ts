// The film's sound lanes (src/sound.mjs on the server), edited by hand like the camera keys (doc.ts: undo, saving, an agent's
// edit wins): beds that loop from..to and one-shots at a time, both from the film's sfx folder. The film's own sound watcher
// remixes on a save, or, with live lanes (mixer.ts), the page plays the change itself and nothing is remixed.
import { DURATION } from "film/scene";
import { createDoc } from "../core/doc";
import { getFile } from "../core/net";
import { r3, stamp } from "../core/time";
import { measureFinal } from "./meter";
import { forgetSounds, replan, setLive } from "./mixer";
import { S } from "../core/state";
import type { Role } from "./hit";
import { type ClipRef } from "./slice";
import { get, say, set } from "../core/store";
import { addTrack, fits, freeTrack, normalize, refs, placeShift, same, tidy, type Track, trackOf } from "./tracks";

export interface Bed { name: string; from: number; to: number; gain: number; fadeIn: number; fadeOut: number; start?: number; duck?: number; pan?: number; track?: string; try?: string[]; [k: string]: unknown }
export interface OneShot { at: number; name: string; gain: number; start?: number; length?: number; fadeIn?: number; fadeOut?: number; pan?: number; track?: string; try?: string[]; [k: string]: unknown }
export interface Lanes { beds: Bed[]; sfx: OneShot[]; tracks: Track[]; [k: string]: unknown }
export interface LibraryItem { name: string; seconds: number; title?: string; license?: string; url?: string; for?: string; kind?: "bgm" | "sfx"; role?: Role }
export interface Peaks { step: number; peaks: number[] }

export let lanes: Lanes | null = null;
export let library: LibraryItem[] = [];

// A soloed track that went (emptied, undone) lets go of its solo, or the page would stay silent with no button to undo it
const changed = () => {
  lanes = doc.data;
  const ids = new Set(lanes?.tracks?.map((t) => t.id)), solo = get().solo.filter((t) => ids.has(t));
  set({ soundRev: get().soundRev + 1, ...(solo.length !== get().solo.length && { solo }) });
  S.dirty = true;
  replan();
  measureFinal();
  if (get().clips.some((c) => !clipOf(c))) setClips([]);
};
const doc = createDoc<Lanes>("sound", {
  label: "audio",
  changed,
  tidy: (l) => { lanes = l; normalize(l, span); tidy(l); }, // a film without tracks gets them here, and in the file with its next edit
  saved: (soundSaved) => set({ soundSaved }),
  replaced: (was) => { if (!was || !lanes || was.beds.length !== lanes.beds.length || was.sfx.length !== lanes.sfx.length) setClips([]); },
});
export const seconds = (name: string) => library.find((x) => x.name === name)?.seconds ?? 1;
// Which library tab a sound sits in (CapCut's Music and Sound effects) and which lane + puts it on: what SOURCES.json says,
// else its length, since music and room tone run long and a hit is short
const LONG = 10;
export const kindOf = (x: LibraryItem): "bgm" | "sfx" => x.kind ?? (x.seconds >= LONG ? "bgm" : "sfx");

// Where a clip sounds, in film seconds. A one-shot without a length rings to the end of its file
export const span = (c: ClipRef): [number, number] => {
  if (!lanes) return [0, 0];
  if (c.list === "beds") { const b = lanes.beds[c.i]; return [b.from, b.to]; }
  const s = lanes.sfx[c.i];
  return [s.at, s.at + (s.length ?? Math.max(0.05, seconds(s.name) - (s.start ?? 0)))];
};
export const clipOf = (c: ClipRef | null) => (c && lanes ? (c.list === "beds" ? lanes.beds[c.i] : lanes.sfx[c.i]) ?? null : null);
export const clipTitle = (c: ClipRef) => { const x = clipOf(c)!; return `${x.name} ${stamp(span(c)[0])}`; };

// ---------- Loading: on start, after any remix and when an agent edits the file (the "lanes" event)
export const loadSound = async () => {
  const r = await doc.load();
  if (!r) { set({ sound: false }); return; }
  const got: { library: LibraryItem[]; live?: boolean } = await r.json();
  if (library.length && JSON.stringify(got.library) !== JSON.stringify(library)) forgetSounds();
  library = got.library;
  set({ sound: true, liveLanes: !!got.live });
  setLive(!!got.live, { lanes: () => lanes, library: () => library, span });
  changed();
};

// Every edit goes through here: one undo step, drawn now, saved shortly (a slider dragged saves once, when let go)
export const edit = doc.edit, preview = doc.preview, snapshot = doc.snapshot, restore = doc.restore;

// ---------- What the lanes and the panel ask for
export const setClips = (cs: ClipRef[]) => { set(cs.length ? { clips: cs, clip: cs.length === 1 ? cs[0] : null, side: "sound", camKey: null, camPicks: [], shotPick: null, keyPicks: [], textPicks: [], object: null } : { clips: [], clip: null }); S.dirty = true; };
export const setClip = (c: ClipRef | null) => setClips(c ? [c] : []);
// Solo, as in Premiere and Resolve: only the soloed tracks sound, heard at once; this page only, never saved or rendered
export const setSolo = (id: string, on: boolean) => {
  const solo = get().solo.filter((t) => t !== id);
  set({ solo: on ? [...solo, id] : solo });
  S.dirty = true;
  replan();
};
export const picked = (c: ClipRef) => get().clips.some((p) => same(p, c));
export const locked = (c: ClipRef) => !!(lanes && trackOf(lanes, c)?.lock);
export const allClips = (): ClipRef[] => (lanes ? refs(lanes) : []);
// Every clip that plays this file: what the library row counts, lights and picks (Resolve's clip usage)
export const usesOf = (name: string) => allClips().filter((c) => clipOf(c)?.name === name);
export const lightSound = (name: string | null) => { if (get().soundLit !== name) { set({ soundLit: name }); S.dirty = true; } };
export const pickUses = (name: string) => {
  const cs = usesOf(name);
  if (!cs.length) { say(`${name} isn't on a track yet. Drag it onto one, or click +`); return; }
  setClips(cs);
  say(cs.length > 1 ? `All ${cs.length} clips of ${name} selected` : `The clip of ${name} selected`);
};
// The keyboard's way onto the lanes: each press picks the next clip sounding at t, or the nearest one when none is
export const pickAt = (t: number) => {
  if (!lanes) return;
  const all = (["beds", "sfx"] as const).flatMap((list) => lanes![list].map((_, i) => ({ list, i })));
  if (!all.length) return;
  const here = all.filter((c) => { const [a, b] = span(c); return a <= t && t <= b; });
  const now = get().clip, k = here.findIndex((c) => c.list === now?.list && c.i === now.i);
  const dist = (c: ClipRef) => { const [a, b] = span(c); return Math.min(Math.abs(a - t), Math.abs(b - t)); };
  setClip(here.length ? here[(k + 1) % here.length] : all.reduce((p, q) => (dist(q) < dist(p) ? q : p)));
};
// The track a new clip goes on: the one it was dropped on if it has room there, else the first of the film's tracks for that kind
// with room, else a new one (below the one dropped on)
const onto = (l: Lanes, kind: "beds" | "sfx", s: number, e: number, want?: string) => {
  if (want === "new") return addTrack(l, kind).id;
  if (want &&l.tracks.some((t) => t.id === want && !t.lock) && fits(l, want, [s, e], span)) return want;
  const home = new Set(refs(l).filter((r) => r.list === kind).map((r) => l[r.list][r.i].track));
  const t = l.tracks.find((t) => home.has(t.id) && !t.lock && fits(l, t.id, [s, e], span));
  if (t && !want) return t.id;
  const row = l.tracks.findIndex((t) => t.id === want);
  return addTrack(l, kind, row < 0 ? undefined : row + 1).id;
};
export const addClip = (name: string, at: number, list?: "beds" | "sfx", track?: string) => {
  const item = library.find((x) => x.name === name), len = seconds(name), kind = list ?? (item && kindOf(item) === "bgm" ? "beds" : "sfx");
  let ref: ClipRef = { list: kind, i: 0 };
  edit((l) => {
    if (kind === "beds") {
      l.beds.push({ name, from: r3(at), to: r3(at + Math.min(len, 30)), gain: 0, fadeIn: 0.5, fadeOut: 0.5, track: onto(l, kind, at, at + Math.min(len, 30), track) });
      ref = { list: "beds", i: l.beds.length - 1 };
    } else {
      // In time order, as a film's own list is written, so the file reads top to bottom
      const i = l.sfx.findIndex((s) => s.at > at);
      const at3 = r3(at);
      l.sfx.splice(i < 0 ? l.sfx.length : i, 0, { at: at3, name, gain: 0, track: onto(l, kind, at3, at3 + len, track) });
      ref = { list: "sfx", i: i < 0 ? l.sfx.length - 1 : i };
    }
  });
  setClip(ref);
  say(`${name} added at ${stamp(at)}`);
};
// Several one-shots at once (sweeten.ts), each on the first sound-effects track with room as addClip puts one; one undo step,
// all picked after
export interface NewShot { name: string; at: number; gain: number; start?: number; length?: number; fadeOut?: number }
export const addShots = (shots: NewShot[]) => {
  const made: OneShot[] = [];
  edit((l) => {
    for (const x of shots) {
      const at = r3(x.at), len = x.length ?? Math.max(0.05, seconds(x.name) - (x.start ?? 0));
      const o: OneShot = { at, name: x.name, gain: x.gain, ...(x.start && { start: r3(x.start) }), ...(x.length && { length: r3(x.length) }), ...(x.fadeOut && { fadeOut: x.fadeOut }) };
      o.track = onto(l, "sfx", at, at + len);
      const i = l.sfx.findIndex((s) => s.at > at);
      l.sfx.splice(i < 0 ? l.sfx.length : i, 0, o);
      made.push(o);
    }
  });
  setClips(made.map((x) => ({ list: "sfx" as const, i: lanes!.sfx.indexOf(x) })).filter((r) => r.i >= 0));
};
// Copies of clips (timeline/clipboard.ts), d seconds later: each on the track it came from while that has room, else the
// nearest free track of its kind (freeTrack), the copies picked after; one undo step
export type CopiedClip = { list: ClipRef["list"]; x: Bed | OneShot };
export const pasteClips = (items: CopiedClip[], d: number) => {
  const made: { list: ClipRef["list"]; x: Bed | OneShot }[] = [];
  edit((l) => {
    for (const { list, x } of items) {
      const c = structuredClone(x);
      if (list === "beds") {
        const b = c as Bed, len = b.to - b.from;
        b.from = r3(Math.max(0, b.from + d)); b.to = r3(b.from + len);
        b.track = freeTrack(l, list, [b.from, b.to], span, b.track ?? "");
        l.beds.push(b);
      } else {
        const o = c as OneShot, len = (o.length ?? Math.max(0.05, seconds(o.name) - (o.start ?? 0)));
        o.at = r3(Math.max(0, o.at + d));
        o.track = freeTrack(l, list, [o.at, o.at + len], span, o.track ?? "");
        // In time order, as addClip keeps the list
        const i = l.sfx.findIndex((s) => s.at > o.at);
        l.sfx.splice(i < 0 ? l.sfx.length : i, 0, o);
      }
      made.push({ list, x: c });
    }
  });
  setClips(made.map(({ list, x }) => ({ list, i: (list === "beds" ? lanes!.beds : lanes!.sfx).indexOf(x as never) })).filter((r) => r.i >= 0));
  say(`${made.length > 1 ? `${made.length} clips` : made[0].x.name} pasted at ${stamp(S.t)}`);
};
export const removeClips = (cs: ClipRef[]) => {
  const gone = cs.filter((c) => clipOf(c) && !locked(c));
  if (!gone.length) { if (cs.length) say("This track is locked. Unlock it in the track header to delete"); return; }
  const first = clipOf(gone[0])!.name;
  // From the back of each list, so the places still to remove don't move
  edit((l) => { for (const c of [...gone].sort((a, b) => b.i - a.i)) (c.list === "beds" ? l.beds : l.sfx).splice(c.i, 1); });
  setClips([]);
  say(`${gone.length > 1 ? `${gone.length} clips` : first} deleted. Ctrl+Z to undo`);
};
export const removeClip = (c: ClipRef) => removeClips([c]);
export const moveToTrack = (c: ClipRef, id: string) => {
  if (locked(c) || lanes?.tracks.find((t) => t.id === id)?.lock) { say("This track is locked. Unlock it in the track header to edit"); return; }
  if (id !== "new" && lanes && !fits(lanes, id, span(c), span, [c])) { say("This clip does not fit here. Choose a track with space or drag it to a gap"); return; }
  edit((l) => { l[c.list][c.i].track = id === "new" ? addTrack(l, c.list).id : id; });
};
export const setTrack = (id: string, change: Partial<Track>) => edit((l) => { const t = l.tracks.find((t) => t.id === id); if (t) Object.assign(t, change); });
export const moveTo = (c: ClipRef, at: number) => {
  if (!lanes || locked(c)) return;
  const [from] = span(c), shift = placeShift(lanes, [c], span, at - from, [-from, DURATION - .05 - from]);
  if (shift === null) return;
  edit((l) => {
    if (c.list === "beds") { const b = l.beds[c.i]; b.from = r3(b.from + shift); b.to = r3(b.to + shift); }
    else l.sfx[c.i].at = r3(l.sfx[c.i].at + shift);
  });
};

// ---------- CapCut's cuts on the picked clips at the playhead: Ctrl+B splits each one it crosses, Q drops what lies before it,
// W what lies after. The part kept on the right goes on playing the file from where the left part stopped (start: seconds
// into the file, which a bed loops), and only the outer ends keep their fades
const MIN = 0.05;
const crossing = (cs: ClipRef[], t: number, what: string) => {
  const hit = cs.filter((c) => { const [a, b] = span(c); return !locked(c) && a + MIN < t && t < b - MIN; });
  if (!hit.length) say(cs.length ? `The playhead isn't inside a picked clip on an unlocked track: move it over the clip to ${what}` : `Pick a sound clip first, then ${what} it at the playhead`);
  return hit;
};
const into = (start: number | undefined, d: number, name: string, loop: boolean) => { const v = (start ?? 0) + d, f = seconds(name); return r3(loop ? ((v % f) + f) % f : v); };
// Moves a clip's left edge to t, its sound staying where it was in the film (lanes.ts trims a bed's head with it too)
export const cutBefore = (x: Bed | OneShot, list: ClipRef["list"], t: number) => {
  if (list === "beds") { const b = x as Bed; b.start = into(b.start, t - b.from, b.name, true); b.from = r3(t); return; }
  const o = x as OneShot, d = t - o.at;
  o.start = into(o.start, d, o.name, false);
  if (o.length !== undefined) o.length = r3(o.length - d);
  o.at = r3(t);
};
const cutAfter = (x: Bed | OneShot, list: ClipRef["list"], t: number) => { if (list === "beds") (x as Bed).to = r3(t); else (x as OneShot).length = r3(t - (x as OneShot).at); };

export const splitClips = (cs: ClipRef[], t = S.t) => {
  const hit = crossing(cs, t, "split");
  if (!hit.length) return;
  const right: ClipRef[] = [];
  edit((l) => {
    for (const c of hit) {
      const list = c.list === "beds" ? l.beds : l.sfx, a = list[c.i], b = structuredClone(a);
      cutAfter(a, c.list, t); a.fadeOut = 0;
      cutBefore(b, c.list, t); if (c.list === "beds") (b as Bed).fadeIn = 0; else delete (b as OneShot).fadeIn;
      if (c.list === "sfx" && !(b as OneShot).fadeOut) delete (b as OneShot).fadeOut;
      (list as (Bed | OneShot)[]).push(b);
      right.push({ list: c.list, i: list.length - 1 });
    }
  });
  setClips(right);
  say(`${hit.length > 1 ? `${hit.length} clips` : clipOf(right[0])!.name} split at ${stamp(t)}. Ctrl+Z to undo`);
};
export const trimClips = (cs: ClipRef[], side: "left" | "right", t = S.t) => {
  const hit = crossing(cs, t, side === "left" ? "delete left of" : "delete right of");
  if (!hit.length) return;
  edit((l) => { for (const c of hit) { const x = c.list === "beds" ? l.beds[c.i] : l.sfx[c.i]; if (side === "left") cutBefore(x, c.list, t); else cutAfter(x, c.list, t); } });
  say(`${side === "left" ? "Start" : "End"} of ${hit.length > 1 ? `${hit.length} clips` : clipOf(hit[0])!.name} trimmed to ${stamp(t)}. Ctrl+Z to undo`);
};
// pan: -1 all left, 1 all right (mixer.ts, mix.py pan_filter); the centre is left out of the file
export const setField = (c: ClipRef, key: "gain" | "fadeIn" | "fadeOut" | "length" | "to" | "duck" | "pan", v: number) => edit((l) => {
  const x = (c.list === "beds" ? l.beds[c.i] : l.sfx[c.i]) as Record<string, unknown>;
  if (key === "pan" && Math.abs(v) < 0.005) delete x.pan; else x[key] = r3(v);
});
// CapCut's ↺ on the Basic section: level back to 0 dB, centred, no fades
export const resetBasic = (c: ClipRef) => edit((l) => {
  const x = (c.list === "beds" ? l.beds[c.i] : l.sfx[c.i]) as Record<string, unknown>;
  x.gain = 0; delete x.pan; delete x.fadeIn; delete x.fadeOut;
});
// Paste attributes (timeline/attributes.ts): what of the clip `from` the creator ticked, onto the clips `to`, one undo step.
// Fades longer than a clip are shortened to fit it, as CapCut does; ducking only goes from a bed onto beds. Locked tracks are
// left out. Returns how many clips took them
export type ClipAttr = "volume" | "pan" | "fades" | "duck";
export const fadesFit = (from: Bed | OneShot, c: ClipRef) => {
  const [a, b] = span(c), fi = (from.fadeIn ?? 0) as number, fo = (from.fadeOut ?? 0) as number, k = fi + fo > b - a ? (b - a) / (fi + fo) : 1;
  return { fadeIn: r3(fi * k), fadeOut: r3(fo * k), short: k < 1 };
};
export const pasteClipAttrs = (from: Bed | OneShot, to: ClipRef[], what: ClipAttr[]) => {
  const ok = to.filter((c) => clipOf(c) && !locked(c));
  if (!ok.length) return 0;
  edit((l) => {
    for (const c of ok) {
      const x = (c.list === "beds" ? l.beds[c.i] : l.sfx[c.i]) as Record<string, unknown>;
      if (what.includes("volume")) x.gain = from.gain;
      if (what.includes("pan")) { if (from.pan) x.pan = from.pan; else delete x.pan; }
      if (what.includes("fades")) {
        const f = fadesFit(from, c);
        for (const k of ["fadeIn", "fadeOut"] as const) { if (c.list === "sfx" && !f[k]) delete x[k]; else x[k] = f[k]; }
      }
      if (what.includes("duck") && c.list === "beds") { if (from.duck) x.duck = from.duck; else delete x.duck; }
    }
  });
  return ok.length;
};
export const swapSound = (c: ClipRef, name: string) => edit((l) => {
  const x = c.list === "beds" ? l.beds[c.i] : l.sfx[c.i];
  x.name = name;
  if (c.list === "sfx") delete (x as OneShot).start; // a start offset belongs to the old file
});

// Level curves come once per file and stay
const peaks = new Map<string, Peaks | null>();
export const peaksOf = (name: string) => {
  if (!peaks.has(name)) {
    peaks.set(name, null);
    getFile(`/api/sfx/${encodeURIComponent(name)}/peaks`).then((r) => (r.ok ? r.json() : null)).then((p) => { if (p) { peaks.set(name, p); S.dirty = true; } });
  }
  return peaks.get(name) ?? null;
};

// One sound heard on its own, from the library: a second press stops it
const audition = new Audio();
let auditioning = "";
export const listen = (name: string) => {
  if (auditioning === name && !audition.paused) { audition.pause(); auditioning = ""; return; }
  auditioning = name;
  audition.src = `/api/sfx/${encodeURIComponent(name)}.wav`;
  audition.play().catch(() => {});
};
export const listening = () => (audition.paused ? "" : auditioning);
audition.addEventListener("ended", () => { auditioning = ""; set({ soundRev: get().soundRev + 1 }); });
audition.addEventListener("play", () => set({ soundRev: get().soundRev + 1 }));
audition.addEventListener("pause", () => set({ soundRev: get().soundRev + 1 }));
