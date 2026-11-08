// The text tracks' part of the page state (core/store.ts): CapCut's Text and Shapes over the picture
export interface TextSlice {
  text: boolean; // the film names its text file (package.json "live-studio".textTimeline): the Text row, library and tab show
  textPicks: number[]; // the items picked on the Text row or the picture, by their place in the file's items
  textSaved: "busy" | "fail" | null;
  textRev: number;
  textSlot: "in" | "out"; // the Animation tab's open part
}
export const textSlice: TextSlice = { text: false, textPicks: [], textSaved: null, textRev: 0, textSlot: "in" };
