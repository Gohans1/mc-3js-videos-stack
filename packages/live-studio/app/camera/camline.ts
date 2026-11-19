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
  const free = tools.free;
  const pos = free.on ? free.p : cam.position;
  const look = free.on ? free.l : tools.look;
  const fov = free.on ? (free.fov ?? cam.fov) : cam.fov;
  const r = (v: Vec3) => [v.x, v.y, v.z].map((x) => +x.toFixed(3));
  const roll = free.on && free.roll ? +free.roll.toFixed(4) : 0;
  const wave = free.on && free.wave ? +free.wave.toFixed(3) : 0;
  const bob = free.on && free.bob ? +free.bob.toFixed(3) : 0;
  const fstop = free.on && free.fstop ? +free.fstop.toFixed(2) : 0;
  const focus =
    free.on && free.focus !== undefined && free.focus !== null
      ? structuredClone(free.focus)
      : undefined;
  const handheld = free.on && free.handheld ? structuredClone(free.handheld) : undefined;
  const extras =
    free.on && (roll || wave || bob || fstop || focus !== undefined || handheld !== undefined)
      ? [
          roll ? `roll: ${roll}` : "",
          wave ? `wave: ${wave}` : "",
          bob ? `bob: ${bob}` : "",
          fstop ? `fstop: ${fstop}` : "",
          focus !== undefined
            ? `focus: ${typeof focus === "number" ? +focus.toFixed(2) : JSON.stringify(focus)}`
            : "",
          handheld !== undefined
            ? `handheld: ${typeof handheld === "string" ? handheld : JSON.stringify(handheld)}`
            : "",
        ]
          .filter(Boolean)
          .map((part) => `, ${part}`)
          .join("")
      : "";
  const world = {
    p: r(pos),
    l: r(look),
    ...(free.on
      ? {
          fov: +fov.toFixed(1),
          ...(roll ? { roll } : {}),
          ...(wave ? { wave } : {}),
          ...(bob ? { bob } : {}),
          ...(fstop ? { fstop } : {}),
          ...(focus !== undefined ? { focus } : {}),
          ...(handheld !== undefined ? { handheld } : {}),
        }
      : {}),
  };
  if (!tools.zoomOf || !tools.smoother) {
    return {
      shot: i,
      line: `p: [${r(pos)}], l: [${r(look)}], fov: ${+fov.toFixed(1)}${extras}`,
      world,
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
    x: (pos.x - k * look.x) * inv - ox,
    y: (pos.y - k * look.y) * inv - oy,
    z: (pos.z - k * look.z) * inv - oz,
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
    line: `p: [${V(p)}, ${V(p)}], l: [${V(l)}, ${V(l)}], fov: ${+fov.toFixed(1)}${extras}`,
    world,
    warn: warn || undefined,
  };
};
export const copyCam = () => {
  const c = camLine(),
    s = `${stamp(S.t)} shot ${c.shot}: ${c.line}${c.warn ? ` (${c.warn})` : ""}`;
  navigator.clipboard?.writeText(s);
  say("Camera angle copied");
};
