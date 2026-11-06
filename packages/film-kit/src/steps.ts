// Footstep sounds placed by the feet themselves: a step sounds when a sole comes down on the floor, played from the block
// it lands on, at the game's own volume and pitch for that block. Two ways to time them:
//   contacts(soles, end): each time a sole comes down and stops (a heel strike), from the soles' paths, so the sound lands
//     on the frame the foot does whatever the body is doing (keys, a walk cycle, a Mixamo clip).
//   gameSteps(walked, end): the game's own rhythm, for a body with no feet to watch (a mob far off, an off-screen walk):
//     Java plays a step each time 0.6 x the distance walked passes a whole number (Entity.applyMovementEmissionAndPlaySound,
//     decompiled 1.21.4), one every 1.67 blocks.
// stepSounds(events, blockAt) turns either into sounds. A step plays the block's step sound (block.<type>.step) at 0.15 x
// the type's volume and its pitch (minecraft.wiki/w/Block_sound_type; almost every type is 1.0 / 1.0; metal is pitch 1.5,
// anvil volume 0.3). Carpet, snow layers, moss carpet and the like play the block under them too, at 1/3 volume and 4/5
// pitch under their own step (Java's combination step sounds: both play). Each step picks one of the event's recorded variants, never the same one twice
// running (repeating a sample is what makes footsteps sound machine-made). The sound files are the film's to choose (CC0
// recordings per material: the game's own .ogg files are Mojang's and are never published).
//   const ev = contacts({ L: (t) => soleL(t), R: (t) => soleR(t) }, end, { ground: 0 });
//   const sounds = stepSounds(ev, (x, y, z) => world.blockBelow(x, y, z));   [{ t, event, volume, pitch, variant, at }]
// A sole path gives world [x, y, z] metres; ground is a height or (x, z) => the floor there.
export const STEP = {
  volume: 0.15, // x the sound type's volume
  layered: { volume: 1 / 3, pitch: 0.8 }, // a step through carpet or snow onto the block below
  lift: 0.03, // m above the floor that still counts as down
  still: 0.25, // m/s: a sole slower than this is planted
  gap: 0.25, // s, one foot never steps again sooner
  every: 1 / 0.6, // blocks walked per step, the game's rhythm
  variants: 4, // recordings per sound event to pick from
};
// sound types whose numbers differ from 1.0 / 1.0 (minecraft.wiki/w/Block_sound_type); everything else is 1.0 / 1.0
export const SOUND_TYPE: Record<string, { volume: number; pitch: number }> = {
  metal: { volume: 1, pitch: 1.5 },
  anvil: { volume: 0.3, pitch: 1 },
  twisting_vines: { volume: 1, pitch: 0.5 },
};
// a few common blocks' sound types; check a new entry against minecraft.wiki/w/Block_sound_type, which lists every block
export const BLOCK_SOUND: Record<string, string> = {
  stone: "stone", cobblestone: "stone", deepslate: "deepslate", bricks: "stone", andesite: "stone", stone_bricks: "stone",
  dirt: "gravel", gravel: "gravel", grass_block: "grass", sand: "sand", red_sand: "sand", snow_block: "snow", clay: "gravel",
  oak_planks: "wood", spruce_planks: "wood", oak_log: "wood", crafting_table: "wood", bookshelf: "wood", chest: "wood",
  white_wool: "wool", glass: "glass", iron_block: "metal", iron_door: "metal", anvil: "anvil", ladder: "ladder",
  netherrack: "netherrack", soul_sand: "soul_sand", moss_block: "moss", ice: "glass", packed_ice: "glass",
  white_carpet: "wool", snow: "snow", moss_carpet: "moss_carpet",
};
// blocks that let the block under them be heard (Java's combination_step_sound_blocks)
export const LAYERED = new Set(["carpet", "snow", "moss_carpet", "crimson_roots", "warped_roots", "nether_sprouts"]);

type V3 = [number, number, number];
const HZ = 120;
const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

export type Step = { t: number; foot: string; at: V3; speed: number };
// heel strikes: a sole that was off the floor (or moving) comes down within `lift` and slows under `still`
export function contacts(soles: Record<string, (t: number) => V3>, end: number, { ground = 0 as number | ((x: number, z: number) => number), from = 0 } = {}) {
  const fl = (x: number, z: number) => (typeof ground === "number" ? ground : ground(x, z));
  const out: Step[] = [];
  for (const [foot, at] of Object.entries(soles)) {
    let prev = at(from), down = true, last = -1e9, peak = 0;
    for (let i = 1; i <= Math.ceil((end - from) * HZ); i++) {
      const t = from + i / HZ, p = at(t);
      const v = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) * HZ;
      const low = p[1] - fl(p[0], p[2]) <= STEP.lift;
      if (!low || v > STEP.still) { if (down && !low) down = false; peak = Math.max(peak, v); }
      if (!down && low && v <= STEP.still * 2) {
        if (t - last >= STEP.gap) { out.push({ t, foot, at: p, speed: peak }); last = t; }
        down = true; peak = 0;
      }
      prev = p;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// the game's step rhythm from how far he has walked: walked(t) in blocks (horizontal), at(t) where he is
export function gameSteps(walked: (t: number) => number, at: (t: number) => V3, end: number, { from = 0 } = {}) {
  const out: Step[] = [];
  let next = Math.floor(walked(from) / STEP.every) + 1;
  for (let i = 1; i <= Math.ceil((end - from) * HZ); i++) {
    const t = from + i / HZ;
    if (walked(t) / STEP.every > next) { out.push({ t, foot: out.length % 2 ? "R" : "L", at: at(t), speed: 0 }); next = Math.floor(walked(t) / STEP.every) + 1; }
  }
  return out;
}

// what each step sounds like: blockAt(x, y, z) names the block the sole is on (asked 0.2 below the sole, as the game
// does); a block in LAYERED plays its own step and, muffled, the step of the block under it (asked 1 block lower)
export function stepSounds(steps: Step[], blockAt: (x: number, y: number, z: number) => string, { seed = 3, variants = STEP.variants } = {}) {
  const last: Record<string, number> = {};
  let n = 0;
  const sound = (s: Step, block: string, muffled: boolean) => {
    const type = BLOCK_SOUND[block] ?? block;
    const T = SOUND_TYPE[type] ?? { volume: 1, pitch: 1 };
    let v = Math.floor(hash(n, seed) * variants);
    if (v === last[type]) v = (v + 1 + Math.floor(hash(n, seed + 1) * (variants - 1))) % variants;
    last[type] = v; n++;
    return {
      t: s.t, foot: s.foot, at: s.at, block, type, event: `block.${type}.step`, variant: v,
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
