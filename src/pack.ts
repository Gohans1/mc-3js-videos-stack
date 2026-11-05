// @ts-nocheck
// The film's own resource pack (pack/assets/gohans): props the game lacks, written as vanilla Java block models on the
// game's own textures, so Blockbench opens them and block-model-renderer lights them like every other block. Bundled
// into the page and served from memory as a block-model-renderer virtual handler, stacked above client.jar.
import computerState from "../pack/assets/gohans/blockstates/computer.json";
import computerModel from "../pack/assets/gohans/models/block/computer.json";
import beigeState from "../pack/assets/gohans/blockstates/computer_beige.json";
import beigeModel from "../pack/assets/gohans/models/block/computer_beige.json";
import blackState from "../pack/assets/gohans/blockstates/computer_black.json";
import blackModel from "../pack/assets/gohans/models/block/computer_black.json";
import steelState from "../pack/assets/gohans/blockstates/computer_steel.json";
import steelModel from "../pack/assets/gohans/models/block/computer_steel.json";
import bedState from "../pack/assets/gohans/blockstates/iron_bed.json";
import bedModel from "../pack/assets/gohans/models/block/iron_bed.json";

const FILES = {
  "assets/gohans/blockstates/computer.json": computerState,
  "assets/gohans/models/block/computer.json": computerModel,
  "assets/gohans/blockstates/computer_beige.json": beigeState,
  "assets/gohans/models/block/computer_beige.json": beigeModel,
  "assets/gohans/blockstates/computer_black.json": blackState,
  "assets/gohans/models/block/computer_black.json": blackModel,
  "assets/gohans/blockstates/computer_steel.json": steelState,
  "assets/gohans/models/block/computer_steel.json": steelModel,
  "assets/gohans/blockstates/iron_bed.json": bedState,
  "assets/gohans/models/block/iron_bed.json": bedModel,
};

export const pack = {
  read: (path) => (path in FILES ? JSON.stringify(FILES[path]) : null),
  list: (dir) => {
    const at = dir.endsWith("/") ? dir : `${dir}/`;
    return Object.keys(FILES).filter((p) => p.startsWith(at)).map((p) => p.slice(at.length)).filter((p) => !p.includes("/"));
  },
};
