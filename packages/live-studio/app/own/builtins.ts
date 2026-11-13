// The studio's own libraries, what a film's effects are told apart from (the Film tab and the "Film" mark on the pickers)
import { ANIMS } from "film-stage/animate";
import { EASES } from "film-stage/camera";
import {
  SHAPE_IN,
  SHAPE_OUT,
  TEXT_IN,
  TEXT_ITEM_KEYS,
  TEXT_OUT,
  TITLE_EASES,
} from "film-stage/titles";
import { TRANSITIONS } from "film-stage/transitions";
import { VELOCITY_EFFECTS } from "film-stage/velocity";

import {
  ADJUSTMENT_KEYS,
  CAM_KEYS,
  SHOT_KEYS,
  SHOT_SLOT_KEYS,
  SOUND_KEYS,
  TEXT_KEYS,
  TEXT_SLOT_KEYS,
} from "../../src/contract.ts";
import { type Builtins, isOwnEase, isOwnFx, isOwnVelocity } from "./own-work";

export const BUILTINS = {
  transitions: TRANSITIONS,
  anims: ANIMS,
  voices: { text: { in: TEXT_IN, out: TEXT_OUT }, shape: { in: SHAPE_IN, out: SHAPE_OUT } },
  eases: EASES,
  velocityEffects: VELOCITY_EFFECTS,
  textEases: TITLE_EASES,
  // __timing: what src/timing-data.mjs keeps on a row while the page runs (its time before a freeze moved it), never saved
  rowKeys: {
    // size, what: the template's framing words for a shot
    Shot: [...SHOT_KEYS, ...SHOT_SLOT_KEYS, "size", "what", "__timing"],
    "Camera key": [...CAM_KEYS, "__timing"],
    Text: [...TEXT_KEYS, ...TEXT_ITEM_KEYS, ...TEXT_SLOT_KEYS, "__timing"],
    Sound: [...SOUND_KEYS.beds, ...SOUND_KEYS.sfx, "__timing"],
    Adjustment: [...ADJUSTMENT_KEYS, "__timing"],
  },
} as unknown as Builtins;

type Fx = { id: string };
export const ownTransition = (fx: Fx) => isOwnFx(fx, BUILTINS.transitions);
export const ownAnim = (slot: "in" | "out" | "combo", fx: Fx) => isOwnFx(fx, BUILTINS.anims[slot]);
export const ownVoice = (shape: boolean, slot: "in" | "out", fx: Fx) =>
  isOwnFx(fx, BUILTINS.voices[shape ? "shape" : "text"][slot]);
export const ownEase = (id: string, eases?: Record<string, unknown>) =>
  isOwnEase(id, BUILTINS.eases, eases);
export const ownVelocity = (fx: string | Fx) => isOwnVelocity(fx, BUILTINS.velocityEffects);
export { THIS_FILM, withFilmChip } from "./own-work";
