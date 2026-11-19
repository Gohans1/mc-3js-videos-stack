import type { TimingClock } from "./timing.mjs";

export function cameraSpeed(
  clock: TimingClock | null,
  from: number,
  to: number,
  ease: (u: number) => number,
  t: number,
): number;
export function sampleCameraSpanSpeed(
  clock: TimingClock | null,
  a: number,
  v: number,
  w: number,
  x0: number,
  x1: number,
  from: number,
  to: number,
  ease: (u: number) => number,
): number[];

export interface CamTimelineKey {
  t: number;
  p?: [number, number, number];
  l?: [number, number, number];
  fov?: number;
  mm?: number;
  cut?: boolean;
  ease?: string;
}

export interface KeySpanAttribution {
  span: [number, number];
  keyRow: number;
  t0: number;
  t1: number;
}

export interface CameraTimelineReport {
  status: "pass" | "warn" | "fail";
  keyCount: number;
  sampleCount: number;
  range: { from: number; to: number };
  posPeak: { v: number; t: number; span: [number, number]; keyRow: number };
  turnPeak: { v: number; t: number; widthSeconds: number; span: [number, number]; keyRow: number };
  fovPeak: { v: number; t: number; span: [number, number]; keyRow: number };
  widthSeconds: number;
  fov: { from: number; to: number; min: number; max: number };
  fastPans: Array<{
    t: number;
    speed: number;
    widthSeconds: number;
    span: [number, number];
    keyRow: number;
  }>;
  fastFovs: Array<{
    t: number;
    rate: number;
    fromFov: number;
    toFov: number;
    span: [number, number];
    keyRow: number;
  }>;
  pops: Array<{
    kind: "pos" | "turn" | "fov";
    t: number;
    step: number;
    around: number;
    span: [number, number];
    keyRow: number;
  }>;
  faults: string[];
}

export interface KeyFileMotionReport {
  file: string;
  tracks: Array<{
    path: string;
    keyCount: number;
    peakPos: { v: number; t: number; rowFrom: number; rowTo: number };
    peakRot: { v: number; t: number; rowFrom: number; rowTo: number };
  }>;
}

export function viewVectorAngleDeg(
  p1: readonly [number, number, number] | undefined,
  l1: readonly [number, number, number] | undefined,
  p2: readonly [number, number, number] | undefined,
  l2: readonly [number, number, number] | undefined,
): number;

export function resolveKeyFov(
  keys: readonly CamTimelineKey[],
  idx: number,
  aspect?: number,
  defaultFov?: number,
): number;

export function attributeCamKeySpan(
  keys: readonly CamTimelineKey[],
  t: number,
  timing?: Pick<TimingClock, "sourceAt"> | null,
): KeySpanAttribution | null;

export function analyzeCameraTimeline(
  keys: readonly CamTimelineKey[],
  opts?: {
    from?: number;
    to?: number;
    aspect?: number;
    defaultFov?: number;
    sampleRate?: number;
    cuts?: readonly number[];
    evaluator?: (
      t: number,
      aspect: number,
      segmentKeys?: readonly CamTimelineKey[],
    ) => {
      p: [number, number, number];
      l: [number, number, number];
      fov?: number;
    };
  },
): CameraTimelineReport;

export function analyzeKeyFileMotion(
  data: unknown,
  filePath?: string,
  opts?: { from?: number; to?: number },
): KeyFileMotionReport;
