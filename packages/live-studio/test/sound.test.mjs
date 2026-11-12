import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { audioPeaks, oggInfo, openSound, wavInfo, wavPeaks } from "../src/sound.mjs";
import { compactJson } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-sound-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// A mono 16 bit WAV: one second of silence, then one at half level
const wav = (file, rate = 8000) => {
  const n = rate * 2,
    data = Buffer.alloc(n * 2);
  for (let i = rate; i < n; i++) data.writeInt16LE(i % 2 ? 16384 : -16384, i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
};

test("a WAV's length comes from its header and its level curve follows the sound", () => {
  const f = join(dir, "two.wav");
  wav(f);
  assert.equal(wavInfo(f).seconds, 2);
  const { step, peaks } = wavPeaks(f);
  assert.equal(peaks.length, Math.round(2 / step));
  assert.equal(peaks[10], 0);
  assert.equal(peaks.at(-10), 0.5);
});

test("waveform peaks include right-channel transients between sampled positions", () => {
  const f = join(dir, "stereo.wav");
  wav(f, 48000);
  const bytes = readFileSync(f);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000 * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.fill(0, 44);
  bytes.writeInt16LE(24576, 44 + 4 + 2);
  writeFileSync(f, bytes);
  assert.equal(wavPeaks(f).peaks[0], 0.75);
});

test("narration uses the same library, waveform and source lookup as ordinary audio clips", () => {
  const project = mkdtempSync(join(dir, "narration-"));
  mkdirSync(join(project, "sound/sfx"), { recursive: true });
  mkdirSync(join(project, "assets/voice"), { recursive: true });
  wav(join(project, "assets/voice/take.wav"));
  writeFileSync(join(project, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
  const sound = openSound(project, {
    soundTimeline: "audio.json",
    sfx: "sound/sfx",
    soundSources: { narration: "assets/voice/take.wav" },
  });
  assert.equal(sound.fileOf("narration"), join(project, "assets/voice/take.wav"));
  assert.equal(sound.library().find((s) => s.name === "narration").seconds, 2);
  assert.equal(sound.peaks("narration").peaks.at(-1), 0.5);
  assert.equal(sound.fileOf("../assets/voice/take"), null);
});

test("the studio writes the lanes as the films' timeline writer does: short entries on one line", () => {
  const data = {
    beds: [{ name: "hum", from: 0, to: 9, gain: 2, fadeIn: 0.5, fadeOut: 1 }],
    sfx: Array.from({ length: 3 }, (_, i) => ({ at: i, name: "tap", gain: -3 })),
  };
  assert.equal(
    compactJson({ sfx: data.sfx.slice(0, 1) }),
    '{"sfx": [{"at": 0, "name": "tap", "gain": -3}]}',
  );
  const lines = compactJson({
    ...data,
    sfx: Array.from({ length: 9 }, (_, i) => ({ at: i, name: "tap", gain: -3 })),
  }).split("\n");
  assert.equal(lines[0], "{");
  assert.ok(lines.every((l) => l.length <= 140));
  assert.equal(
    lines.find((l) => l.includes('"at": 4')).trim(),
    '{"at": 4, "name": "tap", "gain": -3},',
  );
});

test("a film's lanes as timeline_fmt.py wrote them come back unchanged but for whole-number floats (2.0 reads 2)", () => {
  const text = readFileSync(join(import.meta.dirname, "fixtures/timeline/audio.json"), "utf8");
  assert.equal(compactJson(JSON.parse(text)) + "\n", text.replace(/(\d)\.0(?=[,\]}\s])/g, "$1"));
});

test("a save made on an old version is refused, a bad one is named, a good one is written", () => {
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  wav(join(dir, "sound/sfx/tap.wav"));
  writeFileSync(
    join(dir, "sound/sfx/SOURCES.json"),
    JSON.stringify({ tap: { title: "A tap", license: "CC0 1.0", kind: "bgm", role: "whoosh" } }),
  );
  const file = join(dir, "src/timeline/audio.json");
  writeFileSync(
    file,
    JSON.stringify({
      voiceGain: 0,
      beds: [],
      sfx: [{ at: 1, name: "tap", gain: 0, try: ["knock"] }],
    }),
  );
  const s = openSound(dir, { soundTimeline: "src/timeline/audio.json", sfx: "sound/sfx" });
  const { version, data } = s.read();
  assert.deepEqual(s.library(), [
    {
      name: "tap",
      seconds: 2,
      title: "A tap",
      license: "CC0 1.0",
      url: undefined,
      for: undefined,
      kind: "bgm",
      role: "whoosh",
    },
  ]);
  assert.match(
    s.write(version, { ...data, sfx: [{ at: -1, name: "tap", gain: 0 }] }).problems.join(),
    /sfx/,
  );
  data.sfx[0].at = 2.5;
  const ok = s.write(version, data);
  assert.ok(ok.version);
  assert.ok(s.ownWrite());
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).sfx[0], {
    at: 2.5,
    name: "tap",
    gain: 0,
    try: ["knock"],
  }); // the film's own keys stay
  assert.deepEqual(s.write(version, data), { conflict: true });
  writeFileSync(file, readFileSync(file, "utf8").replace("2.5", "3"));
  assert.ok(!s.ownWrite());
  assert.equal(s.fileOf("../x"), null);
  assert.equal(openSound(dir, {}), null);
});

test("shared vault folders define kind and category automatically while film files override by name", () => {
  const repo = mkdtempSync(join(dir, "vault-repo-"));
  writeFileSync(join(repo, "vault.json"), JSON.stringify({ root: "./vault" }));
  mkdirSync(join(repo, "vault/sound/bgm/electronic"), { recursive: true });
  mkdirSync(join(repo, "vault/sound/sfx/transitions"), { recursive: true });
  mkdirSync(join(repo, "vault/sound/sfx/footsteps"), { recursive: true });
  wav(join(repo, "vault/sound/bgm/electronic/bgm-pulse.wav"), 4000); // 2s file, still kind "bgm" from folder
  wav(join(repo, "vault/sound/sfx/transitions/mixkit-168.wav"), 8000);
  wav(join(repo, "vault/sound/sfx/footsteps/gravel.wav"), 8000); // custom folder with no SOURCES.json entry
  writeFileSync(
    join(repo, "vault/sound/SOURCES.json"),
    JSON.stringify({
      "bgm-pulse": { title: "Pulse", license: "CC BY 4.0", source: "incompetech", origin: "real" },
      "mixkit-168": {
        title: "Fast air sweep",
        license: "Mixkit Free",
        source: "mixkit",
        role: "whoosh",
        origin: "real",
      },
    }),
  );

  const film = join(repo, "films/demo");
  mkdirSync(join(film, "sound/sfx/doors"), { recursive: true });
  wav(join(film, "sound/sfx/doors/creak.wav"), 8000);
  wav(join(film, "sound/sfx/mixkit-168.wav"), 16000); // film-local override (rate 16000 -> still 2s, distinct path)
  writeFileSync(
    join(film, "sound/sfx/SOURCES.json"),
    JSON.stringify({
      "mixkit-168": { title: "Custom film whoosh", role: "riser", origin: "synth" },
    }),
  );
  writeFileSync(join(film, "sound/sfx/.hidden.wav"), Buffer.alloc(44));
  writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));

  const s = openSound(film, { soundTimeline: "audio.json", sfx: "sound/sfx" });
  const byName = Object.fromEntries(s.library().map((x) => [x.name, x]));

  assert.equal(byName["bgm-pulse"].kind, "bgm");
  assert.equal(byName["bgm-pulse"].category, "electronic");
  assert.equal(byName["bgm-pulse"].source, "incompetech");
  assert.equal(byName["bgm-pulse"].origin, "real");

  assert.equal(byName.gravel.kind, "sfx");
  assert.equal(byName.gravel.category, "footsteps");
  assert.equal(byName.gravel.source, "vault");
  assert.equal(byName.gravel.origin, undefined);

  assert.equal(byName.creak.category, "doors");
  assert.equal(byName.creak.source, undefined);

  assert.equal(s.fileOf("mixkit-168"), join(film, "sound/sfx/mixkit-168.wav"));
  assert.equal(byName["mixkit-168"].title, "Custom film whoosh");
  assert.equal(byName["mixkit-168"].role, "riser");
  assert.equal(byName["mixkit-168"].origin, "synth");
  assert.equal(s.fileOf("sfx/footsteps/gravel"), null);
  assert.equal(s.fileOf("."), null);
  assert.equal(s.fileOf(".."), null);
  assert.equal(s.fileOf(".hidden"), null);
  assert.equal(s.peaks("gravel").peaks.at(-1), 0.5);

  // Fallback for narration stem when conf.soundSources is omitted (e.g. assemble.ts --clips on bare config)
  mkdirSync(join(film, "assets/public/agent"), { recursive: true });
  wav(join(film, "assets/public/agent/full_voice.wav"), 8000);
  assert.equal(s.fileOf("narration"), join(film, "assets/public/agent/full_voice.wav"));
});

const ogg = (file, seconds = 0.5, freq = 440) => {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:sample_rate=44100:duration=${seconds}`,
      "-af",
      "volume=12dB",
      "-c:a",
      "libvorbis",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
};

test("oggInfo reads duration and sample rate from Ogg Vorbis headers, and openSound merges vault/mc-sound with PEAKS.json and family metadata", () => {
  const repo = mkdtempSync(join(dir, "mc-ogg-repo-"));
  writeFileSync(join(repo, "vault.json"), JSON.stringify({ root: "./vault" }));
  mkdirSync(join(repo, "vault/mc-sound/mc/footsteps"), { recursive: true });
  mkdirSync(join(repo, "vault/mc-sound/bgm/boss"), { recursive: true });

  const step1 = join(repo, "vault/mc-sound/mc/footsteps/mc-step-stone-1.ogg");
  const step2 = join(repo, "vault/mc-sound/mc/footsteps/mc-step-stone-2.ogg");
  const boss = join(repo, "vault/mc-sound/bgm/boss/bgm-wither-storm-theme.ogg");
  ogg(step1, 0.35, 330);
  ogg(step2, 0.4, 370);
  ogg(boss, 1.2, 220);

  const info = oggInfo(step1);
  assert.equal(info.rate, 44100);
  assert.equal(info.channels, 1);
  assert.ok(Math.abs(info.seconds - 0.35) < 0.05);

  writeFileSync(
    join(repo, "vault/mc-sound/SOURCES.json"),
    JSON.stringify({
      "mc-step-stone-1": {
        title: "Stone · Step",
        license: "Minecraft 26.3 Assets",
        source: "minecraft",
        kind: "mc",
        origin: "real",
        family: "mc-step-stone",
        variant: 1,
      },
      "mc-step-stone-2": {
        title: "Stone · Step",
        license: "Minecraft 26.3 Assets",
        source: "minecraft",
        kind: "mc",
        origin: "real",
        family: "mc-step-stone",
        variant: 2,
      },
      "bgm-wither-storm-theme": {
        title: "Theme — Cracker's Wither Storm",
        license: "MIT",
        source: "wither-storm",
        kind: "bgm",
        origin: "real",
      },
    }),
  );
  writeFileSync(
    join(repo, "vault/mc-sound/PEAKS.json"),
    JSON.stringify({
      "mc-step-stone-1": { seconds: 0.35, step: 0.02, peaks: [0.42, 0.45, 0.41] },
      "mc-step-stone-2": { seconds: 0.4, step: 0.02, peaks: [0.38, 0.44, 0.39] },
      "bgm-wither-storm-theme": { seconds: 1.2, step: 0.02, peaks: [0.6, 0.62, 0.58] },
    }),
  );

  const film = join(repo, "films/demo");
  mkdirSync(join(film, "sound/sfx"), { recursive: true });
  ogg(join(film, "sound/sfx/custom-hit.ogg"), 0.25, 520);
  writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));

  const s = openSound(film, { soundTimeline: "audio.json", sfx: "sound/sfx" });
  const byName = Object.fromEntries(s.library().map((x) => [x.name, x]));

  assert.equal(byName["mc-step-stone-1"].kind, "mc");
  assert.equal(byName["mc-step-stone-1"].category, "footsteps");
  assert.equal(byName["mc-step-stone-1"].source, "minecraft");
  assert.equal(byName["mc-step-stone-1"].family, "mc-step-stone");
  assert.equal(byName["mc-step-stone-1"].variant, 1);
  assert.equal(byName["mc-step-stone-1"].seconds, 0.35);
  assert.deepEqual(s.peaks("mc-step-stone-1"), { step: 0.02, peaks: [0.42, 0.45, 0.41] });

  assert.equal(byName["bgm-wither-storm-theme"].kind, "bgm");
  assert.equal(byName["bgm-wither-storm-theme"].category, "boss");

  // Film-local .ogg without PEAKS.json still gets duration via oggInfo and peaks via ffmpeg fallback
  assert.ok(Math.abs(byName["custom-hit"].seconds - 0.25) < 0.05);
  assert.ok(s.peaks("custom-hit").peaks.some((p) => p > 0.2));
});

test("wavInfo and wavPeaks reject zero-channel, zero-rate and truncated-chunk WAVs without hanging", () => {
  const zeroCh = join(dir, "zero-ch.wav");
  wav(zeroCh, 8000);
  const b1 = readFileSync(zeroCh);
  b1.writeUInt16LE(0, 22); // channels = 0
  writeFileSync(zeroCh, b1);

  assert.equal(wavInfo(zeroCh), null);
  const sub = spawnSync(
    process.execPath,
    [
      "-e",
      `import { wavPeaks } from ${JSON.stringify(join(import.meta.dirname, "../src/sound.mjs"))}; console.log(JSON.stringify(wavPeaks(${JSON.stringify(zeroCh)})));`,
    ],
    { encoding: "utf8", timeout: 1500 },
  );
  assert.equal(sub.status, 0, `wavPeaks timed out or crashed: ${sub.stderr || sub.signal}`);
  assert.equal(JSON.parse(sub.stdout.trim()), null);

  const zeroRate = join(dir, "zero-rate.wav");
  wav(zeroRate, 8000);
  const b2 = readFileSync(zeroRate);
  b2.writeUInt32LE(0, 24); // rate = 0
  writeFileSync(zeroRate, b2);
  assert.equal(wavInfo(zeroRate), null);
  assert.equal(wavPeaks(zeroRate), null);
});

test("openSound rejects out-of-root soundSources, symlinked local audio, and non-http source URLs", () => {
  const outside = mkdtempSync(join(dir, "outside-secret-"));
  const secretWav = join(outside, "secret.wav");
  wav(secretWav, 8000);

  const project = mkdtempSync(join(dir, "confined-film-"));
  mkdirSync(join(project, "sound/sfx"), { recursive: true });
  wav(join(project, "sound/sfx/clean.wav"), 8000);
  writeFileSync(
    join(project, "sound/sfx/SOURCES.json"),
    JSON.stringify({
      clean: { title: "Clean", license: "CC0", url: "javascript:alert(1)" },
    }),
  );
  writeFileSync(join(project, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));

  let symCreated = false;
  try {
    symlinkSync(secretWav, join(project, "sound/sfx/linked.wav"));
    symCreated = true;
  } catch {
    symCreated = false;
  }

  const s = openSound(project, {
    soundTimeline: "audio.json",
    sfx: "sound/sfx",
    soundVault: false,
    soundSources: { escaped: "../outside-secret/secret.wav", abs: secretWav },
  });

  assert.equal(s.fileOf("escaped"), null);
  assert.equal(s.fileOf("abs"), null);
  if (symCreated) {
    assert.equal(s.fileOf("linked"), null);
    assert.equal(
      s.library().some((x) => x.name === "linked"),
      false,
    );
  }
  const cleanItem = s.library().find((x) => x.name === "clean");
  assert.equal(cleanItem.url, undefined);
});

test("openSound hot-discovers newly materialized vault/mc-sound without restart, strips UTF-8 BOMs, forwards digits in audioPeaks, and verifies Ogg serial numbers", () => {
  const repo = mkdtempSync(join(dir, "hot-vault-repo-"));
  writeFileSync(join(repo, "vault.json"), "\uFEFF" + JSON.stringify({ root: "./vault" }));
  const film = join(repo, "films/demo");
  mkdirSync(join(film, "sound/sfx"), { recursive: true });
  writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));

  // Start openSound BEFORE vault/mc-sound exists
  const s = openSound(film, { soundTimeline: "audio.json", sfx: "sound/sfx" });
  assert.deepEqual(s.library(), []);
  assert.equal(s.fileOf("mc-step-stone-1"), null);

  // Materialize vault/mc-sound with UTF-8 BOM JSON files while studio is already running
  mkdirSync(join(repo, "vault/mc-sound/mc/footsteps"), { recursive: true });
  const step1 = join(repo, "vault/mc-sound/mc/footsteps/mc-step-stone-1.ogg");
  ogg(step1, 0.3, 330);
  writeFileSync(
    join(repo, "vault/mc-sound/SOURCES.json"),
    "\uFEFF" +
      JSON.stringify({
        "mc-step-stone-1": {
          title: "Stone · Step",
          license: "Minecraft 26.3 Assets",
          source: "minecraft",
          kind: "mc",
          origin: "real",
        },
      }),
  );
  writeFileSync(
    join(repo, "vault/mc-sound/PEAKS.json"),
    "\uFEFF" +
      JSON.stringify({
        "mc-step-stone-1": { seconds: 0.3, step: 0.02, peaks: [0.4, 0.5] },
      }),
  );

  const lib = s.library();
  assert.equal(lib.length, 1);
  assert.equal(lib[0].name, "mc-step-stone-1");
  assert.equal(lib[0].title, "Stone · Step");
  assert.equal(s.fileOf("mc-step-stone-1"), step1);
  assert.deepEqual(s.peaks("mc-step-stone-1"), { step: 0.02, peaks: [0.4, 0.5] });

  // audioPeaks forwards digits argument
  const coarse = audioPeaks(step1, 0.05, 1);
  assert.ok(coarse.peaks.every((p) => Math.round(p * 10) === p * 10));

  // oggInfo ignores a trailing foreign-serial OggS page appended after the valid stream
  const chained = join(repo, "chained.ogg");
  const validBytes = readFileSync(step1);
  const fakePage = Buffer.alloc(32);
  fakePage.write("OggS", 0);
  fakePage[4] = 0;
  fakePage.writeBigInt64LE(44100n * 999n, 6); // bogus 999s granule
  fakePage.writeUInt32LE((validBytes.readUInt32LE(14) ^ 0xdeadbeef) >>> 0, 14); // different serial
  writeFileSync(chained, Buffer.concat([validBytes, fakePage]));
  assert.ok(Math.abs(oggInfo(chained).seconds - 0.3) < 0.06);

  // Guard against accidental UTF-8 BOMs in live-studio runtime modules
  for (const rel of ["../src/sound.mjs", "../src/api.mjs", "../render.mjs"]) {
    const raw = readFileSync(join(import.meta.dirname, rel));
    assert.equal(
      raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf,
      false,
      `unexpected UTF-8 BOM in ${rel}`,
    );
  }
});

test("openSound rejects out-of-root soundTimeline paths", () => {
  const outside = mkdtempSync(join(dir, "outside-timeline-"));
  writeFileSync(join(outside, "escaped.json"), JSON.stringify({ beds: [], sfx: [] }));

  const project = mkdtempSync(join(dir, "isolated-film-"));
  mkdirSync(join(project, "sound/sfx"), { recursive: true });

  assert.throws(
    () =>
      openSound(project, {
        soundTimeline: "../outside-timeline/escaped.json",
        sfx: "sound/sfx",
        soundVault: false,
      }),
    /escapes|inside/i,
  );
});

test("openSound rejects uncontained string soundVault traversal", () => {
  const outside = mkdtempSync(join(dir, "outside-vault-"));
  wav(join(outside, "host_secret.wav"), 8000);

  const project = mkdtempSync(join(dir, "isolated-vault-film-"));
  mkdirSync(join(project, "sound/sfx"), { recursive: true });
  writeFileSync(join(project, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));

  assert.throws(
    () =>
      openSound(project, {
        soundTimeline: "audio.json",
        sfx: "sound/sfx",
        soundVault: outside,
      }),
    /escapes|inside/i,
  );
});

test("peaksAsync decodes local ogg peaks asynchronously and coalesces concurrent calls", async () => {
  const project = mkdtempSync(join(dir, "async-ogg-film-"));
  mkdirSync(join(project, "sound/sfx"), { recursive: true });
  ogg(join(project, "sound/sfx/hit.ogg"), 0.35, 440);
  writeFileSync(join(project, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));

  const s = openSound(project, {
    soundTimeline: "audio.json",
    sfx: "sound/sfx",
    soundVault: false,
  });
  assert.equal(typeof s.peaksAsync, "function");
  const p1 = s.peaksAsync("hit");
  const p2 = s.peaksAsync("hit");
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(r1 && r1.peaks.some((v) => v > 0.2));
  assert.deepEqual(r1, r2);
  assert.equal(await s.peaksAsync("missing"), null);
});
