import { Color, FramebufferTexture, HalfFloatType, PerspectiveCamera, Vector2, SRGBColorSpace, Uniform, WebGLRenderTarget, type Camera, type TextureDataType, type WebGLRenderer } from "three";
import { BlendFunction, Effect, EffectAttribute, EffectComposer, EffectMaterial, EffectPass, GaussianBlurPass, LookupTexture, LUT3DEffect, NoiseEffect, TextureEffect, VignetteEffect, VignetteTechnique } from "postprocessing";
import { ADJUSTMENTS, colorGrade, type BasicGrade } from "./grade-color";
import { readLUT } from "./lut";
import { hasSecondary, type SecondaryGrade } from "./grade-secondary";

export { ADJUSTMENTS };
export type Grade = SecondaryGrade & { enabled?: boolean; basic?: BasicGrade; lut?: { url: string; name: string; amount?: number; enabled?: boolean } };

// glfx.js unsharp mask (MIT): original + strength * (original - blurred).
// Small and broad Gaussian neighborhoods expose detail and local contrast separately.
class DetailEffect extends Effect {
  private blur = [new GaussianBlurPass({ kernelSize: 5 }), new GaussianBlurPass({ kernelSize: 35, resolutionScale: .5 })];
  private targets = [0, 1].map(() => new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType }));
  strength = [0, 0];

  constructor() {
    super("ShotDetail", `
      uniform sampler2D fine, broad;
      uniform float sharpen, clarity;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        c += sharpen * (inputColor.rgb - texture2D(fine, uv).rgb);
        c += clarity * (inputColor.rgb - texture2D(broad, uv).rgb);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`, { attributes: EffectAttribute.CONVOLUTION, blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([["fine", new Uniform(null)], ["broad", new Uniform(null)], ["sharpen", new Uniform(0)], ["clarity", new Uniform(0)]]) });
    this.uniforms.get("fine")!.value = this.targets[0].texture;
    this.uniforms.get("broad")!.value = this.targets[1].texture;
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: TextureDataType) {
    this.blur.forEach((pass) => pass.initialize(renderer, alpha, frameBufferType));
  }
  override setSize(width: number, height: number) {
    this.blur.forEach((pass) => pass.setSize(width, height));
    this.targets.forEach((target) => target.setSize(width, height));
  }
  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget) {
    this.uniforms.get("sharpen")!.value = this.strength[0];
    this.uniforms.get("clarity")!.value = this.strength[1];
    this.blur.forEach((pass, i) => { if (this.strength[i]) pass.render(renderer, inputBuffer, this.targets[i]); });
  }
  override dispose() {
    this.blur.forEach((pass) => pass.dispose());
    this.targets.forEach((target) => target.dispose());
    super.dispose();
  }
}

export function gradeLUT(basic: BasicGrade, size = 32, secondary: SecondaryGrade = {}) {
  const lut = LookupTexture.createNeutral(size), pixels = lut.image.data as Float32Array, c = new Color(), grade = colorGrade(basic, secondary);
  for (let i = 0; i < pixels.length; i += 4) { grade(c.setRGB(pixels[i], pixels[i + 1], pixels[i + 2])); pixels[i] = c.r; pixels[i + 1] = c.g; pixels[i + 2] = c.b; }
  lut.needsUpdate = true;
  return lut;
}

function makeGradeStage(composer: EffectComposer, camera: Camera, imported: Map<string, LookupTexture>) {
  const identity = gradeLUT({}), lut = new LUT3DEffect(identity, { tetrahedralInterpolation: true, inputColorSpace: SRGBColorSpace });
  const custom = new LUT3DEffect(identity, { blendFunction: BlendFunction.NORMAL, tetrahedralInterpolation: true, inputColorSpace: SRGBColorSpace });
  const detail = new DetailEffect(), vignette = new VignetteEffect({ technique: VignetteTechnique.ESKIL, offset: 1.2, darkness: 1 });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT });
  const detailPass = new EffectPass(camera, detail), colorPass = new EffectPass(camera, lut), finishPass = new EffectPass(camera, vignette, noise);
  const customPass = new EffectPass(camera, custom), passes = [detailPass, colorPass, customPass, finishPass];
  passes.forEach((pass) => { composer.addPass(pass); pass.enabled = false; });
  const cache = new Map<number, { key: string; texture: LookupTexture }>();
  const apply = (shot: number, settings: Grade | undefined, t: number, bypass = false) => {
    const basic = settings?.basic ?? {};
    const importedLut = settings?.lut, texture = importedLut && imported.get(importedLut.url);
    const useCustom = !!texture && importedLut?.enabled !== false && (importedLut?.amount ?? 100) > 0;
    const active = !bypass && settings?.enabled !== false && (useCustom || Object.values(basic).some((v) => v !== 0) || hasSecondary(settings ?? {}));
    detailPass.enabled = active && !!(basic.sharpen || basic.clarity);
    customPass.enabled = active && useCustom;
    colorPass.enabled = finishPass.enabled = active;
    if (!active) return;
    const key = JSON.stringify([basic, settings?.hsl, settings?.curves, settings?.wheels]);
    let entry = cache.get(shot);
    if (entry?.key !== key) { entry?.texture.dispose(); entry = { key, texture: gradeLUT(basic, 32, settings) }; cache.set(shot, entry); }
    lut.lut = entry.texture;
    if (texture) custom.lut = texture;
    custom.blendMode.opacity.value = (importedLut?.amount ?? 100) / 100;
    detail.strength = [(basic.sharpen ?? 0) / 50, (basic.clarity ?? 0) / 100];
    vignette.darkness = (basic.vignette ?? 0) >= 0 ? 1 : 0;
    vignette.blendMode.opacity.value = Math.abs(basic.vignette ?? 0) / 100;
    noise.blendMode.opacity.value = (basic.particles ?? 0) / 100 * .35;
    (finishPass.fullscreenMaterial as EffectMaterial).time = t;
  };
  apply.passes = passes;
  apply.dispose = () => { cache.forEach(({ texture }) => texture.dispose()); identity.dispose(); passes.forEach((pass) => pass.dispose()); };
  return apply;
}

export function makeAdjustments(composer: EffectComposer, camera: Camera) {
  const tail = composer.passes.at(-1)!;
  const imported = new Map<string, LookupTexture>(), loading = new Map<string, Promise<void>>();
  const stages: ReturnType<typeof makeGradeStage>[] = [];
  const prepare = async (settings: (Grade | undefined)[]) => {
    await Promise.all(settings.flatMap((g) => {
      const url = g?.lut?.url;
      if (!url || imported.has(url)) return [];
      if (!loading.has(url)) loading.set(url, fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(`LUT could not load: ${url} (${r.status})`);
        imported.set(url, readLUT(await r.text(), url.endsWith(".3dl") ? "3dl" : "cube"));
      }).finally(() => loading.delete(url)));
      return [loading.get(url)!];
    }));
  };
  const apply = (shot: number, settings: Grade | undefined, t: number, bypass = false, layers: { grade: Grade }[] = []) => {
    const grades = [settings, ...layers.map((it) => it.grade)];
    for (let i = 0; i < grades.length; i++) {
      stages[i] ??= makeGradeStage(composer, camera, imported);
      stages[i](i === 0 ? shot : 0, grades[i], t, bypass);
    }
    for (let i = grades.length; i < stages.length; i++) stages[i](0, undefined, t, true);
    const passes = [tail, ...stages.flatMap((stage) => stage.passes)];
    passes.forEach((pass) => { pass.renderToScreen = false; });
    passes.findLast((pass) => pass.enabled)!.renderToScreen = true;
  };
  apply.prepare = prepare;
  apply.dispose = () => { stages.forEach((stage) => stage.dispose()); imported.forEach((texture) => texture.dispose()); };
  return apply;
}

// Framebuffer copies require matching encodings; decode the display pixels in EffectPass instead of an sRGB texture.
class FramebufferEffect extends TextureEffect {
  constructor(texture: FramebufferTexture) {
    super({ texture, blendFunction: BlendFunction.SRC });
    this.outputColorSpace = SRGBColorSpace;
  }
}

// The shared layer sits above the finished picture, including transitions and titles.
// A GPU framebuffer copy preserves that order without reading pixels back to the CPU.
export function makeLayerAdjustments(renderer: WebGLRenderer) {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const texture = new FramebufferTexture(size.x, size.y);
  const camera = new PerspectiveCamera(), composer = new EffectComposer(renderer, { depthBuffer: false, frameBufferType: HalfFloatType });
  composer.addPass(new EffectPass(camera, new FramebufferEffect(texture)));
  const apply = makeAdjustments(composer, camera);
  const draw = (layers: { grade: Grade }[], t: number, bypass = false) => {
    if (bypass || !layers.some(({ grade: g }) => g.enabled !== false && (Object.values(g.basic ?? {}).some((v) => v !== 0) || hasSecondary(g) || g.lut && g.lut.enabled !== false && (g.lut.amount ?? 100) > 0))) return;
    renderer.getDrawingBufferSize(size);
    if (texture.image.width !== size.x || texture.image.height !== size.y) {
      texture.dispose(); texture.image.width = size.x; texture.image.height = size.y; texture.needsUpdate = true;
      composer.setSize(size.x, size.y, false);
    }
    renderer.setRenderTarget(null); renderer.copyFramebufferToTexture(texture);
    apply(-1, layers[0].grade, t, false, layers.slice(1)); composer.render(0);
  };
  draw.prepare = apply.prepare;
  draw.dispose = () => { apply.dispose(); composer.dispose(); texture.dispose(); };
  return draw;
}
