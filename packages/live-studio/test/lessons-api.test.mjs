import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { createApi } from "../src/api.mjs";
import { openLessonFiles } from "../src/lesson-files.mjs";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const setup = ({ withProject = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "lessons-api-"));
  tempDirs.push(root);
  const globalDir = join(root, "lessons");
  const filmRoot = join(root, "films/sealed-room");
  const projectDir = join(filmRoot, "lessons");
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(filmRoot, { recursive: true });

  const all = openLessonFiles(globalDir);
  const film = withProject ? openLessonFiles(projectDir) : null;
  const app = createApi(
    {
      PROJECT: filmRoot,
      voice: null,
      sound: null,
      PUBLIC: join(filmRoot, "assets/public"),
      LITE: join(filmRoot, "renders/live/lite"),
      openRead: () => {
        throw new Error("unexpected read");
      },
    },
    {
      page: { dir: filmRoot, html: () => "<!doctype html>", error: () => null },
      events: new Set(),
      send: () => {},
      lessons: withProject ? { all, film } : all,
    },
  );
  return { root, globalDir, projectDir, all, film, app };
};

const jsonReq = (app, url, method, body) =>
  app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Inspector API defaults to dry, validates drafts, saves effective config and clears only its own cache", async () => {
  const { root, app, globalDir } = setup();
  writeFileSync(join(globalDir, "camera.md"), "# Camera\n");
  const info = await (await app.request("/api/lessons/inspect")).json();
  assert.equal(typeof info.keys.free, "boolean");
  assert.equal(typeof info.keys.paid, "boolean");
  assert.equal(Object.keys(info.keys).length, 2);
  const result = await jsonReq(app, "/api/lessons/inspect", "POST", { note: { text: "closer" } });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.status, "dry");
  assert.match(body.output, /dry simulation/);
  assert.match(body.noteOutput, /NOTE: closer/);
  for (const invalid of [
    { runJev: "true" },
    { drafts: [{ scope: "all", path: "../outside.md", text: "x" }] },
    { config: { heat: 3, keep: 8 } },
  ]) {
    assert.equal(
      (await jsonReq(app, "/api/lessons/inspect", "POST", { note: { text: "x" }, ...invalid }))
        .status,
      400,
    );
  }
  assert.equal(
    (await jsonReq(app, "/api/lessons/inspect", "PUT", { enabled: false, sectionLabel: "rule" }))
      .status,
    200,
  );
  const stored = await (await app.request("/api/lessons/inspect")).json();
  assert.equal(stored.config.enabled, false);
  assert.equal(stored.config.sectionLabel, "rule");
  const notesDir = join(root, "films/sealed-room/notes");
  writeFileSync(join(notesDir, "lessons-cache.json"), "{}");
  writeFileSync(join(notesDir, "lessons-inspect-cache.json"), "[]");
  assert.equal((await app.request("/api/lessons/inspect-cache", { method: "DELETE" })).status, 200);
  assert.equal(existsSync(join(notesDir, "lessons-inspect-cache.json")), false);
  assert.equal(existsSync(join(notesDir, "lessons-cache.json")), true);
});

describe("/api/lessons dual-scope (film + global)", () => {
  test("GET /api/lessons returns both global and film lessons without colliding on matching paths", async () => {
    const { globalDir, projectDir, app } = setup();
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(globalDir, "camera.md"), "---\nwhen: cam\n---\n# Global Camera\n");
    writeFileSync(join(globalDir, "hands.md"), "# Hands\n");
    writeFileSync(join(projectDir, "camera.md"), "---\nwhen: shot 3\n---\n# Film Camera\n");

    const res = await app.request("/api/lessons");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.dir, globalDir.replaceAll("\\", "/"));
    assert.equal(body.projectDir, projectDir.replaceAll("\\", "/"));
    assert.deepEqual(
      body.files.map((f) => [f.scope, f.path, f.text]),
      [
        ["film", "camera.md", "---\nwhen: shot 3\n---\n# Film Camera\n"],
        ["all", "camera.md", "---\nwhen: cam\n---\n# Global Camera\n"],
        ["all", "hands.md", "# Hands\n"],
      ],
    );
  });

  test("POST /api/lessons writes to the requested film scope and creates the project folder on demand", async () => {
    const { globalDir, projectDir, app } = setup();
    writeFileSync(join(globalDir, "camera.md"), "# Global\n");

    const createFilm = await jsonReq(app, "/api/lessons", "POST", {
      scope: "film",
      path: "camera.md",
      text: "# This Film\n",
      base: null,
    });
    assert.equal(createFilm.status, 200);
    const savedFilm = await createFilm.json();
    assert.equal(savedFilm.scope, "film");
    assert.equal(existsSync(join(projectDir, "camera.md")), true);
    assert.equal(readFileSync(join(projectDir, "camera.md"), "utf8"), "# This Film\n");
    assert.equal(readFileSync(join(globalDir, "camera.md"), "utf8"), "# Global\n");
  });

  test("POST /api/lessons returns 409 conflict with current film copy when base tag is stale", async () => {
    const { projectDir, app } = setup();
    await jsonReq(app, "/api/lessons", "POST", {
      scope: "film",
      path: "camera.md",
      text: "# This Film\n",
      base: null,
    });

    const conflict = await jsonReq(app, "/api/lessons", "POST", {
      scope: "film",
      path: "camera.md",
      text: "# Overwrite\n",
      base: "stale-tag",
    });
    assert.equal(conflict.status, 409);
    const conflictBody = await conflict.json();
    assert.equal(conflictBody.conflict, true);
    assert.equal(conflictBody.scope, "film");
    assert.equal(conflictBody.text, "# This Film\n");
    assert.equal(readFileSync(join(projectDir, "camera.md"), "utf8"), "# This Film\n");
  });

  test("POST /api/lessons defaults omitted scope to global", async () => {
    const { globalDir, app } = setup();
    const createGlobal = await jsonReq(app, "/api/lessons", "POST", {
      path: "audio.md",
      text: "# Audio\n",
      base: null,
    });
    assert.equal(createGlobal.status, 200);
    assert.equal(readFileSync(join(globalDir, "audio.md"), "utf8"), "# Audio\n");
  });

  test("DELETE /api/lessons removes only from the specified scope", async () => {
    const { globalDir, projectDir, app } = setup();
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(globalDir, "camera.md"), "# Global\n");
    writeFileSync(join(projectDir, "camera.md"), "# Film\n");

    const listed = await (await app.request("/api/lessons")).json();
    const filmTag = listed.files.find((f) => f.scope === "film" && f.path === "camera.md").tag;

    const del = await jsonReq(app, "/api/lessons", "DELETE", {
      scope: "film",
      path: "camera.md",
      base: filmTag,
    });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).removed, true);
    assert.equal(existsSync(join(projectDir, "camera.md")), false);
    assert.equal(existsSync(join(globalDir, "camera.md")), true);
  });

  test("DELETE /api/lessons returns 409 conflict and leaves disk untouched when base tag is stale", async () => {
    const { globalDir, app } = setup();
    writeFileSync(join(globalDir, "camera.md"), "# Global\n");

    const delConflict = await jsonReq(app, "/api/lessons", "DELETE", {
      scope: "all",
      path: "camera.md",
      base: "stale-tag",
    });
    assert.equal(delConflict.status, 409);
    const delConflictBody = await delConflict.json();
    assert.equal(delConflictBody.conflict, true);
    assert.equal(delConflictBody.text, "# Global\n");
    assert.equal(existsSync(join(globalDir, "camera.md")), true);
  });

  test("POST and DELETE reject film scope with 400 when no project lesson store exists", async () => {
    const single = setup({ withProject: false });
    const badPost = await jsonReq(single.app, "/api/lessons", "POST", {
      scope: "film",
      path: "camera.md",
      text: "# Nope\n",
      base: null,
    });
    assert.equal(badPost.status, 400);

    const badDel = await jsonReq(single.app, "/api/lessons", "DELETE", {
      scope: "film",
      path: "camera.md",
      base: "any",
    });
    assert.equal(badDel.status, 400);
  });
});
