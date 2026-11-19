import assert from "node:assert/strict";
import { test } from "node:test";

import { focusLimits, formatOpticsHud } from "../app/picture/hud.ts";

test("returns empty string when telemetry is missing", () => {
  assert.equal(formatOpticsHud(undefined), "");
});

test("formats minimal shot and lens readout", () => {
  assert.equal(formatOpticsHud({ shot: 0, mm: 50, fov: 26.9 }), "Shot 0 · 50mm");
  assert.equal(formatOpticsHud({ shot: 2, mm: 35.4, fov: 37 }), "Shot 2 · 35.4mm");
});

test("formats full viewfinder telemetry including aperture, focus target, handheld, look and impulse", () => {
  assert.equal(
    formatOpticsHud({
      shot: 1,
      shotName: "Reveal",
      mm: 85,
      fov: 16.1,
      fstop: 2,
      focusM: 2.42,
      focusTarget: "Steve.head",
      handheld: "THE_CLOSEUP",
      look: "teal-amber",
      impulse: "hit",
    }),
    "Shot 1 · Reveal · 85mm · f/2 · 2.4m Steve.head · HH: THE_CLOSEUP · look: teal-amber · HIT",
  );
});

test("omits inactive dof/handheld fields and formats partial focus cleanly", () => {
  assert.equal(
    formatOpticsHud({
      shot: 0,
      mm: 24,
      fov: 53.1,
      fstop: 0,
      focusM: 0,
      focusTarget: "desk.lamp",
      handheld: "off",
    }),
    "Shot 0 · 24mm · focus desk.lamp",
  );
  assert.equal(
    formatOpticsHud({
      shot: 3,
      mm: 135,
      fov: 10.2,
      fstop: 2.8,
      focusM: 4.5,
      handheld: "none",
    }),
    "Shot 3 · 135mm · f/2.8 · 4.5m",
  );
});

test("deduplicates bare numeric focus labels while keeping rack pull targets", () => {
  assert.equal(
    formatOpticsHud({
      shot: 0,
      mm: 50,
      fov: 22.9,
      fstop: 2.8,
      focusM: 3.5,
      focusTarget: "3.5m",
    }),
    "Shot 0 · 50mm · f/2.8 · 3.5m",
  );
  assert.equal(
    formatOpticsHud({
      shot: 1,
      mm: 85,
      fov: 13.6,
      fstop: 2,
      focusM: 3.5,
      focusTarget: "Steve.head->3.5m",
    }),
    "Shot 1 · 85mm · f/2 · 3.5m Steve.head->3.5m",
  );
});

test("one-pixel focus limits match the lens blur at near and far planes", () => {
  const mm = 50,
    fstop = 4,
    focus = 5;
  const { near, far, hyperfocal } = focusLimits(mm, fstop, focus);
  const blur = (distance) =>
    ((((mm ** 2 / fstop) * Math.abs(distance - focus)) / distance / (focus * 1000 - mm)) * 1920) /
    36;
  assert.ok(Math.abs(blur(near) - 1) < 1e-10);
  assert.ok(Math.abs(blur(far) - 1) < 1e-10);
  assert.equal(focusLimits(mm, fstop, hyperfocal).far, Infinity);
});
