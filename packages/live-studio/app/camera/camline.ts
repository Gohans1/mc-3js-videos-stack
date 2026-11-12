import { SHOTS_OUT as SHOTS } from "film/scene";
// The camera as a line: what makes this exact frame, to paste into a film's code or a note. A film whose camera lives in SHOTS
// (tools.zoomOf and tools.smoother) gets a SHOTS line with the shot's slow zoom and its head offset taken out; any other the
// camera in world terms
import * as THREE from "three";

import { shotEnd, shotIndex } from "../core/film";
import { S } from "../core/state";
import { say } from "../core/store";
import { stamp } from "../core/time";

export const camLine = () => {
  const tools = S.tools!,
    cam = tools.camera,
    i = shotIndex(S.t),
    shot = SHOTS[i];
  const look = tools.free.on ? tools.free.l : tools.look;
  if (!tools.zoomOf || !tools.smoother) {
    const r = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(3));
    return {
      shot: i,
      line: `p: [${r(cam.position)}], l: [${r(look)}], fov: ${+cam.fov.toFixed(1)}`,
      world: { p: r(cam.position), l: r(look) },
    };
  }
  const u = (S.t - shot.t) / (shotEnd(i) - shot.t);
  const k = tools.zoomOf(i) * (tools.smoother(u) - 0.5);
  const off = new THREE.Vector3();
  if (shot.rel && tools.head) {
    off.copy(tools.head);
    if (shot.off) off.x += tools.CELL ?? 0;
  }
  const l = look.clone().sub(off);
  const p = cam.position
    .clone()
    .addScaledVector(look, -k)
    .divideScalar(1 - k)
    .sub(off);
  const V = (v: THREE.Vector3) => `V(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
  const warn = [
    shot.pan && "this shot pans",
    shot.follow && "this shot follows the head",
    shot.walk && "this shot walks",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    shot: i,
    line: `p: [${V(p)}, ${V(p)}], l: [${V(l)}, ${V(l)}], fov: ${+cam.fov.toFixed(1)}`,
    world: {
      p: cam.position.toArray().map((v) => +v.toFixed(3)),
      l: look.toArray().map((v) => +v.toFixed(3)),
    },
    warn: warn || undefined,
  };
};
export const copyCam = () => {
  const c = camLine(),
    s = `${stamp(S.t)} shot ${c.shot}: ${c.line}${c.warn ? ` (${c.warn})` : ""}`;
  navigator.clipboard?.writeText(s);
  say("Camera angle copied");
};
