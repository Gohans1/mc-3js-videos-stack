import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { openPage } from "./gpu";

let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/dof-page.ts"));
}, 60_000);
afterAll(() => page?.close());

const renderShot = async (opts: {
  fstop?: number;
  focusDistance?: number;
  mm?: number;
  fadeLevel?: number;
  particles?: number;
  t?: number;
}) => {
  const r = await page.run<{ enabled: boolean; w: number; h: number; rgb: string }>(
    `renderShot(${JSON.stringify(opts)})`,
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

// Local contrast: average absolute horizontal neighbour jump across a checkerboard region.
const edgeContrast = (
  s: Awaited<ReturnType<typeof renderShot>>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => {
  let sum = 0,
    n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1 - 1; x++) {
      sum += Math.abs(s.at(x + 1, y)[1]! - s.at(x, y)[1]!);
      n++;
    }
  return sum / n;
};

test("DOF bypasses cleanly with fstop: 0, keeping both 4m and 12m planes crisp", async () => {
  const off = await renderShot({ fstop: 0, mm: 85 });
  expect(off.enabled).toBe(false);
  const near = edgeContrast(off, 90, 100, 230, 260);
  const far = edgeContrast(off, 410, 100, 550, 260);
  expect(near).toBeGreaterThan(8);
  expect(far).toBeGreaterThan(8);
});

test("Active DOF blurs out-of-focus planes and swaps sharpness across rack-focus pulls in HalfFloat pipeline", async () => {
  const nearFocus = await renderShot({ fstop: 1.4, focusDistance: 4.0, mm: 85 });
  expect(nearFocus.enabled).toBe(true);
  const nn = edgeContrast(nearFocus, 90, 100, 230, 260);
  const nf = edgeContrast(nearFocus, 410, 100, 550, 260);
  expect(nn).toBeGreaterThan(nf * 1.4);

  const farFocus = await renderShot({ fstop: 1.4, focusDistance: 12.0, mm: 85 });
  expect(farFocus.enabled).toBe(true);
  const fn = edgeContrast(farFocus, 90, 100, 230, 260);
  const ff = edgeContrast(farFocus, 410, 100, 550, 260);
  expect(ff).toBeGreaterThan(fn * 1.4);
});

test("makeFade(1) renders pure black (0,0,0) even with active DOF, Bloom, grain, and HalfFloatType", async () => {
  const faded = await renderShot({
    fstop: 1.4,
    focusDistance: 4.0,
    mm: 85,
    particles: 60,
    fadeLevel: 1,
    t: 1.0,
  });
  let maxVal = 0;
  for (let i = 0; i < faded.px.length; i++) if (faded.px[i]! > maxVal) maxVal = faded.px[i]!;
  expect(maxVal).toBe(0);
});

test("Alternating active-DOF and disabled-DOF views (makeTransitions pattern) leaves zero stale blur state", async () => {
  const cleanBefore = await renderShot({ fstop: 0, mm: 85 });
  await renderShot({ fstop: 1.4, focusDistance: 4.0, mm: 85 });
  const cleanAfter = await renderShot({ fstop: 0, mm: 85 });

  expect(cleanAfter.enabled).toBe(false);
  expect(cleanAfter.px.equals(cleanBefore.px)).toBe(true);
});
