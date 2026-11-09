import { Color, HalfFloatType, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { CopyPass, EffectComposer, RenderPass } from "postprocessing";
import { makeAdjustments, type Grade } from "film-stage/grade";
import { colorGrade, type BasicGrade } from "film-stage/grade-color";
import { canvas, config, done, log, still } from "live-studio/lab";
import { applyEdit, buildScene, SHOTS_OUT } from "../src/scene";
import { EDIT } from "../src/edit";

const { W, H } = await config(), c = canvas();
const renderer = new WebGLRenderer({ canvas: c, preserveDrawingBuffer: true });
renderer.setSize(128, 128, false);
const scene = new Scene(), camera = new PerspectiveCamera(), input = new Color(.18, .09, .04);
scene.background = input;
const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new CopyPass());
const adjust = makeAdjustments(composer, camera), gl = renderer.getContext();
const pixel = (x = 64, y = 64) => { const p = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p].slice(0, 3); };
const draw = (basic: BasicGrade) => { adjust(0, { basic }, 5); composer.render(0); return pixel(); };
const baseline = draw({});
for (const grade of [
  { hsl: { orange: { hue: 60, saturation: -80, brightness: 20 } } },
  { curves: { luma: [[0, 0], [.4, .65], [1, 1]], red: [[0, 0], [1, .7]] } },
  { curves: { enabled: false, luma: [[0, 1], [1, 0]] } },
  { wheels: { shadows: { rgb: [.04, 0, -.03] }, midtones: { rgb: [.2, .1, 0] } } },
  { wheels: { mode: "log", amount: 50, shadows: { rgb: [.2, 0, -.2] }, offset: { saturation: 50 } } },
] satisfies Grade[]) {
  adjust(0, grade, 5); composer.render(0);
  const got = pixel(), expected = colorGrade({}, grade)(input.clone().convertLinearToSRGB()).toArray().map((x) => Math.round(x * 255));
  if (got.some((v, i) => Math.abs(v - expected[i]) > 3)) throw new Error(`Secondary GPU mismatch ${JSON.stringify(grade)}: ${got} vs ${expected}`);
  await log(`GPU secondary ${JSON.stringify(grade)}: ${got}, expected ${expected}`);
}
for (const basic of [{ exposure: 25 }, { temp: 35 }, { tint: -30 }, { saturation: -100 }, { shadow: 50 }, { contrast: 30 }, { fade: 70 }]) {
  const got = draw(basic), expected = colorGrade(basic)(input.clone().convertLinearToSRGB()).toArray().map((x) => Math.round(x * 255));
  if (got.some((v, i) => Math.abs(v - expected[i]) > 3)) throw new Error(`GPU color mismatch ${JSON.stringify(basic)}: ${got} vs ${expected}`);
  await log(`GPU ${JSON.stringify(basic)}: ${got}, expected ${expected}`);
}
draw({ vignette: 100 }); const darkCorner = pixel(2, 2);
draw({ vignette: -100 }); const lightCorner = pixel(2, 2);
if (!(darkCorner[0] < baseline[0] && lightCorner[0] > baseline[0])) throw new Error(`Vignette direction: ${darkCorner}/${baseline}/${lightCorner}`);
draw({ sharpen: 60, clarity: 60 });
if (pixel().some((v, i) => Math.abs(v - baseline[i]) > 2)) throw new Error("Detail must preserve a flat field");
draw({ particles: 70 }); const grainA = pixel(35, 47);
draw({ particles: 70 }); const grainB = pixel(35, 47);
if (String(grainA) !== String(grainB)) throw new Error("Grain changes when seeking to the same second");
if (String(draw({})) !== String(baseline)) throw new Error("Disabling Adjust does not restore the original pipeline");
for (const swap of [false, true]) {
  const source = 'LUT_3D_SIZE 2\n' + Array.from({ length: 8 }, (_, i) => swap ? `${(i >> 2) & 1} ${(i >> 1) & 1} ${i & 1}` : `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n');
  const url = URL.createObjectURL(new Blob([source]));
  await adjust.prepare([{ lut: { url, name: "GPU verification" } }]);
  for (const amount of [0, 50, 100]) {
    adjust(0, { lut: { url, name: "GPU verification", amount } }, 5); composer.render(0);
    const target = swap ? new Color(input.b, input.g, input.r) : input.clone();
    const expected = input.clone().convertLinearToSRGB().lerp(target.convertLinearToSRGB(), amount / 100).toArray().map((x) => Math.round(x * 255)), got = pixel();
    if (got.some((v, i) => Math.abs(v - expected[i]) > 3)) throw new Error(`LUT mismatch swap=${swap} amount=${amount}: ${got} vs ${expected}`);
    await log(`GPU LUT swap=${swap} amount=${amount}: ${got}, expected ${expected}`);
  }
  URL.revokeObjectURL(url);
}
adjust.dispose(); composer.dispose(); renderer.dispose();

const film = await buildScene(c, W, H, true), originals = structuredClone(EDIT.shots);
for (const [name, basic] of Object.entries({ neutral: {}, warm: { temp: 45, exposure: 12 }, cool: { temp: -45 }, monochrome: { saturation: -100 }, detail: { sharpen: 50, clarity: 35 }, fade: { fade: 70 }, vignette: { vignette: 80 }, lightVignette: { vignette: -80 }, particles: { particles: 80 } })) {
  EDIT.shots = structuredClone(originals); EDIT.shots[3].adjust = { basic }; applyEdit();
  film(30.2); await still(`adjust-${name}.jpg`, c);
}
EDIT.shots = originals; applyEdit();
for (const [name, grade] of Object.entries({
  hsl: { hsl: { cyan: { saturation: -100 }, blue: { hue: -80, brightness: 50 } } },
  curves: { curves: { luma: [[0, 0], [.25, .1], [.75, .9], [1, 1]] } },
  wheels: { wheels: { shadows: { rgb: [-.02, 0, .04] }, highlights: { rgb: [.15, .05, -.05] } } },
} satisfies Record<string, Grade>)) {
  EDIT.shots = structuredClone(originals); EDIT.shots[3].adjust = grade; applyEdit();
  film(30.2); await still(`adjust-${name}.jpg`, c);
}
EDIT.shots = originals; applyEdit();
await log(`Adjust GPU checks and ${SHOTS_OUT.length}-shot film frames passed`);
await done();
