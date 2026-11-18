import { arcInto } from "film-kit/arc";
import { CubicBezierCurve3, Curve, LineCurve3, Vector3 } from "three";

import { easeOf } from "./camera-meta";

export type CameraAnchor = Record<string, unknown>;
export type CameraPoint = readonly [number, number, number] | CameraAnchor;
export type ResolveCameraAnchor = (anchor: CameraAnchor) => Vector3 | null | undefined;
export const CAMERA_MOTIONS = ["smooth", "linear", "hold", "orbit"] as const;
export type CameraMotion = (typeof CAMERA_MOTIONS)[number];

interface PathKey {
  p: CameraPoint;
  l: CameraPoint;
  motion?: CameraMotion;
  reversePath?: boolean;
  ease?: unknown;
  easeChannels?: { position?: unknown };
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

const smoothCurve = (points: Vector3[], i: number) => {
  const a = points[i],
    b = points[i + 1];
  const before = points[i - 1],
    after = points[i + 2];
  const chord = b.clone().sub(a);
  const from = before?.equals(a) ? new Vector3() : b.clone().sub(before ?? a);
  const to = after?.equals(b) ? new Vector3() : (after ?? b).clone().sub(a);
  return new CubicBezierCurve3(
    a,
    a.clone().add(controlOffset(from, chord)),
    b.clone().sub(controlOffset(to, chord)),
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

export const compileCameraPath = (keys: PathKey[], resolve?: ResolveCameraAnchor) => {
  const positions = keys.map((key) => resolveCameraPoint(key.p, resolve));
  const targets = keys.map((key) => resolveCameraPoint(key.l, resolve));
  let total = 0;
  const spans = keys.slice(1).map((key, i) => {
    const mode = key.motion ?? "smooth";
    const a = positions[i],
      b = positions[i + 1];
    const from = targets[i],
      to = targets[i + 1];
    const position =
      mode === "orbit"
        ? key.reversePath
          ? new OrbitCurve(b, a, to, from, true)
          : new OrbitCurve(a, b, from, to)
        : mode === "smooth" && !a.equals(b)
          ? smoothCurve(positions, i)
          : new LineCurve3(a, b);
    const look =
      mode === "smooth" && !from.equals(to) ? smoothCurve(targets, i) : new LineCurve3(from, to);
    position.arcLengthDivisions = SAMPLES_PER_SPAN;
    look.arcLengthDivisions = SAMPLES_PER_SPAN;
    const length = mode === "hold" ? 0 : position.getLength();
    const travel = length ? traveled(easeOf(key.easeChannels?.position ?? key.ease)) : null;
    const span = { length, offset: total, position, look, hold: mode === "hold", travel };
    total += length * (travel?.[SAMPLES_PER_SPAN] ?? 0);
    return span;
  });
  const distanceAt = (i: number, fraction: number) => {
    if (i < 0) return total;
    const { length, offset, travel } = spans[i];
    if (!travel) return offset;
    const sample = fraction * SAMPLES_PER_SPAN;
    const at = Math.floor(sample);
    const distance = travel[at] + ((travel[at + 1] ?? travel[at]) - travel[at]) * (sample - at);
    return offset + length * distance;
  };
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
      p: pointAtProgress(span.position, u, span.length),
      l: pointAtProgress(span.look, u, span.look.getLength()),
    };
  };
  return { pose, distanceAt };
};
