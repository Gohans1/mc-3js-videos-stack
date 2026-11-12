// makeTransitions as a film runs it, between a red shot and a blue one; test/transitions-gpu.test.ts calls
// window.frameAt(fx, t) for the mean colour at t (the transition runs 0.75 to 1.25) and whether its shader compiled.
import * as THREE from "three";

import { makeTransitions } from "../../src/transitions";

const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(160, 90, false);
const SHOT_COLOURS = [0xd02020, 0x2040d0];
let fx = "dissolve";
const draw = makeTransitions(
  renderer,
  (_t, shot = 1) => {
    renderer.setRenderTarget(null);
    renderer.setClearColor(SHOT_COLOURS[shot]!);
    renderer.clear();
  },
  () => [{ t: 0 }, { t: 1, transition: { fx, len: 0.5, ease: "linear" } }],
  () => 2,
  { on: false },
);

Object.assign(window, {
  frameAt(id: string, t: number) {
    fx = id;
    draw(t);
    const gl = renderer.getContext(),
      px = new Uint8Array(160 * 90 * 4);
    gl.readPixels(0, 0, 160, 90, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const broken = renderer.info.programs?.some((p) => p.diagnostics && !p.diagnostics.runnable);
    let r = 0,
      b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]!;
      b += px[i + 2]!;
    }
    return {
      compiled: !broken && gl.getError() === gl.NO_ERROR,
      r: r / (px.length / 4),
      b: b / (px.length / 4),
    };
  },
});
