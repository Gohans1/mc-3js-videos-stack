// @ts-nocheck
// "The Sealed Room" (OpenAI / Hugging Face incident, SCRIPT.md), parts 1.1 and 1.2: Steve wakes in CELL 0412, tries the
// door, stalls at the screen and tears through the filing drawer. Blocks are the game's
// own models (block-model-renderer), Steve is MCprep's rigged player (mc-actor/player.ts), the CCTV caption is MineRender GUI
// text. draw(t) draws any moment straight away, so the studio, stills and the renderer all seek. Every time and camera key
// lives in EDIT (src/edit.ts: src/edit.json and src/timeline/*.json, film seconds). Mojang files come from assets/public/mc and /mcasset (links to E:, never committed).
import * as THREE from "three";
import { unzipSync } from "fflate";
import { BloomEffect, BlendFunction, BrightnessContrastEffect, EffectComposer, EffectPass, HueSaturationEffect, LensDistortionEffect, NoiseEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { configure, createScene } from "block-model-renderer";
import { AssetLoader, GuiObject } from "minerender";
import { EDIT, fromSource } from "./edit";
import { buildWorld, BED, CABINET, CHAIR, LAMP, ROOM } from "./world";
import { CHAIRS, buildProps } from "./props";
import { bodyAt, blinkAt, moodAt, readLook, targetAt } from "./steve";
import { makeFeet } from "mc-actor/feet";
import { footChecks } from "mc-actor/checks";
import { loadClips } from "mc-actor/clips";
import { props as pack } from "mc-assets/pack";
import { makePlaced, poseAt } from "mc-assets/placed";
import { cameraAt, EASES, onScreenRanges } from "film-stage/camera";
import { flickerAt } from "film-stage/flicker";
import { animate, ANIMS } from "film-stage/animate";
import { blackAt, makeFade } from "film-stage/fade";
import { makeTitles } from "film-stage/titles";
import { makeTransitions, viewTime } from "film-stage/transitions";
import { makeAdjustments, makeLayerAdjustments } from "film-stage/grade";
import { activeAdjustments } from "film-stage/grade-layers";
import { makeDescribe } from "./describe";
import { asVariant, buildVariants } from "mc-assets/variants";
import { VARIANTS } from "./variants";
import { FACES, GESTURES, PX, addPose, blendPose, loadRig, makePlayer, mouthAt } from "mc-actor/player";
import { slerpPose } from "mc-actor/mocap";
import { overlap } from "film-kit/overlap";
import { mask, scalePose } from "film-kit/pose";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16; // block-model-renderer works in pixels, the film in blocks

// The shots live in src/timeline/shots.json (name: what the studio's timeline shows; size and what: the review overlay's,
// src/describe.ts; pov, noHead, fill: how draw frames that shot), read here from EDIT.shots so the studio can move a cut live
export const SHOTS = [];
export let DURATION = 0;
export const SHOTS_OUT = [];
export const applyEdit = () => {
  SHOTS.splice(0, SHOTS.length, ...EDIT.shots);
  SHOTS_OUT.length = SHOTS.length;
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

  // client.jar without its Java code (scripts/mc/slim_jar.py): a quarter of the download on every first visit, the same picture
  const jarFile = await fetch("mc/client_assets.zip");
  if (!jarFile.ok) throw new Error("mc/client_assets.zip is missing: run python ../../scripts/mc/slim_jar.py");
  const jar = new Uint8Array(await jarFile.arrayBuffer());
  // blocks picked from the vault's vetted mod packs (pack/picks.json, mc-assets/pick.py), stacked between the props and the game
  const picked = new Uint8Array(await (await fetch("picked.zip")).arrayBuffer());
  const sources = [pack, picked, jar];
  const world = await createScene(sources, buildWorld(), { lighting: "scene", animate: false });
  world.group.scale.setScalar(S);
  world.group.position.set(0.5, 0.5, 0.5); // block-model-renderer centres blocks on whole numbers; a Minecraft block spans x..x+1
  world.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(world.group);
  const bedModel = await createScene(sources, ["head", "foot"].map((part, z) => ({ id: "black_bed", pos: [0, 0, z], properties: { facing: "north", part, occupied: "false" } })), { lighting: "scene", animate: false });
  bedModel.group.scale.setScalar(S);
  bedModel.group.position.set(0, .5, -.5);
  bedModel.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  const bed = new THREE.Group();
  bed.add(bedModel.group);
  scene.add(bed);
  // film seconds a box is on screen, worked out again whenever the camera keys change (the studio's variant chips)
  const rangesOf = (box) => {
    let at = null, r = null;
    return () => { const k = keysOf(EDIT.cam); if (at !== k) { r = onScreenRanges(box, k, EDIT.end, W / H); at = k; } return r; };
  };
  const variants = await buildVariants(VARIANTS, sources, (g) => {
    g.scale.setScalar(S);
    g.position.copy(world.group.position);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
  }, rangesOf);
  const props = await buildProps(sources, scene, EDIT);
  const placed = await makePlaced(scene, sources, EDIT, "placed");
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
  const chairs = asVariant({ id: "chair", title: "chair", options: CHAIRS, off: true }, props.chairLooks, props.chairBox, rangesOf(props.chairBox));
  variants.push({
    id: chairs.id, title: chairs.title, options: chairs.options, box: chairs.box, off: chairs.off,
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

  // Steve's skin comes out of the same zip, so mc/ needs nothing but client_assets.zip (the vault's jar/)
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
  const adjust = makeAdjustments(composer, camera), layerAdjust = makeLayerAdjustments(renderer);
  await Promise.all([adjust.prepare(SHOTS_OUT.map((s) => s.adjust)), layerAdjust.prepare((EDIT.adjustments?.items ?? []).map((it) => it.grade))]);

  // The 2D layer: the camera's cell number in the top left, in the game's own font
  const gs = Math.max(2, Math.floor(H / 360));
  const hud = new THREE.Scene();
  const hudCam = new THREE.OrthographicCamera(0, W / gs, 0, -H / gs, -100, 100); // GUI y grows down
  const cell = new GuiObject([{ text: [{ text: EDIT.cctv.label, color: 0xffffff }], position: [10, 8], shadow: false }]);
  await cell.init();
  cell.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = EDIT.cctv.labelOpacity; o.material.depthTest = false; } });
  hud.add(cell);
  renderer.autoClear = false;
  const fade = makeFade(renderer);
  const titles = makeTitles(renderer, W, H); // the titles, arrows and circles of src/timeline/text.json, over everything
  await titles.ready;
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
  // his face (mc-actor FACES), a chip in the studio: eyes shut or gone, no expression, by the
  // dev's call (the narrator carries what he feels); the first is the film's own until a pick lands in choices.json
  variants.push(asVariant({ id: "face", title: "Steve's face", options: FACES.map(({ id, title }) => ({ id, title })) },
    FACES.map((f) => ({ set visible(on) { if (on) steve.setFace(f.id); } })), steveBox, () => [[0, EDIT.end]]));
  steveBody.min.z = steve.bones.head.getWorldPosition(V(0, 0, 0)).z + 0.05;
  const res = (v) => (Array.isArray(v) ? v : [eye.x + v.eye[0], eye.y + v.eye[1], eye.z + v.eye[2]]);
  const resolved = new WeakMap();
  const keysOf = (cam) => { if (!resolved.has(cam)) resolved.set(cam, cam.map((k) => ({ ...k, p: res(k.p), l: res(k.l) }))); return resolved.get(cam); };

  // Steve at time t (mc-actor/perform.ts, poses in src/steve.ts): body from the move keys, then each hand reaches its target and the head turns to its
  // look point; both are worked out on the body pose so the arms and neck follow wherever he leans
  const anchor = (a, t) => {
    if (Array.isArray(a)) return V(...a);
    const f = /^([a-z]+)_(\d+)$/.exec(a); // folder_3, spill_1: anchor kind and index
    return f && props.anchors[f[1]] ? props.anchors[f[1]](t, +f[2]) : props.anchors[a](t);
  };
  const now = {};
  const feetAt = makeFeet(steve, () => EDIT.end, bodyAt, clips);
  // film-kit overlap: chest, head and arms trail the body's own moves and settle past a stop (follow-through). Baked over
  // the whole film once per edit; faded out over mocap clips, which already carry their own (film-kit AGENTS.md)
  let lagFor = null, lagOf = null, offClips = null;
  const lagAt = (t) => {
    if (lagFor !== EDIT.steve) {
      const m = EDIT.steve.moves;
      lagOf = overlap((s) => bodyAt(m, s, clips).pose, EDIT.end);
      offClips = mask(m.flatMap((k, i) => (k.clip ? [[k.t, m[i + 1]?.t ?? EDIT.end]] : [])));
      lagFor = EDIT.steve;
    }
    return scalePose(lagOf(t), offClips(t));
  };
  const perform = (t) => {
    const L = EDIT.steve;
    const feet = feetAt(L.moves, t);
    const B = bodyAt(L.moves, t, clips);
    steve.g.position.set(...B.at);
    steve.g.rotation.y = B.yaw * THREE.MathUtils.DEG2RAD;
    // asleep until his right hand twitches (1.1)
    const tw = t - L.twitch;
    const twitch = tw > 0 && tw < 0.35 ? Math.sin((tw / 0.35) * Math.PI) : 0;
    let pose = addPose(B.pose, lagAt(t));
    if (twitch) pose = addPose(pose, { laR: [-14 * twitch, 0, 0], uaR: [-4 * twitch, 0, 0] });
    steve.setPose(pose);
    steve.g.updateMatrixWorld(true);
    const shoulder = (sd) => ({ pivot: steve.bones[`ua${sd}`].getWorldPosition(new THREE.Vector3()) });
    const R = targetAt(L.hands, "R", t, anchor, shoulder("R")), Lh = targetAt(L.hands, "L", t, anchor, shoulder("L"));
    const look = targetAt(L.look, "at", t, anchor);
    const patch = [];
    for (const sd of ["L", "R"]) if (feet[sd]) patch.push([steve.legTo(sd, feet[sd]), 1]);
    if (look) patch.push([{ head: steve.headTo(look.p) }, look.w]);
    // hand IK the film-kit way (AGENTS.md there): the elbow on a pole, down and out, and blended into the pose's own arm by
    // quaternion slerp; twist-free with an Euler blend, a hand reaching low in front raised the elbow over his shoulder
    const arms = [[R, "R", [-0.6, -1, -0.2]], [Lh, "L", [0.6, -1, -0.2]]].filter(([h]) => h).map(([h, sd, pole]) => [steve.armTo(sd, h.p, pole), h.w]);
    for (const [p, w] of patch) pose = blendPose(pose, p, w);
    for (const [p, w] of arms) pose = slerpPose(pose, { ...pose, ...p, root: pose.root }, w);
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
  const frame = (t, view) => {
    bed.visible = !!EDIT.props.bed?.length;
    if (bed.visible) {
      const bedPose = poseAt(EDIT.props.bed, t);
      bed.position.copy(bedPose.at); bed.quaternion.copy(bedPose.q); bed.scale.setScalar(bedPose.scale); bed.visible = bedPose.visible;
    }
    const shot = view ?? shotAt(t), cameraTime = view === undefined ? t : viewTime(SHOTS_OUT, DURATION, view, t);
    const cam = cameraAt(cameraTime, keysOf(EDIT.cam));
    const animBlack = animate(cam, cameraTime, SHOTS_OUT, DURATION);
    camera.position.copy(cam.p);
    lookAt.copy(cam.l);
    camera.fov = cam.fov;
    if (free.on) { camera.fov = free.fov; camera.position.copy(free.p); lookAt.copy(free.l); }
    camera.up.set(0, 1, 0);
    camera.lookAt(lookAt);
    if (!free.on) camera.rotateZ(cam.roll);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    head.copy(camera.position);

    // Steve, then the props that ride on him (a held folder) or fly from where his hand let go
    perform(t);
    props.draw(t, steve.hand, handAt, steve.handL, steve.bones.head);
    if (missed) { missed = false; perform(t); props.draw(t, steve.hand, handAt, steve.handL, steve.bones.head); }
    placed.draw(t);
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
    // The fill rides the film camera even while the free camera flies (film-contract: the free camera only moves the viewpoint)
    const slotFill = SHOTS_OUT[shot].fill;
    if (slotFill) fill.position.set(CABINET.x + 0.35, 0.4, CABINET.z + 0.5); // deep in the slot, behind the lens: his face at the mouth is lit evenly, no hot spot
    else { fill.position.copy(cam.p); fill.position.y += 0.25; }
    fill.intensity = slotFill ? EDIT.light.closeFill : (EDIT.light.face ?? 0);
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
    adjust(shot, SHOTS_OUT[shot]?.adjust, t, free.on);
    composer.render(0);
    renderer.clearDepth();
    renderer.render(hud, hudCam);
    if (!free.on) fade(Math.max(blackAt(EDIT.fx.black, t), animBlack));
    if (!free.on) titles(EDIT.text.items, t, camera, EDIT.text.tracks);
  };
  const draw = makeTransitions(renderer, frame, () => SHOTS_OUT, () => DURATION, free, (t) => layerAdjust(activeAdjustments(EDIT.adjustments, t), t, free.on));
  draw.eases = EASES; // the studio's camera row draws the keys' eases with these
  draw.keyEases = [{ edit: "steve", path: ["moves"], names: Object.keys(EASES) }];
  draw.anims = ANIMS; // the studio's Animation tab lists these
  draw.adjustments = { prepare: (grades) => Promise.all([adjust.prepare(grades), layerAdjust.prepare(grades)]) };
  draw.describe = makeDescribe({ EDIT, SHOTS: SHOTS_OUT, shotAt, keysOf, camera, steveBox, steveBody, variants, steve, now, props });
  draw.variants = variants;
  draw.tools = {
    titles, clips, scene, camera, free, head, look: lookAt, rig: steve.rig, bones: steve.bones, CELL: 0, smoother, zoomOf, anchor,
    objects: [[world.group, "phòng"], [bed, "Bed"], [steve.g, "Steve"], ...props.objects],
    targets: [
      { id: "bed", title: "Bed", objects: [bed], rows: [{ edit: "props", path: ["bed"] }], transform: {
        row: { edit: "props", path: ["bed"] }, axes: { translate: [true, true, true], rotate: [true, true, true], scale: [true, true, true] },
        read: (key) => ({ at: key.at, rot: key.rot ?? [0, 0, 0], scale: key.scale ?? 1 }),
        write: (key, value) => Object.assign(key, { at: value.at, rot: value.rot, scale: value.scale }),
      } },
      { id: "steve", title: "Steve", objects: [steve.g], rows: [{ edit: "steve", path: [] }], transform: {
        row: { edit: "steve", path: ["moves"] }, axes: { translate: [true, true, true], rotate: [false, true, false] },
        read: (key) => ({ at: key.at, rot: [0, key.yaw, 0], scale: 1 }),
        write: (key, value) => { key.at = value.at; key.yaw = value.rot[1]; },
      } },
      { id: "chair", title: "Chair", objects: [props.chair], rows: [{ edit: "props", path: ["chair"] }], transform: {
        row: { edit: "props", path: ["chair"] }, axes: { translate: [true, false, false] },
        read: (key) => ({ at: [CHAIR.x + key.dx, props.chair.position.y, props.chair.position.z], rot: [0, 0, 0], scale: 1 }),
        write: (key, value) => { key.dx = value.at[0] - CHAIR.x; },
      } },
      { id: "drawer", title: "Drawer", objects: [props.tray], rows: [{ edit: "props", path: ["drawer"] }] },
      { id: "keyboard", title: "Keyboard", objects: [keyboard], rows: [{ edit: "props", path: ["keyboard"] }] },
      { id: "screen", title: "Screen", objects: [props.glass], rows: [{ edit: "props", path: ["screen", "typing"] }] },
      { id: "silverfish", title: "Silverfish", objects: [props.silverfish], rows: [{ edit: "props", path: ["silverfish"] }] },
      ...props.sheets.map((object, i) => ({ id: `paper:${i}`, title: "Paper", objects: [object], rows: [{ edit: "props", path: ["takes"] }] })),
    ],
    materials: [], composer, renderer, placed,
  };
  // What `CHECK=name:args` runs (node node_modules/live-studio/render.mjs stills): slide and trace for his feet
  draw.checks = footChecks({ perform, steve, now });
  return draw;
}
