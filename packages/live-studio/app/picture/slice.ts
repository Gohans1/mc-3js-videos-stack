import type { FocusTargetSpec } from "film-stage/camera";

import type { Ratio } from "../../src/frame.ts";
import type { CameraKeyIdentity } from "../camera/cam";
import type { FreeView } from "../core/engine";
import type { FilmViewSize } from "../core/prefs";
import type { GuideMode, ValueCheckMode } from "./director-eye";
import { initialPreview, type PreviewOptions } from "./preview-model";

export type PreviewStill = { url: string; t: number };
export type PinnedAngle = PreviewStill & { view: FreeView | null };
export type FreeTouched = Partial<
  Record<"roll" | "wave" | "bob" | "fstop" | "focus" | "handheld", boolean>
>;

export interface PictureSlice {
  ratio: Ratio;
  captions: boolean;
  guides: boolean;
  guideMode: GuideMode;
  guideSafe: boolean;
  valueCheck: ValueCheckMode;
  ghost: boolean;
  ghostOpacity: number;
  blindAudio: boolean;
  colorScript: boolean;
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
  flySpeed: number;
  nightVision: boolean;
  scopes: boolean;
  filmView: FilmViewSize;
  filmViewWidth: number | null;
  preview: PreviewOptions;
  pinnedAngles: (PinnedAngle | null)[];
  compareGrid: boolean;
  shotList: boolean;
  final: boolean;
  pickFocus: CameraKeyIdentity | "free" | null;
  still: PreviewStill | null;
  comparing: boolean;
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
