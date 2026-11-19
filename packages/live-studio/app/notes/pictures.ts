import { engine } from "../core/engine";
import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { stamp } from "../core/time";
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
export const snapshot = (
  pin: Pin | null | undefined,
  at: number,
  marks: Mark[] = [],
  matchFinal = true,
) =>
  withSnapshotSource(
    at,
    (from) => {
      if (!from) return null;
      const c = document.createElement("canvas"),
        [w, h] = frameSize(960);
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.drawImage(from, 0, 0, w, h);
      for (const m of marks) drawMark(g, m, at, w, h, tone("ink"));
      if (pin) {
        g.strokeStyle = tone("primary");
        g.lineWidth = 3;
        g.beginPath();
        g.arc(pin.x * w, pin.y * h, 14, 0, 7);
        g.stroke();
        g.strokeStyle = tone("stage");
        g.lineWidth = 1;
        g.beginPath();
        g.arc(pin.x * w, pin.y * h, 16, 0, 7);
        g.stroke();
      }
      return c.toDataURL("image/jpeg", 0.85);
    },
    matchFinal,
  );
export const pinCrop = (pin: Pin, at: number) =>
  withSnapshotSource(at, (from) => {
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
const STRIP = [-2, -1, 0, 1];
export const momentStrip = async (at: number) => {
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
