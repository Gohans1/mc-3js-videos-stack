import type { ModelRendererApi } from "../src/model";

export const DATA: Record<string, unknown> = {
  "data/minecraft/dimension_type/overworld.json": {
    attributes: {
      "minecraft:visual/cloud_color": "#ccffffff",
      "minecraft:visual/cloud_height": 192.33,
      "minecraft:visual/fog_color": "#c0d8ff",
      "minecraft:visual/sky_color": "#78a7ff",
      "minecraft:visual/ambient_light_color": "#0a0a0a",
    },
    min_y: -64,
    timelines: "#minecraft:in_overworld",
  },
  "data/minecraft/dimension_type/the_nether.json": {
    has_ceiling: true,
    has_skylight: false,
    skybox: "none",
    attributes: {
      "minecraft:visual/fog_end_distance": 96.0,
      "minecraft:visual/fog_start_distance": 10.0,
      "minecraft:gameplay/sky_light_level": 4.0,
      "minecraft:visual/ambient_light_color": "#302821",
      "minecraft:visual/sky_light_color": "#7a7aff",
      "minecraft:visual/sky_light_factor": 0.0,
    },
    timelines: "#minecraft:in_nether",
  },
  "data/minecraft/dimension_type/the_end.json": {
    skybox: "end",
    attributes: {
      "minecraft:visual/fog_color": "#181318",
      "minecraft:visual/sky_color": "#000000",
    },
  },
  "data/minecraft/timeline/early_game.json": {
    clock: "minecraft:overworld",
    tracks: {
      "minecraft:gameplay/can_pillager_patrol_spawn": {
        keyframes: [
          { ticks: 0, value: false },
          { ticks: 120000, value: true },
        ],
        modifier: "and",
      },
    },
  },
  "data/minecraft/timeline/day.json": {
    period_ticks: 24000,
    tracks: {
      "minecraft:gameplay/sky_light_level": {
        keyframes: [
          { ticks: 133, value: 1.0 },
          { ticks: 11867, value: 1.0 },
          { ticks: 13670, value: 0.26666668 },
          { ticks: 22330, value: 0.26666668 },
        ],
        modifier: "multiply",
      },
      "minecraft:visual/sky_light_color": {
        keyframes: [
          { ticks: 730, value: "#ffffff" },
          { ticks: 11270, value: "#ffffff" },
          { ticks: 13140, value: "#7a7aff" },
          { ticks: 22860, value: "#7a7aff" },
        ],
        modifier: "multiply",
      },
      "minecraft:visual/sky_light_factor": {
        keyframes: [
          { ticks: 730, value: 1.0 },
          { ticks: 11270, value: 1.0 },
          { ticks: 13140, value: 0.24 },
          { ticks: 22860, value: 0.24 },
        ],
        modifier: "multiply",
      },
      "minecraft:visual/cloud_color": {
        keyframes: [
          { ticks: 133, value: "#ffffffff" },
          { ticks: 11867, value: "#ffffffff" },
          { ticks: 13670, value: "#ff191926" },
          { ticks: 22330, value: "#ff191926" },
        ],
        modifier: "multiply",
      },
      "minecraft:visual/sun_angle": {
        ease: { cubic_bezier: [0.362, 0.241, 0.638, 0.759] },
        keyframes: [
          { ticks: 6000, value: 360.0 },
          { ticks: 6000, value: 0.0 },
        ],
      },
      "minecraft:visual/sky_color": {
        keyframes: [
          { ticks: 133, value: "#ffffff" },
          { ticks: 11867, value: "#ffffff" },
          { ticks: 13670, value: "#000000" },
          { ticks: 22330, value: "#000000" },
        ],
        modifier: "multiply",
      },
      "minecraft:visual/fog_color": {
        keyframes: [
          { ticks: 133, value: "#ffffff" },
          { ticks: 11867, value: "#ffffff" },
          { ticks: 13670, value: "#0f0f16" },
          { ticks: 22330, value: "#0f0f16" },
        ],
        modifier: "multiply",
      },
      "minecraft:visual/sunrise_sunset_color": {
        keyframes: [
          { ticks: 71, value: "#5fefa333" },
          { ticks: 310, value: "#29f5ba33" },
          { ticks: 565, value: "#06fbd433" },
          { ticks: 730, value: "#00ffe533" },
          { ticks: 11270, value: "#00ffe533" },
          { ticks: 11397, value: "#04fcd833" },
          { ticks: 11522, value: "#0ff9cb33" },
          { ticks: 11690, value: "#29f5ba33" },
          { ticks: 11929, value: "#5fefa333" },
          { ticks: 12243, value: "#b1e78733" },
          { ticks: 12358, value: "#cce47e33" },
          { ticks: 12512, value: "#e9e07233" },
          { ticks: 12613, value: "#f6dd6b33" },
          { ticks: 12732, value: "#feda6333" },
          { ticks: 12841, value: "#fed75c33" },
          { ticks: 13035, value: "#ecd25133" },
          { ticks: 13252, value: "#c1cc4733" },
          { ticks: 13775, value: "#36be3733" },
          { ticks: 13888, value: "#1fbb3533" },
          { ticks: 14039, value: "#09b73333" },
          { ticks: 14192, value: "#00b33333" },
          { ticks: 21807, value: "#00b23333" },
          { ticks: 21961, value: "#09b73333" },
          { ticks: 22112, value: "#1fbb3533" },
          { ticks: 22225, value: "#36be3733" },
          { ticks: 22748, value: "#c1cc4733" },
          { ticks: 22965, value: "#ecd25133" },
          { ticks: 23159, value: "#fed75c33" },
          { ticks: 23272, value: "#feda6333" },
          { ticks: 23488, value: "#e9e07233" },
          { ticks: 23642, value: "#cce47e33" },
          { ticks: 23757, value: "#b1e78733" },
        ],
      },
      "minecraft:visual/star_brightness": {
        keyframes: [
          { ticks: 92, value: 0.037 },
          { ticks: 627, value: 0.0 },
          { ticks: 11373, value: 0.0 },
          { ticks: 11732, value: 0.016 },
          { ticks: 11959, value: 0.044 },
          { ticks: 12399, value: 0.143 },
          { ticks: 12729, value: 0.258 },
          { ticks: 13228, value: 0.5 },
          { ticks: 22772, value: 0.5 },
          { ticks: 23032, value: 0.364 },
          { ticks: 23356, value: 0.225 },
          { ticks: 23758, value: 0.101 },
        ],
        modifier: "maximum",
      },
      "minecraft:visual/moon_angle": {
        ease: { cubic_bezier: [0.362, 0.241, 0.638, 0.759] },
        keyframes: [
          { ticks: 6000, value: 540.0 },
          { ticks: 6000, value: 180.0 },
        ],
      },
      "minecraft:visual/star_angle": {
        ease: { cubic_bezier: [0.362, 0.241, 0.638, 0.759] },
        keyframes: [
          { ticks: 6000, value: 360.0 },
          { ticks: 6000, value: 0.0 },
        ],
      },
      "minecraft:gameplay/monsters_burn": {
        keyframes: [
          { ticks: 12542, value: false },
          { ticks: 23460, value: true },
        ],
      },
    },
  },
  "data/minecraft/timeline/moon.json": {
    clock: "minecraft:overworld",
    period_ticks: 192000,
    tracks: {
      "minecraft:visual/moon_phase": {
        keyframes: [
          { ticks: 0, value: "full_moon" },
          { ticks: 24000, value: "waning_gibbous" },
          { ticks: 48000, value: "third_quarter" },
          { ticks: 72000, value: "waning_crescent" },
          { ticks: 96000, value: "new_moon" },
          { ticks: 120000, value: "waxing_crescent" },
          { ticks: 144000, value: "first_quarter" },
          { ticks: 168000, value: "waxing_gibbous" },
        ],
      },
    },
  },
  "data/minecraft/tags/timeline/in_overworld.json": {
    values: ["#minecraft:universal", "minecraft:day", "minecraft:moon"],
  },
  "data/minecraft/tags/timeline/in_nether.json": {
    values: ["#minecraft:universal"],
  },
  "data/minecraft/tags/timeline/universal.json": { values: [] },
  "data/minecraft/worldgen/biome/swamp.json": {
    temperature: 0.8,
    downfall: 0.9,
    has_precipitation: true,
    effects: { grass_color_modifier: "swamp", water_color: "#617b64" },
    attributes: {
      "minecraft:visual/sky_color": "#78a7ff",
      "minecraft:visual/water_fog_color": "#232317",
      "minecraft:visual/water_fog_end_distance": {
        argument: 0.85,
        modifier: "multiply",
      },
    },
  },
  "data/minecraft/tags/worldgen/biome/is_nether.json": {
    values: ["minecraft:nether_wastes"],
  },
  "data/minecraft/tags/worldgen/biome/is_end.json": {
    values: ["minecraft:the_end"],
  },
  "data/minecraft/worldgen/biome/the_end.json": {
    temperature: 0.5,
    downfall: 0.5,
    has_precipitation: false,
    effects: { water_color: "#3f76e4" },
  },
  "data/minecraft/worldgen/biome/nether_wastes.json": {
    temperature: 2.0,
    downfall: 0.0,
    has_precipitation: false,
    effects: { water_color: "#3f76e4" },
    attributes: { "minecraft:visual/fog_color": "#330808" },
  },
  "data/minecraft/worldgen/biome/plains.json": {
    temperature: 0.8,
    downfall: 0.4,
    has_precipitation: true,
    effects: { water_color: "#3f76e4" },
    attributes: { "minecraft:visual/sky_color": "#78a7ff" },
  },
  "data/minecraft/worldgen/biome/warm_ocean.json": {
    temperature: 0.5,
    downfall: 0.5,
    has_precipitation: true,
    effects: { water_color: "#43d5ee" },
    attributes: { "minecraft:visual/water_fog_color": "#041f33" },
  },
  "data/minecraft/worldgen/biome/badlands.json": {
    temperature: 2.0,
    downfall: 0.0,
    has_precipitation: false,
    effects: {
      foliage_color: "#9e814d",
      grass_color: "#90814d",
      water_color: "#3f76e4",
    },
    attributes: { "minecraft:visual/sky_color": "#6eb1ff" },
  },
  "data/minecraft/worldgen/biome/dark_forest.json": {
    temperature: 0.7,
    downfall: 0.8,
    has_precipitation: true,
    effects: {
      dry_foliage_color: "#7b5334",
      grass_color_modifier: "dark_forest",
      water_color: "#3f76e4",
    },
  },
  "data/minecraft/worldgen/biome/snowy_plains.json": {
    temperature: 0.0,
    downfall: 0.5,
    has_precipitation: true,
    effects: { water_color: "#3f76e4" },
  },
  "data/minecraft/worldgen/biome/pale_garden.json": {
    temperature: 0.7,
    downfall: 0.8,
    has_precipitation: true,
    effects: { water_color: "#76889d" },
    attributes: {
      "minecraft:visual/fog_color": "#817770",
      "minecraft:visual/sky_color": "#b9b9b9",
    },
  },
};

export const ANIMATIONS: Record<string, number[]> = {
  "assets/minecraft/textures/block/water_still.png": Array(32).fill(2),
  "assets/minecraft/textures/block/lava_still.png": Array(38).fill(2),
};
export const fakeRenderer = (read: string[] = []) =>
  ({
    async readFile(path: string) {
      read.push(path);
      return path in DATA ? new TextEncoder().encode(JSON.stringify(DATA[path])) : undefined;
    },
    async readTexture(path: string) {
      read.push(path);
      const times = ANIMATIONS[path] ?? [1];
      const frames = times.map((_, i) => ({ width: 16, height: 16, frame: i }));
      return { image: frames[0], frames, times, animated: times.length > 1 };
    },
  }) as unknown as ModelRendererApi;
