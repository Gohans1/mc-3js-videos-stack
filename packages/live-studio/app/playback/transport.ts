// The playhead and the sound it plays by: seek, play and pause, speed, volume and where the mix comes from. Every part of the
// studio moves the playhead through here; while playing, the sound is the clock (tick), so picture and voice can't drift
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { AWAY } from "../core/device";
import { shotIndex } from "../core/film";
import { wait } from "../core/net";
import { stored } from "../core/storage";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { FPS } from "../core/time";
import { audioCtx } from "../sound/clock";

export const MIX_URL = AWAY ? "/api/mix_small.webm" : "/api/mix.wav";
// The mix can be shorter than the film: the film grew and its sound wasn't remixed yet. Past the mix's end the picture keeps
// its own clock, because playing a sound that has ended starts it over from 0, and the picture follows the sound
const pastMix = (audio: HTMLAudioElement) => Number.isFinite(audio.duration) && S.t >= audio.duration - 0.05;
// Every place that starts the sound goes through here. False: the picture is past the mix's end and plays on without it
const startSound = () => {
  const audio = S.el.audio;
  if (pastMix(audio)) { audio.pause(); return false; }
  audio.currentTime = S.t;
  audio.play().catch(() => {});
  return true;
};
// CapCut's shuttle (J, K, L): L plays on, faster with each press; J the same backwards, silent, as a sound can't play
// backwards; K stops. 0 when not shuttling, else the speed, negative backwards. Play and Space go back to the chosen speed
const SHUTTLE = [1, 2, 4, 8];
let shuttle = 0, backFrom = 0, backAt = 0, shown = ""; // shown: the speed said under the clock, there while it lasts
// Played from inside the In to Out stretch (timeline/inout.ts), the film goes back to In at Out (backwards, to Out at In), to
// watch one moment over and over; from outside it, it plays on
let looping = false;
const inside = () => { const r = get().inOut; return !!r && S.t >= r[0] - 1e-6 && S.t < r[1]; };
// With no sound to follow, tick runs the film at (now - clockStart) × the speed playing: this puts that clock at the playhead
const syncClock = () => { S.clockStart = performance.now() - (S.t * 1000) / S.el.audio.playbackRate; };
const endShuttle = () => {
  if (!shuttle) return;
  shuttle = 0;
  S.el.audio.playbackRate = get().rate;
  if (get().status === shown) say("", 0);
};
export const seek = (x: number) => {
  S.t = Math.max(0, Math.min(DURATION - 0.01, Math.round(x * FPS) / FPS)); // whole frames, so a time said out loud is a frame that exists
  const audio = S.el.audio;
  if (audio.readyState > 0) audio.currentTime = S.t;
  if (shuttle < 0) { backFrom = S.t; backAt = performance.now(); }
  else if (S.playing && audio.paused && audio.readyState > 0) startSound(); // back inside the mix from past its end
  syncClock();
  S.dirty = true;
};
export const setPlaying = (p: boolean) => {
  S.playing = p;
  set({ playing: p });
  const audio = S.el.audio;
  if (p) { looping = inside(); syncClock(); if (!startSound()) say("The sound ends before the film; wait for the remix"); audioCtx.resume(); }
  else { endShuttle(); audio.pause(); seek(Math.round(S.t * FPS) / FPS); }
};
export const shuttleOn = (d: -1 | 1) => {
  const audio = S.el.audio, faster = S.playing && Math.sign(shuttle || 1) === d; // playing plainly counts as forward at 1x
  const v = faster ? SHUTTLE.find((x) => x > Math.abs(shuttle || 1)) ?? SHUTTLE.at(-1)! : 1;
  if (!S.playing) looping = inside();
  shuttle = d * v;
  S.playing = true;
  set({ playing: true });
  if (d > 0) {
    audio.playbackRate = v; // the lanes follow it (sound/clock.ts)
    syncClock();
    if (audio.paused && !startSound()) say("The sound ends before the film; wait for the remix");
    audioCtx.resume();
  } else { audio.pause(); backFrom = S.t; backAt = performance.now(); }
  say((shown = `${d > 0 ? "Forward" : "Backward"} ${v}× (K stops)`), 0);
};
// The film's new code waits for the creator, who loads it with "New version" when it suits: an agent fixing notes saves code
// all through a review, and a reload on every stop broke the note being written next. Same second after; a draft comes back
export const reloadNow = () => { stored.set("t", String(S.t), sessionStorage); location.reload(); };
export const togglePlay = () => { endShuttle(); setPlaying(!S.playing); };
export const step = (seconds: number) => seek(S.t + seconds);
export const jumpShot = (d: number) => { const i = shotIndex(S.t); seek(d < 0 && S.t - SHOTS[i].t > 0.4 ? SHOTS[i].t : SHOTS[Math.max(0, Math.min(SHOTS.length - 1, i + d))].t); };
export const setRate = (r: number) => { const a = S.el.audio; a.defaultPlaybackRate = a.playbackRate = r; set({ rate: r }); };

// ---------- The sound's source
const setAudio = (url: string) => {
  const audio = S.el.audio;
  audio.src = url;
  audio.addEventListener("loadedmetadata", () => { if (S.playing && shuttle >= 0) startSound(); else audio.currentTime = S.t; }, { once: true });
};
// A phone line can stall for seconds: the whole mix comes down once and then plays from memory, so nothing the line does can cut it
let mixLoad = 0, mixBlob = "";
export const loadWholeMix = async () => {
  const mine = ++mixLoad;
  for (let tries = 0; mine === mixLoad; tries++) {
    try {
      const r = await fetch(MIX_URL);
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const total = Number(r.headers.get("content-length")), reader = r.body.getReader(), parts: Uint8Array<ArrayBuffer>[] = [];
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
export const loadMix = () => { if (AWAY) loadWholeMix(); else setAudio(`${MIX_URL}?${Date.now()}`); };
// The browser can pause the sound by itself (a notification, autoplay rules) while the picture runs on: pick it up where the picture is
const keepSound = () => { const a = S.el?.audio; if (S.playing && shuttle >= 0 && a?.paused && a.readyState > 0) startSound(); };
setInterval(keepSound, 1000);
document.addEventListener("pointerdown", keepSound);

// Phones leave the level to their own buttons (iOS ignores a page setting it), so there the speaker only mutes.
// A level of 0 counts as muted, and unmuting goes back to the last level that was heard
let heardLevel = 1;
const showVolume = () => { const a = S.el.audio; set({ muted: a.muted, volume: a.volume }); stored.set("volume", String(heardLevel)); };
export const setVolume = (v: number) => {
  const a = S.el.audio;
  v = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
  a.muted = v === 0;
  if (v) { a.volume = v; heardLevel = v; }
  showVolume();
};
export const toggleMute = () => { if (S.el.audio.muted) setVolume(heardLevel); else { S.el.audio.muted = true; showVolume(); } };
// The level heard on the last visit
export const restoreVolume = () => { const v = Number(stored.get("volume") ?? 1); if (v > 0 && v <= 1) setVolume(v); };
export const nudgeVolume = (up: boolean) => { const a = S.el.audio; setVolume((a.muted ? (up ? heardLevel - 0.1 : 0) : a.volume) + (up ? 0.1 : -0.1)); };

// One frame's playhead while playing. The sound is the clock, so picture and voice can't drift; slow frames are skipped, never
// delayed. A stalled sound holds the picture: running on would mean jumping back when the sound catches up. Only no sound at all
// (or the picture past the mix's end) lets the page's own clock run
export const tick = () => {
  if (!S.playing) return;
  const r = get().inOut;
  if (shuttle < 0) {
    S.t = Math.max(0, backFrom + ((performance.now() - backAt) / 1000) * shuttle);
    if (looping && r && S.t <= r[0]) { seek(r[1]); return; } // backwards the loop goes round the other way
    if (S.t === 0) setPlaying(false);
    S.dirty = true;
    return;
  }
  const audio = S.el.audio, rate = audio.playbackRate;
  if (!audio.paused && audio.readyState > 2) { S.t = audio.currentTime; syncClock(); }
  else if (!audio.src || audio.error || pastMix(audio)) S.t = ((performance.now() - S.clockStart) / 1000) * rate;
  else syncClock();
  if (looping && r && S.t >= Math.min(r[1], DURATION - 0.02)) { seek(r[0]); return; }
  if (S.t >= DURATION - 0.02) { S.t = DURATION - 0.02; setPlaying(false); }
  S.dirty = true;
};
