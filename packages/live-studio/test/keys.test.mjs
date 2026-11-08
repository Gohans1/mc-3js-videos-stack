import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { KeyFile, keyRows, problems, rowAt } from "../src/contract.mjs";
import { compactJson, openTimelineFile } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-keys-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("key rows: every list of timed keys, at any depth; lists of other things and empty lists are not rows", () => {
  const v = { at: [1, 2, 3], moves: [{ t: 0, pose: "lie" }, { t: 2 }], screen: { on: 4, typing: { tries: [{ t: 5, text: "a" }] } }, pages: [{ title: "x" }], empty: [] };
  assert.deepEqual(keyRows(v), [["moves"], ["screen", "typing", "tries"]]);
  assert.deepEqual(rowAt(v, ["screen", "typing", "tries"]), [{ t: 5, text: "a" }]);
  assert.deepEqual(keyRows([{ t: 0 }, { t: 1 }]), [[]]);
});

test("a key file passes with its rows in time order, and names the row that isn't", () => {
  assert.deepEqual(problems(KeyFile, { a: [{ t: 0 }, { t: 0 }, { t: 1 }] }, "keys"), []);
  assert.match(problems(KeyFile, { s: { a: [{ t: 0 }, { t: 2 }, { t: 1 }] } }, "keys").join(), /order of time[^]*s\.a\[2\]/);
});

test("a film's Steve and prop keys as timeline_fmt.py wrote them pass and come back unchanged but for whole-number floats", () => {
  for (const rel of ["steve.json", "props.json"]) {
    const text = readFileSync(join(import.meta.dirname, "fixtures/timeline", rel), "utf8");
    const v = JSON.parse(text);
    assert.deepEqual(problems(KeyFile, v, rel), []);
    assert.ok(keyRows(v).length > 0, rel);
    assert.equal(compactJson(v) + "\n", text.replace(/\r\n/g, "\n").replace(/(\d)\.0(?=[,\]}\s])/g, "$1"), rel);
  }
});

test("a key file is written only over the version the page saw, and only when every row stays in order", () => {
  const file = join(dir, "props.json");
  writeFileSync(file, JSON.stringify({ chair: [{ t: 0, dx: 0 }, { t: 1, dx: 0.2 }], note: "kept" }));
  const keys = openTimelineFile(dir, "props.json", KeyFile);
  const { version, data } = keys.read();
  assert.ok(keys.write(version, { ...data, chair: [{ t: 1 }, { t: 0 }] }).problems);
  data.chair[1].t = 1.5;
  assert.ok(keys.write(version, data).version);
  assert.ok(keys.ownWrite());
  assert.equal(JSON.parse(readFileSync(file, "utf8")).note, "kept");
  assert.deepEqual(keys.write(version, data), { conflict: true });
});
