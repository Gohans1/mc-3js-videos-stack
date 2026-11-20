import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strToU8, zipSync } from "fflate";

import { pickBlocks } from "../pick.mjs";
import { resolveMcAssetBounds } from "../src/bounds.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const GOHANS_PACK = resolve(HERE, "../pack/assets/gohans");

const mkZip = (entries: Record<string, unknown>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, value]) => [
        path,
        typeof value === "string"
          ? strToU8(value)
          : value instanceof Uint8Array
            ? value
            : strToU8(JSON.stringify(value)),
      ]),
    ),
  );

const withTempDir = (prefix: string, fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const setupVault = (root: string) => {
  const vaultRoot = join(root, "vault");
  mkdirSync(join(vaultRoot, "jar"), { recursive: true });
  mkdirSync(join(vaultRoot, "packs"), { recursive: true });

  const vanillaZip = mkZip({
    "assets/minecraft/blockstates/stone.json": {
      variants: { "": { model: "minecraft:block/stone" } },
    },
    "assets/minecraft/models/block/stone.json": {
      elements: [{ from: [0, 0, 0], to: [16, 16, 16] }],
    },
    "assets/minecraft/models/block/slab_base.json": {
      elements: [{ from: [0, 0, 0], to: [16, 8, 16] }],
    },
    "assets/minecraft/models/item/generated.json": {
      parent: "builtin/generated",
    },
    "assets/minecraft/models/item/lantern.json": {
      elements: [{ from: [5, 0, 5], to: [11, 9, 11] }],
    },
  });
  writeFileSync(join(vaultRoot, "jar/client_assets.zip"), vanillaZip);

  const modZip = mkZip({
    "pack.mcmeta": { pack: { pack_format: 75, description: "test" } },
    "assets/decor/blockstates/bench.json": {
      variants: { "facing=east": [{ model: "decor:block/bench", y: 90 }] },
    },
    "assets/decor/models/block/bench.json": {
      elements: [{ from: [0, 0, 4], to: [16, 8, 12] }],
    },
    "assets/decor/models/block/raw_pillar.json": {
      elements: [{ from: [4, 0, 4], to: [12, 16, 12] }],
    },
    "assets/decor/blockstates/post.json": {
      multipart: [
        { apply: { model: "decor:block/post_base" } },
        { apply: { model: "decor:block/post_top" } },
        { when: { north: "true" }, apply: { model: "decor:block/post_arm" } },
      ],
    },
    "assets/decor/blockstates/cond_only.json": {
      multipart: [
        { when: { north: "true" }, apply: { model: "decor:block/post_top" } },
        { when: { south: "true" }, apply: { model: "decor:block/post_arm" } },
      ],
    },
    "assets/decor/models/block/post_base.json": {
      parent: "minecraft:block/slab_base",
    },
    "assets/decor/models/block/post_top.json": {
      elements: [{ from: [6, 8, 6], to: [10, 16, 10] }],
    },
    "assets/decor/models/block/post_arm.json": {
      elements: [{ from: [0, 16, 0], to: [16, 32, 16] }],
    },
    "assets/decor/items/mug.json": {
      model: { type: "minecraft:model", model: "decor:item/mug_3d" },
    },
    "assets/decor/models/item/mug_3d.json": {
      elements: [{ from: [5, 0, 5], to: [11, 8, 11] }],
    },
    "assets/decor/models/item/flat_coin.json": {
      parent: "minecraft:item/generated",
    },
    // RP override replacing a 3D vanilla item with a flat 2D sprite via 1.21.4+ items/<id>.json
    "assets/minecraft/items/lantern.json": {
      model: { type: "minecraft:model", model: "minecraft:item/lantern_2d" },
    },
    "assets/minecraft/models/item/lantern_2d.json": {
      parent: "minecraft:item/generated",
    },
  });
  writeFileSync(join(vaultRoot, "packs/decor.jar"), modZip);

  // Real archive placed at vaultRoot/evil.jar so traversal pack "../evil.jar" would resolve if unguarded
  writeFileSync(join(vaultRoot, "evil.jar"), modZip);
  return vaultRoot;
};

describe("resolveMcAssetBounds", () => {
  test("resolves real gohans pack parent-inherited block bounds on disk", () => {
    const b = resolveMcAssetBounds(
      { kind: "block", namespace: "gohans", name: "computer_beige" },
      { gohansPackDir: GOHANS_PACK },
    );
    expect(b).not.toBeNull();
    expect(b!.size[0]).toBeGreaterThan(0.5);
    expect(b!.size[1]).toBeGreaterThan(0.5);
    expect(b!.size[2]).toBeGreaterThan(0.5);
    expect(b!.min[1]).toBeCloseTo(0, 4);
  });

  test("resolves vanilla blocks, rotated mod blocks, and unconditional or conditional-only multiparts", () => {
    withTempDir("mc-bounds-blocks-", (root) => {
      const vaultRoot = setupVault(root);

      const stone = resolveMcAssetBounds(
        { kind: "block", namespace: "minecraft", name: "stone" },
        { vaultRoot },
      );
      expect(stone).toEqual({ min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] });

      // Rotated 90 deg around Y: X=[0..16], Z=[4..12] swaps to X=[4..12], Z=[0..16]
      const bench = resolveMcAssetBounds(
        { kind: "block", namespace: "decor", name: "bench", pack: "decor.jar" },
        { vaultRoot },
      );
      expect(bench).not.toBeNull();
      expect(bench!.min[0]).toBeCloseTo(0.25, 4);
      expect(bench!.max[0]).toBeCloseTo(0.75, 4);
      expect(bench!.min[2]).toBeCloseTo(0, 4);
      expect(bench!.max[2]).toBeCloseTo(1, 4);
      expect(bench!.size).toEqual([0.5, 0.5, 1]);

      // Multipart unions unconditional parts (vanilla slab_base [0..0.5] + post_top [0.5..1.0]) and skips conditional arm
      const post = resolveMcAssetBounds(
        { kind: "block", namespace: "decor", name: "post", pack: "decor.jar" },
        { vaultRoot },
      );
      expect(post).not.toBeNull();
      expect(post!.size).toEqual([1, 1, 1]);
      expect(post!.max[1]).toBeCloseTo(1, 4);

      // Conditional-only multipart uses first part's apply
      const condOnly = resolveMcAssetBounds(
        { kind: "block", namespace: "decor", name: "cond_only", pack: "decor.jar" },
        { vaultRoot },
      );
      expect(condOnly).not.toBeNull();
      expect(condOnly!.min).toEqual([0.375, 0.5, 0.375]);
      expect(condOnly!.max).toEqual([0.625, 1, 0.625]);

      // Missing blockstate falls back directly to <ns>:block/<name>
      const rawPillar = resolveMcAssetBounds(
        { kind: "block", namespace: "decor", name: "raw_pillar", pack: "decor.jar" },
        { vaultRoot },
      );
      expect(rawPillar).toEqual({
        min: [0.25, 0, 0.25],
        max: [0.75, 1, 0.75],
        size: [0.5, 1, 0.5],
      });
    });
  });

  test("resolves 1.21.4+ 3D items and returns null for 2D sprites without falling back past 2D overrides", () => {
    withTempDir("mc-bounds-items-", (root) => {
      const vaultRoot = setupVault(root);

      const mug = resolveMcAssetBounds(
        { kind: "item", namespace: "decor", name: "mug", pack: "decor.jar" },
        { vaultRoot },
      );
      expect(mug).not.toBeNull();
      expect(mug!.size[0]).toBeCloseTo(0.375, 4);
      expect(mug!.size[1]).toBeCloseTo(0.5, 4);

      expect(
        resolveMcAssetBounds(
          { kind: "item", namespace: "decor", name: "flat_coin", pack: "decor.jar" },
          { vaultRoot },
        ),
      ).toBeNull();

      // Vanilla lantern without RP override is 3D; RP 2D items/lantern.json override must return null (no stale 3D fallback)
      expect(
        resolveMcAssetBounds(
          { kind: "item", namespace: "minecraft", name: "lantern" },
          { vaultRoot },
        ),
      ).not.toBeNull();
      expect(
        resolveMcAssetBounds(
          { kind: "item", namespace: "minecraft", name: "lantern", pack: "decor.jar" },
          { vaultRoot },
        ),
      ).toBeNull();
    });
  });

  test("fails closed on traversal pack paths even when target archive or vanilla fallback exists", () => {
    withTempDir("mc-bounds-sec-", (root) => {
      const vaultRoot = setupVault(root);

      // evil.jar actually exists at vaultRoot/evil.jar; must still return null
      expect(
        resolveMcAssetBounds(
          { kind: "block", namespace: "decor", name: "bench", pack: "../evil.jar" },
          { vaultRoot },
        ),
      ).toBeNull();

      // Vanilla stone exists in client_assets.zip; traversal pack must NOT fall back to vanilla
      expect(
        resolveMcAssetBounds(
          { kind: "block", namespace: "minecraft", name: "stone", pack: "../evil.jar" },
          { vaultRoot },
        ),
      ).toBeNull();

      // Traversal namespace or name must also return null
      expect(
        resolveMcAssetBounds(
          { kind: "block", namespace: "../minecraft", name: "stone" },
          { vaultRoot },
        ),
      ).toBeNull();
      expect(
        resolveMcAssetBounds(
          { kind: "block", namespace: "minecraft", name: "../stone" },
          { vaultRoot },
        ),
      ).toBeNull();
    });
  });

  test("find --show prints resolved bounds and async itemModel guidance", () => {
    withTempDir("mc-bounds-cli-", (root) => {
      const vaultRoot = setupVault(root);

      const showBench = spawnSync("bun", ["scripts/find.ts", "--show", "block:decor:bench"], {
        cwd: ROOT,
        env: { ...process.env, MC_VAULT_ROOT: vaultRoot },
        encoding: "utf8",
        timeout: 15000,
      });
      expect(showBench.status, showBench.stderr).toBe(0);
      expect(showBench.stdout).toContain(
        "bounds: 0.5 x 0.5 x 1 blocks (x: 0.25..0.75, y: 0..0.5, z: 0..1)",
      );

      const showMug = spawnSync("bun", ["scripts/find.ts", "--show", "item:decor:mug"], {
        cwd: ROOT,
        env: { ...process.env, MC_VAULT_ROOT: vaultRoot },
        encoding: "utf8",
        timeout: 15000,
      });
      expect(showMug.status, showMug.stderr).toBe(0);
      expect(showMug.stdout).toContain(
        "bounds: 0.375 x 0.5 x 0.375 blocks (x: 0.313..0.688, y: 0..0.5, z: 0.313..0.688) [unscaled; itemModel defaults to size=0.42]",
      );
      expect(showMug.stdout).toContain('await itemModel(assets, "decor:mug")');

      const showVanillaLantern = spawnSync(
        "bun",
        ["scripts/find.ts", "--show", "item:minecraft:lantern", "--source", "minecraft"],
        {
          cwd: ROOT,
          env: { ...process.env, MC_VAULT_ROOT: vaultRoot },
          encoding: "utf8",
          timeout: 15000,
        },
      );
      expect(showVanillaLantern.status, showVanillaLantern.stderr).toBe(0);
      expect(showVanillaLantern.stdout).toContain('await itemModel(assets, "minecraft:lantern")');
      expect(showVanillaLantern.stdout).toContain("[unscaled; itemModel defaults to size=0.42]");
    });
  });
});

describe("pick.mjs missing asset errors name the culprit block or item", () => {
  test("includes [needed by block/item:<ns>:<id>] across missing textures, parent models, blockstates, and item models", () => {
    withTempDir("mc-pick-owner-", (root) => {
      const vaultDir = join(root, "packs");
      const filmDir = join(root, "film");
      mkdirSync(vaultDir, { recursive: true });
      mkdirSync(join(filmDir, "assets/public"), { recursive: true });

      const brokenZip = mkZip({
        "assets/decor/blockstates/broken_lamp.json": {
          variants: { "": { model: "decor:block/broken_lamp" } },
        },
        "assets/decor/models/block/broken_lamp.json": {
          textures: { all: "decor:block/missing_tex" },
        },
        "assets/decor/models/item/broken_cup.json": {
          parent: "decor:item/nonexistent_parent",
        },
      });
      writeFileSync(join(vaultDir, "decor.jar"), brokenZip);

      expect(() =>
        pickBlocks({
          cwd: filmDir,
          vaultDir,
          vanillaJar: join(root, "no-vanilla.zip"),
          picksOverride: [{ jar: "decor.jar", namespace: "decor", blocks: ["broken_lamp"] }],
        }),
      ).toThrow(
        /texture decor:block\/missing_tex missing .* \[needed by block:decor:broken_lamp\]/,
      );

      expect(() =>
        pickBlocks({
          cwd: filmDir,
          vaultDir,
          vanillaJar: join(root, "no-vanilla.zip"),
          picksOverride: [{ jar: "decor.jar", namespace: "decor", items: ["broken_cup"] }],
        }),
      ).toThrow(
        /model missing \(assets\/decor\/models\/item\/nonexistent_parent\.json\) \[needed by item:decor:broken_cup\]/,
      );

      expect(() =>
        pickBlocks({
          cwd: filmDir,
          vaultDir,
          vanillaJar: join(root, "no-vanilla.zip"),
          picksOverride: [{ jar: "decor.jar", namespace: "decor", blocks: ["ghost_block"] }],
        }),
      ).toThrow(
        /no blockstate assets\/decor\/blockstates\/ghost_block\.json \[needed by block:decor:ghost_block\]/,
      );

      expect(() =>
        pickBlocks({
          cwd: filmDir,
          vaultDir,
          vanillaJar: join(root, "no-vanilla.zip"),
          picksOverride: [{ jar: "decor.jar", namespace: "decor", items: ["ghost_item"] }],
        }),
      ).toThrow(
        /model missing \(assets\/decor\/models\/item\/ghost_item\.json\) \[needed by item:decor:ghost_item\]/,
      );
    });
  });
});
