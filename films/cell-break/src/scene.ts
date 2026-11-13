// @ts-nocheck
// A prison-break film: Steve in a stone cell (src/world.ts), eyes painted over and no expression, so the narrator carries
// what he feels. Started from templates/film, apart from films/sealed-room. Blocks are the game's own
// models (block-model-renderer) plus the shared props (mc-assets/pack) and this film's picks (pack/picks.json); Steve is
// MCprep's rig (mc-actor/player.ts) acting from src/timeline/steve.json (mc-actor/perform.ts, feet.ts); the camera follows
// src/timeline/cam.json (film-stage/camera.ts). draw(t) draws any moment straight away (the studio's film contract:
// bun run skills get core --ref contract). Mojang files come through assets/public links into the vault (bun run link).
import * as THREE from "three";
import { unzipSync } from "fflate";
import { BloomEffect, EffectComposer, EffectPass, HueSaturationEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { configure, createScene } from "block-model-renderer";
import { EDIT, fromSource } from "./edit";
import { buildLights, buildLoose, buildWorld, CCTV, CCTV_AIM, DESK, RAIL_Y, ROOM_LIGHTS, TORCHES, TUNNEL } from "./world";
import { VARIANTS } from "./variants";
import { POSES, bodyAt, targetAt } from "./steve";
import { buildCellBlock, cellOrigin, CROWD, NEIGHBOUR } from "./cellblock";
import { buildStory } from "./story";
import { makeFeet } from "mc-actor/feet";
import { footChecks } from "mc-actor/checks";
import { loadClips } from "mc-actor/clips";
import { blendPose, loadRig, makePlayer } from "mc-actor/player";
import { slerpPose } from "mc-actor/mocap";
import { props as pack } from "mc-assets/pack";
import { asVariant, buildVariants } from "mc-assets/variants";
import { buildScreen } from "mc-assets/screen";
import { loadFont } from "mc-assets/gamefont";
import { cameraAt, onScreenRanges, shakeAt } from "film-stage/camera";
import { makeTransitions, viewTime } from "film-stage/transitions";
import { flickerAt } from "film-stage/flicker";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16; // block-model-renderer works in pixels, the film in blocks

// Shots are the camera's cuts (timeline/cam.json: the first key and every key with cut: true), each named by its key's
// `what` and `size` for the review list (draw.describe). A shot is a still unless its key says live: true: Steve is held
// as he is at the cut (the dev's rule for this film: a photo of him mid-action); lights, dust and screens keep moving
export let DURATION = 0;
export const SHOTS = [];
export const SHOTS_OUT = [];
export const applyEdit = () => {
  const cuts = EDIT.cam.filter((k, i) => i === 0 || k.cut);
  SHOTS.length = SHOTS_OUT.length = 0;
  cuts.forEach((k) => { SHOTS.push({ t: k.t, size: k.size ?? "", what: k.what ?? "", live: !!k.live }); SHOTS_OUT.push({ ...SHOTS.at(-1), t: fromSource(k.t) }); });
  DURATION = fromSource(EDIT.end);
};
applyEdit();
const shotAt = (t) => Math.max(0, SHOTS_OUT.filter((s) => t >= s.t).length - 1);
// the film second Steve is shown at: the cut's own second in a still shot (a hair after it, so a key on the cut has landed)
const stillAt = (t) => { const s = SHOTS[shotAt(t)]; return !s || s.live ? t : Math.min(t, s.t + 0.02); };

export async function buildScene(canvas, W, H, draft = false) {
  configure({ THREE, assetsUrl: "vendor/bmr_assets.zip" });
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.02, 700);
  scene.add(camera);

  // client.jar without its Java code (scripts/mc/slim_jar.mjs), then the props and the picks stacked above it
  const jarFile = await fetch("mc/client_assets.zip");
  if (!jarFile.ok) throw new Error("mc/client_assets.zip is missing: bun run link at the repo root (bun ../../scripts/mc/slim_jar.mjs if the vault lacks it)");
  const jar = new Uint8Array(await jarFile.arrayBuffer());
  const picked = new Uint8Array(await (await fetch("picked.zip")).arrayBuffer());
  const sources = [pack, picked, jar];
  const world = await createScene(sources, buildWorld(), { lighting: "scene", animate: false });
  world.group.scale.setScalar(S);
  world.group.position.set(0.5, 0.5, 0.5); // block-model-renderer centres blocks on whole numbers; a Minecraft block spans x..x+1
  world.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(world.group);
  // the iron door, the mailbox shelf, the trap block over the TNT and the floor around it, the ceiling: apart so the story can take them away (world.ts LOOSE)
  const loose = {};
  for (const k of ["door", "shelf", "trap", "crater", "ceiling", "tunnel"]) {
    const g = (await createScene(sources, buildLoose(k), { lighting: "scene", animate: false })).group;
    g.scale.setScalar(S); g.position.set(0.5, 0.5, 0.5);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    loose[k] = g;
  }
  // the hole behind the opened shelf: a warm glow on the cart so the reveal reads (lit only while the shelf is away)
  const holeLight = new THREE.PointLight(0xffb070, 0, 4, 2);
  holeLight.position.set(0.5, 0.6, -2.0);
  // after the lever the lamps are dead: a cold moonlit fill from the door's bars so the empty cell still reads
  const moon = new THREE.PointLight(0x8fb0ff, 0, 9, 1.2);
  moon.position.set(4.5, 2.2, 5.2);
  scene.add(moon);
  scene.add(holeLight);
  const lights = await createScene(jar, buildLights(), { lighting: "scene", animate: false });
  lights.group.scale.setScalar(S);
  lights.group.position.copy(world.group.position);
  scene.add(lights.group);

  // Steve's skin comes out of the same zip
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skinUrl = URL.createObjectURL(new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }));
  const steve = await makePlayer(await loadRig("rig/player.glb"), skinUrl, { glow: 0.03 });
  URL.revokeObjectURL(skinUrl);
  steve.setFace("noeyes"); // mc-actor FACES: the skin painted over his eyes, the floating face hidden for good
  scene.add(steve.g);
  // the other players the story needs (story.ts): every one is Steve, eyeless like him, told apart by one thing (dev rule:
  // all of them are the same): his ghost is see-through cold blue, the others wear another shirt colour
  const rigFile = "rig/player.glb";
  const makeActor = async (skin, { ghost = false, shirt = null } = {}) => {
    const path = `assets/minecraft/textures/entity/player/wide/${skin}.png`;
    let url = URL.createObjectURL(new Blob([unzipSync(jar, { filter: (f) => f.name === path })[path]], { type: "image/png" }));
    if (shirt) url = await reshirt(url, shirt);
    const a = await makePlayer(await loadRig(rigFile), url, { glow: ghost ? 0.6 : 0.03 });
    URL.revokeObjectURL(url);
    a.setFace("noeyes");
    if (ghost) a.g.traverse((o) => { if (o.isMesh) o.material = [o.material].flat().map((m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.42; c.depthWrite = false; c.color?.setHex(0x9feaff); if (c.emissive) c.emissive.setHex(0x1a6f9a); return c; }).at(0); });
    scene.add(a.g);
    const pose0 = (name, look) => {
      let pose = POSES[name](0);
      a.setPose(pose); a.g.updateMatrixWorld(true);
      if (look) { pose = blendPose(pose, { head: a.headTo(look) }, 1); a.setPose(pose); }
    };
    let cur = null;
    const set = (pose) => { cur = pose; a.setPose(pose); a.g.updateMatrixWorld(true); };
    return {
      g: a.g, hand: a.hand,
      place: (at, yaw, pose, look) => { a.g.position.copy(at); a.g.rotation.y = yaw * THREE.MathUtils.DEG2RAD; pose0(pose, look); a.g.updateMatrixWorld(true); },
      // a mocap frame (a loaded clip's at(s)), its hips' ground offset turned by yaw from `at`
      play: (at, yaw, pose) => { a.g.position.copy(at); a.g.rotation.y = yaw * THREE.MathUtils.DEG2RAD; set(pose); },
      // one hand onto a world point over the pose play() set, the elbow on a pole down and out
      grip: (sd, target) => set(slerpPose(cur, { ...cur, ...a.armTo(sd, target, [sd === "R" ? -0.6 : 0.6, -1, -0.2]), root: cur.root }, 1)),
      reach: (at, yaw, target) => {
        a.g.position.copy(at); a.g.rotation.y = yaw * THREE.MathUtils.DEG2RAD;
        let pose = POSES.still(0); a.setPose(pose); a.g.updateMatrixWorld(true);
        pose = slerpPose(pose, { ...pose, ...a.armTo("R", target, [-0.6, -1, -0.2]), root: pose.root }, 1);
        a.setPose(pose); a.g.updateMatrixWorld(true);
      },
    };
  };
  // mocap clips the moves name, baked once here: draw(t) only reads them
  const clips = await loadClips([...EDIT.steve.moves.filter((m) => m.clip).map((m) => m.clip), ...(EDIT.props.story?.swing ?? []).map((e) => e.clip)], steve);

  // Props seated like the room: block-model-renderer works in pixels and centres a block on whole numbers
  const place = (g) => {
    g.scale.setScalar(S);
    g.position.copy(world.group.position);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    return g;
  };
  // film seconds a box is on screen (the studio's chips), worked out again whenever the camera keys change
  const rangesOf = (box) => {
    let at = null, r = null;
    return () => { if (at !== EDIT.cam) { r = onScreenRanges(box, EDIT.cam, EDIT.end, W / H); at = EDIT.cam; } return r; };
  };
  const variants = await buildVariants(VARIANTS, sources, place, rangesOf);
  const crt = variants.find((v) => v.id === "computer");

  // The room's light, a studio chip (world.ts ROOM_LIGHTS): the ochre tube in the ceiling, flickering (film-stage/flicker,
  // edit.json light.flicker), or one wall torch. Each look is its glowing blocks and a shadow-casting point light under them;
  // a faint fill keeps the far corners just readable, so the shelf corner sinks into the dark (edit.json light)
  const C = EDIT.light;
  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x3a3026, C.fill);
  scene.add(hemi);
  const roomLooks = await Promise.all(ROOM_LIGHTS.map(async (L) => {
    const g = place((await createScene(jar, L.blocks, { lighting: "scene", animate: false })).group);
    const lamp = new THREE.PointLight(L.id === "tube" ? 0xffc673 : 0xffa552, 0, 12, 2);
    lamp.position.set(...L.light);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.002;
    lamp.shadow.radius = 3;
    lamp.shadow.camera.near = 0.15; // a torch's own stick sits right under its flame
    scene.add(lamp);
    const mats = [];
    g.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) mats.push([m, m.emissiveIntensity ?? 1, m.color.clone()]); });
    return { id: L.id, g, lamp, mats, set visible(on) { g.visible = lamp.visible = on; } };
  }));
  // the mailbox corner gets only a dim cold bounce: dark, but the pulled-out books still read (edit.json light.shelf)
  const shelfFill = new THREE.PointLight(0x9fb4c8, C.shelf, 2.6, 2);
  shelfFill.position.set(1.3, 1.4, 1.1);
  scene.add(shelfFill);
  const roomLight = asVariant({ id: "room_light", title: "room light", options: ROOM_LIGHTS.map(({ id, title }) => ({ id, title })) },
    roomLooks, new THREE.Box3(V(0, 0, 0), V(6, 3, 6)), () => [[0, EDIT.end]]);
  variants.push(roomLight);

  // the CRT's picture and its cold light on him and the desk (mc-assets/screen.ts, timeline/props.json screen)
  const font = await loadFont();
  const screen = buildScreen(font, { at: [DESK.crt, 1, DESK.z], facing: "south", keys: () => EDIT.props.screen, power: () => C.screen });
  scene.add(screen.glass, screen.glow);

  // the CCTV camera hanging from the ceiling's south-west corner (mc-assets cctv_mount + cctv_camera), aimed at the desk
  // (CCTV_AIM); its red light beside the lens blinks slowly (edit.json light.led): a hot little mesh the bloom catches
  // and a faint red light on the stone
  const propBlock = async (id) => {
    const g = (await createScene(sources, [{ id, pos: [0, 0, 0] }], { lighting: "scene", animate: false })).group;
    g.scale.setScalar(S);
    return g;
  };
  const cctv = new THREE.Group();
  const mount = await propBlock("gohans:cctv_mount");
  mount.position.set(CCTV[0], CCTV[1] + 0.5, CCTV[2]);
  // the camera turns on the mount's ball (model 8, 8.75, 8); its own joint is at model (8, 11.5, 10), its lens to -z
  const aim = new THREE.Group();
  aim.position.set(CCTV[0], CCTV[1] + 8.75 * S, CCTV[2]);
  aim.lookAt(...CCTV_AIM); // +z to the desk
  const body = new THREE.Group();
  body.rotation.y = Math.PI; // the lens (-z) to the aim's +z
  const camBlock = await propBlock("gohans:cctv_camera");
  camBlock.position.set(0, (8 - 11.5) * S, (8 - 10) * S);
  body.add(camBlock);
  aim.add(body);
  cctv.add(mount, aim);
  // beside the lens, on the bezel's top right as the camera sees it (model x 9.4, y 9.6, z 3.5 from the block's corner)
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.7 * S, 0.6 * S, 0.5 * S), new THREE.MeshBasicMaterial({ color: 0xff1a10, toneMapped: false }));
  led.position.set((9.4 - 8) * S, (9.6 - 8) * S, (3.4 - 8) * S).add(camBlock.position);
  const ledGlow = new THREE.PointLight(0xff2010, 0, 1.6, 2);
  ledGlow.position.copy(led.position).z -= 0.06;
  body.add(led, ledGlow);
  scene.add(cctv);
  // the ceiling tube never reaches this corner: a faint cold fill so the camera reads as an object, not only a red dot
  const cctvFill = new THREE.PointLight(0xc8d4ff, 0, 1.8, 2);
  cctvFill.position.set(CCTV[0] + 0.9, CCTV[1] + 0.3, CCTV[2] - 0.8);
  scene.add(cctvFill);
  // 0..1: on for light.led.on seconds of every light.led.period, eased in and out
  const ledAt = (t) => { const L = C.led, k = t % L.period; return Math.min(THREE.MathUtils.smoothstep(k, 0, 0.12), 1 - THREE.MathUtils.smoothstep(k, L.on, L.on + 0.25)); };
  // the tunnel has no daylight: each redstone torch and the fire curtain light it (no shadows: the rock walls hold the room's out)
  const glow = [...TORCHES.map((z) => [0xff2a10, [TUNNEL.x + 0.25, RAIL_Y(z) + 1.6, z + 0.5], C.torch]),
    [0xff8a2a, [TUNNEL.x + 0.5, RAIL_Y(TUNNEL.fire) + 1.4, TUNNEL.fire + 0.5], C.fire]];
  const lamps = glow.map(([c, p, i]) => { const l = new THREE.PointLight(c, i, 6, 2); l.position.set(...p); scene.add(l); return l; });

  // everything the story adds (story.ts), then the cell block round the cell (cellblock.ts), every cell a copy of this one
  const story = await buildStory({ scene, camera, sources, jar, font, makeActor, clips, loose });
  const chairObj = story.objects.find(([, label]) => label.startsWith("chair"))[0];
  const block = await buildCellBlock({ sources, scene, props: [screen.glass, chairObj, cctv], actor: await makeActor("steve"), clips: await loadClips(CROWD.map((c) => c.ref), steve), crtId: crt.pick.id });
  const ledWorld = led.getWorldPosition(V(0, 0, 0));
  // over the cell block: one soft light from above on every cell alike, his own too (its lamp alone leaves his walls black)
  const above = new THREE.DirectionalLight(0xffe2bc, 0);
  above.position.set(-20, 60, 30);
  scene.add(above);
  // layer 1: what is drawn while his own cell is one of the block's (block.draw self): the block and the light on it
  for (const o of [block.group, above, hemi]) o.traverse((x) => x.layers.enable(1));
  globalThis.__EDIT = EDIT;
  // cell 0411 lit as his is (dev note: every cell alike): a copy of each of his cell's lights, moved over, on while the
  // camera is in there; draw copies their intensity and colour every frame
  const next = cellOrigin(...NEIGHBOUR);
  const twins = [...roomLooks.map((l) => l.lamp), shelfFill, cctvFill, screen.glow, ledGlow].map((src) => {
    const d = src.clone();
    d.position.copy(src.getWorldPosition(V(0, 0, 0)).add(next));
    scene.add(d);
    return [src, d];
  });

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 }); // N8AO followed by a pass goes black without multisampling
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, W, H);
  Object.assign(ao.configuration, { aoRadius: 1.0, distanceFalloff: 1.0, intensity: 2.0, halfRes: draft });
  ao.outputTargetInternal.texture.type = THREE.HalfFloatType; // 8-bit would band dark stone
  composer.addPass(ao);
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  const tone = new HueSaturationEffect({ saturation: EDIT.look.saturation });
  composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.85, mipmapBlur: true }), tone, new VignetteEffect({ offset: 0.3, darkness: 0.45 }), new ToneMappingEffect({ mode: ToneMappingMode.AGX })));

  // Steve at time t: body from the move keys, then each hand reaches its target and the head turns to its look point.
  // A target is a world point [x, y, z]; a film with props adds named anchors here (a handle that moves with its drawer)
  // Steve's teal shirt (hue 165-200, both layers, arms too) repainted in another colour, its shading kept
  async function reshirt(url, hex) {
    const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url);
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), to = new THREE.Color(hex), hsl = {};
    for (let i = 0; i < d.data.length; i += 4) {
      if (!d.data[i + 3]) continue;
      new THREE.Color(d.data[i] / 255, d.data[i + 1] / 255, d.data[i + 2] / 255).getHSL(hsl);
      if (hsl.s < 0.25 || hsl.h < 165 / 360 || hsl.h > 200 / 360) continue;
      const k = Math.max(d.data[i], d.data[i + 1], d.data[i + 2]) / 175; // 175: the shirt's main tone
      d.data[i] = Math.min(255, to.r * 255 * k); d.data[i + 1] = Math.min(255, to.g * 255 * k); d.data[i + 2] = Math.min(255, to.b * 255 * k);
    }
    g.putImageData(d, 0, 0);
    return URL.createObjectURL(await new Promise((done) => c.toBlob(done, "image/png")));
  }
  // typing (steve.json hands "typeR"/"typeL"): each hand strikes a new key every 0.16 s, the two out of step, lifting
  // ~2 cm between strikes over its own half of the keyboard (KEYBOARD: the middle of each half, timeline KEYS)
  const KEYBOARD = { R: V(2.66, 1.07, 0.82), L: V(2.36, 1.07, 0.82) };
  const keyOf = (sd, k) => { const x = Math.sin(k * 78.233 + (sd === "R" ? 9.1 : 0)) * 43758.5, y = Math.sin(k * 12.989 + 3.7) * 43758.5; return V((x - Math.floor(x) - 0.5) * 0.09, 0, (y - Math.floor(y) - 0.5) * 0.04); };
  const typing = (sd, t) => {
    const f = t / 0.16 + (sd === "R" ? 0.5 : 0), k = Math.floor(f), u = f - k;
    return KEYBOARD[sd].clone().add(keyOf(sd, k).lerp(keyOf(sd, k + 1), THREE.MathUtils.smoothstep(u, 0.2, 0.8))).add(V(0, 0.022 * Math.sin(Math.PI * u), 0));
  };
  const anchor = (a, t) => (a === "typeR" ? typing("R", t) : a === "typeL" ? typing("L", t) : typeof a === "string" ? story.anchors[a]() : V(...a));
  const now = {};
  const feetAt = makeFeet(steve, () => EDIT.end, bodyAt, clips);
  const perform = (t) => {
    const L = EDIT.steve;
    const feet = feetAt(L.moves, t);
    const B = bodyAt(L.moves, t, clips);
    steve.g.position.set(...B.at);
    steve.g.rotation.y = B.yaw * THREE.MathUtils.DEG2RAD;
    let pose = B.pose;
    steve.setPose(pose);
    steve.g.updateMatrixWorld(true);
    const shoulder = (sd) => ({ pivot: steve.bones[`ua${sd}`].getWorldPosition(V(0, 0, 0)) });
    const R = targetAt(L.hands, "R", t, anchor, shoulder("R")), Lh = targetAt(L.hands, "L", t, anchor, shoulder("L"));
    const look = targetAt(L.look, "at", t, anchor);
    const patch = [];
    for (const sd of ["L", "R"]) if (feet[sd]) patch.push([steve.legTo(sd, feet[sd]), 1]);
    if (look) patch.push([{ head: steve.headTo(look.p) }, look.w]);
    // hand IK the film-kit way: the elbow on a pole, down and out, and blended into the pose's own arm by
    // quaternion slerp; twist-free with an Euler blend, a hand reaching low in front raised the elbow over his shoulder
    const arms = [[R, "R", [-0.6, -1, -0.2]], [Lh, "L", [0.6, -1, -0.2]]].filter(([h]) => h).map(([h, sd, pole]) => [steve.armTo(sd, h.p, pole), h.w]);
    for (const [p, w] of patch) pose = blendPose(pose, p, w);
    for (const [p, w] of arms) pose = slerpPose(pose, { ...pose, ...p, root: pose.root }, w);
    steve.setPose(pose);
    steve.g.updateMatrixWorld(true);
    Object.assign(now, { B, R, Lh, look, feet });
  };

  const free = { on: false, p: V(0, 0, 0), l: V(0, 0, 0), fov: 60 };
  const lookAt = V(0, 0, 0), head = V(0, 0, 0);
  const frame = (t, view) => {
    const cameraTime = view === undefined ? t : viewTime(SHOTS_OUT, DURATION, view, t);
    const cam = cameraAt(cameraTime, EDIT.cam);
    camera.position.copy(cam.p);
    lookAt.copy(cam.l);
    camera.fov = cam.fov;
    if (free.on) { camera.fov = free.fov; camera.position.copy(free.p); lookAt.copy(free.l); }
    camera.up.set(0, 1, 0);
    const sh = shakeAt(EDIT.props.story?.shake, t);
    if (!free.on) { camera.position.x += sh.x; camera.position.y += sh.y; }
    camera.lookAt(lookAt);
    if (!free.on) camera.rotateZ(cam.roll + sh.roll);
    // near plane by distance from the cell: 2 cm inside it, up to 0.6 m out over the cell block, or the depth buffer runs out
    camera.near = THREE.MathUtils.clamp(camera.position.distanceTo(V(3, 1.5, 3)) / 160, 0.02, 0.6);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    head.copy(camera.position);
    Object.assign(now, { cam });

    perform(stillAt(t));
    const st = story.draw(t, { steve });
    const c = camera.position, inside = c.x > -1 && c.x < 7 && c.z > -1 && c.z < 7 && c.y > -1 && c.y < 3;
    const redAt = EDIT.props.story?.red?.find(([a, b]) => t >= a && t < (b ?? Infinity))?.[0];
    const self = redAt != null && c.y > 3; // the block red, seen from above: his cell is the block's copy, red like the rest
    camera.layers.set(self ? 1 : 0);
    const near = c.x > next.x - 1 && c.x < next.x + 7 && c.z > next.z - 1 && c.z < next.z + 7 && c.y > -1 && c.y < 3;
    block.draw(t, { inside, near, led: ledWorld, away: st.away, red: redAt, self }); // story.red: [from, to] spans the block burns red
    // over the cell its ceiling (and the lamp blocks in it) come off: the cell block seen from above, roofless
    loose.ceiling.visible = c.y < 3;
    loose.tunnel.visible = lights.group.visible = c.y < 3; // over the block the cells north of his cover where it runs
    above.intensity = 1.1 * THREE.MathUtils.smoothstep(c.y, 3, 7);
    const sk = EDIT.props.story?.shelf?.filter((k) => t >= k.t).at(-1);
    loose.shelf.visible = !sk?.open;
    holeLight.intensity = sk?.open ? 1.8 : 0;

    const L = EDIT.light, lv = flickerAt(L, t);
    hemi.intensity = L.fill;
    shelfFill.intensity = L.shelf;
    lamps.forEach((l, i) => { l.intensity = i < TORCHES.length ? L.torch : L.fire; });
    for (const look of roomLooks) {
      const k = look.id === "tube" ? lv : 1;
      look.lamp.intensity = (look.id === "tube" ? L.tube : L.key) * k;
      for (const [m, e, c] of look.mats) { m.emissiveIntensity = e * (0.08 + 0.92 * k); m.color.copy(c).multiplyScalar(0.25 + 0.75 * k); }
    }
    for (const look of roomLooks) look.g.visible = roomLight.pick.id === look.id && c.y < 3;
    screen.draw(t);
    if (crt.pick.id === "off" || st.blueOff || st.roomDark) { screen.glass.visible = false; screen.glow.intensity = 0; }
    if (st.roomDark) { for (const look of roomLooks) { look.lamp.intensity = 0; for (const [m] of look.mats) { m.emissiveIntensity = 0; m.color.multiplyScalar(0.25); } } hemi.intensity = L.fill; shelfFill.intensity = 0; }
    cctvFill.intensity = st.roomDark ? 0 : 1.5;
    moon.intensity = st.roomDark ? 6 : 0; // after the lever: the lamps dead, only the cold fill left
    const flare = EDIT.props.story?.flare?.some(([a, b]) => t >= a && t < b);
    const on = flare ? 1 : st.roomDark ? 0 : ledAt(t);
    led.material.color.setHex(0xff1a10).multiplyScalar(0.12 + 3.4 * on);
    ledGlow.intensity = L.led.glow * on * (flare ? 1.5 : 1);
    if (flare) led.material.color.setHex(0xff1a10).multiplyScalar(6);
    for (const [src, d] of twins) { d.visible = near && src.visible; d.intensity = src.intensity; d.color.copy(src.color); }
    story.hudAt(t);
    tone.saturation = EDIT.look.saturation;
    composer.render(0);
  };

  const draw = makeTransitions(renderer, frame, () => SHOTS_OUT, () => DURATION, free);
  // The studio's list top left (key I) and every draft frame: what is going on at t and which file holds it
  const mm = (fov) => Math.round(12 / Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  draw.describe = (t) => {
    const s = SHOTS_OUT[shotAt(t)], m = now.B?.act ?? EDIT.steve.moves[0];
    return [
      { head: "SHOT", lines: [{ text: `${shotAt(t) + 1}/${SHOTS_OUT.length} ${s.size} · ${s.what}`, fresh: t - s.t < 1 }] },
      { head: "CAMERA", lines: [{ text: `lens ~${mm(now.cam?.fov ?? 60)}mm (FOV ${Math.round(now.cam?.fov ?? 60)}°) · Catmull-Rom path (film-stage/camera.ts)` }] },
      { head: "STEVE", lines: [
        { text: `${m.do ?? ""} · ${m.clip ? `mocap ${m.clip} (mc-actor/clips.ts)` : `pose ${m.pose} (src/steve.ts)`}`, fresh: t - m.t < 1 && t >= m.t },
        { text: "feet planted (mc-actor/feet.ts) · face: no eyes, never moves (mc-actor FACES noeyes)" },
      ] },
      { head: "LIGHT", lines: [
        { text: `room: ${roomLight.pick.title} (chip; world.ts ROOM_LIGHTS) · tube ${EDIT.light.tube} cd, flicker (film-stage/flicker) · torch ${EDIT.light.key} cd · fill ${EDIT.light.fill}` },
        { text: `CRT: ${crt.pick.title}, cold glow ${EDIT.light.screen} (mc-assets/screen.ts, timeline/props.json screen) · CCTV red light every ${EDIT.light.led.period} s (edit.json light.led)` },
      ] },
      { head: "IN FRAME / STACK", lines: [
        { text: "three.js r186 · block-model-renderer (room, mc-assets props) · MCprep player.glb (CC-BY) · N8AO · postprocessing AgX" },
      ] },
      { head: "EDIT HERE", lines: [{ text: "src/timeline/steve.json · cam.json · props.json · src/edit.json light/look · src/world.ts (set) · src/variants.ts · ../../packages/mc-assets (pack: submit_slot, trace_printer, book_pulled, cctv_camera, cctv_mount)" }] },
    ];
  };
  draw.tools = {
    clips, scene, camera, free, head, look: lookAt, rig: steve.rig, bones: steve.bones,
    home: { p: [3.0, 1.62, 3.6], l: [2.5, 1.2, 0], fov: 60 }, // the free camera's first spot: the room's middle, eye height, facing the desk
    objects: [[world.group, "room"], [lights.group, "tunnel torches, fire"], [block.group, "cell block (cellblock.ts)"], [loose.door, "iron door"], [loose.shelf, "mailbox shelf"], ...story.objects, [cctv, "CCTV camera (mc-assets pack/cctv_camera.json, cctv_mount.json)"], [screen.glass, "CRT picture (mc-assets/screen.ts)"], [steve.g, "Steve"]], materials: [], composer, renderer,
  };
  draw.checks = footChecks({ perform, steve, now });
  draw.variants = variants;
  return draw;
}
