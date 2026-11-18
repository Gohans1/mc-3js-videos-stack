import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderRegion, retimeSrt, retimeWords } from "../src/voice-playground-region.mjs";

const dir = mkdtempSync(join(tmpdir(), "voice-region-physics-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const source = join(dir, "original.wav");
const wav = Buffer.alloc(44 + 4 * 48000 * 4);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(48000 * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let n = 0; n < 4 * 48000; n++) {
  wav.writeInt16LE(Math.round(6000 * Math.sin((n * 2 * Math.PI * 220) / 48000)), 44 + n * 4);
  wav.writeInt16LE(Math.round(7000 * Math.sin((n * 2 * Math.PI * 330) / 48000)), 46 + n * 4);
}
writeFileSync(source, wav);
const replacement = join(dir, "replacement.wav");
const replacementWav = Buffer.from(wav.subarray(0, 44 + 48000 * 4));
replacementWav.writeUInt32LE(replacementWav.length - 8, 4);
replacementWav.writeUInt32LE(replacementWav.length - 44, 40);
for (let n = 0; n < 48000; n++) {
  replacementWav.writeInt16LE(
    Math.round(6000 * Math.sin((n * 2 * Math.PI * 880) / 48000)),
    44 + n * 4,
  );
  replacementWav.writeInt16LE(
    Math.round(6000 * Math.sin((n * 2 * Math.PI * 880) / 48000)),
    46 + n * 4,
  );
}
writeFileSync(replacement, replacementWav);
const pcm = (path) =>
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-ar", "48000", "-ac", "2", "-f", "f32le", "-"],
    { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
const amplitude = (bytes, from, to, frequency) => {
  let sine = 0,
    cosine = 0;
  const first = Math.round(from * 48000),
    last = Math.round(to * 48000);
  for (let n = first; n < last; n++) {
    const sample = bytes.readFloatLE(n * 8);
    sine += sample * Math.sin((n * 2 * Math.PI * frequency) / 48000);
    cosine += sample * Math.cos((n * 2 * Math.PI * frequency) / 48000);
  }
  return (2 * Math.hypot(sine, cosine)) / (last - first);
};

test("a local section edit changes duration and gain while preserving all outside samples and the original file", async () => {
  const original = pcm(source);
  const result = await renderRegion(source, { from: 1, to: 2, rate: 2, gainDb: -6, pause: 0.2 });
  const output = join(dir, "edited.wav");
  writeFileSync(output, result.bytes);
  const edited = pcm(output);
  const bps = 48000 * 8;
  expect(edited.length / bps).toBeCloseTo(3.7, 3);
  expect(Buffer.compare(edited.subarray(0, bps), original.subarray(0, bps))).toBe(0);
  expect(Buffer.compare(edited.subarray(Math.round(1.7 * bps)), original.subarray(2 * bps))).toBe(
    0,
  );
  expect(readFileSync(source)).toEqual(wav);
  expect(result.durationSeconds).toBeCloseTo(3.7, 3);
  const ratio = amplitude(edited, 1.15, 1.4, 220) / amplitude(original, 1.15, 1.4, 220);
  expect(20 * Math.log10(ratio)).toBeCloseTo(-6, 0);
  expect(amplitude(edited, 1.15, 1.4, 220)).toBeGreaterThan(amplitude(edited, 1.15, 1.4, 440) * 10);
  expect(amplitude(edited, 1.6, 1.69, 220)).toBeLessThan(0.0001);
}, 30000);

test.each([
  [0, 1],
  [3, 4],
  [0, 4],
])(
  "editing the region %s..%s also supports clip edges",
  async (from, to) => {
    const result = await renderRegion(source, { from, to, rate: 1, gainDb: -3 });
    expect(result.durationSeconds).toBeCloseTo(4, 3);
  },
  30000,
);

test("an explicit octave change raises the selected tone while leaving the unselected tone unchanged", async () => {
  const result = await renderRegion(source, { from: 1, to: 3, pitch: 12 });
  const output = join(dir, "pitched.wav");
  writeFileSync(output, result.bytes);
  const edited = pcm(output);
  expect(amplitude(edited, 1.5, 2.5, 440)).toBeGreaterThan(amplitude(edited, 1.5, 2.5, 220) * 10);
  expect(amplitude(edited, 0.2, 0.8, 220)).toBeGreaterThan(amplitude(edited, 0.2, 0.8, 440) * 10);
  expect(result.durationSeconds).toBeCloseTo(4, 3);
}, 30000);

test.each([false, true])(
  "a replacement phrase preserves outside audio and can fit the original timing: %s",
  async (fitToSelection) => {
    const result = await renderRegion(source, { from: 1, to: 3, fitToSelection }, { replacement });
    const output = join(dir, `replaced-${fitToSelection}.wav`);
    writeFileSync(output, result.bytes);
    const edited = pcm(output),
      original = pcm(source),
      bps = 48000 * 8;
    expect(result.durationSeconds).toBeCloseTo(fitToSelection ? 4 : 3, 3);
    expect(Buffer.compare(edited.subarray(0, bps), original.subarray(0, bps))).toBe(0);
    expect(
      Buffer.compare(edited.subarray((fitToSelection ? 3 : 2) * bps), original.subarray(3 * bps)),
    ).toBe(0);
    expect(amplitude(edited, 1.25, 1.75, 880)).toBeGreaterThan(
      amplitude(edited, 1.25, 1.75, 220) * 10,
    );
  },
  30000,
);

test("local tempo changes move only selected word times and following audio, keeping a pause out of the preceding word", () => {
  const words = [
    { w: "Before", s: 0, e: 0.8 },
    { w: "Inside", s: 1, e: 2 },
    { w: "After", s: 2, e: 3 },
  ];
  const original = structuredClone(words);
  expect(retimeWords(words, { from: 1, to: 2, rate: 2, pause: 0.25 })).toEqual([
    { w: "Before", s: 0, e: 0.8 },
    { w: "Inside", s: 1, e: 1.5 },
    { w: "After", s: 1.75, e: 2.75 },
  ]);
  expect(words).toEqual(original);
});

test("existing subtitle cues follow the same edit including words crossing a region boundary", () => {
  const source =
    "1\n00:00:00,500 --> 00:00:01,500\nA phrase\n\n2\n00:00:02,000 --> 00:00:03,000\nNext phrase\n";
  expect(retimeSrt(source, { from: 1, to: 2, rate: 2, pause: 0.25 })).toBe(
    "1\n00:00:00,500 --> 00:00:01,250\nA phrase\n\n2\n00:00:01,750 --> 00:00:02,750\nNext phrase\n",
  );
});
