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
  shadows?: boolean;
  lighting?: LightingOption;
  animate?: boolean;
  display?: DisplayOption;
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

export async function texture(
  sources: AssetsInput,
  name: string,
  opts: { renderer?: ModelRendererApi } = {},
): Promise<THREE.Texture> {
  const colon = name.indexOf(":");
  const path = `assets/${colon >= 0 ? name.slice(0, colon) : "minecraft"}/textures/${name.slice(colon + 1)}.png`;
  const bmr = opts.renderer ?? (await loadBmr());
  if (!bmr.readTexture)
    throw new Error("texture() needs block-model-renderer 2.20 or later (readTexture)");
  const data = await bmr.readTexture(path, sources);
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
