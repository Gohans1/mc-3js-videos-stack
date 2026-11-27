import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import {
  BACKDROP_PRESET_IDS,
  BACKDROP_PRESETS,
  createCelestialDisc,
  createCloudLayer,
  createSkyDome,
  createStarfield,
  createStudioBackdrop,
  SKY_PRESET_IDS,
  SKY_PRESETS,
  type SkyPresetId,
  type StudioBackdropPresetId,
} from "../src/sky";

describe("createSkyDome", () => {
  test("creates a linear-HDR BackSide sky sphere with all required uniforms and no inline tone-mapping or colorspace chunks", () => {
    const sky = createSkyDome({
      zenith: "#3366aa",
      horizon: "#ccdde8",
      ground: "#554433",
      sunDir: [-2, 4, -2],
      sunGlow: 1.2,
      sunColor: "#ffe0a0",
      horizonPower: 0.5,
      radius: 300,
    });

    expect(sky.mesh).toBeInstanceOf(THREE.Mesh);
    expect(sky.mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(sky.mesh.geometry.parameters.radius).toBe(300);
    expect(sky.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(sky.material.side).toBe(THREE.BackSide);
    expect(sky.material.depthWrite).toBe(false);
    expect(sky.material.fog).toBe(false);
    expect(sky.mesh.frustumCulled).toBe(false);
    expect(sky.mesh.renderOrder).toBeLessThan(0);

    expect(sky.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(sky.material.fragmentShader).not.toContain("#include <colorspace_fragment>");
    expect(sky.material.fragmentShader).not.toContain("smoothstep(0.0, -0.08");

    expect(sky.uniforms.zenith.value.getHexString()).toBe("3366aa");
    expect(sky.uniforms.horizon.value.getHexString()).toBe("ccdde8");
    expect(sky.uniforms.ground.value.getHexString()).toBe("554433");
    expect(sky.uniforms.sunDir.value.length()).toBeCloseTo(1, 5);
    expect(sky.uniforms.sunGlow.value).toBeCloseTo(1.2, 5);
    expect(sky.uniforms.sunColor.value.getHexString()).toBe("ffe0a0");
    expect(sky.uniforms.horizonPower.value).toBeCloseTo(0.5, 5);

    sky.dispose();
  });

  test("supports all 12 SKY_PRESETS with per-field overrides and rejects unknown presets", () => {
    const required: SkyPresetId[] = [
      "daylight",
      "golden-hour",
      "overcast",
      "dusk",
      "night",
      "dawn",
      "stormy",
      "city-night",
      "underwater",
      "space",
      "arctic",
      "desert",
    ];
    expect(SKY_PRESET_IDS).toHaveLength(12);
    for (const id of required) {
      expect(SKY_PRESET_IDS).toContain(id);
      const sky = createSkyDome({ preset: id, sunGlow: 0.25 });
      expect(sky.uniforms.zenith.value.getHex()).toBe(
        new THREE.Color(SKY_PRESETS[id].zenith).getHex(),
      );
      expect(sky.uniforms.sunGlow.value).toBeCloseTo(0.25, 5);
      sky.dispose();
    }

    expect(() => createSkyDome({ preset: "mars" as SkyPresetId })).toThrow(/daylight/);
    expect(() => createSkyDome({ preset: "toString" as SkyPresetId })).toThrow(/daylight/);
  });

  test("set updates only provided fields, guards zero sunDir, follow tracks world position, and dispose detaches idempotently", () => {
    const scene = new THREE.Scene();
    const sky = createSkyDome({ zenith: "#112233", horizon: "#aabbcc", sunGlow: 0.8 });
    scene.add(sky.mesh);

    sky.set({ sunGlow: 0.3, sunDir: [0, 0, 0] });
    expect(sky.uniforms.zenith.value.getHexString()).toBe("112233");
    expect(sky.uniforms.horizon.value.getHexString()).toBe("aabbcc");
    expect(sky.uniforms.sunGlow.value).toBeCloseTo(0.3, 5);
    expect(Number.isFinite(sky.uniforms.sunDir.value.y)).toBe(true);
    expect(sky.uniforms.sunDir.value.length()).toBeCloseTo(1, 5);

    const rig = new THREE.Group();
    rig.position.set(10, 2, -5);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(1, 3, 4);
    rig.add(cam);
    scene.add(rig);

    sky.follow(cam);
    expect(sky.mesh.position.toArray()).toEqual([11, 5, -1]);

    sky.follow(new THREE.Vector3(-4, 7, 9));
    expect(sky.mesh.position.toArray()).toEqual([-4, 7, 9]);

    sky.dispose();
    sky.dispose();
    expect(scene.children).not.toContain(sky.mesh);
  });
});

describe("createStudioBackdrop", () => {
  test("creates a screen-space radial halo quad with pure linear shader, set, setAspect, and idempotent dispose", () => {
    const scene = new THREE.Scene();
    const backdrop = createStudioBackdrop({
      edge: "#33aec4",
      halo: "#b5c1c8",
      centre: [0.53, 0.49],
      radius: 0.52,
      aspect: 9 / 16,
      power: 1.5,
      stretch: 0.75,
    });
    scene.add(backdrop.mesh);

    expect(backdrop.mesh).toBeInstanceOf(THREE.Mesh);
    expect(backdrop.mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(backdrop.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(backdrop.material.depthWrite).toBe(false);
    expect(backdrop.material.depthTest).toBe(false);
    expect(backdrop.material.fog).toBe(false);
    expect(backdrop.mesh.frustumCulled).toBe(false);
    expect(backdrop.mesh.renderOrder).toBeLessThan(0);

    expect(backdrop.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(backdrop.material.fragmentShader).not.toContain("#include <colorspace_fragment>");

    expect(backdrop.uniforms.edge.value.getHexString()).toBe("33aec4");
    expect(backdrop.uniforms.halo.value.getHexString()).toBe("b5c1c8");
    expect(backdrop.uniforms.centre.value.x).toBeCloseTo(0.53, 5);
    expect(backdrop.uniforms.centre.value.y).toBeCloseTo(0.49, 5);
    expect(backdrop.uniforms.radius.value).toBeCloseTo(0.52, 5);
    expect(backdrop.uniforms.aspect.value).toBeCloseTo(9 / 16, 5);
    expect(backdrop.uniforms.power.value).toBeCloseTo(1.5, 5);
    expect(backdrop.uniforms.stretch.value).toBeCloseTo(0.75, 5);

    backdrop.set({ edge: "#112233", power: 2.2 });
    expect(backdrop.uniforms.edge.value.getHexString()).toBe("112233");
    expect(backdrop.uniforms.halo.value.getHexString()).toBe("b5c1c8");
    expect(backdrop.uniforms.power.value).toBeCloseTo(2.2, 5);

    backdrop.setAspect(16 / 9);
    expect(backdrop.uniforms.aspect.value).toBeCloseTo(16 / 9, 5);

    backdrop.dispose();
    backdrop.dispose();
    expect(scene.children).not.toContain(backdrop.mesh);
  });

  test("supports all 8 BACKDROP_PRESETS with overrides, stays purely linear without inline dither, matches explainer-cyan by default, and rejects unknown presets", () => {
    const required: StudioBackdropPresetId[] = [
      "explainer-cyan",
      "explainer-blue",
      "studio-light",
      "medical-clean",
      "cutaway-slate",
      "dark-dramatic",
      "warm-studio",
      "neon-violet",
    ];
    expect(BACKDROP_PRESET_IDS).toHaveLength(8);
    const def = createStudioBackdrop();
    expect(def.uniforms.centre.value.toArray()).toEqual([
      ...BACKDROP_PRESETS["explainer-cyan"].centre,
    ]);
    expect(def.uniforms.radius.value).toBeCloseTo(BACKDROP_PRESETS["explainer-cyan"].radius, 5);
    expect(def.uniforms.power.value).toBeCloseTo(BACKDROP_PRESETS["explainer-cyan"].power, 5);
    expect(def.uniforms.stretch.value).toBeCloseTo(BACKDROP_PRESETS["explainer-cyan"].stretch, 5);
    def.dispose();

    for (const id of required) {
      expect(BACKDROP_PRESET_IDS).toContain(id);
      const b = createStudioBackdrop({ preset: id, aspect: 16 / 9 });
      expect(b.uniforms.edge.value.getHex()).toBe(
        new THREE.Color(BACKDROP_PRESETS[id].edge).getHex(),
      );
      expect(b.uniforms.aspect.value).toBeCloseTo(16 / 9, 5);
      expect(b.material.fragmentShader).not.toContain("255.0");
      expect(b.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
      expect(b.material.fragmentShader).not.toContain("#include <colorspace_fragment>");
      b.dispose();
    }
    expect(() => createStudioBackdrop({ preset: "invalid" as StudioBackdropPresetId })).toThrow(
      /explainer-cyan/,
    );
    expect(() => createStudioBackdrop({ preset: "toString" as StudioBackdropPresetId })).toThrow(
      /explainer-cyan/,
    );
  });
});

describe("createCloudLayer", () => {
  const quads = (layer: ReturnType<typeof createCloudLayer>) => {
    const geo = layer.mesh.geometry;
    const pos = geo.getAttribute("position");
    const col = geo.getAttribute("color");
    const idx = geo.getIndex()!;
    const out: Array<{ n: string; shade: number }> = [];
    for (let q = 0; q < idx.count / 6; q++) {
      const [a, b, c] = [0, 1, 2].map((i) =>
        new THREE.Vector3().fromBufferAttribute(pos, idx.getX(q * 6 + i)),
      );
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize().round();
      out.push({ n: n.toArray().map(String).join(","), shade: col.getX(idx.getX(q * 6)) });
    }
    return out;
  };

  test("draws a lone cell as Minecraft does: six outward faces shaded on screen top 1, east/west 0.9, north/south 0.8, bottom 0.7", () => {
    const layer = createCloudLayer({ cell: 12, height: 4, grid: [[1, 0], [0, 0]] });
    const onScreen = (v: number) => new THREE.Color(v, v, v).getStyle(THREE.SRGBColorSpace);
    const shades = Object.fromEntries(
      quads(layer).map((q) => [q.n, Number(/\d+/.exec(onScreen(q.shade))![0]) / 255]),
    );
    expect(Object.keys(shades).sort()).toEqual(
      ["-1,0,0", "0,-1,0", "0,0,-1", "0,0,1", "0,1,0", "1,0,0"].sort(),
    );
    expect(shades["0,1,0"]).toBeCloseTo(1);
    expect(shades["1,0,0"]).toBeCloseTo(0.9);
    expect(shades["-1,0,0"]).toBeCloseTo(0.9);
    expect(shades["0,0,1"]).toBeCloseTo(0.8);
    expect(shades["0,0,-1"]).toBeCloseTo(0.8);
    expect(shades["0,-1,0"]).toBeCloseTo(0.7);
    layer.dispose();
  });

  test("keeps only the faces against an empty cell, the grid tiling as the layer repeats", () => {
    const pair = createCloudLayer({ grid: [[1, 1, 0, 0], [0, 0, 0, 0]] });
    expect(quads(pair).length).toBe(10);
    expect(quads(pair).filter((q) => q.n === "1,0,0").length).toBe(1);
    const acrossTheSeam = createCloudLayer({ grid: [[1, 0, 0, 1], [0, 0, 0, 0]] });
    expect(quads(acrossTheSeam).length).toBe(10);
    pair.dispose();
    acrossTheSeam.dispose();
  });

  test("reads a cloud map's opaque pixels as cells, like the game's clouds.png", () => {
    const layer = createCloudLayer({
      image: { width: 2, height: 2, data: [255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 40, 0, 0, 0, 0] },
    });
    expect(quads(layer).length).toBe(6);
    expect(layer.span).toBe(24);
    layer.dispose();
  });

  test("is the game's translucent layer at alpha 0.8, where only the nearest cloud shows: a depth-only pass, then colour where it is nearest", () => {
    const layer = createCloudLayer({ grid: [[1]] });
    expect(layer.material.transparent).toBe(true);
    expect(layer.material.opacity).toBeCloseTo(0.8);
    const [depth, colour] = layer.mesh.material;
    expect(depth!.colorWrite).toBe(false);
    expect(depth!.depthWrite).toBe(true);
    expect(colour).toBe(layer.material);
    expect(colour!.depthFunc).toBe(THREE.LessEqualDepth);
    const count = layer.mesh.geometry.getIndex()!.count;
    expect(layer.mesh.geometry.groups).toEqual([
      { start: 0, count, materialIndex: 0 },
      { start: 0, count, materialIndex: 1 },
    ]);
    expect(createCloudLayer({ grid: [[1]], opacity: 0.5 }).material.opacity).toBe(0.5);
    layer.dispose();
  });

  test("fades its clouds out by `fade` units (the game's 2048 blocks) and repeats the map far enough to reach it, so no edge shows", () => {
    expect(createCloudLayer({ grid: [[1]] }).uniforms.cloudFade.value).toBe(0);
    const one = createCloudLayer({ cell: 12, grid: [[1, 0], [0, 0]] });
    expect(one.uniforms.cloudSpan.value.toArray()).toEqual([24, 24]);
    const far = createCloudLayer({ cell: 12, grid: [[1, 0], [0, 0]], fade: 50 });
    expect(far.uniforms.cloudFade.value).toBe(50);
    expect(far.uniforms.cloudSpan.value.x / 2).toBeGreaterThanOrEqual(50);
    expect(far.uniforms.cloudSpan.value.x).toBe(far.uniforms.cloudSpan.value.y);
    const copies = far.uniforms.cloudSpan.value.x / 24;
    expect(quads(far).length).toBe(6 * copies * copies);
  });

  test("builds the same noise layer from the same seed, follows the camera and drifts with the wind deterministically", () => {
    const opts = { cell: 10, height: 3, gridSize: 16, coverage: 0.4, seed: 42, altitude: 80 };
    const a = createCloudLayer(opts);
    const b = createCloudLayer(opts);
    expect(a.mesh).toBeInstanceOf(THREE.Mesh);
    expect(quads(a).length).toBeGreaterThan(0);
    expect(Array.from(a.mesh.geometry.getAttribute("position").array)).toEqual(
      Array.from(b.mesh.geometry.getAttribute("position").array),
    );
    expect(a.span).toBe(160);
    expect(a.mesh.position.y).toBe(80);

    const cam = new THREE.PerspectiveCamera();
    cam.position.set(250, 12, -190);
    a.follow(cam, { y: 95, origin: [500, -400] });
    expect(a.mesh.position.toArray()).toEqual([250, 95, -190]);
    a.update(5, [4, -2]);
    expect(a.uniforms.cloudShift.value.toArray()).toEqual([500 + 20 - 250, -400 - 10 + 190]);
    expect(a.uniforms.cloudSpan.value.toArray()).toEqual([160, 160]);
    a.update(12, [4, -2]);
    a.update(5, [4, -2]);
    expect(a.uniforms.cloudShift.value.toArray()).toEqual([270, -220]);

    const scene = new THREE.Scene();
    scene.add(a.mesh);
    a.dispose();
    a.dispose();
    b.dispose();
    expect(scene.children).not.toContain(a.mesh);
  });
});

describe("createStarfield", () => {
  test("creates deterministic spectral THREE.Points starfield with linear shader, far-plane xyww, follow, seek-independent twinkle update(t), and dispose", () => {
    const a = createStarfield({ count: 300, radius: 350, seed: 9 });
    const b = createStarfield({ count: 300, radius: 350, seed: 9 });

    expect(a.points).toBeInstanceOf(THREE.Points);
    expect(a.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(a.material.fog).toBe(false);
    expect(a.material.depthWrite).toBe(false);
    expect(a.material.depthFunc).toBe(THREE.LessEqualDepth);
    expect(a.material.vertexShader).toContain("p.xyww");
    expect(a.material.vertexShader).toContain("isOrthographic");
    expect(a.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(a.material.fragmentShader).not.toContain("#include <colorspace_fragment>");

    const posA = a.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const posB = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colA = a.points.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    expect(posA.count).toBe(300);
    expect(Array.from(posA.array)).toEqual(Array.from(posB.array));
    expect(colA.count).toBe(300);

    const fixedPointTest = createStarfield({ count: 64, radius: 100, seed: -0x6d2b79f5 });
    const fpPos = fixedPointTest.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const uniqueX = new Set<number>();
    for (let i = 0; i < fpPos.count; i++) uniqueX.add(Math.round(fpPos.getX(i) * 100));
    expect(uniqueX.size).toBeGreaterThan(20);
    fixedPointTest.dispose();

    const r0 = Math.hypot(posA.getX(0), posA.getY(0), posA.getZ(0));
    expect(r0).toBeCloseTo(350, 3);

    a.update(4.5);
    const tFirst = (a.material.uniforms.uTime as { value: number }).value;
    a.update(9.0);
    a.update(4.5);
    expect((a.material.uniforms.uTime as { value: number }).value).toBe(tFirst);
    expect(tFirst).toBe(4.5);

    const cam = new THREE.PerspectiveCamera();
    cam.position.set(12, 34, -56);
    a.follow(cam);
    expect(a.points.position.toArray()).toEqual([12, 34, -56]);

    const scene = new THREE.Scene();
    scene.add(a.points);
    a.dispose();
    a.dispose();
    b.dispose();
    expect(scene.children).not.toContain(a.points);
  });
});

describe("createCelestialDisc", () => {
  test("creates round and square linear-HDR sun/moon billboards with N8AO-safe additive alpha, xyww far-plane projection, and immediate set() repositioning", () => {
    const sun = createCelestialDisc({
      kind: "sun",
      shape: "square",
      dir: [0, 1, 0],
      distance: 200,
      size: 30,
    });
    const moon = createCelestialDisc({
      kind: "moon",
      shape: "round",
      dir: [-1, 1, 0],
      distance: 150,
      size: 20,
    });

    expect(sun.mesh).toBeInstanceOf(THREE.Mesh);
    expect(sun.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(sun.material.fog).toBe(false);
    expect(sun.material.depthWrite).toBe(false);
    expect(sun.material.depthFunc).toBe(THREE.LessEqualDepth);
    expect(sun.material.vertexShader).toContain("p.xyww");
    expect(sun.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(sun.material.fragmentShader).not.toContain("#include <colorspace_fragment>");
    expect((sun.material.uniforms.uSquare as { value: number }).value).toBe(1);
    expect((moon.material.uniforms.uSquare as { value: number }).value).toBe(0);

    sun.set({ dir: [0, 0, -1], distance: 120 });
    expect(sun.mesh.position.x).toBeCloseTo(0, 4);
    expect(sun.mesh.position.y).toBeCloseTo(0, 4);
    expect(sun.mesh.position.z).toBeCloseTo(-120, 4);

    const cam = new THREE.PerspectiveCamera();
    cam.position.set(10, 5, 20);
    sun.set({ dir: [0, 1, 0], distance: 200 });
    sun.follow(cam);
    expect(sun.mesh.position.x).toBeCloseTo(10, 4);
    expect(sun.mesh.position.y).toBeCloseTo(205, 4);
    expect(sun.mesh.position.z).toBeCloseTo(20, 4);

    sun.set({ intensity: 6, dir: [1, 0, 0], distance: 180 });
    expect(sun.mesh.position.x).toBeCloseTo(190, 4);
    expect(sun.mesh.position.y).toBeCloseTo(5, 4);
    expect(sun.mesh.position.z).toBeCloseTo(20, 4);

    const scene = new THREE.Scene();
    scene.add(sun.mesh, moon.mesh);
    sun.dispose();
    sun.dispose();
    moon.dispose();
    expect(scene.children).not.toContain(sun.mesh);
  });

  test("guards NaN numeric options across sky, backdrop, clouds, starfield, and celestial disc", () => {
    const sky = createSkyDome({
      radius: Number.NaN,
      sunGlow: Number.NaN,
      horizonPower: Number.NaN,
      sunDir: [Number.NaN, 1, 0],
    });
    expect(Number.isFinite(sky.mesh.geometry.parameters.radius)).toBe(true);
    expect(Number.isFinite(sky.uniforms.sunGlow.value)).toBe(true);
    expect(Number.isFinite(sky.uniforms.horizonPower.value)).toBe(true);
    expect(Number.isFinite(sky.uniforms.sunDir.value.x)).toBe(true);
    sky.set({ sunGlow: Number.NaN, horizonPower: Number.NaN });
    expect(Number.isFinite(sky.uniforms.sunGlow.value)).toBe(true);
    expect(Number.isFinite(sky.uniforms.horizonPower.value)).toBe(true);
    sky.dispose();

    const backdrop = createStudioBackdrop({
      radius: Number.NaN,
      aspect: Number.NaN,
      power: Number.NaN,
      stretch: Number.NaN,
    });
    expect(Number.isFinite(backdrop.uniforms.radius.value)).toBe(true);
    expect(Number.isFinite(backdrop.uniforms.aspect.value)).toBe(true);
    expect(Number.isFinite(backdrop.uniforms.power.value)).toBe(true);
    expect(Number.isFinite(backdrop.uniforms.stretch.value)).toBe(true);
    backdrop.setAspect(Number.NaN);
    expect(Number.isFinite(backdrop.uniforms.aspect.value)).toBe(true);
    backdrop.dispose();

    const clouds = createCloudLayer({
      cell: Number.NaN,
      height: Number.NaN,
      altitude: Number.NaN,
      coverage: Number.NaN,
    });
    expect(Number.isFinite(clouds.span)).toBe(true);
    expect(Number.isFinite(clouds.mesh.position.y)).toBe(true);
    clouds.dispose();

    const stars = createStarfield({
      count: Number.NaN,
      radius: Number.NaN,
      size: Number.NaN,
      brightness: Number.NaN,
    });
    expect(stars.points.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(Number.isFinite((stars.material.uniforms.uBrightness as { value: number }).value)).toBe(
      true,
    );
    stars.dispose();

    const disc = createCelestialDisc({
      distance: Number.NaN,
      size: Number.NaN,
      intensity: Number.NaN,
      halo: Number.NaN,
    });
    expect(Number.isFinite(disc.mesh.position.x)).toBe(true);
    expect(Number.isFinite((disc.material.uniforms.uIntensity as { value: number }).value)).toBe(
      true,
    );
    disc.dispose();
  });
});
