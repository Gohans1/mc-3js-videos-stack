import { filmToVideoTime } from "../picture/compare-video-model.ts";
import { drawMark, resolveTone } from "./ink.ts";
import { inkTimes, spread } from "./model.ts";
import type { Mark, Pin } from "./types.ts";

export const REFS_MAX = 6;
const REF_SIDE = 1600;
const REF_QUALITY = 0.88;

export interface CapturedNoteMedia {
  img: string | null;
  crop: string | null;
  strip: string | null;
  frames: { t: number; img: string }[];
  dimensions: [number, number] | null;
}

export const videoCaptureSize = (video: HTMLVideoElement, maxLong = 1280): [number, number] => {
  const vw = Math.max(1, video.videoWidth);
  const vh = Math.max(1, video.videoHeight);
  const scale = Math.min(1, maxLong / Math.max(vw, vh));
  return [Math.max(2, Math.round(vw * scale)), Math.max(2, Math.round(vh * scale))];
};

export const paintAnnotatedVideoFrame = (
  video: HTMLVideoElement,
  pin: Pin | null | undefined,
  at: number,
  marks: readonly Mark[],
): string | null => {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
  const [w, h] = videoCaptureSize(video, 1280);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(video, 0, 0, w, h);
  const scale = Math.max(0.75, Math.min(1.4, Math.max(w, h) / 960));
  const inkColor = resolveTone("ink");
  for (const m of marks) drawMark(g, m, at, w, h, inkColor, scale);
  if (pin) {
    g.strokeStyle = resolveTone("primary");
    g.lineWidth = 3 * scale;
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 14 * scale, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = resolveTone("stage");
    g.lineWidth = Math.max(1, scale);
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 16 * scale, 0, Math.PI * 2);
    g.stroke();
  }
  return c.toDataURL("image/jpeg", 0.85);
};

export const paintPinCrop = (video: HTMLVideoElement, pin: Pin): string | null => {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const side = Math.max(32, Math.round(Math.min(vw, vh) * 0.34));
  const sx = Math.max(0, Math.min(vw - side, pin.x * vw - side / 2));
  const sy = Math.max(0, Math.min(vh - side, pin.y * vh - side / 2));
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 480;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(video, sx, sy, side, side, 0, 0, 480, 480);
  return c.toDataURL("image/jpeg", 0.85);
};

const seekVideoOnce = (video: HTMLVideoElement, rawDest: number, timeoutMs = 1500) =>
  new Promise<boolean>((resolve) => {
    const dest =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, Math.min(video.duration, rawDest))
        : Math.max(0, rawDest);
    const nearDest = () => Math.abs(video.currentTime - dest) <= 0.015;
    if (!video.seeking && video.readyState >= 2 && nearDest()) {
      resolve(true);
      return;
    }
    let phase: "seeking" | "awaiting-ready" | "done" = nearDest() ? "awaiting-ready" : "seeking";
    const finish = (ok: boolean) => {
      if (phase === "done") return;
      phase = "done";
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onSeeked = () => {
      if (phase === "done") return;
      phase = "awaiting-ready";
      if (!video.seeking && video.readyState >= 2) finish(true);
    };
    const onReady = () => {
      if (phase === "awaiting-ready" && !video.seeking && video.readyState >= 2) finish(true);
    };
    const onErr = () => finish(false);
    const timer = window.setTimeout(() => finish(video.readyState >= 2), timeoutMs);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onErr, { once: true });
    if (!nearDest() || video.readyState < 2) {
      if (video.readyState < 2 && video.preload !== "auto") {
        video.preload = "auto";
      }
      try {
        video.currentTime = dest;
      } catch {
        finish(false);
      }
    }
  });

const openOffscreenVideo = (src: string, timeoutMs = 3000) =>
  new Promise<HTMLVideoElement | null>((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener("loadeddata", onLoad);
      v.removeEventListener("canplay", onLoad);
      v.removeEventListener("error", onErr);
      if (ok && v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2) resolve(v);
      else {
        v.removeAttribute("src");
        v.load();
        resolve(null);
      }
    };
    const onLoad = () => finish(true);
    const onErr = () => finish(false);
    const timer = window.setTimeout(() => finish(v.readyState >= 2), timeoutMs);
    v.addEventListener("loadeddata", onLoad, { once: true });
    v.addEventListener("canplay", onLoad, { once: true });
    v.addEventListener("error", onErr, { once: true });
    v.src = src;
    v.load();
  });

export const captureNoteMedia = async (opts: {
  video: HTMLVideoElement | null;
  videoSrc: string | null;
  startSec: number;
  at: number;
  pin: Pin | null;
  marks: readonly Mark[];
}): Promise<CapturedNoteMedia> => {
  const { video, videoSrc, startSec, at, pin, marks } = opts;
  let img: string | null = null;
  let crop: string | null = null;
  const frames: { t: number; img: string }[] = [];
  let dimensions: [number, number] | null =
    video && video.videoWidth > 0 && video.videoHeight > 0
      ? [video.videoWidth, video.videoHeight]
      : null;

  const liveMatchesTime =
    Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) &&
    Math.abs(video!.currentTime + startSec - at) <= 0.12;

  const markTimes = marks.length ? spread(inkTimes(marks), 8) : [];
  const offTimeMarkTimes = markTimes.filter((mt) => Math.abs(mt - at) > 0.12);

  if (liveMatchesTime && video) {
    try {
      img = paintAnnotatedVideoFrame(video, pin, at, marks);
      if (pin) crop = paintPinCrop(video, pin);
      if (markTimes.length > 0 && offTimeMarkTimes.length === 0) {
        const frameImg = paintAnnotatedVideoFrame(video, null, at, marks);
        if (frameImg) frames.push({ t: +at.toFixed(3), img: frameImg });
      }
    } catch {}
  }

  const needOffscreen = Boolean(videoSrc) && (!img || offTimeMarkTimes.length > 0);

  if (needOffscreen && videoSrc) {
    const offscreen = await openOffscreenVideo(videoSrc);
    if (offscreen) {
      try {
        dimensions ??= [offscreen.videoWidth, offscreen.videoHeight];
        const dur =
          Number.isFinite(offscreen.duration) && offscreen.duration > 0 ? offscreen.duration : 0;

        if (!img) {
          const { t: targetVideoT } = filmToVideoTime(at, startSec, dur);
          if (await seekVideoOnce(offscreen, targetVideoT)) {
            img = paintAnnotatedVideoFrame(offscreen, pin, at, marks);
            if (pin && !crop) crop = paintPinCrop(offscreen, pin);
          }
        }

        if (markTimes.length && frames.length === 0) {
          for (const mt of markTimes) {
            if (liveMatchesTime && video && Math.abs(mt - at) <= 0.12) {
              const liveFrame = paintAnnotatedVideoFrame(video, null, mt, marks);
              if (liveFrame) {
                frames.push({ t: +mt.toFixed(3), img: liveFrame });
                continue;
              }
            }
            const { t: targetVideoT, outside } = filmToVideoTime(mt, startSec, dur);
            if (outside) continue;
            if (await seekVideoOnce(offscreen, targetVideoT, 1200)) {
              const frameImg = paintAnnotatedVideoFrame(offscreen, null, mt, marks);
              if (frameImg) frames.push({ t: +mt.toFixed(3), img: frameImg });
            }
          }
        }
      } catch {
      } finally {
        offscreen.pause();
        offscreen.removeAttribute("src");
        offscreen.load();
      }
    }
  }

  return { img, crop, strip: null, frames, dimensions };
};

export const toJpegDataUrl = (source: CanvasImageSource, w: number, h: number): string => {
  const k = Math.min(1, REF_SIDE / Math.max(1, w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", REF_QUALITY);
};

export const fileToRefJpeg = async (file: File): Promise<string> => {
  const bmp = await createImageBitmap(file);
  try {
    return toJpegDataUrl(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
};
