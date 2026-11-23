import { hash } from "./hash";
export const STEP = {
  volume: 0.15,
  layered: { volume: 1 / 3, pitch: 0.8 },
  lift: 0.03,
  still: 0.25,
  gap: 0.25,
  every: 1 / 0.6,
  variants: 4,
};
export const SOUND_TYPE: Record<string, { volume: number; pitch: number }> = {
  metal: { volume: 1, pitch: 1.5 },
  anvil: { volume: 0.3, pitch: 1 },
  twisting_vines: { volume: 1, pitch: 0.5 },
};
export const BLOCK_SOUND: Record<string, string> = {
  stone: "stone",
  cobblestone: "stone",
  deepslate: "deepslate",
  bricks: "stone",
  andesite: "stone",
  stone_bricks: "stone",
  dirt: "gravel",
  gravel: "gravel",
  grass_block: "grass",
  sand: "sand",
  red_sand: "sand",
  snow_block: "snow",
  clay: "gravel",
  oak_planks: "wood",
  spruce_planks: "wood",
  oak_log: "wood",
  crafting_table: "wood",
  bookshelf: "wood",
  chest: "wood",
  white_wool: "wool",
  glass: "glass",
  iron_block: "metal",
  iron_door: "metal",
  anvil: "anvil",
  ladder: "ladder",
  netherrack: "netherrack",
  soul_sand: "soul_sand",
  moss_block: "moss",
  ice: "glass",
  packed_ice: "glass",
  white_carpet: "wool",
  snow: "snow",
  moss_carpet: "moss_carpet",
};
export const LAYERED = new Set([
  "carpet",
  "snow",
  "moss_carpet",
  "crimson_roots",
  "warped_roots",
  "nether_sprouts",
]);

type V3 = [number, number, number];
const HZ = 120;

export type Step = { t: number; foot: string; at: V3; speed: number };
export function contacts(
  soles: Record<string, (t: number) => V3>,
  end: number,
  { ground = 0 as number | ((x: number, z: number) => number), from = 0 } = {},
) {
  const fl = (x: number, z: number) => (typeof ground === "number" ? ground : ground(x, z));
  const out: Step[] = [];
  for (const [foot, at] of Object.entries(soles)) {
    let prev = at(from),
      down = true,
      last = -1e9,
      peak = 0;
    for (let i = 1; i <= Math.ceil((end - from) * HZ); i++) {
      const t = from + i / HZ,
        p = at(t);
      const v = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) * HZ;
      const low = p[1] - fl(p[0], p[2]) <= STEP.lift;
      if (!low || v > STEP.still) {
        if (down && !low) down = false;
        peak = Math.max(peak, v);
      }
      if (!down && low && v <= STEP.still * 2) {
        if (t - last >= STEP.gap) {
          out.push({ t, foot, at: p, speed: peak });
          last = t;
        }
        down = true;
        peak = 0;
      }
      prev = p;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export function gameSteps(
  walked: (t: number) => number,
  at: (t: number) => V3,
  end: number,
  { from = 0 } = {},
) {
  const out: Step[] = [];
  let next = Math.floor(walked(from) / STEP.every) + 1;
  for (let i = 1; i <= Math.ceil((end - from) * HZ); i++) {
    const t = from + i / HZ;
    if (walked(t) / STEP.every > next) {
      out.push({ t, foot: out.length % 2 ? "R" : "L", at: at(t), speed: 0 });
      next = Math.floor(walked(t) / STEP.every) + 1;
    }
  }
  return out;
}

export function stepSounds(
  steps: Step[],
  blockAt: (x: number, y: number, z: number) => string,
  { seed = 3, variants = STEP.variants } = {},
) {
  const last: Record<string, number> = {};
  let n = 0;
  const sound = (s: Step, block: string, muffled: boolean) => {
    const type = BLOCK_SOUND[block] ?? block;
    const T = SOUND_TYPE[type] ?? { volume: 1, pitch: 1 };
    let v = Math.floor(hash(n, seed) * variants);
    if (v === last[type]) v = (v + 1 + Math.floor(hash(n, seed + 1) * (variants - 1))) % variants;
    last[type] = v;
    n++;
    return {
      t: s.t,
      foot: s.foot,
      at: s.at,
      block,
      type,
      event: `block.${type}.step`,
      variant: v,
      volume: STEP.volume * T.volume * (muffled ? STEP.layered.volume : 1),
      pitch: T.pitch * (muffled ? STEP.layered.pitch : 1),
    };
  };
  return steps.flatMap((s) => {
    const on = blockAt(s.at[0], s.at[1] - 0.2, s.at[2]);
    if (!(LAYERED.has(on) || on.endsWith("_carpet"))) return [sound(s, on, false)];
    return [sound(s, on, false), sound(s, blockAt(s.at[0], s.at[1] - 1.2, s.at[2]), true)];
  });
}
