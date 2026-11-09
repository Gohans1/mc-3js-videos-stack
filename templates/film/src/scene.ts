// @ts-nocheck
// A new Minecraft film: a room, Steve and one keyed camera, made to be replaced shot by shot. Blocks are the game's own
// models (block-model-renderer) plus the shared props (mc-assets/pack) and this film's picks (pack/picks.json); Steve is
// MCprep's rig (mc-actor/player.ts) acting from src/timeline/steve.json (mc-actor/perform.ts, feet.ts); the camera follows
// src/timeline/cam.json (film-stage/camera.ts). draw(t) draws any moment straight away (the studio's film contract:
// node_modules/live-studio/docs/film-contract.md). Mojang files come through assets/public links into the vault (bun run link).
import * as THREE from "three";
import { unzipSync } from "fflate";
import { BloomEffect, EffectComposer, EffectPass, HueSaturationEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { configure, createScene } from "block-model-renderer";
import { EDIT, fromSource } from "./edit";
import { buildWorld, ROOM } from "./world";
import { bodyAt, blinkAt, moodAt, readLook, targetAt } from "./steve";
import { makeFeet } from "mc-actor/feet";
import { footChecks } from "mc-actor/checks";
import { loadClips } from "mc-actor/clips";
import { blendPose, loadRig, makePlayer, mouthAt } from "mc-actor/player";
import { slerpPose } from "mc-actor/mocap";
import { props as pack } from "mc-assets/pack";
import { makePlaced } from "mc-assets/placed";
import { cameraAt, EASES } from "film-stage/camera";
import { animate, ANIMS } from "film-stage/animate";
import { blackAt, makeFade } from "film-stage/fade";
import { makeTitles } from "film-stage/titles";
import { makeTransitions, viewTime } from "film-stage/transitions";
import { makeAdjustments } from "film-stage/grade";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16; // block-model-renderer works in pixels, the film in blocks

// The studio reads each shot's name from the comment on its line; size and what feed a draft's list (draw.describe, LIST=1)
export const SHOTS = [
  { t: 0, size: "wide (WS)", what: "the room" }, // wide: Steve in the room
];
export let DURATION = 0;
export const SHOTS_OUT = [];
export const applyEdit = () => {
  SHOTS.forEach((s, i) => { SHOTS_OUT[i] = { ...s, t: fromSource(s.t) }; });
  DURATION = fromSource(EDIT.end);
};
applyEdit();
const shotAt = (t) => SHOTS_OUT.filter((s) => t >= s.t).length - 1;

export async function buildScene(canvas, W, H, draft = false) {
  configure({ THREE, assetsUrl: "vendor/bmr_assets.zip" });
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.02, 100);
  scene.add(camera);

  // client.jar without its Java code (scripts/mc/slim_jar.py), then the props and the picks stacked above it
  const jarFile = await fetch("mc/client_assets.zip");
  if (!jarFile.ok) throw new Error("mc/client_assets.zip is missing: bun run link at the repo root (python ../../scripts/mc/slim_jar.py if the vault lacks it)");
  const jar = new Uint8Array(await jarFile.arrayBuffer());
  const picked = new Uint8Array(await (await fetch("picked.zip")).arrayBuffer());
  const sources = [pack, picked, jar];
  const world = await createScene(sources, buildWorld(), { lighting: "scene", animate: false });
  world.group.scale.setScalar(S);
  world.group.position.set(0.5, 0.5, 0.5); // block-model-renderer centres blocks on whole numbers; a Minecraft block spans x..x+1
  world.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(world.group);

  // Steve's skin comes out of the same zip
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skinUrl = URL.createObjectURL(new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }));
  const steve = await makePlayer(await loadRig("rig/player.glb"), skinUrl, { glow: 0.03 });
  URL.revokeObjectURL(skinUrl);
  scene.add(steve.g);
  const placed = await makePlaced(scene, sources, EDIT, "placed"); // what the creator drops in from the studio's Objects tab
  // mocap clips the moves name, baked once here: draw(t) only reads them
  const clips = await loadClips(EDIT.steve.moves.filter((m) => m.clip).map((m) => m.clip), steve);

  // A soft key from above the room's middle and a sky/ground fill (edit.json light)
  const C = EDIT.light;
  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x3a3026, C.fill);
  const key = new THREE.SpotLight(0xfff0dc, C.key, 14, THREE.MathUtils.degToRad(70), 0.7, 1.2);
  key.position.set(ROOM.x1 / 2 + 0.5, ROOM.top + 0.6, ROOM.z1 / 2 + 0.5);
  key.target.position.set(ROOM.x1 / 2 + 0.5, 0, ROOM.z1 / 2 + 0.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  key.shadow.radius = 3;
  scene.add(hemi, key, key.target);

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 }); // N8AO followed by a pass goes black without multisampling
  const fade = makeFade(renderer);
  const titles = makeTitles(renderer, W, H); // the titles, arrows and circles of src/timeline/text.json, over everything
  await titles.ready;
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, W, H);
  Object.assign(ao.configuration, { aoRadius: 1.0, distanceFalloff: 1.0, intensity: 2.0, halfRes: draft });
  ao.outputTargetInternal.texture.type = THREE.HalfFloatType; // 8-bit would band dark stone
  composer.addPass(ao);
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  const tone = new HueSaturationEffect({ saturation: EDIT.look.saturation });
  composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.85, mipmapBlur: true }), tone, new VignetteEffect({ offset: 0.3, darkness: 0.45 }), new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
  const adjust = makeAdjustments(composer, camera);
  await adjust.prepare(SHOTS_OUT.map((s) => s.adjust));

  // Steve at time t: body from the move keys, then each hand reaches its target and the head turns to its look point.
  // A target is a world point [x, y, z]; a film with props adds named anchors here (a handle that moves with its drawer)
  const anchor = (a) => V(...a);
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
    // hand IK the film-kit way (AGENTS.md there): the elbow on a pole, down and out, and blended into the pose's own arm by
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
    Object.assign(now, { cam });

    perform(t);
    placed.draw(t);
    const mood = moodAt(EDIT.steve.face, t);
    steve.face(mood, mouthAt([], 0), blinkAt(t, 0), readLook(EDIT.steve.read, t) ?? [0, -0.15]);
    now.mood = mood;

    hemi.intensity = EDIT.light.fill;
    key.intensity = EDIT.light.key;
    tone.saturation = EDIT.look.saturation;
    const shot = view ?? shotAt(t);
    adjust(shot, SHOTS_OUT[shot]?.adjust, t, free.on);
    composer.render(0);
    if (!free.on) fade(Math.max(blackAt(EDIT.fx.black, t), animBlack));
    if (!free.on) titles(EDIT.text.items, t, camera, EDIT.text.tracks);
  };

  const draw = makeTransitions(renderer, frame, () => SHOTS_OUT, () => DURATION, free);
  // A draft frame's list (LIST=1): what is going on at t and which file holds it
  const mm = (fov) => Math.round(12 / Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  draw.describe = (t) => {
    const s = SHOTS_OUT[shotAt(t)], m = now.B?.act ?? EDIT.steve.moves[0];
    return [
      { head: "SHOT", lines: [{ text: `${shotAt(t) + 1}/${SHOTS_OUT.length} ${s.size} · ${s.what}`, fresh: t - s.t < 1 }] },
      { head: "CAMERA", lines: [{ text: `lens ~${mm(now.cam?.fov ?? 60)}mm (FOV ${Math.round(now.cam?.fov ?? 60)}°) · Catmull-Rom path (film-stage/camera.ts)` }] },
      { head: "STEVE", lines: [
        { text: `${m.do ?? ""} · ${m.clip ? `mocap ${m.clip} (mc-actor/clips.ts)` : `pose ${m.pose} (src/steve.ts)`}`, fresh: t - m.t < 1 && t >= m.t },
        { text: `feet planted (mc-actor/feet.ts) · face ${EDIT.steve.face.filter((f) => f.t <= t).at(-1)?.mood ?? "neutral"}` },
      ] },
      { head: "IN FRAME / STACK", lines: [
        { text: "three.js r186 · block-model-renderer (room, mc-assets props) · MCprep player.glb (CC-BY) · N8AO · postprocessing AgX" },
      ] },
      { head: "EDIT HERE", lines: [{ text: "src/timeline/steve.json · cam.json · src/edit.json light/look · src/world.ts" }] },
    ];
  };
  draw.tools = {
    titles, clips, scene, camera, free, head, look: lookAt, rig: steve.rig, bones: steve.bones,
    objects: [[world.group, "room"], [steve.g, "Steve"]], materials: [], composer, renderer, placed,
  };
  draw.eases = EASES; // the studio's camera row draws the keys' eases with these
  draw.anims = ANIMS; // the studio's Animation tab lists these
  draw.adjustments = { prepare: adjust.prepare };
  draw.checks = footChecks({ perform, steve, now });
  return draw;
}
