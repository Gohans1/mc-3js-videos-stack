import { expect, test } from "bun:test";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeWav,
  evaluateAudioWaitTick,
  inspectSpeechAudio,
  playbackIsFinal,
  saveNewFile,
} from "./audio";

function pcmFixture() {
  const wav = Buffer.alloc(48);
  wav.write("RIFF");
  wav.writeUInt32LE(40, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  return wav;
}

test("WAV export rejects a truncated player source", () => {
  const wav = pcmFixture();
  expect(decodeWav("data:audio/wav;base64," + wav.toString("base64"))).toEqual(wav);
  expect(() =>
    decodeWav("data:audio/wav;base64," + wav.subarray(0, 44).toString("base64")),
  ).toThrow("truncated");
  expect(() => decodeWav("data:audio/mp3;base64,YWJj")).toThrow("WAV");
  wav.fill(0, 12);
  expect(() => decodeWav("data:audio/wav;base64," + wav.toString("base64"))).toThrow("format");
});

test("WAV export repairs the observed AI Studio byte rate without changing samples", () => {
  const wav = pcmFixture();
  wav.writeUInt32LE(96_000, 28);
  wav.writeInt16LE(-2400, 44);
  wav.writeInt16LE(32767, 46);
  const decoded = decodeWav("data:audio/wav;base64," + wav.toString("base64"));
  expect(decoded.readUInt32LE(28)).toBe(48_000);
  expect(decoded.subarray(44)).toEqual(wav.subarray(44));
});

test("the idle Run and enabled Download interval can still hold a provisional speech chunk", () => {
  const provisional = {
    duration: 0.11,
    timelineEnd: 19,
    playing: true,
    mediaPaused: true,
    sourceSettled: true,
  };
  expect(playbackIsFinal(provisional)).toBe(false);
  expect(playbackIsFinal({ ...provisional, playing: false })).toBe(false);
  expect(playbackIsFinal({ ...provisional, timelineEnd: 0 })).toBe(false);
  expect(playbackIsFinal({ ...provisional, duration: 19.59, playing: false })).toBe(true);
  expect(playbackIsFinal({ ...provisional, duration: 19.59, mediaPaused: false })).toBe(true);
  expect(
    playbackIsFinal({ ...provisional, duration: 19.59, playing: false, sourceSettled: false }),
  ).toBe(false);
  expect(playbackIsFinal({ ...provisional, timelineEnd: 0, playing: false })).toBe(true);
  const evidence = {
    generating: false,
    controlsReady: true,
    hasSource: true,
    awaitingNewAudio: false,
    playback: provisional,
  };
  expect(inspectSpeechAudio(evidence).phase).toBe("streaming");
  expect(
    inspectSpeechAudio({
      ...evidence,
      playback: { ...provisional, duration: 19.59, playing: false },
    }),
  ).toEqual({ phase: "ready", duration: 19.59 });
});

test("saving a take keeps an existing file byte for byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "aistudio-tts-test-"));
  const output = join(root, "take.wav");
  try {
    await writeFile(output, "previous take");
    await expect(saveNewFile(output, Buffer.from("another take"))).rejects.toThrow(
      "already exists",
    );
    expect(await readFile(output, "utf8")).toBe("previous take");
    await saveNewFile(output, Buffer.from("forced take"), true);
    expect(await readFile(output, "utf8")).toBe("forced take");
  } finally {
    await unlink(output);
    await rmdir(root);
  }
});

test("evaluateAudioWaitTick ignores benign snackbars while generating or streaming", () => {
  const generating = evaluateAudioWaitTick({
    phase: "generating",
    duration: null,
    awaitingNewAudio: true,
    alert: "Added to favorites",
    submitted: true,
    idleSince: 0,
    now: 5_000,
    graceMs: 10_000,
  });
  expect(generating).toEqual({ action: "wait", idleSince: 0 });

  const streaming = evaluateAudioWaitTick({
    phase: "streaming",
    duration: null,
    awaitingNewAudio: false,
    alert: "Copied to clipboard",
    submitted: true,
    idleSince: 0,
    now: 8_000,
    graceMs: 10_000,
  });
  expect(streaming).toEqual({ action: "wait", idleSince: 0 });
});

test("evaluateAudioWaitTick fails fast on idle past grace instead of hanging until timeout", () => {
  const firstIdle = evaluateAudioWaitTick({
    phase: "idle",
    duration: null,
    awaitingNewAudio: true,
    alert: "",
    submitted: true,
    idleSince: 0,
    now: 1_000,
    graceMs: 10_000,
  });
  expect(firstIdle).toEqual({ action: "wait", idleSince: 1_000 });

  const alertWhileIdle = evaluateAudioWaitTick({
    phase: "idle",
    duration: null,
    awaitingNewAudio: true,
    alert: "Quota exceeded",
    submitted: true,
    idleSince: 1_000,
    now: 3_500,
    graceMs: 10_000,
  });
  expect(alertWhileIdle.action).toBe("fail");
  if (alertWhileIdle.action === "fail") {
    expect(alertWhileIdle.reason).toContain("AI Studio says: Quota exceeded");
    expect(alertWhileIdle.clearBaseline).toBe(true);
  }

  const silentFail = evaluateAudioWaitTick({
    phase: "idle",
    duration: null,
    awaitingNewAudio: true,
    alert: "",
    submitted: true,
    idleSince: 1_000,
    now: 12_000,
    graceMs: 10_000,
  });
  expect(silentFail.action).toBe("fail");
  if (silentFail.action === "fail") {
    expect(silentFail.reason).toContain("without producing audio");
    expect(silentFail.clearBaseline).toBe(true);
  }

  const collectIdle = evaluateAudioWaitTick({
    phase: "idle",
    duration: null,
    awaitingNewAudio: false,
    alert: "",
    submitted: false,
    idleSince: 0,
    now: 1_000,
    graceMs: 10_000,
  });
  expect(collectIdle.action).toBe("fail");
});
