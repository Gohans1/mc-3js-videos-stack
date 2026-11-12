import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { KeyFile, keyFileSchema, keyRows, problems, rowAt } from "../src/contract.ts";
import { compactJson, openTimelineFile } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-keys-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("deleting the last required pose cannot save a film that crashes, while optional targets may be cleared", () => {
  const initial = {
    moves: [{ t: 4, at: [1, 0, 2], yaw: 0, pose: "stand" }],
    look: [{ t: 6, to: "door" }],
  };
  writeFileSync(join(dir, "required.json"), JSON.stringify(initial));
  const file = openTimelineFile(dir, "required.json", keyFileSchema([["moves"]]));
  const before = file.read();
  assert.ok(file.write(before.version, { ...initial, moves: [] }).problems);
  assert.deepEqual(file.read(), before);
  assert.ok(file.write(before.version, { ...initial, look: [] }).version);
  assert.deepEqual(file.read().data, { ...initial, look: [] });
});

test("key rows: every list of timed keys, at any depth; lists of other things and empty lists are not rows", () => {
  const v = {
    at: [1, 2, 3],
    moves: [{ t: 0, pose: "lie" }, { t: 2 }],
    screen: { on: 4, typing: { tries: [{ t: 5, text: "a" }] } },
    pages: [{ title: "x" }],
    empty: [],
  };
  assert.deepEqual(keyRows(v), [["moves"], ["screen", "typing", "tries"]]);
  assert.deepEqual(rowAt(v, ["screen", "typing", "tries"]), [{ t: 5, text: "a" }]);
  assert.deepEqual(keyRows([{ t: 0 }, { t: 1 }]), [[]]);
});

test("single timed event objects with finite t become key rows while untimed or custom-named prop shapes stay untouched", () => {
  const props = {
    desk: { t: 75.85, at: [0.6, 1, 9.6], yaw: 90 },
    out: { t: 94.27, dur: 0.6, to: [2.05, 10.45], yaw: -25 },
    scrap: { at: [0.82, 9.47], yaw: 25, grab: 98.82, read: 99.72 },
    button: { cell: [3, 1, 10], presses: [42.85, 43.35] },
    files: [{ folder: 0, grab: 84.893, face: 85.136, release: 86.503, yaw: 215 }],
  };
  assert.deepEqual(keyRows(props), [["desk"], ["out"]]);
  assert.deepEqual(problems(keyFileSchema([["desk"]]), props, "props.json"), []);
  assert.match(problems(KeyFile, { desk: { t: Number.NaN } }, "props.json").join() || "ok", /ok/);
});

test("a key file passes with its rows in time order, and names the row that isn't", () => {
  assert.deepEqual(problems(KeyFile, { a: [{ t: 0 }, { t: 0 }, { t: 1 }] }, "keys"), []);
  assert.match(
    problems(KeyFile, { s: { a: [{ t: 0 }, { t: 2 }, { t: 1 }] } }, "keys").join(),
    /order of time[^]*s\.a\[2\]/,
  );
});

test("a film's Steve and prop keys as timeline_fmt.py wrote them pass and come back unchanged but for whole-number floats", () => {
  for (const rel of ["steve.json", "props.json"]) {
    const text = readFileSync(join(import.meta.dirname, "fixtures/timeline", rel), "utf8");
    const v = JSON.parse(text);
    assert.deepEqual(problems(KeyFile, v, rel), []);
    assert.ok(keyRows(v).length > 0, rel);
    assert.equal(
      compactJson(v) + "\n",
      text.replace(/\r\n/g, "\n").replace(/(\d)\.0(?=[,\]}\s])/g, "$1"),
      rel,
    );
  }
});

test("a key file is written only over the version the page saw, and only when every row stays in order", () => {
  const file = join(dir, "props.json");
  writeFileSync(
    file,
    JSON.stringify({
      chair: [
        { t: 0, dx: 0 },
        { t: 1, dx: 0.2 },
      ],
      note: "kept",
    }),
  );
  const keys = openTimelineFile(dir, "props.json", KeyFile);
  const { version, data } = keys.read();
  assert.ok(keys.write(version, { ...data, chair: [{ t: 1 }, { t: 0 }] }).problems);
  data.chair[1].t = 1.5;
  assert.ok(keys.write(version, data).version);
  assert.ok(keys.ownWrite());
  assert.equal(JSON.parse(readFileSync(file, "utf8")).note, "kept");
  assert.deepEqual(keys.write(version, data), { conflict: true });
});
