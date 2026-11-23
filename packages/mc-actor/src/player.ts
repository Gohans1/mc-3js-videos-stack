// @ts-nocheck
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { clamp01, smooth } from "./ease";
import { updaterTo } from "./matrices";
import { BOX, facesOf } from "./skin-paint";

export const PX = 1.875 / 32;
export const SKIN_UV = Object.fromEntries(Object.entries(BOX).map(([k, box]) => [k, facesOf(box)]));
const D = Math.PI / 180;
const LEG = 6 * PX;
// GLTFLoader strips ":" from node names (PropertyBinding.sanitizeNodeName), so "Arm:Left:Upper" is "ArmLeftUpper"
const BONES = {
  root: "center",
  body: "Body",
  chest: "Chest",
  head: "Head",
  uaL: "ArmLeftUpper",
  laL: "ArmLeftLower",
  uaR: "ArmRightUpper",
  laR: "ArmRightLower",
  ulL: "LegLeftUpper",
  llL: "LegLeftLower",
  ulR: "LegRightUpper",
  llR: "LegRightLower",
};

export const loadRig = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

const loadImage = (url) =>
  new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("skin " + url));
    i.src = url;
  });

export const arm = (side, fwd = 0, out = 0, twist = 0, elbow = 0) => ({
  [`ua${side}`]: [-fwd, twist * (side === "L" ? 1 : -1), out * (side === "L" ? 1 : -1)],
  [`la${side}`]: [-elbow, 0, 0],
});
export const leg = (side, fwd = 0, out = 0, knee = 0) => ({
  [`ul${side}`]: [-fwd, 0, out * (side === "L" ? 1 : -1)],
  [`ll${side}`]: [knee, 0, 0],
});
export const squat = (a) => ({
  ...leg("L", a, 4, 2 * a),
  ...leg("R", a, 4, 2 * a),
  root: { y: -2 * LEG * (1 - Math.cos(a * D)) },
});
const merge = (...ps) => {
  const root = {};
  const out = { root };
  for (let n = 0; n < ps.length; n++) {
    const p = ps[n];
    for (const k in p) {
      const v = p[k];
      if (!v) continue;
      if (k === "root") {
        for (const a in v) root[a] = (root[a] ?? 0) + v[a];
      } else {
        const cur = out[k];
        if (cur) {
          cur[0] += v[0];
          cur[1] += v[1];
          cur[2] += v[2];
        } else out[k] = [v[0], v[1], v[2]];
      }
    }
  }
  return out;
};

export const GESTURES = {
  idle: () => ({}),
  stomach: () =>
    merge(arm("L", 28, -26, 0, 78), arm("R", 28, -26, 0, 78), {
      chest: [12, 0, 0],
      head: [16, 0, 0],
    }),
  wave: (s) =>
    merge(arm("R", 15, 150, 10, 25), { laR: [0, 0, 28 * Math.sin(s * 9)], head: [-4, 0, 6] }),
  swing: (s, u) => {
    const up = smooth(u / 0.35),
      hit = smooth((u - 0.35) / 0.25);
    const fwd = 150 * up - 175 * hit;
    return merge(
      arm("R", fwd, 10, 0, 25 - 15 * hit),
      {
        chest: [-8 * up + 14 * hit, 22 * up - 45 * hit, 0],
        body: [0, 10 * up - 20 * hit, 0],
        head: [-6 * up, -10 * up + 20 * hit, 0],
      },
      leg("L", 12 * hit, 0, 10 * hit),
    );
  },
  eat: (s) => merge(arm("R", 70, -25, 30, 115 + 6 * Math.sin(s * 16)), { head: [-6, 0, 0] }),
  point: () => merge(arm("R", 88, 4, 0, 4), { chest: [0, -8, 0], head: [0, -8, 0] }),
  cheer: (s) =>
    merge(
      arm("L", 20, 155, 0, 15 + 10 * Math.sin(s * 8)),
      arm("R", 20, 155, 0, 15 + 10 * Math.sin(s * 8 + 1)),
      { head: [-12, 0, 0], root: { y: 0.28 * Math.abs(Math.sin(s * 4.2)) } },
    ),
  shrug: () =>
    merge(arm("L", 18, 28, 45, 85), arm("R", 18, 28, 45, 85), {
      chest: [-4, 0, 0],
      head: [0, 0, 12],
    }),
  facepalm: () => merge(arm("R", 72, -32, 20, 128), { head: [18, 0, 0], chest: [8, 0, 0] }),
  think: () => merge(arm("R", 42, -22, 15, 138), arm("L", 25, -18, 0, 95), { head: [-6, 10, 8] }),
  scared: () =>
    merge(
      arm("L", 62, -8, 0, 95),
      arm("R", 62, -8, 0, 95),
      { body: [-10, 0, 0], head: [-6, 0, 0] },
      squat(14),
    ),
  peek: () => merge({ body: [0, 0, -22], head: [0, 10, 18] }, arm("L", 25, 30, 0, 40)),
  craft: (s) =>
    merge(
      arm("L", 55, -10, 0, 40 + 14 * Math.max(0, Math.sin(s * 10))),
      arm("R", 55, -10, 0, 40 + 14 * Math.max(0, Math.sin(s * 10 + Math.PI))),
      { head: [28, 0, 0], chest: [10, 0, 0] },
    ),
  carry: () => merge(arm("L", 55, -12, 0, 35), arm("R", 55, -12, 0, 35), { body: [-4, 0, 0] }),
  place: (s, u) =>
    merge(arm("R", 70 - 40 * smooth(u), 0, 0, 20), squat(25 * Math.sin(u * Math.PI)), {
      chest: [25 * Math.sin(u * Math.PI), 0, 0],
      head: [20, 0, 0],
    }),
  crouch: () =>
    merge(
      squat(80),
      { body: [24, 0, 0], head: [-14, 0, 0] },
      arm("L", 32, 6, 0, 30),
      arm("R", 32, 6, 0, 30),
    ),
  pet: (s) =>
    merge(
      squat(80),
      { body: [30, 0, 0], head: [8, 0, 0] },
      arm("R", 70 + 6 * Math.sin(s * 6), -10, 0, 25),
      arm("L", 20, 10, 0, 30),
    ),
  sit: () =>
    merge(
      leg("L", 88, 6, 0),
      leg("R", 88, 6, 0),
      { root: { y: -2 * LEG + 2 * PX }, body: [6, 0, 0] },
      arm("L", 25, 20, 0, 30),
      arm("R", 25, 20, 0, 30),
    ),
  lie: () => ({ root: { rx: -90, y: -(12 * PX - 2 * PX) }, head: [-15, 0, 0] }),
  jump: (s, u) => {
    const k = Math.sin(u * Math.PI);
    return merge(
      { root: { y: 0.9 * k } },
      leg("L", 40 * k, 0, 70 * k),
      leg("R", 40 * k, 0, 70 * k),
      arm("L", -20 * k, 40 * k, 0, 20),
      arm("R", -20 * k, 40 * k, 0, 20),
    );
  },
  hips: () => merge(arm("L", -10, 38, 80, 105), arm("R", -10, 38, 80, 105), { chest: [-4, 0, 0] }),
  nod: (s) => ({ head: [14 * Math.max(0, Math.sin(s * 9)), 0, 0] }),
  shake: (s) => ({ head: [4, 24 * Math.sin(s * 11), 0] }),
  laugh: (s) =>
    merge(
      { chest: [10 + 6 * Math.sin(s * 14), 0, 0], head: [-14 + 6 * Math.sin(s * 14), 0, 0] },
      arm("L", 30, -18, 0, 70),
      arm("R", 30, -18, 0, 70),
    ),
  dance: (s) =>
    merge(
      arm("L", 20, 90 + 60 * Math.sin(s * 6), 0, 60),
      arm("R", 20, 90 - 60 * Math.sin(s * 6), 0, 60),
      {
        root: { x: 0.06 * Math.sin(s * 6), rz: 8 * Math.sin(s * 6) },
        head: [0, 0, -10 * Math.sin(s * 6)],
      },
      leg("L", 0, 0, 25 * Math.max(0, Math.sin(s * 6))),
      leg("R", 0, 0, 25 * Math.max(0, -Math.sin(s * 6))),
    ),
  kneel: () =>
    merge(
      leg("L", 90, 0, 90),
      leg("R", -12, 0, 102),
      { root: { y: -LEG + 0.02 } },
      arm("R", 40, -10, 0, 40),
    ),
  whisper: () => merge(arm("R", 70, -40, 20, 135), { head: [6, 0, 10], chest: [6, 0, 0] }),
  sneak: () =>
    merge(
      squat(30),
      { body: [24, 0, 0], head: [-18, 0, 0] },
      arm("L", 25, 5, 0, 40),
      arm("R", 25, 5, 0, 40),
    ),
  sleep: () => merge(GESTURES.lie(), arm("L", 0, 12, 0, 10), arm("R", 0, 12, 0, 10)),
};

const STRIDE = 0.5;
export const gaitOf = (dist, speed) => ({ ph: (dist * Math.PI) / STRIDE, w: clamp01(speed / 1.2) });
export const walkPose = (dist, speed) => {
  const { ph, w } = gaitOf(dist, speed),
    run = clamp01((speed - 4) / 2);
  if (w < 0.01) return {};
  const s = Math.sin(ph),
    c = Math.cos(ph);
  const A = (21 + 22 * run) * w,
    K = (38 + 50 * run) * w,
    B = (24 + 40 * run) * w;
  return merge(
    leg("L", A * s, 3 * w, K * Math.max(0, c) + 6 * w),
    leg("R", -A * s, 3 * w, K * Math.max(0, -c) + 6 * w),
    arm("L", -B * s, 6 * w, 0, 10 * w + 45 * run * w + 12 * w * Math.max(0, -s)),
    arm("R", B * s, 6 * w, 0, 10 * w + 45 * run * w + 12 * w * Math.max(0, s)),
    {
      chest: [6 * run, 8 * s * w, 0],
      body: [4 * w + 14 * run, 0, 0],
      head: [-6 * run, -6 * s * w, 0],
      root: { y: -(0.03 + 0.05 * Math.abs(s)) * w - 0.03 * run },
    },
  );
};

export const idlePose = (t, seed) =>
  merge(
    arm("L", 0, 5 + 1.5 * Math.sin(t * 1.3 + seed), 0, 6),
    arm("R", 0, 5 + 1.5 * Math.sin(t * 1.3 + seed + 1), 0, 6),
    {
      chest: [-1.5 * Math.sin(t * 1.7 + seed), 0, 0],
      head: [1.2 * Math.sin(t * 0.9 + seed), 0, 0],
    },
  );

export const blendPose = (a, b, k) => {
  const ok = 1 - k;
  const root = a.root ? { ...a.root } : {};
  const out = { root };
  for (const j in a) {
    if (j === "root") continue;
    const v = a[j];
    out[j] = [v[0], v[1], v[2]];
  }
  for (const j in b) {
    const v = b[j];
    if (j === "root") {
      for (const r in v) root[r] = (root[r] ?? 0) * ok + v[r] * k;
      continue;
    }
    const cur = out[j];
    if (cur) {
      cur[0] = cur[0] * ok + v[0] * k;
      cur[1] = cur[1] * ok + v[1] * k;
      cur[2] = cur[2] * ok + v[2] * k;
    } else out[j] = [v[0] * k, v[1] * k, v[2] * k];
  }
  return out;
};
export { merge as addPose };

export const MOODS = {
  neutral: { y: 0, tilt: 0, open: 0.9, squint: 0, pupil: 1, smile: 0 },
  happy: { y: 0.35, tilt: 0, open: 0.8, squint: 0.35, pupil: 1, smile: 1 },
  proud: { y: 0.25, tilt: -6, open: 0.7, squint: 0.2, pupil: 1, smile: 0.8 },
  worried: { y: 0.35, tilt: 26, open: 0.95, squint: 0, pupil: 0.9, smile: -0.7 },
  scared: { y: 0.7, tilt: 22, open: 1, squint: 0, pupil: 0.65, smile: -1 },
  surprised: { y: 0.85, tilt: 4, open: 1, squint: 0, pupil: 0.7, smile: 0 },
  angry: { y: -0.35, tilt: -32, open: 0.85, squint: 0.35, pupil: 1, smile: -0.6 },
  determined: { y: -0.2, tilt: -16, open: 0.9, squint: 0.25, pupil: 1, smile: 0.1 },
  smug: {
    y: 0.2,
    tilt: -8,
    open: 0.62,
    squint: 0.15,
    pupil: 1,
    smile: 0.7,
    L: { y: 0.55 },
    R: { y: -0.1 },
  },
  sleepy: { y: -0.1, tilt: 6, open: 0.35, squint: 0.1, pupil: 1, smile: 0 },
  sad: { y: 0.2, tilt: 30, open: 0.75, squint: 0.1, pupil: 1, smile: -1 },
};
const MOUTH = {
  X: [0, 0, 0, 0],
  A: [0, 0, 0, 0],
  B: [2, 0.5, 0.3, 0],
  C: [2.2, 1, 0.3, 0],
  D: [2.6, 1.5, 0.3, 0.4],
  E: [1.6, 1.1, 0, 0.2],
  F: [1, 0.7, 0, 0],
  G: [2, 0.45, 0.4, 0],
  H: [2.2, 1.1, 0.25, 0.55],
};
export const mouthAt = (cues, s) => {
  if (!cues?.length || s < cues[0][0] - 0.06) return MOUTH.X;
  let i = -1;
  if (s >= cues[0][0]) {
    let lo = 0,
      hi = cues.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s >= cues[mid][0]) lo = mid;
      else hi = mid - 1;
    }
    i = lo;
  }
  const cur = i < 0 ? MOUTH.X : (MOUTH[cues[i][1]] ?? MOUTH.X);
  const next = cues[i + 1];
  if (!next) return cur;
  const lead = Math.min(0.06, i < 0 ? 0.06 : (next[0] - cues[i][0]) / 2);
  const k = smooth((s - (next[0] - lead)) / lead),
    to = MOUTH[next[1]] ?? MOUTH.X;
  return [
    cur[0] + (to[0] - cur[0]) * k,
    cur[1] + (to[1] - cur[1]) * k,
    cur[2] + (to[2] - cur[2]) * k,
    cur[3] + (to[3] - cur[3]) * k,
  ];
};

const flat = (color, glow = 0.12) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    emissive: color,
    emissiveIntensity: glow,
  });

const faceFrame = (root, head) => {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(),
    v = new THREE.Vector3(),
    toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isSkinnedMesh || /Layer2/.test(o.name)) return;
    const hi = o.skeleton.bones.indexOf(head),
      pos = o.geometry.attributes.position,
      si = o.geometry.attributes.skinIndex,
      sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++)
      if (si.getX(i) === hi && sw.getX(i) > 0.5)
        box.expandByPoint(o.localToWorld(o.getVertexPosition(i, v)).applyMatrix4(toRoot));
  });
  const px = (box.max.x - box.min.x) / 8,
    mid = box.getCenter(new THREE.Vector3());
  head.updateWorldMatrix(true, false);
  const localPx = px / head.getWorldScale(new THREE.Vector3()).x; // the bone is scaled (0.586): offsets are in its own units
  const toHead = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(root.matrixWorld),
  );
  const up = new THREE.Vector3(0, 1, 0).applyMatrix3(toHead).normalize(),
    right = new THREE.Vector3(1, 0, 0).applyMatrix3(toHead).normalize();
  const add = (m, x, y, z) => {
    m.position.set(mid.x + x * px, box.max.y - y * px, box.max.z + z * px);
    m.castShadow = false;
    root.add(m);
    head.attach(m);
    return m;
  };
  return { px, localPx, up, right, add, box };
};

const makeFace = (root, head, skin, glow = 0.08, faceColors = null) => {
  const { px, localPx, up, right, add } = faceFrame(root, head);
  const sampleFaceColors = (skinCtx) => {
    const s = Math.max(1, Math.round(skinCtx.canvas.width / 64));
    const patch = skinCtx.getImageData(8 * s, 8 * s, 8 * s, 8 * s).data;
    const stride = 8 * s;
    const pix = (x, y) => {
      const i = (y * s * stride + x * s) * 4;
      return new THREE.Color(`rgb(${patch[i]},${patch[i + 1]},${patch[i + 2]})`);
    };
    const skinCol = pix(1, 5);
    return {
      lidCol: faceColors?.lid ? faceColors.lid.clone() : skinCol.clone().multiplyScalar(0.9),
      irisCol: faceColors?.iris ? faceColors.iris.clone() : pix(2, 4),
      browCol: faceColors?.brow ? faceColors.brow.clone() : pix(3, 0).multiplyScalar(0.75),
      mouthCol: faceColors?.mouth ? faceColors.mouth.clone() : pix(3, 6).multiplyScalar(0.35),
    };
  };
  const initCol = sampleFaceColors(skin);
  const at = (o, base, x, y) =>
    o.position
      .copy(base)
      .addScaledVector(right, x * localPx)
      .addScaledVector(up, y * localPx);
  // All layers of the eye lie in one plane and stack by polygon offset: a gap between them let the white show over the lid when the camera looked across the face
  const layer = (m, k) =>
    Object.assign(m, {
      polygonOffset: true,
      polygonOffsetFactor: -(k + 1),
      polygonOffsetUnits: -4 * (k + 1),
    });
  // Keep near-white emissive restrained to skin glow (<= 0.08) so eyes/teeth never trip BloomEffect
  const whiteGlow = Math.min(0.08, Math.max(0, Number.isFinite(glow) ? glow : 0.08));
  const white = layer(flat(faceColors?.white ?? "#f4f4f4", whiteGlow), 0),
    iris = layer(flat(initCol.irisCol, 0.12), 1),
    dark = layer(flat("#120d1c", 0), 2),
    lid = layer(flat(initCol.lidCol, 0.1), 3);
  const W = 2,
    H = 1.25,
    Z = 0.06,
    LIP = 0.1;
  const eyes = [-1, 1].map((side) => {
    const piece = (w, h, mat) =>
      add(new THREE.Mesh(new THREE.PlaneGeometry(w * px, h * px), mat), side * 2, 4.5, Z);
    const e = {
      side,
      white: piece(W, H, white),
      iris: piece(0.95, 1, iris),
      pupil: piece(0.3, 0.32, dark),
      top: piece(W + 0.1, H, lid),
      low: piece(W + 0.1, H, lid),
    };
    // attach() gave each piece a scale that undoes the head bone's: resizing multiplies it, never replaces it
    for (const k of ["iris", "pupil", "top", "low"]) {
      e[k + "0"] = e[k].position.clone();
      e[k + "S"] = e[k].scale.clone();
    }
    return e;
  });
  const browMat = flat(initCol.browCol, 0.2);
  const brows = [-1, 1].map((side) => {
    const m = add(
      new THREE.Mesh(new THREE.BoxGeometry(2.2 * px, 0.5 * px, 0.3 * px), browMat),
      side * 2,
      3.3,
      0.2,
    );
    return { m, side, base: m.position.clone(), q: m.quaternion.clone() };
  });
  const mouthMat = layer(flat(initCol.mouthCol, 0), 0),
    teethMat = layer(flat("#efeee4", whiteGlow), 1),
    tongueMat = layer(flat("#b9534f", 0.1), 1);
  const recolor = (skinCtx) => {
    const next = sampleFaceColors(skinCtx);
    iris.color.copy(next.irisCol);
    iris.emissive.copy(next.irisCol);
    lid.color.copy(next.lidCol);
    lid.emissive.copy(next.lidCol);
    browMat.color.copy(next.browCol);
    browMat.emissive.copy(next.browCol);
    mouthMat.color.copy(next.mouthCol);
    mouthMat.emissive.copy(next.mouthCol);
  };
  const plane = (mat) => add(new THREE.Mesh(new THREE.PlaneGeometry(px, px), mat), 0, 6, Z);
  const hole = plane(mouthMat),
    teeth = plane(teethMat),
    tongue = plane(tongueMat);
  const corners = [-1, 1].map(() => plane(mouthMat));
  const line = plane(mouthMat);
  const mouth = { hole, teeth, tongue, line };
  for (const o of [...Object.values(mouth), ...corners]) {
    o.userData.p0 = o.position.clone();
    o.userData.s0 = o.scale.clone();
  }
  const rect = (o, x, y, w, h) => {
    o.visible = w > 0.05 && h > 0.05;
    if (!o.visible) return;
    o.scale.set(o.userData.s0.x * w, o.userData.s0.y * h, o.userData.s0.z);
    at(o, o.userData.p0, x, -(y - 6));
  };
  const rot = new THREE.Quaternion(),
    fwdAxis = new THREE.Vector3().crossVectors(right, up).normalize();
  const meshes = [
    ...eyes.flatMap((e) => [e.white, e.iris, e.pupil, e.top, e.low]),
    ...brows.map((b) => b.m),
    hole,
    teeth,
    tongue,
    line,
    ...corners,
  ];
  return Object.assign(
    (mood, m, blink, look) => {
      const gx = Math.max(-1, Math.min(1, look[0])),
        gy = Math.max(-1, Math.min(1, look[1]));
      const lx = gx * 0.5,
        ly = gy * 0.12;
      for (const e of eyes) {
        const ov = mood[e.side < 0 ? "R" : "L"];
        const pupil = ov?.pupil ?? mood.pupil;
        const open = ov?.open ?? mood.open;
        const squint = ov?.squint ?? mood.squint;
        at(e.iris, e.iris0, lx, ly);
        at(e.pupil, e.pupil0, lx, ly);
        e.pupil.scale.copy(e.pupilS).multiplyScalar(pupil);
        const cover = Math.min(1, Math.max(1 - open, blink)),
          under = squint * 0.45 * (1 - cover);
        // each lid reaches LIP past the white, so no sliver of white shows round its edge from a low or high camera
        const top = cover * H + LIP,
          low = under * H + LIP;
        e.top.visible = cover > 0.01;
        e.top.scale.y = (e.topS.y * top) / H;
        at(e.top, e.top0, 0, H / 2 + LIP - top / 2);
        e.low.visible = under > 0.01;
        e.low.scale.y = (e.lowS.y * low) / H;
        at(e.low, e.low0, 0, -H / 2 - LIP + low / 2);
      }
      for (const b of brows) {
        const ov = mood[b.side < 0 ? "R" : "L"];
        const by = ov?.y ?? mood.y;
        const tilt = ov?.tilt ?? mood.tilt;
        b.m.position.copy(b.base).addScaledVector(up, (by - 0.3 * blink) * localPx);
        rot.setFromAxisAngle(fwdAxis, -b.side * tilt * D);
        b.m.quaternion.copy(rot).multiply(b.q);
      }
      const [w, h, th, tg] = m,
        smile = mood.smile;
      rect(hole, 0, 6 + h / 2, w, h);
      rect(teeth, 0, 6 + th / 2, w * 0.9, Math.min(th, h));
      rect(tongue, 0, 6 + h - tg / 2, w * 0.7, Math.min(tg, h));
      const shut = h < 0.2,
        lw = 2,
        cw = Math.max(w, lw) / 2 + 0.25,
        cSize = Math.abs(smile) > 0.15 ? 0.5 : 0,
        cy = 6.55 - smile * 0.45;
      rect(line, 0, 6.55, shut && Math.abs(smile) > 0.15 ? lw : 0, 0.35);
      rect(corners[0], -cw, cy, cSize, cSize);
      rect(corners[1], cw, cy, cSize, cSize);
    },
    {
      meshes,
      recolor,
      white,
      show: (on) => {
        for (const m of [white, iris, dark, lid, browMat, mouthMat, teethMat, tongueMat])
          m.visible = on;
      },
    },
  );
};

const EYE = (x, y) => y === 4 && (x === 1 || x === 2 || x === 5 || x === 6);
export const FACES = [
  { id: "noeyes", title: "no eyes, skin over them", colour: (x, y) => (EYE(x, y) ? 0.95 : null) },
  { id: "closed", title: "eyes shut, mouth shut", hold: [MOODS.neutral, [0, 0, 0, 0], 1, [0, 0]] },
  { id: "holes", title: "no eyes, black holes", colour: (x, y) => (EYE(x, y) ? 0.03 : null) },
  { id: "game", title: "game face (eyes, brows, mouth)" },
  { id: "skin", title: "the skin's own face, nothing over it" },
];
const PART_LAYERS = {
  head: ["head", "hat"],
  body: ["body", "jacket"],
  armR: ["armR", "sleeveR"],
  armL: ["armL", "sleeveL"],
  legR: ["legR", "pantR"],
  legL: ["legL", "pantL"],
};
const skinRects = (ctx, box) => {
  const s = Math.max(1, Math.round(ctx.canvas.width / 64));
  return Object.values(box).map(([x, y, w, h]) => [x * s, y * s, w * s, h * s]);
};
const tintSkin = (ctx, tint) => {
  for (const [box, hex] of tint)
    for (const [x, y, w, h] of skinRects(ctx, box)) {
      const img = ctx.getImageData(x, y, w, h),
        d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.round((d[i] * ((hex >> 16) & 255)) / 255);
        d[i + 1] = Math.round((d[i + 1] * ((hex >> 8) & 255)) / 255);
        d[i + 2] = Math.round((d[i + 2] * (hex & 255)) / 255);
      }
      ctx.putImageData(img, x, y);
    }
};
const hideSkinParts = (ctx, shown) => {
  for (const [part, layers] of Object.entries(PART_LAYERS))
    if (!shown.has(part))
      for (const k of layers)
        for (const [x, y, w, h] of skinRects(ctx, SKIN_UV[k])) ctx.clearRect(x, y, w, h);
};

const paintFacePixels = (ctx, baseCtx, f) => {
  if (!f.colour) return;
  const s = Math.max(1, Math.round(baseCtx.canvas.width / 64));
  const d = baseCtx.getImageData(9 * s, 11 * s, 1, 1).data;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const k = f.colour(x, y);
      if (k == null) continue;
      ctx.fillStyle = `rgb(${(d[0] * k) | 0},${(d[1] * k) | 0},${(d[2] * k) | 0})`;
      ctx.fillRect((8 + x) * s, (8 + y) * s, s, s);
    }
};

export const centroidUv = (m) => {
  const cen = (c) => c.replace(/varying vec2 (vMapUv|vEmissiveMapUv)/g, "centroid varying vec2 $1");
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace(
      "#include <uv_pars_vertex>",
      cen(THREE.ShaderChunk.uv_pars_vertex),
    );
    s.fragmentShader = s.fragmentShader.replace(
      "#include <uv_pars_fragment>",
      cen(THREE.ShaderChunk.uv_pars_fragment),
    );
  };
  m.customProgramCacheKey = () => "centroid-uv";
  return m;
};

export type FaceColorValue =
  string | number | { readonly isColor: true; r: number; g: number; b: number };

export interface FaceColorOverrides {
  white?: FaceColorValue | null;
  lid?: FaceColorValue | null;
  iris?: FaceColorValue | null;
  brow?: FaceColorValue | null;
  mouth?: FaceColorValue | null;
}

export async function makePlayer(
  template,
  skinUrl,
  {
    glow = 0.08,
    face: initialFace = "game",
    faceColors,
  }: { glow?: number; face?: string; faceColors?: FaceColorOverrides | null } = {},
) {
  const savedFaceColors = faceColors
    ? {
        white: faceColors.white != null ? new THREE.Color(faceColors.white) : null,
        lid: faceColors.lid != null ? new THREE.Color(faceColors.lid) : null,
        iris: faceColors.iris != null ? new THREE.Color(faceColors.iris) : null,
        brow: faceColors.brow != null ? new THREE.Color(faceColors.brow) : null,
        mouth: faceColors.mouth != null ? new THREE.Color(faceColors.mouth) : null,
      }
    : null;
  const initMeta = FACES.find((f) => f.id === initialFace);
  if (!initMeta)
    throw new Error(`no face "${initialFace}" (FACES: ${FACES.map((f) => f.id).join(", ")})`);
  const img = typeof skinUrl === "string" ? await loadImage(skinUrl) : skinUrl;
  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = img.width;
  baseCanvas.height = img.height;
  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
  baseCtx.drawImage(img, 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const skinTex = (c) => {
    const t = new THREE.CanvasTexture(c);
    Object.assign(t, {
      flipY: false, // the rig's UVs are glTF's, top-left origin
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      generateMipmaps: false,
      colorSpace: THREE.SRGBColorSpace,
    });
    return t;
  };
  let faceId = initialFace;
  let overlayFn = null;
  let tint = null,
    shown = null,
    gameFace = null;
  let liveMap = skinTex(canvas);
  const redrawSkin = () => {
    const f = FACES.find((x) => x.id === faceId);
    ctx.save?.();
    try {
      if ("globalAlpha" in ctx) ctx.globalAlpha = 1;
      if ("globalCompositeOperation" in ctx) ctx.globalCompositeOperation = "source-over";
      ctx.clearRect?.(0, 0, canvas.width, canvas.height);
      ctx.drawImage(baseCanvas, 0, 0);
      if (f?.colour) paintFacePixels(ctx, baseCtx, f);
      if (tint) tintSkin(ctx, tint);
      if (overlayFn) {
        ctx.save?.();
        try {
          if ("globalAlpha" in ctx) ctx.globalAlpha = 1;
          if ("globalCompositeOperation" in ctx) ctx.globalCompositeOperation = "source-over";
          overlayFn(ctx, canvas.width, canvas.height);
        } finally {
          ctx.restore?.();
        }
      }
      if (shown) hideSkinParts(ctx, shown);
    } finally {
      ctx.restore?.();
    }
    liveMap.needsUpdate = true;
    gameFace?.recolor(ctx);
  };
  redrawSkin();
  const look = {
    map: liveMap,
    roughness: 0.9,
    emissive: 0xffffff,
    emissiveMap: liveMap,
    emissiveIntensity: glow,
  };
  const inner = centroidUv(new THREE.MeshStandardMaterial(look));
  const outer = centroidUv(
    new THREE.MeshStandardMaterial({ ...look, alphaTest: 0.5, side: THREE.DoubleSide }),
  );

  const rig = cloneSkinned(template);
  rig.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.material = /Layer2/.test(o.name) ? outer : inner;
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  const g = new THREE.Group();
  g.add(rig);
  const all = {};
  rig.traverse((o) => {
    if (o.isBone) all[o.name] = o;
  });
  const b = Object.fromEntries(Object.entries(BONES).map(([k, n]) => [k, all[n]]));
  for (const [k, v] of Object.entries(b))
    if (!v)
      throw new Error(`player.glb has no bone ${BONES[k]} (has ${Object.keys(all).join(", ")})`);
  g.updateMatrixWorld(true);
  const rest = {};
  for (const [k, bone] of Object.entries(b)) {
    const C = bone.getWorldQuaternion(new THREE.Quaternion());
    const Ci = C.clone().invert();
    rest[k] = {
      q: bone.quaternion.clone(),
      p: bone.position.clone(),
      C,
      Ci,
      qCi: bone.quaternion.clone().multiply(Ci),
    };
  }
  b.root.parent.updateWorldMatrix(true, false);
  const rootIn = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().copy(b.root.parent.matrixWorld).invert(),
  );
  const ensureGameFace = () => {
    if (gameFace) return gameFace;
    gameFace = makeFace(rig, b.head, ctx, glow, savedFaceColors);
    gameFace.show(!shown || shown.has("head"));
    return gameFace;
  };
  if (initialFace === "game") ensureGameFace();
  const setFace = (id) => {
    const f = FACES.find((x) => x.id === id);
    if (!f) throw new Error(`no face "${id}" (FACES: ${FACES.map((x) => x.id).join(", ")})`);
    faceId = id;
    redrawSkin();
    if (id === "game" || f.hold || gameFace) {
      const gf = ensureGameFace();
      for (const o of gf.meshes) o.visible = id === "game" || !!f.hold;
      if (f.hold) gf(...f.hold);
    }
  };
  const setSkin = (imageOrCanvas) => {
    if (!imageOrCanvas || !(imageOrCanvas.width > 0) || !(imageOrCanvas.height > 0)) {
      throw new Error("setSkin requires an image or canvas with positive width and height");
    }
    const w = imageOrCanvas.width;
    const h = imageOrCanvas.height;
    if (baseCanvas.width !== w || baseCanvas.height !== h) {
      baseCanvas.width = w;
      baseCanvas.height = h;
    }
    baseCtx.save?.();
    try {
      if ("globalAlpha" in baseCtx) baseCtx.globalAlpha = 1;
      if ("globalCompositeOperation" in baseCtx) baseCtx.globalCompositeOperation = "source-over";
      baseCtx.clearRect?.(0, 0, w, h);
      baseCtx.drawImage(imageOrCanvas, 0, 0);
    } finally {
      baseCtx.restore?.();
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      const prevMap = liveMap;
      liveMap = skinTex(canvas);
      for (const m of [inner, outer]) {
        m.map = m.emissiveMap = liveMap;
        m.needsUpdate = true;
      }
      prevMap.dispose();
    }
    redrawSkin();
  };
  const paintSkinOverlay = (drawFn) => {
    overlayFn = typeof drawFn === "function" ? drawFn : null;
    redrawSkin();
  };
  const tintParts = (parts) => {
    for (const k of Object.keys(parts ?? {}))
      if (!SKIN_UV[k])
        throw new Error(`tintParts: no part "${k}" (SKIN_UV: ${Object.keys(SKIN_UV).join(", ")})`);
    const list = Object.entries(parts ?? {}).filter(([, c]) => c != null);
    tint = list.length ? list.map(([k, c]) => [SKIN_UV[k], new THREE.Color(c).getHex()]) : null;
    redrawSkin();
  };
  const showParts = (parts) => {
    for (const k of parts ?? [])
      if (!PART_LAYERS[k])
        throw new Error(`showParts: no part "${k}" (${Object.keys(PART_LAYERS).join(", ")})`);
    shown = parts ? new Set(parts) : null;
    const cut = shown ? 0.5 : 0;
    if (inner.alphaTest !== cut) {
      inner.alphaTest = cut;
      inner.needsUpdate = true;
    }
    gameFace?.show(!shown || shown.has("head"));
    redrawSkin();
  };
  if (initMeta.hold) ensureGameFace()(...initMeta.hold);
  const face = (...a) => {
    if (faceId === "game") ensureGameFace()(...a);
  };
  const hand = new THREE.Group();
  hand.name = "handR"; // so live-studio's --check motion:handR,from,to finds it
  hand.position.set(-6 * PX, 12 * PX, 2 * PX);
  rig.add(hand);
  b.laR.attach(hand);
  const handL = new THREE.Group();
  handL.name = "handL";
  handL.position.set(6 * PX, 12 * PX, 2 * PX);
  rig.add(handL);
  b.laL.attach(handL);
  const holdProp = (side, mesh, opts) => {
    const { pos, rot } = opts ?? {};
    const parent = side === "L" ? handL : side === "R" ? hand : null;
    if (!parent) throw new Error(`holdProp side must be "R" or "L", got ${JSON.stringify(side)}`);
    const prevParent = mesh?.parent;
    const wrist = new THREE.Group();
    wrist.name = `wrist${side}`;
    if (pos) wrist.position.set(pos[0], pos[1], pos[2]);
    if (rot) wrist.rotation.set(rot[0], rot[1], rot[2]);
    if (mesh) {
      wrist.add(mesh);
      if (
        prevParent &&
        (prevParent.parent === hand || prevParent.parent === handL) &&
        (prevParent.name === "wristR" || prevParent.name === "wristL") &&
        prevParent.children.length === 0
      ) {
        prevParent.removeFromParent();
      }
    }
    parent.add(wrist);
    return wrist;
  };
  const restAt = (bone) => bone.getWorldPosition(new THREE.Vector3());
  const ARM = Object.fromEntries(
    ["L", "R"].map((sd) => {
      const S0 = restAt(b[`ua${sd}`]),
        E0 = restAt(b[`la${sd}`]);
      const end = 12 * PX - 0.02;
      return [sd, { L1: S0.distanceTo(E0), L2: Math.max(0.05, E0.y - end) }];
    }),
  );
  const LEGS = Object.fromEntries(
    ["L", "R"].map((sd) => {
      const H0 = restAt(b[`ul${sd}`]),
        K0 = restAt(b[`ll${sd}`]);
      return [
        sd,
        {
          L1: H0.distanceTo(K0),
          L2: K0.y,
          sole: b[`ll${sd}`].worldToLocal(new THREE.Vector3(K0.x, 0, K0.z)),
        },
      ];
    }),
  );
  const parentRest = Object.fromEntries(
    ["uaL", "uaR", "ulL", "ulR", "head"].map((k) => [
      k,
      b[k].parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
    ]),
  );

  const boneEntries = Object.entries(b);
  const rotRoot = [0, 0, 0];
  const R = new THREE.Quaternion(),
    T = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3();
  const jointQuat = (k, a) => {
    R.setFromEuler(e.set(a[0] * D, a[1] * D, a[2] * D, "YXZ"));
    return T.copy(rest[k].qCi).multiply(R).multiply(rest[k].C);
  };
  // Each bone's turn is worked out in T and set once: three re-derives .rotation on every change to .quaternion, which was
  // most of a mocap bake's setPose
  const setPose = (pose) => {
    const r = pose.root ?? {};
    for (let i = 0; i < boneEntries.length; i++) {
      const [k, bone] = boneEntries[i];
      let a;
      if (k === "root") {
        if (r.rx || r.ry || r.rz) {
          rotRoot[0] = r.rx ?? 0;
          rotRoot[1] = r.ry ?? 0;
          rotRoot[2] = r.rz ?? 0;
          a = rotRoot;
        } else a = null;
      } else a = pose[k];
      const rq = rest[k].q;
      if (a) bone.quaternion.copy(jointQuat(k, a));
      else {
        const bq = bone.quaternion;
        if (bq.x !== rq.x || bq.y !== rq.y || bq.z !== rq.z || bq.w !== rq.w) bq.copy(rq);
      }
      bone.position.copy(rest[k].p);
    }
    v.set(r.x ?? 0, r.y ?? 0, r.z ?? 0).applyMatrix3(rootIn);
    b.root.position.copy(rest.root.p).add(v);
  };
  const fastLegsOk =
    !!b.root?.parent &&
    b.ulL.parent === b.root &&
    b.ulR.parent === b.root &&
    b.llL.parent === b.ulL &&
    b.llR.parent === b.ulR;
  const rootParentLocal = b.root.parent ? b.root.parent.matrixWorld.clone() : new THREE.Matrix4();
  const rigRestInv = rig.matrix.clone().invert();
  const rootParentInRig = rigRestInv.clone().multiply(rootParentLocal);
  const UP = new THREE.Vector3(0, 1, 0);
  const gPos = new THREE.Vector3(),
    gQuat = new THREE.Quaternion(),
    legPos = new THREE.Vector3();
  const mG = new THREE.Matrix4(),
    mRoot = new THREE.Matrix4(),
    mBone = new THREE.Matrix4(),
    mUl = new THREE.Matrix4(),
    mLl = new THREE.Matrix4();
  const legsAt = (at, yawDeg, pose, wantL, wantR, hipL, hipR, off) => {
    const r = pose.root ?? {};
    gPos.set(at[0], at[1], at[2]);
    gQuat.setFromAxisAngle(UP, yawDeg * D);
    mG.compose(gPos, gQuat, g.scale);
    if (g.parent) mG.premultiply(g.parent.matrixWorld);
    if (rig.matrixAutoUpdate) rig.updateMatrix();
    mRoot.multiplyMatrices(mG, rig.matrix).multiply(rootParentInRig);
    const rootQ =
      r.rx || r.ry || r.rz
        ? jointQuat(
            "root",
            ((rotRoot[0] = r.rx ?? 0), (rotRoot[1] = r.ry ?? 0), (rotRoot[2] = r.rz ?? 0), rotRoot),
          )
        : rest.root.q;
    v.set(r.x ?? 0, r.y ?? 0, r.z ?? 0).applyMatrix3(rootIn);
    legPos.copy(rest.root.p).add(v);
    mBone.compose(legPos, rootQ, b.root.scale);
    mRoot.multiply(mBone);
    const doLeg = (ulK, llK, sole, wOut, hOut) => {
      const ua = pose[ulK];
      mBone.compose(rest[ulK].p, ua ? jointQuat(ulK, ua) : rest[ulK].q, b[ulK].scale);
      mUl.multiplyMatrices(mRoot, mBone);
      const ue = mUl.elements;
      hOut[off] = ue[12];
      hOut[off + 1] = ue[13];
      hOut[off + 2] = ue[14];
      const la = pose[llK];
      mBone.compose(rest[llK].p, la ? jointQuat(llK, la) : rest[llK].q, b[llK].scale);
      mLl.multiplyMatrices(mUl, mBone);
      v.copy(sole).applyMatrix4(mLl);
      wOut[off] = v.x;
      wOut[off + 1] = v.y;
      wOut[off + 2] = v.z;
    };
    doLeg("ulL", "llL", LEGS.L.sole, wantL, hipL);
    doLeg("ulR", "llR", LEGS.R.sole, wantR, hipR);
  };
  const Q = new THREE.Quaternion(),
    Qi = new THREE.Quaternion(),
    S = new THREE.Vector3(),
    d = new THREE.Vector3();
  const pole = new THREE.Vector3(),
    tx = new THREE.Vector3(),
    ty = new THREE.Vector3(),
    tz = new THREE.Vector3(),
    M = new THREE.Matrix4(),
    e2 = new THREE.Euler();
  const M_actor = new THREE.Matrix4(),
    GInv = new THREE.Matrix4(),
    MLoc = new THREE.Matrix4(),
    tmpP = new THREE.Vector3(),
    tmpS = new THREE.Vector3();
  const actorInv = () => {
    M_actor.multiplyMatrices(rig.matrixWorld, rigRestInv);
    return Math.abs(M_actor.determinant()) > 1e-12 ? GInv.copy(M_actor).invert() : null;
  };
  const localQuat = (obj, inv, out) => {
    MLoc.multiplyMatrices(inv, obj.matrixWorld).decompose(tmpP, out, tmpS);
    return out;
  };
  const parentTurnLocal = (k, inv) => localQuat(b[k].parent, inv, Q).multiply(parentRest[k]);
  const armTo = (sd, target, pole = null) => {
    const { L1, L2 } = ARM[sd],
      k = `ua${sd}`;
    b[k].updateWorldMatrix(true, false);
    const inv = actorInv();
    if (!inv) return { [k]: [0, 0, 0], [`la${sd}`]: [0, 0, 0] };
    S.setFromMatrixPosition(b[k].matrixWorld).applyMatrix4(inv);
    d.copy(target)
      .applyMatrix4(inv)
      .sub(S)
      .applyQuaternion(Qi.copy(parentTurnLocal(k, inv)).invert());
    if (pole) return armPole(sd, d, pole, L1, L2);
    const len = d.length();
    const n = THREE.MathUtils.clamp(len, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    if (len < 1e-6) d.set(0, -1, 0);
    else d.divideScalar(len);
    const e =
      Math.PI -
      Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - n * n) / (2 * L1 * L2), -1, 1));
    const wy = -(L1 + L2 * Math.cos(e)) / n,
      wz = (L2 * Math.sin(e)) / n;
    const g = Math.asin(THREE.MathUtils.clamp(d.x / -wy, -1, 1));
    const y = wy * Math.cos(g),
      z = wz;
    // wrapped to +-180: a hand behind him comes out as -324 instead of +36, the same arm, but blending it with the pose's own
    // arm (a hand key going to null) would swing it the long way round, over his head
    const a =
      THREE.MathUtils.euclideanModulo(
        Math.atan2(d.z, d.y) - Math.atan2(z, y) + Math.PI,
        2 * Math.PI,
      ) - Math.PI;
    return { [`ua${sd}`]: [a / D, 0, g / D], [`la${sd}`]: [-e / D, 0, 0] };
  };
  const U = new THREE.Vector3(),
    B = new THREE.Vector3(),
    F = new THREE.Vector3(),
    P = new THREE.Vector3(),
    M0 = new THREE.Matrix4(),
    M1 = new THREE.Matrix4();
  const HANG = new THREE.Vector3(0, -1, 0),
    FWD = new THREE.Vector3(0, 0, 1),
    SIDE = new THREE.Vector3().crossVectors(HANG, FWD);
  const PQ = new THREE.Quaternion(),
    PE = new THREE.Euler();
  M0.makeBasis(HANG, FWD, SIDE);
  const armPole = (sd, dd, pole, L1, L2) => {
    const len = dd.length();
    const n = THREE.MathUtils.clamp(len, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const dh = len < 1e-6 ? new THREE.Vector3(0, -1, 0) : dd.clone().divideScalar(len);
    P.set(...pole)
      .addScaledVector(dh, -P.set(...pole).dot(dh))
      .normalize();
    const cosA = THREE.MathUtils.clamp((L1 * L1 + n * n - L2 * L2) / (2 * L1 * n), -1, 1);
    U.copy(dh)
      .multiplyScalar(cosA)
      .addScaledVector(P, Math.sqrt(1 - cosA * cosA));
    const e =
      Math.PI -
      Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - n * n) / (2 * L1 * L2), -1, 1));
    F.copy(dh).multiplyScalar(n).addScaledVector(U, -L1).normalize();
    B.copy(F).addScaledVector(U, -F.dot(U));
    if (B.lengthSq() < 1e-8) B.copy(P).addScaledVector(U, -P.dot(U)).negate();
    B.normalize();
    M1.makeBasis(U, B, new THREE.Vector3().crossVectors(U, B));
    PQ.setFromRotationMatrix(M1.multiply(M0.clone().transpose()));
    PE.setFromQuaternion(PQ, "YXZ");
    return { [`ua${sd}`]: [PE.x / D, PE.y / D, PE.z / D], [`la${sd}`]: [-e / D, 0, 0] };
  };
  const legTo = (sd, target) => {
    const { L1, L2 } = LEGS[sd],
      k = `ul${sd}`;
    b[`ll${sd}`].updateWorldMatrix(true, false);
    const inv = actorInv();
    if (!inv) return { [k]: [0, 0, 0], [`ll${sd}`]: [0, 0, 0] };
    S.setFromMatrixPosition(b[k].matrixWorld).applyMatrix4(inv);
    Qi.copy(parentTurnLocal(k, inv)).invert();
    d.copy(target).applyMatrix4(inv).sub(S).applyQuaternion(Qi);
    R.copy(Qi)
      .multiply(localQuat(b[k], inv, Q))
      .multiply(rest[k].Ci);
    tx.set(1, 0, 0).applyQuaternion(R);
    soleNow(sd, ty).applyMatrix4(inv).sub(S).applyQuaternion(Qi).normalize();
    const len = d.length();
    const n = THREE.MathUtils.clamp(len, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    if (len < 1e-6) d.set(0, -1, 0);
    else d.divideScalar(len);
    tx.applyQuaternion(R.setFromUnitVectors(ty, d));
    const e =
      Math.PI -
      Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - n * n) / (2 * L1 * L2), -1, 1));
    const al = Math.acos(THREE.MathUtils.clamp((L1 * L1 + n * n - L2 * L2) / (2 * L1 * n), -1, 1));
    pole.crossVectors(d, tx);
    if (pole.lengthSq() < 1e-6) pole.set(0, 0, 1).addScaledVector(d, -d.z);
    pole.normalize();
    ty.copy(d).multiplyScalar(-Math.cos(al)).addScaledVector(pole, -Math.sin(al));
    tz.copy(pole).multiplyScalar(Math.cos(al)).addScaledVector(d, -Math.sin(al));
    tx.crossVectors(ty, tz);
    e2.setFromRotationMatrix(M.makeBasis(tx, ty, tz), "YXZ");
    return { [k]: [e2.x / D, e2.y / D, e2.z / D], [`ll${sd}`]: [e / D, 0, 0] };
  };
  const soleAt = (sd, out = new THREE.Vector3()) =>
    b[`ll${sd}`].localToWorld(out.copy(LEGS[sd].sole));
  const soleNow = (sd, out = new THREE.Vector3()) =>
    out.copy(LEGS[sd].sole).applyMatrix4(b[`ll${sd}`].matrixWorld);
  const updateBones = updaterTo(g, Object.values(b));
  const baseLegReach = LEGS.L.L1 + LEGS.L.L2;
  const legReachNow = () => {
    rig.updateWorldMatrix(true, false);
    M_actor.multiplyMatrices(rig.matrixWorld, rigRestInv);
    return baseLegReach * tmpS.setFromMatrixColumn(M_actor, 1).length();
  };
  const headTo = (target) => {
    b.head.updateWorldMatrix(true, false);
    const inv = actorInv();
    if (!inv) return [0, 0, 0];
    S.setFromMatrixPosition(b.head.matrixWorld).applyMatrix4(inv);
    d.copy(target)
      .applyMatrix4(inv)
      .sub(S)
      .applyQuaternion(Qi.copy(parentTurnLocal("head", inv)).invert());
    d.y -= 4 * PX;
    const yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z) / D, -75, 75);
    const down = THREE.MathUtils.clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)) / D, -40, 42);
    return [down, yaw, 0];
  };
  const eyeWhite = (c = null) => {
    const w = ensureGameFace().white;
    w.color.set(c ?? savedFaceColors?.white ?? "#f4f4f4");
    w.emissive.copy(w.color);
  };
  const red = (on) => {
    for (const m of [inner, outer]) {
      m.color.setRGB(1, on ? 0.45 : 1, on ? 0.45 : 1);
      m.emissive.setRGB(1, on ? 0.3 : 1, on ? 0.3 : 1);
    }
  };
  const legsSig = () => {
    rig.updateWorldMatrix(true, false);
    const parts = [`${g.scale.x},${g.scale.y},${g.scale.z}`];
    if (g.parent) parts.push(`p:${g.parent.matrixWorld.elements.join(",")}`);
    parts.push(`r:${rig.matrix.elements.join(",")}`);
    for (const n of rootParentLocal.elements) parts.push(String(n));
    for (const k of ["root", "ulL", "ulR", "llL", "llR"]) {
      const rk = rest[k],
        s = b[k].scale;
      parts.push(
        `${k}:${rk.p.x},${rk.p.y},${rk.p.z},${rk.q.x},${rk.q.y},${rk.q.z},${rk.q.w},${s.x},${s.y},${s.z}`,
      );
    }
    parts.push(
      `${LEGS.L.sole.x},${LEGS.L.sole.y},${LEGS.L.sole.z},${LEGS.R.sole.x},${LEGS.R.sole.y},${LEGS.R.sole.z}`,
    );
    return parts.join("|");
  };
  return {
    g,
    rig,
    bones: b,
    setPose,
    legsAt: fastLegsOk ? legsAt : null,
    legsSig,
    updateBones,
    face,
    hand,
    handR: hand,
    handL,
    holdProp,
    armTo,
    legTo,
    soleAt,
    soleNow,
    restLegReach: baseLegReach,
    get legReach() {
      return legReachNow();
    },
    headTo,
    skin: ctx,
    setSkin,
    paintSkinOverlay,
    eyeWhite,
    tintParts,
    showParts,
    red,
    setFace,
  };
}
