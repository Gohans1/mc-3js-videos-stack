import { EDIT } from "film/edit";
import { applyEdit, buildScene, DURATION, SHOTS_OUT } from "film/scene";

import { canvas, config, done, log, still } from "../render/lab";
import { setTiming } from "../src/timing-state.mjs";

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const deadline = setTimeout(() => {
  throw new Error("Template verification exceeded three minutes");
}, 180_000);
const { W, H } = await config();
const draw = await buildScene(canvas(), W, H, true);
const gl = draw.tools.renderer.getContext();
const pixels = () => {
  const data = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
};
const difference = (a: Uint8Array, b: Uint8Array) =>
  a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 32 ? 1 : 0), 0);
const scenePose = () => {
  const poses: number[][] = [];
  draw.tools.scene.traverse((object) => poses.push(object.matrixWorld.toArray()));
  return JSON.stringify([poses, draw.tools.camera.projectionMatrix.toArray()]);
};
const plan = (value: object) => {
  setTiming(value, 8);
  applyEdit();
};
const independent = { base: {}, changes: [] };

EDIT.end = 8;
EDIT.text.items = [
  { kind: "text", text: "Independent text", from: 4, to: 6, x: 0.5, y: 0.3, size: 56 },
];
EDIT.adjustments.items = [];
plan({
  freezes: [{ at: 2, duration: 3 }],
  layerKinds: { text: independent, adjustment: independent },
});
check(DURATION === 11, "Template does not apply the film timing clock");
draw(2.5);
const held = pixels();
await still("template-freeze-held.jpg", canvas());
const actor = draw.tools.targets?.find((t) => t.id === "steve");
check(!!actor?.transform, "Steve cannot be selected and transformed");
const pose = actor!.objects[0].position.toArray();
const heldScene = scenePose();
draw(4.5);
check(
  String(actor!.objects[0].position.toArray()) === String(pose),
  "Freeze did not hold Steve's source pose",
);
check(scenePose() === heldScene, "Freeze changed scene transforms or the camera lens");
check(
  difference(held, pixels()) > 500,
  "Unlinked text did not appear while the picture was frozen",
);
await still("template-freeze-text.jpg", canvas());

EDIT.text.items = [];
draw(4.5);
const afterText = pixels();
await still("template-freeze-after-text.jpg", canvas());
await log(
  `Freeze pixel comparison: changed=${difference(held, afterText)}, mean=${held.reduce((n, v, i) => n + Math.abs(v - afterText[i]), 0) / held.length}`,
);
check(scenePose() === heldScene, "Removing text changed the frozen scene");
EDIT.adjustments.items = [
  { id: "audit", name: "Audit", from: 4, to: 6, track: 0, grade: { basic: { exposure: 50 } } },
];
draw(4.5);
check(difference(held, pixels()) > (W * H) / 4, "Adjust did not use its independent clock");
await still("template-freeze-adjust.jpg", canvas());

EDIT.adjustments.items = [];
EDIT.text.items = [
  { kind: "text", text: "Text over gap", from: 0, to: 8, x: 0.5, y: 0.3, size: 56 },
];
plan({ gaps: [{ from: 0, to: 8 }], layerKinds: { text: independent } });
draw(1);
const gap = pixels();
check(gap[0] === 0 && gap[1] === 0 && gap[2] === 0, "Gap did not hide the 3D picture");
check(
  gap.some((v, i) => i % 4 !== 3 && v > 10),
  "Gap incorrectly hid independent text",
);
await still("template-gap-text.jpg", canvas());

EDIT.text.items = [];
plan({});
EDIT.shots.push({ t: 4, name: "Second shot" });
applyEdit();
check(SHOTS_OUT.length === 2, "New shot was not applied");
check(
  !JSON.stringify(draw.describe(4)).includes("undefined"),
  "draw.describe emitted undefined on studio-added shot",
);
check(
  Array.isArray(draw.velocityEffects) && draw.velocityEffects.length >= 8,
  "draw.velocityEffects missing",
);
EDIT.shots.pop();
applyEdit();
check(SHOTS_OUT.length === 1, "Removed shot remained in SHOTS_OUT");

// Master black fade must stay pure #000000 even when additive camera optics (exposureBloom) and velocity flash fire together
const prevAnim = EDIT.shots[0].anim;
EDIT.shots[0].anim = { in: { fx: "fade", len: 1 }, combo: { fx: "exposureBloom" } };
applyEdit();
draw(0, { velocity: { effect: "flash", amount: 1, phase: 0, beatIndex: 0 } });
const blackPx = pixels();
check(
  blackPx[0] === 0 && blackPx[1] === 0 && blackPx[2] === 0,
  `Master fade-to-black lifted by velocityEffect (${blackPx[0]}, ${blackPx[1]}, ${blackPx[2]})`,
);
EDIT.shots[0].anim = prevAnim;
applyEdit();
draw(1);
await still("template-baseline.jpg", canvas());
check(gl.getError() === gl.NO_ERROR, "Template produced a WebGL error");
await log(
  "PASS: timing, frozen actor, independent Text/Adjust, gap visibility, Steve target and shot updates",
);
clearTimeout(deadline);
await done();
