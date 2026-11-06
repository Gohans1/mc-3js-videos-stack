// @ts-nocheck
// Before and after, side by side: the left Steve is driven the way the film drives him now (smoothstep between keys,
// breathing written into each pose, eyes fixed), the right one through film-kit's layers, each switchable:
//   through (keys that keep moving), overlap (joints trail and settle), cartoon (anticipation and follow-through),
//   breath / sway / settle (src/idle.ts), gaze (fixations, saccades that lead the head, held targets, blinks).
// The right Steve's poses are read at their first instant, so their written-in breathing is gone and breath replaces it;
// his soles are held where the pose puts them (leg IK), as the film's feet.ts does, so the hips can sway over them.
// URL: ?scene=dig|idle  ?t=<seconds> stops there  ?view=both|side|face|faceOld  ?off=<layer>,...
import * as THREE from "three";
import { addPose as addRigPose, blendPose, loadRig, makePlayer, mouthAt, PX } from "./film/player";
import { blinkAt, DIG, IDLE, moodAt, POSES } from "./film/dig";
import { through } from "../src/curve";
import { throughPose } from "../src/pose";
import { overlap } from "../src/overlap";
import { cartoon } from "../src/cartoon";
import { idle } from "../src/idle";
import { anglesOf, eyeTime, gaze, REST_PITCH } from "../src/gaze";

const q = new URLSearchParams(location.search);
const LAYERS = ["through", "overlap", "cartoon", "breath", "sway", "settle", "gaze"];
const on = Object.fromEntries(LAYERS.map((k) => [k, !(q.get("off") ?? "").split(",").includes(k)]));
const SC = q.get("scene") === "idle" ? IDLE : DIG;
const { moves: MOVES, look: LOOK, from: FROM, to: TO } = SC;
const STANDING = new Set(["stand", "readUp", "desk", "fling", "pant", "gasp"]);

const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const mixPose = (a, b, k) => {
  const out = { root: {} };
  for (const r of new Set([...Object.keys(a.root ?? {}), ...Object.keys(b.root ?? {})])) out.root[r] = THREE.MathUtils.lerp(a.root?.[r] ?? 0, b.root?.[r] ?? 0, k);
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) if (j !== "root") { const x = a[j] ?? [0, 0, 0], y = b[j] ?? [0, 0, 0]; out[j] = x.map((v, i) => THREE.MathUtils.lerp(v, y[i], k)); }
  return out;
};

// a key's pose at s seconds into it; the right Steve's poses hold their first instant (frenzy's rocking is its action)
const poseOf = (name, s, neu) => POSES[name](neu && on.breath && name !== "frenzy" ? 0 : Math.max(0, s));
const bodyAt = (t, neu) => {
  const i = keyAt(MOVES, t), a = MOVES[i], b = MOVES[Math.min(i + 1, MOVES.length - 1)];
  const A = poseOf(a.pose, t - a.t, neu);
  if (b === a || t < a.t) return A;
  const B = poseOf(b.pose, 0, neu);
  if (!(neu && on.through)) return mixPose(A, B, smooth((t - a.t) / (b.t - a.t)));
  const p = MOVES[i - 1], n = MOVES[i + 2];
  return throughPose(p ? poseOf(p.pose, t - p.t, neu) : null, A, B, n ? poseOf(n.pose, 0, neu) : null, [p?.t ?? 0, a.t, b.t, n?.t ?? 0], t);
};
const standingAt = (t) => {
  const i = keyAt(MOVES, t), a = MOVES[i], b = MOVES[Math.min(i + 1, MOVES.length - 1)];
  const k = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
  return (STANDING.has(a.pose) ? 1 - k : 0) + (STANDING.has(b.pose) ? k : 0);
};
// the head's look point and weight (null keys: the pose's own head), smoothstep or through the keys
const lookAt = (t, flow) => {
  if (!LOOK.length || t < LOOK[0].t) return null;
  const i = keyAt(LOOK, t), a = LOOK[i], b = LOOK[Math.min(i + 1, LOOK.length - 1)];
  const x = b === a ? 0 : smooth((t - a.t) / (b.t - a.t));
  if (a.at && !b.at) return { p: new THREE.Vector3(...a.at), w: 1 - x };
  if (!a.at && b.at) return { p: new THREE.Vector3(...b.at), w: x };
  if (!a.at) return null;
  const p = LOOK[i - 1]?.at && LOOK[i - 1], n = LOOK[i + 2]?.at && LOOK[i + 2];
  const v = [0, 1, 2].map((c) => (flow ? through(p ? p.at[c] : null, a.at[c], b.at[c], n ? n.at[c] : null, p?.t ?? 0, a.t, b.t, n?.t ?? 0, t) : THREE.MathUtils.lerp(a.at[c], b.at[c], x)));
  return { p: new THREE.Vector3(...v), w: 1 };
};
const nextKey = (x) => LOOK.find((k) => k.t > x)?.t;
const shifts = LOOK.slice(0, -1).filter((k, i) => JSON.stringify(k.at) !== JSON.stringify(LOOK[i + 1].at)).map((k) => k.t);

// every layer is baked once from the right Steve's body pose
const base = (t) => bodyAt(t, true);
const lagOf = overlap(base, TO + 1);
const toon = cartoon(base, TO + 1);
const life = idle(base, TO + 1, { standing: standingAt, breath: +on.breath, sway: +on.sway, settle: +on.settle });
const eyesAt = gaze(shifts, TO + 1, { blinkedNear: (t) => [...Array(16)].some((_, i) => blinkAt(t - i / 30, SC.blinksFrom) > 0) });

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15191c);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.02, 50);
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
const soles = { L: new THREE.Vector3(), R: new THREE.Vector3() };
const place = (c, pose) => { c.s.setPose(pose); c.s.g.updateMatrixWorld(true); };
const perform = (c, t) => {
  const neu = c.name === "new";
  c.s.g.position.set(SC.moves[0].at[0], 0, SC.moves[0].at[2] + c.dz);
  c.s.g.rotation.y = -Math.PI / 2;
  let pose = bodyAt(t, neu);
  const stand = neu ? standingAt(t) : 0;
  if (stand > 0) { place(c, pose); c.s.soleAt("L", soles.L); c.s.soleAt("R", soles.R); }
  if (neu) {
    if (on.overlap) pose = addRigPose(pose, lagOf(t));
    if (on.cartoon) pose = addRigPose(pose, toon(t));
    pose = addRigPose(pose, life(t));
  }
  place(c, pose);
  // planted soles stay where the pose put them while the hips sway and sink over them
  if (stand > 0) { for (const sd of ["L", "R"]) pose = blendPose(pose, c.s.legTo(sd, soles[sd]), stand); place(c, pose); }
  const shift = new THREE.Vector3(0, 0, c.dz);
  const look = lookAt(t, neu && on.through);
  if (look) { pose = blendPose(pose, { head: c.s.headTo(look.p.clone().add(shift)) }, look.w); place(c, pose); }
  c.dot.visible = !!look && look.w > 0.5 && !view().startsWith("face");
  if (look) c.dot.position.copy(look.p).add(shift);
  let eyes = [0, -0.15], extra = 0;
  if (neu && on.gaze) {
    const g = eyesAt(t, (f, o) => {
      const L = lookAt(eyeTime(f, nextKey), on.through);
      const a = L && L.w > 0.5 && gazeTo(c, L.p.clone().add(shift));
      return a ? [a[0] + o[0] / 3, a[1] + o[1] / 3] : [o[0], REST_PITCH + o[1]];
    });
    eyes = g.look;
    extra = g.blink;
  }
  const blink = Math.max(blinkAt(t, SC.blinksFrom), extra);
  c.s.face(moodAt(SC.face, t), mouthAt([], 0), blink, eyes);
  Object.assign(c, { eyes, blink, head: pose.head, stand });
};

const view = () => q.get("view") ?? "both";
const H0 = new THREE.Vector3();
const frame = () => {
  const v = view();
  camera.up.set(0, 1, 0);
  for (const o of cast) o.s.g.visible = true;
  const [x0, , z0] = SC.moves[0].at;
  if (v === "both") { camera.fov = 30; camera.position.set(x0 - 6.4, 1.3, z0); camera.lookAt(x0, 0.6, z0); }
  if (v === "side") { camera.fov = 30; camera.position.set(x0 - 3.5, 2.4, z0 + 3.35); camera.lookAt(x0 - 0.2, 0.6, z0); }
  if (v === "face" || v === "faceOld") {
    // in front of the face, wherever it points: rest axes (z forward, y up) turned by the head
    const c = cast[v === "face" ? 1 : 0];
    c.s.bones.head.getWorldQuaternion(Q).multiply(c.restHead);
    c.s.bones.head.getWorldPosition(H0).add(D.set(0, 4 * PX, 2 * PX).applyQuaternion(Q));
    camera.fov = 30;
    camera.position.copy(H0).add(D.set(0, 0.08, 0.8).applyQuaternion(Q));
    camera.up.set(0, 1, 0).applyQuaternion(Q);
    camera.lookAt(H0);
    for (const o of cast) o.s.g.visible = o === c;
  }
  camera.updateProjectionMatrix();
};

// what the right Steve's automatic layers are doing now
const info = document.getElementById("info");
const status = (t) => {
  const c = cast[1], e = life.effort(t), w = life(t).root.x / 0.035;
  const rate = Math.round(60 * (0.25 + 0.42 * e));
  const lines = [
    on.breath && `breath ${rate}/min, effort ${(e * 100).toFixed(0)}%`,
    on.sway && Math.abs(w) > 0.05 &&`weight on his ${w > 0 ? "left" : "right"} leg ${(Math.abs(w) * 100).toFixed(0)}%`,
    on.settle && life.stops.some((s) => t > s.t && t < s.t + 0.9) && "settling after a stop",
    on.gaze && c.blink > 0.05 && "blink",
    on.gaze && `eyes ${c.eyes.map((v) => v.toFixed(2)).join(" ")}`,
  ].filter(Boolean);
  info.textContent = lines.join("\n");
};

const clock = document.getElementById("clock"), slider = document.getElementById("t");
slider.min = FROM; slider.max = TO; slider.step = 1 / 30;
let t = q.has("t") ? +q.get("t") : FROM, playing = !q.has("t"), speed = 1, last = performance.now();
const draw = (tt) => {
  t = tt;
  for (const c of cast) perform(c, t);
  frame();
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
for (const b of document.querySelectorAll("[data-scene]")) { b.onclick = () => go("scene", b.dataset.scene); b.setAttribute("aria-pressed", String(b.dataset.scene === SC.name)); }
const toggles = document.getElementById("layers");
for (const k of LAYERS) {
  const l = document.createElement("label");
  l.innerHTML = `<input type="checkbox" ${on[k] ? "checked" : ""}> ${k}`;
  l.querySelector("input").onchange = () => go("off", LAYERS.filter((x) => (x === k ? on[x] : !on[x])).join(","));
  toggles.append(l);
}
requestAnimationFrame(loop);
window.demo = { draw, cast, camera, lagOf, toon, life, bodyAt, lookAt, perform, get t() { return t; } };
