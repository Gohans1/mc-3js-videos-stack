import type {
  AssetsInput,
  DisplayOption,
  LightingOption,
  LoadModelArgs,
  ModelReference,
  ParseBlockstateArgs,
  ParseItemDefinitionArgs,
  ResolvedModel,
} from "block-model-renderer";
import * as THREE from "three";

const BLOCK_SCALE = 1 / 16;
const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export interface ModelBounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

export interface ModelElementRotationLike {
  origin?: number[];
  axis?: string;
  angle?: number;
  x?: number;
  y?: number;
  z?: number;
  rescale?: boolean;
}

export interface ModelElementLike {
  from?: number[];
  to?: number[];
  rotation?: ModelElementRotationLike;
}

export interface ModelJsonLike {
  parent?: string;
  elements?: ModelElementLike[];
}

export type ModelJsonResolverSync = (path: string) => ModelJsonLike | null | undefined;
export type ModelJsonResolverAsync = (path: string) => Promise<ModelJsonLike | null | undefined>;
export type ModelJsonResolver = (
  path: string,
) => ModelJsonLike | null | undefined | Promise<ModelJsonLike | null | undefined>;

export interface ModelBoundsOptions {
  /** Blockstate X rotation in degrees (applied around block center [8, 8, 8]). */
  x?: number;
  /** Blockstate Y rotation in degrees (applied around block center [8, 8, 8]). */
  y?: number;
  /** Blockstate Z rotation in degrees (applied around block center [8, 8, 8]). */
  z?: number;
}

export interface ModelRendererApi {
  parseBlockstate: (
    assets: AssetsInput,
    id: string,
    args?: ParseBlockstateArgs,
  ) => Promise<ModelReference[]>;
  parseItemDefinition: (
    assets: AssetsInput,
    id: string,
    args?: ParseItemDefinitionArgs,
  ) => Promise<ModelReference[]>;
  resolveModelData: (assets: AssetsInput, model: ModelReference | string) => Promise<ResolvedModel>;
  loadModel: (
    scene: THREE.Object3D | null,
    assets: AssetsInput,
    model: ResolvedModel,
    args?: LoadModelArgs,
  ) => Promise<THREE.Group>;
}

export interface ModelLoadOptions {
  /** Enable castShadow & receiveShadow on built meshes. Default: true. */
  shadows?: boolean;
  /** block-model-renderer lighting mode. Default: "scene". */
  lighting?: LightingOption;
  /** Attach automatic texture animation loops. Default: false (deterministic draw(t)). */
  animate?: boolean;
  /** Display transform override. Default: {} (unrotated model space, no GUI tilt). */
  display?: DisplayOption;
  /** Optional block-model-renderer API override (for testing without WebGL/native gl). */
  renderer?: ModelRendererApi;
}

let cachedBmr: Promise<ModelRendererApi> | null = null;
const loadBmr = (): Promise<ModelRendererApi> =>
  (cachedBmr ??= import("block-model-renderer") as unknown as Promise<ModelRendererApi>);

function applyShadows(root: THREE.Object3D, shadows: boolean): void {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = shadows;
      obj.receiveShadow = shadows;
    }
  });
}

function normalizeBlockId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("blockModel requires a non-empty block id");
  return /^block:[^:]+:.+/.test(trimmed) ? trimmed.slice(6) : trimmed;
}

function parseItemInput(raw: string): { ns: string; path: string; isExplicitPath: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("itemModel requires a non-empty item id");
  const stripped = /^item:[^:]+:.+/.test(trimmed) ? trimmed.slice(5) : trimmed;
  const colon = stripped.indexOf(":");
  const ns = colon >= 0 ? stripped.slice(0, colon) : "minecraft";
  const path = colon >= 0 ? stripped.slice(colon + 1) : stripped;
  if (!ns || !path)
    throw new Error(`itemModel requires a valid item id, got ${JSON.stringify(raw)}`);
  return { ns, path, isExplicitPath: path.includes("/") };
}

function isMissingSentinel(parts: ModelReference[]): boolean {
  if (parts.length !== 1) return false;
  const first = parts[0];
  const model = typeof first === "string" ? first : first?.model;
  return model === "block-model-renderer:missing" || model === "block-model-renderer:missing.json";
}

/**
 * Loads a standalone Minecraft block (all blockstate parts) as a Three.js Group.
 * Scaled by 1/16 inside a unit-scale holder (1 block = 1 m centered on origin)
 * so caller transforms never fight the 1/16 pixel scale.
 */
export async function blockModel(
  sources: AssetsInput,
  id: string,
  properties: Record<string, string | number | boolean> = {},
  opts: ModelLoadOptions = {},
): Promise<THREE.Group> {
  const blockId = normalizeBlockId(id);
  const bmr = opts.renderer ?? (await loadBmr());
  const parts = await bmr.parseBlockstate(sources, blockId, { data: properties });
  const holder = new THREE.Group();
  holder.name = blockId;
  const inner = new THREE.Group();
  inner.scale.setScalar(BLOCK_SCALE);
  holder.add(inner);

  const loadArgs: LoadModelArgs = {
    lighting: opts.lighting ?? "scene",
    animate: opts.animate ?? false,
    display: opts.display ?? {},
    block: { id: blockId, properties },
  };
  for (const part of parts) {
    const resolved = await bmr.resolveModelData(sources, part);
    const group = await bmr.loadModel(null, sources, resolved, loadArgs);
    inner.add(group);
  }
  applyShadows(inner, opts.shadows ?? true);
  return holder;
}

/**
 * Loads a standalone Minecraft item (1.21.4+ item definitions, composite/special items,
 * legacy mod models, and extruded 3D builtin/generated sprites) scaled by (1/16) * size
 * inside a unit-scale holder Group.
 */
export async function itemModel(
  sources: AssetsInput,
  id: string,
  size = 0.42,
  opts: ModelLoadOptions = {},
): Promise<THREE.Group> {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`itemModel size must be a positive number, got ${size}`);
  }
  const { ns, path, isExplicitPath } = parseItemInput(id);
  const bmr = opts.renderer ?? (await loadBmr());
  const loadArgs: LoadModelArgs = {
    lighting: opts.lighting ?? "scene",
    animate: opts.animate ?? false,
    display: opts.display ?? {},
  };

  const holderName = `${ns}:${path}`;
  let parts: ModelReference[];
  if (isExplicitPath) {
    parts = [{ model: holderName, type: "item" }];
  } else {
    const parsed = await bmr.parseItemDefinition(sources, holderName, {
      display: loadArgs.display,
    });
    parts = isMissingSentinel(parsed) ? [{ model: `${ns}:item/${path}`, type: "item" }] : parsed;
  }

  const holder = new THREE.Group();
  holder.name = holderName;
  const inner = new THREE.Group();
  inner.scale.setScalar(BLOCK_SCALE * size);
  for (const part of parts) {
    const resolved = await bmr.resolveModelData(sources, part);
    const loaded = await bmr.loadModel(null, sources, resolved, loadArgs);
    inner.add(loaded);
  }
  applyShadows(inner, opts.shadows ?? true);
  holder.add(inner);
  return holder;
}

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length >= 3 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    typeof v[2] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

function isThenable<T>(v: unknown): v is PromiseLike<T> {
  return (
    !!v &&
    (typeof v === "object" || typeof v === "function") &&
    "then" in v &&
    typeof v.then === "function"
  );
}

function modelRefToPath(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("builtin/") || trimmed.startsWith("minecraft:builtin/")) {
    return null;
  }
  if (/^assets\/[^/]+\/models\/.+\.json$/.test(trimmed)) return trimmed;
  const colon = trimmed.indexOf(":");
  const ns = colon >= 0 ? trimmed.slice(0, colon) : "minecraft";
  const path = colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
  if (!ns || !path || ns === "builtin") return null;
  return `assets/${ns}/models/${path}.json`;
}

function rotateAxis(x: number, y: number, z: number, axis: "x" | "y" | "z", deg: number): Vec3 {
  const rad = deg * DEG;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  if (axis === "x") return [x, y * c - z * s, y * s + z * c];
  if (axis === "y") return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

function cleanZero(n: number): number {
  return Math.abs(n) < 1e-12 ? 0 : n;
}

function computeElementsBounds(
  elements: ModelElementLike[],
  opts?: ModelBoundsOptions,
): ModelBounds | null {
  if (!elements.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let sawPoint = false;

  const bsX = typeof opts?.x === "number" && Number.isFinite(opts.x) ? opts.x : 0;
  const bsY = typeof opts?.y === "number" && Number.isFinite(opts.y) ? opts.y : 0;
  const bsZ = typeof opts?.z === "number" && Number.isFinite(opts.z) ? opts.z : 0;
  const hasBlockRot = Boolean(bsX || bsY || bsZ);

  for (const el of elements) {
    if (!isVec3(el?.from) || !isVec3(el?.to)) continue;
    const x0 = Math.min(el.from[0], el.to[0]);
    const x1 = Math.max(el.from[0], el.to[0]);
    const y0 = Math.min(el.from[1], el.to[1]);
    const y1 = Math.max(el.from[1], el.to[1]);
    const z0 = Math.min(el.from[2], el.to[2]);
    const z1 = Math.max(el.from[2], el.to[2]);

    const rot = el.rotation;
    const origin: Vec3 = rot && isVec3(rot.origin) ? rot.origin : [8, 8, 8];

    let rescaleAxis: "x" | "y" | "z" | null = null;
    let rescaleFactor = 1;
    if (rot?.rescale) {
      let angle: number | undefined;
      if (
        (rot.axis === "x" || rot.axis === "y" || rot.axis === "z") &&
        typeof rot.angle === "number" &&
        Number.isFinite(rot.angle)
      ) {
        rescaleAxis = rot.axis;
        angle = rot.angle;
      } else {
        for (const a of ["x", "y", "z"] as const) {
          const v = rot[a];
          if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
            rescaleAxis = a;
            angle = v;
            break;
          }
        }
      }
      if (angle) {
        const abs = Math.abs(angle) % 90;
        const eff = abs > 45 ? 90 - abs : abs;
        const cos = Math.cos(eff * DEG);
        if (Math.abs(cos) > 1e-6) rescaleFactor = 1 / cos;
      }
    }

    for (const cx of [x0, x1]) {
      for (const cy of [y0, y1]) {
        for (const cz of [z0, z1]) {
          let px = cx;
          let py = cy;
          let pz = cz;

          if (rot) {
            px -= origin[0];
            py -= origin[1];
            pz -= origin[2];

            if (rescaleAxis && rescaleFactor !== 1) {
              if (rescaleAxis !== "x") px *= rescaleFactor;
              if (rescaleAxis !== "y") py *= rescaleFactor;
              if (rescaleAxis !== "z") pz *= rescaleFactor;
            }

            if (
              (rot.axis === "x" || rot.axis === "y" || rot.axis === "z") &&
              typeof rot.angle === "number" &&
              Number.isFinite(rot.angle)
            ) {
              [px, py, pz] = rotateAxis(px, py, pz, rot.axis, rot.angle);
            } else {
              // Matches block-model-renderer multi-axis order: rotateZ -> rotateY -> rotateX
              if (typeof rot.x === "number" && Number.isFinite(rot.x) && rot.x !== 0) {
                [px, py, pz] = rotateAxis(px, py, pz, "x", rot.x);
              }
              if (typeof rot.y === "number" && Number.isFinite(rot.y) && rot.y !== 0) {
                [px, py, pz] = rotateAxis(px, py, pz, "y", rot.y);
              }
              if (typeof rot.z === "number" && Number.isFinite(rot.z) && rot.z !== 0) {
                [px, py, pz] = rotateAxis(px, py, pz, "z", rot.z);
              }
            }

            px += origin[0];
            py += origin[1];
            pz += origin[2];
          }

          if (hasBlockRot) {
            // Matches block-model-renderer Euler(-x, -y, z, "ZYX") around block center [8, 8, 8]
            px -= 8;
            py -= 8;
            pz -= 8;
            if (bsX) [px, py, pz] = rotateAxis(px, py, pz, "x", -bsX);
            if (bsY) [px, py, pz] = rotateAxis(px, py, pz, "y", -bsY);
            if (bsZ) [px, py, pz] = rotateAxis(px, py, pz, "z", bsZ);
            px += 8;
            py += 8;
            pz += 8;
          }

          sawPoint = true;
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (pz < minZ) minZ = pz;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
          if (pz > maxZ) maxZ = pz;
        }
      }
    }
  }

  if (!sawPoint) return null;
  const min: Vec3 = [
    cleanZero(minX * BLOCK_SCALE),
    cleanZero(minY * BLOCK_SCALE),
    cleanZero(minZ * BLOCK_SCALE),
  ];
  const max: Vec3 = [
    cleanZero(maxX * BLOCK_SCALE),
    cleanZero(maxY * BLOCK_SCALE),
    cleanZero(maxZ * BLOCK_SCALE),
  ];
  const size: Vec3 = [
    cleanZero((maxX - minX) * BLOCK_SCALE),
    cleanZero((maxY - minY) * BLOCK_SCALE),
    cleanZero((maxZ - minZ) * BLOCK_SCALE),
  ];
  return { min, max, size };
}

/**
 * Follows Minecraft model JSON `parent` inheritance (with cycle guard) to find `elements`
 * and computes their AABB in block units (1/16 of 0..16 pixel space).
 * Sync when `resolveJson` returns synchronously; returns a Promise when `resolveJson` is async.
 */
export function modelBounds(
  resolveJson: ModelJsonResolverSync,
  modelRef: string,
  opts?: ModelBoundsOptions,
): ModelBounds | null;
export function modelBounds(
  resolveJson: ModelJsonResolverAsync,
  modelRef: string,
  opts?: ModelBoundsOptions,
): Promise<ModelBounds | null>;
export function modelBounds(
  resolveJson: ModelJsonResolver,
  modelRef: string,
  opts?: ModelBoundsOptions,
): ModelBounds | null | Promise<ModelBounds | null>;
export function modelBounds(
  resolveJson: ModelJsonResolver,
  modelRef: string,
  opts?: ModelBoundsOptions,
): ModelBounds | null | Promise<ModelBounds | null> {
  const visited = new Set<string>();

  const finishAsync = async (
    firstPromise: PromiseLike<ModelJsonLike | null | undefined>,
  ): Promise<ModelBounds | null> => {
    let json = await firstPromise;
    while (json && typeof json === "object") {
      if (Array.isArray(json.elements)) return computeElementsBounds(json.elements, opts);
      if (typeof json.parent !== "string") return null;
      const nextPath = modelRefToPath(json.parent);
      if (!nextPath || visited.has(nextPath)) return null;
      visited.add(nextPath);
      json = await resolveJson(nextPath);
    }
    return null;
  };

  let ref: string | undefined = modelRef;
  while (ref) {
    const path = modelRefToPath(ref);
    if (!path || visited.has(path)) return null;
    visited.add(path);
    const loaded = resolveJson(path);
    if (isThenable<ModelJsonLike | null | undefined>(loaded)) {
      return finishAsync(loaded);
    }
    if (!loaded || typeof loaded !== "object") return null;
    if (Array.isArray(loaded.elements)) return computeElementsBounds(loaded.elements, opts);
    ref = typeof loaded.parent === "string" ? loaded.parent : undefined;
  }
  return null;
}
