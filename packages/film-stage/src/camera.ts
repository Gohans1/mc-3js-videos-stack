// @ts-nocheck
// A keyed camera (a film's src/timeline/cam.json): keys {t, p, l, fov?, roll?, wave?, bob?, cut?, ease?}: position, look
// point, lens and how much the head sways. Between cuts the keys are one centripetal Catmull-Rom curve, so the camera never
// stops gliding; a key with cut: true starts a new curve (a hard cut). On top ride a slow wave (the "breathing" float the
// dev asked for) and Minecraft's own view bob while walking, scaled down so it reads as a step, not a shake.
import BezierEasing from "bezier-easing";
import * as THREE from "three";

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

const lerpKey = (ks, t, f, d) => {
  for (let i = 0; i < ks.length - 1; i++)
    if (t <= ks[i + 1].t) {
      const x = THREE.MathUtils.clamp((t - ks[i].t) / (ks[i + 1].t - ks[i].t), 0, 1);
      return THREE.MathUtils.lerp(ks[i][f] ?? d, ks[i + 1][f] ?? d, x * x * (3 - 2 * x));
    }
  return ks[ks.length - 1][f] ?? d;
};

const tmp = new THREE.Vector3(),
  tmp2 = new THREE.Vector3();
export function cameraAt(t, keys) {
  const segs = segments(keys);
  let s = segs[0];
  for (const g of segs) if (t >= g.t0) s = g;
  const ks = s.ks;
  const u = paramAt(ks, t);
  const p = s.p ? s.p.getPoint(u) : new THREE.Vector3(...ks[0].p);
  const l = s.l ? s.l.getPoint(u) : new THREE.Vector3(...ks[0].l);
  const fov = lerpKey(ks, t, "fov", 70);
  let roll = lerpKey(ks, t, "roll", 0);
  const wave = lerpKey(ks, t, "wave", 1);
  const bob = lerpKey(ks, t, "bob", 0);

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
  const right = tmp2
    .copy(l)
    .sub(p)
    .normalize()
    .cross(new THREE.Vector3(0, 1, 0))
    .normalize();
  p.addScaledVector(right, step * amt * 0.5);
  p.y += -lift * amt + wave * 0.035 * Math.sin(t * 0.9);
  l.addScaledVector(right, wave * 0.12 * Math.sin(t * 0.47));
  l.y += wave * 0.08 * Math.sin(t * 0.71 + 1.3);
  roll += wave * 0.012 * Math.sin(t * 0.53) + step * amt * 0.06;
  return { p, l, fov, roll, speed };
}

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
      c = cameraAt(t, keys);
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
