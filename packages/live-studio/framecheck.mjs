// The encoded draft's picture faults; HELP below says how to run it
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { meter } from "./checks/frames.mjs";
import { cliArgs, envTypos, needFilm, numberArg } from "./src/cli.mjs";
import { staleVideo } from "./src/stale.mjs";

const HELP = `The last check before a video goes out, on the encoded file itself (what the audience gets): black frames, one-frame
flashes, jumps away from cuts, shimmering, frozen stretches (checks/frames.mjs). Run inside the film.
  bun run framecheck                        renders/draft_video.mp4 (make it with bun run render clip)
  bun run framecheck renders/chunks/c02.mp4  any video of the film; a chunk starts at its film second by itself (c02: 60 s),
                                             START=60 says it for any other video
Prints the faults and writes renders/frames_<KIND>_<s>.jpg for each (up to 12): the frame before, the frame, the frame
after. Cuts come from renders/cuts.json, which every bun run render clip writes, so a cut is never a JUMP. Render without LIST=1 for
this check (the list changes the picture). Only the picture is measured, never the draft's strip under it.`;
const [videoArg] = cliArgs(HELP, [], 1);
envTypos(["START", "LIVE_PROJECT"]);
needFilm(process.env.LIVE_PROJECT);

const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const RENDERS = join(PROJECT, "renders");
const video = resolve(PROJECT, videoArg ?? "renders/draft_video.mp4");
if (!existsSync(video)) {
  const videos = existsSync(RENDERS)
    ? readdirSync(RENDERS, { recursive: true })
        .map((f) => `renders/${String(f).replaceAll("\\", "/")}`)
        .filter((f) => f.endsWith(".mp4"))
        .toSorted()
        .slice(0, 8)
    : [];
  console.error(
    `no ${videoArg ?? "renders/draft_video.mp4"} (the videos here: ${videos.join(", ") || "none yet"}); a new one: bun run render clip`,
  );
  process.exit(1);
}

const probe = spawnSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate:format=format_name",
    "-of",
    "json",
    video,
  ],
  { encoding: "utf8" },
);
const probed = JSON.parse(probe.stdout || "{}");
const st = probed.streams?.[0];
// ffprobe reads a picture as a one-frame video stream: image2, png_pipe, ...
if (!st || /^image2|_pipe$/.test(probed.format?.format_name ?? "")) {
  console.error(
    `${videoArg ?? "renders/draft_video.mp4"} is no video: give it a render's mp4, as renders/draft_video.mp4 (bun run render clip)`,
  );
  process.exit(1);
}
const [num, den] = st.r_frame_rate.split("/").map(Number),
  fps = num / (den || 1);
const w = 192,
  h = Math.round((w * 9) / 16 / 2) * 2; // the 16:9 picture at the top of the frame, without a draft's strip
const cutsFile = join(RENDERS, "cuts.json");
// a render's chunk renders/chunks/cNN.mp4 starts at NN*30 s of the film (render.mjs CHUNK)
const chunkNo = /[\\/]chunks[\\/]c(\d+)\.mp4$/.exec(video)?.[1];
const START =
  process.env.START !== undefined
    ? numberArg("START", process.env.START, { min: 0 })
    : chunkNo
      ? Number(chunkNo) * 30
      : 0;
if (START)
  console.log(
    `film seconds from ${START} s on (${chunkNo && process.env.START === undefined ? "the chunk's start" : "START"})`,
  );
const cuts = (existsSync(cutsFile) ? JSON.parse(readFileSync(cutsFile, "utf8")) : []).map(
  (c) => c - START,
);
if (!cuts.length) console.log("no renders/cuts.json: every cut will show as a JUMP");
else
  console.log(
    `cuts from renders/cuts.json, the last bun run render clip's (${statSync(cutsFile).mtime.toLocaleString("sv").slice(0, 16)}): a video from an older render may show a moved cut as a JUMP`,
  );
const stale = staleVideo(PROJECT, video);
if (stale) console.log(`STALE: ${stale.message}`);

const m = meter(w, h);
let frames = 0;
const size = w * h * 3;
await new Promise((done, fail) => {
  const ff = spawn("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-vf",
    `crop=iw:trunc(iw*9/16/2)*2:0:0,scale=${w}:${h}:flags=area`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  const limit = setTimeout(() => {
    ff.kill();
    fail(new Error("ffmpeg took over 10 minutes"));
  }, 600e3);
  let held = Buffer.alloc(0);
  ff.stdout.on("data", (d) => {
    held = Buffer.concat([held, d]);
    while (held.length >= size) {
      m.push(held.subarray(0, size));
      frames++;
      held = held.subarray(size);
    }
  });
  ff.stderr.on("data", (d) => process.stderr.write(d));
  ff.on("close", (code) => {
    clearTimeout(limit);
    if (code) fail(new Error(`ffmpeg exited ${code}`));
    else done();
  });
});

const { lines, faults } = m.report(
  fps,
  cuts.filter((c) => c >= 0),
);
// film seconds in what is printed and in the file names; the video's own seconds to seek in it
const film = (s) => (s + START).toFixed(2);
for (const l of lines)
  console.log(
    l.replace(
      /^( {2}[A-Z]+ )([\d.]+)(?:-([\d.]+))?/,
      (_, k, a, b) => `${k}${film(+a)}${b ? `-${film(+b)}` : ""}`,
    ),
  );
for (const x of faults.slice(0, 12)) {
  const name = `frames_${x.kind}_${film(x.t)}.jpg`;
  // tile packs 3 frames into one picture and -frames:v counts pictures: 3 kept the third, frames 6-8 after the seek
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    Math.max(0, x.t - 1 / fps).toFixed(4),
    "-i",
    video,
    "-vf",
    "scale=640:-2,tile=3x1",
    "-frames:v",
    "1",
    join(RENDERS, name),
  ]);
  console.log(
    r.status === 0
      ? `wrote renders/${name} (before, at, after)`
      : `ERROR could not write renders/${name}`,
  );
}
if (faults.length > 12) console.log(`${faults.length - 12} more not drawn`);
if (faults.length)
  console.log(
    `next: look at the frames_*.jpg; bun run at ${film(faults[0].t)} names the shot, camera, transition and rows playing there (a planned cut or freeze is fine); fix the scene, re-render only that stretch (CHUNKS=${[...new Set(faults.map((x) => Math.floor((x.t + START) / 30)))].join(",")} bun run render clip: chunk N is N*30 s on), then bun run framecheck again`,
  );
// a clean file is not a good one: what the meter cannot judge is left to the eye
else
  console.log(
    `next: the meter judges only faults; look at it yourself: bun run sheet ${videoArg ?? "renders/draft_video.mp4"} ${[0.2, 0.5, 0.8].map((k) => +(START + (k * frames) / fps).toFixed(1)).join(",")}`,
  );
