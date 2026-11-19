import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";

test("exported excerpts keep a reverb tail and the history of a clip already playing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-reverb-span-"));
  const app = join(import.meta.dir, "../app");
  try {
    const entry = join(dir, "entry.ts");
    writeFileSync(
      entry,
      `
import { S } from ${JSON.stringify(join(app, "core/state.ts"))};
import { renderAudioSpan, setLive } from ${JSON.stringify(join(app, "sound/mixer.ts"))};
S.el = { audio: document.createElement("audio") };

window.checkReverb = async (space) => {
  const lanes = {
    beds: [],
    sfx: [{ name: "tone", at: 3.25, length: 2.5, gain: 0, reverb: { space, wet: 1, preDelayMs: 100 } }],
  };
  setLive(true, { lanes: () => lanes, library: () => [], span: () => [3.25, 5.75], voice: () => [] });
  const full = await renderAudioSpan(0, 7.5);
  const excerpts = [];
  for (const [from, to] of [[5.1, 5.7], [6, 6.75]]) {
    const clip = await renderAudioSpan(from, to);
    let peak = 0, maxError = 0;
    for (let c = 0; c < 2; c++) {
      const samples = clip.getChannelData(c);
      const reference = full.getChannelData(c).subarray(Math.round(from * full.sampleRate));
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(reference[i]));
        maxError = Math.max(maxError, Math.abs(samples[i] - reference[i]));
      }
    }
    excerpts.push({ frames: clip.length, expectedFrames: Math.round((to - from) * 48000), peak, maxError });
  }
  const meter = await window.__lanesRender(6, 6.75);
  return { excerpts, peak: meter.peak };
};`,
    );
    const [page, worklet] = await Promise.all([
      Bun.build({
        entrypoints: [entry],
        target: "browser",
        plugins: [
          {
            name: "studio-reverb-span-fixtures",
            setup(build) {
              build.onResolve({ filter: /^film\/edit$/ }, () => ({
                path: "edit",
                namespace: "fixture",
              }));
              build.onResolve({ filter: /brickwall\.worklet\.ts\?worker&url$/ }, () => ({
                path: "worklet",
                namespace: "fixture",
              }));
              build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
                contents:
                  path === "edit"
                    ? "export const EDIT = {}; export const fromSource = t => t; export const toSource = t => t;"
                    : 'export default "/worklet.js";',
                loader: "js",
              }));
            },
          },
        ],
      }),
      Bun.build({ entrypoints: [join(app, "sound/brickwall.worklet.ts")], target: "browser" }),
    ]);
    const tone = Buffer.alloc(3 * 48000 * 2);
    for (let i = 0; i < tone.length / 2; i++) {
      tone.writeInt16LE(Math.round(2800 * Math.sin((2 * Math.PI * 317 * i) / 48000)), 2 * i);
    }
    const impulse = Buffer.alloc(1.4 * 44100 * 2);
    impulse.writeInt16LE(12000, 2 * Math.round(0.75 * 44100));
    impulse.writeInt16LE(5800, 2 * Math.round(1.2 * 44100));
    const responses = new Map<string, [BodyInit, string]>([
      ["/", ['<!doctype html><script type="module" src="/page.js"></script>', "text/html"]],
      ["/page.js", [page.outputs[0], "text/javascript"]],
      ["/worklet.js", [worklet.outputs[0], "text/javascript"]],
      ["/api/sfx/tone.wav", [wrapPcm16ToWav(tone, 48000), "audio/wav"]],
      ["/api/sound/ir", [wrapPcm16ToWav(impulse, 44100), "audio/wav"]],
    ]);
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const asset = responses.get(new URL(req.url).pathname);
        return asset
          ? new Response(asset[0], { headers: { "content-type": asset[1] } })
          : new Response(null, { status: 404 });
      },
    });
    try {
      const browser = new Bun.WebView({ backend: { type: "chrome" } });
      try {
        await browser.navigate(server.url.href);
        for (const space of ["cave", "assets/ir/custom.wav"]) {
          const result = (await browser.evaluate(
            `window.checkReverb(${JSON.stringify(space)})`,
          )) as {
            excerpts: { frames: number; expectedFrames: number; peak: number; maxError: number }[];
            peak: number;
          };
          for (const { frames, expectedFrames, peak, maxError } of result.excerpts) {
            expect(frames).toBe(expectedFrames);
            expect(peak).toBeGreaterThan(0.0001);
            expect(maxError).toBeLessThan(0.0002);
          }
          expect(result.peak).toBeGreaterThan(0.0001);
        }
      } finally {
        browser.close();
      }
    } finally {
      server.stop(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
