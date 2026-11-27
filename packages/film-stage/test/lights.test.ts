import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";

import {
  applyLightingRig,
  applySetLight,
  bakeSceneProbe,
  createAreaLight,
  createEnvironment,
  createGodraysPass,
  createLightingRig,
  createSkyEnvironment,
  DEFAULT_LIGHTS,
  ENVIRONMENT_PRESETS,
  kelvinToHex,
  LIGHT_PRESET_IDS,
  LIGHT_PRESETS,
  type LightKey,
  lightsAt,
  type LightsDoc,
  loadHDREnvironment,
  practicalIntensityAt,
  resolveLightKeys,
} from "../src/lights";

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

describe("kelvinToHex & LIGHT_PRESETS", () => {
  test("kelvinToHex maps warm tungsten below 3200K to orange-red and daylight/cool above 6500K toward blue", () => {
    const candle = kelvinToHex(1900);
    const tungsten = kelvinToHex(3200);
    const daylight = kelvinToHex(6500);
    const blueSky = kelvinToHex(10000);

    for (const hex of [candle, tungsten, daylight, blueSky]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }

    const [cr, cg, cb] = hexToRgb(candle);
    expect(cr).toBeGreaterThan(cg);
    expect(cg).toBeGreaterThan(cb);
    expect(cb).toBeLessThan(80);

    const [dr, dg, db] = hexToRgb(daylight);
    expect(Math.abs(dr - dg)).toBeLessThan(20);
    expect(Math.abs(dg - db)).toBeLessThan(20);

    const [br, , bb] = hexToRgb(blueSky);
    expect(bb).toBeGreaterThan(br);

    expect(kelvinToHex(100)).toBe(kelvinToHex(1000));
    expect(kelvinToHex(100000)).toBe(kelvinToHex(40000));
  });

  test("LIGHT_PRESETS includes all 6 required presets with distinct complete configurations", () => {
    const required = [
      "golden-hour",
      "fluorescent-hall",
      "noir-night",
      "warm-hearth",
      "overcast-doc",
      "studio-three-point",
    ] as const;

    for (const id of required) {
      expect(LIGHT_PRESET_IDS).toContain(id);
      const preset = LIGHT_PRESETS[id];
      expect(preset.title.length).toBeGreaterThan(2);
      expect(preset.state.key.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.state.fog.mode).toMatch(/^(none|linear|exp2)$/);
    }

    expect(LIGHT_PRESETS["noir-night"].state.fill.negativeFill).toBe(true);
    expect(LIGHT_PRESETS["golden-hour"].state.godrays.enabled).toBe(true);
    expect(LIGHT_PRESETS["studio-three-point"].state.godrays.enabled).toBe(false);
  });

  test("lights-meta and camera-meta import zero Three.js or postprocessing modules", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    for (const rel of ["../src/lights-meta.ts", "../src/camera-meta.ts"]) {
      const code = readFileSync(join(import.meta.dir, rel), "utf8");
      const specs = transpiler.scanImports(code).map((imp) => imp.path);
      for (const forbidden of ["three", "three-good-godrays", "postprocessing"]) {
        expect(specs.some((p) => p === forbidden || p.startsWith(`${forbidden}/`))).toBe(false);
      }
    }
  });
});

describe("lightsAt interpolation, cuts, presets, and deterministic flicker", () => {
  test("returns complete DEFAULT_LIGHTS when timeline is absent or empty", () => {
    expect(lightsAt(undefined, 2.5)).toEqual(DEFAULT_LIGHTS);
    expect(lightsAt(null, 2.5)).toEqual(DEFAULT_LIGHTS);
    expect(lightsAt([], 2.5)).toEqual(DEFAULT_LIGHTS);
    expect(lightsAt({ keys: [] } as LightsDoc, 2.5)).toEqual(DEFAULT_LIGHTS);
  });

  test("interpolates key intensity, shortest-path azimuth wrapping, linear RGB color, fog, and eases", () => {
    const doc: LightsDoc = {
      target: [3.5, 1.5, 3.5],
      keys: [
        {
          t: 0,
          key: {
            enabled: true,
            color: "#ff0000",
            intensity: 1,
            azimuth: 350,
            elevation: 20,
            shadowRadius: 2,
            castShadow: true,
          },
          fog: { mode: "linear", color: "#000000", near: 10, far: 30, density: 0 },
        },
        {
          t: 2,
          ease: "linear",
          key: {
            color: "#0000ff",
            intensity: 3,
            azimuth: 10,
            elevation: 60,
            shadowRadius: 6,
          },
          fog: { mode: "linear", color: "#ffffff", near: 20, far: 50, density: 0 },
        },
      ],
    };

    const before = lightsAt(doc, -1);
    expect(before.key.intensity).toBe(1);
    expect(before.key.azimuth).toBe(350);

    const mid = lightsAt(doc, 1);
    expect(mid.target).toEqual([3.5, 1.5, 3.5]);
    expect(mid.key.intensity).toBeCloseTo(2, 5);
    expect(mid.key.elevation).toBeCloseTo(40, 5);
    expect(mid.key.shadowRadius).toBeCloseTo(4, 5);
    expect(mid.key.azimuth).toBeCloseTo(0, 4);
    expect(mid.fog.near).toBeCloseTo(15, 5);
    expect(mid.fog.far).toBeCloseTo(40, 5);
    const [mr, mg, mb] = hexToRgb(mid.key.color);
    expect(mr).toBeGreaterThan(170);
    expect(mg).toBe(0);
    expect(mb).toBe(mr);

    const after = lightsAt(doc, 5);
    expect(after.key.intensity).toBe(3);
    expect(after.key.azimuth).toBe(10);
  });

  test("cut: true jumps instantaneously at key time with zero prior interpolation bleed", () => {
    const keys: LightKey[] = [
      { t: 0, preset: "golden-hour", key: { intensity: 2 } },
      { t: 4, ease: "linear", key: { intensity: 4 } },
      { t: 6, cut: true, preset: "noir-night", key: { intensity: 1.5 } },
    ];

    const justBeforeCut = lightsAt(keys, 5.999);
    expect(justBeforeCut.key.intensity).toBeCloseTo(4, 5);
    expect(justBeforeCut.fill.negativeFill).toBe(false);

    const atCut = lightsAt(keys, 6);
    expect(atCut.key.intensity).toBeCloseTo(1.5, 5);
    expect(atCut.fill.negativeFill).toBe(true);
    expect(atCut.key.color).toBe(LIGHT_PRESETS["noir-night"].state.key.color);
  });

  test("carries segment values forward and matches practicals by id across keyframes", () => {
    const keys: LightKey[] = [
      {
        t: 0,
        preset: "warm-hearth",
        practicals: [
          {
            id: "torch",
            name: "Wall Torch",
            kind: "point",
            at: [1, 2, 1],
            color: "#ff9933",
            intensity: 4,
            distance: 8,
            decay: 2,
            flicker: { rate: 9, amount: 0.35, seed: 7 },
          },
        ],
      },
      {
        t: 4,
        ease: "linear",
        practicals: [
          {
            id: "torch",
            name: "Wall Torch",
            kind: "point",
            at: [1, 4, 1],
            color: "#ff9933",
            intensity: 8,
            distance: 8,
            decay: 2,
            flicker: { rate: 9, amount: 0.35, seed: 7 },
          },
          {
            id: "desk",
            name: "Desk Spot",
            kind: "spot",
            at: [3, 3, 2],
            target: [3, 1, 2],
            color: "#fff1d0",
            intensity: 4,
            distance: 10,
            decay: 1.5,
            angle: 35,
            penumbra: 0.5,
          },
        ],
      },
    ];

    const mid = lightsAt(keys, 2);
    expect(mid.key.color).toBe(LIGHT_PRESETS["warm-hearth"].state.key.color);
    expect(mid.practicals).toHaveLength(2);
    const torch = mid.practicals.find((p) => p.id === "torch");
    const desk = mid.practicals.find((p) => p.id === "desk");
    expect(torch?.at).toEqual([1, 3, 1]);
    expect(torch?.intensity).toBeCloseTo(6, 5);
    expect(desk?.intensity).toBeCloseTo(2, 5);
  });

  test("practical flicker is purely deterministic f(t) and never calls Math.random", () => {
    const originalRandom = Math.random;
    const randomSpy = mock(() => 0.5);
    Math.random = randomSpy;
    try {
      const sample = lightsAt(
        [
          {
            t: 0,
            practicals: [
              {
                id: "candle",
                name: "Candle",
                kind: "point",
                at: [0, 1, 0],
                color: "#ffaa44",
                intensity: 3,
                distance: 6,
                decay: 2,
                flicker: { rate: 10, amount: 0.4, seed: 12 },
              },
            ],
          },
        ],
        1.25,
      );
      const practical = sample.practicals[0];
      const a1 = practicalIntensityAt(practical, 1.25);
      const b = practicalIntensityAt(practical, 3.8);
      const a2 = practicalIntensityAt(practical, 1.25);

      expect(a1).toBe(a2);
      expect(a1).not.toBe(b);
      expect(a1).toBeGreaterThanOrEqual(3 * 0.6 - 1e-6);
      expect(a1).toBeLessThanOrEqual(3 * 1.4 + 1e-6);
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      Math.random = originalRandom;
    }
  });
});

describe("Three.js lighting rig, practical lifecycle, godrays wrapper & dispose", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  test("createLightingRig and applyLightingRig drive Three.js lights, fog, practicals, negative fill, and dispose cleanly", () => {
    const scene = new THREE.Scene();
    const rig = createLightingRig(scene, { target: [2, 1, 2], distance: 12, shadowExtent: 10 });
    cleanups.push(() => rig.dispose());

    expect(scene.children).toContain(rig.key);
    expect(scene.children).toContain(rig.key.target);
    expect(scene.children).toContain(rig.fill);
    expect(scene.children).toContain(rig.rim);
    expect(scene.children).toContain(rig.hemisphere);
    expect(scene.children).toContain(rig.ambient);

    const sample = lightsAt(
      [
        {
          t: 0,
          key: {
            enabled: true,
            color: "#ff8844",
            intensity: 2.5,
            azimuth: 90,
            elevation: 0,
            shadowRadius: 3.5,
            castShadow: true,
          },
          fill: {
            enabled: true,
            color: "#6688aa",
            intensity: 1.0,
            azimuth: -90,
            elevation: 20,
            negativeFill: true,
          },
          world: {
            skyColor: "#88aacc",
            groundColor: "#443322",
            ambientIntensity: 0.8,
            background: "#111822",
          },
          fog: { mode: "exp2", color: "#223344", near: 5, far: 25, density: 0.03 },
          practicals: [
            {
              id: "p1",
              name: "Lamp",
              kind: "point",
              at: [1, 2, 3],
              color: "#ffcc66",
              intensity: 5,
              distance: 9,
              decay: 2,
              flicker: true,
            },
            {
              id: "s1",
              name: "Overhead Spot",
              kind: "spot",
              at: [2, 5, 2],
              target: [2, 0, 2],
              color: "#ffffff",
              intensity: 7,
              distance: 15,
              decay: 1,
              angle: 40,
              penumbra: 0.4,
            },
          ],
        },
      ],
      0.5,
    );

    applyLightingRig(rig, sample, 0.5);

    expect(rig.key.intensity).toBeCloseTo(2.5, 5);
    expect(rig.key.castShadow).toBe(true);
    expect(rig.key.shadow.radius).toBeCloseTo(3.5, 5);
    expect(rig.key.position.x).toBeCloseTo(2 + 12, 3);
    expect(rig.key.position.y).toBeCloseTo(1, 3);
    expect(rig.key.position.z).toBeCloseTo(2, 3);
    expect(rig.fill.intensity).toBeLessThan(0.5);
    expect(rig.ambient.intensity).toBeLessThan(0.8);
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect((scene.fog as THREE.FogExp2).density).toBeCloseTo(0.03, 5);
    expect(scene.background).toBeInstanceOf(THREE.Color);

    const pLight = rig.practicals.get("p1")?.light as THREE.PointLight | undefined;
    const sLight = rig.practicals.get("s1")?.light as THREE.SpotLight | undefined;
    expect(pLight).toBeInstanceOf(THREE.PointLight);
    expect(sLight).toBeInstanceOf(THREE.SpotLight);
    expect(pLight?.position.toArray()).toEqual([1, 2, 3]);
    expect(sLight?.target.position.toArray()).toEqual([2, 0, 2]);
    expect(scene.children).toContain(pLight);
    expect(scene.children).toContain(sLight);
    expect(scene.children).toContain(sLight?.target);

    const sampleLinear = lightsAt(
      [
        {
          t: 0,
          fog: { mode: "linear", color: "#abcdef", near: 4, far: 18, density: 0 },
          practicals: [sample.practicals[0]],
        },
      ],
      0,
    );
    applyLightingRig(rig, sampleLinear, 0);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(rig.practicals.has("s1")).toBe(false);
    expect(scene.children).not.toContain(sLight);

    const sampleNone = lightsAt(
      [{ t: 0, fog: { mode: "none", color: "#000000", near: 10, far: 40, density: 0 } }],
      0,
    );
    applyLightingRig(rig, sampleNone, 0);
    expect(scene.fog).toBeNull();

    rig.dispose();
    expect(scene.children).not.toContain(rig.key);
    expect(scene.children).not.toContain(rig.fill);
    expect(scene.children).not.toContain(rig.rim);
    expect(scene.children).not.toContain(rig.hemisphere);
    expect(scene.children).not.toContain(rig.ambient);
    expect(rig.practicals.size).toBe(0);
  });

  test("lightsAt handles coincident cut at t=0 and clamps overshoot eases cleanly", () => {
    const coincident: LightKey[] = [
      { t: 0, key: { intensity: 1 } },
      { t: 0, cut: true, key: { intensity: 5 } },
      { t: 4, key: { intensity: 2 } },
    ];
    expect(lightsAt(coincident, 0).key.intensity).toBe(5);
    expect(lightsAt(coincident.slice(0, 2), 0).key.intensity).toBe(5);

    const overshootKeys: LightKey[] = [
      {
        t: 0,
        key: { intensity: 0, elevation: -85, shadowRadius: 0 },
        fill: { intensity: 0 },
        rim: { intensity: 0 },
        world: { ambientIntensity: 0 },
        fog: { mode: "exp2", near: 0, far: 1, density: 0, color: "#000000" },
        practicals: [
          {
            id: "lamp",
            name: "Lamp",
            kind: "point",
            at: [0, 0, 0],
            color: "#000000",
            intensity: 0,
            distance: 0,
            decay: 0,
          },
          {
            id: "spot",
            name: "Spot",
            kind: "spot",
            at: [1, 1, 1],
            color: "#000000",
            intensity: 0,
            distance: 0,
            decay: 0,
            angle: 10,
            penumbra: 0,
          },
        ],
        godrays: {
          enabled: true,
          density: 0,
          maxDensity: 0,
          edgeStrength: 0,
          edgeRadius: 0,
          raymarchSteps: 4,
          blur: true,
          weight: 0,
        },
      },
      {
        t: 2,
        ease: [0.6, -1.2, 0.4, 2.2],
        key: { intensity: 4, elevation: 88, shadowRadius: 20 },
        fill: { intensity: 3 },
        rim: { intensity: 3 },
        world: { ambientIntensity: 2 },
        fog: { mode: "exp2", near: 5, far: 20, density: 1.5, color: "#ffffff" },
        practicals: [
          {
            id: "lamp",
            name: "Lamp",
            kind: "point",
            at: [2, 2, 2],
            color: "#ffffff",
            intensity: 10,
            distance: 20,
            decay: 5,
          },
        ],
        godrays: {
          enabled: true,
          density: 0.5,
          maxDensity: 1,
          edgeStrength: 10,
          edgeRadius: 15,
          raymarchSteps: 120,
          blur: true,
          weight: 3,
        },
      },
    ];

    for (let s = 0.05; s < 2; s += 0.1) {
      const val = lightsAt(overshootKeys, s);
      expect(val.key.intensity).toBeGreaterThanOrEqual(0);
      expect(val.key.elevation).toBeGreaterThanOrEqual(-90);
      expect(val.key.elevation).toBeLessThanOrEqual(90);
      expect(val.key.shadowRadius).toBeGreaterThanOrEqual(0);
      expect(val.fill.intensity).toBeGreaterThanOrEqual(0);
      expect(val.rim.intensity).toBeGreaterThanOrEqual(0);
      expect(val.world.ambientIntensity).toBeGreaterThanOrEqual(0);
      expect(val.fog.near).toBeGreaterThanOrEqual(0);
      expect(val.fog.far).toBeGreaterThanOrEqual(0);
      expect(val.fog.density).toBeGreaterThanOrEqual(0);
      expect(val.fog.density).toBeLessThanOrEqual(2);
      expect(val.godrays.density).toBeGreaterThanOrEqual(0);
      expect(val.godrays.maxDensity).toBeLessThanOrEqual(1);
      expect(val.godrays.maxDensity).toBeGreaterThanOrEqual(0);
      expect(val.godrays.raymarchSteps).toBeGreaterThanOrEqual(4);
      expect(val.godrays.weight).toBeGreaterThanOrEqual(0);
      for (const p of val.practicals) {
        expect(p.intensity).toBeGreaterThanOrEqual(0);
        expect(p.distance).toBeGreaterThanOrEqual(0);
        expect(p.decay).toBeGreaterThanOrEqual(0);
        if (p.angle !== undefined) expect(p.angle).toBeGreaterThanOrEqual(1);
        if (p.penumbra !== undefined) expect(p.penumbra).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("createLightingRig captures and restores pre-existing scene background and fog", () => {
    const scene = new THREE.Scene();
    const initialBg = new THREE.Color("#123456");
    const initialFog = new THREE.Fog("#654321", 2, 12);
    scene.background = initialBg;
    scene.fog = initialFog;

    const rig = createLightingRig(scene);
    applyLightingRig(
      rig,
      lightsAt(
        [
          {
            t: 0,
            world: { background: "#111111" },
            fog: { mode: "none", color: "#000", near: 1, far: 5, density: 0 },
          },
        ],
        0,
      ),
      0,
    );
    expect((scene.background as THREE.Color).getHexString()).toBe("111111");
    expect(scene.fog).toBeNull();

    applyLightingRig(rig, lightsAt([{ t: 0, world: { background: null } }], 0), 0);
    expect(scene.background).toBe(initialBg);

    applyLightingRig(rig, lightsAt([{ t: 0, world: { background: "#222222" } }], 0), 0);
    rig.dispose();
    expect(scene.background).toBe(initialBg);
    expect(scene.fog).toBe(initialFog);
  });

  test("createGodraysPass handles unsupported lights, gates castShadow/visible, calibrates variance, and resets blurPass on kernel change", () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    const spot = new THREE.SpotLight(0xffffff, 2);
    const dirNoShadow = new THREE.DirectionalLight(0xffffff, 2);
    (dirNoShadow as { shadow?: unknown }).shadow = undefined;

    const fromSpot = createGodraysPass(spot as unknown as THREE.DirectionalLight, cam);
    expect(fromSpot.supported).toBe(false);
    expect(fromSpot.pass).toBeNull();
    expect(() => fromSpot.update(DEFAULT_LIGHTS.godrays, "#ffffff")).not.toThrow();
    expect(() => fromSpot.dispose()).not.toThrow();

    const fromNoShadow = createGodraysPass(dirNoShadow, cam);
    expect(fromNoShadow.supported).toBe(false);
    expect(fromNoShadow.pass).toBeNull();

    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.castShadow = true;
    const wrapper = createGodraysPass(dir, cam, { enabled: false });
    expect(wrapper.supported).toBe(true);
    expect(wrapper.pass).not.toBeNull();

    const passAny = wrapper.pass as unknown as {
      blurPass: { dispose?: () => void } | null;
      setParams: (params: { blur?: { variance: number; kernelSize: number } | false }) => void;
    };
    const captured: Array<{ blur?: { variance: number; kernelSize: number } | false }> = [];
    const origSetParams = passAny.setParams.bind(passAny);
    passAny.setParams = (params) => {
      captured.push(params);
      return origSetParams(params);
    };

    const rayState = {
      enabled: true,
      density: 0.02,
      maxDensity: 0.5,
      edgeStrength: 2,
      edgeRadius: 2,
      raymarchSteps: 40,
      blur: true,
      weight: 0.8,
      color: "#ffddaa",
    };

    wrapper.update(rayState, "#ffffff");
    expect(wrapper.pass?.enabled).toBe(true);
    expect(captured).toHaveLength(1);
    const firstBlur = captured[0].blur;
    expect(firstBlur && typeof firstBlur === "object").toBe(true);
    if (firstBlur && typeof firstBlur === "object") {
      expect(firstBlur.variance).toBeGreaterThan(0);
      expect(firstBlur.variance).toBeLessThanOrEqual(0.5);
    }

    const firstKernel = firstBlur && typeof firstBlur === "object" ? firstBlur.kernelSize : -1;
    let disposedCount = 0;
    const oldBlur = {
      dispose: () => {
        disposedCount++;
      },
    };
    passAny.blurPass = oldBlur;
    wrapper.update({ ...rayState, edgeRadius: 6 }, "#ffffff");
    expect(captured).toHaveLength(2);
    const secondBlur = captured[1].blur;
    const nextKernel = secondBlur && typeof secondBlur === "object" ? secondBlur.kernelSize : -1;
    expect(nextKernel).not.toBe(firstKernel);
    expect(disposedCount).toBe(1);
    expect(passAny.blurPass).not.toBe(oldBlur);

    wrapper.update({ ...rayState, edgeRadius: 6 }, "#ffffff");
    expect(captured).toHaveLength(2);

    dir.castShadow = false;
    wrapper.update(rayState, "#ffffff");
    expect(wrapper.pass?.enabled).toBe(false);

    dir.castShadow = true;
    dir.visible = false;
    wrapper.update(rayState, "#ffffff");
    expect(wrapper.pass?.enabled).toBe(false);

    dir.visible = true;
    wrapper.update({ ...rayState, weight: 0 }, "#ffffff");
    expect(wrapper.pass?.enabled).toBe(false);

    captured.length = 0;
    wrapper.update({ ...rayState, maxDensity: 1.0, weight: 2.0 }, "#ffffff");
    expect(captured).toHaveLength(1);
    expect((captured[0] as { maxDensity?: number }).maxDensity).toBeLessThanOrEqual(0.999);

    expect(() => wrapper.dispose()).not.toThrow();
  });
});

describe("Round 2 regression guards", () => {
  test("lightsAt and resolveLightKeys do not cache stale in-place mutations or leak internal objects", () => {
    const doc: LightsDoc = {
      target: [0, 1, 0],
      keys: [
        { t: 0, key: { intensity: 2 } },
        { t: 2, key: { intensity: 4 } },
        { t: 4, key: { intensity: 6 } },
      ],
    };

    const resolved1 = resolveLightKeys(doc);
    expect(lightsAt(doc, 0).key.intensity).toBe(2);
    expect(lightsAt(doc, 2).key.intensity).toBe(4);
    expect(lightsAt(doc, 0).target).toEqual([0, 1, 0]);

    doc.keys[0].key!.intensity = 9;
    doc.keys[1] = { t: 2, key: { intensity: 10 } };
    doc.target![1] = 8;

    expect(lightsAt(doc, 0).key.intensity).toBe(9);
    expect(lightsAt(doc, 2).key.intensity).toBe(10);
    expect(lightsAt(doc, 0).target).toEqual([0, 8, 0]);

    resolved1[0].state.key.intensity = 999;
    expect(lightsAt(doc, 0).key.intensity).toBe(9);
  });

  test("applyLightingRig preserves pre-existing same-type Fog and FogExp2 until dispose", () => {
    for (const kind of ["linear", "exp2"] as const) {
      const scene = new THREE.Scene();
      const origFog =
        kind === "linear" ? new THREE.Fog("#112233", 3, 25) : new THREE.FogExp2("#223344", 0.04);
      scene.fog = origFog;

      const rig = createLightingRig(scene);
      const nextFog =
        kind === "linear"
          ? { mode: "linear" as const, color: "#ff0000", near: 8, far: 60, density: 0 }
          : { mode: "exp2" as const, color: "#00ff00", near: 1, far: 10, density: 0.25 };
      applyLightingRig(rig, { ...DEFAULT_LIGHTS, fog: nextFog }, 0);

      expect(scene.fog).not.toBe(origFog);
      if (origFog instanceof THREE.Fog) {
        expect(origFog.near).toBe(3);
        expect(origFog.far).toBe(25);
        expect(origFog.color.getHexString()).toBe("112233");
      } else {
        expect(origFog.density).toBeCloseTo(0.04, 6);
        expect(origFog.color.getHexString()).toBe("223344");
      }

      rig.dispose();
      expect(scene.fog).toBe(origFog);
    }
  });

  test("lightsAt sorts coincident [cut, !cut] keys deterministically and handles non-finite t", () => {
    const unsorted: LightKey[] = [
      { t: 2, cut: true, key: { intensity: 8 } },
      { t: 2, key: { intensity: 1 } },
      { t: 0, key: { intensity: 0 } },
    ];
    expect(lightsAt(unsorted, 1).key.intensity).toBeCloseTo(0.5, 4);
    expect(lightsAt(unsorted, 2).key.intensity).toBe(8);

    expect(lightsAt(unsorted, Number.NaN).key.intensity).toBe(0);
    expect(lightsAt(unsorted, -Infinity).key.intensity).toBe(0);
    expect(lightsAt(unsorted, Infinity).key.intensity).toBe(8);
  });
});

describe("createEnvironment", () => {
  test("bakes procedural PMREM environment presets, disposes temporary resources immediately, and releases target on dispose", () => {
    const bakedScenes: THREE.Scene[] = [];
    const targetDisposed = mock(() => {});
    const fakeTexture = new THREE.Texture();
    const fromSceneSpy = spyOn(THREE.PMREMGenerator.prototype, "fromScene").mockImplementation(
      (scene: THREE.Scene) => {
        bakedScenes.push(scene);
        return {
          texture: fakeTexture,
          dispose: targetDisposed,
        } as unknown as THREE.WebGLRenderTarget;
      },
    );
    const pmremDisposeSpy = spyOn(THREE.PMREMGenerator.prototype, "dispose").mockImplementation(
      () => {},
    );
    try {
      const presets = Object.keys(ENVIRONMENT_PRESETS) as Array<keyof typeof ENVIRONMENT_PRESETS>;
      for (const preset of presets) {
        const env = createEnvironment({} as THREE.WebGLRenderer, { preset });
        expect(env.texture).toBe(fakeTexture);
        expect(bakedScenes.at(-1)?.children.length).toBeGreaterThanOrEqual(4);
        env.dispose();
        env.dispose();
      }
      expect(fromSceneSpy).toHaveBeenCalledTimes(presets.length);
      expect(pmremDisposeSpy).toHaveBeenCalledTimes(presets.length);
      expect(targetDisposed).toHaveBeenCalledTimes(presets.length);
      expect(() =>
        createEnvironment({} as THREE.WebGLRenderer, {
          preset: "invalid" as unknown as "studio",
        }),
      ).toThrow(/studio \| outdoor \| night/);
    } finally {
      fromSceneSpy.mockRestore();
      pmremDisposeSpy.mockRestore();
    }
  });

  test("supports custom { bg, ground, panels } specs, interior-warm, and RoomEnvironment 'room' preset with full disposal", () => {
    const bakedScenes: THREE.Scene[] = [];
    const targetDisposed = mock(() => {});
    const fakeTexture = new THREE.Texture();
    const fromSceneSpy = spyOn(THREE.PMREMGenerator.prototype, "fromScene").mockImplementation(
      (scene: THREE.Scene) => {
        bakedScenes.push(scene);
        return {
          texture: fakeTexture,
          dispose: targetDisposed,
        } as unknown as THREE.WebGLRenderTarget;
      },
    );
    const pmremDisposeSpy = spyOn(THREE.PMREMGenerator.prototype, "dispose").mockImplementation(
      () => {},
    );
    try {
      const custom = createEnvironment({} as THREE.WebGLRenderer, {
        bg: 0x9fb4ba,
        ground: 0x30383e,
        panels: [
          { size: [8, 8], at: [0, 6, 0], look: [0, 0, 0], color: 0xffffff, gain: 4 },
          { size: [5, 3], at: [0, 1, 4], look: [0, 1, 0], color: 0x26315c },
        ],
        sigma: 0.03,
      });
      expect(custom.texture).toBe(fakeTexture);
      expect(bakedScenes.at(-1)?.children.length).toBe(3);
      custom.dispose();

      const room = createEnvironment({} as THREE.WebGLRenderer, { preset: "room" });
      expect(room.texture).toBe(fakeTexture);
      expect(bakedScenes.at(-1)?.children.length).toBeGreaterThan(0);
      room.dispose();

      const warm = createEnvironment({} as THREE.WebGLRenderer, { preset: "interior-warm" });
      expect(warm.texture).toBe(fakeTexture);
      warm.dispose();

      const noGround = createEnvironment({} as THREE.WebGLRenderer, {
        preset: "outdoor",
        ground: null,
      });
      expect(bakedScenes.at(-1)?.children.length).toBe(ENVIRONMENT_PRESETS.outdoor.panels.length);
      noGround.dispose();

      const tintedOutdoor = createEnvironment({} as THREE.WebGLRenderer, {
        preset: "outdoor",
        bg: "#112233",
      });
      const tintedScene = bakedScenes.at(-1);
      expect(tintedScene?.background).toBeInstanceOf(THREE.Color);
      expect((tintedScene?.background as THREE.Color | undefined)?.getHexString()).toBe("112233");
      expect(tintedScene?.children.length).toBe(ENVIRONMENT_PRESETS.outdoor.panels.length + 1);
      tintedOutdoor.dispose();

      const bgOnlyStudio = createEnvironment({} as THREE.WebGLRenderer, { bg: "#223344" });
      const bgScene = bakedScenes.at(-1);
      expect(bgScene?.children.length).toBe(ENVIRONMENT_PRESETS.studio.panels.length + 1);
      for (const child of bgScene?.children ?? []) {
        if (child instanceof THREE.Mesh) {
          expect((child.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
        }
      }
      bgOnlyStudio.dispose();

      const explicitEmptyPanels = createEnvironment({} as THREE.WebGLRenderer, {
        bg: "#223344",
        panels: [],
      });
      expect(bakedScenes.at(-1)?.children.length).toBe(1);
      explicitEmptyPanels.dispose();

      expect(() =>
        createEnvironment({} as THREE.WebGLRenderer, {
          preset: "room",
          bg: "#112233",
        }),
      ).toThrow(/room/);

      expect(() =>
        createEnvironment({} as THREE.WebGLRenderer, {
          preset: "toString" as unknown as "studio",
        }),
      ).toThrow(/studio \| outdoor \| night/);

      expect(pmremDisposeSpy).toHaveBeenCalledTimes(7);
      expect(targetDisposed).toHaveBeenCalledTimes(7);
    } finally {
      fromSceneSpy.mockRestore();
      pmremDisposeSpy.mockRestore();
    }
  });
});

describe("Shorts presets, dynamic shadowExtent, applySetLight, probes, sky IBL, HDR IBL, and RectAreaLight", () => {
  test("LIGHT_PRESETS includes all 26 presets (6 core + 6 Shorts + 14 Coverage Round 1) with safe PCF shadowRadius", () => {
    const shortsPresets = [
      "daylight-exterior",
      "bedroom-night",
      "diner-warm",
      "office-daylight",
      "moonlit-exterior",
      "studio-void",
    ] as const;
    const coveragePresets = [
      "hospital-clinical",
      "neon-city",
      "dusk-twilight",
      "storm-rain",
      "underwater-shallow",
      "underwater-deep",
      "space-orbit",
      "xray-cutaway",
      "dramatic-diorama",
      "arctic-snow",
      "desert-harsh",
      "forest-canopy",
      "fire-hazard",
      "cabin-interior",
    ] as const;

    expect(LIGHT_PRESET_IDS).toHaveLength(26);
    for (const id of [...shortsPresets, ...coveragePresets]) {
      expect(LIGHT_PRESET_IDS).toContain(id);
      expect(LIGHT_PRESETS[id].title.length).toBeGreaterThan(2);
      expect(LIGHT_PRESETS[id].state.key.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(LIGHT_PRESETS[id].state.key.shadowRadius).toBeLessThanOrEqual(3.8);
    }

    for (const id of LIGHT_PRESET_IDS) {
      expect(LIGHT_PRESETS[id].state.key.shadowRadius).toBeLessThanOrEqual(4);
    }
  });

  test("ENVIRONMENT_PRESETS includes all 13 procedural presets (4 base + 9 coverage) plus room", () => {
    const expectedProcedural = [
      "studio",
      "outdoor",
      "night",
      "interior-warm",
      "golden-hour",
      "overcast",
      "neon-night",
      "indoor-cool",
      "underwater",
      "space",
      "arctic",
      "dark-stage",
      "explainer-teal",
    ] as const;
    for (const preset of expectedProcedural) {
      expect(ENVIRONMENT_PRESETS[preset]).toBeDefined();
      expect(ENVIRONMENT_PRESETS[preset].panels.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("lightsAt interpolates key.shadowExtent and applyLightingRig updates shadow projection only when extent changes", () => {
    const doc: LightsDoc = {
      keys: [
        { t: 0, key: { shadowExtent: 4 } },
        { t: 2, ease: "linear", key: { shadowExtent: 12 } },
      ],
    };

    expect(lightsAt(doc, 1).key.shadowExtent).toBeCloseTo(8, 5);
    expect(lightsAt(undefined, 0).key.shadowExtent).toBeUndefined();

    const scene = new THREE.Scene();
    const rig = createLightingRig(scene, { shadowExtent: 10 });
    const projSpy = spyOn(rig.key.shadow.camera, "updateProjectionMatrix");

    applyLightingRig(
      rig,
      { ...DEFAULT_LIGHTS, key: { ...DEFAULT_LIGHTS.key, shadowExtent: 5 } },
      0,
    );
    expect(rig.key.shadow.camera.left).toBe(-5);
    expect(rig.key.shadow.camera.right).toBe(5);
    expect(rig.key.shadow.camera.top).toBe(5);
    expect(rig.key.shadow.camera.bottom).toBe(-5);
    expect(projSpy).toHaveBeenCalledTimes(1);

    applyLightingRig(
      rig,
      { ...DEFAULT_LIGHTS, key: { ...DEFAULT_LIGHTS.key, shadowExtent: 5 } },
      1,
    );
    expect(projSpy).toHaveBeenCalledTimes(1);

    applyLightingRig(rig, DEFAULT_LIGHTS, 2);
    expect(rig.key.shadow.camera.right).toBe(10);
    expect(projSpy).toHaveBeenCalledTimes(2);

    rig.dispose();
  });

  test("applySetLight drives focus-following key, hemi/fill, camera-back rim, zero-alloc fog/bg, practicals, and godrays without removing lights", () => {
    const scene = new THREE.Scene();
    const rig = createLightingRig(scene, { shadowExtent: 12 });
    const initialChildren = [rig.key, rig.fill, rig.rim, rig.hemisphere, rig.ambient];

    const raysA = applySetLight(
      rig,
      {
        key: {
          color: "#ffe4c2",
          intensity: 3,
          from: [-4, 8, -3],
          shadowExtent: 6,
          shadowRadius: 2.5,
        },
        hemi: { sky: "#cfe4f2", ground: "#5a4a3a", intensity: 0.7 },
        rim: { color: "#ffd194", intensity: 1.4, mode: "camera-back", distance: 20, height: 5 },
        fog: { mode: "linear", color: "#aabbcc", near: 20, far: 100 },
        background: "#122334",
        environmentIntensity: 0.65,
        practicals: [
          {
            id: "lamp",
            name: "Bedside",
            kind: "point",
            at: [1, 1.5, 2],
            color: "#ffaa55",
            intensity: 4,
            distance: 8,
            decay: 2,
          },
        ],
        godrays: { enabled: true, density: 0.02 },
      },
      [10, 1, 5],
      [10, 2, 15],
    );

    expect(rig.key.position.toArray()).toEqual([6, 9, 2]);
    expect(rig.key.target.position.toArray()).toEqual([10, 1, 5]);
    expect(rig.key.shadow.camera.right).toBe(6);
    expect(rig.fill.visible).toBe(false);
    expect(rig.fill.intensity).toBe(0);
    expect(rig.hemisphere.intensity).toBeCloseTo(0.7, 5);
    expect(rig.rim.visible).toBe(true);
    expect(rig.rim.position.x).toBeCloseTo(10, 4);
    expect(rig.rim.position.y).toBeCloseTo(6, 4);
    expect(rig.rim.position.z).toBeCloseTo(-15, 4);
    expect(scene.environmentIntensity).toBeCloseTo(0.65, 5);
    expect(raysA.enabled).toBe(true);
    expect(raysA.density).toBeCloseTo(0.02, 5);
    expect(rig.practicals.has("lamp")).toBe(true);

    const ownedFogRef = scene.fog;
    const ownedBgRef = scene.background;
    expect(ownedFogRef).toBeInstanceOf(THREE.Fog);
    expect(ownedBgRef).toBeInstanceOf(THREE.Color);

    applySetLight(
      rig,
      {
        key: { intensity: 0 },
        fog: { mode: "linear", color: "#334455", near: 10, far: 60 },
        background: "#445566",
      },
      [0, 0, 0],
    );

    expect(scene.fog).toBe(ownedFogRef);
    expect(scene.background).toBe(ownedBgRef);
    expect((scene.fog as THREE.Fog).near).toBe(10);
    expect((scene.background as THREE.Color).getHexString()).toBe("445566");
    expect(rig.key.visible).toBe(false);
    expect(rig.key.intensity).toBe(0);
    expect(rig.practicals.size).toBe(0);

    for (const light of initialChildren) {
      expect(scene.children).toContain(light);
    }

    applySetLight(
      rig,
      { key: { color: "#ffffff", intensity: 2, from: [-40, 80, -30], shadowExtent: 10 } },
      [0, 1, 0],
    );
    const farDist = rig.key.position.distanceTo(rig.key.target.position);
    expect(rig.key.shadow.camera.far).toBeGreaterThanOrEqual(farDist + 20);

    rig.dispose();
  });

  test("createSkyEnvironment bakes a sky dome into PMREM and disposes generator, dome, and target", () => {
    const bakedScenes: THREE.Scene[] = [];
    const targetDisposed = mock(() => {});
    const fakeTexture = new THREE.Texture();
    const fromSceneSpy = spyOn(THREE.PMREMGenerator.prototype, "fromScene").mockImplementation(
      (scene: THREE.Scene) => {
        bakedScenes.push(scene);
        return {
          texture: fakeTexture,
          dispose: targetDisposed,
        } as unknown as THREE.WebGLRenderTarget;
      },
    );
    const pmremDisposeSpy = spyOn(THREE.PMREMGenerator.prototype, "dispose").mockImplementation(
      () => {},
    );
    try {
      const env = createSkyEnvironment(
        {} as THREE.WebGLRenderer,
        { preset: "golden-hour" },
        { sigma: 0.02 },
      );
      expect(env.texture).toBe(fakeTexture);
      expect(bakedScenes).toHaveLength(1);
      expect(pmremDisposeSpy).toHaveBeenCalledTimes(1);
      env.dispose();
      env.dispose();
      expect(targetDisposed).toHaveBeenCalledTimes(1);
    } finally {
      fromSceneSpy.mockRestore();
      pmremDisposeSpy.mockRestore();
    }
  });

  test("bakeSceneProbe captures a live scene at position without mutating or disposing scene meshes", () => {
    const liveScene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const geoDisposeSpy = spyOn(box.geometry, "dispose");
    liveScene.add(box);

    let capturedArgs: unknown[] = [];
    const targetDisposed = mock(() => {});
    const fakeTexture = new THREE.Texture();
    const fromSceneSpy = spyOn(THREE.PMREMGenerator.prototype, "fromScene").mockImplementation(
      (...args: unknown[]) => {
        capturedArgs = args;
        return {
          texture: fakeTexture,
          dispose: targetDisposed,
        } as unknown as THREE.WebGLRenderTarget;
      },
    );
    const pmremDisposeSpy = spyOn(THREE.PMREMGenerator.prototype, "dispose").mockImplementation(
      () => {},
    );
    try {
      const probe = bakeSceneProbe({} as THREE.WebGLRenderer, liveScene, {
        position: [200, 1.4, 0.4],
        sigma: 0.02,
        near: 0.05,
        far: 120,
        size: 128,
      });
      expect(probe.texture).toBe(fakeTexture);
      expect(capturedArgs[0]).toBe(liveScene);
      expect(capturedArgs[1]).toBe(0.02);
      expect(capturedArgs[2]).toBe(0.05);
      expect(capturedArgs[3]).toBe(120);
      const opts = capturedArgs[4] as { size: number; position: THREE.Vector3 };
      expect(opts.size).toBe(128);
      expect(opts.position.toArray()).toEqual([200, 1.4, 0.4]);
      expect(pmremDisposeSpy).toHaveBeenCalledTimes(1);
      expect(geoDisposeSpy).not.toHaveBeenCalled();

      probe.dispose();
      probe.dispose();
      expect(targetDisposed).toHaveBeenCalledTimes(1);
    } finally {
      fromSceneSpy.mockRestore();
      pmremDisposeSpy.mockRestore();
      box.geometry.dispose();
      box.material.dispose();
    }
  });

  test("loadHDREnvironment loads via HDRLoader, runs fromEquirectangular, and disposes raw texture and generator", async () => {
    const rawDispose = mock(() => {});
    const targetDisposed = mock(() => {});
    const fakeRawTex = Object.assign(new THREE.DataTexture(), { dispose: rawDispose });
    const fakeEnvTex = new THREE.Texture();

    const { HDRLoader } = await import("three/addons/loaders/HDRLoader.js");
    const loadSpy = spyOn(HDRLoader.prototype, "loadAsync").mockResolvedValue(fakeRawTex);
    const eqSpy = spyOn(THREE.PMREMGenerator.prototype, "fromEquirectangular").mockReturnValue({
      texture: fakeEnvTex,
      dispose: targetDisposed,
    } as unknown as THREE.WebGLRenderTarget);
    const pmremDisposeSpy = spyOn(THREE.PMREMGenerator.prototype, "dispose").mockImplementation(
      () => {},
    );
    try {
      const env = await loadHDREnvironment({} as THREE.WebGLRenderer, "env/studio.hdr");
      expect(env.texture).toBe(fakeEnvTex);
      expect(loadSpy).toHaveBeenCalledWith("env/studio.hdr");
      expect(eqSpy).toHaveBeenCalledWith(fakeRawTex);
      expect(rawDispose).toHaveBeenCalledTimes(1);
      expect(pmremDisposeSpy).toHaveBeenCalledTimes(1);
      env.dispose();
      env.dispose();
      expect(targetDisposed).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
      eqSpy.mockRestore();
      pmremDisposeSpy.mockRestore();
    }
  });

  test("createAreaLight lazily initializes RectAreaLightUniformsLib LTC textures once and positions/aims a RectAreaLight", async () => {
    const { RectAreaLightUniformsLib } =
      await import("three/addons/lights/RectAreaLightUniformsLib.js");
    const initSpy = spyOn(RectAreaLightUniformsLib, "init");
    try {
      const a = createAreaLight({
        color: "#fff4e2",
        intensity: 3.5,
        width: 4,
        height: 2,
        at: [0, 4, 0],
        lookAt: [0, 0, 0],
      });
      const callsAfterFirst = initSpy.mock.calls.length;
      const uniformsLib = THREE.UniformsLib as Record<string, unknown>;
      expect(uniformsLib.LTC_FLOAT_1).toBeInstanceOf(THREE.DataTexture);
      expect(uniformsLib.LTC_FLOAT_2).toBeInstanceOf(THREE.DataTexture);

      const b = createAreaLight({
        color: "#e0eeff",
        intensity: 2,
        width: 3,
        height: 3,
        at: [2, 3, 1],
      });

      expect(a).toBeInstanceOf(THREE.RectAreaLight);
      expect(a.color.getHexString()).toBe("fff4e2");
      expect(a.intensity).toBe(3.5);
      expect(a.width).toBe(4);
      expect(a.height).toBe(2);
      expect(a.position.toArray()).toEqual([0, 4, 0]);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(a.quaternion);
      expect(forward.y).toBeCloseTo(-1, 5);

      expect(b).toBeInstanceOf(THREE.RectAreaLight);
      expect(b.position.toArray()).toEqual([2, 3, 1]);
      expect(initSpy.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      initSpy.mockRestore();
    }
  });

  test("resolveLightKeys ignores inherited Object.prototype keys like toString as preset names", () => {
    const resolved = resolveLightKeys([{ t: 0, preset: "toString", key: { intensity: 1.5 } }]);
    expect(resolved[0].state.key.intensity).toBe(1.5);
    expect(resolved[0].state.key.color).toBe(DEFAULT_LIGHTS.key.color);
  });

  test("createGodraysPass.dispose cleans up leaked blurRenderTarget and depthCopyTarget render targets", () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.castShadow = true;
    const wrapper = createGodraysPass(dir, cam);
    expect(wrapper.supported).toBe(true);

    const blurRtDispose = mock(() => {});
    const illumDepthTexDispose = mock(() => {});
    const illumRtDispose = mock(() => {});
    const compDepthTexDispose = mock(() => {});
    const compRtDispose = mock(() => {});

    const internal = wrapper.pass as unknown as {
      blurRenderTarget: { dispose: () => void } | null;
      illumPass: {
        depthCopyTarget: { depthTexture: { dispose: () => void }; dispose: () => void } | null;
      };
      compositorPass: {
        depthCopyTarget: { depthTexture: { dispose: () => void }; dispose: () => void } | null;
      };
    };
    internal.blurRenderTarget = { dispose: blurRtDispose };
    internal.illumPass.depthCopyTarget = {
      depthTexture: { dispose: illumDepthTexDispose },
      dispose: illumRtDispose,
    };
    internal.compositorPass.depthCopyTarget = {
      depthTexture: { dispose: compDepthTexDispose },
      dispose: compRtDispose,
    };

    wrapper.dispose();
    wrapper.dispose();

    expect(wrapper.pass).toBeNull();
    expect(blurRtDispose).toHaveBeenCalledTimes(1);
    expect(illumDepthTexDispose).toHaveBeenCalledTimes(1);
    expect(illumRtDispose).toHaveBeenCalledTimes(1);
    expect(compDepthTexDispose).toHaveBeenCalledTimes(1);
    expect(compRtDispose).toHaveBeenCalledTimes(1);
    expect(internal.blurRenderTarget).toBeNull();
    expect(internal.illumPass.depthCopyTarget).toBeNull();
    expect(internal.compositorPass.depthCopyTarget).toBeNull();
  });

  test("practicalIntensityAt guards NaN/Infinity t and intensity, and interpolatePractical defaults missing spot targets to ground below light", () => {
    const lamp = {
      id: "lamp",
      name: "Lamp",
      kind: "point" as const,
      at: [0, 2, 0] as [number, number, number],
      color: "#ffaa44",
      intensity: 4,
      distance: 8,
      decay: 2,
      flicker: { rate: 10, amount: 0.3, seed: 5 },
    };
    const atNaN = practicalIntensityAt(lamp, Number.NaN);
    const atInf = practicalIntensityAt(lamp, Infinity);
    const atNegInf = practicalIntensityAt(lamp, -Infinity);
    expect(Number.isFinite(atNaN)).toBe(true);
    expect(Number.isFinite(atInf)).toBe(true);
    expect(Number.isFinite(atNegInf)).toBe(true);
    expect(atNaN).toBe(practicalIntensityAt(lamp, 0));
    expect(practicalIntensityAt({ ...lamp, intensity: Number.NaN }, 1)).toBe(0);

    const mid = lightsAt(
      [
        {
          t: 0,
          practicals: [
            {
              id: "s1",
              name: "Spot",
              kind: "spot",
              at: [2, 6, 4],
              color: "#ffffff",
              intensity: 4,
              distance: 10,
              decay: 2,
            },
          ],
        },
        {
          t: 2,
          ease: "linear",
          practicals: [
            {
              id: "s1",
              name: "Spot",
              kind: "spot",
              at: [2, 6, 4],
              target: [2, 2, 4],
              color: "#ffffff",
              intensity: 4,
              distance: 10,
              decay: 2,
            },
          ],
        },
      ],
      1,
    );
    expect(mid.practicals[0].target).toEqual([2, 1, 4]);
  });

  test("createGodraysPass.update refreshes illumPass lightCameraNear/lightCameraFar when applySetLight changes shadowExtent", () => {
    const scene = new THREE.Scene();
    const rig = createLightingRig(scene, { shadowExtent: 10 });
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    const godrays = createGodraysPass(rig.key, cam);
    expect(godrays.supported).toBe(true);

    const raySpec = { enabled: true, density: 0.02, weight: 1 };
    applySetLight(
      rig,
      { key: { from: [-10, 15, -10], shadowExtent: 8 }, godrays: raySpec },
      [0, 0, 0],
      undefined,
      {
        godrays,
      },
    );
    const illumUniforms = (
      godrays.pass as unknown as {
        illumPass: {
          material: {
            uniforms: { lightCameraNear: { value: number }; lightCameraFar: { value: number } };
          };
        };
      }
    ).illumPass.material.uniforms;
    const farBefore = illumUniforms.lightCameraFar.value;
    expect(farBefore).toBeCloseTo(rig.key.shadow.camera.far, 4);

    applySetLight(
      rig,
      { key: { from: [-40, 80, -30], shadowExtent: 25, shadowNear: 1.5 }, godrays: raySpec },
      [0, 0, 0],
      undefined,
      { godrays },
    );
    expect(illumUniforms.lightCameraNear.value).toBeCloseTo(1.5, 4);
    expect(illumUniforms.lightCameraFar.value).toBeCloseTo(rig.key.shadow.camera.far, 4);
    expect(illumUniforms.lightCameraFar.value).toBeGreaterThan(farBefore);

    const ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    const orthoGodrays = createGodraysPass(rig.key, ortho);
    expect(orthoGodrays.supported).toBe(false);
    expect(orthoGodrays.pass).toBeNull();

    applySetLight(rig, { key: { dir: [3, 4, 0], distance: 10 } }, [1, 2, 3]);
    expect(rig.key.position.x).toBeCloseTo(1 + 6, 4);
    expect(rig.key.position.y).toBeCloseTo(2 + 8, 4);
    expect(rig.key.position.z).toBeCloseTo(3, 4);

    applySetLight(rig, { key: { dir: [0, 0, 0], distance: 12 } }, [1, 2, 3]);
    expect(rig.key.position.x).toBeCloseTo(1, 4);
    expect(rig.key.position.y).toBeCloseTo(14, 4);
    expect(rig.key.position.z).toBeCloseTo(3, 4);

    applySetLight(
      rig,
      {
        key: { intensity: Number.NaN, shadowRadius: Number.NaN, from: [Number.NaN, 5, 0] },
        hemi: { intensity: Number.NaN },
        fog: { mode: "linear", color: "#112233", near: Number.NaN, far: Number.NaN },
        environmentIntensity: Number.NaN,
        practicals: [
          {
            id: "nan-spot",
            kind: "spot",
            color: "#ffffff",
            intensity: Number.NaN,
            at: [Number.NaN, 2, 0],
            distance: Number.NaN,
            decay: Number.NaN,
            angle: Number.NaN,
            penumbra: Number.NaN,
            target: [0, Number.NaN, 0],
          },
        ],
      },
      [1, 2, 3],
    );
    expect(Number.isFinite(rig.key.intensity)).toBe(true);
    expect(Number.isFinite(rig.key.shadow.radius)).toBe(true);
    expect(Number.isFinite(rig.key.position.x)).toBe(true);
    expect(Number.isFinite(rig.hemisphere.intensity)).toBe(true);
    expect(Number.isFinite(scene.environmentIntensity)).toBe(true);
    expect(Number.isFinite((scene.fog as THREE.Fog).near)).toBe(true);
    expect(Number.isFinite((scene.fog as THREE.Fog).far)).toBe(true);
    const nanSpot = rig.practicals.get("nan-spot")?.light as THREE.SpotLight | undefined;
    expect(nanSpot).toBeDefined();
    expect(Number.isFinite(nanSpot!.position.x)).toBe(true);
    expect(Number.isFinite(nanSpot!.intensity)).toBe(true);
    expect(Number.isFinite(nanSpot!.distance)).toBe(true);
    expect(Number.isFinite(nanSpot!.decay)).toBe(true);
    expect(Number.isFinite(nanSpot!.angle)).toBe(true);
    expect(Number.isFinite(nanSpot!.penumbra)).toBe(true);
    expect(Number.isFinite(nanSpot!.target.position.y)).toBe(true);

    godrays.dispose();
    expect(godrays.pass).toBeNull();
    rig.dispose();
  });
});
