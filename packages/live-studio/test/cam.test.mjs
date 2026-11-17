import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { mergeShotHits, repartitionAdjacentHits, splitShotHits } from "../app/camera/shot-hits.ts";
import { formatOpticsAttributes } from "../app/timeline/cam-attributes.ts";
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
