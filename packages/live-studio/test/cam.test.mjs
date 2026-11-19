import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { cameraAt } from "film-stage/camera";

import {
  cameraKeyNavigation,
  cameraTailIndex,
  copyCameraFields,
  createHoldCameraKey,
  keyAtTime,
  redundantLinearCameraKeys,
  replaceCameraFraming,
  reverseCameraKeyRange,
  selectedCameraKeyAt,
  stripInvalidMatchSpeed,
} from "../app/camera/camera-edit.ts";
import { mergeShotHits, repartitionAdjacentHits, splitShotHits } from "../app/camera/shot-hits.ts";
import { formatOpticsAttributes, formatSpeedAttributes } from "../app/timeline/cam-attributes.ts";
import { CamTimeline, problems } from "../src/contract.ts";
import { compactJson, openTimelineFile } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-cam-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const key = (t, more = {}) => ({ t, p: [0, 1, 2], l: [0, 1, 3], ...more });

test("camera keys: anchors and curves pass, keys out of time order or a curve past the frame don't", () => {
  assert.deepEqual(
    problems(
      CamTimeline,
      [
        key(0),
        key(1, { p: { eye: [0, 0.3, 0.1] }, ease: "out" }),
        key(2, { ease: [0.77, 0, 0.175, 1], cut: true }),
      ],
      "cam",
    ),
    [],
  );
  assert.match(problems(CamTimeline, [key(1), key(0.5)], "cam").join(), /order of time/);
  assert.match(
    problems(CamTimeline, [key(0), key(1, { ease: [1.2, 0, 1, 1] })], "cam").join(),
    /ease/,
  );
  assert.match(problems(CamTimeline, [], "cam").join(), /cam/);
});

test("a film's camera keys as timeline_fmt.py wrote them come back unchanged but for whole-number floats", () => {
  const text = readFileSync(join(import.meta.dirname, "fixtures/timeline/cam.json"), "utf8");
  assert.deepEqual(problems(CamTimeline, JSON.parse(text), "cam.json"), []);
  assert.equal(
    compactJson(JSON.parse(text)) + "\n",
    text.replace(/\r\n/g, "\n").replace(/(\d)\.0(?=[,\]}\s])/g, "$1"),
  );
});

test("the camera file is written only over the version the page saw, and only when it passes", () => {
  const file = join(dir, "cam.json");
  writeFileSync(file, JSON.stringify([key(0, { wave: 0.3 }), key(2)]));
  const cam = openTimelineFile(dir, "cam.json", CamTimeline);
  const { version, data } = cam.read();
  assert.ok(cam.write(version, [key(2), key(0)]).problems);
  data[1].ease = [0.23, 1, 0.32, 1];
  assert.ok(cam.write(version, data).version);
  assert.ok(cam.ownWrite());
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8"))[0].wave, 0.3); // the film's own fields stay
  assert.ok(cam.write(version, data).version, "a repeated save from a known base converges");
  assert.deepEqual(cam.write("unknown", data), { conflict: true });
  writeFileSync(file, readFileSync(file, "utf8").replace("0.23", "0.3"));
  assert.ok(!cam.ownWrite());
});

test("splitShotHits partitions hits across split boundaries and mergeShotHits recombines sorted", () => {
  const hits = [
    { t: 1.2, amount: 0.4 },
    { t: 3.5, amount: 0.8, trauma: 0.6 },
    { t: 5.0, amount: 0.3 },
  ];
  const split = splitShotHits(hits, 3.5);
  assert.deepEqual(split.before, [{ t: 1.2, amount: 0.4 }]);
  assert.deepEqual(split.after, [
    { t: 3.5, amount: 0.8, trauma: 0.6 },
    { t: 5.0, amount: 0.3 },
  ]);
  // Cloning guarantees mutating one half never leaks into the other or the input
  split.after[0].amount = 0.99;
  assert.equal(hits[1].amount, 0.8);

  const edgeEmpty = splitShotHits(hits, 0.5);
  assert.equal(edgeEmpty.before, undefined);
  assert.equal(edgeEmpty.after?.length, 3);

  const recombined = mergeShotHits(
    [{ t: 1.2, amount: 0.4 }],
    [
      { t: 5.0, amount: 0.3 },
      { t: 3.5, amount: 0.8, trauma: 0.6 },
    ],
  );
  assert.deepEqual(recombined, [
    { t: 1.2, amount: 0.4 },
    { t: 3.5, amount: 0.8, trauma: 0.6 },
    { t: 5.0, amount: 0.3 },
  ]);
});

test("repartitionAdjacentHits migrates shot hits across moved cut boundaries cleanly", () => {
  const prev = [{ t: 1.2, amount: 0.4 }];
  const next = [
    { t: 2.5, amount: 0.7 },
    { t: 4.1, amount: 0.5 },
  ];
  // Rolling cut forward past 2.5s pulls that hit into the preceding shot
  const rolledRight = repartitionAdjacentHits(prev, next, 3.0);
  assert.deepEqual(rolledRight.prev, [
    { t: 1.2, amount: 0.4 },
    { t: 2.5, amount: 0.7 },
  ]);
  assert.deepEqual(rolledRight.next, [{ t: 4.1, amount: 0.5 }]);
  // Rolling cut back earlier restores both hits to the second shot cleanly
  const rolledBack = repartitionAdjacentHits(rolledRight.prev, rolledRight.next, 2.0);
  assert.deepEqual(rolledBack.prev, [{ t: 1.2, amount: 0.4 }]);
  assert.deepEqual(rolledBack.next, [
    { t: 2.5, amount: 0.7 },
    { t: 4.1, amount: 0.5 },
  ]);
});

test("formatOpticsAttributes renders handheld preset, kind, and off forms accurately", () => {
  assert.equal(
    formatOpticsAttributes({
      mm: 85,
      fstop: 2,
      focus: "Steve.head",
      handheld: { kind: "THE_CLOSEUP", amount: 0.4 },
    }),
    "85mm, f/2, focus Steve.head, handheld THE_CLOSEUP, no roll, the film's sway",
  );
  assert.equal(
    formatOpticsAttributes({
      fov: 50,
      fstop: 0,
      focus: { target: "desk", offset: [0, 0.2, 0] },
      handheld: { preset: "HANDYCAM_RUN" },
      roll: Math.PI / 18,
      wave: 0.5,
    }),
    "FOV 50°, sharp, focus desk, handheld HANDYCAM_RUN, roll 10°, sway 0.5×",
  );
  assert.equal(
    formatOpticsAttributes({ handheld: false }),
    "the film's lens, handheld off, no roll, the film's sway",
  );
  assert.equal(
    formatOpticsAttributes({ handheld: "none" }),
    "the film's lens, handheld off, no roll, the film's sway",
  );
  assert.equal(
    formatOpticsAttributes({ handheld: { preset: "THE_CLOSEUP", amount: 0 } }),
    "the film's lens, handheld off, no roll, the film's sway",
  );
  assert.equal(
    formatOpticsAttributes({ handheld: { kind: "HANDYCAM_RUN", amount: 1e-7 } }),
    "the film's lens, handheld off, no roll, the film's sway",
  );
});

test("camera key lookup prefers the exact tail and the exact cut over frame tolerance", () => {
  const keys = [key(0), key(0.999), key(1, { cut: true })];
  assert.equal(keyAtTime(keys, 0.999, 1 / 60), 1);
  assert.equal(keyAtTime(keys, 1, 1 / 60), 2);
});

test("replacing framing retains a tracked position and the authored millimeter unit", () => {
  const anchor = { target: "Steve.head", offset: [0, 0, 0] };
  const source = key(2, { p: anchor, mm: 85, fstop: 2 });
  replaceCameraFraming(source, { p: [1, 2, 3], l: [0, 1, 0], fov: 42 }, 16 / 9, (saved, pose) => ({
    ...saved,
    offset: pose,
  }));
  assert.deepEqual(source.p, { ...anchor, offset: [1, 2, 3] });
  assert.equal(source.fov, undefined);
  assert.ok(source.mm > 0);
  assert.equal(source.fstop, 2);
});

test("pasting shake copies bob, clearing lens or DOF only clears that group's channels", () => {
  const from = key(1, { wave: 0.2, bob: 0.8, handheld: false });
  const to = key(2, { mm: 50, fstop: 2, focus: "Steve.head", wave: 1, bob: 0 });
  copyCameraFields(from, to, ["shake"]);
  assert.deepEqual(
    to,
    key(2, { mm: 50, fstop: 2, focus: "Steve.head", wave: 0.2, bob: 0.8, handheld: false }),
  );
  copyCameraFields(from, to, ["dof"]);
  assert.equal(to.fstop, undefined);
  assert.equal(to.focus, undefined);
  assert.equal(to.mm, 50);
});

test("camera navigation steps through adjacent tail and cut without clustering their times", () => {
  const keys = [key(0), key(2.999), key(3, { cut: true })];
  assert.equal(cameraKeyNavigation(keys, 2.999, 1, 1 / 60).next, 2);
  assert.equal(cameraKeyNavigation(keys, 3, 2, 1 / 60).prev, 1);
});

test("an anchor without an inverse blocks the whole camera reframe", () => {
  const row = key(2, { p: { eye: [0, 0, 5] }, mm: 50 });
  const before = structuredClone(row);
  const updated = replaceCameraFraming(row, { p: [1, 1, 2], l: [0, 2, 0], fov: 42 }, 16 / 9);
  assert.equal(updated, false);
  assert.deepEqual(row, before);
});

test("a camera key sampled during anticipation serializes valid handheld settings", () => {
  const rows = [
    key(0, { handheld: { kind: "THE_CLOSEUP", move: 0 } }),
    key(2, { handheld: { kind: "THE_CLOSEUP", move: 1 }, ease: "anticipate" }),
  ];
  const pose = cameraAt(0.24, rows).sample;
  assert.deepEqual(problems(CamTimeline, [{ t: 0.24, ...pose }], "cam"), []);
});

test("a saved view targets the selected tail even when the cut shares its timestamp", () => {
  const keys = [key(0), key(3, { fov: 28 }), key(3, { cut: true, fov: 45 })];
  assert.equal(selectedCameraKeyAt(keys, 3 - 1e-6, 1, 1 / 60), 1);
});

test("merging a cut removes only its generated tail and keeps a key reused by Split", () => {
  const keys = [key(0), key(1.5, { id: "outgoing" }), key(1.5, { cut: true, tailId: false })];
  assert.equal(cameraTailIndex(keys, 2, 1 / 30), -1);
  keys[2].tailId = "outgoing";
  assert.equal(cameraTailIndex(keys, 2, 1 / 30), 1);
});

test("copyCameraFields speed group copies and clears matchSpeed alongside ease and easeChannels", () => {
  const from = key(1, { ease: "out", easeChannels: { aim: "linear" }, matchSpeed: true });
  const to = key(2, { ease: "smooth" });
  copyCameraFields(from, to, ["speed"]);
  assert.equal(to.ease, "out");
  assert.deepEqual(to.easeChannels, { aim: "linear" });
  assert.equal(to.matchSpeed, true);

  const plain = key(1, { ease: "inout" });
  copyCameraFields(plain, to, ["speed"]);
  assert.equal(to.ease, "inout");
  assert.equal(to.easeChannels, undefined);
  assert.equal("matchSpeed" in to, false);
});

test("reverseCameraKeyRange keeps boundary matchSpeed in place and reverses interior matchSpeed", () => {
  const twoKeys = [
    key(1, { p: [2, 1, 2], ease: "linear", matchSpeed: true }),
    key(3, { p: [6, 1, 2], ease: "out" }),
  ];
  const reversedTwo = reverseCameraKeyRange(twoKeys);
  assert.equal(reversedTwo[0].matchSpeed, true);
  assert.equal("matchSpeed" in reversedTwo[1], false);
  assert.deepEqual(reversedTwo[0].p, [6, 1, 2]);
  assert.deepEqual(reversedTwo[1].p, [2, 1, 2]);

  const fourKeys = [
    key(1, { p: [1, 0, 0], matchSpeed: true }),
    key(2, { p: [2, 0, 0], matchSpeed: true }),
    key(3, { p: [3, 0, 0] }),
    key(4, { p: [4, 0, 0] }),
  ];
  const reversedFour = reverseCameraKeyRange(fourKeys);
  // Boundaries [0] and [3] stay pinned; interior [1] and [2] mirror positions.
  assert.equal(reversedFour[0].matchSpeed, true);
  assert.equal("matchSpeed" in reversedFour[1], false);
  assert.equal(reversedFour[2].matchSpeed, true);
  assert.equal("matchSpeed" in reversedFour[3], false);
});

test("stripInvalidMatchSpeed removes matchSpeed from non-joinable pasted keys while preserving valid interior joins", () => {
  const rows = [
    key(0, { matchSpeed: true }),
    key(1, { matchSpeed: true }),
    key(2, { matchSpeed: true }),
    key(3, { cut: true, matchSpeed: true }),
    key(4, { matchSpeed: true }),
    key(5, { motion: "hold", matchSpeed: true }),
    key(6, { matchSpeed: true, muted: true }),
    key(7, { matchSpeed: true }),
  ];
  stripInvalidMatchSpeed(
    rows,
    rows.map((_, i) => i),
  );
  // 0: first key, 1: valid interior, 2: shot 0 last key, 3: cut key, 4: before hold, 5: hold, 6: muted, 7: shot 1 last key
  assert.equal("matchSpeed" in rows[0], false);
  assert.equal(rows[1].matchSpeed, true);
  assert.equal("matchSpeed" in rows[2], false);
  assert.equal("matchSpeed" in rows[3], false);
  assert.equal("matchSpeed" in rows[4], false);
  assert.equal("matchSpeed" in rows[5], false);
  assert.equal("matchSpeed" in rows[6], false);
  assert.equal("matchSpeed" in rows[7], false);
});

test("redundantLinearCameraKeys skips keys adjacent to or carrying matchSpeed", () => {
  const linearTrack = [
    key(0, { id: "a", p: [0, 0, 5], l: [0, 0, 0], motion: "linear", ease: "linear" }),
    key(1, { id: "b", p: [5, 0, 5], l: [0, 0, 0], motion: "linear", ease: "linear" }),
    key(2, { id: "c", p: [10, 0, 5], l: [0, 0, 0], motion: "linear", ease: "linear" }),
  ];
  const selected = new Set(["b"]);
  assert.deepEqual(redundantLinearCameraKeys(linearTrack, selected, 1 / 60), [1]);
  for (const idx of [0, 1, 2]) {
    const withMatch = structuredClone(linearTrack);
    withMatch[idx].matchSpeed = true;
    assert.deepEqual(redundantLinearCameraKeys(withMatch, selected, 1 / 60), []);
  }
});

test("createHoldCameraKey strips matchSpeed and marks the new key as hold", () => {
  const source = key(1, {
    id: "orig",
    ease: "out",
    matchSpeed: true,
    cut: true,
    locked: true,
    reason: "beat",
  });
  const held = createHoldCameraKey(source, "held-1", 2, 0.5);
  assert.equal(held.id, "held-1");
  assert.equal(held.t, 2);
  assert.equal(held.motion, "hold");
  assert.equal(held.railU, 0.5);
  assert.equal("matchSpeed" in held, false);
  assert.equal("ease" in held, false);
  assert.equal("cut" in held, false);
  assert.equal("locked" in held, false);
});

test("formatSpeedAttributes appends Match speed only when enabled", () => {
  assert.equal(formatSpeedAttributes({ matchSpeed: true }, "Smooth"), "Smooth · Match speed");
  assert.equal(formatSpeedAttributes({}, "Ease Out"), "Ease Out");
  assert.equal(formatSpeedAttributes({ matchSpeed: false }, "Linear"), "Linear");
});
