import type { AssetsInput } from "block-model-renderer";
import * as THREE from "three";

import { blockParticleTexture, loadBmr, type ModelRendererApi, texturePath } from "./model";

export type Vec3 = readonly [number, number, number];
export type Rgb = [number, number, number];

export interface Rng {
  nextFloat: () => number;
  nextDouble: () => number;
  nextInt: (bound: number) => number;
  nextBoolean: () => boolean;
  nextGaussian: () => number;
}

export function seededRandom(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | undefined;
  return {
    nextFloat: next,
    nextDouble: next,
    nextInt: (bound) => Math.floor(next() * bound),
    nextBoolean: () => next() < 0.5,
    nextGaussian: () => {
      if (spare !== undefined) {
        const v = spare;
        spare = undefined;
        return v;
      }
      let u = 0;
      let v = 0;
      let r = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        r = u * u + v * v;
      } while (r >= 1 || r === 0);
      const m = Math.sqrt((-2 * Math.log(r)) / r);
      spare = v * m;
      return u * m;
    },
  };
}

export interface ParticleWorld {
  solid?: (x: number, y: number, z: number) => boolean;
  ground?: number;
  fluid?: (x: number, y: number, z: number) => number;
}

export class Particle {
  x = 0;
  y = 0;
  z = 0;
  xo = 0;
  yo = 0;
  zo = 0;
  xd = 0;
  yd = 0;
  zd = 0;
  age = 0;
  lifetime = 0;
  gravity = 0;
  friction = 0.98;
  hasPhysics = true;
  speedUp = false;
  onGround = false;
  stopped = false;
  removed = false;
  bbWidth = 0.6;
  bbHeight = 1.8;
  quadSize = 0;
  r = 1;
  g = 1;
  b = 1;
  a = 1;
  roll = 0;
  oRoll = 0;
  frameAge = -1;
  frameLife = 1;
  framePick = 0;
  uv: [number, number, number, number] | undefined;
  sprite: string | undefined;
  data: Record<string, number> = {};
  emit: ((p: Particle, sim: Sim) => void) | undefined;
  constructor(
    readonly type: ParticleType,
    readonly rng: Rng,
  ) {}
}

export interface SpawnOptions {
  sprite?: string;
  color?: Rgb;
  value?: number;
}

export interface Sim {
  world: ParticleWorld;
  rng: Rng;
  spawn: (type: ParticleType, pos: Vec3, vel?: Vec3, opts?: SpawnOptions) => Particle;
}

type Layer = "opaque" | "translucent" | "none";

interface Recipe {
  set?: string;
  layer: Layer;
  init: (p: Particle, pos: Vec3, vel: Vec3, o: SpawnOptions, sim: Sim) => void;
  tick?: (p: Particle, sim: Sim) => void;
  size?: (p: Particle, pt: number) => number;
  alpha?: (p: Particle, pt: number) => number;
  glow?: (p: Particle, pt: number) => number;
  visible?: (p: Particle) => boolean;
}

function setSize(p: Particle, w: number, h: number) {
  p.bbWidth = w;
  p.bbHeight = h;
}

function base(p: Particle, [x, y, z]: Vec3) {
  setSize(p, 0.2, 0.2);
  p.x = p.xo = x;
  p.y = p.yo = y;
  p.z = p.zo = z;
  p.lifetime = Math.trunc(4 / (p.rng.nextFloat() * 0.9 + 0.1));
}

function baseMoving(p: Particle, pos: Vec3, [xa, ya, za]: Vec3) {
  base(p, pos);
  const r = p.rng;
  p.xd = xa + (r.nextFloat() * 2 - 1) * 0.4;
  p.yd = ya + (r.nextFloat() * 2 - 1) * 0.4;
  p.zd = za + (r.nextFloat() * 2 - 1) * 0.4;
  const speed = (r.nextFloat() + r.nextFloat() + 1) * 0.15;
  const len = Math.hypot(p.xd, p.yd, p.zd);
  p.xd = (p.xd / len) * speed * 0.4;
  p.yd = (p.yd / len) * speed * 0.4 + 0.1;
  p.zd = (p.zd / len) * speed * 0.4;
}

function quad(p: Particle) {
  p.quadSize = 0.1 * (p.rng.nextFloat() * 0.5 + 0.5) * 2;
}

const still = (p: Particle, pos: Vec3) => {
  base(p, pos);
  quad(p);
};
const moving = (p: Particle, pos: Vec3, vel: Vec3) => {
  baseMoving(p, pos, vel);
  quad(p);
};

function setPower(p: Particle, power: number) {
  p.xd *= power;
  p.yd = (p.yd - 0.1) * power + 0.1;
  p.zd *= power;
}

function scale(p: Particle, s: number) {
  p.quadSize *= s;
  setSize(p, 0.2 * s, 0.2 * s);
}

const EPS = 1e-7;

function collide(p: Particle, dx: number, dy: number, dz: number, world: ParticleWorld): Vec3 {
  const half = p.bbWidth / 2;
  const box = [p.x - half, p.y, p.z - half, p.x + half, p.y + p.bbHeight, p.z + half];
  const axis = (a: 0 | 1 | 2, d: number) => {
    if (d === 0) return 0;
    const lo = box[a]!;
    const hi = box[a + 3]!;
    if (
      a === 1 &&
      world.ground !== undefined &&
      d < 0 &&
      lo >= world.ground - EPS &&
      lo + d < world.ground
    )
      d = world.ground - lo;
    if (world.solid) {
      const [o1, o2] = ([0, 1, 2] as const).filter((o) => o !== a) as [0 | 1 | 2, 0 | 1 | 2];
      const span = (o: number) =>
        [Math.floor(box[o]! + EPS), Math.floor(box[o + 3]! - EPS)] as const;
      const [a1, b1] = span(o1);
      const [a2, b2] = span(o2);
      const cell = [0, 0, 0];
      const hit = (c: number) => {
        cell[a] = c;
        for (let i = a1; i <= b1; i++)
          for (let j = a2; j <= b2; j++) {
            cell[o1] = i;
            cell[o2] = j;
            if (world.solid!(cell[0]!, cell[1]!, cell[2]!)) return true;
          }
        return false;
      };
      if (d > 0) {
        for (let c = Math.ceil(hi - EPS); c < hi + d; c++)
          if (hit(c)) {
            d = Math.min(d, c - hi);
            break;
          }
      } else {
        for (let c = Math.floor(lo + EPS) - 1; c + 1 > lo + d; c--)
          if (hit(c)) {
            d = Math.max(d, c + 1 - lo);
            break;
          }
      }
    }
    box[a] = lo + d;
    box[a + 3] = hi + d;
    return d;
  };
  const y = axis(1, dy);
  let x = 0;
  let z = 0;
  if (Math.abs(dx) < Math.abs(dz)) {
    z = axis(2, dz);
    x = axis(0, dx);
  } else {
    x = axis(0, dx);
    z = axis(2, dz);
  }
  return [x, y, z];
}

type Mover = (p: Particle, dx: number, dy: number, dz: number, world: ParticleWorld) => void;

const move: Mover = (p, dx, dy, dz, world) => {
  if (p.stopped) return;
  const [ox, oy, oz] = [dx, dy, dz];
  if (p.hasPhysics && (dx || dy || dz) && dx * dx + dy * dy + dz * dz < 100 * 100)
    [dx, dy, dz] = collide(p, dx, dy, dz, world);
  p.x += dx;
  p.y += dy;
  p.z += dz;
  if (Math.abs(oy) >= 1e-5 && Math.abs(dy) < 1e-5) p.stopped = true;
  p.onGround = oy !== dy && oy < 0;
  if (ox !== dx) p.xd = 0;
  if (oz !== dz) p.zd = 0;
};

const glide: Mover = (p, dx, dy, dz) => {
  p.x += dx;
  p.y += dy;
  p.z += dz;
};

function remember(p: Particle) {
  p.xo = p.x;
  p.yo = p.y;
  p.zo = p.z;
}

function baseTick(p: Particle, sim: Sim, mover: Mover = move) {
  remember(p);
  if (p.age++ >= p.lifetime) {
    p.removed = true;
    return;
  }
  p.yd -= 0.04 * p.gravity;
  mover(p, p.xd, p.yd, p.zd, sim.world);
  if (p.speedUp && p.y === p.yo) {
    p.xd *= 1.1;
    p.zd *= 1.1;
  }
  p.xd *= p.friction;
  p.yd *= p.friction;
  p.zd *= p.friction;
  if (p.onGround) {
    p.xd *= 0.7;
    p.zd *= 0.7;
  }
}

function fromAge(p: Particle) {
  if (p.removed) return;
  p.frameAge = p.age;
  p.frameLife = p.lifetime;
}
function randomFrame(p: Particle) {
  p.frameAge = -1;
  p.framePick = p.rng.nextFloat();
}

export function frameIndex(p: Particle, n: number): number {
  if (n <= 1) return 0;
  if (p.frameAge >= 0) return Math.min(n - 1, Math.trunc((p.frameAge * (n - 1)) / p.frameLife));
  return Math.min(n - 1, Math.floor(p.framePick * n));
}

const ramp32 = (p: Particle, pt: number) =>
  p.quadSize * Math.min(1, Math.max(0, ((p.age + pt) / p.lifetime) * 32));

function ashSmoke(
  p: Particle,
  pos: Vec3,
  vel: Vec3,
  mul: number,
  scaleBy: number,
  colorMul: number,
  lifetimeBase: number,
  gravity: number,
  physics: boolean,
) {
  moving(p, pos, [0, 0, 0]);
  p.friction = 0.96;
  p.gravity = gravity;
  p.speedUp = true;
  p.xd = p.xd * mul + vel[0];
  p.yd = p.yd * mul + vel[1];
  p.zd = p.zd * mul + vel[2];
  const c = p.rng.nextFloat() * colorMul;
  p.r = p.g = p.b = c;
  p.quadSize *= 0.75 * scaleBy;
  p.lifetime = Math.max(1, Math.trunc((lifetimeBase / (p.rng.nextFloat() * 0.8 + 0.2)) * scaleBy));
  p.hasPhysics = physics;
  fromAge(p);
}

const smokeTick = (p: Particle, sim: Sim) => {
  baseTick(p, sim);
  fromAge(p);
};

function rising(p: Particle, pos: Vec3, vel: Vec3) {
  moving(p, pos, vel);
  p.friction = 0.96;
  p.xd = p.xd * 0.01 + vel[0];
  p.yd = p.yd * 0.01 + vel[1];
  p.zd = p.zd * 0.01 + vel[2];
  const r = p.rng;
  p.x += (r.nextFloat() - r.nextFloat()) * 0.05;
  p.y += (r.nextFloat() - r.nextFloat()) * 0.05;
  p.z += (r.nextFloat() - r.nextFloat()) * 0.05;
  p.lifetime = Math.trunc(8 / (r.nextFloat() * 0.8 + 0.2)) + 4;
}

const boxGlide: Mover = (p, dx, dy, dz) => {
  p.data.boxX = (p.data.boxX ?? p.x) + dx;
  p.data.boxY = (p.data.boxY ?? p.y) + dy;
  p.data.boxZ = (p.data.boxZ ?? p.z) + dz;
  [p.x, p.y, p.z] = [p.data.boxX, p.data.boxY, p.data.boxZ];
};

const flame: Recipe = {
  set: "flame",
  layer: "opaque",
  init: (p, pos, vel) => {
    rising(p, pos, vel);
    [p.data.boxX, p.data.boxY, p.data.boxZ] = pos;
    randomFrame(p);
  },
  tick: (p, sim) => baseTick(p, sim, boxGlide),
  size: (p, pt) => {
    const f = (p.age + pt) / p.lifetime;
    return p.quadSize * (1 - f * f * 0.5);
  },
  glow: (p, pt) => Math.min(1, Math.max(0, (p.age + pt) / p.lifetime)),
};

function animated(p: Particle, pos: Vec3, gravity: number) {
  still(p, pos);
  p.friction = 0.91;
  p.gravity = gravity;
}
function setFade(p: Particle, rgb: number) {
  p.data.fadeR = ((rgb >> 16) & 255) / 255;
  p.data.fadeG = ((rgb >> 8) & 255) / 255;
  p.data.fadeB = (rgb & 255) / 255;
  p.data.hasFade = 1;
}
function setRgb(p: Particle, rgb: number) {
  p.r = ((rgb >> 16) & 255) / 255;
  p.g = ((rgb >> 8) & 255) / 255;
  p.b = (rgb & 255) / 255;
}
function animatedTick(p: Particle, sim: Sim, mover: Mover = move) {
  baseTick(p, sim, mover);
  fromAge(p);
  const half = Math.trunc(p.lifetime / 2);
  if (p.age > half) {
    p.a = 1 - (p.age - half) / p.lifetime;
    if (p.data.hasFade) {
      p.r += (p.data.fadeR! - p.r) * 0.2;
      p.g += (p.data.fadeG! - p.g) * 0.2;
      p.b += (p.data.fadeB! - p.b) * 0.2;
    }
  }
}

function falling(
  p: Particle,
  pos: Vec3,
  fall: number,
  windBig: number,
  swirl: boolean,
  flowAway: boolean,
  size: number,
  startVel: number,
) {
  still(p, pos);
  const r = p.rng;
  p.data.rotSpeed = ((r.nextBoolean() ? -30 : 30) * Math.PI) / 180;
  p.data.spin = ((r.nextBoolean() ? -5 : 5) * Math.PI) / 180;
  p.data.windBig = windBig;
  p.data.swirl = swirl ? 1 : 0;
  p.data.flowAway = flowAway ? 1 : 0;
  p.lifetime = 300;
  p.gravity = fall * 1.2 * 0.0025;
  const q = size * (r.nextBoolean() ? 0.05 : 0.075);
  p.quadSize = q;
  setSize(p, q, q);
  p.friction = 1;
  p.yd = -startVel;
  const f = r.nextFloat();
  p.data.xaFlow = Math.cos((f * 60 * Math.PI) / 180) * windBig;
  p.data.zaFlow = Math.sin((f * 60 * Math.PI) / 180) * windBig;
  p.data.swirlPeriod = ((1000 + f * 3000) * Math.PI) / 180;
  randomFrame(p);
}
function fallingTick(p: Particle, sim: Sim) {
  remember(p);
  if (p.lifetime-- <= 0) p.removed = true;
  if (p.removed) return;
  const f = Math.min((300 - p.lifetime) / 300, 1);
  let dx = 0;
  let dz = 0;
  if (p.data.flowAway) {
    dx += p.data.xaFlow! * f ** 1.25;
    dz += p.data.zaFlow! * f ** 1.25;
  }
  if (p.data.swirl) {
    dx += f * Math.cos(f * p.data.swirlPeriod!) * p.data.windBig!;
    dz += f * Math.sin(f * p.data.swirlPeriod!) * p.data.windBig!;
  }
  p.xd += dx * 0.0025;
  p.zd += dz * 0.0025;
  p.yd -= p.gravity;
  p.data.rotSpeed! += p.data.spin! / 20;
  p.oRoll = p.roll;
  p.roll += p.data.rotSpeed! / 20;
  move(p, p.xd, p.yd, p.zd, sim.world);
  if (p.onGround || (p.lifetime < 299 && (p.xd === 0 || p.zd === 0))) p.removed = true;
  if (p.removed) return;
  p.xd *= p.friction;
  p.yd *= p.friction;
  p.zd *= p.friction;
}

function waterDrop(p: Particle, pos: Vec3) {
  moving(p, pos, [0, 0, 0]);
  p.xd *= 0.3;
  p.yd = p.rng.nextFloat() * 0.2 + 0.1;
  p.zd *= 0.3;
  setSize(p, 0.01, 0.01);
  p.gravity = 0.06;
  p.lifetime = Math.trunc(8 / (p.rng.nextFloat() * 0.8 + 0.2));
  randomFrame(p);
}
function waterDropTick(p: Particle, sim: Sim) {
  remember(p);
  if (p.lifetime-- <= 0) {
    p.removed = true;
    return;
  }
  p.yd -= p.gravity;
  move(p, p.xd, p.yd, p.zd, sim.world);
  p.xd *= 0.98;
  p.yd *= 0.98;
  p.zd *= 0.98;
  if (p.onGround) {
    if (p.rng.nextFloat() < 0.5) p.removed = true;
    p.xd *= 0.7;
    p.zd *= 0.7;
  }
  const bx = Math.floor(p.x);
  const by = Math.floor(p.y);
  const bz = Math.floor(p.z);
  const top = Math.max(sim.world.solid?.(bx, by, bz) ? 1 : 0, sim.world.fluid?.(bx, by, bz) ?? 0);
  if (top > 0 && p.y < by + top) p.removed = true;
}

function instantSpell(p: Particle, pos: Vec3, vel: Vec3, o: SpawnOptions) {
  spell(p, pos, vel);
  if (o.color) [p.r, p.g, p.b] = o.color;
  setPower(p, o.value ?? 1);
}

function spell(p: Particle, pos: Vec3, [xa, ya, za]: Vec3) {
  const r = p.rng;
  moving(p, pos, [0.5 - r.nextDouble(), ya, 0.5 - r.nextDouble()]);
  p.data.originalAlpha = 1;
  p.friction = 0.96;
  p.gravity = -0.1;
  p.speedUp = true;
  p.yd *= 0.2;
  if (xa === 0 && za === 0) {
    p.xd *= 0.1;
    p.zd *= 0.1;
  }
  p.quadSize *= 0.75;
  p.lifetime = Math.trunc(8 / (r.nextFloat() * 0.8 + 0.2));
  p.hasPhysics = false;
  fromAge(p);
}
const spellTick = (p: Particle, sim: Sim) => {
  baseTick(p, sim);
  fromAge(p);
  p.a += (p.data.originalAlpha! - p.a) * 0.05;
};

function crit(p: Particle, pos: Vec3, vel: Vec3, sim: Sim) {
  moving(p, pos, [0, 0, 0]);
  p.friction = 0.7;
  p.gravity = 0.5;
  p.xd = p.xd * 0.1 + vel[0] * 0.4;
  p.yd = p.yd * 0.1 + vel[1] * 0.4;
  p.zd = p.zd * 0.1 + vel[2] * 0.4;
  const c = p.rng.nextFloat() * 0.3 + 0.6;
  p.r = p.g = p.b = c;
  p.quadSize *= 0.75;
  p.lifetime = Math.max(Math.trunc(6 / (p.rng.nextFloat() * 0.8 + 0.6)), 1);
  p.hasPhysics = false;
  critTick(p, sim);
}
function critTick(p: Particle, sim: Sim) {
  baseTick(p, sim);
  p.g *= 0.96;
  p.b *= 0.9;
}

function crumb(p: Particle, sprite: string | undefined, type: string) {
  if (!sprite)
    throw new Error(
      `"${type}" particles need opts.sprite, a block or item texture ("block/stone")`,
    );
  p.sprite = sprite;
  const uo = p.rng.nextFloat() * 3;
  const vo = p.rng.nextFloat() * 3;
  p.uv = [(uo + 1) / 4, vo / 4, uo / 4, (vo + 1) / 4];
}

function town(p: Particle, pos: Vec3, vel: Vec3) {
  moving(p, pos, vel);
  const c = p.rng.nextFloat() * 0.1 + 0.2;
  p.r = p.g = p.b = c;
  setSize(p, 0.02, 0.02);
  p.quadSize *= p.rng.nextFloat() * 0.6 + 0.5;
  p.xd *= 0.02;
  p.yd *= 0.02;
  p.zd *= 0.02;
  p.lifetime = Math.trunc(20 / (p.rng.nextFloat() * 0.8 + 0.2));
  randomFrame(p);
}
function townTick(p: Particle) {
  remember(p);
  if (p.lifetime-- <= 0) {
    p.removed = true;
    return;
  }
  glide(p, p.xd, p.yd, p.zd, {});
  p.xd *= 0.99;
  p.yd *= 0.99;
  p.zd *= 0.99;
}

function heart(p: Particle, pos: Vec3) {
  moving(p, pos, [0, 0, 0]);
  p.speedUp = true;
  p.friction = 0.86;
  p.xd *= 0.01;
  p.yd *= 0.01;
  p.zd *= 0.01;
  p.yd += 0.1;
  p.quadSize *= 1.5;
  p.lifetime = 16;
  p.hasPhysics = false;
  randomFrame(p);
}

function campfireSmoke(p: Particle, pos: Vec3, vel: Vec3, signal: boolean) {
  still(p, pos);
  scale(p, 3);
  setSize(p, 0.25, 0.25);
  p.lifetime = signal ? p.rng.nextInt(50) + 280 : p.rng.nextInt(50) + 80;
  p.gravity = 3e-6;
  p.xd = vel[0];
  p.yd = vel[1] + p.rng.nextFloat() / 500;
  p.zd = vel[2];
  p.a = signal ? 0.95 : 0.9;
  randomFrame(p);
}
function campfireSmokeTick(p: Particle, sim: Sim) {
  remember(p);
  if (p.age++ >= p.lifetime || p.a <= 0) {
    p.removed = true;
    return;
  }
  const r = p.rng;
  p.xd += (r.nextFloat() / 5000) * (r.nextBoolean() ? 1 : -1);
  p.zd += (r.nextFloat() / 5000) * (r.nextBoolean() ? 1 : -1);
  p.yd -= p.gravity;
  move(p, p.xd, p.yd, p.zd, sim.world);
  if (p.age >= p.lifetime - 60 && p.a > 0.01) p.a -= 0.015;
}

function sparkTick(p: Particle, sim: Sim) {
  animatedTick(p, sim);
  if (!p.data.trail || p.age >= Math.trunc(p.lifetime / 2) || (p.age + p.lifetime) % 2 !== 0)
    return;
  const child = sim.spawn("firework", [p.x, p.y, p.z], [0, 0, 0]);
  child.a = 0.99;
  child.r = p.r;
  child.g = p.g;
  child.b = p.b;
  child.age = Math.trunc(child.lifetime / 2);
  if (p.data.twinkle !== undefined) child.data.twinkle = p.data.twinkle;
}

export type ParticleType =
  | "poof"
  | "smoke"
  | "large_smoke"
  | "white_smoke"
  | "cloud"
  | "sneeze"
  | "explosion"
  | "explosion_emitter"
  | "flame"
  | "small_flame"
  | "soul_fire_flame"
  | "copper_fire_flame"
  | "lava"
  | "heart"
  | "angry_villager"
  | "happy_villager"
  | "composter"
  | "crit"
  | "enchanted_hit"
  | "damage_indicator"
  | "sweep_attack"
  | "block"
  | "item"
  | "splash"
  | "rain"
  | "bubble"
  | "bubble_pop"
  | "note"
  | "portal"
  | "effect"
  | "instant_effect"
  | "entity_effect"
  | "witch"
  | "totem_of_undying"
  | "end_rod"
  | "firework"
  | "flash"
  | "dust"
  | "snowflake"
  | "campfire_cosy_smoke"
  | "campfire_signal_smoke"
  | "cherry_leaves"
  | "tinted_leaves"
  | "pale_oak_leaves"
  | "emitter";

const clampAge = (p: Particle, pt: number) => Math.min(1, Math.max(0, (p.age + pt) / p.lifetime));
const ageOnly = (p: Particle) => {
  remember(p);
  if (p.age++ >= p.lifetime) p.removed = true;
  else fromAge(p);
};

const RECIPES: Record<ParticleType, Recipe> = {
  poof: {
    set: "poof",
    layer: "opaque",
    init: (p, pos, vel) => {
      still(p, pos);
      p.gravity = -0.1;
      p.friction = 0.9;
      const r = p.rng;
      p.xd = vel[0] + (r.nextFloat() * 2 - 1) * 0.05;
      p.yd = vel[1] + (r.nextFloat() * 2 - 1) * 0.05;
      p.zd = vel[2] + (r.nextFloat() * 2 - 1) * 0.05;
      const c = r.nextFloat() * 0.3 + 0.7;
      p.r = p.g = p.b = c;
      p.quadSize = 0.1 * (r.nextFloat() * r.nextFloat() * 6 + 1);
      p.lifetime = Math.trunc(16 / (r.nextFloat() * 0.8 + 0.2)) + 2;
      fromAge(p);
    },
    tick: smokeTick,
  },
  smoke: {
    set: "smoke",
    layer: "opaque",
    init: (p, pos, vel) => ashSmoke(p, pos, vel, 0.1, 1, 0.3, 8, -0.1, true),
    tick: smokeTick,
    size: ramp32,
  },
  large_smoke: {
    set: "large_smoke",
    layer: "opaque",
    init: (p, pos, vel) => ashSmoke(p, pos, vel, 0.1, 2.5, 0.3, 8, -0.1, true),
    tick: smokeTick,
    size: ramp32,
  },
  white_smoke: {
    set: "white_smoke",
    layer: "opaque",
    init: (p, pos, vel) => {
      ashSmoke(p, pos, vel, 0.1, 1, 0.3, 8, -0.1, true);
      [p.r, p.g, p.b] = [0.7294118, 0.69411767, 0.7607843];
    },
    tick: smokeTick,
    size: ramp32,
  },
  cloud: {
    set: "cloud",
    layer: "translucent",
    init: (p, pos, vel) => {
      moving(p, pos, [0, 0, 0]);
      p.friction = 0.96;
      p.xd = p.xd * 0.1 + vel[0];
      p.yd = p.yd * 0.1 + vel[1];
      p.zd = p.zd * 0.1 + vel[2];
      const c = 1 - p.rng.nextFloat() * 0.3;
      p.r = p.g = p.b = c;
      p.quadSize *= 1.875;
      p.lifetime = Math.max(Math.trunc(Math.trunc(8 / (p.rng.nextFloat() * 0.8 + 0.3)) * 2.5), 1);
      p.hasPhysics = false;
      fromAge(p);
    },
    tick: smokeTick,
    size: ramp32,
  },
  sneeze: {
    set: "sneeze",
    layer: "translucent",
    init: (p, pos, vel, o, sim) => {
      RECIPES.cloud.init(p, pos, vel, o, sim);
      [p.r, p.g, p.b] = [0.22, 1, 0.53];
      p.a = 0.4;
    },
    tick: smokeTick,
    size: ramp32,
  },
  explosion: {
    set: "explosion",
    layer: "opaque",
    init: (p, pos, vel) => {
      still(p, pos);
      p.lifetime = 6 + p.rng.nextInt(4);
      const c = p.rng.nextFloat() * 0.6 + 0.4;
      p.r = p.g = p.b = c;
      p.quadSize = 2 * (1 - vel[0] * 0.5);
      fromAge(p);
    },
    tick: ageOnly,
    glow: () => 1,
  },
  explosion_emitter: {
    layer: "none",
    init: (p, pos) => {
      base(p, pos);
      p.lifetime = 8;
    },
    tick: (p, sim) => {
      const r = p.rng;
      for (let i = 0; i < 6; i++) {
        const at: Vec3 = [
          p.x + (r.nextDouble() - r.nextDouble()) * 4,
          p.y + (r.nextDouble() - r.nextDouble()) * 4,
          p.z + (r.nextDouble() - r.nextDouble()) * 4,
        ];
        sim.spawn("explosion", at, [p.age / p.lifetime, 0, 0]);
      }
      if (++p.age === p.lifetime) p.removed = true;
    },
  },
  flame,
  small_flame: {
    ...flame,
    init: (p, pos, vel, o, sim) => {
      flame.init(p, pos, vel, o, sim);
      scale(p, 0.5);
    },
  },
  soul_fire_flame: { ...flame, set: "soul_fire_flame" },
  copper_fire_flame: { ...flame, set: "copper_fire_flame" },
  lava: {
    set: "lava",
    layer: "opaque",
    init: (p, pos) => {
      moving(p, pos, [0, 0, 0]);
      p.gravity = 0.75;
      p.friction = 0.999;
      p.xd *= 0.8;
      p.yd = p.rng.nextFloat() * 0.4 + 0.05;
      p.zd *= 0.8;
      p.quadSize *= p.rng.nextFloat() * 2 + 0.2;
      p.lifetime = Math.trunc(16 / (p.rng.nextFloat() * 0.8 + 0.2));
      randomFrame(p);
    },
    tick: (p, sim) => {
      baseTick(p, sim);
      if (!p.removed && p.rng.nextFloat() > p.age / p.lifetime)
        sim.spawn("smoke", [p.x, p.y, p.z], [p.xd, p.yd, p.zd]);
    },
    size: (p, pt) => {
      const f = (p.age + pt) / p.lifetime;
      return p.quadSize * (1 - f * f);
    },
    glow: () => 1,
  },
  heart: { set: "heart", layer: "opaque", init: (p, pos) => heart(p, pos), size: ramp32 },
  angry_villager: {
    set: "angry_villager",
    layer: "opaque",
    init: (p, [x, y, z]) => heart(p, [x, y + 0.5, z]),
    size: ramp32,
  },
  happy_villager: {
    set: "happy_villager",
    layer: "opaque",
    init: (p, pos, vel) => {
      town(p, pos, vel);
      p.r = p.g = p.b = 1;
    },
    tick: townTick,
  },
  composter: {
    set: "composter",
    layer: "opaque",
    init: (p, pos, vel) => {
      town(p, pos, vel);
      p.r = p.g = p.b = 1;
      p.lifetime = 3 + p.rng.nextInt(5);
    },
    tick: townTick,
  },
  crit: {
    set: "crit",
    layer: "opaque",
    init: (p, pos, vel, _o, sim) => crit(p, pos, vel, sim),
    tick: critTick,
    size: ramp32,
  },
  enchanted_hit: {
    set: "enchanted_hit",
    layer: "opaque",
    init: (p, pos, vel, _o, sim) => {
      crit(p, pos, vel, sim);
      p.r *= 0.3;
      p.g *= 0.8;
    },
    tick: critTick,
    size: ramp32,
  },
  damage_indicator: {
    set: "damage_indicator",
    layer: "opaque",
    init: (p, pos, [xa, ya, za], _o, sim) => {
      crit(p, pos, [xa, ya + 1, za], sim);
      p.lifetime = 20;
    },
    tick: critTick,
    size: ramp32,
  },
  sweep_attack: {
    set: "sweep_attack",
    layer: "opaque",
    init: (p, pos, vel) => {
      still(p, pos);
      p.lifetime = 4;
      const c = p.rng.nextFloat() * 0.6 + 0.4;
      p.r = p.g = p.b = c;
      p.quadSize = 1 - vel[0] * 0.5;
      fromAge(p);
    },
    tick: ageOnly,
    glow: () => 1,
  },
  block: {
    layer: "opaque",
    init: (p, pos, vel, o) => {
      moving(p, pos, vel);
      p.gravity = 1;
      const t = o.color ?? [1, 1, 1];
      [p.r, p.g, p.b] = [0.6 * t[0], 0.6 * t[1], 0.6 * t[2]];
      p.quadSize /= 2;
      crumb(p, o.sprite, "block");
    },
  },
  item: {
    layer: "opaque",
    init: (p, pos, vel, o) => {
      moving(p, pos, [0, 0, 0]);
      p.xd = p.xd * 0.1 + vel[0];
      p.yd = p.yd * 0.1 + vel[1];
      p.zd = p.zd * 0.1 + vel[2];
      p.gravity = 1;
      p.quadSize /= 2;
      crumb(p, o.sprite, "item");
    },
  },
  splash: {
    set: "splash",
    layer: "opaque",
    init: (p, pos, [xa, ya, za]) => {
      waterDrop(p, pos);
      p.gravity = 0.04;
      if (ya === 0 && (xa !== 0 || za !== 0)) {
        p.xd = xa;
        p.yd = 0.1;
        p.zd = za;
      }
    },
    tick: waterDropTick,
  },
  rain: { set: "rain", layer: "opaque", init: (p, pos) => waterDrop(p, pos), tick: waterDropTick },
  bubble: {
    set: "bubble",
    layer: "opaque",
    init: (p, pos, [xa, ya, za]) => {
      moving(p, pos, [xa, ya, za]);
      setSize(p, 0.02, 0.02);
      const r = p.rng;
      p.quadSize *= r.nextFloat() * 0.6 + 0.2;
      p.xd = xa * 0.2 + (r.nextFloat() * 2 - 1) * 0.02;
      p.yd = ya * 0.2 + (r.nextFloat() * 2 - 1) * 0.02;
      p.zd = za * 0.2 + (r.nextFloat() * 2 - 1) * 0.02;
      p.lifetime = Math.trunc(8 / (r.nextFloat() * 0.8 + 0.2));
      randomFrame(p);
    },
    tick: (p, sim) => {
      remember(p);
      if (p.lifetime-- <= 0) {
        p.removed = true;
        return;
      }
      p.yd += 0.002;
      move(p, p.xd, p.yd, p.zd, sim.world);
      p.xd *= 0.85;
      p.yd *= 0.85;
      p.zd *= 0.85;
      const { fluid } = sim.world;
      if (fluid && !(fluid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) > 0))
        p.removed = true;
    },
  },
  bubble_pop: {
    set: "bubble_pop",
    layer: "opaque",
    init: (p, pos, vel) => {
      still(p, pos);
      p.lifetime = 4;
      p.gravity = 0.008;
      [p.xd, p.yd, p.zd] = vel;
      fromAge(p);
    },
    tick: (p, sim) => {
      remember(p);
      if (p.age++ >= p.lifetime) {
        p.removed = true;
        return;
      }
      p.yd -= p.gravity;
      move(p, p.xd, p.yd, p.zd, sim.world);
      fromAge(p);
    },
  },
  note: {
    set: "note",
    layer: "opaque",
    init: (p, pos, _vel, o) => {
      moving(p, pos, [0, 0, 0]);
      p.friction = 0.66;
      p.speedUp = true;
      p.xd *= 0.01;
      p.yd *= 0.01;
      p.zd *= 0.01;
      p.yd += 0.2;
      const c = o.value ?? 0;
      const hue = (k: number) => Math.max(0, Math.sin((c + k) * Math.PI * 2) * 0.65 + 0.35);
      [p.r, p.g, p.b] = [hue(0), hue(1 / 3), hue(2 / 3)];
      p.quadSize *= 1.5;
      p.lifetime = 6;
      randomFrame(p);
    },
    size: ramp32,
  },
  portal: {
    set: "portal",
    layer: "opaque",
    init: (p, pos, vel) => {
      still(p, pos);
      [p.xd, p.yd, p.zd] = vel;
      p.data.xStart = p.x;
      p.data.yStart = p.y;
      p.data.zStart = p.z;
      const r = p.rng;
      p.quadSize = 0.1 * (r.nextFloat() * 0.2 + 0.5);
      const f = r.nextFloat() * 0.6 + 0.4;
      [p.r, p.g, p.b] = [f * 0.9, f * 0.3, f];
      p.lifetime = Math.trunc(r.nextFloat() * 10) + 40;
      randomFrame(p);
    },
    tick: (p) => {
      remember(p);
      if (p.age++ >= p.lifetime) {
        p.removed = true;
        return;
      }
      const f = p.age / p.lifetime;
      const f2 = 1 - (-f + f * f * 2);
      p.x = p.data.xStart! + p.xd * f2;
      p.y = p.data.yStart! + p.yd * f2 + (1 - f);
      p.z = p.data.zStart! + p.zd * f2;
    },
    size: (p, pt) => {
      const f = 1 - (p.age + pt) / p.lifetime;
      return p.quadSize * (1 - f * f);
    },
    glow: (p) => clampAge(p, 0) ** 4,
  },
  effect: { set: "effect", layer: "translucent", init: instantSpell, tick: spellTick },
  instant_effect: {
    set: "instant_effect",
    layer: "translucent",
    init: instantSpell,
    tick: spellTick,
  },
  entity_effect: {
    set: "entity_effect",
    layer: "translucent",
    init: (p, pos, vel, o) => {
      spell(p, pos, vel);
      if (o.color) [p.r, p.g, p.b] = o.color;
      p.a = p.data.originalAlpha = o.value ?? 1;
    },
    tick: spellTick,
  },
  witch: {
    set: "witch",
    layer: "translucent",
    init: (p, pos, vel) => {
      spell(p, pos, vel);
      const f = p.rng.nextFloat() * 0.5 + 0.35;
      [p.r, p.g, p.b] = [f, 0, f];
    },
    tick: spellTick,
  },
  totem_of_undying: {
    set: "totem_of_undying",
    layer: "translucent",
    init: (p, pos, vel) => {
      animated(p, pos, 1.25);
      p.friction = 0.6;
      [p.xd, p.yd, p.zd] = vel;
      p.quadSize *= 0.75;
      p.lifetime = 60 + p.rng.nextInt(12);
      fromAge(p);
      const r = p.rng;
      if (r.nextInt(4) === 0)
        [p.r, p.g, p.b] = [
          0.6 + r.nextFloat() * 0.2,
          0.6 + r.nextFloat() * 0.3,
          r.nextFloat() * 0.2,
        ];
      else
        [p.r, p.g, p.b] = [
          0.1 + r.nextFloat() * 0.2,
          0.4 + r.nextFloat() * 0.3,
          r.nextFloat() * 0.2,
        ];
    },
    tick: (p, sim) => animatedTick(p, sim),
    glow: () => 1,
  },
  end_rod: {
    set: "end_rod",
    layer: "translucent",
    init: (p, pos, vel) => {
      animated(p, pos, 0.0125);
      [p.xd, p.yd, p.zd] = vel;
      p.quadSize *= 0.75;
      p.lifetime = 60 + p.rng.nextInt(12);
      setFade(p, 0xf2e0c9);
      fromAge(p);
    },
    tick: (p, sim) => animatedTick(p, sim, glide),
    glow: () => 1,
  },
  firework: {
    set: "firework",
    layer: "translucent",
    init: (p, pos, vel) => {
      animated(p, pos, 0.1);
      [p.xd, p.yd, p.zd] = vel;
      p.quadSize *= 0.75;
      p.lifetime = 48 + p.rng.nextInt(12);
      p.a = 0.99;
      fromAge(p);
    },
    tick: sparkTick,
    glow: () => 1,
    visible: (p) =>
      !p.data.twinkle ||
      p.age < Math.trunc(p.lifetime / 3) ||
      Math.trunc((p.age + p.lifetime) / 3) % 2 === 0,
  },
  flash: {
    set: "flash",
    layer: "translucent",
    init: (p, pos, _vel, o) => {
      still(p, pos);
      p.lifetime = 4;
      if (o.color) [p.r, p.g, p.b] = o.color;
    },
    size: (p, pt) => 7.1 * Math.sin((p.age + pt - 1) * 0.25 * Math.PI),
    alpha: (p, pt) => 0.6 - (p.age + pt - 1) * 0.25 * 0.5,
  },
  dust: {
    set: "dust",
    layer: "opaque",
    init: (p, pos, vel, o) => {
      moving(p, pos, vel);
      p.friction = 0.96;
      p.speedUp = true;
      p.xd *= 0.1;
      p.yd *= 0.1;
      p.zd *= 0.1;
      const s = o.value ?? 1;
      p.quadSize *= 0.75 * s;
      p.lifetime = Math.trunc(Math.max(Math.trunc(8 / (p.rng.nextDouble() * 0.8 + 0.2)) * s, 1));
      const f = p.rng.nextFloat() * 0.4 + 0.6;
      const [cr, cg, cb] = o.color ?? [1, 0, 0];
      const vary = (c: number) => (p.rng.nextFloat() * 0.2 + 0.8) * c * f;
      [p.r, p.g, p.b] = [vary(cr), vary(cg), vary(cb)];
      fromAge(p);
    },
    tick: smokeTick,
    size: ramp32,
  },
  snowflake: {
    set: "snowflake",
    layer: "opaque",
    init: (p, pos, vel) => {
      still(p, pos);
      p.gravity = 0.225;
      p.friction = 1;
      const r = p.rng;
      p.xd = vel[0] + (r.nextFloat() * 2 - 1) * 0.05;
      p.yd = vel[1] + (r.nextFloat() * 2 - 1) * 0.05;
      p.zd = vel[2] + (r.nextFloat() * 2 - 1) * 0.05;
      p.quadSize = 0.1 * (r.nextFloat() * r.nextFloat() + 1);
      p.lifetime = Math.trunc(16 / (r.nextFloat() * 0.8 + 0.2)) + 2;
      [p.r, p.g, p.b] = [0.923, 0.964, 0.999];
      fromAge(p);
    },
    tick: (p, sim) => {
      smokeTick(p, sim);
      p.xd *= 0.95;
      p.yd *= 0.9;
      p.zd *= 0.95;
    },
  },
  campfire_cosy_smoke: {
    set: "campfire_cosy_smoke",
    layer: "translucent",
    init: (p, pos, vel) => campfireSmoke(p, pos, vel, false),
    tick: campfireSmokeTick,
  },
  campfire_signal_smoke: {
    set: "campfire_signal_smoke",
    layer: "translucent",
    init: (p, pos, vel) => campfireSmoke(p, pos, vel, true),
    tick: campfireSmokeTick,
  },
  cherry_leaves: {
    set: "cherry_leaves",
    layer: "opaque",
    init: (p, pos) => falling(p, pos, 0.25, 2, false, true, 1, 0),
    tick: fallingTick,
  },
  tinted_leaves: {
    set: "tinted_leaves",
    layer: "opaque",
    init: (p, pos, _vel, o) => {
      falling(p, pos, 0.07, 10, true, false, 2, 0.021);
      if (o.color) [p.r, p.g, p.b] = o.color;
    },
    tick: fallingTick,
  },
  pale_oak_leaves: {
    set: "pale_oak_leaves",
    layer: "opaque",
    init: (p, pos) => falling(p, pos, 0.07, 10, true, false, 2, 0.021),
    tick: fallingTick,
  },
  emitter: {
    layer: "none",
    init: (p, pos) => {
      base(p, pos);
      p.lifetime = Infinity;
    },
    tick: (p, sim) => {
      p.emit?.(p, sim);
      if (++p.age >= p.lifetime) p.removed = true;
    },
  },
};

export const PARTICLE_TYPES = Object.keys(RECIPES).filter((t) => t !== "emitter") as ParticleType[];

export const particleSet = (type: ParticleType): string | undefined => RECIPES[type].set;

export interface EntityBox {
  pos: Vec3;
  width: number;
  height: number;
  velocity?: Vec3;
}

export const MOB_SIZES: Record<string, readonly [number, number]> = {
  player: [0.6, 1.8],
  zombie: [0.6, 1.95],
  skeleton: [0.6, 1.99],
  creeper: [0.6, 1.7],
  spider: [1.4, 0.9],
  cave_spider: [0.7, 0.5],
  enderman: [0.6, 2.9],
  cow: [0.9, 1.4],
  pig: [0.9, 0.9],
  sheep: [0.9, 1.3],
  chicken: [0.4, 0.7],
  villager: [0.6, 1.95],
  iron_golem: [1.4, 2.7],
  horse: [1.3964844, 1.6],
  wolf: [0.6, 0.85],
  cat: [0.6, 0.7],
  slime: [0.52, 0.52],
  witch: [0.6, 1.95],
  pillager: [0.6, 1.95],
  husk: [0.6, 1.95],
  drowned: [0.6, 1.95],
  zombie_villager: [0.6, 1.95],
  wither_skeleton: [0.7, 2.4],
  piglin: [0.6, 1.95],
  blaze: [0.6, 1.8],
  ghast: [4, 4],
  warden: [0.9, 2.9],
  fox: [0.6, 0.7],
  rabbit: [0.49, 0.6],
  bee: [0.55, 0.5],
  axolotl: [0.75, 0.42],
  goat: [0.9, 1.3],
  camel: [1.7, 2.375],
  sniffer: [1.9, 1.75],
  allay: [0.35, 0.6],
  armadillo: [0.7, 0.65],
  breeze: [0.6, 1.77],
  parrot: [0.5, 0.9],
  llama: [0.9, 1.87],
  panda: [1.3, 1.25],
  polar_bear: [1.4, 1.4],
  dolphin: [0.9, 0.6],
  squid: [0.8, 0.8],
  turtle: [1.2, 0.4],
  frog: [0.5, 0.5],
  hoglin: [1.3964844, 1.4],
  ravager: [1.95, 2.2],
  vindicator: [0.6, 1.95],
  evoker: [0.6, 1.95],
  phantom: [0.9, 0.5],
  wandering_trader: [0.6, 1.95],
  stray: [0.6, 1.99],
  zombified_piglin: [0.6, 1.95],
  magma_cube: [0.52, 0.52],
  snow_golem: [0.7, 1.9],
  mooshroom: [0.9, 1.4],
  donkey: [1.3964844, 1.5],
  ocelot: [0.6, 0.7],
  bat: [0.5, 0.9],
  cod: [0.5, 0.3],
  salmon: [0.7, 0.4],
  tropical_fish: [0.5, 0.4],
  glow_squid: [0.8, 0.8],
  strider: [0.9, 1.7],
  endermite: [0.4, 0.3],
  silverfish: [0.4, 0.3],
  guardian: [0.85, 0.85],
  shulker: [1, 1],
  vex: [0.4, 0.8],
  wither: [0.9, 3.5],
  ender_dragon: [16, 8],
};

export const mob = (name: string, pos: Vec3, velocity?: Vec3): EntityBox => {
  const size = MOB_SIZES[name];
  if (!size) throw new Error(`mob(): no size for "${name}"; pass { pos, width, height } yourself`);
  return { pos, width: size[0], height: size[1], velocity };
};

export const FIREWORK_COLORS = {
  white: 0xf0f0f0,
  orange: 0xeb8844,
  magenta: 0xc354cd,
  light_blue: 0x6689d3,
  yellow: 0xdecf2a,
  lime: 0x41cd34,
  pink: 0xd88198,
  gray: 0x434343,
  light_gray: 0xababab,
  cyan: 0x287697,
  purple: 0x7b2fbe,
  blue: 0x253192,
  brown: 0x51301a,
  green: 0x3b511a,
  red: 0xb3312c,
  black: 0x1e1b1b,
} as const;

export interface FireworkExplosion {
  shape: "small_ball" | "large_ball" | "star" | "creeper" | "burst";
  colors: readonly number[];
  fadeColors?: readonly number[];
  trail?: boolean;
  twinkle?: boolean;
}

export type BlockFace = "down" | "up" | "north" | "south" | "west" | "east";

export function animateTickChance([dx, dy, dz]: Vec3): number {
  const p = (r: number, d: number) => Math.max(0, r - Math.abs(Math.round(d))) / (r * r);
  return 667 * (p(16, dx) * p(16, dy) * p(16, dz) + p(32, dx) * p(32, dy) * p(32, dz));
}
const TORCH_CHANCE = animateTickChance([4, 0, 0]);

const STAR: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0.3455, 0.309],
  [0.9511, 0.309],
  [0.3795918367346939, -0.12653061224489795],
  [0.6122448979591837, -0.8040816326530612],
  [0, -0.35918367346938773],
];
const CREEPER: ReadonlyArray<readonly [number, number]> = [
  [0, 0.2],
  [0.2, 0.2],
  [0.2, 0.6],
  [0.6, 0.6],
  [0.6, 0.2],
  [0.2, 0.2],
  [0.2, 0],
  [0.4, 0],
  [0.4, -0.6],
  [0.2, -0.6],
  [0.2, -0.4],
  [0, -0.4],
];

const rgb01 = (c: number): Rgb => [
  ((c >> 16) & 255) / 255,
  ((c >> 8) & 255) / 255,
  (c & 255) / 255,
];

function createFireworks(sim: Sim, pos: Vec3, vel: Vec3, explosions: readonly FireworkExplosion[]) {
  if (!explosions.length) {
    for (let i = 0; i < sim.rng.nextInt(3) + 2; i++)
      sim.spawn("poof", pos, [sim.rng.nextGaussian() * 0.05, 0.005, sim.rng.nextGaussian() * 0.05]);
    return;
  }
  const starter = sim.spawn("emitter", pos);
  [starter.xd, starter.yd, starter.zd] = vel;
  starter.lifetime = explosions.length * 2 - 1 + (explosions.some((e) => e.twinkle) ? 15 : 0);
  starter.emit = (s, sim2) => {
    const life = s.age;
    if (life % 2 !== 0 || life / 2 >= explosions.length) return;
    const e = explosions[life / 2]!;
    const colors = e.colors.length ? e.colors : [FIREWORK_COLORS.black];
    const fades = e.fadeColors ?? [];
    const r = s.rng;
    const one = (xa: number, ya: number, za: number) => {
      const spark = sim2.spawn("firework", [s.x, s.y, s.z], [xa, ya, za]);
      if (e.trail) spark.data.trail = 1;
      if (e.twinkle) spark.data.twinkle = 1;
      spark.a = 0.99;
      setRgb(spark, colors[r.nextInt(colors.length)]!);
      if (fades.length) setFade(spark, fades[r.nextInt(fades.length)]!);
    };
    const ball = (speed: number, size: number) => {
      for (let i = -size; i <= size; i++)
        for (let j = -size; j <= size; j++)
          for (let k = -size; k <= size; k++) {
            const x = j + (r.nextDouble() - r.nextDouble()) * 0.5;
            const y = i + (r.nextDouble() - r.nextDouble()) * 0.5;
            const z = k + (r.nextDouble() - r.nextDouble()) * 0.5;
            const len = Math.hypot(x, y, z) / speed + r.nextGaussian() * 0.05;
            one(x / len, y / len, z / len);
            if (i !== -size && i !== size && j !== -size && j !== size) k += size * 2 - 1;
          }
    };
    const shape = (
      speed: number,
      coords: ReadonlyArray<readonly [number, number]>,
      creeper: boolean,
    ) => {
      const [x0, y0] = coords[0]!;
      one(x0 * speed, y0 * speed, 0);
      const turn = r.nextFloat() * Math.PI;
      const step = creeper ? 0.034 : 0.34;
      for (let i = 0; i < 3; i++) {
        const angle = turn + i * Math.PI * step;
        let [px, py] = [x0, y0];
        for (let j = 1; j < coords.length; j++) {
          const [cx, cy] = coords[j]!;
          for (let t = 0.25; t <= 1; t += 0.25) {
            let dx = (px + (cx - px) * t) * speed;
            const dy = (py + (cy - py) * t) * speed;
            const dz = dx * Math.sin(angle);
            dx *= Math.cos(angle);
            for (let k = -1; k <= 1; k += 2) one(dx * k, dy, dz * k);
          }
          [px, py] = [cx, cy];
        }
      }
    };
    const burst = () => {
      const ox = r.nextGaussian() * 0.05;
      const oz = r.nextGaussian() * 0.05;
      for (let i = 0; i < 70; i++)
        one(
          s.xd * 0.5 + r.nextGaussian() * 0.15 + ox,
          s.yd * 0.5 + r.nextDouble() * 0.5,
          s.zd * 0.5 + r.nextGaussian() * 0.15 + oz,
        );
    };
    if (e.shape === "small_ball") ball(0.25, 2);
    else if (e.shape === "large_ball") ball(0.5, 4);
    else if (e.shape === "star") shape(0.5, STAR, false);
    else if (e.shape === "creeper") shape(0.5, CREEPER, true);
    else burst();
    sim2.spawn("flash", [s.x, s.y, s.z], [0, 0, 0], { color: rgb01(colors[0]!) });
  };
}

function tracking(sim: Sim, e: EntityBox, type: ParticleType, ticks: number) {
  const p = sim.spawn("emitter", e.pos);
  p.lifetime = ticks;
  const [vx, vy, vz] = e.velocity ?? [0, 0, 0];
  p.emit = (s, sim2) => {
    const r = s.rng;
    for (let i = 0; i < 16; i++) {
      const x = r.nextFloat() * 2 - 1;
      const y = r.nextFloat() * 2 - 1;
      const z = r.nextFloat() * 2 - 1;
      if (x * x + y * y + z * z > 1) continue;
      const pos: Vec3 = [
        e.pos[0] + vx * s.age + (x * e.width) / 4,
        e.pos[1] + vy * s.age + e.height * (0.5 + y / 4),
        e.pos[2] + vz * s.age + (z * e.width) / 4,
      ];
      sim2.spawn(type, pos, [x, y + 0.2, z]);
    }
  };
  p.emit(p, sim);
  p.age++;
}

const randomX = (r: Rng, e: EntityBox) => e.pos[0] + e.width * (2 * r.nextDouble() - 1);
const randomY = (r: Rng, e: EntityBox) => e.pos[1] + e.height * r.nextDouble();
const randomZ = (r: Rng, e: EntityBox) => e.pos[2] + e.width * (2 * r.nextDouble() - 1);

function every(
  sim: Sim,
  pos: Vec3,
  ticks: number,
  each: (sim: Sim, tick: number, rng: Rng) => void,
) {
  const p = sim.spawn("emitter", pos);
  p.lifetime = ticks;
  p.emit = (s, sim2) => each(sim2, s.age, s.rng);
}

const DIRS: Record<BlockFace, Vec3> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

export const PARTICLE_EVENTS = {
  blockBreak(sim: Sim, sprite: string, [x, y, z]: Vec3, tint?: Rgb) {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++) {
          const [a, b, c] = [(i + 0.5) / 4, (j + 0.5) / 4, (k + 0.5) / 4];
          sim.spawn("block", [x + a, y + b, z + c], [a - 0.5, b - 0.5, c - 0.5], {
            sprite,
            color: tint,
          });
        }
  },
  blockCrack(
    sim: Sim,
    sprite: string,
    [x, y, z]: Vec3,
    face: BlockFace,
    ticks: number,
    tint?: Rgb,
  ) {
    every(sim, [x, y, z], ticks, (s, _tick, r) => {
      const at = [
        x + r.nextDouble() * 0.8 + 0.1,
        y + r.nextDouble() * 0.8 + 0.1,
        z + r.nextDouble() * 0.8 + 0.1,
      ];
      const d = DIRS[face];
      for (let a = 0; a < 3; a++) if (d[a]) at[a] = [x, y, z][a]! + (d[a]! > 0 ? 1.1 : -0.1);
      const p = s.spawn("block", at as unknown as Vec3, [0, 0, 0], { sprite, color: tint });
      setPower(p, 0.2);
      scale(p, 0.6);
    });
  },
  mobDeath(sim: Sim, e: EntityBox) {
    const r = sim.rng;
    for (let i = 0; i < 20; i++) {
      const [d0, d1, d2] = [
        r.nextGaussian() * 0.02,
        r.nextGaussian() * 0.02,
        r.nextGaussian() * 0.02,
      ];
      sim.spawn(
        "poof",
        [randomX(r, e) - d0 * 10, randomY(r, e) - d1 * 10, randomZ(r, e) - d2 * 10],
        [d0, d1, d2],
      );
    }
  },
  explosion(sim: Sim, center: Vec3, radius: number, blockCount: number, breaksBlocks: boolean) {
    sim.spawn(radius < 2 || !breaksBlocks ? "explosion" : "explosion_emitter", center, [1, 0, 0]);
    if (!breaksBlocks) return;
    const r = sim.rng;
    const solid = sim.world.solid;
    for (let n = 0; n < Math.min(blockCount, 512); n++) {
      const d = [r.nextFloat() * 2 - 1, r.nextFloat() * 2 - 1, r.nextFloat() * 2 - 1];
      const len = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
      const dir = d.map((v) => v / len) as unknown as Vec3;
      const dist = Math.cbrt(r.nextFloat()) * radius;
      const off = dir.map((v) => v * dist) as unknown as Vec3;
      const at = [center[0] + off[0], center[1] + off[1], center[2] + off[2]];
      if (solid?.(Math.floor(at[0]!), Math.floor(at[1]!), Math.floor(at[2]!))) continue;
      const speed = (0.5 / (dist / radius + 0.1)) * r.nextFloat() * r.nextFloat() + 0.3;
      const [type, scaling] =
        r.nextInt(2) === 0 ? (["poof", 0.5] as const) : (["smoke", 1] as const);
      sim.spawn(
        type,
        [center[0] + off[0] * scaling, center[1] + off[1] * scaling, center[2] + off[2] * scaling],
        [dir[0] * speed, dir[1] * speed, dir[2] * speed],
      );
    }
  },
  hearts(sim: Sim, e: EntityBox) {
    const r = sim.rng;
    for (let i = 0; i < 7; i++) {
      const v: Vec3 = [r.nextGaussian() * 0.02, r.nextGaussian() * 0.02, r.nextGaussian() * 0.02];
      sim.spawn("heart", [randomX(r, e), randomY(r, e) + 0.5, randomZ(r, e)], v);
    }
  },
  villager(sim: Sim, e: EntityBox, mood: "angry" | "happy") {
    const r = sim.rng;
    for (let i = 0; i < 5; i++) {
      const v: Vec3 = [r.nextGaussian() * 0.02, r.nextGaussian() * 0.02, r.nextGaussian() * 0.02];
      sim.spawn(
        mood === "angry" ? "angry_villager" : "happy_villager",
        [randomX(r, e), randomY(r, e) + 1, randomZ(r, e)],
        v,
      );
    }
  },
  crit(sim: Sim, e: EntityBox, magic = false) {
    tracking(sim, e, magic ? "enchanted_hit" : "crit", 3);
  },
  damage(sim: Sim, e: EntityBox, amount: number) {
    if (!(amount > 2)) return;
    const r = sim.rng;
    const y = e.pos[1] + e.height * 0.5;
    for (let i = 0; i < Math.trunc(amount * 0.5); i++) {
      const at: Vec3 = [e.pos[0] + r.nextGaussian() * 0.1, y, e.pos[2] + r.nextGaussian() * 0.1];
      sim.spawn("damage_indicator", at, [
        r.nextGaussian() * 0.2,
        r.nextGaussian() * 0.2,
        r.nextGaussian() * 0.2,
      ]);
    }
  },
  totem(sim: Sim, e: EntityBox) {
    tracking(sim, e, "totem_of_undying", 30);
  },
  waterSplash(sim: Sim, e: EntityBox, surface: number) {
    const r = sim.rng;
    const w = Math.fround(e.width);
    const limit = Math.fround(1 + Math.fround(w * 20));
    const [vx, vy, vz] = e.velocity ?? [0, 0, 0];
    for (let j = 0; j < limit; j++) {
      const at: Vec3 = [
        e.pos[0] + (r.nextFloat() * 2 - 1) * w,
        surface,
        e.pos[2] + (r.nextFloat() * 2 - 1) * w,
      ];
      sim.spawn("bubble", at, [vx, vy - r.nextFloat() * 0.2, vz]);
    }
    for (let j = 0; j < limit; j++) {
      const at: Vec3 = [
        e.pos[0] + (r.nextFloat() * 2 - 1) * w,
        surface,
        e.pos[2] + (r.nextFloat() * 2 - 1) * w,
      ];
      sim.spawn("splash", at, [vx, vy, vz]);
    }
  },
  firework(
    sim: Sim,
    pos: Vec3,
    explosions: readonly FireworkExplosion[],
    velocity: Vec3 = [0, 0, 0],
  ) {
    createFireworks(sim, pos, velocity, explosions);
  },
  rocket(sim: Sim, pos: Vec3, explosions: readonly FireworkExplosion[], flight = 1) {
    const r = sim.rng;
    const triangle = () => 0.002297 * (r.nextDouble() - r.nextDouble());
    const v = [triangle(), 0.05, triangle()];
    const at = [...pos];
    const lifetime = 10 * (1 + flight) + r.nextInt(6) + r.nextInt(7);
    let life = 0;
    const p = sim.spawn("emitter", pos);
    p.emit = (s, sim2) => {
      v[0] *= 1.15;
      v[2] *= 1.15;
      v[1]! += 0.04;
      for (let a = 0; a < 3; a++) at[a]! += v[a]!;
      life++;
      sim2.spawn("firework", at as unknown as Vec3, [
        s.rng.nextGaussian() * 0.05,
        -v[1]! * 0.5,
        s.rng.nextGaussian() * 0.05,
      ]);
      if (life > lifetime) {
        createFireworks(sim2, at as unknown as Vec3, v as unknown as Vec3, explosions);
        s.lifetime = s.age + 1;
      }
    };
  },
  torch(
    sim: Sim,
    [x, y, z]: Vec3,
    ticks: number,
    o: { facing?: "north" | "south" | "west" | "east"; flame?: ParticleType; chance?: number } = {},
  ) {
    const back = o.facing ? DIRS[o.facing] : [0, 0, 0];
    const at: Vec3 = o.facing
      ? [x + 0.5 - 0.27 * back[0], y + 0.7 + 0.22, z + 0.5 - 0.27 * back[2]]
      : [x + 0.5, y + 0.7, z + 0.5];
    const chance = o.chance ?? TORCH_CHANCE;
    every(sim, at, ticks, (s, _t, r) => {
      if (r.nextFloat() >= chance) return;
      s.spawn("smoke", at);
      s.spawn(o.flame ?? "flame", at);
    });
  },
  campfire(
    sim: Sim,
    [x, y, z]: Vec3,
    ticks: number,
    o: { signal?: boolean; chance?: number } = {},
  ) {
    const chance = o.chance ?? TORCH_CHANCE;
    every(sim, [x, y, z], ticks, (s, _t, r) => {
      if (r.nextFloat() < 0.11) {
        const n = r.nextInt(2) + 2;
        for (let i = 0; i < n; i++) {
          const at: Vec3 = [
            x + 0.5 + (r.nextDouble() / 3) * (r.nextBoolean() ? 1 : -1),
            y + r.nextDouble() + r.nextDouble(),
            z + 0.5 + (r.nextDouble() / 3) * (r.nextBoolean() ? 1 : -1),
          ];
          s.spawn(o.signal ? "campfire_signal_smoke" : "campfire_cosy_smoke", at, [0, 0.07, 0]);
        }
      }
      if (r.nextFloat() < chance && r.nextInt(5) === 0)
        s.spawn("lava", [x + 0.5, y + 0.5, z + 0.5], [r.nextFloat() / 2, 5e-5, r.nextFloat() / 2]);
    });
  },
  lavaPool(sim: Sim, blocks: readonly Vec3[], ticks: number, o: { chance?: number } = {}) {
    const chance = o.chance ?? TORCH_CHANCE;
    every(sim, blocks[0] ?? [0, 0, 0], ticks, (s, _t, r) => {
      for (const [x, y, z] of blocks)
        if (r.nextFloat() < chance && r.nextInt(100) === 0)
          s.spawn("lava", [x + r.nextDouble(), y + 1, z + r.nextDouble()]);
    });
  },
};

interface Burst {
  start: number;
  seed: number;
  build: (sim: Sim) => void;
  sim: Sim | undefined;
  live: Particle[];
  born: Particle[];
  tick: number;
  end: number | undefined;
}

export interface ParticleSimulation {
  world: ParticleWorld;
  burst: (at: number, build: (sim: Sim) => void) => void;
  at: (t: number) => { particles: readonly Particle[]; pt: number }[];
  clear: () => void;
}

export function createParticleSimulation(world: ParticleWorld = {}, seed = 1): ParticleSimulation {
  const bursts: Burst[] = [];
  const reset = (b: Burst) => {
    b.tick = 0;
    b.end = undefined;
    b.born = [];
    const rng = seededRandom(b.seed);
    const sim: Sim = {
      world,
      rng,
      spawn: (type, pos, vel = [0, 0, 0], o = {}) => {
        const p = new Particle(type, seededRandom(Math.floor(rng.nextFloat() * 4294967296)));
        RECIPES[type].init(p, pos, vel, o, sim);
        b.born.push(p);
        return p;
      },
    };
    b.sim = sim;
    b.build(sim);
    b.live = b.born.filter((p) => !p.removed);
    b.born = [];
    if (!b.live.length) b.end = 0;
  };
  const step = (b: Burst) => {
    for (const p of b.live) (RECIPES[p.type].tick ?? baseTick)(p, b.sim!);
    b.live = b.live.filter((p) => !p.removed).concat(b.born);
    b.born = [];
    b.tick++;
    if (!b.live.length) b.end = b.tick;
  };
  return {
    world,
    burst(at, build) {
      bursts.push({
        start: at,
        seed: (Math.imul(seed, 0x9e3779b1) ^ Math.imul(bursts.length + 1, 0x85ebca6b)) >>> 0,
        build,
        sim: undefined,
        live: [],
        born: [],
        tick: 0,
        end: undefined,
      });
    },
    at(t) {
      const out: { particles: readonly Particle[]; pt: number }[] = [];
      for (const b of bursts) {
        const ticks = (t - b.start) * 20;
        if (ticks < 0) continue;
        const n = Math.floor(ticks + 1e-9);
        if (b.end !== undefined && n >= b.end) continue;
        if (!b.sim || n < b.tick) reset(b);
        while (b.tick < n && b.end === undefined) step(b);
        if (b.end !== undefined && n >= b.end) continue;
        out.push({ particles: b.live, pt: Math.min(1, Math.max(0, ticks - n)) });
      }
      return out;
    },
    clear() {
      bursts.length = 0;
    },
  };
}

export interface MinecraftParticlesOptions extends ParticleWorld {
  light?: THREE.Color | ((x: number, y: number, z: number) => THREE.Color);
  seed?: number;
  renderer?: ModelRendererApi;
  name?: string;
}

export interface MinecraftParticles {
  group: THREE.Group;
  simulation: ParticleSimulation;
  add: (type: ParticleType, at: number, pos: Vec3, velocity?: Vec3, opts?: SpawnOptions) => void;
  burst: (at: number, build: (sim: Sim) => void) => void;
  blockBreak: (
    at: number,
    block: string,
    pos: Vec3,
    opts?: { tint?: Rgb; properties?: Record<string, string> },
  ) => void;
  blockCrack: (
    at: number,
    until: number,
    block: string,
    pos: Vec3,
    face: BlockFace,
    opts?: { tint?: Rgb; properties?: Record<string, string> },
  ) => void;
  mobDeath: (at: number, e: EntityBox) => void;
  explosion: (
    at: number,
    center: Vec3,
    opts?: { radius?: number; blockCount?: number; breaksBlocks?: boolean },
  ) => void;
  hearts: (at: number, e: EntityBox) => void;
  villager: (at: number, e: EntityBox, mood: "angry" | "happy") => void;
  crit: (at: number, e: EntityBox, opts?: { magic?: boolean }) => void;
  damage: (at: number, e: EntityBox, amount: number) => void;
  totem: (at: number, e: EntityBox) => void;
  waterSplash: (at: number, e: EntityBox, surface: number) => void;
  firework: (
    at: number,
    pos: Vec3,
    explosions: readonly FireworkExplosion[],
    velocity?: Vec3,
  ) => void;
  rocket: (
    at: number,
    pos: Vec3,
    explosions: readonly FireworkExplosion[],
    opts?: { flight?: number },
  ) => void;
  emitter: (
    at: number,
    until: number,
    pos: Vec3,
    each: (sim: Sim, tick: number, rng: Rng) => void,
  ) => void;
  torch: (
    at: number,
    until: number,
    pos: Vec3,
    opts?: { facing?: "north" | "south" | "west" | "east"; flame?: ParticleType; chance?: number },
  ) => void;
  campfire: (
    at: number,
    until: number,
    pos: Vec3,
    opts?: { signal?: boolean; chance?: number },
  ) => void;
  lavaPool: (
    at: number,
    until: number,
    blocks: readonly Vec3[],
    opts?: { chance?: number },
  ) => void;
  ready: (...textures: string[]) => Promise<void>;
  update: (t: number, camera: THREE.Camera) => void;
  dispose: () => void;
}

const VERTEX = `
attribute vec4 iPos;
attribute vec4 iUv;
attribute vec4 iColor;
attribute float iRoll;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
  float c = cos(iRoll);
  float s = sin(iRoll);
  mvPosition.xy += mat2(c, s, -s, c) * position.xy * iPos.w;
  gl_Position = projectionMatrix * mvPosition;
  vUv = vec2(mix(iUv.x, iUv.z, position.x * 0.5 + 0.5), mix(iUv.w, iUv.y, position.y * 0.5 + 0.5));
  vColor = iColor;
  #include <fog_vertex>
}`;

const FRAGMENT = `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 col = texture2D(map, vUv) * vColor;
  if (col.a < 0.1) discard;
  gl_FragColor = col;
  #ifdef OPAQUE_LAYER
  gl_FragColor.a = 1.0;
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

type Rect = readonly [number, number, number, number];
type Img = CanvasImageSource & { width: number; height: number };

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const particleTexture = (name: string) => {
  const colon = name.indexOf(":");
  return `${colon >= 0 ? name.slice(0, colon) : "minecraft"}:particle/${name.slice(colon + 1)}`;
};

function packAtlas(images: Map<string, Img>) {
  const W = 512;
  const order = [...images].sort((a, b) => b[1].height - a[1].height);
  const at = new Map<string, [number, number]>();
  let x = 0;
  let y = 0;
  let row = 0;
  for (const [name, img] of order) {
    if (x + img.width > W) {
      x = 0;
      y += row + 1;
      row = 0;
    }
    at.set(name, [x, y]);
    x += img.width + 1;
    row = Math.max(row, img.height);
  }
  const H = 2 ** Math.ceil(Math.log2(Math.max(1, y + row)));
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext("2d");
  if (!g) throw new Error("createMinecraftParticles(): no 2d context for the atlas");
  const rects = new Map<string, Rect>();
  for (const [name, [px, py]] of at) {
    const img = images.get(name)!;
    g.drawImage(img, px, py);
    rects.set(name, [px / W, py / H, (px + img.width) / W, (py + img.height) / H]);
  }
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  Object.assign(texture, {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    generateMipmaps: false,
    flipY: false,
    colorSpace: THREE.SRGBColorSpace,
  });
  texture.needsUpdate = true;
  return { texture, rects };
}

class QuadLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private capacity = 0;
  private pos = new Float32Array(0);
  private uv = new Float32Array(0);
  private color = new Float32Array(0);
  private roll = new Float32Array(0);
  count = 0;
  constructor(material: THREE.ShaderMaterial, name: string) {
    this.mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.grow(256);
  }
  private grow(n: number) {
    const cap = Math.max(n, this.capacity * 2);
    const old = this.mesh.geometry;
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(2, 2);
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    const add = (key: string, size: number, prev: Float32Array) => {
      const arr = new Float32Array(cap * size);
      arr.set(prev);
      geo.setAttribute(
        key,
        new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage),
      );
      return arr;
    };
    this.pos = add("iPos", 4, this.pos);
    this.uv = add("iUv", 4, this.uv);
    this.color = add("iColor", 4, this.color);
    this.roll = add("iRoll", 1, this.roll);
    this.capacity = cap;
    this.mesh.geometry = geo;
    old.dispose();
  }
  push(
    x: number,
    y: number,
    z: number,
    size: number,
    rect: Rect,
    r: number,
    g: number,
    b: number,
    a: number,
    roll: number,
  ) {
    if (this.count >= this.capacity) this.grow(this.count + 1);
    const i = this.count++;
    this.pos.set([x, y, z, size], i * 4);
    this.uv.set(rect, i * 4);
    this.color.set([r, g, b, a], i * 4);
    this.roll[i] = roll;
  }
  sortByDepth(view: THREE.Matrix4) {
    const e = view.elements;
    const n = this.count;
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [this.pos[i * 4]!, this.pos[i * 4 + 1]!, this.pos[i * 4 + 2]!];
      depth[i] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    const order = [...Array(n).keys()].sort((a, b) => depth[a]! - depth[b]!);
    const take = (arr: Float32Array, size: number) => {
      const copy = arr.slice(0, n * size);
      order.forEach((from, to) =>
        arr.set(copy.subarray(from * size, from * size + size), to * size),
      );
    };
    take(this.pos, 4);
    take(this.uv, 4);
    take(this.color, 4);
    take(this.roll, 1);
  }
  flush() {
    const geo = this.mesh.geometry;
    geo.instanceCount = this.count;
    for (const key of ["iPos", "iUv", "iColor", "iRoll"]) {
      const attr = geo.getAttribute(key) as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function particleMaterial(opaque: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: null } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: opaque ? { OPAQUE_LAYER: "" } : {},
    fog: true,
    transparent: !opaque,
    depthWrite: opaque,
  });
}

export function createMinecraftParticles(
  sources: AssetsInput,
  opts: MinecraftParticlesOptions = {},
): MinecraftParticles {
  const world: ParticleWorld = { solid: opts.solid, ground: opts.ground };
  const simulation = createParticleSimulation(world, opts.seed ?? 1);
  const group = new THREE.Group();
  group.name = opts.name ?? "particles";
  const opaque = new QuadLayer(particleMaterial(true), "particles-opaque");
  const translucent = new QuadLayer(particleMaterial(false), "particles-translucent");
  group.add(opaque.mesh, translucent.mesh);

  const blocks = new Map<string, Record<string, string>>();
  const blockSprite = new Map<string, string>();
  const textures = new Set<string>();
  let atlas: { texture: THREE.Texture; rects: Map<string, Rect> } | undefined;
  let sets: Map<string, string[]> | undefined;

  const spriteOf = (block: string) => {
    const s = blockSprite.get(block);
    if (!s)
      throw new Error(
        `createMinecraftParticles(): "${block}" was added after ready(); await ready() again`,
      );
    return s;
  };
  const ticksBetween = (at: number, until: number) => Math.max(0, Math.round((until - at) * 20));

  const ready = async (...extra: string[]) => {
    for (const t of extra) textures.add(t);
    const bmr = opts.renderer ?? (await loadBmr());
    const { readFile, readTexture } = bmr;
    if (!readFile || !readTexture)
      throw new Error(
        "createMinecraftParticles() needs block-model-renderer 2.20 or later (readFile, readTexture)",
      );
    if (!sets) {
      const found = new Map<string, string[]>();
      const names = [
        ...new Set(PARTICLE_TYPES.map((t) => RECIPES[t].set).filter((s): s is string => !!s)),
      ];
      await Promise.all(
        names.map(async (set) => {
          const raw = await readFile(`assets/minecraft/particles/${set}.json`, sources);
          if (!raw)
            throw new Error(
              `createMinecraftParticles(): no particles/${set}.json in the asset sources`,
            );
          const list = (JSON.parse(new TextDecoder().decode(raw)) as { textures: string[] })
            .textures;
          found.set(set, list.map(particleTexture));
        }),
      );
      sets = found;
    }
    for (const [block, properties] of blocks)
      if (!blockSprite.has(block))
        blockSprite.set(
          block,
          await blockParticleTexture(sources, block, properties, { renderer: bmr }),
        );
    const all = new Set<string>([
      ...[...sets.values()].flat(),
      ...blockSprite.values(),
      ...textures,
    ]);
    const images = new Map<string, Img>();
    await Promise.all(
      [...all].map(async (name) => {
        const data = await readTexture(texturePath(name), sources);
        if (!data) throw new Error(`createMinecraftParticles(): no texture ${texturePath(name)}`);
        images.set(name, data.image as Img);
      }),
    );
    atlas?.texture.dispose();
    atlas = packAtlas(images);
    opaque.mesh.material.uniforms.map!.value = atlas.texture;
    translucent.mesh.material.uniforms.map!.value = atlas.texture;
  };

  const lit = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const view = new THREE.Matrix4();
  const update = (t: number, camera: THREE.Camera) => {
    if (!atlas || !sets)
      throw new Error("createMinecraftParticles(): await particles.ready() before update()");
    opaque.count = 0;
    translucent.count = 0;
    for (const { particles, pt } of simulation.at(t)) {
      for (const p of particles) {
        const recipe = RECIPES[p.type];
        if (recipe.layer === "none" || recipe.visible?.(p) === false) continue;
        let rect: Rect | undefined;
        if (p.sprite) rect = atlas.rects.get(p.sprite);
        else {
          const frames = sets.get(recipe.set!)!;
          rect = atlas.rects.get(frames[frameIndex(p, frames.length)]!);
        }
        if (!rect)
          throw new Error(
            `createMinecraftParticles(): texture "${p.sprite}" is not loaded; name it in ready("${p.sprite}")`,
          );
        if (p.uv) {
          const [u0, v0, u1, v1] = rect;
          rect = [
            u0 + (u1 - u0) * p.uv[0],
            v0 + (v1 - v0) * p.uv[1],
            u0 + (u1 - u0) * p.uv[2],
            v0 + (v1 - v0) * p.uv[3],
          ];
        }
        const x = p.xo + (p.x - p.xo) * pt;
        const y = p.yo + (p.y - p.yo) * pt;
        const z = p.zo + (p.z - p.zo) * pt;
        const light =
          typeof opts.light === "function" ? opts.light(x, y, z) : (opts.light ?? white);
        lit.copy(light).lerp(white, recipe.glow?.(p, pt) ?? 0);
        const layer = recipe.layer === "opaque" ? opaque : translucent;
        layer.push(
          x,
          y,
          z,
          recipe.size?.(p, pt) ?? p.quadSize,
          rect,
          toLinear(p.r) * lit.r,
          toLinear(p.g) * lit.g,
          toLinear(p.b) * lit.b,
          recipe.alpha?.(p, pt) ?? p.a,
          p.oRoll + (p.roll - p.oRoll) * pt,
        );
      }
    }
    camera.updateMatrixWorld();
    view.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
    translucent.sortByDepth(view);
    opaque.flush();
    translucent.flush();
  };

  const burst = simulation.burst;
  const E = PARTICLE_EVENTS;
  return {
    group,
    simulation,
    add: (type, at, pos, velocity = [0, 0, 0], o = {}) => {
      if (o.sprite) textures.add(o.sprite);
      burst(at, (sim) => void sim.spawn(type, pos, velocity, o));
    },
    burst,
    blockBreak: (at, block, pos, o = {}) => {
      blocks.set(block, o.properties ?? {});
      burst(at, (sim) => E.blockBreak(sim, spriteOf(block), pos, o.tint));
    },
    blockCrack: (at, until, block, pos, face, o = {}) => {
      blocks.set(block, o.properties ?? {});
      burst(at, (sim) =>
        E.blockCrack(sim, spriteOf(block), pos, face, ticksBetween(at, until), o.tint),
      );
    },
    mobDeath: (at, e) => burst(at, (sim) => E.mobDeath(sim, e)),
    explosion: (at, center, o = {}) =>
      burst(at, (sim) =>
        E.explosion(sim, center, o.radius ?? 4, o.blockCount ?? 100, o.breaksBlocks ?? true),
      ),
    hearts: (at, e) => burst(at, (sim) => E.hearts(sim, e)),
    villager: (at, e, mood) => burst(at, (sim) => E.villager(sim, e, mood)),
    crit: (at, e, o = {}) => burst(at, (sim) => E.crit(sim, e, o.magic)),
    damage: (at, e, amount) => burst(at, (sim) => E.damage(sim, e, amount)),
    totem: (at, e) => burst(at, (sim) => E.totem(sim, e)),
    waterSplash: (at, e, surface) => burst(at, (sim) => E.waterSplash(sim, e, surface)),
    firework: (at, pos, explosions, velocity) =>
      burst(at, (sim) => E.firework(sim, pos, explosions, velocity)),
    rocket: (at, pos, explosions, o = {}) =>
      burst(at, (sim) => E.rocket(sim, pos, explosions, o.flight)),
    emitter: (at, until, pos, each) =>
      burst(at, (sim) => every(sim, pos, ticksBetween(at, until), each)),
    torch: (at, until, pos, o) => burst(at, (sim) => E.torch(sim, pos, ticksBetween(at, until), o)),
    campfire: (at, until, pos, o) =>
      burst(at, (sim) => E.campfire(sim, pos, ticksBetween(at, until), o)),
    lavaPool: (at, until, list, o) =>
      burst(at, (sim) => E.lavaPool(sim, list, ticksBetween(at, until), o)),
    ready,
    update,
    dispose: () => {
      opaque.dispose();
      translucent.dispose();
      atlas?.texture.dispose();
      group.removeFromParent();
    },
  };
}
