import { removeCamKeys, removeKey, splitShot } from "../camera/cam";
// The cut (Ctrl+B and the timeline toolbar's scissors), as CapCut's: the picked sound clips if there are any, otherwise the
// shot at the playhead (cam.ts splitShot, for a film that keeps its shots as data). Ctrl+Shift+B cuts every track there
import { layerItems, removeLayers, splitLayers, trimLayers } from "../camera/layers";
import { setTransition, transitionOf } from "../camera/transitions";
import { together } from "../core/doc";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { SAME } from "../core/time";
import { removeKeys } from "../keys/keys";
import { removeObject } from "../objects/placed";
import {
  allClips,
  locked,
  removeClips,
  setClips,
  span,
  splitClips,
  trimClips,
} from "../sound/sound";
import { items as textItems, removeTexts, splitTexts, trimTexts } from "../text/text";
import { removeFreeze, removeShotsTime, removeShotTime } from "./timing";

export const canSplit = () =>
  get().layerPicks.length > 0 ||
  get().textPicks.length > 0 ||
  get().clips.length > 0 ||
  (get().cam && get().shots);
export const splitHere = () => {
  const { layerPicks, textPicks, clips } = get();
  if (layerPicks.length || textPicks.length || clips.length)
    together(() => {
      if (layerPicks.length) splitLayers(layerPicks);
      if (textPicks.length) splitTexts(textPicks);
      if (clips.length) splitClips(clips);
    });
  else if (get().cam && get().shots) splitShot();
  else say("Pick a sound clip to split it at the playhead");
};
// Every unlocked sound clip the playhead is inside, and the shot, in one undo step
export const splitAll = () => {
  const hit = allClips().filter((c) => {
    const [a, b] = span(c);
    return !locked(c) && a + 0.05 < S.t && S.t < b - 0.05;
  });
  const shot = get().cam && get().shots;
  if (!hit.length && !shot) {
    say("Nothing to split at the playhead");
    return;
  }
  together(() => {
    splitLayers(layerItems().map((it) => it.id));
    splitTexts(textItems.map((_, i) => i));
    if (hit.length) splitClips(hit);
    if (shot) splitShot();
  });
};
// CapCut's [ and ]: every sound clip left of the playhead (starting before it) or right of it (ending after it), locked ones aside
export const selectSide = (d: -1 | 1) => {
  const cs = allClips().filter((c) => {
    const [a, b] = span(c);
    return !locked(c) && (d < 0 ? a < S.t - SAME : b > S.t + SAME);
  });
  setClips(cs);
  say(
    cs.length
      ? `${cs.length} clip${cs.length > 1 ? "s" : ""} ${d < 0 ? "left" : "right"} of the playhead selected`
      : `No sound clips ${d < 0 ? "left" : "right"} of the playhead`,
  );
};

// Delete and the toolbar's bin: whatever is picked, every kind of it in one undo step (text, sound clips, camera keyframes, keys;
// a pick may hold them all, timeline/across.ts), or else the dropped-in object picked
export const canDelete = () => {
  const s = get();
  return (
    s.freezePick !== null ||
    s.layerPicks.length > 0 ||
    s.textPicks.length > 0 ||
    s.clips.length > 0 ||
    s.camKey !== null ||
    s.camPicks.length > 0 ||
    s.keyPicks.length > 0 ||
    s.object !== null ||
    (s.timing && (s.shotPick !== null || s.shotPicks.length > 0)) ||
    (s.side === "transition" && s.shotPick !== null && !!transitionOf(s.shotPick))
  );
};
export const deleteSelected = () => {
  if (get().freezePick !== null) {
    removeFreeze(get().freezePick!);
    return;
  }
  const {
    layerPicks,
    clips,
    camKey,
    camPicks,
    keyPicks,
    object,
    textPicks,
    side,
    shotPick,
    shotPicks,
  } = get();
  if (side === "transition" && shotPick !== null && transitionOf(shotPick)) {
    setTransition(shotPick, null);
    return;
  }
  if (get().timing && shotPick !== null) {
    removeShotTime(shotPick);
    return;
  }
  if (
    !shotPicks.length &&
    !layerPicks.length &&
    !clips.length &&
    camKey === null &&
    !camPicks.length &&
    !keyPicks.length &&
    !textPicks.length
  ) {
    if (object) removeObject(object);
    return;
  }
  together(() => {
    if (layerPicks.length) removeLayers(layerPicks);
    if (clips.length) removeClips(clips);
    if (!get().timing || !shotPicks.length) {
      if (camKey !== null) removeKey(camKey);
      else if (camPicks.length) removeCamKeys(camPicks);
    }
    if (keyPicks.length) removeKeys(keyPicks);
    if (textPicks.length) removeTexts(textPicks);
    if (get().timing && shotPicks.length) removeShotsTime(shotPicks);
  });
};

export const trimSelected = (side: "left" | "right") =>
  together(() => {
    const s = get();
    if (s.timing && s.shotPick !== null) {
      removeShotTime(s.shotPick, side);
      return;
    }
    if (s.layerPicks.length) trimLayers(s.layerPicks, side);
    if (s.textPicks.length) trimTexts(s.textPicks, side);
    if (s.clips.length) trimClips(s.clips, side);
  });
