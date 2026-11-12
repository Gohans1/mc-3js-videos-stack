// The master limiter (app/sound/brickwall.ts) holds mix.py's alimiter ceiling: no sample past 0.45, the sound under it
// untouched, and back to unity within the release once the loud part has gone
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { ATTACK, Brickwall, CEILING, RELEASE } from "../app/sound/brickwall.ts";

const RATE = 48000;
const run = (chans, block = 128) => {
  const lim = new Brickwall(RATE, chans.length),
    out = chans.map((c) => new Float32Array(c.length));
  for (let f = 0; f < chans[0].length; f += block) {
    const n = Math.min(block, chans[0].length - f);
    lim.process(
      chans.map((c) => c.subarray(f, f + n)),
      out.map((c) => c.subarray(f, f + n)),
      n,
    );
  }
  return { out, delay: lim.delay };
};
const sine = (secs, amp, hz = 220) =>
  Float32Array.from(
    { length: secs * RATE },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE),
  );
const peak = (a, from = 0, to = a.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};

for (const rate of [44100, 48000])
  test(`live limiter matches FFmpeg samples through stereo transients, sustained peaks and release at ${rate} Hz`, () => {
    const frames = Math.round(rate * 0.4),
      channels = 2;
    const input = new Float32Array(frames * channels);
    for (let i = 0; i < frames; i++)
      for (let c = 0; c < channels; c++) {
        const t = i / rate,
          loud = t > 0.08 && t < 0.18;
        input[i * channels + c] =
          (t < 0.28 ? (loud ? 1.6 : 0.2) : 0) * Math.sin(2 * Math.PI * (c ? 331 : 220) * t);
      }
    input[Math.round(rate * 0.025) * channels] = 2;
    input[Math.round(rate * 0.026) * channels + 1] = -3;
    const result = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "f32le",
        "-ar",
        String(rate),
        "-ac",
        "2",
        "-i",
        "pipe:0",
        "-af",
        "alimiter=limit=0.45:level=false",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { input: Buffer.from(input.buffer), timeout: 15000, maxBuffer: 2e6 },
    );
    assert.equal(result.status, 0, result.stderr?.toString());
    const expected = new Float32Array(
      result.stdout.buffer.slice(
        result.stdout.byteOffset,
        result.stdout.byteOffset + result.stdout.byteLength,
      ),
    );
    assert.equal(expected.length, input.length);
    for (const block of [97, 128]) {
      const limiter = new Brickwall(rate, channels),
        output = [new Float32Array(block), new Float32Array(block)];
      let error = 0;
      for (let offset = 0; offset < frames; offset += block) {
        const n = Math.min(block, frames - offset),
          chunk = [new Float32Array(n), new Float32Array(n)];
        for (let i = 0; i < n; i++)
          for (let c = 0; c < channels; c++) chunk[c][i] = input[(offset + i) * channels + c];
        limiter.process(chunk, output, n);
        for (let i = 0; i < n; i++)
          for (let c = 0; c < channels; c++)
            error = Math.max(error, Math.abs(output[c][i] - expected[(offset + i) * channels + c]));
      }
      assert.ok(error < 2e-7, `${block}-sample blocks: max error ${error}`);
    }
  });

test("a quiet sound passes untouched after FFmpeg's 239-sample look-ahead at 48 kHz", () => {
  const x = sine(1, 0.3),
    { out, delay } = run([x, x]);
  assert.equal(delay, 239);
  for (let i = delay; i < x.length; i++) assert.ok(Math.abs(out[0][i] - x[i - delay]) < 1e-6);
});

test("no sample goes past the ceiling, whatever comes in, on either side", () => {
  const l = sine(1, 0.3),
    r = sine(1, 0.3, 331);
  for (let i = 12000; i < 12010; i++) l[i] = 1.6; // a click, one side only
  for (let i = 24000; i < 36000; i++) r[i] *= 4; // a loud stretch
  const { out } = run([l, r], 97);
  assert.ok(peak(out[0]) <= CEILING + 1e-6, `left ${peak(out[0])}`);
  assert.ok(peak(out[1]) <= CEILING + 1e-6, `right ${peak(out[1])}`);
  assert.ok(
    peak(out[1], 30000, 33000) > CEILING * 0.98,
    "the loud stretch sits at the ceiling, not under it",
  );
});

test("the gain eases down before a hit and is back to unity a release after it", () => {
  const x = sine(1, 0.3);
  x[24000] = 0.9;
  const { out, delay } = run([x]),
    at = (i) => out[0][i + delay] / x[i];
  assert.ok(
    Math.abs(at(24000 - Math.round(ATTACK * RATE) - 2) - 1) < 1e-3,
    "untouched before the look-ahead",
  );
  assert.ok(
    at(24000 - Math.round((ATTACK * RATE) / 2)) < 1 &&
      at(24000 - Math.round((ATTACK * RATE) / 2)) > 0.5,
    "on its way down",
  );
  assert.ok(
    Math.abs(at(24000) * 0.9 - CEILING) < 1e-6,
    `the hit lands on the ceiling: ${at(24000) * 0.9}`,
  );
  const back = 24000 + Math.round((RELEASE + 2 * ATTACK) * RATE) + 4;
  assert.ok(Math.abs(at(back) - 1) < 1e-3, `back to unity: ${at(back)}`);
});
