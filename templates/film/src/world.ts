// @ts-nocheck
// The set as a list of the game's own blocks for block-model-renderer ({id, pos, properties}); one block is one metre.
// A starter room to replace: stone-brick walls, an oak floor, a smooth-stone ceiling, inside x 0..ROOM.x1, z 0..ROOM.z1,
// y 0..ROOM.top, with the shared props (mc-assets pack: "gohans:<prop>") placed like any block. Seeded: every build is the
// same room.
import { mulberry32 } from "math/random";

export const ROOM = { x1: 6, z1: 6, top: 3 };

// [block, share]: the first block takes whatever share is left
const WALL = [["stone_bricks"], ["cracked_stone_bricks", 0.12], ["mossy_stone_bricks", 0.08]];
const FLOOR = [["oak_planks"]];
const CEILING = [["smooth_stone"]];

export function buildWorld() {
  const seed = mulberry32.create(1);
  const rnd = () => mulberry32.sample(seed);
  const pick = (mix) => { let r = rnd(); for (const [id, share] of mix.slice(1)) if ((r -= share) < 0) return id; return mix[0][0]; };
  const blocks = [];
  const put = (id, x, y, z, properties) => blocks.push({ id, pos: [x, y, z], ...(properties && { properties }) });
  const { x1, z1, top } = ROOM;
  for (let x = -1; x <= x1 + 1; x++) for (let z = -1; z <= z1 + 1; z++) {
    put(pick(FLOOR), x, -1, z);
    put(pick(CEILING), x, top + 1, z);
  }
  for (let y = 0; y <= top; y++) {
    for (let z = -1; z <= z1 + 1; z++) { put(pick(WALL), -1, y, z); put(pick(WALL), x1 + 1, y, z); }
    for (let x = 0; x <= x1; x++) { put(pick(WALL), x, y, -1); put(pick(WALL), x, y, z1 + 1); }
  }
  put("gohans:iron_bed", x1, 0, 0, { facing: "north" });
  put("gohans:computer", 0, 1, 3, { facing: "east" });
  for (const dz of [2, 3, 4]) put("iron_trapdoor", 0, 0, dz, { facing: "east", half: "top", open: "false" });
  return blocks;
}
