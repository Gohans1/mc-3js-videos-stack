import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import * as z from "zod";

import { createActivity } from "../src/activity.mjs";
import { createApi } from "../src/api.mjs";
import {
  openEditProtection,
  resetProtectedFiles,
  warnProtectedEdits,
} from "../src/edit-protection.mjs";
import { openFilm } from "../src/film.mjs";
import { openTimelineFile } from "../src/timeline_file.mjs";

const CLI_URL = pathToFileURL(join(import.meta.dirname, "../src/cli.mjs")).href;
const COLLAB = join(import.meta.dirname, "../collab.mjs");

const captureWarnings = (project) => {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    warnProtectedEdits(project);
  } finally {
    console.error = orig;
  }
  return lines;
};

const makeDir = (t, prefix = "collab-guard-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const readAuditLog = (project) =>
  readFileSync(join(project, ".studio/collaboration/notices.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("pending notice warns until non-human protect resolves it, preserves notices.jsonl, and re-arms on new collision", (t) => {
  const project = makeDir(t);
  const rel = "src/timeline/cam.json";
  const protection = openEditProtection(project, rel);
  const initial = { camera: 50, color: "cold" };
  const human = { camera: 60, color: "warm" };
  protection.remember("v1", initial);
  protection.protect(initial, human, "person");
  protection.remember("v2", human);

  // Direct write collides with human edits -> creates pending notice
  const merged = protection.reconcile({ camera: 50, color: "cold" }, () => []);
  assert.deepEqual(merged, human);

  // Fires repeatedly before resolution (never auto-silenced by reads)
  const firstWarn = captureWarnings(project);
  const secondWarn = captureWarnings(project);
  assert.equal(firstWarn.length, 1);
  assert.match(firstWarn[0], /Studio retained human edits in src\/timeline\/cam\.json/);
  assert.equal(secondWarn.length, 1);

  // Another person edit does NOT acknowledge the pending notice
  const humanAgain = { camera: 65, color: "warm" };
  protection.protect(human, humanAgain, "person");
  protection.remember("v3", humanAgain);
  assert.equal(captureWarnings(project).length, 1);

  // Intentional non-human write acknowledging only /camera leaves /color guarded, yet stops spam
  const aiWrite = { camera: 70, color: "warm" };
  protection.protect(humanAgain, aiWrite, "ai");
  protection.remember("v4", aiWrite);
  assert.deepEqual(protection.report().protected, ["/color"]);
  assert.deepEqual(captureWarnings(project), []);
  assert.deepEqual(captureWarnings(project), []);

  // Audit log still preserves notice 1 untouched
  const logAfterAck = readAuditLog(project);
  assert.equal(logAfterAck.length, 1);
  assert.equal(protection.report().notices.length, 1);

  // A new direct write colliding with the still-guarded /color fires a fresh warning
  const secondMerged = protection.reconcile({ camera: 70, color: "cold" }, () => []);
  assert.deepEqual(secondMerged, aiWrite);
  const freshWarn = captureWarnings(project);
  assert.equal(freshWarn.length, 1);
  assert.match(freshWarn[0], /\/color/);
  assert.equal(readAuditLog(project).length, 2);
});

test("reset and resetProtectedFiles acknowledge pending notices while keeping notices.jsonl intact", (t) => {
  const project = makeDir(t);
  const rel = "src/timeline/cam.json";
  mkdirSync(join(project, "src/timeline"), { recursive: true });
  const file = join(project, rel);
  writeFileSync(file, JSON.stringify({ fov: 50 }));

  const timeline = openTimelineFile(project, rel, z.looseObject({}));
  timeline.write(timeline.read().version, { fov: 60 });
  writeFileSync(file, JSON.stringify({ fov: 40 }));
  assert.deepEqual(timeline.read().data, { fov: 60 });
  assert.equal(captureWarnings(project).length, 1);

  resetProtectedFiles(project, [rel]);
  assert.deepEqual(captureWarnings(project), []);
  assert.equal(readAuditLog(project).length, 1);
});

test("legacy collaboration state JSON without acknowledgedNoticeId warns until resolved and stays per-file", (t) => {
  const project = makeDir(t);
  const folder = join(project, ".studio/collaboration");
  mkdirSync(folder, { recursive: true });

  const writeLegacy = (rel, notice) => {
    const key = createHash("sha256").update(rel).digest("hex");
    writeFileSync(
      join(folder, `${key}.json`),
      JSON.stringify({
        guards: [{ path: ["fov"], value: 60 }],
        notices: [notice],
        versions: [],
        latest: { version: "v1", data: { fov: 60 } },
      }),
    );
  };

  writeLegacy("src/timeline/cam.json", {
    id: "legacy-id-1",
    file: "src/timeline/cam.json",
    at: "2026-01-01T00:00:00.000Z",
    retained: ["/fov"],
    incoming: { fov: 45 },
  });
  // Legacy notice lacking even `id`
  writeLegacy("src/timeline/shots.json", {
    file: "src/timeline/shots.json",
    retained: ["/fov"],
    incoming: { fov: 45 },
  });

  const before = captureWarnings(project);
  assert.equal(before.length, 2);

  // Resolving only cam.json silences cam.json while shots.json still warns
  const cam = openEditProtection(project, "src/timeline/cam.json");
  cam.protect({ fov: 60 }, { fov: 60 }, "agent");
  const middle = captureWarnings(project);
  assert.equal(middle.length, 1);
  assert.match(middle[0], /src\/timeline\/shots\.json/);

  // Resolving shots.json via reset silences it too
  const shots = openEditProtection(project, "src/timeline/shots.json");
  shots.reset("v2", { fov: 60 });
  assert.deepEqual(captureWarnings(project), []);
});

test("needFilm warns by default and suppresses protected-edit warnings when warnProtected is false", (t) => {
  const project = makeDir(t);
  mkdirSync(join(project, "src/timeline"), { recursive: true });
  writeFileSync(join(project, "src/scene.ts"), "export {};\n");
  const file = join(project, "src/timeline/cam.json");
  writeFileSync(file, JSON.stringify({ fov: 50 }));

  const timeline = openTimelineFile(project, "src/timeline/cam.json", z.looseObject({}));
  timeline.write(timeline.read().version, { fov: 60 });
  writeFileSync(file, JSON.stringify({ fov: 40 }));
  timeline.read();

  const runNeedFilm = (dir, optsExpr = "") =>
    spawnSync(
      process.execPath,
      [
        "-e",
        `const { needFilm } = await import(${JSON.stringify(CLI_URL)});
         console.log(needFilm(${JSON.stringify(dir)}${optsExpr ? `, ${optsExpr}` : ""}));`,
      ],
      { encoding: "utf8" },
    );

  const warned = runNeedFilm(project);
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stderr, /Studio retained human edits/);

  const quiet = runNeedFilm(project, "{ warnProtected: false }");
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stderr, "");
  assert.equal(quiet.stdout.trim(), project);

  const notFilm = runNeedFilm(makeDir(t, "not-a-film-"), "{ warnProtected: false }");
  assert.equal(notFilm.status, 2);
  assert.match(notFilm.stderr, /is not a film/);
});

test("collab.mjs --help explains optional --film, --silent JSON piping, and stdin '-'", () => {
  const res = spawnSync(process.execPath, [COLLAB, "--help"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /--film/);
  assert.match(res.stdout, /--silent/);
  assert.match(res.stdout, /stdin/i);
  assert.match(res.stdout, /write cam <file\|->/);
});

test("collab.mjs reads without stderr warning spam, writes via stdin '-', and preserves file-path writes", async (t) => {
  const dir = makeDir(t, "collab-e2e-");
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "collab-e2e",
      "live-studio": { camTimeline: "src/timeline/cam.json" },
    }),
  );
  const camFile = join(dir, "src/timeline/cam.json");
  const k0 = { id: "k0", t: 0, p: [0, 1, 5], l: [0, 1, 0], fov: 45 };
  const k1 = { id: "k1", t: 2, p: [2, 1, 5], l: [0, 1, 0], fov: 50 };
  writeFileSync(camFile, JSON.stringify([k0, k1]));

  const activity = createActivity(() => {});
  const film = openFilm(dir, { send: () => {}, activity });
  const app = createApi(film, { page: { dir, html: () => "" }, events: new Set(), activity });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });

  try {
    writeFileSync(
      join(dir, "renders/live/studio.json"),
      JSON.stringify({ project: dir, port: server.port }),
    );

    // Create a human edit on both k0 and k1, then trigger a direct-write collision notice
    const initial = film.cam.read();
    film.cam.write(initial.version, [
      { ...k0, fov: 60 },
      { ...k1, fov: 65 },
    ]);
    writeFileSync(camFile, JSON.stringify([k0, k1]));
    film.cam.read();
    assert.equal(captureWarnings(dir).length, 1);

    const runCollab = async (args, { cwd = dir, stdin } = {}) => {
      const proc = Bun.spawn([process.execPath, COLLAB, ...args], {
        cwd,
        stdin: stdin === undefined ? "ignore" : new Response(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { status, stdout, stderr };
    };

    // 1) collab read inside film folder (no --film): stdout has valid JSON with notices, stderr is empty
    const readRes = await runCollab(["read", "cam"], { cwd: dir });
    assert.equal(readRes.status, 0, readRes.stderr);
    assert.equal(readRes.stderr, "");
    const readJson = JSON.parse(readRes.stdout);
    assert.equal(readJson.data[0].fov, 60);
    assert.equal(readJson.data[1].fov, 65);
    assert.equal(readJson.notices.length, 1);

    // 2) collab write cam - via stdin (keeps k1's human fov: 65 protected, updates k0 to fov: 72)
    const stdinPayload = JSON.stringify({
      base: readJson.version,
      data: [
        { ...readJson.data[0], fov: 72 },
        { ...readJson.data[1], fov: 65 },
      ],
    });
    const writeStdin = await runCollab(["write", "cam", "-"], { cwd: dir, stdin: stdinPayload });
    assert.equal(writeStdin.status, 0, writeStdin.stderr);
    assert.equal(writeStdin.stderr, "");
    const afterStdin = JSON.parse(writeStdin.stdout);
    assert.equal(afterStdin.data[0].fov, 72);
    assert.equal(afterStdin.data[1].fov, 65);
    assert.equal(JSON.parse(readFileSync(camFile, "utf8"))[0].fov, 72);

    // Pending notice is now acknowledged even though k1/fov remains guarded
    assert.deepEqual(captureWarnings(dir), []);
    assert.equal(readAuditLog(dir).length, 1);

    // 3) Backward-compatible file-path write with explicit --film from outside the film directory
    const payloadFile = join(dir, "payload.json");
    writeFileSync(
      payloadFile,
      JSON.stringify({
        base: afterStdin.version,
        data: [
          { ...afterStdin.data[0], fov: 75 },
          { ...afterStdin.data[1], fov: 65 },
        ],
      }),
    );
    const writeFile = await runCollab(["--film", dir, "write", "cam", payloadFile], {
      cwd: tmpdir(),
    });
    assert.equal(writeFile.status, 0, writeFile.stderr);
    assert.equal(writeFile.stderr, "");
    const afterFile = JSON.parse(writeFile.stdout);
    assert.equal(afterFile.data[0].fov, 75);
    assert.equal(JSON.parse(readFileSync(camFile, "utf8"))[0].fov, 75);

    // 4) Usage errors exit 2
    const missingInput = await runCollab(["--film", dir, "write", "cam"]);
    assert.equal(missingInput.status, 2);
    const extraReadArg = await runCollab(["--film", dir, "read", "cam", "-"]);
    assert.equal(extraReadArg.status, 2);
  } finally {
    server.stop(true);
    film.stop?.();
  }
});
