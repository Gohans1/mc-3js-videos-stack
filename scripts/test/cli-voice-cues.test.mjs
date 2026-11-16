import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildVoiceCues } from "../voice/cues.ts";

const CUES = resolve(dirname(fileURLToPath(import.meta.url)), "../voice/cues.ts");

const makeWav = (seconds, rate = 16000) => {
  const samples = Math.max(1, Math.round(seconds * rate));
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  return buf;
};

const makeFilm = (t, name, withStudioConf = true) => {
  const dir = mkdtempSync(join(tmpdir(), `cli-voice-cues-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const put = (rel, data) => writeFileSync(join(dir, rel), JSON.stringify(data));
  put(
    "package.json",
    withStudioConf
      ? {
          name: `probe-${name}`,
          "live-studio": {
            soundTimeline: "src/timeline/audio.json",
            timingTimeline: "src/timeline/timing.json",
            camTimeline: "src/timeline/cam.json",
            sfx: "sound/sfx",
          },
        }
      : { name: `probe-${name}` },
  );
  writeFileSync(join(dir, "src/scene.ts"), "export const scene = {};\n");
  put("src/edit.json", { end: 10 });
  put("src/timeline/audio.json", { tracks: [{ id: "voice", name: "Voice" }], sfx: [] });
  put("src/timeline/timing.json", {});
  return { dir, put };
};

const runCli = (args, cwd, envExtra = {}) =>
  spawnSync("bun", [CUES, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...envExtra },
  });

test("assembled word positions remain authoritative until voice:assemble runs again", (t) => {
  const { dir, put } = makeFilm(t, "assembled-position");
  put("package.json", { "live-studio": { soundSources: { narr: "sound/narr.wav" } } });
  writeFileSync(join(dir, "sound/narr.wav"), makeWav(8));
  writeFileSync(join(dir, "voice/takes/01.wav"), makeWav(0.5));
  put("voice/takes/01.wav.words.json", { dur: 0.5, words: [{ w: "hello", s: 0, e: 0.5 }] });
  put("src/edit.json", { end: 8, takes: [{ id: "01", t: 5 }], voice: { lines: [[1, 1.5]] } });
  put("src/timeline/audio.json", {
    narration: "narr",
    beds: [],
    sfx: [{ name: "narr", at: 0, length: 8, gain: 0 }],
  });
  put("renders/live/voice_map.json", {
    lines: [{ text: "hello", s: 1, e: 1.5, words: [{ w: "hello", s: 1, e: 1.5 }] }],
  });
  assert.equal(buildVoiceCues(dir).lines[0].s, 1);
});

test("a continuous narration brick spanning a reordered seam keeps its spoken order", (t) => {
  const { dir, put } = makeFilm(t, "reordered-brick");
  put("package.json", {
    "live-studio": {
      soundSources: { narr: "sound/narr.wav" },
      timingTimeline: "src/timeline/timing.json",
    },
  });
  writeFileSync(join(dir, "sound/narr.wav"), makeWav(8));
  put("src/edit.json", { end: 8 });
  put("src/timeline/audio.json", {
    narration: "narr",
    beds: [],
    sfx: [{ name: "narr", at: 0, length: 8, gain: 0 }],
  });
  put("src/timeline/timing.json", {
    main: [
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    ],
  });
  put("renders/live/voice_map.json", {
    lines: [
      { text: "early", s: 1, e: 1.5, words: [{ w: "early", s: 1, e: 1.5 }] },
      { text: "late", s: 5, e: 5.5, words: [{ w: "late", s: 5, e: 5.5 }] },
    ],
  });
  assert.deepEqual(buildVoiceCues(dir).lines, [
    { text: "early", s: 5, e: 5.5, speed: 1, words: [{ w: "early", s: 5, e: 5.5 }] },
  ]);
  const cli = runCli([], dir);
  assert.match(cli.stderr, /bun run at/);
  assert.doesNotMatch(cli.stderr, /goes at that second/);
});

test("voice tails remain audible to the final film end when picture and voice clocks differ", (t) => {
  const { dir, put } = makeFilm(t, "independent-tail");
  put("package.json", {
    "live-studio": {
      soundSources: { narr: "sound/narr.wav" },
      timingTimeline: "src/timeline/timing.json",
    },
  });
  writeFileSync(join(dir, "sound/narr.wav"), makeWav(1));
  put("src/edit.json", { end: 4 });
  put("renders/live/voice_map.json", {
    lines: [{ text: "tail", s: 0, e: 0.8, words: [{ w: "tail", s: 0, e: 0.8 }] }],
  });
  put("src/timeline/audio.json", {
    narration: "narr",
    beds: [],
    sfx: [{ name: "narr", at: 3.8, length: 1, gain: 0 }],
  });
  put("src/timeline/timing.json", {
    freezes: [{ at: 0.5, duration: 2 }],
    layerKinds: { voice: { base: {}, changes: [] } },
  });
  const cues = buildVoiceCues(dir);
  assert.equal(cues.lines[0].e, 4.6);
  assert.deepEqual(cues.gaps.at(-1), { from: 4.6, to: 6, dur: 1.4, afterLine: 0 });
});

test("CLI prints help with exit 0, rejects unknown/extra/non-film args with exit 2, warns on env typo, and rejects broken JSON", (t) => {
  const empty = mkdtempSync(join(tmpdir(), "cli-voice-cues-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));

  for (const helpArg of ["--help", "-h", "help"]) {
    const r = runCli([helpArg], empty);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /voice:cues/);
  }

  for (const badArgs of [
    ["--bogus"],
    ["--gap"],
    ["--gap", "0.5"],
    ["extra"],
    ["--json", "extra"],
  ]) {
    const r = runCli(badArgs, empty);
    assert.equal(r.status, 2, `expected exit 2 for ${badArgs.join(" ")}`);
  }

  assert.equal(runCli([], empty).status, 2);

  const { dir, put } = makeFilm(t, "cli-env");
  writeFileSync(join(dir, "renders/live/full_voice.wav"), makeWav(4));
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 0,
        e: 2,
        text: "hello world",
        words: [
          { w: "hello", s: 0, e: 1 },
          { w: "world", s: 1, e: 2 },
        ],
      },
    ],
  });

  const envRun = runCli(["--json"], empty, { LIVE_PROJECT: dir });
  assert.equal(envRun.status, 0);
  const parsed = JSON.parse(envRun.stdout);
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].s, 0);

  const envTypoRun = runCli(["--json"], empty, { LIVE_PROJET: dir });
  assert.equal(envTypoRun.status, 2);
  assert.match(envTypoRun.stderr, /LIVE_PROJET/);

  writeFileSync(join(dir, "choices.json"), "{bad json");
  const badJsonRun = runCli([], dir);
  assert.equal(badJsonRun.status, 1);
  assert.match(badJsonRun.stderr, /choices\.json/);
});

test("muted voice tracks omit muted bricks cleanly, exclude them from omitted-end duration, and report muted narration", (t) => {
  const { dir, put } = makeFilm(t, "muted");
  writeFileSync(join(dir, "sound/sfx/long_narr.wav"), makeWav(14));
  put("src/edit.json", {});
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 0,
        e: 2,
        text: "first line",
        words: [
          { w: "first", s: 0, e: 1 },
          { w: "line", s: 1, e: 2 },
        ],
      },
      {
        s: 4,
        e: 6,
        text: "second line",
        words: [
          { w: "second", s: 4, e: 5 },
          { w: "line", s: 5, e: 6 },
        ],
      },
    ],
  });
  put("src/timeline/audio.json", {
    narration: "long_narr",
    tracks: [{ id: "voice", name: "Voice", mute: true }],
    sfx: [{ name: "long_narr", track: "voice", at: 1 }],
  });
  writeFileSync(join(dir, "voice/takes/t1.mp3"), Buffer.from("fake"));

  const allMuted = buildVoiceCues(dir);
  assert.equal(allMuted.voiceOff, false);
  assert.equal(allMuted.voiceMuted, "voice");
  assert.equal(allMuted.unlaid, false);
  assert.deepEqual(allMuted.lines, []);
  assert.equal(allMuted.duration, 0.1);

  const cliMuted = runCli([], dir);
  assert.equal(cliMuted.status, 0);
  assert.match(cliMuted.stderr, /muted.*voice/);
  assert.doesNotMatch(cliMuted.stderr, /voice:gen/);

  // Partial mute: keep audible brick on voice_a, ignore muted brick duration on voice_b
  writeFileSync(join(dir, "sound/sfx/short_narr.wav"), makeWav(5));
  put("src/timeline/audio.json", {
    narration: "short_narr",
    tracks: [{ id: "voice_a" }, { id: "voice_b", mute: true }],
    sfx: [
      { name: "short_narr", track: "voice_a", at: 1, start: 0, length: 2 },
      { name: "short_narr", track: "voice_b", at: 20, start: 4, length: 2 },
    ],
  });
  const partial = buildVoiceCues(dir);
  assert.equal(partial.voiceMuted, null);
  assert.equal(partial.lines.length, 1);
  assert.equal(partial.lines[0].text, "first line");
  assert.equal(partial.duration, 5);
});

test("films relying on default package.json soundTimeline resolve sound/sfx narration clips", (t) => {
  const { dir, put } = makeFilm(t, "default-pkg", false);
  writeFileSync(join(dir, "sound/sfx/custom_narr.wav"), makeWav(7.5));
  put("src/edit.json", {});
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 0,
        e: 2,
        text: "default path",
        words: [
          { w: "default", s: 0, e: 1 },
          { w: "path", s: 1, e: 2 },
        ],
      },
    ],
  });
  put("src/timeline/audio.json", {
    narration: "custom_narr",
    tracks: [{ id: "voice" }],
    sfx: [{ name: "custom_narr", track: "voice", at: 1 }],
  });

  const cues = buildVoiceCues(dir);
  assert.equal(cues.duration, 7.5);
  assert.equal(cues.lines.length, 1);
  assert.equal(cues.lines[0].s, 1);
  assert.equal(cues.lines[0].e, 3);
});

test("sub-millisecond edit.end truncation drops 0ms phantom slices instead of reporting false speed or 6000 wpm", (t) => {
  const { dir, put } = makeFilm(t, "tiny-end");
  writeFileSync(join(dir, "renders/live/full_voice.wav"), makeWav(5));
  put("src/edit.json", { end: 2.0004 });
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 0,
        e: 1.5,
        text: "kept line",
        words: [
          { w: "kept", s: 0, e: 0.7 },
          { w: "line", s: 0.8, e: 1.5 },
        ],
      },
      {
        s: 2.0,
        e: 4.0,
        text: "tiny tail",
        words: [
          { w: "tiny", s: 2.0, e: 3.0 },
          { w: "tail", s: 3.0, e: 4.0 },
        ],
      },
    ],
  });

  const cues = buildVoiceCues(dir);
  assert.equal(cues.duration, 2);
  assert.equal(cues.lines.length, 1);
  assert.equal(cues.lines[0].text, "kept line");

  const r = runCli([], dir);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /another speed/);

  // Line kept (>= 1ms) trims sub-ms final word cleanly without breaking speed
  put("src/edit.json", { end: 2.5004 });
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 2.0,
        e: 4.0,
        text: "cut word",
        words: [
          { w: "cut", s: 2.0, e: 2.5 },
          { w: "word", s: 2.5, e: 4.0 },
        ],
      },
    ],
  });
  const trimmed = buildVoiceCues(dir);
  assert.equal(trimmed.lines.length, 1);
  assert.equal(trimmed.lines[0].speed, 1);
  assert.deepEqual(trimmed.lines[0].words, [{ w: "cut", s: 2, e: 2.5 }]);
});

test("keeps audio words on their file clock across narrative warp, reordering, speed and overlapping bricks", (t) => {
  const { dir, put } = makeFilm(t, "three-clock");
  writeFileSync(join(dir, "renders/live/full_voice.wav"), makeWav(10));
  put("src/edit.json", {
    end: 10,
    voice: {
      warp: [
        [0, 0],
        [4, 2],
        [10, 8],
      ],
    },
  });
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 0.5,
        e: 2.5,
        text: "early warped",
        words: [
          { w: "early", s: 0.5, e: 1.5 },
          { w: "warped", s: 1.5, e: 2.5 },
        ],
      },
      {
        s: 6.0,
        e: 8.0,
        text: "later clip",
        words: [
          { w: "later", s: 6.0, e: 7.0 },
          { w: "clip", s: 7.0, e: 8.0 },
        ],
      },
    ],
  });
  put("src/timeline/timing.json", {
    main: [
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
      { id: "g", kind: "gap", duration: 1 },
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    ],
    speeds: [{ from: 4, to: 8, rate: 2 }],
    freezes: [{ at: 1, duration: 1 }],
  });

  const reordered = buildVoiceCues(dir);
  assert.equal(reordered.lines.length, 2);
  assert.equal(reordered.lines[0].text, "later clip");
  assert.equal(reordered.lines[0].s, 1);
  assert.equal(reordered.lines[0].e, 2);
  assert.equal(reordered.lines[0].speed, 2);
  assert.equal(reordered.lines[1].text, "early warped");
  assert.equal(reordered.lines[1].s, 3.5);
  assert.equal(reordered.lines[1].e, 5.5);
  assert.equal(reordered.lines[1].speed, 1);

  // Nested overlapping Phrase Bricks preserve non-negative overall pace span
  put("src/edit.json", { end: 10 });
  put("src/timeline/timing.json", {});
  put("renders/live/voice_map.json", {
    lines: [
      {
        s: 0,
        e: 4,
        text: "long phrase here",
        words: [
          { w: "long", s: 0, e: 1 },
          { w: "phrase", s: 1, e: 2 },
          { w: "here", s: 2, e: 4 },
        ],
      },
      { s: 5, e: 6, text: "short", words: [{ w: "short", s: 5, e: 6 }] },
    ],
  });
  put("src/timeline/audio.json", {
    narration: "narr",
    tracks: [{ id: "voice" }],
    sfx: [
      { name: "narr", track: "voice", at: 1, start: 0, length: 4 },
      { name: "narr", track: "voice", at: 2, start: 5, length: 1 },
    ],
  });
  const overlapCli = runCli([], dir);
  assert.equal(overlapCli.status, 0);
  assert.match(overlapCli.stdout, /pace:\s+60 wpm/);
});

test("choices off overrides muted track, non-array sfx does not crash, and outside choices symlink is blocked", (t) => {
  const { dir, put } = makeFilm(t, "choices-and-guards");
  writeFileSync(join(dir, "renders/live/full_voice.wav"), makeWav(5));
  put("renders/live/voice_map.json", {
    lines: [{ s: 0, e: 2, text: "hello", words: [{ w: "hello", s: 0, e: 2 }] }],
  });
  put("src/timeline/audio.json", {
    narration: "narr",
    tracks: [{ id: "voice", mute: true }],
    sfx: "bad",
  });
  put("choices.json", { narr: { set: "off" } });

  const cues = buildVoiceCues(dir);
  assert.equal(cues.voiceOff, true);
  assert.equal(cues.voiceMuted, null);
  assert.deepEqual(cues.lines, []);
  assert.match(runCli([], dir).stderr, /narration: off/);

  const outside = mkdtempSync(join(tmpdir(), "cli-voice-cues-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "choices.json"), JSON.stringify({ narr: { set: "off" } }));
  rmSync(join(dir, "choices.json"));
  let linked = false;
  try {
    symlinkSync(join(outside, "choices.json"), join(dir, "choices.json"));
    linked = true;
  } catch (e) {
    if (
      (e && typeof e === "object" && "code" in e && e.code !== "EPERM") ||
      !(e && typeof e === "object" && "code" in e)
    ) {
      throw e;
    }
  }
  if (linked) {
    assert.throws(() => buildVoiceCues(dir), /inside|outside|escape|Choices|choices/i);
  }
});

test("voice cues and at stop at the selected narration file EOF despite explicit length", async (t) => {
  const { whatsAt } = await import("../at.ts");
  const { dir, put } = makeFilm(t, "selected-eof");
  writeFileSync(join(dir, "sound/sfx/narr.wav"), makeWav(1));
  writeFileSync(join(dir, "sound/sfx/alt.wav"), makeWav(0.5));
  put("src/edit.json", { end: 3 });
  put("src/timeline/cam.json", [{ t: 0, p: [0, 0, 5], l: [0, 0, 0] }]);
  put("src/timeline/audio.json", {
    narration: "narr",
    beds: [],
    sfx: [{ name: "narr", at: 0, length: 1, gain: 0, try: ["alt"] }],
  });
  put("choices.json", { narr: { set: "alt" } });
  put("renders/live/voice_map.json", {
    lines: [
      { text: "early", s: 0.1, e: 0.3, words: [{ w: "early", s: 0.1, e: 0.3 }] },
      { text: "late", s: 0.6, e: 0.9, words: [{ w: "late", s: 0.6, e: 0.9 }] },
    ],
  });
  assert.deepEqual(
    buildVoiceCues(dir).lines.map((l) => l.text),
    ["early"],
  );
  assert.equal(whatsAt(dir, 0.7).narration, null);
});

test("voice cues and at report both occurrences of repeated legacy narration", async (t) => {
  const { whatsAt } = await import("../at.ts");
  const { dir, put } = makeFilm(t, "repeated-narration");
  mkdirSync(join(dir, "assets/public/agent"), { recursive: true });
  writeFileSync(join(dir, "assets/public/agent/full_voice.wav"), makeWav(2));
  put("src/edit.json", { end: 2 });
  put("src/timeline/cam.json", [{ t: 0, p: [0, 0, 5], l: [0, 0, 0] }]);
  put("src/timeline/audio.json", { voice: true, beds: [], sfx: [] });
  put("src/timeline/timing.json", {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 2 },
      { id: "b", kind: "clip", sourceFrom: 0, sourceTo: 2 },
    ],
  });
  put("renders/live/voice_map.json", {
    lines: [{ text: "hello", s: 0.1, e: 0.4, words: [{ w: "hello", s: 0.1, e: 0.4 }] }],
  });
  assert.deepEqual(
    buildVoiceCues(dir).lines.map((line) => [line.s, line.e]),
    [
      [0.1, 0.4],
      [2.1, 2.4],
    ],
  );
  assert.equal(whatsAt(dir, 2.2).narration?.text, "hello");
});

test("finite narration bricks do not acquire phrases outside their mapped playback", async (t) => {
  const { whatsAt } = await import("../at.ts");
  const { dir, put } = makeFilm(t, "finite-repeated-brick");
  writeFileSync(join(dir, "sound/sfx/tone.wav"), makeWav(1));
  put("src/edit.json", { end: 4 });
  put("src/timeline/cam.json", [{ t: 0, p: [0, 0, 5], l: [0, 0, 0] }]);
  put("src/timeline/timing.json", {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 2 },
      { id: "b", kind: "clip", sourceFrom: 0, sourceTo: 2 },
    ],
  });
  put("renders/live/voice_map.json", {
    lines: [{ text: "hello", s: 0.1, e: 0.8, words: [{ w: "hello", s: 0.1, e: 0.8 }] }],
  });
  put("src/timeline/audio.json", {
    narration: "tone",
    beds: [],
    sfx: [{ name: "tone", at: 0, length: 1, gain: 0 }],
  });
  assert.deepEqual(
    buildVoiceCues(dir).lines.map((line) => [line.s, line.e]),
    [[0.1, 0.8]],
  );
  assert.equal(whatsAt(dir, 2.5).narration, null);
  put("src/timeline/audio.json", {
    narration: "tone",
    beds: [],
    sfx: [{ name: "tone", at: 0, length: 4, gain: 0 }],
  });
  assert.deepEqual(
    buildVoiceCues(dir).lines.map((line) => [line.s, line.e]),
    [
      [0.1, 0.8],
      [2.1, 2.8],
    ],
  );
});
