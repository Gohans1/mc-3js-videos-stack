import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { SoundTimeline } from "../../packages/live-studio/src/contract.ts";
import { runAssemble } from "../voice/assemble.ts";
import { buildVoiceCues } from "../voice/cues.ts";
import { runGen } from "../voice/gen.ts";
import { alignmentToWords, stripAudioTags, sts, tts } from "../voice/genvoice.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const makeTinyWavBuffer = (seconds = 1, rate = 8000) => {
  const n = Math.max(1, Math.round(seconds * rate));
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(i % 2 ? 12000 : -12000, i * 2);
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
  return Buffer.concat([h, data]);
};

const listenServer = async (t, handler) => {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  return `http://127.0.0.1:${server.address().port}`;
};

test("stripAudioTags removes bracketed acting tags for neighbor stitching context while keeping spoken punctuation", () => {
  assert.equal(
    stripAudioTags("[whispers] Cell 0412... [slows down] bare stone."),
    "Cell 0412... bare stone.",
  );
  assert.equal(stripAudioTags("  [sigh]  Nothing   inside. "), "Nothing inside.");
});

test("alignmentToWords converts ElevenLabs character alignment into word timestamps", () => {
  const chars = "Wake up.".split("");
  const starts = [0.1, 0.15, 0.2, 0.25, 0.32, 0.4, 0.48, 0.55];
  const ends = [0.15, 0.2, 0.25, 0.3, 0.38, 0.48, 0.55, 0.62];
  const out = alignmentToWords({
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  });
  assert.deepEqual(out.words, [
    { w: "Wake", s: 0.1, e: 0.3 },
    { w: "up.", s: 0.4, e: 0.62 },
  ]);
  assert.equal(out.text, "Wake up.");
  assert.equal(out.dur, 0.62);
});

test("genvoice tts polls GenVoice async tasks, sends tag-stripped context, and retries cleanly if proxy rejects extra fields", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-genvoice-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audioBytes = makeTinyWavBuffer(0.2);
  const bodies = [];
  let baseUrl = "";
  baseUrl = await listenServer(t, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.method === "POST" && req.url === "/v1/text-to-speech/v_echo") {
      const body = JSON.parse(raw);
      bodies.push(body);
      if ("previous_text" in body && bodies.length === 1) {
        res.writeHead(422, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "Extra inputs are not permitted" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "task_123" }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/history/task_123") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "task_123",
          status: "completed",
          characters_used: 12,
          credits_deducted: 12,
          result: { audio_url: `${baseUrl}/dl/task_123.mp3` },
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/dl/task_123.mp3") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(audioBytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const outMp3 = join(dir, "01.mp3");
  const info = await tts({
    voiceId: "v_echo",
    text: "[whispers] Bare concrete.",
    out: outMp3,
    previousText: "[sigh] Cell 0412.",
    nextText: "[pause] One desk.",
    provider: "genvoice",
    apiKey: "gv_test",
    apiBase: `${baseUrl}/v1`,
    pollIntervalMs: 10,
  });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].previous_text, "Cell 0412.");
  assert.equal(bodies[0].next_text, "One desk.");
  assert.equal("previous_text" in bodies[1], false);
  assert.equal(info.task, "task_123");
  assert.deepEqual(readFileSync(outMp3), audioBytes);
});

test("gen.ts runs takes sequentially per voice with neighbor context, request-id stitching, middle-take regen, and --try", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-gen-seq-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 12,
      voice: { lines: [], edits: {}, warp: [] },
      takes: [
        { id: "01", t: 0.5, text: "[whispers] First line." },
        { id: "02", t: 3.0, text: "[tense] Second line." },
        { id: "03", t: 6.0, text: "Third line." },
      ],
      beats: {},
    }),
  );

  const calls = [];
  let reqSeq = 0;
  const audioBytes = makeTinyWavBuffer(0.2);
  const baseUrl = await listenServer(t, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.method === "POST" && req.url?.startsWith("/v1/text-to-speech/")) {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      reqSeq++;
      const reqId = `req_${reqSeq}`;
      calls.push({ body, reqId });
      res.writeHead(200, { "content-type": "application/json", "request-id": reqId });
      res.end(
        JSON.stringify({
          audio_base64: audioBytes.toString("base64"),
          alignment: {
            characters: "Hi.".split(""),
            character_start_times_seconds: [0.05, 0.12, 0.2],
            character_end_times_seconds: [0.12, 0.2, 0.28],
          },
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await runGen({
    cwd: dir,
    args: [],
    env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.previous_text, undefined);
  assert.equal(calls[0].body.next_text, "Second line.");
  assert.equal(calls[1].body.previous_text, "First line.");
  assert.equal(calls[1].body.next_text, "Third line.");
  assert.deepEqual(calls[1].body.previous_request_ids, ["req_1"]);
  assert.deepEqual(calls[2].body.previous_request_ids, ["req_1", "req_2"]);
  assert.equal(existsSync(join(dir, "voice/takes/02.mp3.words.json")), true);

  // Regenerating middle take 02 --try --takes 2 keeps 02.mp3 untouched and passes BOTH previous (req_1) and next (req_3)
  calls.length = 0;
  await runGen({
    cwd: dir,
    args: ["02", "--try", "--takes", "2"],
    env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.previous_text, "First line.");
  assert.equal(calls[0].body.next_text, "Third line.");
  assert.deepEqual(calls[0].body.previous_request_ids, ["req_1"]);
  assert.deepEqual(calls[0].body.next_request_ids, ["req_3"]);
  assert.equal(existsSync(join(dir, "voice/try/02_1.mp3")), true);
  assert.equal(existsSync(join(dir, "voice/try/02_2.mp3")), true);
});

test("sts supports Voice Changer on ElevenLabs and reports a clear error on GenVoice proxy", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-sts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const guide = join(dir, "guide.wav"),
    out = join(dir, "out.mp3");
  writeFileSync(guide, makeTinyWavBuffer(0.25));

  await assert.rejects(
    () =>
      sts({ voiceId: "v_echo", audioPath: guide, out, provider: "genvoice", apiKey: "gv_only" }),
    /ELEVENLABS_API_KEY/,
  );

  let gotMultipart = false;
  const converted = makeTinyWavBuffer(0.25);
  const baseUrl = await listenServer(t, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.method === "POST" && req.url?.startsWith("/v1/speech-to-speech/v_echo")) {
      gotMultipart =
        (req.headers["content-type"] ?? "").includes("multipart/form-data") &&
        Buffer.concat(chunks).toString("latin1").includes("eleven_multilingual_sts_v2");
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(converted);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await sts({
    voiceId: "v_echo",
    audioPath: guide,
    out,
    provider: "elevenlabs",
    apiKey: "el_key",
    apiBase: `${baseUrl}/v1`,
  });
  assert.equal(gotMultipart, true);
  assert.deepEqual(readFileSync(out), converted);
});

test("assemble.ts builds full_voice.wav + per-take draggable Phrase Bricks, preserves hand-dragged bricks, and cues.ts exports post-drag Word GPS", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-assemble-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "radio-edit-test",
      "live-studio": {
        soundSources: { narration: "assets/public/agent/full_voice.wav" },
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  // Radio-Edit-First: takes omit `t` initially!
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 8,
      voice: { lines: [], edits: {}, warp: [] },
      takes: [
        { id: "01", text: "He pulls the drawer." },
        { id: "02", text: "Empty inside." },
      ],
      beats: {},
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "narration",
      voice: false,
      voiceGain: 0,
      beds: [],
      sfx: [{ at: 0, name: "narration", gain: 0, length: 8, dialogue: true, track: "voice" }],
      tracks: [
        { id: "voice", name: "Voice" },
        { id: "t1", name: "SFX" },
      ],
      lufs: -16,
      drive: 0,
    }),
  );
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));

  writeFileSync(join(dir, "voice/takes/01.mp3"), makeTinyWavBuffer(1.0));
  writeFileSync(join(dir, "voice/takes/02.mp3"), makeTinyWavBuffer(1.0));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      dur: 1.0,
      words: [
        { w: "He", s: 0.1, e: 0.3 },
        { w: "pulls.", s: 0.35, e: 0.8 },
      ],
    }),
  );
  writeFileSync(
    join(dir, "voice/takes/02.mp3.words.json"),
    JSON.stringify({
      dur: 1.0,
      words: [
        { w: "Empty", s: 0.05, e: 0.45 },
        { w: "inside.", s: 0.5, e: 0.9 },
      ],
    }),
  );

  await runAssemble({ cwd: dir, args: [] });

  assert.equal(existsSync(join(dir, "assets/public/agent/full_voice.wav")), true);
  assert.equal(existsSync(join(dir, "renders/live/voice_map.json")), true);
  const editAfterFirst = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  assert.equal(
    editAfterFirst.takes[0].t,
    undefined,
    "Radio-Edit-First assemble must not bake k.t into src/edit.json",
  );
  assert.equal(
    editAfterFirst.takes[1].t,
    undefined,
    "Radio-Edit-First assemble must keep omitted t dynamic",
  );
  const audio = JSON.parse(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"));
  assert.equal(SoundTimeline.safeParse(audio).success, true);
  const bricks = audio.sfx.filter((c) => c.name === "narration");
  assert.equal(bricks.length, 2);
  assert.equal(bricks[0].at, bricks[0].start);
  assert.equal(bricks[1].at, bricks[1].start);
  assert.ok(bricks[1].at >= bricks[0].at + bricks[0].length);

  // Simulate creator dragging Phrase Brick #2 right by +3.5s on Studio timeline for dramatic silence!
  const shift = 3.5;
  const originalSecondAt = bricks[1].at;
  bricks[1].at = +(bricks[1].at + shift).toFixed(3);
  writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify(audio, null, 1) + "\n");

  // Re-running assemble WITHOUT --clips must NOT clobber the creator's dragged brick!
  await runAssemble({ cwd: dir, args: [] });
  const afterReassemble = JSON.parse(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"));
  assert.equal(
    afterReassemble.sfx.filter((c) => c.name === "narration")[1].at,
    +(originalSecondAt + shift).toFixed(3),
  );

  // cues.ts must report the exact post-drag heard Word GPS + the dramatic silence gap!
  const cues = buildVoiceCues(dir);
  assert.equal(cues.lines.length, 2);
  assert.equal(cues.lines[1].words[0].w, "Empty");
  assert.ok(Math.abs(cues.lines[1].s - (cues.lines[0].e + 0.4 + shift)) < 0.35);
  assert.ok(cues.gaps.some((g) => g.dur >= 3.5));

  // Replacing Take 01 with a longer take (with loud tail noise past lastWord+0.2s) and re-running assemble:
  // 1) Take 02 re-packs after Take 01 with zero overlap in edit.voice.lines
  // 2) Trailing noise in Take 01 (1.05s..1.95s) is trimmed before amix so the 0.4s gap stays silent
  writeFileSync(join(dir, "voice/takes/01.mp3"), makeTinyWavBuffer(2.0));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      dur: 2.0,
      words: [
        { w: "He", s: 0.1, e: 0.35 },
        { w: "pulls", s: 0.4, e: 0.65 },
        { w: "slowly.", s: 0.7, e: 0.8 },
      ],
    }),
  );
  await runAssemble({ cwd: dir, args: ["--clips"] });
  const editRegrown = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  assert.ok(
    editRegrown.voice.lines[1][0] >= editRegrown.voice.lines[0][1] + 0.5,
    `expected Take 02 to re-pack after regrown Take 01, got ${JSON.stringify(editRegrown.voice.lines)}`,
  );
  const vmap = JSON.parse(readFileSync(join(dir, "renders/live/voice_map.json"), "utf8"));
  // Take 01 naturalEnd = min(2.0, 0.8 + 0.2) = 1.0s; Take 02 starts at 1.4s -> bins 27..32 (1.08s..1.28s) must be silent (0)
  const gapPeaks = vmap.peaks.slice(27, 33);
  assert.ok(
    gapPeaks.length > 0 && gapPeaks.every((p) => p < 0.01),
    `expected trimmed silent gap, got ${JSON.stringify(gapPeaks)}`,
  );
});

test("tts classifies English smart punctuation as en, Vietnamese diacritics as vi, and gen.ts respects active/try .wav files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-lang-wav-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "voice/try"), { recursive: true });

  const seenLangs = [];
  const audioBytes = makeTinyWavBuffer(0.2);
  const baseUrl = await listenServer(t, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.method === "POST" && req.url?.startsWith("/v1/text-to-speech/")) {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      seenLangs.push(body.language_code);
      res.writeHead(200, {
        "content-type": "application/json",
        "request-id": `req_${seenLangs.length}`,
      });
      res.end(JSON.stringify({ audio_base64: audioBytes.toString("base64") }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await tts({
    voiceId: "v_echo",
    text: "[whispers] “He didn’t look back — not once…” at the quiet café.",
    out: join(dir, "en.mp3"),
    provider: "elevenlabs",
    apiKey: "el_test",
    apiBase: `${baseUrl}/v1`,
  });
  await tts({
    voiceId: "v_echo",
    text: "[thì thầm] Không một ai nhìn lại phía sau.",
    out: join(dir, "vi.mp3"),
    provider: "elevenlabs",
    apiKey: "el_test",
    apiBase: `${baseUrl}/v1`,
  });
  assert.deepEqual(seenLangs, ["en", "vi"]);

  // Active 01.wav must NOT be clobbered by default runGen, and existing 01_1.wav in try/ must advance nextTryOut to 01_2.mp3
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [
        { id: "01", text: "Already promoted WAV take." },
        { id: "02", text: "Needs initial MP3 generation." },
      ],
    }),
  );
  writeFileSync(join(dir, "voice/takes/01.wav"), audioBytes);
  writeFileSync(join(dir, "voice/try/01_1.wav"), audioBytes);

  seenLangs.length = 0;
  const generated = await runGen({
    cwd: dir,
    args: [],
    env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
  });
  assert.deepEqual(
    generated.map((r) => r.id),
    ["02"],
    "01.wav is already rendered so only 02 should be generated",
  );
  assert.equal(existsSync(join(dir, "voice/takes/01.mp3")), false);

  const tried = await runGen({
    cwd: dir,
    args: ["01", "--try"],
    env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
  });
  assert.equal(tried.length, 1);
  assert.equal(tried[0].out, join(dir, "voice/try/01_2.mp3"));

  // Unknown take ID must fail BEFORE spending any paid TTS/STS API requests
  seenLangs.length = 0;
  await assert.rejects(
    runGen({
      cwd: dir,
      args: ["02", "99_typo"],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /Unknown take id "99_typo"/,
  );
  assert.equal(seenLangs.length, 0, "must validate all take IDs before calling TTS API");

  // --try with no explicit IDs would spend credits on every take: refused before any request
  await assert.rejects(
    runGen({
      cwd: dir,
      args: ["--try"],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /--try needs the takes to try/,
  );
  assert.equal(seenLangs.length, 0, "a bare --try must not call the TTS API");

  // Regenerating an existing take with unaligned TTS must remove stale <id>.mp3.words.json!
  writeFileSync(
    join(dir, "voice/takes/02.mp3.words.json"),
    JSON.stringify({ dur: 0.2, words: [{ w: "Stale", s: 0, e: 0.15 }] }),
  );
  await runGen({
    cwd: dir,
    args: ["02"],
    env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
  });
  assert.equal(
    existsSync(join(dir, "voice/takes/02.mp3.words.json")),
    false,
    "stale .words.json must be purged on unaligned regen",
  );

  // cues.ts must reflect fresh edit.json / .words.json edits even when an older renders/live/voice_map.json sits on disk
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({
      step: 0.04,
      peaks: [0.1],
      lines: [
        { s: 0, e: 0.2, text: "Outdated cached map", words: [{ w: "Outdated", s: 0, e: 0.2 }] },
      ],
    }),
  );
  writeFileSync(
    join(dir, "voice/takes/02.mp3.words.json"),
    JSON.stringify({
      dur: 0.8,
      words: [
        { w: "Fresh", s: 0.1, e: 0.4 },
        { w: "line.", s: 0.45, e: 0.75 },
      ],
    }),
  );
  const freshCues = buildVoiceCues(dir);
  assert.equal(freshCues.lines[0]?.text, "Fresh line.");
});

test("alignmentToWords strips ElevenLabs [audio tags], gen.ts --guide requires one take id, and assemble --clips initializes audio.narration", async (t) => {
  // 1. Character alignment from /with-timestamps includes raw [audio tags]: strip them from words while keeping spoken timing & dur
  const raw = "[low, quiet] Wake [slow] up.";
  const chars = raw.split("");
  const starts = chars.map((_, i) => +(i * 0.05).toFixed(3));
  const ends = chars.map((_, i) => +((i + 1) * 0.05).toFixed(3));
  const aligned = alignmentToWords({
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  });
  assert.equal(aligned.text, "Wake up.");
  assert.deepEqual(
    aligned.words.map((w) => w.w),
    ["Wake", "up."],
  );
  assert.equal(aligned.dur, +(chars.length * 0.05).toFixed(3));

  const dir = mkdtempSync(join(tmpdir(), "voice-r5-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });

  // 2. Tag-only /with-timestamps payload purges stale .words.json instead of writing empty word list
  const audioBytes = makeTinyWavBuffer(0.2);
  let hits = 0;
  const baseUrl = await listenServer(t, async (_req, res) => {
    hits++;
    const tagChars = "[sighs]".split("");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        audio_base64: audioBytes.toString("base64"),
        alignment: {
          characters: tagChars,
          character_start_times_seconds: tagChars.map((_, i) => i * 0.05),
          character_end_times_seconds: tagChars.map((_, i) => (i + 1) * 0.05),
        },
      }),
    );
  });
  const tagOut = join(dir, "voice/takes/tag_only.mp3");
  writeFileSync(
    `${tagOut}.words.json`,
    JSON.stringify({ dur: 0.2, words: [{ w: "Stale", s: 0, e: 0.1 }] }),
  );
  const tagRes = await tts({
    voiceId: "v_echo",
    text: "[sighs]",
    out: tagOut,
    provider: "elevenlabs",
    apiKey: "el_test",
    apiBase: `${baseUrl}/v1`,
  });
  assert.equal(tagRes.wordsFile, undefined);
  assert.equal(existsSync(`${tagOut}.words.json`), false);

  // 3. --guide without a single explicit take ID must throw BEFORE calling any API
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 4,
      takes: [
        { id: "01", text: "First." },
        { id: "02", text: "Second." },
      ],
    }),
  );
  hits = 0;
  await assert.rejects(
    runGen({
      cwd: dir,
      args: ["--guide", "guide.wav"],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /--guide requires exactly one explicit take id/,
  );
  assert.equal(hits, 0);

  // 4. assemble --clips initializes audio.narration = "narration" when omitted in audio.json
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": { soundTimeline: "src/timeline/audio.json" },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voiceGain: 0,
      beds: [],
      sfx: [],
      tracks: [{ id: "t1", name: "SFX" }],
    }),
  );
  writeFileSync(join(dir, "voice/takes/01.mp3"), makeTinyWavBuffer(0.8));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      dur: 0.8,
      words: [{ w: "First.", s: 0.1, e: 0.6 }],
    }),
  );
  writeFileSync(join(dir, "voice/takes/02.mp3"), makeTinyWavBuffer(0.8));
  writeFileSync(
    join(dir, "voice/takes/02.mp3.words.json"),
    JSON.stringify({
      dur: 0.8,
      words: [{ w: "Second.", s: 0.1, e: 0.6 }],
    }),
  );
  const assembled = await runAssemble({ cwd: dir, args: ["--clips"] });
  assert.equal(assembled.bricksWritten, 2);
  const audioDoc = JSON.parse(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"));
  assert.equal(audioDoc.narration, "narration");
  assert.equal(audioDoc.sfx.filter((c) => c.name === "narration").length, 2);
});

test("gen.ts expires >2h or mismatched .request_ids.json entries, retries ElevenLabs stitched 4xx with text context, and validates take/guide inputs upfront", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-r6-ttl-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });

  const audioBytes = makeTinyWavBuffer(0.2);
  const payloads = [];
  let failStitchedOnce = false;
  const baseUrl = await listenServer(t, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    payloads.push(body);
    if (failStitchedOnce && (body.previous_request_ids?.length || body.next_request_ids?.length)) {
      failStitchedOnce = false;
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Request ID expired or invalid" }));
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "request-id": `req_fresh_${payloads.length}`,
    });
    res.end(JSON.stringify({ audio_base64: audioBytes.toString("base64") }));
  });

  // 1. Expired (>2h), legacy plain-string, and mismatched-voice entries in .request_ids.json must NOT be sent,
  // while fresh (<2h, same voice & model) neighbor entries ARE sent!
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [
        { id: "01", voice: "v_echo", text: "First line." },
        { id: "02", voice: "v_echo", text: "Middle line." },
        { id: "03", voice: "v_echo", text: "Third line." },
      ],
    }),
  );
  const now = Date.now();
  writeFileSync(
    join(dir, "voice/takes/.request_ids.json"),
    JSON.stringify({
      "01": { id: "req_expired_3h", at: now - 3 * 3600_000, voiceId: "v_echo", model: "eleven_v4" },
      "03": { id: "req_fresh_5m", at: now - 5 * 60_000, voiceId: "v_echo", model: "eleven_v4" },
    }),
  );

  await runGen({
    cwd: dir,
    args: ["02"],
    env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
  });
  assert.equal(payloads.length, 1);
  assert.equal(
    payloads[0].previous_request_ids,
    undefined,
    "expired >2h request_id must be omitted so previous_text stays active",
  );
  assert.equal(payloads[0].previous_text, "First line.");
  assert.deepEqual(payloads[0].next_request_ids, ["req_fresh_5m"]);

  // 2. Direct ElevenLabs 422 on stitched request IDs automatically retries once with text-only context
  payloads.length = 0;
  failStitchedOnce = true;
  await tts({
    voiceId: "v_echo",
    text: "Retried line.",
    out: join(dir, "voice/takes/retry.mp3"),
    previousText: "Neighbor before.",
    previousRequestIds: ["req_dead_id"],
    provider: "elevenlabs",
    apiKey: "el_test",
    apiBase: `${baseUrl}/v1`,
  });
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0].previous_request_ids, ["req_dead_id"]);
  assert.equal(payloads[1].previous_request_ids, undefined);
  assert.equal(payloads[1].previous_text, "Neighbor before.");

  // 3. CLI --guide without file path, unsafe TAKE_ID, duplicate take IDs, and missing guide file all fail before API calls
  payloads.length = 0;
  await assert.rejects(
    runGen({
      cwd: dir,
      args: ["01", "--guide"],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /--guide requires a path/,
  );
  await assert.rejects(
    runGen({
      cwd: dir,
      args: ["--guide", "--try", "01"],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /--guide requires a path/,
  );
  await assert.rejects(
    runGen({
      cwd: dir,
      args: ["01", "--guide", "missing_guide.wav"],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /Guide audio file not found/,
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [{ id: "01.bad", text: "Unsafe id." }],
    }),
  );
  await assert.rejects(
    runGen({
      cwd: dir,
      args: [],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /Invalid take id/,
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      takes: [
        { id: "01", text: "Dup A." },
        { id: "01", text: "Dup B." },
      ],
    }),
  );
  await assert.rejects(
    runGen({
      cwd: dir,
      args: [],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /Duplicate take id/,
  );
  assert.equal(payloads.length, 0, "upfront validation must prevent any paid API requests");
});

test("mix.py prepare_timing applies timing.main scene-reorder Linkage in offline renders", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mix-main-linkage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(join(dir, "sound/sfx/hit.wav"), makeTinyWavBuffer(0.2));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
        sfx: "sound/sfx",
      },
    }),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 10,
      voice: { lines: [[6, 8]], edits: {}, warp: [] },
      beats: {},
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      voiceGain: 0,
      beds: [],
      sfx: [{ at: 6.5, name: "hit", gain: 0, length: 0.2 }],
      lufs: -16,
      drive: 0,
    }),
  );
  // Reorder [5..10] before [0..5] via timing.main ONLY (no speeds/freezes/cuts/gaps!)
  writeFileSync(
    join(dir, "src/timeline/timing.json"),
    JSON.stringify({
      main: [
        { id: "m2", kind: "clip", sourceFrom: 5, sourceTo: 10 },
        { id: "m1", kind: "clip", sourceFrom: 0, sourceTo: 5 },
      ],
    }),
  );

  const mixPy = join(ROOT, "scripts/sound/mix.py");
  const py = spawnSync(
    "python",
    [
      "-c",
      `import importlib.util, json; s = importlib.util.spec_from_file_location("mix", ${JSON.stringify(mixPy)}); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps({"sfx": m.A["sfx"], "voice": m.PROJECTED_VOICE}))`,
    ],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(py.status, 0, py.stderr);
  const parsed = JSON.parse(py.stdout.trim());
  assert.equal(parsed.sfx[0].at, 1.5);
  assert.deepEqual(parsed.voice, [[1, 3]]);
});

test("genvoice, gen, assemble, and mix.py enforce remote URL, --takes integer, and film-root path containment", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-sec-r1-"));
  const outside = mkdtempSync(join(tmpdir(), "voice-sec-outside-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 4,
      voice: { lines: [], edits: {}, warp: [] },
      takes: [{ id: "01", text: "Hello." }],
      beats: {},
    }),
  );

  // 1. --takes rejects leading-zero take IDs ("02"), zero, negative, non-integers, and excessive >20 values
  for (const badTakes of ["02", "0", "-1", "Infinity", "21"]) {
    await assert.rejects(
      runGen({
        cwd: dir,
        args: ["--try", "--takes", badTakes],
        env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: "http://127.0.0.1:9" },
      }),
      /--takes requires an integer between 1 and 20/,
    );
  }

  // 2. GenVoice remote https:// apiBase must reject loopback http://127.0.0.1 audio_url
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });
  let fetchStep = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetchStep++;
    if (fetchStep === 1) {
      return new Response(JSON.stringify({ id: "task_ssrf" }), { status: 200 });
    }
    if (fetchStep === 2) {
      return new Response(
        JSON.stringify({
          status: "completed",
          result: { audio_url: "http://127.0.0.1:9999/secret.mp3" },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Should not fetch untrusted audio_url: ${url}`);
  };
  await assert.rejects(
    tts({
      voiceId: "v_echo",
      text: "Hello.",
      out: join(dir, "voice/takes/01.mp3"),
      provider: "genvoice",
      apiKey: "gv_test",
      apiBase: "https://api.genvoice.pro/v1",
      pollIntervalMs: 5,
    }),
    /Refusing insecure|loopback/i,
  );
  globalThis.fetch = origFetch;

  // 3. runAssemble rejects soundSources.narration or soundTimeline escaping the film directory
  writeFileSync(join(dir, "voice/takes/01.wav"), makeTinyWavBuffer(0.5));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundSources: { narration: "../voice-sec-outside/pwned.wav" },
      },
    }),
  );
  await assert.rejects(runAssemble({ cwd: dir }), /inside film directory/i);
  assert.equal(existsSync(join(outside, "pwned.wav")), false);

  // 4. mix.py rejects filtergraph injection (amovie=...) and out-of-root soundSources
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(join(dir, "sound/sfx/tap.wav"), makeTinyWavBuffer(0.3));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        soundSources: { outside_clip: "../voice-sec-outside/secret.wav" },
      },
    }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ at: 0, name: "tap", gain: 0, filters: ["amovie=/etc/passwd"] }],
    }),
  );
  const badFilterPy = spawnSync(
    "python",
    [join(ROOT, "scripts/sound/mix.py"), "--raw", join(dir, "out.wav")],
    { cwd: dir, encoding: "utf8", timeout: 15000 },
  );
  assert.notEqual(badFilterPy.status, 0);
  assert.match(badFilterPy.stderr, /Unsafe or invalid ffmpeg audio filter/);

  writeFileSync(join(outside, "secret.wav"), makeTinyWavBuffer(0.3));
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ at: 0, name: "outside_clip", gain: 0 }],
    }),
  );
  const badPathPy = spawnSync(
    "python",
    [join(ROOT, "scripts/sound/mix.py"), "--raw", join(dir, "out.wav")],
    { cwd: dir, encoding: "utf8", timeout: 15000 },
  );
  assert.notEqual(badPathPy.status, 0);
  assert.match(badPathPy.stderr, /Audio source escapes film directory/);
});

test("genvoice tts blocks private/metadata IPs, IPv4-mapped IPv6, trailing-dot localhost, and private DNS answers on remote apiBase", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-ssrf-r2-"));
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const blockedUrls = [
    "https://169.254.169.254/latest/meta-data/iam",
    "https://10.0.0.5/internal.mp3",
    "https://100.100.100.200/cgnat.mp3",
    "https://[::ffff:127.0.0.1]/mapped.mp3",
    "https://localhost./trailing-dot.mp3",
    "https://rebind.cdn.example/audio.mp3",
  ];

  for (const targetUrl of blockedUrls) {
    let step = 0;
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      step++;
      if (step === 1) return new Response(JSON.stringify({ id: "task_ssrf2" }), { status: 200 });
      if (step === 2) {
        return new Response(
          JSON.stringify({ status: "completed", result: { audio_url: targetUrl } }),
          { status: 200 },
        );
      }
      throw new Error(`UNEXPECTED_FETCH_REACHED: ${url}`);
    };
    await assert.rejects(
      tts({
        voiceId: "v_echo",
        text: "Test.",
        out: join(dir, "01.mp3"),
        provider: "genvoice",
        apiKey: "gv_test",
        apiBase: "https://api.genvoice.pro/v1",
        pollIntervalMs: 5,
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
      /private|loopback|non-global|Refusing/i,
      `Expected SSRF rejection for ${targetUrl}`,
    );
  }
});

test("genvoice tts rejects oversized audio_url payloads exceeding MAX_AUDIO_BYTES", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-size-r2-"));
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  let step = 0;
  globalThis.fetch = async () => {
    step++;
    if (step === 1) return new Response(JSON.stringify({ id: "task_big" }), { status: 200 });
    if (step === 2) {
      return new Response(
        JSON.stringify({
          status: "completed",
          result: { audio_url: "https://cdn.genvoice.pro/big.mp3" },
        }),
        { status: 200 },
      );
    }
    return new Response(new Uint8Array(16), {
      status: 200,
      headers: { "content-length": String(128 * 1024 * 1024) },
    });
  };

  await assert.rejects(
    tts({
      voiceId: "v_echo",
      text: "Big.",
      out: join(dir, "01.mp3"),
      provider: "genvoice",
      apiKey: "gv_test",
      apiBase: "https://api.genvoice.pro/v1",
      pollIntervalMs: 5,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
    /exceeds|too large|size limit/i,
  );
});

test("runGen rejects junction-escaped voice/takes directories before calling TTS API", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "voice-gen-confine-"));
  const outside = mkdtempSync(join(tmpdir(), "voice-gen-outside-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ takes: [{ id: "01", text: "Hello." }] }),
  );
  symlinkSync(outside, join(dir, "voice/takes"), "junction");

  let apiCalled = false;
  const baseUrl = await listenServer(t, (_req, res) => {
    apiCalled = true;
    res.writeHead(500);
    res.end();
  });

  await assert.rejects(
    runGen({
      cwd: dir,
      args: [],
      env: { ELEVENLABS_API_KEY: "el_test", ELEVENLABS_API_BASE: `${baseUrl}/v1` },
    }),
    /inside|escapes|symlink/i,
  );
  assert.equal(apiCalled, false);
  assert.equal(existsSync(join(outside, "01.mp3")), false);
});

test("mix.py rejects file-writing audio filters outside the stateless DSP allowlist", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mix-allowlist-r2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(join(dir, "sound/sfx/tap.wav"), makeTinyWavBuffer(0.2));
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 2, voice: { lines: [], warp: [] } }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ at: 0, name: "tap", gain: 0, filters: ["firequalizer=dumpfile=pwned.txt"] }],
    }),
  );

  const py = spawnSync(
    "python",
    [join(ROOT, "scripts/sound/mix.py"), "--raw", join(dir, "out.wav")],
    { cwd: dir, encoding: "utf8", timeout: 15000 },
  );
  assert.notEqual(py.status, 0);
  assert.match(py.stderr, /Unsafe or invalid ffmpeg audio filter/);
  assert.equal(existsSync(join(dir, "pwned.txt")), false);
});
