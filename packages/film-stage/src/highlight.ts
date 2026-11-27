import * as THREE from "three";

export type HighlightSpan = {
  start: number;
  end: number;
  rampIn?: number;
  rampOut?: number;
  color?: THREE.ColorRepresentation;
  intensity?: number;
};

type EmissiveMaterial = THREE.Material & {
  emissive: THREE.Color;
  emissiveIntensity: number;
};

type Entry = {
  mat: EmissiveMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
};

const isEmissiveMaterial = (mat: THREE.Material): mat is EmissiveMaterial =>
  "emissive" in mat &&
  (mat as { emissive?: unknown }).emissive instanceof THREE.Color &&
  typeof (mat as { emissiveIntensity?: unknown }).emissiveIntensity === "number";

const smooth = (u: number) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

export function pulseEnvelope(
  t: number,
  start: number,
  end: number,
  rampIn = 0.08,
  rampOut = 0.12,
): number {
  if (!Number.isFinite(t) || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const dur = end - start;
  if (dur <= 0 || t < start || t >= end) return 0;
  let rIn = Number.isFinite(rampIn) && rampIn > 0 ? rampIn : 0;
  let rOut = Number.isFinite(rampOut) && rampOut > 0 ? rampOut : 0;
  if (rIn + rOut > dur) {
    const s = dur / (rIn + rOut);
    rIn *= s;
    rOut *= s;
  }
  if (rIn > 0 && t < start + rIn) return smooth((t - start) / rIn);
  if (rOut > 0 && t > end - rOut) return smooth((end - t) / rOut);
  return 1;
}

export function createHighlight(
  root: THREE.Object3D,
  defaults?: { color?: THREE.ColorRepresentation; intensity?: number },
) {
  const defaultColor = new THREE.Color(defaults?.color ?? 0xffe44d);
  const defaultIntensity =
    typeof defaults?.intensity === "number" && Number.isFinite(defaults.intensity)
      ? Math.max(0, defaults.intensity)
      : 0.85;
  const clones = new Map<THREE.Material, THREE.Material>();
  const entries: Entry[] = [];
  const scratch = new THREE.Color();

  const cloneIfEmissive = (mat: THREE.Material): THREE.Material => {
    if (!isEmissiveMaterial(mat)) return mat;
    const existing = clones.get(mat);
    if (existing) return existing;
    const copy = mat.clone() as EmissiveMaterial;
    clones.set(mat, copy);
    entries.push({
      mat: copy,
      baseEmissive: copy.emissive.clone(),
      baseIntensity: copy.emissiveIntensity,
    });
    return copy;
  };

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(cloneIfEmissive);
    } else {
      mesh.material = cloneIfEmissive(mesh.material);
    }
  });

  const set = (k: number, color?: THREE.ColorRepresentation, intensity?: number) => {
    const w = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 0;
    if (w <= 0) {
      for (const e of entries) {
        e.mat.emissive.copy(e.baseEmissive);
        e.mat.emissiveIntensity = e.baseIntensity;
      }
      return;
    }
    const targetColor = color !== undefined ? scratch.set(color) : defaultColor;
    const targetIntensity =
      typeof intensity === "number" && Number.isFinite(intensity)
        ? Math.max(0, intensity)
        : defaultIntensity;
    for (const e of entries) {
      e.mat.emissive.copy(e.baseEmissive).lerp(targetColor, w);
      e.mat.emissiveIntensity = e.baseIntensity + (targetIntensity - e.baseIntensity) * w;
    }
  };

  const apply = (t: number, spans: readonly HighlightSpan[]) => {
    let bestK = 0;
    let bestSpan: HighlightSpan | null = null;
    for (const span of spans) {
      const k = pulseEnvelope(t, span.start, span.end, span.rampIn, span.rampOut);
      if (k > bestK) {
        bestK = k;
        bestSpan = span;
      }
    }
    if (!bestSpan || bestK <= 0) {
      set(0);
      return 0;
    }
    set(bestK, bestSpan.color, bestSpan.intensity);
    return bestK;
  };

  const dispose = () => {
    for (const cloned of clones.values()) cloned.dispose();
    clones.clear();
    entries.length = 0;
  };

  return { set, apply, dispose, count: entries.length };
}

export type OutlineHighlightMode = "outline" | "rim";

export interface OutlineHighlightOptions {
  mode?: OutlineHighlightMode;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  opacity?: number;
  thickness?: number;
  power?: number;
  include?: (mesh: THREE.Mesh) => boolean;
}

export interface OutlineHighlightHandle {
  set: (level: number, color?: THREE.ColorRepresentation, intensity?: number) => void;
  setColor: (color: THREE.ColorRepresentation) => void;
  apply: (t: number, spans: readonly HighlightSpan[]) => number;
  dispose: () => void;
  count: number;
}

const OUTLINE_VERT = `#include <skinning_pars_vertex>
uniform float uThickness;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec3 n = length(objectNormal) > 0.0001 ? normalize(objectNormal) : vec3(0.0, 1.0, 0.0);
  transformed += n * uThickness;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}`;

const OUTLINE_FRAG = `uniform vec3 uColor;
uniform float uIntensity;
uniform float uOpacity;
uniform float uLevel;
void main() {
  float a = clamp(uOpacity * uLevel, 0.0, 1.0);
  if (a < 0.001) discard;
  gl_FragColor = vec4(uColor * uIntensity, a);
}`;

const RIM_VERT = `#include <skinning_pars_vertex>
varying vec3 vNormalView;
varying vec3 vViewPos;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mvPos = modelViewMatrix * vec4(transformed, 1.0);
  vec3 nv = normalMatrix * objectNormal;
  vNormalView = length(nv) > 0.0001 ? normalize(nv) : vec3(0.0, 0.0, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}`;

const RIM_FRAG = `uniform vec3 uColor;
uniform float uIntensity;
uniform float uOpacity;
uniform float uLevel;
uniform float uPower;
varying vec3 vNormalView;
varying vec3 vViewPos;
void main() {
  vec3 n = normalize(vNormalView);
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPos);
  float fresnel = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), max(uPower, 0.1));
  float a = clamp(uOpacity * uLevel * fresnel, 0.0, 1.0);
  if (a < 0.001) discard;
  gl_FragColor = vec4(uColor * uIntensity, a);
}`;

export function createOutlineHighlight(
  root: THREE.Object3D,
  opts: OutlineHighlightOptions = {},
): OutlineHighlightHandle {
  const mode: OutlineHighlightMode = opts.mode ?? "outline";
  const defaultColor = new THREE.Color(opts.color ?? 0xffe44d);
  const intensity =
    typeof opts.intensity === "number" && Number.isFinite(opts.intensity)
      ? Math.max(0, opts.intensity)
      : 1.6;
  const opacity =
    typeof opts.opacity === "number" && Number.isFinite(opts.opacity)
      ? Math.min(1, Math.max(0, opts.opacity))
      : 1;
  const thickness =
    typeof opts.thickness === "number" && Number.isFinite(opts.thickness)
      ? Math.max(0, opts.thickness)
      : 0.025;
  const power =
    typeof opts.power === "number" && Number.isFinite(opts.power) ? Math.max(0.1, opts.power) : 2.5;

  const uColor = { value: defaultColor.clone() };
  const uIntensity = { value: intensity };
  const uOpacity = { value: opacity };
  const uLevel = { value: 0 };
  const uniforms: Record<string, THREE.IUniform> =
    mode === "rim"
      ? { uColor, uIntensity, uOpacity, uLevel, uPower: { value: power } }
      : { uColor, uIntensity, uOpacity, uLevel, uThickness: { value: thickness } };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: mode === "outline" ? THREE.BackSide : THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: mode === "rim",
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    blending: mode === "rim" ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: mode === "rim" ? RIM_VERT : OUTLINE_VERT,
    fragmentShader: mode === "rim" ? RIM_FRAG : OUTLINE_FRAG,
  });

  const sources: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) return;
    if (mesh.userData.__outlineHighlightOverlay) return;
    if (opts.include && !opts.include(mesh)) return;
    sources.push(mesh);
  });

  const overlays: THREE.Mesh[] = [];
  for (const src of sources) {
    let overlay: THREE.Mesh;
    if ((src as THREE.SkinnedMesh).isSkinnedMesh && (src as THREE.SkinnedMesh).skeleton) {
      const skinnedSrc = src as THREE.SkinnedMesh;
      const skinnedOverlay = new THREE.SkinnedMesh(skinnedSrc.geometry, material);
      skinnedOverlay.bindMode = skinnedSrc.bindMode;
      skinnedOverlay.bind(skinnedSrc.skeleton, skinnedSrc.bindMatrix);
      overlay = skinnedOverlay;
    } else {
      overlay = new THREE.Mesh(src.geometry, material);
    }
    overlay.userData.__outlineHighlightOverlay = true;
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    overlay.frustumCulled = src.frustumCulled;
    overlay.visible = false;
    src.add(overlay);
    overlays.push(overlay);
  }

  let disposed = false;

  const setColor = (color: THREE.ColorRepresentation) => {
    defaultColor.set(color);
    uColor.value.copy(defaultColor);
  };

  const set = (level: number, color?: THREE.ColorRepresentation, intensityOverride?: number) => {
    const w = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    uLevel.value = w;
    if (color !== undefined) uColor.value.set(color);
    else uColor.value.copy(defaultColor);
    uIntensity.value =
      typeof intensityOverride === "number" && Number.isFinite(intensityOverride)
        ? Math.max(0, intensityOverride)
        : intensity;
    const show = !disposed && w > 0;
    for (const overlay of overlays) overlay.visible = show;
  };

  const apply = (t: number, spans: readonly HighlightSpan[]) => {
    let bestK = 0;
    let bestSpan: HighlightSpan | null = null;
    for (const span of spans) {
      const k = pulseEnvelope(t, span.start, span.end, span.rampIn, span.rampOut);
      if (k > bestK) {
        bestK = k;
        bestSpan = span;
      }
    }
    if (!bestSpan || bestK <= 0) {
      set(0);
      return 0;
    }
    set(bestK, bestSpan.color ?? defaultColor, bestSpan.intensity);
    return bestK;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const overlay of overlays) overlay.removeFromParent();
    overlays.length = 0;
    material.dispose();
  };

  return { set, setColor, apply, dispose, count: overlays.length };
}
