import { expect, test } from "bun:test";

import { hfovOf } from "film-kit/lens";
import { Box3, PerspectiveCamera, Vector3 } from "three";

import {
  apertureOffset,
  applyCameraRig,
  cameraAt,
  fitBoxFrame,
  orientCamera,
  projectCamera,
  rigFov,
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
