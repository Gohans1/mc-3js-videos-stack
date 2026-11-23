import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = resolve(HERE, "../check.mjs");

const makeFilm = (castData, extraKeyFiles = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "check-nested-keys-"));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "nested-keys-test",
        "live-studio": {
          keyFiles: {
            "src/timeline/cast.json": "cast",
            ...extraKeyFiles,
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 5;\n");
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ voice: { edits: {}, warp: [] }, beats: {}, end: 5 }, null, 2),
  );
  writeFileSync(join(dir, "src/timeline/cast.json"), JSON.stringify(castData, null, 2));
  return dir;
};

const runCheck = (dir, extra = []) =>
  spawnSync(process.execPath, [CHECK_SCRIPT, ...extra], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000,
  });

test("check.mjs warns when a keyFile contains an object array hiding nested timed {t} rows, and clears once keyed as a map", (t) => {
  const dir = makeFilm({
    thugs: [
      { id: "boss", moves: [{ t: 0, at: [0, 0, 0] }] },
      { id: "grunt", moves: [{ t: 1, at: [1, 0, 0] }] },
    ],
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const textRes = runCheck(dir);
  assert.equal(textRes.status, 0, textRes.stderr);
  assert.match(
    textRes.stdout,
    /⚠ src\/timeline\/cast\.json "thugs": array of objects hides nested timed \{t\} rows/,
  );

  const jsonRes = runCheck(dir, ["--json"]);
  assert.equal(jsonRes.status, 0, jsonRes.stderr);
  const parsed = JSON.parse(jsonRes.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.problems.length, 0);
  assert.ok(
    parsed.warnings.some(
      (w) => w.includes('src/timeline/cast.json "thugs"') && w.includes("keyRows()"),
    ),
    JSON.stringify(parsed.warnings),
  );

  writeFileSync(
    join(dir, "src/timeline/cast.json"),
    JSON.stringify(
      {
        thugs: {
          boss: { moves: [{ t: 0, at: [0, 0, 0] }] },
          grunt: { moves: [{ t: 1, at: [1, 0, 0] }] },
        },
      },
      null,
      2,
    ),
  );

  const cleanRes = runCheck(dir, ["--json"]);
  assert.equal(cleanRes.status, 0, cleanRes.stderr);
  const cleanParsed = JSON.parse(cleanRes.stdout);
  assert.equal(cleanParsed.ok, true);
  assert.equal(
    cleanParsed.warnings.filter((w) => w.includes("keyRows()")).length,
    0,
    JSON.stringify(cleanParsed.warnings),
  );
});

test("check.mjs skips placed keyFile and reports root-level nested arrays cleanly", (t) => {
  const dir = makeFilm([{ id: "hero", moves: [{ t: 0 }] }], {
    "src/timeline/placed.json": "placed",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "src/timeline/placed.json"),
    JSON.stringify({
      chair: {
        what: "block:gohans:computer_beige",
        keys: [{ t: 0, at: [0, 0, 0] }],
        extra: [{ id: "part", moves: [{ t: 1 }] }],
      },
    }),
  );

  const res = runCheck(dir, ["--json"]);
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.ok(
    parsed.warnings.some((w) => w.includes("src/timeline/cast.json (root array)")),
    JSON.stringify(parsed.warnings),
  );
  assert.equal(
    parsed.warnings.some((w) => w.includes("placed.json") && w.includes("keyRows()")),
    false,
  );
});
