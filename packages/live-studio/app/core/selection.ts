// Explicit cross-track selection state machine for StudioState (core/store.ts).
// Picking an item on one timeline row or in the 3D viewport clears every other track's stale picks in one place.
import type { GradeTarget } from "../camera/adjust";
import type { KeyRef } from "../keys/slice";
import type { ClipRef } from "../sound/slice";
import type { StudioState } from "./store";

export type Side = StudioState["side"];

export interface SelectionFields {
  freezePick: number | null;
  layerPicks: string[];
  camKey: number | null;
  camPicks: number[];
  shotPick: number | null;
  shotPicks: number[];
  clips: ClipRef[];
  clip: ClipRef | null;
  keyPicks: KeyRef[];
  textPicks: number[];
  object: string | null;
}

export type SelectionPatch = Partial<SelectionFields & { side: Side }>;

export type SelectionAction =
  | { kind: "none" }
  | { kind: "camKey"; index: number | null }
  | { kind: "camKeys"; indices: number[]; shots?: number[] }
  | { kind: "shot"; index: number | null; side?: Side }
  | { kind: "clearShots" }
  | { kind: "freeze"; index: number | null }
  | { kind: "layers"; ids: string[] }
  | { kind: "adjustTarget"; target: GradeTarget }
  | { kind: "clips"; clips: ClipRef[] }
  | { kind: "keys"; refs: KeyRef[]; ownObject: string | null }
  | { kind: "text"; indices: number[] }
  | { kind: "object"; name: string | null }
  | {
      kind: "across";
      layers: string[];
      text: number[];
      shots: number[];
      cam: number[];
      keys: KeyRef[];
      clips: ClipRef[];
    };

export const CLEAR_PICKS: SelectionFields = {
  freezePick: null,
  layerPicks: [],
  camKey: null,
  camPicks: [],
  shotPick: null,
  shotPicks: [],
  clips: [],
  clip: null,
  keyPicks: [],
  textPicks: [],
  object: null,
};

export const hasAnySelection = (s: SelectionFields): boolean =>
  s.freezePick !== null ||
  s.layerPicks.length > 0 ||
  s.camKey !== null ||
  s.camPicks.length > 0 ||
  s.shotPick !== null ||
  s.shotPicks.length > 0 ||
  s.clips.length > 0 ||
  s.clip !== null ||
  s.keyPicks.length > 0 ||
  s.textPicks.length > 0 ||
  s.object !== null;

export const transitionSelection = (action: SelectionAction, currentSide: Side): SelectionPatch => {
  switch (action.kind) {
    case "none":
      return currentSide === "transition" ? { ...CLEAR_PICKS, side: "cam" } : { ...CLEAR_PICKS };
    case "camKey":
      return action.index === null
        ? { camKey: null, camPicks: [] }
        : { ...CLEAR_PICKS, camKey: action.index, side: currentSide === "speed" ? "speed" : "cam" };
    case "camKeys":
      if (!action.indices.length && !action.shots?.length)
        return { camKey: null, camPicks: [], shotPicks: [] };
      return {
        ...CLEAR_PICKS,
        camKey: action.indices.length === 1 ? action.indices[0] : null,
        camPicks: action.indices.length > 1 ? action.indices : [],
        shotPicks: action.shots ?? [],
        side: currentSide === "speed" ? "speed" : "cam",
      };
    case "shot":
      return action.index === null
        ? {
            shotPick: null,
            shotPicks: [],
            ...(currentSide === "transition" ? { side: "cam" as const } : {}),
          }
        : {
            ...CLEAR_PICKS,
            shotPick: action.index,
            side:
              action.side ??
              (currentSide === "speed" || currentSide === "anim" || currentSide === "adjust"
                ? currentSide
                : "cam"),
          };
    case "clearShots":
      return {
        shotPick: null,
        shotPicks: [],
        camKey: null,
        camPicks: [],
        ...(currentSide === "transition" ? { side: "cam" as const } : {}),
      };
    case "freeze":
      return action.index === null
        ? { freezePick: null }
        : { ...CLEAR_PICKS, freezePick: action.index, side: "speed" };
    case "layers":
      return action.ids.length
        ? { ...CLEAR_PICKS, layerPicks: action.ids, side: "adjust" }
        : { layerPicks: [] };
    case "adjustTarget":
      return typeof action.target === "string"
        ? { ...CLEAR_PICKS, layerPicks: [action.target], side: "adjust" }
        : { ...CLEAR_PICKS, shotPick: action.target, side: "adjust" };
    case "clips":
      return action.clips.length
        ? {
            ...CLEAR_PICKS,
            clips: action.clips,
            clip: action.clips.length === 1 ? action.clips[0] : null,
            side:
              action.clips.length === 1 &&
              (currentSide === "voiceChanger" || currentSide === "audioSpeed")
                ? currentSide
                : "sound",
          }
        : { clips: [], clip: null };
    case "keys":
      return action.refs.length
        ? {
            ...CLEAR_PICKS,
            keyPicks: action.refs,
            object: action.ownObject,
            side: action.ownObject ? "objects" : "keys",
          }
        : { keyPicks: [], object: null };
    case "text":
      return action.indices.length
        ? {
            ...CLEAR_PICKS,
            textPicks: action.indices,
            side: currentSide === "textAnim" ? "textAnim" : "text",
          }
        : { textPicks: [] };
    case "object":
      return action.name !== null
        ? { ...CLEAR_PICKS, object: action.name, side: "objects" }
        : { object: null };
    case "across":
      return {
        ...CLEAR_PICKS,
        layerPicks: action.layers,
        textPicks: action.text,
        shotPicks: action.shots,
        camKey: action.cam.length === 1 ? action.cam[0] : null,
        camPicks: action.cam.length > 1 ? action.cam : [],
        keyPicks: action.keys,
        clips: action.clips,
        clip: action.clips.length === 1 ? action.clips[0] : null,
        ...(currentSide === "transition" ? { side: "cam" as const } : {}),
      };
  }
};

export const pruneShotSelection = (
  state: { shotPick: number | null; shotPicks: number[]; side: Side },
  shotCount: number,
): SelectionPatch => {
  const patch: SelectionPatch = {};
  const dropPick = state.shotPick !== null && (state.shotPick < 0 || state.shotPick >= shotCount);
  if (dropPick) patch.shotPick = null;
  const livePicks = state.shotPicks.filter((i) => i >= 0 && i < shotCount);
  if (livePicks.length !== state.shotPicks.length) patch.shotPicks = livePicks;
  if (state.side === "transition" && (dropPick || state.shotPick === null || state.shotPick <= 0)) {
    patch.side = "cam";
  }
  return patch;
};

export const pruneFreezeSelection = (
  freezePick: number | null,
  freezes: readonly { blank?: boolean }[],
): SelectionPatch =>
  freezePick !== null && (!freezes[freezePick] || freezes[freezePick].blank)
    ? { freezePick: null }
    : {};
