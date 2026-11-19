import { describe, expect, test } from "bun:test";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as THREE from "three";

import { poseAt } from "../../mc-assets/src/placed-math.ts";
import { generateImpulseResponse, resolveClipReverb, REVERB_SPACES } from "../app/sound/ir.ts";
import { computeJCutStart, computeLCutEnd, shotCutOverlaps } from "../app/sound/jlcut.ts";
import { computeSpatialParams, isSpatialActive, offsetPosition } from "../app/sound/spatial.ts";
import { createApi } from "../src/api.mjs";
import { SOUND_KEYS } from "../src/contract-keys.ts";
import { ReverbSpec, ShotSpace, SoundTimeline, SpatialSpec } from "../src/contract.ts";
import { mapTimeline } from "../src/timing-data.mjs";
import { compileTiming } from "../src/timing.mjs";

describe("IR synthesizer (ir.ts)", () => {
  test("produces identical deterministic 48kHz stereo buffers across repeated calls", () => {
    for (const space of REVERB_SPACES) {
      const a = generateImpulseResponse(space, 48000);
      const b = generateImpulseResponse(space, 48000);
      expect(a.left.length).toBe(b.left.length);
      expect(a.right.length).toBe(b.right.length);
      expect(a.left).toEqual(b.left);
      expect(a.right).toEqual(b.right);
      expect(a.left.every(Number.isFinite)).toBe(true);
      expect(a.right.every(Number.isFinite)).toBe(true);
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

  test("respects camera roll in radians (matching Three.js rotateZ) and offsetPosition helper", () => {
    // pi/2 roll rotates right vector onto camUp (+Y), so source above camera pans right
    const rolledCam = { ...cam, roll: Math.PI / 2 };
    const above = computeSpatialParams(rolledCam, [0, 5.6, 5], { at: [0, 5.6, 5] });
    expect(above.pan).toBeCloseTo(1, 5);

    // Parity against THREE.PerspectiveCamera.rotateZ across varied pitches/yaws/rolls
    for (const roll of [0, 0.4, -0.75, Math.PI / 2]) {
      const p: [number, number, number] = [2, 3, 6];
      const l: [number, number, number] = [-1, 1.5, 0];
      const threeCam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
      threeCam.position.set(...p);
      threeCam.up.set(0, 1, 0);
      threeCam.lookAt(...l);
      if (roll) threeCam.rotateZ(roll);
      threeCam.updateMatrixWorld();
      const m = threeCam.matrixWorld.elements;
      const rightPos: [number, number, number] = [
        p[0] + m[0] * 4,
        p[1] + m[1] * 4,
        p[2] + m[2] * 4,
      ];
      const spFromRoll = computeSpatialParams({ p, l, roll }, rightPos, { at: rightPos });
      const spFromBasis = computeSpatialParams(
        { p, l: [p[0] - m[8], p[1] - m[9], p[2] - m[10]], up: [m[4], m[5], m[6]] },
        rightPos,
        { at: rightPos },
      );
      expect(spFromRoll.pan).toBeCloseTo(1, 5);
      expect(spFromBasis.pan).toBeCloseTo(1, 5);
      expect(spFromRoll.pan).toBeCloseTo(spFromBasis.pan, 5);
    }

    expect(offsetPosition([1, 2, 3], [0.5, -1, 2])).toEqual([1.5, 1, 5]);
    expect(isSpatialActive({ target: "steve" })).toBe(true);
    expect(isSpatialActive({ refDistance: 2 })).toBe(false);
  });

  test("mapTimeline('sound') remaps acoustic spaces through timing clock cleanly", () => {
    const clock = compileTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 6);
    const sourceAudio = {
      tracks: [],
      beds: [],
      sfx: [],
      spaces: [
        { from: 0, to: 4, space: "hall", wet: 0.3 },
        { from: 4, to: 6, space: "cave", wet: 0.5 },
      ],
    };
    const outAudio = mapTimeline("sound", sourceAudio, clock, false);
    expect(outAudio.spaces.map(({ __timing, ...rest }: any) => rest)).toEqual([
      { from: 0, to: 2, space: "hall", wet: 0.3 },
      { from: 2, to: 4, space: "cave", wet: 0.5 },
    ]);
    const restored = mapTimeline("sound", outAudio, clock, true, sourceAudio);
    expect(restored.spaces).toEqual(sourceAudio.spaces);
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

      mkdirSync(join(tmp, "assets", "ir", "dir.wav"), { recursive: true });
      const dirRes = await app.request("/api/sound/ir?path=assets/ir/dir.wav");
      expect(dirRes.status).toBe(404);

      const encodedTravRes = await app.request("/api/sound/ir?path=assets%2F..%2Fsecret.wav");
      expect(encodedTravRes.status).toBe(400);
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
      const req = createRequire(join(studioDir, "package.json"));
      const reactPath = req.resolve("react");
      const reactDomServerPath = req.resolve("react-dom/server");
      writeFileSync(
        entry,
        [
          `import * as React from ${JSON.stringify(reactPath)};`,
          `import { renderToStaticMarkup } from ${JSON.stringify(reactDomServerPath)};`,
          `import { TooltipProvider } from ${JSON.stringify(join(studioDir, "app/components/ui/tooltip.tsx"))};`,
          `import { ReverbSection } from ${JSON.stringify(join(studioDir, "app/sound/SpatialInspector.tsx"))};`,
          `export * as doc from ${JSON.stringify(join(studioDir, "app/core/doc.ts"))};`,
          `export * as filmMeta from ${JSON.stringify(join(studioDir, "app/core/filmMeta.ts"))};`,
          `export * as mixer from ${JSON.stringify(join(studioDir, "app/sound/mixer.ts"))};`,
          `export * as sceneSpatial from ${JSON.stringify(join(studioDir, "app/sound/scene-spatial.ts"))};`,
          `export * as sound from ${JSON.stringify(join(studioDir, "app/sound/sound.ts"))};`,
          `export * as state from ${JSON.stringify(join(studioDir, "app/core/state.ts"))};`,
          `export * as store from ${JSON.stringify(join(studioDir, "app/core/store.ts"))};`,
          `export * as timingState from ${JSON.stringify(join(studioDir, "src/timing-state.mjs"))};`,
          `export * as filmStub from "film/edit";`,
          `export const renderReverbSection = (props: any) => renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(ReverbSection, props)));`,
        ].join("\n"),
      );

      const stubPlugin = {
        name: "studio-spatial-test-stubs",
        setup(build: any) {
          build.onResolve({ filter: /^@\// }, (args: any) => {
            const rel = args.path.slice(2);
            for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
              const cand = join(studioDir, "app", rel + suffix);
              if (existsSync(cand)) return { path: cand };
            }
            return undefined;
          });
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
              "export const EDIT = { end: 12 }; export const fromSource = (t) => t; export const toSource = (t) => t; export const SCENES = {};",
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
        gains: [] as any[],
        disconnectedConvolvers: 0,
        disconnectedGains: 0,
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
        setValueCurveAtTime() {},
        cancelScheduledValues() {},
      });
      const mkNode = () => ({
        connect(dest: any) {
          return dest;
        },
        disconnect() {},
      });
      class FakeAudioCtx {
        sampleRate: number;
        currentTime = 0;
        destination = mkNode();
        state = "running";
        audioWorklet = { addModule: async () => {} };
        constructor(sampleRate = 48000) {
          this.sampleRate = sampleRate;
        }
        createGain() {
          const g = Object.assign(mkNode(), {
            gain: mkParam(1),
            disconnect() {
              created.disconnectedGains++;
            },
          });
          created.gains.push(g);
          return g;
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
            Q: mkParam(0),
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
          const c = Object.assign(mkNode(), {
            normalize: true,
            buffer: null as any,
            disconnect() {
              created.disconnectedConvolvers++;
            },
          });
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
        async decodeAudioData(buf: ArrayBuffer) {
          // Marker size 64 simulates a 44100 Hz custom IR WAV file decoded on ctx
          const isCustomIr = buf.byteLength === 64;
          const sr = isCustomIr ? 44100 : this.sampleRate;
          return this.createBuffer(2, isCustomIr ? 4410 : sr * 4, sr);
        }
      }
      class FakeOfflineAudioCtx extends FakeAudioCtx {
        length: number;
        constructor(channels: number, length: number, sampleRate: number) {
          super(sampleRate);
          void channels;
          this.length = length;
        }
        async startRendering() {
          return this.createBuffer(2, this.length, this.sampleRate);
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
        OfflineAudioContext: (globalThis as any).OfflineAudioContext,
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
      let irFetches = 0;
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
        (globalThis as any).OfflineAudioContext = FakeOfflineAudioCtx;
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
          if (u.startsWith("/api/sound/ir")) {
            irFetches++;
            return new Response(new ArrayBuffer(64), { status: 200 });
          }
          if (u.startsWith("/api/sound")) {
            return Response.json({
              version: "v1",
              live: true,
              library: [
                { name: "footstep", seconds: 4 },
                { name: "bgm", seconds: 6 },
              ],
              data: {
                tracks: [
                  { id: "bgm", name: "BGM" },
                  { id: "sfx", name: "SFX" },
                  { id: "locked_sfx", name: "Locked", lock: true },
                ],
                beds: [
                  {
                    name: "bgm",
                    from: 4,
                    to: 8,
                    start: 1.0,
                    gain: -10,
                    fadeIn: 0.2,
                    fadeOut: 0.2,
                    track: "bgm",
                  },
                ],
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
                  {
                    at: 8,
                    start: 2.0,
                    length: 0.5,
                    rate: 2,
                    name: "footstep",
                    gain: -3,
                    track: "locked_sfx",
                    reverb: { space: "assets/ir/custom.wav", wet: 0.4, preDelayMs: 10 },
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

        // Verify playSlice constructs Web Audio reverb + spatial nodes cleanly & Q is in dB
        await mod.mixer.playSlice(4.2, 0.25);
        expect(created.convolvers.length).toBeGreaterThanOrEqual(1);
        expect(created.convolvers[0].normalize).toBe(false);
        expect(created.convolvers[0].buffer.numberOfChannels).toBe(2);
        expect(created.delays.length).toBeGreaterThanOrEqual(1);
        expect(created.delays[0].delayTime.value).toBeCloseTo(0.02, 5);
        expect(created.filters.length).toBeGreaterThanOrEqual(1);
        expect(created.filters[0].Q.value).toBeCloseTo(-20 * Math.log10(Math.SQRT2), 5);
        expect(created.filters[0].frequency.value).toBeLessThan(5000); // occlusion LPF active
        expect(created.panners.some((p) => p.pan.value > 0.8)).toBe(true); // camera looks -Z, source at +X => right pan

        // Verify rapid skim cleanup disconnects old GainNode and shared ConvolverNode
        const prevConvolverCount = created.disconnectedConvolvers;
        const prevGainCount = created.disconnectedGains;
        await mod.mixer.playSlice(4.2, 0.05);
        await new Promise((r) => setTimeout(r, 150));
        expect(created.disconnectedConvolvers).toBeGreaterThan(prevConvolverCount);
        expect(created.disconnectedGains).toBeGreaterThan(prevGainCount);

        // Verify offline custom IR decodes/resamples cleanly to OfflineAudioContext 48kHz & forgetSounds clears IR cache
        created.convolvers.length = 0;
        await mod.mixer.renderAudioSpan(7.9, 8.6);
        expect(irFetches).toBe(1);
        const customConv = created.convolvers.find((c) => c.buffer?.length === 4800);
        expect(customConv).toBeDefined();
        expect(customConv.buffer.sampleRate).toBe(48000);

        mod.mixer.forgetSounds();
        await mod.mixer.renderAudioSpan(7.9, 8.6);
        expect(irFetches).toBe(2);

        // Verify scene-spatial.ts reads source-time EDIT.cam/EDIT[placedKey] + frameAt + FreeCam/offline gates
        mod.filmStub.EDIT.cam = [
          { t: 0, p: [0, 1.6, 5], l: [0, 1.6, 0] },
          { t: 4, p: [8, 1.6, 5], l: [0, 1.6, 0], ease: "linear" },
        ];
        mod.filmStub.EDIT.objects = {
          hero: {
            keys: [
              { t: 0, at: [0, 0, 0] },
              { t: 4, at: [10, 0, 0], ease: "inOut" },
            ],
          },
        };
        mod.timingState.setTiming(
          {
            speeds: [{ from: 0, to: 2, rate: 2 }],
            freezes: [{ at: 1, duration: 1, frame: 0.5 }],
          },
          12,
        );
        mod.store.set({ timing: true });
        mod.state.S.t = 1.0;
        mod.state.S.tools = {
          placed: { key: "objects" },
          free: { on: true },
          camera: {
            matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 99, 99, 99, 1] },
          },
        };
        // Freeze spans output [0.5, 1.5) holding source frame=0.5 while FreeCam is ignored
        expect(mod.sceneSpatial.pictureTimeAt(1.0)).toBeCloseTo(0.5, 5);
        expect(mod.sceneSpatial.pictureTimeAt(1.75)).toBeCloseTo(1.5, 5);
        expect(mod.sceneSpatial.sceneCameraPoseAt(1.0).p[0]).toBeCloseTo(1, 4);
        // Live camera pose is used only when !free.on && !offline
        mod.state.S.tools.free.on = false;
        expect(mod.sceneSpatial.sceneCameraPoseAt(1.0).p[0]).toBe(99);
        expect(mod.sceneSpatial.sceneCameraPoseAt(1.0, { offline: true }).p[0]).toBeCloseTo(1, 4);
        // Placed object at t=0.5 matches mc-assets/src/placed-math.ts poseAt arriving-key ease ("inOut")
        const placedAtHalf = poseAt(mod.filmStub.EDIT.objects.hero.keys, 0.5);
        const sceneAtHalf = mod.sceneSpatial.sceneTargetAt("hero", 1.0);
        expect(sceneAtHalf?.[0]).toBeCloseTo(placedAtHalf.at.x, 5);
        mod.store.set({ timing: false });
        mod.timingState.setTiming({}, 12);
        mod.state.S.tools = null;

        // Verify ReverbSection keeps Wet & Pre-delay controls mounted even at wet = 0%
        const wetZeroHtml = mod.renderReverbSection({
          clip: { list: "sfx", i: 0 },
          c: { ...mod.sound.lanes.sfx[0], reverb: { space: "hall", wet: 0, preDelayMs: 12 } },
          from: 4,
          to: 6,
        });
        expect(wetZeroHtml).toContain("Wet");
        expect(wetZeroHtml).toContain("Pre-delay");

        // Verify J-Cut respects SHOTS_OUT cut times, looping beds, rate!=1, locked tracks & Undo/Redo
        mod.filmMeta.syncFilmMeta({ SHOTS: [{ t: 0 }, { t: 6 }], SHOTS_OUT: [{ t: 0 }, { t: 4 }] });
        const ref = { list: "sfx" as const, i: 0 };
        expect(mod.sound.lanes.sfx[0].at).toBe(4);
        const cutInfo = mod.sound.clipCutBounds(ref, 0.75);
        expect(cutInfo.jCut.delta).toBeCloseTo(0.75, 3);
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

        // Looping bed extends past SHOTS_OUT cut and wraps start via loopWrap(6, -0.5) => 4.0 cleanly
        const bedRef = { list: "beds" as const, i: 0 };
        mod.sound.applyJCut(bedRef, 1.5);
        expect(mod.sound.lanes.beds[0].from).toBeCloseTo(2.5, 3);
        expect(mod.sound.lanes.beds[0].start).toBeCloseTo(4.0, 3);
        mod.sound.applyLCut(bedRef, 0.5);
        expect(mod.sound.lanes.beds[0].to).toBeCloseTo(8.5, 3);

        // Locked track is protected from applyJCut / applyLCut; rate=2 unlocking scales trimDelta
        const lockedRef = { list: "sfx" as const, i: 1 };
        expect(mod.sound.locked(lockedRef)).toBe(true);
        mod.sound.applyJCut(lockedRef, 0.5);
        expect(mod.sound.lanes.sfx[1].at).toBe(8);
        mod.sound.edit((l: any) => {
          l.tracks[2].lock = false;
        });
        mod.sound.applyJCut(lockedRef, 0.5);
        expect(mod.sound.lanes.sfx[1].at).toBeCloseTo(7.5, 3);
        expect(mod.sound.lanes.sfx[1].start).toBeCloseTo(1.0, 3);
        expect(mod.sound.lanes.sfx[1].length).toBeCloseTo(1.0, 3);
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
