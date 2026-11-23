import type { SaveState } from "../core/doc";
import type { ContinuityAxis } from "./shots";

export type CameraAimPick = {
  field: "l";
  target?: "free";
  id?: string;
  t: number;
  source?: number;
  sourceRow?: number;
  cut?: boolean;
};
export type ContinuityPick = {
  field: "axis";
  target: "continuity";
  id?: string;
  t: number;
  first?: ContinuityAxis[0];
};
export type OpticsFocusPick = {
  field: "focus";
  target: "optics-focus";
  id?: string;
  t: number;
  time: number;
};
export type CameraPick = CameraAimPick | ContinuityPick | OpticsFocusPick;
export interface CameraSlice {
  cameraPick: CameraPick | null;
  timing: boolean;
  timingRev: number;
  timingSaved: SaveState;
  freezePick: number | null;
  layers: boolean;
  layersRev: number;
  layerPicks: string[];
  layersSaved: SaveState;
  cam: boolean;
  camKey: number | null;
  camPicks: number[];
  shotPick: number | null;
  shotPicks: number[];
  animSlot: "in" | "out" | "combo";
  camSaved: SaveState;
  camRev: number;
  shots: boolean;
  shotsSaved: SaveState;
  shotsRev: number;
}
export const cameraSlice: CameraSlice = {
  cameraPick: null,
  timing: false,
  timingRev: 0,
  timingSaved: null,
  freezePick: null,
  layers: false,
  layersRev: 0,
  layerPicks: [],
  layersSaved: null,
  cam: false,
  camKey: null,
  camPicks: [],
  shotPick: null,
  shotPicks: [],
  animSlot: "in",
  camSaved: null,
  camRev: 0,
  shots: false,
  shotsSaved: null,
  shotsRev: 0,
};
