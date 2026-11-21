import { expect, test } from "bun:test";

import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";

import DATA from "../data/shakify.json";
import { handheld, SHAKES } from "../src/handheld";
import {
  blurPx,
  dofParams,
  dollyZoom,
  fovOf,
  frameSubject,
  hfovOf,
  mmOf,
  nearestPrime,
  SHOT_SIZES,
  shotSize,
} from "../src/lens";
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
  const f0 = fovOf(35, A),
    f1 = fovOf(85, A),
    d0 = 3,
    d1 = dollyZoom(d0, f0, f1);
  const size = (d: number, fov: number) =>
    new Vector3(0, 0.5, 0).project(threeCam({ p: [0, 0, d], l: [0, 0, 0], fov })).y;
  expect(size(d1, f1)).toBeCloseTo(size(d0, f0), 9);
});

test("lens: thin-lens blur is zero at the focus and about 33 px for a 50 mm f/2 background", () => {
  expect(blurPx({ mm: 50, fstop: 2, focus: 2, dist: 2 })).toBeCloseTo(0, 9);
  expect(blurPx({ mm: 50, fstop: 2, focus: 2, dist: 100 })).toBeCloseTo(33.5, 0);
  const macro = blurPx({ mm: 135, fstop: 2, focus: 0.1, dist: 5 });
  expect(Number.isFinite(macro) && macro > 0).toBe(true);
  expect(blurPx({ mm: 50, fstop: 0, focus: 2, dist: 5 })).toBe(0);
});

test("safe: EBU R 95 insets at 1920x1080", () => {
  expect(safe(1920, 1080)).toEqual([96, 54, 1824, 1026]);
  expect(safe(1920, 1080, "action")[0]).toBeCloseTo(67.2, 9);
  expect(inSafe([100, 900, 1800, 1000], 1920, 1080)).toBe(true);
  expect(inSafe([90, 900, 1800, 1000], 1920, 1080)).toBe(false);
});

test("handheld: loops, is centred, passes through the recording and its quat is Blender's XYZ order", () => {
  for (const name of SHAKES) {
    const h = handheld(name),
      n = (DATA[name] as { rotation_euler0: number[] }).rotation_euler0.length;
    expect(h(0.37).rot[1]).toBeCloseTo(h(0.37 + n / 24).rot[1], 9);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += h(i / 24).rot[0];
    expect(Math.abs(sum / n)).toBeLessThan(1e-9);
    const [rx, ry, rz] = h(1.234).rot.map((d) => (d * Math.PI) / 180);
    const q = new Quaternion().setFromEuler(new Euler(rx, ry, rz, "ZYX"));
    const mine = h(1.234).quat;
    expect(Math.abs(mine[0] * q.x + mine[1] * q.y + mine[2] * q.z + mine[3] * q.w)).toBeCloseTo(
      1,
      12,
    );
  }
  const raw = (DATA.THE_CLOSEUP as { rotation_euler2: number[] }).rotation_euler2,
    m = raw.reduce((a, b) => a + b, 0) / raw.length;
  expect(handheld("THE_CLOSEUP")(5 / 24).rot[2]).toBeCloseTo(((raw[5] - m) * 180) / Math.PI, 9);
  expect(handheld("THE_ZEEK_2D")(3).pos).toEqual([0, 0, 0]);
  expect(handheld("HANDYCAM_RUN", { amount: 0 })(3).rot.every((x) => x === 0)).toBe(true);
});

test("lens: shotSize and frameSubject place targets cleanly on screen fill, thirds, and headroom", () => {
  expect(SHOT_SIZES.CU).toBeGreaterThan(SHOT_SIZES.MS);
  expect(SHOT_SIZES.MS).toBeGreaterThan(SHOT_SIZES.WS);
  const dist50 = shotSize("CU", { height: 1.8, mm: 50, aspect: A });
  const dist24 = shotSize("CU", { height: 1.8, mm: 24, aspect: A });
  expect(dist50).toBeGreaterThan(dist24);

  const f = frameSubject([1, 1.5, 2], {
    size: 0.5,
    height: 1.8,
    mm: 50,
    aspect: A,
    yaw: 25,
    pitch: 10,
    headroom: 0.1,
    thirdX: -1 / 3,
  });
  expect(f.mm).toBe(50);
  expect(f.fov).toBeCloseTo(fovOf(50, A), 9);
  const k = threeCam({ p: f.p, l: f.l, fov: f.fov });
  const projected = new Vector3(1, 1.5, 2).project(k);
  expect(projected.x).toBeCloseTo(-1 / 3, 4);
  expect(projected.y).toBeCloseTo(-0.2, 4);
});

test("lens: dofParams maps thin-lens mm and fstop to shallower 85mm bokeh and a resolution-independent sharp depth", () => {
  expect(dofParams({ mm: 50, fstop: 0, focus: 3 })).toEqual({
    focusDistance: 3,
    focusRange: 0,
    bokehScale: 0,
  });
  const tele = dofParams({ mm: 85, fstop: 1.8, focus: 2.5 });
  const wide = dofParams({ mm: 24, fstop: 1.8, focus: 2.5 });
  const stopped = dofParams({ mm: 85, fstop: 11, focus: 2.5 });
  expect(tele.focusDistance).toBe(2.5);
  expect(sharpDepth(tele)).toBeLessThan(sharpDepth(wide));
  expect(tele.bokehScale).toBeGreaterThan(wide.bokehScale);
  expect(tele.bokehScale).toBeGreaterThan(stopped.bokehScale);
  const hd = dofParams({ mm: 50, fstop: 2, focus: 2.5, widthPx: 1280 });
  const qhd = dofParams({ mm: 50, fstop: 2, focus: 2.5, widthPx: 2560 });
  expect(qhd.bokehScale / hd.bokehScale).toBeCloseTo(2, 6);

  // 9:16 Shorts shrinks horizontal sensor width from 1920 to 1080: bokeh must scale with width (9/16), not height (16/9).
  const landscape = dofParams({ mm: 50, fstop: 2, focus: 2.5, widthPx: 1920, heightPx: 1080 });
  const shorts = dofParams({ mm: 50, fstop: 2, focus: 2.5, widthPx: 1080, heightPx: 1920 });
  expect(sharpDepth(shorts)).toBeCloseTo(sharpDepth(landscape), 6);
  expect(shorts.bokehScale / landscape.bokehScale).toBeCloseTo(1080 / 1920, 6);
});

// postprocessing's DepthOfFieldEffect shows its low-resolution blur buffer wholly where
// smoothstep(0, focusRange, |depth - focus|) * bokehScale reaches 1
const shown = (p: ReturnType<typeof dofParams>, offset: number) => {
  const x = Math.min(1, offset / p.focusRange);
  return Math.min(1, x * x * (3 - 2 * x) * p.bokehScale);
};
const sharpDepth = (p: ReturnType<typeof dofParams>) => {
  let lo = 0,
    hi = p.focusRange;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (shown(p, mid) < 1) lo = mid;
    else hi = mid;
  }
  return lo;
};

test("lens: dofParams keeps a close-up subject a hand deep sharp under a wide aperture", () => {
  // a 100 mm close-up of a jar 0.8 m off at f/2.2 on a 1080-wide Short: the jar's back, 10 cm behind the focused label,
  // stays mostly the full-resolution picture
  const jar = dofParams({ mm: 100, fstop: 2.2, focus: 0.8, widthPx: 1080, heightPx: 1920 });
  expect(shown(jar, 0.03)).toBeLessThan(0.1);
  expect(shown(jar, 0.1)).toBeLessThan(0.5);
  // while the chef 1.2 m behind it is the blurred buffer
  expect(shown(jar, 1.2)).toBe(1);
});

test("lens: dofParams blurs the far background as wide as a fast lens does", () => {
  // 100 mm at f/2.2 focused 0.8 m away on a 1080-wide Short: a real lens's blur of infinity is ~250 px across at 1080
  const jar = dofParams({ mm: 100, fstop: 2.2, focus: 0.8, widthPx: 1080, heightPx: 1920 });
  expect(jar.bokehScale).toBeGreaterThan(20);
});

test("lens: shotSize rejects an unknown size and a zero height", () => {
  expect(() => shotSize("MLS" as unknown as Parameters<typeof shotSize>[0])).toThrow(/shotSize/);
  expect(() => shotSize("MCU", { height: 0 })).toThrow(/shotSize/);
});
