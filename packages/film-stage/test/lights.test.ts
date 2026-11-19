import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";

import {
  applyLightingRig,
  createGodraysPass,
  createLightingRig,
  DEFAULT_LIGHTS,
  kelvinToHex,
  LIGHT_PRESET_IDS,
  LIGHT_PRESETS,
  type LightKey,
  lightsAt,
  type LightsDoc,
  practicalIntensityAt,
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

    // Clamps extreme inputs cleanly without NaN
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
    // Wraps 350 -> 10 across 0 instead of swinging backward through 180
    expect(mid.key.azimuth).toBeCloseTo(0, 4);
    expect(mid.fog.near).toBeCloseTo(15, 5);
    expect(mid.fog.far).toBeCloseTo(40, 5);
    // Midpoint in linear RGB between #ff0000 (1,0,0) and #0000ff (0,0,1) -> (0.5,0,0.5) linear = ~#bc00bc sRGB
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
    // Azimuth 90, Elevation 0 places key along +X from target [2, 1, 2]
    expect(rig.key.position.x).toBeCloseTo(2 + 12, 3);
    expect(rig.key.position.y).toBeCloseTo(1, 3);
    expect(rig.key.position.z).toBeCloseTo(2, 3);
    // Negative fill attenuates ground bounce / ambient & fill contrast without invalid negative light
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

    // Switching fog mode to linear then none updates scene.fog cleanly; removing practical removes from scene
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

    // Overshoot bezier dips below 0 and exceeds 1 around endpoints
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

    // Clearing world.background restores initial background cleanly
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

    // Kernel change clears previous blurPass cleanly before setParams instead of keeping disposed pass
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

    // Repeating identical params does not re-invoke setParams
    wrapper.update({ ...rayState, edgeRadius: 6 }, "#ffffff");
    expect(captured).toHaveLength(2);

    // Gated off cleanly when castShadow=false or visible=false or density/weight <= 0
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

    expect(() => wrapper.dispose()).not.toThrow();
  });
});
