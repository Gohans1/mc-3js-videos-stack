// @ts-nocheck
// A keyed camera (a film's src/timeline/cam.json): keys {t, p, l, fov?, roll?, wave?, bob?, cut?, ease?}: position, look
// point, lens and how much the head sways. A key with cut: true starts a new path. On top ride a slow wave (the "breathing" float the
// dev asked for) and Minecraft's own view bob while walking, scaled down so it reads as a step, not a shake.
import { handheld as makeHandheld, type ShakeName, SHAKES } from "film-kit/handheld";
import { clampFov, fovOf, mmOf } from "film-kit/lens";
export { dofParams, dollyZoom, PRIME_LENSES } from "film-kit/lens";
import * as THREE from "three";

import { easeOf, lmix } from "./camera-meta";
import { compileCameraPath, type ResolveCameraAnchor } from "./camera-path";
import { type FovAxis, lensAspect, rigFov } from "./camera-rig";

export * from "./camera-meta";
export * from "./camera-rig";
export {
  CAMERA_MOTIONS,
  resolveCameraPoint,
  type CameraMotion,
  type ResolveCameraAnchor,
} from "./camera-path";
export { fovOf, mmOf };
export { SHAKES, type ShakeName };
const curves = new WeakMap();
const segments = (keys) => {
  if (curves.has(keys)) return curves.get(keys);
  const out = [];
  let cur = [];
  keys.forEach((k, i) => {
    if (i && !k.cut && k.muted) return;
    if (k.cut && cur.length) {
      out.push(cur);
      cur = [];
    }
    cur.push(k);
  });
  out.push(cur);
  const built = out.map((ks) => ({
    t0: ks[0].t,
    ks,
    dynamic: ks.some((key) => !Array.isArray(key.p) || !Array.isArray(key.l)),
    path: null,
  }));
  curves.set(keys, built);
  return built;
};

// Key times are not evenly spread along the curve: map film time to the curve parameter piecewise, eased inside each span
const spanIndex = (ks, t) => {
  const n = ks.length - 1;
  if (n <= 0 || t > ks[n].t) return -1;
  let lo = 0,
    hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t <= ks[mid + 1].t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};
const timeFraction = (ks, t, i) =>
  i < 0 || ks[i + 1].t <= ks[i].t
    ? 1
    : THREE.MathUtils.clamp((t - ks[i].t) / (ks[i + 1].t - ks[i].t), 0, 1);
const progressAt = (ks, t, i, channel) => {
  if (i < 0) return 1;
  if (t <= ks[0].t) return 0;
  const a = ks[i],
    b = ks[i + 1];
  if (b.t <= a.t) return 1;
  if (b.motion === "hold") return Number(b.reversePath ? t > a.t : t >= b.t);
  return t >= b.t ? 1 : easeOf(b.easeChannels?.[channel] ?? b.ease)((t - a.t) / (b.t - a.t));
};
// Camera shake for impacts only: [{t, d, amp}] (amp in metres, roll in radians x 0.1). Decorrelated x/y/roll noise that
// starts at full and decays to nothing over d; keep d <= ~0.6 s and match amp to the hit (a door kick 0.02, a blast 0.06)
export const shakeAt = (events, t) => {
  const out = { x: 0, y: 0, roll: 0 };
  for (const e of events ?? []) {
    const dt = t - e.t;
    if (dt < 0 || dt > e.d) continue;
    const k = e.amp * Math.pow(1 - dt / e.d, 2);
    out.x += k * (Math.sin(dt * 71.3) * 0.6 + Math.sin(dt * 37.9 + 1.7) * 0.4);
    out.y += k * (Math.sin(dt * 59.1 + 0.6) * 0.6 + Math.sin(dt * 23.3 + 2.9) * 0.4);
    out.roll += k * 1.5 * Math.sin(dt * 43.7 + 0.3);
  }
  return out;
};

const UP = new THREE.Vector3(0, 1, 0);
const SHAKE_MAP = new Map<string, ShakeName>(SHAKES.map((s) => [s.toUpperCase(), s]));
const shakeCache = new Map<string, ReturnType<typeof makeHandheld>>();

type HandheldConfig = {
  kind: ShakeName;
  amount: number;
  move: number;
  speed: number;
  offset: number;
  desync: number;
  octaves: number;
};

export type FocusTargetSpec =
  | null
  | number
  | string
  | { target: string; offset?: readonly [number, number, number] }
  | { point: readonly [number, number, number]; label?: string };
export type FocusValue =
  FocusTargetSpec | { from?: FocusTargetSpec; to?: FocusTargetSpec; u: number };

const spanAt = (ks, t) => {
  if (ks.length <= 1 || t <= ks[0].t) return { i: 0, j: 0, u: 0 };
  for (let i = 0; i < ks.length - 1; i++)
    if (t <= ks[i + 1].t) {
      const dt = ks[i + 1].t - ks[i].t;
      const x = dt > 1e-9 ? THREE.MathUtils.clamp((t - ks[i].t) / dt, 0, 1) : 1;
      const u =
        ks[i + 1].motion === "hold"
          ? Number(ks[i + 1].reversePath ? x > 0 : x === 1)
          : ks[i + 1].ease !== undefined
            ? easeOf(ks[i + 1].ease)(x)
            : x * x * (3 - 2 * x);
      return { i, j: i + 1, u };
    }
  const last = ks.length - 1;
  return { i: last, j: last, u: 1 };
};

const channelProgress = (ks, t, span, channel) => {
  const ease = ks[span.j].easeChannels?.[channel];
  if (span.i === span.j || ease === undefined || ks[span.j].motion === "hold") return span.u;
  return easeOf(ease)(timeFraction(ks, t, span.i));
};
const lerpKey = (ks, f, d, span, u) => {
  const { i, j } = span;
  return THREE.MathUtils.lerp(ks[i][f] ?? d, ks[j][f] ?? d, u);
};

const normHandheld = (h): HandheldConfig | null => {
  if (h == null || h === false) return null;
  if (typeof h === "string") {
    const clean = h.trim().toUpperCase();
    if (clean === "OFF" || clean === "NONE") return null;
    const kind = SHAKE_MAP.get(clean);
    return kind ? { kind, amount: 1, move: 1, speed: 1, offset: 0, desync: 0, octaves: 1 } : null;
  }
  if (typeof h === "object") {
    const raw = String(h.preset ?? h.kind ?? "THE_CLOSEUP")
      .trim()
      .toUpperCase();
    if (raw === "OFF" || raw === "NONE") return null;
    const kind = SHAKE_MAP.get(raw);
    if (!kind) return null;
    return {
      kind,
      amount: Math.max(0, Number(h.amount ?? 1)),
      move: Math.max(0, Number(h.move ?? 1)),
      speed: Number(h.speed ?? 1),
      offset: Number(h.offset ?? 0),
      desync: Number(h.desync ?? 0),
      octaves: THREE.MathUtils.clamp(Math.trunc(Number(h.octaves) || 1), 1, 4),
    };
  }
  return null;
};

const sameFocus = (a: FocusTargetSpec | undefined, b: FocusTargetSpec | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if ("point" in a || "point" in b)
    return "point" in a && "point" in b && a.point.every((v, i) => v === b.point[i]);
  if (a.target !== b.target) return false;
  const ao = a.offset,
    bo = b.offset;
  if (!ao && !bo) return true;
  return !!ao && !!bo && ao[0] === bo[0] && ao[1] === bo[1] && ao[2] === bo[2];
};

const carryAt = (ks, idx, aspect, start = 0, axis?: FovAxis) => {
  let fov = rigFov(70, undefined, aspect, axis),
    fstop = 0,
    focus: FocusTargetSpec | undefined,
    mm: number | undefined,
    hh: HandheldConfig[] = [];
  for (let m = start; m <= idx; m++) {
    const k = ks[m];
    if (m > start && m !== idx && k.muted) continue;
    if (k.mm != null) {
      mm = k.mm;
      fov = rigFov(0, mm, aspect, axis);
    } else if (k.fov != null) {
      mm = undefined;
      fov = rigFov(k.fov, undefined, aspect, axis);
    }
    if (k.fstop != null) fstop = Math.max(0, k.fstop);
    if (k.focus !== undefined) focus = k.focus;
    if (k.handheld !== undefined) {
      const values = Array.isArray(k.handheld?.mix) ? k.handheld.mix : [k.handheld];
      hh = values.map(normHandheld).filter(Boolean);
    }
  }
  return { fov, mm, fstop, focus, hh };
};

type OpticsKey = Partial<{
  cut: boolean;
  muted: boolean;
  t: number;
  fov: number;
  mm: number;
  fstop: number;
  focus: unknown;
  handheld: unknown;
  roll: number;
  bob: number;
  wave: number;
}>;

export const cameraKeyOptics = (
  keys: readonly OpticsKey[],
  index: number,
  aspect = 16 / 9,
  axis?: FovAxis,
) => {
  const start = keys.findLastIndex((key, i) => i <= index && key.cut);
  const { hh, ...lens } = carryAt(keys, index, aspect, Math.max(0, start), axis);
  const key = keys[index];
  return {
    ...lens,
    handheld: hh.length > 1 ? { mix: hh } : (hh[0] ?? false),
    roll: key?.roll ?? 0,
    bob: key?.bob ?? 0,
    wave: key?.wave ?? 1,
  };
};

const sampleHandheld = (cfg: HandheldConfig, scale: number, t: number) => {
  const amount = cfg.amount * scale;
  if (amount <= 1e-6) return null;
  const key = [cfg.kind, amount, cfg.move, cfg.speed, cfg.offset].join(":");
  let sampler = shakeCache.get(key);
  if (!sampler) {
    if (shakeCache.size > 128) shakeCache.clear();
    sampler = makeHandheld(cfg.kind, {
      amount,
      move: cfg.move,
      speed: cfg.speed,
      offset: cfg.offset,
    });
    shakeCache.set(key, sampler);
  }
  return sampler(t);
};

const tmp = new THREE.Vector3(),
  tmp2 = new THREE.Vector3(),
  tmp3 = new THREE.Vector3(),
  tmp4 = new THREE.Vector3(),
  mat = new THREE.Matrix4(),
  qCam = new THREE.Quaternion(),
  qShake = new THREE.Quaternion();

const applyShakify = (
  p: THREE.Vector3,
  l: THREE.Vector3,
  roll: number,
  s: ReturnType<ReturnType<typeof makeHandheld>>,
) => {
  const d = Math.max(1e-4, tmp.copy(l).sub(p).length());
  const fwd = tmp.copy(l).sub(p).normalize();
  const right = tmp2.copy(fwd).cross(UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  const up = tmp3.copy(right).cross(fwd).normalize();
  p.addScaledVector(right, s.pos[0]).addScaledVector(up, s.pos[1]).addScaledVector(fwd, -s.pos[2]);
  mat.makeBasis(right, up, tmp4.copy(fwd).negate());
  qCam.setFromRotationMatrix(mat);
  qShake.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
  qCam.multiply(qShake);
  const newFwd = tmp.set(0, 0, -1).applyQuaternion(qCam).normalize();
  l.copy(p).addScaledVector(newFwd, d);
  const newUp = tmp2.set(0, 1, 0).applyQuaternion(qCam).normalize();
  const r0 = tmp3.copy(newFwd).cross(UP);
  if (r0.lengthSq() >= 1e-8) {
    r0.normalize();
    const u0 = tmp4.copy(r0).cross(newFwd).normalize();
    roll += Math.atan2(-newUp.dot(r0), newUp.dot(u0));
  }
  return roll;
};

const blendHandheld = (from: HandheldConfig[], to: HandheldConfig[], u: number) => {
  const pending = [...to];
  const result = from.map((a) => {
    const index = pending.findIndex(
      (b) =>
        a.kind === b.kind &&
        Math.abs(a.speed - b.speed) < 1e-6 &&
        Math.abs(a.offset - b.offset) < 1e-6 &&
        Math.abs(a.desync - b.desync) < 1e-6 &&
        a.octaves === b.octaves,
    );
    if (index < 0) return { ...a, amount: a.amount * (1 - u) };
    const [b] = pending.splice(index, 1);
    return {
      ...a,
      amount: THREE.MathUtils.lerp(a.amount, b.amount, u),
      move: Math.max(0, THREE.MathUtils.lerp(a.move, b.move, u)),
    };
  });
  return [...result, ...pending.map((b) => ({ ...b, amount: b.amount * u }))].filter(
    (shake) => shake.amount > 1e-6,
  );
};

export function cameraAt(
  t,
  keys,
  opts?: { aspect?: number; resolveAnchor?: ResolveCameraAnchor; fovAxis?: FovAxis },
) {
  const aspect = opts?.aspect ?? 16 / 9;
  const segs = segments(keys);
  let s = segs[0];
  if (segs.length > 1) {
    let lo = 0,
      hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t >= segs[mid].t0) lo = mid;
      else hi = mid - 1;
    }
    s = segs[lo];
  }
  const ks = s.ks;
  const path = s.dynamic
    ? compileCameraPath(ks, opts?.resolveAnchor)
    : (s.path ??= compileCameraPath(ks));
  const idx = spanIndex(ks, t);
  const u = progressAt(ks, t, idx, "position");
  const lookU = progressAt(ks, t, idx, "aim");
  const pose = path.pose(idx, u);
  const p = pose.p,
    l = lookU === u ? pose.l : path.pose(idx, lookU).l;
  const distance = path.distanceAt(idx, timeFraction(ks, t, idx));

  const span = spanAt(ks, t);
  const c0 = carryAt(ks, span.i, aspect, 0, opts?.fovAxis);
  const c1 = span.j === span.i ? c0 : carryAt(ks, span.j, aspect, 0, opts?.fovAxis);
  const lensU = channelProgress(ks, t, span, "lens");
  const dofU = channelProgress(ks, t, span, "dof");
  const shakeU = channelProgress(ks, t, span, "shake");
  const rollU = channelProgress(ks, t, span, "roll");
  const dollyZoomScale = span.i === span.j ? undefined : ks[span.j].dollyZoomScale;
  const fov = clampFov(
    dollyZoomScale !== undefined
      ? (2 * Math.atan(dollyZoomScale / Math.max(0.01, p.distanceTo(l))) * 180) / Math.PI
      : c0.fov === c1.fov
        ? c0.fov
        : lmix(c0.fov, c1.fov, lensU),
  );
  const mm = mmOf(fov, lensAspect(aspect, opts?.fovAxis));

  // Interpolate aperture radius (1/fstop) so fading from sharp (0) to shallow DOF avoids passing near f/0.1.
  const a0 = c0.fstop > 0 ? 1 / c0.fstop : 0;
  const a1 = c1.fstop > 0 ? 1 / c1.fstop : 0;
  const ap = THREE.MathUtils.lerp(a0, a1, dofU);
  const fstop = ap > 1e-6 ? 1 / ap : 0;

  let focus: FocusValue | undefined;
  if (dofU <= 0 || sameFocus(c0.focus, c1.focus)) focus = c0.focus;
  else if (dofU >= 1) focus = c1.focus;
  else focus = { from: c0.focus, to: c1.focus, u: dofU };

  let roll = lerpKey(ks, "roll", 0, span, rollU);
  const wave = lerpKey(ks, "wave", 1, span, shakeU);
  const bob = lerpKey(ks, "bob", 0, span, shakeU);
  const base = { p: p.clone(), l: l.clone(), fov, roll };

  let speed = 0;
  if (idx >= 0 && t >= ks[idx].t && ks[idx + 1].motion !== "hold") {
    const before = Math.max(t - 0.025, ks[idx].t);
    const after = Math.min(t + 0.025, ks[idx + 1].t);
    if (after > before) {
      const a = path.distanceAt(idx, timeFraction(ks, before, idx));
      const b = path.distanceAt(idx, timeFraction(ks, after, idx));
      speed = (b - a) / (after - before);
    }
  }
  const walked = distance * 0.55;
  const step = Math.sin(walked * Math.PI);
  const lift = Math.abs(Math.cos(walked * Math.PI));
  const amt = bob * Math.min(speed / 4.3, 1.4) * 0.05;
  // sideways and down with each step, like the game's bobView, plus a slow figure-eight float
  const right = tmp2.copy(l).sub(p).cross(UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  p.addScaledVector(right, step * amt * 0.5);
  p.y += -lift * amt + wave * 0.035 * Math.sin(t * 0.9);
  l.addScaledVector(right, wave * 0.12 * Math.sin(t * 0.47));
  l.y += wave * 0.08 * Math.sin(t * 0.71 + 1.3);
  roll += wave * 0.012 * Math.sin(t * 0.53) + step * amt * 0.06;

  const shakes = blendHandheld(c0.hh, c1.hh, shakeU);
  let strongest: HandheldConfig | undefined;
  for (const shake of shakes) {
    const weight = 2 - 2 ** (1 - shake.octaves);
    for (let octave = 0; octave < shake.octaves; octave++) {
      const offset = sampleHandheld(
        {
          ...shake,
          speed: shake.speed * 2 ** octave,
          offset: shake.offset + shake.desync + octave * 0.37,
        },
        0.5 ** octave / weight,
        t,
      );
      if (offset) roll = applyShakify(p, l, roll, offset);
    }
    if (!strongest || shake.amount >= strongest.amount) strongest = shake;
  }
  const sampleMm =
    lensU <= 0 || c0.mm === c1.mm
      ? c0.mm
      : lensU >= 1
        ? c1.mm
        : c0.mm !== undefined && c1.mm !== undefined
          ? mm
          : undefined;
  const sample = {
    p: base.p.toArray(),
    l: base.l.toArray(),
    fov,
    ...(sampleMm !== undefined && { mm: sampleMm }),
    fstop,
    focus,
    roll: base.roll,
    wave,
    bob,
    handheld: shakes.length > 1 ? { mix: shakes } : (shakes[0] ?? false),
  };
  return {
    p,
    l,
    fov,
    roll,
    speed,
    distance,
    mm,
    fstop,
    focus,
    handheld: strongest?.kind,
    base,
    sample,
  };
}

const resolveSingleFocus = (
  spec: FocusTargetSpec | undefined,
  camPos: THREE.Vector3,
  resolveTarget: (name: string) => THREE.Vector3 | null,
) => {
  if (spec == null) return null;
  if (typeof spec === "number")
    return { distance: Math.max(0.05, spec), label: `${+spec.toFixed(2)}m` };
  if (typeof spec === "string") {
    const basePoint = resolveTarget(spec);
    if (!basePoint) return null;
    const point = basePoint.clone();
    return { distance: Math.max(0.05, camPos.distanceTo(point)), point, label: spec };
  }
  if ("point" in spec) {
    const point = new THREE.Vector3(...spec.point);
    return {
      distance: Math.max(0.05, camPos.distanceTo(point)),
      point,
      label: spec.label ?? "Surface",
    };
  }
  const basePoint = resolveTarget(spec.target);
  if (!basePoint) return null;
  const point = basePoint.clone();
  if (spec.offset) point.add(new THREE.Vector3(spec.offset[0], spec.offset[1], spec.offset[2]));
  return { distance: Math.max(0.05, camPos.distanceTo(point)), point, label: spec.target };
};

export function resolveFocusDistance(
  focus: FocusValue | undefined,
  camPos: THREE.Vector3,
  resolveTarget: (name: string) => THREE.Vector3 | null,
): { distance?: number; label?: string } {
  if (focus == null) return {};
  if (isSingleFocus(focus)) {
    const res = resolveSingleFocus(focus as FocusTargetSpec, camPos, resolveTarget);
    return res ? { distance: res.distance, label: res.label } : {};
  }
  const blend = focus as { from?: FocusTargetSpec; to?: FocusTargetSpec; u: number };
  const a = resolveSingleFocus(blend.from, camPos, resolveTarget);
  const b = resolveSingleFocus(blend.to, camPos, resolveTarget);
  if (a && b) {
    const distance =
      a.point && b.point
        ? Math.max(0.05, a.point.clone().lerp(b.point, blend.u).distanceTo(camPos))
        : Math.max(0.05, THREE.MathUtils.lerp(a.distance, b.distance, blend.u));
    return { distance, label: `${a.label}->${b.label}` };
  }
  const only = b ?? a;
  return only ? { distance: only.distance, label: only.label } : {};
}

const isSingleFocus = (f: FocusValue) =>
  typeof f === "number" || typeof f === "string" || "target" in f || "point" in f;

const pt = new THREE.Vector3();
// Frustum.intersectsBox is conservative (a box past a frame corner still passes), so a point of a 3x3x3 grid over the
// box must be in view
export const inView = (frustum, b) => {
  for (let x = 0; x <= 2; x++)
    for (let y = 0; y <= 2; y++)
      for (let z = 0; z <= 2; z++) {
        pt.set(
          b.min.x + ((b.max.x - b.min.x) * x) / 2,
          b.min.y + ((b.max.y - b.min.y) * y) / 2,
          b.min.z + ((b.max.z - b.min.z) * z) / 2,
        );
        if (frustum.containsPoint(pt)) return true;
      }
  return false;
};

// [[from, to], ...] film seconds when the box is on screen, the film's camera sampled every 0.1 s (the same way draw sets it)
export function onScreenRanges(b, keys, end, aspect) {
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.02, 100),
    frustum = new THREE.Frustum(),
    m = new THREE.Matrix4();
  const out = [];
  let from = null;
  for (let i = 0; i * 0.1 <= end + 1e-6; i++) {
    const t = i * 0.1,
      c = cameraAt(t, keys, { aspect });
    cam.position.copy(c.p);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.l);
    cam.rotateZ(c.roll);
    cam.fov = c.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const seen = inView(
      frustum.setFromProjectionMatrix(
        m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
      ),
      b,
    );
    if (seen && from === null) from = t;
    if (!seen && from !== null) {
      out.push([+from.toFixed(1), +t.toFixed(1)]);
      from = null;
    }
  }
  if (from !== null) out.push([+from.toFixed(1), end]);
  return out;
}
