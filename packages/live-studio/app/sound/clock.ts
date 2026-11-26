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
export const STEREO = {
  channelCount: 2,
  channelCountMode: "explicit",
  channelInterpretation: "speakers",
} as const;
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
  due: (at: number) => boolean;
  when: (at: number) => number;
  ctxAt: (at: number) => number;
}
interface Player {
  tick: (w: Window) => void;
  reset: () => void;
}
const players: Player[] = [];
export const addPlayer = (p: Player) => {
  players.push(p);
};

export const LOOKAHEAD = 1;
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
    const now = ctx.currentTime;
    monitorNode.gain.cancelScheduledValues(now);
    if (level === 0) monitorNode.gain.setValueAtTime(0, now);
    else monitorNode.gain.setTargetAtTime(level, now, 0.015);
  }
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
  if (!anchor || anchor.speed !== speed || Math.abs(anchor.base - base) > 0.05) {
    silence();
    anchor = { base, speed, from: now };
  }
  const a = anchor,
    until = now + LOOKAHEAD * speed;
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
