// @ts-nocheck
// A keyed camera (a film's src/timeline/cam.json): keys {t, p, l, fov?, roll?, wave?, bob?, cut?, ease?}: position, look
// point, lens and how much the head sways. Between cuts the keys are one centripetal Catmull-Rom curve, so the camera never
// stops gliding; a key with cut: true starts a new curve (a hard cut). On top ride a slow wave (the "breathing" float the
// dev asked for) and Minecraft's own view bob while walking, scaled down so it reads as a step, not a shake.
import * as THREE from "three";

const curves = new WeakMap();
const segments = (keys) => {
  if (curves.has(keys)) return curves.get(keys);
  const out = [];
  let cur = [];
  keys.forEach((k, i) => {
    if (k.cut && cur.length) { out.push(cur); cur = []; }
    cur.push(k);
  });
  out.push(cur);
  const built = out.map((ks) => {
    const pts = (f) => ks.map((k) => new THREE.Vector3(...k[f]));
    const one = ks.length === 1;
    return {
      t0: ks[0].t, t1: ks[ks.length - 1].t, ks,
      p: one ? null : new THREE.CatmullRomCurve3(pts("p"), false, "centripetal"),
      l: one ? null : new THREE.CatmullRomCurve3(pts("l"), false, "centripetal"),
    };
  });
  curves.set(keys, built);
  return built;
};

// Key times are not evenly spread along the curve: map film time to the curve parameter piecewise, eased inside each span
const paramAt = (ks, t) => {
  if (t <= ks[0].t) return 0;
  const n = ks.length - 1;
  for (let i = 0; i < n; i++) if (t <= ks[i + 1].t) {
    const x = (t - ks[i].t) / (ks[i + 1].t - ks[i].t);
    const ease = ks[i + 1].ease ?? "smooth";
    const e = ease === "linear" ? x : x * x * (3 - 2 * x) * 0.6 + x * 0.4; // mostly constant speed, softened at each key
    return (i + e) / n;
  }
  return 1;
};

const lerpKey = (ks, t, f, d) => {
  for (let i = 0; i < ks.length - 1; i++) if (t <= ks[i + 1].t) {
    const x = THREE.MathUtils.clamp((t - ks[i].t) / (ks[i + 1].t - ks[i].t), 0, 1);
    return THREE.MathUtils.lerp(ks[i][f] ?? d, ks[i + 1][f] ?? d, x * x * (3 - 2 * x));
  }
  return ks[ks.length - 1][f] ?? d;
};

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
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
  const right = tmp2.copy(l).sub(p).normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();
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
  for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) for (let z = 0; z <= 2; z++) {
    pt.set(b.min.x + ((b.max.x - b.min.x) * x) / 2, b.min.y + ((b.max.y - b.min.y) * y) / 2, b.min.z + ((b.max.z - b.min.z) * z) / 2);
    if (frustum.containsPoint(pt)) return true;
  }
  return false;
};

// [[from, to], ...] film seconds when the box is on screen, the film's camera sampled every 0.1 s (the same way draw sets it)
export function onScreenRanges(b, keys, end, aspect) {
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.02, 100), frustum = new THREE.Frustum(), m = new THREE.Matrix4();
  const out = [];
  let from = null;
  for (let i = 0; i * 0.1 <= end + 1e-6; i++) {
    const t = i * 0.1, c = cameraAt(t, keys);
    cam.position.copy(c.p); cam.up.set(0, 1, 0); cam.lookAt(c.l); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const seen = inView(frustum.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)), b);
    if (seen && from === null) from = t;
    if (!seen && from !== null) { out.push([+from.toFixed(1), +t.toFixed(1)]); from = null; }
  }
  if (from !== null) out.push([+from.toFixed(1), end]);
  return out;
}
