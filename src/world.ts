// @ts-nocheck
// CELL 0412, the sealed room, as a list of the game's own blocks for block-model-renderer ({id, pos, properties}).
// The look follows the first Minecraft cut of this story (Desktop\huggingfaceopenaiincident_minecraft): old stone-brick
// walls with cracked, mossy and chiseled bricks, a cobblestone floor, a stone ceiling, cobwebs in the top corners, a
// polished-deepslate frame round the door and the lamp. One block is one metre. Inside: x 0..8, z 0..11, y 0..5; floor at
// y -1, ceiling at y 6. Steve's iron bed stands in the middle with its head to the north (-z); on his right (-x) is the west wall
// with the desk, chair and screen further along it; the steel door is in the far (south, +z) wall. Seeded: every build is
// the same room.
import { mulberry32 } from "math/random";

export const ROOM = { x0: 0, x1: 8, z0: 0, z1: 11, top: 5 };
export const BED = { x: 4, head: 5 }; // head cell (4, 0, 5), foot cell (4, 0, 6); mattress top 9 px up, as a vanilla bed's
export const DESK = { x: 0, z: 8 }; // two cells along the west wall, z 8..9
export const DOOR = { x: 4, z: ROOM.z1 + 1 };
// The one ceiling light, a sea-lantern strip over the bed, set in the ceiling. Built as its own block scene (scene.ts):
// block-model-renderer gives a merged scene that holds a glowing block one shared emissive material, and the whole room lit itself
export const LAMP = [[BED.x, ROOM.top + 1, BED.head], [BED.x, ROOM.top + 1, BED.head + 1]];

// [block, share]: the first block takes whatever share is left
const WALL = [["stone_bricks"], ["cracked_stone_bricks", 0.16], ["mossy_stone_bricks", 0.1], ["chiseled_stone_bricks", 0.02]];
const FLOOR = [["cobblestone"], ["mossy_cobblestone", 0.1], ["gravel", 0.06]];
const CEILING = [["smooth_stone"], ["stone", 0.12]];

export function buildWorld() {
  const seed = mulberry32.create(412);
  const rnd = () => mulberry32.sample(seed);
  const pick = (mix) => { let r = rnd(); for (const [id, share] of mix.slice(1)) if ((r -= share) < 0) return id; return mix[0][0]; };
  const blocks = [];
  const at = new Map();
  const put = (id, x, y, z, properties) => {
    const k = `${x},${y},${z}`;
    const b = { id, pos: [x, y, z], ...(properties && { properties }) };
    if (at.has(k)) blocks[at.get(k)] = b; else { at.set(k, blocks.length); blocks.push(b); }
  };
  const { x0, x1, z0, z1, top } = ROOM;

  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) {
    put(pick(FLOOR), x, -1, z);
    if (LAMP.some((p) => p[0] === x && p[2] === z)) continue;
    const frame = Math.abs(x - BED.x) <= 1 && z >= BED.head - 1 && z <= BED.head + 2;
    put(frame ? "polished_deepslate" : pick(CEILING), x, top + 1, z);
  }
  for (let y = 0; y <= top; y++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) { put(pick(WALL), x0 - 1, y, z); put(pick(WALL), x1 + 1, y, z); }
    for (let x = x0; x <= x1; x++) { put(pick(WALL), x, y, z0 - 1); put(pick(WALL), x, y, z1 + 1); }
  }
  // nobody has swept this room (the north-east corner holds the CCTV camera)
  for (const [x, z] of [[x1, z1], [x0, z1], [x0, z0]]) put("cobweb", x, top, z);

  // the small iron bed, the film's own model (pack/assets/gohans): one block at the head cell reaching into the foot cell
  put("gohans:iron_bed", BED.x, 0, BED.head, { facing: "north" });

  // a steel desk bolted to the wall and one chair: iron trapdoors as the plate. The old CRT on it has looks to choose
  // between, so it is built apart from the room (src/variants.ts)
  for (const dz of [0, 1]) put("iron_trapdoor", DESK.x, 0, DESK.z + dz, { facing: "east", half: "top", open: "false" });
  put("polished_deepslate_stairs", DESK.x + 1, 0, DESK.z, { facing: "east", half: "bottom", shape: "straight" });

  // the door: iron in a polished-deepslate frame, set into the south wall
  for (const [dx, y] of [[-1, 0], [-1, 1], [-1, 2], [0, 2], [1, 2], [1, 1], [1, 0]]) put("polished_deepslate", DOOR.x + dx, y, DOOR.z);
  put("iron_door", DOOR.x, 0, DOOR.z, { facing: "north", half: "lower", hinge: "left", open: "false", powered: "false" });
  put("iron_door", DOOR.x, 1, DOOR.z, { facing: "north", half: "upper", hinge: "left", open: "false", powered: "false" });
  return blocks;
}
