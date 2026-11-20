import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { openEditProtection } from "../../packages/live-studio/src/edit-protection.mjs";
import { dump, load, save } from "../timeline_fmt.ts";

const ROOT = resolve(import.meta.dir, "../..");
const FMT = join(ROOT, "scripts/timeline_fmt.ts");

const runFmt = (args, cwd) =>
  spawnSync("bun", [FMT, ...args], { cwd, encoding: "utf8", timeout: 30_000 });

const withFilm = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "timeline-fmt-"));
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const MESSY_CAST = '[\n  {\n    "t": 0,\n    "at": [ 1,   2, 3 ]\n  }\n]';
const MESSY_PROPS = '{\n  "crate":   [\n    { "t": 0,  "at": [0, 0, 0] }\n  ]\n}';
const MESSY_CAM = '[\n  {\n    "t": 0,\n    "p": [ 0, 2, 5 ],\n    "l": [ 0, 1, 0 ]\n  }\n]';

test("selective formatting by bare stem leaves other timeline files byte-for-byte untouched", () => {
  withFilm((dir) => {
    const castFile = join(dir, "src/timeline/cast.json");
    const propsFile = join(dir, "src/timeline/props.json");
    const camFile = join(dir, "src/timeline/cam.json");
    writeFileSync(castFile, MESSY_CAST);
    writeFileSync(propsFile, MESSY_PROPS);
    writeFileSync(camFile, MESSY_CAM);

    const res = runFmt(["cast"], dir);
    expect(res.status, res.stderr).toBe(0);
    expect(readFileSync(castFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAST))}\n`);
    expect(readFileSync(propsFile, "utf8")).toBe(MESSY_PROPS);
    expect(readFileSync(camFile, "utf8")).toBe(MESSY_CAM);
  });
});

test("selective formatting by relative paths formats only named files", () => {
  withFilm((dir) => {
    const castFile = join(dir, "src/timeline/cast.json");
    const propsFile = join(dir, "src/timeline/props.json");
    const camFile = join(dir, "src/timeline/cam.json");
    writeFileSync(castFile, MESSY_CAST);
    writeFileSync(propsFile, MESSY_PROPS);
    writeFileSync(camFile, MESSY_CAM);

    const res = runFmt(["src/timeline/props.json", "src/timeline/cam.json"], dir);
    expect(res.status, res.stderr).toBe(0);
    expect(readFileSync(castFile, "utf8")).toBe(MESSY_CAST);
    expect(readFileSync(propsFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_PROPS))}\n`);
    expect(readFileSync(camFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAM))}\n`);
  });
});

test("zero-arg mode skips Studio-protected files and formats remaining unprotected files", () => {
  withFilm((dir) => {
    const camFile = join(dir, "src/timeline/cam.json");
    const shotsFile = join(dir, "src/timeline/shots.json");
    const propsFile = join(dir, "src/timeline/props.json");
    const castFile = join(dir, "src/timeline/cast.json");
    const messyShots = '[\n  {\n    "t": 0,\n    "name": "open"\n  }\n]';

    writeFileSync(camFile, MESSY_CAM);
    writeFileSync(shotsFile, messyShots);
    writeFileSync(propsFile, MESSY_PROPS);
    writeFileSync(castFile, MESSY_CAST);

    // 1. Field-level human guard on cam.json
    const camGuard = openEditProtection(dir, "src/timeline/cam.json");
    const camBase = [{ t: 0, p: [0, 2, 4], l: [0, 1, 0] }];
    const camHuman = JSON.parse(MESSY_CAM);
    camGuard.remember("v1", camBase);
    camGuard.protect(camBase, camHuman, "person");
    camGuard.remember("v2", camHuman);

    // 2. Whole-file guard on shots.json (e.g. after Studio history restore)
    const shotsGuard = openEditProtection(dir, "src/timeline/shots.json");
    shotsGuard.reset("v1", JSON.parse(messyShots));

    // 3. Previously guarded props.json whose guard was cleared by AI collab write (guards: [])
    const propsGuard = openEditProtection(dir, "src/timeline/props.json");
    const propsBefore = { crate: [{ t: 0, at: [1, 0, 0] }] };
    const propsAfter = JSON.parse(MESSY_PROPS);
    propsGuard.remember("v1", propsBefore);
    propsGuard.protect(propsBefore, propsAfter, "person");
    propsGuard.protect(propsAfter, propsAfter, "ai");
    // Overwrite same path as ai to clear the guard completely
    propsGuard.protect(propsBefore, propsAfter, "ai");
    expect(propsGuard.report().protected).toEqual([]);

    const res = runFmt([], dir);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("skipped (Studio-protected): cam.json");
    expect(res.stdout).toContain("skipped (Studio-protected): shots.json");
    expect(res.stdout).not.toContain("skipped (Studio-protected): props.json");
    expect(res.stdout).not.toContain("skipped (Studio-protected): cast.json");

    // Protected files untouched byte-for-byte
    expect(readFileSync(camFile, "utf8")).toBe(MESSY_CAM);
    expect(readFileSync(shotsFile, "utf8")).toBe(messyShots);

    // Unprotected files formatted
    expect(readFileSync(propsFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_PROPS))}\n`);
    expect(readFileSync(castFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAST))}\n`);
  });
});

test("explicitly naming a Studio-protected file warns on stderr and formats it as requested", () => {
  withFilm((dir) => {
    const camFile = join(dir, "src/timeline/cam.json");
    const castFile = join(dir, "src/timeline/cast.json");
    writeFileSync(camFile, MESSY_CAM);
    writeFileSync(castFile, MESSY_CAST);

    const camGuard = openEditProtection(dir, "src/timeline/cam.json");
    camGuard.reset("v1", JSON.parse(MESSY_CAM));

    const res = runFmt(["cam"], dir);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/warning:.*cam\.json.*Studio-protected/i);
    expect(readFileSync(camFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAM))}\n`);
    expect(readFileSync(castFile, "utf8")).toBe(MESSY_CAST);
  });
});

test("invalid, missing, non-json, and path-traversal arguments exit 2 without modifying any files", () => {
  withFilm((dir) => {
    const outerDir = mkdtempSync(join(tmpdir(), "timeline-fmt-outside-"));
    try {
      const outsideFile = join(outerDir, "secret.json");
      writeFileSync(outsideFile, '{   "outside": true  }');

      const castFile = join(dir, "src/timeline/cast.json");
      const sceneFile = join(dir, "src/scene.ts");
      const brokenFile = join(dir, "src/timeline/broken.json");
      writeFileSync(castFile, MESSY_CAST);
      writeFileSync(sceneFile, "export const x = 1;\n");
      writeFileSync(brokenFile, "{bad json");

      const badCases = [
        { argv: ["cast", "missing"], err: /missing|not found|ENOENT/i },
        { argv: ["cast", "../escape.json"], err: /escapes film directory/i },
        { argv: ["cast", outsideFile], err: /escapes film directory/i },
        { argv: ["cast", "src/scene.ts"], err: /\.json/i },
        { argv: [".."], err: /escapes film directory|\.json/i },
        { argv: ["cast", "broken"], err: /broken\.json/i },
        { argv: ["--bogus"], err: /unknown option/i },
      ];

      for (const { argv, err } of badCases) {
        const res = runFmt(argv, dir);
        expect(res.status, `args=${JSON.stringify(argv)} stdout=${res.stdout}`).toBe(2);
        expect(res.stderr, `args=${JSON.stringify(argv)}`).toMatch(err);
        expect(readFileSync(castFile, "utf8"), `args=${JSON.stringify(argv)}`).toBe(MESSY_CAST);
        expect(readFileSync(outsideFile, "utf8")).toBe('{   "outside": true  }');
      }
    } finally {
      rmSync(outerDir, { recursive: true, force: true });
    }
  });
});

test("--help documents optional arguments and skips, and module exports dump/load/save intact", () => {
  withFilm((dir) => {
    const res = runFmt(["--help"], dir);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/stem\|path/i);
    expect(res.stdout).toMatch(/Studio-protected/i);

    const tDir = join(dir, "src/timeline");
    save("sample", [{ t: 0, x: 1 }], tDir);
    expect(load("sample", tDir)).toEqual([{ t: 0, x: 1 }]);
  });
});
