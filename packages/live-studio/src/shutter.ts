export const SHUTTER_TIMINGS = ["open", "center", "close"] as const;
export type ShutterTiming = (typeof SHUTTER_TIMINGS)[number];
export interface Shutter {
  angle?: number;
  timing?: ShutterTiming;
  phase?: number;
  samples?: number;
  apertureSamples?: number;
}
export interface ApertureSample {
  x: number;
  y: number;
}
const LEFT = { open: 0, center: 0.5, close: 1 } as const;
const EPS = 1e-7;

export function shutterTimes(
  t: number,
  fps: number,
  samples: number,
  from: number,
  to: number,
  shutter?: Shutter,
) {
  const span = Math.min(360, Math.max(0, shutter?.angle ?? 180)) / 360 / fps;
  if (samples <= 1 || span <= 0) return [t];
  const phase = Math.min(1, Math.max(-1, shutter?.phase ?? 0)) / fps;
  const start = t - span * LEFT[shutter?.timing ?? "open"] + phase;
  const end = start + span;
  const a = Math.max(from, start);
  const b = Math.min(to - EPS, end);
  if (!(b > a)) return [t];
  return Array.from({ length: samples }, (_, i) => a + ((b - a) * (i + 0.5)) / samples);
}

type PictureSpan = {
  from: number;
  sourceFrom: number;
  sourceTo: number;
  frame?: number;
  blank?: boolean;
};
export function shutterBounds(
  t: number,
  start: number,
  end: number,
  spans: readonly PictureSpan[],
  cuts: readonly number[] = [],
) {
  // the camera keys' cuts inside the shot (heard seconds) bound it as its start and end do
  let from = Math.max(start, ...cuts.filter((c) => c <= t)),
    to = Math.min(end, ...cuts.filter((c) => c > t));
  for (let i = 1; i < spans.length; i++) {
    const before = spans[i - 1],
      after = spans[i];
    if (
      !!before.blank === !!after.blank &&
      Math.abs((before.frame ?? before.sourceTo) - (after.frame ?? after.sourceFrom)) < 1e-5
    )
      continue;
    if (after.from <= t) from = Math.max(from, after.from);
    else to = Math.min(to, after.from);
  }
  return [from, to] as const;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const apertureSamples = (count: number, time = 0): (ApertureSample | undefined)[] => {
  if (count <= 1) return [undefined];
  const pairs = Math.floor(count / 2);
  const turn = time * GOLDEN_ANGLE;
  const result: ApertureSample[] = count % 2 === 0 ? [] : [{ x: 0, y: 0 }];
  for (let i = 0; i < pairs; i++) {
    const radius = Math.sqrt((i + 0.5) / pairs);
    const angle = i * GOLDEN_ANGLE + turn;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    result.push({ x, y }, { x: -x, y: -y });
  }
  return result;
};

// A whip turns the camera so far between two shutter samples that each prints as its own copy of the picture: such a
// frame takes samples until one sample's turn moves the picture GAP_PX at most (food-eat-more's 20°-a-frame whips ghosted
// at 8 and smeared clean at 32). `before` and `after` are the camera's facing at its first two samples.
const GAP_PX = 12;
export const MAX_SHUTTER_SAMPLES = 64;
export const shutterSamples = (base: number, shutter?: Shutter) => {
  if (base <= 1) return base;
  const raw = shutter?.samples;
  const target = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : base;
  return Math.min(MAX_SHUTTER_SAMPLES, Math.max(base, target));
};
export const samplesForTurn = (
  samples: number,
  before: readonly number[],
  after: readonly number[],
  fovDeg: number,
  height: number,
) => {
  const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
  const turn = Math.acos(
    Math.min(1, Math.max(-1, dot / (Math.hypot(...before) * Math.hypot(...after)))),
  );
  const px = (turn / ((fovDeg * Math.PI) / 180)) * height;
  if (!(px > GAP_PX)) return samples;
  return Math.min(MAX_SHUTTER_SAMPLES, Math.ceil((samples * px) / GAP_PX));
};
