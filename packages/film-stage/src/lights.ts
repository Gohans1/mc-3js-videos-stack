import { KernelSize } from "postprocessing";
import * as THREE from "three";
import { GodraysPass, type GodraysPassParams, GodraysUpsampleQuality } from "three-good-godrays";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

import {
  DEFAULT_LIGHTS,
  type FogMode,
  type GodraysState,
  type LightsState,
  practicalIntensityAt,
  type PracticalState,
  type Vec3,
} from "./lights-meta";
import { createSkyDome, type SkyDomeOptions } from "./sky";

export * from "./lights-meta";

export type Vec3Like = Vec3 | THREE.Vector3;

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

interface InternalFogInput {
  mode: FogMode;
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
  density: number;
}

interface InternalLightingRig extends LightingRig {
  _syncBg?: (bg: THREE.ColorRepresentation | null) => void;
  _syncFog?: (fog: InternalFogInput) => void;
  _syncShadow?: (extent: number, near?: number, far?: number, keyDistance?: number) => void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const degToRad = (d: number): number => (d * Math.PI) / 180;
const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const nonNegFinite = (v: number | undefined, fallback = 0): number =>
  Math.max(0, finiteOr(v, fallback));

const _focus = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _away = new THREE.Vector3();

function writeVec3(out: THREE.Vector3, v: Vec3Like): THREE.Vector3 {
  if (v instanceof THREE.Vector3) {
    return out.set(finiteOr(v.x, 0), finiteOr(v.y, 0), finiteOr(v.z, 0));
  }
  return out.set(finiteOr(v[0], 0), finiteOr(v[1], 0), finiteOr(v[2], 0));
}

function placeDirectional(
  light: THREE.DirectionalLight,
  target: Vec3,
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
): void {
  const az = degToRad(finiteOr(azimuthDeg, 0));
  const el = degToRad(clamp(finiteOr(elevationDeg, 45), -89.9, 89.9));
  const dist = Math.max(0.01, finiteOr(distance, 18));
  const cosEl = Math.cos(el);
  light.position.set(
    target[0] + cosEl * Math.sin(az) * dist,
    target[1] + Math.sin(el) * dist,
    target[2] + cosEl * Math.cos(az) * dist,
  );
  light.target.position.set(target[0], target[1], target[2]);
  light.target.updateMatrixWorld();
}

function placeDirectionalBySpec(
  light: THREE.DirectionalLight,
  focus: THREE.Vector3,
  spec: {
    from?: Vec3Like;
    dir?: Vec3Like;
    azimuth?: number;
    elevation?: number;
    distance?: number;
  },
  fallbackAzimuth: number,
  fallbackElevation: number,
  fallbackDistance: number,
): void {
  if (spec.from) {
    writeVec3(_dir, spec.from);
    light.position.copy(focus).add(_dir);
    light.target.position.copy(focus);
    light.target.updateMatrixWorld();
    return;
  }
  if (spec.dir) {
    writeVec3(_dir, spec.dir);
    if (_dir.lengthSq() > 1e-12) _dir.normalize();
    else _dir.set(0, 1, 0);
    const dist = Math.max(0.01, finiteOr(spec.distance, fallbackDistance));
    light.position.copy(focus).addScaledVector(_dir, dist);
    light.target.position.copy(focus);
    light.target.updateMatrixWorld();
    return;
  }
  placeDirectional(
    light,
    [focus.x, focus.y, focus.z],
    finiteOr(spec.azimuth, fallbackAzimuth),
    finiteOr(spec.elevation, fallbackElevation),
    finiteOr(spec.distance, fallbackDistance),
  );
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
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  light.shadow.radius = DEFAULT_LIGHTS.key.shadowRadius;
}

export function createLightingRig(scene: THREE.Scene, opts: LightingRigOptions = {}): LightingRig {
  const defaultTarget: Vec3 = opts.target ? [...opts.target] : [0, 1.5, 0];
  const distance = opts.distance ?? 18;
  const shadowExtent = opts.shadowExtent ?? 12;
  const shadowMapSize = opts.shadowMapSize ?? 2048;
  const defaultNear = 0.5;
  const defaultFar = distance * 3;

  const key = new THREE.DirectionalLight(0xfff4e4, 2.4);
  key.castShadow = true;
  configureDirectionalShadow(key, shadowExtent, shadowMapSize, defaultFar);

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
  let activeExtent = shadowExtent;
  let activeNear = defaultNear;
  let activeFar = defaultFar;
  let disposed = false;

  const rig: InternalLightingRig = {
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
    _syncBg(bg: THREE.ColorRepresentation | null) {
      if (bg !== null) {
        if (!ownedBg) ownedBg = new THREE.Color(bg);
        else ownedBg.set(bg);
        scene.background = ownedBg;
      } else if (ownedBg) {
        if (scene.background === ownedBg) scene.background = initialBg;
        ownedBg = null;
      }
    },
    _syncFog(fog: InternalFogInput) {
      if (fog.mode === "none") {
        scene.fog = null;
        ownedFog = null;
        return;
      }
      if (fog.mode === "linear") {
        const fogNear = nonNegFinite(fog.near, DEFAULT_LIGHTS.fog.near);
        const fogFar = Math.max(fogNear + 0.01, nonNegFinite(fog.far, DEFAULT_LIGHTS.fog.far));
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
      const density = nonNegFinite(fog.density, DEFAULT_LIGHTS.fog.density);
      if (ownedFog instanceof THREE.FogExp2 && scene.fog === ownedFog) {
        ownedFog.color.set(fog.color);
        ownedFog.density = density;
      } else {
        ownedFog = new THREE.FogExp2(fog.color, density);
        scene.fog = ownedFog;
      }
    },
    _syncShadow(extent: number, near?: number, far?: number, keyDistance?: number) {
      const safeExtent = Number.isFinite(extent) ? extent : shadowExtent;
      const nextExtent = Math.max(0.5, safeExtent);
      const safeNear = near !== undefined && Number.isFinite(near) ? near : defaultNear;
      const nextNear = Math.max(0.05, safeNear);
      const safeKeyDist =
        keyDistance !== undefined && Number.isFinite(keyDistance) ? keyDistance : 0;
      const fallbackFar = Math.max(defaultFar, safeKeyDist + nextExtent * 2, nextExtent * 4);
      const safeFar = far !== undefined && Number.isFinite(far) ? far : fallbackFar;
      const nextFar = Math.max(nextNear + 1, safeFar);
      if (nextExtent === activeExtent && nextNear === activeNear && nextFar === activeFar) return;
      activeExtent = nextExtent;
      activeNear = nextNear;
      activeFar = nextFar;
      const cam = key.shadow.camera;
      cam.left = -nextExtent;
      cam.right = nextExtent;
      cam.top = nextExtent;
      cam.bottom = -nextExtent;
      cam.near = nextNear;
      cam.far = nextFar;
      cam.updateProjectionMatrix();
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

function syncPracticals(rig: LightingRig, items: readonly PracticalState[], t: number): void {
  const { scene, practicals } = rig;
  if (items.length === 0) {
    if (practicals.size > 0) {
      for (const id of practicals.keys()) removePractical(scene, practicals, id);
    }
    return;
  }

  const wanted = new Set(items.map((p) => p.id));
  for (const id of practicals.keys()) {
    if (!wanted.has(id)) removePractical(scene, practicals, id);
  }

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    let handle = practicals.get(p.id);
    if (handle && handle.kind !== p.kind) {
      removePractical(scene, practicals, p.id);
      handle = undefined;
    }
    const pDistance = nonNegFinite(p.distance);
    const pDecay = nonNegFinite(p.decay, 2);
    const pAngle = degToRad(clamp(finiteOr(p.angle, 45), 1, 89));
    const pPenumbra = clamp(finiteOr(p.penumbra, 0.3), 0, 1);
    if (!handle) {
      if (p.kind === "spot") {
        const spot = new THREE.SpotLight(p.color, 0, pDistance, pAngle);
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
    writeVec3(handle.light.position, p.at);
    handle.light.intensity = nonNegFinite(practicalIntensityAt(p, t, i));
    handle.light.distance = pDistance;
    handle.light.decay = pDecay;

    if (handle.kind === "spot") {
      const spot = handle.light as THREE.SpotLight;
      spot.angle = pAngle;
      spot.penumbra = pPenumbra;
      if (p.target) writeVec3(spot.target.position, p.target);
      else spot.target.position.set(handle.light.position.x, 0, handle.light.position.z);
      spot.target.updateMatrixWorld();
    }
  }
}

export function applyLightingRig(rig: LightingRig, sample: LightsState, t = 0): void {
  const internal = rig as InternalLightingRig;
  const target: Vec3 = sample.target ?? rig.defaultTarget;

  rig.key.visible = sample.key.enabled;
  rig.key.color.set(sample.key.color);
  rig.key.intensity = sample.key.enabled ? nonNegFinite(sample.key.intensity) : 0;
  rig.key.castShadow = sample.key.enabled && sample.key.castShadow;
  rig.key.shadow.radius = nonNegFinite(sample.key.shadowRadius, DEFAULT_LIGHTS.key.shadowRadius);
  placeDirectional(rig.key, target, sample.key.azimuth, sample.key.elevation, rig.distance);
  internal._syncShadow?.(sample.key.shadowExtent ?? rig.shadowExtent);

  const negScale = sample.fill.negativeFill ? 0.15 : 1;
  const bounceScale = sample.fill.negativeFill ? 0.45 : 1;
  rig.fill.visible = sample.fill.enabled;
  rig.fill.color.set(sample.fill.color);
  rig.fill.intensity = sample.fill.enabled ? nonNegFinite(sample.fill.intensity) * negScale : 0;
  placeDirectional(rig.fill, target, sample.fill.azimuth, sample.fill.elevation, rig.distance);

  rig.rim.visible = sample.rim.enabled;
  rig.rim.color.set(sample.rim.color);
  rig.rim.intensity = sample.rim.enabled ? nonNegFinite(sample.rim.intensity) : 0;
  placeDirectional(rig.rim, target, sample.rim.azimuth, sample.rim.elevation, rig.distance);

  const ambientLevel = nonNegFinite(sample.world.ambientIntensity);
  rig.hemisphere.color.set(sample.world.skyColor);
  rig.hemisphere.groundColor.set(sample.world.groundColor);
  rig.hemisphere.intensity = ambientLevel * 0.65 * bounceScale;
  rig.ambient.color.set(sample.world.skyColor);
  rig.ambient.intensity = ambientLevel * 0.35 * bounceScale;

  internal._syncBg?.(sample.world.background);
  internal._syncFog?.(sample.fog);
  syncPracticals(rig, sample.practicals, t);
}

export interface SetKeySpec {
  enabled?: boolean;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  dir?: Vec3Like;
  from?: Vec3Like;
  azimuth?: number;
  elevation?: number;
  distance?: number;
  castShadow?: boolean;
  shadowExtent?: number;
  shadowRadius?: number;
  shadowNear?: number;
  shadowFar?: number;
}

export interface SetFillSpec {
  enabled?: boolean;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  dir?: Vec3Like;
  from?: Vec3Like;
  azimuth?: number;
  elevation?: number;
  distance?: number;
  negativeFill?: boolean;
}

export interface SetHemiSpec {
  sky?: THREE.ColorRepresentation;
  ground?: THREE.ColorRepresentation;
  intensity?: number;
  ambientIntensity?: number;
}

export type RimMode = "directional" | "camera-back";

export interface SetRimSpec {
  enabled?: boolean;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  mode?: RimMode;
  distance?: number;
  height?: number;
  dir?: Vec3Like;
  from?: Vec3Like;
  azimuth?: number;
  elevation?: number;
}

export interface SetFogSpec {
  mode?: FogMode;
  color?: THREE.ColorRepresentation;
  near?: number;
  far?: number;
  density?: number;
}

export interface SetLightSpec {
  key?: SetKeySpec;
  fill?: SetFillSpec;
  hemi?: SetHemiSpec;
  rim?: SetRimSpec;
  rimMode?: RimMode;
  fog?: SetFogSpec | null;
  background?: THREE.ColorRepresentation | null;
  environment?: THREE.Texture | null;
  environmentIntensity?: number;
  practicals?: PracticalState[];
  godrays?: Partial<GodraysState>;
  t?: number;
}

export interface ApplySetLightOptions {
  t?: number;
  godrays?: GodraysHandle;
}

export function applySetLight(
  rig: LightingRig,
  spec: SetLightSpec,
  focus: Vec3Like = rig.defaultTarget,
  eye?: Vec3Like,
  opts: ApplySetLightOptions = {},
): GodraysState {
  const internal = rig as InternalLightingRig;
  writeVec3(_focus, focus);

  const keyIntensityRaw = nonNegFinite(spec.key?.intensity, DEFAULT_LIGHTS.key.intensity);
  const keyEnabled = spec.key?.enabled ?? keyIntensityRaw > 0;
  rig.key.visible = keyEnabled;
  rig.key.color.set(spec.key?.color ?? DEFAULT_LIGHTS.key.color);
  rig.key.intensity = keyEnabled ? keyIntensityRaw : 0;
  rig.key.castShadow = keyEnabled && (spec.key?.castShadow ?? true);
  rig.key.shadow.radius = nonNegFinite(spec.key?.shadowRadius, DEFAULT_LIGHTS.key.shadowRadius);
  placeDirectionalBySpec(
    rig.key,
    _focus,
    spec.key ?? {},
    DEFAULT_LIGHTS.key.azimuth,
    DEFAULT_LIGHTS.key.elevation,
    rig.distance,
  );
  const keyDist = rig.key.position.distanceTo(rig.key.target.position);
  internal._syncShadow?.(
    spec.key?.shadowExtent ?? rig.shadowExtent,
    spec.key?.shadowNear,
    spec.key?.shadowFar,
    keyDist,
  );

  if (spec.fill) {
    const fillIntensityRaw = nonNegFinite(spec.fill.intensity, DEFAULT_LIGHTS.fill.intensity);
    const fillEnabled = spec.fill.enabled ?? fillIntensityRaw > 0;
    const negScale = spec.fill.negativeFill ? 0.15 : 1;
    rig.fill.visible = fillEnabled;
    rig.fill.color.set(spec.fill.color ?? DEFAULT_LIGHTS.fill.color);
    rig.fill.intensity = fillEnabled ? fillIntensityRaw * negScale : 0;
    placeDirectionalBySpec(
      rig.fill,
      _focus,
      spec.fill,
      DEFAULT_LIGHTS.fill.azimuth,
      DEFAULT_LIGHTS.fill.elevation,
      rig.distance,
    );
  } else {
    rig.fill.visible = false;
    rig.fill.intensity = 0;
  }

  const bounceScale = spec.fill?.negativeFill ? 0.45 : 1;
  const skyColor = spec.hemi?.sky ?? DEFAULT_LIGHTS.world.skyColor;
  const groundColor = spec.hemi?.ground ?? DEFAULT_LIGHTS.world.groundColor;
  rig.hemisphere.color.set(skyColor);
  rig.hemisphere.groundColor.set(groundColor);
  rig.hemisphere.intensity = nonNegFinite(spec.hemi?.intensity, 0.45) * bounceScale;
  rig.ambient.color.set(skyColor);
  rig.ambient.intensity = nonNegFinite(spec.hemi?.ambientIntensity, 0) * bounceScale;

  const rimMode = spec.rim?.mode ?? spec.rimMode ?? "directional";
  const hasRim = spec.rim !== undefined || spec.rimMode !== undefined;
  const rimIntensityRaw = nonNegFinite(
    spec.rim?.intensity,
    hasRim ? DEFAULT_LIGHTS.rim.intensity : 0,
  );
  const rimEnabled = hasRim && (spec.rim?.enabled ?? rimIntensityRaw > 0);
  rig.rim.visible = rimEnabled;
  rig.rim.color.set(spec.rim?.color ?? DEFAULT_LIGHTS.rim.color);
  rig.rim.intensity = rimEnabled ? rimIntensityRaw : 0;
  if (rimMode === "camera-back" && eye) {
    writeVec3(_eye, eye);
    _away.copy(_focus).sub(_eye);
    _away.y = 0;
    if (_away.lengthSq() > 1e-10) _away.normalize();
    else _away.set(0, 0, -1);
    const rimDist = Math.max(0.01, finiteOr(spec.rim?.distance, 20));
    const rimHeight = finiteOr(spec.rim?.height, 5);
    rig.rim.position.copy(_focus).addScaledVector(_away, rimDist);
    rig.rim.position.y += rimHeight;
    rig.rim.target.position.copy(_focus);
    rig.rim.target.updateMatrixWorld();
  } else {
    placeDirectionalBySpec(
      rig.rim,
      _focus,
      spec.rim ?? {},
      DEFAULT_LIGHTS.rim.azimuth,
      DEFAULT_LIGHTS.rim.elevation,
      rig.distance,
    );
  }

  if (spec.environment !== undefined) rig.scene.environment = spec.environment;
  if (spec.environmentIntensity !== undefined && Number.isFinite(spec.environmentIntensity)) {
    rig.scene.environmentIntensity = Math.max(0, spec.environmentIntensity);
  }

  internal._syncBg?.(spec.background ?? null);

  if (spec.fog) {
    const mode: FogMode = spec.fog.mode ?? (spec.fog.density !== undefined ? "exp2" : "linear");
    internal._syncFog?.({
      mode,
      color: spec.fog.color ?? DEFAULT_LIGHTS.fog.color,
      near: spec.fog.near ?? DEFAULT_LIGHTS.fog.near,
      far: spec.fog.far ?? DEFAULT_LIGHTS.fog.far,
      density: spec.fog.density ?? DEFAULT_LIGHTS.fog.density,
    });
  } else {
    internal._syncFog?.({ ...DEFAULT_LIGHTS.fog, mode: "none" });
  }

  syncPracticals(rig, spec.practicals ?? [], opts.t ?? spec.t ?? 0);

  const godraysState: GodraysState = { ...DEFAULT_LIGHTS.godrays, ...spec.godrays };
  opts.godrays?.update(godraysState, `#${rig.key.color.getHexString()}`);
  return godraysState;
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

function computeGodraysValues(state: GodraysState, fallbackColor: string) {
  const weight = Math.max(0, state.weight);
  const density = Math.max(0, state.density * weight);
  const maxDensity = clamp(state.maxDensity * weight, 0, 0.999);
  const distanceAttenuation = Math.max(0, state.edgeStrength);
  const raymarchSteps = clamp(Math.round(state.raymarchSteps), 4, 240);
  const colorHex = state.color ?? fallbackColor;
  const kernel: KernelSize | false = state.blur ? blurKernelFromRadius(state.edgeRadius) : false;
  const variance = kernel !== false ? clamp(state.edgeRadius * 0.05, 0.02, 0.5) : 0;
  const key = `${density}|${maxDensity}|${distanceAttenuation}|${raymarchSteps}|${colorHex}|${kernel}|${variance}`;
  return {
    key,
    kernel,
    density,
    maxDensity,
    distanceAttenuation,
    raymarchSteps,
    colorHex,
    variance,
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
    get pass() {
      return pass;
    },
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
      const illumUniforms = (
        pass as unknown as {
          illumPass?: {
            material?: {
              uniforms?: {
                lightCameraNear?: { value: number };
                lightCameraFar?: { value: number };
              };
            };
          };
        }
      ).illumPass?.material?.uniforms;
      const shadowCam = typedLight.shadow?.camera as { near?: number; far?: number } | undefined;
      if (illumUniforms && shadowCam) {
        if (illumUniforms.lightCameraNear && typeof shadowCam.near === "number") {
          illumUniforms.lightCameraNear.value = shadowCam.near;
        }
        if (illumUniforms.lightCameraFar && typeof shadowCam.far === "number") {
          illumUniforms.lightCameraFar.value = shadowCam.far;
        }
      }
      const next = computeGodraysValues(state, fallbackColor);
      if (next.key === lastKey) return;
      const params: Partial<GodraysPassParams> = {
        density: next.density,
        maxDensity: next.maxDensity,
        distanceAttenuation: next.distanceAttenuation,
        raymarchSteps: next.raymarchSteps,
        color: new THREE.Color(next.colorHex),
        blur: next.kernel !== false ? { kernelSize: next.kernel, variance: next.variance } : false,
        gammaCorrection,
        resolutionScale,
        upsampleQuality,
      };
      try {
        // three-good-godrays@0.12.2 disposes blurPass on setParams without clearing the field.
        if (lastKernel !== next.kernel) {
          const internal = pass as unknown as {
            blurPass?: { dispose?: () => void } | null;
          };
          internal.blurPass?.dispose?.();
          internal.blurPass = null;
        }
        pass.setParams(params);
        lastKey = next.key;
        lastKernel = next.kernel;
      } catch {
        pass.enabled = false;
      }
    },
    dispose() {
      if (!pass) return;
      const internal = pass as unknown as {
        blurRenderTarget?: {
          depthTexture?: { dispose?: () => void } | null;
          dispose?: () => void;
        } | null;
        illumPass?: {
          depthCopyTarget?: {
            depthTexture?: { dispose?: () => void } | null;
            dispose?: () => void;
          } | null;
        } | null;
        compositorPass?: {
          depthCopyTarget?: {
            depthTexture?: { dispose?: () => void } | null;
            dispose?: () => void;
          } | null;
        } | null;
      };
      const disposeRt = (
        rt:
          | { depthTexture?: { dispose?: () => void } | null; dispose?: () => void }
          | null
          | undefined,
      ) => {
        if (!rt) return;
        rt.depthTexture?.dispose?.();
        rt.dispose?.();
      };
      try {
        disposeRt(internal.blurRenderTarget);
        internal.blurRenderTarget = null;
        if (internal.illumPass) {
          disposeRt(internal.illumPass.depthCopyTarget);
          internal.illumPass.depthCopyTarget = null;
        }
        if (internal.compositorPass) {
          disposeRt(internal.compositorPass.depthCopyTarget);
          internal.compositorPass.depthCopyTarget = null;
        }
        pass.dispose();
      } finally {
        pass = null;
        lastKey = "";
        lastKernel = undefined;
      }
    },
  };
}

export type ProceduralEnvironmentPreset =
  | "studio"
  | "outdoor"
  | "night"
  | "interior-warm"
  | "golden-hour"
  | "overcast"
  | "neon-night"
  | "indoor-cool"
  | "underwater"
  | "space"
  | "arctic"
  | "dark-stage"
  | "explainer-teal";
export type EnvironmentPreset = ProceduralEnvironmentPreset | "room";

export interface EnvironmentPanelSpec {
  size: [number, number];
  at: Vec3;
  look: Vec3;
  color: THREE.ColorRepresentation;
  gain?: number;
}

export interface EnvironmentSpec {
  bg: THREE.ColorRepresentation;
  ground?: THREE.ColorRepresentation | null;
  panels: readonly EnvironmentPanelSpec[];
}

export const ENVIRONMENT_PRESETS: Record<ProceduralEnvironmentPreset, EnvironmentSpec> = {
  studio: {
    bg: 0x9aa9b4,
    ground: 0x2e343a,
    panels: [
      { size: [8, 8], at: [0, 6, 0], look: [0, 0, 0], color: 0xffffff, gain: 3.2 },
      { size: [3, 6], at: [-6, 2, 2], look: [0, 1, 0], color: 0xf4f8ff, gain: 1.6 },
      { size: [3, 6], at: [6, 2, -2], look: [0, 1, 0], color: 0xfff5e8, gain: 1.3 },
    ],
  },
  outdoor: {
    bg: 0x89b7e8,
    ground: 0x454a3c,
    panels: [
      { size: [6, 6], at: [5, 8, 4], look: [0, 0, 0], color: 0xfff5dc, gain: 4.5 },
      { size: [10, 6], at: [-6, 4, -4], look: [0, 1, 0], color: 0xc2dfff, gain: 1.4 },
      { size: [8, 4], at: [0, 2, -7], look: [0, 1, 0], color: 0xe6f2ff, gain: 1.1 },
    ],
  },
  night: {
    bg: 0x162033,
    ground: 0x0d1018,
    panels: [
      { size: [6, 6], at: [-4, 7, 3], look: [0, 0, 0], color: 0x7ca6e0, gain: 1.6 },
      { size: [3, 5], at: [6, 2, 2], look: [0, 1, 0], color: 0xffb36b, gain: 1.2 },
      { size: [4, 4], at: [0, 3, -6], look: [0, 1, 0], color: 0x3b5a8a, gain: 0.9 },
    ],
  },
  "interior-warm": {
    bg: 0x4a382b,
    ground: 0x261c15,
    panels: [
      { size: [7, 7], at: [0, 6, 0], look: [0, 0, 0], color: 0xffe4be, gain: 3.4 },
      { size: [4, 5], at: [-6, 2.5, 2], look: [0, 1, 0], color: 0xffcf94, gain: 1.5 },
      { size: [4, 5], at: [6, 2, -2], look: [0, 1, 0], color: 0xd8e2f0, gain: 0.9 },
    ],
  },
  "golden-hour": {
    bg: 0x7c8eb0,
    ground: 0x4d3728,
    panels: [
      { size: [6, 5], at: [-7, 2.8, -5], look: [0, 0.5, 0], color: 0xffbe75, gain: 4.8 },
      { size: [10, 6], at: [5, 5, 4], look: [0, 1, 0], color: 0x9ec4f0, gain: 1.3 },
      { size: [8, 4], at: [0, 2, 7], look: [0, 1, 0], color: 0xffd5a3, gain: 1.2 },
    ],
  },
  overcast: {
    bg: 0xb6c4d1,
    ground: 0x4b4f54,
    panels: [
      { size: [12, 12], at: [0, 8, 0], look: [0, 0, 0], color: 0xeaf1f7, gain: 2.2 },
      { size: [8, 5], at: [-7, 3, 2], look: [0, 1, 0], color: 0xd7e2ec, gain: 1.1 },
      { size: [8, 5], at: [7, 3, -2], look: [0, 1, 0], color: 0xd7e2ec, gain: 1.1 },
    ],
  },
  "neon-night": {
    bg: 0x101326,
    ground: 0x0a0912,
    panels: [
      { size: [4, 6], at: [-6, 3, 2], look: [0, 1, 0], color: 0x4de1ff, gain: 3.0 },
      { size: [4, 6], at: [6, 3, -1], look: [0, 1, 0], color: 0xff4fa8, gain: 2.6 },
      { size: [5, 4], at: [0, 6, -5], look: [0, 1, 0], color: 0x7d6bff, gain: 1.6 },
    ],
  },
  "indoor-cool": {
    bg: 0xbcccd4,
    ground: 0x3b444a,
    panels: [
      { size: [8, 8], at: [0, 7, 0], look: [0, 0, 0], color: 0xf0fbff, gain: 3.1 },
      { size: [5, 4], at: [-6, 2.5, 2], look: [0, 1, 0], color: 0xdaf0f8, gain: 1.4 },
      { size: [5, 4], at: [6, 2.5, -2], look: [0, 1, 0], color: 0xe6f4fa, gain: 1.2 },
    ],
  },
  underwater: {
    bg: 0x155d73,
    ground: 0x0a2936,
    panels: [
      { size: [9, 9], at: [0, 7, 0], look: [0, 0, 0], color: 0x8ef2ff, gain: 3.2 },
      { size: [7, 4], at: [-6, 2, 2], look: [0, 0.5, 0], color: 0x2ba4bf, gain: 1.1 },
      { size: [7, 4], at: [6, 2, -2], look: [0, 0.5, 0], color: 0x1f8aa6, gain: 1.0 },
    ],
  },
  space: {
    bg: 0x03050a,
    ground: 0x020306,
    panels: [
      { size: [3, 3], at: [-7, 4, -5], look: [0, 0, 0], color: 0xffffff, gain: 6.0 },
      { size: [8, 5], at: [6, -2, 5], look: [0, 0, 0], color: 0x4f8ee0, gain: 0.9 },
      { size: [6, 4], at: [0, 6, 6], look: [0, 0, 0], color: 0x1a2844, gain: 0.35 },
    ],
  },
  arctic: {
    bg: 0xc2daf0,
    ground: 0xa4b8cc,
    panels: [
      { size: [7, 7], at: [-5, 6, -4], look: [0, 0, 0], color: 0xf4f9ff, gain: 3.6 },
      { size: [10, 5], at: [6, 3, 4], look: [0, 1, 0], color: 0xbce0ff, gain: 1.6 },
      { size: [10, 4], at: [0, -1, 6], look: [0, 1, 0], color: 0xdcebf7, gain: 1.3 },
    ],
  },
  "dark-stage": {
    bg: 0x12161f,
    ground: 0x090b10,
    panels: [
      { size: [5, 5], at: [0, 7, 1], look: [0, 0, 0], color: 0xfff0d8, gain: 3.0 },
      { size: [3, 5], at: [5, 3, -5], look: [0, 1, 0], color: 0xc4dbff, gain: 1.8 },
      { size: [4, 4], at: [-6, 2, 2], look: [0, 1, 0], color: 0x2c3b54, gain: 0.65 },
    ],
  },
  "explainer-teal": {
    bg: 0x8fb0ba,
    ground: 0x30383e,
    panels: [
      { size: [8, 8], at: [0, 6, 0], look: [0, 0, 0], color: 0xffffff, gain: 3.8 },
      { size: [3, 6], at: [-6, 2, 2], look: [0, 1, 0], color: 0xf4fafc, gain: 1.6 },
      { size: [3, 6], at: [6, 2, -2], look: [0, 1, 0], color: 0xfff7ec, gain: 1.3 },
      { size: [6, 2], at: [-5, -0.5, -1], look: [0, -0.5, 0], color: 0x2aa3b8, gain: 1.1 },
      { size: [6, 2], at: [5, -0.5, 1], look: [0, -0.5, 0], color: 0x2aa3b8, gain: 1.1 },
    ],
  },
};

export interface EnvironmentOptions {
  preset?: EnvironmentPreset;
  spec?: EnvironmentSpec;
  bg?: THREE.ColorRepresentation;
  ground?: THREE.ColorRepresentation | null;
  panels?: readonly EnvironmentPanelSpec[];
  sigma?: number;
}

export interface EnvironmentHandle {
  texture: THREE.Texture;
  dispose: () => void;
}

const VALID_ENV_PRESETS = [...Object.keys(ENVIRONMENT_PRESETS), "room"].join(" | ");

function disposeSceneMeshes(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}

function wrapTargetHandle(target: THREE.WebGLRenderTarget): EnvironmentHandle {
  let active: THREE.WebGLRenderTarget | null = target;
  return {
    texture: target.texture,
    dispose() {
      if (!active) return;
      active.dispose();
      active = null;
    },
  };
}

export function buildEnvironmentScene(
  presetOrSpec: EnvironmentPreset | EnvironmentSpec = "studio",
): THREE.Scene {
  if (presetOrSpec === "room") return new RoomEnvironment();

  const spec =
    typeof presetOrSpec === "string"
      ? Object.hasOwn(ENVIRONMENT_PRESETS, presetOrSpec)
        ? ENVIRONMENT_PRESETS[presetOrSpec]
        : undefined
      : presetOrSpec;

  if (!spec) {
    throw new Error(
      `Unknown environment preset ${JSON.stringify(presetOrSpec)}; expected ${VALID_ENV_PRESETS}`,
    );
  }

  const env = new THREE.Scene();
  env.background = new THREE.Color(spec.bg);
  for (const panel of spec.panels) {
    const color = new THREE.Color(panel.color).multiplyScalar(nonNegFinite(panel.gain, 1));
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(panel.size[0], panel.size[1]),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }),
    );
    mesh.position.set(...panel.at);
    mesh.lookAt(...panel.look);
    env.add(mesh);
  }
  if (spec.ground !== null) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ color: spec.ground ?? 0x2e343a, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    env.add(floor);
  }
  return env;
}

export function createEnvironment(
  renderer: THREE.WebGLRenderer,
  opts: EnvironmentOptions = {},
): EnvironmentHandle {
  const hasOverrides =
    opts.bg !== undefined || opts.ground !== undefined || opts.panels !== undefined;
  let targetSpec: EnvironmentPreset | EnvironmentSpec;
  if (opts.spec) {
    targetSpec = opts.spec;
  } else if (hasOverrides) {
    if (opts.preset !== undefined) {
      if (opts.preset === "room") {
        throw new Error('Environment preset "room" does not accept bg/ground/panels overrides');
      }
      if (!Object.hasOwn(ENVIRONMENT_PRESETS, opts.preset)) {
        throw new Error(
          `Unknown environment preset ${JSON.stringify(opts.preset)}; expected ${VALID_ENV_PRESETS}`,
        );
      }
      const base = ENVIRONMENT_PRESETS[opts.preset];
      targetSpec = {
        bg: opts.bg ?? base.bg,
        ground: opts.ground !== undefined ? opts.ground : base.ground,
        panels: opts.panels ?? base.panels,
      };
    } else {
      targetSpec = {
        bg: opts.bg ?? ENVIRONMENT_PRESETS.studio.bg,
        ground: opts.ground !== undefined ? opts.ground : ENVIRONMENT_PRESETS.studio.ground,
        panels: opts.panels ?? ENVIRONMENT_PRESETS.studio.panels,
      };
    }
  } else {
    targetSpec = opts.preset ?? "studio";
  }

  const envScene = buildEnvironmentScene(targetSpec);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    target = pmrem.fromScene(envScene, nonNegFinite(opts.sigma, 0.04));
  } finally {
    pmrem.dispose();
    if (envScene instanceof RoomEnvironment) envScene.dispose();
    else disposeSceneMeshes(envScene);
  }
  return wrapTargetHandle(target);
}

export interface SkyEnvironmentOptions {
  sigma?: number;
  near?: number;
  far?: number;
  size?: number;
}

export function createSkyEnvironment(
  renderer: THREE.WebGLRenderer,
  skySpec: SkyDomeOptions = {},
  opts: SkyEnvironmentOptions = {},
): EnvironmentHandle {
  const envScene = new THREE.Scene();
  const dome = createSkyDome({ ...skySpec, radius: 50 });
  envScene.add(dome.mesh);
  const sigma = nonNegFinite(opts.sigma, 0.02);
  const near = Math.max(0.001, finiteOr(opts.near, 0.1));
  const far = Math.max(near + 1, finiteOr(opts.far, 100));
  const size = Math.max(16, Math.round(finiteOr(opts.size, 256)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    target = pmrem.fromScene(envScene, sigma, near, far, { size });
  } finally {
    pmrem.dispose();
    dome.dispose();
  }
  return wrapTargetHandle(target);
}

export interface SceneProbeOptions {
  position?: Vec3Like;
  sigma?: number;
  near?: number;
  far?: number;
  size?: number;
}

export function bakeSceneProbe(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  opts: SceneProbeOptions = {},
): EnvironmentHandle {
  const position = new THREE.Vector3();
  if (opts.position) writeVec3(position, opts.position);
  const sigma = nonNegFinite(opts.sigma, 0.02);
  const near = Math.max(0.001, finiteOr(opts.near, 0.05));
  const far = Math.max(near + 1, finiteOr(opts.far, 120));
  const size = Math.max(16, Math.round(finiteOr(opts.size, 256)));
  scene.updateMatrixWorld();
  const pmrem = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    target = pmrem.fromScene(scene, sigma, near, far, { size, position });
  } finally {
    pmrem.dispose();
  }
  return wrapTargetHandle(target);
}

export async function loadHDREnvironment(
  renderer: THREE.WebGLRenderer,
  url: string,
): Promise<EnvironmentHandle> {
  const loader = new HDRLoader();
  const rawTex = await loader.loadAsync(url);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    target = pmrem.fromEquirectangular(rawTex);
  } finally {
    pmrem.dispose();
    rawTex.dispose();
  }
  return wrapTargetHandle(target);
}

let rectAreaLightReady = false;

export interface AreaLightOptions {
  color?: THREE.ColorRepresentation;
  intensity?: number;
  width?: number;
  height?: number;
  at?: Vec3Like;
  lookAt?: Vec3Like;
}

export function createAreaLight(opts: AreaLightOptions = {}): THREE.RectAreaLight {
  if (!rectAreaLightReady) {
    RectAreaLightUniformsLib.init();
    rectAreaLightReady = true;
  }
  const light = new THREE.RectAreaLight(
    opts.color ?? 0xffffff,
    opts.intensity ?? 2,
    opts.width ?? 2,
    opts.height ?? 2,
  );
  if (opts.at) writeVec3(light.position, opts.at);
  if (opts.lookAt) {
    writeVec3(_dir, opts.lookAt);
    light.lookAt(_dir);
  }
  return light;
}
