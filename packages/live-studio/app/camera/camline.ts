// The camera as a line: what makes this exact frame, to paste into a film's code or a note. A film whose camera lives in SHOTS
// (tools.zoomOf and tools.smoother) gets a SHOTS line with the shot's slow zoom and its head offset taken out; any other the
// camera in world terms
import { shotEnd, shotIndex } from "../core/film";
import { SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { S } from "../core/state";
import { say } from "../core/store";
import { stamp } from "../core/time";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const camLine = () => {
  const tools = S.tools!,
    cam = tools.camera,
    i = shotIndex(S.t),
    shot = SHOTS[i];
  const look = tools.free.on ? tools.free.l : tools.look;
  const r = (v: Vec3) => [v.x, v.y, v.z].map((x) => +x.toFixed(3));
  if (!tools.zoomOf || !tools.smoother) {
    return {
      shot: i,
      line: `p: [${r(cam.position)}], l: [${r(look)}], fov: ${+cam.fov.toFixed(1)}`,
      world: { p: r(cam.position), l: r(look) },
    };
  }
  const u = (S.t - shot.t) / (shotEnd(i) - shot.t);
  const k = tools.zoomOf(i) * (tools.smoother(u) - 0.5);
  const ox = shot.rel && tools.head ? tools.head.x + (shot.off ? (tools.CELL ?? 0) : 0) : 0,
    oy = shot.rel && tools.head ? tools.head.y : 0,
    oz = shot.rel && tools.head ? tools.head.z : 0;
  const l: Vec3 = { x: look.x - ox, y: look.y - oy, z: look.z - oz };
  const inv = 1 / (1 - k);
  const p: Vec3 = {
    x: (cam.position.x - k * look.x) * inv - ox,
    y: (cam.position.y - k * look.y) * inv - oy,
    z: (cam.position.z - k * look.z) * inv - oz,
  };
  const V = (v: Vec3) => `V(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
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
