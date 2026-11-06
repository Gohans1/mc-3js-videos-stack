// Puts the demo's two outside files in demo/public/vendor (gitignored): Steve's skin out of the game's client jar (Mojang's:
// never commit or publish it) and MCprep's player rig (CC-BY 3.0, BoxScape Studios + TheDuckCow). Paths: env JAR, RIG.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";

const JAR = process.env.JAR ?? "E:/mc_vault/jar/client_assets.zip", RIG = process.env.RIG ?? "E:/mc_vault/mcprep/player.glb";
const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
const out = new URL("./public/vendor/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("steve.png", out), unzipSync(readFileSync(JAR), { filter: (f) => f.name === SKIN })[SKIN]);
copyFileSync(RIG, new URL("player.glb", out));
console.log("demo/public/vendor: steve.png, player.glb");
