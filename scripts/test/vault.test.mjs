import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mc-vault-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [
    "scripts",
    "vault/jar",
    "vault/motion",
    "vault/packs",
    "vault/tools",
    "vault/mc-sound",
    "external",
    "films/demo/assets/public",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["link.ts", "vault.mjs"])
    if (existsSync(join(scripts, file)))
      copyFileSync(join(scripts, file), join(root, "scripts", file));
  mkdirSync(join(root, "packages/live-studio/src"), { recursive: true });
  for (const file of ["cli.mjs", "edit-protection.mjs", "merge-edits.mjs"])
    copyFileSync(
      join(scripts, "../packages/live-studio/src", file),
      join(root, "packages/live-studio/src", file),
    );
  writeFileSync(
    join(root, "vault.json"),
    JSON.stringify({
      root: "./vault",
      externalRoot: "./external",
      requiredDirectories: ["motion", "packs", "tools", "mc-sound"],
      film_links: { mc: "jar", motion: "motion" },
    }),
  );
  writeFileSync(join(root, "vault/jar/model.txt"), "local");
  writeFileSync(join(root, "vault/motion/clip.txt"), "motion");
  writeFileSync(join(root, "vault/mc-sound/SOURCES.json"), "{}");
  writeFileSync(join(root, "films/demo/package.json"), "{}");
  return {
    root,
    run: () =>
      spawnSync("bun", [join(root, "scripts/link.ts")], {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
      }),
  };
}

test("link makes independent real asset copies and can refresh unchanged copies", (t) => {
  const { root, run } = fixture(t);
  for (let i = 0; i < 2; i++) {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(root, "films/demo/assets/public/mc/model.txt"), "utf8"),
      "local",
    );
    assert.equal(
      readFileSync(join(root, "films/demo/assets/public/motion/clip.txt"), "utf8"),
      "motion",
    );
    assert.equal(readFileSync(join(root, "vault/mc-sound/SOURCES.json"), "utf8"), "{}");
  }
  assert.equal(lstatSync(join(root, "vault")).isSymbolicLink(), false);
  assert.equal(lstatSync(join(root, "films/demo/assets/public/mc")).isSymbolicLink(), false);
  assert.equal(lstatSync(join(root, "films/demo/assets/public/motion")).isSymbolicLink(), false);
  writeFileSync(join(root, "vault/jar/model.txt"), "updated");
  assert.equal(run().status, 0);
  assert.equal(
    readFileSync(join(root, "films/demo/assets/public/mc/model.txt"), "utf8"),
    "updated",
  );
  rmSync(join(root, "films/demo/assets/public/motion"), { recursive: true });
  assert.equal(readFileSync(join(root, "vault/motion/clip.txt"), "utf8"), "motion");
});

test("refresh refuses a modified film asset and preserves both versions", (t) => {
  const { root, run } = fixture(t);
  assert.equal(run().status, 0);
  const filmFile = join(root, "films/demo/assets/public/mc/model.txt");
  writeFileSync(filmFile, "custom film asset");
  writeFileSync(join(root, "vault/jar/model.txt"), "new shared asset");
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(filmFile, "utf8"), "custom film asset");
  assert.equal(readFileSync(join(root, "vault/jar/model.txt"), "utf8"), "new shared asset");
});

test("refresh refuses a nested junction without writing into its target", (t) => {
  const { root, run } = fixture(t);
  mkdirSync(join(root, "vault/jar/nested"));
  writeFileSync(join(root, "vault/jar/nested/model.txt"), "original");
  assert.equal(run().status, 0);
  const nested = join(root, "films/demo/assets/public/mc/nested");
  rmSync(nested, { recursive: true });
  const outside = join(root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "model.txt"), "original");
  symlinkSync(outside, nested, "junction");
  writeFileSync(join(root, "vault/jar/nested/model.txt"), "updated");
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(join(outside, "model.txt"), "utf8"), "original");
});

test("refresh updates an untouched copy after its source was temporarily removed", (t) => {
  const { root, run } = fixture(t);
  const source = join(root, "vault/jar/model.txt");
  const dest = join(root, "films/demo/assets/public/mc/model.txt");
  assert.equal(run().status, 0);
  rmSync(source);
  assert.equal(run().status, 0);
  assert.equal(readFileSync(dest, "utf8"), "local");
  writeFileSync(source, "returned");
  const refreshed = run();
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.equal(readFileSync(dest, "utf8"), "returned");
});

test("sound build reads the local Earshot tool while the archive is empty", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const { root } = fixture(t);
  const local = join(root, "vault");
  const bank = join(local, "tools/earshot/earshot/forge");
  mkdirSync(bank, { recursive: true });
  writeFileSync(join(bank, "bank.py"), "local bank fixture");
  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  writeFileSync(
    join(root, "scripts/render_earshot_bank.py"),
    [
      "import json, sys",
      "from pathlib import Path",
      "assert (Path(sys.argv[1]) / 'earshot/forge/bank.py').read_text() == 'local bank fixture'",
      "print(json.dumps({'sources': {'local-bank': {'title': 'Local bank', 'license': 'CC0 1.0'}}, 'rendered': 1, 'reused': 0}))",
    ].join("\n"),
  );
  await buildSoundVault({
    root,
    local,
    external: join(root, "external"),
    skipBgm: true,
    skipFreesound: true,
    log: () => {},
  });
  const sources = JSON.parse(readFileSync(join(local, "sound/SOURCES.json"), "utf8"));
  assert.equal(sources["local-bank"]?.title, "Local bank");
  assert.equal(existsSync(join(root, "external/tools")), false);
});

test("link repairs an existing link to the old vault without changing its files", (t) => {
  const { root, run } = fixture(t);
  mkdirSync(join(root, "old-jar"));
  writeFileSync(join(root, "old-jar/model.txt"), "old");
  symlinkSync(join(root, "old-jar"), join(root, "films/demo/assets/public/mc"), "junction");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, "films/demo/assets/public/mc/model.txt"), "utf8"), "local");
  assert.equal(readFileSync(join(root, "old-jar/model.txt"), "utf8"), "old");
});

test("link fails on a real directory collision and preserves its content", (t) => {
  const { root, run } = fixture(t);
  mkdirSync(join(root, "films/demo/assets/public/mc"));
  writeFileSync(join(root, "films/demo/assets/public/mc/keep.txt"), "user asset");
  const result = run();
  assert.notEqual(result.status, 0);
  assert.equal(
    readFileSync(join(root, "films/demo/assets/public/mc/keep.txt"), "utf8"),
    "user asset",
  );
});

async function soundFixture(t, response) {
  const f = fixture(t);
  for (const name of ["fetch_mixkit.mjs", "download.mjs"])
    if (existsSync(join(scripts, name)))
      copyFileSync(join(scripts, name), join(f.root, "scripts", name));
  const server = createServer(response);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  writeFileSync(
    join(f.root, "scripts/sfx-catalogue.json"),
    JSON.stringify({
      sounds: [{ id: "test", file_url: `http://127.0.0.1:${server.address().port}/sound.wav` }],
    }),
  );
  return {
    ...f,
    fetch: () =>
      new Promise((done, reject) => {
        const child = spawn("bun", [join(f.root, "scripts/fetch_mixkit.mjs")], {
          cwd: f.root,
          timeout: 15_000,
        });
        let output = "";
        child.stdout.on("data", (b) => {
          output += b;
        });
        child.stderr.on("data", (b) => {
          output += b;
        });
        child.on("error", reject);
        child.on("close", (status) => done({ status, output }));
      }),
  };
}

test("sound fetch reports failure instead of claiming success after HTTP 404", async (t) => {
  const f = await soundFixture(t, (_req, res) => {
    res.writeHead(404);
    res.end("missing");
  });
  const result = await f.fetch();
  assert.notEqual(result.status, 0, result.output);
  assert.equal(existsSync(join(f.root, "vault/sfx/mixkit/test.wav")), false);
});

test("sound fetch replaces an invalid cached response with the downloaded WAV", async (t) => {
  const wav = Buffer.from(
    "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000000000",
    "hex",
  );
  const f = await soundFixture(t, (_req, res) => {
    res.end(wav);
  });
  const file = join(f.root, "vault/sfx/mixkit/test.wav");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "<html>download interrupted</html>");
  const result = await f.fetch();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(readFileSync(file), wav);
});

test("sound fetch also downloads the vault's own Mixkit picks", async (t) => {
  const wav = Buffer.from(
    "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000000000",
    "hex",
  );
  const f = await soundFixture(t, (_req, res) => {
    res.end(wav);
  });
  const url = JSON.parse(readFileSync(join(f.root, "scripts/sfx-catalogue.json"), "utf8")).sounds[0]
    .file_url;
  writeFileSync(
    join(f.root, "scripts/sfx-picks.json"),
    JSON.stringify({ sounds: [{ id: "mixkit-1", file_url: url }] }),
  );
  const result = await f.fetch();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(readFileSync(join(f.root, "vault/sfx/mixkit/mixkit-1.wav")), wav);
});

test("pick.mjs cherry-picks blockstates, parent models, textures and .mcmeta without Python", async (t) => {
  const { zipSync, unzipSync, strToU8, strFromU8 } = await import("fflate");
  const { pickBlocks } = await import("../../packages/mc-assets/pick.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-pick-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vaultPacks = join(root, "vault/packs"),
    filmDir = join(root, "film");
  mkdirSync(vaultPacks, { recursive: true });
  mkdirSync(join(filmDir, "pack"), { recursive: true });
  mkdirSync(join(filmDir, "assets/public"), { recursive: true });
  writeFileSync(
    join(vaultPacks, "decor.jar"),
    zipSync({
      "assets/decor/blockstates/lamp.json": strToU8(
        JSON.stringify({ variants: { "": { model: "decor:block/lamp" } } }),
      ),
      "assets/decor/models/block/lamp.json": strToU8(
        JSON.stringify({
          parent: "decor:block/base_lamp",
          textures: { glow: "decor:block/glow", stone: "minecraft:block/stone", ref: "#glow" },
        }),
      ),
      "assets/decor/models/block/base_lamp.json": strToU8(
        JSON.stringify({ parent: "block/cube_all" }),
      ),
      "assets/decor/textures/block/glow.png": new Uint8Array([137, 80, 78, 71]),
      "assets/decor/textures/block/glow.png.mcmeta": strToU8('{"animation":{}}'),
      "assets/decor/textures/block/unused.png": new Uint8Array([0]),
    }),
  );
  writeFileSync(
    join(filmDir, "pack/picks.json"),
    JSON.stringify([{ jar: "decor.jar", namespace: "decor", blocks: ["lamp"] }]),
  );
  pickBlocks({ cwd: filmDir, vaultDir: vaultPacks });
  const out = unzipSync(readFileSync(join(filmDir, "assets/public/picked.zip")));
  assert.deepEqual(Object.keys(out).sort(), [
    "assets/decor/blockstates/lamp.json",
    "assets/decor/models/block/base_lamp.json",
    "assets/decor/models/block/lamp.json",
    "assets/decor/textures/block/glow.png",
    "assets/decor/textures/block/glow.png.mcmeta",
    "pack.mcmeta",
  ]);
  assert.equal(JSON.parse(strFromU8(out["pack.mcmeta"])).pack.pack_format, 75);
});

test("slim_jar.mjs strips .class and META-INF while keeping assets, data/minecraft/structure and root files", async (t) => {
  const { zipSync, unzipSync, strToU8 } = await import("fflate");
  const { slimJar } = await import("../mc/slim_jar.mjs");
  const mcDir = mkdtempSync(join(tmpdir(), "mc-slim-test-"));
  t.after(() => rmSync(mcDir, { recursive: true, force: true }));
  writeFileSync(
    join(mcDir, "client.jar"),
    zipSync({
      "net/minecraft/Main.class": new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
      "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0\n"),
      "assets/minecraft/textures/block/stone.png": new Uint8Array([1, 2, 3]),
      "data/minecraft/structure/igloo/top.nbt": new Uint8Array([4, 5, 6]),
      "pack.mcmeta": strToU8('{"pack":{"pack_format":48}}'),
      "other/ignored.txt": strToU8("skip"),
    }),
  );
  slimJar({ mcDir });
  const out = unzipSync(readFileSync(join(mcDir, "client_assets.zip")));
  assert.deepEqual(Object.keys(out).sort(), [
    "assets/minecraft/textures/block/stone.png",
    "data/minecraft/structure/igloo/top.nbt",
    "pack.mcmeta",
  ]);
  slimJar({ mcDir });
  writeFileSync(join(mcDir, "client_assets.zip"), "corrupted");
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(mcDir, "client_assets.zip.br"), later, later);
  assert.throws(() => slimJar({ mcDir }), /Corrupt/);
});

test("slim_jar.mjs stores the files as they are and squeezes the whole zip once into client_assets.zip.br", async (t) => {
  const { zipSync, unzipSync, strToU8 } = await import("fflate");
  const { brotliDecompressSync } = await import("node:zlib");
  const { slimJar } = await import("../mc/slim_jar.mjs");
  const mcDir = mkdtempSync(join(tmpdir(), "mc-slim-br-test-"));
  t.after(() => rmSync(mcDir, { recursive: true, force: true }));
  const model = strToU8(
    JSON.stringify({ parent: "block/cube_all", textures: { all: "block/stone" } }),
  );
  const files = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`assets/minecraft/models/block/b${i}.json`, model]),
  );
  writeFileSync(join(mcDir, "client.jar"), zipSync(files));
  writeFileSync(join(mcDir, "client_assets.zip"), zipSync(files, { level: 6 }));
  const after = new Date(Date.now() + 60_000);
  utimesSync(join(mcDir, "client_assets.zip"), after, after);
  slimJar({ mcDir });

  const zip = readFileSync(join(mcDir, "client_assets.zip"));
  const methods = new Set();
  unzipSync(zip, { filter: (f) => (methods.add(f.compression), true) });
  assert.deepEqual(
    [...methods],
    [0],
    "stored: brotli over the whole zip finds the repeats across files",
  );
  assert.deepEqual(brotliDecompressSync(readFileSync(join(mcDir, "client_assets.zip.br"))), zip);
  assert.deepEqual(Object.keys(unzipSync(zip)), Object.keys(files));
});

test("timeline_fmt.ts matches timeline_fmt.py 140-column formatting", async () => {
  const { dump } = await import("../timeline_fmt.ts");
  const sample = {
    short: [1, 2, 3],
    keys: [
      { t: 0, p: [1.25, 2.5, -3.75], l: [0, 1.5, 0], fov: 45 },
      {
        t: 4.5,
        p: [10.123456, 20.654321, -30.987654],
        l: [5.111111, 1.222222, -8.333333],
        fov: 35,
        note: "a deliberately long camera key line that crosses the 140 column width threshold cleanly",
      },
    ],
  };
  const py = spawnSync(
    "python",
    [
      "-c",
      "import json, sys; sys.path.insert(0, 'scripts'); import timeline_fmt; print(timeline_fmt.dump(json.loads(sys.argv[1])))",
      JSON.stringify(sample),
    ],
    { encoding: "utf8" },
  );
  assert.equal(py.status, 0, py.stderr);
  assert.equal(`${dump(sample)}\n`, py.stdout.replaceAll("\r\n", "\n"));
});

test("mix.py resolves sounds from vault/sound/<kind>/<category> when absent from film sound/sfx", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mc-mix-vault-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "vault.json"), JSON.stringify({ root: "./vault" }));
  mkdirSync(join(root, "vault/sound/sfx/footsteps"), { recursive: true });
  const wav = Buffer.from(
    "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000400040",
    "hex",
  );
  writeFileSync(join(root, "vault/sound/sfx/footsteps/gravel.wav"), wav);
  const film = join(root, "films/demo");
  mkdirSync(join(film, "src/timeline"), { recursive: true });
  mkdirSync(join(film, "sound/sfx"), { recursive: true });
  writeFileSync(
    join(film, "src/edit.json"),
    JSON.stringify({ end: 1, voice: { lines: [], warp: [] } }),
  );
  writeFileSync(
    join(film, "src/timeline/audio.json"),
    JSON.stringify({ voice: false, beds: [], sfx: [{ at: 0, name: "gravel", gain: 0 }] }),
  );
  const out = join(film, "sound/mix_dry.wav");
  const py = spawnSync("python", [join(scripts, "sound/mix.py"), "--raw", out], {
    cwd: film,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(existsSync(out), true);
});

test("mix.py resolves .ogg sounds from vault/mc-sound/mc/<category>", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mc-mix-ogg-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "vault.json"), JSON.stringify({ root: "./vault" }));
  mkdirSync(join(root, "vault/mc-sound/mc/footsteps"), { recursive: true });
  const oggPath = join(root, "vault/mc-sound/mc/footsteps/mc-step-stone-1.ogg");
  assert.equal(
    spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=330:sample_rate=44100:duration=0.25",
        "-c:a",
        "libvorbis",
        oggPath,
      ],
      { encoding: "utf8" },
    ).status,
    0,
  );
  const film = join(root, "films/demo");
  mkdirSync(join(film, "src/timeline"), { recursive: true });
  mkdirSync(join(film, "sound/sfx"), { recursive: true });
  writeFileSync(
    join(film, "src/edit.json"),
    JSON.stringify({ end: 1, voice: { lines: [], warp: [] } }),
  );
  writeFileSync(
    join(film, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ at: 0.1, name: "mc-step-stone-1", gain: 0 }],
    }),
  );
  const out = join(film, "sound/mix_dry.wav");
  const py = spawnSync("python", [join(scripts, "sound/mix.py"), "--raw", out], {
    cwd: film,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(existsSync(out), true);
});

test("buildSoundVault includes all curated catalogue.sounds and ignores catalogue.rejected", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-vault-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(local, "sfx/mixkit"), { recursive: true });
  const wav = Buffer.from(
    "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000400040",
    "hex",
  );
  writeFileSync(join(local, "sfx/mixkit/mixkit-168.wav"), wav);
  writeFileSync(join(local, "sfx/mixkit/mixkit-999.wav"), wav);
  writeFileSync(join(local, "sfx/mixkit/mixkit-000.wav"), wav);
  writeFileSync(
    join(root, "scripts/sfx-catalogue.json"),
    JSON.stringify({
      sounds: [
        {
          id: "mixkit-168",
          title: "Fast air sweep",
          role: "whoosh.short",
          page: "https://mixkit.co",
          ear: { verdict: "strong", query: "a crisp whoosh" },
        },
        {
          id: "mixkit-999",
          title: "Subtle tone",
          role: "impact",
          page: "https://mixkit.co",
          ear: { verdict: "weak" },
        },
      ],
      rejected: [
        { id: "mixkit-000", title: "Rejected synth", role: "impact", page: "https://mixkit.co" },
      ],
    }),
  );
  await buildSoundVault({
    root,
    local,
    external: join(root, "none"),
    skipBgm: true,
    skipEarshot: true,
  });
  assert.equal(existsSync(join(local, "sound/sfx/transitions/mixkit-168.wav")), true);
  assert.equal(existsSync(join(local, "sound/sfx/impacts/mixkit-999.wav")), true);
  assert.equal(existsSync(join(local, "sound/sfx/impacts/mixkit-000.wav")), false);
  const sources = JSON.parse(readFileSync(join(local, "sound/SOURCES.json"), "utf8"));
  assert.equal(sources["mixkit-168"].source, "mixkit");
  assert.equal(sources["mixkit-168"].origin, "real");
  assert.equal(sources["mixkit-168"].role, "whoosh");
  assert.equal(sources["mixkit-999"].source, "mixkit");
  assert.equal(sources["mixkit-999"].origin, "real");
  assert.equal(sources["mixkit-000"], undefined);
});

test("buildSoundVault files a sound both lists name once, where the vault's own pick puts it", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-vault-twice-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(local, "sfx/mixkit"), { recursive: true });
  const wav = Buffer.from(
    "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000400040",
    "hex",
  );
  writeFileSync(join(local, "sfx/mixkit/mixkit-1115.wav"), wav);
  mkdirSync(join(local, "sound/sfx/clicks"), { recursive: true });
  writeFileSync(join(local, "sound/sfx/clicks/mixkit-1115.wav"), wav);
  const pen = { id: "mixkit-1115", title: "Pen click", page: "https://mixkit.co" };
  writeFileSync(
    join(root, "scripts/sfx-catalogue.json"),
    JSON.stringify({ sounds: [{ ...pen, role: "click.soft" }] }),
  );
  writeFileSync(
    join(root, "scripts/sfx-picks.json"),
    JSON.stringify({ sounds: [{ ...pen, category: "foley" }] }),
  );
  await buildSoundVault({
    root,
    local,
    external: join(root, "none"),
    skipBgm: true,
    skipEarshot: true,
  });
  assert.equal(existsSync(join(local, "sound/sfx/foley/mixkit-1115.wav")), true);
  assert.equal(existsSync(join(local, "sound/sfx/clicks/mixkit-1115.wav")), false);
});

test("buildSoundVault without earshot in the local vault says where to get it", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-no-earshot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  const lines = [];
  await buildSoundVault({
    root,
    local: join(root, "vault"),
    external: join(root, "ext"),
    skipBgm: true,
    log: (l) => lines.push(l),
  });
  assert.ok(
    lines.some((l) =>
      /^Waiting for you: .*github\.com\/Leonxlnx\/earshot.*vault[\\/]tools[\\/]earshot/.test(l),
    ),
    lines.join("\n"),
  );
});

test("buildSoundVault files the vault's own Mixkit picks into their category, saying what each is for", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-picks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(local, "sfx/mixkit"), { recursive: true });
  writeFileSync(
    join(local, "sfx/mixkit/mixkit-472.wav"),
    Buffer.from(
      "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000400040",
      "hex",
    ),
  );
  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  writeFileSync(
    join(root, "scripts/sfx-picks.json"),
    JSON.stringify({
      sounds: [
        {
          id: "mixkit-472",
          title: "Slow sad trombone fail",
          category: "comedy",
          for: "a fail, a punchline that flops",
          page: "https://mixkit.co/free-sound-effects/wrong/",
        },
      ],
    }),
  );
  await buildSoundVault({
    root,
    local,
    external: join(root, "none"),
    skipBgm: true,
    skipEarshot: true,
    log: () => {},
  });
  assert.equal(existsSync(join(local, "sound/sfx/comedy/mixkit-472.wav")), true);
  const sources = JSON.parse(readFileSync(join(local, "sound/SOURCES.json"), "utf8"));
  assert.deepEqual(sources["mixkit-472"], {
    title: "Slow sad trombone fail",
    license: "Mixkit Sound Effects Free License",
    url: "https://mixkit.co/free-sound-effects/wrong/",
    for: "a fail, a punchline that flops",
    source: "mixkit",
    kind: "sfx",
    origin: "real",
  });
});

test("a Mixkit pick longer than 12 s is cut at its silences into one sound per take; one with no silences, or whose maxSeconds allows it, stays whole", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-long-picks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(local, "sfx/mixkit"), { recursive: true });
  const wav = (id, expr) => {
    const r = spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=48000:d=14`].concat([
        "-c:a",
        "pcm_s16le",
        join(local, "sfx/mixkit", `${id}.wav`),
      ]),
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
  };
  wav("mixkit-9001", "0.5*sin(2*PI*440*t)*lt(mod(t\\,6)\\,1)");
  wav("mixkit-9003", "0.5*sin(2*PI*440*t)*lt(mod(t\\,6)\\,1)");
  wav("mixkit-9002", "0.5*sin(2*PI*220*t)");
  mkdirSync(join(local, "sound/sfx/nature"), { recursive: true });
  copyFileSync(
    join(local, "sfx/mixkit/mixkit-9001.wav"),
    join(local, "sound/sfx/nature/mixkit-9001.wav"),
  );
  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  const pick = (id, title) => ({
    id,
    title,
    category: "nature",
    for: "a wolf howl",
    page: "https://mixkit.co/free-sound-effects/wolf/",
  });
  const writePicks = (howls = {}) =>
    writeFileSync(
      join(root, "scripts/sfx-picks.json"),
      JSON.stringify({
        sounds: [
          { ...pick("mixkit-9001", "Wolf howls"), ...howls },
          pick("mixkit-9002", "Wind"),
          { ...pick("mixkit-9003", "Clock ticking"), maxSeconds: 60 },
        ],
      }),
    );
  writePicks();
  const lines = [];
  const build = () =>
    buildSoundVault({
      root,
      local,
      external: join(root, "none"),
      skipBgm: true,
      skipEarshot: true,
      log: (l) => lines.push(l),
    });
  await build();
  const sources = JSON.parse(readFileSync(join(local, "sound/SOURCES.json"), "utf8"));
  const takes = Object.keys(sources).filter((n) => n.startsWith("mixkit-9001"));
  assert.deepEqual(takes.sort(), [
    "mixkit-9001-take-1",
    "mixkit-9001-take-2",
    "mixkit-9001-take-3",
  ]);
  assert.deepEqual(
    takes.map((n) => [sources[n].title, sources[n].for, sources[n].family, sources[n].variant]),
    takes.map((n, i) => ["Wolf howls", "a wolf howl", "mixkit-9001", i + 1]),
  );
  for (const n of takes) {
    const file = join(local, `sound/sfx/nature/${n}.wav`);
    const seconds = Number(
      spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
        { encoding: "utf8" },
      ).stdout,
    );
    assert.ok(seconds > 1 && seconds < 1.5, `${n} holds one call, got ${seconds} s`);
  }
  assert.equal(existsSync(join(local, "sound/sfx/nature/mixkit-9001.wav")), false);
  assert.equal(existsSync(join(local, "sound/sfx/nature/mixkit-9002.wav")), true);
  assert.equal(sources["mixkit-9002"].family, undefined);
  assert.equal(existsSync(join(local, "sound/sfx/nature/mixkit-9003.wav")), true);
  assert.equal(sources["mixkit-9003"].family, undefined);
  assert.ok(
    lines.some((l) => /Mixkit SFX: 1 long sounds? cut into 3 takes/.test(l)),
    lines.join("\n"),
  );
  assert.ok(
    lines.some((l) => /Mixkit SFX: 1 sounds? longer than their limit kept whole/.test(l)),
    lines.join("\n"),
  );
  const before = readFileSync(join(local, "sound/sfx/nature/mixkit-9001-take-2.wav"));
  await build();
  assert.deepEqual(readFileSync(join(local, "sound/sfx/nature/mixkit-9001-take-2.wav")), before);
  writePicks({ maxSeconds: 60 });
  await build();
  const now = JSON.parse(readFileSync(join(local, "sound/SOURCES.json"), "utf8"));
  assert.deepEqual(
    Object.keys(now).filter((n) => n.startsWith("mixkit-9001")),
    ["mixkit-9001"],
  );
  assert.equal(existsSync(join(local, "sound/sfx/nature/mixkit-9001.wav")), true);
  assert.equal(existsSync(join(local, "sound/sfx/nature/mixkit-9001-take-1.wav")), false);
});

test("buildSoundVault files Mixkit tones by use and moves a sound out of its old category instead of copying it", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-recat-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(local, "sound/sfx/tones"), { recursive: true });
  const wav = Buffer.from(
    "524946462800000057415645666d74201000000001000100401f0000803e000002001000646174610400000000400040",
    "hex",
  );
  const sounds = [
    ["mixkit-2867", "notification", "notifications"],
    ["mixkit-1107", "note", "notifications"],
    ["mixkit-2323", "note", "musical"],
    ["mixkit-3109", "glass", "musical"],
    ["mixkit-154", "glass", "foley"],
    ["mixkit-1063", "tick", "foley"],
    ["mixkit-1433", "shutter", "shutter"],
  ];
  for (const [id] of sounds) writeFileSync(join(local, "sound/sfx/tones", `${id}.wav`), wav);
  writeFileSync(
    join(root, "scripts/sfx-catalogue.json"),
    JSON.stringify({
      sounds: sounds.map(([id, role]) => ({ id, title: id, role, page: "https://mixkit.co" })),
    }),
  );
  await buildSoundVault({
    root,
    local,
    external: join(root, "none"),
    skipBgm: true,
    skipEarshot: true,
  });
  for (const [id, , cat] of sounds) {
    assert.equal(existsSync(join(local, "sound/sfx", cat, `${id}.wav`)), true, `${id} in ${cat}`);
    if (cat !== "tones")
      assert.equal(
        existsSync(join(local, "sound/sfx/tones", `${id}.wav`)),
        false,
        `${id} left behind`,
      );
  }
});

test("buildSoundVault pads hot lossy BGM decodes above -1 dBFS so pcm_s16le never hard-clips", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const { wavPeaks } = await import("../../packages/live-studio/src/sound.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-bgm-headroom-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault"),
    hotOgg = join(root, "hot.ogg");
  const gen = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=1.4*sin(2*PI*440*t)+0.1*random(0)|1.4*sin(2*PI*554*t)+0.1*random(1):s=44100:d=2",
      "-q:a",
      "10",
      "-c:a",
      "libvorbis",
      hotOgg,
    ],
    { encoding: "utf8" },
  );
  assert.equal(gen.status, 0, gen.stderr);
  const oggBytes = readFileSync(hotOgg);
  const server = createServer((_req, res) => {
    res.end(oggBytes);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".claude/skills/cinetic/assets/music"), { recursive: true });
  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  writeFileSync(
    join(root, ".claude/skills/cinetic/assets/music/shortlist.json"),
    JSON.stringify({
      licences: { "cc-by-3.0": { name: "CC BY 3.0" } },
      tracks: [
        {
          id: "hot-track",
          title: "Hot",
          artist: "Test",
          source: "Wikimedia Commons",
          page: "https://commons.wikimedia.org",
          file_url: `http://127.0.0.1:${server.address().port}/hot.ogg`,
          licence_id: "cc-by-3.0",
          mood: "calm",
          profile: "calm",
        },
      ],
    }),
  );
  await buildSoundVault({ root, local, external: join(root, "none"), skipEarshot: true });
  const outWav = join(local, "sound/bgm/chill/bgm-hot-track.wav");
  const maxPeak = Math.max(...wavPeaks(outWav).peaks);
  assert.equal(maxPeak < 0.92, true, `expected headroom <= -1 dBFS (~0.89), got ${maxPeak}`);
});

test("buildSoundVault ingests Pixabay drop MP3s, skips disputed journey-roa, and converts Earshot fit CC0 Freesound originals", async (t) => {
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const { openSound } = await import("../../packages/live-studio/src/sound.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-curated-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault"),
    external = join(root, "ext"),
    pixabayDir = join(root, "downloads");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".agents/skills/cinetic/assets/music"), { recursive: true });
  mkdirSync(join(local, "tools/earshot/earshot/forge/bank"), { recursive: true });
  mkdirSync(pixabayDir, { recursive: true });

  const toneMp3 = join(pixabayDir, "coma-media-this-minimal-technology_pure-12327.mp3");
  const toneOgg = join(root, "plastic.ogg");
  assert.equal(
    spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=0.4",
        "-c:a",
        "libmp3lame",
        toneMp3,
      ],
      { encoding: "utf8" },
    ).status,
    0,
  );
  assert.equal(
    spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=48000:duration=0.25",
        "-c:a",
        "libvorbis",
        toneOgg,
      ],
      { encoding: "utf8" },
    ).status,
    0,
  );
  const oggBytes = readFileSync(toneOgg);

  let seenReferer = "";
  const server = createServer((req, res) => {
    if (req.url === "/code-switch.mp3") {
      seenReferer = req.headers.referer ?? "";
      res.end(readFileSync(toneMp3));
      return;
    }
    res.end(oggBytes);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  writeFileSync(
    join(root, ".agents/skills/cinetic/assets/music/shortlist.json"),
    JSON.stringify({
      licences: {
        pixabay: { name: "Pixabay Content License" },
        "cc-by-3.0": { name: "CC BY 3.0" },
      },
      tracks: [
        {
          id: "this-minimal-technology-pure",
          title: "This Minimal Technology_Pure",
          artist: "Coma-Media",
          source: "Pixabay",
          page: "https://pixabay.com/music/corporate-this-minimal-technology-pure-12327/",
          licence_id: "pixabay",
          mood: "minimal electronic",
          profile: "crisp",
          content_id: "registered",
        },
        {
          id: "amalgam",
          title: "AMALGAM",
          artist: "Rockot",
          source: "Pixabay",
          page: "https://pixabay.com/music/future-bass-amalgam-217007/",
          licence_id: "pixabay",
          mood: "orchestral house",
          profile: "punchy",
        },
      ],
      bench: [
        {
          id: "journey-roa",
          title: "Journey",
          artist: "Roa",
          source: "Chosic",
          page: "https://www.chosic.com/download-audio/45480/",
          file_url: `${baseUrl}/disputed.mp3`,
          licence_id: "cc-by-3.0",
          mood: "disputed",
          profile: "crisp",
        },
        {
          id: "code-switch",
          title: "Code Switch",
          artist: "Punch Deck",
          source: "Chosic",
          page: "https://www.chosic.com/download-audio/59606/",
          file_url: `${baseUrl}/code-switch.mp3`,
          licence_id: "cc-by-3.0",
          mood: "energetic trailer electronic",
          profile: "punchy",
        },
      ],
    }),
  );
  writeFileSync(
    join(local, "tools/earshot/earshot/forge/bank/fit.json"),
    JSON.stringify({
      entries: {
        "fit/click/floss_lid": {
          notes: 'a small plastic click, fitted from "Plastic Clicks.flac" by qubodup (CC0 1.0)',
          source: {
            id: "fs-167829",
            title: "Plastic Clicks.flac",
            author: "qubodup",
            license: "CC0 1.0",
            url: "https://freesound.org/people/qubodup/sounds/167829/",
            preview_url: `${baseUrl}/167829-hq.ogg`,
          },
        },
        "fit/land.light/fingertip_book": {
          notes:
            'light finger steps on a book, fitted from "Light Footsteps On Book" by IENBA (CC0 1.0)',
          source: {
            id: "fs-760337",
            title: "Light Footsteps On Book",
            author: "IENBA",
            license: "CC0 1.0",
            url: "https://freesound.org/people/IENBA/sounds/760337/",
            preview_url: `${baseUrl}/760337-hq.ogg`,
          },
        },
      },
    }),
  );

  const lines = [];
  await buildSoundVault({
    root,
    local,
    external,
    skipEarshot: true,
    pixabayDir,
    log: (l) => lines.push(l),
  });

  assert.ok(
    lines.some((l) =>
      l.startsWith(
        "Waiting for you: AMALGAM — Rockot: open https://pixabay.com/music/future-bass-amalgam-217007/",
      ),
    ),
    `a Pixabay track not dropped yet is named with its page:\n${lines.join("\n")}`,
  );
  assert.equal(existsSync(join(local, "sfx/bgm-cache/this-minimal-technology-pure.mp3")), true);
  assert.equal(
    existsSync(join(local, "sound/bgm/electronic/bgm-this-minimal-technology-pure.wav")),
    true,
  );
  assert.equal(existsSync(join(local, "sound/bgm/cinematic/bgm-amalgam.wav")), false);
  assert.equal(existsSync(join(local, "sound/bgm/electronic/bgm-journey-roa.wav")), false);
  assert.equal(existsSync(join(local, "sound/bgm/cinematic/bgm-code-switch.wav")), true);
  assert.match(seenReferer, /free-stock-music\.com/);

  assert.equal(existsSync(join(local, "sound/sfx/clicks/fs-167829.wav")), true);
  assert.equal(existsSync(join(local, "sound/sfx/foley/fs-760337.wav")), true);

  writeFileSync(join(root, "vault.json"), JSON.stringify({ root: "./vault" }));
  const film = join(root, "films/demo");
  mkdirSync(join(film, "sound/sfx"), { recursive: true });
  writeFileSync(join(film, "sound.json"), JSON.stringify({ beds: [], sfx: [], tracks: [] }));
  const snd = openSound(film, { soundTimeline: "sound.json", sfx: "sound/sfx" });
  const lib = Object.fromEntries(snd.library().map((x) => [x.name, x]));

  assert.equal(
    lib["bgm-this-minimal-technology-pure"].title,
    "This Minimal Technology Pure — Coma-Media",
  );
  assert.equal(lib["bgm-this-minimal-technology-pure"].source, "pixabay");
  assert.equal(lib["bgm-this-minimal-technology-pure"].origin, "real");
  assert.equal(lib["bgm-this-minimal-technology-pure"].category, "electronic");
  assert.equal(lib["bgm-this-minimal-technology-pure"].contentId, true);
  assert.equal(lib["bgm-code-switch"].contentId, undefined);

  assert.equal(lib["bgm-code-switch"].source, "punch-deck");
  assert.equal(lib["bgm-code-switch"].url, "https://soundcloud.com/punch-deck/code-switch");
  assert.equal(lib["bgm-code-switch"].category, "cinematic");

  assert.equal(lib["fs-167829"].title, "Plastic Clicks");
  assert.equal(lib["fs-167829"].for, "A small plastic click");
  assert.equal(lib["fs-167829"].source, "freesound");
  assert.equal(lib["fs-167829"].origin, "real");
  assert.equal(lib["fs-167829"].category, "clicks");
  assert.equal(lib["fs-760337"].category, "foley");
});

test("syncSoundVaultPeaks invalidates cached peaks when WAV content changes at identical byte size", async (t) => {
  const { syncSoundVaultPeaks } = await import("../build_sound_vault.mjs");
  const dir = mkdtempSync(join(tmpdir(), "vault-peaks-mtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "sfx/hits"), { recursive: true });

  const makeWav = (amp) => {
    const samples = 400;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) data.writeInt16LE(amp, i * 2);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write("WAVE", 8);
    h.write("fmt ", 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(8000, 24);
    h.writeUInt32LE(16000, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write("data", 36);
    h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  };

  const wavPath = join(dir, "sfx/hits/punch.wav");
  writeFileSync(wavPath, makeWav(8192));
  assert.equal(syncSoundVaultPeaks(dir), 1);
  const firstPeak = JSON.parse(readFileSync(join(dir, "PEAKS.json"), "utf8")).punch.peaks[0];
  assert.ok(firstPeak > 0.2 && firstPeak < 0.3);

  writeFileSync(wavPath, makeWav(24576));
  const future = new Date(Date.now() + 5000);
  utimesSync(wavPath, future, future);

  assert.equal(syncSoundVaultPeaks(dir), 1);
  const secondPeak = JSON.parse(readFileSync(join(dir, "PEAKS.json"), "utf8")).punch.peaks[0];
  assert.ok(secondPeak > 0.7);
});

test("vault.mjs loads root .env defaults in-process from film subdirectories without spawning bun", (t) => {
  const { root } = fixture(t);
  writeFileSync(
    join(root, ".env"),
    [
      "# comment",
      "MC_BASE=from-base",
      "MC_QUOTED='single $MC_BASE'",
      'MC_EXPAND="hello ${MC_BASE}"',
      'MC_ESCAPED="literal \\$MC_BASE"',
      'MC_SLASH="\\\\$MC_BASE"',
      'MC_WIN_PATH="C:\\Users\\ADMIN\\vault"',
      "MC_SHELL_REF=$MC_EXISTING",
      "MC_CROSS_REF=$MC_DEV_ONLY",
      "MC_OVERRIDE=base-val",
      "MC_DEV_ONLY=base-dev",
      "MC_EMPTY_COMMENT= # inline comment",
      "MC_EXISTING=from-base-file",
    ].join("\n"),
  );
  writeFileSync(
    join(root, ".env.development"),
    "MC_OVERRIDE=dev-val\nMC_DEV_ONLY=dev-val\n",
  );
  writeFileSync(join(root, ".env.local"), "MC_OVERRIDE=local-val\nMC_EXISTING=from-file\n");
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `import { parseDotEnv } from "../../scripts/vault.mjs";
console.log(JSON.stringify({
  parsed: typeof parseDotEnv,
  base: process.env.MC_BASE,
  quoted: process.env.MC_QUOTED,
  expand: process.env.MC_EXPAND,
  escaped: process.env.MC_ESCAPED,
  slash: process.env.MC_SLASH,
  winPath: process.env.MC_WIN_PATH,
  shellRef: process.env.MC_SHELL_REF,
  crossRef: process.env.MC_CROSS_REF,
  override: process.env.MC_OVERRIDE,
  devOnly: process.env.MC_DEV_ONLY,
  emptyComment: process.env.MC_EMPTY_COMMENT,
  existing: process.env.MC_EXISTING,
  loaded: process.env.MC_ROOT_ENV_LOADED,
}));`,
    ],
    {
      cwd: join(root, "films/demo"),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, NODE_ENV: "development", MC_EXISTING: "already-set", PATH: "" },
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), {
    parsed: "function",
    base: "from-base",
    quoted: "single $MC_BASE",
    expand: "hello from-base",
    escaped: "literal $MC_BASE",
    slash: "\\from-base",
    winPath: "C:\\Users\\ADMIN\\vault",
    shellRef: "already-set",
    crossRef: "dev-val",
    override: "local-val",
    devOnly: "dev-val",
    emptyComment: "",
    existing: "already-set",
    loaded: root,
  });
});
