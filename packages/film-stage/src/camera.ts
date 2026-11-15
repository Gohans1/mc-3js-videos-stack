// @ts-nocheck
// A keyed camera (a film's src/timeline/cam.json): keys {t, p, l, fov?, roll?, wave?, bob?, cut?, ease?}: position, look
// point, lens and how much the head sways. Between cuts the keys are one centripetal Catmull-Rom curve, so the camera never
// stops gliding; a key with cut: true starts a new curve (a hard cut). On top ride a slow wave (the "breathing" float the
// dev asked for) and Minecraft's own view bob while walking, scaled down so it reads as a step, not a shake.
import BezierEasing from "bezier-easing";
import { handheld as makeHandheld, type ShakeName, SHAKES } from "film-kit/handheld";
import { fovOf, mmOf } from "film-kit/lens";
import * as THREE from "three";

export { SHAKES, type ShakeName };
export { fovOf, mmOf };

const curves = new WeakMap();
const segments = (keys) => {
  if (curves.has(keys)) return curves.get(keys);
  const out = [];
  let cur = [];
  keys.forEach((k) => {
    if (k.cut && cur.length) {
      out.push(cur);
      cur = [];
    }
    cur.push(k);
  });
  out.push(cur);
  const built = out.map((ks) => {
    const pts = (f) => ks.map((k) => new THREE.Vector3(...k[f]));
    const one = ks.length === 1;
    return {
      t0: ks[0].t,
      t1: ks[ks.length - 1].t,
      ks,
      p: one ? null : new THREE.CatmullRomCurve3(pts("p"), false, "centripetal"),
      l: one ? null : new THREE.CatmullRomCurve3(pts("l"), false, "centripetal"),
    };
  });
  curves.set(keys, built);
  return built;
};

// Pure Cinetic exponential, log-scale, impact-pulse and monotone-spline primitives so films and the studio share one math bank.
export const expOut = (k = 6) => {
  const d = 1 - Math.exp(-k);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : (1 - Math.exp(-k * t)) / d);
};
export const expIn = (k = 6) => {
  const d = Math.exp(k) - 1;
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : (Math.exp(k * t) - 1) / d);
};
export const expInOut = (k = 6) => {
  const half = 1 - Math.exp(-k * 0.5);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5
      ? (0.5 * (1 - Math.exp(-k * t))) / half
      : 1 - (0.5 * (1 - Math.exp(-k * (1 - t)))) / half;
  };
};
export const lmix = (a, b, u) => a * Math.pow(b / a, u);

const monotone = (ys) => {
  const n = ys.length - 1;
  const d = Array.from({ length: n }, (_, i) => (ys[i + 1] - ys[i]) * n);
  const m = Array.from({ length: n + 1 }, (_, i) =>
    i === 0 ? d[0] : i === n ? d[n - 1] : 0.5 * (d[i - 1] + d[i]),
  );
  for (let i = 0; i < n; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i],
      s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t) => {
    if (t <= 0) return ys[0];
    if (t >= 1) return ys[n];
    const x = t * n,
      i = Math.min(n - 1, Math.floor(x)),
      u = x - i,
      h = 1 / n;
    const u2 = u * u,
      u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[i] +
      (u3 - 2 * u2 + u) * h * m[i] +
      (-2 * u3 + 3 * u2) * ys[i + 1] +
      (u3 - u2) * h * m[i + 1]
    );
  };
};

const SNAP_OUT = BezierEasing(0.137, 0.758, 0.128, 0.926);
const GLIDE_OUT = BezierEasing(0.172, 0.687, 0.393, 0.943);
export const hitPulse = (u) => {
  if (u <= 0 || u >= 1) return 0;
  return u < 0.18 ? SNAP_OUT(u / 0.18) : 1 - GLIDE_OUT((u - 0.18) / 0.82);
};

// How a span between two keys spends its time (the later key's `ease`), each EASES entry with one job (bun run find
// reads these with the curve's own shape)
export const EASE_JOBS = {
  base: {
    eases: ["smooth", "linear", "out", "in", "inout", "expo"],
    job: "any move: a general-purpose curve",
  },
  arrive: {
    eases: ["snapOut", "glideOut", "settleOut", "softOut", "liftOut", "jump", "xpArrive"],
    job: "arriving: a front-loaded landing that comes to rest on the key",
  },
  reposition: {
    eases: ["stdInOut", "strongInOut", "whipBuild", "anticipate", "xpTravel"],
    job: "repositioning inside a scene: a reframe or a wind-up that starts and stops at rest",
  },
  leave: {
    eases: ["softIn", "buildIn", "launchIn", "xpLeave"],
    job: "leaving: accelerating into a cut, never braking before it",
  },
};
export const EASES = {
  smooth: (x) => x * x * (3 - 2 * x) * 0.6 + x * 0.4,
  linear: (x) => x,
  out: (x) => 1 - Math.pow(1 - x, 2.2),
  in: (x) => Math.pow(x, 2.2),
  inout: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
  expo: (x) => (Math.pow(2, 7 * x) - 1) / 127,
  snapOut: SNAP_OUT,
  glideOut: GLIDE_OUT,
  settleOut: BezierEasing(0.202, 0.579, 0.484, 0.887),
  softOut: expOut(1.271),
  liftOut: BezierEasing(0.399, 0.329, 0.148, 0.966),
  jump: expOut(12),
  xpArrive: expOut(7),
  stdInOut: monotone([0, 0.04, 0.127, 0.316, 0.55, 0.756, 0.871, 0.924, 0.962, 0.986, 1]),
  strongInOut: BezierEasing(0.673, 0.077, 0.288, 0.943),
  whipBuild: monotone([0, 0.017, 0.041, 0.083, 0.143, 0.279, 0.522, 0.757, 0.902, 0.976, 1]),
  anticipate: BezierEasing(0.56, -0.303, 0.132, 0.795),
  xpTravel: expInOut(7),
  softIn: BezierEasing(0.571, 0.245, 0.76, 0.612),
  buildIn: BezierEasing(0.525, 0.079, 0.724, 0.331),
  launchIn: BezierEasing(0.556, 0.053, 0.835, 0.188),
  xpLeave: expIn(6),
};
// A key's ease may also be a CSS cubic-bezier [x1, y1, x2, y2] (the studio's curve editor writes these)
const beziers = new WeakMap();
export const easeOf = (e) => {
  if (!Array.isArray(e)) return EASES[e] ?? EASES.smooth;
  if (!beziers.has(e)) beziers.set(e, BezierEasing(...e));
  return beziers.get(e);
};
// Key times are not evenly spread along the curve: map film time to the curve parameter piecewise, eased inside each span
const paramAt = (ks, t) => {
  if (t <= ks[0].t) return 0;
  const n = ks.length - 1;
  for (let i = 0; i < n; i++)
    if (t <= ks[i + 1].t) {
      const x = (t - ks[i].t) / (ks[i + 1].t - ks[i].t);
      return (i + easeOf(ks[i + 1].ease)(x)) / n;
    }
  return 1;
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
};

export type FocusTargetSpec =
  number | string | { target: string; offset?: readonly [number, number, number] };
export type FocusValue =
  FocusTargetSpec | { from?: FocusTargetSpec; to?: FocusTargetSpec; u: number };

const spanAt = (ks, t) => {
  if (ks.length <= 1 || t <= ks[0].t) return { i: 0, j: 0, u: 0 };
  for (let i = 0; i < ks.length - 1; i++)
    if (t <= ks[i + 1].t) {
      const dt = ks[i + 1].t - ks[i].t;
      const x = dt > 1e-9 ? THREE.MathUtils.clamp((t - ks[i].t) / dt, 0, 1) : 1;
      const u = ks[i + 1].ease !== undefined ? easeOf(ks[i + 1].ease)(x) : x * x * (3 - 2 * x);
      return { i, j: i + 1, u };
    }
  const last = ks.length - 1;
  return { i: last, j: last, u: 1 };
};

const lerpKey = (ks, t, f, d) => {
  const { i, j, u } = spanAt(ks, t);
  return THREE.MathUtils.lerp(ks[i][f] ?? d, ks[j][f] ?? d, u);
};

const normHandheld = (h): HandheldConfig | null => {
  if (h == null || h === false) return null;
  if (typeof h === "string") {
    const clean = h.trim().toUpperCase();
    if (clean === "OFF" || clean === "NONE") return null;
    const kind = SHAKE_MAP.get(clean);
    return kind ? { kind, amount: 1, move: 1, speed: 1, offset: 0 } : null;
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
    };
  }
  return null;
};

const sameFocus = (a: FocusTargetSpec | undefined, b: FocusTargetSpec | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a.target !== b.target) return false;
  const ao = a.offset,
    bo = b.offset;
  if (!ao && !bo) return true;
  return !!ao && !!bo && ao[0] === bo[0] && ao[1] === bo[1] && ao[2] === bo[2];
};

const carryAt = (ks, idx, aspect) => {
  let fov = 70,
    fstop = 0,
    focus: FocusTargetSpec | undefined,
    hh: HandheldConfig | null = null;
  for (let m = 0; m <= idx; m++) {
    const k = ks[m];
    if (k.mm != null) fov = fovOf(k.mm, aspect);
    else if (k.fov != null) fov = k.fov;
    if (k.fstop != null) fstop = Math.max(0, k.fstop);
    if (k.focus !== undefined) focus = k.focus;
    if (k.handheld !== undefined) hh = normHandheld(k.handheld);
  }
  return { fov, fstop, focus, hh };
};

const sampleHandheld = (cfg: HandheldConfig, scale: number, t: number) => {
  const amount = cfg.amount * scale;
  if (amount <= 1e-6) return null;
  const key = `${cfg.kind}:${amount.toFixed(4)}:${cfg.move.toFixed(4)}:${cfg.speed.toFixed(4)}:${cfg.offset.toFixed(4)}`;
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

export function cameraAt(t, keys, opts?: { aspect?: number }) {
  const aspect = opts?.aspect ?? 16 / 9;
  const segs = segments(keys);
  let s = segs[0];
  for (const g of segs) if (t >= g.t0) s = g;
  const ks = s.ks;
  const u = paramAt(ks, t);
  const p = s.p ? s.p.getPoint(u) : new THREE.Vector3(...ks[0].p);
  const l = s.l ? s.l.getPoint(u) : new THREE.Vector3(...ks[0].l);

  const span = spanAt(ks, t);
  const c0 = carryAt(ks, span.i, aspect);
  const c1 = span.j === span.i ? c0 : carryAt(ks, span.j, aspect);
  const fov = c0.fov === c1.fov ? c0.fov : lmix(c0.fov, c1.fov, span.u);
  const mm = mmOf(fov, aspect);

  // Interpolate aperture radius (1/fstop) so fading from sharp (0) to shallow DOF avoids passing near f/0.1.
  const a0 = c0.fstop > 0 ? 1 / c0.fstop : 0;
  const a1 = c1.fstop > 0 ? 1 / c1.fstop : 0;
  const ap = THREE.MathUtils.lerp(a0, a1, span.u);
  const fstop = ap > 1e-6 ? 1 / ap : 0;

  let focus: FocusValue | undefined;
  if (span.u <= 0 || sameFocus(c0.focus, c1.focus)) focus = c0.focus;
  else if (span.u >= 1) focus = c1.focus;
  else focus = { from: c0.focus, to: c1.focus, u: span.u };

  let roll = lerpKey(ks, t, "roll", 0);
  const wave = lerpKey(ks, t, "wave", 1);
  const bob = lerpKey(ks, t, "bob", 0);
  const base = { p: p.clone(), l: l.clone(), fov, roll };

  // walking speed from the curve, for the step rhythm
  if (s.p) {
    const u2 = paramAt(ks, t + 0.05);
    tmp.copy(s.p.getPoint(u2)).sub(p);
  } else tmp.set(0, 0, 0);
  const speed = tmp.length() / 0.05;
  const walked = t * Math.min(speed, 6) * 0.55; // Minecraft's walk distance, about two steps per block
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

  let handheld: ShakeName | undefined;
  const h0 = c0.hh,
    h1 = c1.hh;
  if (
    h0 &&
    h1 &&
    h0.kind === h1.kind &&
    Math.abs(h0.speed - h1.speed) < 1e-6 &&
    Math.abs(h0.offset - h1.offset) < 1e-6
  ) {
    const blended: HandheldConfig = {
      kind: h0.kind,
      amount: THREE.MathUtils.lerp(h0.amount, h1.amount, span.u),
      move: THREE.MathUtils.lerp(h0.move, h1.move, span.u),
      speed: span.u < 0.5 ? h0.speed : h1.speed,
      offset: span.u < 0.5 ? h0.offset : h1.offset,
    };
    const sOut = sampleHandheld(blended, 1, t);
    if (sOut) {
      roll = applyShakify(p, l, roll, sOut);
      handheld = blended.kind;
    }
  } else {
    const s0 = h0 ? sampleHandheld(h0, 1 - span.u, t) : null;
    const s1 = h1 ? sampleHandheld(h1, span.u, t) : null;
    if (s0) roll = applyShakify(p, l, roll, s0);
    if (s1) roll = applyShakify(p, l, roll, s1);
    if (s1 && (!s0 || span.u >= 0.5)) handheld = h1!.kind;
    else if (s0) handheld = h0!.kind;
  }

  return { p, l, fov, roll, speed, mm, fstop, focus, handheld, base };
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
        : THREE.MathUtils.lerp(a.distance, b.distance, blend.u);
    return { distance, label: `${a.label}->${b.label}` };
  }
  const only = b ?? a;
  return only ? { distance: only.distance, label: only.label } : {};
}

const isSingleFocus = (f: FocusValue) =>
  typeof f === "number" || typeof f === "string" || "target" in f;

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
