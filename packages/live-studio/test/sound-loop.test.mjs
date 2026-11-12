import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loopPasses, loopPeriod } from "../app/sound/loop.ts";

const SR = 48000;
// The looped stream every renderer must make of file x (interleaved stereo, D frames) at stream frame p: pass k starts
// k periods in, fades in on sin over its first xf frames (all but the first) and out on cos over its last
const stream = (x, D, p, c) => {
  const xf = Math.min(1.5 * SR, Math.floor(D / 4)),
    P = D - xf;
  let want = 0;
  for (let k = 0; k * P <= p; k++) {
    const u = p - k * P;
    if (u >= D) continue;
    let w = 1;
    if (k > 0 && u < xf) w *= Math.sin((Math.PI / 2) * (u / xf));
    if (u >= P) w *= Math.cos((Math.PI / 2) * ((u - P) / xf));
    want += x(u, c) * w;
  }
  return want;
};

const PROCESS = fileURLToPath(new URL("../../../scripts/sound/process.py", import.meta.url));

test("a looped bed plays its file in passes that overlap by the crossfade, the first never faded in", () => {
  // a 4 s file crossfades over a quarter of itself (1 s, under the 1.5 s cap), so each pass starts 3 s after the last
  assert.equal(loopPeriod(4), 3);
  assert.equal(loopPeriod(20), 18.5);
  assert.deepEqual(loopPasses(4, 1, 10), [
    { t: 0, offset: 1, end: 3, fadeIn: null, fadeOut: 2 },
    { t: 2, offset: 0, end: 6, fadeIn: 2, fadeOut: 5 },
    { t: 5, offset: 0, end: 9, fadeIn: 5, fadeOut: 8 },
    { t: 8, offset: 0, end: 10, fadeIn: 8, fadeOut: 11 },
  ]);

  // a bed that ends inside its file plays it as it is, with no pass and no fade
  assert.deepEqual(loopPasses(4, 2.5, 1), [
    { t: 0, offset: 2.5, end: 1, fadeIn: null, fadeOut: Infinity },
  ]);
  assert.deepEqual(loopPasses(4, 0, 4), [
    { t: 0, offset: 0, end: 4, fadeIn: null, fadeOut: Infinity },
  ]);
  // a start inside the overlap hears both passes mid-crossfade, as the rendered stream has them
  assert.deepEqual(loopPasses(4, 3.5, 2), [
    { t: 0, offset: 3.5, end: 0.5, fadeIn: null, fadeOut: -0.5 },
    { t: 0, offset: 0.5, end: 2, fadeIn: -0.5, fadeOut: 2.5 },
  ]);
});

for (const [start, len] of [
  [1, 10],
  [2.5, 2],
])
  test(`process.py loops a bed with the same equal-power crossfade, sample for sample (start ${start} s, ${len} s)`, () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-loop-"));
    const run = (exe, args, input) => {
      const r = spawnSync(exe, args, { cwd: dir, input, timeout: 60000 });
      assert.equal(r.status, 0, String(r.stderr));
    };
    try {
      // two ramps, so the end of the file differs from its start and a hard loop would jump
      run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=t/4|0.5-t/8:s=48000:d=4",
        "-c:a",
        "pcm_f32le",
        "src.wav",
      ]);
      run(
        "python",
        [PROCESS, "src.wav", "out.wav"],
        JSON.stringify({ start, duration: len, loop: true }),
      );
      const raw = (f) => {
        run("ffmpeg", ["-v", "error", "-y", "-i", f, "-f", "f32le", `${f}.raw`]);
        const b = readFileSync(join(dir, `${f}.raw`));
        return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
      };
      const x = raw("src.wav"),
        y = raw("out.wav");
      const D = x.length / 2;
      assert.equal(y.length / 2, len * SR);
      let worst = 0;
      for (let n = 0; n < len * SR; n += 97)
        for (const c of [0, 1])
          worst = Math.max(
            worst,
            Math.abs(y[n * 2 + c] - stream((u, ch) => x[u * 2 + ch], D, n + start * SR, c)),
          );
      assert.ok(worst < 1e-5, `largest difference ${worst}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("the preview plays the same stream through Web Audio, also when it joins mid-crossfade", async () => {
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./loop-page.ts", import.meta.url))],
    target: "browser",
  });
  assert.ok(built.success, String(built.logs));
  const js = await built.outputs[0].text();
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/page.js"
        ? new Response(js, { headers: { "content-type": "text/javascript" } })
        : new Response('<!doctype html><script type="module" src="/page.js"></script>', {
            headers: { "content-type": "text/html" },
          }),
  });
  const view = new Bun.WebView({ backend: { type: "chrome" } });
  try {
    await view.navigate(server.url.href);
    const ramp = (u, c) => (c ? 0.5 - u / SR / 8 : u / SR / 4);
    for (const [start, len, u0] of [
      [1, 10, 0],
      [2.5, 2, 0],
      [2.5, 1, 0.3],
      [1, 10, 5.4],
    ]) {
      const y = await view.evaluate(`renderLoop(${start}, ${len}, ${u0})`);
      let worst = 0;
      for (const c of [0, 1])
        y[c].forEach((v, i) => {
          const p = i * 97 + (start + u0) * SR;
          // a bed that ends inside its file is the file itself
          const want = start + len <= 4 ? ramp(p, c) : stream(ramp, 4 * SR, p, c);
          worst = Math.max(worst, Math.abs(v - want));
        });
      assert.ok(worst < 2e-4, `start ${start}, from ${u0}: largest difference ${worst}`);
    }
  } finally {
    view.close();
    server.stop(true);
  }
});
