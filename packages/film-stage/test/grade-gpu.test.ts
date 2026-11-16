import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { openPage } from "./gpu";

// The finishing sliders through the real shaders (makeAdjustments in headless Chrome), on the pictures test/gpu/grade-page.ts paints
let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/grade-page.ts"));
}, 60_000);
afterAll(() => page?.close());

const shot = async (
  picture: string,
  basic: Record<string, number> = {},
  film = false,
  opts?: { t?: number; look?: string; layer?: boolean },
) => {
  const r = await page.run<{ w: number; h: number; rgb: string }>(
    `grade(${JSON.stringify(picture)}, ${JSON.stringify(basic)}, ${film}, ${JSON.stringify(opts ?? {})})`,
  );
  const px = Buffer.from(r.rgb, "base64");
  const at = (x: number, y: number) => [...px.subarray((y * r.w + x) * 3, (y * r.w + x) * 3 + 3)];
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    const out: number[][] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(at(x, y));
    return out;
  };
  return { ...r, px, at, box };
};
type Shot = Awaited<ReturnType<typeof shot>>;
test("Finishing sliders reuse their color LUT while color and secondary edits invalidate it", async () => {
  const result = await page.run<{ finishLuts: number; invalidates: boolean[] }>("finishLutTrial()");
  expect(result.finishLuts).toBe(1);
  expect(result.invalidates).toEqual([true, true, true, true]);
});

const spread = (pixels: number[][]) => {
  const g = pixels.map((p) => p[1]!);
  return Math.max(...g) - Math.min(...g);
};

test("Fisheye pushes the picture out from the centre", async () => {
  const brightest = (s: Shot, y: number) => {
    let best = 0;
    for (let x = 1; x < s.w; x++) if (s.at(x, y)[0]! > s.at(best, y)[0]!) best = x;
    return best;
  };
  expect(brightest(await shot("line"), 270)).toBe(623);
  expect(brightest(await shot("line", { fisheye: 100 }), 270)).toBeGreaterThan(635);
});

test("Lens fringe splits red from blue toward the corners and hardly at the centre", async () => {
  const split = (pixels: number[][]) => pixels.filter(([r, , b]) => Math.abs(r! - b!) > 60).length;
  const plain = await shot("dots"),
    fringed = await shot("dots", { fringe: 100 });
  expect(split(plain.box(860, 0, 940, 80))).toBe(0);
  const corner = split(fringed.box(860, 0, 940, 80)),
    centre = split(fringed.box(440, 230, 520, 310));
  expect(corner).toBeGreaterThan(4 * centre);
});

test("Halation warms bright areas and leaves dark ones alone", async () => {
  const plain = await shot("glow"),
    warm = await shot("glow", { halation: 100 });
  const [r, , b] = warm.at(480, 270);
  expect(r! - b!).toBeGreaterThan(20);
  expect(warm.at(60, 60)).toEqual(plain.at(60, 60));
});

test("Sharpen raises fine contrast and Soften lowers it", async () => {
  const area = (s: Shot) => s.box(400, 200, 440, 240);
  const base = spread(area(await shot("checker")));
  expect(spread(area(await shot("checker", { sharpen: 100 })))).toBeGreaterThan(base + 20);
  expect(spread(area(await shot("checker", { soften: 100 })))).toBeLessThan(base * 0.7);
});

test("Smooth dither moves flat grey by a level or two, the same way every frame", async () => {
  const area = (s: Shot) => s.box(400, 200, 460, 260);
  expect(spread(area(await shot("flat")))).toBe(0);
  const a = await shot("flat", { dither: 100 }),
    b = await shot("flat", { dither: 100 });
  const g = area(a).map((p) => p[1]!);
  expect(Math.max(...g) - Math.min(...g)).toBeGreaterThan(1);
  expect(Math.max(...g.map((v) => Math.abs(v - 128)))).toBeLessThanOrEqual(3);
  expect(Math.abs(g.reduce((s, v) => s + v, 0) / g.length - 128)).toBeLessThan(0.5);
  expect(a.px.equals(b.px)).toBe(true);
});

test("Smooth dither stays a level or two in the dark, where banding shows, instead of turning to grain", async () => {
  const g = (await shot("dark", { dither: 100 })).box(400, 200, 460, 260).map((p) => p[1]!);
  expect(Math.max(...g) - Math.min(...g)).toBeGreaterThan(1);
  expect(Math.max(...g.map((v) => Math.abs(v - 13)))).toBeLessThanOrEqual(2);
});

test("A film's picture leaves the GPU without bands: a ramp finer than 8 bits keeps its in-between levels", async () => {
  for (const basic of [{}, { vignette: 1 }]) {
    const s = await shot("ramp", basic, true);
    for (let x = 30; x < 900; x += 29) {
      const level = 100 + (4 * x) / s.w,
        g = s.box(x, 200, x + 1, 340).map((p) => p[1]!);
      expect(Math.abs(g.reduce((sum, v) => sum + v, 0) / g.length - level)).toBeLessThan(0.2);
      expect(Math.max(...g.map((v) => Math.abs(v - level)))).toBeLessThan(1.5);
    }
  }
});

test("Named looks activate in both makeAdjustments and makeLayerAdjustments even with empty basic sliders", async () => {
  const base = await shot("glow", {}, true);
  const adjusted = await shot("glow", {}, true, { look: "teal-amber" });
  const layered = await shot("glow", {}, true, { look: "teal-amber", layer: true });

  // Shadow corners cool down (blue > red), highlight centre warms up (red > blue)
  const [br, , bb] = base.at(60, 60);
  const [ar, , ab] = adjusted.at(60, 60);
  const [lr, , lb] = layered.at(60, 60);
  expect(ab! - ar!).toBeGreaterThan(bb! - br! + 3);
  expect(lb! - lr!).toBeGreaterThan(bb! - br! + 3);

  const [hr, , hb] = adjusted.at(480, 270);
  const [lhr, , lhb] = layered.at(480, 270);
  expect(hr! - hb!).toBeGreaterThan(10);
  expect(lhr! - lhb!).toBeGreaterThan(10);
});

test("Film grain stays quantized on a 24fps cadence so sub-frame accumulation does not average it away", async () => {
  const a = await shot("flat", { particles: 80 }, true, { t: 1.001 });
  const b = await shot("flat", { particles: 80 }, true, { t: 1.015 });
  const c = await shot("flat", { particles: 80 }, true, { t: 1.05 });

  expect(a.px.equals(b.px)).toBe(true);
  expect(a.px.equals(c.px)).toBe(false);
});
