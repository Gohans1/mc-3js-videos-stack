import { expect, test } from "bun:test";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import DATA from "../data/shakify.json";
import { handheld, SHAKES } from "../src/handheld";
import { blurPx, dollyZoom, fovOf, hfovOf, mmOf, nearestPrime } from "../src/lens";
import { inSafe, safe } from "../src/safe";

const A = 16 / 9;
type Cam = { p: number[]; l: number[]; fov: number; roll?: number };
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
