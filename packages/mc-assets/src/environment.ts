import type { AssetsInput, Biome } from "block-model-renderer";
import { type CloudLayerHandle, createCloudLayer } from "film-stage/sky";
import * as THREE from "three";

import { animatedTexture, loadBmr, type ModelRendererApi, texture } from "./model";

export type Precipitation = "none" | "rain" | "snow";

export interface BiomeEnvironment {
  id: string;
  dimension: string;
  skybox: "overworld" | "end" | "none";
  weather: boolean;
  minY: number;
  temperature: number;
  downfall: number;
  precipitation: Precipitation;
  skyColor: string;
  fogColor: string;
  waterColor: string;
  waterFogColor: string;
  grassModifier: "none" | "dark_forest" | "swamp";
  cloud: { color: string; alpha: number; height: number } | null;
  tint: { grass: Biome; foliage: Biome; dryFoliage: Biome };
  fog: { start: number; end: number; skyEnd: number; cloudEnd: number };
  waterFog: { start: number; end: number };
  attributes: Record<string, unknown>;
  timelines: string[];
}

type Json = Record<string, unknown>;

const DEFAULTS: Record<string, string | number> = {
  "minecraft:visual/sky_color": "#000000",
  "minecraft:visual/fog_color": "#000000",
  "minecraft:visual/water_fog_color": "#050533",
  "minecraft:visual/fog_start_distance": 0,
  "minecraft:visual/fog_end_distance": 1024,
  "minecraft:visual/sky_fog_end_distance": 512,
  "minecraft:visual/cloud_fog_end_distance": 2048,
  "minecraft:visual/water_fog_start_distance": -8,
  "minecraft:visual/water_fog_end_distance": 96,
};

function modify(base: unknown, value: unknown): unknown {
  if (!value || typeof value !== "object" || !("modifier" in value)) return value;
  const { modifier, argument } = value as { modifier: string; argument: unknown };
  const [a, b] = [Number(base), Number(argument)];
  const ops: Record<string, () => unknown> = {
    override: () => argument,
    add: () => a + b,
    subtract: () => a - b,
    multiply: () => a * b,
    minimum: () => Math.min(a, b),
    maximum: () => Math.max(a, b),
  };
  return (ops[modifier] ?? (() => base))();
}

async function timelinesOf(
  sources: AssetsInput,
  ref: unknown,
  bmr: ModelRendererApi,
): Promise<string[]> {
  const refs = Array.isArray(ref) ? ref : ref === undefined ? [] : [ref];
  const out: string[] = [];
  for (const r of refs.map(String)) {
    if (!r.startsWith("#")) {
      out.push(r.includes(":") ? r : `minecraft:${r}`);
      continue;
    }
    const [ns, name] = r.slice(1).includes(":")
      ? r.slice(1).split(":", 2)
      : ["minecraft", r.slice(1)];
    const { values } = await readJson(sources, `data/${ns}/tags/timeline/${name}.json`, bmr, true);
    out.push(...(await timelinesOf(sources, values, bmr)));
  }
  return out;
}
const DARK_FOREST_FOLD = "#28340a";
const SWAMP_GRASS = "#6a7039";

async function readJson(
  sources: AssetsInput,
  path: string,
  bmr: ModelRendererApi,
  optional?: true,
): Promise<Json> {
  if (!bmr.readFile)
    throw new Error(`reading ${path} needs block-model-renderer 2.20 or later (readFile)`);
  const bytes = await bmr.readFile(path, sources);
  if (bytes) return JSON.parse(new TextDecoder().decode(bytes)) as Json;
  if (optional) return {};
  throw new Error(`no ${path} in the asset sources (is the vanilla jar among them?)`);
}

async function dimensionOf(
  sources: AssetsInput,
  id: string,
  bmr: ModelRendererApi,
): Promise<string> {
  for (const [tag, dimension] of [
    ["is_nether", "the_nether"],
    ["is_end", "the_end"],
  ] as const) {
    const { values } = await readJson(
      sources,
      `data/minecraft/tags/worldgen/biome/${tag}.json`,
      bmr,
      true,
    );
    if (Array.isArray(values) && values.includes(id)) return dimension;
  }
  return "overworld";
}

export async function biomeEnvironment(
  sources: AssetsInput,
  id: string,
  opts: { dimension?: string; renderer?: ModelRendererApi } = {},
): Promise<BiomeEnvironment> {
  const bmr = opts.renderer ?? (await loadBmr());
  const [ns, name] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
  const biome = await readJson(sources, `data/${ns}/worldgen/biome/${name}.json`, bmr);
  const dimension = opts.dimension ?? (await dimensionOf(sources, `${ns}:${name}`, bmr));
  const dim = await readJson(sources, `data/minecraft/dimension_type/${dimension}.json`, bmr);
  const effects = (biome.effects ?? {}) as Record<string, string | undefined>;
  const attributes: Record<string, unknown> = { ...(dim.attributes as Json | undefined) };
  for (const [key, value] of Object.entries((biome.attributes as Json | undefined) ?? {}))
    attributes[key] = modify(attributes[key] ?? DEFAULTS[key], value);
  const attr = (key: string): unknown => attributes[key] ?? DEFAULTS[key];
  const distance = (key: string) => Number(attr(`minecraft:visual/${key}`));

  const temperature = Number(biome.temperature ?? 0.5);
  const downfall = Number(biome.downfall ?? 0.5);
  const water = effects.water_color ?? "#3f76e4";
  const climate = { temperature, downfall, water };
  const modifier = (effects.grass_color_modifier ?? "none") as BiomeEnvironment["grassModifier"];
  const grass: Biome =
    modifier === "dark_forest"
      ? { ...climate, tint: DARK_FOREST_FOLD, combine: true }
      : modifier === "swamp"
        ? { ...climate, tint: SWAMP_GRASS }
        : effects.grass_color
          ? { ...climate, tint: effects.grass_color }
          : climate;
  const withTint = (tint: string | undefined): Biome => (tint ? { ...climate, tint } : climate);

  const cloudHeight = attr("minecraft:visual/cloud_height") as number | undefined;
  const cloudColor = attr("minecraft:visual/cloud_color");
  const argb = (typeof cloudColor === "string" ? cloudColor : "#ffffffff").replace("#", "");
  return {
    id: `${ns}:${name}`,
    dimension,
    skybox: (dim.skybox as BiomeEnvironment["skybox"] | undefined) ?? "overworld",
    weather: dim.has_skylight !== false && dim.has_ceiling !== true && dimension !== "the_end",
    minY: Number(dim.min_y ?? 0),
    temperature,
    downfall,
    precipitation:
      biome.has_precipitation === false ? "none" : temperature < 0.15 ? "snow" : "rain",
    skyColor: String(attr("minecraft:visual/sky_color")),
    fogColor: String(attr("minecraft:visual/fog_color")),
    waterColor: water,
    waterFogColor: String(attr("minecraft:visual/water_fog_color")),
    grassModifier: modifier,
    cloud:
      cloudHeight === undefined
        ? null
        : {
            color: `#${argb.length === 8 ? argb.slice(2) : argb}`,
            alpha:
              argb.length === 8
                ? Math.round((parseInt(argb.slice(0, 2), 16) / 255) * 100) / 100
                : 1,
            height: Number(cloudHeight),
          },
    tint: {
      grass,
      foliage: withTint(effects.foliage_color),
      dryFoliage: withTint(effects.dry_foliage_color),
    },
    fog: {
      start: distance("fog_start_distance"),
      end: distance("fog_end_distance"),
      skyEnd: distance("sky_fog_end_distance"),
      cloudEnd: distance("cloud_fog_end_distance"),
    },
    waterFog: {
      start: distance("water_fog_start_distance"),
      end: distance("water_fog_end_distance"),
    },
    attributes,
    timelines: await timelinesOf(sources, dim.timelines, bmr),
  };
}

export type TimelineValue = number | boolean | string | { color: string; alpha: number };

export interface Timeline {
  id: string;
  period: number | undefined;
  at: (track: string, tick: number) => TimelineValue | undefined;
  color: (track: string, tick: number) => [number, number, number, number] | undefined;
  modifier: (track: string) => string | undefined;
}

type Keyframe = { ticks: number; value: unknown };
type Track = {
  ease?: string | { cubic_bezier: [number, number, number, number] };
  keyframes: Keyframe[];
  modifier?: string;
};

function cubicBezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

function argb(value: string): [number, number, number, number] {
  const hex = value.replace("#", "");
  const full = hex.length === 6 ? `ff${hex}` : hex;
  return [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
    number,
  ];
}

export async function timeline(
  sources: AssetsInput,
  id: string,
  opts: { renderer?: ModelRendererApi } = {},
): Promise<Timeline> {
  const bmr = opts.renderer ?? (await loadBmr());
  const [ns, name] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
  const file = await readJson(sources, `data/${ns}/timeline/${name}.json`, bmr);
  const period = file.period_ticks === undefined ? undefined : Number(file.period_ticks);
  const tracks = (file.tracks ?? {}) as Record<string, Track>;
  const track = (key: string) => tracks[key.includes(":") ? key : `minecraft:${key}`];
  const span = (key: string, tick: number) => {
    const tr = track(key);
    const keys = tr?.keyframes;
    if (!keys?.length) return undefined;
    if (period === undefined) {
      const first = keys[0]!;
      const last = keys[keys.length - 1]!;
      if (tick <= first.ticks) return { a: first.value, b: first.value, f: 0 };
      if (tick >= last.ticks) return { a: last.value, b: last.value, f: 0 };
    }
    const p = period ?? Infinity;
    const t = period === undefined ? tick : ((tick % p) + p) % p;
    let i = keys.length - 1;
    for (let k = 0; k < keys.length; k++) if (keys[k]!.ticks <= t) i = k;
    const a = keys[i]!;
    const b = keys[(i + 1) % keys.length]!;
    const ta = a.ticks <= t ? a.ticks : a.ticks - p;
    const tb = b.ticks > ta ? b.ticks : b.ticks + p;
    const linear = tb > ta ? (t - ta) / (tb - ta) : 0;
    const ease = tr!.ease;
    const f =
      ease === "constant"
        ? 0
        : typeof ease === "object"
          ? cubicBezier(ease.cubic_bezier, linear)
          : linear;
    return { a: a.value, b: b.value, f };
  };
  const color = (key: string, tick: number) => {
    const s = span(key, tick);
    if (!s || typeof s.a !== "string" || !s.a.startsWith("#")) return undefined;
    const [ca, cb] = [argb(s.a), argb(String(s.b))];
    const [a, r, g, b] = ca.map((v, c) => (v + (cb[c]! - v) * s.f) / 255) as [
      number,
      number,
      number,
      number,
    ];
    return [r, g, b, a] as [number, number, number, number];
  };
  return {
    id: `${ns}:${name}`,
    period,
    at(key, tick) {
      const s = span(key, tick);
      if (!s) return undefined;
      if (typeof s.a === "boolean") return s.a;
      if (typeof s.a === "number") return s.a + (Number(s.b) - s.a) * s.f;
      if (typeof s.a === "string" && !s.a.startsWith("#")) return s.a;
      const c = color(key, tick)!;
      const hex = c
        .slice(0, 3)
        .map((v) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
      return { color: `#${hex}`, alpha: Math.round(c[3] * 1000) / 1000 };
    },
    color,
    modifier: (key) => (track(key) ? (track(key)!.modifier ?? "override") : undefined),
  };
}

export const dayTimeline = (sources: AssetsInput, opts: { renderer?: ModelRendererApi } = {}) =>
  timeline(sources, "minecraft:day", opts);

export interface MinecraftFluidOptions {
  geometry?: THREE.BufferGeometry;
  size?: number;
  y?: number;
  cell?: number;
  renderer?: ModelRendererApi;
  name?: string;
}

export interface MinecraftWaterOptions extends MinecraftFluidOptions {
  biome?: string;
  color?: THREE.ColorRepresentation;
}

export interface MinecraftFluid<M extends THREE.MeshLambertMaterial | THREE.MeshBasicMaterial> {
  mesh: THREE.Mesh<THREE.BufferGeometry, M>;
  material: M;
  frames: THREE.Texture[];
  uniforms: { fluidCell: { value: number } };
  update: (t: number) => void;
  dispose: () => void;
}

async function fluidSurface<M extends THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>(
  sources: AssetsInput,
  textureName: string,
  material: M,
  opts: MinecraftFluidOptions,
): Promise<MinecraftFluid<M>> {
  const anim = await animatedTexture(sources, textureName, { renderer: opts.renderer });
  material.map = anim.frames[0] ?? null;
  const uniforms = { fluidCell: { value: opts.cell ?? 1 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float fluidCell;")
      .replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvMapUv = vec2(1.0, -1.0) * (modelMatrix * vec4(position, 1.0)).xz / fluidCell;",
      );
  };
  material.customProgramCacheKey = () => "mc-assets-fluid-surface";

  const geometry =
    opts.geometry ??
    new THREE.PlaneGeometry(opts.size ?? 256, opts.size ?? 256).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = opts.name ?? textureName.replace(/^.*\//, "");
  mesh.position.y = opts.y ?? 0;

  return {
    mesh,
    material,
    frames: anim.frames,
    uniforms,
    update(t: number) {
      material.map = anim.frames[anim.frameAt(t)] ?? material.map;
    },
    dispose() {
      mesh.removeFromParent();
      if (!opts.geometry) geometry.dispose();
      material.dispose();
      anim.dispose();
    },
  };
}

export async function createMinecraftWater(
  sources: AssetsInput,
  opts: MinecraftWaterOptions = {},
): Promise<MinecraftFluid<THREE.MeshLambertMaterial>> {
  const color =
    opts.color ??
    (await biomeEnvironment(sources, opts.biome ?? "plains", { renderer: opts.renderer }))
      .waterColor;
  const material = new THREE.MeshLambertMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return fluidSurface(sources, "block/water_still", material, { name: "water", ...opts });
}

export async function createMinecraftLava(
  sources: AssetsInput,
  opts: MinecraftFluidOptions = {},
): Promise<MinecraftFluid<THREE.MeshBasicMaterial>> {
  return fluidSurface(sources, "block/lava_still", new THREE.MeshBasicMaterial(), {
    name: "lava",
    ...opts,
  });
}

export interface MinecraftCloudsOptions {
  altitude?: number;
  daytime?: number;
  timeline?: Timeline;
  color?: THREE.ColorRepresentation;
  alpha?: number;
  fade?: number;
  image?: { width: number; height: number; data: ArrayLike<number> };
  renderer?: ModelRendererApi;
  name?: string;
}

const CLOUD_CELL = 12;
const CLOUD_THICKNESS = 4;
const CLOUD_WIND: readonly [number, number] = [-0.03 * 20, 0];
const CLOUD_FADE = 2048;

export async function cloudImage(
  sources: AssetsInput,
  opts: { renderer?: ModelRendererApi } = {},
): Promise<ImageData> {
  const t = await texture(sources, "environment/clouds", opts);
  const img = t.image as CanvasImageSource & { width: number; height: number };
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext("2d");
  if (!g) throw new Error("cloudImage(): no 2d context");
  g.drawImage(img, 0, 0);
  t.dispose();
  return g.getImageData(0, 0, img.width, img.height);
}

export async function createMinecraftClouds(
  sources: AssetsInput,
  opts: MinecraftCloudsOptions = {},
): Promise<
  Omit<CloudLayerHandle, "update"> & {
    update: (t: number) => void;
    setDaytime: (tick: number) => void;
    setColor: (rgba: readonly [number, number, number, number]) => void;
  }
> {
  const base = new THREE.Color(opts.color ?? "#ffffff");
  const baseAlpha = opts.alpha ?? 0.8;
  const day =
    opts.timeline ??
    (opts.daytime !== undefined
      ? await dayTimeline(sources, { renderer: opts.renderer })
      : undefined);
  const layer = createCloudLayer({
    image: opts.image ?? (await cloudImage(sources, { renderer: opts.renderer })),
    cell: CLOUD_CELL,
    height: CLOUD_THICKNESS,
    color: base,
    opacity: baseAlpha,
    fade: opts.fade ?? CLOUD_FADE,
    altitude: opts.altitude ?? 192.33,
    name: opts.name ?? "clouds",
  });
  for (const m of layer.mesh.material) m.fog = false;
  const a = base.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  const setDaytime = (tick: number) => {
    if (!day)
      throw new Error(
        "createMinecraftClouds(): pass daytime or timeline when creating it to set the daytime",
      );
    const tint = day.at("visual/cloud_color", tick) as { color: string; alpha: number } | undefined;
    const b = new THREE.Color(tint?.color ?? "#ffffff").getRGB(
      new THREE.Color(),
      THREE.SRGBColorSpace,
    );
    layer.material.color.setRGB(a.r * b.r, a.g * b.g, a.b * b.b, THREE.SRGBColorSpace);
    layer.material.opacity = baseAlpha * (tint?.alpha ?? 1);
  };
  if (opts.daytime !== undefined) setDaytime(opts.daytime);
  const setColor = ([r, g, b, alpha]: readonly [number, number, number, number]) => {
    layer.material.color.setRGB(r, g, b, THREE.SRGBColorSpace);
    layer.material.opacity = alpha;
  };
  return { ...layer, update: (t: number) => layer.update(t, CLOUD_WIND), setDaytime, setColor };
}
