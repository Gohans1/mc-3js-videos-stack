import { describe, expect, test } from "bun:test";
import { existsSync, promises as fsPromises, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import zlib from "node:zlib";

import { zipSync } from "fflate";
import * as THREE from "three";

import {
  blockModel,
  itemModel,
  modelBounds,
  type ModelJsonLike,
  type ModelRendererApi,
} from "../src/model";

const GOHANS_PACK_ROOT = resolve(import.meta.dir, "../pack");

function mapResolver(entries: Record<string, ModelJsonLike>) {
  return (path: string) => entries[path] ?? null;
}

function makeFakeRenderer(opts?: {
  blockParts?: Array<Record<string, unknown>>;
  itemParts?: Array<Record<string, unknown> | string>;
  meshBoxes?: Array<{ from: [number, number, number]; to: [number, number, number] }>;
}) {
  const calls: {
    parseBlockstate: Array<{ id: string; args?: unknown }>;
    parseItemDefinition: Array<{ id: string; args?: unknown }>;
    resolveModelData: Array<{ model: unknown }>;
    loadModel: Array<{ model: unknown; args?: unknown }>;
  } = {
    parseBlockstate: [],
    parseItemDefinition: [],
    resolveModelData: [],
    loadModel: [],
  };
  let partIdx = 0;

  const renderer: ModelRendererApi = {
    async parseBlockstate(_assets, id, args) {
      calls.parseBlockstate.push({ id, args });
      return (opts?.blockParts ?? [{ type: "block", model: `${id}` }]) as never;
    },
    async parseItemDefinition(_assets, id, args) {
      calls.parseItemDefinition.push({ id, args });
      return (opts?.itemParts ?? [{ type: "item", model: `${id}` }]) as never;
    },
    async resolveModelData(_assets, model) {
      calls.resolveModelData.push({ model });
      return { resolved: true, input: model } as never;
    },
    async loadModel(_scene, _assets, model, args) {
      calls.loadModel.push({ model, args });
      const box = opts?.meshBoxes?.[partIdx] ?? { from: [0, 0, 0], to: [16, 16, 16] };
      partIdx++;
      const w = box.to[0] - box.from[0];
      const h = box.to[1] - box.from[1];
      const d = box.to[2] - box.from[2];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
      mesh.position.set(box.from[0] + w / 2 - 8, box.from[1] + h / 2 - 8, box.from[2] + d / 2 - 8);
      const group = new THREE.Group();
      group.add(mesh);
      return group;
    },
  };
  return { renderer, calls };
}

class MiniCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  getContext() {
    return {
      canvas: this,
      fillStyle: "#000000",
      globalCompositeOperation: "source-over",
      clearRect: () => {
        this.data.fill(0);
      },
      fillRect: () => {},
      drawImage: (src: MiniCanvas) => {
        if (src?.data) this.data.set(src.data.subarray(0, this.data.length));
      },
      getImageData: (x: number, y: number, w: number, h: number) => {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const si = ((y + py) * this.width + (x + px)) * 4;
            const di = (py * w + px) * 4;
            out[di] = this.data[si] ?? 0;
            out[di + 1] = this.data[si + 1] ?? 0;
            out[di + 2] = this.data[si + 2] ?? 0;
            out[di + 3] = this.data[si + 3] ?? 0;
          }
        }
        return { data: out };
      },
    };
  }
}

async function loadRealBmrCore() {
  const bmrRoot = resolve(import.meta.dir, "../node_modules/block-model-renderer");
  const core = (await import(join(bmrRoot, "src/core.js"))) as ModelRendererApi & {
    setPlatform: (p: Record<string, unknown>) => void;
    prepareAssets: (sources: unknown[], opts?: Record<string, unknown>) => Promise<unknown>;
    zipAssets: (buf: Uint8Array) => Promise<unknown>;
    overridesRole: (name: string) => { role: string; versionBefore?: string } | null;
  };
  const { decodePng, encodeStoredPng } = (await import(join(bmrRoot, "src/core/png.js"))) as {
    decodePng: (buf: Uint8Array) => Promise<{ data: Uint8Array; width: number; height: number }>;
    encodeStoredPng: (data: Uint8Array, w: number, h: number) => Uint8Array;
  };
  const assetsDir = join(bmrRoot, "assets");
  const makeFolder = (dir: string) => ({
    path: dir,
    async read(file: string) {
      try {
        return await fsPromises.readFile(join(dir, file));
      } catch {
        return null;
      }
    },
    async list(sub: string) {
      try {
        return await fsPromises.readdir(join(dir, sub));
      } catch {
        return [];
      }
    },
    filter: [],
  });
  core.setPlatform({
    THREE,
    Canvas: MiniCanvas,
    loadImage: async (d: unknown) => {
      if (d && typeof d === "object" && "width" in d && typeof d.width === "number") return d;
      const png = await decodePng(d as Uint8Array);
      const c = new MiniCanvas(png.width, png.height);
      c.data.set(png.data);
      return c;
    },
    loadTexture: async (img: unknown) => {
      const t = new THREE.Texture(img as HTMLImageElement);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    },
    inflateRaw: (d: Uint8Array) => zlib.inflateRawSync(d),
    prepareEntry: async (e: unknown) =>
      typeof e === "string"
        ? core.zipAssets(await fsPromises.readFile(e))
        : core.zipAssets(e as Uint8Array),
    addBundledEntries: async (arr: Array<Record<string, unknown>>) => {
      for (const name of (await fsPromises.readdir(assetsDir)).toSorted()) {
        const role = core.overridesRole(name);
        if (!role) continue;
        const entry: Record<string, unknown> = makeFolder(join(assetsDir, name));
        entry.bundledOverrides = true;
        entry.overrideRole = role.role;
        if (role.versionBefore) entry.versionBefore = role.versionBefore;
        arr.unshift(entry);
      }
      arr.push(makeFolder(join(assetsDir, "fallbacks")));
    },
    decodeToRaw: (d: Uint8Array) => decodePng(d),
    encodeRawToPng: ({
      data,
      width,
      height,
    }: {
      data: Uint8Array;
      width: number;
      height: number;
    }) => encodeStoredPng(data, width, height),
    getImageSize: async (d: Uint8Array) => {
      const p = await decodePng(d);
      return { width: p.width, height: p.height };
    },
    webgl2: () => false,
    batchedMesh: false,
    maxTextureSize: () => 4096,
  });
  return { core, encodeStoredPng };
}

describe("modelBounds", () => {
  test("computes exact block-unit bounds for direct elements", () => {
    const resolveJson = mapResolver({
      "assets/minecraft/models/block/oak_slab.json": {
        elements: [{ from: [0, 0, 0], to: [16, 8, 16] }],
      },
    });
    expect(modelBounds(resolveJson, "minecraft:block/oak_slab")).toEqual({
      min: [0, 0, 0],
      max: [1, 0.5, 1],
      size: [1, 0.5, 1],
    });
  });

  test("follows multi-level parent inheritance and allows child elements to override parent", () => {
    const resolveJson = mapResolver({
      "assets/mod/models/block/fancy_table.json": {
        parent: "mod:block/base_table",
        textures: { top: "mod:block/oak" },
      },
      "assets/mod/models/block/base_table.json": {
        parent: "block/cube_slab",
      },
      "assets/minecraft/models/block/cube_slab.json": {
        elements: [
          { from: [0, 12, 0], to: [16, 16, 16] },
          { from: [2, 0, 2], to: [4, 12, 4] },
        ],
      },
      "assets/mod/models/block/override_table.json": {
        parent: "mod:block/base_table",
        elements: [{ from: [4, 0, 4], to: [12, 8, 12] }],
      },
      "assets/mod/models/block/empty_override.json": {
        parent: "mod:block/base_table",
        elements: [],
      },
    });

    expect(modelBounds(resolveJson, "mod:block/fancy_table")).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 1],
      size: [1, 1, 1],
    });
    expect(modelBounds(resolveJson, "mod:block/override_table")).toEqual({
      min: [0.25, 0, 0.25],
      max: [0.75, 0.5, 0.75],
      size: [0.5, 0.5, 0.5],
    });
    expect(modelBounds(resolveJson, "mod:block/empty_override")).toBeNull();
  });

  test("matches Three.js AABB for single-axis, rescale (including >90 deg), asymmetric multi-axis, and combined blockstate rotations", () => {
    const resolveJson = mapResolver({
      "assets/minecraft/models/block/diamond_post.json": {
        elements: [
          {
            from: [4, 0, 4],
            to: [12, 16, 12],
            rotation: { origin: [8, 8, 8], axis: "y", angle: 45 },
          },
        ],
      },
      "assets/minecraft/models/block/cross_plant.json": {
        elements: [
          {
            from: [0, 0, 8],
            to: [16, 16, 8],
            rotation: { origin: [8, 8, 8], axis: "y", angle: 135, rescale: true },
          },
        ],
      },
      "assets/minecraft/models/block/asym_multi.json": {
        elements: [
          {
            from: [2, 3, 5],
            to: [14, 9, 11],
            rotation: { origin: [6, 7, 8], x: 30, y: 45, z: 60 },
          },
        ],
      },
      "assets/minecraft/models/block/asym_box.json": {
        elements: [{ from: [0, 0, 0], to: [16, 6, 4] }],
      },
    });

    // 8x8 square rotated 45 deg around Y
    const post = modelBounds(resolveJson, "minecraft:block/diamond_post")!;
    const expectedSpan = Math.SQRT2 / 2;
    expect(post.size[0]).toBeCloseTo(expectedSpan, 6);
    expect(post.size[1]).toBeCloseTo(1, 6);
    expect(post.size[2]).toBeCloseTo(expectedSpan, 6);

    // Rescale at 135 deg folds modulo 90 to 45 deg -> full [0..1] cube bounds
    const plant = modelBounds(resolveJson, "minecraft:block/cross_plant")!;
    expect(plant.min[0]).toBeCloseTo(0, 6);
    expect(plant.max[0]).toBeCloseTo(1, 6);
    expect(plant.min[2]).toBeCloseTo(0, 6);
    expect(plant.max[2]).toBeCloseTo(1, 6);

    // Asymmetric multi-axis { x: 30, y: 45, z: 60 } matches Three.js rotateZ -> rotateY -> rotateX
    const asym = modelBounds(resolveJson, "minecraft:block/asym_multi")!;
    const pivot = new THREE.Vector3(6, 7, 8);
    const rotGroup = new THREE.Group();
    rotGroup.position.copy(pivot);
    rotGroup.rotateZ(THREE.MathUtils.degToRad(60));
    rotGroup.rotateY(THREE.MathUtils.degToRad(45));
    rotGroup.rotateX(THREE.MathUtils.degToRad(30));
    rotGroup.updateMatrixWorld(true);
    const refBox = new THREE.Box3();
    for (const x of [2, 14])
      for (const y of [3, 9])
        for (const z of [5, 11]) {
          const p = new THREE.Vector3(x - pivot.x, y - pivot.y, z - pivot.z).applyMatrix4(
            rotGroup.matrixWorld,
          );
          refBox.expandByPoint(p);
        }
    expect(asym.min[0]).toBeCloseTo(refBox.min.x / 16, 6);
    expect(asym.min[1]).toBeCloseTo(refBox.min.y / 16, 6);
    expect(asym.min[2]).toBeCloseTo(refBox.min.z / 16, 6);
    expect(asym.max[0]).toBeCloseTo(refBox.max.x / 16, 6);
    expect(asym.max[1]).toBeCloseTo(refBox.max.y / 16, 6);
    expect(asym.max[2]).toBeCloseTo(refBox.max.z / 16, 6);

    // Combined blockstate { x: 90, y: 90 } matches Three.js Euler(-90, -90, 0, "ZYX") around [8,8,8]
    const bsRot = modelBounds(resolveJson, "minecraft:block/asym_box", { x: 90, y: 90 })!;
    const bsMat = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(-90), THREE.MathUtils.degToRad(-90), 0, "ZYX"),
    );
    const bsBox = new THREE.Box3();
    for (const x of [0, 16])
      for (const y of [0, 6])
        for (const z of [0, 4]) {
          const p = new THREE.Vector3(x - 8, y - 8, z - 8).applyMatrix4(bsMat).addScalar(8);
          bsBox.expandByPoint(p);
        }
    expect(bsRot.min[0]).toBeCloseTo(bsBox.min.x / 16, 6);
    expect(bsRot.min[1]).toBeCloseTo(bsBox.min.y / 16, 6);
    expect(bsRot.min[2]).toBeCloseTo(bsBox.min.z / 16, 6);
    expect(bsRot.max[0]).toBeCloseTo(bsBox.max.x / 16, 6);
    expect(bsRot.max[1]).toBeCloseTo(bsBox.max.y / 16, 6);
    expect(bsRot.max[2]).toBeCloseTo(bsBox.max.z / 16, 6);

    // Non-finite blockstate rotation values are ignored cleanly without NaN
    const safeNan = modelBounds(resolveJson, "minecraft:block/asym_box", {
      x: Number.NaN,
      y: Infinity,
    })!;
    expect(safeNan).toEqual({
      min: [0, 0, 0],
      max: [1, 6 / 16, 4 / 16],
      size: [1, 6 / 16, 4 / 16],
    });
  });

  test("guards parent cycles and returns null for builtin/generated or missing models", () => {
    const resolveJson = mapResolver({
      "assets/mod/models/block/loop_a.json": { parent: "mod:block/loop_b" },
      "assets/mod/models/block/loop_b.json": { parent: "mod:block/loop_a" },
      "assets/mod/models/block/self.json": { parent: "mod:block/self" },
      "assets/minecraft/models/item/apple.json": {
        parent: "minecraft:item/generated",
        textures: { layer0: "minecraft:item/apple" },
      },
      "assets/minecraft/models/item/generated.json": {
        parent: "builtin/generated",
      },
    });

    expect(modelBounds(resolveJson, "mod:block/loop_a")).toBeNull();
    expect(modelBounds(resolveJson, "mod:block/self")).toBeNull();
    expect(modelBounds(resolveJson, "minecraft:item/apple")).toBeNull();
    expect(modelBounds(resolveJson, "minecraft:block/does_not_exist")).toBeNull();
  });

  test("supports async resolvers and resolves real gohans pack parent inheritance on disk", async () => {
    const diskResolver = (path: string) => {
      const full = join(GOHANS_PACK_ROOT, path);
      return existsSync(full) ? (JSON.parse(readFileSync(full, "utf8")) as ModelJsonLike) : null;
    };
    const syncBounds = modelBounds(diskResolver, "gohans:block/computer_beige");
    const asyncBounds = await modelBounds(
      async (path) => diskResolver(path),
      "gohans:block/computer_beige",
    );
    expect(syncBounds).not.toBeNull();
    expect(asyncBounds).toEqual(syncBounds);
    expect(syncBounds!.size[0]).toBeGreaterThan(0);
    expect(syncBounds!.size[1]).toBeGreaterThan(0);
    expect(syncBounds!.size[2]).toBeGreaterThan(0);
  });
});

describe("blockModel and itemModel", () => {
  test("blockModel passes block placement context for light emission, assembles multiparts at 1/16 scale, and rejects empty id", async () => {
    const { renderer, calls } = makeFakeRenderer({
      blockParts: [
        { type: "block", model: "minecraft:block/oak_fence_post" },
        { type: "block", model: "minecraft:block/oak_fence_side", y: 90 },
      ],
      meshBoxes: [
        { from: [6, 0, 6], to: [10, 16, 10] },
        { from: [7, 6, 0], to: [9, 15, 6] },
      ],
    });

    const fence = await blockModel([], "block:minecraft:oak_fence", { north: true }, { renderer });
    expect(fence).toBeInstanceOf(THREE.Group);
    expect(fence.scale.toArray()).toEqual([1, 1, 1]);
    expect(calls.parseBlockstate).toEqual([
      { id: "minecraft:oak_fence", args: { data: { north: true } } },
    ]);
    expect(calls.loadModel).toHaveLength(2);
    expect(calls.loadModel[0]?.args).toEqual({
      lighting: "scene",
      animate: false,
      display: {},
      block: { id: "minecraft:oak_fence", properties: { north: true } },
    });

    const box = new THREE.Box3().setFromObject(fence);
    expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(1, 5);
    expect(box.min.y).toBeCloseTo(-0.5, 5);
    expect(box.max.y).toBeCloseTo(0.5, 5);

    fence.scale.setScalar(2);
    expect(new THREE.Box3().setFromObject(fence).getSize(new THREE.Vector3()).y).toBeCloseTo(2, 5);

    const meshes: THREE.Mesh[] = [];
    fence.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.castShadow && m.receiveShadow)).toBe(true);

    const { renderer: noShadowRenderer } = makeFakeRenderer();
    const unlit = await blockModel(
      [],
      "minecraft:stone",
      {},
      { shadows: false, renderer: noShadowRenderer },
    );
    unlit.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        expect(o.castShadow).toBe(false);
        expect(o.receiveShadow).toBe(false);
      }
    });

    await expect(blockModel([], "", {}, { renderer: noShadowRenderer })).rejects.toThrow();
    await expect(blockModel([], "   ", {}, { renderer: noShadowRenderer })).rejects.toThrow();
    await expect(
      blockModel([], "minecraft:", {}, { renderer: noShadowRenderer }),
    ).rejects.toThrow();
    await expect(blockModel([], ":stone", {}, { renderer: noShadowRenderer })).rejects.toThrow();
  });

  test("itemModel uses parseItemDefinition for 1.21.4+ bare/composite items, falls back on missing sentinel, and resolves explicit '/' paths directly", async () => {
    // 1. 1.21.4+ composite item returning multiple parts
    const composite = makeFakeRenderer({
      itemParts: [
        { type: "item", model: "minecraft:item/potion_overlay", tints: ["#385dc6"] },
        { type: "item", model: "minecraft:item/potion" },
      ],
    });
    const potion = await itemModel([], "item:minecraft:potion", 0.5, {
      renderer: composite.renderer,
    });
    expect(composite.calls.parseItemDefinition).toEqual([
      { id: "minecraft:potion", args: { display: {} } },
    ]);
    expect(composite.calls.resolveModelData).toHaveLength(2);
    expect(composite.calls.loadModel).toHaveLength(2);
    expect(potion.scale.toArray()).toEqual([1, 1, 1]);
    expect(new THREE.Box3().setFromObject(potion).getSize(new THREE.Vector3()).y).toBeCloseTo(
      0.5,
      5,
    );

    // 2. Legacy 1.20.1 mod item without items/<id>.json: parseItemDefinition returns missing sentinel -> falls back to mod:item/<id>
    const legacy = makeFakeRenderer({
      itemParts: [{ type: "item", model: "block-model-renderer:missing" }],
    });
    const mug = await itemModel([], "mod:coffee_mug", undefined, { renderer: legacy.renderer });
    expect(legacy.calls.parseItemDefinition).toEqual([
      { id: "mod:coffee_mug", args: { display: {} } },
    ]);
    expect(legacy.calls.resolveModelData).toEqual([
      { model: { model: "mod:item/coffee_mug", type: "item" } },
    ]);
    expect(new THREE.Box3().setFromObject(mug).getSize(new THREE.Vector3()).y).toBeCloseTo(0.42, 5);

    // 3. Explicit model path containing '/' bypasses parseItemDefinition
    for (const [input, expected] of [
      ["mod:block/tray", "mod:block/tray"],
      ["mod:item/coffee_mug", "mod:item/coffee_mug"],
      ["item/apple", "minecraft:item/apple"],
    ] as const) {
      const explicit = makeFakeRenderer();
      await itemModel([], input, 0.4, { renderer: explicit.renderer });
      expect(explicit.calls.parseItemDefinition).toHaveLength(0);
      expect(explicit.calls.resolveModelData).toEqual([
        { model: { model: expected, type: "item" } },
      ]);
    }

    await expect(itemModel([], "", 0.42, { renderer: legacy.renderer })).rejects.toThrow();
    await expect(
      itemModel([], "minecraft:", 0.42, { renderer: legacy.renderer }),
    ).rejects.toThrow();
    await expect(itemModel([], "apple", 0, { renderer: legacy.renderer })).rejects.toThrow();
  });

  const vaultJarPath = process.env.MC_VAULT_ROOT
    ? join(process.env.MC_VAULT_ROOT, "jar/client_assets.zip")
    : null;

  test.skipIf(!vaultJarPath || !existsSync(vaultJarPath))(
    "real block-model-renderer core loads MC 1.21.11 emissive blocks, 1.21.4+ items, and legacy mod items",
    async () => {
      const jarPath = vaultJarPath!;
      const { core, encodeStoredPng } = await loadRealBmrCore();
      const whitePx = encodeStoredPng(new Uint8Array([255, 255, 255, 255]), 1, 1);
      const enc = new TextEncoder();
      const legacyModZip = zipSync({
        "assets/testmod/models/item/legacy_mug.json": enc.encode(
          JSON.stringify({
            elements: [
              {
                from: [4, 0, 4],
                to: [12, 10, 12],
                faces: {
                  up: { texture: "#all" },
                  north: { texture: "#all" },
                  south: { texture: "#all" },
                  east: { texture: "#all" },
                  west: { texture: "#all" },
                  down: { texture: "#all" },
                },
              },
            ],
            textures: { all: "testmod:item/mug" },
          }),
        ),
        "assets/testmod/textures/item/mug.png": whitePx,
      });
      // Pin version "1.21.11" so parseItemDefinition returns the missing sentinel for legacy_mug and exercises isMissingSentinel end-to-end
      const sources = await core.prepareAssets([legacyModZip, jarPath], {
        cache: true,
        version: "1.21.11",
      });

      const hasEmission = (group: THREE.Object3D) => {
        let found = false;
        group.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh) return;
          const mats = Array.isArray((o as THREE.Mesh).material)
            ? ((o as THREE.Mesh).material as THREE.MeshStandardMaterial[])
            : [(o as THREE.Mesh).material as THREE.MeshStandardMaterial];
          for (const m of mats) {
            if (m?.emissiveMap && m.emissive && m.emissive.getHex() !== 0) found = true;
          }
        });
        return found;
      };

      const hasMissing = (group: THREE.Object3D) => {
        let missing = false;
        group.traverse((o) => {
          const m = o.userData?.model;
          if (typeof m === "string" && m.includes("missing")) {
            missing = true;
            return;
          }
          if (m && typeof m === "object") {
            const modelObj = m as {
              model?: string;
              elements?: Array<{ faces?: Record<string, { texture?: string }> }>;
            };
            if (typeof modelObj.model === "string" && modelObj.model.includes("missing")) {
              missing = true;
              return;
            }
            if (
              Array.isArray(modelObj.elements) &&
              modelObj.elements.some((el) =>
                Object.values(el?.faces ?? {}).some((f) => f?.texture === "#missing"),
              )
            ) {
              missing = true;
            }
          }
        });
        return missing;
      };

      // Negative control: prove hasMissing catches missing items on real block-model-renderer
      expect(
        hasMissing(
          await itemModel(sources as never, "minecraft:nonexistent_item_xyz", 0.42, {
            renderer: core,
          }),
        ),
      ).toBe(true);

      // Emissive block preservation via block placement context
      const lantern = await blockModel(
        sources as never,
        "minecraft:lantern",
        {},
        { renderer: core },
      );
      const litLamp = await blockModel(
        sources as never,
        "minecraft:redstone_lamp",
        { lit: true },
        { renderer: core },
      );
      const offLamp = await blockModel(
        sources as never,
        "minecraft:redstone_lamp",
        { lit: false },
        { renderer: core },
      );
      expect(hasEmission(lantern)).toBe(true);
      expect(hasEmission(litLamp)).toBe(true);
      expect(hasEmission(offLamp)).toBe(false);

      // 1.21.4+ items resolved via parseItemDefinition (block-item, extruded, special, tinted)
      for (const id of [
        "minecraft:oak_planks",
        "minecraft:apple",
        "minecraft:chest",
        "minecraft:compass",
        "minecraft:potion",
        "minecraft:shield",
      ]) {
        const g = await itemModel(sources as never, id, 0.42, { renderer: core });
        expect(hasMissing(g), `${id} should not resolve to missing model`).toBe(false);
        const sz = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
        expect(sz.x, `${id} width`).toBeGreaterThan(0.1);
        expect(sz.y, `${id} height`).toBeGreaterThan(0.1);
        expect(sz.z, `${id} depth`).toBeGreaterThan(0.01);
      }

      // Legacy 1.20.1 mod item without items/<id>.json falls back cleanly to models/item/<id>.json under pinned 1.21.11
      const mug = await itemModel(sources as never, "testmod:legacy_mug", 0.5, { renderer: core });
      expect(hasMissing(mug)).toBe(false);
      const mugSize = new THREE.Box3().setFromObject(mug).getSize(new THREE.Vector3());
      expect(mugSize.x).toBeCloseTo(0.25, 4);
      expect(mugSize.y).toBeCloseTo((10 / 16) * 0.5, 4);
      expect(mugSize.z).toBeCloseTo(0.25, 4);
    },
  );
});
