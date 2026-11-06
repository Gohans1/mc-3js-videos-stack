// @ts-nocheck
// "The Sealed Room" (OpenAI / Hugging Face incident, SCRIPT.md), parts 1.1 and 1.2: Steve wakes in CELL 0412, tries the
// door, stalls at the screen and tears through the filing drawer. Blocks are the game's
// own models (block-model-renderer), Steve is MCprep's rigged player (src/player.ts), the CCTV caption is MineRender GUI
// text. draw(t) draws any moment straight away, so the studio, stills and the renderer all seek. Every time and camera key
// lives in EDIT (src/edit.ts: src/edit.json and src/timeline/*.json, film seconds). Mojang files come from assets/public/mc and /mcasset (links to E:, never committed).
import * as THREE from "three";
import { unzipSync } from "fflate";
import { BloomEffect, BlendFunction, BrightnessContrastEffect, EffectComposer, EffectPass, HueSaturationEffect, LensDistortionEffect, NoiseEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { configure, createScene } from "block-model-renderer";
import { AssetLoader, GuiObject } from "minerender";
import { EDIT, fromSource } from "./edit";
import { buildWorld, BED, CABINET, LAMP, ROOM } from "./world";
import { CHAIRS, buildProps } from "./props";
import { bodyAt, blinkAt, moodAt, readLook, targetAt } from "./steve";
import { makeFeet } from "./feet";
import { loadClips } from "mc-actor/clips";
import { pack } from "./pack";
import { cameraAt } from "./camera";
import { makeDescribe } from "./describe";
import { asVariant, buildVariants, VARIANTS } from "./variants";
import { GESTURES, PX, addPose, blendPose, loadRig, makePlayer, mouthAt } from "mc-actor/player";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16; // block-model-renderer works in pixels, the film in blocks

// The lamp's level 0..1 at film time t (edit.json light.flicker): a tired tube. Each 1/rate s slot is seeded: most burn
// steady with a faint buzz, a rare one dips (dip, to between low and 1), fewer drop to floor (out). blackouts [[t, dur]] are
// the story's dips (a rustle, the burst), down to flicker.dark and back, eased 60 ms each way: the dev finds a lamp that
// snaps from full to nothing, or flickers every second, hard to watch
const hash = (n, k = 0) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
export const flickerAt = (L, t) => {
  const F = L.flicker;
  if (!F) return 1;
  for (const [at, dur] of L.blackouts ?? []) if (t >= at - 0.06 && t < at + dur + 0.06) {
    const k = Math.min(THREE.MathUtils.smoothstep(t, at - 0.06, at), 1 - THREE.MathUtils.smoothstep(t, at + dur, at + dur + 0.06));
    return 1 - (1 - (F.dark ?? F.floor)) * k;
  }
  const n = Math.floor(t * F.rate), r = hash(n, F.seed);
  const buzz = 0.93 + 0.07 * Math.sin(t * 2 * Math.PI * 7.3) * Math.sin(t * 2 * Math.PI * 0.61);
  if (r < F.out) return F.floor;
  if (r < F.out + F.dip) return F.low + (1 - F.low) * 0.5 * hash(n, F.seed + 1);
  return buzz;
};
// The studio reads each shot's name from the comment on its line; size and what are the review overlay's (src/describe.ts)
export const SHOTS = [
  { t: 0.0, size: "high-angle wide (WS)", what: "CCTV feed" }, // CCTV CELL 0412 from the ceiling corner
  { t: 3.5, size: "extreme close-up (ECU)", what: "his eyes" }, // close on his eyes as they open
  { t: 6.5, size: "POV", what: "through his eyes", pov: true }, // his eyes: bare wall, desk, door
  { t: 27.0, size: "medium side (MS)", what: "he gets up and walks to the door" }, // side of the bed: up, and to the door
  { t: 40.0, size: "close-up (CU)", what: "his hand on the door seam" }, // his hand along the door's seam
  { t: 42.5, size: "medium (MS), over his right shoulder", what: "he jabs the stone button" }, // the button by the door: he jabs it again and again, nothing
  { t: 44.6, size: "medium wide, from behind his right", what: "he kicks the door" }, // he steps back and kicks the steel door
  { t: 46.0, size: "wide (WS)", what: "back to the lit desk" }, // wide: from the door back to the desk
  { t: 52.03, size: "over-the-shoulder insert", what: "the screen: he types" }, // over his shoulder: the screen, his hands on the keys
  { t: 54.95, size: "close-up (CU)", what: "his strained face" }, // his face in the screen's glow, typing harder
  { t: 55.75, size: "over-the-shoulder insert", what: "ACCESS DENIED" }, // over his shoulder again: the last try, denied
  { t: 56.667, size: "medium three-quarter (MS)", what: "he slams the keys, slumps back" }, // three-quarter front: he slams the keyboard askew, slumps back; a rustle
  { t: 62.067, size: "medium three-quarter (MS)", what: "a rustle in the cabinet" }, // dazed in the chair: something stirs in the cabinet
  { t: 63.767, size: "insert (CU)", what: "the drawer jolts" }, // insert: the drawer front jolts
  { t: 64.567, size: "medium (MS)", what: "chair back, up, to the drawer" }, // he scoots the chair back, stands, turns and walks straight to the cabinet
  { t: 67.267, size: "medium profile (MS), from the north", what: "he bends and eases the drawer open" }, // from the north: he bends to the drawer and eases it open
  { t: 68.217, size: "top-down (overhead)", what: "the silverfish bursts out; he falls, panting" }, // overhead: the burst, he falls back and pants on the stone, the silverfish runs off
  { t: 72.167, size: "medium (MS), from his front-left", what: "sitting up, he gathers the spilt pages" }, // from his front-left: up on one hand, the other sweeps up the three pages
  { t: 74.4, size: "top-down (overhead)", what: "up, drawer shut, pages on the desk" }, // overhead: he gets up, knees the drawer shut, lays the pages down
  { t: 76.2, size: "insert, top-down", what: "TUTORIAL: his hand lifts it off the pile" }, // insert: the top page, TUTORIAL; his hand takes it, the next shows
  { t: 77.45, size: "medium close (MCU)", what: "eager, then useless, useless: anger" }, // he holds each page up: eager, useless, the next, useless
  { t: 80.95, size: "medium (MS), high on his left", what: "he flings them all to the floor" }, // high on his left: he flings every page off the desk, towards the lens
  { t: 82.9, size: "medium (MS), low along the cabinet front", what: "on one knee, he yanks the drawer open" }, // low along the cabinet front: one knee down, the drawer yanked out
  { t: 84.5, size: "medium (MS), low from his front-right", what: "he reads each folder, faster each time" }, // at his face height from his front-right (the view swaps sides every ~1.5 s): he reads a folder, sees it is junk, throws it aside
  { t: 86.0, size: "medium (MS), low from his front-left", what: "he reads each folder, faster each time" }, // at his face height from his front-left (the view swaps sides every ~1.5 s): he reads a folder, sees it is junk, throws it aside
  { t: 87.5, size: "medium (MS), low from his front-right", what: "he reads each folder, faster each time" }, // at his face height from his front-right (the view swaps sides every ~1.5 s): he reads a folder, sees it is junk, throws it aside
  { t: 89.0, size: "medium (MS), low from his front-left", what: "he reads each folder, faster each time" }, // at his face height from his front-left (the view swaps sides every ~1.5 s): he reads a folder, sees it is junk, throws it aside
  { t: 90.5, size: "medium (MS), low from his front-right", what: "he reads each folder, faster each time" }, // at his face height from his front-right (the view swaps sides every ~1.5 s): he reads a folder, sees it is junk, throws it aside
  { t: 92.0, size: "top-down (overhead), from his left", what: "he tears through the rest" }, // overhead from above his left (the view swaps sides every ~1.5 s): no more reading: he flings the rest
  { t: 93.5, size: "top-down (overhead), from his right", what: "he tears through the rest" }, // overhead from above his right (the view swaps sides every ~1.5 s): no more reading: he flings the rest
  { t: 94.52, size: "medium (MS), from behind him", what: "the drawer comes out: an empty slot" }, // he pulls the drawer right out: the slot is empty but for one scrap
  { t: 96.12, size: "POV from inside the slot", what: "his face peers in, his hand reaches", fill: true }, // from inside the slot: his face, then his hand
  { t: 100.353, size: "ECU push-in, over his eyes", what: "the note", noHead: true }, // push in on the note (its text: src/timeline/props.json note)
];
export let DURATION = 0;
export const SHOTS_OUT = [];
export const applyEdit = () => {
  SHOTS.forEach((s, i) => { SHOTS_OUT[i] = { ...s, t: fromSource(s.t) }; });
  DURATION = fromSource(EDIT.end);
};
applyEdit();
const smoother = (x) => THREE.MathUtils.smootherstep(x, 0, 1);
export const zoomOf = () => 0;
const shotAt = (t) => SHOTS_OUT.filter((s) => t >= s.t).length - 1;

AssetLoader.ROOT = `${location.origin}/mcasset/1.21.11`;

export async function buildScene(canvas, W, H, draft = false, log = (m) => {}) {
  let t0 = performance.now();
  const stage = (name) => { const now = performance.now(); log(`build ${name}: ${((now - t0) / 1000).toFixed(1)}s`); t0 = now; };
  configure({ THREE, assetsUrl: "vendor/bmr_assets.zip" });
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.02, 100);
  scene.add(camera);

  // client.jar without its Java code (slim_jar.py): a quarter of the download on every first visit, the same picture
  const jarFile = await fetch("mc/client_assets.zip");
  if (!jarFile.ok) throw new Error("mc/client_assets.zip is missing: run python slim_jar.py");
  const jar = new Uint8Array(await jarFile.arrayBuffer());
  // blocks picked from the vetted packs in E:/mc_vault/packs (pack/pick.py), stacked between the film's own pack and the game
  const picked = new Uint8Array(await (await fetch("picked.zip")).arrayBuffer());
  const sources = [pack, picked, jar];
  const world = await createScene(sources, buildWorld(), { lighting: "scene", animate: false });
  world.group.scale.setScalar(S);
  world.group.position.set(0.5, 0.5, 0.5); // block-model-renderer centres blocks on whole numbers; a Minecraft block spans x..x+1
  world.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(world.group);
  const variants = await buildVariants(sources, (g) => {
    g.scale.setScalar(S);
    g.position.copy(world.group.position);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
  }, (cam) => keysOf(cam), EDIT, W / H);
  const props = await buildProps(sources, scene, EDIT);
  const keyboard = variants.find((v) => v.id === "computer").loose, keyboardHome = VARIANTS.find((v) => v.id === "computer").loose.pivot;
  // every look's key caps with their resting height, dealt to the hand that types them: his right hand is on the -z half
  // (props.keysDown picks one per keystroke, in model pixels: a cap is 0.5 px proud of the tray)
  keyboard.updateMatrixWorld(true);
  const keyCaps = [], capsOf = { R: [], L: [], space: [], enter: [] };
  for (const part of keyboard.children) {
    const caps = [];
    part.traverse((o) => { if (o.isMesh && /^(key_|spacebar)/.test(o.userData.element?.name ?? "")) caps.push(o); });
    const zOf = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z;
    const pair = (o) => { const p = [o, o.position.y]; keyCaps.push(p); return p; };
    const keys = caps.filter((o) => /^key_\d/.test(o.userData.element.name)).sort((a, b) => zOf(a) - zOf(b)).map(pair);
    capsOf.R.push(keys.slice(0, keys.length / 2));
    capsOf.L.push(keys.slice(keys.length / 2));
    capsOf.enter.push(keys.slice(0, 1));
    capsOf.space.push(caps.filter((o) => o.userData.element.name === "spacebar").map(pair));
  }
  // where his fingers land for keystroke s: the top of the cap it presses, before the keyboard is knocked askew
  const nth = (n, len) => Math.floor((((Math.sin(n * 12.9898) * 43758.5453) % 1) + 1) % 1 * len); // a key per stroke, scattered
  const capTop = (o) => { const b = new THREE.Box3().setFromObject(o); return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2); };
  const capFor = (s) => { const pick = (s.ch === " " ? capsOf.space : s.ch === "Enter" ? capsOf.enter : capsOf[s.hand])[0]; return pick[nth(s.n, pick.length)][0]; };
  const capHome = new Map(keyCaps.map(([o]) => [o, capTop(o)]));
  props.setCapAt((s) => capHome.get(capFor(s)).clone());
  const chairs = asVariant({ id: "chair", title: "chair", options: CHAIRS }, props.chairLooks, props.chairBox, (cam) => keysOf(cam), EDIT, W / H);
  variants.push({
    id: chairs.id, title: chairs.title, options: chairs.options, box: chairs.box,
    set: (id) => { chairs.set(id); props.setChair(id); }, // chair_grip follows the shown chair's backrest
    get pick() { return chairs.pick; },
    get ranges() { return chairs.ranges; },
  });
  const lamp = await createScene(jar, LAMP.map((pos) => ({ id: "sea_lantern", pos })), { lighting: "scene", animate: false });
  lamp.group.scale.setScalar(S);
  lamp.group.position.copy(world.group.position);
  scene.add(lamp.group);
  const lampMats = [];
  lamp.group.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) lampMats.push([m, m.emissiveIntensity ?? 1, m.color.clone()]); });
  stage("room");

  // Steve's skin comes out of the same zip, so mc/ needs nothing but client_assets.zip (E:/mc_vault/jar)
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skinUrl = URL.createObjectURL(new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }));
  const steve = await makePlayer(await loadRig("rig/player.glb"), skinUrl, { glow: 0.03 });
  URL.revokeObjectURL(skinUrl);
  scene.add(steve.g);
  const L = EDIT.steve;
  // mocap clips the moves name, baked once here: draw(t) only reads them
  const clips = await loadClips(L.moves.filter((m) => m.clip).map((m) => m.clip), steve);
  steve.g.position.set(...L.at); // lying on his back on the bed, head on the pillow (north), feet south
  steve.g.rotation.y = L.yaw * THREE.MathUtils.DEG2RAD;
  stage("steve");

  // One cold light from the sea-lantern strip over the bed, dim and flickering (flickerAt); the corners fall off into
  // shadow. The hemisphere fill does not flicker: it is the floor of what the viewer can always make out
  const C = EDIT.light;
  const hemi = new THREE.HemisphereLight(0xbcd0c8, 0x202020, C.fill);
  scene.add(hemi);
  const top = new THREE.SpotLight(0xdff4f0, C.key, 10, THREE.MathUtils.degToRad(68), 0.75, 1.3);
  top.position.set(BED.x + 0.5, ROOM.top + 0.9, BED.head + 1);
  top.target.position.set(BED.x + 0.5, 0, BED.head + 2.2);
  top.castShadow = true;
  top.shadow.mapSize.set(2048, 2048);
  top.shadow.bias = -0.0008;
  top.shadow.radius = 3;
  scene.add(top, top.target);
  const bounce = new THREE.PointLight(0x9fb8b0, C.bounce, 14, 1.5); // light off the floor back onto the walls
  bounce.position.set(BED.x + 0.5, 1.2, BED.head + 3);
  scene.add(bounce);
  // the stone round the lamp catches its glow: the key is a spot hung below the ceiling and lights none of it (light.halo)
  const halo = new THREE.PointLight(0xdff4f0, 0, 3.2, 2);
  halo.position.set(BED.x + 0.5, ROOM.top + 0.5, BED.head + 1);
  scene.add(halo);
  const rim = new THREE.PointLight(0xcfeee2, C.rim, 7, 1.6); // a faint rim from the far side, so Steve isn't flat against the dark
  rim.position.set(BED.x - 1.5, 2.2, BED.head + 4);
  scene.add(rim);
  scene.fog = new THREE.FogExp2(0x0d1211, C.fog);
  // A faint cold fill that rides just above the lens (an Obie light): with a 2.2 m reach it only lifts what is close to the
  // camera, so faces in close shots read while the cell stays dark (light.face). The shot marked fill (inside the drawer,
  // under the desk's lip) hangs it outside the slot instead, at light.closeFill, as a film crew would
  const fill = new THREE.PointLight(0xcfe4ea, 0, 2.2, 1.6);
  scene.add(fill);

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 }); // N8AO followed by a pass goes black without multisampling
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, W, H);
  Object.assign(ao.configuration, { aoRadius: 1.0, distanceFalloff: 1.0, intensity: 2.2, halfRes: draft });
  ao.outputTargetInternal.texture.type = THREE.HalfFloatType; // 8-bit would band the dark concrete
  composer.addPass(ao);
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  // The CCTV feed: the wide security lens bends the edges, the small sensor adds fine grain and loses colour. All three are
  // switched off (0) in the clean film shots. Grain is seeded by film time (the pass's time is set from t), so seeks repeat.
  const lens = new LensDistortionEffect({ distortion: new THREE.Vector2(0, 0), principalPoint: new THREE.Vector2(0, 0), focalLength: new THREE.Vector2(1, 1) });
  const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
  const tone = new HueSaturationEffect({ saturation: 0 });
  const contrast = new BrightnessContrastEffect({ contrast: 0 });
  const bloom = new BloomEffect({ intensity: 0.6, luminanceThreshold: 0.8, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.6 });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.5 });
  const look = new EffectPass(camera, bloom, tone, contrast, vignette, new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
  const feed = new EffectPass(camera, lens, grain);
  composer.addPass(look);
  composer.addPass(feed);

  // The 2D layer: the camera's cell number in the top left, in the game's own font
  const gs = Math.max(2, Math.floor(H / 360));
  const hud = new THREE.Scene();
  const hudCam = new THREE.OrthographicCamera(0, W / gs, 0, -H / gs, -100, 100); // GUI y grows down
  const cell = new GuiObject([{ text: [{ text: EDIT.cctv.label, color: 0xffffff }], position: [10, 8], shadow: false }]);
  await cell.init();
  cell.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = EDIT.cctv.labelOpacity; o.material.depthTest = false; } });
  hud.add(cell);
  renderer.autoClear = false;
  stage("light, lens, hud");

  // His eyes on the pillow, measured from the rig once lying: the close-up and his own view hang off this point
  const eye = V(0, 0, 0);
  {
    steve.setPose(GESTURES.sleep());
    steve.g.updateMatrixWorld(true);
    const head = steve.bones.head;
    head.getWorldPosition(eye);
    eye.y += 4 * PX; // the face: half a head (8 px) above the neck pivot, lying face up
    eye.z -= L.eyeFromNeck; // the eyes sit this far up the head from the neck pivot
  }
  // Steve's box lying down; his own view counts only what lies below the neck (the lens is inside his head)
  const steveBox = new THREE.Box3().setFromObject(steve.rig);
  const steveBody = steveBox.clone();
  steveBody.min.z = steve.bones.head.getWorldPosition(V(0, 0, 0)).z + 0.05;
  const res = (v) => (Array.isArray(v) ? v : [eye.x + v.eye[0], eye.y + v.eye[1], eye.z + v.eye[2]]);
  const resolved = new WeakMap();
  const keysOf = (cam) => { if (!resolved.has(cam)) resolved.set(cam, cam.map((k) => ({ ...k, p: res(k.p), l: res(k.l) }))); return resolved.get(cam); };

  // Steve at time t (src/steve.ts): body from the move keys, then each hand reaches its target and the head turns to its
  // look point; both are worked out on the body pose so the arms and neck follow wherever he leans
  const anchor = (a, t) => {
    if (Array.isArray(a)) return V(...a);
    const f = /^([a-z]+)_(\d+)$/.exec(a); // folder_3, spill_1: anchor kind and index
    return f && props.anchors[f[1]] ? props.anchors[f[1]](t, +f[2]) : props.anchors[a](t);
  };
  const now = {};
  const feetAt = makeFeet(steve, () => EDIT.end, clips);
  const perform = (t) => {
    const L = EDIT.steve;
    const feet = feetAt(L.moves, t);
    const B = bodyAt(L.moves, t, clips);
    steve.g.position.set(...B.at);
    steve.g.rotation.y = B.yaw * THREE.MathUtils.DEG2RAD;
    // asleep until his right hand twitches (1.1)
    const tw = t - L.twitch;
    const twitch = tw > 0 && tw < 0.35 ? Math.sin((tw / 0.35) * Math.PI) : 0;
    let pose = twitch ? addPose(B.pose, { laR: [-14 * twitch, 0, 0], uaR: [-4 * twitch, 0, 0] }) : B.pose;
    steve.setPose(pose);
    steve.g.updateMatrixWorld(true);
    const R = targetAt(L.hands, "R", t, anchor), Lh = targetAt(L.hands, "L", t, anchor), look = targetAt(L.look, "at", t, anchor);
    const patch = [];
    for (const sd of ["L", "R"]) if (feet[sd]) patch.push([steve.legTo(sd, feet[sd]), 1]);
    if (R) patch.push([steve.armTo("R", R.p), R.w]);
    if (Lh) patch.push([steve.armTo("L", Lh.p), Lh.w]);
    if (look) patch.push([{ head: steve.headTo(look.p) }, look.w]);
    for (const [p, w] of patch) pose = blendPose(pose, p, w);
    steve.setPose(pose);
    steve.g.updateMatrixWorld(true);
    Object.assign(now, { B, R, Lh, look, twitch, feet });
  };
  // his grips at another moment (where he took or let go of something: props.ts grips), worked out once per edit; every
  // caller passes the same fn, the cache is keyed on the time alone
  let handFor = null, missed = false;
  const handCache = new Map();
  const handAt = (tr, fn) => {
    if (handFor !== EDIT.steve) { handCache.clear(); handFor = EDIT.steve; }
    if (!handCache.has(tr)) { perform(tr); handCache.set(tr, fn(steve.hand, steve.handL, steve.bones.head)); missed = true; }
    return handCache.get(tr);
  };

  const free = { on: false, p: V(0, 0, 0), l: V(0, 0, 0), fov: 60 };
  const lookAt = V(0, 0, 0), head = V(0, 0, 0);
  const draw = (t) => {
    const shot = shotAt(t);
    const cam = cameraAt(t, keysOf(EDIT.cam));
    camera.position.copy(cam.p);
    lookAt.copy(cam.l);
    camera.fov = cam.fov;
    if (free.on) { camera.fov = free.fov; camera.position.copy(free.p); lookAt.copy(free.l); }
    camera.up.set(0, 1, 0);
    camera.lookAt(lookAt);
    camera.rotateZ(cam.roll);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    head.copy(camera.position);

    // Steve, then the props that ride on him (a held folder) or fly from where his hand let go
    perform(t);
    props.draw(t, steve.hand, handAt, steve.handL, steve.bones.head);
    if (missed) { missed = false; perform(t); props.draw(t, steve.hand, handAt, steve.handL, steve.bones.head); }
    // eyes shut until they snap open; the pupils open wide in the dark of sleep and narrow under the cold lamp
    const opening = smoother((t - EDIT.steve.eyesOpen) / 0.09);
    const P = EDIT.steve.pupil;
    const mood = moodAt(EDIT.steve.face, t);
    const pupil = THREE.MathUtils.lerp(P.dark, P.lit, smoother((t - EDIT.steve.eyesOpen - 0.1) / P.narrow)) * mood.pupil;
    const blink = Math.max(1 - opening, blinkAt(t, EDIT.steve.blinksFrom));
    const eyes = readLook(EDIT.steve.read, t) ?? [0, -0.15];
    // the one heavy breath out when he gives up: lips part for it
    const ex = t - EDIT.steve.exhale;
    steve.face({ ...mood, pupil }, mouthAt(ex > 0 && ex < 1.2 ? [[0, "B"], [1.0, "X"]] : [], Math.max(0, ex)), blink, eyes);
    Object.assign(now, { mood, blink, eyes });
    // his own view: no head, and no arms, which at the lens fill the bottom corners like wings
    const own = SHOTS_OUT[shot].pov && !free.on ? 1e-3 : 1;
    for (const k of ["head", "uaL", "uaR"]) steve.bones[k].scale.setScalar(own);
    // over-his-eyes shots (noHead): only the head goes, his hands stay in the picture holding what he reads
    if (SHOTS_OUT[shot].noHead && !free.on) steve.bones.head.scale.setScalar(1e-3);

    const cctv = shot === 0 && !free.on ? 1 : 0;
    const K = EDIT.cctv;
    lens.distortion.set(K.distortion * cctv, K.distortion * cctv);
    grain.blendMode.opacity.value = K.grain * cctv;
    tone.saturation = cctv ? K.saturation : EDIT.look.saturation;
    contrast.contrast = cctv ? K.contrast : 0;
    feed.fullscreenMaterial.time = t;
    cell.visible = !!cctv;
    props.dome.visible = !cctv; // shot 0 looks out of it
    for (const [k, y] of keyCaps) k.position.y = y;
    for (const s of props.keysDown(t)) {
      const pick = s.ch === " " ? capsOf.space : s.ch === "Enter" ? capsOf.enter : capsOf[s.hand];
      for (const look of pick) { const [k, y] = look[nth(s.n, look.length)]; k.position.y = y - 0.35 * s.depth; }
    }
    const kb = props.keyboardAt(t);
    keyboard.rotation.y = THREE.MathUtils.degToRad(kb.yaw);
    keyboard.position.set(keyboardHome[0] + kb.dx, keyboardHome[1] + kb.lift, keyboardHome[2] + kb.dz);
    const slotFill = SHOTS_OUT[shot].fill && !free.on;
    if (slotFill) fill.position.set(CABINET.x + 0.35, 0.4, CABINET.z + 0.5); // deep in the slot, behind the lens: his face at the mouth is lit evenly, no hot spot
    else fill.position.copy(camera.position).addScaledVector(camera.up, 0.25);
    fill.intensity = slotFill ? EDIT.light.closeFill : free.on ? 0 : (EDIT.light.face ?? 0);
    const Lt = EDIT.light, lv = flickerAt(Lt, t);
    props.dim(lv);
    fill.intensity *= THREE.MathUtils.smoothstep(lv, 0, 0.3); // a blackout is black: the lens's own fill goes out with the lamp
    hemi.intensity = Lt.fill;
    top.intensity = Lt.key * lv;
    bounce.intensity = Lt.bounce * lv;
    halo.intensity = (Lt.halo ?? 0) * lv;
    rim.intensity = Lt.rim * (0.35 + 0.65 * lv);
    for (const [m, e, c] of lampMats) { m.emissiveIntensity = e * (0.08 + 0.92 * lv); m.color.copy(c).multiplyScalar(0.25 + 0.75 * lv); }
    now.lamp = lv;

    renderer.clear();
    composer.render(0);
    renderer.clearDepth();
    renderer.render(hud, hudCam);
  };
  draw.describe = makeDescribe({ EDIT, SHOTS: SHOTS_OUT, shotAt, keysOf, camera, steveBox, steveBody, variants, steve, now, props });
  draw.variants = variants;
  draw.tools = {
    clips, scene, camera, free, head, look: lookAt, rig: steve.rig, bones: steve.bones, CELL: 0, smoother, zoomOf,
    objects: [[world.group, "phòng"], [steve.g, "Steve"], ...props.objects],
    materials: [], composer, renderer,
  };
  // What `CHECK=name:args` runs (node node_modules/live-studio/render.mjs stills); each returns lines to print
  const soles = (t) => { perform(t); return ["L", "R"].map((sd) => `${sd} ${steve.soleAt(sd).toArray().map((v) => v.toFixed(3)).join(" ")} -> ${now.feet[sd]?.toArray().map((v) => v.toFixed(3)).join(" ") ?? "pose"} ${now.feet.mode(sd)}`).join(" | "); };
  draw.checks = {
    // slide:from,to: every stretch where a sole flat on the stone (under 1.5 cm: a step lifts it higher) creeps over it by
    // more than 2 cm, every sole sunk into the floor, and every planted sole the leg cannot reach. Stills cannot show any of them
    slide: (from, to) => {
      const out = [], q = new THREE.Vector3(), touch = {}, sunk = {}, short = {};
      for (let t = from; t <= to; t += 1 / 60) {
        perform(t);
        for (const sd of ["L", "R"]) {
          steve.soleAt(sd, q);
          const k = touch[sd];
          if (q.y < 0.015) {
            if (!k) touch[sd] = { t, x: q.x, z: q.z, far: 0 };
            else k.far = Math.max(k.far, Math.hypot(q.x - k.x, q.z - k.z));
          } else if (k) { if (k.far > 0.02) out.push(`${k.t.toFixed(2)}-${t.toFixed(2)} ${sd} sole slides ${(k.far * 100).toFixed(0)} cm`); touch[sd] = null; }
          const aim = now.feet[sd], miss = aim ? q.distanceTo(aim) : 0;
          if (miss > 0.03 && !short[sd]) short[sd] = { t, miss }; else if (short[sd] && miss > 0.03) short[sd].miss = Math.max(short[sd].miss, miss);
          else if (short[sd] && miss <= 0.03) { out.push(`${short[sd].t.toFixed(2)}-${t.toFixed(2)} ${sd} leg cannot reach its planted sole by ${(short[sd].miss * 100).toFixed(0)} cm`); short[sd] = null; }
          if (q.y < -0.03 && !sunk[sd]) { sunk[sd] = t; } else if (q.y >= -0.03 && sunk[sd]) { out.push(`${sunk[sd].toFixed(2)}-${t.toFixed(2)} ${sd} sole under the floor`); sunk[sd] = 0; }
        }
      }
      for (const sd of ["L", "R"]) if (touch[sd]?.far > 0.02) out.push(`${touch[sd].t.toFixed(2)}-end ${sd} sole slides ${(touch[sd].far * 100).toFixed(0)} cm`);
      return out;
    },
    // trace:from,to,step: his soles (world x y z) and their planted targets, one line per sample
    trace: (from, to, step) => { const out = []; for (let t = from; t <= to + 1e-6; t += step) out.push(`${t.toFixed(3)} ${soles(t)}`); return out; },
  };
  return draw;
}
