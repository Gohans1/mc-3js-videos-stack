// Ctrl+C, Ctrl+X and Ctrl+V on the timeline, as CapCut's for clips and After Effects' for keyframes: what is picked (text, sound
// clips, camera keys, keys on the key rows, or all of them from a box across the rows) is copied with its times kept apart as they were,
// and pasted with the earliest at the playhead, back onto the tracks and rows it came from (sound.ts pasteClips, cam.ts
// pasteCamKeys, keys.ts pasteKeys, text.ts pasteTexts), one undo step. The copy lives in this page only, as CapCut's does in its project.
import type { AdjustmentLayer } from "film-stage/grade-layers";
import { layerItems, pasteLayers, pickLayers } from "../camera/layers";
import { type CamKey, keys as camKeys, movable, pasteCamKeys } from "../camera/cam";
import { together } from "../core/doc";
import { type CopiedKey, keyOf, pasteKeys } from "../keys/keys";
import { clipOf, type CopiedClip, pasteClips, span } from "../sound/sound";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { stamp } from "../core/time";
import { items as textItems, pasteTexts, pickText, type TextItem } from "../text/text";
import { type Across, count, NONE, pickAcross, picked } from "./across";
import { deleteSelected } from "./cut";

type Copied = { layers: AdjustmentLayer[]; text: TextItem[]; clips: CopiedClip[]; cam: CamKey[]; keys: CopiedKey[]; t0: number };
let copied: Copied | null = null;

export const canCopy = () => { const s = get(); return s.layerPicks.length > 0 || s.textPicks.length > 0 || s.clips.length > 0 || s.camPicks.length > 0 || s.camKey !== null || s.keyPicks.length > 0; };
export const hasCopy = () => copied !== null;

const NOUN = { layers: "adjustment layer", text: "text item", clips: "clip", cam: "camera keyframe", keys: "key" } as const;
const told = (c: Record<"layers" | "text" | "clips" | "cam" | "keys", readonly unknown[]>) => {
  const kinds = (["layers", "text", "clips", "cam", "keys"] as const).filter((k) => c[k].length), n = kinds.reduce((s, k) => s + c[k].length, 0);
  return kinds.length === 1 ? `${n} ${NOUN[kinds[0]]}${n > 1 ? "s" : ""}` : `${n} things`;
};
export const copy = () => {
  const s = get(), p = picked(), cam = p.cam.filter(movable);
  const clips = s.clips.flatMap((c) => { const x = clipOf(c); return x ? [{ list: c.list, x: structuredClone(x) }] : []; });
  const keys = s.keyPicks.map((r) => ({ f: r.f, path: r.path, k: structuredClone(keyOf(r)) })), text = s.textPicks.map((i) => structuredClone(textItems[i]));
  const layers = layerItems().filter((it) => s.layerPicks.includes(it.id)).map((it) => structuredClone(it));
  if (!layers.length && !clips.length && !cam.length && !keys.length && !text.length) { say(p.cam.length ? "A cut can't be copied: pick keyframes inside a shot" : "Pick clips or keyframes on the timeline to copy them"); return false; }
  const t0 = Math.min(...layers.map((it) => it.from), ...s.clips.map((c) => span(c)[0]), ...cam.map((i) => camKeys[i].t), ...keys.map((x) => x.k.t), ...text.map((x) => x.from));
  copied = { layers, text, clips, cam: cam.map((i) => structuredClone(camKeys[i])), keys, t0 };
  say(`${told(copied)} copied. Ctrl+V pastes at the playhead`);
  return true;
};
export const cut = () => { if (copy()) deleteSelected(); };
// Each kind's paste picks what it pasted and drops the rest of the pick: what they each picked is gathered and picked together
export const paste = () => {
  if (!copied) { say("Nothing copied yet: pick clips or keyframes and press Ctrl+C"); return; }
  const c = copied, d = S.t - c.t0, got: Across = structuredClone(NONE), kinds = [c.layers, c.text, c.clips, c.cam, c.keys].filter((x) => x.length).length;
  if (kinds === 1) { if (c.layers.length) pickLayers(pasteLayers(c.layers, d)); else if (c.text.length) pickText(pasteTexts(c.text, d)); else if (c.clips.length) pasteClips(c.clips, d); else if (c.cam.length) pasteCamKeys(c.cam, d); else pasteKeys(c.keys, d); return; }
  pickAcross(got);
  together(() => {
    if (c.layers.length) got.layers = pasteLayers(c.layers, d);
    if (c.text.length) got.text = pasteTexts(c.text, d);
    if (c.clips.length) { pasteClips(c.clips, d); got.clips = get().clips; }
    if (c.cam.length) { pasteCamKeys(c.cam, d); got.cam = picked().cam; }
    if (c.keys.length) { pasteKeys(c.keys, d); got.keys = get().keyPicks; }
  });
  pickAcross(got);
  if (count(got)) say(`${told(got)} pasted at ${stamp(S.t)}`);
};
