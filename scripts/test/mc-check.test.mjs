import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { strToU8, zipSync } from "fflate";

const ROOT = resolve(import.meta.dir, "../..");
const CHECK_MJS = join(ROOT, "packages/live-studio/check.mjs");

const tmpRoots = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makeCheckEnv({ withVault = true } = {}) {
  const root = mkTmp("mc-check-test-");
  const vault = join(root, "vault");
  const film = join(root, "film");
  mkdirSync(join(film, "src/timeline"), { recursive: true });
  mkdirSync(join(film, "pack"), { recursive: true });
  mkdirSync(join(film, "assets/public"), { recursive: true });
  writeFileSync(join(film, "src/scene.ts"), "");
  writeFileSync(
    join(film, "src/timeline/cam.json"),
    JSON.stringify([{ t: 0, p: [0, 1, 5], l: [0, 1, 0] }]),
  );
  writeFileSync(
    join(film, "package.json"),
    JSON.stringify({
      "live-studio": {
        camTimeline: "src/timeline/cam.json",
        keyFiles: { "src/timeline/placed.json": "placed" },
      },
    }),
  );

  if (withVault) {
    mkdirSync(join(vault, "packs"), { recursive: true });
    mkdirSync(join(vault, "jar"), { recursive: true });
    mkdirSync(join(vault, "mcasset/1.21.11/entity-models/minecraft"), { recursive: true });
    mkdirSync(join(vault, "mcasset/1.21.11/entity-models/animations/minecraft"), {
      recursive: true,
    });
    writeFileSync(
      join(vault, "jar/client_assets.zip"),
      zipSync({
        "assets/minecraft/blockstates/barrel.json": strToU8(
          JSON.stringify({
            variants: { "facing=north": { model: "minecraft:block/barrel" } },
          }),
        ),
        "assets/minecraft/models/block/barrel.json": strToU8(JSON.stringify({ elements: [] })),
      }),
    );
    writeFileSync(
      join(vault, "packs/decor-mod.jar"),
      zipSync({
        "assets/decor/blockstates/oak_chair.json": strToU8(
          JSON.stringify({
            variants: { "facing=north": { model: "decor:block/oak_chair" } },
          }),
        ),
        "assets/decor/models/block/oak_chair.json": strToU8(JSON.stringify({ elements: [] })),
        "assets/decor/items/rifle.json": strToU8(JSON.stringify({ model: "decor:item/rifle" })),
      }),
    );
    writeFileSync(
      join(vault, "mcasset/1.21.11/entity-models/minecraft/armadillo.json"),
      JSON.stringify({ id: "minecraft:armadillo", layers: [] }),
    );
    writeFileSync(
      join(vault, "mcasset/1.21.11/entity-models/animations/minecraft/armadillo.json"),
      JSON.stringify({ animations: { walk: { length: 1.5, loop: true } } }),
    );
  }

  const runCheck = () =>
    spawnSync("bun", [CHECK_MJS, "--json"], {
      cwd: film,
      env: { ...process.env, MC_VAULT_ROOT: vault },
      encoding: "utf8",
      timeout: 30000,
    });

  return { vault, film, runCheck };
}

test("check passes cleanly with empty {} placed.json and [] picks.json even without vault", () => {
  const { film, runCheck } = makeCheckEnv({ withVault: false });
  writeFileSync(join(film, "src/timeline/placed.json"), "{}");
  writeFileSync(join(film, "pack/picks.json"), "[]");
  const r = runCheck();
  expect(r.status, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.ok).toBe(true);
  expect(out.warnings).toEqual([]);
});

test("check catches placed.json, gohans, picks.json, and mob faults as X errors", () => {
  const { film, runCheck } = makeCheckEnv({ withVault: true });

  writeFileSync(
    join(film, "src/timeline/placed.json"),
    JSON.stringify({
      bad_what: { what: "item:decor:rifle", keys: [{ t: 0, at: [0, 0, 0] }] },
      bad_scale: { what: "block:gohans:no_such_block", keys: [{ t: 0, at: [0, 0, 0], scale: 0 }] },
      bad_van: { what: "block:minecraft:not_real", keys: [{ t: 0, at: [0, 0, 0] }] },
      bad_mob: { what: "mob:armadillo", clip: "fly", keys: [{ t: 0, at: [0, 0, 0] }] },
    }),
  );
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([{ jar: "decor-mod.jar", namespace: "decor", blocks: ["missing_chair"] }]),
  );

  const r = runCheck();
  expect(r.status).toBe(1);
  const out = JSON.parse(r.stdout);
  expect(out.ok).toBe(false);
  const msg = out.problems.map((p) => p.issue).join("\n");
  expect(msg).toContain("block:gohans:no_such_block");
  expect(msg).toContain("block:minecraft:not_real");
  expect(msg).toContain("fly");
  expect(msg).toContain("missing_chair");
});

test("check reports key typos, unpicked mod block, invalid blockstate props, and stale picked.zip as warnings (exit 0)", () => {
  const { film, runCheck } = makeCheckEnv({ withVault: true });

  // Valid schemas + valid armadillo "none" clip, plus near-miss typo "scle", unpicked block, invalid facing property
  writeFileSync(
    join(film, "src/timeline/placed.json"),
    JSON.stringify({
      dillo: { what: "mob:armadillo", clip: "none", keys: [{ t: 0, at: [0, 0, 0], scle: 1 }] },
      barrel_bad_prop: {
        what: "block:minecraft:barrel",
        properties: { facing: "up" },
        keys: [{ t: 0, at: [0, 0, 0] }],
      },
      chair_unpicked: { what: "block:decor:oak_chair", keys: [{ t: 0, at: [0, 0, 0] }] },
    }),
  );

  // Pick another valid item without generating picked.zip (stale/missing zip warning)
  const picksFile = join(film, "pack/picks.json");
  writeFileSync(
    picksFile,
    JSON.stringify([{ jar: "decor-mod.jar", namespace: "decor", items: ["rifle"], naem: "x" }]),
  );
  const future = new Date(Date.now() + 2000);
  utimesSync(picksFile, future, future);

  const r = runCheck();
  expect(r.status, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.ok).toBe(true);
  const w = out.warnings.join("\n");
  expect(w).toContain('did you mean "scale"');
  expect(w).toContain("chair_unpicked");
  expect(w).toContain("facing");
  expect(w).toContain("picked.zip");
});

test("check validates picked mod block properties, RP model-only fallback properties, and non-array mob keys without crashing", () => {
  const { vault, film, runCheck } = makeCheckEnv({ withVault: true });

  writeFileSync(
    join(vault, "packs/rp-barrel.zip"),
    zipSync({
      "assets/minecraft/models/block/barrel.json": strToU8(JSON.stringify({ elements: [] })),
    }),
  );
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([
      { jar: "decor-mod.jar", namespace: "decor", blocks: ["oak_chair"] },
      { jar: "rp-barrel.zip", namespace: "minecraft", blocks: ["barrel"] },
    ]),
  );
  writeFileSync(
    join(film, "src/timeline/placed.json"),
    JSON.stringify({
      chair: {
        what: "block:decor:oak_chair",
        properties: { facing: "bad_dir" },
        keys: [{ t: 0, at: [0, 0, 0] }],
      },
      barrel: {
        what: "block:minecraft:barrel",
        properties: { facing: "up" },
        keys: [{ t: 0, at: [0, 0, 0] }],
      },
      broken_mob: {
        what: "mob:armadillo",
        keys: "not-an-array",
      },
    }),
  );

  const r = runCheck();
  expect(r.status).toBe(1);
  const out = JSON.parse(r.stdout);
  expect(out.ok).toBe(false);
  const w = out.warnings.join("\n");
  expect(w).toContain('"chair": property facing="bad_dir"');
  expect(w).toContain('"barrel": property facing="up"');
  expect(out.problems.map((p) => p.issue).join("\n")).toContain("broken_mob");
});

test("check reports corrupt pack zip cleanly and keeps contract-keys + cli-catalog parity", async () => {
  const { vault, film, runCheck } = makeCheckEnv({ withVault: true });
  writeFileSync(
    join(vault, "jar/client_assets.zip"),
    zipSync({
      "assets/minecraft/blockstates/barrel.json": strToU8(
        JSON.stringify({
          variants: { "facing=north": { model: "minecraft:block/barrel" } },
        }),
      ),
      "assets/minecraft/models/block/barrel.json": strToU8(JSON.stringify({ elements: [] })),
      "assets/minecraft/blockstates/stone.json": strToU8(
        JSON.stringify({ variants: { "": { model: "minecraft:block/stone" } } }),
      ),
      "assets/minecraft/models/block/stone.json": strToU8(JSON.stringify({ elements: [] })),
    }),
  );
  writeFileSync(join(vault, "packs/corrupt.jar"), "not-a-zip");
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([{ jar: "corrupt.jar", namespace: "decor", blocks: ["oak_chair"] }]),
  );
  writeFileSync(
    join(film, "src/timeline/placed.json"),
    JSON.stringify({
      chair: {
        what: "block:decor:oak_chair",
        properties: { facing: "north" },
        keys: [{ t: 0, at: [0, 0, 0] }],
      },
      stone_bad: {
        what: "block:minecraft:stone",
        properties: { facing: "north" },
        keys: [{ t: 0, at: [0, 0, 0] }],
      },
      stone_str: {
        what: "block:minecraft:stone",
        properties: "bad_non_object",
        keys: [{ t: 0, at: [0, 0, 0] }],
      },
    }),
  );

  const r = runCheck();
  expect(r.status).toBe(1);
  const out = JSON.parse(r.stdout);
  expect(out.problems.map((p) => p.issue).join("\n")).toContain('corrupt archive "corrupt.jar"');
  expect(out.warnings.join("\n")).toContain(
    '"stone_bad": property "facing" not in blockstate (known: none)',
  );
  expect(out.warnings.join("\n")).not.toContain('stone_str": property "0"');

  const { PLACED_OBJECT_KEYS, PLACED_KEY_KEYS, PICK_KEYS } =
    await import("../../packages/live-studio/src/contract-keys.ts");
  const { PlacedObjectSchema, PlacedKeySchema, PickEntrySchema } =
    await import("../../packages/live-studio/src/contract.ts");
  expect(PLACED_OBJECT_KEYS).toEqual(Object.keys(PlacedObjectSchema.shape));
  expect(PLACED_KEY_KEYS).toEqual(Object.keys(PlacedKeySchema.shape));
  const pickShape =
    PickEntrySchema._def?.schema?.shape ??
    PickEntrySchema.unwrap?.()?.shape ??
    PickEntrySchema.shape;
  expect(PICK_KEYS).toEqual(Object.keys(pickShape));

  const { buildCliInvocation } = await import("../../packages/live-studio/src/cli-catalog.ts");
  const inv = buildCliInvocation({
    commandId: "asset",
    subcommandPath: ["timeline"],
    flags: { "--lane": "placed", "--duration": 12 },
  });
  expect(inv.argvTokens).toContain("--duration");

  expect(
    buildCliInvocation({
      commandId: "find",
      subcommandPath: [],
      flags: { "--kind": "sound", "--edition": "vanilla" },
    }).argvTokens,
  ).toEqual(["--kind", "sound", "--edition", "vanilla"]);
  expect(
    buildCliInvocation({
      commandId: "find",
      subcommandPath: [],
      flags: { "--kind": "prop", "--edition": "vanilla" },
    }).argvTokens,
  ).toEqual(["--kind", "prop"]);
  expect(
    buildCliInvocation({
      commandId: "find",
      subcommandPath: [],
      flags: { "--kind": "custom", "--variants": true },
    }).argvTokens,
  ).toEqual(["--kind", "custom", "--variants"]);
  expect(
    buildCliInvocation({
      commandId: "asset",
      subcommandPath: ["plan"],
      args: { id: "dissolve" },
      flags: { "--kind": "transition" },
    }).argvTokens,
  ).toEqual(["plan", "dissolve", "--kind", "transition"]);
});
