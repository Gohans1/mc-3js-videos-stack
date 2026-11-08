// The master limiter (app/sound/brickwall.ts) holds mix.py's alimiter ceiling: no sample past 0.45, the sound under it
// untouched, and back to unity within the release once the loud part has gone
import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTACK, Brickwall, CEILING, RELEASE } from "../app/sound/brickwall.ts";

const RATE = 48000;
const run = (chans, block = 128) => {
  const lim = new Brickwall(RATE, chans.length), out = chans.map((c) => new Float32Array(c.length));
  for (let f = 0; f < chans[0].length; f += block) {
    const n = Math.min(block, chans[0].length - f);
    lim.process(chans.map((c) => c.subarray(f, f + n)), out.map((c) => c.subarray(f, f + n)), n);
  }
  return { out, delay: lim.delay };
};
const sine = (secs, amp, hz = 220) => Float32Array.from({ length: secs * RATE }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));
const peak = (a, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i])); return m; };

test("a quiet sound passes untouched, ATTACK late", () => {
  const x = sine(1, 0.3), { out, delay } = run([x, x]);
  assert.equal(delay, Math.round(ATTACK * RATE));
  for (let i = delay; i < x.length; i++) assert.ok(Math.abs(out[0][i] - x[i - delay]) < 1e-6);
});

test("no sample goes past the ceiling, whatever comes in, on either side", () => {
  const l = sine(1, 0.3), r = sine(1, 0.3, 331);
  for (let i = 12000; i < 12010; i++) l[i] = 1.6; // a click, one side only
  for (let i = 24000; i < 36000; i++) r[i] *= 4; // a loud stretch
  const { out } = run([l, r], 97);
  assert.ok(peak(out[0]) <= CEILING + 1e-6, `left ${peak(out[0])}`);
  assert.ok(peak(out[1]) <= CEILING + 1e-6, `right ${peak(out[1])}`);
  assert.ok(peak(out[1], 30000, 33000) > CEILING * 0.98, "the loud stretch sits at the ceiling, not under it");
});

test("the gain eases down before a hit and is back to unity a release after it", () => {
  const x = sine(1, 0.3);
  x[24000] = 0.9;
  const { out, delay } = run([x]), at = (i) => out[0][i + delay] / x[i];
  assert.ok(Math.abs(at(24000 - Math.round(ATTACK * RATE) - 2) - 1) < 1e-3, "untouched before the look-ahead");
  assert.ok(at(24000 - Math.round(ATTACK * RATE / 2)) < 1 && at(24000 - Math.round(ATTACK * RATE / 2)) > 0.5, "on its way down");
  assert.ok(Math.abs(at(24000) * 0.9 - CEILING) < 1e-6, `the hit lands on the ceiling: ${at(24000) * 0.9}`);
  const back = 24000 + Math.round((RELEASE + 2 * ATTACK) * RATE) + 4;
  assert.ok(Math.abs(at(back) - 1) < 1e-3, `back to unity: ${at(back)}`);
});
