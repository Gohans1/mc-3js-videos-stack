// One frame of the film on the picture, with the studio's overlays on the frame on screen only, and the final-quality copy
// of it on demand
import { buildScene } from "film/scene";

import { drawCamPath } from "../camera/campath";
import { AWAY } from "../core/device";
import { S } from "../core/state";
import { get, invalidatePictures, set } from "../core/store";
import { drawGizmo } from "../objects/placed";
import { drawPageSelection } from "../openfilm/onpicture";
import { setPlaying } from "../playback/transport";
import { drawTextSel } from "../text/onpicture";
import { drawFilmView } from "./filmcam";
import { frameSize } from "./frame";
import { nightVision } from "./nightvision";

// The gizmo goes on top only of the frame on screen, not of frames drawn for a still or a look-ahead
const draw = async (x: number) => {
  if (x === S.t) await drawFilmView();
  nightVision(true);
  try {
    if (S.render?.renderFrame) await S.render.renderFrame(x);
    else S.render?.(x);
  } finally {
    nightVision(false);
  }
  if (x === S.t) {
    drawCamPath();
    drawGizmo();
    drawTextSel();
    drawPageSelection();
  }
};
let drawing = Promise.resolve();
export const render = (x: number, readFrame?: () => void) => {
  // Readback finishes before another queued draw can replace a note's requested picture.
  const next = drawing.then(async () => {
    await draw(x);
    readFrame?.();
  });
  drawing = next.catch(() => {});
  return next;
};

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
  fr.tools.free.p.copy(free.p);
  fr.tools.free.l.copy(free.l);
  if (fr.renderFrame) await fr.renderFrame(S.t);
  else fr(S.t);
};
export const drawFinal = async () => {
  await drawFinalFrame();
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
