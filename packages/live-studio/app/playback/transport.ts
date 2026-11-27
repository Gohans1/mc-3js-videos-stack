import { AWAY, SMALL_SOUND } from "../core/device";
import { shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { wait } from "../core/net";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, say, set } from "../core/store";
import { FPS } from "../core/time";
import { ensureBeatSounds, warmTrialAudio } from "../options/options";
import {
  activeCompareVideo,
  applyCompareVideoAudioState,
  compareHooks,
  comparePlaybackEnd,
  compareStudioOffset,
  compareVideoDuration,
  compareVideoEffectiveAudio,
  compareVideoPlayable,
  compareVideoUsesMediaClock,
  isLiveCompareVideoSynced,
  pauseCompareVideoPlayback,
  startCompareVideoPlayback,
  syncCompareReferenceAudio,
  syncCompareVideoElement,
} from "../picture/compare-video";
import {
  filmToVideoTime,
  isCompareVideoTail,
  videoToFilmTime,
} from "../picture/compare-video-model";
import { resumeAudio } from "../sound/clock";
import { releaseFailedAudioReads } from "../sound/mixer";

export const MIX_URL = SMALL_SOUND ? "/api/mix_small.webm" : "/api/mix.wav";
const pastMix = (audio: HTMLAudioElement, time: number) =>
  Number.isFinite(audio.duration) && time >= audio.duration - 0.05;
const startSound = () => {
  const audio = S.el.audio;
  const time = S.t + compareStudioOffset();
  if (time < 0 || pastMix(audio, time)) {
    audio.pause();
    return time < 0;
  }
  audio.currentTime = time;
  audio.play().catch(() => {});
  return true;
};
const startStudioAudio = () => {
  const audio = S.el.audio;
  releaseFailedAudioReads();
  if (audio.paused && !startSound()) say("The sound ends before the film; wait for the remix");
  resumeAudio();
  void warmTrialAudio();
  void ensureBeatSounds(true);
};
const SHUTTLE = [1, 2, 4, 8];
type TransportMode =
  | { kind: "paused" }
  | { kind: "playing"; looping: boolean }
  | { kind: "shuttle-forward"; rate: number; looping: boolean; banner: string }
  | {
      kind: "shuttle-backward";
      rate: number;
      fromTime: number;
      startedAtMs: number;
      looping: boolean;
      banner: string;
    };
let mode: TransportMode = { kind: "paused" };
const shuttleRate = () =>
  mode.kind === "shuttle-forward"
    ? mode.rate
    : mode.kind === "shuttle-backward"
      ? -mode.rate
      : 0;
const isForwardPlaying = () => mode.kind === "playing" || mode.kind === "shuttle-forward";
const activeRate = () => (mode.kind === "shuttle-forward" ? mode.rate : get().rate);
const inside = () => {
  const r = get().inOut;
  return !!r && S.t >= r[0] - 1e-6 && S.t < r[1];
};
const syncClock = (rate = activeRate()) => {
  S.clockStart = performance.now() - (S.t * 1000) / Math.max(0.05, rate);
};
const elapsedTime = (rate: number) => ((performance.now() - S.clockStart) / 1000) * rate;
const clearShuttleUi = (prev: TransportMode) => {
  if (prev.kind !== "shuttle-forward" && prev.kind !== "shuttle-backward") return;
  S.el.audio.playbackRate = get().rate;
  if (get().status === prev.banner) say("", 0);
};
const setMode = (next: TransportMode) => {
  const prev = mode;
  mode = next;
  S.shuttle = shuttleRate();
  S.playing = next.kind !== "paused";
  if (next.kind === "paused" || next.kind === "playing") clearShuttleUi(prev);
};
const tickStudioAudio = (rate: number) => {
  const audio = S.el.audio;
  const offset = compareStudioOffset();
  const time = S.t + offset;
  if (!audio.paused && audio.readyState > 2) {
    S.t = audio.currentTime - offset;
    syncClock(rate);
  } else if (!audio.src || audio.error || time < 0 || pastMix(audio, time)) {
    S.t = elapsedTime(rate);
    if (time < 0 && S.t + offset >= 0 && audio.readyState > 0) startSound();
  } else {
    syncClock(rate);
  }
};
export const seekLimit = () => Math.max(0, DURATION - 0.01);
export const seekExact = (x: number) => {
  S.t = Math.max(0, Math.min(comparePlaybackEnd() - 0.01, x));
  const audio = S.el.audio;
  const inCompare = Boolean(activeCompareVideo());
  const rate = activeRate();
  let compareOutside: "before" | "after" | null = null;
  if (inCompare) {
    compareOutside = syncCompareVideoElement(S.t, { forceSeek: true, rate }).outside;
  }
  if (!compareVideoUsesMediaClock()) {
    if (audio.readyState > 0) {
      const time = S.t + compareStudioOffset();
      audio.currentTime = Math.max(0, time);
      if (time < 0 || pastMix(audio, time)) audio.pause();
    }
  }
  if (mode.kind === "shuttle-backward") {
    mode = { ...mode, fromTime: S.t, startedAtMs: performance.now() };
  } else if (isForwardPlaying()) {
    if (inCompare && compareVideoUsesMediaClock()) {
      if (compareOutside === null) startCompareVideoPlayback(rate);
    } else if (audio.paused && audio.readyState > 0) {
      startSound();
    }
  }
  syncClock(rate);
  S.dirty = true;
};
export const seek = (x: number) => seekExact(Math.round(x * FPS) / FPS);
export const skipCompareVideo = (direction: -1 | 1) => {
  const item = activeCompareVideo();
  const duration = compareVideoDuration();
  if (!item || duration <= 0 || !compareVideoPlayable()) return;
  const end = item.startSec + Math.max(0, duration - 0.01);
  const current = Math.max(item.startSec, Math.min(end, S.t));
  seekExact(Math.max(item.startSec, Math.min(end, current + direction * 5)));
};
const atCompareVideoEnd = (item: { startSec: number }, dur: number, t = S.t) => {
  const { t: videoTime } = filmToVideoTime(t, item.startSec, dur);
  return isCompareVideoTail(videoTime, dur);
};
const stopIfCompareEnded = (loopingNow: boolean) => {
  const compareItem = activeCompareVideo();
  if (!compareItem || compareVideoEffectiveAudio() !== "video") return false;
  const dur = compareVideoDuration();
  if (!atCompareVideoEnd(compareItem, dur)) return false;
  const r = get().inOut;
  if (loopingNow && r && r[0] < compareItem.startSec + dur - 0.02) {
    S.t = r[0];
    return false;
  }
  if (S.playing) setPlaying(false);
  else say("End of compare video — scrub back or switch audio to Live mix", 3000);
  return true;
};

const comparePauseTime = () => {
  const item = activeCompareVideo(),
    video = S.el.compareVideo;
  if (
    !isForwardPlaying() ||
    !item ||
    !isLiveCompareVideoSynced(video, item) ||
    video.paused ||
    video.seeking ||
    !compareVideoUsesMediaClock()
  )
    return S.t;
  const duration = compareVideoDuration();
  const { t, outside } = filmToVideoTime(S.t, item.startSec, duration);
  return outside || isCompareVideoTail(t, duration)
    ? S.t
    : videoToFilmTime(video.currentTime, item.startSec, comparePlaybackEnd());
};

export const setPlaying = (p: boolean) => {
  if (!S.el || (p && (get().compareVideoMode ? !compareVideoPlayable() : !S.render))) return;
  let loopNow = false;
  if (p) {
    loopNow = inside();
    if (stopIfCompareEnded(loopNow)) return;
  }
  const audio = S.el.audio;
  const pauseTime = p ? S.t : comparePauseTime();
  if (!p) {
    pauseCompareVideoPlayback();
    audio.pause();
  }
  setMode(p ? { kind: "playing", looping: loopNow } : { kind: "paused" });
  set({ playing: p });
  if (p) {
    const rate = get().rate;
    audio.playbackRate = rate;
    syncClock(rate);
    if (activeCompareVideo()) {
      startCompareVideoPlayback(rate);
      if (compareVideoUsesMediaClock()) audio.pause();
      else startStudioAudio();
    } else {
      startStudioAudio();
    }
  } else {
    if (activeCompareVideo()) {
      S.t = pauseTime;
      syncClock();
      S.dirty = true;
    } else seek(S.t);
  }
};
compareHooks.pause = () => setPlaying(false);
compareHooks.seek = seekExact;
export const shuttleOn = (d: -1 | 1) => {
  if (!S.el || (get().compareVideoMode ? !compareVideoPlayable() : !S.render)) return;
  const loopNow = mode.kind !== "paused" ? mode.looping : inside();
  if (d > 0 && stopIfCompareEnded(loopNow)) return;
  const audio = S.el.audio;
  const currentShuttle = shuttleRate();
  const faster = mode.kind !== "paused" && Math.sign(currentShuttle || 1) === d;
  const v = faster
    ? (SHUTTLE.find((x) => x > Math.abs(currentShuttle || 1)) ?? SHUTTLE.at(-1)!)
    : 1;
  const banner = `${d > 0 ? "Forward" : "Backward"} ${v}× (K stops)`;
  setMode(
    d > 0
      ? { kind: "shuttle-forward", rate: v, looping: loopNow, banner }
      : {
          kind: "shuttle-backward",
          rate: v,
          fromTime: S.t,
          startedAtMs: performance.now(),
          looping: loopNow,
          banner,
        },
  );
  set({ playing: true });
  if (d > 0) {
    audio.playbackRate = v;
    syncClock(v);
    if (activeCompareVideo()) {
      startCompareVideoPlayback(v);
      if (compareVideoUsesMediaClock()) audio.pause();
      else startStudioAudio();
    } else {
      startStudioAudio();
    }
  } else {
    pauseCompareVideoPlayback();
    audio.pause();
  }
  say(banner, 0);
};
export const reloadNow = () => {
  stored.set("t", String(S.t), sessionStorage);
  location.reload();
};
export const togglePlay = () => {
  setPlaying(mode.kind === "paused");
};
export const step = (seconds: number) => seek(S.t + seconds);
export const jumpShot = (d: number) => {
  if (!SHOTS.length) return;
  const i = shotIndex(S.t);
  seek(
    d < 0 && S.t - SHOTS[i].t > 0.4
      ? SHOTS[i].t
      : SHOTS[Math.max(0, Math.min(SHOTS.length - 1, i + d))].t,
  );
};
export const setRate = (r: number) => {
  const a = S.el.audio;
  a.defaultPlaybackRate = a.playbackRate = r;
  const effective = mode.kind === "shuttle-forward" ? mode.rate : r;
  if (S.el.compareVideo) {
    try {
      S.el.compareVideo.playbackRate = effective;
    } catch {}
  }
  syncClock(effective);
  set({ rate: r });
};

const setAudio = (url: string) => {
  const audio = S.el.audio;
  audio.src = url;
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (isForwardPlaying() && !compareVideoUsesMediaClock()) startSound();
      else audio.currentTime = Math.max(0, S.t + compareStudioOffset());
    },
    { once: true },
  );
};
let mixLoad = 0,
  mixBlob = "";
export const loadWholeMix = async () => {
  const mine = ++mixLoad;
  for (let tries = 0; mine === mixLoad; tries++) {
    try {
      const r = await fetch(MIX_URL);
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const total = Number(r.headers.get("content-length")),
        reader = r.body.getReader(),
        parts: Uint8Array<ArrayBuffer>[] = [];
      for (let got = 0; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) say(`Loading sound ${Math.round((got / total) * 100)}%`, 0);
      }
      if (mine !== mixLoad) return;
      URL.revokeObjectURL(mixBlob);
      mixBlob = URL.createObjectURL(new Blob(parts, { type: "audio/webm" }));
      setAudio(mixBlob);
      say("Sound loaded");
      return;
    } catch {
      say(`Connection unstable. Retrying sound (${tries + 1})…`, 0);
      await wait(2000);
    }
  }
};
export const loadMix = () => {
  if (AWAY) loadWholeMix();
  else setAudio(`${MIX_URL}?${Date.now()}`);
};
const keepSound = () => {
  if (compareVideoUsesMediaClock()) {
    const compareItem = activeCompareVideo();
    if (!compareItem) return;
    syncCompareReferenceAudio();
    const v = S.el?.compareVideo;
    if (!v || !isLiveCompareVideoSynced(v, compareItem)) return;
    const dur = compareVideoDuration();
    const { t: videoTime, outside } = filmToVideoTime(S.t, compareItem.startSec, dur);
    if (
      isForwardPlaying() &&
      outside === null &&
      v.paused &&
      v.readyState >= 2 &&
      !v.ended &&
      !isCompareVideoTail(videoTime, dur)
    ) {
      startCompareVideoPlayback(activeRate());
    }
    return;
  }
  const a = S.el?.audio;
  if (isForwardPlaying() && a?.paused && a.readyState > 0) startSound();
};
let soundTimer = 0;
const syncSoundTimer = () => {
  if (S.playing) {
    if (!soundTimer) soundTimer = window.setInterval(keepSound, 1000);
  } else if (soundTimer) {
    clearInterval(soundTimer);
    soundTimer = 0;
  }
};
S.watch("playing", syncSoundTimer);
if (S.playing) syncSoundTimer();
document.addEventListener("pointerdown", keepSound);

let heardLevel = 1;
export const setVolume = (v: number) => {
  v = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
  if (v) heardLevel = v;
  set({ muted: v === 0, volume: heardLevel });
  applyCompareVideoAudioState();
  stored.set("volume", String(heardLevel));
};
export const toggleMute = () => {
  setVolume(get().muted ? heardLevel : 0);
};
export const restoreVolume = () => {
  const v = Number(stored.get("volume") ?? 1);
  if (v > 0 && v <= 1) setVolume(v);
};
export const nudgeVolume = (up: boolean) => {
  const { muted, volume: vol } = get();
  setVolume((muted ? (up ? heardLevel - 0.1 : 0) : vol) + (up ? 0.1 : -0.1));
};

export const tick = () => {
  if (mode.kind === "paused") return;
  const loopingNow = mode.looping;
  const r = get().inOut;
  const compareItem = activeCompareVideo();
  const playbackEnd = compareItem ? comparePlaybackEnd() : DURATION;
  if (mode.kind === "shuttle-backward") {
    S.t = Math.max(0, mode.fromTime - ((performance.now() - mode.startedAtMs) / 1000) * mode.rate);
    if (compareItem) syncCompareVideoElement(S.t, { forceSeek: true });
    if (loopingNow && r && S.t <= r[0]) {
      seek(r[1]);
      return;
    }
    if (S.t === 0) setPlaying(false);
    S.dirty = true;
    return;
  }
  const effectiveRate = activeRate();
  if (compareItem) {
    const rawVideo = S.el.compareVideo;
    const video = isLiveCompareVideoSynced(rawVideo, compareItem) ? rawVideo : null;
    const audioMode = compareVideoEffectiveAudio();
    if (audioMode !== "studio") {
      const dur = compareVideoDuration();
      const { t: videoTime, outside } = filmToVideoTime(S.t, compareItem.startSec, dur);
      const pictureEnded = video?.ended || isCompareVideoTail(videoTime, dur);
      if (outside === "before") {
        S.t = elapsedTime(effectiveRate);
        if (S.t >= compareItem.startSec) {
          syncClock(effectiveRate);
          startCompareVideoPlayback(effectiveRate);
        }
      } else if (!video) {
        syncClock(effectiveRate);
      } else if (audioMode === "reference" && pictureEnded) {
        S.t = Math.max(compareItem.startSec + dur, elapsedTime(effectiveRate));
      } else if (pictureEnded) {
        if (loopingNow && r && r[0] < compareItem.startSec + dur - 0.02) {
          seek(r[0]);
          return;
        }
        if (outside !== "after") {
          S.t = videoToFilmTime(dur || video.duration || 0, compareItem.startSec, playbackEnd);
        }
        setPlaying(false);
        S.dirty = true;
        return;
      } else if (!video.paused && !video.seeking && video.readyState >= 2) {
        S.t = videoToFilmTime(video.currentTime, compareItem.startSec, playbackEnd);
        syncClock(effectiveRate);
      } else {
        syncClock(effectiveRate);
      }
      syncCompareReferenceAudio();
    } else {
      tickStudioAudio(effectiveRate);
      const { outside } = syncCompareVideoElement(S.t, { rate: effectiveRate });
      if (video && outside === null && video.paused && video.readyState >= 2 && !video.ended) {
        video.play().catch(() => {});
      }
    }
  } else {
    tickStudioAudio(effectiveRate);
  }
  if (loopingNow && r && S.t >= Math.min(r[1], playbackEnd - 0.02)) {
    seek(r[0]);
    return;
  }
  if (S.t >= playbackEnd - 0.02) {
    S.t = Math.max(0, playbackEnd - 0.02);
    setPlaying(false);
  }
  S.dirty = true;
};
