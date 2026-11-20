import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createActivity } from "../src/activity.mjs";
import { createApi } from "../src/api.mjs";
import { openEditProtection, warnProtectedEdits } from "../src/edit-protection.mjs";
import { filmVersion, filmVersionAsync } from "../src/film-version.mjs";
import { openFilm } from "../src/film.mjs";
import { markDone } from "../src/note-cli.mjs";
import { noteDetailFormat } from "../src/note-detail.mjs";
import { createNotes } from "../src/notes.mjs";

const NOTES_SCRIPT = join(import.meta.dirname, "../notes.mjs");
const COLLAB = join(import.meta.dirname, "../collab.mjs");

const makeDir = (t, prefix = "npc-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
};

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

const runCollab = async (args, { cwd, stdin } = {}) => {
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

test("filmVersion returns git describe for tracked films and deterministic local-<8hex> for untracked/gitignored/non-git films", async (t) => {
  const repo = makeDir(t, "fv-repo-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), "films/\n");

  const trackedFilm = join(repo, "tracked-film");
  mkdirSync(join(trackedFilm, "src"), { recursive: true });
  writeFileSync(join(trackedFilm, "package.json"), JSON.stringify({ name: "tracked-film" }));
  writeFileSync(join(trackedFilm, "src/scene.ts"), "export const v = 1;\n");
  execFileSync("git", ["add", ".gitignore", "tracked-film"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

  const commitHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();

  // Tracked film uses git describe
  assert.equal(filmVersion(trackedFilm), commitHash);
  assert.equal(await filmVersionAsync(trackedFilm), commitHash);

  // Dirty tracked film gets -dirty
  writeFileSync(join(trackedFilm, "src/scene.ts"), "export const v = 2;\n");
  assert.equal(filmVersion(trackedFilm), `${commitHash}-dirty`);
  assert.equal(await filmVersionAsync(trackedFilm), `${commitHash}-dirty`);

  // Gitignored local film inside parent git repo gets local-<8hex> (never parent hash)
  const ignoredFilm = join(repo, "films/local-one");
  mkdirSync(join(ignoredFilm, "src/timeline"), { recursive: true });
  writeFileSync(join(ignoredFilm, "package.json"), JSON.stringify({ name: "local-one" }));
  writeFileSync(join(ignoredFilm, "src/scene.ts"), "export const x = 1;\n");
  writeFileSync(join(ignoredFilm, "src/timeline/cam.json"), "[]\n");

  const v1 = filmVersion(ignoredFilm);
  assert.match(v1, /^local-[0-9a-f]{8}$/);
  assert.equal(await filmVersionAsync(ignoredFilm), v1);
  assert.ok(!v1.includes(commitHash));

  // Changing files in renders/ or notes/ must NOT change the local fingerprint
  mkdirSync(join(ignoredFilm, "renders/live"), { recursive: true });
  mkdirSync(join(ignoredFilm, "notes"), { recursive: true });
  writeFileSync(join(ignoredFilm, "renders/draft.mp4"), "fake-video");
  writeFileSync(join(ignoredFilm, "notes/notes.jsonl"), '{"id":"n1"}\n');
  assert.equal(filmVersion(ignoredFilm), v1);

  // Changing a file in src/ immediately changes the local fingerprint
  writeFileSync(join(ignoredFilm, "src/timeline/cam.json"), '[{"t":0}]\n');
  const v2 = filmVersion(ignoredFilm);
  assert.match(v2, /^local-[0-9a-f]{8}$/);
  assert.notEqual(v2, v1);

  // Changing package.json also changes the local fingerprint
  writeFileSync(join(ignoredFilm, "package.json"), JSON.stringify({ name: "local-one-v2" }));
  const v3 = filmVersion(ignoredFilm);
  assert.match(v3, /^local-[0-9a-f]{8}$/);
  assert.notEqual(v3, v2);

  // Untracked folder inside parent git repo (not in .gitignore) also gets local-<8hex>
  const untrackedFilm = join(repo, "untracked/film-a");
  mkdirSync(join(untrackedFilm, "src"), { recursive: true });
  writeFileSync(join(untrackedFilm, "package.json"), JSON.stringify({ name: "film-a" }));
  writeFileSync(join(untrackedFilm, "src/scene.ts"), "export const a = 1;\n");
  assert.match(filmVersion(untrackedFilm), /^local-[0-9a-f]{8}$/);

  // Directory completely outside any git repo gets deterministic local-<8hex>
  const outsideFilm = makeDir(t, "fv-outside-");
  mkdirSync(join(outsideFilm, "src"), { recursive: true });
  writeFileSync(join(outsideFilm, "package.json"), JSON.stringify({ name: "outside" }));
  writeFileSync(join(outsideFilm, "src/scene.ts"), "export const a = 1;\n");
  const outV = filmVersion(outsideFilm);
  assert.match(outV, /^local-[0-9a-f]{8}$/);
  assert.equal(await filmVersionAsync(outsideFilm), outV);

  // Symlink inside src/ pointing outside project is skipped safely without crashing or altering hash
  const externalSecret = join(makeDir(t, "fv-ext-"), "secret.txt");
  writeFileSync(externalSecret, "outside-content");
  let linked = false;
  try {
    symlinkSync(externalSecret, join(outsideFilm, "src/escape.ts"));
    linked = true;
  } catch {
    // Windows without symlink privilege: skip symlink assertion gracefully
  }
  if (linked) {
    assert.equal(filmVersion(outsideFilm), outV);
  }
});

test("POST /api/notes persists staleBuild:true with local-<8hex> version, and note-detail + notes.mjs render timestamp, staleBuild warning, and version mismatch", async (t) => {
  const dir = makeDir(t, "note-prov-");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "prov-film" }));
  writeFileSync(join(dir, "src/scene.ts"), "export const rev = 1;\n");
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ voice: { lines: [] }, beats: {} }));

  const v1 = filmVersion(dir);
  assert.match(v1, /^local-[0-9a-f]{8}$/);

  const activity = createActivity(() => {});
  const film = openFilm(dir, { send: () => {}, activity });
  const app = createApi(film, {
    page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
    events: new Set(),
    send: () => {},
    activity,
  });

  try {
    // 1) Save a stale-build note through POST /api/notes
    const resStale = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: {
          id: "st1",
          at: "2026-11-19T18:22:10.452Z",
          t: 4.5,
          time: "00:04.500",
          frame: 135,
          shot: 0,
          text: "hand clips desk",
          staleBuild: true,
        },
      }),
    });
    assert.equal(resStale.status, 200);

    // 2) Save a clean note (staleBuild: false should not be persisted)
    const resClean = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: {
          id: "cl1",
          at: "2026-11-19T18:25:00.000Z",
          t: 5.0,
          time: "00:05.000",
          frame: 150,
          shot: 0,
          text: "camera too tight",
          staleBuild: false,
        },
      }),
    });
    assert.equal(resClean.status, 200);

    const saved = createNotes(dir).read();
    assert.equal(saved.length, 2);
    assert.equal(saved[0].version, v1);
    assert.equal(saved[0].staleBuild, true);
    assert.equal(saved[1].version, v1);
    assert.equal("staleBuild" in saved[1], false);

    // 3) Unit check noteDetailFormat directly when currentVersion matches, differs, or version is absent
    const sameFmt = noteDetailFormat({
      root: dir,
      dir: join(dir, "no-lessons"),
      currentVersion: v1,
    });
    const sameOut = sameFmt({ ...saved[0], n: 1 }, false, undefined).join("\n");
    assert.ok(sameOut.includes(`said about version: ${v1}`), sameOut);
    assert.ok(sameOut.includes("2026-11-19T18:22:10Z"), sameOut);
    assert.ok(!sameOut.includes("differs from current"), sameOut);
    assert.ok(sameOut.includes("⚠ captured on an older Studio build before reload"), sameOut);

    const cleanOut = sameFmt({ ...saved[1], n: 2 }, false, undefined).join("\n");
    assert.ok(!cleanOut.includes("older Studio build"), cleanOut);
    assert.ok(cleanOut.includes("2026-11-19T18:25:00Z"), cleanOut);

    const versionlessOut = sameFmt(
      {
        n: 3,
        id: "nv1",
        t: 1,
        time: "00:01.000",
        shot: 0,
        at: "2026-11-19T19:00:05.999Z",
        text: "no version",
      },
      false,
      undefined,
    ).join("\n");
    assert.ok(versionlessOut.includes("written at 2026-11-19T19:00:05Z"), versionlessOut);

    // 4) Modify src/scene.ts -> filmVersion changes to v2 -> notes.mjs CLI flags mismatch & staleBuild & timestamp
    writeFileSync(join(dir, "src/scene.ts"), "export const rev = 2;\n");
    const v2 = filmVersion(dir);
    assert.notEqual(v2, v1);

    const listOut = execFileSync(process.execPath, [NOTES_SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, MC_LESSONS: join(dir, "no-lessons") },
    });
    assert.ok(listOut.includes(`Film now: ${v2}.`), listOut);
    assert.ok(listOut.includes("[older build]"), listOut);

    const detailOut = execFileSync(process.execPath, [NOTES_SCRIPT, "st1"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, MC_LESSONS: join(dir, "no-lessons") },
    });
    assert.ok(
      detailOut.includes(`said about version: ${v1} (differs from current ${v2})`),
      detailOut,
    );
    assert.ok(detailOut.includes("2026-11-19T18:22:10Z"), detailOut);
    assert.ok(detailOut.includes("⚠ captured on an older Studio build before reload"), detailOut);

    // 5) markDone in note-cli.mjs stamps fix.checkpoint with local-<8hex> (never "no git")
    await markDone(dir, "cl1", "widened shot", { noAfterReason: "unit test" });
    const afterFix = createNotes(dir)
      .read()
      .find((n) => n.id === "cl1");
    assert.equal(afterFix.fixes[0].checkpoint, v2);
  } finally {
    film.stop?.();
  }
});

test("warnProtectedEdits resolves /@<uuid>/p and /@<uuid> to human-readable short IDs and (t=<sec>s)", (t) => {
  const project = makeDir(t, "warn-ptr-");
  const rel = "src/timeline/cam.json";
  mkdirSync(join(project, "src/timeline"), { recursive: true });
  const uuid1 = "550e8400-e29b-41d4-a716-446655440000";
  const uuid2 = "a1b2c3d4-1111-2222-3333-444455556666";
  const initial = [
    { id: uuid1, t: 13.7, p: [0, 2, 5], l: [0, 1, 0], fov: 45 },
    { id: uuid2, t: 0, p: [1, 2, 3], l: [0, 0, 0], fov: 50 },
  ];
  const human = [
    { id: uuid1, t: 13.7, p: [2, 3, 6], l: [0, 1, 0], fov: 45 },
    { id: uuid2, t: 0, p: [1, 2, 3], l: [0, 0, 0], fov: 60 },
  ];
  writeFileSync(join(project, rel), JSON.stringify(human));

  const protection = openEditProtection(project, rel, { orderedRows: true });
  protection.remember("v1", initial);
  protection.protect(initial, human, "person");
  protection.remember("v2", human);

  // Collide on both /@uuid1/p and /@uuid2/fov
  protection.reconcile(initial, () => []);

  const warnings = captureWarnings(project);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("/@550e8400/p (t=13.7s)"), warnings[0]);
  assert.ok(warnings[0].includes("/@a1b2c3d4/fov (t=0s)"), warnings[0]);
  assert.ok(!warnings[0].includes(uuid1), `should shorten UUID in warning:\n${warnings[0]}`);

  // Whole-row protected deletion resolves row timestamp from incoming/history even when removed on disk
  const uuid3 = "deadbeef-0000-1111-2222-333344445555";
  const shotsRel = "src/timeline/shots.json";
  const shotsInitial = [
    { id: "s0", t: 0, name: "open" },
    { id: uuid3, t: 8.25, name: "cut" },
  ];
  const shotsAfterDelete = [{ id: "s0", t: 0, name: "open" }];
  writeFileSync(join(project, shotsRel), JSON.stringify(shotsAfterDelete));
  const shotsProt = openEditProtection(project, shotsRel, { orderedRows: true });
  shotsProt.remember("sv1", shotsInitial);
  shotsProt.protect(shotsInitial, shotsAfterDelete, "person");
  shotsProt.remember("sv2", shotsAfterDelete);
  shotsProt.reconcile(shotsInitial, () => []);

  const allWarnings = captureWarnings(project);
  const shotWarn = allWarnings.find((w) => w.includes(shotsRel));
  assert.ok(shotWarn, allWarnings.join("\n"));
  assert.ok(shotWarn.includes("/@deadbeef (t=8.25s)"), shotWarn);
});

test("collab CLI supports lean notices (--full), write --quiet, keyFiles edit names, and atomic write-many via /api/together", async (t) => {
  const dir = makeDir(t, "collab-ergo-");
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "collab-ergo",
      "live-studio": {
        camTimeline: "src/timeline/cam.json",
        shotsTimeline: "src/timeline/shots.json",
        keyFiles: {
          "src/timeline/cast.json": "cast",
          "src/timeline/placed.json": "placed",
        },
      },
    }),
  );

  const camUuid = "550e8400-e29b-41d4-a716-446655440000";
  const k0 = { id: "k0", t: 0, p: [0, 1, 5], l: [0, 1, 0], fov: 45 };
  const k1 = { id: camUuid, t: 13.7, cut: true, p: [2, 1, 5], l: [0, 1, 0], fov: 50 };
  const camFile = join(dir, "src/timeline/cam.json");
  const shotsFile = join(dir, "src/timeline/shots.json");
  const castFile = join(dir, "src/timeline/cast.json");
  const placedFile = join(dir, "src/timeline/placed.json");

  writeFileSync(camFile, JSON.stringify([k0, k1]));
  writeFileSync(
    shotsFile,
    JSON.stringify([
      { id: "s0", t: 0, name: "open" },
      { id: "s1", t: 13.7, name: "cut" },
    ]),
  );
  writeFileSync(castFile, JSON.stringify({ elon: [{ t: 0, x: 1, z: 2 }] }));
  writeFileSync(placedFile, JSON.stringify({}));

  const activity = createActivity(() => {});
  const film = openFilm(dir, { send: () => {}, activity });
  const app = createApi(film, { page: { dir, html: () => "" }, events: new Set(), activity });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });

  try {
    writeFileSync(
      join(dir, "renders/live/studio.json"),
      JSON.stringify({ project: dir, port: server.port }),
    );

    // Create a human edit on k1.p and trigger a direct-write collision notice
    const cam0 = film.cam.read();
    film.cam.write(cam0.version, [k0, { ...k1, p: [3, 2, 6] }]);
    writeFileSync(camFile, JSON.stringify([k0, k1]));
    film.cam.read();

    // 1) Default collab read strips bulky `incoming` and keeps id/at/kind/paths/pathLabels
    const leanRes = await runCollab(["read", "cam"], { cwd: dir });
    assert.equal(leanRes.status, 0, leanRes.stderr);
    const leanJson = JSON.parse(leanRes.stdout);
    assert.equal(leanJson.notices.length, 1);
    const leanNotice = leanJson.notices[0];
    assert.equal("incoming" in leanNotice, false, "default read must strip incoming");
    assert.ok(leanNotice.id);
    assert.ok(leanNotice.at);
    assert.equal(leanNotice.kind, "retained");
    assert.deepEqual(leanNotice.paths, [`/@${camUuid}/p`]);
    assert.deepEqual(leanNotice.pathLabels, ["/@550e8400/p (t=13.7s)"]);

    // 2) collab read --full includes raw incoming, and notices.jsonl on disk keeps incoming untouched
    const fullRes = await runCollab(["read", "cam", "--full"], { cwd: dir });
    assert.equal(fullRes.status, 0, fullRes.stderr);
    const fullJson = JSON.parse(fullRes.stdout);
    assert.equal(fullJson.notices.length, 1);
    assert.deepEqual(fullJson.notices[0].incoming[1].p, [2, 1, 5]);
    const auditLog = readFileSync(join(dir, ".studio/collaboration/notices.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.deepEqual(auditLog[0].incoming[1].p, [2, 1, 5]);

    // 3) collab write --quiet prints compact summary without dumping document data
    const quietWrite = await runCollab(["write", "cam", "-", "--quiet"], {
      cwd: dir,
      stdin: JSON.stringify({
        base: leanJson.version,
        data: [k0, { ...leanJson.data[1], fov: 55 }],
      }),
    });
    assert.equal(quietWrite.status, 0, quietWrite.stderr);
    const quietOut = JSON.parse(quietWrite.stdout);
    assert.equal(quietOut.ok, true);
    assert.equal(quietOut.doc, "cam");
    assert.equal(typeof quietOut.version, "string");
    assert.deepEqual(quietOut.retained, []);
    assert.equal("data" in quietOut, false);

    // 3b) collab write --quiet still reports conflict (exit 1) on stale base
    const staleQuiet = await runCollab(["write", "cam", "-", "--quiet"], {
      cwd: dir,
      stdin: JSON.stringify({ base: "stale-v0", data: [k0, k1] }),
    });
    assert.equal(staleQuiet.status, 1);
    assert.equal(JSON.parse(staleQuiet.stdout).conflict, true);

    // 4) Address keyFiles by edit name (`cast`) for both read and write
    const readCast = await runCollab(["read", "cast"], { cwd: dir });
    assert.equal(readCast.status, 0, readCast.stderr);
    const castJson = JSON.parse(readCast.stdout);
    assert.deepEqual(castJson.data, { elon: [{ t: 0, x: 1, z: 2 }] });

    const writeCast = await runCollab(["write", "cast", "-", "-q"], {
      cwd: dir,
      stdin: JSON.stringify({
        base: castJson.version,
        data: { elon: [{ t: 0, x: 4, z: 5 }] },
      }),
    });
    assert.equal(writeCast.status, 0, writeCast.stderr);
    const castOut = JSON.parse(writeCast.stdout);
    assert.equal(castOut.ok, true);
    assert.equal(castOut.doc, "cast");
    assert.deepEqual(JSON.parse(readFileSync(castFile, "utf8")), {
      elon: [{ t: 0, x: 4, z: 5 }],
    });

    // 5) Unknown doc name exits 2 and lists available names
    const badName = await runCollab(["read", "nonexistent"], { cwd: dir });
    assert.equal(badName.status, 2);
    assert.match(badName.stderr, /unknown document/i);
    assert.match(badName.stderr, /cast/);
    assert.match(badName.stderr, /placed/);

    // 6) Invalid flag combinations exit 2
    assert.equal((await runCollab(["read", "cam", "--quiet"], { cwd: dir })).status, 2);
    assert.equal((await runCollab(["write", "cam", "-", "--full"], { cwd: dir })).status, 2);

    // 7) Atomic collab write-many updates cam + shots + cast together via /api/together
    const curCam = JSON.parse((await runCollab(["read", "cam"], { cwd: dir })).stdout);
    const curShots = JSON.parse((await runCollab(["read", "shots"], { cwd: dir })).stdout);
    const curCast = JSON.parse((await runCollab(["read", "cast"], { cwd: dir })).stdout);

    // 7a) Stale base on one doc (including a real historical ancestor version) aborts the entire batch atomically
    const camBefore = readFileSync(camFile, "utf8");
    const shotsBefore = readFileSync(shotsFile, "utf8");
    const staleMany = await runCollab(["write-many", "-"], {
      cwd: dir,
      stdin: JSON.stringify({
        writes: {
          cam: {
            base: cam0.version,
            data: [curCam.data[0], { ...curCam.data[1], t: 15.0 }],
          },
          shots: {
            base: curShots.version,
            data: [curShots.data[0], { ...curShots.data[1], t: 15.0 }],
          },
        },
      }),
    });
    assert.equal(staleMany.status, 1);
    assert.equal(JSON.parse(staleMany.stdout).conflict, true);
    assert.equal(readFileSync(camFile, "utf8"), camBefore);
    assert.equal(readFileSync(shotsFile, "utf8"), shotsBefore);

    // 7b) Duplicate canonical target (cast + keys/0) exits 2 before calling Studio
    const dupMany = await runCollab(["write-many", "-"], {
      cwd: dir,
      stdin: JSON.stringify({
        writes: {
          cast: { base: curCast.version, data: curCast.data },
          "keys/0": { base: curCast.version, data: curCast.data },
        },
      }),
    });
    assert.equal(dupMany.status, 2);

    // 7c) Valid write-many --quiet atomically shifts cut across cam + shots + cast
    const okMany = await runCollab(["write-many", "-", "--quiet"], {
      cwd: dir,
      stdin: JSON.stringify({
        writes: {
          cam: {
            base: curCam.version,
            data: [curCam.data[0], { ...curCam.data[1], t: 15.2 }],
          },
          shots: {
            base: curShots.version,
            data: [curShots.data[0], { ...curShots.data[1], t: 15.2 }],
          },
          cast: {
            base: curCast.version,
            data: { elon: [{ t: 0, x: 9, z: 9 }] },
          },
        },
      }),
    });
    assert.equal(okMany.status, 0, okMany.stderr);
    const manyOut = JSON.parse(okMany.stdout);
    assert.equal(manyOut.ok, true);
    assert.equal(typeof manyOut.versions.cam, "string");
    assert.equal(typeof manyOut.versions.shots, "string");
    assert.equal(typeof manyOut.versions.cast, "string");
    assert.equal("files" in manyOut, false);
    assert.equal(JSON.parse(readFileSync(camFile, "utf8"))[1].t, 15.2);
    assert.equal(JSON.parse(readFileSync(shotsFile, "utf8"))[1].t, 15.2);
    assert.deepEqual(JSON.parse(readFileSync(castFile, "utf8")), {
      elon: [{ t: 0, x: 9, z: 9 }],
    });

    // 7d) write-many uses actor:"agent", so its edits are NOT locked as human-protected
    assert.equal(film.shots.collaboration().protected.length, 0);
    assert.equal(film.keyFiles[0].collaboration().protected.length, 0);
  } finally {
    server.stop(true);
    film.stop?.();
  }
});

test("collab --help documents --full, --quiet, keyFiles edit names, and write-many", () => {
  const res = spawnSync(process.execPath, [COLLAB, "--help"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /--full/);
  assert.match(res.stdout, /--quiet/);
  assert.match(res.stdout, /write-many/);
  assert.match(res.stdout, /keyFiles/);
});

test("collab rejects ambiguous duplicate keyFiles edit names cleanly with exit 2", async (t) => {
  const dir = makeDir(t, "collab-ambig-");
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "collab-ambig",
      "live-studio": {
        keyFiles: {
          "src/timeline/a.json": "dup",
          "src/timeline/b.json": "dup",
        },
      },
    }),
  );

  const res = await runCollab(["read", "dup"], { cwd: dir });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /ambiguous/i);
  assert.match(res.stderr, /keys\/0/);
  assert.match(res.stderr, /keys\/1/);
});
