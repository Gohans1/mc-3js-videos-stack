import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openGrades } from "../src/grades.mjs";

const cube = 'TITLE "Warm test"\nLUT_3D_SIZE 2\n' + Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n');
test("an imported LUT and saved preset reopen in a different film without the original file", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-grades-"));
  try {
    const presets = join(root, "presets.json"), a = openGrades(join(root, "film-a"), presets), b = openGrades(join(root, "film-b"), presets);
    const lut = a.addLut({ name: "warm.cube", source: cube });
    const preset = a.savePreset("Warm", { basic: { exposure: 12 }, lut: { ...lut, amount: 65 } });
    const grade = b.applyPreset(preset.id);
    assert.equal(grade.basic.exposure, 12);
    assert.equal(grade.lut.amount, 65);
    assert.equal(readFileSync(join(root, "film-b", grade.lut.url), "utf8"), cube);
    assert.equal(b.list().presets[0].name, "Warm");
    assert.equal(b.list().luts.length, 1);
    const again = b.addLut({ name: "copy.cube", source: cube });
    assert.equal(again.url, grade.lut.url);
    assert.equal(b.list().luts.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bad LUT data is rejected and unreadable presets are never overwritten", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-grades-"));
  try {
    const file = join(root, "presets.json"), store = openGrades(join(root, "public"), file);
    for (const source of ['LUT_3D_SIZE 999999\n0 0 0', 'LUT_3D_SIZE 2\n0 0 0', cube + '\n1 1 1']) {
      assert.throws(() => store.addLut({ name: "bad.cube", source }));
    }
    assert.deepEqual(store.list().luts, []);
    writeFileSync(file, "not json");
    assert.throws(() => store.savePreset("Warm", { basic: { temp: 25 } }));
    assert.equal(readFileSync(file, "utf8"), "not json");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
