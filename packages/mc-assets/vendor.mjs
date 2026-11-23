import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { cliArgs, needFilm } from "../live-studio/src/cli.mjs";

cliArgs(
  `Copies block-model-renderer's installed WASM and entity pack into a film's assets/public.
  bun ../../packages/mc-assets/vendor.mjs
Normally run by the film's postinstall. Run again after upgrading block-model-renderer; no download.
next: bun run check`,
  [],
  0,
);
needFilm();

const bmr = join(import.meta.dirname, "node_modules/block-model-renderer");
const pub = join(process.cwd(), "assets/public");
for (const file of ["dist/block_model_renderer_bg.wasm", "assets.zip"]) {
  if (!existsSync(join(bmr, file))) {
    console.error(`missing ${join(bmr, file)}: run bun install at the repo root, then retry`);
    process.exit(2);
  }
}
mkdirSync(join(pub, "vendor"), { recursive: true });
copyFileSync(
  join(bmr, "dist/block_model_renderer_bg.wasm"),
  join(pub, "block_model_renderer_bg.wasm"),
);
copyFileSync(join(bmr, "assets.zip"), join(pub, "vendor/bmr_assets.zip"));
console.log(`Renderer runtime copied to ${pub}\nnext: bun run check`);
