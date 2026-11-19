// The picture's part of the page state (core/store.ts). Fields kept between visits come from core/prefs.ts
import type { FocusTargetSpec } from "film-stage/camera";

import type { Ratio } from "../../src/frame.ts";
import type { FilmViewSize } from "../core/prefs";
import type { GuideMode, ValueCheckMode } from "./director-eye";
import { initialPreview, type PreviewOptions } from "./preview-model";

export type PreviewStill = { url: string; t: number };
export type FreeTouched = Partial<
  Record<"roll" | "wave" | "bob" | "fstop" | "focus" | "handheld", boolean>
>;

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
  freeLook: boolean;
  freeLocked: boolean;
  freeNavigation: "fly" | "walk";
  cameraPath: boolean;
  free: boolean;
  freeFov: number;
  freeRoll: number;
  freeWave: number;
  freeBob: number;
  freeFstop: number;
  freeFocus: FocusTargetSpec | undefined;
  freeHandheld: unknown;
  freeTouched: FreeTouched;
  freePoseRev: number;
  freeHistoryRev: number;
  flySpeed: number; // the free camera's, blocks a second (flight.ts)
  nightVision: boolean; // the free camera's view lit up to find the way (nightvision.ts)
  scopes: boolean; // CapCut's Color oscilloscope under the picture (Oscilloscope.tsx, scopes.ts)
  filmView: FilmViewSize; // the film camera's corner picture beside the free camera (filmcam.ts): its size, split, or off
  filmViewWidth: number | null; // user-dragged pixel width of Film camera PiP; null keeps compact small default
  preview: PreviewOptions;
  pinnedAngles: (PreviewStill | null)[];
  compareGrid: boolean;
  shotList: boolean;
  final: boolean;
  pickFocus: { id?: string; t: number } | "free" | null; // active keyframe target or "free" waiting for click-on-stage focus pick
  still: PreviewStill | null; // the snapshot to compare against (snapshot.ts)
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
  | "freeLook"
> = {
  ratio: "16:9",
  valueCheck: "off",
  ghost: false,
  blindAudio: false,
  colorScript: false,
  free: false,
  freeLocked: false,
  freeNavigation: "fly",
  cameraPath: true,
  freeFov: 60,
  freeRoll: 0,
  freeWave: 0,
  freeBob: 0,
  freeFstop: 0,
  freeFocus: undefined,
  freeHandheld: false,
  freeTouched: {},
  freePoseRev: 0,
  freeHistoryRev: 0,
  preview: initialPreview,
  pinnedAngles: [null, null, null, null],
  compareGrid: false,
  shotList: false,
  final: false,
  pickFocus: null,
  still: null,
  comparing: false,
};
