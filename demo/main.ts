// @ts-nocheck
// Before and after, side by side on one copied film scene (film/dig.ts): the left Steve is driven the way the film drives
// him now (smoothstep between keys, eyes fixed), the right one through film-kit's layers: throughPose and through (keys
// that keep moving), overlap (joints that trail and settle), gaze (eyes that fixate, jump, lead the head and hold the
// target while it turns). URL: ?t=<film seconds> stops there; ?view=both|face|faceOld|side; ?off=through,overlap,gaze.
import * as THREE from "three";
import { addPose as addRigPose, blendPose, loadRig, makePlayer, mouthAt, PX } from "./film/player";
import { blinkAt, FROM, LOOK, moodAt, MOVES, POSES, TO } from "./film/dig";
import { through } from "../src/curve";
import { throughPose } from "../src/pose";
import { overlap } from "../src/overlap";
import { anglesOf, eyeTime, gaze, REST_PITCH } from "../src/gaze";

const q = new URLSearchParams(location.search);
const off = new Set((q.get("off") ?? "").split(",").filter(Boolean));
const on = { through: !off.has("through"), overlap: !off.has("overlap"), gaze: !off.has("gaze") };

const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const mixPose = (a, b, k) => {
  const out = { root: {} };
  for (const r of new Set([...Object.keys(a.root ?? {}), ...Object.keys(b.root ?? {})])) out.root[r] = THREE.MathUtils.lerp(a.root?.[r] ?? 0, b.root?.[r] ?? 0, k);
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) if (j !== "root") { const x = a[j] ?? [0, 0, 0], y = b[j] ?? [0, 0, 0]; out[j] = x.map((v, i) => THREE.MathUtils.lerp(v, y[i], k)); }
  return out;
};

// the body pose at t: the film's way (smoothstep per key pair), or through the keys
const bodyAt = (t, flow) => {
  const i = keyAt(MOVES, t), a = MOVES[i], b = MOVES[Math.min(i + 1, MOVES.length - 1)];
  const sa = t - a.t, A = POSES[a.pose](Math.max(0, sa));
  if (b === a || t < a.t) return A;
  const B = POSES[b.pose](0);
  if (!flow) return mixPose(A, B, smooth((t - a.t) / (b.t - a.t)));
  const p = MOVES[i - 1], n = MOVES[i + 2];
  return throughPose(p ? POSES[p.pose](t - p.t) : null, A, B, n ? POSES[n.pose](0) : null, [p?.t ?? 0, a.t, b.t, n?.t ?? 0], t);
};
// the head's look point and weight at t (tk: the time on the keys, for eyes that look ahead)
const lookAt = (t, flow) => {
  const i = keyAt(LOOK, t), a = LOOK[i], b = LOOK[Math.min(i + 1, LOOK.length - 1)];
  if (t < a.t) return null;
  if (b === a) return { p: new THREE.Vector3(...a.at), w: 1 };
  const p = LOOK[i - 1], n = LOOK[i + 2];
  const v = [0, 1, 2].map((c) => flow ? through(p ? p.at[c] : null, a.at[c], b.at[c], n ? n.at[c] : null, p?.t ?? 0, a.t, b.t, n?.t ?? 0, t) : THREE.MathUtils.lerp(a.at[c], b.at[c], smooth((t - a.t) / (b.t - a.t))));
  return { p: new THREE.Vector3(...v), w: 1 };
};
const lagOf = overlap((t) => bodyAt(t, on.through), TO + 1);
const shifts = LOOK.slice(0, -1).filter((k, i) => JSON.stringify(k.at) !== JSON.stringify(LOOK[i + 1].at)).map((k) => k.t);
const eyesAt = gaze(shifts, TO + 1);
const nextKey = (x) => LOOK.find((k) => k.t > x)?.t;

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15191c);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.02, 50);
scene.add(new THREE.HemisphereLight(0xdfe8ec, 0x2a2622, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-2, 4, 8);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(20, 20, 0x555a5e, 0x44484b);
grid.position.y = 0.001;
scene.add(grid);

const rig = await loadRig("vendor/player.glb");
const SIDE = 0.8; // each Steve this far either side of the film's spot, along z
const cast = [];
for (const [name, dz] of [["old", -SIDE], ["new", SIDE]]) {
  const s = await makePlayer(rig, "vendor/steve.png", { glow: 0.05 });
  scene.add(s.g);
  s.setPose({});
  s.g.updateMatrixWorld(true);
  const restHead = s.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: name === "old" ? 0xff8060 : 0x60e0a0 }));
  scene.add(dot);
  cast.push({ name, s, dz, restHead, dot });
}

const Q = new THREE.Quaternion(), E = new THREE.Vector3(), D = new THREE.Vector3();
// a world point from his eyes, in the posed head's own axes
const gazeTo = (c, p) => {
  c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
  c.s.bones.head.getWorldPosition(E).add(D.set(0, 4 * PX, 4 * PX).applyQuaternion(Q));
  return anglesOf(D.copy(p).sub(E).applyQuaternion(Q.invert()).toArray());
};
const perform = (c, t) => {
  const neu = c.name === "new", flow = neu && on.through;
  let pose = bodyAt(t, flow);
  if (neu && on.overlap) pose = addRigPose(pose, lagOf(t));
  c.s.g.position.set(1.88, 0, 9.55 + c.dz);
  c.s.g.rotation.y = -Math.PI / 2;
  c.s.setPose(pose);
  c.s.g.updateMatrixWorld(true);
  const shift = new THREE.Vector3(0, 0, c.dz);
  const look = lookAt(t, flow);
  if (look) { pose = blendPose(pose, { head: c.s.headTo(look.p.clone().add(shift)) }, look.w); c.s.setPose(pose); c.s.g.updateMatrixWorld(true); }
  c.dot.visible = !!look && !view().startsWith("face");
  if (look) c.dot.position.copy(look.p).add(shift);
  let eyes = [0, -0.15];
  if (neu && on.gaze) eyes = eyesAt(t, (f, o) => {
    const L = lookAt(eyeTime(f, nextKey), flow);
    const a = L && gazeTo(c, L.p.clone().add(shift));
    if (!a) return [o[0], REST_PITCH + o[1]];
    return [a[0] + o[0] / 3, a[1] + o[1] / 3];
  });
  c.s.face(moodAt(t), mouthAt([], 0), blinkAt(t), eyes);
  Object.assign(c, { eyes, head: pose.head });
};

const view = () => q.get("view") ?? "both";
const H0 = new THREE.Vector3();
const place = () => {
  const v = view();
  camera.up.set(0, 1, 0);
  for (const o of cast) o.s.g.visible = true;
  if (v === "both") { camera.fov = 30; camera.position.set(-2.9, 1.25, 9.55); camera.lookAt(1.88, 0.62, 9.55); }
  if (v === "side") { camera.fov = 30; camera.position.set(-1.6, 2.4, 12.9); camera.lookAt(1.7, 0.55, 9.55); }
  if (v === "face" || v === "faceOld") {
    // in front of the face, wherever it points: rest axes (z forward, y up) turned by the head
    const c = cast[v === "face" ? 1 : 0];
    c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
    c.s.bones.head.getWorldPosition(H0).add(D.set(0, 4 * PX, 2 * PX).applyQuaternion(Q));
    camera.fov = 30;
    camera.position.copy(H0).add(D.set(0, 0.08, 0.8).applyQuaternion(Q));
    for (const o of cast) o.s.g.visible = o === c;
    camera.up.set(0, 1, 0).applyQuaternion(Q);
    camera.lookAt(H0);
  }
  camera.updateProjectionMatrix();
};

const ui = document.getElementById("ui"), clock = document.getElementById("clock"), slider = document.getElementById("t");
slider.min = FROM; slider.max = TO; slider.step = 1 / 30;
let t = q.has("t") ? +q.get("t") : FROM, playing = !q.has("t"), speed = 1, last = performance.now();
const draw = (tt) => {
  t = tt;
  for (const c of cast) perform(c, t);
  place();
  renderer.render(scene, camera);
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
slider.oninput = () => { playing = false; draw(+slider.value); };
ui.querySelector("#play").onclick = () => { playing = !playing; };
for (const b of ui.querySelectorAll("[data-speed]")) b.onclick = () => { speed = +b.dataset.speed; };
for (const b of ui.querySelectorAll("[data-view]")) b.onclick = () => { q.set("view", b.dataset.view); };
requestAnimationFrame(loop);
window.demo = { draw, cast, camera, lagOf, bodyAt, lookAt, perform, get t() { return t; } };
