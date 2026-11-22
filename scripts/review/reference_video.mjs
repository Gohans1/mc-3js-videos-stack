import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { cliArgs, numberArg } from "../../packages/live-studio/src/cli.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import { filmPicture } from "../../packages/live-studio/src/video.mjs";

const TIMECODE_HELP = `Add a black timecode bar below a reference video without covering the picture, for AI video review (e.g. aistudio).
  bun run reference timecode <video> [--out <file>] [--label <text>] [--short-edge 720 | --full] [--crf 22] [--minutes 10]
Writes an H.264 .mp4 copy with a black bottom strip (HH:MM:SS.mmm, frame number, and label), keeping the source untouched.
Default output: renders/reference/<video-name>_timecode.mp4 (outside references/ so tools keep reading the clean source).
  --out <file>       Output .mp4 path (must differ from <video>).
  --label <text>     Right-side label on the strip (default REFERENCE; pass "" to omit).
  --short-edge <px>  Cap the shorter picture side in pixels without upscaling (default 720; e.g. 720x1280 portrait / 1280x720 landscape).
  --full             Keep native source picture resolution (disables --short-edge downscaling).
  --crf <N>          H.264 quality factor 0-51 (default 22 for fast AI uploads; lower is larger).
  --minutes <N>      Stop FFmpeg after N minutes (default 10, maximum 60).
Exit 0: wrote video; 1: encode failed or timed out (prior output untouched); 2: usage error.
next: pass the output alongside renders/draft.mp4 to your video reviewer; keep references/ clean`;

const SIDEBYSIDE_HELP = `Tile a reference video and a remake into one synced video with REF/OURS headers and a shared black timecode bar for AI comparison.
  bun run reference sidebyside <reference> <remake> [--out <file>] [--audio ours|ref|none] [--layout auto|hstack|vstack] [--short-edge 720 | --full] [--crf 22] [--minutes 10]
Writes an H.264 .mp4 copy without touching either source; strips a film draft's bottom studio bar before tiling and pads any shorter clip with black to show duration mismatch.
Default output: renders/reference/<ref-name>_vs_<remake-name>.mp4.
  --out <file>       Output .mp4 path (must differ from both inputs).
  --audio <mode>     Audio track to keep: ours (default), ref, or none.
  --layout <mode>    auto (default: hstack for portrait/square, vstack for landscape), hstack, or vstack.
  --short-edge <px>  Cap each panel's shorter side in pixels without upscaling (default 720).
  --full             Keep native panel resolution (disables --short-edge downscaling).
  --crf <N>          H.264 quality factor 0-51 (default 22).
  --minutes <N>      Stop FFmpeg after N minutes (default 10, maximum 60).
Exit 0: wrote video; 1: encode failed or timed out (prior output untouched); 2: usage error.
next: pass the output to your video reviewer with compare-2-video.md; keep sources clean`;

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
      "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,start_time,duration:stream_disposition=attached_pic:stream_side_data=rotation:format=start_time,duration",
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
  const origin = Number(video.start_time ?? info.format?.start_time ?? 0);
  return { video, audio, dispW, dispH, fps, duration, origin };
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

const findRemakePicture = (file) => {
  const direct = filmPicture(process.cwd(), file);
  if (direct) return direct;
  let cur = dirname(file);
  for (let i = 0; i < 4; i++) {
    const hit = filmPicture(cur, file);
    if (hit) return hit;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
};

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
}) {
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  const tmpOut = join(outDir, `.${basename(outPath)}.tmp.${process.pid}.mp4`);
  const ended = await startJob(process.cwd(), jobName, { say: sayStart });
  let status = 1;
  let stopped = false;
  try {
    ({ status, stopped } = await runWorker("ffmpeg", [...ffmpegArgs, tmpOut], minutes));
    const ok = !stopped && status === 0 && existsSync(tmpOut);
    await ended({
      say: `${sayDone} ${ok ? "ready" : "failed"}`,
      level: ok ? "ok" : "warn",
    });
    if (!ok) {
      rmSync(tmpOut, { force: true });
      console.error(
        `${commandLabel}: ${stopped ? `stopped after ${minutes} minute(s)` : `ffmpeg failed (exit ${status})`}; ${outPath} unchanged`,
      );
      process.exit(1);
    }
    renameSync(tmpOut, outPath);
  } finally {
    rmSync(tmpOut, { force: true });
    for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
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
    `next: pass ${displayOut} to your video reviewer (e.g. aistudio); keep references/ clean`,
  );
  process.exit(0);
}

export async function runSidebyside(rawArgs, { usage, runWorker }) {
  const argv = cliArgs(
    SIDEBYSIDE_HELP,
    [
      "--out file",
      "--audio mode",
      "--layout mode",
      "--short-edge px",
      "--full",
      "--crf N",
      "--minutes N",
    ],
    2,
    rawArgs,
  );
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      audio: { type: "string" },
      layout: { type: "string" },
      "short-edge": { type: "string" },
      full: { type: "boolean" },
      crf: { type: "string" },
      minutes: { type: "string" },
    },
  });
  if (positionals.length !== 2) usage("Choose sidebyside <reference> <remake>");
  if (values.full && values["short-edge"] !== undefined)
    usage("Use either --full or --short-edge, not both");
  const audioMode = values.audio ?? "ours";
  if (!["ours", "ref", "none"].includes(audioMode)) usage("--audio takes ours, ref, or none");
  const layoutMode = values.layout ?? "auto";
  if (!["auto", "hstack", "vstack"].includes(layoutMode))
    usage("--layout takes auto, hstack, or vstack");
  const shortEdge = values.full
    ? null
    : numberArg("--short-edge", values["short-edge"] ?? "720", { min: 144, max: 4320, int: true });
  const crf = numberArg("--crf", values.crf ?? "22", { min: 0, max: 51, int: true });
  const minutes = numberArg("--minutes", values.minutes ?? "10", { min: 0.01, max: 60 });
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
  const outPath = resolveDistinctMp4Output(
    values.out,
    join("renders/reference", `${refStem}_vs_${remStem}.mp4`),
    [refSource, remSource],
    "--out must differ from both inputs: keep sources untouched",
    usage,
  );

  const refInfo = probeVideoMedia(refSource);
  const remInfo = probeVideoMedia(remSource);
  if (refInfo.error || remInfo.error) {
    console.error(`reference sidebyside: ${refInfo.error ?? remInfo.error}`);
    process.exit(1);
  }

  const remPicture = findRemakePicture(remSource);
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
  const targetDur = Math.max(refInfo.duration, remInfo.duration, 1 / targetFps);
  const totalFrames = Math.max(1, Math.round(targetDur * targetFps));
  const padDur = targetDur + 0.5;

  const pickedAudio =
    audioMode === "ours"
      ? remInfo.audio
        ? { inputIndex: 1, stream: remInfo.audio, tag: "ours" }
        : { inputIndex: null, stream: null, tag: "none" }
      : audioMode === "ref"
        ? refInfo.audio
          ? { inputIndex: 0, stream: refInfo.audio, tag: "ref" }
          : { inputIndex: null, stream: null, tag: "none" }
        : { inputIndex: null, stream: null, tag: "none" };

  const layoutLabel = layout === "hstack" ? "REF | OURS" : "REF / OURS";
  const leftChars = 15 + String(totalFrames).length;
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
      `tpad=stop_mode=add:stop_duration=${padDur.toFixed(3)}:color=black`,
      `trim=end_frame=${totalFrames}`,
      "setpts=PTS-STARTPTS",
    ];
    return `${inputSpec}${parts.join(",")}`;
  };

  const barY = `h-${barH}+(${barH}-text_h)/2`;
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
      `[left][right]hstack=inputs=2,pad=${outW}:${outH}:0:${headH}:black,` +
        `drawtext=${font}:text='REF':fontcolor=#e6e4dc:fontsize=${headFont}:x=(${panelW}-tw)/2:y=(${headH}-text_h)/2,` +
        `drawtext=${font}:text='OURS':fontcolor=#e6e4dc:fontsize=${headFont}:x=${panelW + seam}+(${panelW}-tw)/2:y=(${headH}-text_h)/2,` +
        `drawtext=${font}:text='%{pts\\:hms}  f%{n}':fontcolor=white:fontsize=${barFont}:x=${margin}:y=${barY}${rightSuffix}[outv]`,
    ].join(";");
  } else {
    const botHeaderY = headH + panelH + seam;
    filterComplex = [
      `${prepPanel("[0:V:0]", null)},pad=${panelW}:${headH + panelH + seam}:0:${headH}:black,drawbox=x=0:y=${headH + panelH}:w=${panelW}:h=${seam}:color=#141414:t=fill[top]`,
      `${prepPanel("[1:V:0]", remCrop)},pad=${panelW}:${headH + panelH + barH}:0:${headH}:black[bot]`,
      `[top][bot]vstack=inputs=2,` +
        `drawtext=${font}:text='REF':fontcolor=#e6e4dc:fontsize=${headFont}:x=(${panelW}-tw)/2:y=(${headH}-text_h)/2,` +
        `drawtext=${font}:text='OURS':fontcolor=#e6e4dc:fontsize=${headFont}:x=(${panelW}-tw)/2:y=${botHeaderY}+(${headH}-text_h)/2,` +
        `drawtext=${font}:text='%{pts\\:hms}  f%{n}':fontcolor=white:fontsize=${barFont}:x=${margin}:y=${barY}${rightSuffix}[outv]`,
    ].join(";");
  }

  await runAtomicFfmpeg({
    runWorker,
    jobName: "reference sidebyside",
    sayStart: `Tiling ${basename(refSource)} vs ${basename(remSource)}`,
    sayDone: "Side-by-side video",
    commandLabel: "reference sidebyside",
    outPath,
    minutes,
    cleanupDirs,
    ffmpegArgs: [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-i",
      refSource,
      "-i",
      remSource,
      "-filter_complex",
      filterComplex,
      "-map",
      "[outv]",
      ...(pickedAudio.inputIndex !== null
        ? [
            "-map",
            `${pickedAudio.inputIndex}:a:0`,
            ...(pickedAudio.stream.codec_name === "aac"
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
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ],
  });

  const displayOut = formatDisplayOut(outPath);
  console.log(
    `wrote ${displayOut} (${outW}x${outH}, ${layout} ${layoutLabel}, ${targetFps}fps, ref ${refInfo.duration.toFixed(2)}s vs ours ${remInfo.duration.toFixed(2)}s, audio:${pickedAudio.tag}${remPicture ? ", stripped draft bar" : ""}; sources untouched)`,
  );
  console.log(
    `next: pass ${displayOut} to your video reviewer with compare-2-video.md; keep sources clean`,
  );
  process.exit(0);
}
