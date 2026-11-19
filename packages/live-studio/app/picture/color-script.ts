import type { TimingClockLike } from "./director-eye";

export interface SwatchColor {
  r: number;
  g: number;
  b: number;
  hex: string;
  weight: number;
  luma: number;
}

export interface FrameColorSummary {
  swatches: SwatchColor[];
  avgLuma: number;
  contrast: number;
  avgHex: string;
}

export interface ColorScriptShot {
  index: number;
  name: string;
  start: number;
  end: number;
  duration: number;
  sampleAt: number;
  widthPct: number;
}

export type PacingFlag = "long-hold" | "flash-cut" | "uniform";

export interface PacingSummary {
  totalDuration: number;
  meanDuration: number;
  medianDuration: number;
  uniformityCV: number;
  isSequenceUniform: boolean;
  byShot: PacingFlag[][];
}

export const rec709Luma = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${clampByte(r).toString(16).padStart(2, "0")}${clampByte(g).toString(16).padStart(2, "0")}${clampByte(b).toString(16).padStart(2, "0")}`;

interface RgbBucket {
  pixels: [number, number, number][];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
  score: number;
  splitChannel: 0 | 1 | 2;
}

function measureBucket(pixels: [number, number, number][]): RgbBucket {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = pixels[i]!;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;
  const maxRange = Math.max(rRange, gRange, bRange);
  const splitChannel: 0 | 1 | 2 = maxRange === rRange ? 0 : maxRange === gRange ? 1 : 2;
  return {
    pixels,
    rMin,
    rMax,
    gMin,
    gMax,
    bMin,
    bMax,
    score: maxRange * Math.sqrt(pixels.length),
    splitChannel,
  };
}

interface Centroid {
  rSum: number;
  gSum: number;
  bSum: number;
  count: number;
}

const centroidRgb = (c: Centroid): [number, number, number] => [
  c.rSum / c.count,
  c.gSum / c.count,
  c.bSum / c.count,
];

function rgbDistSq(a: Centroid, b: Centroid): number {
  const [ar, ag, ab] = centroidRgb(a);
  const [br, bg, bb] = centroidRgb(b);
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return dr * dr + dg * dg + db * db;
}

/**
 * Deterministic pure-TS median-cut palette quantization + Rec.709 luminance summary.
 * Over-splits slightly then merges perceptually close buckets so small bright accents stay represented.
 */
export function extractColorScriptPalette(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  maxColors = 4,
): FrameColorSummary {
  const totalPixels = Math.floor(Math.min(width * height, rgba.length / 4));
  if (totalPixels <= 0 || width <= 0 || height <= 0 || maxColors <= 0) {
    return { swatches: [], avgLuma: 0, contrast: 0, avgHex: "#000000" };
  }

  const step = Math.max(1, Math.floor(totalPixels / 4096));
  const sampled: [number, number, number][] = [];
  let rTot = 0;
  let gTot = 0;
  let bTot = 0;
  let lumaSum = 0;
  let lumaSqSum = 0;

  for (let p = 0; p < totalPixels; p += step) {
    const o = p * 4;
    if (rgba[o + 3]! < 16) continue;
    const r = rgba[o]!;
    const g = rgba[o + 1]!;
    const b = rgba[o + 2]!;
    sampled.push([r, g, b]);
    rTot += r;
    gTot += g;
    bTot += b;
    const l = rec709Luma(r, g, b);
    lumaSum += l;
    lumaSqSum += l * l;
  }

  if (sampled.length === 0) {
    for (let p = 0; p < totalPixels; p += step) {
      const o = p * 4;
      const r = rgba[o]!;
      const g = rgba[o + 1]!;
      const b = rgba[o + 2]!;
      sampled.push([r, g, b]);
      rTot += r;
      gTot += g;
      bTot += b;
      const l = rec709Luma(r, g, b);
      lumaSum += l;
      lumaSqSum += l * l;
    }
  }

  const n = sampled.length;
  const avgLuma = lumaSum / n;
  const variance = Math.max(0, lumaSqSum / n - avgLuma * avgLuma);
  const contrast = Math.sqrt(variance);
  const avgHex = rgbToHex(rTot / n, gTot / n, bTot / n);

  const targetSplits = Math.max(maxColors * 3, 8);
  const boxes: RgbBucket[] = [measureBucket(sampled)];
  while (boxes.length < targetSplits) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.pixels.length >= 2 && box.score > bestScore) {
        bestScore = box.score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestScore <= 0) break;
    const picked = boxes.splice(bestIdx, 1)[0]!;
    const ch = picked.splitChannel;
    picked.pixels.sort((a, b) => a[ch] - b[ch] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const mid = Math.floor(picked.pixels.length / 2);
    if (mid <= 0 || mid >= picked.pixels.length) {
      boxes.push(picked);
      break;
    }
    boxes.push(measureBucket(picked.pixels.slice(0, mid)));
    boxes.push(measureBucket(picked.pixels.slice(mid)));
  }

  const centroids: Centroid[] = boxes.map((box) => {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (const [r, g, b] of box.pixels) {
      rSum += r;
      gSum += g;
      bSum += b;
    }
    return { rSum, gSum, bSum, count: box.pixels.length };
  });

  // Merge perceptually near-identical buckets (< 26 RGB distance), then cap down to maxColors
  const mergeSqThreshold = 26 * 26;
  while (centroids.length > 1) {
    let minD = Infinity;
    let bestI = 0;
    let bestJ = 1;
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) {
        const d = rgbDistSq(centroids[i]!, centroids[j]!);
        if (d < minD) {
          minD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (minD > mergeSqThreshold && centroids.length <= maxColors) break;
    const a = centroids[bestI]!;
    const b = centroids[bestJ]!;
    centroids[bestI] = {
      rSum: a.rSum + b.rSum,
      gSum: a.gSum + b.gSum,
      bSum: a.bSum + b.bSum,
      count: a.count + b.count,
    };
    centroids.splice(bestJ, 1);
  }

  const swatches: SwatchColor[] = centroids
    .map((c) => {
      const r = clampByte(c.rSum / c.count);
      const g = clampByte(c.gSum / c.count);
      const b = clampByte(c.bSum / c.count);
      return {
        r,
        g,
        b,
        hex: rgbToHex(r, g, b),
        weight: c.count / n,
        luma: rec709Luma(r, g, b),
      };
    })
    .sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex));

  return { swatches, avgLuma, contrast, avgHex };
}

function snapSampleAt(start: number, end: number, target: number, fps: number): number {
  const step = 1 / Math.max(1, fps);
  const snapped = Math.round(target * fps) / fps;
  const maxSample = Math.max(start, end - step);
  return Math.max(start, Math.min(maxSample, snapped));
}

function resolveVisibleSampleAt(
  start: number,
  end: number,
  midSample: number,
  fps: number,
  timingClock?: TimingClockLike | null,
): number {
  if (!timingClock?.segments.length) return midSample;
  const hit = timingClock.segments.find((s) => s.from <= midSample && midSample < s.to);
  if (hit && !hit.blank) return midSample;
  const desired = start + (end - start) * 0.5;
  let bestMid = midSample;
  let bestScore = -Infinity;
  for (const seg of timingClock.segments) {
    if (seg.blank) continue;
    const ovStart = Math.max(start, seg.from);
    const ovEnd = Math.min(end, seg.to);
    const overlap = ovEnd - ovStart;
    if (overlap <= 1e-6) continue;
    const ovMid = ovStart + overlap * 0.5;
    // Prefer wide visible spans near the shot midpoint
    const score = overlap - Math.abs(ovMid - desired) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestMid = snapSampleAt(ovStart, ovEnd, ovMid, fps);
    }
  }
  return bestMid;
}

export function buildColorScriptShots(
  shots: readonly { t: number; name?: string }[],
  duration: number,
  comments: readonly string[] = [],
  fps = 30,
  timingClock?: TimingClockLike | null,
): ColorScriptShot[] {
  const total = Math.max(duration, 1 / Math.max(1, fps));
  const out: ColorScriptShot[] = [];
  for (let index = 0; index < shots.length; index++) {
    const s = shots[index]!;
    const start = Math.max(0, s.t);
    const nextStart = shots[index + 1]?.t;
    const end = Math.max(start, nextStart !== undefined ? nextStart : duration);
    const shotDur = Math.max(0, end - start);
    if (shotDur <= 1e-6) continue;
    const mid = start + shotDur * 0.5;
    const midSample = snapSampleAt(start, end, mid, fps);
    const sampleAt = resolveVisibleSampleAt(start, end, midSample, fps, timingClock);
    const name = comments[index]?.trim() || s.name?.trim() || `Shot ${index}`;
    out.push({
      index,
      name,
      start,
      end,
      duration: shotDur,
      sampleAt,
      widthPct: (shotDur / total) * 100,
    });
  }
  return out;
}

export function analyzeShotPacing(shots: readonly ColorScriptShot[]): PacingSummary {
  const maxIndex = shots.reduce((m, s) => Math.max(m, s.index), -1);
  const byShot: PacingFlag[][] = Array.from({ length: maxIndex + 1 }, () => []);
  const positive = shots.filter((s) => s.duration > 1e-4).map((s) => s.duration);
  if (!positive.length) {
    return {
      totalDuration: 0,
      meanDuration: 0,
      medianDuration: 0,
      uniformityCV: 0,
      isSequenceUniform: false,
      byShot,
    };
  }

  const totalDuration = positive.reduce((a, b) => a + b, 0);
  const meanDuration = totalDuration / positive.length;
  const sorted = [...positive].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianDuration =
    sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

  const variance = positive.reduce((sum, d) => sum + (d - meanDuration) ** 2, 0) / positive.length;
  const stdDev = Math.sqrt(variance);
  const uniformityCV = meanDuration > 0 ? stdDev / meanDuration : 0;
  const isSequenceUniform = positive.length >= 4 && uniformityCV < 0.12;

  for (const shot of shots) {
    const d = shot.duration;
    if (d <= 0) continue;
    const bucket = byShot[shot.index]!;
    if (d >= 12 || (d >= 8 && (positive.length < 3 || d >= medianDuration * 2.2))) {
      bucket.push("long-hold");
    } else if (positive.length >= 2 && d < 0.5 && medianDuration >= 1.0) {
      bucket.push("flash-cut");
    }
    if (isSequenceUniform) {
      bucket.push("uniform");
    }
  }

  // Flag local monotonous runs (>= 4 consecutive shots within +/-15% of local mean) even if sequence isn't uniform overall
  if (!isSequenceUniform && shots.length >= 4) {
    let runStart = 0;
    while (runStart <= shots.length - 4) {
      const windowSlice = shots.slice(runStart, runStart + 4).map((s) => s.duration);
      const localMean = windowSlice.reduce((a, b) => a + b, 0) / 4;
      if (localMean > 0 && windowSlice.every((d) => Math.abs(d - localMean) / localMean <= 0.15)) {
        let runEnd = runStart + 4;
        while (
          runEnd < shots.length &&
          Math.abs(shots[runEnd]!.duration - localMean) / localMean <= 0.15
        ) {
          runEnd++;
        }
        for (let k = runStart; k < runEnd; k++) {
          const bucket = byShot[shots[k]!.index]!;
          if (!bucket.includes("uniform")) bucket.push("uniform");
        }
        runStart = runEnd;
      } else {
        runStart++;
      }
    }
  }

  return {
    totalDuration,
    meanDuration,
    medianDuration,
    uniformityCV,
    isSequenceUniform,
    byShot,
  };
}
