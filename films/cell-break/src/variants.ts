// @ts-nocheck
// The film's props with looks to choose between in the studio (mc-assets/variants.ts builds them)
import { DESK } from "./world";

export const VARIANTS = [
  {
    // on the desk against the north wall, its screen to the room (south); the keyboard is each look's `${id}_keys` model on
    // a pivot at its middle, in front of the screen
    id: "computer", title: "computer", pos: [DESK.crt, 1, DESK.z], properties: { facing: "south" },
    loose: { suffix: "_keys", pivot: [DESK.crt + 0.5, 1.03, DESK.z + 0.8125] },
    options: [
      { id: "computer_beige", title: "beige 90s CRT" },
      { id: "computer", title: "gray office CRT" },
      { id: "computer_black", title: "black workstation" },
      { id: "computer_steel", title: "steel terminal" },
    ],
  },
];
