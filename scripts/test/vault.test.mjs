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
    "external/motion",
    "external/packs",
    "external/tools",
    "external/mc-sound",
    "films/demo/assets/public",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["link.ts", "vault.mjs"])
    if (existsSync(join(scripts, file)))
      copyFileSync(join(scripts, file), join(root, "scripts", file));
  // every script's --help and option check (packages/live-studio/src/cli.mjs)
  mkdirSync(join(root, "packages/live-studio/src"), { recursive: true });
  copyFileSync(
    join(scripts, "../packages/live-studio/src/cli.mjs"),
    join(root, "packages/live-studio/src/cli.mjs"),
  );
  writeFileSync(
    join(root, "vault.json"),
    JSON.stringify({
      root: "./vault",
      externalRoot: "./external",
      external: ["motion", "packs", "tools", "mc-sound"],
      film_links: { mc: "jar", motion: "motion" },
    }),
  );
  writeFileSync(join(root, "vault/jar/model.txt"), "local");
  writeFileSync(join(root, "external/motion/clip.txt"), "external");
  writeFileSync(join(root, "external/mc-sound/SOURCES.json"), "{}");
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

test("link resolves local light assets and external motion, and can run again", (t) => {
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
      "external",
    );
    assert.equal(readFileSync(join(root, "vault/mc-sound/SOURCES.json"), "utf8"), "{}");
  }
  assert.equal(lstatSync(join(root, "vault")).isSymbolicLink(), false);
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
  // Second call verifies cached client_assets.zip without failing; corrupting it triggers a clear error
  slimJar({ mcDir });
  writeFileSync(join(mcDir, "client_assets.zip"), "corrupted");
  assert.throws(() => slimJar({ mcDir }), /Corrupt/);
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
  mkdirSync(join(external, "tools/earshot/earshot/forge/bank"), { recursive: true });
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
    join(external, "tools/earshot/earshot/forge/bank/fit.json"),
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

  await buildSoundVault({ root, local, external, skipEarshot: true, pixabayDir });

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

  // Verify live-studio openSound().library() reads all metadata & categories cleanly
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

  // Overwrite with same byte length (844 bytes) at a newer mtime and higher amplitude
  writeFileSync(wavPath, makeWav(24576));
  const future = new Date(Date.now() + 5000);
  utimesSync(wavPath, future, future);

  assert.equal(syncSoundVaultPeaks(dir), 1);
  const secondPeak = JSON.parse(readFileSync(join(dir, "PEAKS.json"), "utf8")).punch.peaks[0];
  assert.ok(secondPeak > 0.7);
});
