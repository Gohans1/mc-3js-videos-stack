// How a span between two keys spends its time, as the film draws it (the later key's ease): a named ease the film shares with
// draw (draw.eases, film-stage's EASES) or a CSS cubic-bezier [x1, y1, x2, y2], which the studio works out itself with
// bezier-easing, the library film-stage uses, so the tiles and the camera row show what the film plays
import BezierEasing from "bezier-easing";
import { S } from "./state";

export type Bezier = [number, number, number, number];
export type Ease = string | Bezier;

const beziers = new Map<string, (x: number) => number>();
// fallback: what a key without an ease gets in the film that plays it (the camera's "smooth", an object's "inout")
export const easeFn = (e: Ease | undefined, fallback: string): ((x: number) => number) | null => {
  if (Array.isArray(e)) { const k = e.join(); if (!beziers.has(k)) beziers.set(k, BezierEasing(...e)); return beziers.get(k)!; }
  return S.render?.eases?.[e ?? fallback] ?? null;
};
export const easeNames = () => Object.keys(S.render?.eases ?? {});
// film-stage's eases by the names CapCut's keyframe Preset curves give the same shapes (Ease In: a slow start, Ease Out: a slow
// stop, Ease: both); a film's own extra ones go by their name
const TITLES: Record<string, string> = { smooth: "Smooth", linear: "Linear", out: "Ease Out", in: "Ease In", inout: "Ease", expo: "Expo In" };
export const easeTitle = (e: Ease | undefined, fallback: string) => (Array.isArray(e) ? `Custom curve (${e.join(", ")})` : TITLES[e ?? fallback] ?? e ?? fallback);
