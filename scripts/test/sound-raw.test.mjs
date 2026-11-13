import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { strToU8, zipSync } from "fflate";

import { fetchSoundRaw } from "../fetch_sound_raw.mjs";
import { readTorrent, torrentPaths } from "../torrent.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// bencode, enough to write a test torrent
const benc = (v) =>
  typeof v === "number"
    ? Buffer.from(`i${v}e`)
    : Array.isArray(v)
      ? Buffer.concat([Buffer.from("l"), ...v.map(benc), Buffer.from("e")])
      : typeof v === "object" && !Buffer.isBuffer(v)
        ? Buffer.concat([
            Buffer.from("d"),
            ...Object.keys(v)
              .sort()
              .flatMap((k) => [benc(k), benc(v[k])]),
            Buffer.from("e"),
          ])
        : Buffer.concat([Buffer.from(`${Buffer.byteLength(v)}:`), Buffer.from(v)]);
const torrentOf = (files) => {
  const info = {
    name: "Sonniss.com - GDC 2016- Game Audio Bundle",
    "piece length": 16384,
    pieces: "x".repeat(20),
    files: files.map((path) => ({ length: 1, path })),
  };
  return {
    bytes: benc({ announce: "udp://t", info }),
    btih: createHash("sha1").update(benc(info)).digest("hex"),
  };
};

async function fixture(t, zips, packs) {
  const root = mkdtempSync(join(tmpdir(), "sound-raw-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const zip = zips[req.url.slice(1)];
    if (!zip) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.end(zip);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}/`;
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "downloads"));
  writeFileSync(
    join(root, "scripts/sound-raw.json"),
    JSON.stringify({
      sources: {
        kenney: {
          licence: "CC0 1.0",
          packs: packs.map((p) => (p.file ? { ...p, file: base + p.file } : p)),
        },
      },
    }),
  );
  const external = join(root, "ext");
  return {
    external,
    raw: join(external, "sound-raw"),
    downloads: join(root, "downloads"),
    requests: () => requests,
    fetch: () =>
      fetchSoundRaw({ root, external, downloads: join(root, "downloads"), log: () => {} }),
  };
}

test("each pack is unpacked from its pinned zip without the Mac metadata, and a second run downloads nothing", async (t) => {
  const zip = zipSync({
    "Audio/click.ogg": strToU8("ogg"),
    "__MACOSX/Audio/._click.ogg": strToU8("mac"),
    "License.txt": strToU8("CC0"),
  });
  const f = await fixture(t, { "ui.zip": zip }, [
    { id: "ui", title: "UI", file: "ui.zip", sha256: sha256(zip) },
  ]);
  const first = await f.fetch();
  assert.deepEqual(first.failed, []);
  assert.equal(readFileSync(join(f.raw, "kenney/ui/Audio/click.ogg"), "utf8"), "ogg");
  assert.equal(existsSync(join(f.raw, "kenney/ui/__MACOSX")), false);
  const asked = f.requests();
  await f.fetch();
  assert.equal(f.requests(), asked);
});

test("a zip that differs from its pinned sha256 is refused and nothing is unpacked", async (t) => {
  const zip = zipSync({ "a.ogg": strToU8("x") });
  const f = await fixture(t, { "a.zip": zip }, [
    { id: "a", title: "A", file: "a.zip", sha256: "0".repeat(64) },
  ]);
  const result = await f.fetch();
  assert.deepEqual(result.failed, ["a"]);
  assert.equal(existsSync(join(f.raw, "kenney/a")), false);
});

test("an entry that climbs out of its pack folder is refused", async (t) => {
  const zip = zipSync({ "../../escape.ogg": strToU8("x") });
  const f = await fixture(t, { "bad.zip": zip }, [
    { id: "bad", title: "Bad", file: "bad.zip", sha256: sha256(zip) },
  ]);
  const result = await f.fetch();
  assert.deepEqual(result.failed, ["bad"]);
  assert.equal(existsSync(join(f.raw, "escape.ogg")), false);
  assert.equal(existsSync(join(f.external, "escape.ogg")), false);
});

test("a pack the site only hands to a browser waits for its zip, then is taken from Downloads", async (t) => {
  const f = await fixture(t, {}, [
    {
      id: "impact-sounds",
      title: "Impact Sounds",
      page: "https://kenney.nl/assets/impact-sounds",
      byHand: "kenney_impact-sounds.zip",
    },
  ]);
  const before = await f.fetch();
  assert.equal(before.waiting.length, 1);
  assert.match(before.waiting[0], /kenney\.nl\/assets\/impact-sounds/);
  writeFileSync(
    join(f.downloads, "kenney_impact-sounds.zip"),
    zipSync({ "Audio/impactGlass_heavy_000.ogg": strToU8("ogg") }),
  );
  const after = await f.fetch();
  assert.deepEqual(after.waiting, []);
  assert.equal(
    existsSync(join(f.raw, "kenney/impact-sounds/Audio/impactGlass_heavy_000.ogg")),
    true,
  );
});

test("a torrent's files get paths Windows can write, inside the pack, each its own", () => {
  const long = `${"Crowd,Military,Army,Squad,Medium Distant,Light,Milling,".repeat(5)}end.wav`;
  const t = torrentOf([
    ["1964 Mercury Montclair ", "drive_03.wav"],
    ["Armored Car\t", "passby.wav"],
    ["Lib", long],
    ["Lib", "a:b.wav"],
    ["Lib", "a?b.wav"],
    ["Lib", "con.wav"],
    ["..", "escape.wav"],
  ]);
  const torrent = readTorrent(t.bytes);
  assert.equal(torrent.btih, t.btih);
  const paths = torrentPaths(torrent, 200);
  assert.deepEqual(
    paths.slice(0, 2).map(({ index, path }) => ({ index, path })),
    [
      { index: 1, path: "1964 Mercury Montclair/drive_03.wav" },
      { index: 2, path: "Armored Car_/passby.wav" },
    ],
  );
  assert.ok(paths[2].path.length <= 200 && paths[2].path.endsWith(".wav"), paths[2].path);
  assert.deepEqual(
    paths.slice(3).map((p) => p.path),
    ["Lib/a_b.wav", "Lib/a_b (2).wav", "Lib/_con.wav", "_/escape.wav"],
  );
});

test("a torrent pack waits for its .torrent, refuses another torrent, and is done once the client wrote every file", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sound-raw-torrent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const external = join(root, "ext"),
    downloads = join(root, "downloads");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(downloads);
  const good = torrentOf([["Lib ", "hit.wav"]]);
  const pack = {
    id: "gdc-2016",
    title: "GDC 2016",
    page: "https://sonniss.com/gameaudiogdc/",
    torrent: "GameAudioGDCPart2.torrent",
    btih: good.btih,
  };
  writeFileSync(
    join(root, "scripts/sound-raw.json"),
    JSON.stringify({ sources: { sonniss: { licence: "Sonniss GDC", packs: [pack] } } }),
  );
  const runs = [];
  const fetch = () =>
    fetchSoundRaw({
      root,
      external,
      downloads,
      log: () => {},
      torrentClient: async (input) => {
        runs.push(readFileSync(input, "utf8"));
        const dir = join(external, "sound-raw/sonniss/gdc-2016/Lib");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "hit.wav"), "x");
        return 0;
      },
    });
  const waiting = await fetch();
  assert.match(waiting.waiting[0], /GameAudioGDCPart2\.torrent/);
  assert.equal(runs.length, 0);

  writeFileSync(join(downloads, "GameAudioGDCPart2.torrent"), torrentOf([["x", "y.wav"]]).bytes);
  assert.deepEqual((await fetch()).failed, ["gdc-2016"]);
  assert.equal(runs.length, 0);

  writeFileSync(join(downloads, "GameAudioGDCPart2.torrent"), good.bytes);
  const done = await fetch();
  assert.deepEqual(done.unpacked, ["gdc-2016"]);
  assert.match(runs[0], /index-out=1=Lib\/hit\.wav/);
  assert.equal(existsSync(join(external, "sound-raw/sonniss/gdc-2016/.pack.json")), true);
  await fetch();
  assert.equal(runs.length, 1, "a finished pack is not handed to the client again");
});

test("a torrent pack is marked done as soon as its own download ends, while another still runs", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sound-raw-torrents-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const external = join(root, "ext"),
    downloads = join(root, "downloads"),
    raw = join(external, "sound-raw/sonniss");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(downloads);
  const packs = ["gdc-2015", "gdc-2016"].map((id) => {
    const t = torrentOf([[id, "hit.wav"]]);
    writeFileSync(join(downloads, `${id}.torrent`), t.bytes);
    return { id, title: id, page: "https://sonniss.com/", torrent: `${id}.torrent`, btih: t.btih };
  });
  writeFileSync(
    join(root, "scripts/sound-raw.json"),
    JSON.stringify({ sources: { sonniss: { licence: "Sonniss GDC", packs } } }),
  );
  const runs = [];
  let early = false;
  const r = await fetchSoundRaw({
    root,
    external,
    downloads,
    log: () => {},
    torrentClient: async (input) => {
      const text = readFileSync(input, "utf8");
      runs.push(text);
      const id = text.includes("gdc-2016") ? "gdc-2016" : "gdc-2015";
      if (id === "gdc-2016")
        for (let i = 0; i < 40 && !early; i++) {
          early = existsSync(join(raw, "gdc-2015/.pack.json"));
          await new Promise((done) => setTimeout(done, 25));
        }
      mkdirSync(join(raw, id, id), { recursive: true });
      writeFileSync(join(raw, id, id, "hit.wav"), "x");
      return 0;
    },
  });
  assert.deepEqual(new Set(r.unpacked), new Set(["gdc-2015", "gdc-2016"]));
  assert.equal(runs.length, 2, "one client run per pack");
  assert.equal(early, true, "2015 was marked while 2016 still ran");
});

// An .ogg tone at the given peak level (dBFS), made with ffmpeg
const tone = (file, db, hz = 660, seconds = 0.2) => {
  mkdirSync(join(file, ".."), { recursive: true });
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i"].concat([
      `aevalsrc=${10 ** (db / 20)}*sin(2*PI*${hz}*t):s=44100:d=${seconds}`,
      "-c:a",
      "libvorbis",
      file,
    ]),
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
};

async function packFixture(t, sort) {
  const root = mkdtempSync(join(tmpdir(), "sound-raw-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const local = join(root, "vault"),
    external = join(root, "ext"),
    pack = join(external, "sound-raw/kenney/ui");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/sfx-catalogue.json"), JSON.stringify({ sounds: [] }));
  const write = (rules, source = {}) =>
    writeFileSync(
      join(root, "scripts/sound-raw.json"),
      JSON.stringify({
        sources: {
          kenney: {
            licence: "CC0 1.0",
            prefix: "ken",
            skip: "(^|/)Preview[^/]*$",
            ...source,
            packs: [
              { id: "ui", key: "ui", title: "UI", page: "https://kenney.nl/ui", sort: rules },
            ],
          },
        },
      }),
    );
  write(sort);
  // takes of one sound (one quiet), a lone sound, one the rules leave out, and the pack's preview
  tone(join(pack, "Audio/click_001.ogg"), -3);
  tone(join(pack, "Audio/click_002.ogg"), -30, 880);
  tone(join(pack, "Audio/error_001.ogg"), -3, 220);
  tone(join(pack, "Audio/mystery_001.ogg"), -3);
  tone(join(pack, "Audio/round_1.ogg"), -3);
  tone(join(pack, "Audio/round_2.ogg"), -3);
  tone(join(pack, "Preview.ogg"), -3);
  writeFileSync(join(pack, ".pack.json"), "{}");
  const { buildSoundVault } = await import("../build_sound_vault.mjs");
  const lines = [];
  const build = () =>
    buildSoundVault({
      root,
      local,
      external,
      skipBgm: true,
      skipEarshot: true,
      skipFreesound: true,
      log: (l) => lines.push(l),
    });
  const sources = () => JSON.parse(readFileSync(join(local, "sound/SOURCES.json"), "utf8"));
  return { pack, local, write, build, sources, lines };
}

const RULES = [
  { match: "/click_", category: "clicks", for: "a UI click" },
  { match: "/error_", category: "notifications", title: "{name} beep", for: "a UI error" },
];

test("a raw pack's sounds are filed by its sort rules, as one family of takes, at -1 dBFS", async (t) => {
  const f = await packFixture(t, RULES);
  await f.build();
  const s = f.sources();
  const takes = Object.entries(s).filter(([, v]) => v.family === "ken-ui-click");
  assert.deepEqual(
    takes.map(([name, v]) => [name, v.variant, v.title]),
    [
      ["ken-ui-click-001", 1, "Click"],
      ["ken-ui-click-002", 2, "Click"],
    ],
  );
  assert.deepEqual(s["ken-ui-error-001"], {
    title: "Error beep",
    license: "CC0 1.0",
    url: "https://kenney.nl/ui",
    for: "a UI error",
    source: "kenney",
    kind: "sfx",
    origin: "real",
    pack: "kenney/ui",
  });
  assert.equal(existsSync(join(f.local, "sound/sfx/clicks/ken-ui-click-002.wav")), true);
  assert.equal(existsSync(join(f.local, "sound/sfx/notifications/ken-ui-error-001.wav")), true);
  const { wavPeaks } = await import("../../packages/live-studio/src/sound.mjs");
  const quiet = Math.max(...wavPeaks(join(f.local, "sound/sfx/clicks/ken-ui-click-002.wav")).peaks);
  assert.ok(quiet > 0.8 && quiet < 0.92, `a quiet take is brought up to -1 dBFS, got ${quiet}`);
  assert.equal(
    Object.keys(s).some((n) => n.includes("mystery") || n.includes("preview")),
    false,
  );
  assert.ok(
    f.lines.some((l) => /mystery_001\.ogg/.test(l)),
    "a file no rule takes is named",
  );
});

test("a rule whose numbers name different lines keeps each file its own sound", async (t) => {
  const f = await packFixture(t, [
    { match: "/round_", category: "voices", takes: false, for: "an announcer" },
    { match: "^Female/", category: "voices", takes: false, title: "{name} · female" },
    { match: "^Male/", category: "voices", takes: false, title: "{name} · male" },
  ]);
  tone(join(f.pack, "Female/go.ogg"), -3);
  tone(join(f.pack, "Male/go.ogg"), -3);
  await f.build();
  const s = f.sources();
  assert.deepEqual(
    ["ken-ui-round-1", "ken-ui-round-2", "ken-ui-female-go", "ken-ui-male-go"].map((n) => [
      s[n]?.title,
      s[n]?.family,
    ]),
    [
      ["Round 1", undefined],
      ["Round 2", undefined],
      ["Go · female", undefined],
      ["Go · male", undefined],
    ],
  );
});

test("a source's sort rules file every pack's sounds its own rules leave", async (t) => {
  const f = await packFixture(t, RULES);
  f.write(RULES, {
    sort: [
      { match: "/click_", category: "foley", for: "never: the pack's rule comes first" },
      { match: "/mystery_", category: "foley", for: "a mystery" },
    ],
  });
  await f.build();
  const s = f.sources();
  assert.equal(existsSync(join(f.local, "sound/sfx/clicks/ken-ui-click-001.wav")), true);
  assert.equal(s["ken-ui-click-001"].for, "a UI click");
  assert.equal(s["ken-ui-mystery-001"].for, "a mystery");
  assert.equal(existsSync(join(f.local, "sound/sfx/foley/ken-ui-mystery-001.wav")), true);
});

test("a file's own name picks its rule before its folder's name does", async (t) => {
  const f = await packFixture(t, RULES);
  tone(join(f.pack, "Hits & Whooshes/metal slam_01.ogg"), -3);
  tone(join(f.pack, "Hits & Whooshes/thing_01.ogg"), -3);
  f.write([
    ...RULES,
    { match: "(?i:whoosh)", category: "transitions", for: "a whoosh" },
    { match: "(?i:slam)", category: "impacts", for: "a slam" },
  ]);
  await f.build();
  const s = f.sources();
  assert.equal(s["ken-ui-metal-slam-01"]?.for, "a slam");
  assert.equal(s["ken-ui-thing-01"]?.for, "a whoosh");
});

test("a sound longer than its source's maxSeconds is left out and counted, unless its rule allows it", async (t) => {
  const f = await packFixture(t, RULES);
  tone(join(f.pack, "Audio/drone_001.ogg"), -3, 110, 3);
  tone(join(f.pack, "Audio/rumble_001.ogg"), -3, 80, 3);
  f.write(
    [
      ...RULES,
      { match: "/drone_", category: "sci-fi", for: "a drone" },
      { match: "/rumble_", category: "impacts", maxSeconds: 5, for: "a rumble" },
    ],
    { maxSeconds: 1 },
  );
  await f.build();
  const s = f.sources();
  assert.equal(s["ken-ui-drone-001"], undefined);
  assert.equal(existsSync(join(f.local, "sound/sfx/sci-fi/ken-ui-drone-001.wav")), false);
  assert.equal(s["ken-ui-rumble-001"]?.for, "a rumble");
  assert.equal(s["ken-ui-click-001"]?.for, "a UI click");
  assert.ok(
    f.lines.some((l) => /kenney\/ui: 1 files? longer than its limit left out/.test(l)),
    f.lines.join("\n"),
  );
});

test("a pack still downloading is left alone until fetch:sound-raw marks it done", async (t) => {
  const f = await packFixture(t, RULES);
  rmSync(join(f.pack, ".pack.json"));
  await f.build();
  assert.equal(f.sources()["ken-ui-error-001"], undefined);
  assert.ok(f.lines.some((l) => /kenney\/ui: not downloaded yet/.test(l)));
});

test("a sound the pack's rules stop taking leaves the vault on the next build", async (t) => {
  const f = await packFixture(t, RULES);
  await f.build();
  f.write(RULES.slice(0, 1));
  await f.build();
  assert.equal(f.sources()["ken-ui-error-001"], undefined);
  assert.equal(existsSync(join(f.local, "sound/sfx/notifications/ken-ui-error-001.wav")), false);
  assert.equal(existsSync(join(f.local, "sound/sfx/clicks/ken-ui-click-001.wav")), true);
});
