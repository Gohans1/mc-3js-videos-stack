import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { findPops, findSlides, report } from "../checks/pops.mjs";

const FPS = 30;
const times = (from, to) => {
  const out = [];
  for (let i = 0; from + i / FPS <= to + 1e-9; i++) out.push(from + i / FPS);
  return out;
};
const D = Math.PI / 180;
const quatX = (deg) => [Math.sin((deg * D) / 2), 0, 0, Math.cos((deg * D) / 2)];
const turnTrack = (owner, part, t, deg, seen) => ({
  owner,
  part,
  kind: "turn",
  t,
  v: t.map((s) => quatX(deg(s))),
  seen: seen ? t.map(seen) : t.map(() => true),
});
const moveTrack = (owner, part, t, pos, kind = "move") => ({
  owner,
  part,
  kind,
  t,
  v: t.map(pos),
  seen: t.map(() => true),
});
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

test("an elbow that eases 90 degrees over half a second does not pop", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("waiter", "laR", t, (s) => 90 * smooth((s - 0.5) / 0.5))], []);
  assert.deepEqual(pops, []);
});

test("an elbow that jumps 60 degrees between two frames pops at the later frame", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("waiter", "laR", t, (s) => (s < 1 ? 0 : 60))], []);
  assert.equal(pops.length, 1);
  assert.equal(pops[0].owner, "waiter");
  assert.equal(pops[0].part, "laR");
  assert.ok(Math.abs(pops[0].t - 1) < 1 / FPS);
  assert.ok(Math.abs(pops[0].step - 60) < 0.5);
});

test("a pop carries the steps of the three frames on either side so the reader can judge it", () => {
  const t = times(0, 2);
  const [pop] = findPops([turnTrack("waiter", "laR", t, (s) => (s < 1 ? 0 : 60))], []);
  assert.equal(pop.near.length, 7);
  assert.ok(Math.abs(pop.near[3] - 60) < 0.5);
  assert.deepEqual(pop.near.filter((_, k) => k !== 3).map(Math.round), [0, 0, 0, 0, 0, 0]);
});

test("an elbow that whips 78 degrees from rest over three frames is a fast move, not a pop", () => {
  const t = times(0, 2);
  const flick = [0, 17.3, 49.6, 73.5, 77.5];
  const deg = (s) => {
    const k = Math.round((s - 1) * FPS);
    return k < 0 ? 0 : (flick[k] ?? 77.5);
  };
  assert.deepEqual(findPops([turnTrack("dreamer", "laL", t, deg)], []), []);
});

test("a pose that switches over two frames pops once", () => {
  const t = times(0, 2);
  const deg = (s) => {
    const k = Math.round((s - 1) * FPS);
    return k < 0 ? 0 : k === 0 ? 30 : 60;
  };
  const pops = findPops([turnTrack("dreamer", "laL", t, deg)], []);
  assert.equal(pops.length, 1);
  assert.ok(Math.abs(pops[0].step - 60) < 0.5);
});

const fromSteps = (steps) => {
  const angles = steps.reduce((acc, s) => [...acc, acc.at(-1) + s], [0]);
  return (s) => {
    const k = Math.round((s - 1) * FPS);
    return k < 0 ? 0 : (angles[k] ?? angles.at(-1));
  };
};

test("an arm that flips 124 degrees in one frame mid-swing pops though its neighbours are fast too", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("dreamer", "uaR", t, fromSteps([34, 28, 124, 48, 14]))], []);
  assert.equal(pops.length, 1);
  assert.ok(Math.abs(pops[0].step - 124) < 0.5);
});

test("an arm that speeds up for two frames and then stops dead is a dead stop, not a pop", () => {
  const t = times(0, 2);
  const ramp = fromSteps([3, 2, 3, 7, 11, 1, 1]);
  assert.deepEqual(findPops([turnTrack("dreamer", "uaR", t, ramp)], []), []);
});

test("a jump across a cut is the edit, not a pop", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("waiter", "laR", t, (s) => (s < 1 ? 0 : 60))], [1]);
  assert.deepEqual(pops, []);
});

test("a joint that is hidden on either side of the jump does not pop", () => {
  const t = times(0, 2);
  const track = turnTrack(
    "waiter",
    "laR",
    t,
    (s) => (s < 1 ? 0 : 60),
    (s) => s < 0.9 || s > 1.2,
  );
  assert.deepEqual(findPops([track], []), []);
});

test("a character running at 6 m/s moves far each frame without popping", () => {
  const t = times(0, 2);
  assert.deepEqual(findPops([moveTrack("girl", "root", t, (s) => [6 * s, 0, 0])], []), []);
});

test("a character that appears two metres away in one frame pops", () => {
  const t = times(0, 2);
  const pops = findPops([moveTrack("girl", "root", t, (s) => [s < 1 ? 0 : 2, 0, 0])], []);
  assert.equal(pops.length, 1);
  assert.ok(Math.abs(pops[0].step - 2) < 1e-6);
});

test("an actor turning around in one frame pops even if their joints stay in pose", async () => {
  const fetchBefore = globalThis.fetch;
  const windowBefore = globalThis.window;
  globalThis.window = {};
  globalThis.fetch = async () => new Response();
  try {
    const { popsCheck } = await import("../render/pops.ts");
    const scene = new THREE.Scene();
    const actor = new THREE.Group();
    actor.name = "steve";
    actor.soleNow = (_side, out) => out.copy(actor.position);
    actor.add(new THREE.Bone());
    scene.add(actor);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    let turnAt = 0.5;
    const draw = (t) => {
      actor.rotation.y = t < turnAt ? 0 : Math.PI;
    };
    draw.tools = { scene, camera };

    const lines = await popsCheck(draw)("", 0, 1);

    assert.match(lines.join("\n"), /POP 0\.50 steve: root rotation 180°/);
    turnAt = 1;
    const endReset = await popsCheck(draw)("", 0, 1);
    assert.doesNotMatch(endReset.join("\n"), /POP 1\.00/);
  } finally {
    globalThis.fetch = fetchBefore;
    if (windowBefore === undefined) delete globalThis.window;
    else globalThis.window = windowBefore;
  }
});

test("a brow that switches mood in one frame pops, one that crossfades does not", () => {
  const t = times(0, 2);
  const snap = moveTrack("dreamer", "browL", t, (s) => [0, s < 1 ? 0 : 0.85, 0], "face");
  const fade = moveTrack("dreamer", "browL", t, (s) => [0, 0.85 * smooth(s - 0.6), 0], "face");
  assert.equal(findPops([snap], []).length, 1);
  assert.deepEqual(findPops([fade], []), []);
});

test("a brow dropped by a one-frame blink is not a mood pop", () => {
  const t = times(0, 2);
  const blink = moveTrack(
    "dreamer",
    "browL",
    t,
    (s) => [0, s >= 1 && s < 1.1 ? -0.3 : 0, 0],
    "face",
  );
  assert.deepEqual(findPops([blink], []), []);
});

const faceTrack = (owner, t, points) => ({
  owner,
  part: "face",
  kind: "landmarks",
  t,
  v: t.map((s) => points(s).flat()),
  seen: t.map(() => true),
});

test("a toon face is one track of landmarks that pops by the farthest any of them jumps in a frame", () => {
  const t = times(0, 2);
  const mouth = [4, 6.7];
  const snap = faceTrack("dreamer", t, (s) => [[2, s < 1 ? 1.8 : 2.6], mouth]);
  const eased = faceTrack("dreamer", t, (s) => [[2, 1.8 + 0.8 * smooth((s - 1) / 0.2)], mouth]);
  const [pop] = findPops([snap], []);
  assert.ok(Math.abs(pop.step - 0.8) < 1e-9);
  assert.deepEqual(findPops([eased], []), []);
});

const soleTrack = (owner, part, t, pos) => ({
  owner,
  part,
  kind: "sole",
  t,
  v: t.map(pos),
  seen: t.map(() => true),
  support: t.map((s) => {
    const position = pos(s);
    return position[1] <= 0.03
      ? { id: "floor", position, scale: [1, 1, 1], height: position[1] }
      : null;
  }),
});
const stepping = (side, speed) => (s) => {
  const phase = (s * 2 + (side === "L" ? 0 : 0.5)) % 1;
  const planted = phase < 0.5;
  const stepStart = Math.floor(s * 2 + (side === "L" ? 0 : 0.5)) / 2;
  return [speed * stepStart, planted ? 0 : 0.08 * Math.sin((phase - 0.5) * 2 * Math.PI), 0];
};

test("feet that stay put while planted do not slide", () => {
  const t = times(0, 3);
  const slides = findSlides(
    [soleTrack("steve", "L", t, stepping("L", 1)), soleTrack("steve", "R", t, stepping("R", 1))],
    [],
  );
  assert.deepEqual(slides, []);
});

test("a sole that glides along the floor while the body walks slides", () => {
  const t = times(0, 3);
  const gliding = (s) => [1.2 * s, 0, 0];
  const slides = findSlides([soleTrack("steve", "L", t, gliding)], []);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].owner, "steve");
  assert.ok(slides[0].worst > 0.5, `worst ${slides[0].worst}`);
});

test("a sole carried in the air has no support to slide against", () => {
  const t = times(0, 3);
  const carried = {
    ...soleTrack("steve", "L", t, (s) => [2 * s, 0.6, 0]),
    support: t.map(() => null),
  };
  assert.deepEqual(findSlides([carried], []), []);
});

test("a sole anchored to a moving cart does not slide", () => {
  const t = times(0, 3);
  const rider = {
    ...soleTrack("steve", "L", t, (s) => [2 * s, 0.6, 0]),
    support: t.map(() => ({ id: "cart", position: [0, 0, 0], scale: [1, 1, 1], height: 0 })),
  };
  assert.deepEqual(findSlides([rider], []), []);
});

test("a sole sliding back on a moving cart is measured in world metres", () => {
  const t = times(0, 3);
  const rider = {
    ...soleTrack("steve", "L", t, () => [0, 0.6, 0]),
    support: t.map((s) => ({ id: "cart", position: [-s / 2, 0, 0], scale: [2, 1, 1], height: 0 })),
  };
  const [slide] = findSlides([rider], []);
  assert.equal(slide?.worst, 3);
});

test("a sole sliding along a floor mesh's local Y is measured on the rotated floor", () => {
  const t = times(0, 1);
  const onPlane = {
    ...soleTrack("steve", "L", t, (s) => [0, 0, -s]),
    support: t.map((s) => ({ id: "plane", position: [0, s, 0], scale: [1, 1, 1], height: 0 })),
  };
  const [slide] = findSlides([onPlane], []);
  assert.equal(slide?.worst, 1);
});

test("the report names each pop's owner, part and second, and ends with an ERROR line that fails the run", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("waiter", "laR", t, (s) => (s < 1 ? 0 : 60))], []);
  const lines = report({ from: 0, to: 2, fps: FPS, tracks: 1, owners: 1, pops, slides: [] });
  const text = lines.join("\n");
  assert.match(text, /POP 1\.00 waiter: laR 60°/);
  assert.match(lines.at(-1), /^ERROR pops: 1 pop/);
});

test("a clean span reports no ERROR line", () => {
  const lines = report({ from: 0, to: 2, fps: FPS, tracks: 3, owners: 1, pops: [], slides: [] });
  assert.ok(lines.every((l) => !l.startsWith("ERROR")));
  assert.match(lines.at(-1), /no pops/);
});

test("an arm speeding up into a cut and on after it is a fast move, not a pop", () => {
  const t = times(0, 2);
  const swing = fromSteps([0, 0, 0, 1, 2, 4, 20, 24, 12, 3, 0, 0]);
  assert.deepEqual(findPops([turnTrack("dreamer", "uaL", t, swing)], [1 + 7.5 / FPS]), []);
});

test("a joint that comes into view is judged by how it moved while hidden", () => {
  const t = times(0, 2);
  const enters = (s) => s >= 1 + 2 / FPS - 1e-9;
  const swing = turnTrack("dreamer", "laL", t, fromSteps([30, 36, 40, 8, 3]), enters);
  assert.deepEqual(findPops([swing], []), []);
});

test("with nothing measured before it, a joint's first step pops only when it turns 90 degrees", () => {
  const t = times(1, 2);
  assert.deepEqual(findPops([turnTrack("dreamer", "laL", t, fromSteps([40, 5, 2]))], []), []);
  assert.equal(findPops([turnTrack("dreamer", "laL", t, fromSteps([120, 5, 2]))], []).length, 1);
});

test("a pose that snaps inside a transition is left to the transition", () => {
  const t = times(0, 2);
  const snap = turnTrack("waiter", "laR", t, (s) => (s < 1 ? 0 : 60));
  assert.deepEqual(findPops([snap], [], [[0.9, 1.2]]), []);
});

test("a snap from rest that settles on the next frame is one two-frame pop", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("dreamer", "uaR", t, fromSteps([0, 0, 20, 6, 0, 0]))], []);
  assert.equal(pops.length, 1);
  assert.equal(pops[0].frames, 2);
  assert.ok(Math.abs(pops[0].step - 26) < 0.5);
});

test("one flip spread over two frames of 90 degrees or more is one pop", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("dreamer", "uaL", t, fromSteps([0, 0, 132, 94, 0, 0]))], []);
  assert.equal(pops.length, 1);
  assert.equal(pops[0].frames, 2);
});

test("a sole planted at two spots in two shots does not slide across the cut", () => {
  const t = times(0, 3);
  const moved = soleTrack("steve", "L", t, (s) => [s < 1.5 ? 0 : 1, 0, 0]);
  assert.deepEqual(findSlides([moved], [1.5]), []);
});

test("a sole the camera cannot see is not judged", () => {
  const t = times(0, 3);
  const hidden = {
    ...soleTrack("steve", "L", t, (s) => [1.2 * s, 0, 0]),
    seen: t.map(() => false),
  };
  assert.deepEqual(findSlides([hidden], []), []);
});

test("two slides of one actor a moment apart are reported as one", () => {
  const t = times(0, 3);
  const glideLiftGlide = (s) => [s, s > 1 && s < 1.2 ? 0.1 : 0, 0];
  const slides = findSlides([soleTrack("steve", "L", t, glideLiftGlide)], []);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].runs, 2);
});

test("one frame thrown out of pose and back is one pop", () => {
  const t = times(0, 2);
  const pops = findPops([turnTrack("dreamer", "head", t, fromSteps([0, 0, 60, -60, 0, 0]))], []);
  assert.equal(pops.length, 1);
  assert.equal(pops[0].frames, 2);
  assert.ok(Math.abs(pops[0].step - 60) < 0.5);
});

test("pops on back-to-back frames of one joint are reported as one", () => {
  const t = times(0, 2);
  const pops = findPops(
    [turnTrack("dreamer", "uaR", t, fromSteps([0, 0, 100, 100, 100, 0, 0]))],
    [],
  );
  assert.equal(pops.length, 1);
  assert.equal(pops[0].frames, 3);
});
