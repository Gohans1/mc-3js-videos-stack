// @ts-nocheck
// Lab: one build of the film, then free-camera stills of props from fixed spots (renders/prop_N.jpg), for judging a
// new block model up close without touching the film's cameras. LAB_VIEW=desk picks a set; AT is the film second drawn.
// ENTRY=lab/prop.ts AT=72.6 LAB_VIEW=desk bun run render stills  (LAB_LOOKS=chair: each chair look from those spots)
import { buildScene } from "../src/scene";
import { canvas, config, done, still } from "live-studio/lab";

const SETS = {
  room: [
    { p: [2.6, 2.0, 8.5], l: [0.5, 1.25, 8.5], fov: 38 }, // straight on, from the chair side
    { p: [5.6, 1.9, 10.6], l: [1.5, 0.8, 6.5], fov: 75 }, // the whole cell from the south-east top corner
    { p: [0.4, 1.9, 5.4], l: [4.0, 0.8, 9.5], fov: 75 }, // the whole cell from the north-west top corner
  ],
  desk: [
    { p: [3.0, 1.1, 8.5], l: [0.8, 0.4, 8.5], fov: 45 }, // the cabinet and drawer, straight on
    { p: [2.2, 1.6, 10.0], l: [0.9, 0.35, 8.5], fov: 45 }, // from the door side, above
    { p: [1.9, 1.3, 8.5], l: [0.8, 0.2, 8.5], fov: 55 }, // down into the drawer
  ],
  // Steve at the desk: eye line to the screen, knees under the desk, hips on the seat, feet down
  sit: [
    { p: [1.3, 1.15, 6.2], l: [1.2, 0.85, 8.5], fov: 50 }, // side-on profile, from the north
    { p: [2.9, 1.65, 9.6], l: [0.8, 1.05, 8.5], fov: 45 }, // behind his left shoulder
    { p: [0.9, 1.5, 10.4], l: [1.5, 0.75, 8.5], fov: 50 }, // three-quarter front, from the desk's south end
  ],
  // the drawer from his left (south), from the north over the chair, and from behind his left shoulder
  drawer: [
    { p: [1.4, 0.9, 11.4], l: [1.3, 0.6, 9.5], fov: 50 },
    { p: [1.5, 1.2, 7.2], l: [1.3, 0.55, 9.5], fov: 50 },
    { p: [2.9, 1.5, 10.6], l: [1.2, 0.5, 9.5], fov: 45 },
  ],
  // the dig (83-92 s) and the scrap at the back of the drawer (92-105 s): candidate angles for the film's cameras
  dig: [
    { p: [0.7, 0.7, 8.35], l: [1.5, 0.8, 9.45], fov: 55 }, // from under the desk's legroom, up into his face
    { p: [2.5, 1.45, 8.3], l: [1.4, 0.6, 9.5], fov: 45 }, // behind his right shoulder, further off
    { p: [1.25, 1.55, 11.3], l: [1.45, 0.7, 9.4], fov: 50 }, // from the south, high: his left side and the open drawer
  ],
  // the keyboard from the north end of the desk, past his hands: keys going down as he types (53-57 s)
  keys: [
    { p: [0.95, 1.3, 7.75], l: [0.85, 1.05, 8.5], fov: 30 },
    { p: [0.55, 1.45, 8.0], l: [0.9, 1.05, 8.5], fov: 34 },
  ],
  // the folder he reads (75-82 s): what is printed on it must read on screen
  flip: [
    { p: [1.8, 1.3, 9.05], l: [1.32, 0.75, 9.42], fov: 32 }, // over his right shoulder
    { p: [1.75, 1.2, 9.9], l: [1.32, 0.75, 9.42], fov: 32 }, // over his left shoulder
    { p: [1.05, 0.95, 9.6], l: [1.35, 0.78, 9.42], fov: 40 }, // from the drawer side, the cover's other face
  ],
  scrap: [
    { p: [1.15, 0.78, 9.95], l: [1.13, 0.45, 9.42], fov: 40 }, // over the drawer's south wall, down into its back corner
    { p: [1.35, 0.85, 9.85], l: [1.12, 0.44, 9.42], fov: 36 },
    { p: [1.15, 0.72, 10.2], l: [1.13, 0.45, 9.42], fov: 30 },
  ],
  door: [
    { p: [4.5, 1.4, 9.0], l: [4.5, 1.2, 12.0], fov: 50 }, // the door, straight on
    { p: [3.2, 1.5, 10.8], l: [4.3, 1.2, 12.0], fov: 45 }, // the door, from the side
  ],
  dome: [{ p: [6.0, 3.8, 3.0], l: [8.7, 5.8, 0.3], fov: 35 }],
};
(async () => {
  const cfg = await config();
  const VIEWS = SETS[cfg.lab.view ?? "room"] ?? SETS.room;
  const c = canvas();
  const draw = await buildScene(c, cfg.W, cfg.H, false);
  const { free } = draw.tools;
  free.on = true;
  const at = cfg.stills[0]?.frame / 30 || 12;
  const shoot = async (name, v) => {
    free.p.set(...v.p); free.l.set(...v.l); free.fov = v.fov;
    draw(at);
    await still(`${name}.jpg`, c);
  };
  // LAB_LOOKS=chair: every look of that variant from every spot of the set (prop_<look>_<spot>.jpg)
  const only = (draw.variants ?? []).find((x) => x.id === cfg.lab.looks);
  if (only) for (const o of only.options) { only.set(o.id); for (const [i, v] of VIEWS.entries()) await shoot(`prop_${o.id.replace(":", "_")}_${i}`, v); }
  else for (const [i, v] of VIEWS.entries()) await shoot(`prop_${i}`, v);
  // every look of every prop with options (src/variants.ts), from the first two spots
  if (!cfg.lab.view) for (const variant of draw.variants ?? []) {
    for (const o of variant.options) { variant.set(o.id); for (const i of [0, 1]) await shoot(`prop_${variant.id}_${o.id}_${i}`, VIEWS[Math.min(i, VIEWS.length - 1)]); }
    variant.set(variant.options[0].id);
  }
  await done();
})();
