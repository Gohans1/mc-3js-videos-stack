// logo-3d: the film's mark as a solid 3D object on vanilla three.js. The shot opens on an extreme close-up of the
// extruded mark (bevelled edges, a lacquer, satin, metal or glass finish lit by the film's light stage), the camera
// turning across its face while a highlight travels over the bevels and the background parts melt into the lens's blur;
// then one move pulls back, turns the mark to face the camera and presses its depth flat onto the lockup plane.
import { type Logo, logoParts, SAMPLE_MARK_SVG } from "../../brand/Mark";
import { E, rand } from "../../lib/anim";
import { useFilm } from "../../lib/film";
import { type Finish, markSolid } from "./geo";
import type { GlMode } from "./gl";
import type { Light3D } from "./light";
import { type Backdrop, clamp01, deg, planeDistance, ramp, Stage3D } from "./stage";

export type { Finish } from "./geo";

export const LOGO3D = {
  dur: 96,
  scale: 7,
  yaw: -62,
  pitch: 17,
  roll: -8,
  focus: [-0.24, -0.2] as [number, number],
  depth: 28,
  bevel: 2.4,
  aperture: 0.022,
  sweep: 120,
  flatten: [0.6, 0.97] as [number, number],
  flat: [0.82, 1] as [number, number],
  fov: 40,
};

export const RECIPE = {
  id: "logo-3d",
  recipe:
    "The mark as a solid (28 deep in its 100 box, bevelled): an extreme close-up (7x the lockup, turned 62 deg and already turning, a corner of the mark filling the frame, the near edge sharp and the far ones soft) turns as a highlight line travels 120 deg over its bevels, then one strongInOut pull-back (96 f) turns it to face the camera, presses its depth flat (60-97 %) and settles its colour to the flat fill (82-100 %) on the lockup plane.",
  params: { ...LOGO3D },
};

export type Lockup = { x: number; y: number; size: number };

export type Logo3DProps = {
  lockup: Lockup;
  logo?: Logo;
  frame?: number;
  at?: number;
  dur?: number;
  finish?: Finish;
  depth?: number;
  bevel?: number;
  from?: Partial<{
    scale: number;
    yaw: number;
    pitch: number;
    roll: number;
    focus: [number, number];
  }>;
  light?: Light3D;
  backdrop?: Backdrop;
  samples?: number;
  gl?: GlMode;
  seed?: number | string;
};

/** The frame (in the part's own timeline) where the lockup settles. */
export const logo3DEnd = (at = 0, dur: number = LOGO3D.dur, fps = 60) => at + (dur * fps) / 60;

type PoseOpts = typeof LOGO3D & { mirror: number };

/** The move at progress p (0..1): screen scale, turn, how deep, how flat, the lens and the light stage's turn. */
export const logoPose = (p: number, o: PoseOpts = { ...LOGO3D, mirror: 1 }) => {
  const zoom = E.strongInOut(clamp01(p));
  const turn = E.settleOut(clamp01(p));
  const travel = E.strongInOut(clamp01(p));
  return {
    scale: Math.exp(Math.log(o.scale) * (1 - zoom)),
    travel,
    yaw: o.yaw * o.mirror * (1 - turn),
    pitch: o.pitch * (1 - turn),
    roll: o.roll * o.mirror * (1 - turn),
    depth: Math.max(0.002, 1 - ramp(p, o.flatten[0], o.flatten[1])),
    flat: ramp(p, o.flat[0], o.flat[1]),
    aperture: o.aperture * (1 - ramp(p, 0.15, 0.78)),
    sweep: o.sweep * o.mirror * (turn - 0.5),
  };
};

const DEFAULT_LOGO = (): Logo => logoParts(SAMPLE_MARK_SVG);

/** Build the 3D solid mark stage (vanilla three.js): poses the mark at any fractional frame t and renders via Stage3D. */
export const Logo3D = ({
  lockup,
  logo,
  frame = 0,
  at = 0,
  dur = LOGO3D.dur,
  finish = "gloss",
  depth = LOGO3D.depth,
  bevel = LOGO3D.bevel,
  from,
  light,
  backdrop,
  samples,
  seed,
}: Logo3DProps) => {
  const film = useFilm();
  const { fps, width: W, height: H } = film;
  const lg = logo ?? DEFAULT_LOGO();
  const mirror = seed === undefined ? 1 : rand(`logo-3d:${seed}`) < 0.5 ? -1 : 1;
  const o: PoseOpts = { ...LOGO3D, ...from, mirror };
  const durF = (dur * fps) / 60;
  const built = markSolid(lg, depth, bevel, finish);
  const k = lockup.size / 100;
  const D = planeDistance(H, o.fov);
  const bw = built.box.max.x - built.box.min.x;
  const bh = built.box.max.y - built.box.min.y;
  const end = { x: lockup.x + built.centre.x * k, y: lockup.y - built.centre.y * k };
  const start = {
    x: W / 2 - o.focus[0] * o.mirror * bw * k * o.scale,
    y: H / 2 - o.focus[1] * bh * k * o.scale,
  };
  const apply = (t: number) => {
    const p = clamp01((t - at) / durF);
    const st = logoPose(p, o);
    const cx = start.x + (end.x - start.x) * st.travel;
    const cy = start.y + (end.y - start.y) * st.travel;
    const s = st.scale;
    built.root.position.set((cx - W / 2) / s, (H / 2 - cy) / s, D * (1 - 1 / s));
    built.root.rotation.set(deg(st.pitch), deg(st.yaw), deg(st.roll), "YXZ");
    built.root.scale.setScalar(k);
    built.body.scale.set(1, 1, st.depth);
    built.flat.value = st.flat;
    const focus = D / s;
    const moving = p > 0 && p < 1;
    return {
      aperture: st.aperture * focus,
      focus,
      still: !moving && st.aperture === 0,
      moving,
      samples: st.aperture > 0.004 ? 32 : undefined,
      dither: 1 - st.flat,
      sweep: st.sweep,
    };
  };
  const stage = Stage3D({
    frame,
    width: W,
    height: H,
    light,
    backdrop,
    samples,
    fov: o.fov,
    children: built.root,
    setup: ({ addSampler }) => addSampler(apply),
  });
  apply(frame);
  return {
    ...stage,
    built,
    pose: apply,
    dispose: () => {
      built.dispose();
      stage.dispose();
    },
  };
};
