// One pick across the timeline's rows, as CapCut's box over all its tracks (the dev's call): camera keys, keys on the key rows and
// sound clips picked together by the box (rowbox.ts, which each row starts on its empty space), then moved together by a drag on
// any of them (each row's drag takes alongWith for the other kinds), deleted and copied together (cut.ts, clipboard.ts), each
// as one undo step (core/doc.ts together). A pick of one kind goes through that kind's own setter, which also opens its tab
import * as cam from "../camera/cam";
import { DURATION } from "film/scene";
import * as keys from "../keys/keys";
import { type KeyRef } from "../keys/slice";
import * as sound from "../sound/sound";
import { type ClipRef } from "../sound/slice";
import { resolve, same } from "../sound/tracks";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { r3 } from "../core/time";
import { boxPick, type ClientRect } from "./rowbox";

export interface Across { cam: number[]; keys: KeyRef[]; clips: ClipRef[] }
export type Kind = keyof Across;
const KINDS: readonly Kind[] = ["cam", "keys", "clips"];
const NONE: Across = { cam: [], keys: [], clips: [] };

export const picked = (): Across => { const s = get(); return { cam: s.camPicks.length ? s.camPicks : s.camKey !== null ? [s.camKey] : [], keys: s.keyPicks, clips: s.clips }; };
export const count = (p: Across) => p.cam.length + p.keys.length + p.clips.length;

export const pickAcross = (p: Across) => {
  const c = [...new Set(p.cam)].filter(cam.movable).sort((a, b) => a - b), n = KINDS.filter((k) => (k === "cam" ? c : p[k]).length).length;
  if (n === 0) set({ camKey: null, camPicks: [], keyPicks: [], clips: [], clip: null });
  else if (n === 1) { if (p.clips.length) sound.setClips(p.clips); else if (p.keys.length) keys.pickKeys(p.keys); else cam.pickCamKeys(c); }
  else set({ camPicks: c.length > 1 ? c : [], camKey: c.length === 1 ? c[0] : null, keyPicks: p.keys, clips: p.clips, clip: null, shotPick: null, object: null });
  S.dirty = true;
};

// What each row's things the box covers, in the page's coordinates: set by the rows as they attach (camrow, keyrows, lanes)
export const inBox: { [K in Kind]: (r: ClientRect) => Across[K] } = { cam: () => [], keys: () => [], clips: () => [] };
export const attachAcross = () => {
  boxPick.picked = picked;
  boxPick.pick = (r, base) => {
    const b = base as Across, cs = inBox.cam(r), ks = inBox.keys(r), ls = inBox.clips(r);
    pickAcross({
      cam: [...b.cam.filter((k) => !cs.includes(k)), ...cs],
      keys: [...b.keys.filter((p) => !ks.some((q) => keys.sameKey(p, q))), ...ks],
      clips: [...b.clips.filter((p) => !ls.some((q) => same(p, q))), ...ls],
    });
  };
  boxPick.none = () => NONE;
  boxPick.done = () => { const n = count(picked()); if (n > 1) say(`${n} selected. Drag one to move them all`); };
};

// ---------- Moving the other kinds' picks with a drag on one kind's: how far each may go, drawn while dragging, kept on release
interface Mover { room: [number, number]; snap: unknown; restore: (s: unknown) => void; preview: (d: number) => void; commit: (d: number) => void }
const shiftKeys = (d: number) => (r: KeyRef, ks: keys.Key[]) => { ks[r.i].t = r3(ks[r.i].t + d); };
const shiftClips = (refs: ClipRef[], d: number) => (l: sound.Lanes) => {
  for (const r of refs) { const e = l[r.list][r.i] as { from?: number; to?: number; at?: number }; if (r.list === "beds") { e.from = r3(e.from! + d); e.to = r3(e.to! + d); } else e.at = r3(e.at! + d); }
  resolve(l, refs, sound.span);
};
const MOVERS: { [K in Kind]: (refs: Across[K]) => Mover } = {
  cam: (is) => ({ room: cam.groupRoom(is), snap: cam.snapshot(), restore: (s) => cam.restore(s as string), preview: (d) => cam.shiftCamKeys(is, d, cam.preview), commit: (d) => cam.shiftCamKeys(is, d) }),
  keys: (refs) => ({ room: keys.room(refs), snap: keys.snapshot(), restore: (s) => keys.restore(s as string[]), preview: (d) => keys.preview(refs, shiftKeys(d)), commit: (d) => keys.editKeys(refs, shiftKeys(d)) }),
  clips: (refs) => {
    const starts = refs.map((r) => sound.span(r)[0]);
    return { room: [-Math.min(...starts), DURATION - 0.05 - Math.max(...starts)], snap: sound.snapshot(), restore: (s) => sound.restore(s as string), preview: (d) => sound.preview(shiftClips(refs, d)), commit: (d) => sound.edit(shiftClips(refs, d)) };
  },
};
export type Along = { room: [number, number]; count: number; preview: (d: number) => void; restore: () => void; commit: (d: number) => void };
// The picks of the kinds other than this one, when the thing pressed is picked along with them; null when nothing else is
export const alongWith = (kind: Kind): Along | null => {
  const p = picked(), clips = p.clips.filter((c) => !sound.locked(c));
  const ms = KINDS.filter((k) => k !== kind && (k === "clips" ? clips : p[k]).length).map((k) => (k === "cam" ? MOVERS.cam(p.cam.filter(cam.movable)) : k === "keys" ? MOVERS.keys(p.keys) : MOVERS.clips(clips)));
  if (!ms.length) return null;
  const restore = () => ms.forEach((m) => m.restore(m.snap));
  return {
    room: ms.reduce<[number, number]>(([lo, hi], m) => [Math.max(lo, m.room[0]), Math.min(hi, m.room[1])], [-Infinity, Infinity]),
    count: p.keys.length + clips.length + p.cam.length - (kind === "cam" ? p.cam.length : kind === "keys" ? p.keys.length : clips.length),
    preview: (d) => { restore(); for (const m of ms) m.preview(d); },
    restore,
    commit: (d) => { for (const m of ms) m.commit(d); },
  };
};
