import { KernelSize } from "postprocessing";
import * as THREE from "three";
import { GodraysPass, type GodraysPassParams, GodraysUpsampleQuality } from "three-good-godrays";

import {
  type GodraysState,
  type LightsState,
  practicalIntensityAt,
  type Vec3,
} from "./lights-meta";

export * from "./lights-meta";

export interface LightingRigOptions {
  target?: Vec3;
  distance?: number;
  shadowExtent?: number;
  shadowMapSize?: number;
}

export interface PracticalHandle {
  kind: "point" | "spot";
  light: THREE.PointLight | THREE.SpotLight;
  target?: THREE.Object3D;
}

export interface LightingRig {
  scene: THREE.Scene;
  defaultTarget: Vec3;
  distance: number;
  shadowExtent: number;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  practicals: Map<string, PracticalHandle>;
  dispose: () => void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const degToRad = (d: number): number => (d * Math.PI) / 180;

function placeDirectional(
  light: THREE.DirectionalLight,
  target: Vec3,
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
): void {
  const az = degToRad(azimuthDeg);
  const el = degToRad(clamp(elevationDeg, -89.9, 89.9));
  const cosEl = Math.cos(el);
  light.position.set(
    target[0] + cosEl * Math.sin(az) * distance,
    target[1] + Math.sin(el) * distance,
    target[2] + cosEl * Math.cos(az) * distance,
  );
  light.target.position.set(target[0], target[1], target[2]);
  light.target.updateMatrixWorld();
}

function configureDirectionalShadow(
  light: THREE.DirectionalLight,
  extent: number,
  mapSize: number,
  far: number,
): void {
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.camera.left = -extent;
  light.shadow.camera.right = extent;
  light.shadow.camera.top = extent;
  light.shadow.camera.bottom = -extent;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = far;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
}

/** Create and attach a Three.js key/fill/rim + hemisphere/ambient rig onto `scene`. */
export function createLightingRig(scene: THREE.Scene, opts: LightingRigOptions = {}): LightingRig {
  const defaultTarget: Vec3 = opts.target ? [...opts.target] : [0, 1.5, 0];
  const distance = opts.distance ?? 18;
  const shadowExtent = opts.shadowExtent ?? 12;
  const shadowMapSize = opts.shadowMapSize ?? 2048;

  const key = new THREE.DirectionalLight(0xfff4e4, 2.4);
  key.castShadow = true;
  configureDirectionalShadow(key, shadowExtent, shadowMapSize, distance * 3);

  const fill = new THREE.DirectionalLight(0xc9dcf2, 0.9);
  const rim = new THREE.DirectionalLight(0xe8f0ff, 1.5);
  const hemisphere = new THREE.HemisphereLight(0xdfe6f0, 0x3a3026, 0.45);
  const ambient = new THREE.AmbientLight(0xdfe6f0, 0.25);

  scene.add(key, key.target, fill, fill.target, rim, rim.target, hemisphere, ambient);

  const practicals = new Map<string, PracticalHandle>();
  let ownedBg: THREE.Color | null = null;
  let disposed = false;

  const rig: LightingRig & { _syncBg?: (bg: string | null) => void } = {
    scene,
    defaultTarget,
    distance,
    shadowExtent,
    key,
    fill,
    rim,
    hemisphere,
    ambient,
    practicals,
    _syncBg(bg: string | null) {
      if (bg) {
        if (!ownedBg) ownedBg = new THREE.Color(bg);
        else ownedBg.set(bg);
        scene.background = ownedBg;
      } else if (ownedBg && scene.background === ownedBg) {
        scene.background = null;
        ownedBg = null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of practicals.values()) {
        scene.remove(handle.light);
        if (handle.target) scene.remove(handle.target);
        handle.light.dispose();
      }
      practicals.clear();
      key.shadow.map?.dispose();
      key.dispose();
      fill.dispose();
      rim.dispose();
      hemisphere.dispose();
      ambient.dispose();
      scene.remove(key, key.target, fill, fill.target, rim, rim.target, hemisphere, ambient);
      if (ownedBg && scene.background === ownedBg) scene.background = null;
      ownedBg = null;
    },
  };
  return rig;
}

function removePractical(
  scene: THREE.Scene,
  practicals: Map<string, PracticalHandle>,
  id: string,
): void {
  const existing = practicals.get(id);
  if (!existing) return;
  scene.remove(existing.light);
  if (existing.target) scene.remove(existing.target);
  existing.light.dispose();
  practicals.delete(id);
}

/** Apply an evaluated `LightsState` snapshot and time `t` (for deterministic flicker) to `rig`. */
export function applyLightingRig(rig: LightingRig, sample: LightsState, t = 0): void {
  const { scene, practicals } = rig;
  const target: Vec3 = sample.target ?? rig.defaultTarget;

  // Key
  rig.key.visible = sample.key.enabled;
  rig.key.color.set(sample.key.color);
  rig.key.intensity = sample.key.enabled ? sample.key.intensity : 0;
  rig.key.castShadow = sample.key.enabled && sample.key.castShadow;
  rig.key.shadow.radius = Math.max(0, sample.key.shadowRadius);
  placeDirectional(rig.key, target, sample.key.azimuth, sample.key.elevation, rig.distance);

  // Fill + Negative Fill bounce attenuation
  const negScale = sample.fill.negativeFill ? 0.15 : 1;
  const bounceScale = sample.fill.negativeFill ? 0.45 : 1;
  rig.fill.visible = sample.fill.enabled;
  rig.fill.color.set(sample.fill.color);
  rig.fill.intensity = sample.fill.enabled ? sample.fill.intensity * negScale : 0;
  placeDirectional(rig.fill, target, sample.fill.azimuth, sample.fill.elevation, rig.distance);

  // Rim
  rig.rim.visible = sample.rim.enabled;
  rig.rim.color.set(sample.rim.color);
  rig.rim.intensity = sample.rim.enabled ? sample.rim.intensity : 0;
  placeDirectional(rig.rim, target, sample.rim.azimuth, sample.rim.elevation, rig.distance);

  // World
  rig.hemisphere.color.set(sample.world.skyColor);
  rig.hemisphere.groundColor.set(sample.world.groundColor);
  rig.hemisphere.intensity = sample.world.ambientIntensity * 0.65 * bounceScale;
  rig.ambient.color.set(sample.world.skyColor);
  rig.ambient.intensity = sample.world.ambientIntensity * 0.35 * bounceScale;
  (rig as LightingRig & { _syncBg?: (bg: string | null) => void })._syncBg?.(
    sample.world.background,
  );

  // Fog
  if (sample.fog.mode === "none") {
    scene.fog = null;
  } else if (sample.fog.mode === "linear") {
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.set(sample.fog.color);
      scene.fog.near = sample.fog.near;
      scene.fog.far = Math.max(sample.fog.near + 0.01, sample.fog.far);
    } else {
      scene.fog = new THREE.Fog(
        sample.fog.color,
        sample.fog.near,
        Math.max(sample.fog.near + 0.01, sample.fog.far),
      );
    }
  } else if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.set(sample.fog.color);
    scene.fog.density = Math.max(0, sample.fog.density);
  } else {
    scene.fog = new THREE.FogExp2(sample.fog.color, Math.max(0, sample.fog.density));
  }

  // Practicals synced by id
  const wanted = new Set(sample.practicals.map((p) => p.id));
  for (const id of practicals.keys()) {
    if (!wanted.has(id)) removePractical(scene, practicals, id);
  }

  for (let i = 0; i < sample.practicals.length; i++) {
    const p = sample.practicals[i];
    let handle = practicals.get(p.id);
    if (handle && handle.kind !== p.kind) {
      removePractical(scene, practicals, p.id);
      handle = undefined;
    }
    if (!handle) {
      if (p.kind === "spot") {
        const spot = new THREE.SpotLight(p.color, p.intensity, p.distance, degToRad(p.angle ?? 45));
        scene.add(spot, spot.target);
        handle = { kind: "spot", light: spot, target: spot.target };
      } else {
        const point = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay);
        scene.add(point);
        handle = { kind: "point", light: point };
      }
      practicals.set(p.id, handle);
    }

    handle.light.color.set(p.color);
    handle.light.position.set(p.at[0], p.at[1], p.at[2]);
    handle.light.intensity = practicalIntensityAt(p, t, i);
    handle.light.distance = p.distance;
    handle.light.decay = p.decay;

    if (handle.kind === "spot") {
      const spot = handle.light as THREE.SpotLight;
      spot.angle = degToRad(clamp(p.angle ?? 45, 1, 89));
      spot.penumbra = clamp(p.penumbra ?? 0.3, 0, 1);
      const tgt = p.target ?? [p.at[0], 0, p.at[2]];
      spot.target.position.set(tgt[0], tgt[1], tgt[2]);
      spot.target.updateMatrixWorld();
    }
  }
}

export interface GodraysHandle {
  supported: boolean;
  pass: GodraysPass | null;
  update: (state: GodraysState, fallbackColor?: string) => void;
  dispose: () => void;
}

export interface GodraysOptions {
  gammaCorrection?: boolean;
  resolutionScale?: number;
  upsampleQuality?: GodraysUpsampleQuality;
}

function blurKernelFromRadius(edgeRadius: number): KernelSize {
  if (edgeRadius <= 0.75) return KernelSize.VERY_SMALL;
  if (edgeRadius <= 1.5) return KernelSize.SMALL;
  if (edgeRadius <= 2.5) return KernelSize.MEDIUM;
  if (edgeRadius <= 4) return KernelSize.LARGE;
  return KernelSize.VERY_LARGE;
}

function toGodraysParams(
  state: GodraysState,
  fallbackColor: string,
  gammaCorrection: boolean,
  resolutionScale: number,
  upsampleQuality: GodraysUpsampleQuality,
): Partial<GodraysPassParams> {
  const weight = Math.max(0, state.weight);
  return {
    density: Math.max(0, state.density * weight),
    maxDensity: clamp(state.maxDensity * weight, 0, 1),
    distanceAttenuation: Math.max(0, state.edgeStrength),
    raymarchSteps: clamp(Math.round(state.raymarchSteps), 4, 240),
    color: new THREE.Color(state.color ?? fallbackColor),
    blur: state.blur
      ? {
          kernelSize: blurKernelFromRadius(state.edgeRadius),
          variance: clamp(state.edgeRadius * 5, 1, 30),
        }
      : false,
    gammaCorrection,
    resolutionScale,
    upsampleQuality,
  };
}

/**
 * Wrap `three-good-godrays` cleanly so unsupported lights (`SpotLight`, no shadows)
 * or headless/WebGL-less contexts degrade to a harmless no-op instead of throwing.
 */
export function createGodraysPass(
  light: THREE.Light | null | undefined,
  camera: THREE.Camera | null | undefined,
  opts: GodraysOptions & { enabled?: boolean } = {},
): GodraysHandle {
  const supportedLight =
    !!light &&
    ((light as THREE.DirectionalLight).isDirectionalLight ||
      (light as THREE.PointLight).isPointLight) &&
    !!(light as THREE.DirectionalLight).shadow;
  const supportedCam = !!camera && (camera as THREE.PerspectiveCamera).isPerspectiveCamera;

  if (!supportedLight || !supportedCam) {
    return { supported: false, pass: null, update() {}, dispose() {} };
  }

  const gammaCorrection = opts.gammaCorrection ?? false;
  const resolutionScale = opts.resolutionScale ?? 0.5;
  const upsampleQuality = opts.upsampleQuality ?? GodraysUpsampleQuality.LOW;

  let pass: GodraysPass | null = null;
  try {
    pass = new GodraysPass(
      light as THREE.DirectionalLight | THREE.PointLight,
      camera as THREE.PerspectiveCamera,
      {
        gammaCorrection,
        resolutionScale,
        upsampleQuality,
        raymarchSteps: 60,
      },
    );
    if (opts.enabled === false) pass.enabled = false;
  } catch {
    return { supported: false, pass: null, update() {}, dispose() {} };
  }

  return {
    supported: true,
    pass,
    update(state: GodraysState, fallbackColor = "#ffffff") {
      if (!pass) return;
      pass.enabled = state.enabled;
      if (!state.enabled) return;
      try {
        pass.setParams(
          toGodraysParams(state, fallbackColor, gammaCorrection, resolutionScale, upsampleQuality),
        );
      } catch {
        pass.enabled = false;
      }
    },
    dispose() {
      if (!pass) return;
      try {
        pass.dispose();
      } finally {
        pass = null;
      }
    },
  };
}
