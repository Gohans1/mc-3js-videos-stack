import assert from "node:assert/strict";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { createApi } from "../src/api.mjs";
import { buildVoiceMap } from "../src/voice-map.mjs";
import { openVoice } from "../src/voice.mjs";

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeTempFilm = () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-voice-test-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "voice/try"), { recursive: true });
  mkdirSync(join(dir, "assets/public"), { recursive: true });

  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      voice: { lines: [[4.3, 5.155]], edits: {}, warp: [] },
      takes: [
        { id: "01", t: 4.3, text: "[low, quiet] He opens his eyes." },
        { id: "02", t: 9.2, voice: "99Hm6N8psCBzc1JwEVR2", text: "[hushed] Bare concrete." },
      ],
      beats: {},
    }),
  );

  writeFileSync(join(dir, "voice/takes/01.mp3"), Buffer.from("ID3-take-01-audio-bytes"));
  writeFileSync(
    join(dir, "voice/takes/01.mp3.words.json"),
    JSON.stringify({
      text: "He opens his eyes.",
      dur: 1.12,
      words: [
        { w: "He", s: 0.1, e: 0.25 },
        { w: "opens", s: 0.28, e: 0.56 },
        { w: "his", s: 0.58, e: 0.71 },
        { w: "eyes.", s: 0.73, e: 0.955 },
      ],
    }),
  );
  writeFileSync(join(dir, "voice/try/01_1.mp3"), Buffer.from("ID3-try-01-1-alternate-bytes"));
  writeFileSync(
    join(dir, "voice/try/01_1.mp3.words.json"),
    JSON.stringify({
      text: "He opens his eyes.",
      dur: 1.28,
      words: [{ w: "He", s: 0.08, e: 1.05 }],
    }),
  );
  return dir;
};

describe("openVoice & /api/voice endpoints", () => {
  test("lists script takes with word alignment durations, unrendered status, and try takes", async () => {
    const dir = makeTempFilm();
    const events = [];
    const voice = openVoice(dir, {
      soundSources: { narration: "assets/public/agent/full_voice.wav" },
    });
    const app = createApi(
      {
        voice,
        sound: null,
        PUBLIC: join(dir, "assets/public"),
        LITE: join(dir, "renders/live/lite"),
        openRead: (file, range) => createReadStream(file, range),
      },
      {
        page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
        events: new Set(),
        send: (ev) => events.push(ev),
      },
    );

    const res = await app.request("/api/voice");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.narration, true);
    assert.equal(body.takes.length, 2);

    assert.equal(body.takes[0].id, "01");
    assert.equal(body.takes[0].file, "01.mp3");
    assert.equal(body.takes[0].seconds, 1.12);
    assert.equal(body.takes[0].words, 4);
    assert.equal(body.takes[0].aligned, true);
    assert.deepEqual(body.takes[0].tries, ["01_1.mp3"]);

    assert.equal(body.takes[1].id, "02");
    assert.equal(body.takes[1].file, null);
    assert.equal(body.takes[1].aligned, false);
  });

  test("streams voice take and try MP3s with audio/mpeg and byte-range 206 support while blocking traversal", async () => {
    const dir = makeTempFilm();
    const outside = mkdtempSync(join(tmpdir(), "studio-voice-outside-"));
    tempDirs.push(outside);
    const secretFile = join(outside, "secret.mp3");
    writeFileSync(secretFile, "outside-secret");
    try {
      symlinkSync(secretFile, join(dir, "voice/takes/leak.mp3"));
    } catch {
      // Windows without symlink privilege skips symlink creation cleanly
    }

    const voice = openVoice(dir, {});
    const app = createApi(
      {
        voice,
        sound: null,
        PUBLIC: join(dir, "assets/public"),
        LITE: join(dir, "renders/live/lite"),
        openRead: (file, range) => createReadStream(file, range),
      },
      {
        page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
        events: new Set(),
        send: () => {},
      },
    );

    const full = await app.request("/api/voice/audio/takes/01.mp3");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "audio/mpeg");
    assert.equal(await full.text(), "ID3-take-01-audio-bytes");

    const ranged = await app.request("/api/voice/audio/try/01_1.mp3", {
      headers: { range: "bytes=0-11" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "ID3-try-01-1");

    for (const bad of [
      "/api/voice/audio/takes/..%2F..%2Fsrc%2Fedit.json",
      "/api/voice/audio/other/01.mp3",
      "/api/voice/audio/takes/leak.mp3",
      "/api/voice/audio/takes/missing.mp3",
    ]) {
      const blocked = await app.request(bad);
      assert.equal(blocked.status, 404, `expected 404 for ${bad}`);
    }

    // Exercise realpathSync + inside() containment via directory junction (works without admin privilege on Windows)
    const juncDir = makeTempFilm();
    rmSync(join(juncDir, "voice/try"), { recursive: true, force: true });
    symlinkSync(outside, join(juncDir, "voice/try"), "junction");
    const juncVoice = openVoice(juncDir, {});
    assert.equal(juncVoice.audioFile("try", "secret.mp3"), null);
  });

  test("swaps a try take into voice/takes non-destructively (backing up original) and rejects mismatched IDs", async () => {
    const dir = makeTempFilm();
    // Provide real MPEG-1 Layer III frames for 01_1.mp3 so pre-assembly ffmpeg probe validates real audio
    const mp3Frame = Buffer.alloc(417);
    mp3Frame[0] = 0xff;
    mp3Frame[1] = 0xfb;
    mp3Frame[2] = 0x90;
    mp3Frame[3] = 0xc0;
    const validTryMp3 = Buffer.concat(Array.from({ length: 12 }, () => mp3Frame));
    writeFileSync(join(dir, "voice/try/01_1.mp3"), validTryMp3);
    const sent = [];
    const voice = openVoice(dir, {});
    const app = createApi(
      {
        voice,
        sound: null,
        PUBLIC: join(dir, "assets/public"),
        LITE: join(dir, "renders/live/lite"),
        openRead: (file, range) => createReadStream(file, range),
      },
      {
        page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
        events: new Set(),
        send: (e) => sent.push(e),
      },
    );

    const bad = await app.request("/api/voice/use-try", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ takeId: "02", tryFile: "01_1.mp3" }),
    });
    assert.equal(bad.status, 400);

    const ok = await app.request("/api/voice/use-try", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ takeId: "01", tryFile: "01_1.mp3" }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.takes[0].seconds, 1.28);
    assert.ok(
      body.takes[0].tries.includes("01_orig.mp3"),
      "original take backed up into voice/try/01_orig.mp3",
    );
    assert.ok(sent.includes("voice"));

    const swappedAudio = await app.request("/api/voice/audio/takes/01.mp3");
    assert.deepEqual(Buffer.from(await swappedAudio.arrayBuffer()), validTryMp3);
  });

  test("computes accurate MP3 duration from MPEG Layer III headers when .words.json is absent", async () => {
    const dir = makeTempFilm();
    // Build a valid 20-frame MPEG-1 Layer III 128kbps 44.1kHz mono MP3 with an ID3v2 header (no .words.json)
    // MPEG-1 (11), Layer III (01), no CRC (1) => 0xFF 0xFB; 128kbps (1001), 44100Hz (00), pad 0, priv 0 => 0x90; Mono (11) => 0xC0
    // Frame length = floor(144 * 128000 / 44100) = 417 bytes; 20 frames = 8340 audio bytes => 8340 * 8 / 128000 = 0.52125s -> 0.521s
    const id3 = Buffer.from([
      0x49,
      0x44,
      0x33,
      0x04,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x0a,
      ...Buffer.alloc(10),
    ]);
    const frame = Buffer.alloc(417);
    frame[0] = 0xff;
    frame[1] = 0xfb;
    frame[2] = 0x90;
    frame[3] = 0xc0;
    const mp3 = Buffer.concat([id3, ...Array.from({ length: 20 }, () => frame)]);
    writeFileSync(join(dir, "voice/takes/02.mp3"), mp3);

    const voice = openVoice(dir, {});
    const body = voice.read();
    const take02 = body.takes.find((t) => t.id === "02");
    assert.equal(take02.file, "02.mp3");
    assert.equal(take02.aligned, false);
    assert.equal(take02.seconds, 0.521);
  });

  test("useTry clears stale .words.json on unaligned tries, handles .mp3<->.wav swaps cleanly, and reassembles full_voice.wav", async () => {
    const dir = makeTempFilm();
    // Create a valid PCM WAV helper (48kHz mono 16-bit)
    const makePcmWav = (durationSec, amp = 12000) => {
      const sr = 48000;
      const samples = Math.round(sr * durationSec);
      const buf = Buffer.alloc(44 + samples * 2);
      buf.write("RIFF", 0);
      buf.writeUInt32LE(36 + samples * 2, 4);
      buf.write("WAVEfmt ", 8);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(sr, 24);
      buf.writeUInt32LE(sr * 2, 28);
      buf.writeUInt16LE(2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write("data", 36);
      buf.writeUInt32LE(samples * 2, 40);
      for (let i = 0; i < samples; i++) {
        buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * amp), 44 + i * 2);
      }
      return buf;
    };

    // Place silent initial full_voice.wav so we can verify useTry reassembles real audio into it
    mkdirSync(join(dir, "assets/public/agent"), { recursive: true });
    const fullVoicePath = join(dir, "assets/public/agent/full_voice.wav");
    writeFileSync(fullVoicePath, makePcmWav(6.0, 0));

    // 1. Add an unaligned MP3 try (20 frames = 0.521s, NO .words.json)
    const frame = Buffer.alloc(417);
    frame[0] = 0xff;
    frame[1] = 0xfb;
    frame[2] = 0x90;
    frame[3] = 0xc0;
    writeFileSync(
      join(dir, "voice/try/01_unaligned.mp3"),
      Buffer.concat(Array.from({ length: 20 }, () => frame)),
    );

    // 2. Add a cross-extension aligned WAV try (01_alt.wav + 01_alt.wav.words.json)
    writeFileSync(join(dir, "voice/try/01_alt.wav"), makePcmWav(0.8, 16000));
    writeFileSync(
      join(dir, "voice/try/01_alt.wav.words.json"),
      JSON.stringify({
        dur: 0.8,
        words: [
          { w: "He", s: 0.05, e: 0.25 },
          { w: "wakes.", s: 0.3, e: 0.72 },
        ],
      }),
    );

    let assembleCalls = 0;
    const voice = openVoice(
      dir,
      { soundSources: { narration: "assets/public/agent/full_voice.wav" } },
      {
        onAssemble: () => {
          assembleCalls++;
        },
      },
    );

    // Promote unaligned MP3 try over aligned 01.mp3 -> stale 01.mp3.words.json MUST be removed!
    const afterUnaligned = await voice.useTry({ takeId: "01", tryFile: "01_unaligned.mp3" });
    assert.equal(
      afterUnaligned.takes[0].aligned,
      false,
      "unaligned try must not inherit previous take's .words.json",
    );
    assert.equal(afterUnaligned.takes[0].words, 0);
    assert.equal(afterUnaligned.takes[0].seconds, 0.521);
    assert.equal(existsSync(join(dir, "voice/takes/01.mp3.words.json")), false);
    assert.ok(afterUnaligned.takes[0].tries.includes("01_orig.mp3"));

    // Promote cross-extension 01_alt.wav over 01.mp3 -> 01.mp3 must be removed from voice/takes/, full_voice.wav rebuilt with loud signal
    const afterWav = await voice.useTry({ takeId: "01", tryFile: "01_alt.wav" });
    assert.equal(afterWav.takes[0].file, "01.wav");
    assert.equal(afterWav.takes[0].aligned, true);
    assert.equal(afterWav.takes[0].words, 2);
    assert.equal(
      existsSync(join(dir, "voice/takes/01.mp3")),
      false,
      "stale sibling 01.mp3 must be removed on cross-ext swap",
    );
    assert.ok(assembleCalls >= 2, `expected onAssemble hook to run, got ${assembleCalls}`);

    const vmap = JSON.parse(readFileSync(join(dir, "renders/live/voice_map.json"), "utf8"));
    assert.equal(vmap.lines.length, 1);
    assert.equal(vmap.lines[0].text, "He wakes.");
    assert.ok(
      vmap.peaks.some((p) => p > 0.1),
      "reassembled full_voice.wav must update voice_map peaks from real audio",
    );
    assert.equal(buildVoiceMap(dir).lines[0].text, "He wakes.");

    // 3. Promote a LONGER try take (2.2s) -> updates edit.json voice.lines and returns swapped span
    writeFileSync(join(dir, "voice/try/01_long.wav"), makePcmWav(2.2, 14000));
    writeFileSync(
      join(dir, "voice/try/01_long.wav.words.json"),
      JSON.stringify({
        dur: 2.2,
        words: [
          { w: "He", s: 0.1, e: 0.4 },
          { w: "slowly", s: 0.5, e: 1.2 },
          { w: "wakes.", s: 1.3, e: 2.05 },
        ],
      }),
    );
    const afterLong = await voice.useTry({ takeId: "01", tryFile: "01_long.wav" });
    assert.equal(afterLong.error, undefined);
    assert.deepEqual(afterLong.swapped, {
      takeId: "01",
      prevStart: 4.25,
      prevEnd: 5.05,
      prevSpokenStart: 4.3,
      prevSpokenEnd: 4.97,
      nextStart: 4.2,
      nextEnd: 6.4,
    });
    const updatedEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
    assert.deepEqual(updatedEdit.voice.lines, [[4.3, 6.25]]);

    // 4. Corrupt non-audio try file fails ffmpeg reassemble -> rolls back active take and returns 500
    writeFileSync(join(dir, "voice/try/01_corrupt.wav"), Buffer.from("NOT-A-VALID-WAV-FILE"));
    const failed = await voice.useTry({ takeId: "01", tryFile: "01_corrupt.wav" });
    assert.equal(failed.status, 500);
    assert.ok(typeof failed.error === "string" && failed.error.length > 0);
    assert.equal(buildVoiceMap(dir).lines[0].text, "He slowly wakes.");

    // 5. Radio-Edit-First (omitted t): promoting a longer Take 01 also reports downstream Take 02's shifted span in swappedSpans
    writeFileSync(join(dir, "voice/takes/02.wav"), makePcmWav(0.9, 12000));
    writeFileSync(
      join(dir, "voice/takes/02.wav.words.json"),
      JSON.stringify({
        dur: 0.9,
        words: [
          { w: "Bare", s: 0.05, e: 0.4 },
          { w: "stone.", s: 0.45, e: 0.8 },
        ],
      }),
    );
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({
        end: 8,
        voice: { lines: [], edits: {}, warp: [] },
        takes: [
          { id: "01", text: "First." },
          { id: "02", text: "Bare stone." },
        ],
        beats: {},
      }),
    );
    await voice.useTry({ takeId: "01", tryFile: "01_alt.wav" }); // 0.8s -> 01: 0..0.8, 02: 1.2..2.1
    const radioSwap = await voice.useTry({ takeId: "01", tryFile: "01_long.wav" }); // 2.2s -> 01: 0..2.2, 02: 2.6..3.5
    assert.equal(radioSwap.error, undefined);
    assert.equal(
      voice.ownEditWrite(),
      true,
      "studio edit.json sync must be marked as ownEditWrite",
    );
    assert.deepEqual(
      radioSwap.swappedSpans.map(({ takeId, prevStart, prevEnd, nextStart, nextEnd }) => ({
        takeId,
        prevStart,
        prevEnd,
        nextStart,
        nextEnd,
      })),
      [
        { takeId: "01", prevStart: 0, prevEnd: 0.8, nextStart: 0, nextEnd: 2.2 },
        { takeId: "02", prevStart: 1.2, prevEnd: 2.1, nextStart: 2.6, nextEnd: 3.5 },
      ],
    );

    // 6. Promoting an unaligned try (01_unaligned.wav has no .words.json) when edit.voice is missing still initializes edit.voice.lines
    // with [spokenStart, spokenEnd] for mix.py BGM ducking instead of dropping the unaligned take!
    writeFileSync(join(dir, "voice/try/01_unaligned.wav"), makePcmWav(0.8, 12000));
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({
        end: 8,
        takes: [
          { id: "01", text: "Unaligned first." },
          { id: "02", text: "Aligned second." },
        ],
        beats: {},
      }),
    );
    const unalignedPromote = await voice.useTry({ takeId: "01", tryFile: "01_unaligned.wav" });
    assert.equal(unalignedPromote.error, undefined);
    const syncedEdit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
    assert.deepEqual(syncedEdit.voice.lines, [
      [0, 0.8],
      [1.25, 2.0],
    ]);

    // 7. First-time failed swap on Take 02 must NOT leave an orphan 02_orig.wav in voice/try/
    writeFileSync(join(dir, "voice/try/02_corrupt.wav"), Buffer.from("NOT-A-VALID-WAV-FILE"));
    const failed02 = await voice.useTry({ takeId: "02", tryFile: "02_corrupt.wav" });
    assert.equal(failed02.status, 500);
    assert.equal(
      existsSync(join(dir, "voice/try/02_orig.wav")),
      false,
      "failed first swap must roll back newly created 02_orig.wav",
    );
    assert.equal(existsSync(join(dir, "voice/try/02_orig.wav.words.json")), false);

    // 8. Intra-directory symlinks inside voice/try/ or voice/takes/ must be rejected by audioFile
    let createdIntraSymlink = false;
    try {
      symlinkSync(join(dir, "voice/takes/02.wav"), join(dir, "voice/try/02_sym.wav"));
      createdIntraSymlink = true;
    } catch {
      createdIntraSymlink = false;
    }
    if (createdIntraSymlink) {
      assert.equal(
        voice.audioFile("try", "02_sym.wav"),
        null,
        "intra-film symlink in voice/try must be rejected",
      );
    }

    // 9. Pre-assembly (no full_voice.wav yet) must still probe tryFile decodability before overwriting active take or leaving _orig
    rmSync(join(dir, "assets/public/agent/full_voice.wav"), { force: true });
    const activeBeforePre = readFileSync(join(dir, "voice/takes/02.wav"));
    const failedPre = await voice.useTry({ takeId: "02", tryFile: "02_corrupt.wav" });
    assert.equal(failedPre.status, 422);
    assert.equal(existsSync(join(dir, "voice/try/02_orig.wav")), false);
    assert.equal(Buffer.compare(readFileSync(join(dir, "voice/takes/02.wav")), activeBeforePre), 0);
  });

  test("openVoice ignores symlinked .words.json sidecars and invalidates cached read() on edit or try changes", () => {
    const dir = makeTempFilm();
    const outside = mkdtempSync(join(tmpdir(), "voice-outside-words-"));
    try {
      const extWords = join(outside, "02.words.json");
      writeFileSync(
        extWords,
        JSON.stringify({ dur: 9.9, words: [{ w: "Injected", s: 0.1, e: 0.9 }] }),
      );
      const frame = Buffer.alloc(417);
      frame[0] = 0xff;
      frame[1] = 0xfb;
      frame[2] = 0x90;
      frame[3] = 0xc0;
      writeFileSync(
        join(dir, "voice/takes/02.mp3"),
        Buffer.concat(Array.from({ length: 20 }, () => frame)),
      );
      let linked = false;
      try {
        symlinkSync(extWords, join(dir, "voice/takes/02.mp3.words.json"));
        linked = true;
      } catch {
        linked = false;
      }

      const voice = openVoice(dir, {});
      const first = voice.read();
      const take02 = first.takes.find((t) => t.id === "02");
      if (linked) {
        assert.equal(
          take02.aligned,
          false,
          "symlinked .words.json outside film root must be ignored",
        );
        assert.equal(take02.words, 0);
      }

      // Warm cached read() returns the same snapshot reference until a new try file lands
      assert.equal(voice.read(), first);

      writeFileSync(
        join(dir, "voice/try/02_fresh.mp3"),
        Buffer.concat(Array.from({ length: 20 }, () => frame)),
      );
      const afterTry = voice.read();
      assert.notEqual(afterTry, first);
      assert.ok(afterTry.takes.find((t) => t.id === "02").tries.includes("02_fresh.mp3"));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
