import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { strToU8, zipSync } from "fflate";

import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { allEntries, objectEntries, run as findRun } from "../find";

const ROOT = resolve(import.meta.dir, "../..");
const FIND_TS = join(ROOT, "scripts/find.ts");

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makeFindEnv() {
  const root = mkTmp("mc-find-test-");
  const vault = join(root, "vault");
  const film = join(root, "film");
  mkdirSync(join(vault, "packs"), { recursive: true });
  mkdirSync(join(vault, "jar"), { recursive: true });
  mkdirSync(join(vault, "props/signs"), { recursive: true });
  mkdirSync(join(vault, "mcasset/1.21.11/entity-models/minecraft"), { recursive: true });
  mkdirSync(join(vault, "mcasset/1.21.11/entity-models/animations/minecraft"), {
    recursive: true,
  });
  mkdirSync(join(film, "src/props"), { recursive: true });
  mkdirSync(join(film, "pack"), { recursive: true });
  writeFileSync(join(film, "src/scene.ts"), "");
  writeFileSync(join(film, "package.json"), JSON.stringify({ name: "find-demo" }));

  // Global & film props
  writeFileSync(join(vault, "props/signs/neon_sign.ts"), "export function makeNeon() {}");
  writeFileSync(join(vault, "props/signs/neon_sign.glb"), new Uint8Array([103, 108, 84, 70]));
  writeFileSync(join(film, "src/props/cafe_table.ts"), "export function makeCafeTable() {}");

  // Vanilla jar
  writeFileSync(
    join(vault, "jar/client_assets.zip"),
    zipSync({
      "assets/minecraft/blockstates/barrel.json": strToU8(
        JSON.stringify({
          variants: {
            "facing=north,open=false": { model: "minecraft:block/barrel" },
            "facing=west,open=true": { model: "minecraft:block/barrel_open" },
          },
        }),
      ),
      "assets/minecraft/models/block/barrel.json": strToU8(
        JSON.stringify({ textures: { side: "minecraft:block/barrel_side" } }),
      ),
      "assets/minecraft/models/block/barrel_open.json": strToU8(
        JSON.stringify({ textures: { side: "minecraft:block/barrel_side" } }),
      ),
      "assets/minecraft/textures/block/barrel_side.png": new Uint8Array([1, 2]),
      "assets/minecraft/items/barrel.json": strToU8(
        JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/barrel" } }),
      ),
      "assets/minecraft/models/item/barrel.json": strToU8(
        JSON.stringify({
          parent: "minecraft:item/generated",
          textures: { layer0: "minecraft:item/iron_sword" },
        }),
      ),
      "assets/minecraft/models/item/generated.json": strToU8(
        JSON.stringify({ parent: "builtin/generated" }),
      ),
      "assets/minecraft/items/iron_sword.json": strToU8(
        JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/iron_sword" } }),
      ),
      "assets/minecraft/models/item/iron_sword.json": strToU8(
        JSON.stringify({
          parent: "minecraft:item/generated",
          textures: { layer0: "minecraft:item/iron_sword" },
        }),
      ),
      "assets/minecraft/textures/item/iron_sword.png": new Uint8Array([1]),
    }),
  );

  // Modded pack with chair variants + item + broken loader
  writeFileSync(
    join(vault, "packs/decor-mod.jar"),
    zipSync({
      "assets/decor/blockstates/oak_chair.json": strToU8(
        JSON.stringify({ variants: { "facing=north": { model: "decor:block/oak_chair" } } }),
      ),
      "assets/decor/blockstates/birch_chair.json": strToU8(
        JSON.stringify({ variants: { "facing=north": { model: "decor:block/birch_chair" } } }),
      ),
      "assets/decor/blockstates/spruce_chair.json": strToU8(
        JSON.stringify({ variants: { "facing=north": { model: "decor:block/spruce_chair" } } }),
      ),
      "assets/decor/blockstates/custom_loader_tank.json": strToU8(
        JSON.stringify({ variants: { "": { model: "decor:block/custom_loader_tank" } } }),
      ),
      "assets/decor/models/block/oak_chair.json": strToU8(
        JSON.stringify({ textures: { a: "decor:block/chair" } }),
      ),
      "assets/decor/models/block/birch_chair.json": strToU8(
        JSON.stringify({ parent: "decor:block/oak_chair" }),
      ),
      "assets/decor/models/block/spruce_chair.json": strToU8(
        JSON.stringify({ parent: "decor:block/oak_chair" }),
      ),
      "assets/decor/models/block/custom_loader_tank.json": strToU8(
        JSON.stringify({ loader: "forge:obj", model: "decor:models/block/tank.obj" }),
      ),
      "assets/decor/items/rifle.json": strToU8(
        JSON.stringify({ model: { type: "minecraft:model", model: "decor:item/rifle" } }),
      ),
      "assets/decor/models/item/rifle.json": strToU8(
        JSON.stringify({
          parent: "minecraft:item/generated",
          textures: { layer0: "decor:item/rifle" },
        }),
      ),
      "assets/decor/textures/block/chair.png": new Uint8Array([1]),
      "assets/decor/textures/item/rifle.png": new Uint8Array([1]),
    }),
  );

  writeFileSync(
    join(vault, "packs/arr-mod.jar"),
    zipSync({
      "assets/arr/blockstates/secret_crate.json": strToU8(
        JSON.stringify({ variants: { "": { model: "arr:block/secret_crate" } } }),
      ),
      "assets/arr/models/block/secret_crate.json": strToU8(
        JSON.stringify({ textures: { a: "arr:block/crate" } }),
      ),
      "assets/arr/textures/block/crate.png": new Uint8Array([1]),
    }),
  );

  writeFileSync(
    join(vault, "packs_index.json"),
    JSON.stringify({
      "decor-mod.jar": {
        title: "Decor Mod",
        slug: "decor-mod",
        url: "https://modrinth.com/mod/decor-mod",
        type: "mod",
        downloads: 120000,
        license: { id: "MIT", name: "MIT License" },
      },
      "arr-mod.jar": {
        title: "ARR Mod",
        slug: "arr-mod",
        url: "https://modrinth.com/mod/arr-mod",
        type: "mod",
        downloads: 500,
        license: { id: "LicenseRef-All-Rights-Reserved" },
      },
    }),
  );

  writeFileSync(
    join(vault, "mcasset/1.21.11/entity-models/minecraft/_list.json"),
    JSON.stringify({ files: ["armadillo.json"] }),
  );
  writeFileSync(
    join(vault, "mcasset/1.21.11/entity-models/animations/minecraft/armadillo.json"),
    JSON.stringify({
      animations: {
        walk: { length: 1.5, loop: true },
        peek: { length: 2.5, loop: false },
      },
    }),
  );

  const runCli = (args: string[], cwd = film) =>
    spawnSync("bun", [FIND_TS, ...args], {
      cwd,
      env: { ...process.env, MC_VAULT_ROOT: vault, MC_FIND_OFFLINE: "1" },
      encoding: "utf8",
      timeout: 20000,
    });

  return { vault, film, runCli };
}

test("allEntries keeps object kinds isolated while objectEntries loads block/item/mob/prop", async () => {
  const { vault, film } = makeFindEnv();
  const base = allEntries(true, ROOT);
  expect(base.some((x) => ["block", "item", "mob", "prop"].includes(x.kind))).toBe(false);

  const objs = await objectEntries({ vaultRoot: vault, filmRoot: film });
  expect(objs.some((x) => x.kind === "block" && x.id === "block:decor:oak_chair")).toBe(true);
  expect(objs.some((x) => x.kind === "item" && x.id === "item:decor:rifle")).toBe(true);
  expect(objs.some((x) => x.kind === "mob" && x.id === "mob:armadillo")).toBe(true);
  expect(objs.some((x) => x.kind === "prop" && x.id === "prop:global:signs/neon_sign")).toBe(true);
  expect(objs.some((x) => x.kind === "prop" && x.id === "prop:film:cafe_table")).toBe(true);
});

test("find --kind object/block/item/mob/prop searches, folds variants, and filters broken/edition/license/source", () => {
  const { film, runCli } = makeFindEnv();

  // Variant folding + broken hiding on chair
  const chairs = runCli(["chair", "--kind", "block"]);
  expect(chairs.status, chairs.stderr).toBe(0);
  expect(chairs.stdout).toContain("chair");
  expect(chairs.stdout).toContain("+2 variants");
  expect(chairs.stdout).toContain("--variants");

  // Unfold variants
  const unfolded = runCli(["chair", "--kind", "block", "--variants"]);
  expect(unfolded.status, unfolded.stderr).toBe(0);
  expect(unfolded.stdout).toContain("oak_chair");
  expect(unfolded.stdout).toContain("birch_chair");
  expect(unfolded.stdout).toContain("spruce_chair");

  // Broken hidden by default, shown with --broken
  const tankHidden = runCli(["tank", "--kind", "block"]);
  expect(tankHidden.stdout).toContain("non-renderable");
  expect(tankHidden.stdout).toContain("--broken");
  const tankShown = runCli(["tank", "--kind", "block", "--broken"]);
  expect(tankShown.status, tankShown.stderr).toBe(0);
  expect(tankShown.stdout).toContain("custom_loader_tank");

  // Umbrella --kind 3d alias searches across blocks, items, mobs, props
  const allObj = runCli(["--kind", "3d", "-n", "50"]);
  expect(allObj.status, allObj.stderr).toBe(0);
  expect(allObj.stdout).toContain("block");
  expect(allObj.stdout).toContain("item:decor:rifle");
  expect(allObj.stdout).toContain("mob:armadillo");
  expect(allObj.stdout).toContain("prop:global:signs/neon_sign");

  // Edition + License + Source filters
  const vanillaOnly = runCli(["--kind", "block", "--edition", "vanilla"]);
  expect(vanillaOnly.status, vanillaOnly.stderr).toBe(0);
  expect(vanillaOnly.stdout).toContain("barrel");
  expect(vanillaOnly.stdout).not.toContain("oak_chair");

  const mitOnly = runCli(["--kind", "block", "--license", "mit"]);
  expect(mitOnly.status, mitOnly.stderr).toBe(0);
  expect(mitOnly.stdout).toContain("oak_chair");
  expect(mitOnly.stdout).not.toContain("barrel");

  // Rich --show outputs (including variants for head + sibling + 2-arg resolveModelData)
  const showBlock = runCli(["--show", "block:minecraft:barrel"]);
  expect(showBlock.status, showBlock.stderr).toBe(0);
  expect(showBlock.stdout).toContain("facing");
  expect(showBlock.stdout).toContain("asset use block:minecraft:barrel");

  const showModBlock = runCli(["--show", "block:decor:oak_chair"]);
  expect(showModBlock.status, showModBlock.stderr).toBe(0);
  expect(showModBlock.stdout).toContain("MIT");
  expect(showModBlock.stdout).toContain("variants (3):");
  expect(showModBlock.stdout).toContain("birch_chair");
  expect(showModBlock.stdout).toContain("spruce_chair");
  expect(showModBlock.stdout).toContain("asset pick block:decor:oak_chair");

  const showSibling = runCli(["--show", "block:decor:spruce_chair"]);
  expect(showSibling.status, showSibling.stderr).toBe(0);
  expect(showSibling.stdout).toContain("variants (3):");

  const showItem = runCli(["--show", "item:decor:rifle"]);
  expect(showItem.status, showItem.stderr).toBe(0);
  expect(showItem.stdout).toContain("asset pick item:decor:rifle");
  expect(showItem.stdout).toContain("resolveModelData(assets,");
  expect(showItem.stdout).toContain("loadModel(");

  // --license minecraft / free sorting excludes LicenseRef-All-Rights-Reserved from free
  const licenseVanilla = runCli(["--kind", "block", "--license", "minecraft"]);
  expect(licenseVanilla.status, licenseVanilla.stderr).toBe(0);
  expect(licenseVanilla.stdout).toContain("barrel");
  expect(licenseVanilla.stdout).not.toContain("oak_chair");

  const licenseFree = runCli(["--kind", "block", "--license", "free"]);
  expect(licenseFree.status, licenseFree.stderr).toBe(0);
  expect(licenseFree.stdout).toContain("gohans:");
  expect(licenseFree.stdout).not.toContain("secret_crate");
  expect(licenseFree.stdout).not.toContain("barrel");

  // Empty --kind prop returns clear recovery message rather than Unknown --kind prop
  const emptyPropVault = join(mkTmp("mc-empty-prop-"), "vault");
  const emptyPropFilm = mkTmp("mc-empty-prop-film-");
  mkdirSync(emptyPropVault, { recursive: true });
  const emptyProp = spawnSync("bun", [FIND_TS, "--kind", "prop"], {
    cwd: emptyPropFilm,
    env: { ...process.env, MC_VAULT_ROOT: emptyPropVault },
    encoding: "utf8",
    timeout: 15000,
  });
  expect(emptyProp.status).toBe(2);
  expect(emptyProp.stderr).toContain("prop has no custom props yet");
  expect(existsSync(join(emptyPropVault, "cache/mc-catalog.v1.json"))).toBe(false);

  const showMob = runCli(["--show", "mob:armadillo"]);
  expect(showMob.status, showMob.stderr).toBe(0);
  expect(showMob.stdout).toContain("walk (1.5s loop)");
  expect(showMob.stdout).toContain("asset use mob:armadillo");

  const showProp = runCli(["--show", "prop:global:signs/neon_sign"]);
  expect(showProp.status, showProp.stderr).toBe(0);
  expect(showProp.stdout).toContain("source: signs/neon_sign.ts");
  expect(showProp.stdout).toContain("model: signs/neon_sign.glb");
  expect(showProp.stdout).toContain("asset use prop:global:signs/neon_sign");

  // GLB-only film prop omits fake TypeScript import snippet
  mkdirSync(join(film, "src/props"), { recursive: true });
  writeFileSync(join(film, "src/props/crate_mesh.glb"), new Uint8Array([103, 108, 84, 70]));
  const showGlbProp = runCli(["--show", "prop:film:crate_mesh"]);
  expect(showGlbProp.status, showGlbProp.stderr).toBe(0);
  expect(showGlbProp.stdout).toContain("model: crate_mesh.glb");
  expect(showGlbProp.stdout).toContain("via GLTFLoader");
  expect(showGlbProp.stdout).not.toContain('import from "./props/crate_mesh"');

  // Now cache is warm -> unscoped `bun run find chair` mentions --kind object hint
  const unscopedWarm = runCli(["chair"]);
  expect(unscopedWarm.status, unscopedWarm.stderr).toBe(0);
  expect(unscopedWarm.stdout).toContain("--kind object");
}, 20000);

test("find supports --star/--unstar on 3D object IDs and mixed --show without false ambiguity", async () => {
  const { vault, film } = makeFindEnv();
  const prevVault = process.env.MC_VAULT_ROOT;
  const favs = favoriteLists(join(film, "favorites"));
  process.env.MC_VAULT_ROOT = vault;
  try {
    // Mixed native preset + 3D object in --show
    const mixed = await findRun(
      ["--show", "dissolve,mob:armadillo"],
      undefined,
      undefined,
      undefined,
      favs,
    );
    expect(mixed).toContain("transition/dissolve");
    expect(mixed).toContain("mob:armadillo");

    // Bare name present as both block and item -> names both ambiguous matches rather than "no entry"
    await expect(
      findRun(["--show", "barrel"], undefined, undefined, undefined, favs),
    ).rejects.toThrow(/matches 2 entries.*block:minecraft:barrel.*item:minecraft:barrel/s);

    const starred = await findRun(
      ["--star", "mob:armadillo,block:decor:oak_chair", "--fav", "props"],
      undefined,
      undefined,
      undefined,
      favs,
    );
    expect(starred).toContain("mob:armadillo");
    expect(starred).toContain("block:decor:oak_chair");
    const listed = await findRun(
      ["--kind", "object", "--fav", "props"],
      undefined,
      undefined,
      undefined,
      favs,
    );
    expect(listed).toContain("mob:armadillo");
    expect(listed).toContain("block:decor:oak_chair");

    // --fav without --kind loads starred 3D objects automatically
    const favOnly = await findRun(["--fav", "props"], undefined, undefined, undefined, favs);
    expect(favOnly).toContain("mob:armadillo");
    expect(favOnly).toContain("block:decor:oak_chair");

    // Bare --kind / --source mention opt-in 3D kinds and pack sources
    await expect(findRun(["--kind"], undefined, undefined, undefined, favs)).rejects.toThrow(
      /3D objects.*block, item, mob, prop/,
    );
    await expect(findRun(["--source"], undefined, undefined, undefined, favs)).rejects.toThrow(
      /3D objects.*decor-mod/,
    );

    // Same block ID in two packs keeps distinct variants per pack and prints --source tip
    const dupVault = mkTmp("mc-find-dup-");
    mkdirSync(join(dupVault, "packs"), { recursive: true });
    mkdirSync(join(dupVault, "jar"), { recursive: true });
    writeFileSync(join(dupVault, "jar/client_assets.zip"), zipSync({}));
    writeFileSync(
      join(dupVault, "packs/pack-a.zip"),
      zipSync({
        "assets/custom/blockstates/oak_wall.json": strToU8(
          JSON.stringify({ variants: { "": { model: "custom:block/oak_wall" } } }),
        ),
        "assets/custom/models/block/oak_wall.json": strToU8(JSON.stringify({ elements: [] })),
        "assets/custom/blockstates/birch_wall.json": strToU8(
          JSON.stringify({ variants: { "": { model: "custom:block/birch_wall" } } }),
        ),
        "assets/custom/models/block/birch_wall.json": strToU8(JSON.stringify({ elements: [] })),
      }),
    );
    writeFileSync(
      join(dupVault, "packs/pack-b.zip"),
      zipSync({
        "assets/custom/blockstates/oak_wall.json": strToU8(
          JSON.stringify({ variants: { "": { model: "custom:block/oak_wall" } } }),
        ),
        "assets/custom/models/block/oak_wall.json": strToU8(JSON.stringify({ elements: [] })),
        "assets/custom/blockstates/spruce_wall.json": strToU8(
          JSON.stringify({ variants: { "": { model: "custom:block/spruce_wall" } } }),
        ),
        "assets/custom/models/block/spruce_wall.json": strToU8(JSON.stringify({ elements: [] })),
      }),
    );
    process.env.MC_VAULT_ROOT = dupVault;
    const dupShown = await findRun(
      ["--show", "block:custom:oak_wall"],
      undefined,
      undefined,
      undefined,
      favs,
    );
    expect(dupShown).toContain("2 sources share the id block:custom:oak_wall: add --source <name>");
    expect(dupShown).toContain("variants (2): oak_wall, birch_wall");
    expect(dupShown).toContain("variants (2): oak_wall, spruce_wall");
  } finally {
    if (prevVault === undefined) delete process.env.MC_VAULT_ROOT;
    else process.env.MC_VAULT_ROOT = prevVault;
  }
});
