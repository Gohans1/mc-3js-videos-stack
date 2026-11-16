// app/lessons/lessons.ts: store reload drafts, concurrent load/save races, conflicts, retry, and persistent view mode.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

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
    files: [
      { path: "walk.md", tag: "t1", text: "# Walk\n" },
      { path: "cam.md", tag: "t2", text: "# Camera, the AI's\n" },
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
  keepMine,
  lessons,
  loadLessons,
  markRead,
  newLesson,
  openLesson,
  readPreferredLessonView,
  saveLesson,
  setLessonView,
  takePick,
  takeTheirs,
  typeLesson,
} = await import("../app/lessons/lessons.ts");

const resetHandlers = () => {
  posted.length = 0;
  deleted.length = 0;
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      files: [
        { path: "walk.md", tag: "t1", text: "# Walk\n" },
        { path: "cam.md", tag: "t2", text: "# Camera, the AI's\n" },
      ],
    });
  postHandler = async () => Response.json({ tag: "t3" });
  deleteHandler = async () => Response.json({ removed: true });
};

beforeEach(() => {
  clearLessonTimers();
  resetHandlers();
});

test("a draft a reload cut off is saved on its version; one the AI changed meanwhile waits for the creator", async () => {
  await loadLessons();
  await flushMicrotasks();
  assert.deepEqual(posted, [
    { path: "walk.md", text: "# Walk\n\n## Feet stay planted\n", base: "t1" },
  ]);
  const { edits, files } = lessons.getState();
  assert.equal(edits["walk.md"], undefined);
  assert.equal(files.find((f) => f.path === "walk.md")?.text, "# Walk\n\n## Feet stay planted\n");
  assert.deepEqual(edits["cam.md"]?.conflict, { tag: "t2", text: "# Camera, the AI's\n" });
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
    edits: { ...s.edits, "race.md": { text: "# Race\n", base: null } },
  }));
  postHandler = async () => {
    const { "race.md": _, ...rest } = lessons.getState().edits;
    lessons.setState({ edits: rest });
    return Response.json({ tag: "t4" });
  };
  await saveLesson("race.md");
  assert.equal(lessons.getState().edits["race.md"], undefined);
});

test("loadLessons preserves a saveLesson completion that landed while GET /api/lessons was in flight", async () => {
  let resolveGet;
  getHandler = () =>
    new Promise((res) => {
      resolveGet = () =>
        res(
          Response.json({
            dir: "lessons",
            files: [{ path: "walk.md", tag: "t3", text: "# Old before save\n" }],
          }),
        );
    });
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "walk.md", tag: "t3", text: "# Old before save\n" }],
    edits: { "walk.md": { text: "# Saved mid-load\n", base: "t3" } },
  }));
  postHandler = async () => Response.json({ tag: "t9" });

  const loadPromise = loadLessons();
  await saveLesson("walk.md");
  resolveGet();
  await loadPromise;
  await flushMicrotasks();

  const walk = lessons.getState().files.find((f) => f.path === "walk.md");
  assert.equal(walk?.tag, "t9");
  assert.equal(walk?.text, "# Saved mid-load\n");
  assert.equal(lessons.getState().seen["walk.md"]?.tag, "t9");
  assert.equal(lessons.getState().edits["walk.md"], undefined);
});

test("loadLessons does not prematurely flush an actively debounced typeLesson timer", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "draft.md", tag: "d1", text: "# Draft\n" }],
    edits: {},
  }));
  getHandler = async () =>
    Response.json({
      dir: "lessons",
      files: [{ path: "draft.md", tag: "d1", text: "# Draft\n" }],
    });

  typeLesson("draft.md", "# Draft\n- Still typing\n");
  await loadLessons();
  await flushMicrotasks();

  assert.equal(posted.length, 0);
  assert.equal(lessons.getState().edits["draft.md"]?.text, "# Draft\n- Still typing\n");
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
      edits: { "bad.md": { text: "# Bad\n", base: null } },
    }));
    postHandler = async () => Response.json({ error: "invalid name" }, { status: 400 });
    await saveLesson("bad.md");
    assert.equal(lessons.getState().edits["bad.md"]?.failed, "invalid name");
    assert.equal(scheduled.length, 0);

    postHandler = async () => {
      throw new Error("offline");
    };
    await saveLesson("bad.md");
    assert.equal(lessons.getState().edits["bad.md"]?.failed, "the studio didn't answer");
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].ms, 3000);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("keepMine, takeTheirs, markRead, openLesson, setLessonView, and case-insensitive newLesson", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [
      { path: "Walk.md", tag: "w1", text: "# Walk\n" },
      { path: "cam.md", tag: "c2", text: "# Cam v2\n" },
    ],
    seen: { "cam.md": { tag: "c1", text: "# Cam v1\n" } },
    edits: {
      "cam.md": {
        text: "# Cam mine\n",
        base: "c1",
        conflict: { tag: "c2", text: "# Cam v2\n" },
      },
      "gone.md": {
        text: "# Gone mine\n",
        base: "g1",
        conflict: { tag: null, text: null },
      },
    },
  }));

  markRead("cam.md");
  assert.equal(lessons.getState().seen["cam.md"]?.tag, "c2");

  keepMine("cam.md");
  await flushMicrotasks();
  assert.deepEqual(posted[0], { path: "cam.md", text: "# Cam mine\n", base: "c2" });
  assert.equal(lessons.getState().edits["cam.md"], undefined);

  takeTheirs("gone.md");
  assert.equal(lessons.getState().edits["gone.md"], undefined);
  assert.equal(
    lessons.getState().files.some((f) => f.path === "gone.md"),
    false,
  );

  newLesson("walk");
  assert.equal(lessons.getState().open, "Walk.md");
  assert.equal(posted.length, 1);

  newLesson("timing/pacing");
  await flushMicrotasks();
  assert.equal(lessons.getState().open, "timing/pacing.md");
  assert.ok(takePick("timing/pacing.md"));
  assert.equal(takePick("timing/pacing.md"), null);

  openLesson("Walk.md");
  setLessonView("Walk.md", "edit");
  assert.equal(lessons.getState().viewByPath["Walk.md"], "edit");
});

test("preferredView persists last manual read/edit choice in localStorage without overwriting on temporary transitions", () => {
  lessons.setState((s) => ({ ...s, viewByPath: {}, preferredView: "read" }));
  localStorage.removeItem("lessonView");

  assert.equal(readPreferredLessonView(), "read");
  localStorage.setItem("lessonView", "bogus");
  assert.equal(readPreferredLessonView(), "read");
  localStorage.setItem("lessonView", "edit");
  assert.equal(readPreferredLessonView(), "edit");

  setLessonView("walk.md", "edit");
  assert.equal(lessons.getState().preferredView, "edit");
  assert.equal(localStorage.getItem("lessonView"), "edit");

  setLessonView("cam.md", "changes");
  assert.equal(lessons.getState().viewByPath["cam.md"], "changes");
  assert.equal(lessons.getState().preferredView, "edit");
  assert.equal(localStorage.getItem("lessonView"), "edit");

  setLessonView("tmp.md", "read", false);
  assert.equal(lessons.getState().viewByPath["tmp.md"], "read");
  assert.equal(lessons.getState().preferredView, "edit");
  assert.equal(localStorage.getItem("lessonView"), "edit");

  setLessonView("other.md", "read");
  assert.equal(lessons.getState().preferredView, "read");
  assert.equal(localStorage.getItem("lessonView"), "read");
  // Previous read/edit overrides clear so switching back uses the latest preference
  assert.equal(lessons.getState().viewByPath["walk.md"], undefined);
  assert.equal(lessons.getState().viewByPath["tmp.md"], undefined);
  // Per-file diff review ("changes") override stays independent
  assert.equal(lessons.getState().viewByPath["cam.md"], "changes");
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
              { path: "walk.md", tag: "t1", text: "# Walk\n" },
              { path: "cam.md", tag: "t2", text: "# Camera\n" },
            ],
          }),
        );
    });
  lessons.setState((s) => ({
    ...s,
    files: [
      { path: "walk.md", tag: "t1", text: "# Walk\n" },
      { path: "cam.md", tag: "t2", text: "# Camera\n" },
    ],
    edits: {},
    seen: {
      "walk.md": { tag: "t1", text: "# Walk\n" },
      "cam.md": { tag: "t2", text: "# Camera\n" },
    },
    viewByPath: { "walk.md": "edit" },
    open: "walk.md",
  }));

  const staleLoad = loadLessons();
  const res = await deleteLesson("walk.md");
  assert.equal(res.removed, true);
  assert.deepEqual(deleted, [{ path: "walk.md", base: "t1" }]);
  assert.equal(lessons.getState().open, null);
  assert.equal(
    lessons.getState().files.some((f) => f.path === "walk.md"),
    false,
  );
  assert.equal(lessons.getState().seen["walk.md"], undefined);

  // Stale GET resolving after delete must not resurrect the deleted file
  resolveGet();
  await staleLoad;
  assert.equal(
    lessons.getState().files.some((f) => f.path === "walk.md"),
    false,
  );

  postHandler = async () => Response.json({ tag: "t-restored" });
  const ok = await res.restore();
  assert.equal(ok, true);
  assert.deepEqual(posted[0], { path: "walk.md", text: "# Walk\n", base: null });
  const restored = lessons.getState().files.find((f) => f.path === "walk.md");
  assert.equal(restored?.tag, "t-restored");
  assert.equal(restored?.text, "# Walk\n");
  assert.equal(lessons.getState().open, "walk.md");
});

test("deleteLesson surfaces 409 conflict without losing newer AI changes", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: {},
    seen: { "walk.md": { tag: "t1", text: "# Walk\n" } },
    open: null,
  }));
  deleteHandler = async () =>
    Response.json({ conflict: true, tag: "t9", text: "# Updated by AI\n" }, { status: 409 });

  const res = await deleteLesson("walk.md");
  assert.equal(res.removed, false);
  assert.equal(res.conflict, true);
  const f = lessons.getState().files.find((x) => x.path === "walk.md");
  assert.equal(f?.tag, "t9");
  assert.equal(f?.text, "# Updated by AI\n");
  assert.equal(lessons.getState().open, "walk.md");
});

test("loadLessons skips failed drafts and ignores stale out-of-order GET responses", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "bad.md", tag: "b1", text: "# Bad\n" }],
    edits: { "bad.md": { text: "# Bad edit\n", base: "b1", failed: "the studio refused it" } },
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
              files: [{ path: "old.md", tag: "o1", text: "# Old\n" }],
            }),
          );
      });
    }
    return Promise.resolve(
      Response.json({ dir: "fresh-dir", files: [{ path: "bad.md", tag: "b1", text: "# Bad\n" }] }),
    );
  };

  const first = loadLessons();
  await loadLessons();
  resolveOld();
  await first;
  await flushMicrotasks();

  assert.equal(lessons.getState().dir, "fresh-dir");
  assert.equal(
    lessons.getState().files.some((f) => f.path === "old.md"),
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
            files: [{ path: "walk.md", tag: "t1", text: "# Walk\n" }],
          }),
        );
    });
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: {},
  }));

  let firstSave = true;
  postHandler = async (body) => {
    if (firstSave) {
      firstSave = false;
      // Creator keeps typing while the first save is still in flight
      typeLesson(body.path, "# Custom\n\n## Second edit\n");
      clearLessonTimers();
      return Response.json({ tag: "t2" });
    }
    return Response.json({ tag: "t3" });
  };

  const getP = loadLessons();
  newLesson("custom");
  await flushMicrotasks();
  resolveGet();
  await getP;

  assert.equal(posted.length, 2);
  assert.equal(posted[1].base, "t2");
  assert.equal(posted[1].text, "# Custom\n\n## Second edit\n");
  const custom = lessons.getState().files.find((f) => f.path === "custom.md");
  assert.equal(custom?.tag, "t3");
  assert.equal(custom?.text, "# Custom\n\n## Second edit\n");
});

test("deleteLesson 409 does not resurrect an edit committed while DELETE was in flight", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: { "walk.md": { text: "# Walk v2\n", base: "t1", saving: true } },
    seen: { "walk.md": { tag: "t1", text: "# Walk\n" } },
    open: "walk.md",
  }));
  deleteHandler = async () => {
    // Autosave commits on server and clears edits["walk.md"] before DELETE returns 409
    lessons.setState((s) => ({
      ...s,
      files: [{ path: "walk.md", tag: "t2", text: "# Walk v2\n" }],
      edits: {},
    }));
    return Response.json({ conflict: true, tag: "t2", text: "# Walk v2\n" }, { status: 409 });
  };

  const res = await deleteLesson("walk.md");
  assert.equal(res.removed, false);
  assert.equal(res.conflict, true);
  assert.equal(lessons.getState().edits["walk.md"], undefined);
});

test("deleteLesson 409 preserves newer mid-flight typing and clears saving flag", async () => {
  lessons.setState((s) => ({
    ...s,
    files: [{ path: "walk.md", tag: "t1", text: "# Walk\n" }],
    edits: { "walk.md": { text: "# Old\n", base: "t1", saving: true } },
    seen: { "walk.md": { tag: "t1", text: "# Walk\n" } },
    open: "walk.md",
  }));
  deleteHandler = async () => {
    typeLesson("walk.md", "# Newer local words\n");
    clearLessonTimers();
    return Response.json({ conflict: true, tag: "t9", text: "# AI edit\n" }, { status: 409 });
  };

  const res = await deleteLesson("walk.md");
  assert.equal(res.removed, false);
  assert.equal(res.conflict, true);
  assert.deepEqual(lessons.getState().edits["walk.md"], {
    text: "# Newer local words\n",
    base: "t1",
    saving: false,
    conflict: { tag: "t9", text: "# AI edit\n" },
  });
});
