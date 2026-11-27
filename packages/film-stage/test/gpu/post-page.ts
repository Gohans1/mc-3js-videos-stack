import { BlendFunction, Effect, EffectPass } from "postprocessing";
import * as THREE from "three";

import { DitherEffect } from "../../src/grade";
import { createOutlineHighlight } from "../../src/highlight";
import {
  applySetLight,
  bakeSceneProbe,
  createAreaLight,
  createEnvironment,
  createLightingRig,
  createSkyEnvironment,
  DEFAULT_LIGHTS,
} from "../../src/lights";
import { createParticleEmitter, createParticleField } from "../../src/particles";
import {
  createFilmRenderer,
  createPostPipeline,
  createScreenEffect,
  type LookdevProfileId,
  type PostPipelineOptions,
  type ScreenEffectPresetId,
} from "../../src/post";
import {
  createCelestialDisc,
  createCloudLayer,
  createSkyDome,
  createStarfield,
  createStudioBackdrop,
} from "../../src/sky";
import {
  createCausticsPlane,
  createFlame,
  createHazeLayer,
  createVolumetricBeam,
  createWaterSurface,
  createWetGround,
  createXRayMaterial,
} from "../../src/surfaces";

const W = 320;
const H = 180;

class TopMaskEffect extends Effect {
  constructor() {
    super(
      "TopMaskEffect",
      `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = uv.y > 0.72 ? vec4(0.0, 0.0, 0.0, inputColor.a) : inputColor;
      }`,
      { blendFunction: BlendFunction.SRC },
    );
  }
}

function readRgb(renderer: THREE.WebGLRenderer, w: number, h: number): string {
  const gl = renderer.getContext();
  const rgba = new Uint8Array(w * h * 4);
  const rgb = new Uint8Array(w * h * 3);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((h - 1 - y) * w + x) * 4;
      rgb.set(rgba.subarray(from, from + 3), (y * w + x) * 3);
    }
  }
  let s = "";
  for (let i = 0; i < rgb.length; i += 0x8000) {
    s += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function drainGlErrors(renderer: THREE.WebGLRenderer): number[] {
  const gl = renderer.getContext();
  const errs: number[] = [];
  let e = gl.getError();
  while (e !== gl.NO_ERROR && errs.length < 16) {
    errs.push(e);
    e = gl.getError();
  }
  return errs;
}

function buildTestScene(blackBg = false) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(blackBg ? 0x000000 : 0x3b4856);

  const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
  key.position.set(4, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const hemi = new THREE.HemisphereLight(0xdce8f8, 0x3a322c, 0.9);
  scene.add(key, hemi);

  const floorGeo = new THREE.PlaneGeometry(8, 8);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  const backWallGeo = new THREE.PlaneGeometry(8, 4);
  const backWallMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.85 });
  const backWall = new THREE.Mesh(backWallGeo, backWallMat);
  backWall.position.set(0, 2, -1.6);
  backWall.receiveShadow = true;

  const boxGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d6, roughness: 0.7 });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.position.set(0, 0.7, -0.8);
  box.castShadow = true;
  box.receiveShadow = true;

  const glowGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(5, 3, 1),
    toneMapped: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(1.5, 1.1, -0.4);

  scene.add(floor, backWall, box, glow);
  const disposeScene = () => {
    key.shadow.map?.dispose();
    floorGeo.dispose();
    floorMat.dispose();
    backWallGeo.dispose();
    backWallMat.dispose();
    boxGeo.dispose();
    boxMat.dispose();
    glowGeo.dispose();
    glowMat.dispose();
    scene.clear();
  };
  return { scene, key, disposeScene };
}

function makeCanvas(w = W, h = H): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

const sharedRenderer = createFilmRenderer(makeCanvas(), W, H, { pixelRatio: 1 });

Object.assign(window, {
  verifyRendererDefaults() {
    const canvas = makeCanvas();
    const renderer = createFilmRenderer(canvas, W, H, { pixelRatio: 1 });
    const size = renderer.getSize(new THREE.Vector2());
    const result = {
      shadowEnabled: renderer.shadowMap.enabled,
      isPcfShadow: renderer.shadowMap.type === THREE.PCFShadowMap,
      isNotPcfSoft: renderer.shadowMap.type !== THREE.PCFSoftShadowMap,
      localClipping: renderer.localClippingEnabled,
      isNoToneMapping: renderer.toneMapping === THREE.NoToneMapping,
      w: size.x,
      h: size.y,
      glErrors: drainGlErrors(renderer),
    };
    renderer.dispose();
    return result;
  },

  renderProfile(opts: {
    profile?: LookdevProfileId;
    blackBg?: boolean;
    aoEnabled?: boolean;
    withAfterToneMap?: boolean;
    withGodrays?: boolean;
    draft?: boolean;
    width?: number;
    height?: number;
  }) {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, key, disposeScene } = buildTestScene(opts.blackBg);
    if (opts.blackBg) {
      scene.clear();
      scene.background = new THREE.Color(0x000000);
    }
    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.6, 3.6);
    cam.lookAt(0, 0.7, -0.8);
    cam.updateMatrixWorld();

    const pipelineOpts: PostPipelineOptions = {
      profile: opts.profile,
      draft: opts.draft ?? true,
      width: opts.width,
      height: opts.height,
      godraysLight: opts.withGodrays ? key : undefined,
      afterToneMap: opts.withAfterToneMap ? [new TopMaskEffect()] : undefined,
    };
    const pipeline = createPostPipeline(renderer, scene, cam, pipelineOpts);
    pipeline.render(cam, { aoEnabled: opts.aoEnabled ?? true });

    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);
    const info = {
      w: W,
      h: H,
      rgb,
      glErrors,
      bufferW: pipeline.composer.inputBuffer.width,
      bufferH: pipeline.composer.inputBuffer.height,
      hasAo: pipeline.ao !== null,
      aoEnabled: pipeline.ao?.enabled ?? false,
      hasBloom: pipeline.bloom !== null,
      hasVignette: pipeline.vignette !== null,
      hasDof: pipeline.dof !== null,
      hasGodrays: pipeline.godrays?.supported ?? false,
      aoHalfFloat: pipeline.ao?.outputTargetInternal.texture.type === THREE.HalfFloatType,
      profile: pipeline.config.profile,
    };
    pipeline.dispose();
    pipeline.dispose();
    disposeScene();
    return info;
  },

  testOrthoAndAoToggle() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, key, disposeScene } = buildTestScene(false);
    const persp = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    persp.position.set(0, 1.4, 3.2);
    persp.lookAt(0, 0.6, -0.8);
    persp.updateMatrixWorld();

    const aspect = W / H;
    const ortho = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 50);
    ortho.position.set(0, 1.4, 3.2);
    ortho.lookAt(0, 0.6, -0.8);
    ortho.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, persp, {
      profile: "cinematic",
      draft: true,
      godraysLight: key,
    });
    const passesBefore = pipeline.composer.passes.length;
    const perspAoRef = pipeline.ao!;

    const activeGodrays = {
      ...DEFAULT_LIGHTS.godrays,
      enabled: true,
      weight: 0.55,
      density: 0.02,
      raymarchSteps: 16,
    };
    pipeline.godrays!.update(activeGodrays);
    const godraysBeforeOrtho = pipeline.godrays!.pass!.enabled;

    pipeline.render(persp, { aoEnabled: true });
    const rgbAoOn = readRgb(renderer, W, H);
    const perspAoOn = perspAoRef.enabled;

    pipeline.render(persp, { aoEnabled: false });
    const rgbAoOff = readRgb(renderer, W, H);
    const perspAoOff = perspAoRef.enabled;

    pipeline.render(ortho, { aoEnabled: true });
    const passesAfterOrtho = pipeline.composer.passes.length;
    const perspAoDuringOrtho = perspAoRef.enabled;
    const activeAoDuringOrthoIsDifferent = pipeline.ao !== perspAoRef && pipeline.ao!.enabled;
    const godraysDuringOrtho = pipeline.godrays!.pass!.enabled;
    pipeline.godrays!.update(activeGodrays);
    const godraysAfterOrthoUpdate = pipeline.godrays!.pass!.enabled;
    const rgbOrtho = readRgb(renderer, W, H);

    pipeline.render(persp, { aoEnabled: true });
    const perspAoRestored = pipeline.ao === perspAoRef && perspAoRef.enabled;
    const godraysRestored = pipeline.godrays!.pass!.enabled;

    pipeline.setSize(160, 90);
    pipeline.render(persp, { aoEnabled: true });
    const glErrors = drainGlErrors(renderer);

    pipeline.dispose();
    pipeline.dispose();
    disposeScene();
    const disposeGlErrors = drainGlErrors(renderer);
    renderer.setSize(W, H, false);

    return {
      w: W,
      h: H,
      passesBefore,
      passesAfterOrtho,
      perspAoOn,
      perspAoOff,
      perspAoDuringOrtho,
      activeAoDuringOrthoIsDifferent,
      perspAoRestored,
      godraysBeforeOrtho,
      godraysDuringOrtho,
      godraysAfterOrthoUpdate,
      godraysRestored,
      rgbAoOn,
      rgbAoOff,
      rgbOrtho,
      glErrors,
      disposeGlErrors,
    };
  },

  testAdjustAndDitherCoordination() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, disposeScene } = buildTestScene(false);
    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.6, 3.6);
    cam.lookAt(0, 0.7, -0.8);
    cam.updateMatrixWorld();

    const mask = new TopMaskEffect();
    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "explainer-clean",
      draft: true,
      afterToneMap: [mask],
    });

    const findPostDither = (): { passIndex: number; effectIndex: number; dither: DitherEffect } => {
      for (let i = 0; i < pipeline.composer.passes.length; i++) {
        const pass = pipeline.composer.passes[i];
        if (!(pass instanceof EffectPass)) continue;
        const effects = (pass as unknown as { effects: Effect[] }).effects;
        const idx = effects.findIndex((e) => e instanceof DitherEffect);
        if (idx >= 0) {
          return { passIndex: i, effectIndex: idx, dither: effects[idx] as DitherEffect };
        }
      }
      throw new Error("DitherEffect not found in composer passes");
    };

    const found = findPostDither();
    const maskEffectIdx = (
      pipeline.composer.passes[found.passIndex] as unknown as { effects: Effect[] }
    ).effects.indexOf(mask);
    const ditherAfterMask = found.effectIndex > maskEffectIdx;
    const ditherBeforeAdjust = found.dither.amount;

    pipeline.adjust(0, { basic: { sharpen: 40, contrast: 15, dither: 30 } }, 0.5, false);
    const adjustActive = pipeline.adjust.isActive();
    const ditherWhenAdjustActive = found.dither.amount;
    pipeline.render(cam);

    pipeline.adjust(0, {}, 0.5, true);
    const adjustInactive = pipeline.adjust.isActive();
    const ditherWhenAdjustBypassed = found.dither.amount;
    pipeline.render(cam);

    const glErrors = drainGlErrors(renderer);
    const rgb = readRgb(renderer, W, H);
    pipeline.dispose();
    disposeScene();

    return {
      w: W,
      h: H,
      rgb,
      glErrors,
      ditherAfterMask,
      ditherBeforeAdjust,
      adjustActive,
      ditherWhenAdjustActive,
      adjustInactive,
      ditherWhenAdjustBypassed,
    };
  },

  testScreenEffects() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, disposeScene } = buildTestScene(false);
    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.6, 3.6);
    cam.lookAt(0, 0.7, -0.8);
    cam.updateMatrixWorld();

    const out: Record<string, { rgbA: string; rgbB: string; glErrors: number[] }> = {};
    for (const preset of ["cctv", "vhs-crt", "night-vision", "thermal"] as ScreenEffectPresetId[]) {
      const fx = createScreenEffect(preset);
      const pipeline = createPostPipeline(renderer, scene, cam, {
        profile: "explainer-clean",
        draft: true,
        afterToneMap: [fx.effect],
      });
      fx.update(2.25);
      pipeline.render(cam);
      const rgbA = readRgb(renderer, W, H);
      fx.update(7.0);
      pipeline.render(cam);
      fx.update(2.25);
      pipeline.render(cam);
      const rgbB = readRgb(renderer, W, H);
      const glErrors = drainGlErrors(renderer);
      pipeline.dispose();
      fx.dispose();
      out[preset] = { rgbA, rgbB, glErrors };
    }
    disposeScene();
    return { w: W, h: H, presets: out };
  },

  testIntegratedLookdevStack() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();

    const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 200);
    cam.position.set(0, 3.2, 9);
    cam.lookAt(0, 1.0, 0);
    cam.updateMatrixWorld();

    const backdrop = createStudioBackdrop({ preset: "explainer-cyan", aspect: W / H });
    scene.add(backdrop.mesh);

    const sky = createSkyDome({ preset: "daylight", radius: 80 });
    sky.follow(cam);
    scene.add(sky.mesh);

    const sun = createCelestialDisc({ kind: "sun", shape: "round", distance: 65 });
    sun.follow(cam);
    scene.add(sun.mesh);

    const stars = createStarfield({ count: 120, radius: 72 });
    stars.follow(cam);
    stars.update(1.5);
    scene.add(stars.points);

    const clouds = createCloudLayer({ altitude: 24, cell: 4, gridSize: 16, seed: 7 });
    clouds.follow(cam);
    clouds.update(2.5);
    scene.add(clouds.mesh);

    const water = createWaterSurface({ preset: "ocean", size: 60, y: 0, textureSize: 64 });
    water.update(1.5);
    scene.add(water.mesh);

    const wetGround = createWetGround({ width: 6, depth: 6, res: 64, y: 0.03 });
    wetGround.mesh.position.set(-4, 0.03, 2);
    scene.add(wetGround.mesh);

    const haze = createHazeLayer({ span: 40, count: 8, layers: 1, textureSize: 32, y: 2 });
    haze.follow(cam);
    scene.add(haze.group);

    const caustics = createCausticsPlane({ size: 20, y: 0.04 });
    caustics.update(1.5);
    scene.add(caustics.mesh);

    const beam = createVolumetricBeam({
      length: 6,
      radius: 1.5,
      color: "#fff4dc",
      intensity: 0.9,
    });
    beam.mesh.position.set(-2.5, 5, 0);
    scene.add(beam.mesh);

    const xrayMat = createXRayMaterial({ preset: "xray-cyan", pulse: 0.3 });
    xrayMat.update(1.5);
    const xrayMesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), xrayMat);
    xrayMesh.position.set(2.4, 1.4, 1.0);
    scene.add(xrayMesh);

    const particles = createParticleField({
      preset: "dust-motes",
      count: 64,
      bounds: [10, 6, 10],
      textureSize: 32,
    });
    particles.follow(cam);
    particles.update(1.5);
    scene.add(particles.mesh);

    const emitter = createParticleEmitter({
      preset: "sparks",
      origin: [0, 1.5, 0],
      triggerAt: 1.0,
      count: 24,
      textureSize: 32,
    });
    emitter.update(1.25);
    scene.add(emitter.mesh);

    const flame = createFlame({ preset: "campfire", width: 0.9, height: 1.6 });
    flame.mesh.position.set(1.8, 0.8, 1.2);
    flame.update(1.5);
    scene.add(flame.mesh);

    const rig = createLightingRig(scene, {
      target: [0, 1, 0],
      shadowExtent: 12,
      shadowMapSize: 512,
    });
    const areaLight = createAreaLight({
      color: 0xfff0d4,
      intensity: 4,
      width: 3,
      height: 2,
      at: [0, 3.5, 4],
      lookAt: [0, 1, 0],
    });
    scene.add(areaLight);

    const island = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xc2b294, roughness: 0.7, metalness: 0.1 }),
    );
    island.position.set(0, 0.7, 0);
    island.castShadow = true;
    island.receiveShadow = true;
    scene.add(island);

    const outline = createOutlineHighlight(island, { mode: "outline", color: "#ffdd55" });
    outline.set(0.8);

    const skyEnv = createSkyEnvironment(renderer, { preset: "daylight" });
    const probe = bakeSceneProbe(renderer, scene, { position: [0, 2, 0], size: 64 });
    applySetLight(
      rig,
      {
        key: { color: "#fff4de", intensity: 2.6, azimuth: 35, elevation: 42, castShadow: true },
        hemi: { sky: "#9cc4f0", ground: "#364452", intensity: 0.7 },
        rim: { color: "#d8ebff", intensity: 0.9, mode: "camera-back" },
        environment: probe.texture,
        environmentIntensity: 0.65,
      },
      [0, 1, 0],
      cam.position,
    );

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "outdoor-natural",
      draft: true,
    });
    pipeline.render(cam);

    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);
    const hasProbeTexture = scene.environment === probe.texture && skyEnv.texture !== null;

    pipeline.dispose();
    rig.dispose();
    probe.dispose();
    skyEnv.dispose();
    outline.dispose();
    flame.dispose();
    emitter.dispose();
    particles.dispose();
    xrayMesh.geometry.dispose();
    xrayMat.dispose();
    beam.dispose();
    caustics.dispose();
    haze.dispose();
    wetGround.dispose();
    water.dispose();
    clouds.dispose();
    stars.dispose();
    sun.dispose();
    sky.dispose();
    backdrop.dispose();
    island.geometry.dispose();
    (island.material as THREE.Material).dispose();
    const disposeGlErrors = drainGlErrors(renderer);

    return { w: W, h: H, rgb, glErrors, disposeGlErrors, hasProbeTexture };
  },

  testN8aoPreservedBehindAdditiveQuads() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, disposeScene } = buildTestScene(false);
    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.3, 3.0);
    cam.lookAt(0, 0.5, -0.8);
    cam.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "cinematic",
      ao: { aoRadius: 0.9, distanceFalloff: 1.0, intensity: 2.8 },
      draft: true,
    });

    pipeline.render(cam, { aoEnabled: true });
    const rgbAoOn = readRgb(renderer, W, H);

    pipeline.render(cam, { aoEnabled: false });
    const rgbAoOff = readRgb(renderer, W, H);

    const flame = createFlame({ preset: "torch", width: 2.6, height: 2.6, intensity: 1.2 });
    flame.mesh.position.set(1.3, 0.9, 0.2);
    flame.update(1.2);
    scene.add(flame.mesh);

    const beam = createVolumetricBeam({
      length: 4.5,
      topRadius: 0.2,
      bottomRadius: 2.2,
      intensity: 0.8,
      opacity: 0.4,
    });
    beam.mesh.position.set(1.6, 3.2, 0.3);
    scene.add(beam.mesh);

    pipeline.render(cam, { aoEnabled: true });
    const rgbWithAdditive = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);

    flame.dispose();
    beam.dispose();
    pipeline.dispose();
    disposeScene();

    return { w: W, h: H, rgbAoOn, rgbAoOff, rgbWithAdditive, glErrors };
  },

  testOutlinePartialAndSkinnedMesh() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f2f2);

    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(3, 5, 4);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 1.0);
    scene.add(key, hemi);

    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.0, 4.2);
    cam.lookAt(0, 0.6, 0);
    cam.updateMatrixWorld();

    const group = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(-0.9, 0.6, 0);
    group.add(box);

    const cylGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.4, 12, 4);
    const pos = cylGeo.attributes.position;
    const skinIndices = new Uint16Array(pos.count * 4);
    const skinWeights = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.min(1, Math.max(0, (y + 0.7) / 1.4));
      skinIndices[i * 4] = 0;
      skinIndices[i * 4 + 1] = 1;
      skinWeights[i * 4] = 1 - t;
      skinWeights[i * 4 + 1] = t;
    }
    cylGeo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    cylGeo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

    const rootBone = new THREE.Bone();
    const tipBone = new THREE.Bone();
    tipBone.position.set(0, 0.7, 0);
    tipBone.rotation.z = 0.25;
    rootBone.add(tipBone);
    const skeleton = new THREE.Skeleton([rootBone, tipBone]);
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xccd8e8, roughness: 0.5 });
    const skinned = new THREE.SkinnedMesh(cylGeo, skinMat);
    skinned.position.set(0.9, 0.6, 0);
    skinned.add(rootBone);
    skinned.bind(skeleton);
    group.add(skinned);
    scene.add(group);

    const outline = createOutlineHighlight(group, {
      mode: "outline",
      color: "#ffdd55",
      thickness: 0.08,
      intensity: 1.5,
      opacity: 1,
    });

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "explainer-clean",
      draft: true,
    });

    outline.set(0);
    pipeline.render(cam);
    const rgbOff = readRgb(renderer, W, H);

    outline.set(0.3);
    pipeline.render(cam);
    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);
    const count = outline.count;

    outline.dispose();
    pipeline.dispose();
    boxGeo.dispose();
    boxMat.dispose();
    cylGeo.dispose();
    skinMat.dispose();
    skeleton.dispose();
    scene.clear();

    return { w: W, h: H, rgbOff, rgb, glErrors, count };
  },

  testNoDoubleDitherPureBlack() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1, 3);
    cam.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "cinematic",
      draft: true,
    });
    const tail = pipeline.composer.passes.at(-1) as EffectPass;
    pipeline.adjust(0, {}, 0.5, true);
    const tailDithering = tail.dithering;
    const adjustActive = pipeline.adjust.isActive();
    pipeline.render(cam);

    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);
    pipeline.dispose();

    return { w: W, h: H, rgb, glErrors, tailDithering, adjustActive };
  },

  testGodraysPerspectiveSwitch() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, key, disposeScene } = buildTestScene(false);

    const perspA = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    perspA.position.set(0, 1.6, 3.6);
    perspA.lookAt(0, 0.7, -0.8);
    perspA.updateMatrixWorld();

    const perspB = new THREE.PerspectiveCamera(38, W / H, 0.5, 250);
    perspB.position.set(-1.4, 2.0, 4.2);
    perspB.lookAt(0, 0.7, -0.8);
    perspB.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, perspA, {
      profile: "cinematic",
      draft: true,
      godraysLight: key,
    });
    pipeline.godrays!.update({
      ...DEFAULT_LIGHTS.godrays,
      enabled: true,
      weight: 0.6,
      density: 0.02,
      raymarchSteps: 16,
    });
    pipeline.render(perspA);
    pipeline.render(perspB);

    const internal = pipeline.godrays!.pass as unknown as {
      props: { camera: THREE.PerspectiveCamera };
      compositorPass: {
        sceneCamera: THREE.PerspectiveCamera;
        fullscreenMaterial: { uniforms: { near: { value: number }; far: { value: number } } };
      };
      illumPass: {
        material: { uniforms: { near: { value: number }; far: { value: number } } };
      };
    };

    const result = {
      enabled: pipeline.godrays!.pass!.enabled,
      propsMatchB: internal.props.camera === perspB,
      compMatchB: internal.compositorPass.sceneCamera === perspB,
      compNear: internal.compositorPass.fullscreenMaterial.uniforms.near.value,
      compFar: internal.compositorPass.fullscreenMaterial.uniforms.far.value,
      illumNear: internal.illumPass.material.uniforms.near.value,
      illumFar: internal.illumPass.material.uniforms.far.value,
      glErrors: drainGlErrors(renderer),
    };

    pipeline.dispose();
    disposeScene();
    return result;
  },

  testSkyEnvironmentSpecular() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const skyEnv = createSkyEnvironment(renderer, { preset: "daylight" });
    scene.environment = skyEnv.texture;
    scene.environmentIntensity = 1.0;

    const sphereGeo = new THREE.SphereGeometry(1.1, 24, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.12,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);

    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 0.2, 3.2);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "outdoor-natural",
      draft: true,
    });
    pipeline.render(cam);

    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);

    pipeline.dispose();
    skyEnv.dispose();
    sphereGeo.dispose();
    sphereMat.dispose();
    scene.clear();
    const disposeGlErrors = drainGlErrors(renderer);

    return { w: W, h: H, rgb, glErrors, disposeGlErrors };
  },

  testProductionOrthoWithFog() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, disposeScene } = buildTestScene(false);
    scene.fog = new THREE.Fog(0x3b4856, 2, 14);

    const aspect = W / H;
    const ortho = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 50);
    ortho.position.set(0, 1.4, 3.2);
    ortho.lookAt(0, 0.6, -0.8);
    ortho.updateMatrixWorld();

    const persp = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    persp.position.set(0, 1.4, 3.2);
    persp.lookAt(0, 0.6, -0.8);
    persp.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, ortho, {
      profile: "cinematic",
      ao: { aoRadius: 0.9, distanceFalloff: 1.0, intensity: 2.6 },
      draft: false,
    });

    const initialAoPresent = pipeline.ao !== null;
    pipeline.render(ortho, { aoEnabled: true });
    const rgbOrthoOn = readRgb(renderer, W, H);

    pipeline.render(ortho, { aoEnabled: false });
    const rgbOrthoOff = readRgb(renderer, W, H);

    pipeline.render(persp, { aoEnabled: true });
    const rgbPerspOn = readRgb(renderer, W, H);

    pipeline.render(persp, { aoEnabled: false });
    const rgbPerspOff = readRgb(renderer, W, H);

    const glErrors = drainGlErrors(renderer);
    pipeline.dispose();
    disposeScene();

    return {
      w: W,
      h: H,
      initialAoPresent,
      rgbOrthoOn,
      rgbOrthoOff,
      rgbPerspOn,
      rgbPerspOff,
      glErrors,
    };
  },

  testXrayClippingAndMultiConv() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 0.8, 3.4);
    cam.lookAt(0, 0.8, 0);
    cam.updateMatrixWorld();

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.8);
    const xrayMat = createXRayMaterial({
      preset: "xray-cyan",
      intensity: 2.0,
      clippingPlanes: [clipPlane],
    });
    const sphereGeo = new THREE.SphereGeometry(0.85, 24, 16);
    const sphere = new THREE.Mesh(sphereGeo, xrayMat);
    sphere.position.set(0, 0.8, 0);
    scene.add(sphere);

    const vhs1 = createScreenEffect("vhs-crt", { intensity: 0.25, grain: 0, tracking: 0 });
    const vhs2 = createScreenEffect("vhs-crt", { intensity: 0.25, grain: 0, tracking: 0 });
    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "explainer-clean",
      dither: 0,
      draft: true,
      afterToneMap: [vhs1.effect, vhs2.effect],
    });

    const tail = pipeline.composer.passes.at(-1) as EffectPass;
    pipeline.adjust(0, {}, 0.5, true);
    const ditherZeroTailFlag = tail.dithering;
    pipeline.render(cam);

    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);

    pipeline.dispose();
    vhs1.dispose();
    vhs2.dispose();
    sphereGeo.dispose();
    xrayMat.dispose();
    scene.clear();

    return { w: W, h: H, rgb, glErrors, ditherZeroTailFlag };
  },

  testHiDpiN8ao() {
    const cssW = 160;
    const cssH = 90;
    const physW = cssW * 2;
    const physH = cssH * 2;
    const canvas = makeCanvas(physW, physH);
    const renderer = createFilmRenderer(canvas, cssW, cssH, { pixelRatio: 2 });
    const { scene, disposeScene } = buildTestScene(false);

    const persp = new THREE.PerspectiveCamera(45, cssW / cssH, 0.1, 50);
    persp.position.set(0, 1.4, 3.2);
    persp.lookAt(0, 0.6, -0.8);
    persp.updateMatrixWorld();

    const aspect = cssW / cssH;
    const ortho = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 50);
    ortho.position.set(0, 1.4, 3.2);
    ortho.lookAt(0, 0.6, -0.8);
    ortho.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, persp, {
      profile: "cinematic",
      ao: { aoRadius: 0.9, distanceFalloff: 1.0, intensity: 2.6 },
      draft: true,
    });

    const perspAoW = pipeline.ao!.width;
    const perspAoH = pipeline.ao!.height;

    pipeline.render(persp, { aoEnabled: true });
    const rgbPerspOn = readRgb(renderer, physW, physH);
    pipeline.render(persp, { aoEnabled: false });
    const rgbPerspOff = readRgb(renderer, physW, physH);

    pipeline.render(ortho, { aoEnabled: true });
    const orthoAoW = pipeline.ao!.width;
    const orthoAoH = pipeline.ao!.height;
    const rgbOrthoOn = readRgb(renderer, physW, physH);
    pipeline.render(ortho, { aoEnabled: false });
    const rgbOrthoOff = readRgb(renderer, physW, physH);

    const glErrors = drainGlErrors(renderer);
    pipeline.dispose();
    disposeScene();
    renderer.dispose();

    return {
      w: physW,
      h: physH,
      perspAoW,
      perspAoH,
      orthoAoW,
      orthoAoH,
      rgbPerspOn,
      rgbPerspOff,
      rgbOrthoOn,
      rgbOrthoOff,
      glErrors,
    };
  },

  testOutlineRimModeAndSkinnedMesh() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1018);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 4);
    scene.add(key);

    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.0, 4.2);
    cam.lookAt(0, 0.6, 0);
    cam.updateMatrixWorld();

    const group = new THREE.Group();
    const sphereGeo = new THREE.SphereGeometry(0.6, 20, 14);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0x263240, roughness: 0.7 });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(-0.9, 0.6, 0);
    group.add(sphere);

    const cylGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.3, 16, 4);
    const pos = cylGeo.attributes.position;
    const skinIndices = new Uint16Array(pos.count * 4);
    const skinWeights = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.min(1, Math.max(0, (y + 0.65) / 1.3));
      skinIndices[i * 4] = 0;
      skinIndices[i * 4 + 1] = 1;
      skinWeights[i * 4] = 1 - t;
      skinWeights[i * 4 + 1] = t;
    }
    cylGeo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    cylGeo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

    const rootBone = new THREE.Bone();
    const tipBone = new THREE.Bone();
    tipBone.position.set(0, 0.65, 0);
    tipBone.rotation.z = 0.2;
    rootBone.add(tipBone);
    const skeleton = new THREE.Skeleton([rootBone, tipBone]);
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x263240, roughness: 0.7 });
    const skinned = new THREE.SkinnedMesh(cylGeo, skinMat);
    skinned.position.set(0.9, 0.6, 0);
    skinned.add(rootBone);
    skinned.bind(skeleton);
    group.add(skinned);
    scene.add(group);

    const rim = createOutlineHighlight(group, {
      mode: "rim",
      color: "#22eeff",
      intensity: 2.2,
      opacity: 1,
    });

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "cinematic",
      draft: true,
    });

    rim.set(0);
    pipeline.render(cam);
    const rgbOff = readRgb(renderer, W, H);

    rim.set(1.0);
    pipeline.render(cam);
    const rgbOn = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);

    rim.dispose();
    pipeline.dispose();
    sphereGeo.dispose();
    sphereMat.dispose();
    cylGeo.dispose();
    skinMat.dispose();
    skeleton.dispose();
    scene.clear();

    return { w: W, h: H, rgbOff, rgbOn, glErrors };
  },

  testCreateEnvironmentStudioAndRoom() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const sphereGeo = new THREE.SphereGeometry(1.1, 24, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.14,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);

    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 0.2, 3.2);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "cinematic",
      bloom: false,
      draft: true,
    });

    const studioEnv = createEnvironment(renderer, { preset: "studio" });
    scene.environment = studioEnv.texture;
    pipeline.render(cam);
    const rgbStudio = readRgb(renderer, W, H);

    const roomEnv = createEnvironment(renderer, { preset: "room" });
    scene.environment = roomEnv.texture;
    pipeline.render(cam);
    const rgbRoom = readRgb(renderer, W, H);

    const glErrors = drainGlErrors(renderer);
    scene.environment = null;
    pipeline.dispose();
    studioEnv.dispose();
    roomEnv.dispose();
    sphereGeo.dispose();
    sphereMat.dispose();
    scene.clear();
    const disposeGlErrors = drainGlErrors(renderer);

    return { w: W, h: H, rgbStudio, rgbRoom, glErrors, disposeGlErrors };
  },

  testOrthoInitLazyGodraysAndAoCarryover() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const { scene, key, disposeScene } = buildTestScene(false);

    const aspect = W / H;
    const ortho = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.2, 60);
    ortho.position.set(0, 1.4, 3.2);
    ortho.lookAt(0, 0.6, -0.8);
    ortho.updateMatrixWorld();

    const persp = new THREE.PerspectiveCamera(45, W / H, 0.2, 80);
    persp.position.set(0, 1.6, 3.6);
    persp.lookAt(0, 0.7, -0.8);
    persp.updateMatrixWorld();

    const pipeline = createPostPipeline(renderer, scene, ortho, {
      profile: "cinematic",
      draft: true,
      godraysLight: key,
      ao: { aoRadius: 0.7, distanceFalloff: 0.9, intensity: 1.8 },
    });

    const initialSupported = pipeline.godrays!.supported;
    const initialPassIsNull = pipeline.godrays!.pass === null;

    pipeline.ao!.configuration.intensity = 3.1;
    pipeline.ao!.configuration.aoRadius = 1.15;
    pipeline.ao!.configuration.distanceFalloff = 1.4;
    pipeline.ao!.configuration.color.setHex(0x112233);

    pipeline.godrays!.update({
      ...DEFAULT_LIGHTS.godrays,
      enabled: true,
      weight: 0.6,
      density: 0.02,
      raymarchSteps: 16,
    });

    pipeline.render(ortho);
    const passStillNullOnOrtho = pipeline.godrays!.pass === null;

    pipeline.render(persp);
    const passCreatedOnPersp = pipeline.godrays!.pass !== null;
    const enabledOnPersp = Boolean(pipeline.godrays!.pass?.enabled);
    const godraysPassIdx = pipeline.godrays!.pass
      ? pipeline.composer.passes.indexOf(pipeline.godrays!.pass)
      : -1;
    const passBeforeTail =
      godraysPassIdx >= 0 && godraysPassIdx < pipeline.composer.passes.length - 1;
    const carriedIntensity = pipeline.ao!.configuration.intensity;
    const carriedRadius = pipeline.ao!.configuration.aoRadius;
    const carriedFalloff = pipeline.ao!.configuration.distanceFalloff;
    const carriedColorHex = pipeline.ao!.configuration.color.getHex();

    pipeline.dof!.update({ fstop: 2.0, focusDistance: 4.0, mm: 50, widthPx: W });
    pipeline.render(ortho);
    const enabledBackOnOrtho = Boolean(pipeline.godrays!.pass?.enabled);
    const cocVersionStart = pipeline.dof!.effect.cocMaterial.version;
    for (let i = 0; i < 4; i++) {
      pipeline.dof!.update({ fstop: 2.0, focusDistance: 4.0 + i * 0.25, mm: 50, widthPx: W });
      pipeline.render(ortho);
    }
    const cocVersionEnd = pipeline.dof!.effect.cocMaterial.version;

    pipeline.render(persp);
    const enabledRestoredOnPersp = Boolean(pipeline.godrays!.pass?.enabled);

    pipeline.godrays!.dispose();
    const passNullAfterDispose = pipeline.godrays!.pass === null;
    pipeline.render(persp);

    const glErrors = drainGlErrors(renderer);
    pipeline.dispose();
    disposeScene();
    const disposeGlErrors = drainGlErrors(renderer);

    return {
      initialSupported,
      initialPassIsNull,
      passStillNullOnOrtho,
      passCreatedOnPersp,
      enabledOnPersp,
      passBeforeTail,
      carriedIntensity,
      carriedRadius,
      carriedFalloff,
      carriedColorHex,
      enabledBackOnOrtho,
      cocVersionStart,
      cocVersionEnd,
      enabledRestoredOnPersp,
      passNullAfterDispose,
      glErrors,
      disposeGlErrors,
    };
  },

  testHdrHeadroomAndMainPassOrder() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const cam = new THREE.OrthographicCamera(-3.5, 3.5, 2, -2, 0.1, 20);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    const geo = new THREE.PlaneGeometry(1.6, 2.4);
    const sdrMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1),
      toneMapped: false,
    });
    const hdrWhiteMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(12, 12, 12),
      toneMapped: false,
    });
    const hdrOrangeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(10, 2, 0.2),
      toneMapped: false,
    });

    const sdrMesh = new THREE.Mesh(geo, sdrMat);
    sdrMesh.position.set(-2.2, 0, 0);
    const hdrWhiteMesh = new THREE.Mesh(geo, hdrWhiteMat);
    hdrWhiteMesh.position.set(0, 0, 0);
    const hdrOrangeMesh = new THREE.Mesh(geo, hdrOrangeMat);
    hdrOrangeMesh.position.set(2.2, 0, 0);
    scene.add(sdrMesh, hdrWhiteMesh, hdrOrangeMesh);

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "cinematic",
      bloom: false,
      vignette: false,
      ao: false,
      draft: true,
    });

    let toneAfterToneMapping = false;
    for (const pass of pipeline.composer.passes) {
      const effects = (pass as unknown as { effects?: { name?: string }[] }).effects;
      if (!effects) continue;
      const toneIdx = effects.indexOf(pipeline.tone);
      const tmIdx = effects.findIndex((e) => e.name === "ToneMappingEffect");
      if (toneIdx >= 0 && tmIdx >= 0) {
        toneAfterToneMapping = toneIdx > tmIdx;
      }
    }

    pipeline.render(cam);
    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);

    pipeline.dispose();
    geo.dispose();
    sdrMat.dispose();
    hdrWhiteMat.dispose();
    hdrOrangeMat.dispose();
    scene.clear();

    return { w: W, h: H, rgb, glErrors, toneAfterToneMapping };
  },

  testXraySkinnedMeshWithClipping() {
    const renderer = sharedRenderer;
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 50);
    cam.position.set(0, 1.0, 3.6);
    cam.lookAt(0, 1.0, 0);
    cam.updateMatrixWorld();

    const cylGeo = new THREE.CylinderGeometry(0.45, 0.45, 2.0, 20, 8);
    const pos = cylGeo.attributes.position;
    const skinIndices = new Uint16Array(pos.count * 4);
    const skinWeights = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.min(1, Math.max(0, (y + 1.0) / 2.0));
      skinIndices[i * 4] = 0;
      skinIndices[i * 4 + 1] = 1;
      skinWeights[i * 4] = 1 - t;
      skinWeights[i * 4 + 1] = t;
    }
    cylGeo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    cylGeo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

    const rootBone = new THREE.Bone();
    const tipBone = new THREE.Bone();
    tipBone.position.set(0, 1.0, 0);
    tipBone.rotation.z = 0.55;
    rootBone.add(tipBone);
    const skeleton = new THREE.Skeleton([rootBone, tipBone]);

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.0);
    const xrayMat = createXRayMaterial({
      preset: "xray-cyan",
      intensity: 2.2,
      clippingPlanes: [clipPlane],
    });

    const skinned = new THREE.SkinnedMesh(cylGeo, xrayMat);
    skinned.position.set(0, 1.0, 0);
    skinned.add(rootBone);
    skinned.bind(skeleton);
    scene.add(skinned);

    const pipeline = createPostPipeline(renderer, scene, cam, {
      profile: "explainer-clean",
      draft: true,
    });
    pipeline.render(cam);

    const rgb = readRgb(renderer, W, H);
    const glErrors = drainGlErrors(renderer);

    pipeline.dispose();
    cylGeo.dispose();
    xrayMat.dispose();
    skeleton.dispose();
    scene.clear();

    return { w: W, h: H, rgb, glErrors };
  },
});
