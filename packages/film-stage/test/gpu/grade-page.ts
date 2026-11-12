// The grade as a film runs it (makeAdjustments on a postprocessing composer) over a known picture; test/grade-gpu.test.ts
// calls window.grade(picture, basic, film) and reads the frame back as base64 RGB, top row first. film: the composer ends on an
// EffectPass, as every film's does (scene.ts: look, feed), instead of on the RenderPass.
import { EffectComposer, EffectPass, RenderPass } from "postprocessing";
import * as THREE from "three";

import { makeAdjustments } from "../../src/grade";

const W = 960,
  H = 540;
type Pixel = [number, number, number];
const square = (x: number, y: number, cx: number, cy: number, r: number) =>
  Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;
const PICTURES: Record<string, (x: number, y: number) => Pixel> = {
  dark: () => [13, 13, 13],
  flat: () => [128, 128, 128],
  line: (x) => (Math.abs(x - 624) <= 1 ? [255, 255, 255] : [0, 0, 0]),
  dots: (x, y) =>
    square(x, y, 480, 270, 12) || square(x, y, 900, 40, 12) ? [255, 255, 255] : [0, 0, 0],
  glow: (x, y) => (square(x, y, 480, 270, 60) ? [220, 220, 220] : [13, 13, 13]),
  checker: (x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? [230, 230, 230] : [25, 25, 25]),
};

const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
const material = new THREE.MeshBasicMaterial();
const scene = new THREE.Scene().add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const adjust = makeAdjustments(composer, camera);

const films = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
films.addPass(new RenderPass(scene, camera));
films.addPass(new EffectPass(camera));
const filmAdjust = makeAdjustments(films, camera);

// sRGB levels 100 to 104 left to right, finer than 8 bits hold: a lit floor or a sky ramp before the picture leaves the GPU
const ramp = () => {
  const data = new Float32Array(W * H * 4),
    c = new THREE.Color();
  for (let x = 0; x < W; x++) {
    const v = c
      .setRGB(1, 1, 1)
      .multiplyScalar((100 + (4 * x) / W) / 255)
      .convertSRGBToLinear().r;
    for (let y = 0; y < H; y++) data.set([v, v, v, 1], (y * W + x) * 4);
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

const texture = (name: string) => {
  if (name === "ramp") return ramp();
  const paint = PICTURES[name]!,
    data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((H - 1 - y) * W + x) * 4;
      data.set([...paint(x, y), 255], i);
    }
  const t = new THREE.DataTexture(data, W, H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

Object.assign(window, {
  grade(picture: string, basic: Record<string, number>, film = false) {
    material.map?.dispose();
    material.map = texture(picture);
    material.needsUpdate = true;
    (film ? filmAdjust : adjust)(0, { basic }, 0);
    (film ? films : composer).render(0);
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
    return { w: W, h: H, rgb: btoa(s) };
  },
});
