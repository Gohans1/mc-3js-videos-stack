import { EffectComposer, EffectPass, LUT3DEffect, RenderPass } from "postprocessing";
import * as THREE from "three";

import { makeAdjustments, makeLayerAdjustments } from "../../src/grade";

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
const layerAdjust = makeLayerAdjustments(renderer);

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
  finishLutTrial(repeats = 2) {
    const colorLut = () =>
      films.passes
        .flatMap((pass) => (pass instanceof EffectPass ? pass.effects : []))
        .find((effect) => effect instanceof LUT3DEffect)!.lut;
    const start = performance.now();
    filmAdjust(0, { basic: { contrast: 25 } }, 0);
    const textures = new Set([colorLut()]);
    for (const key of [
      "sharpen",
      "clarity",
      "soften",
      "halation",
      "fringe",
      "fisheye",
      "vignette",
      "particles",
      "dither",
    ])
      for (let i = 0; i < repeats; i++) {
        filmAdjust(0, { basic: { contrast: 25, [key]: 20 + (i % 60) } }, 0);
        textures.add(colorLut());
      }
    const ms = performance.now() - start;
    const invalidates = [];
    for (const settings of [
      { basic: { contrast: 26 } },
      { basic: { contrast: 25, fade: 20 } },
      { basic: { contrast: 25 }, hsl: { red: { saturation: 30 } } },
      {
        basic: { contrast: 25 },
        curves: {
          red: [
            [0, 0],
            [0.5, 0.6],
            [1, 1],
          ],
        },
      },
      { basic: { contrast: 25 }, wheels: { offset: { rgb: [0.1, 0, 0] } } },
    ] as Parameters<typeof filmAdjust>[1][]) {
      filmAdjust(0, { basic: { contrast: 25 } }, 0);
      const previous = colorLut();
      filmAdjust(0, settings, 0);
      invalidates.push(previous !== colorLut());
    }
    return { ms, finishLuts: textures.size, invalidates };
  },
  grade(
    picture: string,
    basic: Record<string, number>,
    film = false,
    opts?: { t?: number; look?: string; layer?: boolean },
  ) {
    material.map?.dispose();
    material.map = texture(picture);
    material.needsUpdate = true;
    const t = opts?.t ?? 0;
    const g = { ...(opts?.look ? { look: opts.look } : {}), basic };
    if (opts?.layer) {
      filmAdjust(0, {}, t);
      films.render(0);
      layerAdjust([{ grade: g }], t);
    } else {
      (film ? filmAdjust : adjust)(0, g, t);
      (film ? films : composer).render(0);
    }
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
