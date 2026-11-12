import { clamp } from "../lib/anim";
import { DEFOCUS_LEVELS, type DefocusCopy, defocusLevel, defocusMix } from "../lib/defocus";
import { type FilmCtx, useFilm } from "../lib/film";
import type { Declares } from "../timeline";

/**
 * The copies a rack draws at progress t (0 sharp, 1 at `blur` px): with ladder levels, at most two
 * copies at FIXED blur radii from lib/defocus (the first at full opacity, the second on top at its
 * weight), so no radius ever animates. `levels` true takes the house ladder.
 */
export const rackState = (
  t: number,
  blur: number,
  levels: boolean | readonly number[] = true,
): DefocusCopy[] =>
  defocusMix(
    clamp(t) * Math.max(0, blur),
    levels === true || levels === false ? DEFOCUS_LEVELS : levels,
  );

/**
 * Rack focus descriptor: computes fixed-radius defocus ladder copies so blur never animates continuously per layer.
 */
export const RackFocus = ({
  t,
  blur,
  mid = false,
  overscan = 80,
  levels,
  heroBlur = 0,
  film: filmIn,
}: {
  t: number;
  blur: number;
  mid?: boolean;
  overscan?: number;
  levels?: boolean | readonly number[];
  heroBlur?: number;
  film?: Partial<FilmCtx>;
}) => {
  const { width, height } = useFilm(filmIn);
  const tc = Math.min(1, Math.max(0, t));
  const copies: DefocusCopy[] =
    levels !== undefined && levels !== false
      ? rackState(tc, blur, levels)
      : [
          ...(tc < 0.999 ? [{ level: 0, weight: 1 }] : []),
          ...(mid && tc > 0.001 && tc < 0.999 ? [{ level: blur * 0.35, weight: Math.sin(Math.PI * tc) }] : []),
          ...(tc > 0.001 ? [{ level: blur, weight: Math.min(1, tc * 1.8) }] : []),
        ];
  return {
    width,
    height,
    overscan,
    copies,
    heroBlur: defocusLevel(tc * heroBlur),
  };
};

/** What a RackFocus instance does on purpose (steps, flashes, camera blur, seams): nothing; a rack is continuous. */
export const declares = (_props?: unknown, _film?: Partial<FilmCtx>): Declares => ({
  stepped: [],
  flashes: [],
  cameraBlur: [],
  seams: [],
});
