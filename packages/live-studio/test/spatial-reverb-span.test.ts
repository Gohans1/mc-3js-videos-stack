import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";

async function withAudioPage(verify: (browser: Bun.WebView) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "studio-reverb-span-"));
  const app = join(import.meta.dir, "../app");
  const resolve = createRequire(join(app, "../package.json")).resolve;
  const three = resolve("three").replace(/three\.cjs$/, "three.module.js");
  try {
    const entry = join(dir, "entry.ts");
    writeFileSync(
      entry,
      `
import { EDIT } from "film/edit";
import { S } from ${JSON.stringify(join(app, "core/state.ts"))};
import { registerEngine } from ${JSON.stringify(join(app, "core/engine.ts"))};
import { setFilmSource } from ${JSON.stringify(join(app, "core/filmMeta.ts"))};
import { availableSpatialTargets, prepareSceneTargets, sceneCameraPoseAt, sceneTargetAt } from ${JSON.stringify(join(app, "sound/scene-spatial.ts"))};
import { Object3D, PerspectiveCamera, Scene } from ${JSON.stringify(three)};
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
};
window.checkNamed = async (disappears = false, at, to = 1.5) => {
  const makeDraw = () => {
    const scene = new Scene();
    const actor = new Object3D();
    actor.name = "elon";
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 5);
    camera.lookAt(0, 1.6, 0);
    const draw = t => {
      actor.position.set(12 * (t - 0.75), 1.6, 0);
      if (disappears && t >= (typeof disappears === "number" ? disappears : 0.45)) actor.removeFromParent();
      else if (!actor.parent) scene.add(actor);
    };
    draw.tools = { camera, scene };
    return draw;
  };
  const preview = makeDraw();
  preview(0.25);
  S.tools = preview.tools;
  S.t = 0.25;
  registerEngine({ buildAudioScene: async () => makeDraw() });
  const lanes = { beds: [], sfx: [{ name: "tone", at: 0, length: 1.5, gain: 0, spatial: { target: "elon", at } }] };
  setLive(true, {
    lanes: () => lanes, library: () => [], span: () => [0, 1.5], voice: () => [],
    camPose: sceneCameraPoseAt, targetPos: sceneTargetAt, prepareTargets: prepareSceneTargets,
  });
  const live = sceneTargetAt("elon", 0.25);
  let mix;
  try { mix = await renderAudioSpan(0, to); }
  catch (error) { return { error: error.message }; }
  if (to < 1.5) return { frames: mix.length };
  const rms = (channel, from, to) => {
    const part = mix.getChannelData(channel).subarray(from * 48000, to * 48000);
    return Math.sqrt(part.reduce((sum, sample) => sum + sample * sample, 0) / part.length);
  };
  return {
    live, restored: sceneTargetAt("elon", 0.25), names: availableSpatialTargets(),
    first: [rms(0, 0.1, 0.35), rms(1, 0.1, 0.35)],
    last: [rms(0, 1.05, 1.4), rms(1, 1.05, 1.4)],
  };
};
window.checkSceneListener = async (outputClock = false) => {
  const target = [8, 1.6, 5];
  EDIT.cam = [{t: 0, p: [0, 1.6, 5], l: outputClock ? [0, 1.6, 0] : {target: "look"}}];
  const shots = [{ t: 0, cameraClock: outputClock ? "output" : "scene" }];
  setFilmSource({ DURATION: 1, SHOTS: shots, SHOTS_OUT: shots, applyEdit() {} });
  EDIT.placed = { marked: { keys: [{ t: 0, at: target }] } };
  registerEngine({ buildAudioScene: async () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 5);
    camera.lookAt(...target);
    return Object.assign(() => {}, { tools: {camera} });
  } });
  const measure = async (spatial) => {
    const lanes = { beds: [], sfx: [{name: "tone", at: 0, length: 0.5, gain: 0, spatial}] };
    setLive(true, {
      lanes: () => lanes, library: () => [], span: () => [0, 0.5], voice: () => [],
      camPose: sceneCameraPoseAt, targetPos: sceneTargetAt, prepareTargets: prepareSceneTargets,
    });
    const mix = await renderAudioSpan(0, 0.5);
    return [0, 1].map(ch => mix.getChannelData(ch).reduce((sum, sample) => sum + sample * sample, 0));
  };
  return [await measure({ at: target }), await measure({ target: "marked" })];
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
        await verify(browser);
      } finally {
        browser.close();
      }
    } finally {
      server.stop(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("exported excerpts keep a reverb tail and the history of a clip already playing", async () => {
  await withAudioPage(async (browser) => {
    for (const space of ["cave", "assets/ir/custom.wav"]) {
      const result = (await browser.evaluate(`window.checkReverb(${JSON.stringify(space)})`)) as {
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
  });
}, 30000);

test("named scene anchors move between channels without replacing the preview scene", async () => {
  await withAudioPage(async (browser) => {
    const result = (await browser.evaluate("window.checkNamed()")) as {
      live: number[];
      restored: number[];
      names: string[];
      first: [number, number];
      last: [number, number];
    };
    expect(result.names).toContain("elon");
    expect(result.live).toEqual([-6, 1.6, 0]);
    expect(result.restored).toEqual(result.live);
    expect(result.first[0]).toBeGreaterThan(result.first[1] * 2);
    expect(result.last[1]).toBeGreaterThan(result.last[0] * 2);
  });
}, 30000);

test("named scene mixes fail on a missing anchor unless there is an XYZ fallback", async () => {
  await withAudioPage(async (browser) => {
    const missing = await browser.evaluate("window.checkNamed(true)");
    expect(missing).toEqual({ error: expect.stringMatching(/elon.*unavailable/) });
    const excerpt = await browser.evaluate("window.checkNamed(true, undefined, 0.4)");
    expect(excerpt).toEqual({ frames: 19_200 });
    const throughCut = await browser.evaluate("window.checkNamed(0.5, undefined, 0.5)");
    expect(throughCut).toEqual({ frames: 24_000 });
    const shortTail = await browser.evaluate("window.checkNamed(0.45, undefined, 0.485)");
    expect(shortTail).toEqual({ error: expect.stringMatching(/elon.*unavailable/) });
    const fallback = (await browser.evaluate("window.checkNamed(true, [8, 1.6, 5])")) as {
      first: [number, number];
      last: [number, number];
    };
    expect(fallback.first[0]).toBeGreaterThan(fallback.first[1] * 2);
    expect(fallback.last[1]).toBeGreaterThan(fallback.last[0] * 2);
  });
}, 30000);

test("world coordinates and placed anchors both use the scene-targeted listener", async () => {
  await withAudioPage(async (browser) => {
    for (const outputClock of [false, true]) {
      const powers = (await browser.evaluate(`window.checkSceneListener(${outputClock})`)) as [
        number,
        number,
      ][];
      for (const [left, right] of powers) {
        expect(left).toBeGreaterThan(0.1);
        expect(left / right).toBeCloseTo(1, 2);
      }
    }
  });
}, 30000);
