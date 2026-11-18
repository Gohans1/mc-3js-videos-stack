// While the free camera (F) is on: the film camera's own picture in a corner, as Unreal's camera preview and Theatre.js's
// reference window show it, so the shot as the video has it (post and fades included) sits beside the view being flown. It costs
// one more draw with the free camera off, and only when something other than the free camera changed (start.ts frame): flying
// alone never redraws it, playing or editing does. campath.ts takes the film camera's pose from the same draw
import { dofParams } from "film-stage/camera";
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
export const drawFilmView = async () => {
  const tools = S.tools,
    f = tools?.free,
    corner = S.el.filmview;
  if (!stale || !tools || !f?.on) return;
  const shown = corner.clientWidth > 0;
  if (!shown && !keys.length) return; // nobody asks: no corner picture, no camera path to pose
  stale = false;
  f.on = false;
  try {
    if (S.render!.renderFrame) await S.render!.renderFrame(S.t);
    else S.render!(S.t);
  } finally {
    f.on = true;
  }
  const cam = tools.camera;
  filmCam.position.copy(cam.position);
  filmCam.quaternion.copy(cam.quaternion);
  filmCam.aim.copy(tools.look);
  filmCam.focus = tools.optics?.focusM ?? cam.position.distanceTo(tools.look);
  filmCam.focusRange =
    tools.optics?.fstop && tools.optics.fstop > 0
      ? dofParams({ mm: tools.optics.mm, fstop: tools.optics.fstop, focus: filmCam.focus })
          .focusRange
      : 0;
  filmCam.fov = cam.fov;
  filmCam.aspect = cam.aspect;
  filmCam.rev++;
  if (!shown) return;
  // Read in the same task as the draw: the WebGL canvas keeps the frame until the browser shows it
  const w = Math.round(corner.clientWidth * devicePixelRatio),
    h = Math.round(corner.clientHeight * devicePixelRatio);
  if (corner.width !== w || corner.height !== h) {
    corner.width = w;
    corner.height = h;
  }
  corner.getContext("2d")!.drawImage(S.el.canvas, 0, 0, w, h);
};
