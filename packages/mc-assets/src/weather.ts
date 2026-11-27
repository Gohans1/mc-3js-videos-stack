import type { AssetsInput } from "block-model-renderer";
import * as THREE from "three";

import { type BiomeEnvironment, biomeEnvironment, type Precipitation } from "./environment";
import { loadBmr, type ModelRendererApi, texture } from "./model";
import type { MinecraftParticles, Sim, Vec3 } from "./particles";
import { javaRandom, lightmap, type SkyState } from "./sky";

export interface WeatherWorld {
  height: number | ((x: number, z: number) => number);
  precipitation?: Precipitation | ((x: number, y: number, z: number) => Precipitation);
  lightLevel?: (x: number, y: number, z: number) => readonly [sky: number, block: number];
}

export interface SplashWorld extends WeatherWorld {
  surface?: (x: number, y: number, z: number, fx: number, fz: number) => number;
  hot?: (x: number, y: number, z: number) => boolean;
  minY?: number;
}

export interface WeatherColumn {
  kind: "rain" | "snow";
  x: number;
  z: number;
  bottom: number;
  top: number;
  u: number;
  v: number;
  sky: number;
  block: number;
}

export interface ColumnQuad {
  corners: [Vec3, Vec3, Vec3, Vec3];
  uv: [[number, number], [number, number], [number, number], [number, number]];
  alpha: number;
}

const heightAt = (w: WeatherWorld, x: number, z: number) =>
  typeof w.height === "function" ? w.height(x, z) : w.height;
const precipitationOf = (w: WeatherWorld, x: number, y: number, z: number): Precipitation =>
  typeof w.precipitation === "function" ? w.precipitation(x, y, z) : (w.precipitation ?? "rain");
const columnSeed = (x: number, z: number) =>
  ((Math.imul(Math.imul(x, x), 3121) + Math.imul(x, 45238971)) | 0) ^
  ((Math.imul(Math.imul(z, z), 418711) + Math.imul(z, 13761)) | 0);
const columnHash = (x: number, z: number) =>
  (Math.imul(Math.imul(x, x), 3121) +
    Math.imul(x, 45238971) +
    Math.imul(Math.imul(z, z), 418711) +
    Math.imul(z, 13761)) &
  255;

export function precipitationAt(
  env: Pick<BiomeEnvironment, "temperature" | "precipitation">,
  y: number,
  seaLevel = 63,
): Precipitation {
  if (env.precipitation === "none") return "none";
  const cold = seaLevel + 17;
  const temperature = y > cold ? env.temperature - ((y - cold) * 0.05) / 40 : env.temperature;
  return temperature < 0.15 ? "snow" : "rain";
}

export function weatherColumns(
  world: WeatherWorld,
  camera: Vec3,
  gameTime: number,
  opts: { radius?: number } = {},
): WeatherColumn[] {
  const r = opts.radius ?? 10;
  const cx = Math.floor(camera[0]);
  const cy = Math.floor(camera[1]);
  const cz = Math.floor(camera[2]);
  const tick = Math.floor(gameTime);
  const pt = gameTime - tick;
  const out: WeatherColumn[] = [];
  for (let z = cz - r; z <= cz + r; z++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const h = heightAt(world, x, z);
      const bottom = Math.max(cy - r, h);
      const top = Math.max(cy + r, h);
      if (top === bottom) continue;
      const kind = precipitationOf(world, x, cy, z);
      if (kind === "none") continue;
      const rng = javaRandom(columnSeed(x, z));
      const [sky, block] = world.lightLevel?.(x, Math.max(cy, h), z) ?? [15, 0];
      if (kind === "rain") {
        const speed = 3 + rng.nextFloat();
        const v = ((-((tick & 131071) + columnHash(x, z) + pt) / 32) * speed) % 32;
        out.push({ kind, x, z, bottom, top, u: 0, v, sky, block });
      } else {
        const t = (tick & 131071) + pt;
        const u = rng.nextDouble() + t * 0.01 * rng.nextGaussian();
        const drift = rng.nextDouble() + t * rng.nextGaussian() * 0.001;
        const v = -((tick & 511) + pt) / 512 + drift;
        const lift = (level: number) => Math.trunc((level * 3 + 15) / 4);
        out.push({ kind, x, z, bottom, top, u, v, sky: lift(sky), block: lift(block) });
      }
    }
  }
  return out;
}

export function columnQuad(
  col: WeatherColumn,
  camera: Vec3,
  intensity: number,
  radius = 10,
): ColumnQuad | undefined {
  const bx = col.x - Math.floor(camera[0]);
  const bz = col.z - Math.floor(camera[2]);
  const len = Math.hypot(bx, bz);
  if (len === 0) return undefined;
  const hx = -bz / len / 2;
  const hz = bx / len / 2;
  const x = col.x + 0.5 - camera[0];
  const z = col.z + 0.5 - camera[2];
  const far = Math.min((x * x + z * z) / (radius * radius), 1);
  const alpha = (intensity + far * (0.5 - intensity)) * (col.kind === "snow" ? 0.8 : 1);
  const top = col.top - camera[1];
  const bottom = col.bottom - camera[1];
  const vb = col.bottom * 0.25 + col.v;
  const vt = col.top * 0.25 + col.v;
  return {
    corners: [
      [x - hx, top, z - hz],
      [x + hx, top, z + hz],
      [x + hx, bottom, z + hz],
      [x - hx, bottom, z - hz],
    ],
    uv: [
      [col.u, vb],
      [col.u + 1, vb],
      [col.u + 1, vt],
      [col.u, vt],
    ],
    alpha,
  };
}

export interface RainSplashOptions {
  ticks: number;
  rain?: number | ((tick: number) => number);
  radius?: number;
  gameTime?: number;
  decreased?: boolean;
}

export function rainSplashes(
  sim: Sim,
  world: SplashWorld,
  center: (tick: number) => Vec3,
  opts: RainSplashOptions,
): void {
  const r = opts.radius ?? 10;
  const size = 2 * r + 1;
  const minY = world.minY ?? -64;
  const emitter = sim.spawn("emitter", center(0));
  emitter.lifetime = opts.ticks;
  emitter.emit = (e, s) => {
    const rain = typeof opts.rain === "function" ? opts.rain(e.age) : (opts.rain ?? 1);
    if (rain <= 0) return;
    const rng = javaRandom(BigInt((opts.gameTime ?? 0) + e.age) * 312987231n);
    const [px, py, pz] = center(e.age);
    const bx = Math.floor(px);
    const by = Math.floor(py);
    const bz = Math.floor(pz);
    const count = Math.trunc(
      Math.trunc(0.225 * size * size * rain * rain) / (opts.decreased ? 2 : 1),
    );
    for (let i = 0; i < count; i++) {
      const x = bx + rng.nextInt(size) - r;
      const z = bz + rng.nextInt(size) - r;
      const h = heightAt(world, x, z);
      if (h <= minY || h > by + 10 || h < by - 10) continue;
      if (precipitationOf(world, x, h, z) !== "rain") continue;
      const fx = rng.nextDouble();
      const fz = rng.nextDouble();
      const top = world.surface?.(x, h - 1, z, fx, fz) ?? 1;
      const type = world.hot?.(x, h - 1, z) ? "smoke" : "rain";
      s.spawn(type, [x + fx, h - 1 + top, z + fz], [0, 0, 0]);
    }
  };
}

export interface MinecraftWeatherOptions extends SplashWorld {
  biome?: string | BiomeEnvironment;
  seaLevel?: number;
  radius?: number;
  rain?: number;
  sky?: { state: SkyState };
  gameTime?: number;
  renderer?: ModelRendererApi;
  name?: string;
}

export interface MinecraftWeather {
  group: THREE.Group;
  world: SplashWorld;
  set: (conditions: { rain?: number }) => void;
  columns: (t: number, camera: Vec3) => WeatherColumn[];
  update: (t: number, camera: THREE.Camera) => void;
  splashes: (
    particles: Pick<MinecraftParticles, "burst">,
    at: number,
    until: number,
    opts: {
      center: Vec3 | ((t: number) => Vec3);
      rain?: number | ((t: number) => number);
      decreased?: boolean;
    },
  ) => void;
  dispose: () => void;
}

export async function createMinecraftWeather(
  sources: AssetsInput,
  opts: MinecraftWeatherOptions,
): Promise<MinecraftWeather> {
  const bmr = opts.renderer ?? (await loadBmr());
  const radius = Math.min(15, Math.max(1, Math.round(opts.radius ?? 10)));
  let precipitation = opts.precipitation;
  let minY = opts.minY;
  if (precipitation === undefined) {
    const env =
      typeof opts.biome === "object"
        ? opts.biome
        : await biomeEnvironment(sources, opts.biome ?? "plains", { renderer: bmr });
    precipitation = (_x, y) => precipitationAt(env, y, opts.seaLevel);
    minY ??= env.minY;
  }
  const world: SplashWorld = { ...opts, precipitation, minY };
  const [rainMap, snowMap] = await Promise.all(
    ["environment/rain", "environment/snow"].map(async (name) => {
      const t = await texture(sources, name, { renderer: bmr });
      Object.assign(t, {
        flipY: false,
        minFilter: THREE.NearestFilter,
        generateMipmaps: false,
        anisotropy: 1,
      });
      t.needsUpdate = true;
      return t;
    }),
  );

  const capacity = (2 * radius + 1) ** 2;
  const index: number[] = [];
  for (let i = 0; i < capacity; i++) {
    const o = i * 4;
    index.push(o, o + 1, o + 2, o + 2, o + 3, o);
  }
  const layer = (kind: "rain" | "snow", map: THREE.Texture) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(capacity * 12), 3),
    );
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(capacity * 8), 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 16), 4));
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.name = `minecraft-${kind}`;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = kind;
    mesh.frustumCulled = false;
    return mesh;
  };
  const meshes = { rain: layer("rain", rainMap!), snow: layer("snow", snowMap!) };
  const group = new THREE.Group();
  group.name = opts.name ?? "minecraft-weather";
  group.add(meshes.rain, meshes.snow);

  let rain = opts.rain;
  const tickAt = (t: number) => (opts.gameTime ?? 0) + t * 20;
  const columns = (t: number, camera: Vec3) => weatherColumns(world, camera, tickAt(t), { radius });
  const eye = new THREE.Vector3();
  const lit = new THREE.Color();

  const update = (t: number, camera: THREE.Camera) => {
    camera.getWorldPosition(eye);
    const cam: Vec3 = [eye.x, eye.y, eye.z];
    group.position.copy(eye);
    const intensity = rain ?? opts.sky?.state.rain ?? 1;
    const counts = { rain: 0, snow: 0 };
    if (intensity > 0) {
      for (const col of columns(t, cam)) {
        const quad = columnQuad(col, cam, intensity, radius);
        if (!quad) continue;
        const geo = meshes[col.kind].geometry;
        const i = counts[col.kind]++;
        const pos = geo.attributes.position!.array as Float32Array;
        const uv = geo.attributes.uv!.array as Float32Array;
        const color = geo.attributes.color!.array as Float32Array;
        if (opts.sky)
          lit.setRGB(...lightmap(opts.sky.state, col.sky, col.block), THREE.SRGBColorSpace);
        else lit.setRGB(1, 1, 1);
        for (let k = 0; k < 4; k++) {
          pos.set(quad.corners[k]!, (i * 4 + k) * 3);
          uv.set(quad.uv[k]!, (i * 4 + k) * 2);
          color.set([lit.r, lit.g, lit.b, quad.alpha], (i * 4 + k) * 4);
        }
      }
    }
    for (const kind of ["rain", "snow"] as const) {
      const geo = meshes[kind].geometry;
      geo.setDrawRange(0, counts[kind] * 6);
      meshes[kind].visible = counts[kind] > 0;
      for (const name of ["position", "uv", "color"]) geo.attributes[name]!.needsUpdate = true;
    }
  };

  return {
    group,
    world,
    set(conditions) {
      if (conditions.rain !== undefined) rain = conditions.rain;
    },
    columns,
    update,
    splashes(particles, at, until, o) {
      const center = typeof o.center === "function" ? o.center : () => o.center as Vec3;
      const rainAt = o.rain ?? rain ?? opts.sky?.state.rain ?? 1;
      particles.burst(at, (sim) =>
        rainSplashes(sim, world, (tick) => center(at + tick / 20), {
          ticks: Math.max(0, Math.round((until - at) * 20)),
          rain: typeof rainAt === "function" ? (tick) => rainAt(at + tick / 20) : rainAt,
          radius,
          gameTime: Math.floor(tickAt(at)),
          decreased: o.decreased,
        }),
      );
    },
    dispose() {
      for (const m of Object.values(meshes)) {
        m.geometry.dispose();
        m.material.dispose();
      }
      rainMap!.dispose();
      snowMap!.dispose();
    },
  };
}
