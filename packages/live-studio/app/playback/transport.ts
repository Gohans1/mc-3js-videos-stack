import { AWAY, SMALL_SOUND } from "../core/device";
import { shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { wait } from "../core/net";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, say, set } from "../core/store";
import { FPS } from "../core/time";
import { ensureBeatSounds, warmTrialAudio } from "../options/options";
import { resumeAudio, syncMonitorGain } from "../sound/clock";

export const MIX_URL = SMALL_SOUND ? "/api/mix_small.webm" : "/api/mix.wav";
const pastMix = (audio: HTMLAudioElement) =>
  Number.isFinite(audio.duration) && S.t >= audio.duration - 0.05;
const startSound = () => {
  const audio = S.el.audio;
  if (pastMix(audio)) {
    audio.pause();
    return false;
  }
  audio.currentTime = S.t;
  audio.play().catch(() => {});
  return true;
};
const SHUTTLE = [1, 2, 4, 8];
let shuttle = 0,
  backFrom = 0,
  backAt = 0,
  shown = "";
let looping = false;
const inside = () => {
  const r = get().inOut;
  return !!r && S.t >= r[0] - 1e-6 && S.t < r[1];
};
const syncClock = () => {
  S.clockStart = performance.now() - (S.t * 1000) / S.el.audio.playbackRate;
};
const endShuttle = () => {
  if (!shuttle) return;
  shuttle = 0;
  S.el.audio.playbackRate = get().rate;
  if (get().status === shown) say("", 0);
};
export const seekLimit = () => Math.max(0, DURATION - 0.01);
export const seekExact = (x: number) => {
  S.t = Math.max(0, Math.min(seekLimit(), x));
  const audio = S.el.audio;
  if (audio.readyState > 0) audio.currentTime = S.t;
  if (shuttle < 0) {
    backFrom = S.t;
    backAt = performance.now();
  } else if (S.playing && audio.paused && audio.readyState > 0) startSound();
  syncClock();
  S.dirty = true;
};
export const seek = (x: number) => seekExact(Math.round(x * FPS) / FPS);
export const setPlaying = (p: boolean) => {
  if (!S.el || (p && !S.render)) return;
  S.playing = p;
  set({ playing: p });
  const audio = S.el.audio;
  if (p) {
    looping = inside();
    syncClock();
    if (!startSound()) say("The sound ends before the film; wait for the remix");
    resumeAudio();
    void warmTrialAudio();
    void ensureBeatSounds();
  } else {
    endShuttle();
    audio.pause();
    seek(Math.round(S.t * FPS) / FPS);
  }
};
export const shuttleOn = (d: -1 | 1) => {
  if (!S.el || !S.render) return;
  const audio = S.el.audio,
    faster = S.playing && Math.sign(shuttle || 1) === d;
  const v = faster ? (SHUTTLE.find((x) => x > Math.abs(shuttle || 1)) ?? SHUTTLE.at(-1)!) : 1;
  if (!S.playing) looping = inside();
  shuttle = d * v;
  S.playing = true;
  set({ playing: true });
  if (d > 0) {
    audio.playbackRate = v;
    syncClock();
    if (audio.paused && !startSound()) say("The sound ends before the film; wait for the remix");
    resumeAudio();
    void warmTrialAudio();
    void ensureBeatSounds();
  } else {
    audio.pause();
    backFrom = S.t;
    backAt = performance.now();
  }
  say((shown = `${d > 0 ? "Forward" : "Backward"} ${v}× (K stops)`), 0);
};
export const reloadNow = () => {
  stored.set("t", String(S.t), sessionStorage);
  location.reload();
};
export const togglePlay = () => {
  endShuttle();
  setPlaying(!S.playing);
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
  syncClock();
  set({ rate: r });
};

const setAudio = (url: string) => {
  const audio = S.el.audio;
  audio.src = url;
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (S.playing && shuttle >= 0) startSound();
      else audio.currentTime = S.t;
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
  const a = S.el?.audio;
  if (S.playing && shuttle >= 0 && a?.paused && a.readyState > 0) startSound();
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
const showVolume = () => {
  const a = S.el?.audio;
  if (a) {
    set({ muted: a.muted, volume: a.volume });
    syncMonitorGain();
  } else {
    set({ muted: get().muted, volume: heardLevel });
  }
  stored.set("volume", String(heardLevel));
};
export const setVolume = (v: number) => {
  const a = S.el?.audio;
  v = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
  if (v) heardLevel = v;
  if (a) {
    a.muted = v === 0;
    if (v) a.volume = v;
    showVolume();
  } else {
    set({ muted: v === 0, volume: v || heardLevel });
    stored.set("volume", String(heardLevel));
  }
};
export const toggleMute = () => {
  const a = S.el?.audio;
  if (a) {
    if (a.muted) setVolume(heardLevel);
    else {
      if (a.volume > 0) heardLevel = a.volume;
      a.muted = true;
      showVolume();
    }
    return;
  }
  if (get().muted) setVolume(heardLevel);
  else {
    const cur = get().volume;
    if (cur > 0) heardLevel = cur;
    set({ muted: true });
  }
};
export const restoreVolume = () => {
  const v = Number(stored.get("volume") ?? 1);
  if (v > 0 && v <= 1) setVolume(v);
};
export const nudgeVolume = (up: boolean) => {
  const a = S.el?.audio;
  const muted = a ? a.muted : get().muted;
  const vol = a ? a.volume : get().volume;
  setVolume((muted ? (up ? heardLevel - 0.1 : 0) : vol) + (up ? 0.1 : -0.1));
};

export const tick = () => {
  if (!S.playing) return;
  const r = get().inOut;
  if (shuttle < 0) {
    S.t = Math.max(0, backFrom + ((performance.now() - backAt) / 1000) * shuttle);
    if (looping && r && S.t <= r[0]) {
      seek(r[1]);
      return;
    }
    if (S.t === 0) setPlaying(false);
    S.dirty = true;
    return;
  }
  const audio = S.el.audio,
    rate = audio.playbackRate;
  if (!audio.paused && audio.readyState > 2) {
    S.t = audio.currentTime;
    syncClock();
  } else if (!audio.src || audio.error || pastMix(audio))
    S.t = ((performance.now() - S.clockStart) / 1000) * rate;
  else syncClock();
  if (looping && r && S.t >= Math.min(r[1], DURATION - 0.02)) {
    seek(r[0]);
    return;
  }
  if (S.t >= DURATION - 0.02) {
    S.t = DURATION - 0.02;
    setPlaying(false);
  }
  S.dirty = true;
};
