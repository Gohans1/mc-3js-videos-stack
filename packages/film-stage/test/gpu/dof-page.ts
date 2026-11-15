import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import * as THREE from "three";

import { makeDof } from "../../src/dof";
import { makeFade } from "../../src/fade";
import { makeAdjustments } from "../../src/grade";

const W = 640,
  H = 360;

const checkerTex = (cells = 16) => {
  const data = new Uint8Array(cells * cells * 4);
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const v = (x + y) % 2 ? 235 : 18;
      const i = (y * cells + x) * 4;
      data.set([v, v, v, 255], i);
    }
  const tex = new THREE.DataTexture(data, cells, cells);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
};

const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
const tex = checkerTex(36);
const nearMat = new THREE.MeshBasicMaterial({ map: tex });
const farMat = new THREE.MeshBasicMaterial({ map: tex });
const nearPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), nearMat);
nearPlane.position.set(-1.4, 0, 6); // 4m from camera
const farPlane = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 7.8), farMat);
farPlane.position.set(4.2, 0, -2); // 12m from camera
const hotSpot = new THREE.Mesh(
  new THREE.PlaneGeometry(0.6, 0.6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), toneMapped: false }),
);
hotSpot.position.set(0, -1.1, 5);
scene.add(nearPlane, farPlane, hotSpot);

const composer = new EffectComposer(renderer, {
  frameBufferType: THREE.HalfFloatType,
  multisampling: 4,
});
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera, new SMAAEffect()));
const dof = makeDof(composer, camera, { draft: false });
composer.addPass(
  new EffectPass(
    camera,
    new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.85, mipmapBlur: true }),
    new VignetteEffect({ offset: 0.3, darkness: 0.45 }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
  ),
);
const adjust = makeAdjustments(composer, camera);
const fade = makeFade(renderer);

Object.assign(window, {
  renderShot(opts: {
    fstop?: number;
    focusDistance?: number;
    mm?: number;
    fadeLevel?: number;
    particles?: number;
    t?: number;
  }) {
    dof.update({
      fstop: opts.fstop ?? 0,
      focusDistance: opts.focusDistance ?? 4,
      mm: opts.mm ?? 85,
      widthPx: W,
    });
    adjust(0, opts.particles ? { basic: { particles: opts.particles } } : {}, opts.t ?? 0);
    renderer.clear();
    composer.render(0);
    if ((opts.fadeLevel ?? 0) > 0) fade(opts.fadeLevel);
    const gl = renderer.getContext(),
      rgba = new Uint8Array(W * H * 4),
      rgb = new Uint8Array(W * H * 3);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const from = ((H - 1 - y) * W + x) * 4;
        rgb.set(rgba.subarray(from, from + 3), (y * W + x) * 3);
      }
    let s = "";
    for (let i = 0; i < rgb.length; i += 0x8000)
      s += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return { enabled: dof.pass.enabled, w: W, h: H, rgb: btoa(s) };
  },
});
