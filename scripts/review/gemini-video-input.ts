import { spawnSync } from "node:child_process";

export function toGeminiMediaResolution(
  media: string,
):
  | "MEDIA_RESOLUTION_UNSPECIFIED"
  | "MEDIA_RESOLUTION_LOW"
  | "MEDIA_RESOLUTION_MEDIUM"
  | "MEDIA_RESOLUTION_HIGH" {
  const norm = media.trim().toLowerCase();
  if (norm === "default" || norm === "unspecified") return "MEDIA_RESOLUTION_UNSPECIFIED";
  if (norm === "low") return "MEDIA_RESOLUTION_LOW";
  if (norm === "medium") return "MEDIA_RESOLUTION_MEDIUM";
  if (norm === "high") return "MEDIA_RESOLUTION_HIGH";
  throw new Error(
    `unsupported Gemini media resolution "${media}" (expected Default, Low, Medium, or High)`,
  );
}

export function expectedVideoTokensFloor(
  durationSec: number,
  fps: number,
  media: string,
  sourceFps?: number,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  const effectiveFps =
    sourceFps !== undefined && Number.isFinite(sourceFps) && sourceFps > 0
      ? Math.min(fps, sourceFps)
      : fps;
  const tokPerFrame = toGeminiMediaResolution(media) === "MEDIA_RESOLUTION_HIGH" ? 280 : 70;
  const nominal = durationSec * effectiveFps * tokPerFrame;
  if (nominal < 1_000) return 0;
  return Math.floor(nominal * 0.45);
}

type PictureSpan = { startSec: number; durationSec: number };

export function pictureDurationInRange(
  picture: { startSec?: number; durationSec: number },
  from = 0,
  to = Infinity,
): number {
  const start = picture.startSec ?? 0;
  return Math.max(0, Math.min(to, start + picture.durationSec) - Math.max(from, start));
}

function videoPacketSpan(videoPath: string, fps: number): PictureSpan | null {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "V:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      videoPath,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (probe.status !== 0) return null;
  let first = Infinity;
  let lastEnd = -Infinity;
  for (const row of probe.stdout.trim().split(/\r?\n/)) {
    const [pts, duration] = row.split(",").map(Number);
    if (!row || !Number.isFinite(pts)) continue;
    first = Math.min(first, pts!);
    lastEnd = Math.max(
      lastEnd,
      pts! + (duration && duration > 0 ? duration : fps > 0 ? 1 / fps : 0),
    );
  }
  return lastEnd > first ? { startSec: first, durationSec: lastEnd - first } : null;
}

export function probeVideoMeta(videoPath: string): PictureSpan & {
  sourceFps: number;
  hasAudioStream: boolean;
} {
  const p = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=start_time:stream=codec_type,start_time,duration,r_frame_rate,avg_frame_rate:stream_disposition=attached_pic",
      "-of",
      "json",
      videoPath,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 },
  );
  if (p.status !== 0 || !p.stdout.trim()) {
    return { startSec: 0, durationSec: 0, sourceFps: 0, hasAudioStream: false };
  }
  try {
    const j = JSON.parse(p.stdout) as {
      format?: { start_time?: string };
      streams?: Array<{
        codec_type?: string;
        duration?: string;
        start_time?: string;
        r_frame_rate?: string;
        avg_frame_rate?: string;
        disposition?: { attached_pic?: number };
      }>;
    };
    const streams = j.streams ?? [];
    const hasAudioStream = streams.some((s) => s.codec_type === "audio");
    const vStream = streams.find(
      (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
    );
    const parseRate = (raw?: string): number => {
      if (!raw) return 0;
      const [n, d] = raw.split("/").map(Number);
      if (!Number.isFinite(n) || !n) return 0;
      if (d !== undefined) return Number.isFinite(d) && d > 0 ? n / d : 0;
      return n;
    };
    const avg = parseRate(vStream?.avg_frame_rate);
    const raw = parseRate(vStream?.r_frame_rate);
    const sourceFps = avg > 0 && avg <= 240 ? avg : raw > 0 && raw <= 240 ? raw : 0;
    const videoDuration = Number(vStream?.duration ?? 0);
    const fileStart = Number(j.format?.start_time) || 0;
    const picture =
      videoDuration > 0
        ? { startSec: Number(vStream?.start_time ?? fileStart), durationSec: videoDuration }
        : vStream
          ? videoPacketSpan(videoPath, sourceFps)
          : null;
    return {
      startSec: picture ? picture.startSec - fileStart : 0,
      durationSec: picture?.durationSec ?? 0,
      sourceFps,
      hasAudioStream,
    };
  } catch {
    return { startSec: 0, durationSec: 0, sourceFps: 0, hasAudioStream: false };
  }
}
