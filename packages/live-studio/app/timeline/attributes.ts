// CapCut's Copy attributes and Paste attributes (Ctrl+Alt+C, Ctrl+Alt+V, or a clip's right-click menu): the settings of ONE
// picked thing, not the thing, put onto the picked things of its kind once the "Paste attributes?" box (PasteAttributes.tsx)
// says which: a sound clip's volume, pan, fades and ducking (sound.ts pasteClipAttrs), a shot's Animation and Combo animation
// (anim.ts pasteAnims), a camera keyframe's lens and speed (cam.ts pasteKeyAttrs). One undo step each. The words follow CapCut
// 9.7's own (its Resources/po/en.po, pc_copy_*): one source only, same kind only, and fades or animations too long for a clip
// shortened to fit it
import { SHOTS_OUT } from "film/scene";
import { type AnimSet, animFit, animOf, fxOf, pasteAnims, type ShotAnim, type Slot } from "../camera/anim";
import { type CamKey, DEFAULT_EASE, keys as camKeys, movable, pasteKeyAttrs } from "../camera/cam";
import { together } from "../core/doc";
import { easeTitle } from "../core/ease";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import type { ClipRef } from "../sound/slice";
import { type Bed, type ClipAttr, clipOf, fadesFit, locked, type OneShot, pasteClipAttrs } from "../sound/sound";

type Kind = "clip" | "shot" | "cam";
type Copied = { kind: "clip"; x: Bed | OneShot; bed: boolean } | { kind: "shot"; anim: ShotAnim } | { kind: "cam"; k: CamKey; speed: boolean };
type Target = { kind: "clip"; refs: ClipRef[] } | { kind: "shot"; is: number[] } | { kind: "cam"; is: number[] };
export interface Choice { id: string; title: string; value: string; warn?: string }

const NOUN: Record<Kind, string> = { clip: "sound clip", shot: "shot", cam: "camera keyframe" };
let copied: Copied | null = null;

// What is picked now, as a paste would take it
const target = (): Target | null => {
  const s = get();
  if (s.clips.length) return { kind: "clip", refs: s.clips };
  if (s.shotPick !== null && SHOTS_OUT[s.shotPick]) return { kind: "shot", is: [s.shotPick] };
  if (s.camPicks.length) return { kind: "cam", is: s.camPicks };
  if (s.camKey !== null) return { kind: "cam", is: [s.camKey] };
  return null;
};
const count = (t: Target) => (t.kind === "clip" ? t.refs.length : t.is.length);
const many = (n: number, noun: string) => `${n} ${noun}${n > 1 ? "s" : ""}`;

export const hasAttrs = () => copied !== null;
export const copyAttrs = () => {
  const t = target();
  if (!t) { say("Pick one sound clip, shot or camera keyframe to copy its attributes"); return; }
  if (count(t) > 1) { say(`Can't copy attributes of multiple ${NOUN[t.kind]}s: pick one`); return; }
  if (t.kind === "clip") copied = { kind: "clip", x: structuredClone(clipOf(t.refs[0])!), bed: t.refs[0].list === "beds" };
  else if (t.kind === "shot") {
    if (!get().shots) { say("This film keeps its shots in code: ask the AI in a note to change them"); return; }
    copied = { kind: "shot", anim: structuredClone(animOf(t.is[0])) };
  } else copied = { kind: "cam", k: structuredClone(camKeys[t.is[0]]), speed: movable(t.is[0]) };
  say(`Attributes copied. Pick ${NOUN[t.kind]}s and press Ctrl+Alt+V to paste them`);
};

// Opens the box when what is picked can take what was copied, else says why not
export const askPaste = () => {
  const t = target();
  if (!copied) { say("Nothing copied yet: pick one sound clip, shot or camera keyframe and press Ctrl+Alt+C"); return; }
  if (!t) { say(`Pick the ${NOUN[copied.kind]}s to paste onto`); return; }
  if (t.kind !== copied.kind) { say(`Can't paste attributes to a different type: these came from a ${NOUN[copied.kind]}`); return; }
  if (t.kind === "shot" && !get().shots) { say("This film keeps its shots in code: ask the AI in a note to change them"); return; }
  if (t.kind === "clip" && t.refs.every(locked)) { say("This track is locked. Unlock it in the track header to edit"); return; }
  set({ pasteAsk: true });
};

const dB = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`;
const animWords = (slot: Slot, a: AnimSet | undefined, len = true) => (a ? `${fxOf(slot, a.fx)?.title ?? a.fx}${len && a.len !== undefined ? ` ${a.len} s` : ""}` : "None");
// The box's lines: what the copy holds, each one a tick, with a warning where a paste will shorten it
export const choices = (): Choice[] => {
  const t = target();
  if (!copied || !t || t.kind !== copied.kind) return [];
  const n = count(t), they = n > 1 ? "Some of these are" : "This clip is";
  if (copied.kind === "clip" && t.kind === "clip") {
    const x = copied.x, pan = Math.round((x.pan ?? 0) * 100), short = t.refs.some((c) => clipOf(c) && fadesFit(x, c).short);
    const list: Choice[] = [
      { id: "volume", title: "Volume", value: dB(x.gain) },
      { id: "pan", title: "Pan", value: pan ? `${pan < 0 ? "Left" : "Right"} ${Math.abs(pan)}` : "Centre" },
      { id: "fades", title: "Fades", value: `In ${x.fadeIn ?? 0} s, out ${x.fadeOut ?? 0} s`, warn: short ? `${they} too short. The fade in/fade out duration will be shortened to fit the clip duration.` : undefined },
    ];
    if (copied.bed && t.refs.some((c) => c.list === "beds")) list.push({ id: "duck", title: "Ducking under the voice", value: x.duck ? `${x.duck} dB` : "None" });
    return list;
  }
  if (copied.kind === "shot" && t.kind === "shot") {
    const a = copied.anim, short = t.is.some((i) => animFit(i, a).short);
    return [
      { id: "anim", title: "Animation", value: `In: ${animWords("in", a.in)}. Out: ${animWords("out", a.out)}`, warn: short ? `${n > 1 ? "Some of these shots are" : "This shot is"} too short. The animation duration will be shortened to fit the clip duration.` : undefined },
      { id: "combo", title: "Combo animation", value: animWords("combo", a.combo, false) },
    ];
  }
  if (copied.kind === "cam" && t.kind === "cam") {
    const k = copied.k, roll = k.roll as number | undefined, starts = t.is.filter((i) => !movable(i)).length;
    const lens = [k.fov !== undefined ? `FOV ${k.fov}°` : "the film's FOV", roll ? `roll ${Math.round((roll * 1800) / Math.PI) / 10}°` : "no roll", k.wave !== undefined ? `sway ${k.wave}×` : "the film's sway"];
    const list: Choice[] = [{ id: "lens", title: "Lens", value: lens.join(", ") }];
    if (copied.speed) list.push({ id: "speed", title: "Speed", value: easeTitle(k.ease, DEFAULT_EASE), warn: starts ? `${starts > 1 ? `${starts} of these start` : "One of these starts"} a shot: nothing eases into it, so it takes the lens only.` : undefined });
    return list;
  }
  return [];
};
// Who the box pastes onto, in its own words
export const onto = () => {
  const t = target();
  if (!t) return "";
  if (t.kind === "shot") return `Onto shot ${t.is[0]}${S.comments[t.is[0]] ? ` · ${S.comments[t.is[0]]}` : ""}`;
  return `Onto ${many(count(t), NOUN[t.kind])}`;
};

export const pasteAttrs = (ids: string[]) => {
  set({ pasteAsk: false });
  const t = target();
  if (!copied || !t || t.kind !== copied.kind || !ids.length) return;
  let n = count(t), left = 0;
  if (copied.kind === "clip" && t.kind === "clip") {
    n = pasteClipAttrs(copied.x, t.refs, ids as ClipAttr[]);
    left = t.refs.length - n;
  } else if (copied.kind === "shot" && t.kind === "shot") {
    const a = copied.anim;
    together(() => { for (const i of t.is) pasteAnims(i, a, ids as ("anim" | "combo")[]); });
  } else if (copied.kind === "cam" && t.kind === "cam") pasteKeyAttrs(copied.k, t.is, ids as ("lens" | "speed")[]);
  if (!n) return;
  say(`Attributes pasted onto ${many(n, NOUN[t.kind])}${left ? `, ${left} on locked tracks left out` : ""}. Ctrl+Z to undo`);
};
