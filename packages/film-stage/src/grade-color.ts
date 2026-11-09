// CAT16 white balance and tonal ranges: Google Filament, Apache-2.0 (THIRD_PARTY_NOTICES.txt).
// This adapter grades display sRGB; exposure and chromatic adaptation run in linear Rec.709.
import { Color, MathUtils, Matrix3, Vector3 } from "three";
import { secondaryGrade, type SecondaryGrade } from "./grade-secondary";

export const ADJUSTMENTS = [
  { id: "temp", title: "Temp", group: "Color", min: -100, max: 100 },
  { id: "tint", title: "Tint", group: "Color", min: -100, max: 100 },
  { id: "saturation", title: "Saturation", group: "Color", min: -100, max: 100 },
  { id: "exposure", title: "Exposure", group: "Lightness", min: -100, max: 100 },
  { id: "contrast", title: "Contrast", group: "Lightness", min: -100, max: 100 },
  { id: "highlight", title: "Highlight", group: "Lightness", min: -100, max: 100 },
  { id: "shadow", title: "Shadow", group: "Lightness", min: -100, max: 100 },
  { id: "whites", title: "Whites", group: "Lightness", min: -100, max: 100 },
  { id: "blacks", title: "Blacks", group: "Lightness", min: -100, max: 100 },
  { id: "brilliance", title: "Brilliance", group: "Lightness", min: -100, max: 100 },
  { id: "sharpen", title: "Sharpen", group: "Effects", min: 0, max: 100 },
  { id: "clarity", title: "Clarity", group: "Effects", min: 0, max: 100 },
  { id: "particles", title: "Particles", group: "Effects", min: 0, max: 100 },
  { id: "fade", title: "Fade", group: "Effects", min: 0, max: 100 },
  { id: "vignette", title: "Vignette", group: "Effects", min: -100, max: 100 },
] as const;
export type BasicKey = typeof ADJUSTMENTS[number]["id"];
export type BasicGrade = Partial<Record<BasicKey, number>>;

const xyzFromRGB = new Matrix3().fromArray([.412456, .212673, .0193339, .357576, .715152, .119192, .180438, .072175, .950304]);
const lmsFromXYZ = new Matrix3().fromArray([.401288, -.250268, -.002079, .650173, 1.204414, .048952, -.051461, .045854, .953127]);
const lmsFromRGB = new Matrix3().multiplyMatrices(lmsFromXYZ, xyzFromRGB), rgbFromLMS = lmsFromRGB.clone().invert();
const clamp = (v: number) => MathUtils.clamp(v, 0, 1);
const luma = (c: Color) => c.r * .212673 + c.g * .715152 + c.b * .072175;

function whiteBalance(temp: number, tint: number) {
  if (!temp && !tint) return new Matrix3();
  const x = .31271 - temp * (temp < 0 ? .0214 : .066), y = 2.87 * x - 3 * x * x - .275 + tint * .066;
  const lms = new Vector3(x / y, 1, (1 - x - y) / y).applyMatrix3(lmsFromXYZ);
  const scale = new Matrix3().set(.975533 / lms.x, 0, 0, 0, 1.016483 / lms.y, 0, 0, 0, 1.084837 / lms.z);
  return rgbFromLMS.clone().multiply(scale).multiply(lmsFromRGB);
}

export function colorGrade(basic: BasicGrade, secondary: SecondaryGrade = {}) {
  const more = secondaryGrade(secondary);
  const v = (key: BasicKey) => MathUtils.clamp(basic[key] ?? 0, -100, 100) / 100;
  const balance = whiteBalance(v("temp"), v("tint")), exposure = 2 ** (v("exposure") * 4);
  const linear = !!(v("temp") || v("tint") || v("exposure"));
  const shadow = 2 ** v("shadow"), highlight = 2 ** v("highlight"), mid = 2 ** v("brilliance");
  const gain = 2 ** v("whites"), lift = v("blacks") * .2;
  const contrast = 2 ** (v("contrast") * 2), saturation = 1 + v("saturation"), fade = v("fade");
  return (c: Color) => {
    if (linear) c.convertSRGBToLinear().applyMatrix3(balance).multiplyScalar(exposure).convertLinearToSRGB();
    const y = luma(c), s = 1 - MathUtils.smoothstep(y, 0, .333), h = MathUtils.smoothstep(y, .55, 1), m = 1 - s - h;
    c.multiplyScalar(s * shadow + m * mid + h * highlight);
    // Lift/gain keep the opposite endpoint fixed; contrast pivots on display mid-grey.
    const tone = (x: number) => ((x * (gain - lift) + lift - .5) * contrast + .5) * (1 - .25 * fade) + .12 * fade;
    c.setRGB(tone(c.r), tone(c.g), tone(c.b));
    const grey = luma(c);
    c.setRGB(clamp(grey + (c.r - grey) * saturation), clamp(grey + (c.g - grey) * saturation), clamp(grey + (c.b - grey) * saturation));
    return more(c);
  };
}
