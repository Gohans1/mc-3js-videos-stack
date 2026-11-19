import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { strToU8, unzipSync, zipSync } from "fflate";

const ROOT = resolve(import.meta.dir, "../..");
const PICK_MJS = join(ROOT, "packages/mc-assets/pick.mjs");

const tmpRoots = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makePickEnv() {
  const root = mkTmp("mc-pick-test-");
  const vault = join(root, "vault");
  const film = join(root, "film");
  mkdirSync(join(vault, "packs"), { recursive: true });
  mkdirSync(join(vault, "jar"), { recursive: true });
  mkdirSync(join(film, "pack"), { recursive: true });
  mkdirSync(join(film, "src"), { recursive: true });
  writeFileSync(join(film, "src/scene.ts"), "");
  writeFileSync(join(film, "package.json"), JSON.stringify({ name: "pick-demo" }));

  // Vanilla client_assets.zip (provides oak_leaves blockstate & cube_all)
  writeFileSync(
    join(vault, "jar/client_assets.zip"),
    zipSync({
      "assets/minecraft/blockstates/oak_leaves.json": strToU8(
        JSON.stringify({ variants: { "": { model: "minecraft:block/oak_leaves" } } }),
      ),
      "assets/minecraft/models/block/cube_all.json": strToU8(JSON.stringify({ elements: [] })),
      "assets/minecraft/models/block/oak_leaves.json": strToU8(JSON.stringify({ elements: [] })),
      "assets/minecraft/textures/block/oak_leaves.png": new Uint8Array([9, 9]),
    }),
  );

  // Mod jar with both a block and an item (including 1.21.4 items/<id>.json + .mcmeta animation)
  writeFileSync(
    join(vault, "packs/decor-mod.jar"),
    zipSync({
      "assets/decor/blockstates/oak_chair.json": strToU8(
        JSON.stringify({ variants: { "": { model: "decor:block/oak_chair" } } }),
      ),
      "assets/decor/models/block/oak_chair.json": strToU8(
        JSON.stringify({ textures: { tex: "decor:block/chair" } }),
      ),
      "assets/decor/textures/block/chair.png": new Uint8Array([1, 2, 3]),
      "assets/decor/textures/block/chair.png.mcmeta": strToU8('{"animation":{"frametime":2}}'),
      "assets/decor/items/rifle.json": strToU8(
        JSON.stringify({ model: { type: "minecraft:model", model: "decor:item/rifle" } }),
      ),
      "assets/decor/models/item/rifle.json": strToU8(
        JSON.stringify({
          parent: "minecraft:item/generated",
          textures: { layer0: "decor:item/rifle" },
        }),
      ),
      "assets/decor/textures/item/rifle.png": new Uint8Array([4, 5, 6]),
    }),
  );

  // Pure resource pack overriding vanilla oak_leaves (model-only) with secondary namespace & vanilla fallback
  writeFileSync(
    join(vault, "packs/better-leaves.zip"),
    zipSync({
      "assets/minecraft/models/block/oak_leaves.json": strToU8(
        JSON.stringify({
          parent: "betterleaves:block/leaves_base",
          textures: { overlay: "minecraft:block/leaves_tip", base: "minecraft:block/oak_leaves" },
        }),
      ),
      "assets/betterleaves/models/block/leaves_base.json": strToU8(
        JSON.stringify({ parent: "minecraft:block/cube_all" }),
      ),
      "assets/minecraft/textures/block/leaves_tip.png": new Uint8Array([7, 8, 9]),
    }),
  );

  // Second RP overriding the exact same minecraft:models/block/oak_leaves.json to trigger collision warn
  writeFileSync(
    join(vault, "packs/alt-leaves.zip"),
    zipSync({
      "assets/minecraft/models/block/oak_leaves.json": strToU8(
        JSON.stringify({
          parent: "minecraft:block/cube_all",
          textures: { all: "minecraft:block/oak_leaves" },
        }),
      ),
    }),
  );

  return { root, vault, film };
}

test("pick.mjs honors MC_VAULT_ROOT, picks items & blocks, and supports minecraft resource-pack overrides", () => {
  const { vault, film } = makePickEnv();
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([
      {
        jar: "decor-mod.jar",
        namespace: "decor",
        licence: "MIT",
        page: "https://modrinth.com/mod/decor-mod",
        blocks: ["oak_chair"],
        items: ["rifle"],
      },
      {
        jar: "better-leaves.zip",
        namespace: "minecraft",
        licence: "MIT",
        page: "https://modrinth.com/resourcepack/better-leaves",
        blocks: ["oak_leaves"],
      },
    ]),
  );

  const res = spawnSync("bun", [PICK_MJS], {
    cwd: film,
    env: { ...process.env, MC_VAULT_ROOT: vault },
    encoding: "utf8",
    timeout: 15000,
  });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toContain("2 blocks, 1 items");

  const picked = unzipSync(readFileSync(join(film, "assets/public/picked.zip")));
  expect(picked["assets/decor/blockstates/oak_chair.json"]).toBeDefined();
  expect(picked["assets/decor/textures/block/chair.png.mcmeta"]).toBeDefined();
  expect(picked["assets/decor/items/rifle.json"]).toBeDefined();
  expect(picked["assets/decor/textures/item/rifle.png"]).toBeDefined();
  // Pure resource-pack override included!
  expect(picked["assets/minecraft/models/block/oak_leaves.json"]).toBeDefined();
  expect(picked["assets/betterleaves/models/block/leaves_base.json"]).toBeDefined();
  expect(picked["assets/minecraft/textures/block/leaves_tip.png"]).toBeDefined();
  // Vanilla blockstate was NOT copied unnecessarily from client_assets.zip
  expect(picked["assets/minecraft/blockstates/oak_leaves.json"]).toBeUndefined();
});

test("pick.mjs warns on resource-pack override collisions across picks", async () => {
  const { vault, film } = makePickEnv();
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([
      { jar: "better-leaves.zip", namespace: "minecraft", blocks: ["oak_leaves"] },
      { jar: "alt-leaves.zip", namespace: "minecraft", blocks: ["oak_leaves"] },
    ]),
  );
  const res = spawnSync("bun", [PICK_MJS], {
    cwd: film,
    env: { ...process.env, MC_VAULT_ROOT: vault },
    encoding: "utf8",
    timeout: 15000,
  });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stderr).toContain("oak_leaves.json");
});

test("updatePicks & removePicks preserve licence metadata, deduplicate, and optionally skip zip build", async () => {
  const { vault, film } = makePickEnv();
  const { updatePicks, removePicks } = await import(PICK_MJS);

  const a1 = updatePicks(film, {
    jar: "decor-mod.jar",
    namespace: "decor",
    blocks: ["oak_chair"],
    licence: "MIT",
    page: "https://example.com",
    vaultDir: join(vault, "packs"),
    vanillaJar: join(vault, "jar/client_assets.zip"),
  });
  expect(a1.added).toEqual(["block:decor:oak_chair"]);
  expect(existsSync(join(film, "assets/public/picked.zip"))).toBe(true);

  const a2 = updatePicks(film, {
    jar: "decor-mod.jar",
    namespace: "decor",
    blocks: ["oak_chair"],
    items: ["rifle"],
    vaultDir: join(vault, "packs"),
    vanillaJar: join(vault, "jar/client_assets.zip"),
    build: false,
  });
  expect(a2.added).toEqual(["item:decor:rifle"]);
  const picksJson = JSON.parse(readFileSync(join(film, "pack/picks.json"), "utf8"));
  expect(picksJson).toEqual([
    {
      jar: "decor-mod.jar",
      namespace: "decor",
      blocks: ["oak_chair"],
      items: ["rifle"],
      licence: "MIT",
      page: "https://example.com",
    },
  ]);

  const rem = removePicks(film, {
    namespace: "decor",
    blocks: ["oak_chair"],
    items: ["rifle"],
    vaultDir: join(vault, "packs"),
    vanillaJar: join(vault, "jar/client_assets.zip"),
  });
  expect(rem.removed).toEqual(["block:decor:oak_chair", "item:decor:rifle"]);
  expect(JSON.parse(readFileSync(join(film, "pack/picks.json"), "utf8"))).toEqual([]);
});

test("pick.mjs distinguishes missing cached optional models and keeps picks.json atomic on build failure", async () => {
  const { vault, film } = makePickEnv();
  const { updatePicks, pickBlocks } = await import(PICK_MJS);

  // RP overrides stone model with absent vanilla parent barrel, then also asks to pick absent barrel
  writeFileSync(
    join(vault, "packs/rp-partial.zip"),
    zipSync({
      "assets/minecraft/models/block/stone.json": strToU8(
        JSON.stringify({
          parent: "minecraft:block/barrel",
          textures: { side: "minecraft:block/stone_tex" },
        }),
      ),
      "assets/minecraft/textures/block/stone_tex.png": new Uint8Array([1]),
    }),
  );
  writeFileSync(
    join(vault, "packs/broken-mod.jar"),
    zipSync({
      "assets/decor/blockstates/bad.json": strToU8(
        JSON.stringify({ variants: { "": { model: "decor:block/bad" } } }),
      ),
      "assets/decor/models/block/bad.json": strToU8(
        JSON.stringify({ textures: { a: "decor:block/missing_tex" } }),
      ),
    }),
  );

  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([
      { jar: "rp-partial.zip", namespace: "minecraft", blocks: ["stone", "barrel"] },
    ]),
  );
  expect(() =>
    pickBlocks({
      cwd: film,
      vaultDir: join(vault, "packs"),
      vanillaJar: join(vault, "jar/client_assets.zip"),
      quiet: true,
    }),
  ).toThrow(/no blockstate assets\/minecraft\/blockstates\/barrel\.json/);

  // Atomic updatePicks rollback: invalid texture prevents writing picks.json
  writeFileSync(join(film, "pack/picks.json"), "[]");
  expect(() =>
    updatePicks(film, {
      jar: "broken-mod.jar",
      namespace: "decor",
      blocks: ["bad"],
      vaultDir: join(vault, "packs"),
      vanillaJar: join(vault, "jar/client_assets.zip"),
      quiet: true,
    }),
  ).toThrow(/decor:block\/missing_tex missing/);
  expect(JSON.parse(readFileSync(join(film, "pack/picks.json"), "utf8"))).toEqual([]);
});

test("updatePicksBatch skips shadowed override entries in later packs when earlier pack already owns path", async () => {
  const { vault, film } = makePickEnv();
  const { updatePicksBatch } = await import(PICK_MJS);

  writeFileSync(
    join(vault, "packs/a-first.zip"),
    zipSync({
      "assets/minecraft/models/block/oak_leaves.json": strToU8(
        JSON.stringify({
          parent: "minecraft:block/cube_all",
          textures: { all: "minecraft:block/oak_leaves" },
        }),
      ),
      "assets/minecraft/textures/block/oak_leaves.png": new Uint8Array([1, 2, 3]),
    }),
  );
  writeFileSync(
    join(vault, "packs/b-shadowed.zip"),
    zipSync({
      "assets/minecraft/models/block/oak_leaves.json": strToU8(
        JSON.stringify({
          parent: "missing:block/broken_shadowed_parent",
        }),
      ),
    }),
  );

  const res = updatePicksBatch(
    film,
    [
      { jar: "a-first.zip", namespace: "minecraft", blocks: ["oak_leaves"] },
      { jar: "b-shadowed.zip", namespace: "minecraft", blocks: ["oak_leaves"] },
    ],
    {
      vaultDir: join(vault, "packs"),
      vanillaJar: join(vault, "jar/client_assets.zip"),
      quiet: true,
    },
  );
  expect(res.added).toContain("block:minecraft:oak_leaves");
  expect(existsSync(join(film, "assets/public/picked.zip"))).toBe(true);
});
