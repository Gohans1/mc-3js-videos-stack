import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { cliArgs, needFilm, numberArg } from "../../packages/live-studio/src/cli.mjs";
import { heardLength } from "../../packages/live-studio/src/film.mjs";
import { killProcessTree } from "../../packages/live-studio/src/kill-process.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import { compactJson } from "../../packages/live-studio/src/timeline_file.mjs";
import { clockForTimeline } from "../../packages/live-studio/src/timing-state.mjs";
import { filmPicture } from "../../packages/live-studio/src/video.mjs";
import { writeAtomicSync } from "../../packages/live-studio/src/voice-map.mjs";
import { mediaPython } from "../media/home.mjs";
import { runSidebyside, runTimecode } from "./reference_video.mjs";

async function runWorker(executable, args, minutes) {
  const child = spawn(executable, args, {
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (child.pid) killProcessTree(child.pid, () => child.kill("SIGKILL"));
  };
  const timer = setTimeout(stop, minutes * 60_000);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let status;
  try {
    status = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done(code ?? 1));
    });
  } catch (error) {
    console.error(`reference: ${error.message}`);
    status = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }

  return { status, stopped };
}

const HELP = `Optional reference analysis; never required to author a film.
  bun run reference add <video> [--name ref]  Copy a downloaded reference into the film's references/; add --help
  bun run reference timecode <video> [--out <file>] [--label <text>]  Burn a black timecode bar below a copy for AI review; timecode --help
  bun run reference sidebyside <reference> <remake> [--out <file>]  Tile reference and remake into one synced video with shared timecode bar; sidebyside --help
  bun run reference inspect <video-or-URL>  Retained visual/transcript evidence; inspect --help for controls
  bun run reference study <video>
  bun run reference compare <reference> <remake>
  bun run reference solve <shot.json> [--write]  Matchmove one shot's camera from points of our set; solve --help
  --out <folder>     Reports and comparison PNGs (default renders/reference/<video-name> or compare).
  --fit              Compare after scaling the remake's time to the reference's length (compare only).
  --film <film.html> Optional OpenFilm project for the upstream reused-media check (compare only).
  --minutes <N>      Stop analysis and its FFmpeg processes after N minutes (default 5, maximum 60).
study/compare need local video files and ffmpeg/ffprobe on PATH; no account or paid API.
inspect uses Python 3.11+ and ffmpeg/ffprobe for pictures; URL sources additionally use yt-dlp.
inspect --detail transcript skips media download/decoding and never starts a speech model.
Writes study.json/study.md or compare.json/compare.md with side-by-side PNGs in a fresh run-* subfolder; earlier evidence is kept.
Cuts and pace are image-change estimates; flashes and equal-luminance cuts can fool them.
study also lists whip pans and the camera's move each frame once bun run media setup camera is done (tracked corners, not a solved camera).
Metrics and reused-media detection are advisory, not a quality gate or a copyright certificate.
Exit 0: analysis finished; 1: failed analysis OR detected reference-media reuse (read the report); 2: usage error.
Analysis keeps completed reports but does not resume decoding after interruption; use short reference clips.
Examples: bun run reference inspect references/ref.mp4 --scenes --frames 16
          bun run reference study references/ref.mp4
          bun run reference compare references/ref.mp4 renders/draft.mp4 --fit`;

const usage = (why) => {
  console.error(`${why}; bun run reference --help`);
  process.exit(2);
};

const ADD_HELP = `Copy a downloaded reference into the film's references/ under a plain name, run in films/<name>.
  bun run reference add <video> [--name ref] [--minutes 10]
An H.264 .mp4 up to 1920 px is copied as references/<name>.mp4.
Anything else (AV1, 4K, .mkv/.webm, ...) is kept byte for byte as references/<name>-source.<ext>,
and references/<name>.mp4 becomes an H.264 copy (CRF 18, long side 1920 at most, same frames;
AAC audio copied as it is, other audio AAC 256k).
Never replaces a file: an existing name stops it (exit 2) before anything is copied.
next: bun run reference study references/<name>.mp4`;

const SOLVE_HELP = `Solve one reference shot's camera from points of our set (a matchmove), run in films/<name>.
  bun run reference solve shots/pour.json [--video references/ref.mp4] [--write] [--minutes 10]
The shot file names reference seconds (from, to), the lens (fov in degrees, or null to fit it) and 4 or more
points of our set: xyz in world metres and where each shows in the reference, uv {second: [x, y]} in video pixels,
followed frame to frame between those seconds. Every field: scripts/media/camera_solve.py.
Read a uv off bun run sheet references/ref.mp4 frames 7.2 --grid 50 --crop 100,500,1000,1600 (the video's own pixels).
Writes solve.json (cam.json keys, the error of each frame) and sheet.jpg (cyan crosses solved, yellow rings tracked)
to a fresh renders/reference/solve/<name>/run-* folder; needs bun run media setup camera.
--write puts the keys into the film's camera timeline, a reference second as a heard second (a remake keeps the
reference's timing); the keys between from and to and earlier mm-<name>-* keys are replaced, and listed.
"to" is the shot's last frame: a span reaching another shot's cut key stops before writing.
Exit 0: solved; 1: failed or stopped, cam.json unchanged; 2: usage error.
next: look at sheet.jpg before --write`;

// the solved keys into package.json "live-studio".camTimeline: reference (heard) seconds become camera seconds through
// the film's edit, and they take over their span and any earlier solve of the same shot
const writeSolvedKeys = (film, name, solvedKeys) => {
  const conf = JSON.parse(readFileSync(join(film, "package.json"), "utf8"))["live-studio"] ?? {};
  if (!conf.camTimeline) {
    console.error(
      'reference solve: package.json has no "live-studio".camTimeline; the keys stay in solve.json',
    );
    process.exit(1);
  }
  const file = join(film, conf.camTimeline);
  const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const list = Array.isArray(data) ? data : data?.keys;
  if (!Array.isArray(list)) {
    console.error(`reference solve: ${conf.camTimeline} is neither a key list nor {keys}`);
    process.exit(1);
  }
  const camClock = heardLength(film, conf) ? clockForTimeline("cam") : null;
  const keys = solvedKeys.map((k) => ({
    ...k,
    t: +(camClock ? camClock.sourceAt(k.t) : k.t).toFixed(4),
  }));
  const [from, to] = [keys[0].t, keys.at(-1).t];
  const own = `mm-${name}-`;
  const replaced = list.filter(
    (k) => String(k?.id ?? "").startsWith(own) || (k?.t >= from - 1e-6 && k?.t <= to + 1e-6),
  );
  const cut = replaced.find((k) => k?.cut && k.t > from + 1e-6 && !String(k.id).startsWith(own));
  if (cut) {
    console.error(
      `reference solve: the shot runs into the cut ${JSON.stringify(cut.id ?? `t ${cut.t}`)} at ${cut.t} s in ${conf.camTimeline}; end "to" a frame before that shot. The camera timeline is unchanged`,
    );
    process.exit(1);
  }
  const merged = [...list.filter((k) => !replaced.includes(k)), ...keys].toSorted(
    (a, b) => a.t - b.t,
  );
  writeAtomicSync(
    file,
    `${compactJson(Array.isArray(data) ? merged : { ...data, keys: merged })}\n`,
  );
  const gone = replaced.map((k) => k.id ?? `t ${k.t}`);
  return `wrote ${keys.length} keys to ${conf.camTimeline} (camera seconds ${from}–${to})${gone.length ? `; replaced ${gone.length}: ${gone.join(", ")}` : ""}`;
};

if (process.argv[2] === "inspect") {
  const args = process.argv.slice(3);
  const help = args.includes("--help") || args.includes("-h") || args[0] === "help";
  if (args[0] === "help") args[0] = "--help";
  if (!help)
    cliArgs(
      "",
      [
        "--transcript file",
        "--detail mode",
        "--start T",
        "--end T",
        "--at TIMES",
        "--frames N",
        "--scenes",
        "--find text",
        "--out folder",
        "--minutes N",
        "--expect-source-sha256 SHA",
        "--language code",
        "--cookies file",
        "--cookies-from-browser browser",
        "--js-runtime runtime",
      ],
      1,
      args,
    );
  const at = args.lastIndexOf("--minutes");
  const minutes = help
    ? 5
    : numberArg("--minutes", at >= 0 ? args[at + 1] : "5", { min: 0.01, max: 60 });
  const worker = fileURLToPath(new URL("./reference_inspect.py", import.meta.url));
  if (!help)
    console.error(
      `Reference inspection; stops after ${minutes} minute(s); no speech models or paid APIs.`,
    );
  const { status, stopped } = await runWorker("python", [worker, ...args], minutes);
  if (stopped)
    console.error(
      "reference inspect: deadline reached; inspect the printed partial index before retrying",
    );
  process.exit(status);
}

if (process.argv[2] === "add") {
  const argv = cliArgs(ADD_HELP, ["--name base", "--minutes N"], 1, process.argv.slice(3));
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { name: { type: "string" }, minutes: { type: "string" } },
  });
  const name = values.name ?? "ref";
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) usage("--name takes letters, digits, - and _");
  const minutes = numberArg("--minutes", values.minutes ?? "10", { min: 0.01, max: 60 });
  if (positionals.length !== 1) usage("Choose add <video>");
  const film = needFilm();
  const source = resolve(positionals[0]);
  if (!statSync(source, { throwIfNoEntry: false })?.isFile())
    usage(`No local file: ${positionals[0]}`);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height",
      "-of",
      "json",
      source,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  const info = probe.status === 0 ? JSON.parse(probe.stdout) : {};
  const video = info.streams?.find((s) => s.codec_type === "video");
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  if (!video?.width) {
    console.error(
      `reference add: no video stream in ${source} (${(probe.stderr || probe.error?.message || "").trim()})`,
    );
    process.exit(1);
  }
  // H.264 up to 1920 in an .mp4 decodes everywhere (ffmpeg, the studio, Chromium) and is kept as it is
  const ready =
    video.codec_name === "h264" &&
    extname(source).toLowerCase() === ".mp4" &&
    Math.max(video.width, video.height) <= 1920;
  const dir = join(film, "references");
  const picture = join(dir, `${name}.mp4`);
  const kept = join(
    dir,
    `${name}-source${/^\.[a-z0-9]+$/i.test(extname(source)) ? extname(source).toLowerCase() : ""}`,
  );
  const taken = [picture, ...(ready ? [] : [kept])].filter((f) => existsSync(f));
  if (taken.length)
    usage(`${taken.join(", ")} already exists: pick another --name; nothing was copied`);
  mkdirSync(dir, { recursive: true });
  if (ready) {
    copyFileSync(source, picture);
    console.log(
      `copied ${basename(source)} to references/${name}.mp4 (H.264, ${video.width}x${video.height})`,
    );
  } else {
    copyFileSync(source, kept);
    const scale = Math.min(1, 1920 / Math.max(video.width, video.height));
    const width = 2 * Math.round((video.width * scale) / 2);
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        kept,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        `scale=${width}:-2:flags=lanczos`,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        ...(audio?.codec_name === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "256k"]),
        picture,
      ],
      { encoding: "utf8", windowsHide: true, timeout: minutes * 60_000 },
    );
    if (made.status !== 0 || !existsSync(picture)) {
      rmSync(kept, { force: true });
      rmSync(picture, { force: true });
      console.error(
        `reference add: the H.264 copy failed (${(made.stderr || made.error?.message || `exit ${made.status}`).trim()}); nothing was kept in references/`,
      );
      process.exit(1);
    }
    console.log(
      `kept ${basename(source)} as references/${basename(kept)}; references/${name}.mp4 is an H.264 copy (CRF 18, ${width} wide, audio ${audio?.codec_name === "aac" ? "copied" : audio ? "AAC 256k" : "none"}) for the repo's tools`,
    );
  }
  console.log(`next: bun run reference study references/${name}.mp4`);
  process.exit(0);
}

if (process.argv[2] === "timecode") {
  await runTimecode(process.argv.slice(3), { usage, runWorker });
}

if (process.argv[2] === "sidebyside") {
  await runSidebyside(process.argv.slice(3), { usage, runWorker });
}

if (process.argv[2] === "solve") {
  const argv = cliArgs(
    SOLVE_HELP,
    ["--video file", "--write", "--minutes N"],
    1,
    process.argv.slice(3),
  );
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { video: { type: "string" }, write: { type: "boolean" }, minutes: { type: "string" } },
  });
  if (positionals.length !== 1) usage("Choose solve <shot.json>");
  const minutes = numberArg("--minutes", values.minutes ?? "10", { min: 0.01, max: 60 });
  const film = needFilm();
  const shotFile = resolve(positionals[0]);
  const video = resolve(values.video ?? "references/ref.mp4");
  for (const file of [shotFile, video])
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) usage(`No local file: ${file}`);
  let name;
  try {
    name = JSON.parse(readFileSync(shotFile, "utf8")).name;
  } catch (error) {
    usage(`${positionals[0]} is not JSON (${error.message})`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(String(name)))
    usage(`${positionals[0]}: name takes letters, digits, - and _`);
  const python = mediaPython("camera");
  if (!existsSync(python)) {
    console.error("reference solve: needs bun run media setup camera first; nothing was solved");
    process.exit(1);
  }
  const base = join(film, "renders/reference/solve", name);
  mkdirSync(base, { recursive: true });
  const out = mkdtempSync(join(base, `run-${Date.now()}-`));
  console.error(`Solving ${name}; stops after ${minutes} minute(s). Evidence: ${out}`);
  const ended = await startJob(film, `reference solve ${name}`, { say: `Matchmoving ${name}` });
  const worker = fileURLToPath(new URL("../media/camera.py", import.meta.url));
  const { status, stopped } = await runWorker(
    python,
    ["-B", worker, "solve", video, "--shot", shotFile, "--out", out],
    minutes,
  );
  const reportFile = join(out, "solve.json");
  const solved = !stopped && status === 0 && existsSync(reportFile);
  await ended({
    say: `Matchmove ${name} ${solved ? "solved" : "needs attention"}`,
    level: solved ? "ok" : "warn",
  });
  if (!solved) {
    console.error(
      `reference solve: ${stopped ? "deadline reached" : `the solve failed (exit ${status})`}; cam.json is unchanged`,
    );
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  console.log(`solve: ${reportFile}\nsheet: ${join(out, "sheet.jpg")}`);
  if (values.write) console.log(writeSolvedKeys(film, name, report.keys));
  console.log(
    values.write
      ? "next: look at sheet.jpg, then bun run check and a still of the shot"
      : `next: look at sheet.jpg; rerun with --write to put the ${report.keys.length} keys into the camera timeline`,
  );
  process.exit(0);
}

const argv = cliArgs(HELP, ["--out folder", "--fit", "--film file", "--minutes N"], 3);
const {
  positionals: [command, ...files],
  values,
} = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    out: { type: "string" },
    fit: { type: "boolean" },
    film: { type: "string" },
    minutes: { type: "string" },
  },
});
if (!["study", "compare"].includes(command) || files.length !== (command === "study" ? 1 : 2))
  usage("Choose study <video> or compare <reference> <remake>");
if (command === "study" && (values.fit || values.film)) usage("--fit and --film belong to compare");
const minutes = numberArg("--minutes", values.minutes ?? "5", { min: 0.01, max: 60 });
for (const file of [...files, ...(values.film ? [values.film] : [])])
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) usage(`No local file: ${file}`);
const base = resolve(
  values.out ??
    `renders/reference/${command === "study" ? basename(files[0], extname(files[0])) : "compare"}`,
);
let out;
try {
  mkdirSync(base, { recursive: true });
  out = mkdtempSync(join(base, `run-${Date.now()}-`));
} catch (error) {
  console.error(`reference: cannot create report folder ${base}: ${error.message}`);
  process.exit(1);
}
const worker = fileURLToPath(
  new URL("../../third-party/openfilm-replicate/measure.mjs", import.meta.url),
);
console.error(
  `Reference analysis (not a quality gate); stops after ${minutes} minute(s). Reports: ${out}`,
);
const ended = await startJob(process.cwd(), `reference ${command}`, {
  say: `Measuring ${basename(files[0])}`,
});
// a film draft is its picture over a strip naming the heard time and shot: the measure compares the picture alone
const measured = files.map((f) => resolve(f));
const began = Date.now();
const picture = command === "compare" ? filmPicture(process.cwd(), measured[1]) : null;
// under its own name, so compare.md names the draft; removed once measured
const pictureDir = join(out, "remake-picture");
if (picture) {
  mkdirSync(pictureDir);
  const cropped = join(pictureDir, basename(files[1]));
  const c = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      measured[1],
      "-map",
      "0:V:0",
      "-map",
      "0:a?",
      "-vf",
      `crop=${picture.width}:${picture.height}:0:0`,
      "-c:v",
      "libx264",
      "-crf",
      "12",
      "-preset",
      "veryfast",
      "-c:a",
      "copy",
      cropped,
    ],
    { encoding: "utf8", windowsHide: true, timeout: minutes * 60_000 },
  );
  if (c.status === 0) {
    measured[1] = cropped;
    console.error(
      `reference: comparing ${files[1]}'s picture (${picture.width}x${picture.height}), without the draft's strip under it`,
    );
  } else if (Date.now() - began >= minutes * 60_000) {
    console.error(`reference: stopped after ${minutes} minute(s) cutting the draft's strip off`);
    rmSync(pictureDir, { recursive: true, force: true });
    await ended({ say: `Reference ${command} stopped`, level: "warn" });
    process.exit(1);
  } else
    console.error(
      `reference: could not cut the draft's strip off (${(c.stderr || c.error?.message || `exit ${c.status}`).trim()}); comparing the whole frame`,
    );
}
const { status, stopped } = await runWorker(
  process.execPath,
  [
    worker,
    command,
    ...measured,
    "--out",
    out,
    ...(values.fit ? ["--fit"] : []),
    ...(values.film ? ["--film", resolve(values.film)] : []),
  ],
  Math.max(0.01, minutes - (Date.now() - began) / 60_000),
);
if (picture) {
  rmSync(pictureDir, { recursive: true, force: true });
  const compareJson = join(out, "compare.json");
  if (existsSync(compareJson)) {
    const compared = JSON.parse(readFileSync(compareJson, "utf8"));
    const named = {
      ...compared,
      remake: resolve(files[1]),
      remakePicture: measured[1] === resolve(files[1]) ? null : picture,
    };
    writeFileSync(compareJson, `${JSON.stringify(named, null, 1)}\n`);
  }
}
if (stopped)
  console.error(
    "reference: stopped before completion; completed reports remain, decoding must restart",
  );
// the measure's cuts are image changes and miss a whip pan, so study adds the camera's own motion from bun run media camera
const studyJson = join(out, "study.json");
if (command === "study" && !stopped && status === 0 && existsSync(studyJson)) {
  const camera = mediaPython("camera");
  if (!existsSync(camera))
    console.error(
      "reference: whip pans and camera motion need bun run media setup camera; cuts and changes stand",
    );
  else {
    const m = spawnSync(
      camera,
      [
        "-B",
        fileURLToPath(new URL("../media/camera.py", import.meta.url)),
        "motion",
        resolve(files[0]),
        "--out",
        join(out, "camera"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: minutes * 60_000 },
    );
    const motionFile = join(out, "camera", "motion.json");
    if (m.status === 0 && existsSync(motionFile)) {
      const motion = JSON.parse(readFileSync(motionFile, "utf8"));
      rmSync(join(out, "camera"), { recursive: true });
      const studied = JSON.parse(readFileSync(studyJson, "utf8"));
      const near = 1.5 / motion.fps;
      const cuts = studied.picture?.cuts ?? [];
      for (const w of motion.whips) {
        const cut = cuts.find((c) => c.at >= w.from - near && c.at <= w.to + near);
        if (cut) w.cut = cut.at;
      }
      writeFileSync(studyJson, JSON.stringify({ ...studied, motion }));
      const t = (s) => s.toFixed(3);
      appendFileSync(
        join(out, "study.md"),
        [
          "",
          `## Whips (${motion.whips.length})`,
          "",
          "The camera moving over 6% of the frame (or zooming 6%) a frame for 2 frames or more, from tracked corners; a whip around a cut is a whip transition. study.json motion.frames has dx, dy, zoom, turn and inliers for every frame.",
          "",
          ...(motion.whips.length
            ? motion.whips.map(
                (w) =>
                  `- ${t(w.from)}–${t(w.to)}: the camera ${w.camera}${w.cut === undefined ? "" : `, a whip transition through the cut at ${t(w.cut)}`}${w.lostFrames ? `, ${w.lostFrames} frame(s) too smeared to track` : ""}`,
              )
            : ["None."]),
          "",
        ].join("\n"),
      );
      console.log(`${motion.whips.length} whip pan${motion.whips.length === 1 ? "" : "s"}`);
    } else
      console.error(
        `reference: the camera's motion was not measured (${(m.stderr || m.error?.message || `exit ${m.status}`).trim()}); cuts and changes stand`,
      );
  }
}
await ended({
  say: `Reference ${command} ${status === 0 ? "finished" : "needs attention"}`,
  level: status === 0 ? "ok" : "warn",
});
const complete =
  !stopped &&
  [0, 1].includes(status) &&
  ["json", "md"].every((ext) =>
    statSync(join(out, `${command}.${ext}`), { throwIfNoEntry: false })?.isFile(),
  );
console.log(
  complete
    ? `next: read ${out}/${command}.json and ${out}/${command}.md; inspect comparison PNGs before deciding what to change`
    : `next: fix the error above and rerun the same reference command; partial files from this attempt only: ${out}`,
);
process.exitCode = complete ? status : 1;
