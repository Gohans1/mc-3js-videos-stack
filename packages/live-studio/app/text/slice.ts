import type { SaveState } from "../core/doc";

export interface TextSlice {
  text: boolean;
  textPicks: number[];
  textSaved: SaveState;
  textRev: number;
  textSlot: "in" | "out";
}
export const textSlice: TextSlice = {
  text: false,
  textPicks: [],
  textSaved: null,
  textRev: 0,
  textSlot: "in",
};
