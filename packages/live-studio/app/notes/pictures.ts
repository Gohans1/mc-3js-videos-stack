import { engine } from "../core/engine";
import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { stamp } from "../core/time";
import {
  compareVideoCaptureSize,
  type CompareVideoSession,
  withCompareVideoCapture,
  withCompareVideoFrames,
} from "../picture/compare-video";
import type { NoteCompareSource } from "../picture/compare-video-model";
import { frameSize } from "../picture/frame";
import { tone } from "../timeline/canvas";
import { drawMark } from "./ink";
import { pickSnapshotSource } from "./review-nav";
import type { Mark, Pin } from "./slice";

const withSnapshotSource = async <T>(
  at: number,
  read: (from: HTMLCanvasElement | null) => T,
  matchFinal = true,
): Promise<T> => {
  const finalEl = engine.finalCanvas();
  const source = pickSnapshotSource({
    at,
    playhead: S.t,
    finalAt: S.finalAt,
    hasFinal: !!finalEl && matchFinal,
    hasRender: !!S.render,
  });
  if (!source) return read(null);
  if (source === "final") return read(finalEl!);
  let result!: T;
  await engine.render(at, () => {
    result = read(S.el.canvas);
  });
  return result;
};
const paintAnnotatedFrame = (
  from: CanvasImageSource,
  w: number,
  h: number,
  pin: Pin | null | undefined,
  at: number,
  marks: Mark[],
) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(from, 0, 0, w, h);
  const scale = Math.max(0.75, Math.min(1.4, Math.max(w, h) / 960));
  for (const m of marks) drawMark(g, m, at, w, h, tone("ink"), scale);
  if (pin) {
    g.strokeStyle = tone("primary");
    g.lineWidth = 3 * scale;
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 14 * scale, 0, 7);
    g.stroke();
    g.strokeStyle = tone("stage");
    g.lineWidth = Math.max(1, scale);
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 16 * scale, 0, 7);
    g.stroke();
  }
  return c.toDataURL("image/jpeg", 0.85);
};
type CompareCaptureTarget = NoteCompareSource | CompareVideoSession | null;

const isCompareSession = (target: CompareCaptureTarget): target is CompareVideoSession =>
  Boolean(target && "captureAt" in target);

export const snapshot = (
  pin: Pin | null | undefined,
  at: number,
  marks: Mark[] = [],
  matchFinal = true,
  compareTarget: CompareCaptureTarget = null,
) => {
  if (compareTarget) {
    const read = (video: HTMLVideoElement | null) => {
      if (!video) return null;
      const [w, h] = compareVideoCaptureSize(video, 1280);
      return paintAnnotatedFrame(video, w, h, pin, at, marks);
    };
    return isCompareSession(compareTarget)
      ? compareTarget.captureAt(at, read)
      : withCompareVideoCapture(at, read, compareTarget);
  }
  return withSnapshotSource(
    at,
    (from) => {
      if (!from) return null;
      const [w, h] = frameSize(960);
      return paintAnnotatedFrame(from, w, h, pin, at, marks);
    },
    matchFinal,
  );
};
export const pinCrop = (pin: Pin, at: number, compareTarget: CompareCaptureTarget = null) => {
  if (compareTarget) {
    const read = (video: HTMLVideoElement | null) => {
      if (!video) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.max(32, Math.round(Math.min(vw, vh) * 0.34));
      const sx = Math.max(0, Math.min(vw - side, pin.x * vw - side / 2));
      const sy = Math.max(0, Math.min(vh - side, pin.y * vh - side / 2));
      const c = document.createElement("canvas");
      c.width = c.height = 480;
      c.getContext("2d")!.drawImage(video, sx, sy, side, side, 0, 0, 480, 480);
      return c.toDataURL("image/jpeg", 0.85);
    };
    return isCompareSession(compareTarget)
      ? compareTarget.captureAt(at, read)
      : withCompareVideoCapture(at, read, compareTarget);
  }
  return withSnapshotSource(at, (from) => {
    if (!from) return null;
    const side = Math.round(Math.min(from.width, from.height) * 0.34);
    const c = document.createElement("canvas");
    c.width = c.height = 480;
    c.getContext("2d")!.drawImage(
      from,
      pin.x * from.width - side / 2,
      pin.y * from.height - side / 2,
      side,
      side,
      0,
      0,
      480,
      480,
    );
    return c.toDataURL("image/jpeg", 0.85);
  });
};
const STRIP = [-2, -1, 0, 1];
export const momentStrip = async (at: number, compareTarget: CompareCaptureTarget = null) => {
  if (compareTarget) {
    const times = STRIP.map((d) => Math.max(0, at + d));
    let c: HTMLCanvasElement | null = null;
    let g: CanvasRenderingContext2D | null = null;
    let w = 0;
    let h = 0;
    const readFrame = (video: HTMLVideoElement, i: number, filmT: number) => {
      if (!c || !g) {
        [w, h] = compareVideoCaptureSize(video, 480);
        c = document.createElement("canvas");
        c.width = w * STRIP.length;
        c.height = h;
        g = c.getContext("2d")!;
        g.font = "bold 20px Consolas,monospace";
      }
      g.drawImage(video, i * w, 0, w, h);
      g.fillStyle = tone("scrim-strong");
      g.fillRect(i * w + 4, 4, 128, 28);
      g.fillStyle = STRIP[i] === 0 ? tone("primary") : tone("picture");
      g.fillText(stamp(filmT), i * w + 8, 25);
      g.fillStyle = tone("stage");
      g.fillRect(i * w, 0, 2, h);
    };
    const finish = () => (c ? c.toDataURL("image/jpeg", 0.8) : null);
    return isCompareSession(compareTarget)
      ? compareTarget.captureFrames(times, readFrame, finish)
      : withCompareVideoFrames(times, readFrame, finish, compareTarget);
  }
  const [w, h] = frameSize(400),
    c = document.createElement("canvas");
  c.width = w * STRIP.length;
  c.height = h;
  const g = c.getContext("2d")!;
  g.font = "bold 20px Consolas,monospace";
  for (const [i, d] of STRIP.entries()) {
    const x = Math.min(Math.max(0, at + d), DURATION - 0.02);
    await engine.render(x, () => g.drawImage(S.el.canvas, i * w, 0, w, h));
    g.fillStyle = tone("scrim-strong");
    g.fillRect(i * w + 4, 4, 128, 28);
    g.fillStyle = d === 0 ? tone("primary") : tone("picture");
    g.fillText(stamp(x), i * w + 8, 25);
    g.fillStyle = tone("stage");
    g.fillRect(i * w, 0, 2, h);
  }
  return c.toDataURL("image/jpeg", 0.8);
};
