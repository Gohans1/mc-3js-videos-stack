import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { computeCropView, parseCropRect, withCropViewOffset } from "../src/crop.mjs";

test("parseCropRect validates normalized 0..1 rectangles and rejects invalid bounds", () => {
  assert.deepEqual(parseCropRect("0.25, 0.25, 0.5, 0.5"), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.throws(() => parseCropRect("0.25,0.25,0.5"), /4 numbers/);
  assert.throws(() => parseCropRect("-0.1,0,0.5,0.5"), /x/);
  assert.throws(() => parseCropRect("0.8,0,0.5,0.5"), /within 0\.\.1/);
  assert.throws(() => parseCropRect("0,0,0,0.5"), /w/);
});

test("computeCropView keeps 1:1 pixel aspect for square and non-square normalized crops", () => {
  const sameAspect = computeCropView(1280, 720, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.equal(sameAspect.outWidth, 1280);
  assert.equal(sameAspect.outHeight, 720);
  assert.equal(sameAspect.offsetX, 320);
  assert.equal(sameAspect.offsetY, 180);
  assert.equal(sameAspect.viewWidth, 640);
  assert.equal(sameAspect.viewHeight, 360);

  const tallCrop = computeCropView(1280, 720, { x: 0.3, y: 0.2, w: 0.2, h: 0.4 });
  assert.equal(tallCrop.outWidth, 640);
  assert.equal(tallCrop.outHeight, 720);
  assert.equal(tallCrop.offsetX, 384);
  assert.equal(tallCrop.offsetY, 144);
  assert.equal(tallCrop.viewWidth, 512);
  assert.equal(tallCrop.viewHeight, 288);
});

test("withCropViewOffset projects the target sub-frustum to full NDC and restores projection matrix cleanly", () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();

  const beforeProj = cam.projectionMatrix.elements.slice();

  // Compute world point at normalized screen coordinate (nx=0.5, ny=0.5) -> NDC (0, 0)
  // And point at center of crop [0.25, 0.25, 0.5, 0.5] -> normalized full screen (0.5, 0.5)
  // And point at top-left of crop [0.25, 0.25, 0.5, 0.5] -> normalized full screen (0.25, 0.25)
  const unprojectScreen = (nx, ny) => new THREE.Vector3(2 * nx - 1, 1 - 2 * ny, 0.5).unproject(cam);
  const topLeftCorner = unprojectScreen(0.25, 0.25);
  const cropCenter = unprojectScreen(0.5, 0.5);

  withCropViewOffset(cam, 1280, 720, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, () => {
    assert.equal(cam.view?.enabled, true);
    const tl = topLeftCorner.clone().project(cam);
    const cc = cropCenter.clone().project(cam);
    assert.ok(Math.abs(tl.x - -1) < 1e-5, `expected cropped top-left ndc.x=-1, got ${tl.x}`);
    assert.ok(Math.abs(tl.y - 1) < 1e-5, `expected cropped top-left ndc.y=+1, got ${tl.y}`);
    assert.ok(Math.abs(cc.x) < 1e-5, `expected cropped center ndc.x=0, got ${cc.x}`);
    assert.ok(Math.abs(cc.y) < 1e-5, `expected cropped center ndc.y=0, got ${cc.y}`);
  });

  assert.equal(cam.view?.enabled ?? false, false);
  cam.projectionMatrix.elements.forEach((v, i) => {
    assert.ok(Math.abs(v - beforeProj[i]) < 1e-10, `projectionMatrix[${i}] not restored`);
  });
});
