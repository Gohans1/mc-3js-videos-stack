// The studio page's start: the film is built, every part attached and loaded, the server's saves listened to; from then on
// one frame is drawn whenever something changed
import * as THREE from "three";
import * as FILM from "film/scene";
import { buildScene, SHOTS_OUT as SHOTS } from "film/scene";
import { checkFilm } from "../src/contract.mjs";
import { loadCam } from "./camera/cam";
import { attachCamRow } from "./camera/camrow";
import { loadShots } from "./camera/shots";
import { AWAY, PHONE } from "./core/device";
import { onEvent, onHello } from "./core/events";
import { loadFavorites } from "./core/favorites";
import { shotIndex } from "./core/film";
import { getFile, postJson, wait } from "./core/net";
import { S, type Elements } from "./core/state";
import { stored } from "./core/storage";
import { get, say, set, showError } from "./core/store";
import { stamp } from "./core/time";
import { attachKeyRows } from "./keys/keyrows";
import { attachAcross } from "./timeline/across";
import { loadKeys } from "./keys/keys";
import { attachInk, drawInk } from "./notes/ink";
import { drawnNotes, drawPins, ensureNote, flushNotes, followNotes, loadNotes, noteMarks, restoreDraft } from "./notes/notes";
import { followChips, loadSounds, loadTrials, optionRanges } from "./options/options";
import { captionAt } from "./picture/captions";
import { staleFilmView } from "./picture/filmcam";
import { frameSize, loadFilm } from "./picture/frame";
import { fly } from "./picture/freecam";
import { lookAtClick } from "./picture/look";
import { attachPicture, fit } from "./picture/pointer";
import { drawFinal, render } from "./picture/render";
import { measureScopes } from "./picture/scopes";
import { loadMix, loadWholeMix, MIX_URL, restoreVolume, seek, setPlaying, tick } from "./playback/transport";
import { attachLanes } from "./sound/lanes";
import { loadText } from "./text/text";
import { attachTextRow } from "./text/textrow";
import { loadSound } from "./sound/sound";
import { attachTimeline, drawTimelines, loadVoice, marks, refreshTimes } from "./timeline/timeline";
import { attachPreviewAxis, peekTime } from "./timeline/peek";
import { restoreInOut } from "./timeline/inout";

addEventListener("resize", () => { S.dirty = true; });

// ---------- The film contract (contract.mjs, docs/film-contract.md): the server checks the film's files, this page its code
let filmProblems: string[] = [], fileProblems: string[] = [];
const showContract = () => set({ contract: [...fileProblems, ...filmProblems] });
const reportFilm = (list: string[]) => { filmProblems = list; showContract(); postJson("/api/contract", { problems: list }).catch(() => {}); };
// Everything a page away from this PC fetched, at its size on the wire even when it came from the cache this time: what a
// first visit costs. The studio warns in its terminal when that is too much (src/weight.mjs)
const reportWeight = () => {
  if (!AWAY) return;
  const files = [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]
    .map((e) => ({ url: new URL(e.name), bytes: (e as PerformanceResourceTiming).encodedBodySize }))
    .filter(({ url, bytes }) => url.origin === location.origin && bytes > 0)
    .map(({ url, bytes }) => ({ path: url.pathname, bytes }));
  postJson("/api/weight", { files }).catch(() => {});
};
const loadContract = async () => {
  const r = await fetch("/api/contract.json").catch(() => null);
  if (!r?.ok) return;
  fileProblems = (await r.json()).files ?? [];
  showContract();
};


// ---------- The film's saves, from the studio's server (app/core/events.ts)
const listen = () => {
  const codeChanged = () => set({ newBuild: true });
  // "own": rebuilt only because the studio saved the sound lanes or the camera keys, which this page already shows
  onEvent("code", (why) => { if (why !== "own") codeChanged(); });
  onEvent("build-error", (message) => showError(`The film's code has an error; the page keeps the last version and reloads once it's fixed.\n\n${message}`));
  onEvent("sound-start", () => say("Mixing sound…"));
  onEvent("sound", () => { loadMix(); loadTrials(); loadSound(); say("Sound updated"); });
  onEvent("lanes", loadSound); // an agent edited lanes the page plays itself: no remix, just the file again
  onEvent("cam", loadCam); // an agent edited the camera keys: the picture takes them now, no new build to load
  onEvent("keys", (i) => loadKeys(Number(i))); // the same for one key file (Steve, props): which one it names
  onEvent("shots", loadShots);
  onEvent("text", loadText); // an agent edited the titles: the picture takes them now
  onEvent("notes", loadNotes);
  onEvent("voice", loadVoice);
  onEvent("contract", loadContract);
  onEvent("film", codeChanged); // the frame's shape changed (Settings, maybe in another page): a reload builds the scene at it
  onEvent("favorites", loadFavorites); // starred here, in another tab or on the phone
  // Back after the line dropped or the studio restarted: catch up on what changed meanwhile
  onHello((current, reconnect) => {
    if (!current) codeChanged();
    // Not the mix: that is the whole WAV again on every phone unlock. The rest answers "unchanged" for a few bytes
    if (reconnect) { loadNotes(); loadVoice(); loadContract(); loadTrials(); loadSound(); loadCam(); loadKeys(); loadShots(); loadText(); loadFavorites(); }
  });
};

// ---------- Start, then draw whenever something changed
export const start = async (el: Elements) => {
  S.el = el;
  await loadFilm(); // the stage, the canvases and the scene are all sized by it
  THREE.DefaultLoadingManager.onError = (url) => { S.failedFile = url; };
  THREE.DefaultLoadingManager.onProgress = (_, done, total) => { if (!S.render) set({ loading: `Loading the scene… ${done}/${total}` }); };
  marks.notes = noteMarks;
  marks.optionRanges = optionRanges;
  restoreVolume();
  listen();
  attachPicture();
  attachTimeline();
  attachPreviewAxis();
  restoreInOut();
  attachLanes();
  attachCamRow();
  attachKeyRows();
  attachTextRow();
  attachAcross();
  attachInk({ look: lookAtClick, begin: ensureNote, pause: () => { if (S.playing) setPlaying(false); } });
  fit();
  if (!AWAY) el.audio.src = MIX_URL; // on a phone line the room comes first, or the sound eats the bandwidth while the picture stays black
  flushNotes();
  FILM.applyEdit();
  S.comments = await (await getFile("/api/shots.json")).json();
  const t0 = performance.now();
  // A phone gets fewer pixels to draw; clicks and pins are in fractions of the picture, so nothing else notices
  const [w, h] = frameSize(PHONE ? 640 : 960);
  el.canvas.width = w; el.canvas.height = h;
  const timeline = Promise.all([loadNotes(), loadVoice()]); // the words and notes don't wait for the room
  try {
    S.render = await buildScene(el.canvas, w, h, true);
  } catch (e) {
    // A file lost on a bad line: start again, the browser keeps the ones that arrived. Giving up has to say which file
    const tries = Number(stored.get("loadTries", sessionStorage)) || 0;
    if (tries < 3) {
      stored.set("loadTries", String(tries + 1), sessionStorage);
      set({ loading: `Connection unstable. Retrying (${tries + 1})…` });
      // Only once the line is back: reloading into no network would leave the browser's own error page
      for (;;) { await wait(1500); try { if ((await fetch("/api/edit.json")).ok) break; } catch {} }
      location.reload();
      return;
    }
    stored.remove("loadTries", sessionStorage);
    throw new Error(`Couldn't load ${S.failedFile || "the scene"}. Check your connection, then reload. (${(e as Error).message})`);
  }
  stored.remove("loadTries", sessionStorage);
  if (AWAY) loadWholeMix();
  S.tools = S.render.tools;
  set({ placed: !!S.tools.placed });
  reportFilm(checkFilm(FILM, S.render));
  loadContract();
  set({ loading: "", ready: true });
  say(`Loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const extras = Promise.all([timeline, loadTrials(), loadSounds(), loadSound(), loadCam(), loadKeys(), loadShots(), loadText(), loadFavorites()]).then(() => { refreshTimes(); S.dirty = true; });
  refreshTimes();
  seek(S.t);
  loop();
  extras.then(() => { restoreDraft(); window.__readyAt = Date.now(); reportWeight(); });
};

const warm = SHOTS.map((_, i) => i).sort((a, b) => Math.abs(SHOTS[a].t - S.t) - Math.abs(SHOTS[b].t - S.t));
let drawMs = 0, frames = 0, fpsAt = performance.now(), shownShot = -1, lastFrame = performance.now();
// A film that throws at one moment still lets the dev move to another: the error shows and the next frame comes anyway
const loop = () => {
  try { frame(); } catch (e) { showError(e); }
  // A page in the background gets no animation frames, and the sound would carry on without the picture
  if (document.hidden) setTimeout(loop, 100); else requestAnimationFrame(loop);
};
const frame = () => {
  const dt = Math.min(0.1, (performance.now() - lastFrame) / 1000); // a frame after a stall moves a little, never across the room
  lastFrame = performance.now();
  fly(dt);
  tick();
  const peeked = peekTime(); // CapCut's preview axis: the frame under the mouse on the timeline, the playhead staying (timeline/peek.ts)
  if (S.dirty || S.viewMoved) {
    if (S.dirty) staleFilmView(); // anything but the free camera's own move may change what the film camera sees
    S.dirty = S.viewMoved = false;
    const a = performance.now();
    render(peeked ?? S.t);
    followChips();
    drawMs = drawMs * 0.9 + (performance.now() - a) * 0.1;
    frames++;
    const i = shotIndex(S.t);
    S.el.clock.textContent = stamp(peeked ?? S.t);
    S.el.clock.toggleAttribute("data-peek", peeked !== null);
    if (i !== shownShot) { shownShot = i; set({ shot: `shot ${i}: ${S.comments[i] ?? ""}` }); }
    S.el.caption.textContent = get().captions ? captionAt(peeked ?? S.t) ?? "" : "";
    drawTimelines();
    S.el.pins.hidden = S.el.ink.hidden = S.el.chips.hidden = peeked !== null; // the playhead's, not the peeked frame's
    drawPins();
    drawInk(drawnNotes);
    let finalNow = false;
    if (get().final && S.finalRender) {
      if (S.playing || S.dragging || peeked !== null) { S.el.final.hidden = true; S.finalAt = -1; }
      else if (S.finalAt !== S.t) { drawFinal(); finalNow = true; }
    }
    // The scopes read the frame on screen: the final-quality one when it shows (only when drawn now), else the draft
    measureScopes(finalNow ? S.el.final : S.el.final.hidden ? S.el.canvas : null);
    followNotes();
    stored.set("t", String(S.t), sessionStorage);
    window.__live = { t: S.t, shot: i, drawMs };
  } else if (warm.length) {
    // While nothing is asked of it: touch one more shot, nearest first, so its shaders and textures are ready before the first
    // jump there. The current frame is redrawn in the same task, so the screen never shows the detour
    render(SHOTS[warm.shift()!].t + 0.1);
    render(S.t);
  }
  const now = performance.now();
  if (now - fpsAt > 500) {
    const fps = (frames * 1000) / (now - fpsAt);
    frames = 0; fpsAt = now;
    set({ perf: `${S.playing ? fps.toFixed(0) + " fps, " : ""}${drawMs.toFixed(0)} ms/frame` });
  }
};
