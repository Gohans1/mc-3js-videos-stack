// One frame of the film on the picture, with the studio's overlays on the frame on screen only, and the final-quality copy
// of it on demand
import { buildScene } from "film/scene";

import { drawCamPath } from "../camera/campath";
import { AWAY, PHONE } from "../core/device";
import { S } from "../core/state";
import { get, invalidatePictures, set } from "../core/store";
import { drawGizmo } from "../objects/placed";
import { drawPageSelection } from "../openfilm/onpicture";
import { setPlaying } from "../playback/transport";
import { drawTextSel } from "../text/onpicture";
import { drawFilmView } from "./filmcam";
import { frameSize } from "./frame";
import { nightVision } from "./nightvision";
import { renderWithMonitor } from "./preview-monitor";

// The gizmo goes on top only of the frame on screen, not of frames drawn for a still or a look-ahead
const baseRatios = new WeakMap<NonNullable<NonNullable<typeof S.tools>["renderer"]>, number>();
const resizePreview = (scale: number) => {
  const tools = S.tools,
    renderer = tools?.renderer;
  if (!renderer) return;
  const base = baseRatios.get(renderer) ?? renderer.getPixelRatio();
  if (!baseRatios.has(renderer)) baseRatios.set(renderer, base);
  if (renderer.getPixelRatio() === base * scale) return;
  if (tools.resizePreview) tools.resizePreview(base * scale);
  else renderer.setPixelRatio(base * scale);
};
const draw = async (x: number, screen = true) => {
  if (screen) resizePreview(S.playing && get().preview.reduced && !PHONE ? 0.5 : 1);
  if (screen && x === S.t) {
    const split = !PHONE && S.tools?.free.on && get().filmView === "split";
    if (split) await buildFinal();
    await drawFilmView(split ? (S.finalRender ?? undefined) : undefined);
  }
  if (screen) nightVision(true);
  try {
    const renderFilm = async () => {
      if (S.render?.renderFrame) await S.render.renderFrame(x);
      else S.render?.(x);
    };
    if (screen) await renderWithMonitor(S.tools?.scene, renderFilm);
    else await renderFilm();
  } finally {
    if (screen) nightVision(false);
  }
  if (screen && x === S.t) {
    drawCamPath();
    drawGizmo();
    if (!get().preview.clean) {
      drawTextSel();
      drawPageSelection();
    }
  }
};
let drawing = Promise.resolve();
const queueFrame = (run: () => Promise<void>) => {
  const next = drawing.then(run);
  drawing = next.catch(() => {});
  return next;
};

export const render = (x: number, readFrame?: () => void) =>
  queueFrame(async () => {
    await draw(x);
    readFrame?.();
  });

export const readSceneFrame = (t: number, read: () => void) =>
  queueFrame(async () => {
    const free = S.tools?.free;
    const wasFree = free?.on ?? false;
    if (free) free.on = false;
    try {
      await draw(t, false);
      read();
    } finally {
      if (free) free.on = wasFree;
      S.dirty = true;
    }
  });

export const capturePreviewFrame = (t: number, read: (canvas: HTMLCanvasElement) => void) =>
  queueFrame(async () => {
    if (S.finalRender && get().final && t === S.t) {
      await drawFinalFrame();
      read(S.el.final);
    } else {
      resizePreview(1);
      await draw(t, false);
      read(S.el.canvas);
    }
    S.dirty = true;
    S.finalAt = -1;
  });

export const finalCanvas = () => (get().final && S.finalRender ? S.el.final : null);
// The final renderer is built the first time Final quality or Export still frame asks for it, once however often they ask
let building: Promise<void> | null = null;
export const buildFinal = () => {
  if (S.finalRender) return Promise.resolve();
  building ??= (async () => {
    set({ loading: "Building final quality (about 10 s, first time only)…" });
    try {
      const [w, h] = frameSize(1920);
      S.el.final.width = w;
      S.el.final.height = h;
      S.finalRender = await buildScene(S.el.final, w, h, false);
    } finally {
      set({ loading: "" });
      building = null;
    }
  })();
  return building;
};
// The frame on screen at final quality, into the final canvas (hidden unless Final quality is on), seen from the free camera
// when it is on
export const drawFinalFrame = async () => {
  const fr = S.finalRender!,
    free = S.tools!.free;
  Object.assign(fr.tools.free, { on: free.on, fov: free.fov });
  if (fr.tools.free.previewEffects !== undefined)
    fr.tools.free.previewEffects = free.previewEffects ?? false;
  fr.tools.free.p.copy(free.p);
  fr.tools.free.l.copy(free.l);
  if (fr.renderFrame) await fr.renderFrame(S.t);
  else fr(S.t);
};
export const drawFinal = async () => {
  await renderWithMonitor(S.finalRender?.tools.scene, drawFinalFrame);
  drawGizmo(S.finalRender!.tools);
  S.finalAt = S.t;
  S.el.final.hidden = false;
  if (!S.playing && get().review) invalidatePictures();
};
export const setFinal = async (on: boolean) => {
  if (AWAY) return;
  set({ final: on });
  if (!on) {
    S.el.final.hidden = true;
    invalidatePictures();
    return;
  }
  if (S.playing) setPlaying(false);
  await buildFinal();
  S.finalAt = -1;
  S.dirty = true;
  invalidatePictures();
};
