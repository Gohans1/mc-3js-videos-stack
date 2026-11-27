import { describe, expect, it } from "bun:test";

import { createLiteController } from "../app/lite/store.ts";
import type { CompareVideoCatalog, LiteFilmMeta, Note } from "../app/lite/types.ts";

class MemoryStorage {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): boolean {
    this.map.set(key, value);
    return true;
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

interface FakeServerState {
  film: LiteFilmMeta;
  catalog: CompareVideoCatalog;
  notes: Note[];
  failNextPost?: boolean;
  failVideos?: boolean;
  failNotesGet?: boolean;
  postStatusQueue?: number[];
  conflictNextOp?: boolean;
  opStatusQueue?: number[];
  requests: { method: string; url: string; body?: unknown }[];
}

const makeFakeFetch = (server: FakeServerState): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    server.requests.push({ method, url, body });

    if (url === "/api/film.json") {
      return new Response(JSON.stringify(server.film), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "/api/compare-videos") {
      if (server.failVideos) {
        return new Response("down", { status: 503 });
      }
      return new Response(JSON.stringify(server.catalog), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "/api/notes" && method === "GET") {
      if (server.failNotesGet) {
        return new Response("down", { status: 503 });
      }
      const nums = Object.fromEntries(server.notes.map((n, i) => [n.id, i + 1]));
      return new Response(JSON.stringify(server.notes), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-note-numbers": JSON.stringify(nums),
        },
      });
    }
    if (url === "/api/notes" && method === "POST") {
      if (server.failNextPost) {
        server.failNextPost = false;
        throw new Error("offline");
      }
      const forcedStatus = server.postStatusQueue?.shift();
      if (forcedStatus) {
        return new Response(`status ${forcedStatus}`, { status: forcedStatus });
      }
      const payload = body as { note: Note; img?: string; crop?: string; refs?: string[] };
      const saved: Note = {
        ...payload.note,
        ...(payload.img ? { img: `notes/img/${payload.note.id}.jpg` } : {}),
        ...(payload.crop ? { crop: `notes/img/${payload.note.id}_crop.jpg` } : {}),
        ...(payload.refs?.length
          ? { refs: payload.refs.map((_, i) => `notes/img/${payload.note.id}_r${i}.jpg`) }
          : {}),
      };
      server.notes.push(saved);
      return new Response("ok", { status: 200 });
    }
    if (url.startsWith("/api/notes/") && method === "POST") {
      const id = url.slice("/api/notes/".length);
      if (server.conflictNextOp) {
        server.conflictNextOp = false;
        return new Response("conflict", { status: 409 });
      }
      const forcedStatus = server.opStatusQueue?.shift();
      if (forcedStatus) {
        return new Response(`status ${forcedStatus}`, { status: forcedStatus });
      }
      const op = body as Record<string, unknown>;
      if (op.remove) {
        server.notes = server.notes.filter((n) => n.id !== id);
      } else if (op.restore) {
        if (!server.notes.some((n) => n.id === id)) {
          server.notes.push({
            id,
            at: "2026-01-01T00:00:00.000Z",
            t: 1,
            time: "00:01.000",
            frame: 30,
            shot: 0,
            text: typeof op.text === "string" ? op.text : "Restored",
            done: false,
          });
        }
      }
      return new Response("ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

const makeServer = (): FakeServerState => ({
  film: {
    name: "demo-film",
    ratio: "9:16",
    duration: 20,
    shots: [
      { t: 0, name: "Intro" },
      { t: 5, name: "Action" },
    ],
  },
  catalog: {
    videos: [
      {
        path: "renders/reference/v2_helper.mp4",
        name: "v2_helper.mp4",
        category: "compare",
        size: 500,
        mtimeMs: 9000,
        startSec: 0,
        layout: "hstack",
      },
      {
        path: "renders/reference/ref_vs_draft.mp4",
        name: "ref_vs_draft.mp4",
        category: "compare",
        size: 1200,
        mtimeMs: 8000,
        startSec: 0,
        layout: "hstack",
      },
      {
        path: "renders/draft.mp4",
        name: "draft.mp4",
        category: "render",
        size: 800,
        mtimeMs: 9500,
        startSec: 0,
        layout: "single",
      },
    ],
    defaultPath: "renders/reference/v2_helper.mp4",
    canBuild: { ref: null, ours: "renders/draft.mp4" },
  },
  notes: [
    {
      id: "check1",
      at: "2026-01-01T00:00:00.000Z",
      t: 2,
      time: "00:02.000",
      frame: 60,
      shot: 0,
      shotName: "Intro",
      text: "Fix sky color",
      done: true,
      state: "check",
      fixes: [{ what: "Adjusted sky grade", at: "2026-01-01T01:00:00.000Z" }],
    },
    {
      id: "ask1",
      at: "2026-01-01T00:01:00.000Z",
      t: 6,
      time: "00:06.000",
      frame: 180,
      shot: 1,
      shotName: "Action",
      text: "Move actor",
      done: true,
      state: "check",
      fixes: [{ what: "Left or right?", at: "2026-01-01T01:05:00.000Z", ask: true }],
    },
  ],
  requests: [],
});

describe("Lite store controller", () => {
  it("loads film, auto-selects latest explicit compare video, and loads notes with numbers", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });

    await ctrl.init();
    const s = ctrl.store.getState();

    expect(s.film.name).toBe("demo-film");
    expect(s.selectedPath).toBe("renders/reference/ref_vs_draft.mp4");
    expect(s.videos).toHaveLength(3);
    expect(s.notes).toHaveLength(2);
    expect(s.noteNumbers).toEqual({ check1: 1, ask1: 2 });
  });

  it("switches videos and preserves selection across manual refresh", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });

    await ctrl.init();
    ctrl.selectVideo("renders/draft.mp4");
    expect(ctrl.store.getState().selectedPath).toBe("renders/draft.mp4");

    await ctrl.refreshAll();
    expect(ctrl.store.getState().selectedPath).toBe("renders/draft.mp4");
  });

  it("creates a note with compare metadata and captured media, then flushes to API", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    ctrl.openCreateNote({ x: 0.75, y: 0.5, what: "OURS · right" }, 6.5, false);
    ctrl.setDraft("Right side arm clips through wall");
    await ctrl.saveCompose({
      capture: async () => ({
        img: "data:image/jpeg;base64,/9j/frame",
        crop: "data:image/jpeg;base64,/9j/crop",
        strip: null,
        frames: [],
        dimensions: [1080, 960],
      }),
    });
    await ctrl.whenFlushed();

    expect(ctrl.store.getState().compose).toBeNull();
    const created = ctrl.store.getState().notes.find((n) => n.text === "Right side arm clips through wall");
    expect(created).toBeDefined();
    expect(created?.shot).toBe(1);
    expect(created?.compareVideo?.path).toBe("renders/reference/ref_vs_draft.mp4");
    expect(created?.img).toBe(`notes/img/${created!.id}.jpg`);
    expect(created?.crop).toBe(`notes/img/${created!.id}_crop.jpg`);
    expect(server.notes).toHaveLength(3);
  });

  it("handles approve, answer AI ask, remember, edit, delete, restore, and 409 reload", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    const checkNote = ctrl.store.getState().notes.find((n) => n.id === "check1")!;
    expect(ctrl.approveNote(checkNote)).toBe(true);
    await ctrl.whenFlushed();
    expect(ctrl.store.getState().notes.find((n) => n.id === "check1")?.state).toBe("done");

    const askNote = ctrl.store.getState().notes.find((n) => n.id === "ask1")!;
    expect(ctrl.answerNote(askNote, "Move left by 1 block")).toBe(true);
    await ctrl.whenFlushed();
    expect(ctrl.store.getState().notes.find((n) => n.id === "ask1")?.state).toBe("open");

    expect(ctrl.rememberNote(askNote, "film")).toBe(true);
    await ctrl.whenFlushed();
    expect(ctrl.store.getState().notes.find((n) => n.id === "ask1")?.remember?.scope).toBe("film");

    ctrl.removeNote(askNote);
    await ctrl.whenFlushed();
    expect(ctrl.store.getState().notes.some((n) => n.id === "ask1")).toBe(false);

    ctrl.restoreNote(askNote);
    await ctrl.whenFlushed();
    expect(ctrl.store.getState().notes.some((n) => n.id === "ask1")).toBe(true);

    server.conflictNextOp = true;
    const latest = ctrl.store.getState().notes.find((n) => n.id === "check1")!;
    ctrl.reopenNote(latest);
    await ctrl.whenFlushed();
    expect(
      server.requests.filter((r) => r.url === "/api/notes" && r.method === "GET").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("queues failed saves in storage and retries cleanly", async () => {
    const server = makeServer();
    server.failNextPost = true;
    const storage = new MemoryStorage();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage,
      retryDelayMs: 10,
    });
    await ctrl.init();

    ctrl.openCreateNote(null, 3.0, false);
    ctrl.setDraft("Queued offline note");
    await ctrl.saveCompose({
      capture: async () => ({
        img: "data:image/jpeg;base64,/9j/offline",
        crop: null,
        strip: null,
        frames: [],
        dimensions: [640, 360],
      }),
    });
    await ctrl.whenFlushed();

    expect(server.notes.some((n) => n.text === "Queued offline note")).toBe(true);
    expect(ctrl.store.getState().saved).toBeNull();
    expect(storage.get("liteUnsentNotes")).toBe("[]");
  });

  it("cancels dirty create compose with undo when switching videos and restores original video on undo", async () => {
    const server = makeServer();
    let lastNotice: { title: string; undo?: () => void } | null = null;
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
      onNotice: (n) => {
        lastNotice = n;
      },
    });
    await ctrl.init();

    ctrl.openCreateNote({ x: 0.25, y: 0.5, what: "REF · left" }, 2.0, true);
    ctrl.setDraft("Unsaved note on compare clip");
    ctrl.setInkMarks([{ kind: "box", t: 2.0, pts: [[0.1, 0.1], [0.4, 0.4]] }]);

    ctrl.selectVideo("renders/draft.mp4");
    expect(ctrl.store.getState().selectedPath).toBe("renders/draft.mp4");
    expect(ctrl.store.getState().compose).toBeNull();
    expect(ctrl.store.getState().inkMarks).toHaveLength(0);
    expect(lastNotice?.undo).toBeDefined();

    lastNotice!.undo!();
    expect(ctrl.store.getState().selectedPath).toBe("renders/reference/ref_vs_draft.mp4");
    expect(ctrl.store.getState().compose?.kind).toBe("create");
    expect(ctrl.store.getState().draft).toBe("Unsaved note on compare clip");
    expect(ctrl.store.getState().inkMarks).toHaveLength(1);
  });

  it("ignores non-null ink tools while editing a note", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    const note = ctrl.store.getState().notes[0]!;
    ctrl.openEditNote(note, false);
    ctrl.setInkTool("pen");
    expect(ctrl.store.getState().inkTool).toBeNull();
    ctrl.setInkTool("box");
    expect(ctrl.store.getState().inkTool).toBeNull();
  });

  it("preserves wasPlaying and resume when re-tapping video during an open create compose", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    ctrl.openCreateNote({ x: 0.2, y: 0.5, what: "REF · left" }, 3.0, true);
    ctrl.openCreateNote({ x: 0.8, y: 0.5, what: "OURS · right" }, 3.0, false);
    const compose = ctrl.store.getState().compose;
    expect(compose?.kind).toBe("create");
    if (compose?.kind === "create") {
      expect(compose.wasPlaying).toBe(true);
      expect(compose.resume).toBe(true);
      expect(compose.pin?.what).toBe("OURS · right");
    }
  });

  it("recovers from permanent HTTP 400 and retries HTTP 413 with heavy media stripped without stalling queue", async () => {
    const server = makeServer();
    const notices: { title: string; description?: string; type?: string }[] = [];
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
      onNotice: (n) => notices.push(n),
    });
    await ctrl.init();

    server.postStatusQueue = [400];
    ctrl.openCreateNote(null, 1.0, false);
    ctrl.setDraft("Bad payload note");
    await ctrl.saveCompose({
      capture: async () => ({
        img: "data:image/jpeg;base64,/9j/bad",
        crop: null,
        strip: null,
        frames: [],
        dimensions: [640, 360],
      }),
    });
    await ctrl.whenFlushed();

    expect(ctrl.store.getState().saved).toBeNull();
    expect(ctrl.getUnsentNotes()).toHaveLength(0);
    expect(notices.some((n) => n.type === "error" && n.description === "Bad payload note")).toBe(true);

    server.postStatusQueue = [413];
    ctrl.openCreateNote({ x: 0.5, y: 0.5, what: "REF · left" }, 2.0, false);
    ctrl.setDraft("Large note retried slim");
    await ctrl.saveCompose({
      capture: async () => ({
        img: "data:image/jpeg;base64,/9j/main",
        crop: "data:image/jpeg;base64,/9j/crop",
        strip: "data:image/jpeg;base64,/9j/strip",
        frames: [{ t: 2, img: "data:image/jpeg;base64,/9j/f0" }],
        dimensions: [640, 360],
      }),
    });
    await ctrl.whenFlushed();

    const postReqs = server.requests.filter((r) => r.url === "/api/notes" && r.method === "POST");
    const lastReqBody = postReqs.at(-1)?.body as Record<string, unknown>;
    expect(lastReqBody.strip).toBeUndefined();
    expect(lastReqBody.frames).toBeUndefined();
    expect(lastReqBody.crop).toBeUndefined();
    expect(lastReqBody.img).toBe("data:image/jpeg;base64,/9j/main");
    expect(server.notes.some((n) => n.text === "Large note retried slim")).toBe(true);
    expect(ctrl.store.getState().saved).toBeNull();
  });

  it("preserves dirty create compose with Undo on openEditNote and blocks openEditNote while noteSaving", async () => {
    const server = makeServer();
    const notices: { title: string; undo?: () => void }[] = [];
    const seeks: { t: number; clipChanged: boolean }[] = [];
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
      onNotice: (n) => notices.push(n),
      onSeek: (t, clipChanged) => seeks.push({ t, clipChanged }),
    });
    await ctrl.init();

    const targetNote = ctrl.store.getState().notes[0]!;
    ctrl.openCreateNote({ x: 0.3, y: 0.4, what: "REF · left" }, 4.5, false);
    ctrl.setDraft("Important unsaved observation");
    ctrl.setInkMarks([{ kind: "box", t: 4.5, pts: [[0.1, 0.2], [0.4, 0.5]] }]);
    const revBefore = ctrl.store.getState().inkRev;

    ctrl.openEditNote(targetNote, false);
    expect(ctrl.store.getState().compose?.kind).toBe("edit");
    expect(ctrl.store.getState().inkMarks).toHaveLength(0);
    expect(ctrl.store.getState().inkRev).toBeGreaterThan(revBefore);
    const undoNotice = notices.at(-1);
    expect(undoNotice?.undo).toBeDefined();

    undoNotice!.undo!();
    expect(ctrl.store.getState().compose?.kind).toBe("create");
    expect(ctrl.store.getState().draft).toBe("Important unsaved observation");
    expect(ctrl.store.getState().inkMarks).toHaveLength(1);
    expect(seeks.at(-1)).toEqual({ t: 4.5, clipChanged: false });

    let releaseCapture!: () => void;
    const saving = ctrl.saveCompose({
      capture: () =>
        new Promise((resolve) => {
          releaseCapture = () =>
            resolve({
              img: "data:image/jpeg;base64,/9j/a",
              crop: null,
              strip: null,
              frames: [],
              dimensions: [640, 360],
            });
        }),
    });
    expect(ctrl.store.getState().noteSaving).toBe(true);
    ctrl.openEditNote(targetNote, false);
    expect(ctrl.store.getState().compose?.kind).toBe("create");

    releaseCapture();
    await saving;
    await ctrl.whenFlushed();
  });

  it("uses non-blocking statusPill instead of toasts for routine actions and warns on offline refresh", async () => {
    const server = makeServer();
    const notices: { title: string; type?: string; undo?: () => void }[] = [];
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
      onNotice: (n) => notices.push(n),
    });
    await ctrl.init();

    const checkNote = ctrl.store.getState().notes.find((n) => n.id === "check1")!;
    ctrl.approveNote(checkNote);
    expect(notices).toHaveLength(0);
    expect(ctrl.store.getState().statusPill).toContain("Approved");

    const askNote = ctrl.store.getState().notes.find((n) => n.id === "ask1")!;
    ctrl.rememberNote(askNote, "film");
    expect(notices).toHaveLength(0);
    expect(ctrl.store.getState().statusPill).toContain("Remember");

    ctrl.answerNote(askNote, "Shift left");
    expect(notices).toHaveLength(0);
    expect(ctrl.store.getState().statusPill).toContain("Sent back to AI");
    await ctrl.whenFlushed();

    server.failVideos = true;
    await ctrl.refreshAll();
    expect(notices.some((n) => n.type === "warning" || n.type === "error")).toBe(true);
  });

  it("seeks back to original timestamp on video-switch Undo and cancelCompose Undo", async () => {
    const server = makeServer();
    const notices: { title: string; undo?: () => void }[] = [];
    const seeks: { t: number; clipChanged: boolean }[] = [];
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
      onNotice: (n) => notices.push(n),
      onSeek: (t, clipChanged) => seeks.push({ t, clipChanged }),
    });
    await ctrl.init();

    ctrl.openCreateNote({ x: 0.2, y: 0.3, what: "REF · left" }, 7.25, false);
    ctrl.setDraft("Switch draft");
    ctrl.selectVideo("renders/draft.mp4");
    notices.at(-1)!.undo!();
    expect(ctrl.store.getState().selectedPath).toBe("renders/reference/ref_vs_draft.mp4");
    expect(seeks.at(-1)).toEqual({ t: 7.25, clipChanged: true });

    ctrl.cancelCompose();
    notices.at(-1)!.undo!();
    expect(seeks.at(-1)).toEqual({ t: 7.25, clipChanged: false });
  });

  it("sets autoFocus=false for draw/drag opens and autoFocus=true by default for pin/button opens", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    ctrl.openCreateNote(null, 1.0, false, { autoFocus: false });
    const drawCompose = ctrl.store.getState().compose;
    expect(drawCompose?.kind).toBe("create");
    if (drawCompose?.kind === "create") {
      expect(drawCompose.autoFocus).toBe(false);
    }

    ctrl.closeCompose();
    ctrl.openCreateNote({ x: 0.25, y: 0.5, what: "REF · left" }, 2.0, false);
    const pinCompose = ctrl.store.getState().compose;
    expect(pinCompose?.kind).toBe("create");
    if (pinCompose?.kind === "create") {
      expect(pinCompose.autoFocus).toBe(true);
    }
  });

  it("clears videoError and increments videoReloadSeq on refreshAll and same-path re-select even when file metadata is unchanged", async () => {
    const server = makeServer();
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    const seq0 = ctrl.store.getState().videoReloadSeq;
    ctrl.onVideoError("Decode failed");
    expect(ctrl.store.getState().videoError).toBe("Decode failed");

    await ctrl.refreshAll();
    expect(ctrl.store.getState().videoError).toBeNull();
    expect(ctrl.store.getState().videoReloadSeq).toBe(seq0 + 1);

    ctrl.onVideoError("Transient network drop");
    ctrl.selectVideo("renders/reference/ref_vs_draft.mp4");
    expect(ctrl.store.getState().videoError).toBeNull();
    expect(ctrl.store.getState().videoReloadSeq).toBe(seq0 + 2);
  });

  it("reconciles compare layout and pin/mark hits from captured dimensions when layoutExact is absent", async () => {
    const server = makeServer();
    server.film.ratio = "16:9";
    const ctrl = createLiteController({
      fetchFn: makeFakeFetch(server),
      storage: new MemoryStorage(),
      retryDelayMs: 5,
    });
    await ctrl.init();

    ctrl.openCreateNote({ x: 0.5, y: 0.8, what: "OURS · right" }, 2.0, false);
    ctrl.setDraft("Check bottom panel");
    ctrl.setInkMarks([{ kind: "box", t: 2.0, pts: [[0.2, 0.7], [0.8, 0.9]] }]);
    await ctrl.saveCompose({
      capture: async () => ({
        img: "data:image/jpeg;base64,/9j/vstack",
        crop: null,
        strip: null,
        frames: [],
        dimensions: [1280, 1520],
      }),
    });
    await ctrl.whenFlushed();

    const saved = ctrl.store.getState().notes.find((n) => n.text === "Check bottom panel");
    expect(saved?.compareVideo?.layout).toBe("vstack");
    expect(saved?.pin?.what).toBe("OURS · bottom");
    expect(saved?.marks?.[0]?.hits?.[0]?.what).toBe("OURS · bottom");
  });
});
