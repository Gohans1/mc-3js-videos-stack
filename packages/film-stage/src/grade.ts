import { Color, HalfFloatType, SRGBColorSpace, Uniform, WebGLRenderTarget, type Camera, type TextureDataType, type WebGLRenderer } from "three";
import { BlendFunction, Effect, EffectAttribute, EffectComposer, EffectMaterial, EffectPass, GaussianBlurPass, LookupTexture, LUT3DEffect, NoiseEffect, VignetteEffect, VignetteTechnique } from "postprocessing";
import { ADJUSTMENTS, colorGrade, type BasicGrade } from "./grade-color";
import { readLUT } from "./lut";

export { ADJUSTMENTS };
export type Grade = { enabled?: boolean; basic?: BasicGrade; lut?: { url: string; name: string; amount?: number; enabled?: boolean } };

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

export function gradeLUT(basic: BasicGrade, size = 32) {
  const lut = LookupTexture.createNeutral(size), pixels = lut.image.data as Float32Array, c = new Color(), grade = colorGrade(basic);
  for (let i = 0; i < pixels.length; i += 4) { grade(c.setRGB(pixels[i], pixels[i + 1], pixels[i + 2])); pixels[i] = c.r; pixels[i + 1] = c.g; pixels[i + 2] = c.b; }
  lut.needsUpdate = true;
  return lut;
}

export function makeAdjustments(composer: EffectComposer, camera: Camera) {
  const originalTail = composer.passes.at(-1)!;
  const identity = gradeLUT({}), lut = new LUT3DEffect(identity, { tetrahedralInterpolation: true, inputColorSpace: SRGBColorSpace });
  const custom = new LUT3DEffect(identity, { blendFunction: BlendFunction.NORMAL, tetrahedralInterpolation: true, inputColorSpace: SRGBColorSpace });
  const detail = new DetailEffect(), vignette = new VignetteEffect({ technique: VignetteTechnique.ESKIL, offset: 1.2, darkness: 1 });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT });
  const detailPass = new EffectPass(camera, detail), colorPass = new EffectPass(camera, lut), finishPass = new EffectPass(camera, vignette, noise);
  const customPass = new EffectPass(camera, custom), passes = [detailPass, colorPass, customPass, finishPass];
  passes.forEach((pass) => { composer.addPass(pass); pass.enabled = false; });
  originalTail.renderToScreen = true;
  const cache = new Map<number, { key: string; texture: LookupTexture }>();
  const imported = new Map<string, LookupTexture>(), loading = new Map<string, Promise<void>>();
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
  const apply = (shot: number, settings: Grade | undefined, t: number, bypass = false) => {
    const basic = settings?.basic ?? {};
    const importedLut = settings?.lut, texture = importedLut && imported.get(importedLut.url);
    const useCustom = !!texture && importedLut?.enabled !== false && (importedLut?.amount ?? 100) > 0;
    const active = !bypass && settings?.enabled !== false && (useCustom || Object.values(basic).some((v) => v !== 0));
    originalTail.renderToScreen = !active;
    detailPass.enabled = active && !!(basic.sharpen || basic.clarity);
    customPass.enabled = active && useCustom;
    colorPass.enabled = finishPass.enabled = active;
    if (!active) return;
    const key = JSON.stringify(basic);
    let entry = cache.get(shot);
    if (entry?.key !== key) { entry?.texture.dispose(); entry = { key, texture: gradeLUT(basic) }; cache.set(shot, entry); }
    lut.lut = entry.texture;
    if (texture) custom.lut = texture;
    custom.blendMode.opacity.value = (importedLut?.amount ?? 100) / 100;
    detail.strength = [(basic.sharpen ?? 0) / 50, (basic.clarity ?? 0) / 100];
    vignette.darkness = (basic.vignette ?? 0) >= 0 ? 1 : 0;
    vignette.blendMode.opacity.value = Math.abs(basic.vignette ?? 0) / 100;
    noise.blendMode.opacity.value = (basic.particles ?? 0) / 100 * .35;
    (finishPass.fullscreenMaterial as EffectMaterial).time = t;
  };
  apply.prepare = prepare;
  apply.dispose = () => { cache.forEach(({ texture }) => texture.dispose()); imported.forEach((texture) => texture.dispose()); identity.dispose(); passes.forEach((pass) => pass.dispose()); };
  return apply;
}
