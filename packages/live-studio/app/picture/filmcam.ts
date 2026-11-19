// While the free camera (F) is on: the film camera's own picture in a corner, as Unreal's camera preview and Theatre.js's
// reference window show it, so the shot as the video has it (post and fades included) sits beside the view being flown. It costs
// one more draw with the free camera off, and only when something other than the free camera changed (start.ts frame): flying
// alone never redraws it, playing or editing does. campath.ts takes the film camera's pose from the same draw
import { dofParams } from "film-stage/camera";
import type { Draw } from "film/scene";
import * as THREE from "three";

import { keys } from "../camera/cam";
import { S } from "../core/state";

export const filmCam = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  aim: new THREE.Vector3(),
  focus: 0,
  focusRange: 0,
  fov: 50,
  aspect: 16 / 9,
  rev: 0,
};
let stale = true;
export const staleFilmView = () => {
  stale = true;
};

// Called before the frame on screen is drawn: the free camera's view drawn next is what stays on the main canvas
export const drawFilmView = async (full?: Draw) => {
  const tools = S.tools,
    corner = S.el.filmview;
  if (!stale || !tools?.free.on) return;
  const source = full ?? S.render!;
  const updatedTools = source.tools;
  const f = updatedTools.free;
  const shown = corner.clientWidth > 0;
  if (!shown && !keys.length) return; // nobody asks: no corner picture, no camera path to pose
  stale = false;
  const wasFree = f.on;
  f.on = false;
  try {
    if (source.renderFrame) await source.renderFrame(S.t);
    else source(S.t);
  } finally {
    f.on = wasFree;
  }
  const { camera: cam, optics, look } = updatedTools;
  filmCam.position.copy(cam.position);
  filmCam.quaternion.copy(cam.quaternion);
  filmCam.aim.copy(look);
  filmCam.focus = optics?.focusM ?? cam.position.distanceTo(look);
  filmCam.focusRange =
    optics?.fstop && optics.fstop > 0
      ? dofParams({ mm: optics.mm, fstop: optics.fstop, focus: filmCam.focus })
          .focusRange
      : 0;
  filmCam.fov = cam.fov;
  filmCam.aspect = cam.aspect;
  filmCam.rev++;
  if (!shown) return;
  // Read in the same task as the draw: the WebGL canvas keeps the frame until the browser shows it
  const image = full ? S.el.final : S.el.canvas;
  if (full) S.finalAt = -1;
  const w = full ? image.width : Math.round(corner.clientWidth * devicePixelRatio),
    h = full ? image.height : Math.round(corner.clientHeight * devicePixelRatio);
  if (corner.width !== w || corner.height !== h) {
    corner.width = w;
    corner.height = h;
  }
  corner.getContext("2d")!.drawImage(image, 0, 0, w, h);
};
