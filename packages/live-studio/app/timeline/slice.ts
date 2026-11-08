// The timeline's part of the page state (core/store.ts)
export interface TimelineSlice {
  selection: string[]; // what the block clicked on the timeline says (a sentence, an action), for the Settings sheet
  magnet: boolean; // drags on the timeline snap to the playhead, words, cuts and edges (Shift skips it for one drag; core/prefs.ts)
  previewAxis: boolean; // CapCut's preview axis: the picture shows the frame under the mouse on the timeline (peek.ts)
  blade: boolean; // CapCut's split mode (B): a click on the timeline cuts there (blade.ts)
  pasteAsk: boolean; // the "Paste attributes?" box is open (attributes.ts, PasteAttributes.tsx); the studio's keys wait meanwhile
  inOut: [number, number] | null; // CapCut's In and Out points: the stretch a note written inside it is about (inout.ts)
}
export const timelineSlice: Omit<TimelineSlice, "magnet" | "previewAxis"> = { selection: [], blade: false, pasteAsk: false, inOut: null };
