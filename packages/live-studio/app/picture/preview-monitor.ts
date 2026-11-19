import { MeshBasicMaterial, MeshStandardMaterial, type Scene } from "three";

import { S } from "../core/state";
import { get } from "../core/store";

const materials = {
  clay: new MeshStandardMaterial({ color: 0xb9b6af, roughness: 0.9 }),
  wireframe: new MeshBasicMaterial({ color: 0xbce5ef, wireframe: true }),
  xray: new MeshBasicMaterial({
    color: 0x95d4e4,
    transparent: true,
    opacity: 0.24,
    depthTest: false,
    depthWrite: false,
  }),
};

export const renderWithMonitor = async (scene: Scene | undefined, draw: () => Promise<void>) => {
  const { clean, debug } = get().preview;
  if (!scene || clean || debug === "off") return draw();
  const material = scene.overrideMaterial;
  scene.overrideMaterial = materials[debug];
  try {
    await draw();
  } finally {
    scene.overrideMaterial = material;
  }
};

export const EXPOSURE = [
  { at: 0, rgb: [55, 30, 126] },
  { at: 5, rgb: [33, 64, 195] },
  { at: 20, rgb: [42, 150, 208] },
  { at: 40, rgb: [38, 182, 101] },
  { at: 50, rgb: [140, 141, 145] },
  { at: 70, rgb: [232, 154, 187] },
  { at: 85, rgb: [244, 204, 69] },
  { at: 95, rgb: [239, 76, 42] },
] as const;
const exposurePalette = Array.from(
  { length: 256 },
  (_, i) => EXPOSURE.findLast(({ at }) => i >= at * 2.55)?.rgb ?? EXPOSURE[0].rgb,
);
const zebraColor = [255, 247, 225, 220];
const peakColor = [86, 255, 172, 220];

let source: HTMLCanvasElement;
export const drawPreviewMonitor = (picture: HTMLCanvasElement | null) => {
  const { clean, layers, zebra } = get().preview;
  const output = S.el.inspection;
  if (!output || clean || layers === "off" || !picture?.width) return;
  source ??= document.createElement("canvas");
  const scale = Math.min(1, 640 / Math.max(picture.width, picture.height));
  const w = Math.max(1, Math.round(picture.width * scale));
  const h = Math.max(1, Math.round(picture.height * scale));
  if (source.width !== w || source.height !== h) {
    source.width = output.width = w;
    source.height = output.height = h;
  }
  const read = source.getContext("2d", { willReadFrequently: true })!;
  const paint = output.getContext("2d")!;
  read.drawImage(picture, 0, 0, w, h);
  const inPixels = read.getImageData(0, 0, w, h).data;
  const result = paint.createImageData(w, h);
  const luma = (i: number) =>
    0.2126 * inPixels[i] + 0.7152 * inPixels[i + 1] + 0.0722 * inPixels[i + 2];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const brightness = luma(i);
      if (layers === "falseColor") {
        result.data.set(exposurePalette[Math.round(brightness)], i);
        result.data[i + 3] = 255;
      } else if (layers === "zebras" && brightness >= zebra * 2.55 && (x + y) % 12 < 5) {
        result.data.set(zebraColor, i);
      } else if (layers === "peaking" && x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const gx = luma(i + 4) - luma(i - 4);
        const gy = luma(i + w * 4) - luma(i - w * 4);
        if (gx * gx + gy * gy > 65 * 65) result.data.set(peakColor, i);
      }
    }
  }
  paint.putImageData(result, 0, 0);
};
