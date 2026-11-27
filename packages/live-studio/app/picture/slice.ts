import type { FocusTargetSpec } from "film-stage/camera";

import type { Ratio } from "../../src/frame.ts";
import type { CameraKeyIdentity } from "../camera/cam";
import type { FreeView } from "../core/engine";
import type { FilmViewSize } from "../core/prefs";
import type {
  CompareVideoAudioMode,
  CompareVideoItem,
  CompareVideoMeta,
} from "./compare-video-model";
import type { GuideMode, ValueCheckMode } from "./director-eye";
import { initialPreview, type PreviewOptions } from "./preview-model";

export type PreviewStill = { url: string; t: number };
export type SnapshotState =
  | { status: "none" }
  | { status: "captured"; still: PreviewStill; comparing: boolean };
export type PinnedAngle = PreviewStill & { view: FreeView | null };
export type FreeTouched = Partial<
  Record<"roll" | "wave" | "bob" | "fstop" | "focus" | "handheld", boolean>
>;

export type CompareCatalogState =
  | {
      status: "loading";
      videos: CompareVideoItem[];
      canBuild: { ref: string | null; ours: string | null };
    }
  | {
      status: "ready";
      videos: CompareVideoItem[];
      canBuild: { ref: string | null; ours: string | null };
    }
  | {
      status: "error";
      videos: CompareVideoItem[];
      canBuild: { ref: string | null; ours: string | null };
      error: string;
    };

export type CompareVideoState =
  | { status: "none" }
  | { status: "loading"; path: string; meta: CompareVideoMeta | null }
  | { status: "ready"; path: string; meta: CompareVideoMeta | null }
  | { status: "error"; path: string; error: string };

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
  snapshot: SnapshotState;
  compareVideoMode: boolean;
  compareCatalog: CompareCatalogState;
  compareVideo: CompareVideoState;
  compareVideoAudio: CompareVideoAudioMode;
  compareReferenceAudioStatus: { src: string; state: "ready" | "silent" | "unavailable" } | null;
  compareLatestNotice: string | null;
}

export const compareVideoPathOf = (s: Pick<PictureSlice, "compareVideo">): string | null =>
  s.compareVideo.status === "none" ? null : s.compareVideo.path;
export const compareVideoMetaOf = (
  s: Pick<PictureSlice, "compareVideo">,
): CompareVideoMeta | null =>
  s.compareVideo.status === "loading" || s.compareVideo.status === "ready"
    ? s.compareVideo.meta
    : null;
export const compareVideoReadyOf = (s: Pick<PictureSlice, "compareVideo">): boolean =>
  s.compareVideo.status === "ready";
export const compareVideoErrorOf = (s: Pick<PictureSlice, "compareVideo">): string | null =>
  s.compareVideo.status === "error" ? s.compareVideo.error : null;
export const compareCatalogErrorOf = (s: Pick<PictureSlice, "compareCatalog">): string | null =>
  s.compareCatalog.status === "error" ? s.compareCatalog.error : null;
export const compareVideosLoadedOf = (s: Pick<PictureSlice, "compareCatalog">): boolean =>
  s.compareCatalog.status === "ready";

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
  | "compareVideoAudio"
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
  snapshot: { status: "none" },
  compareVideoMode: false,
  compareCatalog: { status: "loading", videos: [], canBuild: { ref: null, ours: null } },
  compareVideo: { status: "none" },
  compareReferenceAudioStatus: null,
  compareLatestNotice: null,
};
