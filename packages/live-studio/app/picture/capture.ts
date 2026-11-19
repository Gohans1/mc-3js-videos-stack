import { engine } from "../core/engine";
import { S } from "../core/state";
import { frameSize } from "./frame";

export interface CapturedFrame {
  dataUrl: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

async function captureAt(
  at: number,
  longSide: number,
  withPixels: boolean,
): Promise<CapturedFrame | null> {
  if (!S.render || !S.el?.canvas || !S.el.canvas.width || !S.el.canvas.height) return null;
  const [w, h] = frameSize(longSide);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", withPixels ? { willReadFrequently: true } : undefined);
  if (!ctx) return null;

  let captured = false;
  const drawFilm = engine.renderFilmFrame ?? engine.render;
  await drawFilm(at, () => {
    const src = S.el?.canvas;
    if (!src || !src.width || !src.height) return;
    ctx.drawImage(src, 0, 0, w, h);
    captured = true;
  });
  if (!captured) return null;

  const rgba = withPixels ? ctx.getImageData(0, 0, w, h).data : new Uint8ClampedArray(0);
  return {
    dataUrl: c.toDataURL("image/jpeg", withPixels ? 0.82 : 0.88),
    rgba,
    width: w,
    height: h,
  };
}

export const captureFrameDataUrl = async (at: number, longSide = 960): Promise<string | null> =>
  (await captureAt(at, longSide, false))?.dataUrl ?? null;

export const captureFramePixels = (at: number, longSide = 160): Promise<CapturedFrame | null> =>
  captureAt(at, longSide, true);
