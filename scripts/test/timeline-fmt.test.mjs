import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

    const camGuard = openEditProtection(dir, "src/timeline/cam.json");
    const camBase = [{ t: 0, p: [0, 2, 4], l: [0, 1, 0] }];
    const camHuman = JSON.parse(MESSY_CAM);
    camGuard.remember("v1", camBase);
    camGuard.protect(camBase, camHuman, "person");
    camGuard.remember("v2", camHuman);

    const shotsGuard = openEditProtection(dir, "src/timeline/shots.json");
    shotsGuard.reset("v1", JSON.parse(messyShots));

    const propsGuard = openEditProtection(dir, "src/timeline/props.json");
    const propsBefore = { crate: [{ t: 0, at: [1, 0, 0] }] };
    const propsAfter = JSON.parse(MESSY_PROPS);
    propsGuard.remember("v1", propsBefore);
    propsGuard.protect(propsBefore, propsAfter, "person");
    propsGuard.protect(propsAfter, propsAfter, "ai");
    propsGuard.protect(propsBefore, propsAfter, "ai");
    expect(propsGuard.report().protected).toEqual([]);

    const res = runFmt([], dir);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("skipped (Studio-protected): cam.json");
    expect(res.stdout).toContain("skipped (Studio-protected): shots.json");
    expect(res.stdout).not.toContain("skipped (Studio-protected): props.json");
    expect(res.stdout).not.toContain("skipped (Studio-protected): cast.json");

    expect(readFileSync(camFile, "utf8")).toBe(MESSY_CAM);
    expect(readFileSync(shotsFile, "utf8")).toBe(messyShots);

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
      const studioMeta = join(dir, ".studio/meta.json");
      const nodeModPkg = join(dir, "node_modules/pkg/package.json");
      mkdirSync(join(dir, ".studio"), { recursive: true });
      mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
      writeFileSync(castFile, MESSY_CAST);
      writeFileSync(sceneFile, "export const x = 1;\n");
      writeFileSync(brokenFile, "{bad json");
      writeFileSync(studioMeta, '{   "internal": true  }');
      writeFileSync(nodeModPkg, '{   "name": "pkg"  }');

      const badCases = [
        { argv: ["cast", "missing"], err: /missing|not found|ENOENT/i },
        { argv: ["cast", "../escape.json"], err: /escapes film directory/i },
        { argv: ["cast", outsideFile], err: /escapes film directory/i },
        { argv: ["cast", "src/scene.ts"], err: /\.json/i },
        { argv: [".."], err: /escapes film directory|\.json/i },
        { argv: ["cast", "broken"], err: /broken\.json/i },
        { argv: ["cast", ".studio/meta.json"], err: /internal|\.studio/i },
        { argv: ["cast", "node_modules/pkg/package.json"], err: /internal|node_modules/i },
        { argv: ["--bogus"], err: /unknown option/i },
      ];

      for (const { argv, err } of badCases) {
        const res = runFmt(argv, dir);
        expect(res.status, `args=${JSON.stringify(argv)} stdout=${res.stdout}`).toBe(2);
        expect(res.stderr, `args=${JSON.stringify(argv)}`).toMatch(err);
        expect(readFileSync(castFile, "utf8"), `args=${JSON.stringify(argv)}`).toBe(MESSY_CAST);
        expect(readFileSync(outsideFile, "utf8")).toBe('{   "outside": true  }');
        expect(readFileSync(studioMeta, "utf8")).toBe('{   "internal": true  }');
        expect(readFileSync(nodeModPkg, "utf8")).toBe('{   "name": "pkg"  }');
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

test("corrupt collaboration state fails closed, duplicate args deduplicate, and dir.json / bare .json are handled safely", () => {
  withFilm((dir) => {
    const camFile = join(dir, "src/timeline/cam.json");
    const castFile = join(dir, "src/timeline/cast.json");
    const bareJson = join(dir, "src/timeline/.json");
    const dirJson = join(dir, "src/timeline/dir.json");
    writeFileSync(camFile, MESSY_CAM);
    writeFileSync(castFile, MESSY_CAST);
    writeFileSync(bareJson, "[ 1,  2 ]");
    mkdirSync(dirJson);

    const collabDir = join(dir, ".studio/collaboration");
    mkdirSync(collabDir, { recursive: true });
    const camKey = createHash("sha256").update("src/timeline/cam.json").digest("hex");
    writeFileSync(join(collabDir, `${camKey}.json`), "{corrupt json");

    const zeroRes = runFmt([], dir);
    expect(zeroRes.status, zeroRes.stderr).toBe(0);
    expect(zeroRes.stdout).toContain("skipped (Studio-protected): cam.json");
    expect(readFileSync(camFile, "utf8")).toBe(MESSY_CAM);
    expect(readFileSync(bareJson, "utf8")).toBe("[ 1,  2 ]");
    expect(readFileSync(castFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAST))}\n`);

    const expCam = runFmt(["cam"], dir);
    expect(expCam.status, expCam.stderr).toBe(0);
    expect(expCam.stderr).toMatch(/warning:.*cam\.json.*Studio-protected/i);
    expect(readFileSync(camFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAM))}\n`);

    writeFileSync(castFile, MESSY_CAST);
    const dupRes = runFmt(["cast", "src/timeline/cast.json"], dir);
    expect(dupRes.status, dupRes.stderr).toBe(0);
    const castLines = dupRes.stdout.split("\n").filter((l) => l.startsWith("cast.json "));
    expect(castLines).toHaveLength(1);

    expect(runFmt(["src/timeline/dir.json"], dir).status).toBe(2);
    expect(runFmt(["src/timeline/.json"], dir).status).toBe(2);
  });
});

test("symlink/junction targets inside or replacing src/timeline exit 2 without writing", () => {
  withFilm((dir) => {
    const outerDir = mkdtempSync(join(tmpdir(), "timeline-fmt-link-"));
    try {
      const outsideFile = join(outerDir, "linked.json");
      writeFileSync(outsideFile, '{   "outside": true  }');
      const castFile = join(dir, "src/timeline/cast.json");
      writeFileSync(castFile, MESSY_CAST);

      const linkDir = join(dir, "src/timeline/linkdir.json");
      let linkedFile = false;
      try {
        symlinkSync(outsideFile, join(dir, "src/timeline/link.json"), "file");
        linkedFile = true;
      } catch {
        symlinkSync(outerDir, linkDir, "junction");
      }

      if (linkedFile) {
        const expRes = runFmt(["src/timeline/link.json"], dir);
        expect(expRes.status).toBe(2);
        expect(expRes.stderr).toMatch(/symlink|junction|escapes/i);

        const zeroRes = runFmt([], dir);
        expect(zeroRes.status).toBe(2);
        expect(readFileSync(castFile, "utf8")).toBe(MESSY_CAST);
        expect(readFileSync(outsideFile, "utf8")).toBe('{   "outside": true  }');
      } else {
        const expRes = runFmt(["src/timeline/linkdir.json/linked.json"], dir);
        expect(expRes.status).toBe(2);
        expect(expRes.stderr).toMatch(/symlink|junction|escapes/i);

        const zeroRes = runFmt([], dir);
        expect(zeroRes.status).toBe(2);
        expect(zeroRes.stderr).toMatch(/symlink|junction|escapes/i);
        expect(readFileSync(castFile, "utf8")).toBe(MESSY_CAST);
        expect(readFileSync(outsideFile, "utf8")).toBe('{   "outside": true  }');
      }

      const dir2 = mkdtempSync(join(tmpdir(), "timeline-fmt-linkdir-"));
      try {
        mkdirSync(join(dir2, "src"), { recursive: true });
        symlinkSync(
          outerDir,
          join(dir2, "src/timeline"),
          process.platform === "win32" ? "junction" : "dir",
        );
        const zeroDirRes = runFmt([], dir2);
        expect(zeroDirRes.status).toBe(2);
        expect(zeroDirRes.stderr).toMatch(/symlink|junction|escapes/i);
        expect(readFileSync(outsideFile, "utf8")).toBe('{   "outside": true  }');
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      rmSync(outerDir, { recursive: true, force: true });
    }
  });
});

test("Windows case-mismatch between on-disk filename and lowercase Studio guard stays protected", () => {
  if (process.platform !== "win32") return;
  withFilm((dir) => {
    const camMixed = join(dir, "src/timeline/Cam.json");
    const castFile = join(dir, "src/timeline/cast.json");
    writeFileSync(camMixed, MESSY_CAM);
    writeFileSync(castFile, MESSY_CAST);

    const camGuard = openEditProtection(dir, "src/timeline/cam.json");
    camGuard.reset("v1", JSON.parse(MESSY_CAM));

    const zeroRes = runFmt([], dir);
    expect(zeroRes.status, zeroRes.stderr).toBe(0);
    expect(zeroRes.stdout).toMatch(/skipped \(Studio-protected\): Cam\.json/i);
    expect(readFileSync(camMixed, "utf8")).toBe(MESSY_CAM);
    expect(readFileSync(castFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAST))}\n`);

    const expRes = runFmt(["Cam"], dir);
    expect(expRes.status, expRes.stderr).toBe(0);
    expect(expRes.stderr).toMatch(/warning:.*Cam\.json.*Studio-protected/i);
    expect(readFileSync(camMixed, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAM))}\n`);
  });
});

test("Windows explicit formatting with mismatched casing preserves exact on-disk filename casing", () => {
  if (process.platform !== "win32") return;
  withFilm((dir) => {
    const timelineDir = join(dir, "src/timeline");
    const castFile = join(timelineDir, "cast.json");
    writeFileSync(castFile, MESSY_CAST);

    const stemRes = runFmt(["CAST"], dir);
    expect(stemRes.status, stemRes.stderr).toBe(0);
    expect(readdirSync(timelineDir)).toEqual(["cast.json"]);
    expect(readFileSync(castFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAST))}\n`);

    writeFileSync(castFile, MESSY_CAST);
    const pathRes = runFmt(["src/timeline/CAST.json"], dir);
    expect(pathRes.status, pathRes.stderr).toBe(0);
    expect(readdirSync(timelineDir)).toEqual(["cast.json"]);
    expect(readFileSync(castFile, "utf8")).toBe(`${dump(JSON.parse(MESSY_CAST))}\n`);
  });
});
