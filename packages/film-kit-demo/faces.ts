import { loadRig, makePlayer, mouthAt } from "mc-actor/player";
import {
  blendFace,
  drawToonFace,
  drawToonMarks,
  EXPRESSION_GROUPS,
  EXPRESSIONS,
  type Face,
  feel,
  FEELINGS,
  mix,
  prepareSkin,
  REF_ALEX,
  resolveFace,
  talk,
  toonStyle,
  wearToonFace,
  withBlink,
} from "mc-actor/toon-face";
import * as THREE from "three";

const q = new URLSearchParams(location.search);
const still = q.has("still");
const SKIN = "vendor/alex.png";

const H = Math.max(480, innerHeight - 90),
  W = Math.round(H * 0.6);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.querySelector("#stage")!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#7fb8f5");
scene.add(new THREE.HemisphereLight(0xd6ebff, 0x5f8f35, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 3.6);
sun.position.set(1.2, 4, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 0.5, far: 15 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: "#62b840", roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 100);
const SHOTS = {
  ref: { at: [0, 1.6, 4.2], look: [0, 1.59, 0] },
  close: { at: [0, 1.64, 1.75], look: [0, 1.62, 0] },
  medium: { at: [0, 1.35, 3.2], look: [0, 1.15, 0] },
} as const;
const shotNames = Object.keys(SHOTS) as (keyof typeof SHOTS)[];
let shot = shotNames.find((n) => n === q.get("shot")) ?? "ref";
const aim = () => {
  const { at, look } = SHOTS[shot];
  camera.position.set(at[0], at[1], at[2]);
  camera.lookAt(look[0], look[1], look[2]);
  document.querySelector("#shot")!.textContent = `Shot: ${shot}`;
};
aim();

const alex = await makePlayer(await loadRig("vendor/player.glb"), SKIN);
scene.add(alex.g);
const wear = wearToonFace(alex, REF_ALEX);

const names = Object.keys(EXPRESSIONS);
let target = resolveFace(q.get("face") ?? "smile"),
  from = target,
  base = target,
  t0 = 0,
  chosen = q.get("face") ?? "smile";
const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
const now = () => performance.now() / 1000;
const show = (face: Face, label: string) => {
  from = base;
  target = face;
  t0 = now();
  document.querySelector("#now")!.textContent = label;
};
const choose = (name: string) => {
  show(resolveFace(name), name);
  chosen = name;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tile"))
    b.setAttribute("aria-pressed", String(b.dataset.face === name));
};

const skinImg = new Image();
skinImg.src = SKIN;
await skinImg.decode();
const skin = document.createElement("canvas");
skin.width = skin.height = 64;
const sctx = skin.getContext("2d", { willReadFrequently: true })!;
sctx.drawImage(skinImg, 0, 0);
const flatStyle = toonStyle();
prepareSkin(sctx, REF_ALEX.skin);
const VIEW = 16,
  MARGIN = 4;
const tile = (name: string | Face, size = 320) => {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#7fb8f5";
  g.fillRect(0, 0, size, size);
  g.scale(size / VIEW, size / VIEW);
  g.translate(MARGIN, MARGIN);
  g.imageSmoothingEnabled = false;
  g.drawImage(skin, 8, 8, 8, 8, 0, 0, 8, 8);
  const face = resolveFace(name);
  drawToonFace(g, face, flatStyle);
  drawToonMarks(g, face, flatStyle);
  return c;
};
const groups = document.querySelector("#groups")!;
for (const [group, members] of Object.entries(EXPRESSION_GROUPS)) {
  const h = document.createElement("h2");
  h.textContent = `${group} (${members.length})`;
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const name of members) {
    const b = document.createElement("button");
    b.className = "tile";
    b.dataset.face = name;
    b.append(tile(name), name);
    b.onclick = () => choose(name);
    grid.append(b);
  }
  groups.append(h, grid);
}
const family = document.querySelector<HTMLSelectElement>("#family")!,
  level = document.querySelector<HTMLInputElement>("#level")!;
for (const name of Object.keys(FEELINGS)) family.add(new Option(`${name}: ${FEELINGS[name]!.join(" / ")}`, name));
const onFeel = () => {
  const k = Number(level.value);
  document.querySelector("#levelOut")!.textContent = k.toFixed(2);
  show(feel(family.value, k), `${family.value} ${k.toFixed(2)}`);
};
family.onchange = level.oninput = onFeel;

const toggle = (id: string, on?: boolean) => {
  const b = document.querySelector<HTMLButtonElement>(`#${id}`)!;
  const v = on ?? b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(v));
  return v;
};
const pressed = (id: string) =>
  document.querySelector(`#${id}`)!.getAttribute("aria-pressed") === "true";
for (const id of ["auto", "talk", "blink", "sway"]) document.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = () => toggle(id);
document.querySelector<HTMLButtonElement>("#shot")!.onclick = () => {
  shot = shotNames[(shotNames.indexOf(shot) + 1) % shotNames.length]!;
  aim();
};
if (still) for (const id of ["blink", "sway"]) toggle(id, false);
choose(chosen);
t0 = -1;

const CUES: [number, string][] = [
  [0, "X"], [0.12, "B"], [0.26, "D"], [0.42, "C"], [0.56, "F"], [0.7, "E"],
  [0.84, "A"], [0.94, "G"], [1.08, "D"], [1.26, "H"], [1.4, "X"],
];
const yaw = Number(q.get("yaw") ?? 0),
  pitch = Number(q.get("pitch") ?? 0);
let nextBlink = 2,
  nextAuto = 0;
const frame = () => {
  const t = now();
  if (pressed("auto") && t > nextAuto) {
    choose(names[(names.indexOf(chosen) + 1) % names.length]!);
    nextAuto = t + 1.6;
  }
  base = blendFace(from, target, minJerk((t - t0) / 0.28));
  let face: Face = pressed("talk") ? talk(base, mouthAt(CUES, t % 1.6)) : base;
  if (pressed("blink")) {
    if (t > nextBlink + 0.16) nextBlink = t + 2 + Math.random() * 2.5;
    const u = (t - nextBlink) / 0.16;
    if (u > 0 && u < 1) face = withBlink(face, Math.sin(u * Math.PI));
  }
  wear.set(face);
  const sw = pressed("sway") ? 1 : 0;
  alex.setPose({
    head: [pitch + sw * 3 * Math.sin(t * 0.9), yaw + sw * 9 * Math.sin(t * 0.55), sw * 2.5 * Math.sin(t * 0.7)],
  });
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
};
frame();
Object.assign(window, {
  toonDemo: { choose, show, wear, alex, tile, scene, sun, renderer, camera, resolveFace, blendFace, withBlink, feel, mix },
});
