// @ts-nocheck
// The players: MCprep's Simple Player rig (BoxScape Studios + TheDuckCow, CC-BY 3.0; assets/public/rig/player.glb), one
// SkeletonUtils clone per character with its own skin. It is the real 32 px tall player (1.875 blocks, feet at y 0, facing +z)
// with 13 joints: center (hips), Body (waist), Chest, Head, and upper/lower bones for each arm and leg, so elbows and knees
// bend. Every frame starts from the rest pose and is posed from film time only, so any frame seeks.
// Rotations are given in the character's own frame (x = his left, y = up, z = forward) in degrees; a child joint turns
// with its parent, as in any FK rig.
// The rig has no face bones: eyes (lids, iris, pupil), brows and a mouth float a hair off the head and ride the Head
// bone, the way Minecraft animation rigs build faces. Mouth shapes are Rhubarb Lip Sync's A-H and X (this film's
// narrator is off screen: Steve's mouth stays shut).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { clamp01, smooth } from "./ease";

export const PX = 1.875 / 32; // one skin pixel at the size the game draws a player
const D = Math.PI / 180;
const LEG = 6 * PX; // thigh and shin are each half of the 12 px leg
// GLTFLoader strips ":" from node names (PropertyBinding.sanitizeNodeName), so "Arm:Left:Upper" is "ArmLeftUpper"
const BONES = { root: "center", body: "Body", chest: "Chest", head: "Head", uaL: "ArmLeftUpper", laL: "ArmLeftLower", uaR: "ArmRightUpper", laR: "ArmRightLower", ulL: "LegLeftUpper", llL: "LegLeftLower", ulR: "LegRightUpper", llR: "LegRightLower" };

export const loadRig = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("skin " + url)); i.src = url; });

// ---- poses: {joint: [x, y, z]} in degrees, plus root: {y, x, z (metres), rx, ry, rz (degrees)} ----
// arm(fwd, out, twist, elbow): fwd raises it to the front, out lifts it to his side, elbow bends the forearm forward
export const arm = (side, fwd = 0, out = 0, twist = 0, elbow = 0) => ({ [`ua${side}`]: [-fwd, twist * (side === "L" ? 1 : -1), out * (side === "L" ? 1 : -1)], [`la${side}`]: [-elbow, 0, 0] });
// leg(fwd, out, knee): fwd kicks it forward, knee bends the shin back
export const leg = (side, fwd = 0, out = 0, knee = 0) => ({ [`ul${side}`]: [-fwd, 0, out * (side === "L" ? 1 : -1)], [`ll${side}`]: [knee, 0, 0] });
// Squat with both feet planted: thighs forward by a, shins back by 2a, hips drop by exactly the legs' lost height
export const squat = (a) => ({ ...leg("L", a, 4, 2 * a), ...leg("R", a, 4, 2 * a), root: { y: -2 * LEG * (1 - Math.cos(a * D)) } });
const merge = (...ps) => {
  const out = { root: {} };
  for (const p of ps) for (const [k, v] of Object.entries(p)) {
    if (k === "root") { for (const [a, b] of Object.entries(v)) out.root[a] = (out.root[a] ?? 0) + b; continue; }
    out[k] = out[k] ? out[k].map((x, i) => x + v[i]) : v.slice();
  }
  return out;
};

// One gesture at local time s (seconds since it started) and progress u (0..1 of its length)
export const GESTURES = {
  idle: () => ({}),
  stomach: () => merge(arm("L", 28, -26, 0, 78), arm("R", 28, -26, 0, 78), { chest: [12, 0, 0], head: [16, 0, 0] }),
  wave: (s) => merge(arm("R", 15, 150, 10, 25), { laR: [0, 0, 28 * Math.sin(s * 9)], head: [-4, 0, 6] }),
  swing: (s, u) => {
    // wind-up, strike, follow-through: the right arm comes over the top while the chest turns into it
    const up = smooth(u / 0.35), hit = smooth((u - 0.35) / 0.25);
    const fwd = 150 * up - 175 * hit;
    return merge(arm("R", fwd, 10, 0, 25 - 15 * hit), { chest: [-8 * up + 14 * hit, 22 * up - 45 * hit, 0], body: [0, 10 * up - 20 * hit, 0], head: [-6 * up, -10 * up + 20 * hit, 0] }, leg("L", 12 * hit, 0, 10 * hit));
  },
  eat: (s) => merge(arm("R", 70, -25, 30, 115 + 6 * Math.sin(s * 16)), { head: [-6, 0, 0] }),
  point: () => merge(arm("R", 88, 4, 0, 4), { chest: [0, -8, 0], head: [0, -8, 0] }),
  cheer: (s) => merge(arm("L", 20, 155, 0, 15 + 10 * Math.sin(s * 8)), arm("R", 20, 155, 0, 15 + 10 * Math.sin(s * 8 + 1)), { head: [-12, 0, 0], root: { y: 0.28 * Math.abs(Math.sin(s * 4.2)) } }),
  shrug: () => merge(arm("L", 18, 28, 45, 85), arm("R", 18, 28, 45, 85), { chest: [-4, 0, 0], head: [0, 0, 12] }),
  facepalm: () => merge(arm("R", 72, -32, 20, 128), { head: [18, 0, 0], chest: [8, 0, 0] }),
  think: () => merge(arm("R", 42, -22, 15, 138), arm("L", 25, -18, 0, 95), { head: [-6, 10, 8] }),
  scared: () => merge(arm("L", 62, -8, 0, 95), arm("R", 62, -8, 0, 95), { body: [-10, 0, 0], head: [-6, 0, 0] }, squat(14)),
  peek: () => merge({ body: [0, 0, -22], head: [0, 10, 18] }, arm("L", 25, 30, 0, 40)),
  craft: (s) => merge(arm("L", 55, -10, 0, 40 + 14 * Math.max(0, Math.sin(s * 10))), arm("R", 55, -10, 0, 40 + 14 * Math.max(0, Math.sin(s * 10 + Math.PI))), { head: [28, 0, 0], chest: [10, 0, 0] }),
  carry: () => merge(arm("L", 55, -12, 0, 35), arm("R", 55, -12, 0, 35), { body: [-4, 0, 0] }),
  place: (s, u) => merge(arm("R", 70 - 40 * smooth(u), 0, 0, 20), squat(25 * Math.sin(u * Math.PI)), { chest: [25 * Math.sin(u * Math.PI), 0, 0], head: [20, 0, 0] }),
  crouch: () => merge(squat(80), { body: [24, 0, 0], head: [-14, 0, 0] }, arm("L", 32, 6, 0, 30), arm("R", 32, 6, 0, 30)),
  pet: (s) => merge(squat(80), { body: [30, 0, 0], head: [8, 0, 0] }, arm("R", 70 + 6 * Math.sin(s * 6), -10, 0, 25), arm("L", 20, 10, 0, 30)),
  sit: () => merge(leg("L", 88, 6, 0), leg("R", 88, 6, 0), { root: { y: -2 * LEG + 2 * PX }, body: [6, 0, 0] }, arm("L", 25, 20, 0, 30), arm("R", 25, 20, 0, 30)),
  lie: () => ({ root: { rx: -90, y: -(12 * PX - 2 * PX) }, head: [-15, 0, 0] }),
  jump: (s, u) => { const k = Math.sin(u * Math.PI); return merge({ root: { y: 0.9 * k } }, leg("L", 40 * k, 0, 70 * k), leg("R", 40 * k, 0, 70 * k), arm("L", -20 * k, 40 * k, 0, 20), arm("R", -20 * k, 40 * k, 0, 20)); },
  hips: () => merge(arm("L", -10, 38, 80, 105), arm("R", -10, 38, 80, 105), { chest: [-4, 0, 0] }),
  nod: (s) => ({ head: [14 * Math.max(0, Math.sin(s * 9)), 0, 0] }),
  shake: (s) => ({ head: [4, 24 * Math.sin(s * 11), 0] }),
  laugh: (s) => merge({ chest: [10 + 6 * Math.sin(s * 14), 0, 0], head: [-14 + 6 * Math.sin(s * 14), 0, 0] }, arm("L", 30, -18, 0, 70), arm("R", 30, -18, 0, 70)),
  dance: (s) => merge(arm("L", 20, 90 + 60 * Math.sin(s * 6), 0, 60), arm("R", 20, 90 - 60 * Math.sin(s * 6), 0, 60), { root: { x: 0.06 * Math.sin(s * 6), rz: 8 * Math.sin(s * 6) }, head: [0, 0, -10 * Math.sin(s * 6)] }, leg("L", 0, 0, 25 * Math.max(0, Math.sin(s * 6))), leg("R", 0, 0, 25 * Math.max(0, -Math.sin(s * 6)))),
  kneel: () => merge(leg("L", 90, 0, 90), leg("R", -12, 0, 102), { root: { y: -LEG + 0.02 } }, arm("R", 40, -10, 0, 40)),
  whisper: () => merge(arm("R", 70, -40, 20, 135), { head: [6, 0, 10], chest: [6, 0, 0] }),
  sneak: () => merge(squat(30), { body: [24, 0, 0], head: [-18, 0, 0] }, arm("L", 25, 5, 0, 40), arm("R", 25, 5, 0, 40)),
  sleep: () => merge(GESTURES.lie(), arm("L", 0, 12, 0, 10), arm("R", 0, 12, 0, 10)),
};

// One step is half a metre: on 12 px legs (0.70 m) a planted foot a quarter metre ahead of (or behind) the hips is reached
// with the hips 8 cm down (3 cm all along, a planted leg is never quite straight). The thigh swing (21 degrees) carries the foot that far, so the pose's soles and the planted ones (src/feet.ts)
// agree. At 1.05 m a step (34 degrees) every planted foot slid 25-43 cm and both feet left the floor together
const STRIDE = 0.5;
// The gait at a walked distance: phase (the left foot is on the floor while cos(ph) < 0, the right while cos(ph) > 0) and
// how much of a walk it is (0 standing, 1 full pace)
export const gaitOf = (dist, speed) => ({ ph: (dist * Math.PI) / STRIDE, w: clamp01(speed / 1.2) });
// Walk or run, phase from the distance walked: thighs swing, the knee folds while the leg swings forward, the arms
// counter-swing with a little elbow, the chest twists against the hips. The hips are lowest as one foot lands and the other
// pushes off (both on the floor) and highest as one passes the other
export const walkPose = (dist, speed) => {
  const { ph, w } = gaitOf(dist, speed), run = clamp01((speed - 4) / 2);
  if (w < 0.01) return {};
  const s = Math.sin(ph), c = Math.cos(ph);
  const A = (21 + 22 * run) * w, K = (38 + 50 * run) * w, B = (24 + 40 * run) * w;
  return merge(
    leg("L", A * s, 3, K * Math.max(0, c) + 6 * w), leg("R", -A * s, 3, K * Math.max(0, -c) + 6 * w),
    arm("L", -B * s, 6, 0, 10 * w + 45 * run * w + 12 * w * Math.max(0, -s)), arm("R", B * s, 6, 0, 10 * w + 45 * run * w + 12 * w * Math.max(0, s)),
    { chest: [6 * run, 8 * s * w, 0], body: [4 * w + 14 * run, 0, 0], head: [-6 * run, -6 * s * w, 0], root: { y: -(0.03 + 0.05 * Math.abs(s)) * w - 0.03 * run } },
  );
};

export const idlePose = (t, seed) => merge(arm("L", 0, 5 + 1.5 * Math.sin(t * 1.3 + seed), 0, 6), arm("R", 0, 5 + 1.5 * Math.sin(t * 1.3 + seed + 1), 0, 6), { chest: [-1.5 * Math.sin(t * 1.7 + seed), 0, 0], head: [1.2 * Math.sin(t * 0.9 + seed), 0, 0] });

// Blend b over a by weight k, joint by joint
export const blendPose = (a, b, k) => {
  const out = { root: { ...(a.root ?? {}) } };
  for (const [j, v] of Object.entries(a)) if (j !== "root") out[j] = v.slice();
  for (const [j, v] of Object.entries(b)) {
    if (j === "root") { for (const [r, x] of Object.entries(v)) out.root[r] = THREE.MathUtils.lerp(out.root[r] ?? 0, x, k); continue; }
    const base = out[j] ?? [0, 0, 0];
    out[j] = base.map((x, i) => THREE.MathUtils.lerp(x, v[i], k));
  }
  return out;
};
export { merge as addPose };

// ---- face ----
// Moods: brows (y raise, tilt > 0 lifts the inner ends), eyes (open, squint, pupil size), smile (-1 frown .. 1 smile)
export const MOODS = {
  neutral: { y: 0, tilt: 0, open: 0.9, squint: 0, pupil: 1, smile: 0 },
  happy: { y: 0.35, tilt: 0, open: 0.8, squint: 0.35, pupil: 1, smile: 1 },
  proud: { y: 0.25, tilt: -6, open: 0.7, squint: 0.2, pupil: 1, smile: 0.8 },
  worried: { y: 0.35, tilt: 26, open: 0.95, squint: 0, pupil: 0.9, smile: -0.7 },
  scared: { y: 0.7, tilt: 22, open: 1, squint: 0, pupil: 0.65, smile: -1 },
  surprised: { y: 0.85, tilt: 4, open: 1, squint: 0, pupil: 0.7, smile: 0 },
  angry: { y: -0.35, tilt: -32, open: 0.85, squint: 0.35, pupil: 1, smile: -0.6 },
  determined: { y: -0.2, tilt: -16, open: 0.9, squint: 0.25, pupil: 1, smile: 0.1 },
  smug: { y: 0.2, tilt: -8, open: 0.62, squint: 0.15, pupil: 1, smile: 0.7, L: { y: 0.55 }, R: { y: -0.1 } },
  sleepy: { y: -0.1, tilt: 6, open: 0.35, squint: 0.1, pupil: 1, smile: 0 },
  sad: { y: 0.2, tilt: 30, open: 0.75, squint: 0.1, pupil: 1, smile: -1 },
};
// Rhubarb's mouth shapes as an opening in skin pixels: [width, height, teeth (top strip), tongue (bottom strip)]
const MOUTH = { X: [0, 0, 0, 0], A: [0, 0, 0, 0], B: [2, 0.5, 0.3, 0], C: [2.2, 1, 0.3, 0], D: [2.6, 1.5, 0.3, 0.4], E: [1.6, 1.1, 0, 0.2], F: [1, 0.7, 0, 0], G: [2, 0.45, 0.4, 0], H: [2.2, 1.1, 0.25, 0.55] };
export const mouthAt = (cues, s) => {
  // shape at local time s, eased over 60 ms from the previous one so the lips move instead of popping
  if (!cues?.length || s < 0) return MOUTH.X;
  let i = 0;
  while (i < cues.length - 1 && s >= cues[i + 1][0]) i++;
  const cur = MOUTH[cues[i][1]] ?? MOUTH.X, prev = i > 0 ? MOUTH[cues[i - 1][1]] ?? MOUTH.X : MOUTH.X;
  const k = smooth((s - cues[i][0]) / 0.06);
  return cur.map((v, j) => prev[j] + (v - prev[j]) * k);
};

const flat = (color, glow = 0.12) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: color, emissiveIntensity: glow });

// The face in the rig's rest pose, measured from the head's own skinned vertices: pixel size, front plane and the head
// bone's axes. Pieces are placed in the root's frame and then attached to the head bone, so they follow every turn
const faceFrame = (root, head) => {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), v = new THREE.Vector3(), toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isSkinnedMesh || /Layer2/.test(o.name)) return;
    const hi = o.skeleton.bones.indexOf(head), pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) if (si.getX(i) === hi && sw.getX(i) > 0.5) box.expandByPoint(o.localToWorld(o.getVertexPosition(i, v)).applyMatrix4(toRoot));
  });
  const px = (box.max.x - box.min.x) / 8, mid = box.getCenter(new THREE.Vector3());
  head.updateWorldMatrix(true, false);
  const localPx = px / head.getWorldScale(new THREE.Vector3()).x; // the bone is scaled (0.586): offsets are in its own units
  const toHead = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(root.matrixWorld));
  const up = new THREE.Vector3(0, 1, 0).applyMatrix3(toHead).normalize(), right = new THREE.Vector3(1, 0, 0).applyMatrix3(toHead).normalize();
  // x in pixels from the face's middle (+ = his left, the viewer's right), y in rows from the top of the face, z off the face
  const add = (m, x, y, z) => { m.position.set(mid.x + x * px, box.max.y - y * px, box.max.z + z * px); m.castShadow = false; root.add(m); head.attach(m); return m; };
  return { px, localPx, up, right, add, box };
};

const makeFace = (root, head, skin) => {
  const { px, localPx, up, right, add } = faceFrame(root, head);
  const pix = (x, y) => { const d = skin.getImageData(8 + x, 8 + y, 1, 1).data; return new THREE.Color(`rgb(${d[0]},${d[1]},${d[2]})`); };
  const skinCol = pix(1, 5), irisCol = pix(2, 4), hairCol = pix(3, 0), lipCol = pix(3, 6);
  const lidCol = skinCol.clone().multiplyScalar(0.9);
  const at = (o, base, x, y) => o.position.copy(base).addScaledVector(right, x * localPx).addScaledVector(up, y * localPx);
  // All layers of the eye lie in one plane and stack by polygon offset: a gap between them let the white show over the lid when the camera looked across the face
  const layer = (m, k) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -(k + 1), polygonOffsetUnits: -4 * (k + 1) });
  const white = layer(flat("#f4f4f4", 0.25), 0), iris = layer(flat(irisCol, 0.12), 1), dark = layer(flat("#120d1c", 0), 2), lid = layer(flat(lidCol, 0.1), 3);
  const W = 2, H = 1.25, Z = 0.06, LIP = 0.1;
  const eyes = [-1, 1].map((side) => {
    const piece = (w, h, mat) => add(new THREE.Mesh(new THREE.PlaneGeometry(w * px, h * px), mat), side * 2, 4.5, Z);
    const e = { side, white: piece(W, H, white), iris: piece(0.95, 1, iris), pupil: piece(0.3, 0.32, dark), top: piece(W + 0.1, H, lid), low: piece(W + 0.1, H, lid) };
    // attach() gave each piece a scale that undoes the head bone's: resizing multiplies it, never replaces it
    for (const k of ["iris", "pupil", "top", "low"]) { e[k + "0"] = e[k].position.clone(); e[k + "S"] = e[k].scale.clone(); }
    return e;
  });
  const browMat = flat(hairCol.clone().multiplyScalar(0.75), 0.2);
  const brows = [-1, 1].map((side) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(2.2 * px, 0.5 * px, 0.3 * px), browMat), side * 2, 3.3, 0.2); return { m, side, base: m.position.clone(), q: m.quaternion.clone() }; });
  // mouth: a dark opening with a strip of teeth along the top and the tongue along the bottom; corners lift for a smile
  const mouthMat = layer(flat(lipCol.clone().multiplyScalar(0.35), 0), 0), teethMat = layer(flat("#efeee4", 0.2), 1), tongueMat = layer(flat("#b9534f", 0.1), 1);
  const plane = (mat) => add(new THREE.Mesh(new THREE.PlaneGeometry(px, px), mat), 0, 6, Z);
  const hole = plane(mouthMat), teeth = plane(teethMat), tongue = plane(tongueMat);
  const corners = [-1, 1].map(() => plane(mouthMat));
  const line = plane(mouthMat);
  const mouth = { hole, teeth, tongue, line };
  for (const o of [...Object.values(mouth), ...corners]) { o.userData.p0 = o.position.clone(); o.userData.s0 = o.scale.clone(); }
  // x, y: centre in face pixels (y = rows down from the top of the face); w, h: size in pixels
  const rect = (o, x, y, w, h) => {
    o.visible = w > 0.05 && h > 0.05;
    if (!o.visible) return;
    o.scale.set(o.userData.s0.x * w, o.userData.s0.y * h, o.userData.s0.z);
    at(o, o.userData.p0, x, -(y - 6));
  };
  const rot = new THREE.Quaternion(), fwdAxis = new THREE.Vector3();
  // mood: blended mood values; m: mouth [w, h, teeth, tongue]; blink 0..1; look [x, y] in -1..1
  return (mood, m, blink, look) => {
    for (const e of eyes) {
      const sd = e.side < 0 ? "R" : "L", o = { ...mood, ...(mood[sd] ?? {}) };
      const gx = Math.max(-1, Math.min(1, look[0])), gy = Math.max(-1, Math.min(1, look[1]));
      const x = gx * 0.5, y = gy * 0.12;
      at(e.iris, e.iris0, x, y); at(e.pupil, e.pupil0, x, y);
      e.pupil.scale.copy(e.pupilS).multiplyScalar(o.pupil);
      const cover = Math.min(1, Math.max(1 - o.open, blink)), under = o.squint * 0.45 * (1 - cover);
      // each lid reaches LIP past the white, so no sliver of white shows round its edge from a low or high camera
      const top = cover * H + LIP, low = under * H + LIP;
      e.top.visible = cover > 0.01; e.top.scale.y = e.topS.y * top / H; at(e.top, e.top0, 0, H / 2 + LIP - top / 2);
      e.low.visible = under > 0.01; e.low.scale.y = e.lowS.y * low / H; at(e.low, e.low0, 0, -H / 2 - LIP + low / 2);
    }
    for (const b of brows) {
      const sd = b.side < 0 ? "R" : "L", o = { ...mood, ...(mood[sd] ?? {}) };
      b.m.position.copy(b.base).addScaledVector(up, (o.y - 0.3 * blink) * localPx);
      // tilt > 0 lifts the inner end (the end nearer the nose)
      fwdAxis.crossVectors(right, up).normalize();
      rot.setFromAxisAngle(fwdAxis, -b.side * o.tilt * D);
      b.m.quaternion.copy(rot).multiply(b.q);
    }
    const [w, h, th, tg] = m, smile = mood.smile;
    rect(hole, 0, 6 + h / 2, w, h);
    rect(teeth, 0, 6 + th / 2, w * 0.9, Math.min(th, h));
    rect(tongue, 0, 6 + h - tg / 2, w * 0.7, Math.min(tg, h));
    // shut mouth: the skin's own painted mouth shows; a smile or frown adds a line and turned corners over it
    const shut = h < 0.2, lw = 2;
    rect(line, 0, 6.55, shut && Math.abs(smile) > 0.15 ? lw : 0, 0.35);
    const cw = Math.max(w, lw) / 2 + 0.25;
    corners.forEach((c, i) => rect(c, (i ? 1 : -1) * cw, 6.55 - smile * 0.45, Math.abs(smile) > 0.15 ? 0.5 : 0, 0.5));
  };
};

// ---- one character ----
export async function makePlayer(template, skinUrl, { glow = 0.08 } = {}) {
  const img = await loadImage(skinUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false; // the rig's UVs are glTF's, top-left origin
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.colorSpace = THREE.SRGBColorSpace;
  // a touch of self light from the skin itself, so faces still read under the night's single sodium lamp
  const look = { map, roughness: 0.9, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: glow };
  const inner = new THREE.MeshStandardMaterial(look);
  const outer = new THREE.MeshStandardMaterial({ ...look, alphaTest: 0.5, side: THREE.DoubleSide });

  const rig = cloneSkinned(template);
  rig.traverse((o) => { if (o.isSkinnedMesh) { o.material = /Layer2/.test(o.name) ? outer : inner; o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
  const g = new THREE.Group(); // feet on the floor at the origin, facing +z
  g.add(rig);
  const all = {};
  rig.traverse((o) => { if (o.isBone) all[o.name] = o; });
  const b = Object.fromEntries(Object.entries(BONES).map(([k, n]) => [k, all[n]]));
  for (const [k, v] of Object.entries(b)) if (!v) throw new Error(`player.glb has no bone ${BONES[k]} (has ${Object.keys(all).join(", ")})`);
  g.updateMatrixWorld(true);
  const rest = {};
  for (const [k, bone] of Object.entries(b)) {
    const C = bone.getWorldQuaternion(new THREE.Quaternion());
    rest[k] = { q: bone.quaternion.clone(), p: bone.position.clone(), C, Ci: C.clone().invert() };
  }
  // the hips' parent is rotated and scaled: a move in character metres becomes this in its own units
  b.root.parent.updateWorldMatrix(true, false);
  const rootIn = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(b.root.parent.matrixWorld).invert());
  const face = makeFace(rig, b.head, ctx);
  const hand = new THREE.Group(); // the right hand's grip, for held items
  hand.position.set(-6 * PX, 12 * PX, 2 * PX); // vanilla: the right shoulder pivot (-5, 22, 0) px, then 10 down the arm, 2 forward, 1 out
  rig.add(hand);
  b.laR.attach(hand);
  const handL = new THREE.Group();
  handL.position.set(6 * PX, 12 * PX, 2 * PX);
  rig.add(handL);
  b.laL.attach(handL);
  // Two-bone arm IK and head aim, measured from the rest pose: shoulder pivot to elbow, elbow to the end of the hand
  const restAt = (bone) => bone.getWorldPosition(new THREE.Vector3());
  const ARM = Object.fromEntries(["L", "R"].map((sd) => {
    const S0 = restAt(b[`ua${sd}`]), E0 = restAt(b[`la${sd}`]);
    const end = 12 * PX - 0.02; // the bottom of the arm box, just inside it, so a touch sinks the hand in by 2 cm and never floats
    return [sd, { L1: S0.distanceTo(E0), L2: Math.max(0.05, E0.y - end) }];
  }));
  // Legs the same way: hip pivot to knee, knee to the middle of the sole (on the floor at rest), kept in the shin's own
  // frame so soleAt finds it in any pose
  const LEGS = Object.fromEntries(["L", "R"].map((sd) => {
    const H0 = restAt(b[`ul${sd}`]), K0 = restAt(b[`ll${sd}`]);
    return [sd, { L1: H0.distanceTo(K0), L2: K0.y, sole: b[`ll${sd}`].worldToLocal(new THREE.Vector3(K0.x, 0, K0.z)) }];
  }));
  const parentRest = Object.fromEntries(["uaL", "uaR", "ulL", "ulR", "head"].map((k) => [k, b[k].parent.getWorldQuaternion(new THREE.Quaternion()).invert()]));

  const R = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  const setPose = (pose) => {
    for (const [k, bone] of Object.entries(b)) { bone.quaternion.copy(rest[k].q); bone.position.copy(rest[k].p); }
    for (const [k, a] of Object.entries(pose)) {
      if (k === "root" || !b[k]) continue;
      R.setFromEuler(e.set(a[0] * D, a[1] * D, a[2] * D, "YXZ"));
      // local = rest * C^-1 R C: R turns the joint in the character's own axes, about the joint itself
      b[k].quaternion.copy(rest[k].q).multiply(rest[k].Ci).multiply(R).multiply(rest[k].C);
    }
    const r = pose.root ?? {};
    if (r.rx || r.ry || r.rz) {
      R.setFromEuler(e.set((r.rx ?? 0) * D, (r.ry ?? 0) * D, (r.rz ?? 0) * D, "YXZ"));
      b.root.quaternion.copy(rest.root.q).multiply(rest.root.Ci).multiply(R).multiply(rest.root.C);
    }
    v.set(r.x ?? 0, r.y ?? 0, r.z ?? 0).applyMatrix3(rootIn);
    b.root.position.copy(rest.root.p).add(v);
  };
  // The joint's parent turn now, relative to its rest, as a world rotation (includes the character's yaw and lean)
  const Q = new THREE.Quaternion(), Qi = new THREE.Quaternion(), S = new THREE.Vector3(), d = new THREE.Vector3();
  const parentTurn = (k) => b[k].parent.getWorldQuaternion(Q).multiply(parentRest[k]);
  // Call after setPose with everything but this arm, then g.updateMatrixWorld(true). Returns the arm's joints (degrees) that
  // put the end of the hand on the world point: the elbow folds forward (it points back), the upper arm takes the rest
  // pole [x, y, z] (his left, up, forward, in the chest's axes): where the elbow should point. Without one the upper arm
  // never twists, which puts a hand near his own face on an elbow raised sideways at shoulder height; with one the arm
  // takes the twist too (a full 3-joint upper arm), so a hand to the chin comes up on an elbow hanging down and out
  const armTo = (sd, target, pole = null) => {
    const { L1, L2 } = ARM[sd];
    b[`ua${sd}`].getWorldPosition(S);
    d.copy(target).sub(S).applyQuaternion(Qi.copy(parentTurn(`ua${sd}`)).invert());
    if (pole) return armPole(sd, d, pole, L1, L2);
    const n = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    d.normalize();
    const e = Math.PI - Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - n * n) / (2 * L1 * L2), -1, 1));
    // the hand's direction with the arm hanging and only the elbow bent, then the shoulder's out (z) and forward (x) turns
    const wy = -(L1 + L2 * Math.cos(e)) / n, wz = (L2 * Math.sin(e)) / n;
    const g = Math.asin(THREE.MathUtils.clamp(d.x / -wy, -1, 1));
    const y = wy * Math.cos(g), z = wz;
    // wrapped to +-180: a hand behind him comes out as -324 instead of +36, the same arm, but blending it with the pose's own
    // arm (a hand key going to null) would swing it the long way round, over his head
    const a = THREE.MathUtils.euclideanModulo(Math.atan2(d.z, d.y) - Math.atan2(z, y) + Math.PI, 2 * Math.PI) - Math.PI;
    return { [`ua${sd}`]: [a / D, 0, g / D], [`la${sd}`]: [-e / D, 0, 0] };
  };
  const U = new THREE.Vector3(), B = new THREE.Vector3(), F = new THREE.Vector3(), P = new THREE.Vector3(), M0 = new THREE.Matrix4(), M1 = new THREE.Matrix4();
  const HANG = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, 1), SIDE = new THREE.Vector3().crossVectors(HANG, FWD);
  const PQ = new THREE.Quaternion(), PE = new THREE.Euler();
  M0.makeBasis(HANG, FWD, SIDE);
  const armPole = (sd, dd, pole, L1, L2) => {
    const n = THREE.MathUtils.clamp(dd.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const dh = dd.clone().normalize();
    // the elbow on the circle of possible elbows, on the pole's side of the shoulder-hand line
    P.set(...pole).addScaledVector(dh, -P.set(...pole).dot(dh)).normalize();
    const cosA = THREE.MathUtils.clamp((L1 * L1 + n * n - L2 * L2) / (2 * L1 * n), -1, 1);
    U.copy(dh).multiplyScalar(cosA).addScaledVector(P, Math.sqrt(1 - cosA * cosA));
    const e = Math.PI - Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - n * n) / (2 * L1 * L2), -1, 1));
    // the forearm's way from the elbow; the upper arm turns so its own forward (where the elbow folds) points along it
    F.copy(dh).multiplyScalar(n).addScaledVector(U, -L1).normalize();
    B.copy(F).addScaledVector(U, -F.dot(U));
    if (B.lengthSq() < 1e-8) B.copy(P).addScaledVector(U, -P.dot(U)).negate();
    B.normalize();
    M1.makeBasis(U, B, new THREE.Vector3().crossVectors(U, B));
    PQ.setFromRotationMatrix(M1.multiply(M0.clone().transpose()));
    PE.setFromQuaternion(PQ, "YXZ");
    return { [`ua${sd}`]: [PE.x / D, PE.y / D, PE.z / D], [`la${sd}`]: [-e / D, 0, 0] };
  };
  // armTo for a leg: the knee folds back (the shin behind the thigh's line), the thigh takes the rest. A target past the
  // leg's reach leaves it straight towards it
  const legTo = (sd, target) => {
    const { L1, L2 } = LEGS[sd];
    b[`ul${sd}`].getWorldPosition(S);
    d.copy(target).sub(S).applyQuaternion(Qi.copy(parentTurn(`ul${sd}`)).invert());
    const n = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    d.normalize();
    const e = Math.PI - Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - n * n) / (2 * L1 * L2), -1, 1));
    const wy = -(L1 + L2 * Math.cos(e)) / n, wz = -(L2 * Math.sin(e)) / n;
    const g = Math.asin(THREE.MathUtils.clamp(d.x / -wy, -1, 1));
    const a = THREE.MathUtils.euclideanModulo(Math.atan2(d.z, d.y) - Math.atan2(wz, wy * Math.cos(g)) + Math.PI, 2 * Math.PI) - Math.PI;
    return { [`ul${sd}`]: [a / D, 0, g / D], [`ll${sd}`]: [e / D, 0, 0] };
  };
  const soleAt = (sd, out = new THREE.Vector3()) => b[`ll${sd}`].localToWorld(out.copy(LEGS[sd].sole));
  // Head angles [down, to his left, 0] that turn the face to a world point, held inside a natural neck range
  const headTo = (target) => {
    b.head.getWorldPosition(S);
    S.y += 4 * PX;
    d.copy(target).sub(S).applyQuaternion(Qi.copy(parentTurn("head")).invert());
    const yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z) / D, -75, 75);
    const down = THREE.MathUtils.clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)) / D, -40, 42); // past this the neck reads broken: the eyes do the rest
    return [down, yaw, 0];
  };
  // Minecraft's hurt overlay: the skin goes red while hurt or dying (on/off, as in the game)
  const red = (on) => { for (const m of [inner, outer]) { m.color.setRGB(1, on ? 0.45 : 1, on ? 0.45 : 1); m.emissive.setRGB(1, on ? 0.3 : 1, on ? 0.3 : 1); } };
  return { g, rig, bones: b, setPose, face, hand, handL, armTo, legTo, soleAt, legReach: LEGS.L.L1 + LEGS.L.L2, headTo, skin: ctx, red };
}
