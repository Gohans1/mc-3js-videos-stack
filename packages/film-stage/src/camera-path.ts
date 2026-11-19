import { arcInto } from "film-kit/arc";
import { CatmullRomCurve3, CubicBezierCurve3, Curve, LineCurve3, Vector3 } from "three";

import { easeOf } from "./camera-meta";
import { canMatchCameraSpeed, matchedSpanEase, paceSample, spatialJoinSlopes } from "./camera-pace";

export type CameraAnchor = Record<string, unknown>;
export type CameraPoint = readonly [number, number, number] | CameraAnchor;
export type ResolveCameraAnchor = (anchor: CameraAnchor) => Vector3 | null | undefined;
export const CAMERA_MOTIONS = ["smooth", "linear", "hold", "orbit"] as const;
export type CameraMotion = (typeof CAMERA_MOTIONS)[number];

interface PathKey {
  t: number;
  p: CameraPoint;
  l: CameraPoint;
  motion?: CameraMotion;
  reversePath?: boolean;
  matchSpeed?: boolean;
  railU?: number;
  inHandle?: readonly [number, number, number];
  outHandle?: readonly [number, number, number];
  ease?: unknown;
  easeChannels?: { position?: unknown; aim?: unknown };
}

const isPoint = (point: unknown): point is readonly [number, number, number] =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

export const resolveCameraPoint = (point: CameraPoint, resolve?: ResolveCameraAnchor) => {
  if (isPoint(point)) return new Vector3(...point);
  const anchor = point as CameraAnchor;
  const resolved = resolve?.(anchor);
  if (resolved) return resolved.clone();
  const fallback = [anchor.fallback, anchor.eye, anchor.offset].find(isPoint);
  return fallback ? new Vector3(...fallback) : new Vector3();
};

const controlOffset = (direction: Vector3, chord: Vector3) =>
  direction.dot(chord) > 0 ? direction.setLength(chord.length() / 3) : direction.set(0, 0, 0);

type HandleKey = { t: number; motion?: CameraMotion; matchSpeed?: boolean };

export const defaultCameraHandles = (points: Vector3[], i: number, keys?: readonly HandleKey[]) => {
  const a = points[i],
    b = points[i + 1];
  const before = points[i - 1],
    after = points[i + 2];
  const chord = b.clone().sub(a);
  const alignIn =
    !!keys?.[i]?.matchSpeed && canMatchCameraSpeed(keys, i) && keys[i].motion === "linear";
  const alignOut =
    !!keys?.[i + 1]?.matchSpeed &&
    canMatchCameraSpeed(keys, i + 1) &&
    keys[i + 2]?.motion === "linear";
  const from = before?.equals(a)
    ? new Vector3()
    : alignIn && before
      ? a.clone().sub(before)
      : b.clone().sub(before ?? a);
  const to = after?.equals(b)
    ? new Vector3()
    : alignOut && after
      ? after.clone().sub(b)
      : (after ?? b).clone().sub(a);
  return { out: controlOffset(from, chord), in: controlOffset(to, chord).negate() };
};

const GL_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
const GL_W = [
  0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647,
  0.23692688505618908,
];

// Three.js Curve.getUtoTmapping linearly interpolates uniform-t LUT bins, causing large speed errors near zero/short handles.
class SmoothBezierCurve extends CubicBezierCurve3 {
  private exactLengths: number[] | null = null;
  private exactDivisions = 0;

  private bezierSpeed(t: number) {
    const u = 1 - t;
    const a = 3 * u * u,
      b = 6 * u * t,
      c = 3 * t * t;
    const dx =
      a * (this.v1.x - this.v0.x) + b * (this.v2.x - this.v1.x) + c * (this.v3.x - this.v2.x);
    const dy =
      a * (this.v1.y - this.v0.y) + b * (this.v2.y - this.v1.y) + c * (this.v3.y - this.v2.y);
    const dz =
      a * (this.v1.z - this.v0.z) + b * (this.v2.z - this.v1.z) + c * (this.v3.z - this.v2.z);
    return Math.hypot(dx, dy, dz);
  }

  private segmentArcLength(t0: number, t1: number) {
    const half = (t1 - t0) * 0.5,
      mid = (t0 + t1) * 0.5;
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += GL_W[i] * this.bezierSpeed(mid + half * GL_X[i]);
    return sum * half;
  }

  override updateArcLengths() {
    this.exactLengths = null;
    super.updateArcLengths();
  }

  override getLengths(divisions = this.arcLengthDivisions) {
    if (this.exactLengths && this.exactDivisions === divisions) return this.exactLengths;
    const lengths = [0];
    let sum = 0;
    for (let k = 0; k < divisions; k++) {
      sum += this.segmentArcLength(k / divisions, (k + 1) / divisions);
      lengths.push(sum);
    }
    this.exactLengths = lengths;
    this.exactDivisions = divisions;
    return lengths;
  }

  override getUtoTmapping(u: number, distance?: number) {
    const lengths = this.getLengths();
    const n = lengths.length - 1;
    const total = lengths[n];
    const target = distance ? distance : u * total;
    if (target <= 0 || total <= 0) return 0;
    if (target >= total) return 1;
    let lo = 0,
      hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lengths[mid] <= target) lo = mid;
      else hi = mid - 1;
    }
    const baseT = lo / n;
    const ds = lengths[lo + 1] - lengths[lo];
    if (ds <= 0) return baseT;
    let tLo = baseT,
      tHi = (lo + 1) / n;
    let t = tLo + ((target - lengths[lo]) / ds) * (tHi - tLo);
    const tol = 1e-11 * total;
    for (let iter = 0; iter < 8; iter++) {
      const err = lengths[lo] + this.segmentArcLength(baseT, t) - target;
      if (Math.abs(err) <= tol) break;
      if (err < 0) tLo = t;
      else tHi = t;
      const spd = this.bezierSpeed(t);
      const next = spd > 1e-12 ? t - err / spd : (tLo + tHi) * 0.5;
      t = next > tLo && next < tHi ? next : (tLo + tHi) * 0.5;
    }
    return t;
  }
}

const smoothCurve = (
  points: Vector3[],
  i: number,
  from?: PathKey["outHandle"],
  to?: PathKey["inHandle"],
  keys?: readonly HandleKey[],
) => {
  const a = points[i],
    b = points[i + 1];
  const offsets = defaultCameraHandles(points, i, keys);
  return new SmoothBezierCurve(
    a,
    a.clone().add(from ? new Vector3(...from) : offsets.out),
    b.clone().add(to ? new Vector3(...to) : offsets.in),
    b,
  );
};

class OrbitCurve extends Curve<Vector3> {
  private readonly relativeStart: number[];
  private readonly relativeEnd: number[];
  private readonly result = [0, 0, 0];
  private readonly offset = new Vector3();
  private readonly bend: { bend: number[] };

  constructor(
    start: Vector3,
    end: Vector3,
    private readonly from: Vector3,
    private readonly to: Vector3,
    private readonly reversed = false,
  ) {
    super();
    const relative = start.clone().sub(from);
    const sideways = new Vector3(relative.z, 0, -relative.x);
    this.bend = { bend: sideways.lengthSq() > 1e-12 ? sideways.normalize().toArray() : [1, 0, 0] };
    this.relativeStart = relative.toArray();
    this.relativeEnd = end.clone().sub(to).toArray();
  }

  getPoint(t: number, target = new Vector3()) {
    if (this.reversed) t = 1 - t;
    return target
      .lerpVectors(this.from, this.to, t)
      .add(
        this.offset.fromArray(
          arcInto(this.result, [0, 0, 0], this.relativeStart, this.relativeEnd, t, this.bend),
        ),
      );
  }
}

const SAMPLES_PER_SPAN = 48;
const traveled = (ease: (u: number) => number) => {
  const lengths = new Float64Array(SAMPLES_PER_SPAN + 1);
  let previous = 0;
  for (let i = 1; i <= SAMPLES_PER_SPAN; i++) {
    const progress = i === SAMPLES_PER_SPAN ? 1 : ease(i / SAMPLES_PER_SPAN);
    lengths[i] = lengths[i - 1] + Math.abs(progress - previous);
    previous = progress;
  }
  return lengths;
};
const pointAtProgress = (curve: Curve<Vector3>, progress: number, length: number) => {
  if (!length) return curve.getPoint(0);
  if (progress >= 0 && progress <= 1) return curve.getPointAt(progress);
  const end = progress < 0 ? 0 : 1;
  return curve.getPoint(end).addScaledVector(curve.getTangent(end), (progress - end) * length);
};

class RailSpan extends Curve<Vector3> {
  constructor(
    private readonly rail: CatmullRomCurve3,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }
  getPoint(t: number, target = new Vector3()) {
    return this.rail.getPointAt(
      Math.max(0, Math.min(1, this.from + (this.to - this.from) * t)),
      target,
    );
  }
  getLength() {
    return this.rail.getLength() * Math.abs(this.to - this.from);
  }
}

const rails = new WeakMap<readonly (readonly [number, number, number])[], CatmullRomCurve3>();
export const makeCameraRail = (points: readonly (readonly [number, number, number])[]) => {
  const existing = rails.get(points);
  if (existing) return existing;
  const rail = new CatmullRomCurve3(points.map((point) => new Vector3(...point)));
  rail.arcLengthDivisions = Math.max(SAMPLES_PER_SPAN, (points.length - 1) * SAMPLES_PER_SPAN);
  rails.set(points, rail);
  return rail;
};

export const cameraRailU = (key: Pick<PathKey, "railU">, index: number, count: number) =>
  Math.max(0, Math.min(1, key.railU ?? index / Math.max(1, count - 1)));

export const compileCameraPath = (
  keys: PathKey[],
  resolve?: ResolveCameraAnchor,
  points?: readonly (readonly [number, number, number])[],
) => {
  const rail = points && points.length > 1 ? makeCameraRail(points) : null;
  const u = rail ? keys.map((key, i) => cameraRailU(key, i, keys.length)) : [];
  const positions = keys.map((key, i) =>
    rail ? rail.getPointAt(u[i]) : resolveCameraPoint(key.p, resolve),
  );
  const targets = keys.map((key) => resolveCameraPoint(key.l, resolve));
  const spans = keys.slice(1).map((key, i) => {
    const mode = key.motion ?? "smooth";
    const a = positions[i],
      b = positions[i + 1];
    const from = targets[i],
      to = targets[i + 1];
    const position = rail
      ? new RailSpan(rail, u[i], u[i + 1])
      : mode === "orbit"
        ? key.reversePath
          ? new OrbitCurve(b, a, to, from, true)
          : new OrbitCurve(a, b, from, to)
        : mode === "smooth" && (!a.equals(b) || keys[i].outHandle || key.inHandle)
          ? smoothCurve(positions, i, keys[i].outHandle, key.inHandle, keys)
          : new LineCurve3(a, b);
    const look =
      mode === "smooth" && !from.equals(to)
        ? smoothCurve(targets, i, undefined, undefined, keys)
        : new LineCurve3(from, to);
    position.arcLengthDivisions = position instanceof CubicBezierCurve3 ? 128 : SAMPLES_PER_SPAN;
    look.arcLengthDivisions = look instanceof CubicBezierCurve3 ? 128 : SAMPLES_PER_SPAN;
    const length = mode === "hold" ? 0 : position.getLength();
    return {
      length,
      position,
      look,
      hold: mode === "hold",
      ease: {
        position: easeOf(key.easeChannels?.position ?? key.ease),
        aim: easeOf(key.easeChannels?.aim ?? key.ease),
      },
    };
  });
  const pose = (i: number, u: number) => {
    if (i < 0 || u === 1) {
      const end = i < 0 ? keys.length - 1 : i + 1;
      return { p: positions[end].clone(), l: targets[end].clone() };
    }
    if (u === 0 || spans[i].hold) return { p: positions[i].clone(), l: targets[i].clone() };
    const span = spans[i];
    if (span.position instanceof OrbitCurve) {
      const t = span.length && u >= 0 && u <= 1 ? span.position.getUtoTmapping(u, 0) : u;
      return { p: span.position.getPoint(t), l: span.look.getPoint(t) };
    }
    return {
      p:
        span.position instanceof RailSpan
          ? span.position.getPoint(u)
          : pointAtProgress(span.position, u, span.length),
      l: pointAtProgress(span.look, u, span.look.getLength()),
    };
  };
  const joined = keys.map((key, i) => key.matchSpeed === true && canMatchCameraSpeed(keys, i));
  if (joined.some(Boolean)) {
    const startSlopes = {
      position: [] as (number | undefined)[],
      aim: [] as (number | undefined)[],
    };
    const endSlopes = {
      position: [] as (number | undefined)[],
      aim: [] as (number | undefined)[],
    };
    joined.forEach((match, i) => {
      if (!match) return;
      const time = keys[i].t;
      const leftTime = time - keys[i - 1].t;
      const rightTime = keys[i + 1].t - time;
      const previous = pose(i - 1, 1 - paceSample);
      const at = pose(i, 0);
      const next = pose(i, paceSample);
      const leftLengths = {
        position: spans[i - 1].length,
        aim: spans[i - 1].hold ? 0 : spans[i - 1].look.getLength(),
      };
      const rightLengths = {
        position: spans[i].length,
        aim: spans[i].hold ? 0 : spans[i].look.getLength(),
      };
      for (const [channel, field] of [
        ["position", "p"],
        ["aim", "l"],
      ] as const) {
        if (leftLengths[channel] <= 1e-12 && rightLengths[channel] <= 1e-12) continue;
        const [endSlope, startSlope] = spatialJoinSlopes(
          leftTime,
          rightTime,
          leftLengths[channel],
          rightLengths[channel],
          at[field].clone().sub(previous[field]),
          next[field].clone().sub(at[field]),
        );
        endSlopes[channel][i - 1] = endSlope;
        startSlopes[channel][i] = startSlope;
      }
    });
    spans.forEach((span, k) => {
      if (!joined[k] && !joined[k + 1]) return;
      span.ease.position = matchedSpanEase(
        span.ease.position,
        startSlopes.position[k],
        endSlopes.position[k],
      );
      span.ease.aim = matchedSpanEase(span.ease.aim, startSlopes.aim[k], endSlopes.aim[k]);
    });
  }
  let total = 0;
  const distances = spans.map(({ ease, length }) => {
    const offset = total;
    const travel = length ? traveled(ease.position) : null;
    total += length * (travel?.[SAMPLES_PER_SPAN] ?? 0);
    return { offset, length, travel };
  });
  const distanceAt = (i: number, fraction: number) => {
    if (i < 0) return total;
    const { offset, length, travel } = distances[i];
    if (!travel) return offset;
    const sample = fraction * SAMPLES_PER_SPAN;
    const at = Math.floor(sample);
    const distance = travel[at] + ((travel[at + 1] ?? travel[at]) - travel[at]) * (sample - at);
    return offset + length * distance;
  };
  const railAt = (i: number, progress: number) => {
    if (!rail) return undefined;
    if (i < 0) return u.at(-1);
    return Math.max(0, Math.min(1, u[i] + (u[i + 1] - u[i]) * progress));
  };
  const progress = (i: number, channel: "position" | "aim", u: number) => spans[i].ease[channel](u);
  const matchedSpeedAt = (i: number, fraction: number) => {
    if (!joined[i] && !joined[i + 1]) return undefined;
    const dt = keys[i + 1].t - keys[i].t;
    const lo = Math.max(0, fraction - paceSample),
      hi = Math.min(1, fraction + paceSample);
    if (!(dt > 0) || !(hi > lo)) return 0;
    const from = pose(i, progress(i, "position", lo)).p;
    const to = pose(i, progress(i, "position", hi)).p;
    return from.distanceTo(to) / ((hi - lo) * dt);
  };
  const motionSpans = spans.map((span, i) => ({
    from: keys[i].t,
    to: keys[i + 1].t,
    length: span.length,
    aimLength: span.hold ? 0 : span.look.getLength(),
    hold: span.hold,
    ease: span.ease.position,
    aimEase: span.ease.aim,
    key0: keys[i],
    key1: keys[i + 1],
  }));
  return { pose, progress, distanceAt, railAt, matchedSpeedAt, motionSpans };
};
