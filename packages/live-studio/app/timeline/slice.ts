import type { LinkageSettings } from "../../src/linkage.mjs";
// The timeline's part of the page state (core/store.ts)
import { stored } from "../core/storage";

export interface TimelineSlice {
  selection: string[]; // what the block clicked on the timeline says (a sentence, an action), for the Settings sheet
  magnet: boolean; // drags on the timeline snap to the playhead, words, cuts and edges (Shift skips it for one drag; core/prefs.ts)
  linkage: boolean;
  linkageKinds: LinkageSettings;
  mainMagnet: boolean;
  previewAxis: boolean; // CapCut's preview axis: the picture shows the frame under the mouse on the timeline (peek.ts)
  previewAudio: boolean; // and plays the sound there, CapCut's "video and audio" preview (peek.ts)
  blade: boolean; // CapCut's split mode (B): a click on the timeline cuts there (blade.ts)
  inOut: [number, number] | null; // CapCut's In and Out points: the stretch a note written inside it is about (inout.ts)
  span: number; // seconds the timeline shows, the whole film (Infinity) until zoomed in; kept for this tab (timeline.ts zoomTo)
}
export const timelineSlice: Omit<
  TimelineSlice,
  "magnet" | "linkage" | "linkageKinds" | "mainMagnet" | "previewAxis" | "previewAudio"
> = {
  selection: [],
  blade: false,
  inOut: null,
  span: Number(stored.get("span", sessionStorage)) || Infinity,
};
