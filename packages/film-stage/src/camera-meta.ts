// @ts-nocheck
import BezierEasing from "bezier-easing";

export const CAMERA_CHANNELS = ["position", "aim", "lens", "dof", "roll", "shake"] as const;
export type CameraChannel = (typeof CAMERA_CHANNELS)[number];

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
  if (typeof e === "string" && e.startsWith("reverse:")) {
    const original = easeOf(e.slice(8));
    return (u: number) => 1 - original(1 - u);
  }
  if (!Array.isArray(e)) return EASES[e] ?? EASES.smooth;
  if (!beziers.has(e)) beziers.set(e, BezierEasing(...e));
  return beziers.get(e);
};
