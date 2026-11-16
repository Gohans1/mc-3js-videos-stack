// What the page plays itself (options to try, beat sounds, the live sound lanes) runs on the mix's clock: the <audio> element
// plays the mix, and every 50 ms each player schedules what is due in the next quarter second against it
import { S, wake } from "../core/state";

let ctx: AudioContext | null = null,
  masterNode: GainNode | null = null,
  monitorNode: GainNode | null = null,
  masterLevel = 1;
const readyHooks = new Set<(ctx: AudioContext, master: GainNode) => void>();

export const hasAudio = () => ctx !== null;
export const onAudioReady = (fn: (ctx: AudioContext, master: GainNode) => void) => {
  readyHooks.add(fn);
  if (ctx && masterNode) fn(ctx, masterNode);
  return () => {
    readyHooks.delete(fn);
  };
};
export const getAudio = (): { ctx: AudioContext; master: GainNode } => {
  if (!ctx || !masterNode || !monitorNode) {
    ctx = new AudioContext();
    // Everything the page plays sums here at the film's own level, where the meter reads it (meter.ts); the volume slider comes after
    masterNode = ctx.createGain();
    monitorNode = ctx.createGain();
    const audio = S.el?.audio;
    if (audio) masterLevel = audio.muted ? 0 : audio.volume;
    monitorNode.gain.value = masterLevel;
    masterNode.connect(monitorNode).connect(ctx.destination);
    for (const hook of readyHooks) hook(ctx, masterNode);
  }
  return { ctx, master: masterNode };
};
export const getAudioCtx = () => getAudio().ctx;
export const getMaster = () => getAudio().master;
export const resumeAudio = () => {
  void getAudioCtx().resume();
};
// Read as a stereo file is: a mono sound comes out of both sides, as ffmpeg makes it stereo in the final mix
export const STEREO = {
  channelCount: 2,
  channelCountMode: "explicit",
  channelInterpretation: "speakers",
} as const;
// An AudioWorklet module (loaded by URL) added to a context once
const added = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();
export const addModule = (ctx: BaseAudioContext, url: string) => {
  const mine = added.get(ctx) ?? new Map<string, Promise<void>>();
  added.set(ctx, mine);
  if (!mine.has(url)) mine.set(url, ctx.audioWorklet.addModule(url));
  return mine.get(url)!;
};

export interface Window {
  now: number;
  speed: number;
  until: number;
  due: (at: number) => boolean; // a moment first inside this window, so it is played once
  when: (at: number) => number; // the context time of film second at, never in the past
  ctxAt: (at: number) => number; // the same, unclamped: for envelopes that started before now
}
interface Player {
  tick: (w: Window) => void;
  reset: () => void;
}
const players: Player[] = [];
export const addPlayer = (p: Player) => {
  players.push(p);
};

let sounding: AudioScheduledSourceNode[] = [],
  anchor: { base: number; speed: number; from: number } | null = null;
export const hasSounding = () => sounding.length > 0;
export const track = (src: AudioScheduledSourceNode) => {
  src.addEventListener("ended", () => {
    sounding = sounding.filter((s) => s !== src);
  });
  sounding.push(src);
  wake("audio");
};
const silence = () => {
  for (const s of sounding) {
    try {
      s.stop();
    } catch {}
  }
  sounding = [];
  anchor = null;
  for (const p of players) p.reset();
};
// Something heard changed (an option picked): what is sounding stops and starts again from here
export const restart = () => {
  if (anchor && ctx) {
    silence();
    tick();
  }
};

export const syncMonitorGain = () => {
  const audio = S.el?.audio;
  if (!ctx || !monitorNode || !audio) return;
  const level = audio.muted ? 0 : audio.volume;
  if (masterLevel !== level) {
    masterLevel = level;
    monitorNode.gain.setTargetAtTime(level, ctx.currentTime, 0.015);
  } // eased, or a slider drag clicks
};

const tick = () => {
  const audio = S.el?.audio;
  if (!audio) return;
  if (!ctx || !monitorNode) {
    if (S.playing && !audio.paused && audio.readyState >= 3) getAudio();
    else return;
  }
  const activeCtx = ctx!;
  syncMonitorGain();
  if (!S.playing || audio.paused || audio.readyState < 3) {
    if (anchor) silence();
    return;
  }
  const now = audio.currentTime,
    speed = audio.playbackRate,
    base = activeCtx.currentTime - now / speed;
  // A seek shows up as a jump in the sound's clock; small wobble in that clock is ignored, so the rhythm of the presses stays even
  if (!anchor || anchor.speed !== speed || Math.abs(anchor.base - base) > 0.05) {
    silence();
    anchor = { base, speed, from: now };
  }
  const a = anchor,
    until = now + 0.25 * speed;
  const ctxAt = (at: number) => a.base + at / speed;
  const w: Window = {
    now,
    speed,
    until,
    ctxAt,
    due: (at) => at >= a.from && at < until && at > now - 0.1,
    when: (at) => Math.max(activeCtx.currentTime, ctxAt(at)),
  };
  for (const p of players) p.tick(w);
  a.from = until;
};
let tickTimer = 0;
const syncClockTick = () => {
  if (S.playing) {
    if (!tickTimer) tickTimer = window.setInterval(tick, 50);
  } else {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = 0;
    }
    tick();
  }
};
S.watch("playing", syncClockTick);
syncClockTick();
