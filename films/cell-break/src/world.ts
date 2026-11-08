// @ts-nocheck
// The cell, as a list of the game's own blocks for block-model-renderer ({id, pos, properties}); one block is one metre.
// The same stone room as films/sealed-room (6 x 6 inside, 3 high: old stone-brick walls, cobblestone floor, stone
// ceiling). Inside: x 0..6, z 0..6, y 0..3. Seeded: every build is the same room.
//   west wall (-x): bookshelves floor to ceiling, dusty (the warden's dead-weight library)
//   north-west corner: one chiseled bookshelf set in the north wall, the inmates' mailbox
//   behind it: a secret conduit north, down three blocks, redstone-lit, the cable from the service box under the desk on
//     its floor (story.ts), a curtain of fire across it further on (the firewall), then on into the dark (no light past z -14)
//   north wall, beside the chiseled shelf: the steel desk (iron-trapdoor plate), seen from where he stands at it: the
//     submission slot on the left, the CRT and keyboard in the middle (src/variants.ts), the reasoning-trace printer on the
//     right, the filing cabinet under it; the CCTV camera watches it from the ceiling's south-west corner (scene.ts)
//   north-east corner: the black bed along the east wall; south wall: the iron door in a polished-deepslate frame
//   ceiling: a two-block tube light over the room's east half (ROOM_LIGHTS: the studio's "room light" chip)
import { mulberry32 } from "math/random";

export const ROOM = { x1: 5, z1: 5, top: 2 };
export const BED = { x: 5, head: 0 }; // head cell (5, 0, 0), foot cell (5, 0, 1)
export const DOOR = { x: 4, z: ROOM.z1 + 1 };
export const SHELF = { x: 0, y: 0, z: -1 }; // the chiseled bookshelf, in the north wall, its books toward the room
// The conduit behind it, by z: its floor's level there. z -2 is the landing behind the shelf; the floor steps down a block
// each to z -5, level from z -6 to the far end. The cable on its floor and the pulse along it are story.ts CABLE
export const TUNNEL = { x: 0, end: -32, fire: -12 };
export const RAIL_Y = (z) => (z >= -2 ? 0 : z >= -5 ? z + 2 : -3);
// redstone torches on the tunnel's west wall (the only light in there), at these z
export const TORCHES = [-6, -9, -14];
// the desk's three cells along the north wall, west to east (his left to right as he faces it): slot, CRT, printer
export const DESK = { z: 0, slot: 1, crt: 2, printer: 3 };
// the CCTV camera: its ceiling mount's foot (x, the top cell's floor, z) in the south-west corner, and the point it watches
export const CCTV = [0.35, 2, 5.65];
export const CCTV_AIM = [2.4, 1.0, 1.4];
// the floor block over the TNT (story.ts, hook F7): its own block scene so the story can lift it away
export const TRAP = [3, -1, 3];
// the floor the TNT blows away (story.ts): every cell within two steps of it, apart as loose.crater; under it the crater's
// bed (y -2, and y -3 under the TNT's own hole), always there, hidden by the floor until the blast
export const CRATER = [];
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dz) <= 2 && (dx || dz)) CRATER.push([TRAP[0] + dx, TRAP[2] + dz]);
// The room's light, one of two (the studio's "room light" chip; the first is the film's own). Each look is its own glowing
// block scene: a tube strip set in the ceiling (two ochre froglights) or one wall torch beside the door, the ceiling whole.
// light: where scene.ts hangs that look's lamp
export const TUBE = [[3, ROOM.top + 1, 2], [3, ROOM.top + 1, 3]];
export const ROOM_LIGHTS = [
  { id: "tube", title: "flickering ceiling tube", blocks: TUBE.map((pos) => ({ id: "ochre_froglight", pos, properties: { axis: "z" } })), light: [3.5, ROOM.top + 0.9, 3] },
  { id: "torch", title: "one wall torch by the door", blocks: [{ id: "wall_torch", pos: [2, 1, 5], properties: { facing: "north" } }, ...TUBE.map((pos) => ({ id: "smooth_stone", pos }))], light: [2.5, 1.78, 5.72] },
];

// [block, share]: the first block takes whatever share is left
const WALL = [["stone_bricks"], ["cracked_stone_bricks", 0.16], ["mossy_stone_bricks", 0.1], ["chiseled_stone_bricks", 0.02]];
const FLOOR = [["cobblestone"], ["mossy_cobblestone", 0.1], ["gravel", 0.06]];
const CEILING = [["smooth_stone"], ["stone", 0.12]];
const ROCK = [["stone"], ["andesite", 0.2], ["tuff", 0.15], ["cobblestone", 0.1]];
const CRATER_BED = [["stone"], ["dirt", 0.3], ["tuff", 0.15]];

// Blocks that give light (the torches, the fire) are built as their own block scene (buildLights, scene.ts): block-model-renderer
// makes a glowing block emissive only there; in the room's merged scene a torch stays an unlit black stick
const GLOWS = new Set(["wall_torch", "redstone_wall_torch", "fire"]);
// Blocks the story hides for a moment are their own block scenes too (story.ts): the iron door (the hook's camera flies
// out through it), the mailbox shelf (its bottom panel slides away at 2:49 to show the tunnel) and the trap block over the TNT
const LOOSE = { door: new Set(["iron_door"]), shelf: new Set(["chiseled_bookshelf", "gohans:book_pulled"]) };
const isTrap = (b) => b.pos.every((v, i) => v === TRAP[i]);
const isCrater = (b) => b.pos[1] === TRAP[1] && CRATER.some(([x, z]) => b.pos[0] === x && b.pos[2] === z);
// the ceiling, apart so scene.ts can lift it off while the camera is above the cell (the cell block seen from over it)
const isCeiling = (b) => b.pos[1] === ROOM.top + 1;
// the tunnel past the north wall, apart so scene.ts can hide it while the camera is over the cell block (the cells north
// of his stand where it runs)
const isTunnel = (b) => b.pos[2] < -1;
let built;
export const buildWorld = () => (built ??= splitWorld()).room;
export const buildLights = () => (built ??= splitWorld()).lights;
export const buildLoose = (k) => (built ??= splitWorld())[k];
// one cell as the cell block repeats it (cellblock.ts): inside its walls, the floor to the walls' top, no ceiling and
// nothing past the walls (the tunnel, the crater's bed); no glowing blocks (the lamps are the room's)
export const buildCell = () => allBlocks().filter((b) => {
  const [x, y, z] = b.pos;
  return x >= -1 && x <= ROOM.x1 + 1 && z >= -1 && z <= ROOM.z1 + 1 && y >= -1 && y <= ROOM.top && !GLOWS.has(b.id);
});
const splitWorld = () => {
  const all = allBlocks(), loose = (b) => isTrap(b) || isCrater(b) || isCeiling(b) || isTunnel(b) || Object.values(LOOSE).some((ids) => ids.has(b.id));
  return {
    room: all.filter((b) => !GLOWS.has(b.id) && !loose(b)), lights: all.filter((b) => GLOWS.has(b.id)),
    ...Object.fromEntries(Object.entries(LOOSE).map(([k, ids]) => [k, all.filter((b) => ids.has(b.id))])), trap: all.filter(isTrap), crater: all.filter(isCrater), ceiling: all.filter(isCeiling), tunnel: all.filter((b) => isTunnel(b) && !GLOWS.has(b.id)),
  };
};

function allBlocks() {
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
  const { x1, z1, top } = ROOM;
  for (let x = -1; x <= x1 + 1; x++) for (let z = -1; z <= z1 + 1; z++) {
    put(pick(FLOOR), x, -1, z);
    if (!TUBE.some((p) => p[0] === x && p[2] === z)) put(pick(CEILING), x, top + 1, z);
  }
  for (let y = 0; y <= top; y++) {
    for (let z = -1; z <= z1 + 1; z++) { put(pick(WALL), -1, y, z); put(pick(WALL), x1 + 1, y, z); }
    for (let x = 0; x <= x1; x++) { put(pick(WALL), x, y, -1); put(pick(WALL), x, y, z1 + 1); }
  }
  // the bookshelf wall, corner to corner, with webs along its top
  for (let y = 0; y <= top; y++) for (let z = 0; z <= z1; z++) put("bookshelf", -1, y, z);
  for (const z of [0, 1]) put("cobweb", 0, top, z); // none at z 4, 5: the CCTV camera's corner, seen from the desk
  put("cobweb", 0, 0, z1);

  // the mailbox: a chiseled bookshelf (slots 0-2 the top row, 3-5 the bottom, left to right seen from the room). The top
  // row's first two hold the leather letters from the other cells, pulled half out (gohans:book_pulled, the cell in front);
  // the bottom row stands empty, its loose back panel the way into the tunnel
  const slots = [false, false, true, false, false, false];
  put("chiseled_bookshelf", SHELF.x, SHELF.y, SHELF.z, { facing: "south", ...Object.fromEntries(slots.map((on, i) => [`slot_${i}_occupied`, String(on)])) });
  put("gohans:book_pulled", SHELF.x, SHELF.y, SHELF.z + 1, { facing: "south" });

  // the tunnel: carve, rail, then line every face left open with rock
  const air = new Set();
  const hole = (x, y, z) => air.add(`${x},${y},${z}`);
  for (let z = -2; z >= TUNNEL.end; z--) { const y = RAIL_Y(z); for (let dy = 0; dy <= (z <= -2 && z >= -5 ? 2 : 1); dy++) hole(TUNNEL.x, y + dy, z); }
  // the firewall: netherrack jambs and lintel with fire hanging off them over the line
  const fy = RAIL_Y(TUNNEL.fire);
  for (const [dx, dy] of [[-1, 0], [-1, 1], [1, 0], [1, 1], [0, 2], [-1, 2], [1, 2]]) put("netherrack", TUNNEL.x + dx, fy + dy, TUNNEL.fire);
  put("fire", TUNNEL.x, fy, TUNNEL.fire, { east: "true", west: "true", up: "false", north: "false", south: "false", age: "0" });
  put("fire", TUNNEL.x, fy + 1, TUNNEL.fire, { east: "true", west: "true", up: "true", north: "false", south: "false", age: "0" });
  for (const z of TORCHES) put("redstone_wall_torch", TUNNEL.x, RAIL_Y(z) + 1, z, { facing: "east", lit: "true" });
  for (const k of air) {
    const [x, y, z] = k.split(",").map(Number);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = `${x + dx},${y + dy},${z + dz}`;
      if (!air.has(n) && !at.has(n)) put(pick(ROCK), x + dx, y + dy, z + dz);
    }
  }

  // the desk: the trapdoor plate over the slot's and the CRT's cells, the cabinet (which carries its own plate) under the
  // printer's; the CRT and its keyboard are the studio's computer chip (src/variants.ts)
  for (const x of [DESK.slot, DESK.crt]) put("iron_trapdoor", x, 0, DESK.z, { facing: "south", half: "top", open: "false" });
  put("gohans:file_cabinet", DESK.printer, 0, DESK.z, { facing: "south" });
  put("gohans:submit_slot", DESK.slot, 1, DESK.z, { facing: "south" });
  put("gohans:trace_printer", DESK.printer, 1, DESK.z, { facing: "south" });
  put("black_bed", BED.x, 0, BED.head, { facing: "north", part: "head", occupied: "false" });
  put("black_bed", BED.x, 0, BED.head + 1, { facing: "north", part: "foot", occupied: "false" });
  // a closed door's panel lies on the side away from its facing: "south" puts it flush with the room's side of the wall
  for (const [dx, y] of [[-1, 0], [-1, 1], [-1, 2], [0, 2], [1, 2], [1, 1], [1, 0]]) put("polished_deepslate", DOOR.x + dx, y, DOOR.z);
  put("iron_door", DOOR.x, 0, DOOR.z, { facing: "south", half: "lower", hinge: "left", open: "false", powered: "false" });
  put("iron_door", DOOR.x, 1, DOOR.z, { facing: "south", half: "upper", hinge: "left", open: "false", powered: "false" });
  put("stone_button", DOOR.x - 1, 1, ROOM.z1, { face: "wall", facing: "north", powered: "false" }); // the door's dead call button
  // the crater's bed, last so its seeded picks leave every block above as it was
  for (const [x, z] of CRATER) put(pick(CRATER_BED), x, TRAP[1] - 1, z);
  put("stone", TRAP[0], TRAP[1] - 2, TRAP[2]);
  return blocks;
}
