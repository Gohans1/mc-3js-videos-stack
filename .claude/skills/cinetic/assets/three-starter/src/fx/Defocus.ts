import { DEFOCUS_SHARP, type DefocusCopy, defocusMix } from "../lib/defocus";
import { type FilmCtx, fpsOf, sizeOf, uOf, useFilm } from "../lib/film";
import type { Declares } from "../timeline";

/**
 * Defocus and speed smear as static copies (lib/defocus): the layer is drawn at one or two FIXED blur levels and
 * the two are cross-faded by opacity, so no blur radius ever animates.
 *
 *   Defocus   an even softening of `sigma` px (at 1080p): a hidden cut's jump frame, a layer stepping back in a
 *             stack, a punch-in clearing.
 *   DirBlur   a smear along the motion only, from the layer's speed: sigma = speed (px/s) x DIR_BLUR.seconds,
 *             the smear a 180-degree shutter leaves at 30 fps (sigma 0.15 x px per 30 fps frame).
 */

/** House numbers: the smear in seconds of travel (sigma = px/s x seconds), the speed under which nothing smears. */
export const DIR_BLUR = { seconds: 0.0048, minPxS: 120, whipShutter: 360 } as const;

/** The copies that draw a smear of a layer moving `v` px per film frame (signed; px at 1080p). Pure. */
export const dirBlurMix = (
  v: number,
  film?: Partial<FilmCtx>,
  o: { seconds?: number; minPxS?: number; shutter?: number } = {},
): DefocusCopy[] => {
  const fps = fpsOf(film);
  const pxS = Math.abs(v) * fps;
  if (pxS < (o.minPxS ?? DIR_BLUR.minPxS)) return [{ level: 0, weight: 1 }];
  const sigma =
    o.shutter !== undefined
      ? (Math.abs(v) * o.shutter) / 360 / Math.sqrt(12)
      : pxS * (o.seconds ?? DIR_BLUR.seconds);
  return sigma < DEFOCUS_SHARP ? [{ level: 0, weight: 1 }] : defocusMix(sigma);
};

/** An even defocus of `sigma` px at 1080p (scaled with the frame), computed as at most two fixed levels. */
export const Defocus = ({
  sigma,
  children,
  film: filmIn,
}: {
  sigma: number;
  children?: unknown;
  film?: Partial<FilmCtx>;
}) => {
  const film = useFilm(filmIn);
  const s = sigma * uOf(film);
  const copies = s < DEFOCUS_SHARP ? [{ level: 0, weight: 1 }] : defocusMix(s);
  return { sigma: s, sharp: s < DEFOCUS_SHARP, copies, children };
};

/**
 * Directional smear along `axis` or `angle` for a layer moving `v` px per film frame at 1080p.
 */
export const DirBlur = ({
  v,
  axis = "y",
  angle,
  id = "dirblur",
  seconds,
  shutter,
  children,
  film: filmIn,
}: {
  v: number;
  axis?: "x" | "y";
  angle?: number;
  id?: string;
  seconds?: number;
  shutter?: number;
  children?: unknown;
  film?: Partial<FilmCtx>;
}) => {
  const film = useFilm(filmIn);
  const copies = dirBlurMix(v, film, { seconds, shutter }).map((c) => ({
    ...c,
    level: c.level * uOf(film),
  }));
  const { width, height } = sizeOf(film);
  return {
    id: id.replace(/[^a-zA-Z0-9_-]/g, ""),
    axis: angle === undefined ? axis : "x",
    angle,
    diagonal: Math.ceil(Math.hypot(width, height)),
    sharp: copies.length === 1 && copies[0].level === 0,
    copies,
    children,
  };
};

/**
 * Rotational smear for a layer spinning `omega` degrees per film frame about (cx, cy) px.
 */
export const SPIN_BLUR = { shutter: 180, stepDeg: 6, max: 10 } as const;
export const spinBlurCopies = (
  omega: number,
  o: { shutter?: number; stepDeg?: number; max?: number } = {},
) => {
  const sweep = Math.abs(omega) * ((o.shutter ?? SPIN_BLUR.shutter) / 360);
  if (Math.abs(omega) < 1) return [0];
  const n = Math.max(
    2,
    Math.min(o.max ?? SPIN_BLUR.max, Math.ceil(sweep / (o.stepDeg ?? SPIN_BLUR.stepDeg)) + 1),
  );
  return Array.from({ length: n }, (_, k) => -Math.sign(omega) * sweep * (k / (n - 1)));
};

export const SpinBlur = ({
  omega,
  cx,
  cy,
  shutter,
  children,
}: {
  omega: number;
  cx: number;
  cy: number;
  shutter?: number;
  children?: unknown;
}) => {
  const angles = spinBlurCopies(omega, { shutter });
  return {
    cx,
    cy,
    sharp: angles.length === 1,
    copies: angles.map((deg, k) => ({ deg, opacity: 1 / (k + 1) })),
    children,
  };
};

/** Defocus and DirBlur are continuous: nothing to declare. */
export const declares = (_props?: unknown, _film?: Partial<FilmCtx>): Declares => ({
  stepped: [],
  flashes: [],
  cameraBlur: [],
  seams: [],
});
