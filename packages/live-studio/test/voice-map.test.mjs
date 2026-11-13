import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  cpSync,
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
import { test } from "node:test";

import { openFilm, STUDIO, voiceMapOf } from "../src/film.mjs";
import { buildVoiceMap, planVoicePlacements, writeVoiceMap } from "../src/voice-map.mjs";

const writePcm16Wav = (file, samples, rate = 1000) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
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
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, Buffer.concat([h, data]));
};

test("buildVoiceMap returns empty peaks and lines when full_voice.wav is absent", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-map-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ takes: [{ id: "01", t: 1.5 }] }));
  assert.deepEqual(buildVoiceMap(dir), { step: 0.04, peaks: [], lines: [] });
});

test("buildVoiceMap computes 0.04s WAV peaks, shifts word timings to take.t, and skips unaligned takes cleanly", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-map-full-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [
        { id: "01", t: 2.0 },
        { id: "02", t: 5.0 },
      ],
    }),
  );
  writeFileSync(join(dir, "voice/takes/01.mp3"), Buffer.from("ID3-dummy"));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      words: [
        { w: "Cell", s: 0.12, e: 0.42 },
        { w: "0412.", s: 0.45, e: 0.92 },
      ],
    }),
  );
  // rate=1000 => 40 samples per 0.04s window; include a trailing 10-sample partial window
  const samples = [...Array(40).fill(0), ...Array(40).fill(16384), ...Array(10).fill(-8192)];
  writePcm16Wav(join(dir, "assets/public/agent/full_voice.wav"), samples, 1000);

  const out = buildVoiceMap(dir);
  assert.equal(out.step, 0.04);
  assert.deepEqual(out.peaks, [0, 0.5, 0.25]);
  assert.deepEqual(out.lines, [
    {
      s: 2,
      e: 2.8,
      text: "Cell 0412.",
      words: [
        { w: "Cell", s: 2, e: 2.3 },
        { w: "0412.", s: 2.33, e: 2.8 },
      ],
    },
  ]);
});

test("openFilm writes renders/live/voice_map.json natively with no voice_map.py in the film", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-voicemap-native-"));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  // Ensure NO voice_map.py exists in dir
  assert.equal(existsSync(join(dir, "voice_map.py")), false);

  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  edit.takes = [{ id: "01", t: 1.25 }];
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(edit));
  writeFileSync(join(dir, "voice/takes/01.mp3"), Buffer.from("ID3-dummy"));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      words: [
        { w: "Wake", s: 0.05, e: 0.35 },
        { w: "up.", s: 0.4, e: 0.7 },
      ],
    }),
  );
  writePcm16Wav(join(dir, "assets/public/agent/full_voice.wav"), Array(80).fill(16384), 1000);
  writeFileSync(join(dir, "src/timeline/audio.json"), '{"gain": 1}\n');
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { sound: ["sound.py", "src/timeline/audio.json"] } }),
  );
  writeFileSync(
    join(dir, "sound.py"),
    'import sys, pathlib\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"")\nout.with_name("trials.json").write_text("{}")\n',
  );

  const events = new EventEmitter(),
    heard = [];
  const film = openFilm(dir, {
    send: (e) => {
      heard.push(e);
      events.emit(e);
    },
  });
  t.after(() => {
    film.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`No completed mix: ${heard.join(", ")}`)), 20000);
    events.once("sound", () => {
      clearTimeout(timer);
      done();
    });
    film.start();
  });

  const mapPath = voiceMapOf(dir);
  assert.equal(existsSync(mapPath), true);
  assert.equal(heard.includes("voice"), true);
  const mapped = JSON.parse(readFileSync(mapPath, "utf8"));
  assert.equal(mapped.lines.length, 1);
  assert.equal(mapped.lines[0].text, "Wake up.");
  assert.equal(mapped.lines[0].s, 1.25);
  assert.equal(mapped.lines[0].e, 1.9);
  assert.equal(writeVoiceMap(dir, mapPath).words, 2);
});

test("buildVoiceMap clamps start at 0 when take.t < firstWord.s, packs sequential omitted-t takes, and skips orphan/unsafe takes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-map-parity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writePcm16Wav(join(dir, "assets/public/agent/full_voice.wav"), Array(100).fill(0), 1000);

  // 1. Cold-open take with t: 0 and leading breath (words[0].s = 0.194) + unsafe ID + orphan .words.json without audio
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [
        { id: "01", t: 0 },
        { id: "../evil", t: 1.0 },
        { id: "02", t: 3.0 },
      ],
    }),
  );
  writeFileSync(join(dir, "voice/takes/01.mp3"), Buffer.from("ID3-01"));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      dur: 0.95,
      words: [
        { w: "Cold", s: 0.194, e: 0.5 },
        { w: "open.", s: 0.55, e: 0.9 },
      ],
    }),
  );
  // Orphan .words.json with NO 02.mp3 / 02.wav audio file -> must NOT enter voice_map lines
  writeFileSync(
    join(dir, "voice/takes/02.mp3.words.json"),
    JSON.stringify({
      words: [{ w: "Ghost", s: 0.1, e: 0.5 }],
    }),
  );

  const cold = buildVoiceMap(dir);
  assert.equal(cold.lines.length, 1);
  assert.equal(
    cold.lines[0].s,
    0.194,
    "cold-open take at t:0 must clamp start=0 so word 0 stays at 0.194s",
  );
  assert.equal(cold.lines[0].e, 0.9);

  // 2. Radio-Edit-First omitted-t sequential packing: take 2 starts at r3(naturalEnd_1 + 0.4)
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [{ id: "01" }, { id: "03" }],
    }),
  );
  writeFileSync(join(dir, "voice/takes/03.mp3"), Buffer.from("ID3-03"));
  writeFileSync(
    join(dir, "voice/takes/03.mp3.words.json"),
    JSON.stringify({
      dur: 1.2,
      words: [
        { w: "Second", s: 0.08, e: 0.6 },
        { w: "line.", s: 0.65, e: 1.1 },
      ],
    }),
  );
  // Take 01: start=0, lastWord=0.9, dur=0.95 => naturalEnd = min(0.95, 1.1) = 0.95 => cursor = 1.35
  // Take 03: start=1.35 => words[0].s = 1.35 + 0.08 = 1.43
  const packed = buildVoiceMap(dir);
  assert.equal(packed.lines.length, 2);
  assert.equal(packed.lines[0].s, 0.194);
  assert.equal(packed.lines[1].s, 1.43);
  assert.equal(packed.lines[1].e, 2.45);

  // 3. WhisperX unaligned sentinel ({ s: -1, e: -1 }) must be filtered out instead of shifting start by +1s
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [{ id: "01", t: 2.0 }],
    }),
  );
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      dur: 0.9,
      words: [
        { w: "0412", s: -1, e: -1 },
        { w: "Cell.", s: 0.2, e: 0.7 },
      ],
    }),
  );
  const filtered = buildVoiceMap(dir);
  assert.equal(filtered.lines.length, 1);
  assert.deepEqual(filtered.lines[0].words, [{ w: "Cell.", s: 2.0, e: 2.5 }]);
});

test("openFilm attaches full_voice.wav watcher when assembled after startup and does not emit premature sound event on useTry", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-voice-late-"));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "voice/try"), { recursive: true });

  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  edit.takes = [{ id: "01", t: 1.0, text: "Hello." }];
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(edit));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    '{"narration":"narration","beds":[],"sfx":[]}\n',
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        sound: ["sound.py", "src/timeline/audio.json"],
        soundTimeline: "src/timeline/audio.json",
        soundSources: { narration: "assets/public/agent/full_voice.wav" },
      },
    }),
  );
  writeFileSync(
    join(dir, "sound.py"),
    'import sys, time, pathlib\ntime.sleep(0.15)\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"RIFF")\nout.with_name("trials.json").write_text("{}")\n',
  );

  // Start WITHOUT full_voice.wav (like cell-break before first assemble)
  const events = new EventEmitter(),
    heard = [];
  const film = openFilm(dir, {
    send: (e) => {
      heard.push(e);
      events.emit(e);
    },
  });
  t.after(() => {
    film.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`Initial mix timed out: ${heard.join(", ")}`)),
      20000,
    );
    events.once("sound", () => {
      clearTimeout(timer);
      done();
    });
    film.start();
  });
  heard.length = 0;

  // Simulate assemble creating voice/takes/01.wav + .words.json + full_voice.wav + updating edit.json
  writePcm16Wav(join(dir, "voice/takes/01.wav"), Array(1000).fill(12000), 1000);
  writeFileSync(
    join(dir, "voice/takes/01.wav.words.json"),
    JSON.stringify({ dur: 1.0, words: [{ w: "Hello.", s: 0.1, e: 0.8 }] }),
  );
  writePcm16Wav(join(dir, "voice/try/01_alt.wav"), Array(1200).fill(14000), 1000);
  writeFileSync(
    join(dir, "voice/try/01_alt.wav.words.json"),
    JSON.stringify({ dur: 1.2, words: [{ w: "Hi.", s: 0.1, e: 0.9 }] }),
  );
  writePcm16Wav(join(dir, "assets/public/agent/full_voice.wav"), Array(2000).fill(12000), 1000);
  edit.voice = { lines: [[1.0, 1.7]], edits: {}, warp: [] };
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(edit, null, 1) + "\n");

  await new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`Late assemble timed out: ${heard.join(", ")}`)),
      20000,
    );
    const check = () => {
      if (heard.includes("voice") && heard.includes("sound")) {
        clearTimeout(timer);
        done();
      }
    };
    events.on("voice", check);
    events.on("sound", check);
  });
  assert.equal(existsSync(voiceMapOf(dir)), true);

  // Now call useTry: "sound" MUST NOT appear before sound.py finishes ("sound-start" must precede "sound")
  heard.length = 0;
  const soundDone = new Promise((done) => events.once("sound", done));
  const res = await film.voice.useTry({ takeId: "01", tryFile: "01_alt.wav" });
  assert.equal(res.error, undefined);
  // Immediately upon useTry resolving, sound.py (0.15s sleep) is still running, so "sound" has NOT fired prematurely!
  assert.equal(
    heard.includes("sound"),
    false,
    `expected no premature sound event before sound.py completes, got: ${heard.join(", ")}`,
  );
  assert.equal(heard.includes("sound-start"), true);
  await soundDone;
  assert.equal(heard.includes("sound"), true);
});

test("openFilm started before voice/ exists detects initial voice/takes creation without touching edit.json", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-voice-cold-dir-"));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });

  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  edit.takes = [{ id: "01", text: "Cold start take." }];
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(edit));
  writeFileSync(join(dir, "src/timeline/audio.json"), '{"beds":[],"sfx":[]}\n');
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        sound: ["sound.py", "src/timeline/audio.json"],
        soundTimeline: "src/timeline/audio.json",
      },
    }),
  );
  writeFileSync(
    join(dir, "sound.py"),
    'import sys, pathlib\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"RIFF")\nout.with_name("trials.json").write_text("{}")\n',
  );

  // Confirm voice/ does NOT exist when openFilm starts!
  assert.equal(existsSync(join(dir, "voice")), false);
  const events = new EventEmitter();
  const film = openFilm(dir, { send: (e) => events.emit(e) });
  t.after(() => {
    film.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Initial mix timed out")), 20000);
    events.once("sound", () => {
      clearTimeout(timer);
      done();
    });
    film.start();
  });

  // Now gen.ts creates voice/takes/01.wav WITHOUT editing src/edit.json!
  const voiceHeard = new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error("Expected voice event when voice/ directory is created after startup")),
      5000,
    );
    events.once("voice", () => {
      clearTimeout(timer);
      done();
    });
  });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writePcm16Wav(join(dir, "voice/takes/01.wav"), Array(800).fill(10000), 1000);
  await voiceHeard;
  assert.equal(film.voice.read().takes[0]?.file, "01.wav");
});

test("writeVoiceMap rejects out-of-root and junction-escaped output paths", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-map-confine-"));
  const outside = mkdtempSync(join(tmpdir(), "voice-map-outside-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ takes: [] }));

  assert.throws(() => writeVoiceMap(dir, join(outside, "voice_map.json")), /inside|escapes/i);
  mkdirSync(join(dir, "renders"), { recursive: true });
  let linked = false;
  try {
    symlinkSync(outside, join(dir, "renders/live"), "junction");
    linked = true;
  } catch {
    linked = false;
  }
  if (linked) {
    assert.throws(
      () => writeVoiceMap(dir, join(dir, "renders/live/voice_map.json")),
      /inside|escapes|symlink/i,
    );
    assert.equal(existsSync(join(outside, "voice_map.json")), false);
  }
});

test("a take with no word timings stops assembly with the command that writes them for that take", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-words-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ takes: [{ id: "01", text: "Hi." }] }));
  writeFileSync(join(dir, "voice/takes/01.mp3"), "mp3");
  assert.throws(
    () => planVoicePlacements(dir, { strict: true, fallbackSecondsOf: () => 1 }),
    (e) =>
      /scripts[\\/]voice[\\/]words\.py /.test(e.message) &&
      e.message.includes("01.mp3") &&
      !e.message.includes("<the take>"),
  );
});
