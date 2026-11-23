import { describe, expect, test } from "bun:test";

import { createAuditionController } from "../app/sound/audition-controller";

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

const createFakeAudio = () => {
  const listeners = new Map();
  const audio = {
    src: "",
    paused: true,
    duration: 10,
    currentTime: 0,
    nextPlayPromise: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit(type) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    play() {
      audio.paused = false;
      const res = audio.nextPlayPromise ?? Promise.resolve();
      audio.nextPlayPromise = null;
      return res;
    },
    pause() {
      if (audio.paused) return;
      audio.paused = true;
      audio.emit("pause");
    },
  };
  return audio;
};

describe("createAuditionController", () => {
  test("source video, dubbed media and recording audition share one active playback without stopping a native resume", () => {
    const audio = createFakeAudio(),
      source = createFakeAudio(),
      dubbed = createFakeAudio();
    const ctrl = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: () => {},
    });
    ctrl.listenUrl("recording", "/recording.mp3");
    audio.emit("play");
    source.play();
    ctrl.playNativeAudition(source);
    expect(audio.paused).toBe(true);
    expect(source.paused).toBe(false);
    dubbed.play();
    ctrl.playNativeAudition(dubbed);
    expect(source.paused).toBe(true);
    expect(dubbed.paused).toBe(false);
    dubbed.pause();
    dubbed.play();
    ctrl.playNativeAudition(dubbed);
    expect(dubbed.paused).toBe(false);
    ctrl.listenUrl("comparison", "/comparison.mp3");
    audio.emit("play");
    expect(dubbed.paused).toBe(true);
    expect(ctrl.listening()).toBe("comparison");
    source.play();
    ctrl.playNativeAudition(source);
    ctrl.releaseNativeAudition(source);
    expect(source.paused).toBe(true);
    expect(ctrl.listening()).toBe("");
    dubbed.play();
    ctrl.playNativeAudition(dubbed);
    ctrl.stopAudition();
    expect(dubbed.paused).toBe(true);
  });
  test("a selected region starts at its boundary, stops there, replays and does not limit the next full clip", () => {
    const audio = createFakeAudio();
    const ctrl = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: () => {},
    });
    ctrl.listenUrl("region:one", "/one.wav", { from: 2, to: 4 });
    audio.emit("loadedmetadata");
    audio.emit("play");
    expect(audio.currentTime).toBe(2);
    audio.currentTime = 4.1;
    audio.emit("timeupdate");
    expect(audio.paused).toBe(true);
    ctrl.listenUrl("region:one", "/one.wav", { from: 2, to: 4 });
    expect(audio.currentTime).toBe(2);
    ctrl.listenUrl("pg:two", "/two.wav");
    audio.emit("play");
    audio.currentTime = 5;
    audio.emit("timeupdate");
    expect(audio.paused).toBe(false);
    ctrl.stopAudition();
  });
  test("recovers cleanly on play() rejection: stops tick, resets listening, bumps state, and toasts once", async () => {
    const audio = createFakeAudio();
    const errs = [];
    let soundBumps = 0;
    const intervalsCleared = [];
    const intervalsStarted = [];

    const ctrl = createAuditionController({
      audio,
      setInterval: (fn, ms) => {
        const handle = { fn, ms };
        intervalsStarted.push(handle);
        return handle;
      },
      clearInterval: (handle) => intervalsCleared.push(handle),
      onSoundBump: () => soundBumps++,
      onPlayError: (msg) => errs.push(msg),
    });

    const err = Object.assign(new Error("Format error"), { name: "NotSupportedError" });
    audio.nextPlayPromise = Promise.reject(err);

    ctrl.listenUrl("gv:v1", "https://example.com/bad.mp3");
    audio.emit("play");
    expect(ctrl.listening()).toBe("gv:v1");
    expect(intervalsStarted).toHaveLength(1);

    await flushMicrotasks();
    audio.emit("error");

    expect(ctrl.listening()).toBe("");
    expect(audio.paused).toBe(true);
    expect(intervalsCleared.length).toBeGreaterThanOrEqual(1);
    expect(errs).toEqual(["Could not play preview audio"]);
    expect(soundBumps).toBeGreaterThanOrEqual(2);
  });

  test("ignores AbortError and stale errors when switching quickly to a new preview", async () => {
    const audio = createFakeAudio();
    const errs = [];
    let rejectFirst;
    const firstPromise = new Promise((_, rej) => {
      rejectFirst = rej;
    });

    const ctrl = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: (msg) => errs.push(msg),
    });

    audio.nextPlayPromise = firstPromise;
    ctrl.listenUrl("gv:v1", "https://example.com/1.mp3");

    ctrl.listenUrl("gv:v2", "https://example.com/2.mp3");
    audio.emit("play");

    rejectFirst(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await flushMicrotasks();

    expect(ctrl.listening()).toBe("gv:v2");
    expect(errs).toEqual([]);
  });

  test("clears active preview when media error event fires without play() rejection", () => {
    const audio = createFakeAudio();
    const errs = [];
    const ctrl = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: (msg) => errs.push(msg),
    });

    ctrl.listenUrl("gv:v1", "https://example.com/404.mp3");
    audio.emit("play");
    expect(ctrl.listening()).toBe("gv:v1");

    audio.emit("error");
    expect(ctrl.listening()).toBe("");
    expect(audio.paused).toBe(true);
    expect(errs).toEqual(["Could not play preview audio"]);
  });

  test("reports a cloud preview failure to its row and keeps the global error for other previews", () => {
    const audio = createFakeAudio();
    const seen = [];
    const ctrl = createAuditionController({
      audio,
      onSoundBump() {},
      onPlayError: (message) => seen.push(message),
    });

    ctrl.listenUrl("cloud:recording", "https://example.com/cloud.mp3", undefined, () =>
      seen.push("Cloud row"),
    );
    audio.emit("error");
    audio.emit("error");
    ctrl.listenUrl("gv:voice", "https://example.com/voice.mp3");
    audio.emit("error");

    expect(seen).toEqual(["Cloud row", "Could not play preview audio"]);
  });

  test("toggles pause on repeat listenUrl, seeks within bounds, and resets on ended", () => {
    const audio = createFakeAudio();
    const errs = [];
    const ctrl = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: (msg) => errs.push(msg),
    });

    ctrl.listenUrl("gv:v1", "https://example.com/ok.mp3");
    audio.emit("play");
    expect(ctrl.listening()).toBe("gv:v1");

    ctrl.seekAudition("gv:v1", 99, 5);
    expect(audio.currentTime).toBeCloseTo(9.98, 2);
    ctrl.seekAudition("gv:other", 2, 5);
    expect(audio.currentTime).toBeCloseTo(9.98, 2);
    ctrl.seekAudition("gv:v1", -5, 5);
    expect(audio.currentTime).toBe(0);

    ctrl.listenUrl("gv:v1", "https://example.com/ok.mp3");
    expect(ctrl.listening()).toBe("");
    expect(audio.paused).toBe(true);

    ctrl.listenUrl("gv:v1", "https://example.com/ok.mp3");
    audio.emit("play");
    audio.emit("ended");
    expect(ctrl.listening()).toBe("");
    expect(errs).toEqual([]);
  });

  test("keeps unknown pre-metadata duration at 0/1 (never 100%) without seeking and ignores unowned play events", () => {
    const audio = createFakeAudio();
    audio.duration = Number.NaN;
    const intervalsStarted = [];
    const ctrl = createAuditionController({
      audio,
      setInterval: (fn, ms) => {
        const handle = { fn, ms };
        intervalsStarted.push(handle);
        return handle;
      },
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: () => {},
    });

    audio.paused = false;
    audio.emit("play");
    expect(intervalsStarted).toHaveLength(0);
    expect(ctrl.listening()).toBe("");

    ctrl.listenUrl("gv:v1", "https://example.com/stream.mp3");
    audio.emit("play");
    audio.currentTime = 0.25;
    expect(ctrl.auditionProgress(0)).toEqual({ at: 0, duration: 1, known: false });

    ctrl.seekAudition("gv:v1", 0.5, 0);
    expect(audio.currentTime).toBe(0.25);

    audio.duration = 12;
    expect(ctrl.auditionProgress(0)).toEqual({ at: 0.25, duration: 12, known: true });
    ctrl.seekAudition("gv:v1", 4, 0);
    expect(audio.currentTime).toBe(4);
  });

  test("preserves auditionTarget across pause and ended for dock scrubbing until stopAudition or error", async () => {
    const audio = createFakeAudio();
    const ctrl = createAuditionController({
      audio,
      setInterval: () => 1,
      clearInterval: () => {},
      onSoundBump: () => {},
      onPlayError: () => {},
    });

    ctrl.listenUrl("sfx_pop", "/api/sfx/sfx_pop.wav");
    audio.emit("play");
    expect(ctrl.auditionTarget()).toBe("sfx_pop");
    expect(ctrl.listening()).toBe("sfx_pop");

    ctrl.listenUrl("sfx_pop", "/api/sfx/sfx_pop.wav");
    expect(ctrl.listening()).toBe("");
    expect(ctrl.auditionTarget()).toBe("sfx_pop");

    audio.src = "sentinel";
    ctrl.listenUrl("sfx_pop", "/api/sfx/sfx_pop.wav");
    audio.emit("play");
    expect(audio.src).toBe("sentinel");

    audio.currentTime = 4;
    audio.emit("ended");
    expect(audio.currentTime).toBe(0);
    expect(ctrl.listening()).toBe("");
    expect(ctrl.auditionTarget()).toBe("sfx_pop");

    ctrl.stopAudition();
    expect(ctrl.auditionTarget()).toBe("");
    expect(audio.paused).toBe(true);

    audio.nextPlayPromise = Promise.reject(
      Object.assign(new Error("boom"), { name: "MediaError" }),
    );
    ctrl.listenUrl("sfx_bad", "/api/sfx/sfx_bad.wav");
    await flushMicrotasks();
    expect(ctrl.auditionTarget()).toBe("");
    expect(ctrl.listening()).toBe("");
  });
});
