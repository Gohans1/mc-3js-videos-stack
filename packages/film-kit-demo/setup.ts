// Puts the demo's outside files in place, all gitignored: in public/vendor Steve's skin out of the game's client jar
// (Mojang's: never commit or publish it) and MCprep's player rig (CC-BY 3.0, BoxScape Studios + TheDuckCow); in
// public/motion/mixamo the Mixamo clips the mocap scene plays (free to use in a film, never to redistribute as files).
// Paths: env JAR, RIG, MOTION.
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
const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
const out = new URL("./public/vendor/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(
  new URL("steve.png", out),
  unzipSync(new Uint8Array(readFileSync(JAR)), { filter: (f) => f.name === SKIN })[SKIN],
);
copyFileSync(RIG, new URL("player.glb", out));
const mix = new URL("./public/motion/mixamo/", import.meta.url);
mkdirSync(mix, { recursive: true });
for (const c of CLIPS) copyFileSync(`${MOTION}/mixamo/${c}.fbx`, new URL(`${c}.fbx`, mix));
console.log(`public/vendor: steve.png, player.glb; public/motion/mixamo: ${CLIPS.length} clips`);
