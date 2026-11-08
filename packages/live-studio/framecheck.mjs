// The last check before a video goes out, on the encoded file itself (what the audience gets, after the encoder and the
// chunk joins): black frames, one-frame flashes, jumps away from cuts, shimmering, frozen stretches (src/frames.mjs).
//   node node_modules/live-studio/framecheck.mjs [video]   inside a film; default renders/draft_video.mp4
//   START=60 node ... renders/chunks/c02.mp4   a part of the film: the second of the film it starts at, for times and cuts
// Prints the faults and writes renders/frames_<KIND>_<s>.jpg for each (up to 12): the frame before, the frame, the frame
// after. Cuts come from renders/cuts.json, which every render writes, so a cut is never a JUMP. A draft drawn with the list
// (draw.describe) changes when the list does: render the clip with NOLIST=1 for this check. The draft timestamp corner is
// left out.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { meter } from "./src/frames.mjs";

const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const RENDERS = join(PROJECT, "renders");
const video = resolve(PROJECT, process.argv[2] ?? "renders/draft_video.mp4");
if (!existsSync(video)) { console.error(`no ${video}: render it first (NOLIST=1 bun run render clip)`); process.exit(1); }

const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", video], { encoding: "utf8" });
const st = JSON.parse(probe.stdout || "{}").streams?.[0];
if (!st) { console.error(`ffprobe cannot read ${video}`); process.exit(1); }
const [num, den] = st.r_frame_rate.split("/").map(Number), fps = num / (den || 1);
const w = 192, h = Math.round((w * st.height) / st.width / 2) * 2;
const cutsFile = join(RENDERS, "cuts.json");
const START = +(process.env.START ?? 0);
const cuts = (existsSync(cutsFile) ? JSON.parse(readFileSync(cutsFile, "utf8")) : []).map((c) => c - START);
if (!cuts.length) console.log("no renders/cuts.json: every cut will show as a JUMP");

// the draft timestamp box, top right (page.ts draws it at W-162..W-10, 10..46 on 1280x720)
const m = meter(w, h, (x, y) => !(x >= w * (1 - 175 / 1280) && y <= h * (50 / 720)));
const size = w * h * 3;
await new Promise((done, fail) => {
  const ff = spawn("ffmpeg", ["-v", "error", "-i", video, "-vf", `scale=${w}:${h}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const limit = setTimeout(() => { ff.kill(); fail(new Error("ffmpeg took over 10 minutes")); }, 600e3);
  let held = Buffer.alloc(0);
  ff.stdout.on("data", (d) => {
    held = Buffer.concat([held, d]);
    while (held.length >= size) { m.push(held.subarray(0, size)); held = held.subarray(size); }
  });
  ff.stderr.on("data", (d) => process.stderr.write(d));
  ff.on("close", (code) => { clearTimeout(limit); code ? fail(new Error(`ffmpeg exited ${code}`)) : done(); });
});

const { lines, faults } = m.report(fps, cuts.filter((c) => c >= 0));
// film seconds in what is printed and in the file names; the video's own seconds to seek in it
const film = (s) => (s + START).toFixed(2);
for (const l of lines) console.log(l.replace(/^( {2}[A-Z]+ )([\d.]+)(?:-([\d.]+))?/, (_, k, a, b) => `${k}${film(+a)}${b ? `-${film(+b)}` : ""}`));
for (const x of faults.slice(0, 12)) {
  const name = `frames_${x.kind}_${film(x.t)}.jpg`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, x.t - 1 / fps).toFixed(4), "-i", video, "-frames:v", "3", "-vf", "scale=640:-2,tile=3x1", "-update", "1", join(RENDERS, name)]);
  console.log(r.status === 0 ? `wrote renders/${name} (before, at, after)` : `ERROR could not write renders/${name}`);
}
if (faults.length > 12) console.log(`${faults.length - 12} more not drawn`);
