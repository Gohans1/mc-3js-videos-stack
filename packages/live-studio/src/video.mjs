import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { ratioOf, sizeOf } from "./frame.ts";

// Where a rendered video sits on the film's heard clock, read from its name (render.mjs names them so):
//   renders/chunks/cNN.mp4, renders/final_chunks/cNN.mp4  NN*30 s on (render.mjs CHUNK)
//   renders/span_<from>-<to>.mp4                           a SPAN run's, <from> s on
// anything else starts at 0. final: render final's picture (final_chunks, final_video.mp4, mix's final.mp4), which
// render final draws again.
export const videoStart = (video) => {
  const chunk = /(?:^|[\\/])(final_)?chunks[\\/]c(\d+)\.mp4$/.exec(video);
  if (chunk) return { start: Number(chunk[2]) * 30, kind: "chunk", final: Boolean(chunk[1]) };
  const span = /(?:^|[\\/])span_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\.mp4$/.exec(video);
  if (span)
    return {
      start: Number(span[1]),
      kind: "span",
      final: false,
      span: [Number(span[1]), Number(span[2])],
    };
  return { start: 0, kind: null, final: /(?:^|[\\/])final(?:_video)?\.mp4$/.test(video) };
};

export const renderIdentity = (file) => {
  const st = statSync(file);
  return { size: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
};

const reviewFile = (file) => `${file}.review.json`;
export const readRenderEvidence = (file) => {
  if (!existsSync(reviewFile(file))) return null;
  try {
    const data = JSON.parse(readFileSync(reviewFile(file), "utf8"));
    const identity = renderIdentity(file);
    if (data.size === identity.size && data.mtimeMs === identity.mtimeMs) return data;
  } catch {}
  return {};
};

export function writeRenderEvidence(file, data) {
  writeFileSync(reviewFile(file), JSON.stringify({ ...data, ...renderIdentity(file) }));
}

const validCuts = (cuts) => Array.isArray(cuts) && cuts.every((n) => Number.isFinite(n) && n >= 0);

export function renderCuts(root, video) {
  const file = resolve(root, video);
  const data = readRenderEvidence(file);
  if (data) {
    if (validCuts(data.cuts))
      return {
        status: "bound",
        times: data.cuts,
        file: relative(root, reviewFile(file)).replaceAll("\\", "/"),
      };
    return { status: "unavailable", reason: "no matching cut metadata for this render" };
  }
  const old = join(root, "renders", "cuts.json");
  if (!existsSync(old))
    return { status: "missing", reason: "no cut metadata; bun run render clip records it" };
  try {
    const cuts = JSON.parse(readFileSync(old, "utf8"));
    if (!validCuts(cuts))
      return {
        status: "invalid",
        reason: "renders/cuts.json is no list of seconds; bun run render clip writes it again",
      };
    // Legacy global cut files were written before their own video.
    if (statSync(old).mtimeMs > statSync(file).mtimeMs)
      return {
        status: "unavailable",
        reason: "renders/cuts.json is newer than this video; render it again to bind its cuts",
      };
    return { status: "legacy", times: cuts, file: "renders/cuts.json" };
  } catch {
    return {
      status: "invalid",
      reason: "renders/cuts.json is no list of seconds; bun run render clip writes it again",
    };
  }
}

// A filename convention applies within the selected film's own renders.
export const filmVideo = (root, video) => {
  const file = resolve(root, video);
  const rel = relative(root, file).replaceAll("\\", "/");
  if (
    !/^renders\/(?:(?:draft|final)(?:_video)?\.mp4|(?:final_)?chunks\/c\d+\.mp4|span_\d+(?:\.\d+)?-\d+(?:\.\d+)?\.mp4)$/.test(
      rel,
    )
  )
    return null;
  try {
    if (
      !statSync(file).isFile() ||
      relative(realpathSync(root), realpathSync(file)).replaceAll("\\", "/") !== rel
    )
      return null;
  } catch {
    return null;
  }
  const where = videoStart(rel);
  const data = readRenderEvidence(file);
  return {
    ...where,
    start: Number.isFinite(data?.start) && data.start >= 0 ? data.start : where.start,
    mixed: /^renders\/(draft|final)\.mp4$/.test(rel),
  };
};

// The picture of a film render a draft's strip (heard time, shot) sits under: its top { width, height } at the film's
// ratio (package.json "live-studio".ratio, 16:9 by default), or null when the video is no film render or has no strip
export const filmPicture = (root, video) => {
  const file = resolve(root, video);
  if (!filmVideo(root, file)) return null;
  const size = probeVideo(file);
  if (!size) return null;
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {}
  const [w, h] = sizeOf(ratioOf(pkg), 16);
  const height = Math.trunc((size.width * h) / w / 2) * 2;
  return height < size.height ? { width: size.width, height } : null;
};

// A video's stream as ffprobe reads it ({ width, height, fps }), or null for a picture (ffprobe reads one as a one-frame
// video stream: image2, png_pipe, ...) or a file it cannot read
export const probeVideo = (file) => {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "V:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,avg_frame_rate:stream_side_data=rotation:format=format_name,start_time",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  let probed;
  try {
    probed = JSON.parse(r.stdout || "{}");
  } catch {
    return null;
  }
  const st = probed.streams?.[0];
  if (!st || /^image2|_pipe$/.test(probed.format?.format_name ?? "")) return null;
  const [num, den] = (st.r_frame_rate ?? "0/1").split("/").map(Number);
  const [frames, seconds] = (st.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = (seconds && frames / seconds) || num / (den || 1);
  const rotation = st.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ?? 0;
  const [width, height] =
    Math.abs(rotation) % 180 === 90 ? [st.height, st.width] : [st.width, st.height];
  const origin = Number(probed.format?.start_time ?? 0);
  return fps > 0 ? { width, height, fps, ...(origin && { origin }) } : null;
};
