import { describe, expect, test } from "bun:test";
import { createReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateImpulseResponse, resolveClipReverb, REVERB_SPACES } from "../app/sound/ir.ts";
import { computeJCutStart, computeLCutEnd, shotCutOverlaps } from "../app/sound/jlcut.ts";
import { computeSpatialParams, isSpatialActive, offsetPosition } from "../app/sound/spatial.ts";
import { createApi } from "../src/api.mjs";
import { SOUND_KEYS } from "../src/contract-keys.ts";
import { ReverbSpec, ShotSpace, SoundTimeline, SpatialSpec } from "../src/contract.ts";

describe("IR synthesizer (ir.ts)", () => {
  test("produces identical deterministic 48kHz stereo buffers across repeated calls", () => {
    for (const space of REVERB_SPACES) {
      const a = generateImpulseResponse(space, 48000);
      const b = generateImpulseResponse(space, 48000);
      expect(a.left.length).toBe(b.left.length);
      expect(a.right.length).toBe(b.right.length);
      expect(a.left).toEqual(b.left);
      expect(a.right).toEqual(b.right);
      for (let i = 0; i < a.left.length; i++) {
        expect(Number.isFinite(a.left[i])).toBe(true);
        expect(Number.isFinite(a.right[i])).toBe(true);
      }
    }
  });

  test("presets scale in decay duration and stereo decorrelation", () => {
    const small = generateImpulseResponse("small-room", 48000);
    const hall = generateImpulseResponse("hall", 48000);
    const cave = generateImpulseResponse("cave", 48000);
    const outdoor = generateImpulseResponse("outdoor", 48000);

    expect(hall.left.length).toBeGreaterThan(small.left.length);
    expect(cave.left.length).toBeGreaterThan(hall.left.length);

    // Tail energy decays over time (last 20% quieter than first 20%)
    const rmsSlice = (buf: Float32Array, a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / Math.max(1, b - a));
    };
    const earlyRms = rmsSlice(hall.left, 0, Math.floor(hall.left.length * 0.2));
    const lateRms = rmsSlice(hall.left, Math.floor(hall.left.length * 0.8), hall.left.length);
    expect(earlyRms).toBeGreaterThan(lateRms * 2);

    // Outdoor has sparser/quieter late tail relative to cave
    const outdoorLate = rmsSlice(
      outdoor.left,
      Math.floor(outdoor.left.length * 0.6),
      outdoor.left.length,
    );
    const caveEarly = rmsSlice(cave.left, 0, Math.floor(cave.left.length * 0.25));
    expect(caveEarly).toBeGreaterThan(outdoorLate);

    // Stereo L and R channels are distinct (decorrelated reflections/tail)
    let diff = 0;
    for (let i = 0; i < hall.left.length; i++) diff += Math.abs(hall.left[i] - hall.right[i]);
    expect(diff).toBeGreaterThan(1.0);
  });

  test("resolveClipReverb applies precedence: clip > matching shot space > film default", () => {
    const spaces = [
      { from: 0, to: 5, space: "outdoor", wet: 0.2 },
      { from: 5, to: 10, space: "cave", wet: 0.45 },
    ];
    const film = { space: "hall", wet: 0.3 };

    // Falls back to film default outside shots
    expect(resolveClipReverb(undefined, 12, spaces, film)).toEqual({
      space: "hall",
      wet: 0.3,
      preDelayMs: 18,
    });
    // Inherits shot space inside [5, 10)
    expect(resolveClipReverb(undefined, 6.5, spaces, film)).toEqual({
      space: "cave",
      wet: 0.45,
      preDelayMs: 24,
    });
    // Explicit clip dry overrides shot/film space
    expect(resolveClipReverb({ space: "dry" }, 6.5, spaces, film)).toBeNull();
    // Explicit clip override wins
    expect(
      resolveClipReverb({ space: "stairwell", wet: 0.5, preDelayMs: 12 }, 6.5, spaces, film),
    ).toEqual({
      space: "stairwell",
      wet: 0.5,
      preDelayMs: 12,
    });
  });
});

describe("3D spatial audio math (spatial.ts)", () => {
  const cam = {
    p: [0, 1.6, 5] as [number, number, number],
    l: [0, 1.6, 0] as [number, number, number],
  };

  test("computes exact center, hard-left, hard-right stereo pan from camera basis", () => {
    const center = computeSpatialParams(cam, [0, 1.6, 0], { at: [0, 1.6, 0] });
    expect(center.pan).toBeCloseTo(0, 6);
    expect(center.frontDot).toBeCloseTo(1, 6);
    expect(center.distance).toBeCloseTo(5, 6);

    const right = computeSpatialParams(cam, [4, 1.6, 5], { at: [4, 1.6, 5] });
    expect(right.pan).toBeCloseTo(1, 6);
    expect(right.frontDot).toBeCloseTo(0, 6);

    const left = computeSpatialParams(cam, [-4, 1.6, 5], { at: [-4, 1.6, 5] });
    expect(left.pan).toBeCloseTo(-1, 6);
    expect(left.frontDot).toBeCloseTo(0, 6);
  });

  test("applies inverse-clamped distance attenuation, behind-head shadow, and occlusion LPF", () => {
    const near = computeSpatialParams(cam, [0, 1.6, 3], {
      at: [0, 1.6, 3],
      refDistance: 2,
      maxDistance: 20,
      rolloff: 1,
    });
    const mid = computeSpatialParams(cam, [0, 1.6, -5], {
      at: [0, 1.6, -5],
      refDistance: 2,
      maxDistance: 20,
      rolloff: 1,
    });
    const farClamped = computeSpatialParams(cam, [0, 1.6, -50], {
      at: [0, 1.6, -50],
      refDistance: 2,
      maxDistance: 20,
      rolloff: 1,
    });

    expect(near.gain).toBeCloseTo(1, 6); // distance === refDistance === 2
    expect(mid.gain).toBeCloseTo(2 / (2 + (10 - 2)), 6); // 0.2
    expect(farClamped.gain).toBeCloseTo(2 / (2 + (20 - 2)), 6); // clamped at maxDistance=20 -> 0.1
    expect(mid.cutoffHz).toBeLessThan(near.cutoffHz);
    expect(farClamped.cutoffHz).toBeLessThan(mid.cutoffHz);

    const behind = computeSpatialParams(cam, [0, 1.6, 7], {
      at: [0, 1.6, 7],
      refDistance: 2,
    });
    expect(behind.frontDot).toBeCloseTo(-1, 6);
    expect(behind.cutoffHz).toBeCloseTo(5500, 1);

    const occluded = computeSpatialParams(cam, [0, 1.6, 3], {
      at: [0, 1.6, 3],
      refDistance: 2,
      occlusion: 1,
    });
    expect(occluded.cutoffHz).toBeCloseTo(380, 1);
    expect(occluded.gain).toBeCloseTo(0.45, 6);

    const noAir = computeSpatialParams(cam, [0, 1.6, 15], {
      at: [0, 1.6, 15],
      refDistance: 2,
      airAbsorption: false,
      occlusion: 0,
    });
    expect(noAir.cutoffHz).toBe(20000);
  });

  test("respects camera roll and offsetPosition helper", () => {
    // 90 deg roll rotates right vector onto camUp (+Y), so source above camera pans right
    const rolledCam = { ...cam, roll: 90 };
    const above = computeSpatialParams(rolledCam, [0, 5.6, 5], { at: [0, 5.6, 5] });
    expect(above.pan).toBeCloseTo(1, 5);

    expect(offsetPosition([1, 2, 3], [0.5, -1, 2])).toEqual([1.5, 1, 5]);
    expect(isSpatialActive({ target: "steve" })).toBe(true);
    expect(isSpatialActive({ refDistance: 2 })).toBe(false);
  });
});

describe("J-Cut / L-Cut helpers (jlcut.ts)", () => {
  test("detects shot cut overlap for leading and trailing edges", () => {
    const cuts = [0, 4, 9, 15];
    const jCut = shotCutOverlaps(3.25, 7.0, cuts);
    expect(jCut.cuts).toEqual([4]);
    expect(jCut.jLead).toEqual({ cut: 4, amount: 0.75 });
    expect(jCut.lTrail).toBeNull();

    const lCut = shotCutOverlaps(6.0, 9.8, cuts);
    expect(lCut.cuts).toEqual([9]);
    expect(lCut.lTrail?.cut).toBe(9);
    expect(lCut.lTrail?.amount).toBeCloseTo(0.8, 6);
  });

  test("computeJCutStart and computeLCutEnd clamp cleanly against neighbours and source room", () => {
    // Source trimIn allows going back from 4.0 to 3.4 (clamped by sourceRoom, not 3.25)
    const j = computeJCutStart({
      from: 4.0,
      to: 7.0,
      prevEnd: 1.0,
      nextStart: 12.0,
      minFrom: 3.4,
      maxTo: 8.5,
      minLength: 1 / 30,
      cutTimes: [4.0],
      leadSec: 0.75,
    });
    expect(j.changed).toBe(true);
    expect(j.target).toBeCloseTo(3.4, 6);

    // At start of audio file (minFrom === from): blocked by source, no change
    const jBlocked = computeJCutStart({
      from: 4.0,
      to: 7.0,
      prevEnd: 1.0,
      nextStart: 12.0,
      minFrom: 4.0,
      maxTo: 8.5,
      minLength: 1 / 30,
      cutTimes: [4.0],
    });
    expect(jBlocked.changed).toBe(false);
    expect(jBlocked.blockedBy).toBe("source");

    // L-Cut stops cleanly at next neighbour clip on same track
    const l = computeLCutEnd({
      from: 4.0,
      to: 7.0,
      prevEnd: 0.0,
      nextStart: 7.5,
      minFrom: 3.0,
      maxTo: 10.0,
      minLength: 1 / 30,
      cutTimes: [7.0],
      trailSec: 0.75,
    });
    expect(l.changed).toBe(true);
    expect(l.target).toBeCloseTo(7.5, 6);
  });
});

describe("Contract schema & key validation", () => {
  test("SOUND_KEYS matches contract schema shapes exactly", () => {
    const tlKeys = Object.keys(SoundTimeline.shape).sort();
    expect([...SOUND_KEYS.audio].sort()).toEqual(tlKeys);
    const bedKeys = Object.keys(SoundTimeline.shape.beds.element.shape).sort();
    expect([...SOUND_KEYS.beds].sort()).toEqual(bedKeys);
    const sfxKeys = Object.keys(SoundTimeline.shape.sfx.element.shape).sort();
    expect([...SOUND_KEYS.sfx].sort()).toEqual(sfxKeys);
  });

  test("validates safe reverb/spaces/spatial specs and blocks unsafe IR paths", () => {
    expect(ReverbSpec.safeParse({ space: "hall", wet: 0.3, preDelayMs: 15 }).success).toBe(true);
    expect(ReverbSpec.safeParse({ space: "assets/ir/vault_room.wav", wet: 0.25 }).success).toBe(
      true,
    );
    expect(ReverbSpec.safeParse({ space: "../secret.wav" }).success).toBe(false);
    expect(ReverbSpec.safeParse({ space: "/etc/passwd" }).success).toBe(false);
    expect(ReverbSpec.safeParse({ space: "C:\\Windows\\ir.wav" }).success).toBe(false);

    expect(ShotSpace.safeParse({ from: 2, to: 1, space: "cave" }).success).toBe(false);
    expect(
      SpatialSpec.safeParse({
        target: "steve",
        offset: [0, 1.6, 0],
        refDistance: 5,
        maxDistance: 2,
      }).success,
    ).toBe(false);

    const parsed = SoundTimeline.safeParse({
      beds: [
        {
          name: "music",
          from: 0,
          to: 10,
          gain: -14,
          fadeIn: 0.5,
          fadeOut: 0.5,
          reverb: { space: "hall", wet: 0.25 },
        },
      ],
      sfx: [
        {
          at: 3.5,
          name: "footstep",
          gain: -6,
          spatial: { target: "steve", refDistance: 2, maxDistance: 25, occlusion: 0.2 },
        },
      ],
      reverb: { space: "small-room", wet: 0.15 },
      spaces: [{ from: 3, to: 8, space: "cave", wet: 0.4 }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("/api/sound/ir security and serving", () => {
  test("serves film-local IR WAV inside project and blocks traversal / non-audio files", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "studio-ir-route-"));
    try {
      mkdirSync(join(tmp, "assets", "ir"), { recursive: true });
      const wavPath = join(tmp, "assets", "ir", "room.wav");
      writeFileSync(wavPath, Buffer.from("RIFF\x24\0\0\0WAVEfmt "));
      writeFileSync(join(tmp, "package.json"), "{}");

      const app = createApi(
        {
          PROJECT: tmp,
          PUBLIC: tmp,
          openRead: (file: string, range?: { start?: number; end?: number }) =>
            createReadStream(file, range),
          sound: { fileOf: () => null },
        },
        { page: { dir: tmp }, events: new Set() },
      );

      const okRes = await app.request("/api/sound/ir?path=assets/ir/room.wav");
      expect(okRes.status).toBe(200);

      const travRes = await app.request("/api/sound/ir?path=../secret.wav");
      expect([400, 403]).toContain(travRes.status);

      const absRes = await app.request("/api/sound/ir?path=/etc/passwd");
      expect(absRes.status).toBe(400);

      const jsonRes = await app.request("/api/sound/ir?path=package.json");
      expect(jsonRes.status).toBe(404);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Live mixer Web Audio routing + J/L-Cut Undo/Redo (mixer.ts & sound.ts)", () => {
  test("routes clips through ConvolverNode(normalize=false), DelayNode, BiquadFilterNode, StereoPannerNode and undoes J/L-Cuts", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "studio-mixer-spatial-"));
    try {
      const entry = join(tmp, "entry.ts");
      const outDir = join(tmp, "out");
      const studioDir = join(import.meta.dir, "..");
      writeFileSync(
        entry,
        [
          `export * as doc from ${JSON.stringify(join(studioDir, "app/core/doc.ts"))};`,
          `export * as mixer from ${JSON.stringify(join(studioDir, "app/sound/mixer.ts"))};`,
          `export * as sound from ${JSON.stringify(join(studioDir, "app/sound/sound.ts"))};`,
          `export * as state from ${JSON.stringify(join(studioDir, "app/core/state.ts"))};`,
          `export * as store from ${JSON.stringify(join(studioDir, "app/core/store.ts"))};`,
        ].join("\n"),
      );

      const stubPlugin = {
        name: "studio-spatial-test-stubs",
        setup(build: any) {
          build.onResolve({ filter: /\?(?:worker&url|url)$/ }, (args: any) => ({
            path: args.path,
            namespace: "url-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "url-stub" }, () => ({
            contents: "export default 'blob:worklet-stub';",
            loader: "js",
          }));
          build.onResolve({ filter: /^film\/(edit|scene)$/ }, (args: any) => ({
            path: args.path,
            namespace: "film-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "film-stub" }, () => ({
            contents:
              "export const EDIT = { end: 12 }; export const fromSource = () => []; export const SCENES = {};",
            loader: "js",
          }));
        },
      };

      const built = await Bun.build({
        entrypoints: [entry],
        outdir: outDir,
        format: "esm",
        target: "browser",
        plugins: [stubPlugin],
      });
      expect(built.success).toBe(true);

      const created = {
        convolvers: [] as any[],
        delays: [] as any[],
        filters: [] as any[],
        panners: [] as any[],
      };
      const mkParam = (val = 0) => ({
        value: val,
        setValueAtTime(v: number) {
          this.value = v;
        },
        linearRampToValueAtTime(v: number) {
          this.value = v;
        },
        exponentialRampToValueAtTime(v: number) {
          this.value = v;
        },
        setTargetAtTime(v: number) {
          this.value = v;
        },
        cancelScheduledValues() {},
      });
      const mkNode = () => ({
        connect(dest: any) {
          return dest;
        },
        disconnect() {},
      });
      class FakeAudioCtx {
        sampleRate = 48000;
        currentTime = 0;
        destination = mkNode();
        state = "running";
        audioWorklet = { addModule: async () => {} };
        createGain() {
          return Object.assign(mkNode(), { gain: mkParam(1) });
        }
        createStereoPanner() {
          const p = Object.assign(mkNode(), {
            pan: mkParam(0),
            channelCountMode: "max",
            channelCount: 2,
          });
          created.panners.push(p);
          return p;
        }
        createBiquadFilter() {
          const f = Object.assign(mkNode(), {
            type: "lowpass",
            frequency: mkParam(20000),
            Q: mkParam(0.7071),
          });
          created.filters.push(f);
          return f;
        }
        createDelay(max = 1) {
          const d = Object.assign(mkNode(), { delayTime: mkParam(0), maxDelayTime: max });
          created.delays.push(d);
          return d;
        }
        createConvolver() {
          const c = Object.assign(mkNode(), { normalize: true, buffer: null as any });
          created.convolvers.push(c);
          return c;
        }
        createBuffer(ch: number, len: number, sr: number) {
          const chans = Array.from({ length: ch }, () => new Float32Array(len));
          return {
            numberOfChannels: ch,
            length: len,
            sampleRate: sr,
            duration: len / sr,
            getChannelData: (i: number) => chans[i],
          };
        }
        createBufferSource() {
          return Object.assign(mkNode(), {
            buffer: null,
            playbackRate: mkParam(1),
            start() {},
            stop() {},
            addEventListener() {},
          });
        }
        createMediaElementSource() {
          return mkNode();
        }
        createChannelSplitter() {
          return mkNode();
        }
        createAnalyser() {
          return Object.assign(mkNode(), {
            fftSize: 256,
            frequencyBinCount: 128,
            getFloatTimeDomainData() {},
          });
        }
        async decodeAudioData() {
          return this.createBuffer(2, 48000 * 4, 48000);
        }
      }

      const prevGlobals = {
        window: (globalThis as any).window,
        document: (globalThis as any).document,
        matchMedia: (globalThis as any).matchMedia,
        innerWidth: (globalThis as any).innerWidth,
        innerHeight: (globalThis as any).innerHeight,
        Audio: (globalThis as any).Audio,
        AudioContext: (globalThis as any).AudioContext,
        AudioWorkletNode: (globalThis as any).AudioWorkletNode,
        EventSource: (globalThis as any).EventSource,
        localStorage: (globalThis as any).localStorage,
        sessionStorage: (globalThis as any).sessionStorage,
        location: (globalThis as any).location,
        fetch: globalThis.fetch,
      };
      const mkStorage = () => {
        const m = new Map<string, string>();
        return {
          getItem: (k: string) => m.get(k) ?? null,
          setItem: (k: string, v: string) => void m.set(k, v),
          removeItem: (k: string) => void m.delete(k),
        };
      };
      try {
        (globalThis as any).localStorage = mkStorage();
        (globalThis as any).sessionStorage = mkStorage();
        (globalThis as any).location = {
          origin: "http://127.0.0.1",
          hostname: "127.0.0.1",
          search: "",
          pathname: "/",
        };
        (globalThis as any).innerWidth = 1920;
        (globalThis as any).innerHeight = 1080;
        (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {} });
        (globalThis as any).document = {
          hidden: false,
          visibilityState: "visible",
          createElement: () => ({ canPlayType: () => "" }),
          querySelector: () => null,
          addEventListener() {},
          removeEventListener() {},
        };
        (globalThis as any).Audio = class {
          addEventListener() {}
          removeEventListener() {}
          pause() {}
          play() {
            return Promise.resolve();
          }
          removeAttribute() {}
        };
        (globalThis as any).AudioContext = FakeAudioCtx;
        (globalThis as any).AudioWorkletNode = class {
          port = { postMessage() {}, onmessage: null };
          connect(dest: any) {
            return dest;
          }
          disconnect() {}
        };
        (globalThis as any).EventSource = class {
          close() {}
          addEventListener() {}
        };
        (globalThis as any).window = {
          setTimeout,
          clearTimeout,
          addEventListener() {},
          removeEventListener() {},
          localStorage: (globalThis as any).localStorage,
          sessionStorage: (globalThis as any).sessionStorage,
          __STUDIO_FILM__: { end: 12, shots: [{ t: 0 }, { t: 4 }, { t: 8 }] },
        };
        globalThis.fetch = (async (url: string | URL | Request) => {
          const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
          if (u.startsWith("/api/sfx/")) return new Response(new ArrayBuffer(16), { status: 200 });
          if (u.startsWith("/api/sound")) {
            return Response.json({
              version: "v1",
              live: true,
              library: [{ name: "footstep", seconds: 4 }],
              data: {
                tracks: [{ id: "sfx", name: "SFX" }],
                beds: [],
                sfx: [
                  {
                    at: 4,
                    start: 1.5,
                    length: 2.0,
                    name: "footstep",
                    gain: -3,
                    track: "sfx",
                    reverb: { space: "hall", wet: 0.35, preDelayMs: 20 },
                    spatial: { at: [6, 1.6, 5], refDistance: 2, maxDistance: 40, occlusion: 0.5 },
                  },
                ],
              },
            });
          }
          return Response.json({});
        }) as typeof fetch;

        const mod = await import(built.outputs[0].path);
        mod.state.S.el = { audio: { currentSrc: "", muted: false, volume: 1 } };
        await mod.sound.loadSound();
        await new Promise((r) => setTimeout(r, 30));

        // Verify playSlice constructs Web Audio reverb + spatial nodes cleanly
        await mod.mixer.playSlice(4.2, 0.25);
        expect(created.convolvers.length).toBeGreaterThanOrEqual(1);
        expect(created.convolvers[0].normalize).toBe(false);
        expect(created.convolvers[0].buffer.numberOfChannels).toBe(2);
        expect(created.delays.length).toBeGreaterThanOrEqual(1);
        expect(created.delays[0].delayTime.value).toBeCloseTo(0.02, 5);
        expect(created.filters.length).toBeGreaterThanOrEqual(1);
        expect(created.filters[0].frequency.value).toBeLessThan(5000); // occlusion LPF active
        expect(created.panners.some((p) => p.pan.value > 0.8)).toBe(true); // camera looks -Z, source at +X => right pan

        // Verify J-Cut Lead In extends left across cut (4.0 -> 3.25) adjusting start/length, and Undo restores!
        const ref = { list: "sfx" as const, i: 0 };
        expect(mod.sound.lanes.sfx[0].at).toBe(4);
        mod.sound.applyJCut(ref, 0.75);
        expect(mod.sound.lanes.sfx[0].at).toBeCloseTo(3.25, 3);
        expect(mod.sound.lanes.sfx[0].start).toBeCloseTo(0.75, 3);
        expect(mod.sound.lanes.sfx[0].length).toBeCloseTo(2.75, 3);

        mod.doc.undo();
        expect(mod.sound.lanes.sfx[0].at).toBeCloseTo(4, 3);
        expect(mod.sound.lanes.sfx[0].start).toBeCloseTo(1.5, 3);
        expect(mod.sound.lanes.sfx[0].length).toBeCloseTo(2.0, 3);

        mod.doc.redo();
        expect(mod.sound.lanes.sfx[0].at).toBeCloseTo(3.25, 3);
        mod.mixer.setLive(false, {
          lanes: () => null,
          library: () => [],
          span: () => [0, 0],
          voice: () => [],
        });
      } finally {
        Object.assign(globalThis, prevGlobals);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
