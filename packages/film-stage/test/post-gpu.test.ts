import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { openPage } from "./gpu";

let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/post-page.ts"));
}, 60_000);
afterAll(() => page?.close());

function decodeRgb(b64: string, w: number) {
  const px = Buffer.from(b64, "base64");
  const at = (x: number, y: number) => [...px.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
  const meanRgb = (x0: number, y0: number, x1: number, y1: number) => {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [r, g, b] = at(x, y);
        sr += r!;
        sg += g!;
        sb += b!;
        n++;
      }
    }
    return [sr / n, sg / n, sb / n] as const;
  };
  const meanLuma = (x0: number, y0: number, x1: number, y1: number) => {
    const [r, g, b] = meanRgb(x0, y0, x1, y1);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return { px, at, meanRgb, meanLuma };
}

test("createFilmRenderer enforces PCFShadowMap, NoToneMapping, localClipping, and zero WebGL errors", async () => {
  const r = await page.run<{
    shadowEnabled: boolean;
    isPcfShadow: boolean;
    isNotPcfSoft: boolean;
    localClipping: boolean;
    isNoToneMapping: boolean;
    w: number;
    h: number;
    glErrors: number[];
  }>("verifyRendererDefaults()");

  expect(r.shadowEnabled).toBe(true);
  expect(r.isPcfShadow).toBe(true);
  expect(r.isNotPcfSoft).toBe(true);
  expect(r.localClipping).toBe(true);
  expect(r.isNoToneMapping).toBe(true);
  expect(r.w).toBe(320);
  expect(r.h).toBe(180);
  expect(r.glErrors).toEqual([]);
});

test(
  "createPostPipeline renders all four core lookdev profiles cleanly in HalfFloat WebGL2 and respects explicit width/height",
  async () => {
    for (const profile of [
      "explainer-clean",
      "cinematic",
      "outdoor-natural",
      "neon-night",
    ] as const) {
      const r = await page.run<{
        w: number;
        h: number;
        rgb: string;
        glErrors: number[];
        hasAo: boolean;
        aoHalfFloat: boolean;
        hasBloom: boolean;
        hasVignette: boolean;
        hasDof: boolean;
        profile: string;
      }>(`renderProfile(${JSON.stringify({ profile })})`);

      expect(r.glErrors).toEqual([]);
      expect(r.hasAo).toBe(true);
      expect(r.aoHalfFloat).toBe(true);
      expect(r.hasBloom).toBe(true);
      expect(r.hasDof).toBe(true);
      expect(r.hasVignette).toBe(profile === "neon-night");
      expect(r.profile).toBe(profile);

      const img = decodeRgb(r.rgb, r.w);
      expect(img.meanLuma(100, 50, 220, 140)).toBeGreaterThan(20);
    }

    const sized = await page.run<{ bufferW: number; bufferH: number; glErrors: number[] }>(
      `renderProfile(${JSON.stringify({ profile: "cinematic", width: 200, height: 120 })})`,
    );
    expect(sized.glErrors).toEqual([]);
    expect(sized.bufferW).toBe(200);
    expect(sized.bufferH).toBe(120);
  },
  30_000,
);

test(
  "explainer-clean dither preserves pure black (0,0,0) without lifting black floor",
  async () => {
    const r = await page.run<{ w: number; h: number; rgb: string; glErrors: number[] }>(
      `renderProfile(${JSON.stringify({ profile: "explainer-clean", blackBg: true })})`,
    );
    expect(r.glErrors).toEqual([]);
    const img = decodeRgb(r.rgb, r.w);
    let maxVal = 0;
    for (let i = 0; i < img.px.length; i++) if (img.px[i]! > maxVal) maxVal = img.px[i]!;
    expect(maxVal).toBe(0);
  },
  30_000,
);

test(
  "aoEnabled toggle, lazy ortho parallelAO, and godrays ortho suppression/restoration work cleanly",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      passesBefore: number;
      passesAfterOrtho: number;
      perspAoOn: boolean;
      perspAoOff: boolean;
      perspAoDuringOrtho: boolean;
      activeAoDuringOrthoIsDifferent: boolean;
      perspAoRestored: boolean;
      godraysBeforeOrtho: boolean;
      godraysDuringOrtho: boolean;
      godraysAfterOrthoUpdate: boolean;
      godraysRestored: boolean;
      rgbAoOn: string;
      rgbAoOff: string;
      rgbOrtho: string;
      glErrors: number[];
      disposeGlErrors: number[];
    }>("testOrthoAndAoToggle()");

    expect(r.glErrors).toEqual([]);
    expect(r.disposeGlErrors).toEqual([]);
    expect(r.perspAoOn).toBe(true);
    expect(r.perspAoOff).toBe(false);
    expect(r.passesAfterOrtho).toBe(r.passesBefore + 1);
    expect(r.perspAoDuringOrtho).toBe(false);
    expect(r.activeAoDuringOrthoIsDifferent).toBe(true);
    expect(r.perspAoRestored).toBe(true);
    expect(r.godraysBeforeOrtho).toBe(true);
    expect(r.godraysDuringOrtho).toBe(false);
    expect(r.godraysAfterOrthoUpdate).toBe(false);
    expect(r.godraysRestored).toBe(true);

    const on = decodeRgb(r.rgbAoOn, r.w);
    const off = decodeRgb(r.rgbAoOff, r.w);
    const ortho = decodeRgb(r.rgbOrtho, r.w);

    expect(on.px.equals(off.px)).toBe(false);
    expect(on.meanLuma(40, 40, 280, 160)).toBeLessThan(off.meanLuma(40, 40, 280, 160));
    expect(ortho.meanLuma(80, 40, 240, 140)).toBeGreaterThan(20);
  },
  30_000,
);

test(
  "afterToneMap custom effect runs after tone mapping and dither suppresses cleanly when adjust is active",
  async () => {
    const base = await page.run<{ w: number; h: number; rgb: string; glErrors: number[] }>(
      `renderProfile(${JSON.stringify({ profile: "cinematic" })})`,
    );
    const masked = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      hasGodrays: boolean;
    }>(
      `renderProfile(${JSON.stringify({ profile: "cinematic", withAfterToneMap: true, withGodrays: true })})`,
    );

    expect(masked.glErrors).toEqual([]);
    expect(masked.hasGodrays).toBe(true);

    const baseImg = decodeRgb(base.rgb, base.w);
    const maskedImg = decodeRgb(masked.rgb, masked.w);

    expect(baseImg.meanLuma(20, 4, 300, 35)).toBeGreaterThan(20);
    expect(maskedImg.meanLuma(20, 4, 300, 35)).toBe(0);
    expect(maskedImg.meanLuma(100, 80, 220, 150)).toBeGreaterThan(20);

    const coord = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      ditherAfterMask: boolean;
      ditherBeforeAdjust: number;
      adjustActive: boolean;
      ditherWhenAdjustActive: number;
      adjustInactive: boolean;
      ditherWhenAdjustBypassed: number;
    }>("testAdjustAndDitherCoordination()");

    expect(coord.glErrors).toEqual([]);
    expect(coord.ditherAfterMask).toBe(true);
    expect(coord.ditherBeforeAdjust).toBe(50);
    expect(coord.adjustActive).toBe(true);
    expect(coord.ditherWhenAdjustActive).toBe(0);
    expect(coord.adjustInactive).toBe(false);
    expect(coord.ditherWhenAdjustBypassed).toBe(50);
  },
  30_000,
);

test(
  "createScreenEffect renders cctv, vhs-crt, night-vision, and thermal deterministically in afterToneMap",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      presets: Record<string, { rgbA: string; rgbB: string; glErrors: number[] }>;
    }>("testScreenEffects()");

    for (const preset of ["cctv", "vhs-crt", "night-vision", "thermal"] as const) {
      const entry = r.presets[preset]!;
      expect(entry.glErrors).toEqual([]);
      const imgA = decodeRgb(entry.rgbA, r.w);
      const imgB = decodeRgb(entry.rgbB, r.w);
      expect(imgA.px.equals(imgB.px)).toBe(true);
      expect(imgA.meanLuma(80, 40, 240, 140)).toBeGreaterThan(15);
    }

    const nvg = decodeRgb(r.presets["night-vision"]!.rgbA, r.w);
    const [nr, ng, nb] = nvg.meanRgb(100, 60, 220, 130);
    expect(ng).toBeGreaterThan(nr * 2.0);
    expect(ng).toBeGreaterThan(nb * 2.0);

    const thermal = decodeRgb(r.presets.thermal!.rgbA, r.w);
    const [tr, , tb] = thermal.meanRgb(120, 70, 200, 120);
    expect(tr).toBeGreaterThan(tb);
  },
  30_000,
);

test(
  "Integrated lookdev stack (post + backdrop + sky + stars + sun + clouds + water + wetGround + haze + caustics + beam + xray + particles + emitter + flame + outline + lights + bakeSceneProbe) renders cleanly with zero WebGL errors",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      disposeGlErrors: number[];
      hasProbeTexture: boolean;
    }>("testIntegratedLookdevStack()");

    expect(r.glErrors).toEqual([]);
    expect(r.disposeGlErrors).toEqual([]);
    expect(r.hasProbeTexture).toBe(true);

    const img = decodeRgb(r.rgb, r.w);
    expect(img.meanLuma(40, 8, 280, 45)).toBeGreaterThan(35);
    expect(img.meanLuma(40, 125, 280, 170)).toBeGreaterThan(15);
    expect(img.meanLuma(110, 60, 210, 130)).toBeGreaterThan(25);
  },
  30_000,
);

test(
  "N8AO crevice darkening is preserved behind transparent corners of additive flame and volumetric beam",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgbAoOn: string;
      rgbAoOff: string;
      rgbWithAdditive: string;
      glErrors: number[];
    }>("testN8aoPreservedBehindAdditiveQuads()");

    expect(r.glErrors).toEqual([]);
    const aoOn = decodeRgb(r.rgbAoOn, r.w);
    const aoOff = decodeRgb(r.rgbAoOff, r.w);
    const withAdditive = decodeRgb(r.rgbWithAdditive, r.w);

    const onLuma = aoOn.meanLuma(140, 105, 210, 155);
    const offLuma = aoOff.meanLuma(140, 105, 210, 155);
    const addLuma = withAdditive.meanLuma(140, 105, 210, 155);

    expect(offLuma - onLuma).toBeGreaterThan(4);
    expect(addLuma).toBeLessThan(offLuma - 2);
  },
  30_000,
);

test(
  "createOutlineHighlight partial set(0.3) renders visible yellow outline over bright background and SkinnedMesh with zero WebGL errors",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgbOff: string;
      rgb: string;
      glErrors: number[];
      count: number;
    }>("testOutlinePartialAndSkinnedMesh()");

    expect(r.glErrors).toEqual([]);
    expect(r.count).toBe(2);

    const off = decodeRgb(r.rgbOff, r.w);
    const on = decodeRgb(r.rgb, r.w);
    expect(on.meanLuma(10, 10, 55, 55)).toBeGreaterThan(200);
    expect(on.meanLuma(135, 60, 185, 120)).toBeGreaterThan(200);
    expect(on.px.equals(off.px)).toBe(false);

    let yellowOutlinePixels = 0;
    for (let y = 30; y < 150; y++) {
      for (let x = 40; x < 280; x++) {
        const [r0, g0, b0] = off.at(x, y);
        const [r1, g1, b1] = on.at(x, y);
        const warmth0 = (r0! + g0!) * 0.5 - b0!;
        const warmth1 = (r1! + g1!) * 0.5 - b1!;
        if (warmth1 - warmth0 > 12) yellowOutlinePixels++;
      }
    }
    expect(yellowOutlinePixels).toBeGreaterThan(20);
  },
  30_000,
);

test(
  "Default post profile keeps tail.dithering false after ungraded adjust() and preserves pure black (0,0,0)",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      tailDithering: boolean;
      adjustActive: boolean;
    }>("testNoDoubleDitherPureBlack()");

    expect(r.glErrors).toEqual([]);
    expect(r.adjustActive).toBe(false);
    expect(r.tailDithering).toBe(false);

    const img = decodeRgb(r.rgb, r.w);
    let maxVal = 0;
    for (let i = 0; i < img.px.length; i++) if (img.px[i]! > maxVal) maxVal = img.px[i]!;
    expect(maxVal).toBe(0);
  },
  30_000,
);

test(
  "Switching perspective cameras with active godrays syncs camera references and near/far with zero WebGL errors",
  async () => {
    const r = await page.run<{
      enabled: boolean;
      propsMatchB: boolean;
      compMatchB: boolean;
      compNear: number;
      compFar: number;
      illumNear: number;
      illumFar: number;
      glErrors: number[];
    }>("testGodraysPerspectiveSwitch()");

    expect(r.glErrors).toEqual([]);
    expect(r.enabled).toBe(true);
    expect(r.propsMatchB).toBe(true);
    expect(r.compMatchB).toBe(true);
    expect(r.compNear).toBe(0.5);
    expect(r.compFar).toBe(250);
    expect(r.illumNear).toBe(0.5);
    expect(r.illumFar).toBe(250);
  },
  30_000,
);

test(
  "createSkyEnvironment lights a metallic sphere with non-black IBL specular and disposes cleanly",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      disposeGlErrors: number[];
    }>("testSkyEnvironmentSpecular()");

    expect(r.glErrors).toEqual([]);
    expect(r.disposeGlErrors).toEqual([]);

    const img = decodeRgb(r.rgb, r.w);
    expect(img.meanLuma(125, 55, 195, 125)).toBeGreaterThan(25);
    expect(img.meanLuma(4, 4, 24, 24)).toBe(0);
  },
  30_000,
);

test(
  "Production draft:false OrthographicCamera with scene.fog and initial ortho->perspective switch preserve N8AO darkening",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      initialAoPresent: boolean;
      rgbOrthoOn: string;
      rgbOrthoOff: string;
      rgbPerspOn: string;
      rgbPerspOff: string;
      glErrors: number[];
    }>("testProductionOrthoWithFog()");

    expect(r.glErrors).toEqual([]);
    expect(r.initialAoPresent).toBe(true);

    const oOn = decodeRgb(r.rgbOrthoOn, r.w);
    const oOff = decodeRgb(r.rgbOrthoOff, r.w);
    const pOn = decodeRgb(r.rgbPerspOn, r.w);
    const pOff = decodeRgb(r.rgbPerspOff, r.w);

    expect(oOn.meanLuma(60, 50, 260, 165)).toBeLessThan(oOff.meanLuma(60, 50, 260, 165) - 2);
    expect(pOn.meanLuma(60, 50, 260, 165)).toBeLessThan(pOff.meanLuma(60, 50, 260, 165) - 2);
  },
  30_000,
);

test(
  "createXRayMaterial clips cleanly against clippingPlanes alongside batched CONVOLUTION afterToneMap effects and dither:0 opt-out",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      ditherZeroTailFlag: boolean;
    }>("testXrayClippingAndMultiConv()");

    expect(r.glErrors).toEqual([]);
    expect(r.ditherZeroTailFlag).toBe(false);

    const img = decodeRgb(r.rgb, r.w);
    expect(img.meanLuma(120, 25, 200, 70)).toBeLessThan(4);
    expect(img.meanLuma(120, 100, 200, 145)).toBeGreaterThan(20);
  },
  30_000,
);

test(
  "HiDPI pixelRatio:2 keeps N8AOPostPass matched to physical drawingBufferSize on both perspective and lazy ortho cameras",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      perspAoW: number;
      perspAoH: number;
      orthoAoW: number;
      orthoAoH: number;
      rgbPerspOn: string;
      rgbPerspOff: string;
      rgbOrthoOn: string;
      rgbOrthoOff: string;
      glErrors: number[];
    }>("testHiDpiN8ao()");

    expect(r.glErrors).toEqual([]);
    expect(r.perspAoW).toBe(320);
    expect(r.perspAoH).toBe(180);
    expect(r.orthoAoW).toBe(320);
    expect(r.orthoAoH).toBe(180);

    const pOn = decodeRgb(r.rgbPerspOn, r.w);
    const pOff = decodeRgb(r.rgbPerspOff, r.w);
    const oOn = decodeRgb(r.rgbOrthoOn, r.w);
    const oOff = decodeRgb(r.rgbOrthoOff, r.w);

    expect(pOn.meanLuma(170, 50, 290, 150)).toBeLessThan(pOff.meanLuma(170, 50, 290, 150) - 2);
    expect(oOn.meanLuma(170, 50, 290, 150)).toBeLessThan(oOff.meanLuma(170, 50, 290, 150) - 2);
  },
  30_000,
);

test(
  "createOutlineHighlight rim mode renders visible cyan rim glow on static and SkinnedMesh targets with zero WebGL errors",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgbOff: string;
      rgbOn: string;
      glErrors: number[];
    }>("testOutlineRimModeAndSkinnedMesh()");

    expect(r.glErrors).toEqual([]);
    const off = decodeRgb(r.rgbOff, r.w);
    const on = decodeRgb(r.rgbOn, r.w);
    expect(on.px.equals(off.px)).toBe(false);

    let cyanRimPixels = 0;
    for (let y = 25; y < 155; y++) {
      for (let x = 40; x < 280; x++) {
        const [r0, g0, b0] = off.at(x, y);
        const [r1, g1, b1] = on.at(x, y);
        const c0 = (g0! + b0!) * 0.5 - r0!;
        const c1 = (g1! + b1!) * 0.5 - r1!;
        if (c1 - c0 > 18) cyanRimPixels++;
      }
    }
    expect(cyanRimPixels).toBeGreaterThan(25);
  },
  30_000,
);

test(
  "createEnvironment studio and room presets light metallic specular cleanly in WebGL2 and dispose with zero errors",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgbStudio: string;
      rgbRoom: string;
      glErrors: number[];
      disposeGlErrors: number[];
    }>("testCreateEnvironmentStudioAndRoom()");

    expect(r.glErrors).toEqual([]);
    expect(r.disposeGlErrors).toEqual([]);

    const studio = decodeRgb(r.rgbStudio, r.w);
    const room = decodeRgb(r.rgbRoom, r.w);
    expect(studio.meanLuma(125, 55, 195, 125)).toBeGreaterThan(25);
    expect(room.meanLuma(125, 55, 195, 125)).toBeGreaterThan(25);
    expect(studio.meanLuma(4, 4, 24, 24)).toBe(0);
    expect(room.meanLuma(4, 4, 24, 24)).toBe(0);
  },
  30_000,
);

test(
  "OrthographicCamera init lazily creates GodraysPass on perspective switch, carries live AO config, stabilizes DoF cocMaterial.version, and nulls pass on dispose",
  async () => {
    const r = await page.run<{
      initialSupported: boolean;
      initialPassIsNull: boolean;
      passStillNullOnOrtho: boolean;
      passCreatedOnPersp: boolean;
      enabledOnPersp: boolean;
      passBeforeTail: boolean;
      carriedIntensity: number;
      carriedRadius: number;
      carriedFalloff: number;
      carriedColorHex: number;
      enabledBackOnOrtho: boolean;
      cocVersionStart: number;
      cocVersionEnd: number;
      enabledRestoredOnPersp: boolean;
      passNullAfterDispose: boolean;
      glErrors: number[];
      disposeGlErrors: number[];
    }>("testOrthoInitLazyGodraysAndAoCarryover()");

    expect(r.glErrors).toEqual([]);
    expect(r.disposeGlErrors).toEqual([]);
    expect(r.initialSupported).toBe(true);
    expect(r.initialPassIsNull).toBe(true);
    expect(r.passStillNullOnOrtho).toBe(true);
    expect(r.passCreatedOnPersp).toBe(true);
    expect(r.enabledOnPersp).toBe(true);
    expect(r.passBeforeTail).toBe(true);
    expect(r.carriedIntensity).toBeCloseTo(3.1, 6);
    expect(r.carriedRadius).toBeCloseTo(1.15, 6);
    expect(r.carriedFalloff).toBeCloseTo(1.4, 6);
    expect(r.carriedColorHex).toBe(0x112233);
    expect(r.enabledBackOnOrtho).toBe(false);
    expect(r.cocVersionEnd).toBe(r.cocVersionStart);
    expect(r.enabledRestoredOnPersp).toBe(true);
    expect(r.passNullAfterDispose).toBe(true);
  },
  30_000,
);

test(
  "AgX cinematic pipeline preserves linear HDR > 1.0 headroom because HueSaturationEffect runs after ToneMappingEffect",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
      toneAfterToneMapping: boolean;
    }>("testHdrHeadroomAndMainPassOrder()");

    expect(r.glErrors).toEqual([]);
    expect(r.toneAfterToneMapping).toBe(true);

    const img = decodeRgb(r.rgb, r.w);
    const sdrWhiteLuma = img.meanLuma(35, 55, 85, 125);
    const hdrWhiteLuma = img.meanLuma(135, 55, 185, 125);
    const [or, og, ob] = img.meanRgb(235, 55, 285, 125);

    expect(sdrWhiteLuma).toBeGreaterThan(185);
    expect(sdrWhiteLuma).toBeLessThan(218);
    expect(hdrWhiteLuma).toBeGreaterThan(240);
    expect(hdrWhiteLuma - sdrWhiteLuma).toBeGreaterThan(25);
    expect(or).toBeGreaterThan(235);
    expect(og).toBeGreaterThan(150);
    expect(ob).toBeGreaterThan(55);
  },
  30_000,
);

test(
  "createXRayMaterial compiles and renders cleanly on a bent SkinnedMesh with clippingPlanes in WebGL2",
  async () => {
    const r = await page.run<{
      w: number;
      h: number;
      rgb: string;
      glErrors: number[];
    }>("testXraySkinnedMeshWithClipping()");

    expect(r.glErrors).toEqual([]);
    const img = decodeRgb(r.rgb, r.w);
    expect(img.meanLuma(110, 20, 210, 65)).toBeLessThan(5);
    expect(img.meanLuma(110, 105, 210, 150)).toBeGreaterThan(18);
  },
  30_000,
);
