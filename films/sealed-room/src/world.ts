// @ts-nocheck
// CELL 0412, the sealed room, as a list of the game's own blocks for block-model-renderer ({id, pos, properties}).
// The look follows the first Minecraft cut of this story (Desktop\huggingfaceopenaiincident_minecraft): old stone-brick
// walls with cracked, mossy and chiseled bricks, a cobblestone floor, a stone ceiling, cobwebs in the top corners, a
// polished-deepslate frame round the door and the lamp. One block is one metre. Inside: x 0..6, z 5..11, y 0..3 (the dev:
// a 6 x 6 cell, small and stifling, under a low ceiling); floor at y -1, ceiling at y 3. Steve's black bed stands with its
// head against the north (-z) wall; on his right (-x) is the west wall with the desk, chair, screen and filing drawer
// further along it; the steel door is in the south (+z) wall. The walls were drawn in round the desk corner, which kept its
// world coordinates (and every key that points at it). Seeded: every build is the same room.
import { mulberry32 } from "math/random";

export const ROOM = { x0: 0, x1: 5, z0: 5, z1: 10, top: 2 };
export const BED = { x: 4, head: 5 }; // head cell (4, 0, 5), foot cell (4, 0, 6); a vanilla bed: mattress top 9 px up
export const DESK = { x: 0, z: 8 }; // two cells along the west wall, z 8..9
export const DOOR = { x: 4, z: ROOM.z1 + 1 };
// Props that move or hide are built apart from the room (src/props.ts): the chair he pulls out, the drawer he yanks open,
// the CCTV dome (shot 0 looks out of it). The cabinet the drawer slides out of stands under the desk, carrying that cell's plate.
// The chair he sits in (src/props.ts): x is its backrest's front face when tucked in, z the line it slides along, seat its
// height. 0.45 m is a real chair for a 1.8 m man, which Steve is: his thighs clear the desk plate (0.81 m) and his eyes come
// level with the screen. With the backrest here he sits back at ease, knees a hand short of the desk, eyes ~0.75 m from the glass
export const CHAIR = { x: 1.71, z: DESK.z + 0.5, seat: 0.45 };
// under the desk's south cell: the north cell, in front of the screen, is his legroom, and the drawer opens by his left knee
export const CABINET = { x: DESK.x, z: DESK.z + 1 };
export const DOME = [ROOM.x1, ROOM.top, ROOM.z0];
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
  // nobody has swept this room: webs in the top corners and along the ceiling's edges, one low in the north-west corner
  // (the north-east top corner holds the CCTV camera)
  for (const [x, y, z] of [[x1, top, z1], [x0, top, z1], [x0, top, z0], [x0, top, z0 + 1], [x0, top, z1 - 1], [x1 - 1, top, z1], [x0 + 1, top, z0], [x0, 0, z0]]) put("cobweb", x, y, z);

  // the game's own black bed: head cell to the north, foot cell south of it
  put("black_bed", BED.x, 0, BED.head, { facing: "north", part: "head", occupied: "false" });
  put("black_bed", BED.x, 0, BED.head + 1, { facing: "north", part: "foot", occupied: "false" });

  // a steel desk bolted to the wall: iron trapdoors as the plate, the filing cabinet under its south cell. The old CRT
  // on it has looks to choose between, so it is built apart from the room (src/variants.ts)
  for (const dz of [0, 1]) put("iron_trapdoor", DESK.x, 0, DESK.z + dz, { facing: "east", half: "top", open: "false" });
  put("gohans:file_cabinet", CABINET.x, 0, CABINET.z, { facing: "east" }); // replaces that cell's trapdoor: the cabinet model carries the plate

  // the door: iron in a polished-deepslate frame, set into the south wall. A closed door's panel lies on the side away from
  // its facing: "south" puts it flush with the room's side of the wall, where his hand can reach the seam
  for (const [dx, y] of [[-1, 0], [-1, 1], [-1, 2], [0, 2], [1, 2], [1, 1], [1, 0]]) put("polished_deepslate", DOOR.x + dx, y, DOOR.z);
  put("iron_door", DOOR.x, 0, DOOR.z, { facing: "south", half: "lower", hinge: "left", open: "false", powered: "false" });
  put("iron_door", DOOR.x, 1, DOOR.z, { facing: "south", half: "upper", hinge: "left", open: "false", powered: "false" });
  return blocks;
}
