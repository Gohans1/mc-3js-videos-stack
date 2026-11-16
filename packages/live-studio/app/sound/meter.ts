// The master meter's numbers (AudioMeter.tsx draws them): each channel's peak and the loudness of everything the page plays, read
// at master, before the volume slider. Loudness is EBU R128 / ITU-R BS.1770-5 from loudness-worklet (checked by its author
// against the EBU Tech 3341 and ITU BS.2217 test signals), never computed here. Every number is shifted to what the final render
// holds: mix.py's last pass moves the whole film by one gain to audio.json "lufs" (-14, YouTube's level), and that gain is
// measured here too, on the film's sound rendered offline after each change (mixer.ts renderFilm)
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

// ---------- Live, while the meter is shown
let nodeCtx: AudioContext | null = null,
  stereo: GainNode | null = null,
  split: ChannelSplitterNode | null = null,
  sink: GainNode | null = null,
  taps: AnalyserNode[] | null = null;
const samples = new Float32Array(4096);
let wanted = false,
  on = false,
  ready = false,
  loud: LoudnessNode | null = null,
  metrics: Float32Array | null = null,
  unsubAudio: (() => void) | null = null,
  lastTapCtx: AudioContext | null = null,
  lastTapTime = -1;
const rawPeak: [number, number] = [-Infinity, -Infinity];
const peakOut: [number, number] = [-Infinity, -Infinity];
const readingOut: Reading = {
  peak: peakOut,
  shortTerm: -Infinity,
  integrated: -Infinity,
  truePeak: -Infinity,
};

const ensureNodes = (ctx: AudioContext) => {
  if (nodeCtx === ctx && stereo && taps) return;
  nodeCtx = ctx;
  lastTapCtx = null;
  lastTapTime = -1;
  rawPeak[0] = -Infinity;
  rawPeak[1] = -Infinity;
  stereo = new GainNode(ctx, STEREO);
  split = ctx.createChannelSplitter(2);
  sink = ctx.createGain();
  stereo.connect(split);
  sink.gain.value = 0; // the loudness node passes the sound on and only runs while that reaches the output: silently
  sink.connect(ctx.destination);
  // 4096 samples (~85 ms): each frame's read overlaps the last one even at 15 fps, so no peak falls between two
  taps = [0, 1].map((c) => {
    const a = ctx.createAnalyser();
    a.fftSize = 4096;
    split!.connect(a, c);
    return a;
  });
};
const connectMeter = async (ctx: AudioContext, master: GainNode) => {
  if (!wanted || on) return;
  on = true;
  ensureNodes(ctx);
  master.connect(stereo!);
  await load(ctx);
  ready = true;
  if (on) {
    resetLoudness();
    wake("audio");
  }
};
export const startMeter = async () => {
  wanted = true;
  if (!unsubAudio)
    unsubAudio = onAudioReady((ctx, master) => {
      if (wanted) void connectMeter(ctx, master);
    });
  else if (hasAudio()) {
    const master = getMaster();
    await connectMeter(nodeCtx ?? (master.context as AudioContext), master);
  }
};
export const stopMeter = () => {
  wanted = false;
  if (!on) return;
  on = false;
  lastTapTime = -1;
  rawPeak[0] = -Infinity;
  rawPeak[1] = -Infinity;
  if (hasAudio() && stereo) getMaster().disconnect(stereo);
  if (loud && stereo) {
    stereo.disconnect(loud);
    loud.disconnect();
    loud = null;
  }
};
// A new count, so the integrated reading covers what has played since (AudioMeter calls it when Play is pressed)
export const resetLoudness = () => {
  if (!on || !ready || !nodeCtx || !stereo || !sink) return;
  if (loud) {
    stereo.disconnect(loud);
    loud.disconnect();
  }
  loud = new LoudnessNode(nodeCtx, STEREO);
  metrics = new Float32Array(loud.metricCount);
  stereo.connect(loud).connect(sink);
};

export interface Reading {
  peak: [number, number];
  shortTerm: number;
  integrated: number;
  truePeak: number;
}
// In dB as the final render will have them (its gain added); -Infinity until there is something to read
export const readMeter = (gain: number): Reading => {
  if (taps && nodeCtx) {
    const t = nodeCtx.currentTime;
    if (t <= 0) {
      rawPeak[0] = -Infinity;
      rawPeak[1] = -Infinity;
      lastTapCtx = nodeCtx;
      lastTapTime = 0;
    } else if (lastTapCtx !== nodeCtx || t !== lastTapTime) {
      lastTapCtx = nodeCtx;
      lastTapTime = t;
      for (let c = 0; c < 2; c++) {
        taps[c].getFloatTimeDomainData(samples);
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
  if (!loud || !metrics) {
    readingOut.shortTerm = -Infinity;
    readingOut.integrated = -Infinity;
    readingOut.truePeak = -Infinity;
    return readingOut;
  }
  loud.getFloatLoudnessData(metrics);
  const m = LoudnessNode.from(metrics);
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

// ---------- The final render's loudness pass (mix.py, listen.level): one linear gain to the target, or as far as MIX_CEILING allows
export interface Loudness {
  before: number;
  target: number;
  gain: number;
  truePeak: number;
  held: number;
} // truePeak: the film's, after the gain; held: how far short of the target the ceiling stopped it
let timer = 0,
  busy = false,
  again = false;
// After the lanes or the narration change, once the edits rest: a render of the whole film takes a second or two
export const measureFinal = () => {
  clearTimeout(timer);
  timer = window.setTimeout(measure, 1500);
};
const measure = async () => {
  if (!get().meter) return; // measured again when it is shown (AudioMeter)
  if (busy) {
    again = true;
    return;
  }
  busy = true;
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
    // The worklet sends its numbers as messages every 0.1 s of film; the last land a moment after the render ends
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
    busy = false;
    if (again) {
      again = false;
      measureFinal();
    }
  }
};
