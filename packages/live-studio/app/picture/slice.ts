// The picture's part of the page state (core/store.ts). Fields kept between visits come from core/prefs.ts
import type { Ratio } from "../../src/frame.ts";
import type { FilmViewSize } from "../core/prefs";
import { initialPreview, type PreviewOptions } from "./preview-model";

export type PreviewStill = { url: string; t: number };

export interface PictureSlice {
  ratio: Ratio; // the film's frame shape (frame.ts), from its package.json
  captions: boolean;
  guides: boolean; // thirds and safe areas over the picture (Guides.tsx)
  freeLook: boolean;
  freeLocked: boolean;
  freeNavigation: "fly" | "walk";
  cameraPath: boolean;
  free: boolean;
  flySpeed: number; // the free camera's, blocks a second (flight.ts)
  nightVision: boolean; // the free camera's view lit up to find the way (nightvision.ts)
  scopes: boolean; // CapCut's Color oscilloscope under the picture (Oscilloscope.tsx, scopes.ts)
  filmView: FilmViewSize; // the film camera's corner picture beside the free camera (filmcam.ts): its size, or off
  preview: PreviewOptions;
  pinnedAngles: (PreviewStill | null)[];
  compareGrid: boolean;
  shotList: boolean;
  final: boolean;
  still: PreviewStill | null; // the snapshot to compare against (snapshot.ts)
  comparing: boolean; // the snapshot shows over the picture while \ is held
}
export const pictureSlice: Omit<
  PictureSlice,
  "captions" | "guides" | "flySpeed" | "nightVision" | "filmView" | "scopes" | "freeLook"
> = {
  ratio: "16:9",
  free: false,
  freeLocked: false,
  freeNavigation: "fly",
  cameraPath: true,
  preview: initialPreview,
  pinnedAngles: [null, null, null, null],
  compareGrid: false,
  shotList: false,
  final: false,
  still: null,
  comparing: false,
};
