import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { strToU8, unzipSync, zipSync } from "fflate";
import { Hono } from "hono";

import { openAssets } from "../../packages/live-studio/src/assets.mjs";

const ROOT = resolve(import.meta.dir, "../..");
const ASSET_MJS = join(ROOT, "scripts/asset.mjs");

const tmpRoots = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function mkTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makeEnv({ speedRate = 2 } = {}) {
  const root = mkTmp("mc-asset-placed-");
  const vault = join(root, "vault");
  const film = join(root, "film");
  mkdirSync(join(vault, "packs"), { recursive: true });
  mkdirSync(join(vault, "jar"), { recursive: true });
  mkdirSync(join(vault, "props/signs"), { recursive: true });
  mkdirSync(join(vault, "mcasset/1.21.11/entity-models/minecraft"), { recursive: true });
  mkdirSync(join(vault, "mcasset/1.21.11/entity-models/animations/minecraft"), {
    recursive: true,
  });
  mkdirSync(join(film, "src/timeline"), { recursive: true });
  mkdirSync(join(film, "src/props"), { recursive: true });
  mkdirSync(join(film, "pack"), { recursive: true });
  writeFileSync(join(film, "src/scene.ts"), "");
  writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 20 }));
  const conf = {
    shotsTimeline: "src/timeline/shots.json",
    textTimeline: "src/timeline/text.json",
    adjustmentTimeline: "src/timeline/adjust.json",
    soundTimeline: "src/timeline/audio.json",
    timingTimeline: "src/timeline/timing.json",
    sfx: "sound/sfx",
    keyFiles: { "src/timeline/placed.json": "placed" },
  };
  writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
  writeFileSync(
    join(film, conf.timingTimeline),
    JSON.stringify({ speeds: [{ from: 0, to: 20, rate: speedRate }] }),
  );
  writeFileSync(join(film, conf.shotsTimeline), JSON.stringify([{ t: 0 }, { t: 10 }]));

  writeFileSync(
    join(vault, "jar/client_assets.zip"),
    zipSync({
      "assets/minecraft/blockstates/barrel.json": strToU8(
        JSON.stringify({
          variants: { "facing=north": { model: "minecraft:block/barrel" } },
        }),
      ),
      "assets/minecraft/models/block/barrel.json": strToU8(
        JSON.stringify({ textures: { side: "minecraft:block/barrel_side" } }),
      ),
      "assets/minecraft/textures/block/barrel_side.png": new Uint8Array([1]),
      "assets/minecraft/models/item/generated.json": strToU8(
        JSON.stringify({ parent: "builtin/generated" }),
      ),
    }),
  );

  writeFileSync(
    join(vault, "packs/decor-mod.jar"),
    zipSync({
      "assets/decor/blockstates/oak_chair.json": strToU8(
        JSON.stringify({ variants: { "facing=north": { model: "decor:block/oak_chair" } } }),
      ),
      "assets/decor/models/block/oak_chair.json": strToU8(
        JSON.stringify({ textures: { a: "decor:block/chair" } }),
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
    join(vault, "packs/other-decor.jar"),
    zipSync({
      "assets/decor/blockstates/oak_chair.json": strToU8(
        JSON.stringify({ variants: { "facing=north": { model: "decor:block/oak_chair" } } }),
      ),
      "assets/decor/models/block/oak_chair.json": strToU8(
        JSON.stringify({ textures: { a: "decor:block/chair" } }),
      ),
      "assets/decor/textures/block/chair.png": new Uint8Array([9]),
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
        license: { id: "MIT", name: "MIT License" },
      },
      "other-decor.jar": {
        title: "Other Decor",
        slug: "other-decor",
        url: "https://modrinth.com/mod/other-decor",
        type: "mod",
        license: { id: "Apache-2.0", name: "Apache License 2.0" },
      },
    }),
  );

  writeFileSync(
    join(vault, "mcasset/1.21.11/entity-models/minecraft/_list.json"),
    JSON.stringify({ files: ["armadillo.json"] }),
  );
  writeFileSync(
    join(vault, "mcasset/1.21.11/entity-models/animations/minecraft/armadillo.json"),
    JSON.stringify({ animations: { walk: { length: 1.5, loop: true } } }),
  );

  // Global props: one clean bundle, one importing an uncopied helper
  writeFileSync(
    join(vault, "props/signs/neon_sign.ts"),
    'import * as THREE from "three"; export const makeNeon = () => new THREE.Group();',
  );
  writeFileSync(join(vault, "props/signs/neon_sign.glb"), new Uint8Array([103, 108, 84, 70]));
  writeFileSync(
    join(vault, "props/bad_dep.ts"),
    'import { helper } from "./shared_helper"; export const bad = helper;',
  );
  writeFileSync(join(vault, "props/shared_helper.ts"), "export const helper = 1;");

  const run = (...args) =>
    spawnSync("bun", [ASSET_MJS, ...args], {
      cwd: film,
      env: { ...process.env, MC_VAULT_ROOT: vault },
      encoding: "utf8",
      timeout: 20000,
    });
  const json = (...args) => {
    const r = run(...args);
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };
  return { root, vault, film, conf, run, json };
}

test("asset pick, timeline --lane picks, and unpick manage pack/picks.json and warn on placed refs", () => {
  const { film, run, json } = makeEnv();

  // Ambiguous across decor-mod and other-decor -> exit 2 listing both sources
  const amb = run("pick", "block:decor:oak_chair", "--film", film);
  expect(amb.status).toBe(2);
  expect(amb.stderr).toContain("decor-mod");
  expect(amb.stderr).toContain("other-decor");

  const p = json(
    "pick",
    "block:decor:oak_chair,item:decor:rifle",
    "--film",
    film,
    "--source",
    "decor-mod",
  );
  expect(p.added).toEqual(["block:decor:oak_chair", "item:decor:rifle"]);
  expect(existsSync(join(film, "assets/public/picked.zip"))).toBe(true);
  const picks = JSON.parse(readFileSync(join(film, "pack/picks.json"), "utf8"));
  expect(picks[0]).toMatchObject({
    jar: "decor-mod.jar",
    namespace: "decor",
    licence: "MIT",
    blocks: ["oak_chair"],
    items: ["rifle"],
  });

  const tl = json("timeline", "--film", film, "--lane", "picks");
  expect(tl.zip.exists).toBe(true);
  expect(tl.zip.blocks).toBe(1);
  expect(tl.zip.items).toBe(1);

  // Place the picked block, then unpick -> warns that placed object still uses it
  json("use", "block:decor:oak_chair", "--film", film, "--from", "1");
  const unpick = json("unpick", "block:decor:oak_chair", "--film", film, "--source", "decor-mod");
  expect(unpick.removed).toEqual(["block:decor:oak_chair"]);
  expect(unpick.warnings.join("\n")).toContain("block:decor:oak_chair");

  // --no-pick works even when the block exists in multiple packs without --source
  const np = json("use", "block:decor:oak_chair", "--film", film, "--from", "2", "--no-pick");
  expect(np.picked).toBeUndefined();
}, 20000);

test("asset unpick preserves both pick files when a remaining pack cannot build", () => {
  const { film, run, json } = makeEnv();
  json("pick", "block:decor:oak_chair,item:decor:rifle", "--source", "decor-mod");
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([
      { jar: "decor-mod.jar", namespace: "decor", blocks: ["oak_chair"], items: ["rifle"] },
      { jar: "missing.jar", namespace: "other", blocks: ["cabinet"] },
    ]),
  );
  const manifest = join(film, "pack/picks.json");
  const output = join(film, "assets/public/picked.zip");
  const originalManifest = readFileSync(manifest);
  const originalZip = readFileSync(output);

  const result = run("unpick", "block:decor:oak_chair,item:decor:rifle");

  expect(result.status).toBe(1);
  expect(readFileSync(manifest)).toEqual(originalManifest);
  expect(readFileSync(output)).toEqual(originalZip);
});

test("asset use validates placement before publishing an auto-pick", () => {
  const { film, run } = makeEnv();
  const result = run(
    "use",
    "block:decor:oak_chair",
    "--source",
    "decor-mod",
    "--props",
    JSON.stringify({ clip: "walk" }),
  );

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("clip");
  expect(existsSync(join(film, "pack/picks.json"))).toBe(false);
  expect(existsSync(join(film, "assets/public/picked.zip"))).toBe(false);
});

test("asset use preserves a read-only manifest and leaves neither placement nor ZIP", () => {
  const { film, run } = makeEnv();
  const manifest = join(film, "pack/picks.json");
  writeFileSync(manifest, "[]");
  chmodSync(manifest, 0o444);
  try {
    const result = run("use", "block:decor:oak_chair", "--source", "decor-mod");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("read-only");
    expect(readFileSync(manifest, "utf8")).toBe("[]");
    expect(existsSync(join(film, "assets/public/picked.zip"))).toBe(false);
    expect(existsSync(join(film, "src/timeline/placed.json"))).toBe(false);
  } finally {
    chmodSync(manifest, 0o644);
  }
});

test("a pending mod pick with a missing archive does not block placement of a vanilla block", () => {
  const { film, json } = makeEnv();
  const manifest = join(film, "pack/picks.json");
  const picks = JSON.stringify([{ jar: "missing.jar", namespace: "decor", blocks: ["cabinet"] }]);
  writeFileSync(manifest, picks);

  const result = json("use", "block:minecraft:barrel");
  expect(result.object.what).toBe("block:minecraft:barrel");
  expect(readFileSync(manifest, "utf8")).toBe(picks);
  expect(json("timeline", "--lane", "picks").zip.stale).toBe(true);
});

test("archive filenames select exactly one source in find, pick and unpick", () => {
  const { film, vault, json } = makeEnv();
  const id = "block:decor:oak_chair";
  writeFileSync(
    join(vault, "packs/decor-mod.zip"),
    readFileSync(join(vault, "packs/other-decor.jar")),
  );
  const show = spawnSync(
    "bun",
    [join(ROOT, "scripts/find.ts"), "--show", id, "--source", "decor-mod.jar"],
    { cwd: film, env: { ...process.env, MC_VAULT_ROOT: vault }, encoding: "utf8", timeout: 20000 },
  );
  expect(show.status, show.stderr).toBe(0);
  expect(show.stdout).toContain("decor-mod.jar");
  expect(show.stdout).not.toContain("decor-mod.zip");
  const search = spawnSync(
    "bun",
    [join(ROOT, "scripts/find.ts"), "oak chair", "--kind", "block", "--json", "--offline"],
    { cwd: film, env: { ...process.env, MC_VAULT_ROOT: vault }, encoding: "utf8", timeout: 20000 },
  );
  expect(search.status, search.stderr).toBe(0);
  const hits = JSON.parse(search.stdout).keyword.results.filter((result) => result.id === id);
  expect(new Set(hits.map((result) => result.key)).size).toBe(3);
  json("pick", id, "--source", "decor-mod.jar");
  writeFileSync(
    join(film, "pack/picks.json"),
    JSON.stringify([
      { jar: "decor-mod.jar", namespace: "decor", blocks: ["oak_chair"] },
      { jar: "decor-mod.zip", namespace: "decor", blocks: ["oak_chair"] },
    ]),
  );
  const removed = json("unpick", id, "--source", "decor-mod.jar");
  expect(removed.picks.map((row) => row.jar)).toEqual(["decor-mod.zip"]);
});

test("asset use builds pending picks and reports a ZIP stale after unpicking the last asset without building", () => {
  const { film, json } = makeEnv();
  json("pick", "block:decor:oak_chair", "--source", "decor-mod", "--no-build");
  expect(json("timeline", "--lane", "picks").zip.stale).toBe(true);

  json("use", "block:decor:oak_chair");

  const zip = unzipSync(readFileSync(join(film, "assets/public/picked.zip")));
  expect(zip["assets/decor/blockstates/oak_chair.json"]).toBeDefined();
  expect(json("timeline", "--lane", "picks").zip.stale).toBe(false);
  json("unpick", "block:decor:oak_chair", "--no-build");
  expect(json("timeline", "--lane", "picks").zip.stale).toBe(true);
});

test("asset pick and use reject a second source for the same runtime block ID", () => {
  const { film, run, json } = makeEnv();
  const id = "block:decor:oak_chair";
  json("pick", id, "--source", "decor-mod");
  const output = join(film, "assets/public/picked.zip");
  const originalZip = readFileSync(output);

  for (const command of ["pick", "use"]) {
    const result = run(command, id, "--source", "other-decor");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("decor-mod.jar");
    expect(result.stderr).toContain("unpick");
  }
  expect(json("timeline", "--lane", "picks").data.map((row) => row.jar)).toEqual(["decor-mod.jar"]);
  expect(readFileSync(output)).toEqual(originalZip);
  expect(existsSync(join(film, "src/timeline/placed.json"))).toBe(false);
});

test("asset pick rejects different assets that would publish conflicting texture bytes", () => {
  const { vault, run, json } = makeEnv();
  json("pick", "block:decor:oak_chair", "--source", "decor-mod");
  writeFileSync(
    join(vault, "packs/table.jar"),
    zipSync({
      "assets/decor/blockstates/table.json": strToU8(
        '{"variants":{"":{"model":"decor:block/table"}}}',
      ),
      "assets/decor/models/block/table.json": strToU8('{"textures":{"top":"decor:block/chair"}}'),
      "assets/decor/textures/block/chair.png": new Uint8Array([7]),
    }),
  );

  const result = run("pick", "block:decor:table", "--source", "table.jar");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("assets/decor/textures/block/chair.png");
  expect(json("timeline", "--lane", "picks").data.map((row) => row.jar)).toEqual(["decor-mod.jar"]);
});

test("asset use accepts namespaced shorthand and auto-picks a mod block in the minecraft namespace", () => {
  const { vault, json } = makeEnv();
  writeFileSync(
    join(vault, "packs/custom.jar"),
    zipSync({
      "assets/minecraft/blockstates/mod_table.json": strToU8(
        '{"variants":{"":{"model":"custom:block/table"}}}',
      ),
      "assets/custom/models/block/table.json": strToU8('{"elements":[]}'),
    }),
  );
  const result = json("use", "minecraft:mod_table", "--kind", "block");
  expect(result.object.what).toBe("block:minecraft:mod_table");
  expect(result.picked.added).toEqual(["block:minecraft:mod_table"]);
});

test("asset use reports unknown vanilla blockstate properties before rendering", () => {
  const { json } = makeEnv();
  const result = json(
    "use",
    "block:minecraft:barrel",
    "--props",
    JSON.stringify({ properties: { facing: "up", facng: "north" } }),
  );
  expect(result.warnings.join("\n")).toContain('property facing="up"');
  expect(result.warnings.join("\n")).toContain('property "facng"');
});

test("asset use, timeline, edit, and remove on placed lane convert heard<->scene clocks", () => {
  const { film, run, json } = makeEnv({ speedRate: 2 });

  // Place mod block with --source disambiguation, boolean/numeric blockstate traits & auto-pick
  const chair = json(
    "use",
    "block:decor:oak_chair",
    "--film",
    film,
    "--source",
    "decor-mod",
    "--from",
    "2",
    "--props",
    JSON.stringify({
      at: [1, 0, 3],
      scale: 1.5,
      ease: [0.2, 0, 0, 1],
      properties: { facing: "north", open: true, count: 2 },
    }),
  );
  expect(chair.target).toBe("placed:oak_chair");
  expect(chair.picked.added).toContain("block:decor:oak_chair");
  expect(chair.object.properties).toEqual({ facing: "north", open: true, count: 2 });

  // Stored on disk in SCENE seconds (2s heard at 2x speed = 4s scene!)
  const disk = JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8"));
  expect(disk.oak_chair.keys[0]).toMatchObject({ t: 4, at: [1, 0, 3], scale: 1.5 });

  // timeline --lane placed returns HEARD seconds
  const view = json("timeline", "--film", film, "--lane", "placed");
  expect(view.data.oak_chair.keys[0].t).toBeCloseTo(2);
  expect(view.targets).toContain("placed:oak_chair");

  // Edit at --from 3 heard (= 6s scene) inserts new sorted keyframe
  json(
    "edit",
    "placed:oak_chair",
    "--film",
    film,
    "--from",
    "3",
    "--props",
    JSON.stringify({ at: [2, 0, 3] }),
  );
  const disk2 = JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8"));
  expect(disk2.oak_chair.keys).toHaveLength(2);
  expect(disk2.oak_chair.keys[1]).toMatchObject({ t: 6, at: [2, 0, 3] });

  // Edit keyframe fields WITHOUT --from when multiple keys exist -> exit 2
  const ambEdit = run("edit", "placed:oak_chair", "--film", film, "--props", '{"at":[9,0,9]}');
  expect(ambEdit.status).toBe(2);

  // Remove the added keyframe, then remove the whole object
  json("edit", "placed:oak_chair", "--film", film, "--from", "3", "--props", '{"removeKey":true}');
  expect(
    JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8")).oak_chair.keys,
  ).toHaveLength(1);
  json("remove", "placed:oak_chair", "--film", film);
  expect(JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8"))).toEqual({});
}, 20000);

test("placed lane validates mob clips/rates, --source minecraft, and rejects invalid CLI flags", async () => {
  const { vault, film, conf, run } = makeEnv({ speedRate: 2 });
  const prevVault = process.env.MC_VAULT_ROOT;
  process.env.MC_VAULT_ROOT = vault;
  try {
    writeFileSync(
      join(vault, "jar/client_assets.zip"),
      zipSync({
        "assets/minecraft/blockstates/stone.json": strToU8(
          JSON.stringify({ variants: { "": { model: "minecraft:block/stone" } } }),
        ),
        "assets/minecraft/models/block/stone.json": strToU8(JSON.stringify({ elements: [] })),
      }),
    );

    const assets = openAssets(film, conf);

    // Vanilla block with --source minecraft must place cleanly without calling updatePicksBatch
    const stone = await assets.use("block:minecraft:stone", { from: 0, source: "minecraft" });
    expect(stone.object.what).toBe("block:minecraft:stone");

    // Cubic-bezier ease, rate: 0, and object clip/rate vs keyClip/keyRate isolation
    const mob = await assets.use("mob:armadillo", {
      from: 1,
      props: { clip: "none", rate: 0, keyClip: "walk", keyRate: 1.2, ease: [0.2, 0, 0, 1] },
    });
    expect(mob.object.clip).toBe("none");
    expect(mob.object.rate).toBe(0);
    expect(mob.object.keys[0]).toMatchObject({
      t: 1,
      clip: "walk",
      rate: 1.2,
      ease: [0.2, 0, 0, 1],
    });
    expect(mob.data.armadillo.keys[0].t).toBe(1);
    const mobDisk = JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8"));
    expect(mobDisk.armadillo.keys[0].t).toBe(2);

    await assets.change(
      "placed:armadillo",
      {
        at: [1, 0, 2],
        keyClip: "walk",
        keyRate: 2.5,
        clip: "walk",
        rate: 0.5,
      },
      false,
      { from: 2 },
    );
    const onDisk = JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8"));
    expect(onDisk.armadillo.clip).toBe("walk");
    expect(onDisk.armadillo.rate).toBe(0.5);
    expect(onDisk.armadillo.keys[1]).toMatchObject({ t: 4, clip: "walk", rate: 2.5 });

    // Reject silent no-ops and usage errors with code 2
    await expect(
      assets.change("placed:armadillo", { removeKey: true }, false, {}),
    ).rejects.toMatchObject({ code: 2 });
    await expect(
      assets.change("placed:armadillo", { keys: [{ t: 0, at: [0, 0, 0] }] }, false, { from: 1 }),
    ).rejects.toMatchObject({ code: 2 });
    await expect(
      assets.use("mob:armadillo", { from: 0, props: { name: "   " } }),
    ).rejects.toMatchObject({ code: 2 });
    await expect(
      assets.use("mob:armadillo", { from: 0, props: { ease: "" } }),
    ).rejects.toMatchObject({ code: 2 });
    await expect(assets.use("prop:global:signs/neon_sign", { from: 1 })).rejects.toMatchObject({
      code: 2,
    });

    // Unpick --source wrongpack skips without deleting other jars
    assets.pick(["block:decor:oak_chair"], { source: "decor-mod" });
    const wrongUnpick = await assets.unpick(["block:decor:oak_chair"], { source: "wrongpack" });
    expect(wrongUnpick.removed).toEqual([]);
    expect(wrongUnpick.picks).toHaveLength(1);
    expect(wrongUnpick.warnings[0]).toContain("wrongpack");

    // CLI exits 2 cleanly for --shot on 3D object & contradicting --kind
    expect(
      run("use", "block:gohans:computer", "--from", "0", "--shot", "1", "--film", film).status,
    ).toBe(2);
    expect(run("use", "mob:armadillo", "--kind", "block", "--film", film).status).toBe(2);
    expect(run("unpick", "block:decor:oak_chair", "--kind", "item", "--film", film).status).toBe(2);
  } finally {
    if (prevVault === undefined) delete process.env.MC_VAULT_ROOT;
    else process.env.MC_VAULT_ROOT = prevVault;
  }
}, 20000);

test("asset use prop:global copies into src/props, guards leaf symlinks/paths, and handles Vite ?url imports", () => {
  const { vault, film, run, json } = makeEnv();

  writeFileSync(
    join(vault, "props/signs/vite_sign.ts"),
    'import modelUrl from "./vite_sign.glb?url"; export const u = modelUrl;',
  );
  writeFileSync(join(vault, "props/signs/vite_sign.glb"), new Uint8Array([103, 108, 84, 70]));
  const viteRes = json("use", "prop:global:signs/vite_sign", "--film", film);
  expect(viteRes.warnings).toEqual([]);

  const res = json("use", "prop:global:signs/neon_sign", "--film", film);
  expect(existsSync(join(film, "src/props/signs/neon_sign.ts"))).toBe(true);
  expect(existsSync(join(film, "src/props/signs/neon_sign.glb"))).toBe(true);
  expect(res.copied).toBe(true);

  expect(run("use", "prop:global:signs/neon_sign", "--film", film).status).toBe(1);
  expect(run("use", "prop:global:signs/neon_sign", "--film", film, "--force").status).toBe(0);
  expect(run("use", "prop:global:C:bad", "--film", film).status).toBe(2);
  expect(run("use", "prop:global:.hidden", "--film", film).status).toBe(2);

  // Directory junction escape check (works on Windows without elevation) + optional leaf file symlink check
  const outsideDir = join(film, "outside-props");
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, "secret.ts"), "keep");
  rmSync(join(film, "src/props/signs"), { recursive: true, force: true });
  symlinkSync(outsideDir, join(film, "src/props/signs"), "junction");
  expect(run("use", "prop:global:signs/neon_sign", "--film", film, "--force").status).toBe(1);
  expect(readFileSync(join(outsideDir, "secret.ts"), "utf8")).toBe("keep");

  rmSync(join(film, "src/props/signs"), { force: true });
  mkdirSync(join(film, "src/props/signs"), { recursive: true });
  try {
    const outsideTarget = join(film, "outside-secret.txt");
    writeFileSync(outsideTarget, "keep");
    symlinkSync(outsideTarget, join(film, "src/props/signs/neon_sign.ts"), "file");
    expect(run("use", "prop:global:signs/neon_sign", "--film", film, "--force").status).toBe(1);
    expect(readFileSync(outsideTarget, "utf8")).toBe("keep");
  } catch (err) {
    if (err?.code !== "EPERM") throw err;
  }

  const dep = json("use", "prop:global:bad_dep", "--film", film);
  expect(dep.warnings.join("\n")).toContain("shared_helper");
}, 20000);

test("asset use writes through real Studio mountCollaboration even before placed.json exists", async () => {
  const { vault, film } = makeEnv();
  const { mountCollaboration } =
    await import("../../packages/live-studio/src/collaboration-api.mjs");
  const { PlacedTimeline } = await import("../../packages/live-studio/src/contract.ts");
  const { openTimelineFile } = await import("../../packages/live-studio/src/timeline_file.mjs");

  const lane = openTimelineFile(film, "src/timeline/placed.json", PlacedTimeline);
  const app = new Hono();
  mountCollaboration(app, (name) => (name === "keys/0" ? lane : null));
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
  try {
    mkdirSync(join(film, "renders/live"), { recursive: true });
    writeFileSync(join(film, "renders/live/studio.json"), JSON.stringify({ port: server.port }));
    expect(existsSync(join(film, "src/timeline/placed.json"))).toBe(false);

    const proc = Bun.spawn(
      ["bun", ASSET_MJS, "use", "mob:armadillo", "--film", film, "--from", "0"],
      {
        cwd: film,
        env: { ...process.env, MC_VAULT_ROOT: vault },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [status, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(status, stderr).toBe(0);
    const saved = JSON.parse(readFileSync(join(film, "src/timeline/placed.json"), "utf8"));
    expect(saved.armadillo?.what).toBe("mob:armadillo");
  } finally {
    server.stop(true);
  }
});

test("placed lane supports slug != jar unpick/alreadyPicked, non-destructive remove errors, and strict props.keys validation", async () => {
  const { vault, film, conf } = makeEnv({ speedRate: 1 });
  const prevVault = process.env.MC_VAULT_ROOT;
  process.env.MC_VAULT_ROOT = vault;
  try {
    writeFileSync(
      join(vault, "packs/bakery.jar"),
      zipSync({
        "assets/bakery/blockstates/oven.json": strToU8(
          JSON.stringify({ variants: { "": { model: "bakery:block/oven" } } }),
        ),
        "assets/bakery/models/block/oven.json": strToU8(JSON.stringify({ elements: [] })),
      }),
    );
    writeFileSync(
      join(vault, "packs_index.json"),
      JSON.stringify({
        "bakery.jar": { slug: "lets-do-bakery", title: "Let's Do Bakery" },
      }),
    );

    const assets = openAssets(film, conf);
    const picked = assets.pick(["block:bakery:oven"], { source: "lets-do-bakery" });
    expect(picked.added).toEqual(["block:bakery:oven"]);

    // alreadyPicked matches hit.pack even when slug != jar
    const placed = await assets.use("block:bakery:oven", { from: 0, source: "lets-do-bakery" });
    expect(placed.picked).toBeUndefined();
    expect(JSON.parse(readFileSync(join(film, "pack/picks.json"), "utf8"))).toHaveLength(1);

    // unpick --source resolves slug via packs_index.json
    const unpicked = await assets.unpick(["block:bakery:oven"], { source: "lets-do-bakery" });
    expect(unpicked.removed).toEqual(["block:bakery:oven"]);
    expect(JSON.parse(readFileSync(join(film, "pack/picks.json"), "utf8"))).toEqual([]);

    // Invalid props.keys / non-string clip exit cleanly with code 2 (not ZodError)
    await expect(
      assets.use("mob:armadillo", {
        from: 0,
        props: {
          keys: [
            { t: 2, at: [0, 0, 0] },
            { t: 1, at: [1, 0, 0] },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 2 });
    await expect(
      assets.use("mob:armadillo", {
        from: 0,
        props: { keys: [{ t: 0 }] },
      }),
    ).rejects.toMatchObject({ code: 2 });
    await expect(
      assets.use("mob:armadillo", {
        from: 0,
        props: { clip: 123 },
      }),
    ).rejects.toMatchObject({ code: 2 });

    // Failed remove (remove = true) on code-duration film (edit.json = {}) must NOT wipe placed.json
    writeFileSync(join(film, "src/edit.json"), "{}");
    const codeAssets = openAssets(film, conf);
    const beforeRemove = readFileSync(join(film, "src/timeline/placed.json"), "utf8");
    await expect(codeAssets.change("placed:oven", {}, true, {})).rejects.toThrow(/pass --duration/);
    expect(readFileSync(join(film, "src/timeline/placed.json"), "utf8")).toBe(beforeRemove);
    await expect(
      codeAssets.change("placed:oven", { remove: true }, false, { duration: 20 }),
    ).rejects.toMatchObject({ code: 2 });

    // Prototype property names and cross-kind controls are rejected safely
    await expect(
      codeAssets.change("placed:toString", {}, true, { duration: 20 }),
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      codeAssets.change("placed:constructor", { scale: 2 }, false, { duration: 20 }),
    ).rejects.toMatchObject({ code: 1 });
    for (const badName of ["__proto__", "constructor", "prototype"]) {
      await expect(
        codeAssets.use("mob:armadillo", { from: 0, props: { name: badName }, duration: 20 }),
      ).rejects.toMatchObject({ code: 2 });
    }
    await expect(
      codeAssets.use("mob:armadillo", {
        from: 0,
        props: { properties: { facing: "north" } },
        duration: 20,
      }),
    ).rejects.toMatchObject({ code: 2 });
    await expect(
      codeAssets.use("block:bakery:oven", {
        from: 0,
        source: "lets-do-bakery",
        props: { clip: "walk" },
        duration: 20,
      }),
    ).rejects.toMatchObject({ code: 2 });

    // asset plan --kind aligns with cli-catalog (accepted instead of exit-2 flag error)
    const planRes = spawnSync(
      "bun",
      [ASSET_MJS, "plan", "dissolve", "--kind", "transition", "--film", film],
      {
        cwd: film,
        env: { ...process.env, MC_VAULT_ROOT: vault },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    expect(planRes.status, planRes.stderr).toBe(1);
    expect(planRes.stderr).toContain("plan requires a template");
    expect(planRes.stderr).not.toContain("--kind does not apply");
  } finally {
    if (prevVault === undefined) delete process.env.MC_VAULT_ROOT;
    else process.env.MC_VAULT_ROOT = prevVault;
  }
});
