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
  const initialBg = scene.background;
  const initialFog = scene.fog;
  let ownedBg: THREE.Color | null = null;
  let ownedFog: THREE.Fog | THREE.FogExp2 | null = null;
  let disposed = false;

  const rig: LightingRig & {
    _syncBg?: (bg: string | null) => void;
    _syncFog?: (fog: LightsState["fog"]) => void;
  } = {
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
      } else if (ownedBg) {
        if (scene.background === ownedBg) scene.background = initialBg;
        ownedBg = null;
      }
    },
    _syncFog(fog: LightsState["fog"]) {
      if (fog.mode === "none") {
        scene.fog = null;
        ownedFog = null;
        return;
      }
      if (fog.mode === "linear") {
        const fogNear = Math.max(0, fog.near);
        const fogFar = Math.max(fogNear + 0.01, fog.far);
        if (ownedFog instanceof THREE.Fog && scene.fog === ownedFog) {
          ownedFog.color.set(fog.color);
          ownedFog.near = fogNear;
          ownedFog.far = fogFar;
        } else {
          ownedFog = new THREE.Fog(fog.color, fogNear, fogFar);
          scene.fog = ownedFog;
        }
        return;
      }
      const density = Math.max(0, fog.density);
      if (ownedFog instanceof THREE.FogExp2 && scene.fog === ownedFog) {
        ownedFog.color.set(fog.color);
        ownedFog.density = density;
      } else {
        ownedFog = new THREE.FogExp2(fog.color, density);
        scene.fog = ownedFog;
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
      if (ownedBg && scene.background === ownedBg) scene.background = initialBg;
      scene.fog = initialFog;
      ownedBg = null;
      ownedFog = null;
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

export function applyLightingRig(rig: LightingRig, sample: LightsState, t = 0): void {
  const { scene, practicals } = rig;
  const target: Vec3 = sample.target ?? rig.defaultTarget;

  rig.key.visible = sample.key.enabled;
  rig.key.color.set(sample.key.color);
  rig.key.intensity = sample.key.enabled ? Math.max(0, sample.key.intensity) : 0;
  rig.key.castShadow = sample.key.enabled && sample.key.castShadow;
  rig.key.shadow.radius = Math.max(0, sample.key.shadowRadius);
  placeDirectional(rig.key, target, sample.key.azimuth, sample.key.elevation, rig.distance);

  const negScale = sample.fill.negativeFill ? 0.15 : 1;
  const bounceScale = sample.fill.negativeFill ? 0.45 : 1;
  rig.fill.visible = sample.fill.enabled;
  rig.fill.color.set(sample.fill.color);
  rig.fill.intensity = sample.fill.enabled ? Math.max(0, sample.fill.intensity) * negScale : 0;
  placeDirectional(rig.fill, target, sample.fill.azimuth, sample.fill.elevation, rig.distance);

  rig.rim.visible = sample.rim.enabled;
  rig.rim.color.set(sample.rim.color);
  rig.rim.intensity = sample.rim.enabled ? Math.max(0, sample.rim.intensity) : 0;
  placeDirectional(rig.rim, target, sample.rim.azimuth, sample.rim.elevation, rig.distance);

  const ambientLevel = Math.max(0, sample.world.ambientIntensity);
  rig.hemisphere.color.set(sample.world.skyColor);
  rig.hemisphere.groundColor.set(sample.world.groundColor);
  rig.hemisphere.intensity = ambientLevel * 0.65 * bounceScale;
  rig.ambient.color.set(sample.world.skyColor);
  rig.ambient.intensity = ambientLevel * 0.35 * bounceScale;
  (rig as LightingRig & { _syncBg?: (bg: string | null) => void })._syncBg?.(
    sample.world.background,
  );

  (rig as LightingRig & { _syncFog?: (fog: LightsState["fog"]) => void })._syncFog?.(sample.fog);

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
    const pDistance = Math.max(0, p.distance);
    const pDecay = Math.max(0, p.decay);
    if (!handle) {
      if (p.kind === "spot") {
        const spot = new THREE.SpotLight(
          p.color,
          0,
          pDistance,
          degToRad(clamp(p.angle ?? 45, 1, 89)),
        );
        scene.add(spot, spot.target);
        handle = { kind: "spot", light: spot, target: spot.target };
      } else {
        const point = new THREE.PointLight(p.color, 0, pDistance, pDecay);
        scene.add(point);
        handle = { kind: "point", light: point };
      }
      practicals.set(p.id, handle);
    }

    handle.light.color.set(p.color);
    handle.light.position.set(p.at[0], p.at[1], p.at[2]);
    handle.light.intensity = Math.max(0, practicalIntensityAt(p, t, i));
    handle.light.distance = pDistance;
    handle.light.decay = pDecay;

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
): { params: Partial<GodraysPassParams>; key: string; kernel: KernelSize | false } {
  const weight = Math.max(0, state.weight);
  const density = Math.max(0, state.density * weight);
  const maxDensity = clamp(state.maxDensity * weight, 0, 0.999);
  const distanceAttenuation = Math.max(0, state.edgeStrength);
  const raymarchSteps = clamp(Math.round(state.raymarchSteps), 4, 240);
  const colorHex = state.color ?? fallbackColor;
  const kernel = state.blur ? blurKernelFromRadius(state.edgeRadius) : false;
  const variance = kernel !== false ? clamp(state.edgeRadius * 0.05, 0.02, 0.5) : 0;
  const key = `${density}|${maxDensity}|${distanceAttenuation}|${raymarchSteps}|${colorHex}|${kernel}|${variance}`;
  return {
    key,
    kernel,
    params: {
      density,
      maxDensity,
      distanceAttenuation,
      raymarchSteps,
      color: new THREE.Color(colorHex),
      blur: kernel !== false ? { kernelSize: kernel, variance } : false,
      gammaCorrection,
      resolutionScale,
      upsampleQuality,
    },
  };
}

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

  const typedLight = light as THREE.DirectionalLight | THREE.PointLight;
  const gammaCorrection = opts.gammaCorrection ?? false;
  const resolutionScale = opts.resolutionScale ?? 0.5;
  const upsampleQuality = opts.upsampleQuality ?? GodraysUpsampleQuality.LOW;

  let pass: GodraysPass | null = null;
  try {
    pass = new GodraysPass(typedLight, camera as THREE.PerspectiveCamera, {
      gammaCorrection,
      resolutionScale,
      upsampleQuality,
      raymarchSteps: 60,
    });
    if (opts.enabled === false) pass.enabled = false;
  } catch {
    return { supported: false, pass: null, update() {}, dispose() {} };
  }

  let lastKey = "";
  let lastKernel: KernelSize | false | undefined = undefined;

  return {
    supported: true,
    pass,
    update(state: GodraysState, fallbackColor = "#ffffff") {
      if (!pass) return;
      const active = Boolean(
        state.enabled &&
        typedLight.visible &&
        typedLight.castShadow &&
        state.weight > 0 &&
        state.density > 0,
      );
      pass.enabled = active;
      if (!active) return;
      const { key, kernel, params } = toGodraysParams(
        state,
        fallbackColor,
        gammaCorrection,
        resolutionScale,
        upsampleQuality,
      );
      if (key === lastKey) return;
      try {
        // three-good-godrays@0.12.2 disposes blurPass on setParams without clearing the field.
        if (lastKernel !== kernel) {
          const internal = pass as unknown as {
            blurPass?: { dispose?: () => void } | null;
          };
          internal.blurPass?.dispose?.();
          internal.blurPass = null;
        }
        pass.setParams(params);
        lastKey = key;
        lastKernel = kernel;
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
        lastKey = "";
        lastKernel = undefined;
      }
    },
  };
}
