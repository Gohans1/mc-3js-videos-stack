// The stage camera's context and the planes under it: split out so
// fx/Grounds can hold a ground still on screen under a declared move without importing the stage. Named apart from
// the fx/depth folder (the 3D stage): on a case-blind disk a file fx/FloatDepth.ts avoids colliding with `../fx/depth`.
import { bleedFor, type FloatOpts, type FloatState, planeOf } from "../lib/drift";
import { type FilmCtx, useFilm } from "../lib/film";

export type FloatCtxT = { s: FloatState; o: FloatOpts; bleed: number } | null;

export const FloatCtx = {
  current: null as FloatCtxT,
  run<R>(value: FloatCtxT, fn: () => R): R {
    const prev = FloatCtx.current;
    FloatCtx.current = value;
    try {
      return fn();
    } finally {
      FloatCtx.current = prev;
    }
  },
};

/** The stage camera the current subtree sits on (null outside a Float). */
export const useFloat = (): FloatCtxT => FloatCtx.current;

export const T = (x: number, y: number, k: number) => ({ x, y, scale: k });

/**
 * A plane at depth z under the stage camera (lib/drift DRIFT.depth): while a declared move runs, z < 1 lags (the
 * ground 0.25, a back layer 0.6), z > 1 leads (a near plane 1.35); on a still camera every plane is still.
 */
export const Depth = ({
  z,
  bleed = false,
  children,
  film: filmIn,
}: {
  z: number;
  bleed?: boolean;
  children?: unknown;
  film?: Partial<FilmCtx>;
}) => {
  const film = useFilm(filmIn);
  const ctx = useFloat();
  if (!ctx) return { x: 0, y: 0, k: 1, bleed: 1, pose: T(0, 0, 1), width: film.width, height: film.height, children };
  const p = planeOf(ctx.s, z);
  const b = bleed ? bleedFor(ctx.o, film, z) : 1;
  return {
    x: p.x,
    y: p.y,
    k: p.k * b,
    bleed: b,
    pose: T(p.x, p.y, p.k * b),
    width: film.width,
    height: film.height,
    children,
  };
};
