import LoudnessNode from "loudness-worklet";
import worklet from "loudness-worklet/worklet?url";

import { DURATION } from "../core/filmMeta";
import { wake } from "../core/state";
import { get, set } from "../core/store";
import { addModule, getMaster, hasAudio, onAudioReady, STEREO } from "./clock";
import { MIX_CEILING, normalizationDelta } from "./gain";
import { renderFilm } from "./mixer";

const load = (ctx: BaseAudioContext) => addModule(ctx, worklet);
export const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

type MeterNodes = {
  ctx: AudioContext;
  stereo: GainNode;
  split: ChannelSplitterNode;
  sink: GainNode;
  taps: AnalyserNode[];
};

type MeterConn =
  | { kind: "stopped"; nodes: MeterNodes | null }
  | { kind: "waiting"; nodes: MeterNodes | null }
  | { kind: "loading"; nodes: MeterNodes; seq: number }
  | {
      kind: "attached";
      nodes: MeterNodes;
      loud: LoudnessNode | null;
      metrics: Float32Array | null;
    };

const samples = new Float32Array(4096);
let conn: MeterConn = { kind: "stopped", nodes: null };
let connSeq = 0;
let unsubAudio: (() => void) | null = null;
let lastTapCtx: AudioContext | null = null;
let lastTapTime = -1;
const rawPeak: [number, number] = [-Infinity, -Infinity];
const peakOut: [number, number] = [-Infinity, -Infinity];
const readingOut: Reading = {
  peak: peakOut,
  shortTerm: -Infinity,
  integrated: -Infinity,
  truePeak: -Infinity,
};

const ensureNodes = (ctx: AudioContext): MeterNodes => {
  if (conn.nodes && conn.nodes.ctx === ctx) return conn.nodes;
  lastTapCtx = null;
  lastTapTime = -1;
  rawPeak[0] = -Infinity;
  rawPeak[1] = -Infinity;
  const stereo = new GainNode(ctx, STEREO);
  const split = ctx.createChannelSplitter(2);
  const sink = ctx.createGain();
  stereo.connect(split);
  sink.gain.value = 0;
  sink.connect(ctx.destination);
  const taps = [0, 1].map((c) => {
    const a = ctx.createAnalyser();
    a.fftSize = 4096;
    split.connect(a, c);
    return a;
  });
  return { ctx, stereo, split, sink, taps };
};
const connectMeter = async (ctx: AudioContext, master: GainNode) => {
  if (conn.kind !== "waiting") return;
  const nodes = ensureNodes(ctx);
  const seq = ++connSeq;
  conn = { kind: "loading", nodes, seq };
  master.connect(nodes.stereo);
  try {
    await load(ctx);
  } catch (err) {
    if (conn.kind === "loading" && conn.seq === seq) {
      if (hasAudio()) getMaster().disconnect(nodes.stereo);
      conn = { kind: "stopped", nodes };
    }
    throw err;
  }
  if (conn.kind !== "loading" || conn.seq !== seq) return;
  conn = { kind: "attached", nodes, loud: null, metrics: null };
  resetLoudness();
  wake("audio");
};
export const startMeter = async () => {
  if (conn.kind === "loading" || conn.kind === "attached") return;
  conn = { kind: "waiting", nodes: conn.nodes };
  if (!unsubAudio)
    unsubAudio = onAudioReady((ctx, master) => {
      if (conn.kind === "waiting") void connectMeter(ctx, master);
    });
  else if (hasAudio()) {
    const master = getMaster();
    await connectMeter(conn.nodes?.ctx ?? (master.context as AudioContext), master);
  }
};
export const stopMeter = () => {
  connSeq++;
  const prev = conn;
  conn = { kind: "stopped", nodes: prev.nodes };
  if (prev.kind !== "loading" && prev.kind !== "attached") return;
  lastTapTime = -1;
  rawPeak[0] = -Infinity;
  rawPeak[1] = -Infinity;
  if (hasAudio()) getMaster().disconnect(prev.nodes.stereo);
  if (prev.kind === "attached" && prev.loud) {
    prev.nodes.stereo.disconnect(prev.loud);
    prev.loud.disconnect();
  }
};
export const resetLoudness = () => {
  if (conn.kind !== "attached") return;
  const { nodes, loud } = conn;
  if (loud) {
    nodes.stereo.disconnect(loud);
    loud.disconnect();
  }
  const nextLoud = new LoudnessNode(nodes.ctx, STEREO);
  const nextMetrics = new Float32Array(nextLoud.metricCount);
  nodes.stereo.connect(nextLoud).connect(nodes.sink);
  conn = { kind: "attached", nodes, loud: nextLoud, metrics: nextMetrics };
};

export interface Reading {
  peak: [number, number];
  shortTerm: number;
  integrated: number;
  truePeak: number;
}
export const readMeter = (gain: number): Reading => {
  const nodes = conn.nodes;
  if (nodes) {
    const t = nodes.ctx.currentTime;
    if (t <= 0) {
      rawPeak[0] = -Infinity;
      rawPeak[1] = -Infinity;
      lastTapCtx = nodes.ctx;
      lastTapTime = 0;
    } else if (lastTapCtx !== nodes.ctx || t !== lastTapTime) {
      lastTapCtx = nodes.ctx;
      lastTapTime = t;
      for (let c = 0; c < 2; c++) {
        nodes.taps[c].getFloatTimeDomainData(samples);
        let m = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = samples[i];
          const a = v < 0 ? -v : v;
          if (a > m) m = a;
        }
        rawPeak[c] = db(m);
      }
    }
    peakOut[0] = rawPeak[0] + gain;
    peakOut[1] = rawPeak[1] + gain;
  } else {
    peakOut[0] = -Infinity;
    peakOut[1] = -Infinity;
  }
  if (conn.kind !== "attached" || !conn.loud || !conn.metrics) {
    readingOut.shortTerm = -Infinity;
    readingOut.integrated = -Infinity;
    readingOut.truePeak = -Infinity;
    return readingOut;
  }
  conn.loud.getFloatLoudnessData(conn.metrics);
  const m = LoudnessNode.from(conn.metrics);
  if (m.currentFrame === 0) {
    readingOut.shortTerm = -Infinity;
    readingOut.integrated = -Infinity;
    readingOut.truePeak = -Infinity;
    return readingOut;
  }
  readingOut.shortTerm = m.shortTermLoudness + gain;
  readingOut.integrated = m.integratedLoudness + gain;
  readingOut.truePeak = m.maximumTruePeakLevel + gain;
  return readingOut;
};

export interface Loudness {
  before: number;
  target: number;
  gain: number;
  truePeak: number;
  held: number;
}
type LoudnessJob =
  | { kind: "idle" }
  | { kind: "scheduled"; timer: number }
  | { kind: "running"; rerun: boolean };
let loudnessJob: LoudnessJob = { kind: "idle" };
export const measureFinal = () => {
  if (loudnessJob.kind === "running") {
    loudnessJob = { kind: "running", rerun: true };
    return;
  }
  if (loudnessJob.kind === "scheduled") clearTimeout(loudnessJob.timer);
  loudnessJob = { kind: "scheduled", timer: window.setTimeout(measure, 1500) };
};
const measure = async () => {
  const { meter, ready } = get();
  if (!meter || !ready) {
    if (loudnessJob.kind === "scheduled") loudnessJob = { kind: "idle" };
    return;
  }
  if (loudnessJob.kind === "running") {
    loudnessJob = { kind: "running", rerun: true };
    return;
  }
  loudnessJob = { kind: "running", rerun: false };
  try {
    const got: { node?: LoudnessNode } = {};
    const lanes = await renderFilm(async (ctx) => {
      await load(ctx);
      got.node = new LoudnessNode(ctx, STEREO);
      got.node.connect(ctx.destination);
      return got.node;
    });
    if (!lanes || !got.node) {
      set({ loudness: null });
      return;
    }
    const m = new Float32Array(got.node.metricCount);
    for (let i = 0; i < 20; i++) {
      got.node.getFloatLoudnessData(m);
      if (LoudnessNode.from(m).currentTime >= DURATION - 0.2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const s = LoudnessNode.from(m),
      target = Number(lanes.lufs ?? -14);
    if (!Number.isFinite(s.integratedLoudness)) {
      set({ loudness: null });
      return;
    }
    const gain =
      normalizationDelta(s.integratedLoudness, target, s.maximumTruePeakLevel, MIX_CEILING) ??
      target - s.integratedLoudness;
    set({
      loudness: {
        before: s.integratedLoudness,
        target,
        gain,
        truePeak: s.maximumTruePeakLevel + gain,
        held: target - s.integratedLoudness - gain,
      },
    });
  } catch (e) {
    console.warn("The meter couldn't measure the film's loudness", e);
  } finally {
    const shouldRerun = loudnessJob.kind === "running" && loudnessJob.rerun;
    loudnessJob = { kind: "idle" };
    if (shouldRerun) measureFinal();
  }
};
