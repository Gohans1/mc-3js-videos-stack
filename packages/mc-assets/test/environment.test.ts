import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import {
  biomeEnvironment,
  createMinecraftClouds,
  createMinecraftLava,
  createMinecraftWater,
  dayTimeline,
  timeline,
} from "../src/environment";
import { fakeRenderer } from "./vanilla-data";

describe("biomeEnvironment", () => {
  test("reads a biome's colours and climate from the game's data, falling back to the overworld's", async () => {
    const renderer = fakeRenderer();
    const plains = await biomeEnvironment([], "plains", { renderer });
    expect(plains.skyColor).toBe("#78a7ff");
    expect(plains.fogColor).toBe("#c0d8ff");
    expect(plains.waterColor).toBe("#3f76e4");
    expect(plains.waterFogColor).toBe("#050533");
    expect(plains.precipitation).toBe("rain");
    expect(plains.cloud).toEqual({ color: "#ffffff", alpha: 0.8, height: 192.33 });
    expect(plains.tint.grass).toEqual({ temperature: 0.8, downfall: 0.4, water: "#3f76e4" });

    const pale = await biomeEnvironment([], "minecraft:pale_garden", { renderer });
    expect(pale.skyColor).toBe("#b9b9b9");
    expect(pale.fogColor).toBe("#817770");
    expect((await biomeEnvironment([], "warm_ocean", { renderer })).waterFogColor).toBe("#041f33");
  });

  test("hands block-model-renderer one biome per colormap: the biome's own colour replaces the sampled one, dark forest folds onto it", async () => {
    const renderer = fakeRenderer();
    const badlands = await biomeEnvironment([], "badlands", { renderer });
    expect(badlands.tint.grass.tint).toBe("#90814d");
    expect(badlands.tint.foliage.tint).toBe("#9e814d");
    expect(badlands.tint.dryFoliage.tint).toBeUndefined();
    expect(badlands.precipitation).toBe("none");
    const dark = await biomeEnvironment([], "dark_forest", { renderer });
    expect(dark.grassModifier).toBe("dark_forest");
    expect(dark.tint.grass).toMatchObject({ tint: "#28340a", combine: true });
    expect(dark.tint.dryFoliage.tint).toBe("#7b5334");
  });

  test("finds a biome's dimension from the game's biome tags: the Nether draws no clouds", async () => {
    const nether = await biomeEnvironment([], "nether_wastes", { renderer: fakeRenderer() });
    expect(nether.dimension).toBe("the_nether");
    expect(nether.fogColor).toBe("#330808");
    expect(nether.cloud).toBeNull();
    expect(nether.skybox).toBe("none");
    expect((await biomeEnvironment([], "the_end", { renderer: fakeRenderer() })).skybox).toBe(
      "end",
    );
    const plains = await biomeEnvironment([], "plains", { renderer: fakeRenderer() });
    expect(plains.dimension).toBe("overworld");
    expect(plains.skybox).toBe("overworld");
  });

  test("snows where the biome is colder than 0.15, and names a biome the data does not have", async () => {
    const renderer = fakeRenderer();
    expect((await biomeEnvironment([], "snowy_plains", { renderer })).precipitation).toBe("snow");
    await expect(biomeEnvironment([], "nowhere", { renderer })).rejects.toThrow(
      "data/minecraft/worldgen/biome/nowhere.json",
    );
  });
});

const frameShown = (fluid: { material: THREE.Material & { map: THREE.Texture | null } }) =>
  (fluid.material.map!.image as { frame: number }).frame;

describe("dayTimeline", () => {
  test("reads the day's tracks from timeline/day.json: clouds white by day, #191926 by night, between at dusk, wrapping round the day", async () => {
    const day = await dayTimeline([], { renderer: fakeRenderer() });
    expect(day.period).toBe(24000);
    expect(day.at("visual/cloud_color", 6000)).toEqual({ color: "#ffffff", alpha: 1 });
    expect(day.at("minecraft:visual/cloud_color", 18000)).toEqual({ color: "#191926", alpha: 1 });
    expect(day.at("visual/cloud_color", 50)).toEqual({ color: "#f4f4f5", alpha: 1 });
    const dusk = day.at("visual/cloud_color", (11867 + 13670) / 2) as { color: string };
    expect(dusk.color).toBe("#8c8c93");
    expect(day.at("gameplay/monsters_burn", 13000)).toBe(false);
    expect(day.at("gameplay/monsters_burn", 1000)).toBe(true);
    expect(day.at("visual/nothing", 0)).toBeUndefined();
  });

  test("runs a timeline without period_ticks once from tick 0, holding its last keyframe (early_game)", async () => {
    const early = await timeline([], "early_game", { renderer: fakeRenderer() });
    expect(early.period).toBeUndefined();
    expect(early.at("gameplay/can_pillager_patrol_spawn", 1000)).toBe(false);
    expect(early.at("gameplay/can_pillager_patrol_spawn", 130000)).toBe(true);
    expect(early.at("gameplay/can_pillager_patrol_spawn", 500000)).toBe(true);
  });

  test("eases the sun round once a day on the game's cubic bezier: overhead at noon, under at midnight", async () => {
    const day = await dayTimeline([], { renderer: fakeRenderer() });
    expect(day.at("visual/sun_angle", 6000)).toBeCloseTo(0);
    expect(day.at("visual/sun_angle", 18000)).toBeCloseTo(180);
    expect(day.at("visual/sun_angle", 9000) as number).toBeLessThan(45);
    expect(day.at("visual/sun_angle", 27000 - 24000) as number).toBeGreaterThan(270);
  });
});

describe("createMinecraftWater", () => {
  test("is the game's still water: water_still.png tinted by the biome's water colour, translucent, lit like a block face", async () => {
    const read: string[] = [];
    const water = await createMinecraftWater([], {
      biome: "warm_ocean",
      renderer: fakeRenderer(read),
    });
    expect(read).toContain("assets/minecraft/textures/block/water_still.png");
    expect(water.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(water.material.color.getHexString(THREE.SRGBColorSpace)).toBe("43d5ee");
    expect(water.material.transparent).toBe(true);
    const plains = await createMinecraftWater([], { renderer: fakeRenderer() });
    expect(plains.material.color.getHexString(THREE.SRGBColorSpace)).toBe("3f76e4");
    water.dispose();
    plains.dispose();
  });

  test("plays every frame of the strip for as long as its .mcmeta says, two game ticks apiece, and loops", async () => {
    const water = await createMinecraftWater([], { color: "#ffffff", renderer: fakeRenderer() });
    expect(water.frames.length).toBe(32);
    const at = (t: number) => {
      water.update(t);
      return frameShown(water);
    };
    expect(at(0)).toBe(0);
    expect(at(0.09)).toBe(0);
    expect(at(0.1)).toBe(1);
    expect(at(3.1)).toBe(31);
    expect(at(3.2)).toBe(0);
    expect(at(0.1)).toBe(1);
    water.dispose();
  });

  test("covers the surface it is given, or a size x size square, at height y, a block every `cell` units", async () => {
    const ring = new THREE.RingGeometry(10, 20, 8);
    const water = await createMinecraftWater([], {
      geometry: ring,
      cell: 0.5,
      y: -3,
      renderer: fakeRenderer(),
    });
    expect(water.mesh.geometry).toBe(ring);
    expect(water.uniforms.fluidCell.value).toBe(0.5);
    expect(water.mesh.position.y).toBe(-3);
    const flat = await createMinecraftWater([], { size: 64, renderer: fakeRenderer() });
    flat.mesh.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(flat.mesh);
    expect(box.max.x - box.min.x).toBeCloseTo(64);
    expect(box.max.y - box.min.y).toBeCloseTo(0);
    water.dispose();
    flat.dispose();
  });
});

describe("createMinecraftLava", () => {
  test("is the game's still lava: lava_still.png untinted, opaque and full bright, its frames rocking 0..19..1", async () => {
    const lava = await createMinecraftLava([], { renderer: fakeRenderer() });
    expect(lava.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(lava.material.transparent).toBe(false);
    expect(lava.frames.length).toBe(38);
    lava.update(3.7);
    expect(frameShown(lava)).toBe(37);
    lava.update(3.8);
    expect(frameShown(lava)).toBe(0);
    lava.dispose();
  });
});

describe("createMinecraftClouds", () => {
  const sky = { width: 3, height: 1, data: [255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0] };

  test("is the game's fancy layer: 12 x 4 x 12 block cells from clouds.png at y 192.33, alpha 0.8, gone 2048 blocks out", async () => {
    const clouds = await createMinecraftClouds([], { image: sky });
    const geo = clouds.mesh.geometry;
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y - geo.boundingBox!.min.y).toBe(4);
    const side = Array.from({ length: 4 }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(geo.getAttribute("position"), i),
    );
    expect(Math.max(...side.map((v) => v.z)) - Math.min(...side.map((v) => v.z))).toBe(12);
    expect(clouds.span / 2).toBeGreaterThanOrEqual(2048);
    expect(clouds.mesh.position.y).toBeCloseTo(192.33);
    expect(clouds.material.opacity).toBeCloseTo(0.8);
    expect(clouds.uniforms.cloudFade.value).toBe(2048);
    clouds.dispose();
  });

  test("takes the day's cloud colour at a tick, and again as the day moves on: white at noon, the game's night grey after dusk", async () => {
    const noon = await createMinecraftClouds([], { image: sky, renderer: fakeRenderer() });
    expect(noon.material.color.getHexString(THREE.SRGBColorSpace)).toBe("ffffff");
    const night = await createMinecraftClouds([], {
      image: sky,
      daytime: 18000,
      renderer: fakeRenderer(),
    });
    expect(night.material.color.getHexString(THREE.SRGBColorSpace)).toBe("191926");
    night.setDaytime(6000);
    expect(night.material.color.getHexString(THREE.SRGBColorSpace)).toBe("ffffff");
    const dusk = await createMinecraftClouds([], {
      image: sky,
      color: "#808080",
      daytime: 12768.5,
      renderer: fakeRenderer(),
    });
    expect(dusk.material.color.getHexString(THREE.SRGBColorSpace)).toBe("46464a");
    expect(() => noon.setDaytime(18000)).toThrow("daytime");
    noon.dispose();
    night.dispose();
  });

  test("drifts west 0.03 blocks a tick, as the game's do", async () => {
    const clouds = await createMinecraftClouds([], { image: sky, altitude: 400 });
    clouds.follow(new THREE.Vector3(0, 0, 0));
    clouds.update(10);
    expect(clouds.uniforms.cloudShift.value.x).toBeCloseTo(-6);
    expect(clouds.uniforms.cloudShift.value.y).toBeCloseTo(0);
    expect(clouds.mesh.position.y).toBe(400);
    clouds.dispose();
  });
});
