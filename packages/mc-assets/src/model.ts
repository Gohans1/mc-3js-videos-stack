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

export {
  type ModelBounds,
  modelBounds,
  type ModelBoundsOptions,
  type ModelElementLike,
  type ModelElementRotationLike,
  type ModelJsonLike,
  type ModelJsonResolver,
  type ModelJsonResolverAsync,
  type ModelJsonResolverSync,
  type Vec3,
} from "./model-bounds.ts";

const BLOCK_SCALE = 1 / 16;

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
  readTexture?: (path: string, assets: AssetsInput) => Promise<{ image: unknown } | null>;
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
  (cachedBmr ??= (import("block-model-renderer") as unknown as Promise<ModelRendererApi>).catch(
    (err) => {
      cachedBmr = null;
      throw err;
    },
  ));

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
  const stripped = /^block:[^:]*:/.test(trimmed) ? trimmed.slice(6) : trimmed;
  const colon = stripped.indexOf(":");
  const ns = colon >= 0 ? stripped.slice(0, colon) : "minecraft";
  const path = colon >= 0 ? stripped.slice(colon + 1) : stripped;
  if (!ns || !path) {
    throw new Error(`blockModel requires a valid block id, got ${JSON.stringify(raw)}`);
  }
  return stripped;
}

function parseItemInput(raw: string): { ns: string; path: string; isExplicitPath: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("itemModel requires a non-empty item id");
  const stripped = /^item:[^:]*:/.test(trimmed) ? trimmed.slice(5) : trimmed;
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

/**
 * A texture by name through the asset stack (resource packs first, then the jar), e.g. "block/iron_block",
 * "item/sugar" or "mymod:block/x": pixel-sharp, sRGB, repeating, the first frame of an animated one.
 * A new THREE.Texture each call, so its repeat/offset are the caller's own.
 */
export async function texture(
  sources: AssetsInput,
  name: string,
  opts: { renderer?: ModelRendererApi } = {},
): Promise<THREE.Texture> {
  const colon = name.indexOf(":");
  const path = `assets/${colon >= 0 ? name.slice(0, colon) : "minecraft"}/textures/${name.slice(colon + 1)}.png`;
  const bmr = opts.renderer ?? (await loadBmr());
  const data = await bmr.readTexture!(path, sources);
  if (!data) throw new Error(`no texture ${path} in the asset sources`);
  const t = new THREE.Texture(data.image as THREE.Texture["image"]);
  Object.assign(t, {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestMipmapLinearFilter,
    colorSpace: THREE.SRGBColorSpace,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    anisotropy: 8,
  });
  t.needsUpdate = true;
  return t;
}
