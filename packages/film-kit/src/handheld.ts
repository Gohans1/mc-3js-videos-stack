// A camera held by a person: real recorded camera wobble from Camera Shakify (Ian Hubert & Nathan Vegdahl; the data is CC0,
// data/shakify.LICENSE.txt; their add-on code is GPL and is not used here). Each recording loops seamlessly at 24 fps;
// samples are joined by Catmull-Rom so any t reads directly. Unlike Shakify, each track is centred on its mean, so the shake
// never shifts the framing you set (Investigation drifts the camera 6-12 cm off otherwise).
// Shakes: INVESTIGATION, THE_CLOSEUP, THE_WEDDING, WALK_TO_THE_STORE, HANDYCAM_RUN, OUT_CAR_WINDOW (rotate and move);
// BIKE_ON_GRAVEL_2D, SPACESHIP_SHAKE_2D, THE_ZEEK_2D (rotate only).
//   const hold = handheld("THE_CLOSEUP", { amount: 0.6, offset: 12 });  const { pos, quat } = hold(t);
//   after camera.lookAt(...): camera.translateX(pos[0]).translateY(pos[1]).translateZ(pos[2]); camera.quaternion.multiply(q.set(...quat))
// pos is metres and rot degrees [x: tilt, y: pan, z: roll], both in the camera's own axes (three's: x right, y up, looking
// down -z, the same as Blender's camera); quat applies rot in Blender's XYZ order. amount scales everything, move only the
// position, speed the playback rate; offset (seconds) starts the recording elsewhere so shots do not share one wobble.
import DATA from "../data/shakify.json";

export type ShakeName = keyof typeof DATA;
export const SHAKES = Object.keys(DATA) as ShakeName[];

const centred = (v?: number[]) => {
  if (!v) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.map((x) => x - m);
};

export function handheld(
  kind: ShakeName = "THE_CLOSEUP",
  { amount = 1, move = 1, speed = 1, offset = 0 } = {},
) {
  const s = DATA[kind] as Record<string, unknown> & { fps: number };
  if (!s) throw new Error(`handheld: no shake ${kind}; one of ${SHAKES.join(", ")}`);
  const loc = [0, 1, 2].map((i) => centred(s[`location${i}`] as number[] | undefined));
  const rot = [0, 1, 2].map((i) => centred(s[`rotation_euler${i}`] as number[] | undefined));
  const n = rot[0]!.length;
  const sample = (v: number[] | null, f: number) => {
    if (!v) return 0;
    const i = Math.floor(f),
      u = f - i;
    const at = (k: number) => v[((k % n) + n) % n];
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    return (
      p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)))
    );
  };
  return (t: number) => {
    const f = (t * speed + offset) * s.fps;
    const r = rot.map((v) => sample(v, f) * amount);
    const pos = loc.map((v) => sample(v, f) * amount * move) as [number, number, number];
    // Blender XYZ euler: x first, then y, then z, about fixed axes = qz * qy * qx
    const h = r.map((a) => a / 2),
      c = h.map(Math.cos),
      sn = h.map(Math.sin);
    const quat: [number, number, number, number] = [
      sn[0] * c[1] * c[2] - c[0] * sn[1] * sn[2],
      c[0] * sn[1] * c[2] + sn[0] * c[1] * sn[2],
      c[0] * c[1] * sn[2] - sn[0] * sn[1] * c[2],
      c[0] * c[1] * c[2] + sn[0] * sn[1] * sn[2],
    ];
    return { pos, rot: r.map((a) => (a * 180) / Math.PI) as [number, number, number], quat };
  };
}
