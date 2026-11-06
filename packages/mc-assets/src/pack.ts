// @ts-nocheck
// The shared props (pack/assets/gohans): things the game lacks, written as vanilla Java block models on the game's own
// textures, so Blockbench opens them and block-model-renderer lights them like every other block. Bundled into the page
// and served from memory as a block-model-renderer source, stacked above client.jar: createScene([props, ...film's, jar]).
// A new prop for every film: its blockstate and model in pack/assets/gohans, imported here (both bundlers need a plain
// import per file). A prop only one film needs: that film's own pack, the same way through packOf.
import computerS from "../pack/assets/gohans/blockstates/computer.json";
import computerM from "../pack/assets/gohans/models/block/computer.json";
import beigeS from "../pack/assets/gohans/blockstates/computer_beige.json";
import beigeM from "../pack/assets/gohans/models/block/computer_beige.json";
import blackS from "../pack/assets/gohans/blockstates/computer_black.json";
import blackM from "../pack/assets/gohans/models/block/computer_black.json";
import steelS from "../pack/assets/gohans/blockstates/computer_steel.json";
import steelM from "../pack/assets/gohans/models/block/computer_steel.json";
import computerKS from "../pack/assets/gohans/blockstates/computer_keys.json";
import computerKM from "../pack/assets/gohans/models/block/computer_keys.json";
import beigeKS from "../pack/assets/gohans/blockstates/computer_beige_keys.json";
import beigeKM from "../pack/assets/gohans/models/block/computer_beige_keys.json";
import blackKS from "../pack/assets/gohans/blockstates/computer_black_keys.json";
import blackKM from "../pack/assets/gohans/models/block/computer_black_keys.json";
import steelKS from "../pack/assets/gohans/blockstates/computer_steel_keys.json";
import steelKM from "../pack/assets/gohans/models/block/computer_steel_keys.json";
import bedS from "../pack/assets/gohans/blockstates/iron_bed.json";
import bedM from "../pack/assets/gohans/models/block/iron_bed.json";
import cabinetS from "../pack/assets/gohans/blockstates/file_cabinet.json";
import cabinetM from "../pack/assets/gohans/models/block/file_cabinet.json";
import drawerS from "../pack/assets/gohans/blockstates/file_drawer.json";
import drawerM from "../pack/assets/gohans/models/block/file_drawer.json";
import folder0S from "../pack/assets/gohans/blockstates/folder_0.json";
import folder0M from "../pack/assets/gohans/models/block/folder_0.json";
import folder1S from "../pack/assets/gohans/blockstates/folder_1.json";
import folder1M from "../pack/assets/gohans/models/block/folder_1.json";
import folder2S from "../pack/assets/gohans/blockstates/folder_2.json";
import folder2M from "../pack/assets/gohans/models/block/folder_2.json";
import sheetS from "../pack/assets/gohans/blockstates/sheet.json";
import sheetM from "../pack/assets/gohans/models/block/sheet.json";
import scrapS from "../pack/assets/gohans/blockstates/paper_scrap.json";
import scrapM from "../pack/assets/gohans/models/block/paper_scrap.json";
import domeS from "../pack/assets/gohans/blockstates/cctv_dome.json";
import domeM from "../pack/assets/gohans/models/block/cctv_dome.json";

const MODELS = {
  computer: [computerS, computerM], computer_beige: [beigeS, beigeM], computer_black: [blackS, blackM], computer_steel: [steelS, steelM],
  computer_keys: [computerKS, computerKM], computer_beige_keys: [beigeKS, beigeKM], computer_black_keys: [blackKS, blackKM], computer_steel_keys: [steelKS, steelKM],
  iron_bed: [bedS, bedM], file_cabinet: [cabinetS, cabinetM], file_drawer: [drawerS, drawerM],
  folder_0: [folder0S, folder0M], folder_1: [folder1S, folder1M], folder_2: [folder2S, folder2M], sheet: [sheetS, sheetM],
  paper_scrap: [scrapS, scrapM], cctv_dome: [domeS, domeM],
};

/** A block-model-renderer source serving block models from memory: { "assets/<ns>/...json": parsed JSON }. */
export function packOf(files) {
  return {
    read: (path) => (path in files ? JSON.stringify(files[path]) : null),
    list: (dir) => {
      const at = dir.endsWith("/") ? dir : `${dir}/`;
      return Object.keys(files).filter((p) => p.startsWith(at)).map((p) => p.slice(at.length)).filter((p) => !p.includes("/"));
    },
  };
}

export const props = packOf(Object.fromEntries(Object.entries(MODELS).flatMap(([n, [s, m]]) => [
  [`assets/gohans/blockstates/${n}.json`, s], [`assets/gohans/models/block/${n}.json`, m],
])));
