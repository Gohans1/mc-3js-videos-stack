// @ts-nocheck
// "The Sealed Room" (OpenAI / Hugging Face incident, SCRIPT.md), part 1.1: Steve wakes in CELL 0412. Blocks are the game's
// own models (block-model-renderer), Steve is MCprep's rigged player (src/player.ts), the CCTV caption is MineRender GUI
// text. draw(t) draws any moment straight away, so the studio, stills and the renderer all seek. Every time and camera key
// lives in edit.json (film seconds). Mojang files come from assets/public/mc and /mcasset (links to E:, never committed).
import * as THREE from "three";
import { BloomEffect, BlendFunction, BrightnessContrastEffect, EffectComposer, EffectPass, HueSaturationEffect, LensDistortionEffect, NoiseEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { configure, createScene } from "block-model-renderer";
import { AssetLoader, GuiObject } from "minerender";
import { EDIT, fromSource } from "./edit";
import { buildWorld, BED, LAMP } from "./world";
import { pack } from "./pack";
import { cameraAt } from "./camera";
import { makeDescribe } from "./describe";
import { buildVariants } from "./variants";
import { GESTURES, MOODS, PX, addPose, loadRig, makePlayer, mouthAt } from "./player";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16; // block-model-renderer works in pixels, the film in blocks
// The studio reads each shot's name from the comment on its line; size and what are the review overlay's (src/describe.ts)
export const SHOTS = [
  { t: 0.0, size: "high-angle wide (WS)", what: "CCTV feed" }, // CCTV CELL 0412 from the ceiling corner
  { t: 3.5, size: "extreme close-up (ECU)", what: "his eyes" }, // close on his eyes as they open
  { t: 6.5, size: "POV", what: "through his eyes" }, // his eyes: bare wall, desk, door
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

  const jar = new Uint8Array(await (await fetch("mc/client.jar")).arrayBuffer());
  const world = await createScene([pack, jar], buildWorld(), { lighting: "scene", animate: false });
  world.group.scale.setScalar(S);
  world.group.position.set(0.5, 0.5, 0.5); // block-model-renderer centres blocks on whole numbers; a Minecraft block spans x..x+1
  world.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(world.group);
  const variants = await buildVariants([pack, jar], (g) => {
    g.scale.setScalar(S);
    g.position.copy(world.group.position);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
  }, (cam) => keysOf(cam), EDIT, W / H);
  const lamp = await createScene(jar, LAMP.map((pos) => ({ id: "sea_lantern", pos })), { lighting: "scene", animate: false });
  lamp.group.scale.setScalar(S);
  lamp.group.position.copy(world.group.position);
  scene.add(lamp.group);
  stage("room");

  const steve = await makePlayer(await loadRig("rig/player.glb"), "mc/assets/minecraft/textures/entity/player/wide/steve.png", { glow: 0.03 });
  scene.add(steve.g);
  const L = EDIT.steve;
  steve.g.position.set(...L.at); // lying on his back on the bed, head on the pillow (north), feet south
  steve.g.rotation.y = L.yaw * THREE.MathUtils.DEG2RAD;
  stage("steve");

  // One cold light from the sea-lantern strip over the bed; the corners fall off into shadow, as the script asks
  const C = EDIT.light;
  const hemi = new THREE.HemisphereLight(0xbcd0c8, 0x202020, C.fill);
  scene.add(hemi);
  const top = new THREE.SpotLight(0xdff4f0, C.key, 22, THREE.MathUtils.degToRad(68), 0.75, 1.3);
  top.position.set(BED.x + 0.5, 5.9, BED.head + 1);
  top.target.position.set(BED.x + 0.5, 0, BED.head + 2.2);
  top.castShadow = true;
  top.shadow.mapSize.set(2048, 2048);
  top.shadow.bias = -0.0008;
  top.shadow.radius = 3;
  scene.add(top, top.target);
  const bounce = new THREE.PointLight(0x9fb8b0, C.bounce, 14, 1.5); // light off the floor back onto the walls
  bounce.position.set(BED.x + 0.5, 1.2, BED.head + 3);
  scene.add(bounce);
  const rim = new THREE.PointLight(0xcfeee2, C.rim, 7, 1.6); // a faint rim from the far side, so Steve isn't flat against the dark
  rim.position.set(BED.x - 1.5, 2.2, BED.head + 4);
  scene.add(rim);
  scene.fog = new THREE.FogExp2(0x0d1211, C.fog);

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

    // Steve: asleep until his right hand twitches, eyes shut until they snap open; in his own view his head is not drawn
    const tw = t - EDIT.steve.twitch;
    const twitch = tw > 0 && tw < 0.35 ? Math.sin((tw / 0.35) * Math.PI) : 0;
    const pose = addPose(GESTURES.sleep(), { laR: [-14 * twitch, 0, 0], uaR: [-4 * twitch, 0, 0] });
    steve.setPose(pose);
    const opening = smoother((t - EDIT.steve.eyesOpen) / 0.09);
    // the pupils open wide in the dark of sleep and narrow under the cold lamp
    const P = EDIT.steve.pupil;
    const pupil = THREE.MathUtils.lerp(P.dark, P.lit, smoother((t - EDIT.steve.eyesOpen - 0.1) / P.narrow));
    steve.face({ ...MOODS.neutral, pupil }, mouthAt([], 0), 1 - opening, [0, -0.15]);
    // his own view: no head, and no arms, which at the lens fill the bottom corners like wings
    const own = shot === 2 && !free.on ? 1e-3 : 1;
    for (const k of ["head", "uaL", "uaR"]) steve.bones[k].scale.setScalar(own);

    const cctv = shot === 0 && !free.on ? 1 : 0;
    const K = EDIT.cctv;
    lens.distortion.set(K.distortion * cctv, K.distortion * cctv);
    grain.blendMode.opacity.value = K.grain * cctv;
    tone.saturation = cctv ? K.saturation : EDIT.look.saturation;
    contrast.contrast = cctv ? K.contrast : 0;
    feed.fullscreenMaterial.time = t;
    cell.visible = !!cctv;

    renderer.clear();
    composer.render(0);
    renderer.clearDepth();
    renderer.render(hud, hudCam);
  };
  draw.describe = makeDescribe({ EDIT, SHOTS: SHOTS_OUT, shotAt, keysOf, camera, steveBox, steveBody, variants });
  draw.variants = variants;
  draw.tools = {
    scene, camera, free, head, look: lookAt, rig: steve.rig, bones: steve.bones, CELL: 0, smoother, zoomOf,
    objects: [[world.group, "phòng"], [steve.g, "Steve"]],
    materials: [], composer, renderer,
  };
  return draw;
}
