// The encoded draft's picture faults; HELP below says how to run it
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { meter } from "./checks/frames.mjs";
import { cliArgs, envTypos, jsonFile, needFilm, secondArg } from "./src/cli.mjs";
import { ratioOf, sizeOf } from "./src/frame.ts";
import { staleVideo } from "./src/stale.mjs";
import { probeVideo, videoStart } from "./src/video.mjs";

const HELP = `The last check before a video goes out, on the encoded file itself (what the audience gets): black frames, one-frame
flashes, jumps away from cuts, shimmering, frozen stretches (checks/frames.mjs). Run inside the film.
  bun run framecheck                        renders/draft_video.mp4 (make it with bun run render clip)
  bun run framecheck renders/chunks/c02.mp4  any video of the film; a chunk or a span starts at its film second by itself
                                             (c02: 60 s, span_40-44.mp4: 40 s), START=60 says it for any other video
A Short (package.json "live-studio".ratio "9:16") is measured at its own shape, the whole picture.
Prints the faults and writes renders/frames_<KIND>_<s>.jpg for each (up to 12): the frame before, the frame, the frame
after (the last run's are cleared first). Cuts come from renders/cuts.json, which every bun run render clip writes, so a cut is never a JUMP. Render without LIST=1 for
this check (the list changes the picture). Only the picture is measured, never the draft's strip under it.`;
const [videoArg] = cliArgs(HELP, [], 1);
envTypos(["START", "LIVE_PROJECT"]);
needFilm(process.env.LIVE_PROJECT);

const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const RENDERS = join(PROJECT, "renders");
const video = resolve(PROJECT, videoArg ?? "renders/draft_video.mp4");
// a broken film file is a fault in the film: named, exit 1
const readJson = (file) => {
  try {
    return jsonFile(file, PROJECT);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
};
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
  process.exit(2);
}

const probed = probeVideo(video);
if (!probed) {
  console.error(
    `${videoArg ?? "renders/draft_video.mp4"} is no video: give it a render's mp4, as renders/draft_video.mp4 (bun run render clip)`,
  );
  process.exit(2);
}
const { fps } = probed;
// the picture at the top of the frame at the film's shape (a Short is 9:16), without a draft's strip under it
const ratio = ratioOf(readJson(join(PROJECT, "package.json")));
const [w, h] = sizeOf(ratio, 192),
  tall = ratio === "9:16" ? "16/9" : "9/16";
const cutsFile = join(RENDERS, "cuts.json");
const where = videoStart(video);
const START = process.env.START !== undefined ? secondArg("START", process.env.START) : where.start;
if (START)
  console.log(
    `film seconds from ${START} s on (${process.env.START !== undefined ? "START" : `the ${where.kind}'s start`})`,
  );
const written = existsSync(cutsFile) ? readJson(cutsFile) : [];
if (!Array.isArray(written) || written.some((c) => typeof c !== "number" || !(c >= 0))) {
  console.error("renders/cuts.json is no list of seconds: bun run render clip writes it again");
  process.exit(1);
}
const cuts = written.map((c) => c - START);
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
    // a video wider than the film's shape has no strip to cut: the whole frame (\, keeps min's comma in the filter)
    `crop=iw:min(ih\\,trunc(iw*${tall}/2)*2):0:0,scale=${w}:${h}:flags=area`,
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

// only the cuts this video holds (nearCut in checks/frames.mjs reaches 1.5 frames either side)
const { lines, faults } = m.report(
  fps,
  cuts.filter((c) => c >= -1.5 / fps && c <= (frames + 1.5) / fps),
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
// frames of faults since fixed would read as faults still there
mkdirSync(RENDERS, { recursive: true });
for (const f of readdirSync(RENDERS))
  if (/^frames_.*\.jpg$/.test(f)) rmSync(join(RENDERS, f), { force: true });
for (const x of faults.slice(0, 12)) {
  const name = `frames_${x.kind}_${film(x.t)}.jpg`;
  // tile packs 3 frames into one picture and -frames:v counts pictures: 3 kept the third, frames 6-8 after the seek
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    // half a frame before the frame before: a seek is to the first frame at or after it, and t - 1/fps rounded to
    // 4 places lands just past that frame a third of the time at 30 fps
    Math.max(0, x.t - 1.5 / fps).toFixed(4),
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
// a mixed video (draft.mp4, final.mp4) gets its new picture through the mix again; the upload's picture goes on to deliver
// a START said by hand goes on with the commands that read the same video's seconds
const again = process.env.START !== undefined ? `START=${START} ` : "";
const mixed = /^(draft|final)\.mp4$/.test(basename(video));
const remix =
  where.final || mixed
    ? `, then bun run mix renders/${where.final ? "final" : "draft"}_video.mp4`
    : "";
const upload =
  basename(video) === "final_video.mp4"
    ? "; then bun run mix renders/final_video.mp4, then bun run deliver (YouTube's spec)"
    : basename(video) === "final.mp4"
      ? "; then bun run deliver (YouTube's spec)"
      : "";
if (faults.length) {
  const redraw = where.span
    ? `SPAN=${where.span.join(",")} bun run render clip`
    : `CHUNKS=${[...new Set(faults.map((x) => Math.floor((x.t + START) / 30)))].join(",")} bun run render ${where.final ? "final" : "clip"}${remix}: chunk N is N*30 s on`;
  console.log(
    `next: look at the frames_*.jpg; bun run at ${film(faults[0].t)} names the shot, camera, transition and rows playing there (a planned cut or freeze is fine); fix the scene, re-render only that stretch (${redraw}), then ${again}bun run framecheck${videoArg ? ` ${videoArg}` : ""} again`,
  );
}
// a clean file is not a good one: what the meter cannot judge is left to the eye
else
  console.log(
    `next: the meter judges only faults; look at it yourself: ${again}bun run sheet ${videoArg ?? "renders/draft_video.mp4"} ${[0.2, 0.5, 0.8].map((k) => +(START + (k * frames) / fps).toFixed(1)).join(",")}${upload}`,
  );
