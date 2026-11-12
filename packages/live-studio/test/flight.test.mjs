// The free camera flies like Minecraft's creative flight (app/picture/flight.ts): held keys move it every frame by time, not by
// the keyboard's repeat
import assert from "node:assert/strict";
import { test } from "node:test";

import { createFlight, SPRINT } from "../app/picture/flight.ts";

const hold = (flight, seconds, fps, speed = 4) => {
  let forward = 0,
    right = 0,
    up = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const d = flight.step(1 / fps, speed);
    if (d) {
      forward += d[0];
      right += d[1];
      up += d[2];
    }
  }
  return [forward, right, up];
};

test("holding W flies forward at the speed asked, from the first frame", () => {
  const f = createFlight();
  f.press("KeyW", 0);
  const [forward, right, up] = hold(f, 1, 60, 6);
  assert.ok(forward > 6 * 0.85 && forward < 6, `${forward}`);
  assert.equal(right, 0);
  assert.equal(up, 0);
});

test("Space flies up and Shift flies down, like Minecraft; E and Q too", () => {
  for (const [code, sign] of [
    ["Space", 1],
    ["ShiftLeft", -1],
    ["KeyE", 1],
    ["KeyQ", -1],
  ]) {
    const f = createFlight();
    f.press(code, 0);
    const [forward, right, up] = hold(f, 1, 60);
    assert.ok(sign * up > 4 * 0.85 && sign * up < 4, `${code}: ${up}`);
    assert.equal(forward + right, 0, code);
  }
});

test("W pressed twice quickly sprints SPRINT times faster until it is let go; held down it never does", () => {
  const tapped = createFlight(),
    held = createFlight();
  tapped.press("KeyW", 0);
  tapped.release("KeyW");
  tapped.press("KeyW", 0.2);
  // a held key repeats its keydown: half a second, then every 33 ms
  held.press("KeyW", 0);
  held.press("KeyW", 0.5);
  held.press("KeyW", 0.533);
  const ratio = hold(tapped, 2, 60)[0] / hold(held, 2, 60)[0];
  assert.ok(Math.abs(ratio - SPRINT) < 0.05, `${ratio}`);
  tapped.release("KeyW");
  tapped.press("KeyW", 5);
  hold(tapped, 1, 60); // up to full speed again
  assert.ok(
    Math.abs(hold(tapped, 1, 60)[0] - 4) < 0.05,
    "a new press after letting go walks again",
  );
});

test("a second W press long after the first walks", () => {
  const f = createFlight();
  f.press("KeyW", 0);
  f.release("KeyW");
  f.press("KeyW", 0.6);
  hold(f, 1, 60);
  assert.ok(Math.abs(hold(f, 1, 60)[0] - 4) < 0.05);
});

test("a Shift that starts a shortcut (Shift+K, Shift+drag) gives back the height it dropped, and drops no more", () => {
  const f = createFlight();
  f.press("ShiftLeft", 0);
  const dropped = hold(f, 0.15, 60)[2];
  assert.ok(dropped < -0.1, `${dropped}`);
  assert.ok(Math.abs(f.chord() + dropped) < 1e-9, "chord() is the height to climb back");
  assert.equal(f.step(1 / 60, 4), null, "no glide on down after it");
  assert.equal(hold(f, 0.5, 60)[2], 0, "still held, Shift no longer flies");
  assert.equal(f.chord(), 0, "a second shortcut while it is held gives back nothing more");
  f.release("ShiftLeft");
  f.press("ShiftLeft", 2);
  assert.ok(hold(f, 0.5, 60)[2] < 0, "pressed again, it flies down again");
});

test("without Shift down a shortcut moves nothing", () => {
  const f = createFlight();
  f.press("KeyW", 0);
  hold(f, 0.5, 60);
  assert.equal(f.chord(), 0);
  assert.ok(hold(f, 0.5, 60)[0] > 1.9, "and W carries on");
});

test("the same distance at any frame rate", () => {
  const a = createFlight(),
    b = createFlight();
  a.press("Space", 0);
  b.press("Space", 0);
  const at30 = hold(a, 1, 30)[2],
    at144 = hold(b, 1, 144)[2];
  assert.ok(Math.abs(at30 - at144) / at144 < 0.03, `${at30} vs ${at144}`);
});

test("letting go glides a little, then stops asking for frames", () => {
  const f = createFlight();
  f.press("KeyS", 0);
  hold(f, 1, 60);
  f.release("KeyS");
  const glide = hold(f, 0.5, 60)[0];
  assert.ok(glide < 0 && glide > -0.5, `${glide}`);
  assert.equal(f.step(1 / 60, 4), null);
});

test("opposite keys cancel, and losing focus lets go of everything", () => {
  const f = createFlight();
  f.press("KeyA", 0);
  f.press("KeyD", 0);
  assert.equal(hold(f, 0.5, 60)[1], 0);
  f.release("KeyD");
  hold(f, 0.5, 60);
  f.clear();
  hold(f, 1, 60);
  assert.equal(f.step(1 / 60, 4), null);
});

test("only the flying keys are taken", () => {
  const f = createFlight();
  for (const code of ["KeyW", "Space", "ShiftRight"]) assert.equal(f.press(code, 0), true, code);
  for (const code of ["KeyF", "KeyK", "ControlLeft"]) assert.equal(f.press(code, 0), false, code);
});
