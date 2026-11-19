// The picture's part of the page state (core/store.ts). Fields kept between visits come from core/prefs.ts
import type { Ratio } from "../../src/frame.ts";
import type { FilmViewSize } from "../core/prefs";
import type { GuideMode, ValueCheckMode } from "./director-eye";

export interface PictureSlice {
  ratio: Ratio; // the film's frame shape (frame.ts), from its package.json
  captions: boolean;
  guides: boolean; // framing guides over the picture (Guides.tsx)
  guideMode: GuideMode;
  guideSafe: boolean;
  valueCheck: ValueCheckMode; // viewport luminance check only, never touches film grade
  ghost: boolean; // cut-boundary onion skin overlay (GhostOverlay.tsx)
  ghostOpacity: number;
  blindAudio: boolean; // audio-only listening curtain over Stage
  colorScript: boolean; // horizontal shot/palette/pacing strip (ColorScript.tsx)
  free: boolean;
  freeFov: number;
  freeRoll: number;
  freeWave: number;
  flySpeed: number; // the free camera's, blocks a second (flight.ts)
  nightVision: boolean; // the free camera's view lit up to find the way (nightvision.ts)
  scopes: boolean; // CapCut's Color oscilloscope under the picture (Oscilloscope.tsx, scopes.ts)
  filmView: FilmViewSize; // the film camera's corner picture beside the free camera (filmcam.ts): visible preset or off
  filmViewWidth: number | null; // user-dragged pixel width of Film camera PiP; null keeps compact small default
  final: boolean;
  pickFocus: number | null; // active keyframe index waiting for a click-on-stage focus pick
  still: { url: string; t: number } | null; // the snapshot to compare against (snapshot.ts)
  comparing: boolean; // the snapshot shows over the picture while \ is held
}
export const pictureSlice: Omit<
  PictureSlice,
  | "captions"
  | "guides"
  | "guideMode"
  | "guideSafe"
  | "ghostOpacity"
  | "flySpeed"
  | "nightVision"
  | "filmView"
  | "filmViewWidth"
  | "scopes"
> = {
  ratio: "16:9",
  valueCheck: "off",
  ghost: false,
  blindAudio: false,
  colorScript: false,
  free: false,
  freeFov: 60,
  freeRoll: 0,
  freeWave: 0,
  final: false,
  pickFocus: null,
  still: null,
  comparing: false,
};
