// CapCut's Color oscilloscope (Oscilloscope.tsx shows it under the picture): the frame on screen copied in the same task as its
// draw (the WebGL canvas keeps the frame only until the browser shows it), measured, then drawn as CapCut's three panes:
// RGB parade (each channel's levels across the picture), RGB waveform (the three laid over one another: white where they agree)
// and vectorscope (hue round the circle, saturation out from the middle). Levels read 0 to 1023 as CapCut and DaVinci label
// them. The frame is read small (W x H)
import { S } from "../core/state";
import { tone } from "../timeline/canvas";
import { get } from "../core/store";

const W = 256, H = 144, LEVELS = 256;
const tmp = (w: number, h: number) => { const c = Object.assign(document.createElement("canvas"), { width: w, height: h }); return { c, x: c.getContext("2d")!, img: new ImageData(w, h) }; };
const parade = tmp(W * 3, LEVELS), wave = tmp(W, LEVELS), vector = tmp(LEVELS, LEVELS);
const bins = [new Uint16Array(W * LEVELS), new Uint16Array(W * LEVELS), new Uint16Array(W * LEVELS)];
const vCount = new Uint16Array(LEVELS * LEVELS), vSum = new Float32Array(LEVELS * LEVELS * 3);

// How bright a bin draws: a level a few pixels share still shows, a flat stretch of picture doesn't burn out
const glow = (count: number, per: number) => Math.min(255, Math.sqrt(count / per) * 900);

// How much of the picture is pure black or pure white (BT.709 luma at the very ends): detail lost there. Written in the
// waveform's corner, amber past 2%
const clipped = { black: 0, white: 0 };

// src: the canvas just drawn, in this task (start.ts frame); null when the frame on screen wasn't drawn now. A copy is taken at
// once, shrunk on the GPU, and read when the GPU hands it back. While playing, ten readings a second; paused, every frame. A
// reading still running when the next frame comes reads that one after, so the scopes always end on the frame on screen
let asked = 0, last = 0, busy = false, next: ImageBitmap | null = null;
export const measureScopes = (src: HTMLCanvasElement | null) => {
  if (!src || !get().scopes) return;
  const now = performance.now();
  if (S.playing && now - last < 100) return;
  last = now;
  const id = ++asked;
  createImageBitmap(src, { resizeWidth: W, resizeHeight: H, resizeQuality: "low" }).then((copy) => {
    if (id !== asked) { copy.close(); return; }
    next?.close();
    next = copy;
    if (!busy) void readAll();
  }, () => {});
};
const readAll = async () => {
  busy = true;
  try {
    while (next) {
      const copy = next;
      next = null;
      try { const px = await pixels(copy); if (px) read(px); } finally { copy.close(); }
    }
  } finally { busy = false; }
};

// The copy comes back through WebGPU, whose mapAsync hands the bytes over without the page ever waiting on the GPU. Every
// WebGL or canvas way (getImageData, VideoFrame.copyTo, readPixels into a pixel buffer behind a fence) makes a call that waits
// on Chrome's GPU process, about 24 ms while the film plays: a hitch in the film at every reading (measured). A browser
// without WebGPU reads through a canvas, hitches and all
const rgba = new Uint8Array(W * H * 4);
type Gpu = { device: GPUDevice; frame: GPUTexture; out: GPUBuffer } | null;
let gpu: Promise<Gpu> | null = null, flat: OffscreenCanvasRenderingContext2D | null = null;
const startGpu = async (): Promise<Gpu> => {
  const device = await (await navigator.gpu?.requestAdapter())?.requestDevice();
  if (!device) return null;
  device.lost.then(() => { gpu = null; });
  return {
    device,
    frame: device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT }),
    out: device.createBuffer({ size: rgba.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
  };
};
const pixels = async (copy: ImageBitmap): Promise<Uint8Array | null> => {
  const g = await (gpu ??= startGpu().catch(() => null));
  if (!g) {
    flat ??= new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true })!;
    flat.drawImage(copy, 0, 0);
    return new Uint8Array(flat.getImageData(0, 0, W, H).data.buffer);
  }
  g.device.queue.copyExternalImageToTexture({ source: copy }, { texture: g.frame }, [W, H]);
  const work = g.device.createCommandEncoder();
  work.copyTextureToBuffer({ texture: g.frame }, { buffer: g.out, bytesPerRow: W * 4 }, [W, H]);
  g.device.queue.submit([work.finish()]);
  try { await g.out.mapAsync(GPUMapMode.READ); } catch { return null; } // the device was lost: the next reading starts a new one
  rgba.set(new Uint8Array(g.out.getMappedRange()));
  g.out.unmap();
  return rgba;
};
const read = (px: Uint8Array) => {
  for (const b of bins) b.fill(0);
  vCount.fill(0); vSum.fill(0);
  let black = 0, white = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
    bins[0][x * LEVELS + r]++; bins[1][x * LEVELS + g]++; bins[2][x * LEVELS + b]++;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 1.5) black++; else if (luma > 253.5) white++;
    // Cb right, Cr up, each -0.5..0.5 of full scale across the pane
    const cb = (b - luma) / 1.8556 / 255, cr = (r - luma) / 1.5748 / 255;
    const vx = Math.max(0, Math.min(LEVELS - 1, Math.round(LEVELS / 2 + cb * LEVELS))), vy = Math.max(0, Math.min(LEVELS - 1, Math.round(LEVELS / 2 - cr * LEVELS)));
    const k = vy * LEVELS + vx;
    vCount[k]++; vSum[k * 3] += r; vSum[k * 3 + 1] += g; vSum[k * 3 + 2] += b;
  }
  clipped.black = black / (W * H); clipped.white = white / (W * H);
  drawLevels();
  drawVector();
  paint(S.el.parade, parade.c, "parade");
  paint(S.el.wave, wave.c, "wave");
  paint(S.el.vector, vector.c, "vector");
};

const drawLevels = () => {
  const p = parade.img.data, w = wave.img.data;
  p.fill(0); w.fill(0);
  for (let c = 0; c < 3; c++) for (let x = 0; x < W; x++) for (let v = 0; v < LEVELS; v++) {
    const count = bins[c][x * LEVELS + v];
    if (!count) continue;
    const a = glow(count, H), row = LEVELS - 1 - v;
    const pi = (row * W * 3 + c * W + x) * 4;
    p[pi + c] = a; p[pi + 3] = 255;
    const wi = (row * W + x) * 4;
    w[wi + c] = a; w[wi + 3] = 255;
  }
  parade.x.putImageData(parade.img, 0, 0);
  wave.x.putImageData(wave.img, 0, 0);
};
const drawVector = () => {
  const d = vector.img.data;
  d.fill(0);
  for (let k = 0; k < vCount.length; k++) {
    const count = vCount[k];
    if (!count) continue;
    // Each dot in the picture's own colour there, lifted so a dark colour still shows
    const r = vSum[k * 3] / count, g = vSum[k * 3 + 1] / count, b = vSum[k * 3 + 2] / count, top = Math.max(r, g, b, 1), a = glow(count, 6) / 255;
    d[k * 4] = (155 + (r / top) * 100) * a; d[k * 4 + 1] = (155 + (g / top) * 100) * a; d[k * 4 + 2] = (155 + (b / top) * 100) * a; d[k * 4 + 3] = 255;
  }
  vector.x.putImageData(vector.img, 0, 0);
};

// The 75% colour bars' places, where a vectorscope's targets sit: R, Mg, B, Cy, G, Yl
const TARGETS = [[191, 0, 0, "R"], [191, 0, 191, "Mg"], [0, 0, 191, "B"], [0, 191, 191, "Cy"], [0, 191, 0, "G"], [191, 191, 0, "Yl"]] as const;
const GRID = "rgba(255,255,255,0.14)", LABEL = "rgba(255,255,255,0.45)";

const paint = (pane: HTMLCanvasElement, from: HTMLCanvasElement, kind: "parade" | "wave" | "vector") => {
  const dpr = devicePixelRatio, w = Math.round(pane.clientWidth * dpr), h = Math.round(pane.clientHeight * dpr);
  if (!w || !h) return;
  if (pane.width !== w || pane.height !== h) { pane.width = w; pane.height = h; }
  const x = pane.getContext("2d")!;
  x.clearRect(0, 0, w, h);
  x.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
  x.textBaseline = "middle";
  if (kind === "vector") {
    const s = Math.min(w, h) - 8 * dpr, ox = (w - s) / 2, oy = (h - s) / 2, cx = w / 2, cy = h / 2;
    x.drawImage(from, ox, oy, s, s);
    x.strokeStyle = GRID; x.lineWidth = dpr;
    x.beginPath(); x.arc(cx, cy, s / 2, 0, Math.PI * 2); x.moveTo(cx - s / 2, cy); x.lineTo(cx + s / 2, cy); x.moveTo(cx, cy - s / 2); x.lineTo(cx, cy + s / 2); x.stroke();
    // The skin tone line: where faces of every colour fall, about 123° round from Cb
    const skin = (-123 * Math.PI) / 180;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(skin) * s / 2, cy + Math.sin(skin) * s / 2); x.stroke();
    x.fillStyle = LABEL; x.textAlign = "center";
    for (const [r, g, b, name] of TARGETS) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b, tx = cx + ((b - luma) / 1.8556 / 255) * s, ty = cy - ((r - luma) / 1.5748 / 255) * s;
      x.strokeRect(tx - 4 * dpr, ty - 4 * dpr, 8 * dpr, 8 * dpr);
      x.fillText(name, tx + (tx < cx ? -12 : 12) * dpr, ty);
    }
    return;
  }
  const pad = 26 * dpr, top = 6 * dpr, bottom = h - 6 * dpr, at = (v: number) => bottom - (v / 1023) * (bottom - top);
  x.imageSmoothingEnabled = true;
  x.drawImage(from, pad, top, w - pad - 4 * dpr, bottom - top);
  x.strokeStyle = GRID; x.lineWidth = dpr; x.fillStyle = LABEL; x.textAlign = "right";
  for (const v of [0, 256, 512, 768, 1023]) {
    x.beginPath(); x.moveTo(pad, at(v)); x.lineTo(w - 4 * dpr, at(v)); x.stroke();
    if (v % 512 === 0 || v === 1023) x.fillText(String(v), pad - 4 * dpr, at(v));
  }
  if (kind === "parade") for (const k of [1, 2]) { const sx = pad + ((w - pad - 4 * dpr) * k) / 3; x.beginPath(); x.moveTo(sx, top); x.lineTo(sx, bottom); x.stroke(); }
  if (kind === "wave") {
    // On a dark plate of its own, so a trace under it never hides it
    const pct = (f: number) => (f > 0 && f < 0.01 ? "<1" : String(Math.round(f * 100))), y = bottom - 9 * dpr;
    const black = `Black ${pct(clipped.black)}%`, white = `White ${pct(clipped.white)}%   `, bw = x.measureText(black).width, ww = x.measureText(white).width;
    x.fillStyle = "rgba(0,0,0,0.78)";
    x.fillRect(w - 12 * dpr - bw - ww, y - 8 * dpr, bw + ww + 8 * dpr, 16 * dpr);
    x.textAlign = "right";
    x.fillStyle = clipped.black > 0.02 ? tone("warn") : LABEL;
    x.fillText(black, w - 8 * dpr, y);
    x.fillStyle = clipped.white > 0.02 ? tone("warn") : LABEL;
    x.fillText(white, w - 8 * dpr - bw, y);
  }
};
