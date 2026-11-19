import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
  parts?: Array<Record<string, unknown>>;
  meshBoxes?: Array<{ from: [number, number, number]; to: [number, number, number] }>;
}) {
  const calls: {
    parseBlockstate: Array<{ id: string; args?: unknown }>;
    resolveModelData: Array<{ model: unknown }>;
    loadModel: Array<{ model: unknown; args?: unknown }>;
  } = {
    parseBlockstate: [],
    resolveModelData: [],
    loadModel: [],
  };
  let partIdx = 0;

  const renderer: ModelRendererApi = {
    async parseBlockstate(_assets, id, args) {
      calls.parseBlockstate.push({ id, args });
      return (opts?.parts ?? [{ type: "block", model: `${id}` }]) as never;
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

describe("modelBounds", () => {
  test("computes exact block-unit bounds for direct elements", () => {
    const resolveJson = mapResolver({
      "assets/minecraft/models/block/oak_slab.json": {
        elements: [{ from: [0, 0, 0], to: [16, 8, 16] }],
      },
    });
    const b = modelBounds(resolveJson, "minecraft:block/oak_slab");
    expect(b).toEqual({
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

  test("computes accurate AABB for rotated elements (single-axis, rescale, multi-axis, and blockstate rotation)", () => {
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
            rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true },
          },
        ],
      },
      "assets/minecraft/models/block/multi_rot.json": {
        elements: [
          {
            from: [8, 8, 8],
            to: [16, 10, 10],
            rotation: { origin: [8, 8, 8], x: 90, y: 0, z: 0 },
          },
        ],
      },
      "assets/minecraft/models/block/wall_bar.json": {
        elements: [{ from: [0, 0, 0], to: [16, 16, 4] }],
      },
    });

    // 8x8 square rotated 45 deg around Y has diagonal 8*sqrt(2) -> 0.5*sqrt(2) blocks wide
    const post = modelBounds(resolveJson, "minecraft:block/diamond_post")!;
    expect(post).not.toBeNull();
    const expectedSpan = Math.SQRT2 / 2;
    expect(post.size[0]).toBeCloseTo(expectedSpan, 6);
    expect(post.size[1]).toBeCloseTo(1, 6);
    expect(post.size[2]).toBeCloseTo(expectedSpan, 6);
    expect(post.min[0]).toBeCloseTo(0.5 - expectedSpan / 2, 6);
    expect(post.max[0]).toBeCloseTo(0.5 + expectedSpan / 2, 6);

    // Cross-plant with rescale: true expands to full [0..1, 0..1, 0..1] block bounds
    const plant = modelBounds(resolveJson, "minecraft:block/cross_plant")!;
    expect(plant.min[0]).toBeCloseTo(0, 6);
    expect(plant.min[1]).toBeCloseTo(0, 6);
    expect(plant.min[2]).toBeCloseTo(0, 6);
    expect(plant.max[0]).toBeCloseTo(1, 6);
    expect(plant.max[1]).toBeCloseTo(1, 6);
    expect(plant.max[2]).toBeCloseTo(1, 6);

    // Multi-axis 1.21.11 format (x=90 around origin [8,8,8] maps +Y->+Z and +Z->-Y)
    const multi = modelBounds(resolveJson, "minecraft:block/multi_rot")!;
    expect(multi.min[0]).toBeCloseTo(0.5, 6);
    expect(multi.max[0]).toBeCloseTo(1, 6);
    expect(multi.min[1]).toBeCloseTo(6 / 16, 6);
    expect(multi.max[1]).toBeCloseTo(8 / 16, 6);
    expect(multi.min[2]).toBeCloseTo(8 / 16, 6);
    expect(multi.max[2]).toBeCloseTo(10 / 16, 6);

    // Blockstate rotation y: 90 maps north wall (z: 0..4) to east wall (x: 12..16)
    const rotated = modelBounds(resolveJson, "minecraft:block/wall_bar", { y: 90 })!;
    expect(rotated.min[0]).toBeCloseTo(0.75, 6);
    expect(rotated.max[0]).toBeCloseTo(1, 6);
    expect(rotated.min[2]).toBeCloseTo(0, 6);
    expect(rotated.max[2]).toBeCloseTo(1, 6);
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
  test("blockModel assembles multipart blockstates scaled by 1/16 inside a unit-scale holder with configurable shadows", async () => {
    const { renderer, calls } = makeFakeRenderer({
      parts: [
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
    expect(calls.resolveModelData).toHaveLength(2);
    expect(calls.loadModel).toHaveLength(2);
    expect(calls.loadModel[0]?.args).toEqual({
      lighting: "scene",
      animate: false,
      display: {},
    });

    const box = new THREE.Box3().setFromObject(fence);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(1, 5);
    expect(box.min.y).toBeCloseTo(-0.5, 5);
    expect(box.max.y).toBeCloseTo(0.5, 5);

    // Caller scaling the holder must double size rather than overwriting the 1/16 scale
    fence.scale.setScalar(2);
    const doubled = new THREE.Box3().setFromObject(fence).getSize(new THREE.Vector3());
    expect(doubled.y).toBeCloseTo(2, 5);

    const meshes: THREE.Mesh[] = [];
    fence.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.castShadow && m.receiveShadow)).toBe(true);

    // Shadows can be disabled explicitly
    const { renderer: noShadowRenderer } = makeFakeRenderer();
    const unlit = await blockModel(
      [],
      "minecraft:stone",
      {},
      {
        shadows: false,
        renderer: noShadowRenderer,
      },
    );
    const unlitMeshes: THREE.Mesh[] = [];
    unlit.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) unlitMeshes.push(o as THREE.Mesh);
    });
    expect(unlitMeshes).toHaveLength(1);
    expect(unlitMeshes[0]?.castShadow).toBe(false);
    expect(unlitMeshes[0]?.receiveShadow).toBe(false);
  });

  test("itemModel normalizes item ids, scales by (1/16)*size inside a clean holder, and sets shadows", async () => {
    const cases: Array<[string, string]> = [
      ["apple", "minecraft:item/apple"],
      ["minecraft:apple", "minecraft:item/apple"],
      ["item:minecraft:apple", "minecraft:item/apple"],
      ["mod:coffee_mug", "mod:item/coffee_mug"],
      ["mod:item/coffee_mug", "mod:item/coffee_mug"],
      ["mod:block/tray", "mod:block/tray"],
    ];

    for (const [input, expectedModel] of cases) {
      const { renderer, calls } = makeFakeRenderer();
      const holder = await itemModel([], input, 0.5, { renderer });
      expect(holder).toBeInstanceOf(THREE.Group);
      expect(holder.scale.toArray()).toEqual([1, 1, 1]);
      expect(calls.resolveModelData).toEqual([{ model: { model: expectedModel, type: "item" } }]);
      expect(calls.loadModel[0]?.args).toEqual({
        lighting: "scene",
        animate: false,
        display: {},
      });
      const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(0.5, 5);
      expect(size.y).toBeCloseTo(0.5, 5);
      expect(size.z).toBeCloseTo(0.5, 5);
    }

    // Default size = 0.42
    const { renderer: defRenderer } = makeFakeRenderer();
    const defItem = await itemModel([], "minecraft:apple", undefined, { renderer: defRenderer });
    const defSize = new THREE.Box3().setFromObject(defItem).getSize(new THREE.Vector3());
    expect(defSize.y).toBeCloseTo(0.42, 5);
    let sawMesh = false;
    defItem.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        sawMesh = true;
        expect(o.castShadow).toBe(true);
        expect(o.receiveShadow).toBe(true);
      }
    });
    expect(sawMesh).toBe(true);

    // Invalid size or empty id throws crisply
    await expect(itemModel([], "", 0.42, { renderer: defRenderer })).rejects.toThrow();
    await expect(itemModel([], "apple", 0, { renderer: defRenderer })).rejects.toThrow();
  });
});
