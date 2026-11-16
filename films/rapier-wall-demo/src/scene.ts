// @ts-nocheck
import { configure, createScene, prepareAssets } from "block-model-renderer";
import { unzipSync } from "fflate";
import { animate, ANIMS } from "film-stage/animate";
import { cameraAt, EASES, mmOf, resolveFocusDistance } from "film-stage/camera";
import { makeDof } from "film-stage/dof";
import { blackAt, makeFade } from "film-stage/fade";
import { makeAdjustments, makeLayerAdjustments } from "film-stage/grade";
import { activeAdjustments } from "film-stage/grade-layers";
import { makeTitles } from "film-stage/titles";
import { makeTransitions, viewTime } from "film-stage/transitions";
import { makeVelocity } from "film-stage/velocity";
import { mouthCues } from "live-studio/lips";
import { findTarget } from "live-studio/targets";
import { mulberry32 } from "math/random";
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
import * as THREE from "three";

import { BLAST_ORIGIN, TNT_ORIGIN } from "./breach-layout";
import { EDIT, fromSource } from "./edit";
import { blinkAt, bodyAt, moodAt, readLook, targetAt } from "./steve";
import BREACH from "./timeline/breach.json";
import { buildWorld, ROOM } from "./world";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = 1 / 16;

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

async function buildBlockTemplate(sources, id, properties) {
  const s = await createScene(
    sources,
    [{ id, pos: [0, 0, 0], ...(properties && { properties }) }],
    { lighting: "scene", animate: false },
  );
  if (!s) throw new Error(`block-model-renderer has no block "${id}"`);
  s.group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return s.group;
}

function makeExplosionParticles(scene) {
  const SPARK_COUNT = 160;
  const DUST_COUNT = 130;
  const rng = mulberry32.create(2026);
  const rnd = () => mulberry32.sample(rng);

  const seedPoints = (n) => {
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      const spreadX = (rnd() - 0.5) * 2.2;
      const spreadY = (rnd() - 0.35) * 1.8;
      const speed = 2.8 + rnd() * 6.5;
      vel.push([
        spreadX * speed * 0.55,
        Math.max(-0.4, spreadY * speed * 0.55 + 1.8),
        -(speed * (0.65 + rnd() * 0.7)),
      ]);
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -20;
      pos[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geo, pos, vel };
  };

  const sparksData = seedPoints(SPARK_COUNT);
  const sparksMat = new THREE.PointsMaterial({
    color: 0xffb347,
    size: 0.08,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const sparks = new THREE.Points(sparksData.geo, sparksMat);
  sparks.frustumCulled = false;

  const dustData = seedPoints(DUST_COUNT);
  const dustMat = new THREE.PointsMaterial({
    color: 0x9aa0a6,
    size: 0.24,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustData.geo, dustMat);
  dust.frustumCulled = false;

  const flashBall = new THREE.Group();
  flashBall.position.set(BLAST_ORIGIN[0], BLAST_ORIGIN[1], 5.82);
  const flashCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(12.0, 7.5, 2.2),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const flashPuffs = [
    [-0.95, 0.45, -1.6, 0.16, 8.5, 2.6, 0.25],
    [0.88, 0.52, -1.45, 0.15, 9.0, 3.2, 0.35],
    [-0.62, -0.48, -1.85, 0.14, 6.5, 1.4, 0.12],
    [0.74, -0.42, -1.7, 0.15, 7.2, 1.8, 0.18],
    [0.05, 0.78, -1.9, 0.17, 10.0, 4.0, 0.45],
    [-1.25, 0.12, -1.3, 0.13, 6.0, 1.2, 0.1],
    [1.18, -0.08, -1.4, 0.13, 6.8, 1.6, 0.15],
    [-0.28, 0.92, -1.2, 0.14, 7.5, 2.1, 0.22],
    [0.34, -0.68, -1.5, 0.12, 5.8, 1.1, 0.08],
    [-0.78, 0.72, -1.75, 0.13, 8.0, 2.4, 0.2],
    [0.92, 0.85, -1.25, 0.12, 6.2, 1.3, 0.12],
    [0.08, -0.18, -2.2, 0.16, 11.0, 5.2, 0.8],
  ].map(([vx, vy, vz, s, cr, cg, cb], idx) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(cr, cg, cb),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    m.userData.vel = new THREE.Vector3(vx, vy, vz);
    m.userData.spin = new THREE.Vector3((idx % 3) * 4 + 3, ((idx + 1) % 3) * 5 + 2, ((idx + 2) % 3) * 4 - 5);
    flashBall.add(m);
    return m;
  });
  const flashHalo = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.6, 1.0, 0.25),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  flashBall.add(flashHalo, flashCore);

  scene.add(sparks, dust, flashBall);

  return (t) => {
    const dt = t - BREACH.tBoom;
    if (dt < 0) {
      sparks.visible = dust.visible = flashBall.visible = false;
      return;
    }
    const flashK = Math.max(0, 1 - dt / 0.42);
    flashBall.visible = flashK > 0.01;
    if (flashBall.visible) {
      const coreK = Math.max(0, 1 - dt / 0.24);
      const coreScale = 0.72 + Math.sin(Math.min(1, dt / 0.08) * Math.PI * 0.5) * 0.65;
      flashCore.scale.setScalar(coreScale);
      flashHalo.scale.setScalar(coreScale * 0.85);
      flashCore.material.opacity = Math.pow(coreK, 1.35) * 0.9;
      flashHalo.material.opacity = Math.pow(coreK, 1.5) * 0.22;
      const sparkFade = Math.pow(flashK, 1.15);
      const sparkStep = 0.22 + dt * 4.2;
      for (const p of flashPuffs) {
        p.material.opacity = sparkFade * 0.92;
        p.position.copy(p.userData.vel).multiplyScalar(sparkStep);
        p.rotation.set(p.userData.spin.x * dt, p.userData.spin.y * dt, p.userData.spin.z * dt);
        p.scale.setScalar(Math.max(0.25, 1.15 - dt * 1.8));
      }
    }

    sparks.visible = dt <= 1.25;
    if (sparks.visible) {
      const drag = Math.exp(-dt * 1.6);
      const travel = (1 - drag) / 1.6;
      for (let i = 0; i < SPARK_COUNT; i++) {
        const [vx, vy, vz] = sparksData.vel[i];
        sparksData.pos[i * 3] = 3.5 + (i % 7 - 3) * 0.22 + vx * travel;
        sparksData.pos[i * 3 + 1] = Math.max(0.03, 1.25 + ((i % 5) - 2) * 0.22 + vy * travel - 6.0 * dt * dt);
        sparksData.pos[i * 3 + 2] = 6.2 + vz * travel;
      }
      sparksData.geo.attributes.position.needsUpdate = true;
      sparksMat.opacity = Math.max(0, 1 - dt / 1.1);
    }

    dust.visible = dt <= 3.6;
    if (dust.visible) {
      const drag = Math.exp(-dt * 1.15);
      const travel = (1 - drag) / 1.15;
      for (let i = 0; i < DUST_COUNT; i++) {
        const [vx, vy, vz] = dustData.vel[i];
        dustData.pos[i * 3] = 3.5 + ((i % 9) - 4) * 0.28 + vx * travel * 0.42;
        dustData.pos[i * 3 + 1] = Math.max(0.1, 1.3 + ((i % 6) - 2.5) * 0.25 + vy * travel * 0.28 + dt * 0.12);
        dustData.pos[i * 3 + 2] = 6.0 + vz * travel * 0.45;
      }
      dustData.geo.attributes.position.needsUpdate = true;
      dustMat.opacity = Math.max(0, 0.34 * (1 - dt / 3.6));
    }
  };
}

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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8bc4f5);
  scene.fog = new THREE.FogExp2(0x8bc4f5, 0.012);
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.02, 100);
  scene.add(camera);

  const jarFile = await fetch("mc/client_assets.zip");
  if (!jarFile.ok)
    throw new Error(
      "mc/client_assets.zip is missing: bun run link at the repo root (bun ../../scripts/mc/slim_jar.mjs if the vault lacks it)",
    );
  const jar = new Uint8Array(await jarFile.arrayBuffer());
  const picked = new Uint8Array(await (await fetch("picked.zip")).arrayBuffer());
  const sources = await prepareAssets([pack, picked, jar], { cache: true });
  const world = await createScene(sources, buildWorld(), { lighting: "scene", animate: false, optimize: false });
  world.group.scale.setScalar(S);
  world.group.position.set(0.5, 0.5, 0.5);
  world.group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  scene.add(world.group);

  // Build shared block templates ONCE and instance our 71 pre-baked wall chunks + 2 dynamic barrels + TNT
  const blockTemplates = {
    stone_bricks: await buildBlockTemplate(sources, "stone_bricks"),
    cracked_stone_bricks: await buildBlockTemplate(sources, "cracked_stone_bricks"),
    mossy_stone_bricks: await buildBlockTemplate(sources, "mossy_stone_bricks"),
    barrel: await buildBlockTemplate(sources, "barrel", { facing: "up" }),
  };

  const tntGroup = await buildBlockTemplate(sources, "tnt");
  tntGroup.scale.setScalar(S);
  tntGroup.position.set(...TNT_ORIGIN);
  const tntMats = [];
  tntGroup.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((m) => m.clone());
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
    tntMats.push(...cloned);
  });
  scene.add(tntGroup);

  const breachGroup = new THREE.Group();
  breachGroup.name = "breachBricks";
  const barrelsGroup = new THREE.Group();
  barrelsGroup.name = "barrels";
  scene.add(breachGroup, barrelsGroup);

  const bodyNodes = BREACH.bodies.map((b) => {
    const holder = new THREE.Group();
    holder.name = b.id;
    const mesh = blockTemplates[b.kind].clone(true);
    mesh.scale.setScalar(b.size / 16);
    holder.add(mesh);
    holder.position.set(...b.start);
    (b.role === "brick" ? breachGroup : barrelsGroup).add(holder);
    return { body: b, holder };
  });

  // Scratch vectors/quaternions for zero-GC draw(t) interpolation of pre-baked 30Hz Rapier keyframes
  const pA = V(0, 0, 0),
    pB = V(0, 0, 0);
  const qA = new THREE.Quaternion(),
    qB = new THREE.Quaternion();
  const sampleBreach = (t) => {
    const dt = t - BREACH.tBoom;
    if (dt < 0) {
      const rumble = dt > -0.35 ? Math.sin(t * 75) * 0.01 * (1 + dt / 0.35) : 0;
      for (let i = 0; i < bodyNodes.length; i++) {
        const { body, holder } = bodyNodes[i];
        const jx = body.role === "brick" ? rumble * ((i % 3) - 1) : 0;
        const jz = body.role === "brick" ? rumble * (((i >> 1) % 3) - 1) : 0;
        holder.position.set(body.start[0] + jx, body.start[1], body.start[2] + jz);
        holder.quaternion.identity();
      }
      return;
    }

    const clamped = Math.min(BREACH.duration, dt);
    const f = clamped * BREACH.fps;
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, BREACH.bodies[0].frames.length - 1);
    const alpha = f - i0;

    for (const { body, holder } of bodyNodes) {
      const k0 = body.frames[i0];
      const k1 = body.frames[i1];
      pA.set(k0[0], k0[1], k0[2]);
      pB.set(k1[0], k1[1], k1[2]);
      holder.position.lerpVectors(pA, pB, alpha);
      qA.set(k0[3], k0[4], k0[5], k0[6]);
      qB.set(k1[3], k1[4], k1[5], k1[6]);
      holder.quaternion.slerpQuaternions(qA, qB, alpha);
    }
  };

  const updateParticles = makeExplosionParticles(scene);

  // Steve
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skinUrl = URL.createObjectURL(
    new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }),
  );
  const steve = await makePlayer(await loadRig("rig/player.glb"), skinUrl, { glow: 0.03 });
  URL.revokeObjectURL(skinUrl);
  scene.add(steve.g);
  const placed = await makePlaced(scene, sources, EDIT, "placed");
  const clips = await loadClips(
    EDIT.steve.moves.filter((m) => m.clip).map((m) => m.clip),
    steve,
  );

  // Lighting: moody stone bunker fill, corner lanterns, pulsing TNT warning light, explosion flash & outdoor breach sunbeam
  const C = EDIT.light;
  const hemi = new THREE.HemisphereLight(0xb2cef0, 0x5c4a3a, C.fill);
  const key = new THREE.SpotLight(0xffe1ba, C.key, 18, THREE.MathUtils.degToRad(62), 0.78, 1.1);
  key.position.set(ROOM.x1 / 2 + 0.5, ROOM.top + 0.35, ROOM.z1 / 2 - 0.1);
  key.target.position.set(ROOM.x1 / 2 + 0.5, 0.1, ROOM.z1 / 2 + 0.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2.5;
  const fillLeft = new THREE.PointLight(0xffb56b, 4.2, 9, 1.4);
  fillLeft.position.set(1.2, 2.5, 1.8);
  const fillRight = new THREE.PointLight(0xffb56b, 4.8, 9, 1.4);
  fillRight.position.set(5.4, 2.5, 4.2);

  const tntLight = new THREE.PointLight(0xff3b1f, 0, 8, 1.4);
  tntLight.position.set(3.5, 1.35, 6.2);

  const boomLight = new THREE.PointLight(0xffaa44, 0, 14, 1.2);
  boomLight.position.set(3.5, 1.4, 5.7);

  const breachSun = new THREE.SpotLight(0xc2e2ff, 0, 24, THREE.MathUtils.degToRad(44), 0.55, 1.0);
  breachSun.position.set(3.5, 3.5, 12.2);
  breachSun.target.position.set(3.5, 0.3, 2.8);
  breachSun.castShadow = true;
  breachSun.shadow.mapSize.set(2048, 2048);
  breachSun.shadow.bias = -0.0004;
  breachSun.shadow.normalBias = 0.03;
  const courtyardFill = new THREE.PointLight(0xbbe0ff, 26, 18, 0.9);
  courtyardFill.position.set(3.5, 4.2, 9.8);

  scene.add(hemi, key, key.target, fillLeft, fillRight, tntLight, boomLight, breachSun, breachSun.target, courtyardFill);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 4,
  });
  const fade = makeFade(renderer);
  const titles = makeTitles(renderer, W, H, { items: EDIT.text.items });
  const anims = ANIMS;
  await titles.ready;
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, W, H);
  Object.assign(ao.configuration, {
    aoRadius: 1.0,
    distanceFalloff: 1.0,
    intensity: 2.0,
    halfRes: draft,
  });
  ao.outputTargetInternal.texture.type = THREE.HalfFloatType;
  composer.addPass(ao);
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  const dof = makeDof(composer, camera, { draft });
  const tone = new HueSaturationEffect({ saturation: EDIT.look.saturation });
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.85, mipmapBlur: true }),
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

  const free = { on: false, p: V(0, 0, 0), l: V(0, 0, 0), fov: 60 };
  const lookAt = V(0, 0, 0),
    head = V(0, 0, 0);
  const velocityEffect = makeVelocity(renderer);
  const opticsTelemetry = {};
  const sceneObjects = [
    [world.group, "room"],
    [breachGroup, "breachBricks"],
    [barrelsGroup, "barrels"],
    [tntGroup, "tnt"],
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
    const resolvedFocus = bypass
      ? {}
      : resolveFocusDistance(cam.focus, camera.position, resolveFocusTarget);
    const fallbackFocus = Math.max(0.05, camera.position.distanceTo(lookAt));
    const rawFocusM = resolvedFocus.distance ?? (effectiveFstop > 0 ? fallbackFocus : undefined);
    const focusM = rawFocusM !== undefined ? Math.max(0.05, rawFocusM) : undefined;
    const renderedMm = Math.round(mmOf(camera.fov, W / H) * 10) / 10;
    Object.assign(opticsTelemetry, {
      shot,
      shotName: [shotEntry?.size, shotEntry?.what ?? shotEntry?.name].filter(Boolean).join(" · "),
      mm: renderedMm,
      fov: Math.round(camera.fov * 10) / 10,
      fstop: effectiveFstop !== undefined ? Math.round(effectiveFstop * 10) / 10 : undefined,
      focusM: focusM !== undefined ? Math.round(focusM * 100) / 100 : undefined,
      focusTarget: resolvedFocus.label,
      handheld: bypass ? undefined : cam.handheld,
      look: bypass
        ? undefined
        : (activeLayerLook ??
          (shotEntry?.adjust?.enabled !== false ? shotEntry?.adjust?.look : undefined)),
      impulse: bypass ? undefined : cam.optics?.impulse,
    });
    return { effectiveFstop, focusM, fallbackFocus, renderedMm };
  };
  let clocks;
  const frame = (t, view) => {
    const cameraTime = view === undefined ? t : viewTime(SHOTS_OUT, DURATION, view, t);
    const cam = cameraAt(cameraTime, EDIT.cam, { aspect: W / H });
    const animBlack = animate(cam, cameraTime, SHOTS_OUT, DURATION, anims);
    camera.position.copy(cam.p);
    lookAt.copy(cam.l);
    camera.fov = cam.fov;
    if (free.on) {
      camera.fov = free.fov;
      camera.position.copy(free.p);
      lookAt.copy(free.l);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(lookAt);
    if (!free.on) camera.rotateZ(cam.roll);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    head.copy(camera.position);
    Object.assign(now, { cam });

    // Pre-baked Rapier physics + TNT blink + explosion light/particles (pure function of t)
    sampleBreach(t);
    updateParticles(t);
    const beforeBoom = t < BREACH.tBoom;
    tntGroup.visible = beforeBoom;
    if (beforeBoom) {
      const rem = BREACH.tBoom - t;
      const freq = rem < 0.7 ? 14 : 6;
      const blink = Math.sin(t * Math.PI * freq) > 0 ? 1 : 0;
      const swell = rem < 0.35 ? 1 + 0.16 * (1 - rem / 0.35) : 1;
      tntGroup.scale.setScalar(S * swell);
      for (const m of tntMats) {
        m.emissive?.setHex(blink ? 0xffffff : 0x661200);
        m.emissiveIntensity = blink ? 0.95 : 0.25;
      }
      tntLight.intensity = blink ? 7.5 : 1.5;
      boomLight.intensity = 0;
      breachSun.intensity = 0;
    } else {
      tntLight.intensity = 0;
      boomLight.intensity = 65 * Math.exp(-(t - BREACH.tBoom) * 9.5);
      breachSun.intensity = 78 * Math.min(1, (t - BREACH.tBoom) / 0.28);
    }

    perform(t);
    placed.draw(t);
    scene.updateMatrixWorld();
    const mood = moodAt(EDIT.steve.face, t);
    const mouth = mouthAt(mouthCues(EDIT, "steve"), t);
    steve.face(mood, mouth, blinkAt(t, 0), readLook(EDIT.steve.read, t) ?? [0, -0.15]);
    now.mood = mood;

    hemi.intensity = EDIT.light.fill;
    key.intensity = EDIT.light.key;
    tone.saturation = EDIT.look.saturation;
    const shot = Math.max(0, view ?? shotAt(t));
    const shotEntry = SHOTS_OUT[shot];
    const adjAt = clocks?.adjustments ?? clocks?.layers ?? t;
    const adjVisible = clocks?.adjustmentsVisible ?? clocks?.layersVisible ?? true;
    const activeLayerLook =
      !free.on && adjVisible
        ? [...activeAdjustments(EDIT.adjustments, adjAt, clocks?.adjustmentTime)]
            .reverse()
            .find((it) => it.grade?.enabled !== false && it.grade?.look)?.grade?.look
        : undefined;
    const { effectiveFstop, focusM, fallbackFocus, renderedMm } = syncOptics(
      cam,
      shot,
      shotEntry,
      activeLayerLook,
      free.on,
    );
    Object.assign(now, { optics: opticsTelemetry });
    renderer.clear();
    if (clocks?.pictureVisible !== false || free.on) {
      dof.update({
        fstop: effectiveFstop,
        focusDistance: focusM ?? fallbackFocus,
        mm: renderedMm,
        widthPx: W,
      });
      adjust(shot, shotEntry?.adjust, t, free.on);
      composer.render(0);
      if (!free.on) velocityEffect(clocks?.velocity ?? null, cam.optics);
      if (!free.on) fade(Math.max(blackAt(EDIT.fx.black, t), animBlack));
    }
    if (!free.on && clocks?.layersVisible !== false)
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
        free.on,
      );
    },
    (cut) => clocks?.transitionVisible?.(cut) ?? true,
  );
  const draw = Object.assign((t, nextClocks) => {
    clocks = nextClocks;
    composite(t);
  }, composite);
  draw.velocity = true;
  draw.velocityEffects = velocityEffect.effects;
  draw.rapierDemo = [
    {
      id: "rapier-prebake",
      title: "Rapier 3D Pre-Bake",
      tip: "71 stone chunks + 2 wooden barrels simulated @ 120Hz -> 30Hz breach.json",
    },
  ];
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
            text: `${m.do ?? ""} · ${m.clip ? `mocap ${m.clip}` : `pose ${m.pose} (src/steve.ts)`}`,
            fresh: t - m.t < 1 && t >= m.t,
          },
        ],
      },
      {
        head: "PHYSICS",
        lines: [
          {
            text:
              t < BREACH.tBoom
                ? `pre-blast locked (${BREACH.bodies.length} bodies queued)`
                : `rapier pre-baked ${(t - BREACH.tBoom).toFixed(2)}s post-blast (breach.json)`,
          },
        ],
      },
    ];
  };
  draw.tools = {
    titles,
    clips,
    scene,
    camera,
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
  draw.eases = EASES;
  draw.keyEases = [{ edit: "steve", path: ["moves"], names: Object.keys(EASES) }];
  draw.anims = anims;
  draw.adjustments = {
    prepare: (grades) => Promise.all([adjust.prepare(grades), layerAdjust.prepare(grades)]),
  };
  const initCam = EDIT.cam?.length
    ? cameraAt(0, EDIT.cam, { aspect: W / H })
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
