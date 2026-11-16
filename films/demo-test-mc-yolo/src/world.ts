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
  const pick = (mix) => {
    let r = rnd();
    for (const [id, share] of mix.slice(1)) if ((r -= share) < 0) return id;
    return mix[0][0];
  };
  const blocks = [];
  const put = (id, x, y, z, properties) =>
    blocks.push({ id, pos: [x, y, z], ...(properties && { properties }) });
  const { x1, z1, top } = ROOM;
  for (let x = -1; x <= x1 + 1; x++)
    for (let z = -1; z <= z1 + 1; z++) {
      put(pick(FLOOR), x, -1, z);
      put(pick(CEILING), x, top + 1, z);
    }
  for (let y = 0; y <= top; y++) {
    for (let z = -1; z <= z1 + 1; z++) {
      put(pick(WALL), -1, y, z);
      put(pick(WALL), x1 + 1, y, z);
    }
    for (let x = 0; x <= x1; x++) {
      put(pick(WALL), x, y, -1);
      put(pick(WALL), x, y, z1 + 1);
    }
  }
  // A kitchen: counter along the back wall, a fence-post table on a red rug in the middle; the cake on it is a placed
  // object (src/timeline/placed.json) so it can be hidden and swapped as the cat eats
  put("smoker", 0, 0, 0, { facing: "south", lit: "true" });
  put("furnace", 1, 0, 0, { facing: "south", lit: "false" });
  put("barrel", 2, 0, 0, { facing: "up" });
  put("crafting_table", 3, 0, 0);
  put("barrel", 4, 0, 0, { facing: "up" });
  put("oak_slab", 0, 1, 1, { type: "bottom" });
  for (const x of [5, 6]) put("bookshelf", x, 0, 0);
  put("potted_red_tulip", 2, 1, 0);
  put("potted_cactus", 4, 1, 0);
  put("lantern", 3, 3, 3, { hanging: "true" });
  put("lantern", 1, 3, 1, { hanging: "true" });
  for (let x = 1; x <= 4; x++) for (let z = 2; z <= 4; z++) put("red_carpet", x, 0, z);
  put("oak_fence", 2, 0, 3, { east: "true" });
  put("oak_fence", 3, 0, 3, { west: "true" });
  put("oak_pressure_plate", 2, 1, 3);
  // a window in the east wall: the wall's own blocks there give way to glass
  for (let y = 1; y <= 2; y++)
    for (const z of [2, 3, 4]) {
      const i = blocks.findIndex((b) => b.pos[0] === x1 + 1 && b.pos[1] === y && b.pos[2] === z);
      if (i >= 0) blocks.splice(i, 1);
      put("glass_pane", x1 + 1, y, z, { north: "true", south: "true" });
    }
  return blocks;
}
