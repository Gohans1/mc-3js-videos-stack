import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(REPO, "scripts/sound/get_sfx.py");

function runCli(args, { cwd = REPO, env = {} } = {}) {
  return spawnSync("python", [SCRIPT, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function runCliAsync(args, { cwd = REPO, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [SCRIPT, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function makeTempFilm(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-get-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "scene.ts"), "export {};\n", "utf8");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

function makeMp3Buffer(dir, filename, filterOrInputArgs) {
  const out = path.join(dir, filename);
  const res = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", ...filterOrInputArgs, "-c:a", "libmp3lame", "-b:a", "128k", out],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg fixture failed: ${res.stderr}`);
  }
  return fs.readFileSync(out);
}

function readWavInfo(wavPath) {
  const buf = fs.readFileSync(wavPath);
  assert.ok(buf.length >= 44, `wav too short: ${buf.length}`);
  assert.equal(buf.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buf.subarray(8, 12).toString("ascii"), "WAVE");

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.subarray(offset, offset + 4).toString("ascii");
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataStart = body;
      dataSize = Math.min(size, Math.max(0, buf.length - body));
      break;
    }
    offset = body + size + (size & 1);
  }
  assert.ok(dataStart >= 44, "missing data chunk");
  const bytesPerFrame = (bitsPerSample / 8) * channels;
  const frames = bytesPerFrame > 0 ? Math.floor(dataSize / bytesPerFrame) : 0;
  const samples = new Int16Array(Math.floor(dataSize / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = buf.readInt16LE(dataStart + i * 2);
  }
  return { channels, sampleRate, bitsPerSample, frames, samples };
}

async function startMockFreesound(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  );
  const addr = server.address();
  return `http://127.0.0.1:${addr.port}`;
}

test("cached SFX are reprocessed when trim or channel settings change, reusing the raw download", async (t) => {
  const dir = makeTempFilm(t);
  const mp3 = makeMp3Buffer(dir, "source.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
  ]);
  let downloads = 0;
  const base = await startMockFreesound(t, (req, res) => {
    if (req.url.startsWith("/previews/")) {
      downloads++;
      res.end(mp3);
    } else {
      res.end(`<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>
        <meta property="og:audio:artist" content="Fixture author">
        <div data-title="Fixture sound" data-mp3="${base}/previews/123-hq.mp3"></div>`);
    }
  });
  for (const settings of [{ keep: 0.2 }, { keep: 0.5 }, { keep: 0.5, music: true }]) {
    fs.mkdirSync(path.join(dir, "sound"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "sound/sfx_list.json"),
      JSON.stringify({ tap: { id: 123, for: "test cue", ...settings } }),
    );
    const r = await runCliAsync([], { cwd: dir, env: { FREESOUND_BASE: base } });
    assert.equal(r.status, 0, r.stderr);
    const wav = readWavInfo(path.join(dir, "sound/sfx/tap.wav"));
    assert.ok(Math.abs(wav.frames / wav.sampleRate - settings.keep) < 0.002);
    assert.equal(wav.channels, settings.music ? 2 : 1);
  }
  const sourcesPath = path.join(dir, "sound/sfx/SOURCES.json");
  const legacy = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
  delete legacy.tap.processing;
  fs.writeFileSync(sourcesPath, JSON.stringify(legacy));
  fs.writeFileSync(
    path.join(dir, "sound/sfx_list.json"),
    JSON.stringify({ tap: { id: 123, for: "full source" } }),
  );
  const rebuilt = await runCliAsync([], { cwd: dir, env: { FREESOUND_BASE: base } });
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  const full = readWavInfo(path.join(dir, "sound/sfx/tap.wav"));
  assert.ok(full.frames / full.sampleRate > 0.9);
  assert.equal(full.channels, 1);
  assert.equal(downloads, 1);
});

test("help flags exit 0 even when sfx_list.json is malformed and in non-film cwd", (t) => {
  const brokenDir = makeTempFilm(t, {
    "sound/sfx_list.json": "{bad json",
  });
  const nonFilm = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-nonfilm-"));
  t.after(() => fs.rmSync(nonFilm, { recursive: true, force: true }));

  for (const [args, cwd] of [
    [["-h"], brokenDir],
    [["--help"], brokenDir],
    [["help"], brokenDir],
    [["find", "--help"], brokenDir],
    [["sweeteners", "-h"], brokenDir],
    [["--help"], nonFilm],
  ]) {
    const r = runCli(args, { cwd });
    assert.equal(r.status, 0, `${args.join(" ")} stderr: ${r.stderr}`);
    assert.match(r.stdout, /bun run sfx:get/);
    assert.doesNotMatch(r.stderr, /Traceback|JSONDecodeError/);
  }
});

test("invalid flags, bad arguments, and non-film directory exit 2 cleanly without touching sfx_list.json", (t) => {
  const brokenDir = makeTempFilm(t, {
    "sound/sfx_list.json": "{bad json",
  });
  const nonFilm = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-nonfilm-"));
  t.after(() => fs.rmSync(nonFilm, { recursive: true, force: true }));

  const cases = [
    [["--bogus"], brokenDir, /unknown option/],
    [["find"], brokenDir, /find what/],
    [["find", "   "], brokenDir, /find what/],
    [["find", "cat", "0"], brokenDir, /max seconds/],
    [["find", "cat", "-5"], brokenDir, /max seconds/],
    [["find", "cat", "abc"], brokenDir, /max seconds/],
    [["find", "cat", "nan"], brokenDir, /max seconds/],
    [["find", "cat", "inf"], brokenDir, /max seconds/],
    [["find", "cat", "meow"], brokenDir, /usage|quotes/],
    [["sweeteners", "extra"], brokenDir, /usage/],
    [[], nonFilm, /not a film/],
    [["sweeteners"], nonFilm, /not a film/],
  ];

  for (const [args, cwd, pattern] of cases) {
    const r = runCli(args, { cwd });
    assert.equal(
      r.status,
      2,
      `expected exit 2 for ${args.join(" ")}, got ${r.status}: ${r.stderr}`,
    );
    assert.match(r.stderr, pattern);
    assert.doesNotMatch(r.stderr, /Traceback|JSONDecodeError/);
  }
});

test("sfx_list.json rejects malformed JSON, invalid entries, and path traversal without traceback", (t) => {
  const outsideFile = path.join(os.tmpdir(), `sfx-escape-${process.pid}.wav`);
  t.after(() => fs.rmSync(outsideFile, { force: true }));

  const badConfigs = [
    ["{bad json", /not valid JSON/],
    ["[]", /JSON object/],
    [JSON.stringify({ tap: { id: 123 } }), /missing.*"for"|for/i],
    [JSON.stringify({ tap: { id: true, for: "click" } }), /id/],
    [JSON.stringify({ tap: { id: -5, for: "click" } }), /id/],
    [JSON.stringify({ tap: { id: 123, for: "   " } }), /for/],
    [JSON.stringify({ tap: { id: 123, keep: -1, for: "click" } }), /keep/],
    [JSON.stringify({ tap: { id: 123, keep: true, for: "click" } }), /keep/],
    [JSON.stringify({ tap: { id: 123, bed: "yes", for: "click" } }), /bed/],
    [JSON.stringify({ "../evil": { id: 123, for: "escape" } }), /invalid sound name|evil/i],
    [JSON.stringify({ ".hidden": { id: 123, for: "hidden" } }), /invalid sound name|hidden/i],
    [JSON.stringify({ con: { id: 123, for: "reserved" } }), /invalid sound name|con/i],
  ];

  for (const [rawJson, msgPattern] of badConfigs) {
    const dir = makeTempFilm(t, { "sound/sfx_list.json": rawJson });
    const r = runCli([], { cwd: dir });
    assert.equal(r.status, 1, `expected exit 1 for ${rawJson}, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, msgPattern);
    assert.doesNotMatch(r.stderr, /Traceback|KeyError|JSONDecodeError/);
    assert.equal(fs.existsSync(outsideFile), false);
  }
});

test("empty sfx_list.json exits 0 with next: hint", (t) => {
  const dir = makeTempFilm(t, { "sound/sfx_list.json": "{}" });
  const r = runCli([], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.match(lines.at(-1), /^next:\s+/);
});

test("symlink or junction escape for sound/sfx is blocked before writing", async (t) => {
  const base = await startMockFreesound(t, (req, res) => {
    res.writeHead(404);
    res.end("not found");
  });
  const dir = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 101, for: "click" } }),
  });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "sound"), { recursive: true });
  fs.symlinkSync(
    outside,
    path.join(dir, "sound", "sfx"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const r = await runCliAsync([], { cwd: dir, env: { FREESOUND_BASE: base } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /symlink|junction|escapes/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("find scrapes Freesound search HTML, filters duration, escapes entities, and prints next: line", async (t) => {
  const base = await startMockFreesound(t, (req, res) => {
    if (req.url.startsWith("/search/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><body>
          <div class="bw-player" data-sound-id="110011" data-title="Cat &amp; Meow — soft" data-duration="1.5" data-num-downloads="4200"></div>
          <div data-title="Too Long" class="extra bw-player" data-sound-id="220022" data-duration="12.5" data-num-downloads="900"></div>
        </body></html>
      `);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const nonFilm = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-find-"));
  t.after(() => fs.rmSync(nonFilm, { recursive: true, force: true }));

  const hitRun = await runCliAsync(["find", "cat meow", "5"], {
    cwd: nonFilm,
    env: { FREESOUND_BASE: base, PYTHONIOENCODING: "ascii" },
  });
  assert.equal(hitRun.status, 0, hitRun.stderr);
  assert.match(hitRun.stdout, /110011 \| Cat & Meow/);
  assert.doesNotMatch(hitRun.stdout, /220022/);
  const lines = hitRun.stdout.trim().split(/\r?\n/);
  assert.match(lines.at(-1), /^next: .*110011/);

  const missRun = await runCliAsync(["find", "cat meow", "0.5"], {
    cwd: nonFilm,
    env: { FREESOUND_BASE: base },
  });
  assert.equal(missRun.status, 1);
  assert.match(missRun.stderr, /no CC0 sound/);
});

test("fetch verifies true CC0 license, preserves existing valid files on failure, and cleans partial temp files", async (t) => {
  const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-fix-"));
  t.after(() => fs.rmSync(fixDir, { recursive: true, force: true }));
  const toneMp3 = makeMp3Buffer(fixDir, "tone.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
  ]);

  let baseUrl = "";
  baseUrl = await startMockFreesound(t, (req, res) => {
    if (req.url === "/s/101/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><meta property="og:audio:artist" content="Alice &amp; Co"></head>
        <body>
          <div class="bw-player" data-title="Clean Hit — 01" data-mp3="${baseUrl}/previews/101-lq.mp3"></div>
          <a title="Go to the full license text" href="http://creativecommons.org/publicdomain/zero/1.0/">Creative Commons 0</a>
        </body></html>
      `);
      return;
    }
    if (req.url === "/s/202/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><meta property="og:audio:artist" content="Bob"></head>
        <body>
          <p>Description note: people often compare CC-BY with Creative Commons 0.</p>
          <div class="bw-player" data-title="Actually CC-BY" data-mp3="${baseUrl}/previews/202-lq.mp3"></div>
          <a title="Go to the full license text" href="https://creativecommons.org/licenses/by/4.0/">Attribution 4.0</a>
        </body></html>
      `);
      return;
    }
    if (req.url === "/previews/101-hq.mp3" || req.url === "/previews/202-hq.mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(toneMp3);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const dir = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({
      good_hit: { id: 101, keep: 0.6, for: "good hit" },
      bad_ccby: { id: 202, for: "not cc0" },
    }),
  });

  const res = await runCliAsync([], { cwd: dir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(res.status, 1, `expected exit 1 for non-CC0 second entry, got ${res.status}`);
  assert.match(res.stderr, /not CC0/i);
  assert.doesNotMatch(res.stderr, /Traceback/);

  const wav101 = path.join(dir, "sound", "sfx", "good_hit.wav");
  assert.equal(fs.existsSync(wav101), true);
  assert.equal(fs.existsSync(path.join(dir, "sound", "sfx", "bad_ccby.wav")), false);
  const leftovers = fs
    .readdirSync(path.join(dir, "sound", "sfx"))
    .filter((f) => f.includes(".tmp"));
  assert.deepEqual(leftovers, []);

  const info = readWavInfo(wav101);
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 1);
  assert.ok(
    Math.abs(info.frames - 0.6 * 48000) < 2500,
    `expected ~0.6s frames, got ${info.frames}`,
  );
  const tail = info.samples.subarray(Math.max(0, info.samples.length - 48));
  const peakTail = Math.max(...Array.from(tail, (v) => Math.abs(v)));
  assert.ok(peakTail < 2000, `expected fade-out tail near zero, got peak ${peakTail}`);

  const sources = JSON.parse(
    fs.readFileSync(path.join(dir, "sound", "sfx", "SOURCES.json"), "utf8"),
  );
  assert.deepEqual(sources.good_hit, {
    id: 101,
    title: "Clean Hit — 01",
    by: "Alice & Co",
    url: `${baseUrl}/s/101/`,
    license: "CC0 1.0",
    processing: { keep: 0.6, bed: false, music: false },
    for: "good hit",
  });
  assert.equal(sources.bad_ccby, undefined);
});

test("quiet one-shot below -45dB falls back from silenceremove instead of writing 0-frame wav, and music sets stereo + kind bgm", async (t) => {
  const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-quiet-"));
  t.after(() => fs.rmSync(fixDir, { recursive: true, force: true }));
  const quietMp3 = makeMp3Buffer(fixDir, "quiet.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.8",
    "-af",
    "volume=0.0018",
  ]);
  const musicMp3 = makeMp3Buffer(fixDir, "music.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=1.2",
    "-ac",
    "2",
  ]);

  let baseUrl = "";
  baseUrl = await startMockFreesound(t, (req, res) => {
    const map = {
      "/s/301/": { title: "Quiet Tap", by: "QuietUser", mp3: `${baseUrl}/previews/301-lq.mp3` },
      "/s/302/": { title: "Bg Loop", by: "MusicUser", mp3: `${baseUrl}/previews/302-lq.mp3` },
    };
    const item = map[req.url];
    if (item) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><meta property="og:audio:artist" content="${item.by}"></head>
        <body>
          <div class="bw-player" data-title="${item.title}" data-mp3="${item.mp3}"></div>
          <a href="http://creativecommons.org/publicdomain/zero/1.0/">Creative Commons 0</a>
        </body></html>
      `);
      return;
    }
    if (req.url === "/previews/301-hq.mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(quietMp3);
      return;
    }
    if (req.url === "/previews/302-hq.mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(musicMp3);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const dir = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({
      quiet_tap: { id: 301, for: "quiet foley" },
      theme_bgm: { id: 302, music: true, for: "background score" },
    }),
  });

  const res = await runCliAsync([], { cwd: dir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout.trim().split(/\r?\n/).at(-1), /^next: bun run check$/);

  const quietInfo = readWavInfo(path.join(dir, "sound", "sfx", "quiet_tap.wav"));
  assert.ok(
    quietInfo.frames > 1000,
    `expected non-empty wav for quiet sound, got ${quietInfo.frames}`,
  );

  const musicInfo = readWavInfo(path.join(dir, "sound", "sfx", "theme_bgm.wav"));
  assert.equal(musicInfo.channels, 2);

  const sources = JSON.parse(
    fs.readFileSync(path.join(dir, "sound", "sfx", "SOURCES.json"), "utf8"),
  );
  assert.equal(sources.theme_bgm.kind, "bgm");
});

test("sweeteners writes role and kind sfx metadata, skips valid existing wavs, and backfills missing role/kind", async (t) => {
  const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-sweet-"));
  t.after(() => fs.rmSync(fixDir, { recursive: true, force: true }));
  const hitMp3 = makeMp3Buffer(fixDir, "sweet.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=520:duration=0.5",
  ]);

  let hitsFetched = 0;
  let baseUrl = "";
  baseUrl = await startMockFreesound(t, (req, res) => {
    const m = /^\/s\/(\d+)\/$/.exec(req.url);
    if (m) {
      hitsFetched += 1;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><meta property="og:audio:artist" content="SweetMaker"></head>
        <body>
          <div class="bw-player" data-title="Sweet ${m[1]}" data-mp3="${baseUrl}/previews/${m[1]}-lq.mp3"></div>
          <a href="http://creativecommons.org/publicdomain/zero/1.0/">Creative Commons 0</a>
        </body></html>
      `);
      return;
    }
    if (req.url.startsWith("/previews/")) {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(hitMp3);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const dir = makeTempFilm(t);
  const sfxDir = path.join(dir, "sound", "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });
  const preWav = path.join(sfxDir, "sweet_riser.wav");
  const wavGen = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.4",
      "-ar",
      "48000",
      "-ac",
      "1",
      preWav,
    ],
    { encoding: "utf8" },
  );
  assert.equal(wavGen.status, 0, wavGen.stderr);
  fs.writeFileSync(
    path.join(sfxDir, "SOURCES.json"),
    "\uFEFF" +
      JSON.stringify({
        sweet_riser: {
          id: 685256,
          title: "Existing Riser",
          by: "SweetMaker",
          url: "https://freesound.org/s/685256/",
          license: "CC0 1.0",
          processing: { keep: null, bed: false, music: false },
          for: "existing",
        },
      }),
    "utf8",
  );

  const res = await runCliAsync(["sweeteners"], { cwd: dir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(
    hitsFetched,
    6,
    "should skip existing valid sweet_riser and fetch the remaining 6 sweeteners",
  );
  assert.match(res.stdout.trim().split(/\r?\n/).at(-1), /^next: /);

  const sources = JSON.parse(fs.readFileSync(path.join(sfxDir, "SOURCES.json"), "utf8"));
  assert.equal(sources.sweet_riser.role, "riser");
  assert.equal(sources.sweet_riser.kind, "sfx");
  assert.equal(sources.sweet_whoosh.role, "whoosh");
  assert.equal(sources.sweet_whoosh.kind, "sfx");
  assert.equal(sources.sweet_impact.role, "impact");
  assert.equal(sources.sweet_downlifter.role, "downlifter");
});

test("re-fetches corrupt 0-frame wav, handles malformed SOURCES.json, and respects live-studio.sfx confinement", async (t) => {
  const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-recover-"));
  t.after(() => fs.rmSync(fixDir, { recursive: true, force: true }));
  const toneMp3 = makeMp3Buffer(fixDir, "tone.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.5",
  ]);

  let baseUrl = "";
  baseUrl = await startMockFreesound(t, (req, res) => {
    if (req.url === "/s/505/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><meta property="og:audio:artist" content="Tester"></head>
        <body>
          <div class="bw-player" data-title="Recovered Sound" data-mp3="${baseUrl}/previews/505-lq.mp3"></div>
          <a href="http://creativecommons.org/publicdomain/zero/1.0/">Creative Commons 0</a>
        </body></html>
      `);
      return;
    }
    if (req.url === "/previews/505-hq.mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(toneMp3);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const badSourcesDir = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 505, for: "tap" } }),
    "sound/sfx/SOURCES.json": "{broken",
  });
  const badRes = await runCliAsync([], { cwd: badSourcesDir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(badRes.status, 1);
  assert.match(badRes.stderr, /not valid JSON/);
  assert.doesNotMatch(badRes.stderr, /Traceback/);

  const escapeDir = makeTempFilm(t, {
    "package.json": JSON.stringify({ "live-studio": { sfx: "../outside" } }),
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 505, for: "tap" } }),
  });
  const escRes = await runCliAsync([], { cwd: escapeDir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(escRes.status, 1);
  assert.match(escRes.stderr, /escapes film root/i);

  const customDir = makeTempFilm(t, {
    "package.json": JSON.stringify({ "live-studio": { sfx: "audio/sfx" } }),
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 505, for: "tap" } }),
    "audio/sfx/SOURCES.json": JSON.stringify({
      tap: {
        id: 505,
        title: "Old",
        by: "Tester",
        url: "https://freesound.org/s/505/",
        license: "CC0 1.0",
        for: "tap",
      },
    }),
  });
  const emptyWav = Buffer.alloc(44);
  emptyWav.write("RIFF", 0);
  emptyWav.writeUInt32LE(36, 4);
  emptyWav.write("WAVEfmt ", 8);
  emptyWav.writeUInt32LE(16, 16);
  emptyWav.writeUInt16LE(1, 20);
  emptyWav.writeUInt16LE(1, 22);
  emptyWav.writeUInt32LE(48000, 24);
  emptyWav.writeUInt32LE(96000, 28);
  emptyWav.writeUInt16LE(2, 32);
  emptyWav.writeUInt16LE(16, 34);
  emptyWav.write("data", 36);
  emptyWav.writeUInt32LE(0, 40);
  fs.writeFileSync(path.join(customDir, "audio", "sfx", "tap.wav"), emptyWav);

  const healRes = await runCliAsync([], { cwd: customDir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(healRes.status, 0, healRes.stderr);
  const healedInfo = readWavInfo(path.join(customDir, "audio", "sfx", "tap.wav"));
  assert.ok(
    healedInfo.frames > 1000,
    `expected corrupt 0-frame wav to be re-fetched, got ${healedInfo.frames}`,
  );
});

test("rejects root-relative/dot live-studio.sfx, file-vs-dir collisions, and boolean SOURCES id true", async (t) => {
  const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sfx-edge-"));
  t.after(() => fs.rmSync(fixDir, { recursive: true, force: true }));
  const toneMp3 = makeMp3Buffer(fixDir, "tone.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.4",
  ]);

  let hits = 0;
  let baseUrl = "";
  baseUrl = await startMockFreesound(t, (req, res) => {
    hits += 1;
    if (req.url === "/s/1/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><head><meta property="og:audio:artist" content="Tester"></head>
        <body>
          <div class="bw-player" data-title="Sound One" data-mp3="${baseUrl}/previews/1-lq.mp3"></div>
          <a href="http://creativecommons.org/publicdomain/zero/1.0/">Creative Commons 0</a>
        </body></html>
      `);
      return;
    }
    if (req.url === "/previews/1-hq.mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(toneMp3);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  for (const [badSfx, msgPattern] of [
    ["/outside", /must be relative|escapes/i],
    ["\\outside", /must be relative|escapes/i],
    ["C:outside", /must be relative|escapes/i],
    [".", /film root itself/i],
    ["./", /film root itself/i],
    ["sound/..", /escapes|film root/i],
  ]) {
    const dir = makeTempFilm(t, {
      "package.json": JSON.stringify({ "live-studio": { sfx: badSfx } }),
      "sound/sfx_list.json": JSON.stringify({ tap: { id: 1, for: "tap" } }),
    });
    const r = await runCliAsync([], { cwd: dir, env: { FREESOUND_BASE: baseUrl } });
    assert.equal(r.status, 1, `expected exit 1 for ${badSfx}, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, msgPattern);
    assert.doesNotMatch(r.stderr, /Traceback|ValueError/);
    assert.equal(fs.existsSync(path.join(dir, "SOURCES.json")), false);
  }

  const fileAtSfx = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 1, for: "tap" } }),
    "sound/sfx": "not a dir",
  });
  const sfxFileRes = await runCliAsync([], { cwd: fileAtSfx, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(sfxFileRes.status, 1);
  assert.match(sfxFileRes.stderr, /must be a directory/i);
  assert.doesNotMatch(sfxFileRes.stderr, /Traceback|FileExistsError/);

  const fileAtRaw = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 1, for: "tap" } }),
    "sound/sfx/raw": "not a dir",
  });
  const rawFileRes = await runCliAsync([], { cwd: fileAtRaw, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(rawFileRes.status, 1);
  assert.match(rawFileRes.stderr, /must be a directory/i);
  assert.doesNotMatch(rawFileRes.stderr, /Traceback|FileExistsError/);
  assert.equal(hits, 0, "directory slot errors must fail before network requests");

  const boolIdDir = makeTempFilm(t, {
    "sound/sfx_list.json": JSON.stringify({ tap: { id: 1, for: "tap" } }),
    "sound/sfx/SOURCES.json": JSON.stringify({
      tap: {
        id: true,
        title: "Bool",
        by: "X",
        url: "https://freesound.org/s/1/",
        license: "CC0 1.0",
        for: "tap",
      },
    }),
  });
  const wavGen = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.3",
      "-ar",
      "48000",
      "-ac",
      "1",
      path.join(boolIdDir, "sound", "sfx", "tap.wav"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(wavGen.status, 0, wavGen.stderr);
  const boolRes = await runCliAsync([], { cwd: boolIdDir, env: { FREESOUND_BASE: baseUrl } });
  assert.equal(boolRes.status, 0, boolRes.stderr);
  assert.ok(hits > 0, "boolean id: true should trigger fresh fetch for id: 1");
  const updatedSources = JSON.parse(
    fs.readFileSync(path.join(boolIdDir, "sound", "sfx", "SOURCES.json"), "utf8"),
  );
  assert.strictEqual(updatedSources.tap.id, 1);
});
