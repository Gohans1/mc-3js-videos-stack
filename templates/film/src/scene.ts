// @ts-nocheck
import { configure, createScene, prepareAssets } from "block-model-renderer";
import { unzipSync } from "fflate";
import { animate, ANIMS } from "film-stage/animate";
import {
  apertureOffset,
  applyCameraFeel,
  applyCameraRig,
  cameraAt,
  cameraTrackOptions,
  EASES,
  lensAspect,
  mmOf,
  orientCamera,
  orthographicCamera,
  projectCamera,
  resolveFocusDistance,
} from "film-stage/camera";
import { makeDof } from "film-stage/dof";
import { blackAt, makeFade } from "film-stage/fade";
import { makeAdjustments, makeLayerAdjustments } from "film-stage/grade";
import { activeAdjustments } from "film-stage/grade-layers";
import {
  applyLightingRig,
  createGodraysPass,
  createLightingRig,
  DEFAULT_LIGHTS,
  lightsAt,
} from "film-stage/lights";
import { makeTitles } from "film-stage/titles";
import { makeTransitions, viewTime } from "film-stage/transitions";
import { makeVelocity } from "film-stage/velocity";
import { mouthCues } from "live-studio/lips";
import { findTarget } from "live-studio/targets";
import { footChecks } from "mc-actor/checks";
import { loadClips } from "mc-actor/clips";
import { makeFeet } from "mc-actor/feet";
import { slerpPose } from "mc-actor/mocap";
import { blendPose, loadRig, makePlayer, mouthAt } from "mc-actor/player";
import { props as pack } from "mc-assets/pack";
import { makePlaced } from "mc-assets/placed";
import { N8AOPostPass } from "n8ao";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
// A new Minecraft film: a room, Steve and one keyed camera, made to be replaced shot by shot. Blocks are the game's own
// models (block-model-renderer) plus the shared props (mc-assets/pack) and this film's picks (pack/picks.json); Steve is
// MCprep's rig (mc-actor/player.ts) acting from src/timeline/steve.json (mc-actor/perform.ts, feet.ts); the camera follows
// src/timeline/cam.json (film-stage/camera.ts). draw(t) draws any moment straight away (the studio's film contract:
// bun run skills get core --ref contract). Mojang files come through assets/public links into the vault (bun run link).
// Pre-installed extras: rigid-body physics via @dimforge/rapier3d-compat (pre-bake in Bun to src/timeline/*.json for
// deterministic draw(t)); ambient occlusion & post FX via n8ao (N8AOPostPass) + postprocessing (EffectComposer, below);
// volumetric godrays via three-good-godrays (GodraysPass; PointLight or DirectionalLight only, not SpotLight, before ToneMappingEffect).
import * as THREE from "three";

import { EDIT, fromSource } from "./edit";
import { blinkAt, bodyAt, moodAt, readLook, targetAt } from "./steve";
import { buildWorld, ROOM } from "./world";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16; // block-model-renderer works in pixels, the film in blocks

export const SHOTS = [];
export let DURATION = 0;
export const SHOTS_OUT = [];
export const applyEdit = () => {
  SHOTS.splice(0, SHOTS.length, ...EDIT.shots);
  SHOTS_OUT.length = SHOTS.length;
  SHOTS.forEach((s, i) => {
    SHOTS_OUT[i] = {
      ...s,
      t: fromSource(s.t),
      ...(s.hits ? { hits: s.hits.map((h) => ({ ...h, t: fromSource(h.t) })) } : {}),
    };
  });
  DURATION = fromSource(EDIT.end);
};
applyEdit();
const shotAt = (t) => SHOTS_OUT.filter((s) => t >= s.t).length - 1;

export async function buildScene(canvas, W, H, draft = false) {
  configure({ THREE, assetsUrl: "vendor/bmr_assets.zip" });
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const perspective = new THREE.PerspectiveCamera(60, W / H, 0.02, 100);
  const parallel = orthographicCamera(60, W / H);
  let camera = perspective;
  scene.add(perspective, parallel);

  // client.jar without its Java code (scripts/mc/slim_jar.mjs), then the props and the picks stacked above it
  const jarFile = await fetch("mc/client_assets.zip");
  if (!jarFile.ok)
    throw new Error(
      "mc/client_assets.zip is missing: bun run link at the repo root (bun ../../scripts/mc/slim_jar.mjs if the vault lacks it)",
    );
  const jar = new Uint8Array(await jarFile.arrayBuffer());
  const picked = new Uint8Array(await (await fetch("picked.zip")).arrayBuffer());
  // prepared once, with block-model-renderer's cross-call cache: a createScene handed raw zips unpacks the 5 MB jar again
  // and decodes every texture again on each call
  const sources = await prepareAssets([pack, picked, jar], { cache: true });
  const blocks = buildWorld();
  const roofLevel = ROOM.top + 1;
  const [world, roof] = await Promise.all([
    createScene(
      sources,
      blocks.filter((b) => b.pos[1] !== roofLevel),
      { lighting: "scene", animate: false },
    ),
    createScene(
      sources,
      blocks.filter((b) => b.pos[1] === roofLevel),
      { lighting: "scene", animate: false },
    ),
  ]);
  for (const { group } of [world, roof]) {
    group.scale.setScalar(S);
    group.position.set(0.5, 0.5, 0.5);
    group.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    scene.add(group);
  }
  const cameraGroups = { Roof: roof.group };

  // Steve's skin comes out of the same zip
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skinUrl = URL.createObjectURL(
    new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }),
  );
  const steve = await makePlayer(await loadRig("rig/player.glb"), skinUrl, { glow: 0.03 });
  URL.revokeObjectURL(skinUrl);
  scene.add(steve.g);
  const placed = await makePlaced(scene, sources, EDIT, "placed"); // what the creator drops in from the studio's Objects tab
  // mocap clips the moves name, baked once here: draw(t) only reads them
  const clips = await loadClips(
    EDIT.steve.moves.filter((m) => m.clip).map((m) => m.clip),
    steve,
  );

  const roomTarget = [ROOM.x1 / 2 + 0.5, 1.5, ROOM.z1 / 2 + 0.5];
  const lightingRig = createLightingRig(scene, {
    target: roomTarget,
    distance: 18,
    shadowExtent: 10,
  });
  const inactiveRig = {
    ...DEFAULT_LIGHTS,
    key: { ...DEFAULT_LIGHTS.key, enabled: false },
    fill: { ...DEFAULT_LIGHTS.fill, enabled: false },
    rim: { ...DEFAULT_LIGHTS.rim, enabled: false },
    world: { ...DEFAULT_LIGHTS.world, ambientIntensity: 0, background: null },
    fog: { ...DEFAULT_LIGHTS.fog, mode: "none" },
    practicals: [],
    godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
  };
  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x3a3026);
  const roomKey = new THREE.SpotLight(0xfff0dc, 40, 14, THREE.MathUtils.degToRad(70), 0.7, 1.2);
  roomKey.position.set(roomTarget[0], ROOM.top + 0.6, roomTarget[2]);
  roomKey.target.position.set(roomTarget[0], 0, roomTarget[2]);
  roomKey.castShadow = true;
  roomKey.shadow.mapSize.set(2048, 2048);
  roomKey.shadow.bias = -0.0008;
  roomKey.shadow.radius = 3;
  scene.add(hemi, roomKey, roomKey.target);
  let timelineLighting = true;

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 4,
  });
  const fade = makeFade(renderer);
  const titles = makeTitles(renderer, W, H, { items: EDIT.text.items }); // the titles and Cinetic annotation shapes of src/timeline/text.json, over everything; ready waits on their fonts only
  const anims = ANIMS;
  await titles.ready;
  composer.addPass(new RenderPass(scene, camera));
  const ambientOcclusion = (view) => {
    const ao = new N8AOPostPass(scene, view, W, H);
    Object.assign(ao.configuration, {
      aoRadius: 1.0,
      distanceFalloff: 1.0,
      intensity: 2.0,
      halfRes: draft,
    });
    ao.outputTargetInternal.texture.type = THREE.HalfFloatType;
    return ao;
  };
  const ao = ambientOcclusion(perspective);
  composer.addPass(ao);
  let parallelAO,
    composerCamera = perspective,
    passCount = -1;
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  const dof = makeDof(composer, camera, { draft });
  const godrays = createGodraysPass(lightingRig.key, camera, { enabled: false });
  if (godrays.pass) composer.addPass(godrays.pass);
  const tone = new HueSaturationEffect({ saturation: EDIT.look.saturation });
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.85, mipmapBlur: true }),
      tone,
      new VignetteEffect({ offset: 0.3, darkness: 0.45 }),
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    ),
  );
  const adjust = makeAdjustments(composer, camera),
    layerAdjust = makeLayerAdjustments(renderer);
  await Promise.all([
    adjust.prepare(SHOTS_OUT.map((s) => s.adjust)),
    layerAdjust.prepare((EDIT.adjustments?.items ?? []).map((it) => it.grade)),
  ]);

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
    const R = targetAt(L.hands, "R", t, anchor, shoulder("R")),
      Lh = targetAt(L.hands, "L", t, anchor, shoulder("L"));
    const look = targetAt(L.look, "at", t, anchor);
    const patch = [];
    for (const sd of ["L", "R"]) if (feet[sd]) patch.push([steve.legTo(sd, feet[sd]), 1]);
    if (look) patch.push([{ head: steve.headTo(look.p) }, look.w]);
    // hand IK the film-kit way: the elbow on a pole, down and out, and blended into the pose's own arm by
    // quaternion slerp; twist-free with an Euler blend, a hand reaching low in front raised the elbow over his shoulder
    const arms = [
      [R, "R", [-0.6, -1, -0.2]],
      [Lh, "L", [0.6, -1, -0.2]],
    ]
      .filter(([h]) => h)
      .map(([h, sd, pole]) => [steve.armTo(sd, h.p, pole), h.w]);
    for (const [p, w] of patch) pose = blendPose(pose, p, w);
    for (const [p, w] of arms) pose = slerpPose(pose, { ...pose, ...p, root: pose.root }, w);
    steve.setPose(pose);
    steve.g.updateMatrixWorld(true);
    Object.assign(now, { B, R, Lh, look, feet });
  };

  const free = {
    on: false,
    previewEffects: false,
    p: V(0, 0, 0),
    l: V(0, 0, 0),
    fov: 60,
    roll: 0,
    wave: 0,
    bob: 0,
    fstop: 0,
    focus: undefined,
    handheld: false,
  };
  const lookAt = V(0, 0, 0),
    head = V(0, 0, 0);
  const velocityEffect = makeVelocity(renderer);
  const opticsTelemetry = {};
  const sceneObjects = [
    [world.group, "room"],
    [roof.group, "Roof"],
    [steve.g, "Steve"],
  ];
  const focusBox = new THREE.Box3();
  const focusVec = V(0, 0, 0);
  const resolveFocusTarget = (name) => {
    const obj = findTarget({ scene, objects: sceneObjects, bones: steve.bones }, name);
    if (!obj) return null;
    obj.updateMatrixWorld(true);
    if (obj.isBone && !obj.children.length) return obj.getWorldPosition(focusVec).clone();
    focusBox.setFromObject(obj);
    return (
      !focusBox.isEmpty() ? focusBox.getCenter(focusVec) : obj.getWorldPosition(focusVec)
    ).clone();
  };
  const syncOptics = (cam, shot, shotEntry, activeLayerLook, bypass) => {
    const effectiveFstop = bypass ? 0 : cam.fstop;
    const fallbackFocus = Math.max(0.05, camera.position.distanceTo(lookAt));
    const resolvedFocus = bypass
      ? {}
      : resolveFocusDistance(cam.focus, camera.position, resolveFocusTarget, fallbackFocus);
    const rawFocusM = resolvedFocus.distance ?? (effectiveFstop > 0 ? fallbackFocus : undefined);
    const focusM = rawFocusM !== undefined ? Math.max(0.05, rawFocusM) : undefined;
    const lock = shotEntry?.camera?.fovAxis;
    const renderedMm = Math.round(mmOf(camera.fov, lensAspect(W / H, lock)) * 10) / 10;
    Object.assign(opticsTelemetry, {
      shot,
      shotName: [shotEntry?.size, shotEntry?.what ?? shotEntry?.name].filter(Boolean).join(" · "),
      mm: renderedMm,
      fov: Math.round(camera.fov * 10) / 10,
      fstop: effectiveFstop !== undefined ? Math.round(effectiveFstop * 10) / 10 : undefined,
      focusM: focusM !== undefined ? Math.round(focusM * 100) / 100 : undefined,
      focusTarget: resolvedFocus.label,
      handheld: bypass ? undefined : cam.handheld,
      look:
        activeLayerLook ??
        (shotEntry?.adjust?.enabled !== false ? shotEntry?.adjust?.look : undefined),
      impulse: bypass ? undefined : cam.optics?.impulse,
    });
    return { effectiveFstop, focusM, fallbackFocus, renderedMm };
  };
  const anchorObject = (anchor) => {
    const name =
      typeof anchor.target === "string"
        ? anchor.target
        : Array.isArray(anchor.eye)
          ? "Steve.head"
          : null;
    return name ? findTarget({ scene, objects: sceneObjects, bones: steve.bones }, name) : null;
  };
  const stableAnchorRotation = () => {
    const forward = V(0, 0, 1).applyQuaternion(steve.g.getWorldQuaternion(new THREE.Quaternion()));
    return new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.atan2(forward.x, forward.z));
  };
  const resolveCameraAnchor = (anchor) => {
    const object = anchorObject(anchor);
    if (!object) return null;
    const point = new THREE.Vector3().fromArray(anchor.offset ?? anchor.eye ?? [0, 0, 0]);
    if (anchor.space === "local") return object.localToWorld(point);
    if (anchor.space === "view") point.applyQuaternion(stableAnchorRotation());
    return point.add(object.getWorldPosition(new THREE.Vector3()));
  };
  const moveCameraAnchor = (anchor, point) => {
    const object = anchorObject(anchor);
    if (!object) return null;
    const offset = new THREE.Vector3().fromArray(point);
    if (anchor.space === "local") object.worldToLocal(offset);
    else {
      offset.sub(object.getWorldPosition(new THREE.Vector3()));
      if (anchor.space === "view") offset.applyQuaternion(stableAnchorRotation().invert());
    }
    const field = Array.isArray(anchor.eye) && !anchor.target ? "eye" : "offset";
    return { ...anchor, [field]: offset.toArray(), fallback: point };
  };
  const sampleTrack = (t, rig, optics) =>
    cameraAt(t, EDIT.cam, {
      aspect: W / H,
      resolveAnchor: resolveCameraAnchor,
      ...cameraTrackOptions(rig),
      optics,
    });
  let clocks,
    editTime = 0,
    worldTime = 0;
  const cameraSample = () => {
    const cam = sampleTrack(editTime, SHOTS_OUT[Math.max(0, shotAt(worldTime))]?.camera);
    const focus =
      cam.focus && typeof cam.focus === "object" && "u" in cam.focus
        ? resolveFocusDistance(cam.focus, cam.base.p, resolveFocusTarget).distance
        : cam.focus;
    return { ...cam.sample, focus };
  };
  const cameraOpticsSample = () => {
    const shot = SHOTS_OUT[Math.max(0, shotAt(worldTime))];
    const cam = sampleTrack(editTime, shot?.camera, shot?.optics);
    const p = free.on ? (now.cam?.p ?? cam.p) : camera.position;
    const l = free.on ? (now.cam?.l ?? cam.l) : lookAt;
    const focus =
      cam.focus && typeof cam.focus === "object" && "u" in cam.focus
        ? resolveFocusDistance(cam.focus, p, resolveFocusTarget, p.distanceTo(l)).distance
        : cam.focus;
    return { mm: cam.mm, focus };
  };
  const poseScene = (t) => {
    perform(t);
    placed.draw(t);
    scene.updateMatrixWorld();
  };
  const hasAnchors = () => EDIT.cam.some((key) => !Array.isArray(key.p) || !Array.isArray(key.l));
  const riggedTrack = (world, time, i, worldAtCamera) => {
    const rig = SHOTS_OUT[i]?.camera;
    const cam = sampleTrack(time, rig, SHOTS_OUT[i]?.optics);
    const bounds = [SHOTS_OUT[i]?.t ?? 0, SHOTS_OUT[i + 1]?.t ?? DURATION];
    const clock =
      worldAtCamera ?? (SHOTS_OUT[i]?.cameraClock === "output" ? () => world : (next) => next);
    const movingAnchor = (rig?.lead || rig?.bank || rig?.look === "tangent") && hasAnchors();
    try {
      applyCameraRig(cam, time, bounds, rig, (at) => {
        if (movingAnchor) poseScene(clock(at));
        return sampleTrack(at, rig);
      });
    } finally {
      if (movingAnchor) poseScene(world);
    }
    return cam;
  };
  const sampleCameraFrames = (times, sample) => {
    if (!hasAnchors()) return times.map((time) => sample(time));
    try {
      return times.map((time) => {
        poseScene(time.world);
        return sample(time);
      });
    } finally {
      poseScene(worldTime);
    }
  };
  const sampleCameraTrack = (times) =>
    sampleCameraFrames(
      times,
      ({ world, camera }) =>
        sampleTrack(camera, SHOTS_OUT[Math.max(0, shotAt(world))]?.camera).sample,
    );
  const sampleCameraPath = (times) =>
    sampleCameraFrames(times, ({ world, camera, worldAtCamera }) => {
      const cam = riggedTrack(world, camera, Math.max(0, shotAt(world)), worldAtCamera);
      animate(cam, camera, SHOTS_OUT, DURATION, anims);
      return { p: cam.p, l: cam.l, fov: cam.fov, base: cam.base };
    });
  const frame = (t, view) => {
    const scouting = free.on && !free.previewEffects;
    const activeView = view === undefined || view === shotAt(t);
    worldTime = t;
    poseScene(t);
    const trackTime = clocks?.camera ?? t;
    const cameraTime =
      view === undefined ? trackTime : viewTime(SHOTS_OUT, DURATION, view, trackTime);
    const shot = Math.max(0, view ?? shotAt(t));
    const shotEntry = SHOTS_OUT[shot];
    const rig = shotEntry?.camera;
    const cam = riggedTrack(t, cameraTime, shot, activeView ? clocks?.worldAtCamera : undefined);
    for (const [name, group] of Object.entries(cameraGroups))
      group.visible = !rig?.hideGroups?.includes(name);
    const animBlack = animate(cam, cameraTime, SHOTS_OUT, DURATION, anims);
    const freeActive = free.on && activeView;
    camera = !freeActive && rig?.projection === "orthographic" ? parallel : perspective;
    camera.position.copy(cam.p);
    lookAt.copy(cam.l);
    camera.fov = cam.fov;
    let freeFeel;
    if (freeActive) {
      camera.fov = free.fov;
      camera.position.copy(free.p);
      lookAt.copy(free.l);
      freeFeel = applyCameraFeel({
        p: camera.position,
        l: lookAt,
        roll: free.roll ?? 0,
        t,
        wave: free.wave ?? 0,
        bob: free.bob ?? 0,
        handheld: free.handheld,
      });
    }
    orientCamera(
      camera,
      lookAt,
      freeActive ? freeFeel.roll : scouting ? 0 : cam.roll,
      freeActive ? undefined : scouting ? undefined : rig,
    );
    projectCamera(
      camera,
      W,
      H,
      freeActive ? undefined : scouting ? { orthographicDepth: rig?.orthographicDepth } : rig,
    );
    head.copy(camera.position);
    Object.assign(now, { cam });

    const mood = moodAt(EDIT.steve.face, t);
    // lip sync: the takes with "by": "steve" in edit.json (bun run voice:lips); any mouth of the film's own reads the same cues
    const mouth = mouthAt(mouthCues(EDIT, "steve"), t);
    steve.face(mood, mouth, blinkAt(t, 0), readLook(EDIT.steve.read, t) ?? [0, -0.15]);
    now.mood = mood;

    const lightKeys = Array.isArray(EDIT.lights) ? EDIT.lights : EDIT.lights?.keys;
    if (lightKeys?.length) {
      hemi.visible = roomKey.visible = false;
      const lightsSample = lightsAt(EDIT.lights, t);
      applyLightingRig(lightingRig, lightsSample, t);
      godrays.update(lightsSample.godrays, lightsSample.key.color);
      timelineLighting = true;
    } else {
      if (timelineLighting) {
        applyLightingRig(lightingRig, inactiveRig);
        godrays.update(inactiveRig.godrays);
        timelineLighting = false;
      }
      hemi.visible = roomKey.visible = true;
      hemi.intensity = EDIT.light?.fill ?? 0.6;
      roomKey.intensity = EDIT.light?.key ?? 40;
    }
    tone.saturation = EDIT.look.saturation;
    const adjAt = clocks?.adjustments ?? clocks?.layers ?? t;
    const adjVisible = clocks?.adjustmentsVisible ?? clocks?.layersVisible ?? true;
    const activeLayerLook = adjVisible
      ? [...activeAdjustments(EDIT.adjustments, adjAt, clocks?.adjustmentTime)]
          .reverse()
          .find((it) => it.grade?.enabled !== false && it.grade?.look)?.grade?.look
      : undefined;
    const opticsSource = freeActive
      ? {
          fstop: free.fstop ?? 0,
          focus: free.focus,
          handheld: freeFeel.handheld,
        }
      : cam;
    const { effectiveFstop, focusM, fallbackFocus, renderedMm } = syncOptics(
      opticsSource,
      shot,
      shotEntry,
      activeLayerLook,
      freeActive ? false : scouting,
    );
    Object.assign(now, { optics: opticsTelemetry });
    renderer.clear();
    if (clocks?.pictureVisible !== false || scouting) {
      const pupil = camera === perspective && clocks?.aperture;
      if (pupil) {
        const offset = apertureOffset(
          camera,
          pupil,
          renderedMm,
          effectiveFstop,
          focusM ?? fallbackFocus,
        );
        projectCamera(camera, W, H, freeActive ? undefined : rig, offset);
      }
      dof.update({
        fstop: pupil ? 0 : effectiveFstop,
        focusDistance: focusM ?? fallbackFocus,
        mm: renderedMm,
        widthPx: W * renderer.getPixelRatio(),
      });
      adjust(shot, shotEntry?.adjust, t, false);
      if (camera === parallel && !parallelAO) {
        parallelAO = ambientOcclusion(parallel);
        composer.addPass(parallelAO, composer.passes.indexOf(ao) + 1);
      }
      ao.enabled = camera === perspective;
      if (parallelAO) parallelAO.enabled = camera === parallel;
      if (composerCamera !== camera || passCount !== composer.passes.length) {
        composer.setMainCamera(camera);
        composerCamera = camera;
        passCount = composer.passes.length;
      }
      composer.render(0);
      if (!scouting) velocityEffect(clocks?.velocity ?? null, cam.optics);
      if (!scouting) fade(Math.max(blackAt(EDIT.fx.black, t), animBlack));
    }
    if (!scouting && clocks?.layersVisible !== false)
      titles(EDIT.text.items, clocks?.layers ?? t, camera, EDIT.text.tracks, clocks?.textTime);
  };

  const composite = makeTransitions(
    renderer,
    frame,
    () => SHOTS_OUT,
    () => DURATION,
    free,
    (t) => {
      const at = clocks?.adjustments ?? clocks?.layers ?? t;
      const visible = clocks?.adjustmentsVisible ?? clocks?.layersVisible ?? true;
      layerAdjust(
        visible ? activeAdjustments(EDIT.adjustments, at, clocks?.adjustmentTime) : [],
        at,
        false,
      );
    },
    (cut) => clocks?.transitionVisible?.(cut) ?? true,
  );
  const draw = Object.assign((t, nextClocks) => {
    clocks = nextClocks;
    editTime = clocks?.camera ?? t;
    composite(t);
  }, composite);
  draw.velocity = true;
  draw.velocityEffects = velocityEffect.effects;
  // A draft frame's list (LIST=1): what is going on at t and which file holds it
  draw.describe = (t) => {
    const idx = Math.max(0, shotAt(t)),
      s = SHOTS_OUT[idx],
      shotLabel = [s?.size, s?.what ?? s?.name].filter(Boolean).join(" · "),
      m = now.B?.act ?? EDIT.steve.moves[0],
      lensFov = now.cam?.fov ?? 60,
      lensMm = Math.round(mmOf(lensFov, W / H)),
      opt = now.optics,
      rawTarget = opt?.focusTarget?.trim() ?? "",
      numericTarget = /^\d+(?:\.\d+)?m$/.test(rawTarget),
      focusText =
        rawTarget && !numericTarget
          ? `focus ${rawTarget}${opt?.focusM != null ? ` (${opt.focusM}m)` : ""}`
          : opt?.focusM != null
            ? `focus ${opt.focusM}m`
            : rawTarget
              ? `focus ${rawTarget}`
              : null,
      opticsParts = [
        opt?.fstop ? `f/${opt.fstop}` : "deep focus",
        focusText,
        opt?.handheld ? `handheld ${opt.handheld}` : null,
        opt?.impulse ? `impulse ${opt.impulse}` : null,
      ].filter(Boolean),
      lookLine = opt?.look ? `look ${opt.look} (film-stage/looks.ts)` : null;
    return [
      {
        head: "SHOT",
        lines: [
          {
            text: `${idx + 1}/${SHOTS_OUT.length}${shotLabel ? ` ${shotLabel}` : ""}`,
            fresh: s ? t - s.t < 1 : false,
          },
        ],
      },
      {
        head: "CAMERA",
        lines: [
          {
            text: `lens ${lensMm}mm (FOV ${Math.round(lensFov)}°) · ${opticsParts.join(" · ")}`,
          },
          ...(lookLine ? [{ text: lookLine }] : []),
        ],
      },
      {
        head: "STEVE",
        lines: [
          {
            text: `${m.do ?? ""} · ${m.clip ? `mocap ${m.clip} (mc-actor/clips.ts)` : `pose ${m.pose} (src/steve.ts)`}`,
            fresh: t - m.t < 1 && t >= m.t,
          },
          {
            text: `feet planted (mc-actor/feet.ts) · face ${EDIT.steve.face.filter((f) => f.t <= t).at(-1)?.mood ?? "neutral"}`,
          },
          {
            text: `mouth ${mouthCues(EDIT, "steve").findLast(([s]) => s <= t)?.[1] ?? 'X (no lip sync: takes with "by": "steve", bun run voice:lips)'} (src/timeline/mouth.json)`,
          },
        ],
      },
      {
        head: "IN FRAME / STACK",
        lines: [
          {
            text: "three.js r186 · block-model-renderer (room, mc-assets props) · MCprep player.glb (CC-BY) · N8AO · postprocessing AgX",
          },
        ],
      },
      {
        head: "EDIT HERE",
        lines: [
          {
            text: "src/timeline/steve.json · cam.json · lights.json · src/edit.json light/look · src/world.ts",
          },
        ],
      },
    ];
  };
  draw.tools = {
    titles,
    clips,
    scene,
    get camera() {
      return camera;
    },
    free,
    head,
    look: lookAt,
    rig: steve.rig,
    bones: steve.bones,
    objects: sceneObjects,
    materials: [],
    composer,
    renderer,
    optics: opticsTelemetry,
    cameraSample,
    cameraOpticsSample,
    resizePreview(scale) {
      renderer.setPixelRatio(scale);
      composer.setSize(W, H, false);
    },
    sampleCameraPath,
    sampleCameraTrack,
    cameraClock: true,
    cameraRig: true,
    cameraProjection: true,
    cameraRails: true,
    apertureSampling: true,
    cameraGroups: Object.keys(cameraGroups),
    moveCameraAnchor,
    resolveCameraAnchor,
    cameraAnchors: [
      { target: "Steve.head", label: "Head" },
      { target: "Steve.body", label: "Body" },
      { target: "Steve", label: "Root" },
    ],
    placed,
    targets: [
      {
        id: "steve",
        title: "Steve",
        objects: [steve.g],
        rows: [{ edit: "steve", path: [] }],
        transform: {
          row: { edit: "steve", path: ["moves"] },
          axes: { translate: [true, true, true], rotate: [false, true, false] },
          read: (key) => ({ at: key.at, rot: [0, key.yaw, 0], scale: 1 }),
          write: (key, value) => {
            key.at = value.at;
            key.yaw = value.rot[1];
          },
        },
      },
    ],
  };
  draw.eases = EASES; // the studio's camera row draws the keys' eases with these
  draw.keyEases = [{ edit: "steve", path: ["moves"], names: Object.keys(EASES) }];
  draw.anims = anims; // the studio's Animation tab lists these
  draw.adjustments = {
    prepare: (grades) => Promise.all([adjust.prepare(grades), layerAdjust.prepare(grades)]),
  };
  const initCam = EDIT.cam?.length
    ? sampleTrack(0)
    : { p: camera.position, l: lookAt, fov: camera.fov };
  camera.position.copy(initCam.p);
  lookAt.copy(initCam.l);
  camera.fov = initCam.fov;
  const initShot = Math.max(0, shotAt(0));
  syncOptics(
    initCam,
    initShot,
    SHOTS_OUT[initShot],
    [...activeAdjustments(EDIT.adjustments, 0)]
      .reverse()
      .find((it) => it.grade?.enabled !== false && it.grade?.look)?.grade?.look,
    false,
  );
  draw.checks = footChecks({ perform, steve, now });
  return draw;
}
