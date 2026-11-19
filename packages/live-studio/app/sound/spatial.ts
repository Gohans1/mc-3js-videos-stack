export type Vec3 = [number, number, number];

export interface SpatialSpec {
  at?: Vec3;
  target?: string;
  offset?: Vec3;
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  occlusion?: number;
  airAbsorption?: boolean;
}

export interface CameraPose {
  p: Vec3;
  l: Vec3;
  up?: Vec3;
  roll?: number;
}

export interface SpatialParams {
  pan: number;
  gain: number;
  cutoffHz: number;
  distance: number;
  frontDot: number;
}

export const SPATIAL_DEFAULTS = {
  refDistance: 2.0,
  maxDistance: 40.0,
  rolloff: 1.0,
  occlusion: 0.0,
  airAbsorption: true,
} as const;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

const norm = (a: Vec3, fallback: Vec3): Vec3 => {
  const m = len(a);
  return m > 1e-9 ? [a[0] / m, a[1] / m, a[2] / m] : fallback;
};

export function isSpatialActive(spec: SpatialSpec | undefined | null): spec is SpatialSpec {
  return Boolean(
    spec && (spec.at !== undefined || (spec.target !== undefined && spec.target !== "")),
  );
}

export function offsetPosition(base: Vec3, offset?: Vec3): Vec3 {
  return offset ? [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]] : base;
}

export function computeSpatialParams(
  cam: CameraPose,
  source: Vec3,
  spec: SpatialSpec,
): SpatialParams {
  const refDistance = Math.max(0.01, spec.refDistance ?? SPATIAL_DEFAULTS.refDistance);
  const maxDistance = Math.max(refDistance, spec.maxDistance ?? SPATIAL_DEFAULTS.maxDistance);
  const rolloff = Math.max(0, spec.rolloff ?? SPATIAL_DEFAULTS.rolloff);
  const occlusion = clamp(spec.occlusion ?? SPATIAL_DEFAULTS.occlusion, 0, 1);
  const airAbsorption = spec.airAbsorption ?? SPATIAL_DEFAULTS.airAbsorption;

  const fwd = norm(sub(cam.l, cam.p), [0, 0, -1]);
  const worldUp = cam.up ? norm(cam.up, [0, 1, 0]) : ([0, 1, 0] as Vec3);
  const rawRight = cross(fwd, worldUp);
  const rightBase =
    len(rawRight) > 1e-6
      ? norm(rawRight, [1, 0, 0])
      : Math.abs(fwd[1]) > 0.9
        ? ([1, 0, 0] as Vec3)
        : norm(cross(fwd, [0, 1, 0]), [1, 0, 0]);
  const camUp = norm(cross(rightBase, fwd), [0, 1, 0]);

  const rollRad = ((cam.roll ?? 0) * Math.PI) / 180;
  const effRight =
    rollRad !== 0
      ? norm(add(scale(rightBase, Math.cos(rollRad)), scale(camUp, Math.sin(rollRad))), rightBase)
      : rightBase;

  const rel = sub(source, cam.p);
  const distance = len(rel);
  const occGain = 1 - 0.55 * occlusion;
  const occCutoff = 20000 * Math.pow(380 / 20000, occlusion);

  if (distance < 1e-6) {
    return {
      pan: 0,
      gain: clamp(occGain, 0, 1),
      cutoffHz: clamp(occCutoff, 250, 20000),
      distance: 0,
      frontDot: 1,
    };
  }

  const dir: Vec3 = [rel[0] / distance, rel[1] / distance, rel[2] / distance];
  const pan = clamp(dot(dir, effRight), -1, 1);
  const frontDot = clamp(dot(dir, fwd), -1, 1);

  const clampedDist = clamp(distance, refDistance, maxDistance);
  const denom = refDistance + rolloff * (clampedDist - refDistance);
  const distGain = denom > 0 ? refDistance / denom : 1;
  const gain = clamp(distGain * occGain, 0, 1);

  let airCutoff = 20000;
  let behindCutoff = 20000;
  if (airAbsorption) {
    const excessDist = Math.max(0, distance - refDistance);
    airCutoff = Math.max(1200, 20000 * Math.exp(-0.045 * excessDist));
    if (frontDot < 0) {
      behindCutoff = 20000 * Math.pow(5500 / 20000, -frontDot);
    }
  }

  const cutoffHz = clamp(Math.min(airCutoff, behindCutoff, occCutoff), 250, 20000);
  return { pan, gain, cutoffHz, distance, frontDot };
}
