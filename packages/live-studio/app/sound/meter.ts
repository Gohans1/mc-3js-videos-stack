import { DURATION } from "film/scene";
// The master meter's numbers (AudioMeter.tsx draws them): each channel's peak and the loudness of everything the page plays, read
// at master, before the volume slider. Loudness is EBU R128 / ITU-R BS.1770-5 from loudness-worklet (checked by its author
// against the EBU Tech 3341 and ITU BS.2217 test signals), never computed here. Every number is shifted to what the final render
// holds: mix.py's last pass moves the whole film by one gain to audio.json "lufs" (-14, YouTube's level), and that gain is
// measured here too, on the film's sound rendered offline after each change (mixer.ts renderFilm)
import LoudnessNode from "loudness-worklet";
import worklet from "loudness-worklet/worklet?url";

import { get, set } from "../core/store";
import { addModule, audioCtx, master, STEREO } from "./clock";
import { MIX_CEILING, normalizationDelta } from "./gain";
import { renderFilm } from "./mixer";

const load = (ctx: BaseAudioContext) => addModule(ctx, worklet);
export const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

// ---------- Live, while the meter is shown
const stereo = new GainNode(audioCtx, STEREO),
  split = audioCtx.createChannelSplitter(2),
  sink = audioCtx.createGain();
stereo.connect(split);
sink.gain.value = 0; // the loudness node passes the sound on and only runs while that reaches the output: silently
sink.connect(audioCtx.destination);
// 4096 samples (~85 ms): each frame's read overlaps the last one even at 15 fps, so no peak falls between two
const taps = [0, 1].map((c) => {
  const a = audioCtx.createAnalyser();
  a.fftSize = 4096;
  split.connect(a, c);
  return a;
});
const samples = new Float32Array(4096);
let on = false,
  ready = false,
  loud: LoudnessNode | null = null,
  metrics: Float32Array | null = null;

export const startMeter = async () => {
  if (on) return;
  on = true;
  master.connect(stereo);
  await load(audioCtx);
  ready = true;
  if (on) resetLoudness();
};
export const stopMeter = () => {
  if (!on) return;
  on = false;
  master.disconnect(stereo);
  if (loud) {
    stereo.disconnect(loud);
    loud.disconnect();
    loud = null;
  }
};
// A new count, so the integrated reading covers what has played since (AudioMeter calls it when Play is pressed)
export const resetLoudness = () => {
  if (!on || !ready) return;
  if (loud) {
    stereo.disconnect(loud);
    loud.disconnect();
  }
  loud = new LoudnessNode(audioCtx, STEREO);
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
  const peak = taps.map((a) => {
    a.getFloatTimeDomainData(samples);
    let m = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > m) m = v;
    }
    return db(m) + gain;
  }) as [number, number];
  const none = { peak, shortTerm: -Infinity, integrated: -Infinity, truePeak: -Infinity };
  if (!loud || !metrics) return none;
  loud.getFloatLoudnessData(metrics);
  const m = LoudnessNode.from(metrics);
  if (m.currentFrame === 0) return none; // zeros, not silence, until the worklet's first message (and while the page is suspended)
  return {
    peak,
    shortTerm: m.shortTermLoudness + gain,
    integrated: m.integratedLoudness + gain,
    truePeak: m.maximumTruePeakLevel + gain,
  };
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
