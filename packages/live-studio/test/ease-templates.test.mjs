import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  bezierEaseFn,
  DEFAULT_CUSTOM_CURVE,
  easeToBezierWith,
  endSlope,
  entryHandleForSlope,
  fitBezier,
  startSlope,
} from "../app/core/ease-math.ts";
import { openEaseTemplates } from "../src/ease-templates.mjs";

const clamp = (v) => Math.max(-1.5, Math.min(2.5, v));
const testEaseFn = (e) => {
  if (Array.isArray(e)) return bezierEaseFn(e);
  return e === "linear" ? (x) => x : (x) => x * x * (3 - 2 * x);
};

test("openEaseTemplates persists templates atomically and protects corrupt files", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-ease-templates-"));
  try {
    const file = join(root, "ease-templates.json");
    const store = openEaseTemplates(file);
    assert.deepEqual(store.list(), []);

    const created = store.save("Whip Snap", [0.4, 0.1, 0.2, 1], { basedOn: "Lift Out" });
    assert.equal(created.name, "Whip Snap");
    assert.deepEqual(created.curve, [0.4, 0.1, 0.2, 1]);
    assert.equal(created.basedOn, "Lift Out");
    assert.ok(created.id);

    const updated = store.save("Whip Snap v2", [0.35, 0.15, 0.25, 0.98], { id: created.id });
    assert.equal(updated.id, created.id);
    assert.equal(updated.name, "Whip Snap v2");
    assert.deepEqual(updated.curve, [0.35, 0.15, 0.25, 0.98]);
    assert.equal(store.list().length, 1);

    const reopened = openEaseTemplates(file);
    assert.equal(reopened.list().length, 1);
    assert.equal(reopened.list()[0].name, "Whip Snap v2");

    store.remove(created.id);
    assert.deepEqual(store.list(), []);

    writeFileSync(file, "not valid json");
    assert.throws(() => store.save("Broken", [0.42, 0, 0.58, 1]));
    assert.equal(readFileSync(file, "utf8"), "not valid json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fitBezier and easeToBezierWith match exact presets and closely approximate non-bezier functions", () => {
  const fSmooth = (x) => x * x * (3 - 2 * x) * 0.6 + x * 0.4;
  const fitted = fitBezier(fSmooth);
  assert.equal(fitted.length, 4);
  const fApprox = testEaseFn(fitted);
  assert.ok(fApprox);
  for (let i = 0; i <= 10; i++) {
    const x = i / 10;
    assert.ok(
      Math.abs(fApprox(x) - fSmooth(x)) < 0.03,
      `diff at ${x}: ${fApprox(x)} vs ${fSmooth(x)}`,
    );
  }

  assert.deepEqual(
    easeToBezierWith([0.1, 0.2, 0.8, 0.9], "smooth", () => null),
    [0.1, 0.2, 0.8, 0.9],
  );
  assert.deepEqual(
    easeToBezierWith("linear", "smooth", () => null),
    [0, 0, 1, 1],
  );
  assert.deepEqual(
    easeToBezierWith("liftOut", "smooth", () => null),
    [0.399, 0.329, 0.148, 0.966],
  );
});

test("entryHandleForSlope matches incoming physical speed across different segment durations", () => {
  const prevFn = testEaseFn([0.42, 0, 0.72, 0.78]);
  const inSlope = endSlope(prevFn);
  assert.ok(inSlope > 0.2);

  const prevDuration = 1.5;
  const currDuration = 3.0;
  const targetSlope = (inSlope / prevDuration) * currDuration;
  const [x1, y1] = entryHandleForSlope(targetSlope);
  const aligned = [x1, clamp(y1), DEFAULT_CUSTOM_CURVE[2], DEFAULT_CUSTOM_CURVE[3]];
  const nextFn = testEaseFn(aligned);
  const vIn = inSlope / prevDuration;
  const vOut = startSlope(nextFn) / currDuration;
  assert.ok(Math.abs(vIn - vOut) < 0.03, `vIn=${vIn} vOut=${vOut}`);
  assert.equal(aligned[2], 0.58);
  assert.equal(aligned[3], 1);
});
