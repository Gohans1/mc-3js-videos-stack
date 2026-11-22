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
