import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import type { ModelRendererApi } from "../src/model";
import {
  blockHardness,
  breakPlan,
  crackStage,
  decalUv,
  type MiningTags,
  miningTags,
} from "../src/mining";

const TAGS: Record<string, string[]> = {
  "mineable/pickaxe": ["minecraft:stone", "minecraft:obsidian", "#minecraft:ores"],
  ores: ["minecraft:diamond_ore"],
  "mineable/shovel": ["minecraft:dirt"],
  "mineable/axe": ["minecraft:oak_planks"],
  "mineable/hoe": ["#minecraft:leaves"],
  leaves: ["minecraft:oak_leaves"],
  needs_diamond_tool: ["minecraft:obsidian"],
  needs_iron_tool: ["minecraft:diamond_ore"],
  incorrect_for_wooden_tool: [
    "#minecraft:needs_diamond_tool",
    "#minecraft:needs_iron_tool",
    "minecraft:iron_ore",
  ],
  incorrect_for_iron_tool: ["#minecraft:needs_diamond_tool"],
  sword_efficient: ["#minecraft:leaves"],
  sword_instantly_mines: ["minecraft:bamboo"],
  shears_extreme_breaking_speed: ["#minecraft:leaves"],
  shears_major_breaking_speed: ["minecraft:white_wool"],
};

const fakeTags = (): ModelRendererApi =>
  ({
    async readFile(path: string) {
      const m = /^data\/minecraft\/tags\/block\/(.+)\.json$/.exec(path);
      const values = m ? TAGS[m[1]!] : undefined;
      return values ? new TextEncoder().encode(JSON.stringify({ values })) : undefined;
    },
  }) as unknown as ModelRendererApi;

let tags: MiningTags;
const plan = async (block: string, opts: Parameters<typeof breakPlan>[2] = {}) => {
  tags ??= await miningTags([], { renderer: fakeTags() });
  return breakPlan(block, tags, opts);
};

describe("block hardness (Blocks, read from the game's code)", () => {
  test("covers the dyed and weathered families by their real ids", () => {
    expect(blockHardness("stone")).toBe(1.5);
    expect(blockHardness("minecraft:obsidian")).toBe(50);
    expect(blockHardness("black_terracotta")).toBe(1.25);
    expect(blockHardness("lime_wool")).toBe(0.8);
    expect(blockHardness("waxed_oxidized_cut_copper_stairs")).toBe(3);
    expect(blockHardness("infested_stone")).toBe(0.75);
    expect(blockHardness("bedrock")).toBe(-1);
    expect(blockHardness("not_a_block")).toBeUndefined();
  });
});

describe("break time (BlockBehaviour.getDestroyProgress, Player.getDestroySpeed)", () => {
  test("bare hands dig dirt in 15 ticks but need about 150 for stone, which wants a pickaxe", async () => {
    expect((await plan("dirt")).ticks).toBe(15);
    expect((await plan("stone")).ticks).toBeGreaterThanOrEqual(150);
  });

  test("progress adds up in 32-bit floats, so a step that divides 1 exactly can need one tick more", async () => {
    const stone = await plan("stone");
    expect(stone.perTick).toBe(Math.fround(Math.fround(1 / 1.5) / 100));
    expect(stone.ticks).toBe(151);
    expect(stone.progressAt(150)).toBeLessThan(1);
  });

  test("the right pickaxe tier works at full pace, a lower tier at the hand's penalty", async () => {
    expect((await plan("stone", { tool: "wooden_pickaxe" })).ticks).toBe(23);
    expect((await plan("obsidian", { tool: "diamond_pickaxe" })).ticks).toBe(188);
    expect((await plan("obsidian", { tool: "iron_pickaxe" })).ticks).toBe(834);
    expect((await plan("diamond_ore", { tool: "stone_pickaxe" })).ticks).toBe(
      Math.ceil(1 / (4 / 3 / 30)),
    );
    expect((await plan("diamond_ore", { tool: "wooden_pickaxe" })).ticks).toBe(151);
  });

  test("a tool on blocks outside its tag works like a hand", async () => {
    expect((await plan("dirt", { tool: "diamond_pickaxe" })).ticks).toBe(15);
    expect((await plan("dirt", { tool: "wooden_shovel" })).ticks).toBe(8);
  });

  test("efficiency adds level squared plus one, haste and fatigue scale it, and fast enough is instant", async () => {
    expect((await plan("stone", { tool: "diamond_pickaxe", efficiency: 5 })).ticks).toBe(2);
    expect((await plan("stone", { tool: "diamond_pickaxe", efficiency: 5, haste: 2 })).ticks).toBe(
      0,
    );
    expect((await plan("dirt", { efficiency: 5 })).ticks).toBe(15);
    expect((await plan("stone", { tool: "diamond_pickaxe", miningFatigue: 1 })).ticks).toBe(
      Math.ceil(1 / ((8 * 0.3) / 45)),
    );
  });

  test("underwater and off the ground each slow digging fivefold", async () => {
    expect((await plan("stone", { tool: "diamond_pickaxe" })).ticks).toBe(6);
    expect((await plan("stone", { tool: "diamond_pickaxe", underwater: true })).ticks).toBe(29);
    expect(
      (await plan("stone", { tool: "diamond_pickaxe", underwater: true, aquaAffinity: true })).ticks,
    ).toBe(6);
    expect(
      (await plan("stone", { tool: "diamond_pickaxe", underwater: true, onGround: false })).ticks,
    ).toBe(141);
  });

  test("swords and shears follow their own block rules", async () => {
    expect((await plan("bamboo", { tool: "wooden_sword" })).ticks).toBe(0);
    expect((await plan("oak_leaves", { tool: "iron_sword" })).ticks).toBe(
      Math.ceil(1 / (1.5 / 0.2 / 30)),
    );
    expect((await plan("oak_leaves", { tool: "shears" })).ticks).toBe(0);
    expect((await plan("white_wool", { tool: "shears" })).ticks).toBe(
      Math.ceil(1 / (5 / 0.8 / 30)),
    );
  });

  test("unbreakable blocks never break and instant ones break on the first tick", async () => {
    expect((await plan("bedrock", { tool: "netherite_pickaxe" })).ticks).toBe(Infinity);
    expect((await plan("tnt")).ticks).toBe(0);
  });

  test("an explicit hardness covers blocks outside the table", async () => {
    expect((await plan("mymod:goo", { hardness: 0.5 })).ticks).toBe(15);
    expect(() => breakPlan("mymod:goo", tags, {})).toThrow(/hardness/);
  });
});

describe("crack stage (MultiPlayerGameMode.getDestroyStage)", () => {
  test("no crack before any progress, then one stage per tenth", () => {
    expect(crackStage(0)).toBe(-1);
    expect(crackStage(0.05)).toBe(0);
    expect(crackStage(0.5)).toBe(5);
    expect(crackStage(0.99)).toBe(9);
  });

  test("the plan reports the stage tick by tick and clears it once the block breaks", async () => {
    const p = await plan("stone", { tool: "wooden_pickaxe" });
    expect(p.stageAt(0)).toBe(-1);
    expect(p.stageAt(1)).toBe(0);
    expect(p.stageAt(12)).toBe(5);
    expect(p.stageAt(22)).toBe(9);
    expect(p.stageAt(23)).toBe(-1);
    expect(p.seconds).toBeCloseTo(23 / 20);
  });
});

describe("crack decal mapping (SheetedDecalTextureGenerator)", () => {
  const spans = (corners: [number, number, number][], normal: [number, number, number]) => {
    const uvs = corners.map((c) => decalUv(c, normal));
    const range = (i: 0 | 1) =>
      Math.max(...uvs.map((u) => u[i])) - Math.min(...uvs.map((u) => u[i]));
    return [range(0), range(1)];
  };

  test("every face of a full block spans the crack texture exactly once", () => {
    const faces: [[number, number, number], [number, number, number][]][] = [
      [[0, 1, 0], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]],
      [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
      [[0, 0, -1], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]],
      [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
      [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
      [[1, 0, 0], [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]],
    ];
    for (const [n, corners] of faces) {
      const [du, dv] = spans(corners, n);
      expect(du).toBeCloseTo(1, 5);
      expect(dv).toBeCloseTo(1, 5);
    }
  });

  test("side faces read upright: the texture's top row sits at the block's top", () => {
    for (const n of [
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
    ] as [number, number, number][]) {
      const top = decalUv([0.5, 0.99, 0.5], n)[1];
      const bottom = decalUv([0.5, 0.01, 0.5], n)[1];
      const wrap = (v: number) => v - Math.floor(v);
      expect(wrap(top)).toBeLessThan(0.05);
      expect(wrap(bottom)).toBeGreaterThan(0.95);
    }
  });

  test("a slab's top face takes the same texels as a full block's top", () => {
    const slab = decalUv([0.25, 0.5, 0.75], [0, 1, 0]);
    const full = decalUv([0.25, 1, 0.75], [0, 1, 0]);
    expect(slab[0]).toBeCloseTo(full[0], 9);
    expect(slab[1]).toBeCloseTo(full[1], 9);
  });

  test("a tilted normal picks the nearest face", () => {
    const n = new THREE.Vector3(0.2, 0.9, 0.1).normalize();
    expect(decalUv([0.3, 1, 0.6], [n.x, n.y, n.z])).toEqual(decalUv([0.3, 1, 0.6], [0, 1, 0]));
    expect(decalUv([0.3, 1, 0.6], [0.6, 0.5, 0])).toEqual(decalUv([0.3, 1, 0.6], [1, 0, 0]));
  });
});
