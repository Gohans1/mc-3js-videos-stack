import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

import { stagePreviewPackOverlay } from "../src/asset-preview-overlay.mjs";
import {
  DEFAULT_PREVIEW_OUT,
  DEFAULT_PREVIEW_SIZE,
  MAX_PREVIEW_ITEMS,
  normalizePreviewEntry,
  parsePreviewResultFromLog,
  PREVIEW_JSON_PREFIX,
  PreviewDataError,
  readPickedPreviewEntries,
  resolvePreviewSpec,
  validatePreviewLimit,
  validatePreviewOut,
  validatePreviewSize,
} from "../src/asset-preview-spec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const ASSET_SCRIPT = join(REPO, "scripts/asset.mjs");
const RENDER_SCRIPT = join(REPO, "packages/live-studio/render.mjs");
const PREVIEW_ENTRY = join(REPO, "packages/live-studio/render/asset-preview.ts");
const NEW_FILM_SCRIPT = join(REPO, "scripts/new_film.ts");
const HELP_SCRIPT = join(REPO, "packages/live-studio/help.mjs");
const TEMPLATE = join(REPO, "templates/film");

const runBun = (script, args, { cwd = REPO, env = process.env, timeout = 120_000 } = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });

const makeTempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test("validatePreviewOut accepts safe filenames and rejects traversal, paths, dots, and Windows device names", () => {
  expect(validatePreviewOut(undefined)).toBe(DEFAULT_PREVIEW_OUT);
  expect(validatePreviewOut("sheet_01.jpg")).toBe("sheet_01.jpg");
  expect(validatePreviewOut("props-v2.PNG")).toBe("props-v2.PNG");

  for (const bad of [
    "",
    "   ",
    "../escape.jpg",
    "sheet..jpg",
    "sub/sheet.jpg",
    "sub\\sheet.jpg",
    ".hidden.jpg",
    "_leading.jpg",
    "sheet.webp",
    "sheet.json",
    "CON.jpg",
    "nul.png",
    "com1.jpg",
    "bad name.jpg",
  ]) {
    expect(() => validatePreviewOut(bad)).toThrow();
  }
});

test("validatePreviewSize and validatePreviewLimit enforce strict numeric bounds", () => {
  expect(validatePreviewSize(undefined)).toBe(DEFAULT_PREVIEW_SIZE);
  expect(validatePreviewSize("0.75")).toBe(0.75);
  expect(validatePreviewSize(4)).toBe(4);
  for (const bad of ["", "   ", "0", "-1", "4.01", "NaN", "Infinity", "abc"]) {
    expect(() => validatePreviewSize(bad)).toThrow();
  }

  expect(validatePreviewLimit(undefined)).toBe(MAX_PREVIEW_ITEMS);
  expect(validatePreviewLimit("1")).toBe(1);
  expect(validatePreviewLimit(36)).toBe(36);
  for (const bad of ["", "   ", "0", "-2", "1.5", "37", "abc"]) {
    expect(() => validatePreviewLimit(bad)).toThrow();
  }
});

test("normalizePreviewEntry resolves explicit and kind-defaulted block/item IDs and rejects invalid or ambiguous inputs", () => {
  expect(normalizePreviewEntry("block:minecraft:oak_stairs")).toEqual({
    kind: "block",
    id: "minecraft:oak_stairs",
    label: "block:minecraft:oak_stairs",
  });
  expect(normalizePreviewEntry("item:iron_sword")).toEqual({
    kind: "item",
    id: "minecraft:iron_sword",
    label: "item:minecraft:iron_sword",
  });
  expect(normalizePreviewEntry("decor:oak_chair", "block")).toEqual({
    kind: "block",
    id: "decor:oak_chair",
    label: "block:decor:oak_chair",
  });
  expect(normalizePreviewEntry("item:modern:chair", "item")).toEqual({
    kind: "item",
    id: "modern:chair",
    label: "item:modern:chair",
  });

  expect(() => normalizePreviewEntry("minecraft:oak_stairs")).toThrow(/Ambiguous/);
  expect(() => normalizePreviewEntry("block:minecraft:oak_stairs", "item")).toThrow(/contradicts/);
  expect(() => normalizePreviewEntry("mob:minecraft:zombie")).toThrow(/blocks and items/);
  expect(() => normalizePreviewEntry("prop:global:desk")).toThrow(/blocks and items/);
  expect(() => normalizePreviewEntry("block::oak")).toThrow();
  expect(() => normalizePreviewEntry("block:minecraft:")).toThrow();
  expect(() => normalizePreviewEntry("block:minecraft:../bad")).toThrow();
  expect(() => normalizePreviewEntry("block:minecraft:oak stairs")).toThrow();
});

test("resolvePreviewSpec expands pack/picks.json by default, filters by --kind, deduplicates, rejects comma-only args and corrupt manifests", () => {
  const dir = makeTempDir("asset-preview-spec-");
  try {
    expect(() => readPickedPreviewEntries(dir)).toThrow(/pack\/picks\.json not found/);

    mkdirSync(join(dir, "pack"), { recursive: true });
    writeFileSync(
      join(dir, "pack/picks.json"),
      JSON.stringify([
        {
          jar: "demo.jar",
          namespace: "decor",
          blocks: ["chair", "table", "chair"],
          items: ["cup", "plate"],
        },
      ]),
    );

    const all = resolvePreviewSpec({ projectDir: dir });
    expect(all.source).toBe("picks");
    expect(all.items.map((x) => x.label)).toEqual([
      "block:decor:chair",
      "block:decor:table",
      "item:decor:cup",
      "item:decor:plate",
    ]);
    expect(all.totalAvailable).toBe(4);
    expect(all.truncated).toBe(0);
    expect(all.showScale).toBe(true);

    const blocksOnly = resolvePreviewSpec({
      projectDir: dir,
      kind: "block",
      limit: 1,
      noScale: true,
    });
    expect(blocksOnly.items.map((x) => x.label)).toEqual(["block:decor:chair"]);
    expect(blocksOnly.totalAvailable).toBe(2);
    expect(blocksOnly.truncated).toBe(1);
    expect(blocksOnly.showScale).toBe(false);

    const itemsOnly = resolvePreviewSpec({ projectDir: dir, kind: "item" });
    expect(itemsOnly.items.map((x) => x.label)).toEqual(["item:decor:cup", "item:decor:plate"]);

    const fromArgs = resolvePreviewSpec({
      projectDir: dir,
      rawIds: [
        "block:minecraft:oak_stairs,item:minecraft:iron_sword",
        "block:minecraft:oak_stairs",
      ],
      out: "custom.png",
      size: "0.6",
    });
    expect(fromArgs.source).toBe("args");
    expect(fromArgs.items.map((x) => x.label)).toEqual([
      "block:minecraft:oak_stairs",
      "item:minecraft:iron_sword",
    ]);
    expect(fromArgs.out).toBe("custom.png");
    expect(fromArgs.size).toBe(0.6);

    // Empty/comma-only args and empty --kind must fail instead of falling back
    expect(() => resolvePreviewSpec({ projectDir: dir, rawIds: [", ,"] })).toThrow(
      /empty asset IDs/,
    );
    expect(() => resolvePreviewSpec({ projectDir: dir, rawIds: [""] })).toThrow(/empty asset IDs/);
    expect(() => resolvePreviewSpec({ projectDir: dir, kind: "" })).toThrow(/block or item/);

    // Corrupt / malformed pack/picks.json throws PreviewDataError
    for (const badContent of [
      "{not-json",
      JSON.stringify({ not: "an-array" }),
      JSON.stringify([{ blocks: ["chair"] }]),
      JSON.stringify([{ namespace: "   " }]),
      JSON.stringify([{ namespace: "decor", blocks: "not-array" }]),
      JSON.stringify([{ namespace: "decor", blocks: [123] }]),
      JSON.stringify([{ namespace: "decor", items: [""] }]),
    ]) {
      writeFileSync(join(dir, "pack/picks.json"), badContent);
      expect(() => readPickedPreviewEntries(dir)).toThrow(PreviewDataError);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parsePreviewResultFromLog extracts the latest prefixed JSON payload safely", () => {
  expect(parsePreviewResultFromLog("built in 1.0s\nno json here")).toBeNull();
  const sample = `built in 1.0s\n${PREVIEW_JSON_PREFIX}{"ok":false}\n${PREVIEW_JSON_PREFIX}{"ok":true,"count":2}\nrender stills: 3.1s\n`;
  expect(parsePreviewResultFromLog(sample)).toEqual({ ok: true, count: 2 });
  expect(parsePreviewResultFromLog(`${PREVIEW_JSON_PREFIX}{broken`)).toBeNull();
});

test("asset preview CLI validates flags, leading flags with multi-IDs, corrupt picks (exit 1), and missing client_assets.zip before Chrome boots", () => {
  const dir = makeTempDir("asset-preview-cli-");
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 1;\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "tmp-film", "live-studio": {} }),
    );
    mkdirSync(join(dir, "pack"), { recursive: true });
    writeFileSync(join(dir, "pack/picks.json"), "[]");

    const badOut = runBun(ASSET_SCRIPT, [
      "preview",
      "block:minecraft:oak_stairs",
      "--film",
      dir,
      "--out",
      "../escape.jpg",
    ]);
    expect(badOut.status).toBe(2);
    expect(badOut.stderr).toContain("--out");

    const badKind = runBun(ASSET_SCRIPT, ["preview", "--film", dir, "--kind", "mob"]);
    expect(badKind.status).toBe(2);
    expect(badKind.stderr).toContain("block or item");

    // Empty positional ID must exit 2 instead of silently falling back to pack/picks.json
    writeFileSync(
      join(dir, "pack/picks.json"),
      JSON.stringify([{ jar: "vanilla.jar", namespace: "minecraft", blocks: ["oak_stairs"] }]),
    );
    const emptyPos = runBun(ASSET_SCRIPT, ["preview", "", "--film", dir]);
    expect(emptyPos.status).toBe(2);
    expect(emptyPos.stderr).toContain("empty asset IDs");

    for (const emptyFlag of [
      ["--out", ""],
      ["--size", ""],
      ["--limit", ""],
      ["--kind", ""],
      ["--source", ""],
    ]) {
      const r = runBun(ASSET_SCRIPT, [
        "preview",
        "block:minecraft:oak_stairs",
        "--film",
        dir,
        ...emptyFlag,
      ]);
      expect(r.status).toBe(2);
    }

    writeFileSync(join(dir, "pack/picks.json"), "[]");
    const emptyPicks = runBun(ASSET_SCRIPT, ["preview", "--film", dir]);
    expect(emptyPicks.status).toBe(2);
    expect(emptyPicks.stderr).toContain("pack/picks.json");

    // Corrupt picks.json exits 1 (data error, not usage error)
    writeFileSync(join(dir, "pack/picks.json"), "{broken-json");
    const corruptPicks = runBun(ASSET_SCRIPT, ["preview", "--film", dir]);
    expect(corruptPicks.status).toBe(1);
    expect(corruptPicks.stderr).toContain("pack/picks.json");
    writeFileSync(join(dir, "pack/picks.json"), JSON.stringify([{ namespace: "   " }]));
    const blankNsPicks = runBun(ASSET_SCRIPT, ["preview", "--film", dir]);
    expect(blankNsPicks.status).toBe(1);
    expect(blankNsPicks.stderr).toContain("namespace");
    writeFileSync(join(dir, "pack/picks.json"), "[]");

    // Leading flag before preview with multiple IDs must pass cliArgs (reaches missing client_assets.zip -> exit 1)
    const leadingFlag = runBun(ASSET_SCRIPT, [
      "--film",
      dir,
      "preview",
      "block:minecraft:oak_stairs",
      "item:minecraft:iron_sword",
    ]);
    expect(leadingFlag.status).toBe(1);
    expect(leadingFlag.stderr).toContain("client_assets.zip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("stagePreviewPackOverlay handles gohans built-ins, missing vault/packs, and pack/picks.json pinnedJar disambiguation without Chrome", () => {
  const dir = makeTempDir("asset-preview-overlay-unit-");
  const prevVault = process.env.MC_VAULT_ROOT;
  const enc = new TextEncoder();
  const createdZips = [];
  try {
    const project = join(dir, "film");
    const emptyVault = join(dir, "empty-vault");
    mkdirSync(join(project, "pack"), { recursive: true });
    mkdirSync(emptyVault, { recursive: true });
    process.env.MC_VAULT_ROOT = emptyVault;

    // 1) gohans built-in rejects mismatched --source and accepts --source gohans
    const gohansItem = [normalizePreviewEntry("block:gohans:chair")];
    expect(() => stagePreviewPackOverlay(project, gohansItem, { source: "pack-a" })).toThrow(
      /mc-assets\/pack/,
    );
    expect(stagePreviewPackOverlay(project, gohansItem, { source: "gohans" })).toEqual({
      zipPath: null,
      staged: [],
      stagingErrors: [],
    });

    // 2) Missing vault/packs returns empty without --source, and throws exit 2 with --source
    const modItem = [normalizePreviewEntry("block:sharedmod:desk_lamp")];
    expect(stagePreviewPackOverlay(project, modItem)).toEqual({
      zipPath: null,
      staged: [],
      stagingErrors: [],
    });
    expect(() => stagePreviewPackOverlay(project, modItem, { source: "pack-b" })).toThrow(
      /Vault packs folder not found/,
    );

    // 3) pack/picks.json pinnedJar disambiguates a multi-pack ID without --source or picked.zip
    const vault = join(dir, "vault");
    mkdirSync(join(vault, "packs"), { recursive: true });
    mkdirSync(join(vault, "jar"), { recursive: true });
    writeFileSync(
      join(vault, "jar/client_assets.zip"),
      zipSync({ "pack.mcmeta": enc.encode(JSON.stringify({ pack: { pack_format: 75 } })) }),
    );
    const selfModel = JSON.stringify({ elements: [{ from: [0, 0, 0], to: [16, 16, 16] }] });
    const makePack = () =>
      zipSync({
        "assets/sharedmod/blockstates/desk_lamp.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "sharedmod:block/desk_lamp" } } }),
        ),
        "assets/sharedmod/models/block/desk_lamp.json": enc.encode(selfModel),
      });
    writeFileSync(join(vault, "packs/pack-a.jar"), makePack());
    writeFileSync(join(vault, "packs/pack-b.jar"), makePack());
    writeFileSync(
      join(project, "pack/picks.json"),
      JSON.stringify([{ jar: "pack-b.jar", namespace: "sharedmod", blocks: ["desk_lamp"] }]),
    );
    process.env.MC_VAULT_ROOT = vault;

    const pinned = stagePreviewPackOverlay(project, modItem);
    if (pinned.zipPath) createdZips.push(pinned.zipPath);
    expect(pinned.zipPath).not.toBeNull();
    expect(existsSync(pinned.zipPath)).toBe(true);
    expect(pinned.staged).toEqual([{ id: "block:sharedmod:desk_lamp", pack: "pack-b.jar" }]);
    expect(pinned.stagingErrors).toEqual([]);
  } finally {
    if (prevVault === undefined) delete process.env.MC_VAULT_ROOT;
    else process.env.MC_VAULT_ROOT = prevVault;
    for (const z of createdZips) rmSync(z, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new-film, help, and asset --help surface studio --detach and asset preview onboarding", () => {
  const newFilmHelp = runBun(NEW_FILM_SCRIPT, ["--help"]);
  expect(newFilmHelp.status).toBe(0);
  expect(newFilmHelp.stdout).toContain("bun run studio --detach");

  const rootHelp = runBun(HELP_SCRIPT, []);
  expect(rootHelp.status).toBe(0);
  expect(rootHelp.stdout).toContain("preview 3D models beside Steve");

  const assetHelp = runBun(ASSET_SCRIPT, ["--help"]);
  expect(assetHelp.status).toBe(0);
  expect(assetHelp.stdout).toContain("preview [id[,id] ...]");
  expect(assetHelp.stdout).toContain("--no-scale");
});

const VAULT_ROOT = process.env.MC_VAULT_ROOT || join(REPO, "vault");
const CLIENT_ZIP = join(VAULT_ROOT, "jar/client_assets.zip");
const RIG_GLB = join(VAULT_ROOT, "mcprep/player.glb");
const CHROME_BIN = join(
  VAULT_ROOT,
  "tools/chrome-headless-shell",
  process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell",
);
const BMR_DIR = join(REPO, "packages/mc-assets/node_modules/block-model-renderer");
const BMR_ZIP = join(BMR_DIR, "assets.zip");
const BMR_WASM = join(BMR_DIR, "dist/block_model_renderer_bg.wasm");
const HAS_LIVE_PREVIEW_ASSETS =
  existsSync(CLIENT_ZIP) && existsSync(BMR_ZIP) && existsSync(BMR_WASM) && existsSync(CHROME_BIN);

describe.skipIf(!HAS_LIVE_PREVIEW_ASSETS)("asset preview live headless Chrome renders", () => {
  let film = "";
  const sentinel = Buffer.from("existing-still-sentinel-bytes");

  beforeAll(() => {
    film = makeTempDir("asset-preview-live-");
    const enc = new TextEncoder();
    cpSync(TEMPLATE, film, {
      recursive: true,
      filter: (src) => !src.endsWith("node_modules") && !src.endsWith("renders"),
    });
    const pkgPath = join(film, "package.json");
    const pkgObj = JSON.parse(
      readFileSync(pkgPath, "utf8").replace("__NAME__", "tmp-preview").replace("__PORT__", "47999"),
    );
    pkgObj["live-studio"] = { ...pkgObj["live-studio"], chrome: CHROME_BIN };
    writeFileSync(pkgPath, `${JSON.stringify(pkgObj, null, 2)}\n`);

    mkdirSync(join(film, "assets/public/mc"), { recursive: true });
    mkdirSync(join(film, "assets/public/vendor"), { recursive: true });
    mkdirSync(join(film, "assets/public/rig"), { recursive: true });
    copyFileSync(CLIENT_ZIP, join(film, "assets/public/mc/client_assets.zip"));
    copyFileSync(BMR_ZIP, join(film, "assets/public/vendor/bmr_assets.zip"));
    copyFileSync(BMR_WASM, join(film, "assets/public/block_model_renderer_bg.wasm"));
    if (existsSync(RIG_GLB)) copyFileSync(RIG_GLB, join(film, "assets/public/rig/player.glb"));

    // Synthetic picked.zip with 1 valid custom block, 1 vanilla override, + broken entries
    const pickedZip = zipSync({
      "assets/badmod/blockstates/good_crate.json": enc.encode(
        JSON.stringify({ variants: { "": { model: "minecraft:block/oak_planks" } } }),
      ),
      "assets/minecraft/blockstates/brick_stairs.json": enc.encode(
        JSON.stringify({ variants: { "": { model: "minecraft:block/lantern" } } }),
      ),
      "assets/badmod/blockstates/broken_chair.json": enc.encode(
        JSON.stringify({ variants: { "": { model: "badmod:block/does_not_exist" } } }),
      ),
      "assets/badmod/items/broken_sword.json": enc.encode(
        JSON.stringify({
          model: { type: "minecraft:model", model: "badmod:item/does_not_exist" },
        }),
      ),
    });
    writeFileSync(join(film, "assets/public/picked.zip"), pickedZip);

    // Seed a sentinel still_1s.jpg to prove an --entry run never wipes existing film stills
    mkdirSync(join(film, "renders"), { recursive: true });
    writeFileSync(join(film, "renders/still_1s.jpg"), sentinel);

    mkdirSync(join(film, "pack"), { recursive: true });
    writeFileSync(
      join(film, "pack/picks.json"),
      JSON.stringify([{ jar: "vanilla.jar", namespace: "minecraft", items: ["iron_sword"] }]),
    );
  });

  afterAll(() => {
    if (film) rmSync(film, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("renders uppercase .PNG, special items and picked.zip blocks", () => {
    const r1 = runBun(ASSET_SCRIPT, [
      "--film",
      film,
      "preview",
      "block:minecraft:oak_stairs",
      "item:minecraft:chest",
      "block:badmod:good_crate",
      "--out",
      "upper_sheet.PNG",
    ]);
    expect(r1.status, r1.stderr || r1.stdout).toBe(0);
    const j1 = JSON.parse(r1.stdout);
    expect(j1.ok).toBe(true);
    expect(j1.source).toBe("args");
    expect(j1.output).toBe("renders/upper_sheet.PNG");
    expect(j1.count).toBe(3);
    expect(j1.resolved).toBe(3);
    expect(j1.scaleRef).toBe(existsSync(RIG_GLB) ? "steve-rig" : "proxy");
    expect(j1.items[0].bounds.size).toEqual([1, 1, 1]);
    expect(j1.items[1].missing).toBe(false);
    expect(j1.items[1].bounds).not.toBeNull();
    expect(j1.items[2].missing).toBe(false);
    expect(j1.items[2].bounds.size).toEqual([1, 1, 1]);

    // Uppercase .PNG MUST write actual PNG magic bytes (not JPEG)
    const pngBytes = readFileSync(join(film, "renders/upper_sheet.PNG"));
    expect(pngBytes.length).toBeGreaterThan(5000);
    expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(readFileSync(join(film, "renders/still_1s.jpg"))).toEqual(sentinel);
  }, 60_000);

  test("renders default pack/picks.json single-column sheet with --size and --no-scale", () => {
    const r2 = runBun(ASSET_SCRIPT, [
      "preview",
      "--film",
      film,
      "--no-scale",
      "--size",
      "0.8",
      "--out",
      "solo_item.jpg",
    ]);
    expect(r2.status, r2.stderr || r2.stdout).toBe(0);
    const j2 = JSON.parse(r2.stdout);
    expect(j2.ok).toBe(true);
    expect(j2.source).toBe("picks");
    expect(j2.scaleRef).toBe("none");
    expect(j2.width).toBe(664); // 1 column: PAD*2 (24) + TILE_W (640)
    expect(j2.items[0].bounds.size[0]).toBeCloseTo(0.8, 2);
    const jpgBytes = readFileSync(join(film, "renders/solo_item.jpg"));
    expect(jpgBytes.length).toBeGreaterThan(2000);
    expect([...jpgBytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  }, 60_000);

  test("reports missing:true, bounds:null, and exit 1 for missing vanilla and broken picked.zip models", () => {
    const r3 = runBun(ASSET_SCRIPT, [
      "preview",
      "block:minecraft:definitely_not_a_real_block_xyz",
      "item:minecraft:definitely_not_a_real_item_xyz",
      "item:minecraft:item/also_fake_xyz",
      "block:badmod:broken_chair",
      "item:badmod:broken_sword",
      "--film",
      film,
      "--out",
      "missing_all.jpg",
    ]);
    expect(r3.status).toBe(1);
    const j3 = JSON.parse(r3.stdout);
    expect(j3.ok).toBe(false);
    expect(j3.resolved).toBe(0);
    expect(j3.items).toHaveLength(5);
    for (const item of j3.items) {
      expect(item.missing).toBe(true);
      expect(item.bounds).toBeNull();
    }
    expect(existsSync(join(film, "renders/missing_all.jpg"))).toBe(true);
  }, 60_000);

  test("rejects an unsafe --lab preview_spec out and over-limit specs while preserving still_1s.jpg", () => {
    const escapedPath = join(film, "escaped.jpg");
    const badSpec = JSON.stringify({
      items: [{ kind: "block", id: "minecraft:oak_stairs" }],
      out: "..%2Fescaped.jpg",
    });
    const rBadSpec = runBun(
      RENDER_SCRIPT,
      ["stills", "--at", "1", "--entry", PREVIEW_ENTRY, "--lab", `preview_spec=${badSpec}`],
      { cwd: film },
    );
    expect(rBadSpec.status).not.toBe(0);
    expect(`${rBadSpec.stdout}\n${rBadSpec.stderr}`).toContain("--out");
    expect(existsSync(escapedPath)).toBe(false);
    expect(readFileSync(join(film, "renders/still_1s.jpg"))).toEqual(sentinel);

    const tooMany = Array.from(
      { length: MAX_PREVIEW_ITEMS + 1 },
      () => "block:minecraft:oak_stairs",
    );
    const tooManySpec = JSON.stringify({ items: tooMany, out: "too_many.jpg" });
    const rTooMany = runBun(
      RENDER_SCRIPT,
      ["stills", "--entry", PREVIEW_ENTRY, "--lab", `preview_spec=${tooManySpec}`],
      { cwd: film },
    );
    expect(rTooMany.status).not.toBe(0);
    expect(`${rTooMany.stdout}\n${rTooMany.stderr}`).toContain("too many preview items");
    expect(existsSync(join(film, "renders/too_many.jpg"))).toBe(false);
  }, 60_000);

  test("blocks encoded /still/ traversal at the render.mjs server boundary", () => {
    const escapedPath = join(film, "escaped.jpg");
    mkdirSync(join(film, "lab"), { recursive: true });
    writeFileSync(
      join(film, "lab/evil.ts"),
      `import { done, post } from "live-studio/lab";
(async () => {
  await post("/still/..%2Fescaped.jpg", new Uint8Array([1, 2, 3]));
  await done();
})();
`,
    );
    const rTraversal = runBun(RENDER_SCRIPT, ["stills", "--at", "1", "--entry", "lab/evil.ts"], {
      cwd: film,
    });
    expect(rTraversal.status).not.toBe(0);
    expect(rTraversal.stderr).toContain("invalid still path");
    expect(existsSync(escapedPath)).toBe(false);
    expect(readFileSync(join(film, "renders/still_1s.jpg"))).toEqual(sentinel);
  }, 60_000);

  test("rejects an invalid --lab preview_overlay path and never leaks preview_overlay into /config", () => {
    const rBadOverlay = runBun(
      RENDER_SCRIPT,
      [
        "stills",
        "--entry",
        PREVIEW_ENTRY,
        "--lab",
        `preview_overlay=${join(film, "package.json")}`,
      ],
      { cwd: film },
    );
    expect(rBadOverlay.status).toBe(2);
    expect(rBadOverlay.stderr).toContain(
      "--lab preview_overlay=<file> must point to an existing .zip",
    );

    mkdirSync(join(film, "lab"), { recursive: true });
    writeFileSync(
      join(film, "lab/check-cfg.ts"),
      `import { config, done, log } from "live-studio/lab";
(async () => {
  const cfg = await config();
  await log("CFG_LAB_KEYS:" + JSON.stringify(Object.keys(cfg.lab ?? {})));
  await done();
})();
`,
    );
    const rLeakCheck = runBun(
      RENDER_SCRIPT,
      [
        "stills",
        "--entry",
        "lab/check-cfg.ts",
        "--lab",
        "ping=ok",
        "--lab",
        `preview_overlay=${join(film, "assets/public/picked.zip")}`,
      ],
      { cwd: film },
    );
    expect(rLeakCheck.status, rLeakCheck.stderr || rLeakCheck.stdout).toBe(0);
    const combined = `${rLeakCheck.stdout}\n${rLeakCheck.stderr}`;
    const match = combined.match(/CFG_LAB_KEYS:(\[[^\r\n]*\])/);
    expect(match, combined).not.toBeNull();
    const labKeys = JSON.parse(match[1]);
    expect(labKeys).toContain("ping");
    expect(labKeys).not.toContain("preview_overlay");
  }, 60_000);

  test("previews unpicked vault modpack blocks & items read-only, overrides picked.zip with --source, isolates broken candidates, and cleans temp overlays", () => {
    const vault = makeTempDir("asset-preview-vault-");
    const enc = new TextEncoder();
    try {
      mkdirSync(join(vault, "packs"), { recursive: true });
      mkdirSync(join(vault, "jar"), { recursive: true });
      copyFileSync(CLIENT_ZIP, join(vault, "jar/client_assets.zip"));

      const packA = zipSync({
        "assets/shopmod/blockstates/cafe_chair.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "minecraft:block/oak_stairs" } } }),
        ),
        "assets/shopmod/blockstates/broken_lamp.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "shopmod:block/missing_mesh" } } }),
        ),
        "assets/shopmod/items/latte_cup.json": enc.encode(
          JSON.stringify({ model: { type: "minecraft:model", model: "minecraft:item/apple" } }),
        ),
        "assets/sharedmod/blockstates/desk_lamp.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "minecraft:block/torch" } } }),
        ),
      });
      const packB = zipSync({
        "assets/sharedmod/blockstates/desk_lamp.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "minecraft:block/lantern" } } }),
        ),
        "assets/badmod/blockstates/good_crate.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "minecraft:block/lantern" } } }),
        ),
      });
      const packC = zipSync({
        "assets/badmod/blockstates/good_crate.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "badmod:block/missing_mesh" } } }),
        ),
        "assets/minecraft/blockstates/oak_planks.json": enc.encode(
          JSON.stringify({ variants: { "": { model: "packc:block/missing_planks_mesh" } } }),
        ),
      });
      writeFileSync(join(vault, "packs/pack-a.jar"), packA);
      writeFileSync(join(vault, "packs/pack-b.jar"), packB);
      writeFileSync(join(vault, "packs/pack-c.jar"), packC);

      const picksBefore = readFileSync(join(film, "pack/picks.json"));
      const pickedZipBefore = readFileSync(join(film, "assets/public/picked.zip"));
      const vaultEnv = { ...process.env, MC_VAULT_ROOT: vault };

      // 1) Unpicked modpack block + item preview cleanly without mutating film picks or picked.zip
      const rUnpicked = runBun(
        ASSET_SCRIPT,
        [
          "preview",
          "block:shopmod:cafe_chair",
          "item:shopmod:latte_cup",
          "--film",
          film,
          "--out",
          "unpicked_sheet.jpg",
        ],
        { env: vaultEnv },
      );
      expect(rUnpicked.status, rUnpicked.stderr || rUnpicked.stdout).toBe(0);
      const jUnpicked = JSON.parse(rUnpicked.stdout);
      expect(jUnpicked.ok).toBe(true);
      expect(jUnpicked.resolved).toBe(2);
      expect(jUnpicked.items[0].missing).toBe(false);
      expect(jUnpicked.items[0].bounds.size).toEqual([1, 1, 1]);
      expect(jUnpicked.items[1].missing).toBe(false);
      expect(jUnpicked.items[1].bounds).not.toBeNull();
      expect(jUnpicked.stagedFromVault).toEqual([
        { id: "block:shopmod:cafe_chair", pack: "pack-a.jar" },
        { id: "item:shopmod:latte_cup", pack: "pack-a.jar" },
      ]);
      expect(readFileSync(join(film, "pack/picks.json"))).toEqual(picksBefore);
      expect(readFileSync(join(film, "assets/public/picked.zip"))).toEqual(pickedZipBefore);

      // 2) Ambiguous ID across 2 vault packs fails with exit 2 naming both packs
      const rAmbig = runBun(
        ASSET_SCRIPT,
        ["preview", "block:sharedmod:desk_lamp", "--film", film],
        { env: vaultEnv },
      );
      expect(rAmbig.status).toBe(2);
      expect(rAmbig.stderr).toContain("Ambiguous");
      expect(rAmbig.stderr).toContain("pack-a.jar");
      expect(rAmbig.stderr).toContain("pack-b.jar");

      // 3) --source selects pack-b's lantern (0.375 x 0.6875 x 0.375) AND overrides picked.zip's 1x1x1 good_crate
      const rSource = runBun(
        ASSET_SCRIPT,
        [
          "preview",
          "block:sharedmod:desk_lamp",
          "block:badmod:good_crate",
          "--source",
          "pack-b",
          "--film",
          film,
          "--out",
          "source_sheet.jpg",
        ],
        { env: vaultEnv },
      );
      expect(rSource.status, rSource.stderr || rSource.stdout).toBe(0);
      const jSource = JSON.parse(rSource.stdout);
      expect(jSource.ok).toBe(true);
      expect(jSource.resolved).toBe(2);
      expect(jSource.stagedFromVault).toEqual([
        { id: "block:sharedmod:desk_lamp", pack: "pack-b.jar" },
        { id: "block:badmod:good_crate", pack: "pack-b.jar" },
      ]);
      for (const entry of jSource.items) {
        expect(entry.missing).toBe(false);
        expect(entry.bounds.size[0]).toBeCloseTo(0.375, 2);
        expect(entry.bounds.size[1]).toBeCloseTo(0.6875, 2);
        expect(entry.bounds.size[2]).toBeCloseTo(0.375, 2);
      }
      expect(readFileSync(join(film, "assets/public/picked.zip"))).toEqual(pickedZipBefore);

      // 4) Broken vault candidate is isolated so valid siblings still render and stagingErrors reports it
      const rBrokenMix = runBun(
        ASSET_SCRIPT,
        [
          "preview",
          "block:shopmod:cafe_chair",
          "block:shopmod:broken_lamp",
          "--film",
          film,
          "--out",
          "broken_mix_sheet.jpg",
        ],
        { env: vaultEnv },
      );
      expect(rBrokenMix.status, rBrokenMix.stderr || rBrokenMix.stdout).toBe(0);
      const jBrokenMix = JSON.parse(rBrokenMix.stdout);
      expect(jBrokenMix.ok).toBe(true);
      expect(jBrokenMix.resolved).toBe(1);
      expect(jBrokenMix.items[0].missing).toBe(false);
      expect(jBrokenMix.items[1].missing).toBe(true);
      expect(jBrokenMix.items[1].bounds).toBeNull();
      expect(jBrokenMix.stagedFromVault).toEqual([
        { id: "block:shopmod:cafe_chair", pack: "pack-a.jar" },
      ]);
      expect(jBrokenMix.stagingErrors).toHaveLength(1);
      expect(jBrokenMix.stagingErrors[0].id).toBe("block:shopmod:broken_lamp");
      expect(jBrokenMix.stagingErrors[0].pack).toBe("pack-a.jar");

      // 5) Broken --source candidate must NEVER silently fall back to picked.zip or vanilla client_assets.zip
      const rBrokenSourcePicked = runBun(
        ASSET_SCRIPT,
        [
          "preview",
          "block:badmod:good_crate",
          "--source",
          "pack-c",
          "--film",
          film,
          "--out",
          "broken_source_picked.jpg",
        ],
        { env: vaultEnv },
      );
      expect(rBrokenSourcePicked.status).toBe(1);
      const jBrokenSourcePicked = JSON.parse(rBrokenSourcePicked.stdout);
      expect(jBrokenSourcePicked.ok).toBe(false);
      expect(jBrokenSourcePicked.resolved).toBe(0);
      expect(jBrokenSourcePicked.items[0].missing).toBe(true);
      expect(jBrokenSourcePicked.items[0].bounds).toBeNull();
      expect(jBrokenSourcePicked.stagingErrors).toHaveLength(1);
      expect(jBrokenSourcePicked.stagingErrors[0].id).toBe("block:badmod:good_crate");

      const rBrokenSourceVanilla = runBun(
        ASSET_SCRIPT,
        [
          "preview",
          "block:minecraft:oak_planks",
          "--source",
          "pack-c",
          "--film",
          film,
          "--out",
          "broken_source_vanilla.jpg",
        ],
        { env: vaultEnv },
      );
      expect(rBrokenSourceVanilla.status).toBe(1);
      const jBrokenSourceVanilla = JSON.parse(rBrokenSourceVanilla.stdout);
      expect(jBrokenSourceVanilla.ok).toBe(false);
      expect(jBrokenSourceVanilla.resolved).toBe(0);
      expect(jBrokenSourceVanilla.items[0].missing).toBe(true);
      expect(jBrokenSourceVanilla.items[0].bounds).toBeNull();
      expect(jBrokenSourceVanilla.stagingErrors).toHaveLength(1);
      expect(jBrokenSourceVanilla.stagingErrors[0].id).toBe("block:minecraft:oak_planks");

      // 6) --source minecraft skips picked.zip overrides and renders true vanilla geometry
      const rSourceVanilla = runBun(
        ASSET_SCRIPT,
        [
          "preview",
          "block:minecraft:brick_stairs",
          "--source",
          "minecraft",
          "--film",
          film,
          "--out",
          "source_vanilla.jpg",
        ],
        { env: vaultEnv },
      );
      expect(rSourceVanilla.status, rSourceVanilla.stderr || rSourceVanilla.stdout).toBe(0);
      const jSourceVanilla = JSON.parse(rSourceVanilla.stdout);
      expect(jSourceVanilla.ok).toBe(true);
      expect(jSourceVanilla.items[0].missing).toBe(false);
      expect(jSourceVanilla.items[0].bounds.size).toEqual([1, 1, 1]);

      // 7) Unknown --source fails fast with exit 2
      const rMissingSrc = runBun(
        ASSET_SCRIPT,
        ["preview", "block:sharedmod:desk_lamp", "--source", "no-such-pack", "--film", film],
        { env: vaultEnv },
      );
      expect(rMissingSrc.status).toBe(2);
      expect(rMissingSrc.stderr).toContain("no-such-pack");

      // 8) Every ephemeral overlay zip created by child processes in this test was cleaned up
      const spawnedPids = new Set(
        [
          rUnpicked,
          rAmbig,
          rSource,
          rBrokenMix,
          rBrokenSourcePicked,
          rBrokenSourceVanilla,
          rSourceVanilla,
          rMissingSrc,
        ]
          .map((r) => r.pid)
          .filter((pid) => typeof pid === "number" && pid > 0),
      );
      expect(spawnedPids.size).toBeGreaterThan(0);
      const leakedOverlays = readdirSync(tmpdir()).filter((f) => {
        const m = /^mc-preview-overlay-(\d+)-.*\.zip$/i.exec(f);
        return m ? spawnedPids.has(Number(m[1])) : false;
      });
      expect(leakedOverlays).toEqual([]);
    } finally {
      rmSync(vault, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 120_000);
});
