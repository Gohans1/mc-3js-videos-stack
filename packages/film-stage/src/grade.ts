import {
  BlendFunction,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectMaterial,
  EffectPass,
  GaussianBlurPass,
  LookupTexture,
  LUT3DEffect,
  NoiseEffect,
  TextureEffect,
  VignetteEffect,
  VignetteTechnique,
} from "postprocessing";
import {
  type Camera,
  Color,
  FramebufferTexture,
  HalfFloatType,
  PerspectiveCamera,
  SRGBColorSpace,
  type TextureDataType,
  Uniform,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

import { ADJUSTMENTS, type BasicGrade, colorGrade } from "./grade-color";
import { hasSecondary, type SecondaryGrade } from "./grade-secondary";
import { readLUT } from "./lut";

export { ADJUSTMENTS };
export type Grade = SecondaryGrade & {
  enabled?: boolean;
  basic?: BasicGrade;
  lut?: { url: string; name: string; amount?: number; enabled?: boolean };
};

// glfx.js unsharp mask (MIT): original + strength * (original - blurred), plus physical highlight halation on the broad pass.
// Slider values to shader strengths. Cinetic: final soften stays under 0.8 px, a radial fringe reaches about 6 px per channel at a
// 1080p corner, a fisheye screen look is k 0.18 on r normalised to the half-diagonal.
export function finishStrength(basic: BasicGrade) {
  return {
    sharpen: (basic.sharpen ?? 0) / 50,
    clarity: (basic.clarity ?? 0) / 100,
    halation: ((basic.halation ?? 0) / 100) * 0.55,
    soften: ((basic.soften ?? 0) / 100) * 0.75,
    fringe: ((basic.fringe ?? 0) / 100) * 0.006,
    fisheye: ((basic.fisheye ?? 0) / 100) * 0.18,
  };
}

// Barrel r(1 + k r^2) with r normalised to the half-diagonal, so the centre and corners stay put; the fringe scales red out and
// blue in around that
class LensEffect extends Effect {
  constructor() {
    super(
      "ShotLens",
      `
      uniform float fringe, fisheye;
      vec2 lensUv(vec2 uv, float scale) {
        vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
        float r2 = dot(d, d) / (0.25 * (aspect * aspect + 1.0));
        return d * ((1.0 + fisheye * r2) / (1.0 + fisheye) * scale) / vec2(aspect, 1.0) + 0.5;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 g = texture2D(inputBuffer, lensUv(uv, 1.0));
        float r = texture2D(inputBuffer, lensUv(uv, 1.0 / (1.0 + fringe))).r;
        float b = texture2D(inputBuffer, lensUv(uv, 1.0 + fringe)).b;
        outputColor = vec4(r, g.g, b, g.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, Uniform>([
          ["fringe", new Uniform(0)],
          ["fisheye", new Uniform(0)],
        ]),
      },
    );
  }
  set strength([fringe, fisheye]: [number, number]) {
    this.uniforms.get("fringe")!.value = fringe;
    this.uniforms.get("fisheye")!.value = fisheye;
  }
}

class DetailEffect extends Effect {
  // 7 is postprocessing's smallest Gaussian that blurs: its 5 keeps only the centre tap (GaussKernel trims edgeBias 2 a side)
  private blur = [
    new GaussianBlurPass({ kernelSize: 7 }),
    new GaussianBlurPass({ kernelSize: 35, resolutionScale: 0.5 }),
  ];
  private targets = [0, 1].map(
    () => new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType }),
  );
  strength = [0, 0, 0, 0];

  constructor() {
    super(
      "ShotDetail",
      `
      uniform sampler2D fine, broad;
      uniform float sharpen, clarity, halation, soften;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        if (sharpen != 0.0) c += sharpen * (inputColor.rgb - texture2D(fine, uv).rgb);
        if (clarity != 0.0 || halation > 0.0) {
          vec3 b = texture2D(broad, uv).rgb;
          c += clarity * (inputColor.rgb - b);
          if (halation > 0.0) {
            float lum = dot(b, vec3(0.2126, 0.7152, 0.0722));
            float glow = smoothstep(0.48, 0.96, lum) * halation * (1.0 - 0.35 * c.r);
            c += vec3(1.0, 0.36, 0.10) * glow;
          }
        }
        if (soften > 0.0) c = mix(c, texture2D(fine, uv).rgb, soften);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, Uniform>([
          ["fine", new Uniform(null)],
          ["broad", new Uniform(null)],
          ["sharpen", new Uniform(0)],
          ["clarity", new Uniform(0)],
          ["halation", new Uniform(0)],
          ["soften", new Uniform(0)],
        ]),
      },
    );
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
    this.uniforms.get("halation")!.value = this.strength[2];
    this.uniforms.get("soften")!.value = this.strength[3];
    if (this.strength[0] || this.strength[3])
      this.blur[0].render(renderer, inputBuffer, this.targets[0]);
    if (this.strength[1] || this.strength[2])
      this.blur[1].render(renderer, inputBuffer, this.targets[1]);
  }
  override dispose() {
    this.blur.forEach((pass) => pass.dispose());
    this.targets.forEach((target) => target.dispose());
    super.dispose();
  }
}

class DitherEffect extends Effect {
  constructor() {
    super(
      "TpdfDither",
      `
      uniform float ditherAmp;
      // The composer works in linear light and encodes sRGB on output: the noise is sized in output levels, so it is
      // added after encoding and decoded back (in linear, the encode's steep slope near black made it grain)
      vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        if (ditherAmp <= 0.0) { outputColor = inputColor; return; }
        vec2 fc = gl_FragCoord.xy;
        float u1 = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
        float u2 = fract(52.9829189 * fract(dot(fc + vec2(17.0, 29.0), vec2(0.00583715, 0.06711056))));
        vec3 s = toSrgb(clamp(inputColor.rgb, 0.0, 1.0));
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        float gate = smoothstep(0.0, 0.015, lum) * (1.0 - smoothstep(0.985, 1.0, lum));
        vec3 c = toLinear(clamp(s + (u1 + u2 - 1.0) * ditherAmp * gate, 0.0, 1.0));
        outputColor = vec4(c, inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, Uniform>([["ditherAmp", new Uniform(0)]]),
      },
    );
  }
  set amount(v: number) {
    this.uniforms.get("ditherAmp")!.value = Math.max(0, v) / 50 / 255;
  }
}

export function gradeLUT(basic: BasicGrade, size = 32, secondary: SecondaryGrade = {}) {
  const lut = LookupTexture.createNeutral(size),
    pixels = lut.image.data as Float32Array,
    c = new Color(),
    grade = colorGrade(basic, secondary);
  for (let i = 0; i < pixels.length; i += 4) {
    grade(c.setRGB(pixels[i], pixels[i + 1], pixels[i + 2]));
    pixels[i] = c.r;
    pixels[i + 1] = c.g;
    pixels[i + 2] = c.b;
  }
  lut.needsUpdate = true;
  return lut;
}

function makeGradeStage(
  composer: EffectComposer,
  camera: Camera,
  imported: Map<string, LookupTexture>,
) {
  const identity = gradeLUT({}),
    lut = new LUT3DEffect(identity, {
      tetrahedralInterpolation: true,
      inputColorSpace: SRGBColorSpace,
    });
  const custom = new LUT3DEffect(identity, {
    blendFunction: BlendFunction.NORMAL,
    tetrahedralInterpolation: true,
    inputColorSpace: SRGBColorSpace,
  });
  const detail = new DetailEffect(),
    vignette = new VignetteEffect({ technique: VignetteTechnique.ESKIL, offset: 1.2, darkness: 1 });
  const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT }),
    dither = new DitherEffect();
  const lens = new LensEffect();
  const detailPass = new EffectPass(camera, detail),
    colorPass = new EffectPass(camera, lut),
    lensPass = new EffectPass(camera, lens),
    finishPass = new EffectPass(camera, vignette, noise, dither);
  const customPass = new EffectPass(camera, custom),
    passes = [detailPass, colorPass, customPass, lensPass, finishPass];
  passes.forEach((pass) => {
    composer.addPass(pass);
    pass.enabled = false;
  });
  const cache = new Map<number, { key: string; texture: LookupTexture }>();
  const apply = (shot: number, settings: Grade | undefined, t: number, bypass = false) => {
    const basic = settings?.basic ?? {};
    const importedLut = settings?.lut,
      texture = importedLut && imported.get(importedLut.url);
    const useCustom =
      !!texture && importedLut?.enabled !== false && (importedLut?.amount ?? 100) > 0;
    const active =
      !bypass &&
      settings?.enabled !== false &&
      (useCustom || Object.values(basic).some((v) => v !== 0) || hasSecondary(settings ?? {}));
    detailPass.enabled =
      active && !!(basic.sharpen || basic.clarity || basic.halation || basic.soften);
    lensPass.enabled = active && !!(basic.fringe || basic.fisheye);
    customPass.enabled = active && useCustom;
    colorPass.enabled = finishPass.enabled = active;
    if (!active) return;
    const key = JSON.stringify([basic, settings?.hsl, settings?.curves, settings?.wheels]);
    let entry = cache.get(shot);
    if (entry?.key !== key) {
      entry?.texture.dispose();
      entry = { key, texture: gradeLUT(basic, 32, settings) };
      cache.set(shot, entry);
    }
    lut.lut = entry.texture;
    if (texture) custom.lut = texture;
    custom.blendMode.opacity.value = (importedLut?.amount ?? 100) / 100;
    const k = finishStrength(basic);
    detail.strength = [k.sharpen, k.clarity, k.halation, k.soften];
    lens.strength = [k.fringe, k.fisheye];
    vignette.darkness = (basic.vignette ?? 0) >= 0 ? 1 : 0;
    vignette.blendMode.opacity.value = Math.abs(basic.vignette ?? 0) / 100;
    noise.blendMode.opacity.value = ((basic.particles ?? 0) / 100) * 0.35;
    dither.amount = basic.dither ?? 0;
    (finishPass.fullscreenMaterial as EffectMaterial).time = t;
  };
  apply.passes = passes;
  apply.dispose = () => {
    cache.forEach(({ texture }) => texture.dispose());
    identity.dispose();
    passes.forEach((pass) => pass.dispose());
  };
  return apply;
}

export function makeAdjustments(composer: EffectComposer, camera: Camera) {
  const tail = composer.passes.at(-1)!;
  const imported = new Map<string, LookupTexture>(),
    loading = new Map<string, Promise<void>>();
  const stages: ReturnType<typeof makeGradeStage>[] = [];
  const prepare = async (settings: (Grade | undefined)[]) => {
    await Promise.all(
      settings.flatMap((g) => {
        const url = g?.lut?.url;
        if (!url || imported.has(url)) return [];
        if (!loading.has(url))
          loading.set(
            url,
            fetch(url)
              .then(async (r) => {
                if (!r.ok) throw new Error(`LUT could not load: ${url} (${r.status})`);
                imported.set(url, readLUT(await r.text(), url.endsWith(".3dl") ? "3dl" : "cube"));
              })
              .finally(() => loading.delete(url)),
          );
        return [loading.get(url)!];
      }),
    );
  };
  const apply = (
    shot: number,
    settings: Grade | undefined,
    t: number,
    bypass = false,
    layers: { grade: Grade }[] = [],
  ) => {
    const grades = [settings, ...layers.map((it) => it.grade)];
    for (let i = 0; i < grades.length; i++) {
      stages[i] ??= makeGradeStage(composer, camera, imported);
      stages[i](i === 0 ? shot : 0, grades[i], t, bypass);
    }
    for (let i = grades.length; i < stages.length; i++) stages[i](0, undefined, t, true);
    const passes = [tail, ...stages.flatMap((stage) => stage.passes)];
    passes.forEach((pass) => {
      pass.renderToScreen = false;
    });
    passes.findLast((pass) => pass.enabled)!.renderToScreen = true;
  };
  apply.prepare = prepare;
  apply.dispose = () => {
    stages.forEach((stage) => stage.dispose());
    imported.forEach((texture) => texture.dispose());
  };
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
  const camera = new PerspectiveCamera(),
    composer = new EffectComposer(renderer, { depthBuffer: false, frameBufferType: HalfFloatType });
  composer.addPass(new EffectPass(camera, new FramebufferEffect(texture)));
  const apply = makeAdjustments(composer, camera);
  const draw = (layers: { grade: Grade }[], t: number, bypass = false) => {
    if (
      bypass ||
      !layers.some(
        ({ grade: g }) =>
          g.enabled !== false &&
          (Object.values(g.basic ?? {}).some((v) => v !== 0) ||
            hasSecondary(g) ||
            (g.lut && g.lut.enabled !== false && (g.lut.amount ?? 100) > 0)),
      )
    )
      return;
    renderer.getDrawingBufferSize(size);
    if (texture.image.width !== size.x || texture.image.height !== size.y) {
      texture.dispose();
      texture.image.width = size.x;
      texture.image.height = size.y;
      texture.needsUpdate = true;
      composer.setSize(size.x, size.y, false);
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(texture);
    apply(-1, layers[0].grade, t, false, layers.slice(1));
    composer.render(0);
  };
  draw.prepare = apply.prepare;
  draw.dispose = () => {
    apply.dispose();
    composer.dispose();
    texture.dispose();
  };
  return draw;
}
