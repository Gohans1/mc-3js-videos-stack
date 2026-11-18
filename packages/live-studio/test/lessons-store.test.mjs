// app/lessons/lessons.ts: dual-scope store drafts, concurrent load/save races, conflicts, retry, and persistent view mode.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { LESSON_TEXT_MAX } from "../src/lesson-template.ts";

const was = { fetch: globalThis.fetch, localStorage: globalThis.localStorage },
  kept = new Map();
globalThis.localStorage ??= {
  getItem: (k) => kept.get(k) ?? null,
  setItem: (k, v) => kept.set(k, v),
  removeItem: (k) => kept.delete(k),
};

const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

// Seed legacy bare keys to verify migration to "all:<path>" on load
localStorage.setItem(
  "lessonDrafts",
  JSON.stringify({
    "walk.md": { text: "# Walk\n\n## Feet stay planted\n", base: "t1" },
    "cam.md": { text: "# Camera, mine\n", base: "old" },
  }),
);

let getHandler = async () =>
  Response.json({
    dir: "lessons",
    projectDir: "films/demo/lessons",
    files: [
      { scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" },
      { scope: "all", path: "cam.md", tag: "t2", text: "# Camera, the AI's\n" },
    ],
  });
let postHandler = async () => Response.json({ tag: "t3" });
let deleteHandler = async () => Response.json({ removed: true });
const posted = [];
const deleted = [];

globalThis.fetch = async (url, init) => {
  if (init?.method === "POST") {
    const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
    posted.push(body);
    return postHandler(body);
  }
  if (init?.method === "DELETE") {
    const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
    deleted.push(body);
    return deleteHandler(body);
  }
  return getHandler(url);
};

after(() => {
  clearLessonTimers();
  for (const k of ["lessonDrafts", "lessonsSeen", "lessonView"]) localStorage.removeItem(k);
  globalThis.fetch = was.fetch;
  if (!was.localStorage) delete globalThis.localStorage;
});

const {
  LESSON_NAME,
  clearLessonTimers,
  deleteLesson,
  dismissAiNotice,
  lessonKey,
  lessons,
  loadLessons,
  markRead,
  newLesson,
  openLesson,
  openLessonFolder,
  readPreferredLessonView,
  saveLesson,
  setLessonView,
  setScopeFilter,
  takePick,
  typeLesson,
} = await import("../app/lessons/lessons.ts");

const resetHandlers = () => {
  posted.length = 0;
  deleted.length = 0;
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      projectDir: "films/demo/lessons",
      files: [
        { scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" },
        { scope: "all", path: "cam.md", tag: "t2", text: "# Camera, the AI's\n" },
      ],
    });
  postHandler = async () => Response.json({ tag: "t3" });
  deleteHandler = async () => Response.json({ removed: true });
};

beforeEach(() => {
  clearLessonTimers();
  resetHandlers();
});

test("a draft a reload cut off is saved on its version; one the AI changed meanwhile yields automatically to the AI version", async () => {
  await loadLessons();
  await flushMicrotasks();
  assert.deepEqual(posted, [
    { scope: "all", path: "walk.md", text: "# Walk\n\n## Feet stay planted\n", base: "t1" },
  ]);
  const { edits, files, projectDir, aiNotice } = lessons.getState();
  assert.equal(projectDir, "films/demo/lessons");
  assert.equal(edits["all:walk.md"], undefined);
  assert.equal(edits["all:cam.md"], undefined);
  assert.equal(
    files.find((f) => f.key === "all:walk.md")?.text,
    "# Walk\n\n## Feet stay planted\n",
  );
  assert.equal(files.find((f) => f.key === "all:cam.md")?.text, "# Camera, the AI's\n");
  assert.equal(aiNotice?.key, "all:cam.md");
  dismissAiNotice();
  assert.equal(lessons.getState().aiNotice, null);
});

test("LESSON_NAME accepts valid names with or without a .md suffix and rejects unsafe paths", () => {
  assert.equal(LESSON_NAME.test("lighting"), true);
  assert.equal(LESSON_NAME.test("lighting.md"), true);
  assert.equal(LESSON_NAME.test("camera/framing.md"), true);
  assert.equal(LESSON_NAME.test("../escape.md"), false);
  assert.equal(LESSON_NAME.test("bad.txt"), false);
});

test("saveLesson exits cleanly if an edit entry is cleared while the request is in flight", async () => {
  lessons.setState((s) => ({
    ...s,
    edits: { ...s.edits, "all:race.md": { text: "# Race\n", base: null } },
  }));
  postHandler = async () => {
    const { "all:race.md": _, ...rest } = lessons.getState().edits;
    lessons.setState({ edits: rest });
    return Response.json({ tag: "t4" });
  };
  await saveLesson("all:race.md");
  assert.equal(lessons.getState().edits["all:race.md"], undefined);
});

test("loadLessons preserves a saveLesson completion that landed while GET /api/lessons was in flight", async () => {
  let resolveGet;
  getHandler = () =>
    new Promise((res) => {
      resolveGet = () =>
        res(
          Response.json({
            dir: "lessons",
            files: [{ scope: "all", path: "walk.md", tag: "t3", text: "# Old before save\n" }],
          }),
        );
    });
  lessons.setState((s) => ({
    ...s,
    files: [
      { key: "all:walk.md", scope: "all", path: "walk.md", tag: "t3", text: "# Old before save\n" },
    ],
    edits: { "all:walk.md": { text: "# Saved mid-load\n", base: "t3" } },
  }));
  postHandler = async () => Response.json({ tag: "t9" });

  const loadPromise = loadLessons();
  await saveLesson("all:walk.md");
  resolveGet();
  await loadPromise;
  await flushMicrotasks();

  const walk = lessons.getState().files.find((f) => f.key === "all:walk.md");
  assert.equal(walk?.tag, "t9");
  assert.equal(walk?.text, "# Saved mid-load\n");
  assert.equal(lessons.getState().seen["all:walk.md"]?.tag, "t9");
  assert.equal(lessons.getState().edits["all:walk.md"], undefined);
});

test("loadLessons does not prematurely flush an actively debounced typeLesson timer", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:draft.md", scope: "all", path: "draft.md", tag: "d1", text: "# Draft\n" }],
    edits: {},
  }));
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      files: [{ scope: "all", path: "draft.md", tag: "d1", text: "# Draft\n" }],
    });

  typeLesson("all:draft.md", "# Draft\n- Still typing\n");
  await loadLessons();
  await flushMicrotasks();

  assert.equal(posted.length, 0);
  assert.equal(lessons.getState().edits["all:draft.md"]?.text, "# Draft\n- Still typing\n");
});

test("saveLesson records API validation errors without retrying and schedules retry on network failure", async () => {
  const realSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, ms) => {
    const id = scheduled.length + 1;
    scheduled.push({ id, fn, ms });
    return id;
  };
  try {
    lessons.setState((s) => ({
      ...s,
      edits: { "all:bad.md": { text: "# Bad\n", base: null } },
    }));
    postHandler = async () => Response.json({ error: "invalid name" }, { status: 400 });
    await saveLesson("all:bad.md");
    assert.equal(lessons.getState().edits["all:bad.md"]?.failed, "invalid name");
    assert.equal(scheduled.length, 0);

    postHandler = async () => {
      throw new Error("offline");
    };
    await saveLesson("all:bad.md");
    assert.equal(lessons.getState().edits["all:bad.md"]?.failed, "the studio didn't answer");
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].ms, 3000);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("an oversized draft stays editable and is saved only after it fits the lesson limit", async () => {
  const key = "all:walk.md";
  const oversized = "a".repeat(LESSON_TEXT_MAX + 1);
  typeLesson(key, oversized);
  await saveLesson(key);
  assert.equal(posted.length, 0);
  assert.equal(lessons.getState().edits[key].text, oversized);

  const shortened = "# Walk\n";
  typeLesson(key, shortened);
  await saveLesson(key);
  assert.equal(posted[0].text, shortened);
  assert.equal(lessons.getState().edits[key], undefined);
});

test("saveLesson 409 adopts AI version while keeping prior seen snapshot for diffs, markRead, openLesson, setLessonView, and case-insensitive newLesson", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [
      { key: "all:Walk.md", scope: "all", path: "Walk.md", tag: "w1", text: "# Walk\n" },
      { key: "all:cam.md", scope: "all", path: "cam.md", tag: "c1", text: "# Cam v1\n" },
      { key: "all:gone.md", scope: "all", path: "gone.md", tag: "g1", text: "# Gone v1\n" },
    ],
    seen: {
      "all:cam.md": { tag: "c1", text: "# Cam v1\n" },
      "all:gone.md": { tag: "g1", text: "# Gone v1\n" },
    },
    edits: {
      "all:cam.md": { text: "# Cam mine\n", base: "c1" },
      "all:gone.md": { text: "# Gone mine\n", base: "g1" },
      "all:ai-created.md": { text: "# Mine before list\n", base: null },
    },
    open: "all:gone.md",
  }));

  postHandler = async (body) => {
    if (body.path === "cam.md")
      return Response.json({ conflict: true, tag: "c2", text: "# Cam v2\n" }, { status: 409 });
    if (body.path === "gone.md")
      return Response.json({ conflict: true, tag: null, text: null }, { status: 409 });
    if (body.path === "ai-created.md")
      return Response.json(
        { conflict: true, tag: "ai1", text: "# AI wrote first\n" },
        { status: 409 },
      );
    return Response.json({ tag: "t3" });
  };

  await saveLesson("all:cam.md");
  assert.equal(lessons.getState().edits["all:cam.md"], undefined);
  assert.equal(lessons.getState().files.find((f) => f.key === "all:cam.md")?.text, "# Cam v2\n");
  assert.equal(lessons.getState().seen["all:cam.md"]?.text, "# Cam v1\n");
  assert.equal(lessons.getState().aiNotice?.key, "all:cam.md");

  markRead("all:cam.md");
  assert.equal(lessons.getState().seen["all:cam.md"]?.tag, "c2");

  await saveLesson("all:gone.md");
  assert.equal(lessons.getState().edits["all:gone.md"], undefined);
  assert.equal(
    lessons.getState().files.some((f) => f.key === "all:gone.md"),
    false,
  );
  assert.equal(lessons.getState().seen["all:gone.md"], undefined);
  assert.equal(lessons.getState().open, null);
  assert.equal(lessons.getState().aiNotice?.removed, true);

  // Non-null 409 on a brand-new topic absent from files[] inserts the AI file automatically
  await saveLesson("all:ai-created.md");
  assert.equal(lessons.getState().edits["all:ai-created.md"], undefined);
  assert.deepEqual(
    lessons.getState().files.find((f) => f.key === "all:ai-created.md"),
    {
      key: "all:ai-created.md",
      scope: "all",
      path: "ai-created.md",
      tag: "ai1",
      text: "# AI wrote first\n",
    },
  );

  const countBefore = posted.length;
  newLesson("walk", "all");
  assert.equal(lessons.getState().open, "all:Walk.md");
  assert.equal(posted.length, countBefore);

  newLesson("timing/pacing", "film");
  await flushMicrotasks();
  assert.equal(lessons.getState().open, "film:timing/pacing.md");
  assert.deepEqual(posted.at(-1)?.scope, "film");
  assert.ok(takePick("film:timing/pacing.md"));
  assert.equal(takePick("film:timing/pacing.md"), null);

  openLesson("all:Walk.md");
  setLessonView("all:Walk.md", "edit");
  assert.equal(lessons.getState().viewByPath["all:Walk.md"], "edit");
});

test("preferredView persists last manual read/edit choice in localStorage without overwriting on temporary transitions", () => {
  lessons.setState((s) => ({ ...s, viewByPath: {}, preferredView: "read" }));
  localStorage.removeItem("lessonView");

  assert.equal(readPreferredLessonView(), "read");
  localStorage.setItem("lessonView", "bogus");
  assert.equal(readPreferredLessonView(), "read");
  localStorage.setItem("lessonView", "edit");
  assert.equal(readPreferredLessonView(), "edit");

  setLessonView("all:walk.md", "edit");
  assert.equal(lessons.getState().preferredView, "edit");
  assert.equal(localStorage.getItem("lessonView"), "edit");

  setLessonView("all:cam.md", "changes");
  assert.equal(lessons.getState().viewByPath["all:cam.md"], "changes");
  assert.equal(lessons.getState().preferredView, "edit");
  assert.equal(localStorage.getItem("lessonView"), "edit");

  setLessonView("all:tmp.md", "read", false);
  assert.equal(lessons.getState().viewByPath["all:tmp.md"], "read");
  assert.equal(lessons.getState().preferredView, "edit");
  assert.equal(localStorage.getItem("lessonView"), "edit");

  setLessonView("all:other.md", "read");
  assert.equal(lessons.getState().preferredView, "read");
  assert.equal(localStorage.getItem("lessonView"), "read");
  assert.equal(lessons.getState().viewByPath["all:walk.md"], undefined);
  assert.equal(lessons.getState().viewByPath["all:tmp.md"], undefined);
  assert.equal(lessons.getState().viewByPath["all:cam.md"], "changes");
});

test("deleteLesson deletes file with base tag, ignores stale in-flight GET, and restore recreates it", async () => {
  let resolveGet;
  getHandler = () =>
    new Promise((res) => {
      resolveGet = () =>
        res(
          Response.json({
            dir: "lessons",
            files: [
              { scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" },
              { scope: "all", path: "cam.md", tag: "t2", text: "# Camera\n" },
            ],
          }),
        );
    });
  lessons.setState((s) => ({
    ...s,
    files: [
      { key: "all:walk.md", scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" },
      { key: "all:cam.md", scope: "all", path: "cam.md", tag: "t2", text: "# Camera\n" },
    ],
    edits: {},
    seen: {
      "all:walk.md": { tag: "t1", text: "# Walk\n" },
      "all:cam.md": { tag: "t2", text: "# Camera\n" },
    },
    viewByPath: { "all:walk.md": "edit" },
    open: "all:walk.md",
  }));

  const staleLoad = loadLessons();
  const res = await deleteLesson("all:walk.md");
  assert.equal(res.removed, true);
  assert.deepEqual(deleted, [{ scope: "all", path: "walk.md", base: "t1" }]);
  assert.equal(lessons.getState().open, null);
  assert.equal(
    lessons.getState().files.some((f) => f.key === "all:walk.md"),
    false,
  );
  assert.equal(lessons.getState().seen["all:walk.md"], undefined);

  resolveGet();
  await staleLoad;
  assert.equal(
    lessons.getState().files.some((f) => f.key === "all:walk.md"),
    false,
  );

  postHandler = async () => Response.json({ tag: "t-restored" });
  const ok = await res.restore();
  assert.equal(ok, true);
  assert.deepEqual(posted[0], { scope: "all", path: "walk.md", text: "# Walk\n", base: null });
  const restored = lessons.getState().files.find((f) => f.key === "all:walk.md");
  assert.equal(restored?.tag, "t-restored");
  assert.equal(restored?.text, "# Walk\n");
  assert.equal(lessons.getState().open, "all:walk.md");
});

test("deleteLesson surfaces 409 conflict without losing newer AI changes", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:walk.md", scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: {},
    seen: { "all:walk.md": { tag: "t1", text: "# Walk\n" } },
    open: null,
  }));
  deleteHandler = async () =>
    Response.json({ conflict: true, tag: "t9", text: "# Updated by AI\n" }, { status: 409 });

  const res = await deleteLesson("all:walk.md");
  assert.equal(res.removed, false);
  assert.equal(res.conflict, true);
  const f = lessons.getState().files.find((x) => x.key === "all:walk.md");
  assert.equal(f?.tag, "t9");
  assert.equal(f?.text, "# Updated by AI\n");
  assert.equal(lessons.getState().open, "all:walk.md");
});

test("deleteLesson treats an already-missing file as an external removal and keeps its draft", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:walk.md", scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: { "all:walk.md": { text: "# Draft\n", base: "t1" } },
    open: "all:walk.md",
  }));
  deleteHandler = async () => Response.json({ removed: false, missing: true });

  assert.deepEqual(await deleteLesson("all:walk.md"), { removed: false, missing: true });
  assert.equal(lessons.getState().open, null);
  assert.equal(lessons.getState().files.length, 0);
  assert.deepEqual(lessons.getState().aiNotice?.drafts, [{ path: "walk.md", text: "# Draft\n" }]);
});

test("loadLessons skips failed drafts and ignores stale out-of-order GET responses", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:bad.md", scope: "all", path: "bad.md", tag: "b1", text: "# Bad\n" }],
    edits: { "all:bad.md": { text: "# Bad edit\n", base: "b1", failed: "the studio refused it" } },
  }));

  let resolveOld;
  let call = 0;
  getHandler = () => {
    call += 1;
    if (call === 1) {
      return new Promise((res) => {
        resolveOld = () =>
          res(
            Response.json({
              dir: "stale-dir",
              files: [{ scope: "all", path: "old.md", tag: "o1", text: "# Old\n" }],
            }),
          );
      });
    }
    return Promise.resolve(
      Response.json({
        dir: "fresh-dir",
        files: [{ scope: "all", path: "bad.md", tag: "b1", text: "# Bad\n" }],
      }),
    );
  };

  const first = loadLessons();
  await loadLessons();
  resolveOld();
  await first;
  await flushMicrotasks();

  assert.equal(lessons.getState().dir, "fresh-dir");
  assert.equal(
    lessons.getState().files.some((f) => f.key === "all:old.md"),
    false,
  );
  assert.equal(posted.length, 0);
});

test("newLesson created mid-GET is preserved and typeLesson mid-save chains cleanly", async () => {
  let resolveGet;
  getHandler = () =>
    new Promise((res) => {
      resolveGet = () =>
        res(
          Response.json({
            dir: "lessons",
            files: [{ scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" }],
          }),
        );
    });
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:walk.md", scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: {},
  }));

  let firstSave = true;
  postHandler = async (body) => {
    if (firstSave) {
      firstSave = false;
      typeLesson(lessonKey(body.scope, body.path), "# Custom\n\n## Second edit\n");
      clearLessonTimers();
      return Response.json({ tag: "t2" });
    }
    return Response.json({ tag: "t3" });
  };

  const getP = loadLessons();
  newLesson("custom", "all");
  await flushMicrotasks();
  resolveGet();
  await getP;

  assert.equal(posted.length, 2);
  assert.equal(posted[1].base, "t2");
  assert.equal(posted[1].text, "# Custom\n\n## Second edit\n");
  const custom = lessons.getState().files.find((f) => f.key === "all:custom.md");
  assert.equal(custom?.tag, "t3");
  assert.equal(custom?.text, "# Custom\n\n## Second edit\n");
});

test("deleteLesson 409 does not resurrect an edit committed while DELETE was in flight", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:walk.md", scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: { "all:walk.md": { text: "# Walk v2\n", base: "t1", saving: true } },
    seen: { "all:walk.md": { tag: "t1", text: "# Walk\n" } },
    open: "all:walk.md",
  }));
  deleteHandler = async () => {
    lessons.setState((s) => ({
      ...s,
      files: [
        { key: "all:walk.md", scope: "all", path: "walk.md", tag: "t2", text: "# Walk v2\n" },
      ],
      edits: {},
    }));
    return Response.json({ conflict: true, tag: "t2", text: "# Walk v2\n" }, { status: 409 });
  };

  const res = await deleteLesson("all:walk.md");
  assert.equal(res.removed, false);
  assert.equal(res.conflict, true);
  assert.equal(lessons.getState().edits["all:walk.md"], undefined);
  assert.equal(lessons.getState().aiNotice?.drafts, undefined);
});

test("deleteLesson 409 adopts the disk version and saves the rejected draft for download", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ key: "all:walk.md", scope: "all", path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: { "all:walk.md": { text: "# Old\n", base: "t1", saving: true } },
    seen: { "all:walk.md": { tag: "t1", text: "# Walk\n" } },
    open: "all:walk.md",
  }));
  deleteHandler = async () =>
    Response.json({ conflict: true, tag: "t9", text: "# AI edit\n" }, { status: 409 });

  const res = await deleteLesson("all:walk.md");
  assert.equal(res.removed, false);
  assert.equal(res.conflict, true);
  assert.equal(lessons.getState().edits["all:walk.md"], undefined);
  assert.equal(lessons.getState().files.find((f) => f.key === "all:walk.md")?.text, "# AI edit\n");
  assert.equal(lessons.getState().seen["all:walk.md"]?.text, "# Walk\n");
  assert.deepEqual(lessons.getState().aiNotice?.drafts, [{ path: "walk.md", text: "# Old\n" }]);
});

const seedDualScopeCameraLessons = async () => {
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      projectDir: "films/sealed-room/lessons",
      files: [
        { scope: "film", path: "camera.md", tag: "f1", text: "# Film Cam\n" },
        { scope: "all", path: "camera.md", tag: "a1", text: "# Global Cam\n" },
      ],
    });
  lessons.setState((s) => ({
    ...s,
    files: [],
    edits: {},
    seen: {},
    viewByPath: {},
    open: null,
    folder: [],
    scopeFilter: "both",
  }));
  await loadLessons();
};

test("newLesson opens existing matching film copy or creates a new scoped copy independently", async () => {
  await seedDualScopeCameraLessons();
  assert.equal(lessons.getState().files.length, 2);

  newLesson("camera", "film");
  assert.equal(lessons.getState().open, "film:camera.md");

  newLesson("notes-rule", "film");
  await flushMicrotasks();
  assert.equal(posted.at(-1)?.scope, "film");
  assert.equal(posted.at(-1)?.path, "notes-rule.md");
});

test("saveLesson and deleteLesson operate independently on film vs global copies with identical paths", async () => {
  await seedDualScopeCameraLessons();

  typeLesson("all:camera.md", "# Global Cam Updated\n");
  clearLessonTimers();
  postHandler = async () => Response.json({ tag: "a2" });
  await saveLesson("all:camera.md");
  assert.deepEqual(posted.at(-1), {
    scope: "all",
    path: "camera.md",
    text: "# Global Cam Updated\n",
    base: "a1",
  });
  assert.equal(
    lessons.getState().files.find((f) => f.key === "film:camera.md")?.text,
    "# Film Cam\n",
  );

  const del = await deleteLesson("film:camera.md");
  assert.equal(del.removed, true);
  assert.deepEqual(deleted.at(-1), { scope: "film", path: "camera.md", base: "f1" });
  assert.equal(
    lessons.getState().files.some((f) => f.key === "all:camera.md"),
    true,
  );
});

test("setScopeFilter updates scopeFilter and clears hidden open file and folder", async () => {
  await seedDualScopeCameraLessons();

  setScopeFilter("film");
  assert.equal(lessons.getState().scopeFilter, "film");
  setScopeFilter("both");
  assert.equal(lessons.getState().scopeFilter, "both");

  openLesson("all:camera.md");
  assert.equal(lessons.getState().open, "all:camera.md");
  setScopeFilter("film");
  assert.equal(lessons.getState().open, null);
  assert.deepEqual(lessons.getState().folder, []);
});

test("deleteLesson, loadLessons, and conflict removal clamp stale nested folder state", async () => {
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      projectDir: "films/demo/lessons",
      files: [
        { scope: "film", path: "craft/sibling.md", tag: "f1", text: "# Sibling\n" },
        { scope: "film", path: "craft/sub/deep.md", tag: "f2", text: "# Deep\n" },
      ],
    });
  await loadLessons();

  openLesson("film:craft/sub/deep.md");
  assert.deepEqual(lessons.getState().folder, ["craft", "sub"]);

  // Deleting last file inside craft/sub shrinks folder to still-valid ancestor ["craft"]
  const delDeep = await deleteLesson("film:craft/sub/deep.md");
  assert.equal(delDeep.removed, true);
  assert.equal(lessons.getState().open, null);
  assert.deepEqual(lessons.getState().folder, ["craft"]);

  // Deleting the remaining file in craft clears folder completely to []
  const delSib = await deleteLesson("film:craft/sibling.md");
  assert.equal(delSib.removed, true);
  assert.deepEqual(lessons.getState().folder, []);

  // Re-open nested folder via loadLessons, then remove it externally via loadLessons & 409 conflict removal
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      projectDir: "films/demo/lessons",
      files: [{ scope: "film", path: "craft/sub/deep.md", tag: "f2", text: "# Deep\n" }],
    });
  await loadLessons();
  openLessonFolder(["craft", "sub"]);
  assert.deepEqual(lessons.getState().folder, ["craft", "sub"]);

  getHandler = async () =>
    Response.json({
      dir: "lessons",
      projectDir: "films/demo/lessons",
      files: [],
    });
  await loadLessons();
  assert.deepEqual(lessons.getState().folder, []);

  // External removal discovered via saveLesson 409 conflict (tag: null) also clamps folder
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      projectDir: "films/demo/lessons",
      files: [{ scope: "all", path: "craft/gone.md", tag: "g1", text: "# Gone\n" }],
    });
  await loadLessons();
  openLessonFolder(["craft"]);
  typeLesson("all:craft/gone.md", "# Gone\n- edit\n");
  clearLessonTimers();
  postHandler = async () =>
    Response.json({ conflict: true, tag: null, text: null }, { status: 409 });
  await saveLesson("all:craft/gone.md");
  assert.deepEqual(lessons.getState().folder, []);
});

test("loadLessons prunes stale seen snapshots when files are removed outside the studio", async () => {
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      files: [{ scope: "all", path: "temp.md", tag: "v1", text: "# Old Temp\n" }],
    });
  await loadLessons();
  assert.equal(lessons.getState().seen["all:temp.md"]?.tag, "v1");

  getHandler = async () => Response.json({ dir: "lessons", files: [] });
  await loadLessons();
  assert.equal(lessons.getState().seen["all:temp.md"], undefined);
});

test("a failed first load allows retry and a failed refresh keeps the loaded lessons", async () => {
  lessons.setState({ loaded: false, files: [], edits: {} });
  getHandler = async () => new Response(null, { status: 503 });
  await loadLessons();
  assert.equal(lessons.getState().loadFailed, true);
  assert.equal(lessons.getState().loaded, false);

  resetHandlers();
  await loadLessons();
  const loaded = lessons.getState();
  assert.equal(loaded.loadFailed, false);
  assert.equal(loaded.files.length, 2);

  getHandler = async () => {
    throw new Error("offline");
  };
  await loadLessons();
  assert.equal(lessons.getState().loadFailed, true);
  assert.equal(lessons.getState().files, loaded.files);
});
