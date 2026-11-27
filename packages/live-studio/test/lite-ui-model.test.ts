import { describe, expect, it } from "bun:test";

import { LitePlaybackClock } from "../app/lite/playback.ts";
import type { CompareVideoCatalog, CompareVideoItem } from "../src/compare-video-meta.ts";
import { wholeNote } from "../src/note-state.mjs";
import {
  applyNoteChange,
  buildNotePayload,
  clampRatio,
  clock,
  filterAndGroupNotes,
  groupVideosByCategory,
  inkSpan,
  inkTimes,
  inkWords,
  isCreatorNeedsWork,
  isNoteAsking,
  markHitsForCompare,
  noteNumberMap,
  noteState,
  pickDefaultVideoPath,
  pinShortLabel,
  resolveNoteMedia,
  shotAtTime,
  summarizeNoteThread,
} from "../app/lite/model.ts";
import type { Mark, Note } from "../app/lite/types.ts";

const makeVideo = (overrides: Partial<CompareVideoItem> & { path: string }): CompareVideoItem => ({
  name: overrides.path.split("/").pop() ?? overrides.path,
  category: "compare",
  size: 1024,
  mtimeMs: 1000,
  startSec: 0,
  layout: "hstack",
  ...overrides,
});

describe("pickDefaultVideoPath", () => {
  it("prefers explicit compare filename tokens over newer helper clips in renders/reference/", () => {
    const catalog: CompareVideoCatalog = {
      videos: [
        makeVideo({ path: "renders/reference/v17_w2.mp4", mtimeMs: 5000, category: "compare" }),
        makeVideo({ path: "renders/reference/v17_sbs.mp4", mtimeMs: 4000, category: "compare" }),
        makeVideo({ path: "renders/draft.mp4", mtimeMs: 6000, category: "render", layout: "single" }),
      ],
      defaultPath: "renders/reference/v17_w2.mp4",
      canBuild: { ref: null, ours: null },
    };

    expect(pickDefaultVideoPath(catalog)).toBe("renders/reference/v17_sbs.mp4");
  });

  it("prefers ref_vs_draft over render and reference videos", () => {
    const catalog: CompareVideoCatalog = {
      videos: [
        makeVideo({ path: "renders/reference/ref_vs_draft.mp4", mtimeMs: 3000, category: "compare" }),
        makeVideo({ path: "renders/draft.mp4", mtimeMs: 9000, category: "render", layout: "single" }),
        makeVideo({ path: "references/ref.mp4", mtimeMs: 1000, category: "reference", layout: "single" }),
      ],
      defaultPath: "renders/reference/ref_vs_draft.mp4",
      canBuild: { ref: "references/ref.mp4", ours: "renders/draft.mp4" },
    };

    expect(pickDefaultVideoPath(catalog)).toBe("renders/reference/ref_vs_draft.mp4");
  });

  it("prefers compare video with layoutExact when no explicit token matches", () => {
    const catalog: CompareVideoCatalog = {
      videos: [
        makeVideo({ path: "renders/reference/clip_a.mp4", mtimeMs: 5000, category: "compare" }),
        makeVideo({
          path: "renders/reference/clip_b.mp4",
          mtimeMs: 4000,
          category: "compare",
          layoutExact: true,
        }),
      ],
      defaultPath: "renders/reference/clip_a.mp4",
      canBuild: { ref: null, ours: null },
    };

    expect(pickDefaultVideoPath(catalog)).toBe("renders/reference/clip_b.mp4");
  });

  it("falls back to catalog.defaultPath and then first video when no compare video exists", () => {
    const withDefault: CompareVideoCatalog = {
      videos: [
        makeVideo({ path: "renders/draft.mp4", category: "render", layout: "single" }),
        makeVideo({ path: "references/ref.mp4", category: "reference", layout: "single" }),
      ],
      defaultPath: "renders/draft.mp4",
      canBuild: { ref: "references/ref.mp4", ours: "renders/draft.mp4" },
    };
    expect(pickDefaultVideoPath(withDefault)).toBe("renders/draft.mp4");

    const empty: CompareVideoCatalog = {
      videos: [],
      defaultPath: null,
      canBuild: { ref: null, ours: null },
    };
    expect(pickDefaultVideoPath(empty)).toBeNull();
  });
});

describe("groupVideosByCategory", () => {
  it("groups videos in Compare, Renders, Reference order and omits empty groups", () => {
    const videos = [
      makeVideo({ path: "references/ref.mp4", category: "reference", layout: "single" }),
      makeVideo({ path: "renders/reference/ref_vs_ours.mp4", category: "compare", layout: "hstack" }),
    ];
    const groups = groupVideosByCategory(videos, "9:16");
    expect(groups.map((g) => g.category)).toEqual(["compare", "reference"]);
    expect(groups[0].label).toBe("Compare (REF | OURS)");
    expect(groups[1].label).toBe("Reference");
  });
});

describe("noteState and applyNoteChange", () => {
  const baseNote = (): Note => ({
    id: "abc123",
    at: "2026-01-01T00:00:00.000Z",
    t: 2.5,
    time: "00:02.500",
    frame: 75,
    shot: 1,
    shotName: "Intro",
    text: "Lighting too dark",
    done: false,
  });

  it("derives state from explicit state or legacy done boolean", () => {
    expect(noteState(baseNote())).toBe("open");
    expect(noteState({ ...baseNote(), done: true })).toBe("done");
    expect(noteState({ ...baseNote(), state: "check", done: true })).toBe("check");
  });

  it("approves a fixed check note and rejects approving an AI question", () => {
    const fixed: Note = {
      ...baseNote(),
      state: "check",
      done: true,
      fixes: [{ what: "Raised key light", at: "2026-01-01T01:00:00.000Z" }],
    };
    const ok = applyNoteChange(fixed, { approve: true }, "2026-01-01T02:00:00.000Z");
    expect(ok).toEqual({ ok: true });
    expect(noteState(fixed)).toBe("done");
    expect(fixed.approved).toBe("2026-01-01T02:00:00.000Z");

    const asking: Note = {
      ...baseNote(),
      state: "check",
      done: true,
      fixes: [{ what: "Which side?", at: "2026-01-01T01:00:00.000Z", ask: true }],
    };
    const bad = applyNoteChange(asking, { approve: true }, "2026-01-01T02:00:00.000Z");
    expect(bad.ok).toBe(false);
  });

  it("handles again, text edits, done/reopen, and remember transitions", () => {
    const n = baseNote();
    expect(applyNoteChange(n, { done: true }, "2026-01-01T01:00:00.000Z")).toEqual({ ok: true });
    expect(noteState(n)).toBe("check");
    expect(n.fixes?.at(-1)?.what).toBe("marked done");

    expect(applyNoteChange(n, { again: "Still dark on left" }, "2026-01-01T02:00:00.000Z")).toEqual({
      ok: true,
    });
    expect(noteState(n)).toBe("open");
    expect(n.asks?.at(-1)?.text).toBe("Still dark on left");

    expect(applyNoteChange(n, { text: "Updated text" }, "2026-01-01T03:00:00.000Z")).toEqual({
      ok: true,
    });
    expect(n.text).toBe("Updated text");
    expect(n.edits?.at(-1)?.was).toBe("Lighting too dark");

    expect(applyNoteChange(n, { remember: "all" }, "2026-01-01T04:00:00.000Z")).toEqual({ ok: true });
    expect(n.remember).toEqual({ scope: "all", at: "2026-01-01T04:00:00.000Z" });

    expect(applyNoteChange(n, { remember: null }, "2026-01-01T05:00:00.000Z")).toEqual({ ok: true });
    expect(n.remember).toBeUndefined();

    expect(applyNoteChange(n, { done: false }, "2026-01-01T06:00:00.000Z")).toEqual({ ok: true });
    expect(noteState(n)).toBe("open");
  });
});

describe("shotAtTime and buildNotePayload", () => {
  const shots = [
    { t: 0, name: "Opening" },
    { t: 4.5, name: "Reveal" },
    { t: 10.0, name: "Outro" },
  ];

  it("maps film timestamp to the enclosing shot with from/to/into", () => {
    expect(shotAtTime(shots, 15, 6.25)).toEqual({
      index: 1,
      name: "Reveal",
      from: 4.5,
      to: 10,
      into: 1.75,
    });
    expect(shotAtTime([], 12, 3)).toEqual({
      index: 0,
      name: "",
      from: 0,
      to: 12,
      into: 3,
    });
  });

  it("builds a Note payload that satisfies wholeNote() and CLI context.shot requirements", () => {
    const marks: Mark[] = [
      { kind: "box", t: 6.25, pts: [[0.1, 0.2], [0.4, 0.6]] },
      { kind: "arrow", t: 7.5, pts: [[0.6, 0.3], [0.8, 0.5]] },
    ];
    const annotated = marks.map((m) => markHitsForCompare(m, "compare", "hstack"));
    const note = buildNotePayload({
      id: "m1234",
      at: "2026-01-01T12:00:00.000Z",
      t: 6.25,
      shots,
      duration: 15,
      text: "Check right panel reflection",
      pin: { x: 0.75, y: 0.5, what: "OURS · right" },
      compareVideo: { path: "renders/reference/ref_vs_draft.mp4", category: "compare", layout: "hstack" },
      marks: annotated,
      wasPlaying: true,
      rate: 1,
      muted: false,
      volume: 1,
      canvasSize: [1080, 960],
      screenSize: [390, 844],
    });

    expect(wholeNote(note)).toBe(true);
    expect(note.shot).toBe(1);
    expect(note.shotName).toBe("Reveal");
    expect(note.time).toBe("00:06.250");
    expect(note.frame).toBe(188);
    expect(note.range).toEqual([6.25, 7.5]);
    expect(note.compareVideo).toEqual({
      path: "renders/reference/ref_vs_draft.mp4",
      category: "compare",
      layout: "hstack",
    });
    const ctx = note.context as {
      shot: { from: number; to: number; into: number };
      view: { phone: boolean; canvas: [number, number]; screen: [number, number] };
    };
    expect(ctx.shot).toEqual({ from: 4.5, to: 10, into: 1.75 });
    expect(ctx.view).toEqual({ phone: true, canvas: [1080, 960], screen: [390, 844] });
    expect(annotated[0].hits?.[0]?.what).toBe("REF · left");
    expect(annotated[1].hits?.[0]?.what).toBe("OURS · right");
    expect(inkSpan(annotated)).toEqual([6.25, 7.5]);
    expect(inkTimes(annotated)).toEqual([6.25, 7.5]);
    expect(inkWords(annotated)).toContain("box 00:06.250: REF · left");
  });
});

describe("filterAndGroupNotes, thread summary, media & helpers", () => {
  const mk = (id: string, t: number, extra: Partial<Note> = {}): Note => ({
    id,
    at: "2026-01-01T00:00:00.000Z",
    t,
    time: "00:01.000",
    frame: Math.round(t * 30),
    shot: 0,
    shotName: "Shot 0",
    text: `Note ${id}`,
    done: false,
    ...extra,
  });

  it("partitions open, ready check, asking, and done notes with scrubber marks", () => {
    const notes: Note[] = [
      mk("n1", 5, { state: "open" }),
      mk("n2", 2, {
        state: "check",
        done: true,
        fixes: [{ what: "Fixed", at: "2026-01-01T01:00:00.000Z" }],
      }),
      mk("n3", 3, {
        state: "check",
        done: true,
        fixes: [{ what: "Clarify?", at: "2026-01-01T01:00:00.000Z", ask: true }],
      }),
      mk("n4", 1, { state: "done", done: true, approved: "2026-01-01T02:00:00.000Z" }),
    ];

    const grouped = filterAndGroupNotes(notes);
    expect(grouped.counts).toEqual({ all: 4, check: 1, asking: 1, open: 1, done: 1 });
    expect(grouped.check.map((n) => n.id)).toEqual(["n2"]);
    expect(grouped.asking.map((n) => n.id)).toEqual(["n3"]);
    expect(grouped.open.map((n) => n.id)).toEqual(["n1"]);
    expect(grouped.done.map((n) => n.id)).toEqual(["n4"]);
    expect(grouped.marks.map((m) => ({ t: m.t, done: m.done, check: m.check, asking: m.asking }))).toEqual([
      { t: 1, done: true, check: false, asking: false },
      { t: 2, done: false, check: true, asking: false },
      { t: 3, done: false, check: true, asking: true },
      { t: 5, done: false, check: false, asking: false },
    ]);
    expect(isNoteAsking(notes[2], "check")).toBe(true);
    expect(isNoteAsking(notes[1], "check")).toBe(false);
  });

  it("summarizes thread active ask/fix and prior entries", () => {
    const n = mk("t1", 1, {
      state: "open",
      fixes: [{ what: "Tried fix", at: "2026-01-01T01:00:00.000Z" }],
      asks: [{ text: "Still off", at: "2026-01-01T02:00:00.000Z" }],
      edits: [{ was: "Old text", at: "2026-01-01T00:30:00.000Z" }],
    });
    const summary = summarizeNoteThread(n, "open");
    expect(summary.activeAsk?.text).toBe("Still off");
    expect(summary.activeFix).toBeNull();
    expect(summary.prior.length).toBe(2);
    expect(isCreatorNeedsWork(n, "open")).toBe(true);
  });

  it("resolves server and queued note media URLs safely", () => {
    const saved = mk("m1", 1, {
      img: "notes/img/m1.jpg",
      crop: "notes/img/m1_crop.jpg",
      refs: ["notes/img/m1_r0.jpg"],
      fixes: [{ what: "Done", at: "2026-01-01T01:00:00.000Z", after: "notes/img/m1_fix0.jpg", t: 1.5 }],
    });
    expect(resolveNoteMedia(saved, [])).toEqual({
      thumb: "/api/note-img/m1.jpg",
      crop: "/api/note-img/m1_crop.jpg",
      refs: ["/api/note-img/m1_r0.jpg"],
      after: "/api/note-img/m1_fix0.jpg",
      noAfterReason: null,
      afterTime: 1.5,
    });

    const queuedNote = mk("q1", 2);
    expect(
      resolveNoteMedia(queuedNote, [
        { note: queuedNote, img: "data:image/jpeg;base64,/9j/a", crop: "data:image/jpeg;base64,/9j/b" },
      ]),
    ).toMatchObject({
      thumb: "data:image/jpeg;base64,/9j/a",
      crop: "data:image/jpeg;base64,/9j/b",
    });
  });

  it("parses x-note-numbers header and formats clock/ratio/pin labels", () => {
    const notes = [mk("a", 1), mk("b", 2)];
    expect(noteNumberMap(notes, JSON.stringify({ a: 4, b: 9 }))).toEqual({ a: 4, b: 9 });
    expect(noteNumberMap(notes, "invalid")).toEqual({ a: 1, b: 2 });
    expect(clock(65.9)).toBe("1:05");
    expect(clampRatio(5, 10)).toBe(0.5);
    expect(clampRatio(-1, 10)).toBe(0);
    expect(clampRatio(15, 0)).toBe(0);
    expect(pinShortLabel("OURS · right (x=0.7)")).toBe("OURS · right");
  });
});

describe("LitePlaybackClock", () => {
  it("defers seek across clip switch until new video metadata loads", () => {
    const clockInst = new LitePlaybackClock();
    const fakeVideo = {
      readyState: 4,
      duration: 10,
      currentTime: 1,
      paused: true,
      ended: false,
      pause() {},
    } as unknown as HTMLVideoElement;

    clockInst.attach(fakeVideo);
    clockInst.setClip(0, 10);
    clockInst.seekAfterClipChange(7.5);
    expect(fakeVideo.currentTime).toBe(1);
    expect(clockInst.t).toBe(7.5);

    clockInst.setClip(2, 12);
    expect(clockInst.t).toBe(7.5);

    clockInst.onLoadedMetadata(fakeVideo);
    expect(fakeVideo.currentTime).toBe(5.5);
    expect(clockInst.t).toBe(7.5);
  });

  it("updates filmDuration without wiping loaded videoDuration or resetting playback time", () => {
    const clockInst = new LitePlaybackClock();
    const fakeVideo = {
      readyState: 4,
      duration: 12,
      currentTime: 4.25,
      paused: true,
      ended: false,
      pause() {},
    } as unknown as HTMLVideoElement;

    clockInst.attach(fakeVideo);
    clockInst.setClip(1, 10);
    clockInst.onLoadedMetadata(fakeVideo);
    expect(clockInst.duration).toBe(12);
    expect(clockInst.t).toBe(5.25);

    clockInst.setFilmDuration(25);
    expect(clockInst.duration).toBe(12);
    expect(clockInst.t).toBe(5.25);
  });

  it("cycles playback rate and preserves it across clip metadata reloads", () => {
    const clockInst = new LitePlaybackClock();
    const fakeVideo = {
      readyState: 4,
      duration: 12,
      currentTime: 0,
      playbackRate: 1,
      paused: true,
      ended: false,
      pause() {},
    } as unknown as HTMLVideoElement;

    clockInst.attach(fakeVideo);
    expect(clockInst.rate).toBe(1);
    const next = clockInst.cycleRate();
    expect(next).toBe(1.25);
    expect(fakeVideo.playbackRate).toBe(1.25);

    fakeVideo.playbackRate = 1;
    clockInst.setClip(0, 12);
    clockInst.onLoadedMetadata(fakeVideo);
    expect(fakeVideo.playbackRate).toBe(1.25);
    expect(clockInst.rate).toBe(1.25);
  });

  it("emits playing=false and cancels rAF on attach(null), and ignores onPlay while detached", () => {
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancel = globalThis.cancelAnimationFrame;
    let nextRafId = 1;
    const cancelled: number[] = [];
    let scheduled = 0;

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: () => {
        scheduled++;
        return nextRafId++;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: (id: number) => {
        cancelled.push(id);
      },
    });

    try {
      const clockInst = new LitePlaybackClock();
      const playStates: boolean[] = [];
      clockInst.subscribePlay((p) => playStates.push(p));

      clockInst.onPlay();
      expect(clockInst.isPlaying).toBe(false);
      expect(scheduled).toBe(0);
      expect(playStates).toEqual([false]);

      const fakeVideo = {
        readyState: 4,
        duration: 10,
        currentTime: 2,
        playbackRate: 1,
        paused: false,
        ended: false,
        pause() {},
      } as unknown as HTMLVideoElement;

      clockInst.attach(fakeVideo);
      clockInst.onLoadedMetadata(fakeVideo);
      clockInst.onPlay();
      expect(clockInst.isPlaying).toBe(true);
      expect(scheduled).toBe(1);
      expect(playStates).toEqual([false, true]);

      clockInst.attach(null);
      expect(clockInst.isPlaying).toBe(false);
      expect(cancelled).toEqual([1]);
      expect(playStates).toEqual([false, true, false]);
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: prevRaf });
      Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: prevCancel });
    }
  });

  it("preserves pendingSeekFilmT if onPlay fires while loading before onLoadedMetadata", () => {
    const clockInst = new LitePlaybackClock();
    const fakeVideo = {
      readyState: 0,
      duration: 10,
      currentTime: 0,
      playbackRate: 1,
      paused: false,
      ended: false,
      pause() {
        this.paused = true;
      },
    } as unknown as HTMLVideoElement;

    clockInst.attach(fakeVideo);
    clockInst.setClip(2, 12);
    clockInst.seekAfterClipChange(7.5);
    clockInst.onPlay();
    expect(clockInst.isPlaying).toBe(true);

    fakeVideo.readyState = 4;
    clockInst.onLoadedMetadata(fakeVideo);
    expect(fakeVideo.currentTime).toBe(5.5);
    expect(clockInst.t).toBe(7.5);
    expect(clockInst.isPlaying).toBe(true);
    clockInst.pause();
  });

  it("keeps playing state and rAF active when seek is called before metadata loads", () => {
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancel = globalThis.cancelAnimationFrame;
    let nextRafId = 1;
    const cancelled: number[] = [];

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: () => nextRafId++,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: (id: number) => {
        cancelled.push(id);
      },
    });

    try {
      const clockInst = new LitePlaybackClock();
      const playStates: boolean[] = [];
      clockInst.subscribePlay((p) => playStates.push(p));

      const fakeVideo = {
        readyState: 0,
        duration: 10,
        currentTime: 0,
        playbackRate: 1,
        paused: false,
        ended: false,
        pause() {
          this.paused = true;
        },
      } as unknown as HTMLVideoElement;

      clockInst.attach(fakeVideo);
      clockInst.setClip(0, 10);
      clockInst.onPlay();
      clockInst.seek(5.0);

      expect(clockInst.isPlaying).toBe(true);
      expect(cancelled).toEqual([]);
      expect(playStates).toEqual([false, true]);

      fakeVideo.readyState = 4;
      clockInst.onLoadedMetadata(fakeVideo);
      expect(clockInst.isPlaying).toBe(true);
      expect(fakeVideo.currentTime).toBe(5.0);
      expect(clockInst.t).toBe(5.0);
      expect(playStates).toEqual([false, true]);
      clockInst.pause();
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: prevRaf });
      Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: prevCancel });
    }
  });
});
