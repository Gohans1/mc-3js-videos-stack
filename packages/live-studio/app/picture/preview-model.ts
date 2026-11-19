export const CROP_RATIOS = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
  "2.39:1": 2.39,
} as const;
export type CropRatio = keyof typeof CROP_RATIOS;
export const PREVIEW_LAYERS = ["off", "peaking", "zebras", "falseColor"] as const;
export const PREVIEW_DEBUG = ["off", "clay", "wireframe", "xray"] as const;

export const initialPreview = {
  zoom: 100,
  panX: 0,
  panY: 0,
  mirror: false,
  reduced: true,
  motionBlur: false,
  clean: false,
  horizon: false,
  layers: "off" as (typeof PREVIEW_LAYERS)[number],
  debug: "off" as (typeof PREVIEW_DEBUG)[number],
  zebra: 95,
  crops: [] as CropRatio[],
  passepartout: 0,
  primes: false,
  golden: false,
  ruler: false,
  rulerX: 50,
  rulerY: 50,
  onion: 0,
};
export type PreviewOptions = typeof initialPreview;

export const guideRect = (w: number, h: number, ratio: number) => {
  const width = Math.min(w, ratio * h);
  const height = Math.min(h, w / ratio);
  return { x: (w - width) / 2, y: (h - height) / 2, width, height };
};
