import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canPlaceCameraCut } from "../src/camera-clock.mjs";
import { cameraSpeed } from "../src/camera-speed.mjs";
import { heardLength } from "../src/film.mjs";
import { mapTimeline } from "../src/timing-data.mjs";
import {
  cameraCutSeconds,
  cameraTimesAt,
  clockForTimeline,
  renderCutTimes,
  setTiming,
  timedDraw,
} from "../src/timing-state.mjs";

test("mixed legacy and identified camera keys at the opening keep their authored order on save", () => {
  setTiming({}, 8, []);
  const clock = clockForTimeline("cam");
  const keys = [
    { t: 0, p: [1, 0, 0], l: [1, 0, 1] },
    { t: 0, id: "second", p: [2, 0, 0], l: [2, 0, 1] },
    { t: 3, p: [3, 0, 0], l: [3, 0, 1] },
  ];
  const projected = mapTimeline("cam", keys, clock);
  projected[2].roll = 0.1;
  assert.deepEqual(mapTimeline("cam", projected, clock, true, keys), [
    keys[0],
    keys[1],
    { ...keys[2], roll: 0.1 },
  ]);
});

test("a shot's output clock keeps moving through freezes while the actor stays fixed", () => {
  const timing = { freezes: [{ at: 2, duration: 3 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const draw = timedDraw((world, clocks) => ({ world, camera: clocks.camera }));
    const late = draw(4);
    assert.equal(late.world, 2);
    assert.equal(late.camera, 16 / 7);
    assert.equal(draw(3).camera, 12 / 7);
    assert.deepEqual(draw(4), late);
    assert.deepEqual(draw(7), { world: 4, camera: 4 });
    assert.ok(cameraSpeed(clockForTimeline("cam"), 0, 4, (u) => u, 3) > 0);
  } finally {
    setTiming({}, 8, []);
  }
});

test("output-clock camera keys project and invert independently of a speed ramp", () => {
  const timing = {
    speeds: [
      {
        from: 0,
        to: 4,
        curve: [
          [0, 0.5],
          [1, 2],
        ],
      },
    ],
  };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const clock = clockForTimeline("cam");
    const rows = [
      { t: 0, id: "start" },
      { t: 2, id: "middle" },
      { t: 4, cut: true, id: "cut" },
    ];
    const projected = mapTimeline("cam", rows, clock);
    assert.ok(Math.abs(projected[1].t * 2 - projected[2].t) < 1e-8);
    assert.deepEqual(mapTimeline("cam", projected, clock, true, rows), rows);
  } finally {
    setTiming({}, 8, []);
  }
});

test("a relocated Freeze within a shot advances the camera across both hold boundaries", () => {
  const timing = { freezes: [{ at: 2, frame: 1, duration: 3 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const sample = timedDraw((world, clocks) => ({ world, camera: clocks.camera }));
    assert.equal(sample(2).world, 1);
    assert.equal(sample(2).camera, 8 / 7);
    assert.ok(sample(2 - 1e-4).camera < sample(2).camera);
    assert.ok(sample(5 - 1e-4).camera < sample(5).camera);
  } finally {
    setTiming({}, 8, []);
  }
});

test("an internal hard cut follows camera time through an output-clock Freeze", () => {
  const timing = { freezes: [{ at: 2, duration: 3 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const clock = clockForTimeline("cam");
    const source = [{ t: 0 }, { t: 2.4, id: "move" }, { t: 4, cut: true }];
    const view = mapTimeline("cam", source, clock);
    const move = view.find((row) => row.id === "move");
    move.cut = true;
    const cut = mapTimeline("cam", view, clock, true, source);
    const placements = mapTimeline("cam", cut, clock).filter((row) => row.id === "move");
    assert.deepEqual(
      placements.map((row) => row.t),
      [move.t],
    );

    const target = 4.5;
    placements[0].t = target;
    const moved = mapTimeline("cam", [view[0], ...placements, view[2]], clock, true, cut);
    assert.equal(moved[1].t, cameraTimesAt(target).camera);
    assert.equal(moved[1].cut, true);
  } finally {
    setTiming({}, 8, []);
  }
});

test("a shot's camera cut stays at its picture boundary when a Freeze starts there", () => {
  setTiming({ freezes: [{ at: 4, duration: 3 }] }, 8, [{ t: 0 }, { t: 4 }]);
  try {
    const clock = clockForTimeline("cam");
    const rows = [{ t: 0 }, { t: 4, cut: true }];
    const view = mapTimeline("cam", rows, clock);
    assert.equal(view[1].t, 4);
    assert.deepEqual(mapTimeline("cam", view, clock, true, rows), rows);
  } finally {
    setTiming({}, 8, []);
  }
});

test("a scene-clock hard cut is marked at the edge where its frame first plays", () => {
  for (const [freeze, expected] of [
    [{ at: 2, duration: 3 }, 2],
    [{ at: 2, frame: 1, duration: 3 }, 5],
  ]) {
    setTiming({ freezes: [freeze] }, 8, [{ t: 0 }, { t: 4 }]);
    try {
      const clock = clockForTimeline("cam");
      const rows = [{ t: 0 }, { t: 2, cut: true }];
      const view = mapTimeline("cam", rows, clock);
      assert.equal(view[1].t, expected);
      assert.ok(cameraTimesAt(expected - 0.001).camera < 2);
      assert.equal(cameraTimesAt(expected).camera, 2);
      assert.deepEqual(mapTimeline("cam", view, clock, true, rows), rows);
    } finally {
      setTiming({}, 8, []);
    }
  }
});

test("editing an output-clock cut stores the same picture boundary for the camera and shot", () => {
  const timing = { freezes: [{ at: 2, duration: 3 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const clock = clockForTimeline("cam");
    const rows = [
      { t: 0, id: "start" },
      { t: 4, cut: true, id: "cut" },
    ];
    const view = mapTimeline("cam", rows, clock);
    assert.equal(view[1].t, 7);
    view[1].t = 6;
    const source = mapTimeline("cam", view, clock, true, rows);
    assert.equal(source[1].t, 3);
    setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 3 }]);
    assert.equal(mapTimeline("cam", source, clockForTimeline("cam"))[1].t, 6);
  } finally {
    setTiming({}, 8, []);
  }
});

test("splitting an output-clock shot preserves the display times and outgoing order of its keys", () => {
  const timing = {
    speeds: [
      {
        from: 0,
        to: 4,
        curve: [
          [0, 0.5],
          [1, 2],
        ],
      },
    ],
  };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const oldClock = clockForTimeline("cam");
    const rows = [
      { t: 0, id: "start" },
      { t: 1.2, id: "actor" },
      { t: 3, id: "room" },
      { t: 4, cut: true, id: "end" },
    ];
    const view = mapTimeline("cam", rows, oldClock);
    const split = oldClock.cameraPicture.outputAt(1);
    view.splice(
      2,
      0,
      { t: split - 0.001, id: "tail" },
      { t: split, id: "cut", cut: true, tailId: "tail" },
    );
    setTiming(timing, 8, [
      { t: 0, cameraClock: "output" },
      { t: 1, cameraClock: "output" },
      { t: 4 },
    ]);
    const newClock = clockForTimeline("cam");
    const raw = mapTimeline("cam", view, newClock, true, rows, {}, oldClock);
    assert.deepEqual(
      raw.map((row) => row.id),
      view.map((row) => row.id),
    );
    assert.ok(raw[1].t < raw[2].t);
    assert.ok(raw[2].t < raw[3].t);
    assert.ok(Math.abs(raw[3].t - 1) < 1e-9);
    const projected = mapTimeline("cam", raw, newClock);
    projected.forEach((row, i) => assert.ok(Math.abs(row.t - view[i].t) < 1e-9));
  } finally {
    setTiming({}, 8, []);
  }
});

test("a cut cannot be placed where the picture clock restores a different visible time", () => {
  const timing = { freezes: [{ at: 2, frame: 1.5, duration: 2 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const clock = clockForTimeline("cam").cameraPicture;
    assert.equal(canPlaceCameraCut(clock, 2), false);
    assert.equal(canPlaceCameraCut(clock, 2.5), false);
    assert.equal(canPlaceCameraCut(clock, 4), false);
    assert.equal(canPlaceCameraCut(clock, 4.033), true);
    assert.equal(canPlaceCameraCut(clock, 1.95), true);
  } finally {
    setTiming({}, 8, []);
  }
});

test("keys in a detached Freeze have two editable placements and one stored row", () => {
  const timing = { freezes: [{ at: 4, frame: 1.5, duration: 2 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 3 }]);
  try {
    const clock = clockForTimeline("cam");
    const start = { t: 0, id: "start" };
    const cut = { t: 3, id: "cut", cut: true };
    const original = [start, cut];
    const view = mapTimeline("cam", original, clock);
    view.push({ t: 5.5, id: "move" });
    const source = mapTimeline("cam", view, clock, true, original);
    assert.deepEqual(
      source.map(({ id, t }) => [id, t]),
      [
        ["start", 0],
        ["move", 2.25],
        ["cut", 3],
      ],
    );
    const projected = mapTimeline("cam", source, clock);
    assert.deepEqual(
      projected.filter((row) => row.id === "move").map(({ t }) => t),
      [2.25, 5.5],
    );
    assert.deepEqual(mapTimeline("cam", projected, clock, true, source), source);
    const later = projected.find((row) => row.id === "move" && row.t === 5.5);
    later.t = 5;
    later.fov = 40;
    assert.deepEqual(mapTimeline("cam", projected, clock, true, source), [
      start,
      { t: 1.5, id: "move", fov: 40 },
      cut,
    ]);
    assert.deepEqual(
      mapTimeline(
        "cam",
        projected.filter((row) => row !== later),
        clock,
        true,
        source,
      ),
      original,
    );
  } finally {
    setTiming({}, 8, []);
  }
});

test("an output-clock camera cut cannot choose opposite sides of a ripple seam", () => {
  const main = [
    { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 2 },
    { id: "b", kind: "clip", sourceFrom: 3, sourceTo: 8 },
  ];
  setTiming({ main }, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const picture = clockForTimeline("cam").cameraPicture;
    assert.equal(picture.sourceAt(2, "before"), 2);
    assert.equal(picture.sourceAt(2), 3);
    assert.equal(canPlaceCameraCut(picture, 2), false);
    assert.equal(canPlaceCameraCut(picture, 2.04), true);
  } finally {
    setTiming({}, 8, []);
  }
});

test("a new key on the exit of a detached Freeze belongs to the frame that resumes playing", () => {
  const timing = { freezes: [{ at: 4, frame: 1.5, duration: 2 }] };
  setTiming(timing, 8, [{ t: 0, cameraClock: "output" }, { t: 3 }]);
  try {
    const clock = clockForTimeline("cam");
    const source = [
      { t: 0, id: "start" },
      { t: 3, id: "cut", cut: true },
    ];
    const view = mapTimeline("cam", source, clock);
    view.push({ t: 6, id: "resume" });
    const actual = mapTimeline("cam", view, clock, true, source);
    assert.deepEqual(actual, [...source, { t: 4, id: "resume" }]);
    assert.deepEqual(
      mapTimeline("cam", actual, clock)
        .filter((row) => row.id === "resume")
        .map(({ t }) => t),
      [6],
    );
  } finally {
    setTiming({}, 8, []);
  }
});

test("camera lookahead follows the active output occurrence through freeze and movement", () => {
  setTiming({ freezes: [{ at: 0, duration: 1 }] }, 8, [{ t: 0, cameraClock: "output" }, { t: 4 }]);
  try {
    const first = cameraTimesAt(0);
    const second = cameraTimesAt(1 / 30);
    assert.equal(first.worldAtCamera(first.camera + 0.25), 0);
    assert.equal(second.worldAtCamera(second.camera + 0.25), 0);
    const moving = cameraTimesAt(1.25);
    assert.ok(Math.abs(moving.worldAtCamera(moving.camera + 0.25) - 0.5625) < 1e-8);
    assert.ok(moving.worldAtCamera(8) < 4);
  } finally {
    setTiming({}, 8, []);
  }
});

// bun run check and reference solve --write read the cam clock a CLI sets up from the film's files alone
test("heardLength sets the camera clock from the film's shots, so an output-clock shot moves through a freeze", () => {
  const dir = mkdtempSync(join(tmpdir(), "heard-shots-"));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  const conf = {
    timingTimeline: "src/timeline/timing.json",
    shotsTimeline: "src/timeline/shots.json",
  };
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 8 }));
  writeFileSync(
    join(dir, conf.timingTimeline),
    JSON.stringify({ freezes: [{ at: 2, duration: 3 }] }),
  );
  writeFileSync(
    join(dir, conf.shotsTimeline),
    JSON.stringify([{ t: 0, cameraClock: "output" }, { t: 4 }]),
  );
  try {
    assert.ok(heardLength(dir, conf));
    assert.equal(clockForTimeline("cam").sourceAt(4), 16 / 7);
  } finally {
    setTiming({}, 8, []);
  }
});

test("camera keys with cut: true cut the picture at their heard second, after a speed ramp too", (t) => {
  t.after(() => setTiming({}, 8, []));
  const keys = [{ t: 0, cut: true }, { t: 1 }, { t: 3, cut: true }, { t: 5 }, { t: 6, cut: true }];
  setTiming({}, 8, []);
  assert.deepEqual(cameraCutSeconds(keys), [3, 6]);
  // the first two source seconds play in one
  setTiming({ speeds: [{ from: 0, to: 2, rate: 2 }] }, 8, []);
  assert.deepEqual(cameraCutSeconds(keys), [2, 5]);
  // a Freeze starting on the cut holds the new camera's first frame: the picture cuts where the Freeze starts
  const at = (t) => [{ t: 0 }, { t, cut: true }];
  setTiming({ freezes: [{ at: 4, duration: 3 }] }, 8, [{ t: 0 }, { t: 4 }]);
  assert.deepEqual(cameraCutSeconds(at(4)), [4]);
  setTiming({ freezes: [{ at: 2, duration: 3 }] }, 8, [{ t: 0 }, { t: 4 }]);
  assert.deepEqual(cameraCutSeconds(at(2)), [2]);
});

// a render's cuts: its shots' starts and its camera keys' cuts, each once, in order; a cam.json of { keys } reads the same
test("a render's cuts join the shots' starts and the camera keys' cuts", (t) => {
  t.after(() => setTiming({}, 8, []));
  setTiming({}, 8, []);
  const keys = [{ t: 0 }, { t: 4, cut: true }, { t: 6, cut: true }];
  assert.deepEqual(renderCutTimes([4, 2], keys), [2, 4, 6]);
  assert.deepEqual(renderCutTimes([4], { keys }), [4, 6]);
});
