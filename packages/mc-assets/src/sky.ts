import type { AssetsInput } from "block-model-renderer";
import * as THREE from "three";

import { type BiomeEnvironment, biomeEnvironment, type Timeline, timeline } from "./environment";
import { loadBmr, type ModelRendererApi, texture } from "./model";

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export const MOON_PHASES = [
  "full_moon",
  "waning_gibbous",
  "third_quarter",
  "waning_crescent",
  "new_moon",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
] as const;
export type MoonPhase = (typeof MOON_PHASES)[number];

const MUL = 0x5deece66dn;
const MASK = (1n << 48n) - 1n;

export function javaRandom(seed: number | bigint) {
  let s = (BigInt(seed) ^ MUL) & MASK;
  const next = (bits: number) => {
    s = (s * MUL + 0xbn) & MASK;
    return Number(BigInt.asIntN(32, s >> BigInt(48 - bits)));
  };
  const nextDouble = () => (next(26) * 2 ** 27 + next(27)) * 2 ** -53;
  let spare: number | undefined;
  return {
    nextFloat: () => next(24) / 2 ** 24,
    nextDouble,
    nextInt(bound: number) {
      if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(next(31))) >> 31n);
      for (;;) {
        const bits = next(31);
        const val = bits % bound;
        if (((bits - val + (bound - 1)) | 0) >= 0) return val;
      }
    },
    nextGaussian() {
      if (spare !== undefined) {
        const v = spare;
        spare = undefined;
        return v;
      }
      for (;;) {
        const a = 2 * nextDouble() - 1;
        const b = 2 * nextDouble() - 1;
        const r = a * a + b * b;
        if (r < 1 && r !== 0) {
          const m = Math.sqrt((-2 * Math.log(r)) / r);
          spare = b * m;
          return a * m;
        }
      }
    },
  };
}

export function vanillaStars(): Float32Array {
  const r = javaRandom(10842);
  const f = Math.fround;
  const out: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const [dir, z, x, y, v] = [0, 0, 0, 0, 0].map(() => new THREE.Vector3());
  for (let i = 0; i < 1500; i++) {
    const px = f(f(r.nextFloat() * 2) - 1);
    const py = f(f(r.nextFloat() * 2) - 1);
    const pz = f(f(r.nextFloat() * 2) - 1);
    const size = f(0.15 + f(r.nextFloat() * f(0.1)));
    const lengthSq = f(px * px + py * py + pz * pz);
    if (lengthSq <= f(0.010000001) || lengthSq >= 1) continue;
    dir!.set(px, py, pz).normalize().multiplyScalar(100);
    const angle = r.nextDouble() * Math.fround(Math.PI) * 2;
    z!.copy(dir!).negate().normalize();
    x!.crossVectors(up, z!).normalize();
    y!.crossVectors(z!, x!);
    const [c, s] = [Math.cos(-angle), Math.sin(-angle)];
    for (const [a, b] of [
      [size, -size],
      [size, size],
      [-size, size],
      [-size, -size],
    ] as const) {
      const ra = a * c - b * s;
      const rb = a * s + b * c;
      v!.copy(x!).multiplyScalar(ra).addScaledVector(y!, rb).add(dir!);
      out.push(v!.x, v!.y, v!.z);
    }
  }
  return new Float32Array(out);
}

export type Submerged = "water" | "lava" | "powder_snow";

export interface SkyConditions {
  time?: number;
  rain?: number;
  thunder?: number;
  renderDistance?: number;
  cloudRange?: number;
  eyeSkyLight?: number;
  submerged?: Submerged;
  waterVision?: number;
  fireResistance?: boolean;
  flash?: boolean;
}

export const waterVision = (ticksUnderwater: number) =>
  ticksUnderwater >= 600
    ? 1
    : clamp01(ticksUnderwater / 100) * 0.6 +
      (ticksUnderwater < 100 ? 0 : clamp01((ticksUnderwater - 100) / 500)) * 0.39999998;

export interface FogDistances {
  environmentalStart: number;
  environmentalEnd: number;
  renderDistanceStart: number;
  renderDistanceEnd: number;
  skyEnd: number;
  cloudEnd: number;
}

export interface SkyState {
  skybox: BiomeEnvironment["skybox"];
  sky: Rgb;
  fog: Rgb;
  sunrise: Rgba;
  cloud: Rgba;
  sunAngle: number;
  moonAngle: number;
  starAngle: number;
  starBrightness: number;
  rainBrightness: number;
  moonPhase: MoonPhase;
  rain: number;
  thunder: number;
  renderDistance: number;
  skyFogEnd: number;
  minY: number;
  distances: FogDistances;
  skyLightColor: Rgb;
  skyLightFactor: number;
  ambientLight: Rgb;
  blockLightTint: Rgb;
  skyLightLevel: number;
  submerged?: Submerged;
  fluidFog: Rgb;
  waterVision: number;
}

type Value = number | boolean | string | Rgba;

const DEG = 0.017453292;
const SKY_DEFAULTS: Record<string, Value> = {
  sky_color: [0, 0, 0, 1],
  fog_color: [0, 0, 0, 1],
  sunrise_sunset_color: [0, 0, 0, 0],
  cloud_color: [0, 0, 0, 0],
  sun_angle: 0,
  moon_angle: 0,
  star_angle: 0,
  star_brightness: 0,
  moon_phase: "full_moon",
  sky_light_color: [1, 1, 1, 1],
  sky_light_factor: 1,
  ambient_light_color: [0, 0, 0, 1],
  block_light_tint: [1, 0xd8 / 255, 0x8c / 255, 1],
  sky_light_level: 15,
};
const NIGHT_SKY_LIGHT: Rgba = [0x7a / 255, 0x7a / 255, 1, 1];

function rgba(value: unknown): Rgba | undefined {
  if (typeof value !== "string" || !value.startsWith("#")) return undefined;
  const hex = value.slice(1);
  const full = hex.length === 6 ? `ff${hex}` : hex;
  const [a, r, g, b] = [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgba;
  return [r, g, b, a];
}

const lerp = (t: number, a: number, b: number) => a + (b - a) * t;
const lerpColor = (t: number, a: Rgba, b: Rgba) => a.map((v, i) => lerp(t, v, b[i]!)) as Rgba;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const channel8 = (v: number) => Math.floor(v * 255) / 255;

function applyModifier(modifier: string, base: Value, arg: Value): Value {
  if (Array.isArray(base) && Array.isArray(arg)) {
    if (modifier === "multiply") return base.map((v, i) => v * arg[i]!) as Rgba;
    return arg;
  }
  if (typeof base === "number" && typeof arg === "number") {
    const ops: Record<string, number> = {
      multiply: base * arg,
      add: base + arg,
      subtract: base - arg,
      maximum: Math.max(base, arg),
      minimum: Math.min(base, arg),
    };
    return ops[modifier] ?? arg;
  }
  if (typeof base === "boolean" && typeof arg === "boolean") {
    return modifier === "or" ? base || arg : modifier === "and" ? base && arg : arg;
  }
  return arg;
}

const blendToGray = (brightness: number, factor: number) => (c: Rgba) => {
  const g = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) * brightness;
  return lerpColor(factor, c, [g, g, g, c[3]]);
};
const multiplyBy = (r: number, g: number, b: number) => (c: Rgba) =>
  [c[0] * channel8(r), c[1] * channel8(g), c[2] * channel8(b), c[3]] as Rgba;

const WEATHER: Record<string, { rain: (v: Value) => Value; thunder: (v: Value) => Value }> = {
  sky_color: {
    rain: (c) => blendToGray(0.6, 0.75)(c as Rgba),
    thunder: (c) => blendToGray(0.24, 0.94)(c as Rgba),
  },
  fog_color: {
    rain: (c) => multiplyBy(0.5, 0.5, 0.6)(c as Rgba),
    thunder: (c) => multiplyBy(0.25, 0.25, 0.3)(c as Rgba),
  },
  cloud_color: {
    rain: (c) => blendToGray(0.24, 0.5)(c as Rgba),
    thunder: (c) => blendToGray(0.095, 0.94)(c as Rgba),
  },
  sunrise_sunset_color: {
    rain: (c) => multiplyBy(0.5, 0.5, 0.6)(c as Rgba),
    thunder: (c) => multiplyBy(0.25, 0.25, 0.3)(c as Rgba),
  },
  star_brightness: { rain: () => 0, thunder: () => 0 },
  sky_light_level: {
    rain: (v) => lerp(0.3125, v as number, 4),
    thunder: (v) => lerp(0.52734375, v as number, 4),
  },
  sky_light_factor: {
    rain: (v) => lerp(0.3125, v as number, 0.24),
    thunder: (v) => lerp(0.52734375, v as number, 0.24),
  },
  sky_light_color: {
    rain: (c) => lerpColor(channel8(0.3125), c as Rgba, NIGHT_SKY_LIGHT),
    thunder: (c) => lerpColor(channel8(0.52734375), c as Rgba, NIGHT_SKY_LIGHT),
  },
};

function weather(key: string, v: Value, rainOnly: number, thunder: number): Value {
  const w = WEATHER[key];
  if (!w) return v;
  const mix = (t: number, a: Value, b: Value) =>
    Array.isArray(a) ? lerpColor(t, a, b as Rgba) : lerp(t, a as number, b as number);
  if (rainOnly > 0) v = mix(rainOnly, v, w.rain(v));
  if (thunder > 0) v = mix(thunder, v, w.thunder(v));
  return v;
}

export function skyState(
  env: BiomeEnvironment,
  timelines: readonly Timeline[],
  c: SkyConditions = {},
): SkyState {
  const time = c.time ?? 6000;
  const rain = env.weather ? clamp01(c.rain ?? 0) : 0;
  const thunder = clamp01(c.thunder ?? 0) * rain;
  const rainOnly = rain - thunder;
  const renderDistance = Math.max(2, c.renderDistance ?? 12);

  const value = (key: string): Value => {
    const path = `${key === "sky_light_level" ? "gameplay" : "visual"}/${key}`;
    const raw = env.attributes[`minecraft:${path}`];
    let v: Value = rgba(raw) ?? (raw as Value | undefined) ?? SKY_DEFAULTS[key]!;
    for (const line of timelines) {
      const modifier = line.modifier(path);
      if (!modifier) continue;
      const arg = Array.isArray(v) ? line.color(path, time) : line.at(path, time);
      if (arg !== undefined) v = applyModifier(modifier, v, arg as Value);
    }
    v = weather(key, v, rainOnly, thunder);
    if (c.flash && key === "sky_color")
      v = lerpColor(0.22, v as Rgba, [0.8, 0.8, 1, (v as Rgba)[3]]);
    if (c.flash && key === "sky_light_factor") v = 1;
    return v;
  };

  const underSky = clamp01(((c.eyeSkyLight ?? 15) - 8) / 7);
  const rainFog = rain * underSky * (env.precipitation === "none" ? 0.5 : 1);
  const rdEnd = renderDistance * 16;
  const sky = value("sky_color") as Rgba;
  const fog = value("fog_color") as Rgba;
  const phase = String(value("moon_phase")).replace(/^minecraft:/, "");
  const rgb = (key: string): Rgb => (value(key) as Rgba).slice(0, 3) as Rgb;
  const vision = clamp01(c.waterVision ?? 1);
  const [fluidStart, fluidEnd, fluidFog]: [number, number, Rgb] | [] =
    c.submerged === "water"
      ? [
          env.waterFog.start,
          env.waterFog.end * Math.max(0.25, vision),
          (rgba(env.waterFogColor) ?? [0, 0, 0]).slice(0, 3) as Rgb,
        ]
      : c.submerged === "lava"
        ? [c.fireResistance ? 0 : 0.25, c.fireResistance ? 5 : 1, [0x99 / 255, 0x1a / 255, 0]]
        : c.submerged === "powder_snow"
          ? [0, 2, [0x9f / 255, 0xbb / 255, 0xcc / 255]]
          : [];
  const atmosphere = {
    environmentalStart: env.fog.start - 160 * rainFog,
    environmentalEnd: Math.max(Math.min(96, env.fog.end), env.fog.end - 256 * rainFog),
    skyEnd: Math.min(rdEnd, env.fog.skyEnd),
    cloudEnd: Math.min((c.cloudRange ?? 128) * 16, env.fog.cloudEnd),
  };
  return {
    skybox: env.skybox,
    sky: [sky[0], sky[1], sky[2]],
    fog: [fog[0], fog[1], fog[2]],
    sunrise: value("sunrise_sunset_color") as Rgba,
    cloud: value("cloud_color") as Rgba,
    sunAngle: (value("sun_angle") as number) * DEG,
    moonAngle: (value("moon_angle") as number) * DEG,
    starAngle: (value("star_angle") as number) * DEG,
    starBrightness: value("star_brightness") as number,
    rainBrightness: 1 - rain,
    moonPhase: (MOON_PHASES as readonly string[]).includes(phase)
      ? (phase as MoonPhase)
      : "full_moon",
    rain,
    thunder,
    renderDistance,
    skyFogEnd: env.fog.skyEnd,
    minY: env.minY,
    distances: {
      ...(fluidEnd === undefined
        ? atmosphere
        : {
            environmentalStart: fluidStart!,
            environmentalEnd: fluidEnd,
            skyEnd: fluidEnd,
            cloudEnd: fluidEnd,
          }),
      renderDistanceStart: rdEnd - Math.min(64, Math.max(4, rdEnd / 10)),
      renderDistanceEnd: rdEnd,
    },
    skyLightColor: rgb("sky_light_color"),
    skyLightFactor: value("sky_light_factor") as number,
    ambientLight: rgb("ambient_light_color"),
    blockLightTint: rgb("block_light_tint"),
    skyLightLevel: value("sky_light_level") as number,
    submerged: c.submerged,
    fluidFog: fluidFog ?? [0, 0, 0],
    waterVision: vision,
  };
}

export interface LightmapOptions {
  gamma?: number;
  flicker?: number;
}

export function lightmap(s: SkyState, sky: number, block: number, o: LightmapOptions = {}): Rgb {
  const brightness = (level: number) => level / (4 - 3 * level);
  const skyLevel = Math.floor(Math.min(15, Math.max(0, sky))) / 15;
  const blockLevel = Math.floor(Math.min(15, Math.max(0, block))) / 15;
  const skyBright = brightness(skyLevel) * s.skyLightFactor;
  const blockBright = brightness(blockLevel) * ((o.flicker ?? 0) + 1.4);
  const white = 0.9 * (2 * blockLevel - 1) ** 2;
  let c = [0, 1, 2].map((i) => {
    const blockColor = lerp(white, s.blockLightTint[i]!, 1);
    return clamp01(s.ambientLight[i]! + s.skyLightColor[i]! * skyBright + blockColor * blockBright);
  }) as Rgb;
  const max = Math.max(...c);
  if (max > 0) {
    const scaled = (1 - (1 - max) ** 4) / max;
    c = c.map((v) => lerp(o.gamma ?? 0.5, v, v * scaled)) as Rgb;
  }
  return c;
}

export function fogColorFacing(
  s: SkyState,
  forward: readonly [number, number, number],
  o: { y?: number } = {},
): Rgb {
  if (s.submerged) return fluidFogColor(s, o.y);
  let fog: Rgb = [...s.fog];
  if (s.renderDistance >= 4) {
    const side = Math.sin(s.sunAngle) > 0 ? -1 : 1;
    const len = Math.hypot(...forward) || 1;
    const d = (forward[0] / len) * side;
    if (d > 0 && s.sunrise[3] > 0)
      fog = fog.map((v, i) => lerp(d * s.sunrise[3], v, s.sunrise[i]!)) as Rgb;
  }
  let sky: Rgb = [...s.sky];
  if (s.rain > 0)
    sky = [sky[0] * (1 - s.rain * 0.5), sky[1] * (1 - s.rain * 0.5), sky[2] * (1 - s.rain * 0.4)];
  if (s.thunder > 0) sky = sky.map((v) => v * (1 - s.thunder * 0.5)) as Rgb;
  const reach = Math.min(s.skyFogEnd / 16, s.renderDistance);
  const f = 1 - (0.25 + 0.75 * clamp01(reach / 32)) ** 0.25;
  const dark = o.y === undefined ? 0 : clamp01((32 + s.minY - o.y) / 32);
  return fog.map((v, i) => lerp(f, v, sky[i]!) * (1 - dark) ** 2) as Rgb;
}

function fluidFogColor(s: SkyState, y: number | undefined): Rgb {
  if (s.submerged !== "water") return [...s.fluidFog];
  const dark = y === undefined ? 0 : clamp01((32 + s.minY - y) / 32);
  const c = s.fluidFog.map((v) => v * (1 - dark) ** 2) as Rgb;
  if (c.some((v) => v === 0)) return c;
  const scale = 1 / Math.max(...c);
  return c.map((v) => lerp(s.waterVision, v, v * scale)) as Rgb;
}

const LINEAR = `
vec3 mcToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float mcLinearFog(float v, float start, float end) {
  if (v <= start) return 0.0;
  if (v >= end) return 1.0;
  return (v - start) / (end - start);
}`;

const FAR_VERTEX = `
attribute float alpha;
varying vec2 vUv;
varying float vAlpha;
varying float vSph;
varying float vCyl;
void main() {
  vUv = uv;
  vAlpha = alpha;
  vSph = length(position);
  vCyl = max(length(position.xz), abs(position.y));
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAGMENTS = {
  clear: `uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`,
  disc: `uniform vec3 skyColor;
uniform vec3 fogColor;
uniform float skyEnd;
varying float vSph;
varying float vCyl;
void main() {
  float f = max(mcLinearFog(vSph, 0.0, skyEnd), mcLinearFog(vCyl, skyEnd, skyEnd));
  gl_FragColor = vec4(mcToLinear(mix(skyColor, fogColor, f)), 1.0);
}`,
  sunrise: `uniform vec4 color;
varying float vAlpha;
void main() {
  if (vAlpha == 0.0) discard;
  gl_FragColor = vec4(mcToLinear(color.rgb), vAlpha * color.a);
}`,
  celestial: `uniform sampler2D map;
uniform float alpha;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a == 0.0) discard;
  gl_FragColor = vec4(mcToLinear(c.rgb * c.a * alpha), 1.0);
}`,
  stars: `uniform float brightness;
void main() { gl_FragColor = vec4(mcToLinear(vec3(brightness * brightness)), 1.0); }`,
  end: `uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv) * vec4(vec3(40.0 / 255.0), 1.0);
  if (c.a == 0.0) discard;
  gl_FragColor = vec4(mcToLinear(c.rgb), c.a);
}`,
};

type Blend = "opaque" | "translucent" | "additive";

function farMaterial(
  kind: keyof typeof FRAGMENTS,
  uniforms: Record<string, THREE.IUniform>,
  blend: Blend,
) {
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FAR_VERTEX,
    fragmentShader: `${LINEAR}\n${FRAGMENTS[kind]}`,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    transparent: true,
    side: THREE.DoubleSide,
    fog: false,
    blending: blend === "opaque" ? THREE.NoBlending : THREE.CustomBlending,
  });
  if (blend === "translucent") {
    Object.assign(m, {
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  } else if (blend === "additive") {
    Object.assign(m, {
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
  }
  return m;
}

function geometry(
  positions: number[],
  extra: { uv?: number[]; alpha?: number[]; index?: number[] } = {},
) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const n = positions.length / 3;
  g.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(extra.uv ?? Array.from({ length: n * 2 }, () => 0), 2),
  );
  g.setAttribute(
    "alpha",
    new THREE.Float32BufferAttribute(extra.alpha ?? Array.from({ length: n }, () => 1), 1),
  );
  if (extra.index) g.setIndex(extra.index);
  return g;
}

function skyDisc(h: number) {
  const ring = Array.from({ length: 9 }, (_, i) => {
    const a = (-180 + i * 45) * (Math.PI / 180);
    return [Math.sign(h) * 512 * Math.cos(a), h, 512 * Math.sin(a)];
  });
  const pos: number[] = [];
  for (let i = 0; i < 8; i++) pos.push(0, h, 0, ...ring[i]!, ...ring[i + 1]!);
  return geometry(pos);
}

function sunriseFan() {
  const ring = Array.from({ length: 17 }, (_, i) => {
    const a = (i * Math.PI * 2) / 16;
    return [Math.sin(a) * 120, Math.cos(a) * 120, -Math.cos(a) * 40];
  });
  const pos: number[] = [];
  const alpha: number[] = [];
  for (let i = 0; i < 16; i++) {
    pos.push(0, 100, 0, ...ring[i]!, ...ring[i + 1]!);
    alpha.push(1, 0, 0);
  }
  return geometry(pos, { alpha });
}

function celestialQuad(moon: boolean) {
  const uv = moon ? [1, 1, 0, 1, 0, 0, 1, 0] : [0, 0, 1, 0, 1, 1, 0, 1];
  return geometry([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], { uv, index: [0, 1, 2, 0, 2, 3] });
}

function starsGeometry() {
  const corners = vanillaStars();
  const index: number[] = [];
  for (let q = 0; q < corners.length / 12; q++)
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  return geometry(Array.from(corners), { index });
}

function endBox() {
  const turns = [
    new THREE.Matrix4(),
    new THREE.Matrix4().makeRotationX(Math.PI / 2),
    new THREE.Matrix4().makeRotationX(-Math.PI / 2),
    new THREE.Matrix4().makeRotationX(Math.PI),
    new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
  ];
  const face = [
    [-100, -100, -100, 0, 0],
    [-100, -100, 100, 0, 16],
    [100, -100, 100, 16, 16],
    [100, -100, -100, 16, 0],
  ] as const;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const v = new THREE.Vector3();
  turns.forEach((m, f) => {
    for (const [x, y, z, u, w] of face) {
      v.set(x, y, z).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      uv.push(u, w);
    }
    index.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return geometry(pos, { uv, index });
}

async function skyTexture(sources: AssetsInput, name: string, renderer: ModelRendererApi) {
  const t = await texture(sources, name, { renderer });
  Object.assign(t, {
    colorSpace: THREE.NoColorSpace,
    flipY: false,
    minFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  t.name = name.replace(/^.*\//, "");
  t.needsUpdate = true;
  return t;
}

export interface MinecraftSkyOptions extends SkyConditions {
  biome?: string | BiomeEnvironment;
  horizon?: number;
  renderer?: ModelRendererApi;
  name?: string;
}

export interface MinecraftSky {
  group: THREE.Group;
  state: SkyState;
  fogColor: THREE.Color;
  fog: THREE.Fog;
  fogUniforms: { mcFog: { value: THREE.Vector4 } };
  light: THREE.Color;
  set: (conditions: SkyConditions) => void;
  follow: (camera: THREE.Camera, opts?: { y?: number }) => void;
  dispose: () => void;
}

export async function createMinecraftSky(
  sources: AssetsInput,
  opts: MinecraftSkyOptions = {},
): Promise<MinecraftSky> {
  const bmr = opts.renderer ?? (await loadBmr());
  const env =
    typeof opts.biome === "object"
      ? opts.biome
      : await biomeEnvironment(sources, opts.biome ?? "plains", { renderer: bmr });
  const lines = await Promise.all(
    env.timelines.map((id) => timeline(sources, id, { renderer: bmr })),
  );
  const horizon = opts.horizon ?? 63;
  let conditions: SkyConditions = { ...opts };
  let state = skyState(env, lines, conditions);

  const group = new THREE.Group();
  group.name = opts.name ?? "minecraft-sky";
  const meshes: THREE.Mesh[] = [];
  const add = (
    parent: THREE.Object3D,
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.ShaderMaterial,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = -2000 + meshes.length;
    meshes.push(mesh);
    parent.add(mesh);
    return mesh;
  };
  const textures: THREE.Texture[] = [];

  const fogColor = new THREE.Color();
  const light = new THREE.Color();
  const fog = new THREE.Fog(
    fogColor.clone(),
    state.distances.renderDistanceStart,
    state.distances.renderDistanceEnd,
  );
  const fogUniforms = { mcFog: { value: new THREE.Vector4() } };
  const fogSrgb = { value: new THREE.Vector3() };

  const clearUniforms = { color: { value: fogColor } };
  add(
    group,
    "sky-clear",
    new THREE.IcosahedronGeometry(100, 2),
    farMaterial("clear", clearUniforms, "opaque"),
  );

  const overworld = state.skybox === "overworld";
  const discUniforms = {
    skyColor: { value: new THREE.Vector3() },
    fogColor: fogSrgb,
    skyEnd: { value: 512 },
  };
  const darkUniforms = {
    skyColor: { value: new THREE.Vector3(0, 0, 0) },
    fogColor: fogSrgb,
    skyEnd: discUniforms.skyEnd,
  };
  const sunriseUniforms = { color: { value: new THREE.Vector4() } };
  const sunUniforms = { map: { value: null as THREE.Texture | null }, alpha: { value: 1 } };
  const moonUniforms = { map: { value: null as THREE.Texture | null }, alpha: sunUniforms.alpha };
  const starUniforms = { brightness: { value: 0 } };
  let sunrise: THREE.Mesh | undefined;
  let celestial: THREE.Group | undefined;
  let pivots: { sun: THREE.Object3D; moon: THREE.Object3D; stars: THREE.Object3D } | undefined;
  let stars: THREE.Mesh | undefined;
  let darkDisc: THREE.Mesh | undefined;
  const moons = new Map<MoonPhase, THREE.Texture>();

  if (overworld) {
    const sunTex = await skyTexture(sources, "environment/celestial/sun", bmr);
    textures.push(sunTex);
    for (const phase of MOON_PHASES) {
      const t = await skyTexture(sources, `environment/celestial/moon/${phase}`, bmr);
      moons.set(phase, t);
      textures.push(t);
    }
    sunUniforms.map.value = sunTex;

    add(group, "sky-disc", skyDisc(16), farMaterial("disc", discUniforms, "opaque"));
    sunrise = add(
      group,
      "sky-sunrise",
      sunriseFan(),
      farMaterial("sunrise", sunriseUniforms, "translucent"),
    );
    sunrise.matrixAutoUpdate = false;
    celestial = new THREE.Group();
    celestial.name = "sky-celestial";
    celestial.rotation.y = -Math.PI / 2;
    group.add(celestial);
    pivots = { sun: new THREE.Object3D(), moon: new THREE.Object3D(), stars: new THREE.Object3D() };
    celestial.add(pivots.sun, pivots.moon, pivots.stars);
    const sun = add(
      pivots.sun,
      "sky-sun",
      celestialQuad(false),
      farMaterial("celestial", sunUniforms, "additive"),
    );
    sun.position.y = 100;
    sun.scale.set(30, 1, 30);
    const moon = add(
      pivots.moon,
      "sky-moon",
      celestialQuad(true),
      farMaterial("celestial", moonUniforms, "additive"),
    );
    moon.position.y = 100;
    moon.scale.set(20, 1, 20);
    stars = add(
      pivots.stars,
      "sky-stars",
      starsGeometry(),
      farMaterial("stars", starUniforms, "additive"),
    );
    darkDisc = add(
      group,
      "sky-dark-disc",
      skyDisc(-16),
      farMaterial("disc", darkUniforms, "opaque"),
    );
    darkDisc.position.y = 12;
  } else if (state.skybox === "end") {
    const endTex = await skyTexture(sources, "environment/end_sky", bmr);
    textures.push(endTex);
    add(group, "sky-end", endBox(), farMaterial("end", { map: { value: endTex } }, "translucent"));
  }

  const forward = new THREE.Vector3(0, 0, -1);
  let eyeY: number | undefined;
  const eye = new THREE.Vector3();
  const sunriseMatrix = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();

  const skyHidden = () => state.submerged === "lava" || state.submerged === "powder_snow";

  const applyState = () => {
    const d = state.distances;
    fogUniforms.mcFog.value.set(
      d.environmentalStart,
      d.environmentalEnd,
      d.renderDistanceStart,
      d.renderDistanceEnd,
    );
    fog.near = d.renderDistanceStart;
    fog.far = d.renderDistanceEnd;
    discUniforms.skyEnd.value = d.skyEnd;
    discUniforms.skyColor.value.set(...state.sky);
    light.setRGB(...lightmap(state, 15, 0), THREE.SRGBColorSpace);
    for (const piece of group.children) piece.visible = piece.name === "sky-clear" || !skyHidden();
    if (darkDisc) darkDisc.visible = eyeY !== undefined && eyeY - horizon < 0 && !skyHidden();
    if (!overworld) return;
    sunriseUniforms.color.value.set(...state.sunrise);
    sunrise!.visible = state.sunrise[3] > 0.001 && !skyHidden();
    const z = ((Math.sin(state.sunAngle) < 0 ? 180 : 0) + 90) * (Math.PI / 180);
    sunriseMatrix
      .makeRotationX(Math.PI / 2)
      .multiply(tmp.makeRotationZ(z))
      .multiply(tmp.makeScale(1, 1, state.sunrise[3]));
    sunrise!.matrix.copy(sunriseMatrix);
    sunrise!.matrixWorldNeedsUpdate = true;
    pivots!.sun.rotation.x = state.sunAngle;
    pivots!.moon.rotation.x = state.moonAngle;
    pivots!.stars.rotation.x = state.starAngle;
    sunUniforms.alpha.value = state.rainBrightness;
    moonUniforms.map.value = moons.get(state.moonPhase)!;
    starUniforms.brightness.value = state.starBrightness;
    stars!.visible = state.starBrightness > 0 && !skyHidden();
  };

  const applyFog = () => {
    const srgb = fogColorFacing(state, [forward.x, forward.y, forward.z], { y: eyeY });
    fogSrgb.value.set(...srgb);
    fogColor.setRGB(...srgb, THREE.SRGBColorSpace);
    fog.color.copy(fogColor);
  };

  applyState();
  applyFog();

  return {
    group,
    get state() {
      return state;
    },
    fogColor,
    fog,
    fogUniforms,
    light,
    set(next) {
      conditions = { ...conditions, ...next };
      state = skyState(env, lines, conditions);
      applyState();
      applyFog();
    },
    follow(camera, o = {}) {
      camera.updateWorldMatrix(true, false);
      camera.getWorldPosition(eye);
      camera.getWorldDirection(forward);
      group.position.copy(eye);
      eyeY = o.y ?? eye.y;
      if (darkDisc) darkDisc.visible = eyeY - horizon < 0 && !skyHidden();
      applyFog();
    },
    dispose() {
      group.removeFromParent();
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      for (const t of textures) t.dispose();
    },
  };
}

const patched = new WeakSet<THREE.Material>();

export function useVanillaFog(root: THREE.Object3D, sky: Pick<MinecraftSky, "fogUniforms">): void {
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of (Array.isArray(mats) ? mats : mats ? [mats] : []) as THREE.Material[]) {
      if (patched.has(m)) continue;
      patched.add(m);
      const before = m.onBeforeCompile;
      const ownKey =
        m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey
          ? () => before.toString()
          : m.customProgramCacheKey.bind(m);
      m.onBeforeCompile = (shader, renderer) => {
        before.call(m, shader, renderer);
        shader.uniforms.mcFog = sky.fogUniforms.mcFog;
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <fog_pars_vertex>",
            "#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vMcFogPos;\n#endif",
          )
          .replace(
            "#include <fog_vertex>",
            "#include <fog_vertex>\n#ifdef USE_FOG\nvMcFogPos = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <fog_pars_fragment>",
            `#include <fog_pars_fragment>\n#ifdef USE_FOG\nuniform vec4 mcFog;\nvarying vec3 vMcFogPos;\n${LINEAR}\n#endif`,
          )
          .replace(
            "#include <fog_fragment>",
            `#ifdef USE_FOG
float mcFogValue = max(
  mcLinearFog(length(vMcFogPos), mcFog.x, mcFog.y),
  mcLinearFog(max(length(vMcFogPos.xz), abs(vMcFogPos.y)), mcFog.z, mcFog.w));
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, mcFogValue);
#endif`,
          );
      };
      m.customProgramCacheKey = () => `${ownKey()}|mc-vanilla-fog`;
      m.needsUpdate = true;
    }
  });
}
