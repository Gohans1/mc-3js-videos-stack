import { createHighlight, createOutlineHighlight, pulseEnvelope } from "film-stage/highlight";
import {
  applyLightingRig,
  applySetLight,
  bakeSceneProbe,
  createAreaLight,
  createEnvironment,
  createGodraysPass,
  createLightingRig,
  createSkyEnvironment,
  DEFAULT_LIGHTS,
  ENVIRONMENT_PRESETS,
  KELVIN_CHIPS,
  kelvinToHex,
  LIGHT_PRESET_IDS,
  LIGHT_PRESETS,
  lightsAt,
  loadHDREnvironment,
  type EnvironmentHandle,
  type EnvironmentOptions,
  type EnvironmentPreset,
  type LightingRig,
  type LightingRigOptions,
  type LightsState,
  type Vec3,
} from "film-stage/lights";
import {
  createParticleEmitter,
  createParticleField,
  EMITTER_PRESETS,
  PARTICLE_PRESETS,
  type EmitterPresetName,
  type ParticlePresetName,
} from "film-stage/particles";
import {
  createFilmRenderer,
  createPostPipeline,
  createScreenEffect,
  LOOKDEV_PROFILE_IDS,
  LOOKDEV_PROFILES,
  resolvePostConfig,
  SCREEN_EFFECT_PRESET_IDS,
  SCREEN_EFFECT_PRESETS,
  type FilmRendererOptions,
  type LookdevProfileId,
  type PostPipeline,
  type PostPipelineOptions,
  type ToneMapName,
} from "film-stage/post";
import {
  BACKDROP_PRESET_IDS,
  BACKDROP_PRESETS,
  createCelestialDisc,
  createCloudLayer,
  createSkyDome,
  createStarfield,
  createStudioBackdrop,
  SKY_PRESET_IDS,
  SKY_PRESETS,
} from "film-stage/sky";
import {
  createCausticsPlane,
  createFlame,
  createHazeLayer,
  createPhysicalMaterial,
  createVolumetricBeam,
  createWaterSurface,
  createWetGround,
  createXRayMaterial,
  FLAME_PRESETS,
  MATERIAL_PRESET_IDS,
  MATERIAL_PRESETS,
  WATER_PRESETS,
  XRAY_PRESETS,
  type FlamePresetName,
  type WaterPresetName,
  type XRayPresetName,
} from "film-stage/surfaces";
import * as THREE from "three";

export {
  applyLightingRig,
  applySetLight,
  BACKDROP_PRESET_IDS,
  BACKDROP_PRESETS,
  bakeSceneProbe,
  createAreaLight,
  createCausticsPlane,
  createCelestialDisc,
  createCloudLayer,
  createEnvironment,
  createFilmRenderer,
  createFlame,
  createGodraysPass,
  createHazeLayer,
  createHighlight,
  createLightingRig,
  createOutlineHighlight,
  createParticleEmitter,
  createParticleField,
  createPhysicalMaterial,
  createPostPipeline,
  createScreenEffect,
  createSkyDome,
  createSkyEnvironment,
  createStarfield,
  createStudioBackdrop,
  createVolumetricBeam,
  createWaterSurface,
  createWetGround,
  createXRayMaterial,
  DEFAULT_LIGHTS,
  EMITTER_PRESETS,
  ENVIRONMENT_PRESETS,
  FLAME_PRESETS,
  KELVIN_CHIPS,
  kelvinToHex,
  LIGHT_PRESET_IDS,
  LIGHT_PRESETS,
  lightsAt,
  loadHDREnvironment,
  LOOKDEV_PROFILE_IDS,
  LOOKDEV_PROFILES,
  MATERIAL_PRESET_IDS,
  MATERIAL_PRESETS,
  PARTICLE_PRESETS,
  pulseEnvelope,
  resolvePostConfig,
  SCREEN_EFFECT_PRESET_IDS,
  SCREEN_EFFECT_PRESETS,
  SKY_PRESET_IDS,
  SKY_PRESETS,
  WATER_PRESETS,
  XRAY_PRESETS,
};

export type {
  EmitterPresetName,
  EnvironmentHandle,
  EnvironmentOptions,
  EnvironmentPreset,
  FilmRendererOptions,
  FlamePresetName,
  LightingRig,
  LightingRigOptions,
  LightsState,
  LookdevProfileId,
  ParticlePresetName,
  PostPipeline,
  PostPipelineOptions,
  ToneMapName,
  Vec3,
  WaterPresetName,
  XRayPresetName,
};

export const ENVIRONMENT_PRESET_IDS: readonly EnvironmentPreset[] = [
  ...(Object.keys(ENVIRONMENT_PRESETS) as EnvironmentPreset[]),
  "room",
];
export const WATER_PRESET_IDS: readonly WaterPresetName[] = Object.keys(
  WATER_PRESETS,
) as WaterPresetName[];
export const XRAY_PRESET_IDS: readonly XRayPresetName[] = Object.keys(
  XRAY_PRESETS,
) as XRayPresetName[];
export const FLAME_PRESET_IDS: readonly FlamePresetName[] = Object.keys(
  FLAME_PRESETS,
) as FlamePresetName[];
export const PARTICLE_PRESET_IDS: readonly ParticlePresetName[] = Object.keys(
  PARTICLE_PRESETS,
) as ParticlePresetName[];
export const EMITTER_PRESET_IDS: readonly EmitterPresetName[] = Object.keys(
  EMITTER_PRESETS,
) as EmitterPresetName[];

export interface LookdevEditLightFallback {
  fill?: number;
  spot?: number;
  key?: number;
  env?: number;
}

export interface LookdevEditLook {
  saturation?: number;
}

export interface SetupLookdevOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scene: THREE.Scene;
  camera: THREE.Camera;
  draft?: boolean;
  renderer?: FilmRendererOptions;
  environment?: EnvironmentOptions;
  environmentIntensity?: number;
  lighting?: LightingRigOptions;
  roomFallback?: {
    target?: Vec3;
    ceilingY?: number;
  };
  profile?: LookdevProfileId;
  toneMapping?: ToneMapName;
  saturation?: number;
  godrays?: boolean;
  post?: Omit<PostPipelineOptions, "width" | "height" | "draft" | "godraysLight">;
}

export interface LookdevHandle {
  renderer: THREE.WebGLRenderer;
  environment: EnvironmentHandle;
  lightingRig: LightingRig;
  post: PostPipeline;
  updateLighting: (
    editLights: Parameters<typeof lightsAt>[0],
    t: number,
    fallbackEditLight?: LookdevEditLightFallback | null,
  ) => void;
  syncLook: (editLook?: LookdevEditLook | null) => void;
  dispose: () => void;
}

const INACTIVE_RIG: LightsState = {
  ...DEFAULT_LIGHTS,
  key: { ...DEFAULT_LIGHTS.key, enabled: false },
  fill: { ...DEFAULT_LIGHTS.fill, enabled: false },
  rim: { ...DEFAULT_LIGHTS.rim, enabled: false },
  world: { ...DEFAULT_LIGHTS.world, ambientIntensity: 0, background: null },
  fog: { ...DEFAULT_LIGHTS.fog, mode: "none" },
  practicals: [],
  godrays: { ...DEFAULT_LIGHTS.godrays, enabled: false },
};

const nonNegFinite = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;

export function setupLookdev(opts: SetupLookdevOptions): LookdevHandle {
  const { canvas, width, height, scene, camera, draft = false } = opts;
  const defaultEnvIntensity = nonNegFinite(opts.environmentIntensity, 0.35);

  const rollback: (() => void)[] = [];
  let renderer: THREE.WebGLRenderer;
  let environment: EnvironmentHandle;
  let lightingRig: LightingRig;
  let post: PostPipeline;

  try {
    renderer = createFilmRenderer(canvas, width, height, opts.renderer);
    rollback.push(() => renderer.dispose());

    environment = createEnvironment(renderer, opts.environment ?? { preset: "studio" });
    scene.environment = environment.texture;
    scene.environmentIntensity = defaultEnvIntensity;
    rollback.push(() => {
      if (scene.environment === environment.texture) scene.environment = null;
      environment.dispose();
    });

    lightingRig = createLightingRig(scene, opts.lighting);
    rollback.push(() => lightingRig.dispose());

    post = createPostPipeline(renderer, scene, camera, {
      width,
      height,
      draft,
      ...opts.post,
      profile: opts.profile ?? opts.post?.profile ?? "cinematic",
      ...(opts.toneMapping !== undefined ? { toneMapping: opts.toneMapping } : {}),
      ...(opts.saturation !== undefined ? { saturation: opts.saturation } : {}),
      godraysLight: opts.godrays === false ? null : lightingRig.key,
    });
  } catch (error) {
    while (rollback.length > 0) rollback.pop()?.();
    throw error;
  }

  let timelineLighting = true;
  let disposed = false;
  let fallbackLights: { hemi: THREE.HemisphereLight; roomKey: THREE.SpotLight } | null = null;

  const ensureFallbackLights = () => {
    if (fallbackLights) return fallbackLights;
    const target: Vec3 = opts.roomFallback?.target ?? opts.lighting?.target ?? [0, 1.5, 0];
    const ceilingY = opts.roomFallback?.ceilingY ?? target[1] + 2.6;
    const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x3a3026);
    const roomKey = new THREE.SpotLight(0xfff0dc, 28, 14, THREE.MathUtils.degToRad(70), 0.7, 1.2);
    roomKey.position.set(target[0], ceilingY, target[2]);
    roomKey.target.position.set(target[0], 0, target[2]);
    roomKey.castShadow = true;
    roomKey.shadow.mapSize.set(2048, 2048);
    roomKey.shadow.bias = -0.0008;
    roomKey.shadow.radius = 3;
    scene.add(hemi, roomKey, roomKey.target);
    fallbackLights = { hemi, roomKey };
    return fallbackLights;
  };

  const updateLighting: LookdevHandle["updateLighting"] = (editLights, t, fallbackEditLight) => {
    if (disposed) return;
    const lightKeys = Array.isArray(editLights) ? editLights : editLights?.keys;
    if (lightKeys?.length) {
      if (fallbackLights) {
        fallbackLights.hemi.visible = false;
        fallbackLights.roomKey.visible = false;
      }
      const lightsSample = lightsAt(editLights, t);
      applyLightingRig(lightingRig, lightsSample, t);
      post.godrays?.update(lightsSample.godrays, lightsSample.key.color);
      const ambient = nonNegFinite(lightsSample.world.ambientIntensity, 0);
      scene.environmentIntensity = Math.min(0.85, ambient * 1.4);
      timelineLighting = true;
      return;
    }

    if (timelineLighting) {
      applyLightingRig(lightingRig, INACTIVE_RIG);
      post.godrays?.update(INACTIVE_RIG.godrays);
      timelineLighting = false;
    }
    const { hemi, roomKey } = ensureFallbackLights();
    hemi.visible = true;
    roomKey.visible = true;
    hemi.intensity = nonNegFinite(fallbackEditLight?.fill, 0.6);
    roomKey.intensity = nonNegFinite(fallbackEditLight?.spot ?? fallbackEditLight?.key, 28);
    scene.environmentIntensity = nonNegFinite(fallbackEditLight?.env, defaultEnvIntensity);
  };

  const syncLook: LookdevHandle["syncLook"] = (editLook) => {
    if (disposed) return;
    post.tone.saturation =
      typeof editLook?.saturation === "number" && Number.isFinite(editLook.saturation)
        ? editLook.saturation
        : post.config.saturation;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    post.dispose();
    lightingRig.dispose();
    if (scene.environment === environment.texture) {
      scene.environment = null;
    }
    environment.dispose();
    if (fallbackLights) {
      scene.remove(fallbackLights.hemi, fallbackLights.roomKey, fallbackLights.roomKey.target);
      fallbackLights.roomKey.shadow.map?.dispose();
      fallbackLights.roomKey.dispose();
      fallbackLights.hemi.dispose();
      fallbackLights = null;
    }
    renderer.dispose();
  };

  return {
    renderer,
    environment,
    lightingRig,
    post,
    updateLighting,
    syncLook,
    dispose,
  };
}
