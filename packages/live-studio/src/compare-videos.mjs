import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { defaultCompareLayout, inferCompareLayout } from "./compare-video-meta.ts";
import { ratioOf } from "./frame.ts";
import { filmVideo, readRenderEvidence } from "./video.mjs";

const execFileAsync = promisify(execFile);
const probeCache = new Map();
const pendingProbes = new Map();
const PROBE_CACHE_MAX = 64;

export const COMPARE_VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);

const SKIP_RENDER_DIRS = new Set([
  "live",
  "chunks",
  "final_chunks",
  "notes_backup",
  "refsheet",
  "scenes",
  "listen_stems",
]);
const SKIP_RENDER_PREFIXES = [".", "framecheck_", "review_", "mixed_", "run-"];
const CATEGORY_RANK = { compare: 0, render: 1, reference: 2 };

export const isSkippedRenderDir = (name) => {
  const lower = String(name ?? "").toLowerCase();
  return SKIP_RENDER_DIRS.has(lower) || SKIP_RENDER_PREFIXES.some((p) => lower.startsWith(p));
};

const isTempVideoName = (name) =>
  name.startsWith(".") || /\.(?:new|tmp)\.(?:mp4|webm|mov)$/i.test(name);

const readFilmRatio = (projectDir) => {
  try {
    const pkgFile = join(projectDir, "package.json");
    if (existsSync(pkgFile)) return ratioOf(JSON.parse(readFileSync(pkgFile, "utf8")));
  } catch {}
  return "16:9";
};

export const classifyCompareVideo = (relPath) => {
  const rel = String(relPath ?? "").replaceAll("\\", "/");
  const lower = rel.toLowerCase();
  if (lower.startsWith("references/")) return "reference";
  const name = basename(rel);
  if (/_timecode\./i.test(name) && !/(?:^|[_-])(sbs|sidebyside)(?:[_.-]|$)/i.test(name)) {
    return "reference";
  }
  if (/(?:^|[_-])(sbs|sidebyside|vs|compare|cmp)(?:[_.-]|$)/i.test(name)) return "compare";
  if (/^ref(?:[_.-]|$)/i.test(name) || /^orig\./i.test(name)) {
    return "reference";
  }
  if (lower.startsWith("renders/reference/")) return "compare";
  return "render";
};

export { defaultCompareLayout, inferCompareLayout };

const exactCompareLayout = (evidence) => {
  const layout = evidence?.compareLayout;
  return layout === "hstack" || layout === "vstack" ? layout : null;
};

const inferStartSec = (projectDir, fullFile, rel, evidence) => {
  if (Number.isFinite(evidence?.start) && evidence.start >= 0) return evidence.start;
  const fv = filmVideo(projectDir, fullFile);
  if (fv && Number.isFinite(fv.start) && fv.start >= 0) return fv.start;
  const m =
    /(?:^|[/_-])(?:span|compare)[_-](\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?!-\d)(?:[_.-]|$)/i.exec(rel);
  if (m) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) return start;
  }
  return 0;
};

const canonical = (p) => {
  const r = realpathSync(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

const isInsideCanonical = (rootCanon, targetCanon) =>
  targetCanon === rootCanon || targetCanon.startsWith(rootCanon + sep);

const hasControlChar = (value) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const validateCompareSegments = (segments) => {
  if (
    segments.length < 2 ||
    segments.some(
      (seg) => !seg || seg === "." || seg === ".." || seg.startsWith(".") || hasControlChar(seg),
    )
  ) {
    return { ok: false, status: 400, error: "Invalid video path" };
  }
  const top = segments[0].toLowerCase();
  const second = segments[1];
  if (top !== "renders" && top !== "references") {
    return { ok: false, status: 403, error: "Video path must be under renders/ or references/" };
  }
  if (top === "renders") {
    if (segments.length > 3) {
      return { ok: false, status: 403, error: "Nested render paths are not accessible" };
    }
    if (segments.length === 3 && isSkippedRenderDir(second)) {
      return { ok: false, status: 403, error: "Internal render folder is not accessible" };
    }
  }
  if (top === "references" && segments.length > 2) {
    return { ok: false, status: 403, error: "Nested reference paths are not accessible" };
  }
  const rel = segments.join("/");
  if (!COMPARE_VIDEO_EXTS.has(extname(rel).toLowerCase())) {
    return { ok: false, status: 400, error: "Unsupported video extension" };
  }
  return { ok: true, rel };
};

export const isValidCompareVideoPath = (rawPath) => {
  if (typeof rawPath !== "string") return false;
  if (
    !rawPath ||
    rawPath !== rawPath.trim() ||
    hasControlChar(rawPath) ||
    rawPath.includes("\\") ||
    rawPath.startsWith("/") ||
    /^[A-Za-z]:/.test(rawPath)
  ) {
    return false;
  }
  return validateCompareSegments(rawPath.split("/")).ok;
};

const scanDir = (projectDir, rootCanon, dir, depth, maxDepth, isRenders, out) => {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      if (depth >= maxDepth) continue;
      if (isRenders && depth === 0 && isSkippedRenderDir(name)) continue;
      if (name.startsWith(".")) continue;
      scanDir(projectDir, rootCanon, full, depth + 1, maxDepth, isRenders, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isTempVideoName(name)) continue;
    if (!COMPARE_VIDEO_EXTS.has(extname(name).toLowerCase())) continue;
    try {
      const real = canonical(full);
      if (!isInsideCanonical(rootCanon, real)) continue;
      const realRel = relative(rootCanon, real).replaceAll("\\", "/");
      if (!validateCompareSegments(realRel.split("/")).ok) continue;
      const st = statSync(full);
      if (!st.isFile() || st.size <= 0) continue;
      const rel = relative(projectDir, full).replaceAll("\\", "/");
      out.push({ full, rel, name, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
    } catch {}
  }
};

const newestValidated = (videos, candidates) => {
  const allowed = new Set(candidates.map((p) => p.toLowerCase()));
  let best = null;
  let bestMtime = -1;
  for (const item of videos) {
    if (allowed.has(item.path.toLowerCase()) && item.mtimeMs > bestMtime) {
      best = item.path;
      bestMtime = item.mtimeMs;
    }
  }
  return best;
};

export const listCompareVideos = (projectDir) => {
  const root = resolve(projectDir);
  if (!existsSync(root))
    return { videos: [], defaultPath: null, canBuild: { ref: null, ours: null } };
  const rootCanon = canonical(root);
  const filmRatio = readFilmRatio(root);
  const raw = [];
  scanDir(root, rootCanon, join(root, "renders"), 0, 1, true, raw);
  scanDir(root, rootCanon, join(root, "references"), 0, 0, false, raw);

  const videos = raw
    .map((item) => {
      const evidence = readRenderEvidence(item.full);
      const layout = exactCompareLayout(evidence);
      const category = layout ? "compare" : classifyCompareVideo(item.rel);
      const referencePath = evidence?.compareReference;
      const studioStartSec = evidence?.compareStudioStart;
      const embeddedAudio = evidence?.compareAudio;
      return {
        path: item.rel,
        name: item.name,
        category,
        size: item.size,
        mtimeMs: item.mtimeMs,
        startSec: inferStartSec(root, item.full, item.rel, evidence),
        layout: layout ?? defaultCompareLayout(category, filmRatio),
        ...(layout ? { layoutExact: true } : {}),
        ...(layout && referencePath !== undefined
          ? { referencePath: isValidCompareVideoPath(referencePath) ? referencePath : null }
          : {}),
        ...(layout && Number.isFinite(studioStartSec) && studioStartSec >= 0
          ? { studioStartSec }
          : {}),
        ...(layout && ["ours", "ref", "none"].includes(embeddedAudio) ? { embeddedAudio } : {}),
      };
    })
    .toSorted(
      (a, b) =>
        CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
        b.mtimeMs - a.mtimeMs ||
        b.path.localeCompare(a.path, undefined, { numeric: true }),
    );

  const refCandidates = videos.filter((v) => v.path.toLowerCase().startsWith("references/"));
  const preferredRef =
    refCandidates.find((v) => v.path.toLowerCase() === "references/ref.mp4")?.path ??
    refCandidates[0]?.path ??
    null;
  const preferredOurs =
    newestValidated(videos, ["renders/final.mp4", "renders/draft.mp4"]) ??
    newestValidated(videos, ["renders/final_video.mp4", "renders/draft_video.mp4"]);

  return {
    videos,
    defaultPath: videos[0]?.path ?? null,
    canBuild: { ref: preferredRef, ours: preferredOurs },
  };
};

export const compareVideosFingerprint = (projectDir) =>
  listCompareVideos(projectDir)
    .videos.map(
      (v) =>
        `${v.path}:${v.size}:${v.mtimeMs}:${v.startSec}:${v.layout}:${!!v.layoutExact}:${v.referencePath}:${v.studioStartSec}:${v.embeddedAudio}`,
    )
    .join("|");

export const resolveCompareVideoFile = (projectDir, rawPath) => {
  const trimmed = String(rawPath ?? "").trim();
  if (
    !trimmed ||
    hasControlChar(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return { ok: false, status: 400, error: "Invalid video path" };
  }
  const checked = validateCompareSegments(trimmed.split(/[\\/]/));
  if (!checked.ok) return checked;
  const { rel } = checked;
  const root = resolve(projectDir);
  const full = resolve(root, rel);
  if (!existsSync(full)) {
    return { ok: false, status: 404, error: "Video file not found" };
  }
  try {
    const rootCanon = canonical(root);
    const real = canonical(full);
    if (!isInsideCanonical(rootCanon, real)) {
      return { ok: false, status: 403, error: "Video path escapes film directory" };
    }
    const realRel = relative(rootCanon, real).replaceAll("\\", "/");
    const canonicalChecked = validateCompareSegments(realRel.split("/"));
    if (!canonicalChecked.ok) {
      return { ok: false, status: 403, error: canonicalChecked.error };
    }
    if (!statSync(full).isFile()) {
      return { ok: false, status: 404, error: "Video file not found" };
    }
  } catch {
    return { ok: false, status: 404, error: "Video file not found" };
  }
  return { ok: true, file: full, rel };
};

const parseRate = (raw) => {
  const [num, den] = String(raw ?? "0/1")
    .split("/")
    .map(Number);
  return den > 0 && num > 0 ? num / den : 0;
};

const readProbe = async (resolved, filmRatio, layout) => {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height,r_frame_rate,avg_frame_rate,duration:stream_disposition=attached_pic:stream_side_data=rotation:format=duration",
        "-of",
        "json",
        resolved.file,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const info = JSON.parse(stdout || "{}");
    const streams = Array.isArray(info.streams) ? info.streams : [];
    const video = streams.find(
      (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
    );
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    const rotation = Number(
      video?.side_data_list?.find((item) => item?.rotation !== undefined)?.rotation ?? 0,
    );
    const rotated = Math.abs(rotation) % 180 === 90;
    const width = video ? (rotated ? Number(video.height) : Number(video.width)) : 0;
    const height = video ? (rotated ? Number(video.width) : Number(video.height)) : 0;
    if (
      !video ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return { ok: false, status: 422, error: "File contains no video stream" };
    }
    const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;
    const duration = Number(video.duration) || Number(info.format?.duration) || 0;
    const category = classifyCompareVideo(resolved.rel);
    return {
      ok: true,
      path: resolved.rel,
      width,
      height,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : 30,
      hasAudio,
      layout: layout ?? inferCompareLayout(category, width, height, filmRatio),
    };
  } catch {
    return { ok: false, status: 422, error: "Could not probe video metadata" };
  }
};

export const probeCompareVideo = async (projectDir, rawPath) => {
  const resolved = resolveCompareVideoFile(projectDir, rawPath);
  if (!resolved.ok) return resolved;
  let st;
  try {
    st = statSync(resolved.file);
  } catch {
    return { ok: false, status: 404, error: "Video file not found" };
  }
  const filmRatio = readFilmRatio(resolve(projectDir));
  const layout = exactCompareLayout(readRenderEvidence(resolved.file));
  const key = `${resolved.file}:${st.size}:${Math.round(st.mtimeMs)}:${filmRatio}:${layout}`;
  const cached = probeCache.get(key);
  if (cached) return { ...cached };

  let job = pendingProbes.get(key);
  if (!job) {
    job = readProbe(resolved, filmRatio, layout)
      .then((result) => {
        if (result.ok) {
          if (probeCache.size >= PROBE_CACHE_MAX) probeCache.delete(probeCache.keys().next().value);
          probeCache.set(key, result);
        }
        return result;
      })
      .finally(() => pendingProbes.delete(key));
    pendingProbes.set(key, job);
  }
  return { ...(await job) };
};
