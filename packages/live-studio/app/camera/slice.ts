// The camera keys' and shots' part of the page state (core/store.ts)
export interface CameraSlice {
  layers: boolean; layersRev: number; layerPicks: string[]; layersSaved: "busy" | "fail" | null;
  cam: boolean; // the film names its camera keys (package.json "live-studio".camTimeline): the camera row and tab show
  camKey: number | null; // the key picked on the camera row, by its place in the file
  camPicks: number[]; // several keys picked at once (two or more; camKey is null then)
  shotPick: number | null; // the shot block picked on the camera row (its place in SHOTS_OUT), the Animation tab's shot
  animSlot: "in" | "out" | "combo"; // the Animation tab's open part
  camSaved: "busy" | "fail" | null;
  camRev: number;
  shots: boolean; // the film keeps its shots as data (package.json "live-studio".shotsTimeline): a cut can be moved
  shotsSaved: "busy" | "fail" | null;
  shotsRev: number;
}
export const cameraSlice: CameraSlice = { layers: false, layersRev: 0, layerPicks: [], layersSaved: null, cam: false, camKey: null, camPicks: [], shotPick: null, animSlot: "in", camSaved: null, camRev: 0, shots: false, shotsSaved: null, shotsRev: 0 };
