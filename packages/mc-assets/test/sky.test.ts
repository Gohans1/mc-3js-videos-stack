import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import { biomeEnvironment, createMinecraftClouds, timeline } from "../src/environment";
import {
  createMinecraftSky,
  fogColorFacing,
  javaRandom,
  lightmap,
  type SkyState,
  skyState,
  useVanillaFog,
  vanillaStars,
  waterVision,
} from "../src/sky";
import { fakeRenderer } from "./vanilla-data";

const hex = ([r, g, b]: readonly number[]) =>
  [r, g, b]
    .map((v) =>
      Math.round(v! * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

async function stateAt(
  biome: string,
  conditions: Parameters<typeof skyState>[2] = {},
): Promise<SkyState> {
  const renderer = fakeRenderer();
  const env = await biomeEnvironment([], biome, { renderer });
  const lines = await Promise.all(env.timelines.map((id) => timeline([], id, { renderer })));
  return skyState(env, lines, conditions);
}

describe("javaRandom", () => {
  test("draws what java.util.Random draws from the same seed", () => {
    const r = javaRandom(10842);
    expect([r.nextFloat(), r.nextFloat(), r.nextFloat(), r.nextFloat()]).toEqual([
      Math.fround(0.12987703),
      Math.fround(0.037620723),
      Math.fround(0.8834354),
      Math.fround(0.9509856),
    ]);
    expect(r.nextDouble()).toBeCloseTo(0.3331155735128949, 15);
  });

  test("draws java.util.Random's ints and gaussians, which the weather rolls", () => {
    const r = javaRandom(-123456789);
    expect([r.nextInt(21), r.nextInt(16)]).toEqual([13, 12]);
    expect(r.nextFloat()).toBeCloseTo(0.96539897, 7);
    expect(r.nextDouble()).toBe(0.7006048333539494);
    expect(r.nextGaussian()).toBeCloseTo(-1.1141722510011245, 14);
    expect(r.nextGaussian()).toBeCloseTo(1.857741067928237, 14);
    expect(r.nextInt(1000000007)).toBe(722141591);
  });
});

describe("vanillaStars", () => {
  test("keeps the 780 of 1500 tries the game keeps from seed 10842, each a square 100 blocks out facing the eye", () => {
    const stars = vanillaStars();
    expect(stars.length).toBe(780 * 4 * 3);
    const corner = (i: number) =>
      new THREE.Vector3(stars[i * 3], stars[i * 3 + 1], stars[i * 3 + 2]);
    const [a, b, c, d] = [0, 1, 2, 3].map(corner) as [
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
    ];
    const centre = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
    expect(
      centre
        .clone()
        .normalize()
        .toArray()
        .map((v) => +v.toFixed(5)),
    ).toEqual(
      new THREE.Vector3(-0.33376896, 0.43831766, 0.29899096)
        .normalize()
        .toArray()
        .map((v) => +v.toFixed(5)),
    );
    expect(centre.length()).toBeCloseTo(100, 3);
    expect(a.distanceTo(b)).toBeCloseTo(2 * 0.15018426, 5);
    expect(a.clone().sub(b).dot(centre)).toBeCloseTo(0, 3);
    expect(a.clone().sub(d).dot(centre)).toBeCloseTo(0, 3);
  });
});

describe("skyState", () => {
  test("is the biome's own sky and fog at noon, the sun overhead, no stars, no sunset glow", async () => {
    const noon = await stateAt("plains", { time: 6000 });
    expect(hex(noon.sky)).toBe("78a7ff");
    expect(hex(noon.fog)).toBe("c0d8ff");
    expect(noon.sunAngle).toBeCloseTo(0);
    const sky = await createMinecraftSky([], {
      biome: "plains",
      time: 12000,
      renderer: fakeRenderer(),
    });
    sky.group.updateMatrixWorld(true);
    const sun = meshNamed(sky.group, "sky-sun").getWorldPosition(new THREE.Vector3());
    const a = sky.state.sunAngle;
    expect(a).toBeGreaterThan(Math.PI / 4);
    expect(sun.x).toBeCloseTo(-100 * Math.sin(a), 4);
    expect(sun.y).toBeCloseTo(100 * Math.cos(a), 4);
    expect(sun.z).toBeCloseTo(0, 4);
    sky.dispose();
    expect(noon.moonAngle).toBeCloseTo(Math.PI);
    expect(noon.starBrightness).toBe(0);
    expect(noon.sunrise[3]).toBe(0);
    expect(noon.moonPhase).toBe("full_moon");
    expect(noon.skybox).toBe("overworld");
  });

  test("goes black at midnight under half-bright stars, the fog the game's night #0f0f16 times the biome's", async () => {
    const night = await stateAt("plains", { time: 18000 });
    expect(hex(night.sky)).toBe("000000");
    expect(hex(night.fog)).toBe(
      hex([0xc0 * 0x0f, 0xd8 * 0x0f, 0xff * 0x16].map((v) => v / 255 / 255)),
    );
    expect(night.starBrightness).toBeCloseTo(0.5);
    expect(night.sunAngle).toBeCloseTo(Math.PI);
  });

  test("glows orange at the horizon at dusk, from the day's sunrise_sunset_color", async () => {
    const dusk = await stateAt("plains", { time: 12841 });
    expect(hex(dusk.sunrise)).toBe("d75c33");
    expect(dusk.sunrise[3]).toBeCloseTo(0xfe / 255, 5);
  });

  test("turns the moon a phase each day from timeline/moon.json, eight days round", async () => {
    expect((await stateAt("plains", { time: 18000 + 24000 })).moonPhase).toBe("waning_gibbous");
    expect((await stateAt("plains", { time: 18000 + 4 * 24000 })).moonPhase).toBe("new_moon");
    expect((await stateAt("plains", { time: 18000 + 8 * 24000 })).moonPhase).toBe("full_moon");
  });

  test("greys the sky and dims sun, stars and fog in rain as WeatherAttributes does, more in a storm", async () => {
    const rain = await stateAt("plains", { time: 6000, rain: 1 });
    const [r, g, b] = [0x78, 0xa7, 0xff].map((v) => v / 255) as [number, number, number];
    const grey = (0.3 * r + 0.59 * g + 0.11 * b) * 0.6;
    expect(hex(rain.sky)).toBe(hex([r, g, b].map((v) => v + (grey - v) * 0.75)));
    expect(hex(rain.fog)).toBe(
      hex([0xc0, 0xd8, 0xff].map((v, i) => (v / 255) * ([127, 127, 153][i]! / 255))),
    );
    expect(rain.rainBrightness).toBe(0);
    const night = await stateAt("plains", { time: 18000, rain: 0.5 });
    expect(night.starBrightness).toBeCloseTo(0.25);
    const storm = await stateAt("plains", { time: 6000, rain: 1, thunder: 1 });
    const stormGrey = (0.3 * r + 0.59 * g + 0.11 * b) * 0.24;
    expect(hex(storm.sky)).toBe(hex([r, g, b].map((v) => v + (stormGrey - v) * 0.94)));
  });

  test("hazes rain fog only where the eye sees the sky (AtmosphericFogEnvironment: sky light 8 to 15)", async () => {
    const roofed = await stateAt("plains", { renderDistance: 32, rain: 1, eyeSkyLight: 8 });
    expect(roofed.distances.environmentalStart).toBe(0);
    const half = await stateAt("plains", { renderDistance: 32, rain: 1, eyeSkyLight: 11.5 });
    expect(half.distances.environmentalStart).toBeCloseTo(-80, 6);
  });

  test("hazes over the game's fog distances: render distance fog in its last tenth, rain pulling the haze in", async () => {
    const clear = await stateAt("plains", { renderDistance: 12 });
    expect(clear.distances).toEqual({
      environmentalStart: 0,
      environmentalEnd: 1024,
      renderDistanceStart: 192 - 19.2,
      renderDistanceEnd: 192,
      skyEnd: 192,
      cloudEnd: 2048,
    });
    const rain = await stateAt("plains", { renderDistance: 32, rain: 1 });
    expect(rain.distances.environmentalStart).toBe(-160);
    expect(rain.distances.environmentalEnd).toBe(1024 - 256);
    expect(rain.distances.skyEnd).toBe(512);
    const nether = await stateAt("nether_wastes");
    expect(nether.skybox).toBe("none");
    expect(nether.distances.environmentalStart).toBe(10);
    expect(nether.distances.environmentalEnd).toBe(96);
  });
});

describe("lightmap", () => {
  test("lights a sky-lit block full white at noon and moonlit blue at midnight, as lightmap.fsh does", async () => {
    const noon = await stateAt("plains", { time: 6000 });
    expect(noon.skyLightFactor).toBe(1);
    expect(hex(noon.skyLightColor)).toBe("ffffff");
    expect(hex(noon.ambientLight)).toBe("0a0a0a");
    expect(noon.skyLightLevel).toBe(15);
    expect(hex(lightmap(noon, 15, 0))).toBe("ffffff");
    const night = await stateAt("plains", { time: 18000 });
    expect(night.skyLightFactor).toBeCloseTo(0.24, 6);
    expect(hex(night.skyLightColor)).toBe("7a7aff");
    expect(night.skyLightLevel).toBeCloseTo(4, 5);
    const [r, g, b] = lightmap(night, 15, 0);
    expect(r).toBeCloseTo(0.27841, 4);
    expect(g).toBeCloseTo(0.27841, 4);
    expect(b).toBeCloseTo(0.50465, 4);
    expect(lightmap(night, 0, 0, { gamma: 0 })).toEqual([10 / 255, 10 / 255, 10 / 255]);
  });

  test("warms torch light toward the block light tint #ffd88c in the dark, whitening near full", async () => {
    const night = await stateAt("plains", { time: 18000 });
    expect(hex(night.blockLightTint)).toBe("ffd88c");
    const [r, g, b] = lightmap(night, 0, 7, { gamma: 0 });
    const level = 7 / 15;
    const bright = (level / (4 - 3 * level)) * 1.4;
    const white = 0.9 * (2 * level - 1) ** 2;
    const tint = [1, 0xd8 / 255, 0x8c / 255].map((t) => t + (1 - t) * white);
    expect(r).toBeCloseTo(10 / 255 + tint[0]! * bright, 5);
    expect(g).toBeCloseTo(10 / 255 + tint[1]! * bright, 5);
    expect(b).toBeCloseTo(10 / 255 + tint[2]! * bright, 5);
  });

  test("dims the sky light in rain and storms toward the night's (WeatherAttributes ALPHA_BLEND)", async () => {
    const rain = await stateAt("plains", { time: 6000, rain: 1 });
    expect(rain.skyLightFactor).toBeCloseTo(1 + (0.24 - 1) * 0.3125, 6);
    expect(rain.skyLightLevel).toBeCloseTo(15 + (4 - 15) * 0.3125, 5);
    expect(rain.skyLightColor[0]).toBeCloseTo(1 + (0x7a / 255 - 1) * (79 / 255), 6);
    const storm = await stateAt("plains", { time: 6000, rain: 1, thunder: 1 });
    expect(storm.skyLightFactor).toBeCloseTo(1 + (0.24 - 1) * 0.52734375, 6);
  });

  test("keeps the Nether's own dim light and gives it no weather (Level.canHaveWeather)", async () => {
    const nether = await stateAt("nether_wastes", { rain: 1, thunder: 1 });
    expect(nether.rain).toBe(0);
    expect(nether.thunder).toBe(0);
    expect(nether.skyLightFactor).toBe(0);
    expect(nether.skyLightLevel).toBe(4);
    expect(hex(lightmap(nether, 15, 0, { gamma: 0 }))).toBe("302821");
    expect(nether.distances.environmentalStart).toBe(10);
  });
});

describe("fogColorFacing", () => {
  test("warms toward the sunset when the eye looks at it, and leans to the sky colour at short render distances", async () => {
    const dusk = await stateAt("plains", { time: 12841, renderDistance: 32 });
    const west = fogColorFacing(dusk, [-1, 0, 0]);
    const east = fogColorFacing(dusk, [1, 0, 0]);
    expect(hex(east)).toBe(hex(dusk.fog));
    expect(west[0]).toBeGreaterThan(east[0]);
    const noon = await stateAt("plains", { time: 6000, renderDistance: 32 });
    expect(hex(fogColorFacing(noon, [0, 0, -1]))).toBe("c0d8ff");
    const near = await stateAt("plains", { time: 6000, renderDistance: 2 });
    const f = 1 - (0.25 + 0.75 / 16) ** 0.25;
    const want = [0xc0, 0xd8, 0xff].map((v, i) => (v + ([0x78, 0xa7, 0xff][i]! - v) * f) / 255);
    expect(hex(fogColorFacing(near, [0, 0, -1]))).toBe(hex(want));
  });

  test("darkens toward black in the void, (1 - d)^2 from 32 blocks over the world's floor", async () => {
    const noon = await stateAt("plains", { time: 6000, renderDistance: 32 });
    expect(hex(fogColorFacing(noon, [0, 0, -1], { y: -32 }))).toBe("c0d8ff");
    const d = (32 - 64 + 48) / 32;
    const want = [0xc0, 0xd8, 0xff].map((v) => (v / 255) * (1 - d) ** 2);
    expect(hex(fogColorFacing(noon, [0, 0, -1], { y: -48 }))).toBe(hex(want));
    expect(hex(fogColorFacing(noon, [0, 0, -1], { y: -64 }))).toBe("000000");
  });
});

describe("inside a fluid (FogRenderer with the water, lava and powder snow environments)", () => {
  test("water pulls the fog to the biome's water fog distances, shortened while the eyes adjust", async () => {
    const clear = await stateAt("plains", { time: 6000, submerged: "water" });
    expect(clear.distances).toMatchObject({
      environmentalStart: -8,
      environmentalEnd: 96,
      skyEnd: 96,
      cloudEnd: 96,
      renderDistanceEnd: 192,
    });
    const fresh = await stateAt("plains", { time: 6000, submerged: "water", waterVision: 0 });
    expect(fresh.distances.environmentalEnd).toBe(24);
  });

  test("the eyes adjust over 30 seconds under water (LocalPlayer.getWaterVision)", () => {
    expect([0, 50, 100, 350, 600, 900].map(waterVision)).toEqual([
      0,
      0.3,
      0.6,
      0.6 + 0.5 * 0.39999998,
      1,
      1,
    ]);
  });

  test("water fog is the biome's water fog colour, brightened to full as the eyes adjust, never the sunset", async () => {
    const dusk = { time: 12841, renderDistance: 32, submerged: "water" } as const;
    const adjusted = await stateAt("plains", dusk);
    expect(hex(fogColorFacing(adjusted, [-1, 0, 0]))).toBe("1919ff");
    expect(hex(fogColorFacing(adjusted, [1, 0, 0]))).toBe("1919ff");
    const fresh = await stateAt("plains", { ...dusk, waterVision: 0 });
    expect(hex(fogColorFacing(fresh, [1, 0, 0]))).toBe("050533");
    expect(hex(fogColorFacing(adjusted, [1, 0, 0], { y: -64 }))).toBe("000000");
  });

  test("lava and powder snow close the fog to a block or two in their own colours", async () => {
    const lava = await stateAt("plains", { submerged: "lava" });
    expect(lava.distances).toMatchObject({
      environmentalStart: 0.25,
      environmentalEnd: 1,
      skyEnd: 1,
    });
    expect(hex(fogColorFacing(lava, [0, 0, 1], { y: -64 }))).toBe("991a00");
    const resistant = await stateAt("plains", { submerged: "lava", fireResistance: true });
    expect(resistant.distances).toMatchObject({ environmentalStart: 0, environmentalEnd: 5 });
    const snow = await stateAt("plains", { submerged: "powder_snow" });
    expect(snow.distances).toMatchObject({
      environmentalStart: 0,
      environmentalEnd: 2,
      cloudEnd: 2,
    });
    expect(hex(fogColorFacing(snow, [0, 0, 1]))).toBe("9fbbcc");
  });
});

describe("the sky inside lava or powder snow (LevelRenderer.addSkyPass)", () => {
  test("is not drawn, only the fog colour behind everything; water keeps it", async () => {
    const sky = await createMinecraftSky([], {
      biome: "plains",
      time: 6000,
      renderer: fakeRenderer(),
    });
    const shown = () =>
      sky.group.children
        .filter((c) => c.visible)
        .map((c) => c.name)
        .sort();
    const open = shown();
    sky.set({ submerged: "lava" });
    expect(shown()).toEqual(["sky-clear"]);
    sky.set({ submerged: "water" });
    expect(shown()).toEqual(open);
    sky.dispose();
  });
});

describe("a lightning flash (ClientLevel's sky flash layers)", () => {
  test("pulls the sky 22% toward #ccccff and lights the open ground as by day", async () => {
    const night = await stateAt("plains", { time: 18000 });
    const flash = await stateAt("plains", { time: 18000, flash: true });
    expect(hex(flash.sky)).toBe(hex([0.8 * 0.22, 0.8 * 0.22, 0.22]));
    expect(flash.skyLightFactor).toBe(1);
    expect(lightmap(flash, 15, 0)[0]).toBeGreaterThan(lightmap(night, 15, 0)[0]);
    expect(hex(flash.fog)).toBe(hex(night.fog));
  });
});

const meshNamed = (root: THREE.Object3D, name: string) => root.getObjectByName(name) as THREE.Mesh;

describe("createMinecraftSky", () => {
  test("draws the game's sky pieces behind everything, in the game's order", async () => {
    const sky = await createMinecraftSky([], {
      biome: "plains",
      time: 18000,
      renderer: fakeRenderer(),
    });
    const order = [
      "sky-clear",
      "sky-disc",
      "sky-sunrise",
      "sky-sun",
      "sky-moon",
      "sky-stars",
      "sky-dark-disc",
    ];
    const meshes = order.map((n) => meshNamed(sky.group, n));
    expect(meshes.every(Boolean)).toBe(true);
    const orders = meshes.map((m) => m.renderOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const m of meshes) {
      expect(m.frustumCulled).toBe(false);
      expect((m.material as THREE.Material).depthWrite).toBe(false);
    }
    expect(meshNamed(sky.group, "sky-stars").visible).toBe(true);
    sky.dispose();
  });

  test("shows the moon phase of the day and hides the stars by day", async () => {
    const read: string[] = [];
    const sky = await createMinecraftSky([], {
      biome: "plains",
      time: 6000 + 4 * 24000,
      renderer: fakeRenderer(read),
    });
    expect(read).toContain("assets/minecraft/textures/environment/celestial/sun.png");
    expect(read).toContain("assets/minecraft/textures/environment/celestial/moon/new_moon.png");
    expect(meshNamed(sky.group, "sky-stars").visible).toBe(false);
    const moon = meshNamed(sky.group, "sky-moon").material as THREE.ShaderMaterial;
    expect(moon.uniforms.map!.value.name).toBe("new_moon");
    sky.set({ time: 6000 });
    expect(moon.uniforms.map!.value.name).toBe("full_moon");
    sky.dispose();
  });

  test("keeps light, a linear colour, on the open-ground daylight lightmap(state, 15, 0) as the day turns", async () => {
    const sky = await createMinecraftSky([], {
      biome: "plains",
      time: 6000,
      renderer: fakeRenderer(),
    });
    expect(sky.light.getHexString(THREE.SRGBColorSpace)).toBe("ffffff");
    sky.set({ time: 18000 });
    expect(sky.light.getHexString(THREE.SRGBColorSpace)).toBe(hex(lightmap(sky.state, 15, 0)));
    sky.dispose();
  });

  test("follows the camera, clears to the fog colour it faces and keeps a THREE.Fog in step for the scene", async () => {
    const sky = await createMinecraftSky([], {
      biome: "plains",
      time: 6000,
      renderDistance: 32,
      renderer: fakeRenderer(),
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 80, -3);
    sky.follow(camera);
    expect(sky.group.position.toArray()).toEqual([5, 80, -3]);
    expect(sky.fogColor.getHexString(THREE.SRGBColorSpace)).toBe("c0d8ff");
    expect(sky.fog.color.getHexString(THREE.SRGBColorSpace)).toBe("c0d8ff");
    expect(sky.fog.near).toBeCloseTo(512 - 51.2);
    expect(sky.fog.far).toBe(512);
    expect(meshNamed(sky.group, "sky-dark-disc").visible).toBe(false);
    camera.position.y = 40;
    sky.follow(camera);
    expect(meshNamed(sky.group, "sky-dark-disc").visible).toBe(true);
    sky.dispose();
  });

  test("draws only the fog colour in the Nether and the End's tiled box in the End", async () => {
    const nether = await createMinecraftSky([], {
      biome: "nether_wastes",
      renderer: fakeRenderer(),
    });
    const shown = (s: typeof nether) =>
      s.group.children.filter((c) => c.visible).map((c) => c.name);
    expect(shown(nether)).toEqual(["sky-clear"]);
    const read: string[] = [];
    const end = await createMinecraftSky([], { biome: "the_end", renderer: fakeRenderer(read) });
    expect(shown(end)).toEqual(["sky-clear", "sky-end"]);
    expect(read).toContain("assets/minecraft/textures/environment/end_sky.png");
    nether.dispose();
    end.dispose();
  });
});

describe("clouds under the sky", () => {
  test("take the sky's cloud colour, the day's tint and the weather's grey already in it", async () => {
    const storm = await stateAt("plains", { time: 6000, rain: 1, thunder: 1 });
    const clouds = await createMinecraftClouds([], {
      image: { width: 1, height: 1, data: [255, 255, 255, 255] },
    });
    clouds.setColor(storm.cloud);
    expect(clouds.material.color.getHexString(THREE.SRGBColorSpace)).toBe(hex(storm.cloud));
    expect(clouds.material.opacity).toBeCloseTo(storm.cloud[3]);
    expect(storm.cloud[3]).toBeCloseTo(0xcc / 255);
    expect(hex(storm.cloud)).not.toBe("ffffff");
    clouds.dispose();
  });
});

describe("useVanillaFog", () => {
  test("swaps three's fog for the game's on every material under a root, once, keeping their own shader patches", async () => {
    const sky = await createMinecraftSky([], { biome: "plains", renderer: fakeRenderer() });
    const own = new THREE.MeshLambertMaterial();
    let ownPatched = 0;
    own.onBeforeCompile = () => void ownPatched++;
    const root = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), own));
    useVanillaFog(root, sky);
    useVanillaFog(root, sky);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    own.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(ownPatched).toBe(1);
    expect(shader.fragmentShader).not.toContain("#include <fog_fragment>");
    expect(shader.fragmentShader).toContain("mcFog");
    expect(shader.vertexShader).toContain("vMcFogPos");
    expect(shader.uniforms.mcFog).toBe(sky.fogUniforms.mcFog);
    expect(own.customProgramCacheKey()).toContain("mc-vanilla-fog");
    sky.dispose();
  });
});
