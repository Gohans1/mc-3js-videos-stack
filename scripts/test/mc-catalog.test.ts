import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";

import {
  foldObjectVariants,
  loadMcAssetsCatalog,
  loadWarmMcCache,
  readZipCatalog,
  readZipMembers,
} from "../../packages/mc-assets/src/catalog.ts";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makePackFixture() {
  const root = mkTmp("mc-catalog-");
  const vaultRoot = join(root, "vault");
  const gohansDir = join(root, "gohans");
  mkdirSync(join(vaultRoot, "packs"), { recursive: true });
  mkdirSync(join(vaultRoot, "jar"), { recursive: true });
  mkdirSync(join(vaultRoot, "mcasset/1.21.11/entity-models/minecraft"), { recursive: true });
  mkdirSync(join(vaultRoot, "mcasset/1.21.11/entity-models/animations/minecraft"), {
    recursive: true,
  });
  mkdirSync(join(gohansDir, "blockstates"), { recursive: true });
  mkdirSync(join(gohansDir, "models/block"), { recursive: true });

  // Built-in gohans prop
  writeFileSync(
    join(gohansDir, "blockstates/desk_lamp.json"),
    JSON.stringify({ variants: { "": { model: "gohans:block/desk_lamp" } } }),
  );
  writeFileSync(
    join(gohansDir, "models/block/desk_lamp.json"),
    JSON.stringify({
      parent: "minecraft:block/cube_all",
      textures: { all: "minecraft:block/iron_block" },
    }),
  );

  // Vanilla client_assets.zip
  const vanillaZip = zipSync({
    "assets/minecraft/blockstates/barrel.json": strToU8(
      JSON.stringify({
        variants: {
          "facing=north,open=false": { model: "minecraft:block/barrel" },
          "facing=west,open=true": { model: "minecraft:block/barrel_open" },
        },
      }),
    ),
    "assets/minecraft/blockstates/barrier.json": strToU8(
      JSON.stringify({ variants: { "": { model: "minecraft:block/barrier" } } }),
    ),
    "assets/minecraft/blockstates/oak_leaves.json": strToU8(
      JSON.stringify({ variants: { "": { model: "minecraft:block/oak_leaves" } } }),
    ),
    "assets/minecraft/models/block/oak_leaves.json": strToU8(
      JSON.stringify({
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/barrel_side" },
      }),
    ),
    "assets/minecraft/models/block/barrel.json": strToU8(
      JSON.stringify({
        parent: "minecraft:block/cube_bottom_top",
        textures: { side: "minecraft:block/barrel_side" },
      }),
    ),
    "assets/minecraft/models/block/barrel_open.json": strToU8(
      JSON.stringify({
        parent: "minecraft:block/cube_bottom_top",
        textures: { side: "minecraft:block/barrel_side" },
      }),
    ),
    "assets/minecraft/models/block/cube_bottom_top.json": strToU8(JSON.stringify({ elements: [] })),
    "assets/minecraft/models/block/cube_all.json": strToU8(JSON.stringify({ elements: [] })),
    "assets/minecraft/models/block/barrier.json": strToU8(JSON.stringify({ textures: {} })),
    "assets/minecraft/models/item/generated.json": strToU8(
      JSON.stringify({ parent: "builtin/generated" }),
    ),
    "assets/minecraft/items/diamond_sword.json": strToU8(
      JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/diamond_sword" } }),
    ),
    "assets/minecraft/items/diamond_chestplate.json": strToU8(
      JSON.stringify({
        model: {
          type: "minecraft:select",
          property: "minecraft:trim_material",
          fallback: { type: "minecraft:model", model: "minecraft:item/diamond_chestplate" },
          cases: [
            {
              when: "minecraft:quartz",
              model: {
                type: "minecraft:model",
                model: "minecraft:item/diamond_chestplate_quartz_trim",
              },
            },
          ],
        },
      }),
    ),
    "assets/minecraft/models/item/diamond_sword.json": strToU8(
      JSON.stringify({
        parent: "minecraft:item/generated",
        textures: { layer0: "minecraft:item/diamond_sword" },
      }),
    ),
    "assets/minecraft/models/item/diamond_chestplate.json": strToU8(
      JSON.stringify({
        parent: "minecraft:item/generated",
        textures: { layer0: "minecraft:item/diamond_chestplate" },
      }),
    ),
    "assets/minecraft/models/item/diamond_chestplate_quartz_trim.json": strToU8(
      JSON.stringify({
        parent: "minecraft:item/generated",
        textures: {
          layer0: "minecraft:item/diamond_chestplate",
          layer1: "minecraft:trims/items/chestplate_trim_quartz",
        },
      }),
    ),
    "assets/minecraft/textures/block/barrel_side.png": new Uint8Array([137, 80, 78, 71]),
    "assets/minecraft/textures/block/iron_block.png": new Uint8Array([137, 80, 78, 71]),
    "assets/minecraft/textures/item/diamond_sword.png": new Uint8Array([137, 80, 78, 71]),
    "assets/minecraft/textures/item/diamond_chestplate.png": new Uint8Array([137, 80, 78, 71]),
  });
  writeFileSync(join(vaultRoot, "jar/client_assets.zip"), vanillaZip);

  // Mod jar with ok blocks (wood variants), broken custom loader, geo/obj models, and item
  const modJar = zipSync({
    "assets/decor/blockstates/oak_chair.json": strToU8(
      JSON.stringify({ variants: { "facing=north": { model: "decor:block/oak_chair" } } }),
    ),
    "assets/decor/blockstates/spruce_chair.json": strToU8(
      JSON.stringify({ variants: { "facing=north": { model: "decor:block/spruce_chair" } } }),
    ),
    "assets/decor/blockstates/birch_chair.json": strToU8(
      JSON.stringify({ variants: { "facing=north": { model: "decor:block/birch_chair" } } }),
    ),
    "assets/decor/blockstates/broken_missing_tex.json": strToU8(
      JSON.stringify({ variants: { "": { model: "decor:block/broken_missing_tex" } } }),
    ),
    "assets/decor/blockstates/custom_loader_tank.json": strToU8(
      JSON.stringify({ variants: { "": { model: "decor:block/custom_loader_tank" } } }),
    ),
    "assets/decor/blockstates/non_json_meta.rpo": strToU8("ignore me"),
    "assets/decor/models/block/oak_chair.json": strToU8(
      JSON.stringify({ textures: { tex: "decor:block/oak_wood" }, elements: [] }),
    ),
    "assets/decor/models/block/spruce_chair.json": strToU8(
      JSON.stringify({
        parent: "decor:block/oak_chair",
        textures: { tex: "decor:block/spruce_wood" },
      }),
    ),
    "assets/decor/models/block/birch_chair.json": strToU8(
      JSON.stringify({
        parent: "decor:block/oak_chair",
        textures: { tex: "decor:block/birch_wood" },
      }),
    ),
    "assets/decor/models/block/broken_missing_tex.json": strToU8(
      JSON.stringify({ textures: { tex: "decor:block/does_not_exist" } }),
    ),
    "assets/decor/models/block/custom_loader_tank.json": strToU8(
      JSON.stringify({ loader: "forge:obj", model: "decor:models/block/tank.obj" }),
    ),
    "assets/decor/geo/rifle.geo.json": strToU8(JSON.stringify({ format_version: "1.12.0" })),
    "assets/decor/items/rifle.json": strToU8(
      JSON.stringify({ model: { type: "minecraft:model", model: "decor:item/rifle" } }),
    ),
    "assets/decor/models/item/rifle.json": strToU8(
      JSON.stringify({
        parent: "minecraft:item/generated",
        textures: { layer0: "decor:item/rifle" },
      }),
    ),
    "assets/decor/textures/block/oak_wood.png": new Uint8Array([1, 2]),
    "assets/decor/textures/block/spruce_wood.png": new Uint8Array([1, 2]),
    "assets/decor/textures/block/birch_wood.png": new Uint8Array([1, 2]),
    "assets/decor/textures/item/rifle.png": new Uint8Array([1, 2]),
  });
  writeFileSync(join(vaultRoot, "packs/decor-mod.jar"), modJar);

  // Pure resource pack overriding vanilla leaf model without a blockstate
  const rpZip = zipSync({
    "assets/minecraft/models/block/oak_leaves.json": strToU8(
      JSON.stringify({
        parent: "betterleaves:block/leaves_base",
        textures: { all: "minecraft:block/barrel_side" },
      }),
    ),
    "assets/betterleaves/models/block/leaves_base.json": strToU8(JSON.stringify({ elements: [] })),
    "assets/betterleaves/textures/block/leaf_tip.png": new Uint8Array([1]),
  });
  writeFileSync(join(vaultRoot, "packs/better-leaves.zip"), rpZip);

  writeFileSync(
    join(vaultRoot, "packs_index.json"),
    JSON.stringify({
      "decor-mod.jar": {
        title: "Decor Mod",
        slug: "decor-mod",
        url: "https://modrinth.com/mod/decor-mod",
        type: "mod",
        downloads: 50000,
        license: { id: "MIT", name: "MIT License" },
      },
      "better-leaves.zip": {
        title: "Better Leaves",
        slug: "better-leaves",
        url: "https://modrinth.com/resourcepack/better-leaves",
        type: "resourcepack",
        downloads: 90000,
        license: { id: "Apache-2.0", name: "Apache License 2.0" },
      },
    }),
  );

  // Mobs (mirror real vault layout: nested folders listed under "directories" with subdir _list.json)
  mkdirSync(join(vaultRoot, "mcasset/1.21.11/entity-models/minecraft/boat"), { recursive: true });
  writeFileSync(
    join(vaultRoot, "mcasset/1.21.11/entity-models/minecraft/_list.json"),
    JSON.stringify({ files: ["armadillo.json"], directories: ["boat"] }),
  );
  writeFileSync(
    join(vaultRoot, "mcasset/1.21.11/entity-models/minecraft/boat/_list.json"),
    JSON.stringify({ files: ["oak.json"] }),
  );
  writeFileSync(
    join(vaultRoot, "mcasset/1.21.11/entity-models/animations/minecraft/armadillo.json"),
    JSON.stringify({
      animations: {
        walk: { length: 1.5, loop: true },
        peek: { length: 2.5, loop: false },
      },
    }),
  );

  return { vaultRoot, gohansDir };
}

test("selective central-directory ZIP reader extracts stored & deflated entries even with bit-3 local flags", () => {
  const dir = mkTmp("mc-zip-");
  const zPath = join(dir, "sample.zip");
  const raw = zipSync({
    "assets/test/a.json": [strToU8('{"ok":true}'), { level: 6 }],
    "assets/test/b.json": [strToU8('{"stored":1}'), { level: 0 }],
  });
  // Simulate streaming jar with GP flag bit 3 (data descriptor) & zeroed local header sizes
  const patched = Buffer.from(raw);
  patched.writeUInt16LE(patched.readUInt16LE(6) | 0x08, 6);
  patched.writeUInt32LE(0, 18);
  patched.writeUInt32LE(0, 22);
  writeFileSync(zPath, patched);

  const cd = readZipCatalog(patched);
  expect(cd.has("assets/test/a.json")).toBe(true);
  expect(cd.has("assets/test/b.json")).toBe(true);

  const got = readZipMembers(patched, cd, ["assets/test/a.json", "assets/test/b.json"]);
  expect(JSON.parse(Buffer.from(got.get("assets/test/a.json")!).toString("utf8"))).toEqual({
    ok: true,
  });
  expect(JSON.parse(Buffer.from(got.get("assets/test/b.json")!).toString("utf8"))).toEqual({
    stored: 1,
  });
});

test("mc catalog indexes gohans, vanilla, modded, resource-pack overrides, items, mobs, broken detection, and warm fingerprint cache", () => {
  const { vaultRoot, gohansDir } = makePackFixture();

  expect(loadWarmMcCache(vaultRoot)).toBeNull();

  const cat = loadMcAssetsCatalog({ vaultRoot, gohansPackDir: gohansDir });
  expect(cat.items.find((x) => x.id === "block:gohans:desk_lamp")?.renderable).toBe(true);
  const barrel = cat.items.find((x) => x.id === "block:minecraft:barrel");
  expect(barrel?.renderable).toBe(true);
  expect(barrel?.props).toEqual({ facing: ["north", "west"], open: ["false", "true"] });
  expect(cat.items.some((x) => x.id === "block:minecraft:barrier")).toBe(false);
  expect(cat.items.find((x) => x.id === "item:minecraft:diamond_sword")?.renderable).toBe(true);
  expect(cat.items.find((x) => x.id === "item:minecraft:diamond_chestplate")?.renderable).toBe(
    true,
  );

  // Mod blocks & broken checks
  expect(cat.items.find((x) => x.id === "block:decor:oak_chair")?.renderable).toBe(true);
  expect(cat.items.find((x) => x.id === "block:decor:oak_chair")?.license).toBe("MIT");
  expect(cat.items.find((x) => x.id === "block:decor:broken_missing_tex")?.renderable).toBe(false);
  expect(cat.items.find((x) => x.id === "block:decor:broken_missing_tex")?.brokenReason).toContain(
    "decor:block/does_not_exist",
  );
  expect(cat.items.find((x) => x.id === "block:decor:custom_loader_tank")?.renderable).toBe(false);
  expect(cat.items.find((x) => x.id === "block:decor:custom_loader_tank")?.brokenReason).toContain(
    "forge:obj",
  );
  // Mod 1.21.4 item + resource pack model-only override
  expect(cat.items.find((x) => x.id === "item:decor:rifle")?.renderable).toBe(true);
  const leaves = cat.items.find(
    (x) => x.id === "block:minecraft:oak_leaves" && x.pack === "better-leaves.zip",
  );
  expect(leaves?.renderable).toBe(true);

  // Mobs & animation metadata
  const armadillo = cat.items.find((x) => x.id === "mob:armadillo");
  expect(armadillo?.clips).toEqual([
    { name: "walk", length: 1.5, loop: true },
    { name: "peek", length: 2.5, loop: false },
  ]);
  expect(cat.items.some((x) => x.id === "mob:boat/oak")).toBe(true);

  // Cache persisted & warm-loadable without rescanning
  const warm = loadWarmMcCache(vaultRoot);
  expect(warm).not.toBeNull();
  expect(warm?.packs["decor-mod.jar"]?.entries.length).toBeGreaterThan(0);

  // Delete raw jar? No, test cache hit + selective invalidation when 1 jar changes
  const cleanBefore = readFileSync(join(vaultRoot, "cache/mc-catalog.v1.json"), "utf8");
  expect(JSON.parse(cleanBefore).packs["better-leaves.zip"].fingerprint).toBeTruthy();

  const rpPath = join(vaultRoot, "packs/better-leaves.zip");
  const now = new Date(Date.now() + 5000);
  utimesSync(rpPath, now, now);
  const cat2 = loadMcAssetsCatalog({ vaultRoot, gohansPackDir: gohansDir });
  expect(cat2.stats.reindexedPacks).toEqual(["better-leaves.zip"]);

  // Updating packs_index.json metadata refreshes entry metadata without archive mtime change, and type flip reindexes
  const idxPath = join(vaultRoot, "packs_index.json");
  const idx = JSON.parse(readFileSync(idxPath, "utf8"));
  idx["decor-mod.jar"].title = "Decor Mod Updated";
  idx["decor-mod.jar"].license = { id: "CC-BY-4.0" };
  writeFileSync(idxPath, JSON.stringify(idx));
  const cat3 = loadMcAssetsCatalog({ vaultRoot, gohansPackDir: gohansDir });
  expect(cat3.items.find((x) => x.id === "block:decor:oak_chair")?.packTitle).toBe(
    "Decor Mod Updated",
  );
  expect(cat3.items.find((x) => x.id === "block:decor:oak_chair")?.license).toBe("CC-BY-4.0");
  idx["decor-mod.jar"].type = "resourcepack";
  writeFileSync(idxPath, JSON.stringify(idx));
  const cat4 = loadMcAssetsCatalog({ vaultRoot, gohansPackDir: gohansDir });
  expect(cat4.stats.reindexedPacks).toContain("decor-mod.jar");
});

test("foldObjectVariants groups wood/color/number variants after filtering while preserving distinct packs", () => {
  const chairs = [
    {
      kind: "block",
      id: "block:decor:birch_chair",
      source: "decor-mod",
      pack: "decor-mod.jar",
      group: "decor",
      title: "birch chair",
    },
    {
      kind: "block",
      id: "block:decor:oak_chair",
      source: "decor-mod",
      pack: "decor-mod.jar",
      group: "decor",
      title: "oak chair",
    },
    {
      kind: "block",
      id: "block:decor:spruce_chair",
      source: "decor-mod",
      pack: "decor-mod.jar",
      group: "decor",
      title: "spruce chair",
    },
    {
      kind: "block",
      id: "block:other:oak_chair",
      source: "other-mod",
      pack: "other-mod.jar",
      group: "other",
      title: "oak chair",
    },
  ] as any[];

  const folded = foldObjectVariants(chairs);
  expect(folded).toHaveLength(2);
  const decor = folded.find((x) => x.pack === "decor-mod.jar");
  expect(decor?.variants?.length).toBe(3);
  expect(decor?.id).toBe("block:decor:birch_chair");
});

test("mc catalog warns and skips corrupt pack zip without crashing valid entries", () => {
  const { vaultRoot, gohansDir } = makePackFixture();
  writeFileSync(join(vaultRoot, "packs/corrupt.jar"), "not-a-valid-zip");

  const origWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;

  try {
    const cat = loadMcAssetsCatalog({ vaultRoot, gohansPackDir: gohansDir, quiet: false });
    expect(cat.items.some((x) => x.id === "mob:boat/oak")).toBe(true);
    expect(cat.items.some((x) => x.id === "block:decor:oak_chair")).toBe(true);
    expect(captured.join("")).toContain('Warning: skipping corrupt pack "corrupt.jar"');
  } finally {
    process.stderr.write = origWrite;
  }
});
