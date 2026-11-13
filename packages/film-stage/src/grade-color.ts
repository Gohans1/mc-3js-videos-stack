// CAT16 white balance and tonal ranges: Google Filament, Apache-2.0 (THIRD_PARTY_NOTICES.txt).
// This adapter grades display sRGB; exposure and chromatic adaptation run in linear Rec.709.
import { Color, MathUtils, Matrix3, Vector3 } from "three";

import { type SecondaryGrade, secondaryGrade } from "./grade-secondary";

export const ADJUSTMENTS = [
  {
    id: "temp",
    title: "Temp",
    tip: "White balance: + warm (orange, sunset), - cool (blue, night)",
    group: "Color",
    min: -100,
    max: 100,
  },
  {
    id: "tint",
    title: "Tint",
    tip: "Green to magenta colour cast",
    group: "Color",
    min: -100,
    max: 100,
  },
  {
    id: "saturation",
    title: "Saturation",
    tip: "How strong the colours are, from black and white to vivid",
    group: "Color",
    min: -100,
    max: 100,
  },
  {
    id: "exposure",
    title: "Exposure",
    tip: "Overall brightness, like opening or closing the lens",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "contrast",
    title: "Contrast",
    tip: "Difference between darks and lights: flat or punchy",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "highlight",
    title: "Highlight",
    tip: "Brightness of the bright areas only",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "shadow",
    title: "Shadow",
    tip: "Brightness of the dark areas only",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "whites",
    title: "Whites",
    tip: "Where the brightest whites sit: clip or pull them back",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "blacks",
    title: "Blacks",
    tip: "Where the deepest blacks sit: crush or lift them",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "brilliance",
    title: "Brilliance",
    tip: "Brightness of the midtones only, between the shadows and the highlights",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "sharpen",
    title: "Sharpen",
    tip: "Crisper fine edges",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "clarity",
    title: "Clarity",
    tip: "Local contrast on broad detail: a grittier, more textured, punchier look",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "soften",
    title: "Soften",
    tip: "A slight blur that takes the hard digital edge off the picture",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "fringe",
    title: "Lens fringe",
    tip: "Red and blue colour fringes toward the edges, like a cheap lens",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "fisheye",
    title: "Fisheye",
    tip: "Barrel distortion that bulges the picture like a fisheye or GoPro lens",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "halation",
    title: "Halation",
    tip: "A warm red-orange glow bleeding around bright lights, like film stock",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "dither",
    title: "Smooth dither",
    tip: "Fine noise that hides banding in smooth gradients like skies",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "particles",
    title: "Particles",
    tip: "Film grain: fine moving noise laid over the picture",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "fade",
    title: "Fade",
    tip: "Lifts the blacks into a washed-out, faded matte look, like an old print",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "vignette",
    title: "Vignette",
    tip: "Darkens (or lightens) the corners to pull the eye to the centre",
    group: "Effects",
    min: -100,
    max: 100,
  },
] as const;
export type BasicKey = (typeof ADJUSTMENTS)[number]["id"];
export type BasicGrade = Partial<Record<BasicKey, number>>;

const xyzFromRGB = new Matrix3().fromArray([
  0.412456, 0.212673, 0.0193339, 0.357576, 0.715152, 0.119192, 0.180438, 0.072175, 0.950304,
]);
const lmsFromXYZ = new Matrix3().fromArray([
  0.401288, -0.250268, -0.002079, 0.650173, 1.204414, 0.048952, -0.051461, 0.045854, 0.953127,
]);
const lmsFromRGB = new Matrix3().multiplyMatrices(lmsFromXYZ, xyzFromRGB),
  rgbFromLMS = lmsFromRGB.clone().invert();
const clamp = (v: number) => MathUtils.clamp(v, 0, 1);
const luma = (c: Color) => c.r * 0.212673 + c.g * 0.715152 + c.b * 0.072175;

function whiteBalance(temp: number, tint: number) {
  if (!temp && !tint) return new Matrix3();
  const x = 0.31271 - temp * (temp < 0 ? 0.0214 : 0.066),
    y = 2.87 * x - 3 * x * x - 0.275 + tint * 0.066;
  const lms = new Vector3(x / y, 1, (1 - x - y) / y).applyMatrix3(lmsFromXYZ);
  const scale = new Matrix3().set(
    0.975533 / lms.x,
    0,
    0,
    0,
    1.016483 / lms.y,
    0,
    0,
    0,
    1.084837 / lms.z,
  );
  return rgbFromLMS.clone().multiply(scale).multiply(lmsFromRGB);
}

export function colorGrade(basic: BasicGrade, secondary: SecondaryGrade = {}) {
  const more = secondaryGrade(secondary);
  const v = (key: BasicKey) => MathUtils.clamp(basic[key] ?? 0, -100, 100) / 100;
  const balance = whiteBalance(v("temp"), v("tint")),
    exposure = 2 ** (v("exposure") * 4);
  const linear = !!(v("temp") || v("tint") || v("exposure"));
  const shadow = 2 ** v("shadow"),
    highlight = 2 ** v("highlight"),
    mid = 2 ** v("brilliance");
  const gain = 2 ** v("whites"),
    lift = v("blacks") * 0.2;
  const contrast = 2 ** (v("contrast") * 2),
    saturation = 1 + v("saturation"),
    fade = v("fade");
  return (c: Color) => {
    if (linear)
      c.convertSRGBToLinear().applyMatrix3(balance).multiplyScalar(exposure).convertLinearToSRGB();
    const y = luma(c),
      s = 1 - MathUtils.smoothstep(y, 0, 0.333),
      h = MathUtils.smoothstep(y, 0.55, 1),
      m = 1 - s - h;
    c.multiplyScalar(s * shadow + m * mid + h * highlight);
    // Lift/gain keep the opposite endpoint fixed; contrast pivots on display mid-grey.
    const tone = (x: number) =>
      ((x * (gain - lift) + lift - 0.5) * contrast + 0.5) * (1 - 0.25 * fade) + 0.12 * fade;
    c.setRGB(tone(c.r), tone(c.g), tone(c.b));
    const grey = luma(c);
    c.setRGB(
      clamp(grey + (c.r - grey) * saturation),
      clamp(grey + (c.g - grey) * saturation),
      clamp(grey + (c.b - grey) * saturation),
    );
    return more(c);
  };
}
