// Draft render: a few stills and the whole film as GPU-encoded 30 s chunks, joined into renders/draft_video.mp4 on C: (SSD).
// node src/render.mjs [stills|clip]   (no argument does both)
// CHUNKS=3,4 node src/render.mjs clip   re-renders only those chunks (film seconds 90-150) and re-joins the rest as they are
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const path = (p) => fileURLToPath(new URL("../" + p, import.meta.url));
const what = process.argv[2] ?? "all";
const FPS = 30;
const SECONDS = JSON.parse(readFileSync(path("src/edit.json"), "utf8")).end; // the scene needs a browser, so Node reads the length from edit.json
const bundleDir = path("renders/.bundle");
mkdirSync(bundleDir, { recursive: true });
const entry = process.env.ENTRY ?? "src/fast_page.ts";
await build({ entryPoints: [path(entry)], bundle: true, format: "esm", logLevel: "error", outfile: bundleDir + "/fast_page.js",
  alias: { zlib: path("src/shims/empty.js"), assert: path("src/shims/empty.js") } });

const CHUNK = 30;
const chunkDir = path("renders/chunks");
mkdirSync(chunkDir, { recursive: true });
const all = Array.from({ length: Math.ceil(SECONDS / CHUNK) }, (_, i) => i);
const pick = process.env.CHUNKS ? process.env.CHUNKS.split(",").map(Number) : all;
const chunkFile = (i) => `${chunkDir}/c${String(i).padStart(2, "0")}.mp4`;
const cfg = {
  W: 1280, H: 720, draft: true, quality: 0.9, timeoutS: 3600,
  public: path("assets/public"), mcassetCache: "E:/mc_vault/mcasset", bundleDir, stillDir: path("renders"),
  stills: what === "clip" ? [] : (process.env.AT ?? "0.5,3,7.5,9.5,13").split(",").map(Number).map((s) => ({ name: `still_${s}s.jpg`, frame: Math.round(s * FPS) })),
  jobs: what === "stills" ? [] : pick.map((i) => ({ index: i, start: i * CHUNK * FPS, stop: Math.min(SECONDS, (i + 1) * CHUNK) * FPS - 1, samples: 1, out: chunkFile(i) })),
  webcodecs: { bitrate: 4e6, hardware: "prefer-hardware" },
};
writeFileSync(bundleDir + "/config.json", JSON.stringify(cfg));
const t0 = Date.now();
const r = spawnSync("node", [path("src/fast_render.mjs"), bundleDir + "/config.json"], { stdio: "inherit" });
console.log(`render ${what}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (r.status === 0 && what !== "stills" && all.every((i) => existsSync(chunkFile(i)))) {
  // every chunk starts on a keyframe with the same encoder settings, so the join is a lossless stream copy
  writeFileSync(chunkDir + "/list.txt", all.map((i) => `file '${chunkFile(i)}'`).join("\n"));
  const j = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", chunkDir + "/list.txt", "-c", "copy", path("renders/draft_video.mp4")], { stdio: "inherit" });
  console.log(j.status === 0 ? "joined renders/draft_video.mp4" : "ERROR join failed");
}
process.exit(r.status ?? 1);
