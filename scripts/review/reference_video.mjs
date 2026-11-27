import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { cliArgs, numberArg, secondArg } from "../../packages/live-studio/src/cli.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import {
  filmPicture,
  filmVideo,
  readRenderEvidence,
  reviewFile,
  writeRenderEvidence,
} from "../../packages/live-studio/src/video.mjs";
import { probeVideoMeta } from "./gemini-video-input.ts";

const TIMECODE_HELP = `Add a black timecode bar below a reference video without covering the picture, for AI video review (e.g. analyze-ref-video).
  bun run reference timecode <video> [--out <file>] [--label <text>] [--short-edge 720 | --full] [--crf 22] [--minutes 10]
Writes an H.264 .mp4 copy with a black bottom strip (HH:MM:SS.mmm, frame number, and label), keeping the source untouched.
Default output: renders/reference/<video-name>_timecode.mp4 (outside references/ so tools keep reading the clean source).
  --out <file>       Output .mp4 path (must differ from <video>).
  --label <text>     Right-side label on the strip (default REFERENCE; pass "" to omit).
  --short-edge <px>  Cap the shorter picture side in pixels without upscaling (default 720; e.g. 720x1280 portrait / 1280x720 landscape).
  --full             Keep native source picture resolution (disables --short-edge downscaling).
  --crf <N>          H.264 quality factor 0-51 (default 22 for fast AI uploads; lower is larger).
  --minutes <N>      Stop FFmpeg after N minutes (default 10, maximum 60).
Exit 0: wrote video; 1: encoding, publishing or timeout failed (prior output untouched); 2: usage error.
next: use the timecoded copy to extract single-source stills for analyze-ref-video; keep references/ clean`;

const SIDEBYSIDE_HELP = `Tile a reference video and a remake into one synced video with REF/OURS headers and a shared black timecode bar for local review.
  bun run reference sidebyside <reference> <remake> [--out <file>] [--start <sec> | --range <from,to>] [--audio ours|ref|none] [--layout auto|hstack|vstack] [--short-edge 720 | --full] [--crf 22] [--minutes 10]
Writes an H.264 .mp4 copy without touching either source. Strips a film draft's bottom studio bar before tiling. Full comparisons pad a shorter clip with black to show duration mismatch.
Auto-aligns film spans (renders/span_<a>-<b>.mp4) and chunks (renders/chunks/cNN.mp4) to their matching window in <reference> with true film timecode; pass --start to override.
Default output: renders/reference/<ref-name>_vs_<remake-name>.mp4.
  --out <file>       Output .mp4 path (must differ from both inputs).
  --start <sec>      Reference start offset in seconds (e.g. 12, 0:12, 00:12.500) to align a partial/span clip against <reference>.
  --range <from,to>  Cut both videos to the same film-time window (e.g. 1:45,3:35). The window must fall inside both picture tracks. Appends the range to the default filename.
  --audio <mode>     Audio track to keep: ours (default), ref, or none.
  --layout <mode>    auto (default: hstack for portrait/square, vstack for landscape), hstack, or vstack.
  --short-edge <px>  Cap each panel's shorter side in pixels without upscaling (default 720).
  --full             Keep native panel resolution (disables --short-edge downscaling).
  --crf <N>          H.264 quality factor 0-51 (default 22).
  --minutes <N>      Stop FFmpeg after N minutes (default 10, maximum 60).
Exit 0: wrote video and review metadata; 1: encoding, publishing or timeout failed (prior video kept); 2: usage error.
next: press V (or click Compare) in Studio — auto-loads renders/reference/*_vs_*.mp4. For AI review, run reference frames on the two sources.`;

const FRAME_BATCH_LIMIT = 450;

const FRAMES_HELP = `Export timecoded JPEGs and ready-to-upload absolute-path file lists for AI review.
  bun run reference frames <video> [--range <from,to>] [--fps 15] [--label REFERENCE] [--batch-size ${FRAME_BATCH_LIMIT}] [--short-edge 720 | --full] [--out <folder>] [--minutes 10]
  bun run reference frames <reference> <remake> [--out <folder>] [--start <sec> | --range <from,to>] [--fps 15] [--batch-size ${FRAME_BATCH_LIMIT}] [--layout hstack|vstack|auto] [--short-edge 720 | --full] [--minutes 10]
Single-video mode burns a black timecode bar below the picture (ideal for analyze-ref-video or original renders): it auto-strips the studio draft bottom bar on canonical draft renders (renders/draft.mp4, renders/draft_video.mp4, renders/chunks/c<N>.mp4, renders/span_<from>-<to>.mp4) and auto-aligns canonical spans/chunks (including renders/final_chunks/c<N>.mp4) to their film-time start (--range takes film seconds; external, copied/renamed, and full-film videos start at 0, and non-canonical copies like renders/draft_v2.mp4 are not auto-cropped). Two-video mode uses the same span/chunk alignment and studio-bar crop as sidebyside (default layout: hstack, REF left, OURS right). Both modes warn on stderr if the rendered film input used --samples 1.
  --out <folder>     Parent folder for fresh run-* folders (default renders/reference/<name>_frames or <ref>_vs_<remake>_frames).
  --label <text>     Single-video mode: right-side bar label (default REFERENCE; pass "" to omit).
  --start <sec>      Two-video mode: offset into REF for a standalone scene render; overrides automatic alignment.
  --range <from,to>  Select a window on the film clock, e.g. 12,32. It must fit within the picture track(s).
                     Omit --range on span_*.mp4 (auto-aligns without 30 fps 2-decimal rounding errors); floor the end to min(refEnd, remEnd).
  --fps <N|native>   Sample at up to N fps (integer 1-60, default 15), or keep all frames of the source/composite.
  --batch-size <N>   Maximum images per list (1-${FRAME_BATCH_LIMIT}, default ${FRAME_BATCH_LIMIT}).
  --short-edge <px>  Cap each panel's shorter side without upscaling (default 720); --full keeps native size.
  --minutes <N>      Stop FFmpeg after N minutes (default 10, maximum 60).
Prints absolute paths to list.txt (one batch) or list-001.txt, list-002.txt, etc. Each line names one JPEG.
Do not merge list.txt files across separate runs: every run writes f000001.jpg... and duplicate basenames fail upload.
Exit 0: wrote a new batch folder; 1: export failed or timed out; 2: usage error. Earlier runs and sources stay intact.
next: pass each list to AI Studio ask --batch --files-from <list>, or reuse it for another visual prompt`;

async function writeFrameBatches({
  runWorker,
  outPath,
  ffmpegArgs,
  minutes,
  samplingFps,
  batchSize,
}) {
  mkdirSync(outPath, { recursive: true });
  const runDir = mkdtempSync(join(outPath, "run-"));
  let completed = false;
  try {
    const { status, stopped } = await runWorker(
      "ffmpeg",
      [
        ...ffmpegArgs,
        "-an",
        "-fps_mode",
        "passthrough",
        "-q:v",
        "2",
        "-start_number",
        "1",
        join(runDir.replaceAll("%", "%%"), "f%06d.jpg"),
      ],
      minutes,
    );
    if (stopped) throw new Error(`stopped after ${minutes} minute(s)`);
    if (status !== 0) throw new Error(`ffmpeg failed (exit ${status})`);
    const images = readdirSync(runDir)
      .filter((file) => file.endsWith(".jpg"))
      .sort();
    if (!images.length) throw new Error("no shared video frame in the selected range");
    const batchCount = Math.ceil(images.length / batchSize);
    const batchDigits = Math.max(3, String(batchCount).length);
    const lists = [];
    for (let i = 0; i < images.length; i += batchSize) {
      const number = String(lists.length + 1).padStart(batchDigits, "0");
      const list = join(runDir, batchCount === 1 ? "list.txt" : `list-${number}.txt`);
      const paths = images.slice(i, i + batchSize).map((file) => join(runDir, file));
      writeFileSync(list, `${paths.join("\n")}\n`, "utf8");
      lists.push(list);
    }
    completed = true;
    console.log(`wrote ${images.length} JPEGs at ${samplingFps} fps in ${lists.length} batch(es)`);
    for (const list of lists) console.log(list);
  } finally {
    if (!completed) rmSync(runDir, { recursive: true, force: true });
  }
}

const MONO_FONTS = [
  "C:/Windows/Fonts/consolab.ttf",
  "C:/Windows/Fonts/consola.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/System/Library/Fonts/Menlo.ttc",
];

const escapeFilterPath = (file) =>
  file.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");

const fontOption = () => {
  const file = MONO_FONTS.find((candidate) => existsSync(candidate));
  return file ? `fontfile='${escapeFilterPath(file)}'` : "font='monospace'";
};

const samePath = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

const resolveDistinctMp4Output = (rawOut, defaultOut, inputs, conflictMessage, usage) => {
  if (rawOut !== undefined && !rawOut.trim()) usage("--out needs an .mp4 file path");
  const outPath = resolve(rawOut ?? defaultOut);
  const matchesInput = (input) =>
    samePath(outPath, input) ||
    (existsSync(outPath) && samePath(realpathSync(outPath), realpathSync(input)));
  if (inputs.some(matchesInput)) usage(conflictMessage);
  if (statSync(outPath, { throwIfNoEntry: false })?.isDirectory())
    usage("--out must be a file path, not a directory");
  if (extname(outPath).toLowerCase() !== ".mp4") usage("--out must end in .mp4");
  return outPath;
};

const formatDisplayOut = (outPath) => {
  const shown = relative(process.cwd(), outPath).replaceAll("\\", "/") || outPath;
  return shown.startsWith("..") ? outPath : shown;
};

const parseRate = (raw) => {
  const [num, den] = String(raw ?? "0/1")
    .split("/")
    .map(Number);
  return den > 0 && num > 0 ? num / den : 0;
};

const probeVideoMedia = (file) => {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,start_time,duration,time_base,nb_frames:stream_disposition=attached_pic:stream_side_data=rotation:format=start_time,duration",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  const info = probe.status === 0 ? JSON.parse(probe.stdout) : {};
  const video = info.streams?.find(
    (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
  );
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  if (!video?.width || !video?.height) {
    return {
      error: `no video stream in ${file} (${(probe.stderr || probe.error?.message || "").trim()})`,
    };
  }
  const rotation = Number(
    video.side_data_list?.find((item) => item?.rotation !== undefined)?.rotation ?? 0,
  );
  const rotated = Math.abs(rotation) % 180 === 90;
  const dispW = rotated ? video.height : video.width;
  const dispH = rotated ? video.width : video.height;
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;
  const duration = Number(video.duration) || Number(info.format?.duration) || 0;
  const fileStart = Number(info.format?.start_time ?? 0);
  const origin = Number(video.start_time ?? fileStart);
  return { video, audio, dispW, dispH, fps, duration, origin, fileStart };
};

const scaleToShortEdge = (dispW, dispH, shortEdge) => {
  const minSide = Math.min(dispW, dispH);
  const scale = shortEdge && minSide > shortEdge ? shortEdge / minSide : 1;
  return {
    scale,
    width: 2 * Math.ceil((dispW * scale) / 2),
    height: 2 * Math.ceil((dispH * scale) / 2),
  };
};

const computeBarTypography = (outW, barH, leftChars, rawRightText) => {
  const margin = Math.max(8, Math.round(outW * 0.02));
  const minF = Math.max(8, Math.round(barH * 0.35));
  const maxF = Math.round(barH * 0.62);
  const totalUnits = (leftChars + (rawRightText ? 2 + rawRightText.length * 0.8 : 1)) * 0.62;
  const fontSize = Math.max(minF, Math.min(maxF, Math.floor((outW - 2 * margin) / totalUnits)));
  const rightFontSize = Math.max(8, Math.round(fontSize * 0.8));
  const maxRightChars = Math.max(
    0,
    Math.floor(((outW - 2 * margin) / (0.62 * fontSize) - leftChars - 2) / 0.8),
  );
  const rightText =
    !rawRightText || maxRightChars < 4
      ? ""
      : rawRightText.length > maxRightChars
        ? `${rawRightText.slice(0, maxRightChars - 1)}…`
        : rawRightText;
  return { margin, fontSize, rightFontSize, rightText };
};

const findRemakeContext = (file) => {
  let meta = null;
  let picture = null;
  const candidates = [process.cwd()];
  let cur = dirname(file);
  for (let i = 0; i < 4; i++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const dir of candidates) {
    const found = filmVideo(dir, file);
    if (found) {
      meta = found;
      picture = filmPicture(dir, file);
      break;
    }
  }
  const evidence = readRenderEvidence(file);
  let samples = Number.isInteger(evidence?.samples) ? evidence.samples : null;
  if (samples === null && meta?.mixed) {
    const sibling = join(
      dirname(file),
      basename(file) === "final.mp4" ? "final_video.mp4" : "draft_video.mp4",
    );
    const sibEvidence = existsSync(sibling) ? readRenderEvidence(sibling) : null;
    if (
      sibEvidence &&
      Number.isInteger(sibEvidence.samples) &&
      (!evidence?.pictureInput ||
        (sibEvidence.size === evidence.pictureInput.size &&
          sibEvidence.mtimeMs === evidence.pictureInput.mtimeMs))
    ) {
      samples = sibEvidence.samples;
    }
  }
  return { meta, picture, evidence, samples };
};

function publishVideoWithEvidence(tempVideo, outPath, evidence) {
  const stagedEvidence = reviewFile(tempVideo);
  const targetEvidence = reviewFile(outPath);
  const previousEvidence = `${stagedEvidence}.previous`;
  let retainPrevious = false;
  try {
    writeRenderEvidence(tempVideo, evidence);
    if (existsSync(targetEvidence)) copyFileSync(targetEvidence, previousEvidence);
    renameSync(stagedEvidence, targetEvidence);
    try {
      renameSync(tempVideo, outPath);
    } catch (error) {
      try {
        if (existsSync(previousEvidence)) renameSync(previousEvidence, targetEvidence);
        else rmSync(targetEvidence, { force: true });
      } catch (restoreError) {
        retainPrevious = true;
        throw new Error(
          `${error.message}. Could not restore review metadata: ${restoreError.message}${existsSync(previousEvidence) ? `. Previous metadata is at ${previousEvidence}` : ""}`,
        );
      }
      throw error;
    }
  } finally {
    rmSync(stagedEvidence, { force: true });
    if (!retainPrevious) rmSync(previousEvidence, { force: true });
  }
}

async function runAtomicFfmpeg({
  runWorker,
  jobName,
  sayStart,
  sayDone,
  commandLabel,
  outPath,
  ffmpegArgs,
  minutes,
  cleanupDirs,
  requireVideoFrames,
  evidence,
}) {
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  const tmpOut = join(outDir, `.${basename(outPath)}.tmp.${process.pid}.mp4`);
  const ended = await startJob(process.cwd(), jobName, { say: sayStart });
  let status = 1;
  let stopped = false;
  let ok = false;
  let outputError;
  try {
    ({ status, stopped } = await runWorker("ffmpeg", [...ffmpegArgs, tmpOut], minutes));
    ok = !stopped && status === 0 && existsSync(tmpOut);
    if (ok && requireVideoFrames && !(Number(probeVideoMedia(tmpOut).video?.nb_frames) > 0)) {
      ok = false;
      outputError = "no shared video frame in the selected range";
    }
    if (ok) {
      try {
        if (evidence) publishVideoWithEvidence(tmpOut, outPath, evidence);
        else renameSync(tmpOut, outPath);
      } catch (error) {
        ok = false;
        outputError = `could not publish output (${error.message})`;
      }
    }
    await ended({
      say: `${sayDone} ${ok ? "ready" : "failed"}`,
      level: ok ? "ok" : "warn",
    });
  } finally {
    rmSync(tmpOut, { force: true });
    for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  }
  if (!ok) {
    console.error(
      `${commandLabel}: ${outputError ?? (stopped ? `stopped after ${minutes} minute(s)` : `ffmpeg failed (exit ${status})`)}; ${outPath} unchanged`,
    );
    process.exit(1);
  }
}

export async function runTimecode(rawArgs, { usage, runWorker }) {
  const argv = cliArgs(
    TIMECODE_HELP,
    ["--out file", "--label text", "--short-edge px", "--full", "--crf N", "--minutes N"],
    1,
    rawArgs,
  );
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      label: { type: "string" },
      "short-edge": { type: "string" },
      full: { type: "boolean" },
      crf: { type: "string" },
      minutes: { type: "string" },
    },
  });
  if (positionals.length !== 1) usage("Choose timecode <video>");
  if (values.full && values["short-edge"] !== undefined)
    usage("Use either --full or --short-edge, not both");
  const shortEdge = values.full
    ? null
    : numberArg("--short-edge", values["short-edge"] ?? "720", { min: 144, max: 4320, int: true });
  const crf = numberArg("--crf", values.crf ?? "22", { min: 0, max: 51, int: true });
  const minutes = numberArg("--minutes", values.minutes ?? "10", { min: 0.01, max: 60 });
  const source = resolve(positionals[0]);
  if (!statSync(source, { throwIfNoEntry: false })?.isFile())
    usage(`No local file: ${positionals[0]}`);
  const outPath = resolveDistinctMp4Output(
    values.out,
    join("renders/reference", `${basename(source, extname(source))}_timecode.mp4`),
    [source],
    "--out must differ from <video>: keep the clean source untouched",
    usage,
  );

  const info = probeVideoMedia(source);
  if (info.error) {
    console.error(`reference timecode: ${info.error}`);
    process.exit(1);
  }
  const { scale, width: outW, height: picH } = scaleToShortEdge(info.dispW, info.dispH, shortEdge);
  const barH = Math.max(28, 2 * Math.round(picH * 0.028));
  const outH = picH + barH;
  const rawLabel = (values.label ?? "REFERENCE").replace(/\s+/g, " ").trim();
  const estFrames = Math.max(1, Math.ceil((info.duration || 60) * 60));
  const leftChars = 15 + String(estFrames).length;
  const {
    margin,
    fontSize,
    rightFontSize,
    rightText: label,
  } = computeBarTypography(outW, barH, leftChars, rawLabel);

  const origin = info.origin ?? 0;
  const ptsExpr =
    Number.isFinite(origin) && Math.abs(origin) > 1e-6
      ? `%{pts\\:hms\\:${(-origin).toFixed(6)}}`
      : "%{pts\\:hms}";
  const font = fontOption();
  const yExpr = `h-${barH}+(${barH}-text_h)/2`;
  const filters = [
    ...(scale < 1 ? [`scale=${outW}:${picH}:flags=lanczos`] : []),
    `pad=${outW}:${outH}:0:0:black`,
    `drawtext=${font}:text='${ptsExpr}  f%{n}':fontcolor=white:fontsize=${fontSize}:x=${margin}:y=${yExpr}`,
  ];

  const cleanupDirs = [];
  if (label) {
    const tmpLabelDir = mkdtempSync(join(tmpdir(), "ref-tc-"));
    cleanupDirs.push(tmpLabelDir);
    const labelFile = join(tmpLabelDir, "label.txt");
    writeFileSync(labelFile, label, "utf8");
    filters.push(
      `drawtext=${font}:expansion=none:textfile='${escapeFilterPath(labelFile)}':fontcolor=#b8b6ad:fontsize=${rightFontSize}:x=w-tw-${margin}:y=${yExpr}`,
    );
  }

  await runAtomicFfmpeg({
    runWorker,
    jobName: "reference timecode",
    sayStart: `Burning timecode bar on ${basename(source)}`,
    sayDone: "Timecode bar",
    commandLabel: "reference timecode",
    outPath,
    minutes,
    cleanupDirs,
    ffmpegArgs: [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-i",
      source,
      "-map",
      "0:V:0",
      "-map",
      "0:a:0?",
      "-vf",
      filters.join(","),
      "-fps_mode",
      "passthrough",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      ...(info.audio?.codec_name === "aac"
        ? ["-c:a", "copy"]
        : info.audio
          ? ["-c:a", "aac", "-b:a", "256k"]
          : []),
    ],
  });

  const displayOut = formatDisplayOut(outPath);
  console.log(
    `wrote ${displayOut} (${outW}x${outH}, +${barH}px black timecode bar; source untouched)`,
  );
  console.log(
    `next: extract single-source stills from ${displayOut} for analyze-ref-video; keep references/ clean`,
  );
  process.exit(0);
}

export async function runComparison(operation, rawArgs, { usage, runWorker }) {
  const frames = operation === "frames";
  const commandLabel = `reference ${operation}`;
  const argv = cliArgs(
    frames ? FRAMES_HELP : SIDEBYSIDE_HELP,
    [
      "--out file",
      "--start sec",
      "--range from,to",
      "--layout mode",
      "--short-edge px",
      "--full",
      "--minutes N",
      ...(frames
        ? ["--fps N|native", "--batch-size N", "--label text"]
        : ["--audio mode", "--crf N"]),
    ],
    2,
    rawArgs,
  );
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      start: { type: "string" },
      range: { type: "string" },
      layout: { type: "string" },
      "short-edge": { type: "string" },
      full: { type: "boolean" },
      minutes: { type: "string" },
      ...(frames
        ? { fps: { type: "string" }, "batch-size": { type: "string" }, label: { type: "string" } }
        : { audio: { type: "string" }, crf: { type: "string" } }),
    },
  });
  const singleSource = frames && positionals.length === 1;
  if (!singleSource && positionals.length !== 2) {
    usage(
      frames
        ? "Choose frames <video> or frames <reference> <remake>"
        : `Choose ${operation} <reference> <remake>`,
    );
  }
  if (!singleSource && values.label !== undefined) {
    usage("--label applies only to single-video reference frames <video>");
  }
  if (singleSource && values.layout !== undefined) {
    usage("--layout applies only to two-video reference frames <reference> <remake>");
  }
  if (singleSource && values.start !== undefined) {
    usage("Use --range <from,to> for single-video reference frames <video>");
  }
  if (values.full && values["short-edge"] !== undefined)
    usage("Use either --full or --short-edge, not both");
  const audioMode = frames ? "none" : (values.audio ?? "ours");
  if (!["ours", "ref", "none"].includes(audioMode)) usage("--audio takes ours, ref, or none");
  const layoutMode = values.layout ?? (frames ? "hstack" : "auto");
  if (!["auto", "hstack", "vstack"].includes(layoutMode))
    usage("--layout takes auto, hstack, or vstack");
  const shortEdge = values.full
    ? null
    : numberArg("--short-edge", values["short-edge"] ?? "720", { min: 144, max: 4320, int: true });
  const crf = numberArg("--crf", values.crf ?? "22", { min: 0, max: 51, int: true });
  const minutes = numberArg("--minutes", values.minutes ?? "10", { min: 0.01, max: 60 });
  const samplingLimit =
    frames && values.fps !== "native"
      ? numberArg("--fps", values.fps ?? "15", { min: 1, max: 60, int: true })
      : null;
  const batchSize = frames
    ? numberArg("--batch-size", values["batch-size"] ?? String(FRAME_BATCH_LIMIT), {
        min: 1,
        max: FRAME_BATCH_LIMIT,
        int: true,
      })
    : null;
  const explicitStart = values.start !== undefined ? secondArg("--start", values.start) : null;
  let range = null;
  if (values.range !== undefined) {
    if (explicitStart !== null) usage("Use either --range or --start, not both");
    const parts = values.range.split(",");
    if (parts.length !== 2 || parts.some((part) => !part.trim()))
      usage("--range takes from,to in film seconds");
    range = parts.map((part) => secondArg("--range", part.trim()));
    if (range[0] >= range[1]) usage("--range requires from before to");
  }
  if (singleSource) {
    const source = resolve(positionals[0]);
    if (!statSync(source, { throwIfNoEntry: false })?.isFile())
      usage(`No local file: ${positionals[0]}`);
    const stem = basename(source, extname(source));
    if (values.out !== undefined && !values.out.trim()) usage("--out needs a folder path");
    const outPath = resolve(values.out ?? join("renders/reference", `${stem}_frames`));
    const output = statSync(outPath, { throwIfNoEntry: false });
    if (output && !output.isDirectory()) usage("--out must be a folder");
    const info = probeVideoMedia(source);
    if (info.error) {
      console.error(`${commandLabel}: ${info.error}`);
      process.exit(1);
    }
    const srcCtx = findRemakeContext(source);
    const srcPicture = srcCtx.picture;
    const autoOrigin =
      srcCtx.meta && (srcCtx.meta.kind === "span" || srcCtx.meta.kind === "chunk")
        ? srcCtx.meta.start
        : 0;
    const startSec = range?.[0] ?? autoOrigin;
    const fileSeek = range ? range[0] - autoOrigin : 0;
    const durationSec = Number(info.video.duration) || info.duration;
    if (range) {
      if (!(durationSec > 0)) usage("--range could not establish the video duration");
      const allowedEnd = autoOrigin + durationSec + parseRate(info.video.time_base);
      if (startSec < autoOrigin - 1e-6 || range[1] > allowedEnd + 1e-6) {
        usage(
          `--range ${range.join(",")} is outside the video window (${autoOrigin.toFixed(2)}-${(autoOrigin + durationSec).toFixed(2)}s)`,
        );
      }
    }
    const windowDur = range ? range[1] - startSec : durationSec;
    if (!(windowDur > 0)) {
      console.error(`${commandLabel}: input reports zero duration; nothing was written`);
      process.exit(1);
    }
    const srcW = srcPicture ? srcPicture.width : info.dispW;
    const srcH = srcPicture ? srcPicture.height : info.dispH;
    const { scale, width: outW, height: picH } = scaleToShortEdge(srcW, srcH, shortEdge);
    const barH = Math.max(28, 2 * Math.round(picH * 0.028));
    const outH = picH + barH;
    const targetFps = Math.max(1, Math.min(60, Math.round(info.fps || 30)));
    const samplingFps = Math.min(samplingLimit ?? targetFps, targetFps);
    const startFrame = Math.round(startSec * targetFps);
    const totalFrames = Math.max(1, Math.round(windowDur * targetFps));
    const rawLabel = (values.label ?? "REFERENCE").replace(/\s+/g, " ").trim();
    const leftChars = 15 + String(startFrame + totalFrames).length;
    const {
      margin,
      fontSize,
      rightFontSize,
      rightText: label,
    } = computeBarTypography(outW, barH, leftChars, rawLabel);
    const ptsExpr = startSec > 0 ? `%{pts\\:hms\\:${startSec.toFixed(6)}}` : "%{pts\\:hms}";
    const frameExpr = startFrame > 0 ? `f%{eif\\:n+${startFrame}\\:d}` : "f%{n}";
    const font = fontOption();
    const yExpr = `h-${barH}+(${barH}-text_h)/2`;
    const filters = [
      ...(srcPicture ? [`crop=${srcPicture.width}:${srcPicture.height}:0:0`] : []),
      ...(scale < 1 ? [`scale=${outW}:${picH}:flags=lanczos`] : []),
      "setsar=1",
      "setpts=PTS-STARTPTS",
      `fps=${targetFps}`,
      `trim=end_frame=${totalFrames}`,
      "setpts=PTS-STARTPTS",
      `pad=${outW}:${outH}:0:0:black`,
      `drawtext=${font}:text='${ptsExpr}  ${frameExpr}':fontcolor=white:fontsize=${fontSize}:x=${margin}:y=${yExpr}`,
    ];
    const cleanupDirs = [];
    if (label) {
      const tmpLabelDir = mkdtempSync(join(tmpdir(), "ref-sf-"));
      cleanupDirs.push(tmpLabelDir);
      const labelFile = join(tmpLabelDir, "label.txt");
      writeFileSync(labelFile, label, "utf8");
      filters.push(
        `drawtext=${font}:expansion=none:textfile='${escapeFilterPath(labelFile)}':fontcolor=#b8b6ad:fontsize=${rightFontSize}:x=w-tw-${margin}:y=${yExpr}`,
      );
    }
    if (samplingFps < targetFps) {
      filters.push(`fps=fps=${samplingFps}:round=up`);
    }
    let ok = false;
    try {
      await writeFrameBatches({
        runWorker,
        outPath,
        minutes,
        samplingFps,
        batchSize,
        ffmpegArgs: [
          "-v",
          "error",
          "-nostdin",
          "-y",
          ...(fileSeek > 0 ? ["-ss", fileSeek.toFixed(6)] : []),
          "-i",
          source,
          "-map",
          "0:V:0",
          "-vf",
          filters.join(","),
        ],
      });
      ok = true;
    } catch (error) {
      console.error(`${commandLabel}: ${error.message}`);
    } finally {
      for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
    }
    if (!ok) process.exit(1);
    if (srcCtx.samples === 1) {
      console.error(
        `warning: ${basename(source)} was rendered with --samples 1 (no shutter motion blur); for motion-blur/whip review render with --samples 8`,
      );
    }
    return;
  }
  const refSource = resolve(positionals[0]);
  const remSource = resolve(positionals[1]);
  for (const [raw, file] of [
    [positionals[0], refSource],
    [positionals[1], remSource],
  ]) {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) usage(`No local file: ${raw}`);
  }
  const refStem = basename(refSource, extname(refSource));
  const remStem = basename(remSource, extname(remSource));
  const pairName = `${refStem}_vs_${remStem}`;
  let outPath;
  if (frames) {
    if (values.out !== undefined && !values.out.trim()) usage("--out needs a folder path");
    outPath = resolve(values.out ?? join("renders/reference", `${pairName}_frames`));
    const output = statSync(outPath, { throwIfNoEntry: false });
    if (output && !output.isDirectory()) usage("--out must be a folder");
  } else {
    outPath = resolveDistinctMp4Output(
      values.out,
      join("renders/reference", `${pairName}${range ? `_${range.join("-")}` : ""}.mp4`),
      [refSource, remSource],
      "--out must differ from both inputs: keep sources untouched",
      usage,
    );
  }

  const refInfo = probeVideoMedia(refSource);
  const remInfo = probeVideoMedia(remSource);
  if (refInfo.error || remInfo.error) {
    console.error(`${commandLabel}: ${refInfo.error ?? remInfo.error}`);
    process.exit(1);
  }

  const remCtx = findRemakeContext(remSource);
  const remPicture = remCtx.picture;
  const autoWindow =
    remCtx.meta && (remCtx.meta.kind === "span" || remCtx.meta.kind === "chunk")
      ? remCtx.meta.start
      : null;
  const remakeOrigin = autoWindow ?? 0;
  const startSec = range?.[0] ?? explicitStart ?? remakeOrigin;
  const remakeSeek = range ? startSec - remakeOrigin : 0;
  if (range) {
    const pictureSpan = (source, info) => {
      const durationSec = Number(info.video.duration);
      return durationSec > 0
        ? { startSec: info.origin - info.fileStart, durationSec, endTolerance: 0 }
        : { ...probeVideoMeta(source), endTolerance: parseRate(info.video.time_base) };
    };
    const refPicture = pictureSpan(refSource, refInfo);
    const remPicture = pictureSpan(remSource, remInfo);
    if (!(refPicture.durationSec > 0 && remPicture.durationSec > 0)) {
      usage("--range could not establish the picture duration of both sources");
    }
    const refPictureStart = refPicture.startSec;
    const remPictureStart = remakeOrigin + remPicture.startSec;
    const sharedStart = Math.max(refPictureStart, remPictureStart);
    const refEnd = refPictureStart + refPicture.durationSec;
    const remEnd = remPictureStart + remPicture.durationSec;
    const sharedEnd = Math.min(refEnd, remEnd);
    const allowedEnd = Math.min(refEnd + refPicture.endTolerance, remEnd + remPicture.endTolerance);
    const micros = (seconds) => Math.round(seconds * 1_000_000);
    if (micros(startSec) < micros(sharedStart) || micros(range[1]) > micros(allowedEnd)) {
      usage(
        `--range ${range.join(",")} is outside the shared video window (${sharedStart.toFixed(2)}-${sharedEnd.toFixed(2)}s)`,
      );
    }
  }
  const isWindow = explicitStart !== null || autoWindow !== null;
  if (!range && startSec >= refInfo.duration) {
    usage(
      `--start ${startSec}s is at or past <reference> duration (${refInfo.duration.toFixed(2)}s)`,
    );
  }
  const { width: panelW, height: panelH } = scaleToShortEdge(
    refInfo.dispW,
    refInfo.dispH,
    shortEdge,
  );
  const layout = layoutMode === "auto" ? (panelH >= panelW ? "hstack" : "vstack") : layoutMode;
  const seam = 4;
  const headH = Math.max(24, 2 * Math.round(panelH * 0.024));
  const barH = Math.max(28, 2 * Math.round(panelH * 0.028));
  const outW = layout === "hstack" ? panelW * 2 + seam : panelW;
  const outH =
    layout === "hstack" ? headH + panelH + barH : headH + panelH + seam + headH + panelH + barH;
  const targetFps = Math.max(1, Math.min(60, Math.round(remInfo.fps || refInfo.fps || 30)));
  const refWindowDur = range
    ? range[1] - startSec
    : isWindow
      ? Math.min(Math.max(0, refInfo.duration - startSec), remInfo.duration)
      : refInfo.duration;
  const remWindowDur = range ? refWindowDur : remInfo.duration;
  const maxDur = Math.max(refWindowDur, remWindowDur);
  if (!(maxDur > 0)) {
    console.error(`${commandLabel}: inputs report zero duration; nothing was written`);
    process.exit(1);
  }
  const targetDur = Math.max(maxDur, 1 / targetFps);
  const totalFrames = Math.max(1, Math.round(targetDur * targetFps));
  const startFrame = Math.round(startSec * targetFps);
  const padDur = targetDur + 0.5;
  const windowAudio = (info, seek) => {
    const audio = info.audio;
    const duration = Number(audio?.duration);
    if (!range || !(duration > 0)) return audio;
    const start = Number(audio.start_time ?? info.fileStart);
    const from = info.fileStart + seek;
    return from < start + duration && from + (range[1] - range[0]) > start ? audio : null;
  };
  const remAudio = windowAudio(remInfo, remakeSeek);
  const refAudio = windowAudio(refInfo, startSec);

  const pickedAudio =
    audioMode === "ours"
      ? remAudio
        ? { inputIndex: 1, stream: remAudio, tag: "ours" }
        : { inputIndex: null, stream: null, tag: "none" }
      : audioMode === "ref"
        ? refAudio
          ? { inputIndex: 0, stream: refAudio, tag: "ref" }
          : { inputIndex: null, stream: null, tag: "none" }
        : { inputIndex: null, stream: null, tag: "none" };

  const layoutLabel = layout === "hstack" ? "REF | OURS" : "REF / OURS";
  const leftChars = 15 + String(startFrame + totalFrames).length;
  const {
    margin,
    fontSize: barFont,
    rightFontSize: rightFont,
    rightText,
  } = computeBarTypography(outW, barH, leftChars, `${layoutLabel}  audio:${pickedAudio.tag}`);
  const headFont = Math.max(12, Math.round(headH * 0.62));
  const font = fontOption();

  const prepPanel = (inputSpec, cropPrefix) => {
    const parts = [
      ...(cropPrefix ? [cropPrefix] : []),
      `scale=${panelW}:${panelH}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${panelW}:${panelH}:(ow-iw)/2:(oh-ih)/2:black`,
      "setsar=1",
      "setpts=PTS-STARTPTS",
      `fps=${targetFps}`,
      ...(range ? [] : [`tpad=stop_mode=add:stop_duration=${padDur.toFixed(3)}:color=black`]),
      `trim=end_frame=${totalFrames}`,
      "setpts=PTS-STARTPTS",
    ];
    return `${inputSpec}${parts.join(",")}`;
  };

  const barY = `h-${barH}+(${barH}-text_h)/2`;
  const ptsExpr = startSec > 0 ? `%{pts\\:hms\\:${startSec.toFixed(6)}}` : "%{pts\\:hms}";
  const frameExpr = startFrame > 0 ? `f%{eif\\:n+${startFrame}\\:d}` : "f%{n}";
  const cleanupDirs = [];
  const rightDraw = [];
  if (rightText) {
    const tmpLabelDir = mkdtempSync(join(tmpdir(), "ref-sbs-"));
    cleanupDirs.push(tmpLabelDir);
    const rightFile = join(tmpLabelDir, "right.txt");
    writeFileSync(rightFile, rightText, "utf8");
    rightDraw.push(
      `drawtext=${font}:expansion=none:textfile='${escapeFilterPath(rightFile)}':fontcolor=#b8b6ad:fontsize=${rightFont}:x=w-tw-${margin}:y=${barY}`,
    );
  }

  const remCrop = remPicture ? `crop=${remPicture.width}:${remPicture.height}:0:0` : null;
  const rightSuffix = rightDraw.length ? `,${rightDraw.join(",")}` : "";
  let filterComplex;
  if (layout === "hstack") {
    filterComplex = [
      `${prepPanel("[0:V:0]", null)},pad=${panelW + seam}:${panelH}:0:0:#141414[left]`,
      `${prepPanel("[1:V:0]", remCrop)}[right]`,
      `[left][right]hstack=inputs=2${range ? ":shortest=1" : ""},pad=${outW}:${outH}:0:${headH}:black,` +
        `drawtext=${font}:text='REF':fontcolor=#e6e4dc:fontsize=${headFont}:x=(${panelW}-tw)/2:y=(${headH}-text_h)/2,` +
        `drawtext=${font}:text='OURS':fontcolor=#e6e4dc:fontsize=${headFont}:x=${panelW + seam}+(${panelW}-tw)/2:y=(${headH}-text_h)/2,` +
        `drawtext=${font}:text='${ptsExpr}  ${frameExpr}':fontcolor=white:fontsize=${barFont}:x=${margin}:y=${barY}${rightSuffix}[outv]`,
    ].join(";");
  } else {
    const botHeaderY = headH + panelH + seam;
    filterComplex = [
      `${prepPanel("[0:V:0]", null)},pad=${panelW}:${headH + panelH + seam}:0:${headH}:black,drawbox=x=0:y=${headH + panelH}:w=${panelW}:h=${seam}:color=#141414:t=fill[top]`,
      `${prepPanel("[1:V:0]", remCrop)},pad=${panelW}:${headH + panelH + barH}:0:${headH}:black[bot]`,
      `[top][bot]vstack=inputs=2${range ? ":shortest=1" : ""},` +
        `drawtext=${font}:text='REF':fontcolor=#e6e4dc:fontsize=${headFont}:x=(${panelW}-tw)/2:y=(${headH}-text_h)/2,` +
        `drawtext=${font}:text='OURS':fontcolor=#e6e4dc:fontsize=${headFont}:x=(${panelW}-tw)/2:y=${botHeaderY}+(${headH}-text_h)/2,` +
        `drawtext=${font}:text='${ptsExpr}  ${frameExpr}':fontcolor=white:fontsize=${barFont}:x=${margin}:y=${barY}${rightSuffix}[outv]`,
    ].join(";");
  }

  const inputArgs = [
    "-v",
    "error",
    "-nostdin",
    "-y",
    ...(startSec > 0 ? ["-ss", startSec.toFixed(6)] : []),
    "-i",
    refSource,
    ...(remakeSeek > 0 ? ["-ss", remakeSeek.toFixed(6)] : []),
    "-i",
    remSource,
  ];
  if (frames) {
    const samplingFps = Math.min(samplingLimit ?? targetFps, targetFps);
    const sampled = samplingFps < targetFps;
    if (sampled) filterComplex += `;[outv]fps=fps=${samplingFps}:round=up[stills]`;
    let ok = false;
    try {
      await writeFrameBatches({
        runWorker,
        outPath,
        minutes,
        samplingFps,
        batchSize,
        ffmpegArgs: [
          ...inputArgs,
          "-filter_complex",
          filterComplex,
          "-map",
          sampled ? "[stills]" : "[outv]",
        ],
      });
      ok = true;
    } catch (error) {
      console.error(`${commandLabel}: ${error.message}`);
    } finally {
      for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
    }
    if (!ok) process.exit(1);
    if (remCtx.samples === 1) {
      console.error(
        `warning: ${basename(remSource)} was rendered with --samples 1 (no shutter motion blur); for motion-blur/whip review render with --samples 8`,
      );
    }
    return;
  }

  const relativeRef = relative(process.cwd(), refSource);
  await runAtomicFfmpeg({
    runWorker,
    jobName: "reference sidebyside",
    sayStart: `Tiling ${basename(refSource)} vs ${basename(remSource)}`,
    sayDone: "Side-by-side video",
    commandLabel,
    outPath,
    minutes,
    cleanupDirs,
    requireVideoFrames: range !== null,
    evidence: {
      start: startSec,
      compareLayout: layout,
      compareAudio: pickedAudio.tag,
      compareStudioStart: remakeOrigin + remakeSeek,
      compareReference:
        isAbsolute(relativeRef) || relativeRef.startsWith("..")
          ? null
          : relativeRef.replaceAll("\\", "/"),
    },
    ffmpegArgs: [
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[outv]",
      ...(pickedAudio.inputIndex !== null
        ? [
            "-map",
            `${pickedAudio.inputIndex}:a:0`,
            ...(range
              ? ["-af", `atrim=end=${refWindowDur.toFixed(6)}`, "-c:a", "aac", "-b:a", "256k"]
              : isWindow && pickedAudio.inputIndex === 0
                ? ["-t", targetDur.toFixed(6), "-c:a", "aac", "-b:a", "256k"]
                : pickedAudio.stream.codec_name === "aac"
                  ? ["-c:a", "copy"]
                  : ["-c:a", "aac", "-b:a", "256k"]),
          ]
        : ["-an"]),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(crf),
      "-g",
      String(targetFps),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ],
  });

  if (remCtx.samples === 1) {
    console.log(
      `warning: ${basename(remSource)} was rendered with --samples 1 (no shutter motion blur); for motion-blur/whip review render with --samples 8`,
    );
  }
  const displayOut = formatDisplayOut(outPath);
  console.log(
    `wrote ${displayOut} (${outW}x${outH}, ${layout} ${layoutLabel}, ${targetFps}fps, ref ${refWindowDur.toFixed(2)}s vs ours ${remWindowDur.toFixed(2)}s${startSec > 0 ? `, start ${startSec.toFixed(2)}s` : ""}, audio:${pickedAudio.tag}${remPicture ? ", stripped draft bar" : ""}; sources untouched)`,
  );
  console.log(
    `next: press V (or click Compare) in Studio — auto-loads ${displayOut}. For AI review, run reference frames on the two sources.`,
  );
}
