import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { unzipSync } from "fflate";

import { LOCAL } from "../../scripts/vault.mjs";

const MOTION = process.env.MOTION ?? join(LOCAL, "motion");
const CLIPS = [
  "Being_Surprised_And_Looking_Right_c9c8214a",
  "Breathing_Idle_c9c6d0d5",
  "Pushing_A_Button_With_The_Right_Hand_c9c8f267",
  "Big_Yawn_While_Standing_c9c98361",
  "Sighing_In_Relief_c9c92112",
  "Thinking_While_Standing_c9c990e8",
];
const JAR = process.env.JAR ?? join(LOCAL, "jar/client_assets.zip"),
  RIG = process.env.RIG ?? join(LOCAL, "mcprep/player.glb");
const SKINS = ["steve", "alex"].map((n) => `assets/minecraft/textures/entity/player/wide/${n}.png`);
const out = new URL("./public/vendor/", import.meta.url);
mkdirSync(out, { recursive: true });
const skins = unzipSync(new Uint8Array(readFileSync(JAR)), { filter: (f) => SKINS.includes(f.name) });
for (const s of SKINS) writeFileSync(new URL(s.split("/").pop()!, out), skins[s]!);
copyFileSync(RIG, new URL("player.glb", out));
const mix = new URL("./public/motion/mixamo/", import.meta.url);
mkdirSync(mix, { recursive: true });
for (const c of CLIPS) copyFileSync(`${MOTION}/mixamo/${c}.fbx`, new URL(`${c}.fbx`, mix));
console.log(`public/vendor: steve.png, alex.png, player.glb; public/motion/mixamo: ${CLIPS.length} clips`);
