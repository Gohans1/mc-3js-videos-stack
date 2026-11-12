// A film's postinstall (node ../../packages/mc-assets/vendor.mjs, run in the film folder): block-model-renderer finds its
// wasm next to the page bundle and its block entity pack at configure({ assetsUrl: "vendor/bmr_assets.zip" }), and a
// bundled build loses the module URL both would otherwise resolve from, so both are copied into the film's assets/public.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const bmr = join(import.meta.dirname, "node_modules/block-model-renderer");
const pub = join(process.cwd(), "assets/public");
mkdirSync(join(pub, "vendor"), { recursive: true });
copyFileSync(
  join(bmr, "dist/block_model_renderer_bg.wasm"),
  join(pub, "block_model_renderer_bg.wasm"),
);
copyFileSync(join(bmr, "assets.zip"), join(pub, "vendor/bmr_assets.zip"));
