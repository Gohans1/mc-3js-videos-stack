// @ts-nocheck
import { mulberry32 } from "math/random";

import { BREACH_OPENING, CRATE_BASE_BLOCK, ROOM } from "./breach-layout";

export { ROOM };

const WALL = [["stone_bricks"], ["cracked_stone_bricks", 0.16], ["mossy_stone_bricks", 0.1]];
const FLOOR = [["oak_planks"]];
const COURTYARD = [["cobblestone"], ["mossy_cobblestone", 0.25], ["gravel", 0.08]];
const CEILING = [["smooth_stone"], ["stone", 0.15]];

export function buildWorld() {
  const seed = mulberry32.create(42);
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

  // Interior floor (y = -1 -> surface at y = 0) and ceiling (y = top + 1 -> underside at y = 4)
  for (let x = -1; x <= x1 + 1; x++) {
    for (let z = -1; z <= z1; z++) {
      put(z === z1 ? "cobblestone" : pick(FLOOR), x, -1, z);
    }
    // Ceiling extends 1 block past z1 to form a bunker brow and seal the top wall corner seam
    for (let z = -1; z <= z1 + 1; z++) {
      put(pick(CEILING), x, top + 1, z);
    }
    // Outdoor courtyard ground behind the breach wall (open sky above)
    for (let z = z1 + 1; z <= z1 + 6; z++) {
      put(pick(COURTYARD), x, -1, z);
    }
  }

  // Low ruin parapet at the back of the outer courtyard so the horizon reads naturally through the hole
  for (let x = -1; x <= x1 + 1; x++) {
    put(pick(WALL), x, 0, z1 + 6);
    if (x < 2 || x > 4) put(pick(WALL), x, 1, z1 + 6);
  }

  // Side walls (x = -1, x = x1 + 1), back wall (z = -1), and front wall (z = z1) with 3x3 breach hole left open
  for (let y = 0; y <= top; y++) {
    for (let z = -1; z <= z1 + 1; z++) {
      put(pick(WALL), -1, y, z);
      put(pick(WALL), x1 + 1, y, z);
    }
    for (let x = 0; x <= x1; x++) {
      put(pick(WALL), x, y, -1);
      const inBreach =
        x >= BREACH_OPENING.x0 &&
        x <= BREACH_OPENING.x1 &&
        y >= BREACH_OPENING.y0 &&
        y <= BREACH_OPENING.y1;
      if (!inBreach) put(pick(WALL), x, y, BREACH_OPENING.z);
    }
  }

  // Static oak crate base inside the room holding up the top dynamic barrel
  put("oak_planks", CRATE_BASE_BLOCK[0], CRATE_BASE_BLOCK[1], CRATE_BASE_BLOCK[2]);

  // Warm hanging lanterns up near the back corners, clear of debris
  put("lantern", 0, top, 1, { hanging: "true" });
  put("lantern", x1, top, 1, { hanging: "true" });

  return blocks;
}
