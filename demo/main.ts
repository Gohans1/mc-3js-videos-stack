// @ts-nocheck
// Two Steves side by side. In the film scenes (dig, standing, walk, reach) the left one is driven the way the film drives
// him now (smoothstep between keys, breathing written into each pose, eyes fixed) and the right one through film-kit's
// layers, each switchable. In the mocap scene both get the layers: the left acts the moments with hand-made keys, the
// right plays Mixamo clips, and every layer that a clip already has (overlap, breath, sway, drift, the head's steadying)
// fades out over each clip (pose.ts mask; switch "mask" off to see them doubled).
// Layer order on the body pose: through keys, + overlap, + cartoon, + idle, + lean, + mood posture, + attention (chest and
// waist join the look), then foot pin, head IK, + steady head, + drift, hand IK (on arcs); face: gaze, blinks, lids.
// The layered Steve's poses are read at their first instant, so their written-in breathing is gone and breath replaces it.
// URL: ?scene=dig|idle|walk|reach|mocap  ?t=<seconds> stops there  ?view=both|side|face|faceOld  ?off=<layer>,...
//      ?mood=tense|tired (Laban Effort on the layered Steve)
import * as THREE from "three";
import { addPose as addRigPose, blendPose, loadRig, makePlayer, mouthAt, PX, walkPose } from "./film/player";
import { blinkAt, DIG, IDLE, moodAt, POSES } from "./film/dig";
import { CLIP_A, CLIP_B, mocapScene, REACH, WALK } from "./film/extra";
import { loadClips } from "./film/clips";
import { slerpPose } from "./film/mocap";
import { through } from "../src/curve";
import { canonical, mask, scalePose, throughPose } from "../src/pose";
import { overlap } from "../src/overlap";
import { cartoon } from "../src/cartoon";
import { idle } from "../src/idle";
import { anglesOf, eyeTime, gaze, lidOpen, REST_PITCH } from "../src/gaze";
import { attention } from "../src/attention";
import { steady } from "../src/steady";
import { lean } from "../src/lean";
import { micro } from "../src/micro";
import { arc } from "../src/arc";
import { effort, MOOD, phrase } from "../src/effort";

const q = new URLSearchParams(location.search);
const LAYERS = ["through", "overlap", "cartoon", "breath", "sway", "settle", "gaze", "lids", "attention", "steady", "lean", "noise", "arcs", "mask"];
const on = Object.fromEntries(LAYERS.map((k) => [k, !(q.get("off") ?? "").split(",").includes(k)]));
const MOODNAME = MOOD[q.get("mood")] ? q.get("mood") : "calm";
const FX = effort(MOOD[MOODNAME]);
const SCENES = { dig: DIG, idle: IDLE, walk: WALK, reach: REACH };
const D = Math.PI / 180;

const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const mixPose = (a, b, k) => {
  const out = { root: {} };
  for (const r of new Set([...Object.keys(a.root ?? {}), ...Object.keys(b.root ?? {})])) out.root[r] = THREE.MathUtils.lerp(a.root?.[r] ?? 0, b.root?.[r] ?? 0, k);
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) if (j !== "root") { const x = a[j] ?? [0, 0, 0], y = b[j] ?? [0, 0, 0]; out[j] = x.map((v, i) => THREE.MathUtils.lerp(v, y[i], k)); }
  return out;
};

// ---- stage ----
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15191c);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.02, 80);
scene.add(new THREE.HemisphereLight(0xdfe8ec, 0x2a2622, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-2, 4, 8);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x555a5e, 0x44484b);
grid.position.y = 0.001;
scene.add(grid);

const rig = await loadRig("vendor/player.glb");
const probe = await makePlayer(rig, "vendor/steve.png"); // never shown: measures the rig for the bakes

// ---- scene ----
const NAME = q.get("scene") === "mocap" || SCENES[q.get("scene")] ? q.get("scene") : "dig";
let SC, CLIPS = {};
if (NAME === "mocap") {
  CLIPS = await loadClips([CLIP_A, CLIP_B], probe);
  SC = mocapScene(Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, c.duration])));
} else SC = SCENES[NAME];
const { from: FROM, to: TO } = SC, END = TO + 1;
const STANDING = new Set(["stand", "readUp", "desk", "fling", "pant", "gasp"]);
const AT0 = SC.moves[0].at;

// where the character stands and faces at t (a walk path, or the scene's spot), with this Steve's sideways offset
const placeOf = (t) => { const P = SC.path?.(t); return P ? { x: P.x, z: P.z, yaw: P.yaw, dist: P.dist, speed: P.speed } : { x: AT0[0], z: AT0[2], yaw: -90, dist: 0, speed: 0 }; };
// a walk spreads the two along his path (one 2 m behind the other) so a side camera sees both
const offsetOf = (dz) => (SC.path ? new THREE.Vector3(1.25 * dz, 0, 0) : new THREE.Vector3(0, 0, dz));
const placeAt = (s, dz, t) => { const P = placeOf(t); s.g.position.set(P.x, 0, P.z).add(offsetOf(dz)); s.g.rotation.y = P.yaw * D; };
const place = (s, pose) => { s.setPose(pose); s.g.updateMatrixWorld(true); };

// One performance: its keys (moves, look), whether film-kit's layers drive it, and every layer baked from its body pose
function actor({ moves, look, layered, dz, masked }) {
  const M = layered && FX.hold > 0 ? phrase(moves, FX.hold) : moves;
  const poseOf = (key, s) => {
    if (key.clip) { const c = CLIPS[key.clip], x = (key.from ?? 0) + Math.max(0, s) * (key.rate ?? 1); return c.at(key.loop ? THREE.MathUtils.euclideanModulo(x, c.duration) : x); }
    return POSES[key.pose](layered && on.breath && key.pose !== "frenzy" ? 0 : Math.max(0, s));
  };
  const bodyAt = (t) => {
    const i = keyAt(M, t), a = M[i], b = M[Math.min(i + 1, M.length - 1)];
    let pose;
    const A = poseOf(a, t - a.t);
    if (b === a || t < a.t) pose = A;
    else {
      const B = poseOf(b, 0), k = (t - a.t) / (b.t - a.t);
      // a clip's turns are measured, not keyed angle by angle: blend them as turns (the film's slerpPose)
      if (a.clip || b.clip) pose = slerpPose(A, B, smooth(k));
      else if (!(layered && on.through)) pose = mixPose(A, B, smooth(k));
      else {
        const p = M[i - 1], n = M[i + 2], ok = (x) => x && !x.clip;
        pose = throughPose(ok(p) ? poseOf(p, t - p.t) : null, A, B, ok(n) ? poseOf(n, 0) : null, [p?.t ?? 0, a.t, b.t, n?.t ?? 0], t);
      }
    }
    const P = placeOf(t);
    // layers add their offsets to this pose, so it is spelled the way they read it
    return canonical(P.speed > 0 ? addRigPose(pose, walkPose(P.dist, P.speed)) : pose);
  };
  const standingAt = (t) => {
    const i = keyAt(M, t), a = M[i], b = M[Math.min(i + 1, M.length - 1)];
    const k = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
    const s = (STANDING.has(a.pose) ? 1 - k : 0) + (STANDING.has(b.pose) ? k : 0);
    return s * (1 - Math.min(1, placeOf(t).speed / 1.2));
  };
  // the head's look point and weight (null keys: the pose's own head), smoothstep or through the keys
  const lookAt = (t) => {
    if (!look.length || t < look[0].t) return null;
    const i = keyAt(look, t), a = look[i], b = look[Math.min(i + 1, look.length - 1)];
    const x = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
    if (a.at && !b.at) return { p: new THREE.Vector3(...a.at), w: 1 - x };
    if (!a.at && b.at) return { p: new THREE.Vector3(...b.at), w: x };
    if (!a.at) return null;
    const p = look[i - 1]?.at && look[i - 1], n = look[i + 2]?.at && look[i + 2];
    const v = [0, 1, 2].map((c) => (layered && on.through ? through(p ? p.at[c] : null, a.at[c], b.at[c], n ? n.at[c] : null, p?.t ?? 0, a.t, b.t, n?.t ?? 0, t) : THREE.MathUtils.lerp(a.at[c], b.at[c], x)));
    return { p: new THREE.Vector3(...v), w: 1 };
  };
  const A = { bodyAt, standingAt, lookAt, layered, dz, look };
  if (!layered) return A;

  const w = masked && on.mask && SC.clips ? mask(SC.clips) : () => 1;
  const lagOf = overlap(bodyAt, END, FX.overlap);
  const toon = cartoon(bodyAt, END, FX.cartoon);
  const life = idle(bodyAt, END, { standing: standingAt, breath: +on.breath, sway: on.sway ? FX.idle.sway : 0, settle: on.settle ? FX.idle.settle : 0 });
  const tilt = lean((t) => placeOf(t), END);
  const prePose = (t) => {
    const k = w(t);
    let p = bodyAt(t);
    if (on.overlap) p = addRigPose(p, scalePose(lagOf(t), k));
    if (on.cartoon) p = addRigPose(p, scalePose(toon(t), k));
    p = addRigPose(p, scalePose(life(t), k));
    if (on.lean) p = addRigPose(p, tilt(t));
    return addRigPose(p, scalePose(FX.posture, k));
  };
  // the turn the head would need from the trunk as it is, measured on the rig, for the trunk to take its share of
  const chain = attention((t) => {
    const L = lookAt(t);
    if (!L) return null;
    placeAt(probe, dz, t);
    place(probe, prePose(t));
    const [down, yaw] = probe.headTo(L.p.clone().add(offsetOf(dz)));
    return { down, yaw, w: L.w };
  }, END);
  const trunkPose = (t) => (on.attention ? addRigPose(prePose(t), chain(t)) : prePose(t));
  const steadyHead = steady(trunkPose, END);
  const drift = micro({ amount: FX.micro.amount });
  const shifts = look.slice(0, -1).filter((k, i) => JSON.stringify(k.at) !== JSON.stringify(look[i + 1].at)).map((k) => k.t);
  const eyesAt = gaze(shifts, END, { mean: FX.gaze.mean, wander: FX.gaze.wander, blinkedNear: (t) => [...Array(16)].some((_, i) => blinkAt(t - i / 30, SC.blinksFrom) > 0) });
  return Object.assign(A, { w, lagOf, toon, life, tilt, chain, trunkPose, steadyHead, drift, eyesAt, nextKey: (x) => look.find((k) => k.t > x)?.t });
}

// ---- cast ----
const SIDE = 0.8;
const MOCAP = NAME === "mocap";
const cast = [];
for (const [name, dz] of [["old", -SIDE], ["new", SIDE]]) {
  const s = await makePlayer(rig, "vendor/steve.png", { glow: 0.05 });
  scene.add(s.g);
  place(s, {});
  const restHead = s.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: name === "old" ? 0xff8060 : 0x60e0a0 }));
  scene.add(dot);
  const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012), new THREE.MeshBasicMaterial({ color: name === "old" ? 0xff8060 : 0x60e0a0 }), 46);
  scene.add(trail);
  const spec = MOCAP
    ? name === "old" ? { moves: SC.authored.moves, look: SC.authored.look, layered: true } : { moves: SC.moves, look: SC.look, layered: true, masked: true }
    : { moves: SC.moves, look: SC.look, layered: name === "new" };
  cast.push({ name, s, dz, restHead, dot, trail, act: actor({ ...spec, dz }) });
}
document.getElementById("old").textContent = MOCAP ? "Left: hand-made keys + film-kit layers (no Mixamo)" : "Before: the film now (smoothstep keys, breathing per pose, eyes fixed)";
document.getElementById("new").textContent = MOCAP ? `Right: Mixamo clips (layers ${on.mask ? "fade out over each clip" : "NOT faded: doubled"})` : `After: film-kit layers${MOODNAME === "calm" ? "" : `, mood ${MOODNAME}`}`;

// right hand targets in his own axes; "rest" is where the end of the hand hangs (armTo puts that end on the target:
// 12 px up from the feet, under the elbow); the arc pivots on his right shoulder as it is posed at that moment
place(probe, {});
probe.g.position.set(0, 0, 0); probe.g.rotation.y = 0; probe.g.updateMatrixWorld(true);
const elbow0 = probe.bones.laR.getWorldPosition(new THREE.Vector3());
const REST_HAND = [elbow0.x, 12 * PX - 0.02, elbow0.z];
const handEnd = probe.bones.laR.worldToLocal(new THREE.Vector3(...REST_HAND)); // in the forearm's own frame
let SHOULDER_R = probe.bones.uaR.getWorldPosition(new THREE.Vector3()).toArray();
const handLocal = (t, arcs) => {
  const HK = SC.hands ?? [];
  if (!HK.length || t < HK[0].t) return null;
  const i = keyAt(HK, t), a = HK[i], b = HK[Math.min(i + 1, HK.length - 1)];
  const k = b === a ? 0 : smooth((t - a.t) / (b.t - a.t)), P = (r) => (r === "rest" ? REST_HAND : r);
  if (!a.R && !b.R) return null;
  if (a.R && (!b.R || b === a)) return { p: P(a.R), w: b === a ? 1 : 1 - k };
  if (!a.R) return { p: P(b.R), w: k };
  const pa = P(a.R), pb = P(b.R);
  return { p: arcs ? arc(SHOULDER_R, pa, pb, k, { bend: [0, 0, 1] }) : pa.map((v, j) => v + (pb[j] - v) * k), w: 1 };
};

const Q = new THREE.Quaternion(), E = new THREE.Vector3(), V = new THREE.Vector3(), M4 = new THREE.Matrix4();
// a world point from his eyes, in the posed head's own axes
const gazeTo = (c, p) => {
  c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
  c.s.bones.head.getWorldPosition(E).add(V.set(0, 4 * PX, 4 * PX).applyQuaternion(Q));
  return anglesOf(V.copy(p).sub(E).applyQuaternion(Q.invert()).toArray());
};
const soles = { L: new THREE.Vector3(), R: new THREE.Vector3() };
const perform = (c, t) => {
  const A = c.act;
  placeAt(c.s, c.dz, t);
  const stand = A.layered ? A.standingAt(t) : 0;
  if (stand > 0) { place(c.s, A.bodyAt(t)); c.s.soleAt("L", soles.L); c.s.soleAt("R", soles.R); }
  let pose = A.layered ? A.trunkPose(t) : A.bodyAt(t);
  place(c.s, pose);
  // planted soles stay where the pose put them while the hips sway and sink over them
  if (stand > 0) { for (const sd of ["L", "R"]) pose = blendPose(pose, c.s.legTo(sd, soles[sd]), stand); place(c.s, pose); }
  const shift = offsetOf(c.dz);
  const look = A.lookAt(t);
  if (look) { pose = blendPose(pose, { head: c.s.headTo(look.p.clone().add(shift)) }, look.w); place(c.s, pose); }
  c.dot.visible = !!look && look.w > 0.5 && !view().startsWith("face");
  if (look) c.dot.position.copy(look.p).add(shift);
  const k = A.layered ? A.w(t) : 0;
  c.steadyNow = [0, 0];
  if (A.layered) {
    if (on.steady) { const h = A.steadyHead(t).head; c.steadyNow = [h[0] * (1 - (look?.w ?? 0)) * k, h[2] * k]; pose = addRigPose(pose, { head: [c.steadyNow[0], 0, c.steadyNow[1]] }); }
    if (on.noise) pose = addRigPose(pose, scalePose(A.drift(t), k));
    place(c.s, pose);
  }
  // the right hand on its target, straight or on its arc; the target's path over the last 1.5 s as dots
  const arcs = A.layered && on.arcs;
  SHOULDER_R = c.s.g.worldToLocal(c.s.bones.uaR.getWorldPosition(V)).toArray();
  const hand = handLocal(t, arcs);
  c.handErr = null;
  if (hand) {
    const target = new THREE.Vector3(...hand.p).applyMatrix4(c.s.g.matrixWorld);
    pose = blendPose(pose, c.s.armTo("R", target), hand.w);
    place(c.s, pose);
    c.handErr = c.s.bones.laR.localToWorld(V.copy(handEnd)).distanceTo(target) * (hand.w > 0.99 ? 1 : 0);
  }
  c.trail.visible = !!SC.hands;
  if (SC.hands) for (let i = 0; i < 46; i++) {
    const h = handLocal(t - i / 30, arcs), p = h ? new THREE.Vector3(...h.p).applyMatrix4(c.s.g.matrixWorld) : new THREE.Vector3(0, -10, 0);
    c.trail.setMatrixAt(i, M4.makeTranslation(p.x, p.y, p.z));
  }
  c.trail.instanceMatrix.needsUpdate = true;
  // face: eyes on fixations that lead the head, blinks, lids that follow the eyes
  let eyes = [0, -0.15], extra = 0, lid = 0;
  if (A.layered && on.gaze) {
    const g = A.eyesAt(t, (f, o) => {
      const L = A.lookAt(eyeTime(f, A.nextKey));
      const a = L && L.w > 0.5 && gazeTo(c, L.p.clone().add(shift));
      return a ? [a[0] + o[0] / 3, a[1] + o[1] / 3] : [o[0], REST_PITCH + o[1]];
    });
    eyes = g.look;
    extra = g.blink;
    lid = on.lids ? g.lid : 0;
  }
  const blink = Math.max(blinkAt(t, SC.blinksFrom), extra);
  const mood = moodAt(SC.face, t);
  mood.open = Math.min(1, Math.max(0, mood.open + lidOpen(lid)));
  c.s.face(mood, mouthAt([], 0), blink, eyes);
  Object.assign(c, { eyes, blink, lid, look, stand, k });
};

// ---- camera ----
const view = () => q.get("view") ?? (NAME === "walk" || NAME === "reach" ? "side" : "both");
const H0 = new THREE.Vector3();
const frame = (t) => {
  const v = view();
  camera.up.set(0, 1, 0);
  for (const o of cast) o.s.g.visible = true;
  const P = placeOf(t), x0 = P.x, z0 = P.z;
  if (v === "both") { camera.fov = 30; camera.position.set(x0 - 6.4, 1.3, z0); camera.lookAt(x0, 0.6 + (MOCAP ? 0.3 : 0), z0); }
  if (v === "side") {
    camera.fov = 30;
    if (NAME === "reach") { camera.position.set(x0 - 3.4, 1.7, z0 - 4.6); camera.lookAt(x0 - 0.3, 1.1, z0 - 0.2); }
    else if (NAME === "walk") { camera.position.set(x0 - 0.6, 1.4, AT0[2] - 7.5); camera.lookAt(x0, 1.1, AT0[2] + 0.3); }
    else { camera.position.set(x0 - 3.5, 2.4, z0 + 3.35); camera.lookAt(x0 - 0.2, 0.6, z0); }
  }
  if (v === "face" || v === "faceOld") {
    // in front of the face, wherever it points: rest axes (z forward, y up) turned by the head
    const c = cast[v === "face" ? 1 : 0];
    c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
    c.s.bones.head.getWorldPosition(H0).add(V.set(0, 4 * PX, 2 * PX).applyQuaternion(Q));
    camera.fov = 30;
    camera.position.copy(H0).add(V.set(0, 0.08, 0.8).applyQuaternion(Q));
    camera.up.set(0, 1, 0).applyQuaternion(Q);
    camera.lookAt(H0);
    for (const o of cast) o.s.g.visible = o === c;
  }
  camera.updateProjectionMatrix();
};

// what the right Steve's automatic layers are doing now (in the mocap scene: both)
const info = document.getElementById("info");
const status = (t) => {
  const lines = [];
  for (const c of MOCAP ? cast : [cast[1]]) {
    const A = c.act;
    if (!A.layered) continue;
    if (MOCAP) lines.push(c.name === "old" ? "LEFT (keys)" : "RIGHT (Mixamo)");
    const e = A.life.effort(t), wt = A.life(t).root.x / 0.035, k = c.k;
    if (MOCAP && k < 0.99) lines.push(`clip: body layers ${((1 - k) * 100).toFixed(0)}% faded out`);
    if (on.breath && k > 0.01) lines.push(`breath ${Math.round(60 * (0.25 + 0.42 * e))}/min, effort ${(e * 100).toFixed(0)}%`);
    if (on.sway && Math.abs(wt * k) > 0.05) lines.push(`weight on his ${wt > 0 ? "left" : "right"} leg ${(Math.abs(wt * k) * 100).toFixed(0)}%`);
    if (on.settle && k > 0.5 && A.life.stops.some((s) => t > s.t && t < s.t + 0.9)) lines.push("settling after a stop");
    if (on.lean && (Math.abs(A.tilt.forward(t)) > 0.3 || Math.abs(A.tilt.left(t)) > 0.3)) lines.push(`lean ${A.tilt.forward(t) > 0 ? "forward" : "back"} ${Math.abs(A.tilt.forward(t)).toFixed(1)}°, into turn ${A.tilt.left(t).toFixed(1)}°`);
    const ch = A.chain(t).chest;
    if (on.attention && Math.hypot(ch[0], ch[1]) > 0.3) lines.push(`chest joins the look: ${ch[1].toFixed(1)}° turn, ${ch[0].toFixed(1)}° down`);
    if (on.steady && Math.hypot(...c.steadyNow) > 0.3) lines.push(`head steadies ${c.steadyNow[0].toFixed(1)}° pitch, ${c.steadyNow[1].toFixed(1)}° roll`);
    if (on.gaze && c.blink > 0.05) lines.push("blink");
    if (on.gaze) lines.push(`eyes ${c.eyes.map((v) => v.toFixed(2)).join(" ")}${on.lids ? `, lids ${c.lid.toFixed(2)}` : ""}`);
    if (c.handErr != null) lines.push(`hand ${(c.handErr * 100).toFixed(1)} cm off its target`);
  }
  if (!MOCAP && cast[0].handErr != null) lines.push(`(left hand ${(cast[0].handErr * 100).toFixed(1)} cm off)`);
  if (MOODNAME !== "calm") lines.push(`mood ${MOODNAME}: holds ${(FX.hold * 100).toFixed(0)}% of each move, then goes`);
  info.textContent = lines.join("\n");
};

const clock = document.getElementById("clock"), slider = document.getElementById("t");
slider.min = FROM; slider.max = TO; slider.step = 1 / 30;
let t = q.has("t") ? +q.get("t") : FROM, playing = !q.has("t"), speed = 1, last = performance.now();
const draw = (tt) => {
  t = tt;
  for (const c of cast) perform(c, t);
  frame(t);
  renderer.render(scene, camera);
  status(t);
  const m = Math.floor(t / 60), s = (t - m * 60).toFixed(3).padStart(6, "0");
  clock.textContent = `${String(m).padStart(2, "0")}:${s}`;
  slider.value = t;
};
const loop = (now) => {
  if (playing) { t += ((now - last) / 1000) * speed; if (t > TO) t = FROM; }
  last = now;
  draw(t);
  requestAnimationFrame(loop);
};
const go = (k, v) => { q.set(k, v); q.delete("t"); location.search = q.toString(); };
slider.oninput = () => { playing = false; draw(+slider.value); };
document.getElementById("play").onclick = () => { playing = !playing; };
for (const b of document.querySelectorAll("[data-speed]")) b.onclick = () => { speed = +b.dataset.speed; };
for (const b of document.querySelectorAll("[data-view]")) b.onclick = () => { q.set("view", b.dataset.view); };
for (const b of document.querySelectorAll("[data-scene]")) { b.onclick = () => go("scene", b.dataset.scene); b.setAttribute("aria-pressed", String(b.dataset.scene === NAME)); }
for (const b of document.querySelectorAll("[data-mood]")) { b.onclick = () => go("mood", b.dataset.mood); b.setAttribute("aria-pressed", String(b.dataset.mood === MOODNAME)); }
const toggles = document.getElementById("layers");
for (const k of LAYERS) {
  const l = document.createElement("label");
  l.innerHTML = `<input type="checkbox" ${on[k] ? "checked" : ""}> ${k}`;
  l.querySelector("input").onchange = () => go("off", LAYERS.filter((x) => (x === k ? on[x] : !on[x])).join(","));
  toggles.append(l);
}
requestAnimationFrame(loop);
window.demo = { draw, cast, camera, SC, CLIPS, perform, placeOf, handLocal, get t() { return t; } };
