import { expect, test } from "bun:test";

import { hfovOf } from "film-kit/lens";
import * as THREE from "three";
import { Box3, PerspectiveCamera, Vector3 } from "three";

import {
  apertureOffset,
  applyCameraRig,
  cameraAt,
  fitBoxFrame,
  orientCamera,
  projectCamera,
  rigFov,
  resolveFocusDistance,
} from "../src/camera";

test("horizontal FOV stays fixed across frame shapes and orthogonal lookup is stable", () => {
  const wide = rigFov(45, undefined, 16 / 9, { mode: "horizontal", aspect: 16 / 9 });
  const tall = rigFov(45, undefined, 9 / 16, { mode: "horizontal", aspect: 16 / 9 });
  expect(hfovOf(tall, 9 / 16)).toBeCloseTo(hfovOf(wide, 16 / 9), 9);
  const camera = new PerspectiveCamera(45, 16 / 9);
  const look = new Vector3(0, 5, 0);
  orientCamera(camera, look, 0, { up: [0, 0, 1] });
  projectCamera(camera, 1920, 1080, { near: 0.08, far: 450 });
  expect(camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(
    1e-5,
  );
  expect(camera.far).toBe(450);
});

test("one-node holds position and retains aim direction at a converted pose", () => {
  const cam = { p: new Vector3(2, 2, 1), l: new Vector3(2, 3, 1), roll: 0 };
  applyCameraRig(cam, 1, [0, 2], { look: "one-node", position: [6, 3, 9] }, () => cam);
  expect(cam.p.toArray()).toEqual([6, 3, 9]);
  expect(cam.l.clone().sub(cam.p).toArray()).toEqual([0, 1, 0]);
});

test("a displaced aperture keeps the focal plane sharp", () => {
  const camera = new PerspectiveCamera(35, 16 / 9);
  const onPlane = new Vector3(0.5, 0.2, -4);
  const behind = new Vector3(0.5, 0.2, -8);
  projectCamera(camera, 1920, 1080);
  const base = onPlane.clone().project(camera);
  const far = behind.clone().project(camera);
  const pupil = apertureOffset(camera, { x: 0.7, y: -0.7 }, 50, 1.4, 4);
  projectCamera(camera, 1920, 1080, undefined, pupil);
  expect(onPlane.clone().project(camera).distanceTo(base)).toBeLessThan(1e-9);
  expect(behind.clone().project(camera).distanceTo(far)).toBeGreaterThan(0.001);
});

test("a Vertigo segment preserves subject scale between endpoints", () => {
  const keys = [
    { t: 0, p: [0, 1, 4], l: [0, 1, 0], fov: (2 * Math.atan(0.25) * 180) / Math.PI, wave: 0 },
    {
      t: 1,
      p: [0, 1, 2],
      l: [0, 1, 0],
      fov: (2 * Math.atan(0.5) * 180) / Math.PI,
      wave: 0,
      ease: "linear",
      motion: "linear",
      dollyZoomScale: 1,
    },
  ];
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const { p, l, fov } = cameraAt(t, keys).base;
    expect(p.distanceTo(l) * Math.tan((fov * Math.PI) / 360)).toBeCloseTo(1, 10);
  }
});

test("Fit Box contains a group in the active offset projection", () => {
  const box = new Box3(new Vector3(-0.8, -0.5, -0.4), new Vector3(0.8, 0.5, 0.4));
  const rig = {
    lensShift: [0.8, -0.3] as [number, number],
    frameOffset: [0, 0.2] as [number, number],
  };
  const view = new PerspectiveCamera(35, 16 / 9);
  const fit = fitBoxFrame(box, new Vector3(-0.4, -0.2, -1), {
    fov: view.fov,
    aspect: view.aspect,
    fill: 0.75,
    rig,
  });
  expect(fit).not.toBeNull();
  view.position.copy(fit!.p);
  orientCamera(view, fit!.l, 0, rig);
  projectCamera(view, 1920, 1080, rig);
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const out = new Vector3(x, y, z).project(view);
        expect(Math.abs(out.x)).toBeLessThanOrEqual(0.7500001);
        expect(Math.abs(out.y - 0.2)).toBeLessThanOrEqual(0.7500001);
      }
});

test("orthographic shots keep subject width when its depth changes and fit a shifted frame", () => {
  const view = Object.assign(new THREE.OrthographicCamera(), { fov: 42, aspect: 16 / 9 });
  const rig = {
    projection: "orthographic",
    orthographicDepth: 6,
    lensShift: [0.4, -0.1],
    frameOffset: [0.1, 0.15],
  } as const;
  const params = {
    ...rig,
    lensShift: [...rig.lensShift] as [number, number],
    frameOffset: [...rig.frameOffset] as [number, number],
  };
  const box = new THREE.Box3(new THREE.Vector3(-3, -1.5, -10), new THREE.Vector3(3, 1.5, -3));
  const forward = new THREE.Vector3(0, 0, -1);
  const result = fitBoxFrame(box, forward, { fov: 42, aspect: 16 / 9, fill: 0.7, rig: params })!;
  expect(result.fov).toBeGreaterThan(0);
  view.position.copy(result.p);
  view.fov = result.fov!;
  orientCamera(view, result.l, 0, params);
  projectCamera(view, 1920, 1080, params);
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) {
      const near = new THREE.Vector3(x, y, box.max.z).project(view);
      const far = new THREE.Vector3(x, y, box.min.z).project(view);
      expect(near.x).toBeCloseTo(far.x, 9);
      expect(near.y).toBeCloseTo(far.y, 9);
      expect(Math.abs(near.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(near.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(near.z)).toBeLessThan(1);
      expect(Math.abs(far.z)).toBeLessThan(1);
    }
});

test("authored relative Bézier handles change travel through a Smooth span", () => {
  const first = { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 };
  const second = { t: 2, p: [2, 0, 5], l: [2, 0, 0], motion: "smooth", ease: "linear" };
  expect(cameraAt(1, [first, second]).base.p.y).toBe(0);
  const arc = [
    { ...first, outHandle: [0, 3, 0] },
    { ...second, inHandle: [0, 3, 0] },
  ];
  const middle = cameraAt(1, arc).base.p;
  expect(middle.distanceTo(new THREE.Vector3(1, 2.25, 5))).toBeLessThan(1e-5);
  expect(cameraAt(2, arc).base.p.toArray()).toEqual([2, 0, 5]);
});

test("rail u constrains the path while hold and cuts retain their authored endpoints", () => {
  const rail: [number, number, number][] = [
    [0, 0, 5],
    [0, 0, 0],
    [5, 0, 0],
  ];
  const keys = [
    { t: 0, p: [10, 0, 7], l: [0, 0, 0], railU: 0, wave: 0 },
    { t: 2, p: [12, 0, 7], l: [2, 0, 0], railU: 1, motion: "linear", ease: "linear" },
    { t: 3, p: [14, 0, 7], l: [2, 0, 0], cut: true },
  ];
  expect(cameraAt(1, keys, { rail }).base.p.distanceTo(new THREE.Vector3())).toBeLessThan(1e-5);
  expect(cameraAt(2, keys, { rail }).base.p.distanceTo(new THREE.Vector3(5, 0, 0))).toBeLessThan(
    1e-6,
  );
  expect(cameraAt(3, keys).base.p.toArray()).toEqual([14, 0, 7]);
  const railEnd = cameraAt(2.5, keys, { rail, extrapolation: "linear" });
  expect(railEnd.base.p.distanceTo(new THREE.Vector3(5, 0, 0))).toBeLessThan(1e-6);
  expect(railEnd.sample.railU).toBe(1);
  const hold = [keys[0], { ...keys[1], motion: "hold" }, keys[2]];
  expect(cameraAt(1, hold, { rail }).base.p.toArray()).toEqual(rail[0]);
});

test("linear extrapolation extends the source span only until the next cut", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 2, p: [2, 0, 5], l: [2, 0, 0], motion: "linear", ease: "linear" },
    { t: 4, p: [10, 0, 5], l: [10, 0, 0], wave: 0, cut: true },
  ];
  expect(cameraAt(3, keys).base.p.x).toBe(2);
  expect(cameraAt(3, keys, { extrapolation: "linear" }).base.p.x).toBe(3);
  expect(cameraAt(3, keys, { extrapolation: "linear" }).base.l.x).toBe(3);
  expect(cameraAt(4, keys, { extrapolation: "linear" }).base.p.x).toBe(10);
});

test("independent optical tracks preserve pose, blend focus from auto, and leave Dolly Zoom in control", () => {
  const poses = [0, 4].map((t) => ({
    t, p: [t, 0, 10], l: [t, 0, 0], fov: 50, focus: 4,
    fstop: 2.8, motion: "linear", ease: "linear", wave: 0,
  }));
  const optics = {
    focalLength: { wide: { t: 0, value: 24 }, long: { t: 4, value: 50, ease: "linear" } },
    focus: { auto: { t: 0, value: null }, near: { t: 4, value: 4, ease: "linear" } },
  };
  const raw = cameraAt(2, poses);
  const withOptics = cameraAt(2, poses, { optics });
  expect(withOptics.p.toArray()).toEqual(raw.p.toArray());
  expect(withOptics.l.toArray()).toEqual(raw.l.toArray());
  expect(withOptics.fstop).toBeCloseTo(2.8, 6);
  expect(withOptics.mm).toBeCloseTo(37, 6);
  expect(resolveFocusDistance(withOptics.focus, withOptics.p, () => null).distance).toBeCloseTo(7, 6);
  expect(raw.fov).toBe(50);
  expect(raw.focus).toBe(4);

  const dollyPoses = [poses[0], { ...poses[1], dollyZoomScale: 2 }];
  expect(cameraAt(2, dollyPoses, { optics }).fov).toBe(cameraAt(2, dollyPoses).fov);
  expect(cameraAt(0, poses, { optics }).focus).toBeNull();
  expect(cameraAt(4, poses, { optics }).focus).toBe(4);
});
