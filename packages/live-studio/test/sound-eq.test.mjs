import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { coefficients, readEq, withBands, withCut, withShelf, withWidth } from "../app/sound/eq.ts";
import { playedPart, syncPoint } from "../app/sound/sync.ts";

test("readEq reads each cut with its slope, the shelves, the peaking bands and the width from the ffmpeg chain", () => {
  assert.deepEqual(readEq(undefined), {
    low: 0,
    lowSlope: 12,
    high: 0,
    highSlope: 12,
    lowShelf: { f: 120, g: 0 },
    highShelf: { f: 8000, g: 0 },
    bands: [],
    width: 1,
  });
  assert.deepEqual(
    readEq([
      "highpass=f=120:poles=2:w=0.5412",
      "highpass=f=120:poles=2:w=1.3066",
      "lowpass=f=9000:poles=1",
      "lowshelf=f=90:g=-3:t=q:w=0.7071",
      "equalizer=f=2500:t=q:w=1.4:g=-4",
      "extrastereo=m=0.4:c=0",
    ]),
    {
      low: 120,
      lowSlope: 24,
      high: 9000,
      highSlope: 6,
      lowShelf: { f: 90, g: -3 },
      highShelf: { f: 8000, g: 0 },
      bands: [{ f: 2500, q: 1.4, g: -4 }],
      width: 0.4,
    },
  );
});

test("withCut sets, replaces or removes one cut and keeps every other filter in place", () => {
  const chain = ["acompressor=threshold=0.2", "highpass=f=80:poles=2"];
  assert.deepEqual(withCut(chain, "low", 150), [
    "acompressor=threshold=0.2",
    "highpass=f=150:poles=2",
  ]);
  assert.deepEqual(withCut(chain, "high", 12000), [
    "acompressor=threshold=0.2",
    "highpass=f=80:poles=2",
    "lowpass=f=12000:poles=2",
  ]);
  assert.deepEqual(withCut(chain, "low", 0), ["acompressor=threshold=0.2"]);
  assert.equal(withCut(["highpass=f=80:poles=2"], "low", 0), undefined);
});

test("withCut writes 24 and 36 dB/oct as real-sound's Butterworth orders 4 and 6, and a new frequency keeps the slope", () => {
  const steep = withCut(["highpass=f=80:poles=2", "alimiter"], "low", 100, 24);
  assert.deepEqual(steep, [
    "highpass=f=100:poles=2:w=0.5412",
    "highpass=f=100:poles=2:w=1.3066",
    "alimiter",
  ]);
  assert.deepEqual(withCut(steep, "low", 150), [
    "highpass=f=150:poles=2:w=0.5412",
    "highpass=f=150:poles=2:w=1.3066",
    "alimiter",
  ]);
  assert.deepEqual(withCut(undefined, "high", 8000, 36), [
    "lowpass=f=8000:poles=2:w=0.5176",
    "lowpass=f=8000:poles=2:w=0.7071",
    "lowpass=f=8000:poles=2:w=1.9319",
  ]);
  assert.deepEqual(withCut(undefined, "high", 8000, 6), ["lowpass=f=8000:poles=1"]);
});

test("withShelf, withBands and withWidth add, replace or drop their own entries and leave the rest of the chain alone", () => {
  const shelf = withShelf(["alimiter"], "low", 90, -3);
  assert.deepEqual(shelf, ["alimiter", "lowshelf=f=90:g=-3:t=q:w=0.7071"]);
  assert.deepEqual(withShelf(shelf, "low", 90, 0), ["alimiter"]);
  assert.deepEqual(withShelf(shelf, "high", 9000, 2.5), [
    "alimiter",
    "lowshelf=f=90:g=-3:t=q:w=0.7071",
    "highshelf=f=9000:g=2.5:t=q:w=0.7071",
  ]);

  const banded = ["equalizer=f=1:t=q:w=1:g=1", "alimiter", "equalizer=f=2:t=q:w=1:g=2"];
  assert.deepEqual(withBands(banded, [{ f: 3000, q: 2, g: 4 }]), [
    "equalizer=f=3000:t=q:w=2:g=4",
    "alimiter",
  ]);
  assert.deepEqual(withBands(banded, []), ["alimiter"]);

  assert.deepEqual(withWidth(["alimiter"], 0.5), ["alimiter", "extrastereo=m=0.5:c=0"]);
  assert.equal(withWidth(["extrastereo=m=0.5:c=0"], 1), undefined);
});

// ffmpeg filters a unit impulse; the studio's coefficients run through the same difference equation must give it back
const ffmpegImpulse = (filter, n = 4096) => {
  const impulse = new Float32Array(n);
  impulse[0] = 0.5;
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "f32le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-i",
      "-",
      "-af",
      filter,
      "-f",
      "f32le",
      "-",
    ],
    { input: Buffer.from(impulse.buffer), maxBuffer: 1 << 24 },
  );
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(r.stdout.length, n * 4);
  return {
    impulse,
    out: new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4),
  };
};
const run = (sections, x) => {
  let y = Float64Array.from(x);
  for (const { b, a } of sections) {
    const out = new Float64Array(y.length);
    for (let n = 0; n < y.length; n++) {
      let v = 0;
      for (let k = 0; k < b.length; k++) if (n >= k) v += b[k] * y[n - k];
      for (let k = 1; k < a.length; k++) if (n >= k) v -= a[k] * out[n - k];
      out[n] = v / a[0];
    }
    y = out;
  }
  return y;
};

test("the studio previews every EQ entry the inspector writes with the filter ffmpeg renders", () => {
  for (const spec of [
    "highpass=f=120:poles=1",
    "highpass=f=120:poles=2",
    "highpass=f=120:poles=2:w=0.5412",
    "lowpass=f=6000:poles=1",
    "lowpass=f=6000:poles=2:w=1.9319",
    "lowshelf=f=90:g=-9:t=q:w=0.7071",
    "highshelf=f=9000:g=6:t=q:w=0.7071",
    "equalizer=f=2500:t=q:w=1.4:g=-4",
  ]) {
    const { impulse, out } = ffmpegImpulse(spec),
      ours = run(coefficients(spec, 48000), impulse);
    const worst = Math.max(...out.map((v, i) => Math.abs(v - ours[i])));
    assert.ok(worst < 1e-5, `${spec}: off by ${worst}`);
  }
  assert.equal(coefficients("acompressor=threshold=0.2", 48000), null);
  assert.equal(coefficients("lowshelf=f=90:g=-9", 48000), null, "ffmpeg's own shelf width");
});

test("syncPoint finds real-sound's start, attack, peak and end on a decoded sound", () => {
  const rate = 48000,
    left = new Float32Array(rate / 2),
    right = new Float32Array(rate / 2);
  const fill = (ch, from, to, v) => ch.fill(v, Math.round(from * rate), Math.round(to * rate));
  fill(left, 0.1, 0.2, 0.05); // a breath 26 dB under the peak is not the attack
  fill(left, 0.2, 0.3, 0.5);
  fill(right, 0.3, 0.3025, 1); // the loudest 5 ms, on one side only
  fill(left, 0.3025, 0.4, 0.3);
  fill(left, 0.4, 0.45, 0.004); // a tail above real-sound's -50 dB end
  fill(left, 0.45, 0.5, 0.002);
  assert.equal(syncPoint([left, right], rate, "start"), 0);
  assert.equal(syncPoint([left, right], rate, "attack"), 0.2);
  assert.equal(syncPoint([left, right], rate, "peak"), 0.3025);
  assert.equal(syncPoint([left, right], rate, "end"), (0.45 * rate - 1) / rate);
});

test("a reversed clip syncs on the samples it plays, back to front", () => {
  const rate = 1000,
    hit = new Float32Array(2000).map((_, i) => (i < 500 ? 0 : Math.exp(-(i - 500) / 200)));
  const forward = playedPart([hit], 500, 1500, false),
    back = playedPart([hit], 500, 1500, true);
  assert.equal(syncPoint(forward, rate, "peak"), 0.002);
  assert.equal(syncPoint(back, rate, "peak"), 0.997);
  assert.equal(hit[500], 1, "the source is left as it was");
});
