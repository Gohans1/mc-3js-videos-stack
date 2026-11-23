export const REVERB_SPACES = ["dry", "small-room", "hall", "stairwell", "cave", "outdoor"] as const;

export type ReverbPreset = (typeof REVERB_SPACES)[number];

export interface ReverbSpec {
  space: string;
  wet?: number;
  preDelayMs?: number;
}

export interface ShotSpace {
  from: number;
  to?: number;
  space: string;
  wet?: number;
  preDelayMs?: number;
}

export interface ResolvedReverb {
  space: string;
  wet: number;
  preDelayMs: number;
}

interface EarlyTap {
  ms: number;
  gain: number;
  pan: number;
}

interface SpacePresetConfig {
  durationSec: number;
  defaultWet: number;
  defaultPreDelayMs: number;
  rt60Low: number;
  rt60High: number;
  crossoverHz: number;
  density: number;
  tailGain: number;
  tailFadeInSec: number;
  seed: number;
  early: readonly EarlyTap[];
}

export const SPACE_PRESETS: Record<Exclude<ReverbPreset, "dry">, SpacePresetConfig> = {
  "small-room": {
    durationSec: 0.55,
    defaultWet: 0.18,
    defaultPreDelayMs: 6,
    rt60Low: 0.42,
    rt60High: 0.24,
    crossoverHz: 1400,
    density: 2400,
    tailGain: 0.34,
    tailFadeInSec: 0.018,
    seed: 0x11a2b3c4,
    early: [
      { ms: 4.2, gain: 0.85, pan: -0.65 },
      { ms: 6.8, gain: 0.72, pan: 0.6 },
      { ms: 10.1, gain: 0.58, pan: -0.35 },
      { ms: 13.7, gain: 0.46, pan: 0.8 },
      { ms: 18.4, gain: 0.35, pan: -0.75 },
      { ms: 23.2, gain: 0.26, pan: 0.3 },
    ],
  },
  hall: {
    durationSec: 1.85,
    defaultWet: 0.28,
    defaultPreDelayMs: 18,
    rt60Low: 1.75,
    rt60High: 1.05,
    crossoverHz: 1500,
    density: 2400,
    tailGain: 0.48,
    tailFadeInSec: 0.045,
    seed: 0x22b3c4d5,
    early: [
      { ms: 11.5, gain: 0.78, pan: -0.75 },
      { ms: 16.2, gain: 0.72, pan: 0.7 },
      { ms: 22.8, gain: 0.62, pan: -0.4 },
      { ms: 29.4, gain: 0.55, pan: 0.55 },
      { ms: 37.6, gain: 0.44, pan: -0.85 },
      { ms: 46.1, gain: 0.38, pan: 0.85 },
      { ms: 58.3, gain: 0.29, pan: -0.25 },
      { ms: 71.0, gain: 0.22, pan: 0.35 },
    ],
  },
  stairwell: {
    durationSec: 1.45,
    defaultWet: 0.32,
    defaultPreDelayMs: 10,
    rt60Low: 1.15,
    rt60High: 1.38,
    crossoverHz: 1800,
    density: 1650,
    tailGain: 0.44,
    tailFadeInSec: 0.025,
    seed: 0x33c4d5e6,
    early: [
      { ms: 5.5, gain: 0.92, pan: -0.8 },
      { ms: 9.8, gain: 0.84, pan: 0.85 },
      { ms: 17.5, gain: 0.7, pan: -0.7 },
      { ms: 25.0, gain: 0.6, pan: 0.75 },
      { ms: 38.2, gain: 0.48, pan: -0.5 },
      { ms: 51.0, gain: 0.39, pan: 0.55 },
      { ms: 69.5, gain: 0.28, pan: -0.6 },
      { ms: 88.0, gain: 0.21, pan: 0.45 },
    ],
  },
  cave: {
    durationSec: 2.9,
    defaultWet: 0.42,
    defaultPreDelayMs: 24,
    rt60Low: 2.85,
    rt60High: 1.3,
    crossoverHz: 1100,
    density: 1400,
    tailGain: 0.56,
    tailFadeInSec: 0.06,
    seed: 0x44d5e6f7,
    early: [
      { ms: 14.0, gain: 0.8, pan: -0.6 },
      { ms: 24.5, gain: 0.74, pan: 0.65 },
      { ms: 39.0, gain: 0.66, pan: -0.85 },
      { ms: 58.2, gain: 0.54, pan: 0.8 },
      { ms: 83.4, gain: 0.45, pan: -0.45 },
      { ms: 112.0, gain: 0.36, pan: 0.5 },
      { ms: 148.5, gain: 0.27, pan: -0.75 },
      { ms: 192.0, gain: 0.2, pan: 0.35 },
    ],
  },
  outdoor: {
    durationSec: 0.75,
    defaultWet: 0.16,
    defaultPreDelayMs: 28,
    rt60Low: 0.36,
    rt60High: 0.22,
    crossoverHz: 1200,
    density: 450,
    tailGain: 0.18,
    tailFadeInSec: 0.035,
    seed: 0x55e6f708,
    early: [
      { ms: 22.0, gain: 0.85, pan: -0.85 },
      { ms: 38.5, gain: 0.68, pan: 0.8 },
      { ms: 64.0, gain: 0.52, pan: -0.55 },
      { ms: 96.0, gain: 0.38, pan: 0.65 },
      { ms: 145.0, gain: 0.25, pan: -0.4 },
      { ms: 210.0, gain: 0.16, pan: 0.45 },
    ],
  },
};

const CUSTOM_DEFAULT_WET = 0.25;
const CUSTOM_DEFAULT_PREDELAY_MS = 0;
export const IR_TARGET_RMS = 0.45;
const MAX_CUSTOM_GAIN = 4.0;

export function isPresetSpace(space: string): space is ReverbPreset {
  return (REVERB_SPACES as readonly string[]).includes(space);
}

export function defaultReverbParams(space: string): { wet: number; preDelayMs: number } {
  if (space === "dry") return { wet: 0, preDelayMs: 0 };
  if (isPresetSpace(space)) {
    const p = SPACE_PRESETS[space as Exclude<ReverbPreset, "dry">];
    return { wet: p.defaultWet, preDelayMs: p.defaultPreDelayMs };
  }
  return { wet: CUSTOM_DEFAULT_WET, preDelayMs: CUSTOM_DEFAULT_PREDELAY_MS };
}

export function resolveReverbSpec(spec: ReverbSpec | undefined | null): ResolvedReverb | null {
  if (!spec || !spec.space || spec.space === "dry") return null;
  const defaults = defaultReverbParams(spec.space);
  const wet = Math.max(0, Math.min(1, spec.wet ?? defaults.wet));
  if (wet <= 0) return null;
  const preDelayMs = Math.max(0, Math.min(500, spec.preDelayMs ?? defaults.preDelayMs));
  return { space: spec.space, wet, preDelayMs };
}

export function resolveClipReverb(
  clipReverb: ReverbSpec | undefined | null,
  clipTime: number,
  spaces: readonly ShotSpace[] | undefined,
  filmReverb: ReverbSpec | undefined | null,
): ResolvedReverb | null {
  if (clipReverb) return resolveReverbSpec(clipReverb);
  if (spaces && spaces.length > 0) {
    let matched: ShotSpace | null = null;
    for (const s of spaces) {
      if (clipTime >= s.from && (s.to === undefined || clipTime < s.to)) {
        matched = s;
      }
    }
    if (matched) return resolveReverbSpec(matched);
  }
  return resolveReverbSpec(filmReverb);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeStereoIr(left: Float32Array, right: Float32Array): void {
  let sumSq = 0;
  for (let i = 0; i < left.length; i++) {
    sumSq += left[i] * left[i] + right[i] * right[i];
  }
  const rms = Math.sqrt(sumSq * 0.5);
  if (rms <= 1e-12) return;
  const scale = Math.min(MAX_CUSTOM_GAIN, IR_TARGET_RMS / rms);
  for (let i = 0; i < left.length; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
}

function addTap(buf: Float32Array, pos: number, amp: number): void {
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  if (i0 >= 0 && i0 < buf.length) buf[i0] += amp * (1 - frac);
  const i1 = i0 + 1;
  if (i1 >= 0 && i1 < buf.length) buf[i1] += amp * frac;
}

export function generateImpulseResponse(
  space: string,
  sampleRate = 48000,
): { left: Float32Array; right: Float32Array; sampleRate: number } {
  if (!isPresetSpace(space) || space === "dry") {
    const left = new Float32Array(1);
    const right = new Float32Array(1);
    left[0] = 1;
    right[0] = 1;
    return { left, right, sampleRate };
  }

  const cfg = SPACE_PRESETS[space as Exclude<ReverbPreset, "dry">];
  const length = Math.max(1, Math.round(cfg.durationSec * sampleRate));
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (const tap of cfg.early) {
    const pos = (tap.ms / 1000) * sampleRate;
    const angle = ((Math.max(-1, Math.min(1, tap.pan)) + 1) * Math.PI) / 4;
    addTap(left, pos, tap.gain * Math.cos(angle));
    addTap(right, pos, tap.gain * Math.sin(angle));
  }

  const rng = mulberry32(cfg.seed);
  const step = sampleRate / cfg.density;
  const startSample = Math.max(1, Math.floor((cfg.early[0].ms / 1000) * sampleRate));
  const rawL = new Float64Array(length);
  const rawR = new Float64Array(length);

  const numCells = Math.floor((length - startSample) / step);
  for (let k = 0; k < numCells; k++) {
    const idxL = startSample + Math.floor((k + rng()) * step);
    const signL = rng() < 0.5 ? -1 : 1;
    if (idxL >= 0 && idxL < length) rawL[idxL] += signL;

    const idxR = startSample + Math.floor((k + rng()) * step);
    const signR = rng() < 0.5 ? -1 : 1;
    if (idxR >= 0 && idxR < length) rawR[idxR] += signR;
  }

  const alpha = Math.exp((-2 * Math.PI * cfg.crossoverHz) / sampleRate);
  const kLow = -6.907755278982137 / (cfg.rt60Low * sampleRate);
  const kHigh = -6.907755278982137 / (cfg.rt60High * sampleRate);
  const fadeInSamples = Math.max(1, cfg.tailFadeInSec * sampleRate);
  const fadeOutSamples = Math.min(length, Math.max(1, Math.round(0.02 * sampleRate)));
  const fadeOutStart = length - fadeOutSamples;

  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < length; i++) {
    const xL = rawL[i];
    const xR = rawR[i];
    lpL = (1 - alpha) * xL + alpha * lpL;
    lpR = (1 - alpha) * xR + alpha * lpR;
    const hpL = xL - lpL;
    const hpR = xR - lpR;

    const tRel = Math.max(0, i - startSample);
    const fadeIn = tRel >= fadeInSamples ? 1 : tRel / fadeInSamples;
    const envLow = Math.exp(kLow * tRel);
    const envHigh = Math.exp(kHigh * tRel);

    left[i] += cfg.tailGain * fadeIn * (lpL * envLow + hpL * envHigh);
    right[i] += cfg.tailGain * fadeIn * (lpR * envLow + hpR * envHigh);

    if (i >= fadeOutStart) {
      const rem = (length - 1 - i) / Math.max(1, fadeOutSamples - 1);
      const w = 0.5 * (1 - Math.cos(Math.PI * rem));
      left[i] *= w;
      right[i] *= w;
    }
  }

  normalizeStereoIr(left, right);
  return { left, right, sampleRate };
}
