// The cut (Ctrl+B and the timeline toolbar's scissors), as CapCut's: the picked sound clips if there are any, otherwise the
// shot at the playhead (cam.ts splitShot, for a film that keeps its shots as data). Ctrl+Shift+B cuts every track there
import { removeCamKeys, removeKey, splitShot } from "../camera/cam";
import { together } from "../core/doc";
import { removeKeys } from "../keys/keys";
import { removeObject } from "../objects/placed";
import { allClips, locked, removeClips, setClips, span, splitClips } from "../sound/sound";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { SAME } from "../core/time";

export const canSplit = () => get().clips.length > 0 || (get().cam && get().shots);
export const splitHere = () => {
  if (get().clips.length) splitClips(get().clips);
  else if (get().cam && get().shots) splitShot();
  else say("Pick a sound clip to split it at the playhead");
};
// Every unlocked sound clip the playhead is inside, and the shot, in one undo step
export const splitAll = () => {
  const hit = allClips().filter((c) => { const [a, b] = span(c); return !locked(c) && a + 0.05 < S.t && S.t < b - 0.05; });
  const shot = get().cam && get().shots;
  if (!hit.length && !shot) { say("Nothing to split at the playhead"); return; }
  together(() => { if (hit.length) splitClips(hit); if (shot) splitShot(); });
};
// CapCut's [ and ]: every sound clip left of the playhead (starting before it) or right of it (ending after it), locked ones aside
export const selectSide = (d: -1 | 1) => {
  const cs = allClips().filter((c) => { const [a, b] = span(c); return !locked(c) && (d < 0 ? a < S.t - SAME : b > S.t + SAME); });
  setClips(cs);
  say(cs.length ? `${cs.length} clip${cs.length > 1 ? "s" : ""} ${d < 0 ? "left" : "right"} of the playhead selected` : `No sound clips ${d < 0 ? "left" : "right"} of the playhead`);
};

// The toolbar's bin: whatever is picked, as Delete does (sound clips, camera keyframes, keys, a dropped-in object)
export const canDelete = () => { const s = get(); return s.clips.length > 0 || s.camKey !== null || s.camPicks.length > 0 || s.keyPicks.length > 0 || s.object !== null; };
export const deleteSelected = () => {
  const s = get();
  if (s.clips.length) removeClips(s.clips);
  else if (s.camKey !== null) removeKey(s.camKey);
  else if (s.camPicks.length) removeCamKeys(s.camPicks);
  else if (s.keyPicks.length) removeKeys(s.keyPicks);
  else if (s.object) removeObject(s.object);
};
