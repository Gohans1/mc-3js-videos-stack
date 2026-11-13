// The studio's own libraries, what a film's effects are told apart from (the Film tab and the "Film" mark on the pickers)
import { ANIMS } from "film-stage/animate";
import { EASES } from "film-stage/camera";
import { SHAPE_IN, SHAPE_OUT, TEXT_IN, TEXT_OUT, TITLE_EASES } from "film-stage/titles";
import { TRANSITIONS } from "film-stage/transitions";
import { VELOCITY_EFFECTS } from "film-stage/velocity";

import { type Builtins, isOwnFx } from "./own-work";

export const BUILTINS = {
  transitions: TRANSITIONS,
  anims: ANIMS,
  voices: { text: { in: TEXT_IN, out: TEXT_OUT }, shape: { in: SHAPE_IN, out: SHAPE_OUT } },
  eases: EASES,
  velocityEffects: VELOCITY_EFFECTS,
  textEases: TITLE_EASES,
} as unknown as Builtins;

type Fx = { id: string };
export const ownTransition = (fx: Fx) => isOwnFx(fx, BUILTINS.transitions);
export const ownAnim = (slot: "in" | "out" | "combo", fx: Fx) => isOwnFx(fx, BUILTINS.anims[slot]);
export const ownVoice = (shape: boolean, slot: "in" | "out", fx: Fx) =>
  isOwnFx(fx, BUILTINS.voices[shape ? "shape" : "text"][slot]);
