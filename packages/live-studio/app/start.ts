import * as FILM from "film/scene";
import { buildScene, SHOTS_OUT as SHOTS } from "film/scene";
import * as THREE from "three";

import { aiSpans, listenActivity, loadActivity, onActivitySpans } from "./activity/activity";
import { applyPinnedFraming, keys as camKeys, loadCam } from "./camera/cam";
import { attachCamRow } from "./camera/camrow";
import { loadLayers } from "./camera/layers";
import { loadShots, shotsDoc } from "./camera/shots";
import { afterPaint } from "./core/afterPaint";
import { bootData, invalidateTagPrefix, versionUrl } from "./core/boot";
import { AWAY, PHONE } from "./core/device";
import { loadEaseTemplates } from "./core/ease";
import { registerEngine } from "./core/engine";
import { onEvent, onHello } from "./core/events";
import { loadFavorites } from "./core/favorites";
import { shotIndex } from "./core/film";
import { applyEdit, setFilmSource } from "./core/filmMeta";
import { clearPrefetch, getFile, postJson, prefetchFile, wait } from "./core/net";
import { type Elements, onWake, S, wake } from "./core/state";
import { stored } from "./core/storage";
import { get, invalidatePictures, say, set, showError } from "./core/store";
import { stamp } from "./core/time";
import { attachKeyRows } from "./keys/keyrows";
import { loadKeys, prepareKeys } from "./keys/keys";
import { lessons, loadLessons } from "./lessons/lessons";
import { loadLights } from "./lighting/lights";
import { attachInk, drawInk } from "./notes/ink";
import {
  drawnNotes,
  drawPins,
  ensureNote,
  flushNotes,
  followNoteLinks,
  followNotes,
  loadNotes,
  noteMarks,
  restoreDraft,
} from "./notes/notes";
import {
  addInFront,
  cancelPreviewTransform,
  isGizmoDragging,
  nativeTransform,
  previewTransform,
  removeObject,
  select as selectObject,
  setGizmo,
  shownTransform,
  startObjectCarry,
} from "./objects/placed";
import { readOpenFilm } from "./openfilm/state";
import { followChips, loadTrials, optionRanges } from "./options/options";
import { drawCameraMonitor } from "./picture/camera-monitor";
import { captionAt } from "./picture/captions";
import { staleFilmView } from "./picture/filmcam";
import { filmFeatures, frameSize, loadFilm } from "./picture/frame";
import { flight, fly, flyFree, setFov, setFree } from "./picture/freecam";
import { formatOpticsHud } from "./picture/hud";
import { lookAtClick } from "./picture/look";
import { attachPicture, fit } from "./picture/pointer";
import { drawPreviewMonitor } from "./picture/preview-monitor";
import { drawFinal, finalCanvas, render, renderFilmFrame, setFinal } from "./picture/render";
import { measureScopes } from "./picture/scopes";
import {
  loadMix,
  loadWholeMix,
  MIX_URL,
  restoreVolume,
  seek,
  setPlaying,
  tick,
} from "./playback/transport";
import { attachLanes } from "./sound/lanes";
import { invalidateSoundCaches, loadSound } from "./sound/sound";
import { loadVoiceTakes } from "./sound/voice-client";
import { handleVoiceLibraryEvent } from "./sound/voice-library-client";
import { handleVoicePlaygroundEvent } from "./sound/voice-playground-client";
import { loadText } from "./text/text";
import { attachTextRow } from "./text/textrow";
import { attachAcross } from "./timeline/across";
import { restoreInOut } from "./timeline/inout";
import { attachPreviewAxis, peekTime } from "./timeline/peek";
import {
  attachTimeline,
  drawTimelineActivity,
  drawTimelines,
  loadVoice,
  marks,
  refreshTimes,
} from "./timeline/timeline";
import { loadTiming } from "./timeline/timing";

registerEngine({
  buildAudioScene: buildScene,
  render,
  renderFilmFrame,
  finalCanvas,
  setFinal,
  setFree,
  flyFree,
  applyPinnedFraming,
  setFov,
  setGizmo,
  isGizmoDragging,
  removeObject,
  selectObject,
  shownTransform,
  previewTransform,
  cancelPreviewTransform,
  nativeTransform,
  startObjectCarry: (what, e) => startObjectCarry(what, e, lookAtClick),
  addObjectInFront: (what) => addInFront(what, lookAtClick),
});

addEventListener("resize", () => {
  S.dirty = true;
});

let filmProblems: string[] = [],
  fileProblems: string[] = [],
  postedProblems = false;
const showContract = () => set({ contract: [...fileProblems, ...filmProblems] });
const reportFilm = (list: string[]) => {
  filmProblems = list;
  showContract();
  if (!list.length && !postedProblems && !bootData()?.hasPageProblems) return;
  postedProblems = true;
  postJson("/api/contract", { problems: list }).catch(() => {});
};
const reportWeight = () => {
  if (!AWAY) return;
  const files = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ]
    .map((e) => ({ url: new URL(e.name), bytes: (e as PerformanceResourceTiming).encodedBodySize }))
    .filter(({ url, bytes }) => url.origin === location.origin && bytes > 0)
    .map(({ url, bytes }) => ({ path: url.pathname, bytes }));
  postJson("/api/weight", { files }).catch(() => {});
};
const loadContract = async (initial = false) => {
  const inline = initial ? bootData()?.contract : undefined;
  if (inline) {
    fileProblems = inline.files ?? [];
    showContract();
    return;
  }
  const r = await fetch("/api/contract.json").catch(() => null);
  if (!r?.ok) return;
  fileProblems = (await r.json()).files ?? [];
  showContract();
};
const runFilmCheck = () =>
  void import("../src/contract.ts")
    .then(({ checkFilm }) => reportFilm(checkFilm(FILM, S.render, camKeys)))
    .catch(() => {});

const listen = () => {
  const codeChanged = () => set({ newBuild: true });
  onEvent("code", (why) => {
    if (why !== "own") codeChanged();
  });
  onEvent("build-error", (message) =>
    showError(
      `The film's code has an error; the page keeps the last version and reloads once it's fixed.\n\n${message}`,
    ),
  );
  onEvent("sound-start", () => say("Mixing sound…"));
  onEvent("sound", () => {
    invalidateTagPrefix("/api/mix");
    invalidateTagPrefix("/api/sfx/");
    invalidateTagPrefix("/api/voice");
    loadMix();
    loadTrials();
    loadSound({ usedOnly: true });
    say("Sound updated");
  });
  onEvent("lanes", () => loadSound({ lanesOnly: true }));
  const reloadNotice =
    (
      rev: "camRev" | "lightsRev" | "shotsRev" | "layersRev" | "textRev",
      msg: string,
      load: () => Promise<unknown>,
      after?: () => void,
    ) =>
    async () => {
      const before = get()[rev];
      await load();
      if (get()[rev] !== before) {
        say(msg);
        after?.();
      }
    };
  onEvent("cam", reloadNotice("camRev", "Camera keys updated", loadCam, runFilmCheck));
  onEvent("lights", reloadNotice("lightsRev", "Lighting updated", loadLights));
  onEvent("keys", (i) => loadKeys(Number(i)));
  onEvent("shots", reloadNotice("shotsRev", "Shots updated", loadShots));
  onEvent("timing", loadTiming);
  onEvent("adjustment", reloadNotice("layersRev", "Color adjustment updated", loadLayers));
  onEvent("openfilm", () => {
    void readOpenFilm().catch(showError);
  });
  onEvent("text", reloadNotice("textRev", "Titles updated", loadText));
  onEvent("notes", () => loadNotes({ notify: true }));
  onEvent("voice", () => {
    invalidateTagPrefix("/api/voice");
    invalidateTagPrefix("/api/mix");
    invalidateSoundCaches();
    loadVoice();
    loadVoiceTakes();
  });
  onEvent("contract", () => loadContract());
  onEvent("film", codeChanged);
  onEvent("favorites", loadFavorites);
  onEvent("ease-templates", loadEaseTemplates);
  onEvent("lessons", () => {
    if (lessons.getState().loaded) void loadLessons();
  });
  onEvent("voice-library", handleVoiceLibraryEvent);
  onEvent("voice-playground", handleVoicePlaygroundEvent);
  listenActivity();
  onHello((current, reconnect) => {
    if (!current) codeChanged();
    if (reconnect) {
      clearPrefetch();
      invalidateTagPrefix("/api/voice");
      invalidateTagPrefix("/api/sfx/");
      loadNotes({ notify: true });
      loadVoice();
      loadVoiceTakes();
      handleVoiceLibraryEvent();
      handleVoicePlaygroundEvent();
      loadContract();
      loadTrials();
      loadTiming();
      loadSound({ usedOnly: true });
      loadCam();
      loadLights();
      loadKeys();
      loadShots();
      loadText();
      loadLayers();
      void readOpenFilm().catch(showError);
      loadFavorites();
      void loadEaseTemplates();
      void loadActivity();
      if (lessons.getState().loaded) void loadLessons();
    }
  });
};

const phoneLong = (stage: HTMLElement) => {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData || (nav.deviceMemory ?? 8) < 4) return 640;
  const r = stage.getBoundingClientRect();
  return Math.round(
    Math.min(960, Math.max(640, Math.max(r.width, r.height) * Math.min(devicePixelRatio, 2))),
  );
};

export const start = async (el: Elements) => {
  S.el = el;
  await loadFilm();
  THREE.DefaultLoadingManager.onError = (url) => {
    S.failedFile = url;
  };
  marks.notes = noteMarks;
  marks.optionRanges = optionRanges;
  marks.ai = aiSpans;
  restoreVolume();
  listen();
  attachPicture();
  if (!PHONE) {
    attachTimeline();
    onActivitySpans(drawTimelineActivity);
    attachPreviewAxis();
    restoreInOut();
    attachLanes();
    attachCamRow();
    attachKeyRows();
    attachTextRow();
    attachAcross();
  }
  attachInk({
    look: lookAtClick,
    begin: ensureNote,
    pause: () => {
      if (S.playing) setPlaying(false);
    },
  });
  fit();
  const has = filmFeatures();
  if (!AWAY && has.mix) el.audio.src = versionUrl(MIX_URL);
  flushNotes();
  setFilmSource(FILM);
  applyEdit();
  const comments = getFile("/api/shots.json")
    .then(async (r) => {
      if (!r.ok || shotsDoc.data) return;
      S.comments = await r.json();
      shownShot = -1;
      refreshTimes();
      S.dirty = true;
    })
    .catch(() => {});
  const t0 = performance.now();
  const [w, h] = frameSize(PHONE ? phoneLong(el.stage) : 960);
  el.canvas.width = w;
  el.canvas.height = h;
  const timeline = Promise.all([
    loadNotes(),
    has.voiceMap
      ? loadVoice()
      : Promise.resolve().then(() => {
          S.voiceReady = true;
          S.dirty = true;
        }),
    has.voice ? loadVoiceTakes() : Promise.resolve(),
  ]);
  const timingReady = has.timing ? loadTiming() : Promise.resolve(set({ timing: false }));
  const contractReady = loadContract(true);
  const earlyExtras = Promise.all([
    has.shots ? loadShots() : Promise.resolve(set({ shots: false })),
    loadFavorites(),
    loadEaseTemplates(),
  ]);
  const earlySound = Promise.all([timingReady, timeline]).then(() =>
    loadSound({ usedOnly: true, initial: true }),
  );
  const editingReady = timingReady.then(() =>
    Promise.all([
      has.cam ? loadCam() : Promise.resolve(set({ cam: false })),
      has.lights ? loadLights() : Promise.resolve(set({ lights: false })),
      has.keys ? loadKeys() : Promise.resolve(set({ keyFiles: [] })),
      has.text ? loadText() : Promise.resolve(set({ text: false })),
      has.adjustment ? loadLayers() : Promise.resolve(set({ layers: false })),
      readOpenFilm(),
    ]),
  );
  if (has.cam) prefetchFile("/api/cam");
  if (has.lights) prefetchFile("/api/lights");
  if (has.keys) void prepareKeys();
  if (has.text) prefetchFile("/api/text");
  if (has.adjustment) prefetchFile("/api/adjustment");
  if (has.sound) prefetchFile("/api/sound?used=1");
  if (has.trials) prefetchFile("/api/trials.json");
  if (has.choices) prefetchFile("/api/choices.json");
  const isTransientSceneError = async (err: unknown, failedFile: string): Promise<boolean> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    if (
      err instanceof TypeError &&
      /failed to fetch|networkerror|load failed|network request failed/i.test(err.message)
    ) {
      return true;
    }
    if (
      err instanceof Error &&
      /(?:ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ECONN|ETIMEDOUT|502|503|504|gateway|service unavailable)/i.test(
        err.message,
      )
    ) {
      return true;
    }
    try {
      const ping = await fetch("/api/edit.json", { cache: "no-store" });
      if (!ping.ok) return ping.status >= 500;
    } catch {
      return true;
    }
    if (failedFile) {
      try {
        const asset = await fetch(failedFile, { method: "HEAD", cache: "no-store" });
        return asset.status >= 500;
      } catch {
        return true;
      }
    }
    return false;
  };
  stored.remove("loadTries", sessionStorage);
  const MAX_SCENE_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    set({ loading: "Building scene…" });
    await afterPaint();
    S.failedFile = "";
    try {
      S.render = await buildScene(el.canvas, w, h, true);
      break;
    } catch (e) {
      const transient =
        attempt < MAX_SCENE_RETRIES && (await isTransientSceneError(e, S.failedFile));
      if (!transient) {
        set({ loading: "" });
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          S.failedFile
            ? `Couldn't load ${S.failedFile}. (${detail})`
            : `Couldn't load the scene. (${detail})`,
        );
      }
      set({
        loading: `Connection unstable. Retrying scene (${attempt + 1}/${MAX_SCENE_RETRIES})…`,
      });
      for (let probe = 0; probe < 20; probe++) {
        await wait(1500);
        try {
          if ((await fetch("/api/edit.json", { cache: "no-store" })).ok) break;
        } catch {}
      }
    }
  }
  if (AWAY && has.mix) loadWholeMix();
  S.tools = S.render.tools;
  set({ placed: !!S.tools.placed });
  await timingReady;
  set({ loading: "Rendering first frame…" });
  await afterPaint();
  const extras = Promise.all([
    comments,
    contractReady,
    earlyExtras,
    timeline,
    loadTrials(true),
    earlySound,
    editingReady,
  ]).then(() => {
    refreshTimes();
    S.dirty = true;
    invalidatePictures();
  });
  refreshTimes();
  seek(S.t);
  loopStarted = true;
  await loop();
  set({ loading: "", ready: true });
  if (window.__live) say(`Loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  extras.then(() => {
    restoreDraft();
    followNoteLinks();
    panelsLoaded = true;
    markReady();
    reportWeight();
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 250));
    idle(runFilmCheck, { timeout: 600 });
    warm.push(
      ...SHOTS.map((_, i) => i).sort(
        (a, b) => Math.abs(SHOTS[a].t - S.t) - Math.abs(SHOTS[b].t - S.t),
      ),
    );
    wake("render");
  });
};

let panelsLoaded = false;
const markReady = () => {
  if (panelsLoaded && window.__live && !window.__readyAt) window.__readyAt = Date.now();
};

const warm: number[] = [];
let drawMs = 0,
  frames = 0,
  fpsAt = performance.now(),
  shownShot = -1,
  lastFrame = performance.now();
let keptAt = -1e9,
  keptT = -1;
let loopStarted = false,
  inFrame = false,
  loopKind: 0 | 1 | 2 = 0,
  loopId = 0;
const needFrame = () => S.dirty || S.viewMoved || S.playing || warm.length > 0 || flight.active();
const cancelLoop = () => {
  if (loopKind === 1) cancelAnimationFrame(loopId);
  else if (loopKind === 2) clearTimeout(loopId);
  loopKind = 0;
  loopId = 0;
};
const scheduleLoop = () => {
  if (!loopStarted || inFrame || loopKind || !needFrame()) return;
  if (document.hidden) {
    loopKind = 2;
    loopId = window.setTimeout(loop, 100);
  } else {
    loopKind = 1;
    loopId = requestAnimationFrame(loop);
  }
};
onWake("render", () => {
  if (!inFrame && !loopKind) lastFrame = performance.now();
  scheduleLoop();
});
document.addEventListener("visibilitychange", () => {
  cancelLoop();
  if (!document.hidden && !loopKind) lastFrame = performance.now();
  scheduleLoop();
});
const loop = async () => {
  loopKind = 0;
  loopId = 0;
  inFrame = true;
  try {
    await frame();
  } catch (e) {
    showError(e);
  } finally {
    inFrame = false;
  }
  scheduleLoop();
};
let lastClockEl: HTMLElement | null = null;
let lastClockText: string | null = null;
let lastPeekState: boolean | null = null;
let lastCaptionEl: HTMLElement | null = null;
let lastCaptionText: string | null = null;
let lastHudEl: HTMLElement | null = null;
let lastHudText: string | null = null;

const frame = async () => {
  const dt = Math.min(0.1, (performance.now() - lastFrame) / 1000);
  lastFrame = performance.now();
  fly(dt);
  tick();
  const peeked = peekTime();
  if (S.dirty || S.viewMoved) {
    if (S.dirty) staleFilmView();
    S.dirty = S.viewMoved = false;
    const a = performance.now();
    await render(peeked ?? S.t);
    followChips();
    drawMs = drawMs * 0.9 + (performance.now() - a) * 0.1;
    frames++;
    const showTime = peeked ?? S.t;
    const isPeek = peeked !== null;
    const i = shotIndex(S.t);
    if (i !== shownShot) {
      shownShot = i;
      set({ shot: `shot ${i}: ${S.comments[i] ?? ""}` });
    }
    drawTimelines();
    if (S.el.pins.hidden !== isPeek) S.el.pins.hidden = isPeek;
    if (S.el.ink.hidden !== isPeek) S.el.ink.hidden = isPeek;
    if (S.el.chips.hidden !== isPeek) S.el.chips.hidden = isPeek;
    drawPins();
    drawInk(drawnNotes);
    if (lastClockEl !== S.el.clock) {
      lastClockEl = S.el.clock;
      lastClockText = null;
      lastPeekState = null;
    }
    const nextClock = stamp(showTime);
    if (lastClockText !== nextClock) {
      S.el.clock.textContent = nextClock;
      lastClockText = nextClock;
    }
    if (lastPeekState !== isPeek) {
      S.el.clock.toggleAttribute("data-peek", isPeek);
      lastPeekState = isPeek;
    }
    if (lastCaptionEl !== S.el.caption) {
      lastCaptionEl = S.el.caption;
      lastCaptionText = null;
    }
    const nextCaption = get().captions ? (captionAt(showTime) ?? "") : "";
    if (lastCaptionText !== nextCaption) {
      S.el.caption.textContent = nextCaption;
      lastCaptionText = nextCaption;
    }
    if (lastHudEl !== S.el.hud) {
      lastHudEl = S.el.hud;
      lastHudText = null;
    }
    const nextHud = [formatOpticsHud(S.tools?.optics), drawCameraMonitor(showTime)]
      .filter(Boolean)
      .join(" · ");
    if (S.el.hud && lastHudText !== nextHud) {
      S.el.hud.textContent = nextHud;
      lastHudText = nextHud;
    }
    let finalNow = false;
    if (get().final && S.finalRender) {
      if (S.playing || S.dragging || peeked !== null) {
        S.el.final.hidden = true;
        S.finalAt = -1;
      } else if (S.finalAt !== S.t) {
        await drawFinal();
        finalNow = get().final && S.finalAt === S.t;
      }
    }
    const painted = !S.el.shutter.hidden
      ? S.el.shutter
      : finalNow
        ? S.el.final
        : S.el.final.hidden
          ? S.el.canvas
          : null;
    measureScopes(painted);
    drawPreviewMonitor(painted);
    followNotes();
    wake("rendered");
    const keptNow = performance.now();
    if (Math.abs(S.t - keptT) > 1 || keptNow - keptAt > 500) {
      keptAt = keptNow;
      keptT = S.t;
      stored.set("t", String(S.t), sessionStorage);
    }
    window.__live = { t: S.t, shot: i, drawMs };
    markReady();
  } else if (warm.length) {
    // Async preparation can paint between awaits; warm only synchronous film renderers on the visible canvas.
    if (S.render?.renderFrame) warm.length = 0;
    else {
      await render(SHOTS[warm.shift()!].t + 0.1);
      await render(S.t);
    }
  }
  const now = performance.now();
  if (now - fpsAt > 500 || (!S.playing && get().perf.includes("fps"))) {
    const fps = (frames * 1000) / Math.max(1, now - fpsAt);
    frames = 0;
    fpsAt = now;
    set({ perf: `${S.playing ? fps.toFixed(0) + " fps, " : ""}${drawMs.toFixed(0)} ms/frame` });
  }
};
