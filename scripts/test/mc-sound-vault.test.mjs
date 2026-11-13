import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { strToU8, zipSync } from "fflate";

import { buildMcSoundVault, classifyMcSound, formatMcTitle } from "../build_mc_sound_vault.mjs";

const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

function makeOgg(dir, name, freq, durationSec) {
  const out = join(dir, name);
  const res = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:sample_rate=44100:duration=${durationSec}`,
      "-af",
      "volume=12dB",
      "-c:a",
      "libvorbis",
      out,
    ],
    { encoding: "utf8" },
  );
  assert.equal(res.status, 0, res.stderr);
  return readFileSync(out);
}

describe("formatMcTitle & classifyMcSound", () => {
  test("strips lone trailing singleton digits while preserving weapon/model numbers and deduplicating identical action segments", () => {
    assert.equal(formatMcTitle("step/stone"), "Stone · Step");
    assert.equal(formatMcTitle("dig/dig"), "Dig");
    assert.equal(
      formatMcTitle("mob/allay/item_thrown1", { stripSingleDigit: true }),
      "Allay · Item Thrown",
    );
    assert.equal(
      formatMcTitle("item/cave_book/book_close_0", { stripSingleDigit: true }),
      "Cave Book · Close",
    );
    assert.equal(formatMcTitle("bluntwood/bluntwood_walk"), "Bluntwood · Walk");
    assert.equal(formatMcTitle("gun/m4a1", { stripSingleDigit: true }), "Gun · M4a1");
    assert.equal(formatMcTitle("gun/ak47", { stripSingleDigit: true }), "Gun · Ak47");
  });

  test("classifies Vanilla and modded paths into the 8 filmmaker categories", () => {
    assert.equal(classifyMcSound("minecraft", "ambient/cave/cave1"), "horror");
    assert.equal(classifyMcSound("willows-horror", "whisper"), "horror");
    assert.equal(classifyMcSound("minecraft", "step/stone1"), "footsteps");
    assert.equal(classifyMcSound("presence-footsteps", "bluntwood/walk1"), "footsteps");
    assert.equal(classifyMcSound("minecraft", "damage/hit1"), "combat");
    assert.equal(classifyMcSound("minecraft", "weather/rain1"), "ambience");
    assert.equal(classifyMcSound("minecraft", "mob/zombie/say1"), "mobs");
    assert.equal(classifyMcSound("extrasounds", "inventory/click"), "magic");
    assert.equal(classifyMcSound("minecraft", "item/spyglass/use"), "items");
    assert.equal(classifyMcSound("minecraft", "block/chest/open"), "blocks");
  });

  test("keeps Blocks for blocks: vehicles, machines and stray effects get their own home", () => {
    const cases = [
      ["minecraft", "minecart/base", "vehicles"],
      ["minecraft", "entity/boat/paddle_water1", "vehicles"],
      ["immersive-aircraft", "propeller_small", "vehicles"],
      ["immersive-aircraft", "warship", "vehicles"],
      ["alexs-caves", "misc/submarine/submarine_hit_3", "vehicles"],
      ["create-nuclear", "geiger/high", "machines"],
      ["create-nuclear", "reactor/running", "machines"],
      ["security-craft", "camerasnap", "machines"],
      ["alexs-caves", "misc/nuclear_siren", "machines"],
      ["alexs-caves", "misc/dark_cloud/dark_cloud_appear_0", "magic"],
      ["minecraft", "random/orb", "magic"],
      ["minecraft", "random/fuse", "combat"],
      ["minecraft", "random/successful_hit", "combat"],
      ["minecraft", "event/raid/raidhorn", "combat"],
      ["minecraft", "random/splash", "ambience"],
      ["cluttered", "polaroid_flash", "items"],
      ["minecraft", "tile/piston/in", "blocks"],
      ["dusty-decorations", "copper_light_on", "blocks"],
    ];
    assert.deepEqual(
      cases.map(([source, path]) => [source, path, classifyMcSound(source, path)]),
      cases,
    );
  });
});

test("buildMcSoundVault materializes a fresh machine from mc-sound-packs.json + Mojang CDN, verifies pack SHA1, preserves CC-BY credits, and avoids multi-namespace family collisions", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mc-sound-fresh-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const tmpAudio = join(root, "tmp-audio");
  mkdirSync(tmpAudio, { recursive: true });
  const stone1 = makeOgg(tmpAudio, "stone1.ogg", 330, 0.22);
  const stone2 = makeOgg(tmpAudio, "stone2.ogg", 370, 0.25);
  const chestOpen = makeOgg(tmpAudio, "chest.ogg", 520, 0.4);
  const c418Music = makeOgg(tmpAudio, "calm1.ogg", 220, 1.0);
  const rain1 = makeOgg(tmpAudio, "rain1.ogg", 180, 0.5);
  const bossBgm = makeOgg(tmpAudio, "boss.ogg", 440, 1.2);

  const stone1Hash = sha1(stone1);
  const stone2Hash = sha1(stone2);
  const chestHash = sha1(chestOpen);
  const musicHash = sha1(c418Music);

  // Put stone1 in local .minecraft cache; stone2 + chestOpen come from CDN
  const mcAssetsDir = join(root, "dot-minecraft/assets");
  mkdirSync(join(mcAssetsDir, "objects", stone1Hash.slice(0, 2)), { recursive: true });
  writeFileSync(join(mcAssetsDir, "objects", stone1Hash.slice(0, 2), stone1Hash), stone1);

  const pfJar = Buffer.from(
    zipSync({
      "assets/presencefootsteps/sounds/bluntwood/bluntwood_walk1.ogg": stone1,
      "assets/presencefootsteps/sounds/bluntwood/bluntwood_walk2.ogg": stone2,
      "assets/presencefootstepsmono/sounds/bluntwood/bluntwood_walk1.ogg": stone1,
      // Second namespace inside same pack with identical dir/base -> must get distinct family slug!
      "assets/pf_extra/sounds/bluntwood/bluntwood_walk1.ogg": stone1,
      "assets/pf_extra/sounds/bluntwood/bluntwood_walk2.ogg": stone2,
    }),
  );
  const weatherZip = Buffer.from(
    zipSync({
      "assets/minecraft/sounds/weather/gentle_rain_1.ogg": rain1,
    }),
  );
  const witherJar = Buffer.from(
    zipSync({
      "assets/cwsm_soundtrack__vsides/sounds/beginning_of_the_end.ogg": bossBgm,
    }),
  );

  const cdnObjects = new Map([
    [`/${stone2Hash.slice(0, 2)}/${stone2Hash}`, stone2],
    [`/${chestHash.slice(0, 2)}/${chestHash}`, chestOpen],
    [`/${musicHash.slice(0, 2)}/${musicHash}`, c418Music],
    ["/packs/presence-footsteps.jar", pfJar],
    ["/packs/gentler-weather-sounds.zip", weatherZip],
    ["/packs/crackers-wither-storm-mod-v-sides-soundtrack.jar", witherJar],
  ]);

  const fetchedPaths = [];
  const server = createServer((req, res) => {
    fetchedPaths.push(req.url);
    if (req.url === "/26.3.json") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          assetIndex: { id: "34", url: `http://127.0.0.1:${server.address().port}/34.json` },
        }),
      );
      return;
    }
    if (req.url === "/34.json") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          objects: {
            "minecraft/sounds/step/stone1.ogg": { hash: stone1Hash, size: stone1.length },
            "minecraft/sounds/step/stone2.ogg": { hash: stone2Hash, size: stone2.length },
            "minecraft/sounds/block/chest/open.ogg": { hash: chestHash, size: chestOpen.length },
            "minecraft/sounds/music/game/calm1.ogg": { hash: musicHash, size: c418Music.length },
          },
        }),
      );
      return;
    }
    const obj = cdnObjects.get(req.url);
    if (obj) {
      res.end(obj);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts/vault-assets.json"),
    JSON.stringify({ minecraft: { version: "26.3", metadata: `${baseUrl}/26.3.json` } }),
  );
  writeFileSync(
    join(root, "scripts/mc-sound-packs.json"),
    JSON.stringify({
      packs: [
        {
          file: "presence-footsteps.jar",
          source: "presence-footsteps",
          title: "Presence Footsteps",
          license: "Polyform-Shield-1.0",
          url: "https://modrinth.com/mod/presence-footsteps",
          downloadUrl: `${baseUrl}/packs/presence-footsteps.jar`,
          sha1: sha1(pfJar),
        },
        {
          file: "gentler-weather-sounds.zip",
          source: "gentler-weather-sounds",
          title: "Gentler Weather Sounds",
          license: "Apache-2.0 / CC-BY-4.0",
          credits: "bone666138, Soundrack (Freesound CC BY 4.0)",
          url: "https://modrinth.com/resourcepack/gentler-weather-sounds",
          downloadUrl: `${baseUrl}/packs/gentler-weather-sounds.zip`,
          sha1: sha1(weatherZip),
        },
        {
          file: "crackers-wither-storm-mod-v-sides-soundtrack.jar",
          source: "wither-storm",
          title: "Cracker's Wither Storm Mod: V-Sides Soundtrack",
          license: "MIT",
          url: "https://modrinth.com/mod/crackers-wither-storm-mod-v-sides-soundtrack",
          downloadUrl: `${baseUrl}/packs/crackers-wither-storm-mod-v-sides-soundtrack.jar`,
          sha1: sha1(witherJar),
        },
      ],
    }),
  );

  // Fresh external vault with ZERO pre-downloaded packs!
  const external = join(root, "external");
  const summary = await buildMcSoundVault({
    root,
    external,
    mcAssetsDir,
    resourcesBaseUrl: baseUrl,
  });

  assert.equal(fetchedPaths.includes(`/${stone1Hash.slice(0, 2)}/${stone1Hash}`), false);
  assert.equal(fetchedPaths.includes(`/${stone2Hash.slice(0, 2)}/${stone2Hash}`), true);
  assert.equal(fetchedPaths.includes(`/${musicHash.slice(0, 2)}/${musicHash}`), false);
  assert.equal(existsSync(join(external, "packs/presence-footsteps.jar")), true);

  // 3 vanilla + 4 pf (2 namespaces * 2 variants) + 1 weather + 1 wither-storm = 9
  assert.equal(summary.total, 9);
  const outDir = join(external, "mc-sound");
  const sources = JSON.parse(readFileSync(join(outDir, "SOURCES.json"), "utf8"));
  assert.equal(Object.keys(sources).length, 9);

  // Multi-namespace families inside the same pack get distinct family slugs
  const pfFamilies = new Set(
    Object.values(sources)
      .filter((s) => s.source === "presence-footsteps")
      .map((s) => s.family),
  );
  assert.equal(pfFamilies.size, 2);

  // Singleton trailing "_1" stripped from human title; CC-BY-4.0 attribution preserved
  const rainEntry = sources["mc-gentler-weather-sounds-weather-gentle-rain-1"];
  assert.equal(rainEntry.title, "Weather · Gentle Rain");
  assert.equal(rainEntry.license, "Apache-2.0 / CC-BY-4.0");
  assert.match(rainEntry.for, /bone666138/);

  // Precomputed PEAKS.json has accurate durations and normalized 0..1 peak arrays
  const peaks = JSON.parse(readFileSync(join(outDir, "PEAKS.json"), "utf8"));
  assert.ok(Math.abs(peaks["mc-step-stone-1"].seconds - 0.22) < 0.08);
  assert.ok(peaks["mc-step-stone-1"].peaks.some((p) => p > 0.2));
});

test("buildMcSoundVault fallback strictly excludes asset-restricted packs (eerie-the-horror-soundpack, betterend, betternether, superb-warfare)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mc-sound-restricted-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tmpAudio = join(root, "tmp-audio");
  mkdirSync(tmpAudio, { recursive: true });
  const tone = makeOgg(tmpAudio, "tone.ogg", 440, 0.2);

  mkdirSync(join(root, "scripts"), { recursive: true });
  const cacheDir = join(root, "external/mc-sound/.cache");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(root, "scripts/vault-assets.json"),
    JSON.stringify({ minecraft: { version: "26.3", metadata: "http://127.0.0.1:1/unused" } }),
  );
  writeFileSync(join(cacheDir, "version-26.3.json"), JSON.stringify({ assetIndex: { id: "34" } }));
  writeFileSync(join(cacheDir, "asset-index-34.json"), JSON.stringify({ objects: {} }));

  const external = join(root, "external");
  mkdirSync(join(external, "packs"), { recursive: true });
  mkdirSync(join(external, "tools"), { recursive: true });
  for (const bad of [
    "eerie-the-horror-soundpack.zip",
    "betterend.jar",
    "betternether.jar",
    "superb-warfare.jar",
  ]) {
    writeFileSync(
      join(external, "packs", bad),
      zipSync({
        "assets/bad/sounds/restricted.ogg": tone,
        "pack.mcmeta": strToU8("{}"),
      }),
    );
  }
  writeFileSync(
    join(external, "packs/immersivethunder.jar"),
    zipSync({ "assets/immersivethunder/sounds/thunder_1.ogg": tone }),
  );
  writeFileSync(
    join(external, "tools/triage_result.json"),
    JSON.stringify({
      "eerie-the-horror-soundpack.zip": { verdict: "keep" },
      "betterend.jar": { verdict: "keep" },
      "betternether.jar": { verdict: "keep" },
      "superb-warfare.jar": { verdict: "keep" },
      "immersivethunder.jar": { verdict: "keep" },
    }),
  );
  writeFileSync(
    join(external, "packs_index.json"),
    JSON.stringify({
      "immersivethunder.jar": {
        title: "ImmersiveThunder",
        slug: "immersivethunder",
        license: { id: "MIT" },
      },
    }),
  );

  const summary = await buildMcSoundVault({
    root,
    external,
    mcAssetsDir: join(root, "empty-mc-assets"),
    skipPeaks: true,
  });
  assert.equal(summary.total, 1);
  const sources = JSON.parse(readFileSync(join(external, "mc-sound/SOURCES.json"), "utf8"));
  assert.deepEqual(Object.keys(sources), ["mc-immersivethunder-thunder-1"]);
});

test("buildMcSoundVault folds an unnumbered take (cricket.ogg beside cricket2.ogg, cricket3.ogg) into its family as take #1", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mc-sound-unnumbered-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tmpAudio = join(root, "tmp-audio");
  mkdirSync(tmpAudio, { recursive: true });
  const tone = makeOgg(tmpAudio, "tone.ogg", 440, 0.2);

  mkdirSync(join(root, "scripts"), { recursive: true });
  const cacheDir = join(root, "external/mc-sound/.cache");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(root, "scripts/vault-assets.json"),
    JSON.stringify({ minecraft: { version: "26.3", metadata: "http://127.0.0.1:1/unused" } }),
  );
  writeFileSync(join(cacheDir, "version-26.3.json"), JSON.stringify({ assetIndex: { id: "34" } }));
  writeFileSync(join(cacheDir, "asset-index-34.json"), JSON.stringify({ objects: {} }));

  const external = join(root, "external");
  mkdirSync(join(external, "packs"), { recursive: true });
  mkdirSync(join(external, "tools"), { recursive: true });
  writeFileSync(
    join(external, "packs/ambientsounds.jar"),
    zipSync({
      "assets/ambientsounds/sounds/animals/cricket/cricket.ogg": tone,
      "assets/ambientsounds/sounds/animals/cricket/cricket2.ogg": tone,
      "assets/ambientsounds/sounds/animals/cricket/cricket3.ogg": tone,
    }),
  );
  writeFileSync(
    join(external, "tools/triage_result.json"),
    JSON.stringify({ "ambientsounds.jar": { verdict: "keep" } }),
  );
  writeFileSync(
    join(external, "packs_index.json"),
    JSON.stringify({ "ambientsounds.jar": { slug: "ambientsounds", license: { id: "MIT" } } }),
  );

  await buildMcSoundVault({
    root,
    external,
    mcAssetsDir: join(root, "empty-mc-assets"),
    skipPeaks: true,
  });
  const sources = JSON.parse(readFileSync(join(external, "mc-sound/SOURCES.json"), "utf8"));
  const takes = Object.entries(sources)
    .map(([name, s]) => ({
      name,
      family: s.family,
      variant: s.variant,
      path: s.for.match(/\(([^)]+)\)/)[1],
    }))
    .sort((a, b) => a.variant - b.variant);
  assert.deepEqual(
    takes.map((x) => [x.family, x.variant, x.path]),
    [
      ["mc-ambientsounds-animals-cricket", 1, "ambientsounds:animals/cricket/cricket"],
      ["mc-ambientsounds-animals-cricket", 2, "ambientsounds:animals/cricket/cricket2"],
      ["mc-ambientsounds-animals-cricket", 3, "ambientsounds:animals/cricket/cricket3"],
    ],
  );
  const families = new Set(takes.map((x) => x.family));
  assert.equal(
    takes.some((x) => families.has(x.name)),
    false,
  );
});

test("buildMcSoundVault writes what the game's subtitles say a sound is into its text, so words search finds a hiss by 'hisses'", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mc-sound-captions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tmp-audio"), { recursive: true });
  const tone = makeOgg(join(root, "tmp-audio"), "tone.ogg", 440, 0.2);

  const cacheDir = join(root, "external/mc-sound/.cache");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts/vault-assets.json"),
    JSON.stringify({ minecraft: { version: "26.3", metadata: "http://127.0.0.1:1/unused" } }),
  );
  writeFileSync(join(cacheDir, "version-26.3.json"), JSON.stringify({ assetIndex: { id: "34" } }));
  writeFileSync(join(cacheDir, "asset-index-34.json"), JSON.stringify({ objects: {} }));
  const clientJar = join(root, "client.jar");
  writeFileSync(
    clientJar,
    zipSync({
      "assets/minecraft/lang/en_us.json": strToU8(
        JSON.stringify({ "subtitles.entity.creeper.primed": "Creeper hisses" }),
      ),
    }),
  );

  const external = join(root, "external");
  mkdirSync(join(external, "packs"), { recursive: true });
  mkdirSync(join(external, "tools"), { recursive: true });
  writeFileSync(
    join(external, "packs/spooky.jar"),
    zipSync({
      "assets/spooky/sounds/fuse.ogg": tone,
      "assets/spooky/sounds/bell.ogg": tone,
      "assets/spooky/sounds.json": strToU8(
        JSON.stringify({
          "creeper.fuse": { subtitle: "subtitles.entity.creeper.primed", sounds: ["fuse"] },
          "tnt.fuse": { subtitle: "subtitles.spooky.tnt", sounds: [{ name: "spooky:fuse" }] },
          "bell.toll": {
            subtitle: "subtitles.spooky.bell",
            sounds: ["bell", { name: "creeper.fuse", type: "event" }],
          },
        }),
      ),
      "assets/spooky/lang/en_us.json": strToU8(
        JSON.stringify({
          "subtitles.spooky.tnt": "TNT fizzes",
          "subtitles.spooky.bell": "Bell tolls",
        }),
      ),
    }),
  );
  writeFileSync(
    join(external, "tools/triage_result.json"),
    JSON.stringify({ "spooky.jar": { verdict: "keep" } }),
  );
  writeFileSync(
    join(external, "packs_index.json"),
    JSON.stringify({ "spooky.jar": { slug: "spooky", license: { id: "MIT" } } }),
  );

  await buildMcSoundVault({
    root,
    external,
    mcAssetsDir: join(root, "empty-mc-assets"),
    clientJar,
    skipPeaks: true,
  });
  const sources = Object.values(
    JSON.parse(readFileSync(join(external, "mc-sound/SOURCES.json"), "utf8")),
  );
  const textOf = (path) => sources.find((s) => s.for.includes(`(${path})`))?.for ?? "";
  assert.match(textOf("spooky:fuse"), /Creeper hisses/);
  assert.match(textOf("spooky:fuse"), /TNT fizzes/);
  assert.match(textOf("spooky:bell"), /Bell tolls/);
  assert.doesNotMatch(textOf("spooky:bell"), /hisses/);
  assert.deepEqual(sources.find((s) => s.for.includes("(spooky:bell)"))?.heard, ["Bell tolls"]);
});
