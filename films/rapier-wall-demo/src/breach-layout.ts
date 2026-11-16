// @ts-nocheck
import { mulberry32 } from "math/random";

export const ROOM = { x1: 6, z1: 6, top: 3 };
export const T_BOOM = 2.25;
export const BREACH_FPS = 30;
export const SIM_DURATION = 5.2; // simulates 2.25s .. 7.45s

export const BREACH_OPENING = {
  x0: 2,
  x1: 4, // inclusive -> spans x: 2..5
  y0: 0,
  y1: 2, // inclusive -> spans y: 0..3
  z: 6, // wall sits at z: 6..7, inner face facing room is z = 6.0
};

export const CRATE_BASE_BLOCK = [5, 0, 4]; // static oak_planks pedestal in world.ts -> world x:5..6, y:0..1, z:4..5
export const STEVE_WAIT = [0.95, 0, 3.1];

export const DYNAMIC_PROPS = [
  { id: "barrel-top", block: "barrel", size: 0.94, start: [5.5, 1.47, 4.5], density: 0.95 },
  { id: "barrel-floor", block: "barrel", size: 0.94, start: [5.15, 0.47, 3.35], density: 1.0 },
];

const CHUNK_KINDS = ["stone_bricks", "cracked_stone_bricks", "mossy_stone_bricks"];

export function buildWallChunks() {
  const rng = mulberry32.create(9042);
  const chunks = [];
  const half = 0.246;
  for (let iy = 0; iy < 6; iy++) {
    for (let ix = 0; ix < 6; ix++) {
      for (let iz = 0; iz < 2; iz++) {
        // Leave one small peep crack at front-center so the blinking TNT glow shines into the room
        if (ix === 2 && iy === 2 && iz === 0) continue;
        const r = mulberry32.sample(rng);
        const kind = r < 0.56 ? CHUNK_KINDS[0] : r < 0.86 ? CHUNK_KINDS[1] : CHUNK_KINDS[2];
        chunks.push({
          id: `chunk_${ix}_${iy}_${iz}`,
          kind,
          half,
          start: [
            BREACH_OPENING.x0 + 0.25 + ix * 0.5,
            BREACH_OPENING.y0 + 0.25 + iy * 0.5,
            BREACH_OPENING.z + 0.25 + iz * 0.5,
          ],
        });
      }
    }
  }
  return chunks;
}

export const TNT_ORIGIN = [3.5, 0.5, 7.25];
export const BLAST_ORIGIN = [3.5, 1.3, 7.15];
