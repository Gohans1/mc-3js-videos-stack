// Ctrl+C, Ctrl+X and Ctrl+V on the timeline, as CapCut's for clips and After Effects' for keyframes: what is picked (sound clips,
// camera keys, keys on the key rows) is copied with its times kept apart as they were, and pasted with the earliest at the
// playhead, back onto the tracks and rows it came from (sound.ts pasteClips, cam.ts pasteCamKeys, keys.ts pasteKeys). The copy
// lives in this page only, as CapCut's does in its project.
import { type CamKey, keys as camKeys, movable, pasteCamKeys } from "../camera/cam";
import { type CopiedKey, keyOf, pasteKeys } from "../keys/keys";
import { clipOf, type CopiedClip, pasteClips, span } from "../sound/sound";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { deleteSelected } from "./cut";

type Copied = { what: "clips"; items: CopiedClip[]; t0: number } | { what: "cam"; items: CamKey[]; t0: number } | { what: "keys"; items: CopiedKey[]; t0: number };
let copied: Copied | null = null;

export const canCopy = () => { const s = get(); return s.clips.length > 0 || s.camPicks.length > 0 || s.camKey !== null || s.keyPicks.length > 0; };
export const hasCopy = () => copied !== null;

export const copy = () => {
  const s = get();
  if (s.clips.length) {
    const items = s.clips.flatMap((c) => { const x = clipOf(c); return x ? [{ list: c.list, x: structuredClone(x) }] : []; });
    copied = { what: "clips", items, t0: Math.min(...s.clips.map((c) => span(c)[0])) };
  } else if (s.camPicks.length || s.camKey !== null) {
    const is = (s.camPicks.length ? s.camPicks : [s.camKey!]).filter(movable);
    if (!is.length) { say("A cut can't be copied: pick keyframes inside a shot"); return false; }
    copied = { what: "cam", items: is.map((i) => structuredClone(camKeys[i])), t0: Math.min(...is.map((i) => camKeys[i].t)) };
  } else if (s.keyPicks.length) {
    const items = s.keyPicks.map((r) => ({ f: r.f, path: r.path, k: structuredClone(keyOf(r)) }));
    copied = { what: "keys", items, t0: Math.min(...items.map((x) => x.k.t)) };
  } else { say("Pick clips or keyframes on the timeline to copy them"); return false; }
  const n = copied.items.length, noun = copied.what === "clips" ? "clip" : copied.what === "cam" ? "camera keyframe" : "key";
  say(`${n} ${noun}${n > 1 ? "s" : ""} copied. Ctrl+V pastes at the playhead`);
  return true;
};
export const cut = () => { if (copy()) deleteSelected(); };
export const paste = () => {
  if (!copied) { say("Nothing copied yet: pick clips or keyframes and press Ctrl+C"); return; }
  const d = S.t - copied.t0;
  if (copied.what === "clips") pasteClips(copied.items, d);
  else if (copied.what === "cam") pasteCamKeys(copied.items, d);
  else pasteKeys(copied.items, d);
};
