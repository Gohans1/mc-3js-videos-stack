// Runs after every install: block-model-renderer finds its wasm next to the page bundle and its block entity pack at
// configure({ assetsUrl }), and a bundled build loses the module URL both would otherwise resolve from
import { copyFileSync, mkdirSync } from "node:fs";

const from = new URL("../node_modules/block-model-renderer/", import.meta.url);
const to = new URL("../assets/public/", import.meta.url);
mkdirSync(new URL("vendor/", to), { recursive: true });
copyFileSync(new URL("dist/block_model_renderer_bg.wasm", from), new URL("block_model_renderer_bg.wasm", to));
copyFileSync(new URL("assets.zip", from), new URL("vendor/bmr_assets.zip", to));
