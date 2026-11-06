import { expect, test } from "bun:test";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import DATA from "../data/shakify.json";
import { handheld, SHAKES } from "../src/handheld";
import { blurPx, dollyZoom, fovOf, hfovOf, mmOf, nearestPrime } from "../src/lens";
import { inSafe, safe } from "../src/safe";
import { type Cam, project, shotcheck, shotlist, view } from "../src/shotcheck";

const A = 16 / 9;
const threeCam = (c: Cam) => {
  const k = new PerspectiveCamera(c.fov, A, 0.05, 100);
  k.position.set(...(c.p as [number, number, number]));
  k.up.set(0, 1, 0);
  k.lookAt(new Vector3(...(c.l as [number, number, number])));
  k.rotateZ(((c.roll ?? 0) * Math.PI) / 180);
  k.updateMatrixWorld();
  k.updateProjectionMatrix();
  return k;
};

test("lens: full-frame millimetres match a photographer's angles and three's setFocalLength on a 36 mm gauge", () => {
  expect(hfovOf(fovOf(50, A), A)).toBeCloseTo(39.6, 1);
  expect(hfovOf(fovOf(24, A), A)).toBeCloseTo(73.7, 1);
  expect(mmOf(fovOf(85, A), A)).toBeCloseTo(85, 9);
  const k = new PerspectiveCamera(50, A);
  k.filmGauge = 36;
  k.setFocalLength(35);
  expect(k.fov).toBeCloseTo(fovOf(35, A), 9);
  expect(nearestPrime(30)).toBe(35);
  expect(nearestPrime(60)).toBe(50);
});

test("lens: a dolly zoom keeps the subject the same size on screen", () => {
  const f0 = fovOf(35, A), f1 = fovOf(85, A), d0 = 3, d1 = dollyZoom(d0, f0, f1);
  const size = (d: number, fov: number) => new Vector3(0, 0.5, 0).project(threeCam({ p: [0, 0, d], l: [0, 0, 0], fov })).y;
  expect(size(d1, f1)).toBeCloseTo(size(d0, f0), 9);
});

test("lens: thin-lens blur is zero at the focus and about 33 px for a 50 mm f/2 background", () => {
  expect(blurPx({ mm: 50, fstop: 2, focus: 2, dist: 2 })).toBeCloseTo(0, 9);
  expect(blurPx({ mm: 50, fstop: 2, focus: 2, dist: 100 })).toBeCloseTo(33.5, 0);
});

test("safe: EBU R 95 insets at 1920x1080", () => {
  expect(safe(1920, 1080)).toEqual([96, 54, 1824, 1026]);
  expect(safe(1920, 1080, "action")[0]).toBeCloseTo(67.2, 9);
  expect(inSafe([100, 900, 1800, 1000], 1920, 1080)).toBe(true);
  expect(inSafe([90, 900, 1800, 1000], 1920, 1080)).toBe(false);
});

test("handheld: loops, is centred, passes through the recording and its quat is Blender's XYZ order", () => {
  for (const name of SHAKES) {
    const h = handheld(name), n = (DATA[name] as { rotation_euler0: number[] }).rotation_euler0.length;
    expect(h(0.37).rot[1]).toBeCloseTo(h(0.37 + n / 24).rot[1], 9);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += h(i / 24).rot[0];
    expect(Math.abs(sum / n)).toBeLessThan(1e-9);
    const [rx, ry, rz] = h(1.234).rot.map((d) => (d * Math.PI) / 180);
    const q = new Quaternion().setFromEuler(new Euler(rx, ry, rz, "ZYX"));
    const mine = h(1.234).quat;
    expect(Math.abs(mine[0] * q.x + mine[1] * q.y + mine[2] * q.z + mine[3] * q.w)).toBeCloseTo(1, 12);
  }
  const raw = (DATA.THE_CLOSEUP as { rotation_euler2: number[] }).rotation_euler2, m = raw.reduce((a, b) => a + b, 0) / raw.length;
  expect(handheld("THE_CLOSEUP")(5 / 24).rot[2]).toBeCloseTo(((raw[5] - m) * 180) / Math.PI, 9);
  expect(handheld("THE_ZEEK_2D")(3).pos).toEqual([0, 0, 0]);
  expect(handheld("HANDYCAM_RUN", { amount: 0 })(3).rot.every((x) => x === 0)).toBe(true);
});

test("shotcheck projects exactly as a three.js camera does, roll included", () => {
  const c: Cam = { p: [1, 2, 5], l: [-0.5, 1.2, 0], fov: 38, roll: 7 };
  const k = threeCam(c), w = view(c, A);
  for (const q of [[0, 1, 0], [0.4, 1.9, -1], [-1, 0.3, 1]] as [number, number, number][]) {
    const t = new Vector3(...q).project(k), s = project(w, q);
    expect(s.x).toBeCloseTo(t.x, 9);
    expect(s.y).toBeCloseTo(t.y, 9);
  }
});

// a subject standing at the origin, eyes 1.6 m up, and a camera that orbits it
const eye: [number, number, number] = [0, 1.6, 0];
const still = () => ({ steve: { eye, top: [0, 1.8, 0] as [number, number, number] } });
const orbit = (deg: number, d: number, fov = 40): Cam => {
  const a = (deg * Math.PI) / 180;
  return { p: [Math.sin(a) * d, 1.6, Math.cos(a) * d], l: eye, fov };
};
const run = (camera: (t: number) => Cam, cuts: number[], subjects: any = still, to = 4) => shotcheck({ from: 0, to, camera, cuts, subjects });

test("shotcheck: a clean cut prints nothing", () => {
  expect(run((t) => (t < 2 ? orbit(0, 4) : orbit(45, 2.5)), [2])).toEqual([]);
});

test("shotcheck: jump cut, flash cut, zoom, roll, fast pan", () => {
  expect(run((t) => (t < 2 ? orbit(0, 4) : orbit(10, 4.2)), [2]).join("\n")).toContain("jump cut on steve");
  expect(run((t) => (t < 2 ? orbit(0, 4) : t < 2.2 ? orbit(60, 2) : orbit(0, 4)), [2, 2.2]).join("\n")).toContain("flash cut");
  expect(run((t) => orbit(0, 4, 50 - 5 * t), []).join("\n")).toContain("a zoom");
  expect(run(() => ({ ...orbit(0, 4), roll: 3 }), []).join("\n")).toContain("horizon tilted up to 3.0");
  const pan = (t: number): Cam => ({ p: [0, 1.6, 4], l: [4 * Math.sin(t * 1.5), 1.6, 4 - 4 * Math.cos(t * 1.5)], fov: 40 });
  expect(run(pan, []).join("\n")).toContain("pans up to 86 deg/s");
});

test("shotcheck: the 180-degree line, screen direction and eyeline", () => {
  const two = () => ({ a: { eye: [-1, 1.6, 0] as [number, number, number] }, b: { eye: [1, 1.6, 0] as [number, number, number] } });
  const side = (z: number): Cam => ({ p: [0, 1.6, z], l: [0, 1.6, 0], fov: 50 });
  expect(run((t) => side(t < 2 ? 5 : -5), [2], two).join("\n")).toContain("a and b swap screen sides");
  const overhead: Cam = { p: [0, 6, -0.01], l: [0, 1.6, 0], fov: 50 }; // seen from above with a and b swapped
  expect(run((t) => (t < 2 ? side(5) : overhead), [2], two).join("\n")).not.toContain("swap");
  const bobbing = (t: number) => ({ w: { eye: [Math.sin(t * 9) * 0.1, 1.6, 0] as [number, number, number], at: [0, 0, 0] as [number, number, number] } });
  expect(run((t) => side(t < 2 ? 5 : -5), [2], bobbing).join("\n")).not.toContain("screen direction");
  const walker = (t: number) => ({ w: { eye: [t * 0.8 - 1.6, 1.6, 0] as [number, number, number] } });
  const follow = (z: number) => (t: number): Cam => ({ p: [t * 0.8 - 1.6, 1.6, z], l: [t * 0.8 - 1.6, 1.6, 0], fov: 50 });
  expect(run((t) => (t < 2 ? follow(5) : follow(-5))(t), [2], walker).join("\n")).toContain("screen direction flips");
  const looker = () => ({ s: { eye, look: [3, 1.6, 0] as [number, number, number] } });
  expect(run((t) => (t < 2 ? orbit(0, 3) : orbit(180, 3)), [2], looker).join("\n")).toContain("eyeline flips");
});

test("shotcheck: a camera that moves before the subject does, and one that follows it", () => {
  const walker = (t: number) => ({ w: { eye: [Math.max(0, t - 2) * 0.8, 1.6, 0] as [number, number, number] } });
  const cam = (start: number) => (t: number): Cam => ({ p: [Math.max(0, t - start) * 0.8, 1.6, 4], l: [Math.max(0, t - start) * 0.8, 1.6, 0], fov: 40 });
  expect(run(cam(1.9), [], walker).join("\n")).toContain("camera starts 3 frames before w's move");
  expect(run(cam(2.15), [], walker).join("\n")).not.toContain("camera starts");
});

test("shotcheck: framing (joint cut, head tangent, headroom, lead room)", () => {
  const bottom = 1.6 - 4 * Math.tan((20 * Math.PI) / 180);
  const legs = () => ({ steve: { eye, joints: { knee: [0.2, bottom, 0] as [number, number, number] } } });
  expect(run(() => orbit(0, 4), [], legs).join("\n")).toContain("bottom edge cuts steve at knee");
  const ty = Math.tan((20 * Math.PI) / 180);
  const touching = () => ({ steve: { eye, top: [0, 1.6 + 4 * ty, 0] as [number, number, number] } });
  expect(run(() => orbit(0, 4), [], touching).join("\n")).toContain("touches the frame edge");
  const low: Cam = { p: [0, 1.75, 1], l: [0, 1.75, 0], fov: 40 };
  expect(run(() => low, []).join("\n")).toContain("too much headroom");
  const lookRight = () => ({ steve: { eye, look: [3, 1.6, 0] as [number, number, number] } });
  expect(run(() => ({ p: [-1, 1.6, 4], l: [-1, 1.6, 0], fov: 40 }), [], lookRight).join("\n")).toContain("lead room");
  expect(run(() => ({ p: [1, 1.6, 4], l: [1, 1.6, 0], fov: 40 }), [], lookRight)).toEqual([]);
});

test("shotlist: one line per shot plus the average", () => {
  const lines = shotlist({ from: 0, to: 4, camera: (t) => (t < 1 ? orbit(0, 4, fovOf(50, A)) : orbit(45, 2.5)), cuts: [1], subjects: still });
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(/^0\.00-1\.00 1\.0 s 50 mm \(prime 50\) steve eyes x\+0\.00 y[+-]0\.00 top y\+/);
  expect(lines[2]).toBe("2 shots, average 2.0 s, median 2.0 s");
});
