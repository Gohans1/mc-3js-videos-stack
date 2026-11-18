import type { CameraOptics } from "./animate-meta";

export const VELOCITY_EFFECTS = [
  "flash",
  "hitPunch",
  "blurShake",
  "shutterStreak",
  "fadeBlur",
  "retroZoom",
  "fringeBeat",
  "rainbow",
] as const;
// What each built-in effect does on a beat, as the shader below draws it (the studio's picker, bun run find)
export const VELOCITY_LOOKS: Record<
  (typeof VELOCITY_EFFECTS)[number],
  { title: string; tip: string }
> = {
  flash: {
    title: "Flash",
    tip: "Each beat flashes the frame brighter with a contrast kick, then fades back",
  },
  hitPunch: {
    title: "Hit punch",
    tip: "Each beat punches in about 9% with a crisp contrast lift, fast in and easing back: hits on the kick drum",
  },
  blurShake: {
    title: "Blur shake",
    tip: "Each beat shakes the frame with a jittery blurred jolt that dies out",
  },
  shutterStreak: {
    title: "Shutter streak",
    tip: "Each beat smears the frame in a horizontal motion streak that fades",
  },
  fadeBlur: {
    title: "Fade blur",
    tip: "Each beat swells a soft blur and darkens the frame, then clears: a dreamy pulse",
  },
  retroZoom: {
    title: "Retro zoom",
    tip: "Each beat jumps the frame in about 16% and lets it fall back while red and blue split apart",
  },
  fringeBeat: {
    title: "Edge fringe",
    tip: "Each beat splits red and blue apart toward the frame's edges, the centre stays clean",
  },
  rainbow: {
    title: "Rainbow",
    tip: "Each beat swings red and blue copies of the frame around in a circle: a psychedelic colour wobble",
  },
};
export type VelocityEffect = (typeof VELOCITY_EFFECTS)[number] | (string & {});
export type VelocityFrame = {
  effect: VelocityEffect;
  amount: number;
  phase: number;
  beatIndex?: number;
};
export type CustomVelocityHandler = (
  frame: VelocityFrame,
  baseOptics?: CameraOptics | null,
) => Partial<CameraOptics> | void;
