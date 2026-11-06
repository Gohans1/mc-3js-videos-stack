// Puts the demo's outside files in place, all gitignored: in demo/public/vendor Steve's skin out of the game's client jar
// (Mojang's: never commit or publish it) and MCprep's player rig (CC-BY 3.0, BoxScape Studios + TheDuckCow); in
// demo/public/motion/mixamo the Mixamo clips the mocap scene plays (free to use in a film, never to redistribute as files).
// Paths: env JAR, RIG, MOTION.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";

const MOTION = process.env.MOTION ?? "E:/mc_vault/motion";
const CLIPS = ["Being_Surprised_And_Looking_Right_c9c8214a", "Breathing_Idle_c9c6d0d5"];
const JAR = process.env.JAR ?? "E:/mc_vault/jar/client_assets.zip", RIG = process.env.RIG ?? "E:/mc_vault/mcprep/player.glb";
const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
const out = new URL("./public/vendor/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("steve.png", out), unzipSync(readFileSync(JAR), { filter: (f) => f.name === SKIN })[SKIN]);
copyFileSync(RIG, new URL("player.glb", out));
const mix = new URL("./public/motion/mixamo/", import.meta.url);
mkdirSync(mix, { recursive: true });
for (const c of CLIPS) copyFileSync(`${MOTION}/mixamo/${c}.fbx`, new URL(`${c}.fbx`, mix));
console.log(`demo/public/vendor: steve.png, player.glb; demo/public/motion/mixamo: ${CLIPS.length} clips`);
