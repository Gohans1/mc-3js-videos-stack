import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const app = fileURLToPath(new URL("./app", import.meta.url));
// loudness-worklet's AudioWorklet file, which its exports map leaves out: the page loads it by URL (app/sound/meter.ts). A pattern,
// as a plain name never matches once ?url is on it
const loudnessWorklet = {
  find: /^loudness-worklet\/worklet(?=\?|$)/,
  replacement: join(
    dirname(createRequire(import.meta.url).resolve("loudness-worklet")),
    "loudness.worklet.js",
  ),
};

// The studio's own page. src/live.mjs adds the film (its code, its three, its edit.json) when it starts this for one film
export default defineConfig({
  root: app,
  plugins: [react(), tailwindcss()],
  resolve: { alias: [{ find: "@", replacement: app }, loudnessWorklet] },
});
