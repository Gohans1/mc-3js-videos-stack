// @ts-nocheck
import { canvas, config, done, log, still } from "live-studio/lab";

import { EDIT } from "../src/edit";
import { applyEdit, buildScene } from "../src/scene";

const cfg = await config();
const deadline = setTimeout(() => {
  throw new Error("Showcase exceeded three minutes");
}, 180_000);
const original = structuredClone(EDIT);
const draw = await buildScene(canvas(), cfg.W, cfg.H, true);
const samples = {
  baseline: () => [1],
  text: () => {
    EDIT.text.items = [
      {
        kind: "text",
        text: "THE ROOM\nA new story",
        font: "mono",
        size: 56,
        x: 0.5,
        y: 0.2,
        from: 0,
        to: 8,
        in: { fx: "type", len: 2 },
      },
    ];
    return [0.5, 2];
  },
  shapes: () => {
    EDIT.text.items = [
      { kind: "circle", x: 0.54, y: 0.43, w: 220, h: 380, from: 0, to: 8, color: "#00C8CD" },
      { kind: "arrow", x: 0.35, y: 0.36, size: 240, from: 0, to: 8 },
    ];
    return [1];
  },
  animation: () => {
    EDIT.shots[0].anim = { in: { fx: "push", len: 2, k: 1 } };
    return [0.2, 2];
  },
  transition: () => {
    EDIT.shots.push({ t: 4, name: "Next view", transition: { fx: "black", len: 1 } });
    return [3.5, 4, 4.5];
  },
  grade: () => {
    EDIT.shots[0].adjust = { basic: { saturation: -100 } };
    return [1];
  },
  adjustment: () => {
    EDIT.adjustments.items = [
      {
        id: "sample",
        name: "Warm light",
        from: 2,
        to: 4,
        track: 0,
        grade: { basic: { temp: 45, exposure: 15 } },
      },
    ];
    return [1, 3];
  },
};
const wanted = cfg.lab.demo;
if (wanted && !Object.hasOwn(samples, wanted))
  throw new Error("LAB_DEMO must be one of: " + Object.keys(samples).join(", "));
for (const [name, setup] of Object.entries(samples)) {
  if (wanted && wanted !== name) continue;
  Object.assign(EDIT, structuredClone(original));
  const times = setup();
  applyEdit();
  for (const t of times) {
    draw(t);
    await still("showcase_" + name + "_" + t.toFixed(1) + ".jpg", canvas());
  }
  await log(name + ": " + times.join(", ") + " s");
}
Object.assign(EDIT, original);
applyEdit();
clearTimeout(deadline);
await done();
