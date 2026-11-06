// @ts-nocheck
// The film's props with looks to choose between in the studio (mc-assets/variants.ts builds them)
import { DESK } from "./world";

export const VARIANTS = [
  {
    id: "computer", title: "computer", pos: [DESK.x, 1, DESK.z], properties: { facing: "east" },
    // the keyboard is each look's `${id}_keys` model, hung on a pivot at its middle (world) so it can be knocked askew
    // (src/timeline/props.json keyboard, applied in src/scene.ts through the variant's `loose`). It is built one mesh per cube
    // (userData.element), so each key can go down on its own as he types
    loose: { suffix: "_keys", pivot: [DESK.x + 0.8125, 1.03, DESK.z + 0.5] },
    options: [
      { id: "computer", title: "gray office CRT" },
      { id: "computer_beige", title: "beige 90s CRT" },
      { id: "computer_black", title: "black workstation" },
      { id: "computer_steel", title: "steel terminal" },
    ],
  },
];
