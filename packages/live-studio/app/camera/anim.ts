// A shot's In, Out and Combo (CapCut's Animation tab, for a 3D camera), kept on the shot in shots.json as "anim" {in, out,
// combo}, each {fx, len?, k?}, and drawn by the film (film-stage/animate.ts) on top of its camera keys: None takes one off and
// its length stays a number. The effects listed are the film's own (draw.anims). Each change is one undo step (shotsDoc);
// trying one on (hover) is a preview the picture plays without sound, put back when the pointer leaves.
import type { AnimFx } from "film/scene";
import { DURATION, SHOTS_OUT } from "film/scene";
import { shotIndex } from "../core/film";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { seek, setPlaying } from "../playback/transport";
import { keys } from "./cam";
import { type ShotRow, shotsDoc } from "./shots";

export type Slot = "in" | "out" | "combo";
export interface AnimSet { fx: string; len?: number; k?: number }
export type ShotAnim = Partial<Record<Slot, AnimSet>>;

export const SLOT_NAMES: Record<Slot, string> = { in: "In", out: "Out", combo: "Combo" };
export const anims = () => S.render?.anims ?? null;
export const fxOf = (slot: Slot, id: string | undefined): AnimFx | undefined => (id ? anims()?.[slot].find((x) => x.id === id) : undefined);
export const shotSpan = (i: number): [number, number] => [SHOTS_OUT[i]?.t ?? 0, SHOTS_OUT[i + 1]?.t ?? DURATION];
export const animOf = (i: number): ShotAnim => (shotsDoc.data?.[i]?.anim as ShotAnim | undefined) ?? {};
// The shot the Camera and Animation tabs show: the block picked on the camera row, else the picked key's, else the playhead's
export const shownShot = () => {
  const { shotPick: s, camKey: k } = get();
  return s !== null && SHOTS_OUT[s] ? s : shotIndex(k !== null && keys[k] ? keys[k].t : S.t);
};
// A shot block clicked on the camera row: its details show, in the Animation tab if that is open, else the Camera tab
export const pickShot = (i: number | null) => {
  const side = get().side;
  set(i === null ? { shotPick: null } : { shotPick: i, camKey: null, camPicks: [], side: side === "anim" || side === "adjust" ? side : "cam", clips: [], clip: null, keyPicks: [], textPicks: [], layerPicks: [], object: null });
  S.dirty = true;
};

const MIN = 0.1;
// The longest an In or Out may run: the shot, less what the other end already takes
export const roomFor = (i: number, slot: "in" | "out") => {
  const [a, b] = shotSpan(i), other = animOf(i)[slot === "in" ? "out" : "in"];
  const otherLen = other ? (other.len ?? fxOf(slot === "in" ? "out" : "in", other.fx)?.len ?? 0) : 0;
  return Math.max(MIN, Math.round((b - a - otherLen) * 100) / 100);
};
export const lenOf = (i: number, slot: "in" | "out") => { const a = animOf(i)[slot]; return a ? Math.min(a.len ?? fxOf(slot, a.fx)?.len ?? 0.5, roomFor(i, slot)) : 0; };

const put = (d: ShotRow[], i: number, slot: Slot, v: AnimSet | null) => {
  const a: ShotAnim = { ...(d[i].anim as ShotAnim | undefined) };
  if (v) a[slot] = v; else delete a[slot];
  if (Object.keys(a).length) d[i].anim = a; else delete d[i].anim;
};
// What picking an effect stores: an In or Out with the effect's own length, cut to the room the shot has
const fresh = (i: number, slot: Slot, id: string): AnimSet => {
  if (slot === "combo") { const k = animOf(i).combo?.k; return k && k !== 1 ? { fx: id, k } : { fx: id }; }
  const len = animOf(i)[slot]?.len ?? fxOf(slot, id)?.len ?? 0.5;
  return { fx: id, len: Math.min(len, roomFor(i, slot)) };
};
export const setAnim = (i: number, slot: Slot, id: string | null) => {
  shotsDoc.edit((d) => put(d, i, slot, id ? fresh(i, slot, id) : null));
  say(id ? `${SLOT_NAMES[slot]}: ${fxOf(slot, id)?.title ?? id} on shot ${i}. Ctrl+Z to undo` : `${SLOT_NAMES[slot]} taken off shot ${i}`);
};
export const previewAnim = (i: number, slot: Slot, id: string | null) => shotsDoc.preview((d) => put(d, i, slot, id ? fresh(i, slot, id) : null));
// len for an In or Out, k (strength) for a Combo
export const setAmount = (i: number, slot: Slot, v: number, keep = true) => {
  const cur = animOf(i)[slot];
  if (!cur) return;
  const next = slot === "combo" ? { ...cur, k: Math.round(v * 100) / 100 } : { ...cur, len: Math.round(Math.max(MIN, Math.min(roomFor(i, slot), v)) * 100) / 100 };
  if (keep) shotsDoc.edit((d) => put(d, i, slot, next));
  else shotsDoc.preview((d) => put(d, i, slot, next));
};
// Paste attributes (timeline/attributes.ts): a shot's In and Out ("anim", CapCut's Animation) and its Combo, as `from` has them
// (none takes one off), onto shot i, one undo step. An In and Out that don't fit the shot are shortened together, as CapCut
// shortens an animation to fit a short clip; short says so
export const animFit = (i: number, from: ShotAnim) => {
  const [a, b] = shotSpan(i), lens = (["in", "out"] as const).map((s) => (from[s] ? from[s].len ?? fxOf(s, from[s].fx)?.len ?? 0.5 : 0));
  const k = lens[0] + lens[1] > b - a - MIN ? Math.max(0, b - a - MIN) / (lens[0] + lens[1]) : 1, fit = (v: number) => Math.max(MIN, Math.round(v * k * 100) / 100);
  return { in: from.in && { ...from.in, len: fit(lens[0]) }, out: from.out && { ...from.out, len: fit(lens[1]) }, short: k < 1 };
};
export const pasteAnims = (i: number, from: ShotAnim, what: ("anim" | "combo")[]) => {
  const f = animFit(i, from);
  shotsDoc.edit((d) => {
    if (what.includes("anim")) { put(d, i, "in", f.in ?? null); put(d, i, "out", f.out ?? null); }
    if (what.includes("combo")) put(d, i, "combo", from.combo ? structuredClone(from.combo) : null);
  });
};
export const clearAnims = (i: number) => { shotsDoc.edit((d) => { delete d[i].anim; }); say(`Shot ${i} has no animation now. Ctrl+Z to undo`); };

// The seconds that show an effect: an In from the shot's start to a little after it lands, an Out from a little before it into
// the cut, a Combo the whole shot
export const spanOf = (i: number, slot: Slot): [number, number] => {
  const [a, b] = shotSpan(i), last = b - 1 / 30;
  if (slot === "in") return [a, Math.min(last, a + lenOf(i, "in") + 0.6)];
  if (slot === "out") return [Math.max(a, b - lenOf(i, "out") - 0.8), last];
  return [a, last];
};

// The picture plays a stretch on its own, without sound (an effect tried on), then the playhead goes back where it was. Pressing
// play or seeking meanwhile ends it there
let run = 0, home: number | null = null, expect = -1;
export const playSpan = (a: number, b: number, loop = false) => {
  run++;
  if (S.playing) setPlaying(false);
  home ??= S.t;
  const id = run, t0 = performance.now(), rate = Math.max(1, (b - a) / 4); // a long Combo plays faster, in about 4 s
  const step = () => {
    if (id !== run) return;
    if (S.playing || (expect >= 0 && Math.abs(S.t - expect) > 0.05)) { run++; home = null; expect = -1; return; }
    let t = a + ((performance.now() - t0) / 1000) * rate;
    if (t >= b) { if (!loop) { stopSpan(); return; } t = a + ((t - a) % Math.max(0.01, b - a)); }
    seek(t);
    expect = S.t;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
export const stopSpan = () => {
  run++;
  expect = -1;
  if (home !== null) { seek(home); home = null; }
};
