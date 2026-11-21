// The encoded draft's picture faults; HELP below says how to run it
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";

import { JUMP_MIN, meter } from "./checks/frames.mjs";
import { cliArgs, envTypos, jsonFile, needFilm, secondArg } from "./src/cli.mjs";
import { ratioOf, sizeOf } from "./src/frame.ts";
import { referenceVideo } from "./src/ref-cuts.mjs";
import { staleVideo } from "./src/stale.mjs";
import { startJob } from "./src/tell.mjs";
import { filmVideo, probeVideo, renderCuts } from "./src/video.mjs";

const HELP = `Measure encoded picture faults: black frames, one-frame
flashes, jumps away from cuts, shimmering, frozen stretches (checks/frames.mjs). Run inside the film.
  bun run framecheck                        renders/draft_video.mp4 (make it with bun run render clip)
  bun run framecheck renders/chunks/c02.mp4  any video of the film; a chunk or a span starts at its film second by itself
                                             (c02: 60 s, span_40-44.mp4: 40 s), START=60 says it for any other video
A Short (package.json "live-studio".ratio "9:16") is measured at its own shape, the whole picture.
  bun run framecheck [video] --json          JSON report on stdout; progress on stderr
  bun run framecheck [video] --vs <ref.mp4>  weigh each JUMP and FLASH against the reference at the same heard second
                                             (a current render does it by itself with the film's references/ video):
                                             "ref jumps too" is a move the remake copies, "OURS ONLY" a pop to look at
                                             first; OURS ONLY faults get the strips first
Saves each run's report and up to 12 fault strips in renders/framecheck_*/. A current render can use its own cut metadata to skip abrupt changes near planned cuts. External files use file seconds and the full frame.
START gives a manual time offset. Use sheet <video> frames for native image detail at a precise requested time.
Render without LIST=1: the shot list changes the picture. Exit 0 means measurement finished; read the findings.`;
const args = cliArgs(HELP, ["--json", "--vs <video>"], 1);
const vsAt = args.indexOf("--vs");
const videoArg = args.find((a, i) => !a.startsWith("--") && (vsAt < 0 || i !== vsAt + 1));
const log = args.includes("--json") ? console.error : console.log;
envTypos(["START", "LIVE_PROJECT"]);
needFilm(process.env.LIVE_PROJECT);

const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const RENDERS = join(PROJECT, "renders");
const video = resolve(PROJECT, videoArg ?? "renders/draft_video.mp4");
if (vsAt >= 0 && !existsSync(resolve(PROJECT, args[vsAt + 1]))) {
  console.error(`no ${args[vsAt + 1]}: --vs takes the reference video, as references/ref.mp4`);
  process.exit(2);
}
// a broken film file is a fault in the film: named, exit 1
const readJson = (file) => {
  try {
    return jsonFile(file, PROJECT);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
};
const listRenderVideos = (rootDir) => {
  const found = [];
  const walk = (dir, prefix = "") => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else if (e.isFile() && e.name.endsWith(".mp4")) found.push(`renders/${rel}`);
    }
  };
  walk(rootDir);
  return found.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 8);
};
if (!existsSync(video)) {
  const videos = existsSync(RENDERS) ? listRenderVideos(RENDERS) : [];
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
const { fps, origin = 0 } = probed;
const shown = (videoArg ?? "renders/draft_video.mp4").replaceAll("\\", "/");
const render = filmVideo(PROJECT, video);
const stale = staleVideo(PROJECT, video);
const where = render ?? { start: 0, final: false, mixed: false };
const requestedStart =
  process.env.START !== undefined ? secondArg("START", process.env.START) : where.start;
const manual = Math.abs(requestedStart - where.start) > 1e-6;
const START = manual ? requestedStart : where.start;
const timeline = Boolean(render && !stale && !manual);
const clock = manual ? "manual" : render ? "film" : "file";
if (START)
  log(
    `${clock === "manual" ? "manual seconds" : "film seconds"} from ${START} s on (${process.env.START !== undefined ? "START" : `the ${where.kind}'s start`})`,
  );
else log(`Reading ${clock} seconds from 0`);
if (stale) log(`STALE: ${stale.message}`);
if (!timeline) log("Film cuts and timeline links omitted for this file or offset.");

const useLayout = render && !stale;
const ratio = useLayout
  ? ratioOf(readJson(join(PROJECT, "package.json")))
  : probed.height > probed.width
    ? "9:16"
    : "16:9";
const [w, h] = sizeOf(ratio, 192);
const tall = ratio === "9:16" ? "16/9" : "9/16";
const crop = useLayout ? `crop=iw:min(ih\\,trunc(iw*${tall}/2)*2):0:0,` : "";
const filter = `showinfo=checksum=0,${crop}scale=${w}:${h}:flags=area`;
// the reference's frame-to-frame change (mean per pixel, 0-1) at the film's rate from `from` s, filled to this shape
function refChanges(file, from, seconds) {
  const r = meter(w, h);
  return new Promise((done, fail) => {
    const ff = spawn("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(from),
      "-t",
      String(seconds),
      "-i",
      file,
      "-an",
      "-vf",
      `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=area,crop=${w}:${h}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ]);
    const limit = setTimeout(() => {
      ff.kill();
      fail(new Error("ffmpeg took over 5 minutes"));
    }, 300e3);
    let held = Buffer.alloc(0),
      said = "";
    ff.stdout.on("data", (d) => {
      held = Buffer.concat([held, d]);
      while (held.length >= size) {
        r.push(held.subarray(0, size));
        held = held.subarray(size);
      }
    });
    ff.stderr.on("data", (d) => (said = (said + d).slice(-500)));
    ff.on("error", (err) => {
      clearTimeout(limit);
      fail(err);
    });
    ff.on("close", (code) => {
      clearTimeout(limit);
      if (code !== 0) fail(new Error(`ffmpeg exited ${code}: ${said.trim()}`));
      else done(r.report(fps).D);
    });
  });
}
const cutInfo = timeline ? renderCuts(PROJECT, video) : null;
if (cutInfo?.reason) log(cutInfo.reason);
const cuts = (cutInfo?.times ?? []).map((c) => c - START);
const ended = await startJob(PROJECT, "framecheck", { say: `Checking the frames of ${shown}` });
const m = meter(w, h);
let frames = 0;
const times = [];
let lastDuration;
const size = w * h * 3;
try {
  await new Promise((done, fail) => {
    const ff = spawn("ffmpeg", [
      "-xerror",
      "-v",
      "info",
      "-nostats",
      "-hide_banner",
      "-copyts",
      "-i",
      video,
      "-map",
      "0:V:0",
      "-vf",
      filter,
      "-fps_mode",
      "passthrough",
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
    let secondsPerTick = 0;
    let details = "";
    createInterface({ input: ff.stderr }).on("line", (line) => {
      if (!line.includes("Parsed_showinfo")) {
        details = (details + line + "\n").slice(-2000);
        return;
      }
      const base = /config in time_base: (\d+)\/(\d+)/.exec(line);
      if (base) secondsPerTick = Number(base[1]) / Number(base[2]);
      const stamp = /\bn:\s*\d+\s+pts:\s*(-?\d+)/.exec(line);
      if (stamp && secondsPerTick) {
        times.push(Number(stamp[1]) * secondsPerTick - origin);
        const duration = /\bduration:\s*(\d+)/.exec(line);
        lastDuration = duration ? Number(duration[1]) * secondsPerTick : undefined;
      }
    });
    ff.on("error", (err) => {
      clearTimeout(limit);
      fail(err);
    });
    ff.on("close", (code) => {
      clearTimeout(limit);
      if (code !== 0) fail(new Error(`ffmpeg exited ${code}: ${details.trim()}`));
      else done();
    });
  });
  if (!frames) throw new Error("no picture frames decoded");
  if (times.length !== frames)
    throw new Error("FFmpeg did not report a presentation timestamp for each decoded frame");
} catch (e) {
  console.error(`Could not measure ${shown}: ${e.message}`);
  await ended({ say: `Frame check failed for ${shown}`, level: "fail" });
  process.exit(1);
}

// only the cuts this video holds (nearCut in checks/frames.mjs reaches 1.5 frames either side)
const activeCuts = cuts.filter((c) => c >= times[0] - 1.5 / fps && c <= times.at(-1) + 2.5 / fps);
const { lines, faults, D } = m.report(fps, activeCuts, times, lastDuration);
// the reference at the same heard seconds: a jump or flash it has too is a move the remake copies, one it has not is ours
const refFile =
  vsAt >= 0 ? resolve(PROJECT, args[vsAt + 1]) : timeline ? referenceVideo(PROJECT) : null;
const refShown = vsAt >= 0 ? args[vsAt + 1] : refFile;
const sudden = faults.filter((x) => x.kind === "JUMP" || x.kind === "FLASH");
let weighed = false;
if (refFile && sudden.length) {
  const path = resolve(PROJECT, refFile);
  const from = Math.max(0, START + times[0] - 0.5);
  let refD = [];
  try {
    refD = await refChanges(path, from, START + times.at(-1) + 0.5 - from);
  } catch (e) {
    log(`the reference could not be read (${e.message}); faults are not weighed against it`);
  }
  for (const x of refD.length ? sudden : []) {
    const k = Math.round((x.t + START - from) * fps);
    const near = refD.slice(Math.max(1, k - 3), k + 4);
    if (!near.length) {
      x.ref = { said: "the reference ends before here" };
      continue;
    }
    const peak = Math.max(...near);
    const around = [
      ...refD.slice(Math.max(1, k - 12), Math.max(1, k - 3)),
      ...refD.slice(k + 4, k + 13),
    ].toSorted((a, b) => a - b);
    const median = Math.max(around[Math.floor(around.length / 2)] ?? 0, 0.002);
    // ours: the change of the frame flagged (a flash's way back too)
    const i = times.indexOf(x.t);
    const own = x.kind === "FLASH" ? Math.max(D[i] ?? 0, D[i + 1] ?? 0) : (D[i] ?? 0);
    const spike = peak > JUMP_MIN && peak > 3 * median;
    // the reference's fast moves are smeared and ours are sharp: the same move measures about half ours there, and a
    // reference changing a tenth of the picture a frame is moving fast itself
    const fast = peak >= 5 * JUMP_MIN;
    const asMuch = peak >= 0.5 * own;
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const both = `${pct(peak)} a frame, ours ${pct(own)}`;
    x.ref = {
      change: peak,
      oursChange: own,
      overMedian: peak / median,
      ours: !spike && !fast && !asMuch,
      said: spike
        ? `ref jumps too (${pct(peak)}, x${(peak / median).toFixed(1)} its median)`
        : fast
          ? `the reference moves fast here too (${both})`
          : asMuch
            ? `the reference moves about as much here (${both})`
            : `OURS ONLY: ours changes ${pct(own)}, the reference ${pct(peak)} a frame`,
    };
    weighed = true;
  }
  for (const [i, x] of faults.entries()) if (x.ref) lines[i + 1] += `; ${x.ref.said}`;
}
// film seconds in what is printed and in the file names; the video's own seconds to seek in it
const film = (s) => (s + START).toFixed(2);
const exact = (s) => (s + START).toFixed(9).replace(/\.?0+$/, "");
for (const l of lines)
  log(
    l.replace(
      /^( {2}[A-Z]+ )([\d.]+)(?:-([\d.]+))?/,
      (_, k, a, b) => `${k}${film(+a)}${b ? `-${film(+b)}` : ""}`,
    ),
  );
mkdirSync(RENDERS, { recursive: true });
const out = mkdtempSync(join(RENDERS, "framecheck_"));
const strips = new Map();
const artifacts = [];
// a pop the reference does not have is the one to look at first
const stripFaults = faults
  .toSorted((a, b) => Number(Boolean(b.ref?.ours)) - Number(Boolean(a.ref?.ours)))
  .slice(0, 12)
  .toSorted((a, b) => a.t - b.t);
const formats = new Map();
let formatError;
if (stripFaults.length) {
  const last = times.indexOf(stripFaults.at(-1).t);
  const through = times[Math.min(last + 1, times.length - 1)] + origin + 1;
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "V:0",
      "-read_intervals",
      `%${through.toFixed(9)}`,
      "-show_entries",
      "frame=best_effort_timestamp,width,height,sample_aspect_ratio,pix_fmt:stream=time_base:stream_side_data=rotation",
      "-of",
      "json",
      video,
    ],
    { encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    if (probe.status !== 0) throw new Error(probe.error?.message || probe.stderr?.trim());
    const data = JSON.parse(probe.stdout);
    const stream = data.streams[0];
    const [num, den] = stream.time_base.split("/").map(Number);
    const rotation =
      stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0;
    for (const picture of data.frames ?? []) {
      if (picture.best_effort_timestamp === undefined) continue;
      const [a, b] = (picture.sample_aspect_ratio ?? "").split(":").map(Number);
      const pixelAspect = a > 0 && b > 0 ? a / b : 1;
      const displayAspect = (picture.width / picture.height) * pixelAspect;
      const pts = (Number(picture.best_effort_timestamp) * num) / den;
      const key = [picture.width, picture.height, pixelAspect, picture.pix_fmt].join("/");
      formats.set(pts.toFixed(9), {
        key,
        aspect: Math.abs(rotation) % 180 === 90 ? 1 / displayAspect : displayAspect,
      });
    }
  } catch (error) {
    formatError = `could not verify strip frame formats: ${error.message}`;
  }
}
for (const [i, x] of stripFaults.entries()) {
  const name = `frames_${i}_${x.kind}_${film(x.t)}.jpg`;
  const frame = times.indexOf(x.t);
  const first = Math.max(0, frame - 1);
  const neighbors = times.slice(first, frame + 2).map((t) => t + origin);
  const geometry = neighbors.map((t) => formats.get(t.toFixed(9)));
  const path = join(out, name);
  const artifact = relative(PROJECT, path).replaceAll("\\", "/");
  const draw = (dest, expected, filters, seek) => {
    const from = (expected[0] - 0.000002).toFixed(9);
    const to = (expected.at(-1) + 0.000002).toFixed(9);
    const r = spawnSync(
      "ffmpeg",
      [
        "-nostdin",
        "-xerror",
        "-v",
        "info",
        "-hide_banner",
        "-nostats",
        "-y",
        ...seek,
        "-copyts",
        "-i",
        video,
        "-map",
        "0:V:0",
        "-vf",
        `select=between(t\\,${from}\\,${to}),${filters}`,
        "-frames:v",
        "1",
        "-noautoscale",
        "-update",
        "1",
        dest,
      ],
      { timeout: 30_000, encoding: "utf8" },
    );
    const stderr = r.stderr ?? "";
    let tick = 0;
    const frames = [];
    for (const [, num, den, n, pts] of stderr.matchAll(
      /config in time_base: (\d+)\/(\d+)|\bn:\s*(\d+)\s+pts:\s*(-?\d+)/g,
    )) {
      if (num) tick = Number(num) / Number(den);
      else frames.push({ index: Number(n), time: Number(pts) * tick });
    }
    const exact =
      frames.length === expected.length &&
      frames.every((p, j) => p.index === j && Math.abs(p.time - expected[j]) < 0.00001);
    if (r.status === 0 && existsSync(dest) && exact) return null;
    rmSync(dest, { force: true });
    return (
      r.error?.message ??
      ((r.status !== 0 && stderr.trim().split("\n").at(-1)) ||
        "FFmpeg did not produce the expected uninterrupted frame sequence")
    );
  };
  const read = (dest, expected, filters) => {
    const seek = Math.max(0, expected[0] - origin - 2 / fps);
    return seek > 0 && !draw(dest, expected, filters, ["-ss", seek.toFixed(9)])
      ? null
      : draw(dest, expected, filters, []);
  };
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  const known = geometry.every(
    (frame) => frame && Number.isFinite(frame.aspect) && frame.aspect > 0,
  );
  const formatChanges = known && geometry.some((frame) => frame.key !== geometry[0].key);
  let error = formatError ?? "could not match a strip timestamp to the decoded frame format";
  if (known && !formatChanges) {
    const height = even(640 / geometry[0].aspect);
    const filters = `scale=640:${height}:out_range=full:reset_sar=1,format=yuvj420p,showinfo=checksum=0,tile=3x1:nb_frames=${neighbors.length}`;
    error = read(path, neighbors, filters);
  }
  if ((formatChanges || error) && known && neighbors.length > 1) {
    // A format change reinitializes tile. Stage each frame on a fixed canvas first.
    const tiles = neighbors.map((_, j) => join(out, `.strip-${i}-${j}.jpg`));
    try {
      error = null;
      for (const [j, target] of tiles.entries()) {
        const aspect = geometry[j].aspect;
        const width = even(Math.min(640, 640 * aspect));
        const height = even(Math.min(640, 640 / aspect));
        const fit = `scale=${width}:${height}:out_range=full:reset_sar=1,format=yuvj420p,pad=640:640:(ow-iw)/2:(oh-ih)/2,showinfo=checksum=0`;
        error = read(target, [neighbors[j]], fit);
        if (error) break;
      }
      if (!error) {
        const stack = spawnSync(
          "ffmpeg",
          [
            "-nostdin",
            "-xerror",
            "-v",
            "error",
            "-y",
            ...tiles.flatMap((tile) => ["-i", tile]),
            "-filter_complex",
            `hstack=inputs=${tiles.length}`,
            "-frames:v",
            "1",
            "-update",
            "1",
            path,
          ],
          { timeout: 30_000, encoding: "utf8" },
        );
        if (stack.status !== 0 || !existsSync(path)) {
          error =
            stack.error?.message ?? (stack.stderr?.trim() || "FFmpeg did not write a fault strip");
          rmSync(path, { force: true });
        }
      }
    } finally {
      for (const tile of tiles) rmSync(tile, { force: true });
    }
  }
  if (!error) {
    strips.set(x, artifact);
    log(`wrote ${artifact} (up to three neighboring frames)`);
  } else {
    artifacts.push({ path: artifact, error });
    log(`ERROR could not write ${artifact}`);
  }
}
if (faults.length > 12) log(`${faults.length - 12} more not drawn`);
const index = join(out, "index.json");
const report = {
  source: {
    path: video,
    clock,
    start: START,
    fpsHint: fps,
    frames,
    pictureFrom: START + times[0],
    lastFrame: START + times.at(-1),
  },
  timeline: timeline ? "current" : stale ? "stale" : render ? "manual-offset" : "external",
  stale,
  cuts: cutInfo,
  reference: weighed ? refShown.replaceAll("\\", "/") : null,
  cutsUsed: activeCuts.map((c) => c + START),
  findings: faults.map((x) => ({
    kind: x.kind,
    fileTime: x.t,
    time: x.t + START,
    ...(x.to !== undefined && { fileEnd: x.to, end: x.to + START }),
    detail: x.say,
    ...(x.ref && { reference: x.ref }),
    strip: strips.get(x) ?? null,
  })),
  artifactErrors: artifacts,
  index: relative(PROJECT, index).replaceAll("\\", "/"),
};
writeFileSync(index, JSON.stringify(report, null, 2) + "\n");
log(`index: ${report.index}`);
if (args.includes("--json")) console.log(JSON.stringify(report));
await ended(
  faults.length
    ? {
        say: `Frames of ${shown}: ${faults.length} fault${faults.length > 1 ? "s" : ""} (${[...new Set(faults.map((x) => x.kind))].join(", ")})`,
        level: "warn",
        marks: timeline
          ? faults.map((x) => ({
              at: x.t + START,
              ...(x.to !== undefined && { to: x.to + START }),
              say: x.kind,
            }))
          : undefined,
      }
    : { say: `Frames of ${shown}: no black, flash, jump, shimmer or freeze`, level: "ok" },
);
// a mixed video (draft.mp4, final.mp4) gets its new picture through the mix again; the upload's picture goes on to deliver
// a START said by hand goes on with the commands that read the same video's seconds
const again = process.env.START !== undefined ? `START=${START} ` : "";
const mixed = where.mixed;
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
const showVideo = /\s/.test(shown) ? JSON.stringify(shown) : shown;
const focus =
  faults.find((fault) => fault.ref?.ours) ??
  faults.find((fault) => fault.kind !== "FROZEN") ??
  faults[0];
if (!timeline) {
  log(
    `next: ${again}bun run sheet ${showVideo} ${focus ? `frames ${exact(focus.t)}` : "overview"} (inspect the encoded picture)`,
  );
} else if (focus) {
  const time = exact(focus.t);
  let rows = false;
  try {
    const { whatsAt } = await import("../../scripts/at.ts");
    rows = Number(time) < whatsAt(PROJECT, Number(time)).length;
  } catch {}
  const context = rows
    ? `bun run at ${time} names the timeline rows`
    : `AT=${time} LIST=1 bun run render stills shows the live scene`;
  const redraw = where.span
    ? `SPAN=${where.span.join(",")} bun run render clip`
    : `CHUNKS=${[...new Set(faults.map((x) => Math.floor((x.t + START) / 30)))].join(",")} bun run render ${where.final ? "final" : "clip"}${remix}: chunk N is N*30 s on`;
  // checks/frames.mjs skips a flash or jump at a cut the render recorded, not a black or frozen run
  const cutsSaid = !cutInfo?.times
    ? "a planned cut or freeze is fine"
    : activeCuts.length
      ? `a flash or jump at the render's ${activeCuts.length === 1 ? "cut" : `${activeCuts.length} cuts`} here is left out already; a planned freeze or pop can stay`
      : "the render records no cut here; a planned freeze or pop can stay";
  log(
    `next: look at the strips listed above; ${context} (${cutsSaid}); if unintended, fix the scene and re-render that stretch (${redraw}), then ${again}bun run framecheck${videoArg ? ` ${showVideo}` : ""} again`,
  );
}
// a clean file is not a good one: what the meter cannot judge is left to the eye
else log(`next: inspect the picture: ${again}bun run sheet ${showVideo} overview${upload}`);
