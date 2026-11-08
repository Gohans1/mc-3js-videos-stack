// The picture's part of the page state (core/store.ts). Fields kept between visits come from core/prefs.ts
import type { Ratio } from "../../src/frame.mjs";
import type { FilmViewSize } from "../core/prefs";

export interface PictureSlice {
  ratio: Ratio; // the film's frame shape (frame.ts), from its package.json
  captions: boolean;
  guides: boolean; // thirds and safe areas over the picture (Guides.tsx)
  free: boolean;
  flySpeed: number; // the free camera's, blocks a second (flight.ts)
  nightVision: boolean; // the free camera's view lit up to find the way (nightvision.ts)
  scopes: boolean; // CapCut's Color oscilloscope under the picture (Oscilloscope.tsx, scopes.ts)
  filmView: FilmViewSize; // the film camera's corner picture beside the free camera (filmcam.ts): its size, or off
  final: boolean;
  still: { url: string; t: number } | null; // the snapshot to compare against (snapshot.ts)
  comparing: boolean; // the snapshot shows over the picture while \ is held
}
export const pictureSlice: Omit<PictureSlice, "captions" | "guides" | "flySpeed" | "nightVision" | "filmView" | "scopes"> = { ratio: "16:9", free: false, final: false, still: null, comparing: false };
