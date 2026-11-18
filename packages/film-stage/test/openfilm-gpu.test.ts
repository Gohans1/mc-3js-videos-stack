import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import {
  openFilmCatalog,
  openFilmHTML,
  openFilmResource,
} from "../../live-studio/src/openfilm.mjs";
import { openPage } from "./gpu";

let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/openfilm-page.ts"), (req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/_openfilm/library/test-recovery-")) {
      const bad = url.pathname.endsWith("-bad.html");
      const seek = url.pathname.endsWith("-seek.html");
      return new Response(
        openFilmHTML(
          `<!doctype html><head><style>body{margin:0}</style></head><body><canvas width="64" height="36"></canvas><script>const g=document.querySelector('canvas').getContext('2d');window.film={frame(t){${bad ? "throw Error('broken editable asset')" : (seek ? "if(t>0.5)throw Error('broken seek');" : "") + "g.fillStyle='lime';g.fillRect(0,0,64,36)"}}}</script>`,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }
    if (url.pathname === "/_openfilm/library/test-init.html")
      return new Response(
        openFilmHTML(
          `<!doctype html><html><head><style>:root{--ink:blue}body{margin:0}.label{display:none}</style></head><body><span class="label">old</span><canvas width="32" height="32"></canvas><script>const label=document.querySelector('.label'),words=label.textContent,color=getComputedStyle(document.documentElement).getPropertyValue('--ink');window.film={frame(){label.textContent=words;const g=document.querySelector('canvas').getContext('2d');g.fillStyle=color;g.fillRect(0,0,32,32)}}</script></body></html>`,
          JSON.parse(url.searchParams.get("_of") ?? "{}"),
        ),
        { headers: { "content-type": "text/html" } },
      );
    const asset = openFilmResource(req);
    if (asset) return asset;
    if (new URL(req.url).pathname !== "/fixture") return;
    return new Response(
      `<!doctype html><script>window.filmHost=true</script>
      <style>html,body{margin:0;height:100%;background:transparent} .box{position:absolute;width:40px;height:40px;background:red;animation:show 1s linear both}@keyframes show{from{opacity:0}to{opacity:1}} .label{position:absolute;left:42px;color:white;font:16px sans-serif}</style>
      <div class="box"></div><div class="label">old</div><canvas id="ink" width="4" height="4" style="position:absolute;left:76px"></canvas>
      <script>window.film={frame(t){const g=document.querySelector('#ink').getContext('2d');g.fillStyle='blue';g.fillRect(0,0,4,4)}}</script>`,
      { headers: { "content-type": "text/html" } },
    );
  });
}, 60_000);
afterAll(() => page?.close());

test("editable words and CSS variables reach a component before its script initializes", async () => {
  expect(await page.run("propsBeforeInit()")).toEqual({ text: "AI", pixel: [255, 0, 0, 255] });
});

test("failed seeks can return to a valid time on the same overlay and cut", async () => {
  const results = await page.run<{
    layers: { error?: string; pixel?: number[] }[];
    cuts: { error?: string; pixel?: number[] }[];
  }>("seekRecovery()");
  for (const frames of [results.layers, results.cuts]) {
    expect(frames[0]!.pixel).toEqual([0, 255, 0, 255]);
    expect(frames[1]!.error).toContain("broken seek");
    expect(frames[2]!.pixel).toEqual([0, 255, 0, 255]);
  }
});

test("an OpenFilm cut does not redraw 3D frames outside its own interval", async () => {
  expect(await page.run("inactiveCutDraws()")).toBe(1);
});

test("removing a broken page restores valid overlays and an empty layer list", async () => {
  const results =
    await page.run<{ asset: string | null; error?: string; pixel?: number[] }[]>("layerRecovery()");
  expect(results[0]!.error).toContain("broken editable asset");
  expect(results[1]).toEqual({ asset: "good", pixel: [0, 255, 0, 255] });
  expect(results[2]!.error).toContain("broken editable asset");
  expect(results[3]).toEqual({ asset: null, pixel: [255, 0, 0, 255] });
  expect(results[4]).toEqual({ asset: "good", pixel: [0, 255, 0, 255] });
});

test("motion opacity blends the completed effect with the underlying picture", async () => {
  const [off, half, full] = await page.run<number[][]>("layerOpacity()");
  expect(off).toEqual([255, 0, 0, 255]);
  expect(full![0]).toBeLessThan(240);
  expect(Math.abs(half![0]! - (255 + full![0]!) / 2)).toBeLessThan(2);
  expect(half!.slice(1)).toEqual([0, 0, 255]);
});

test("iframe webfonts preserve Vietnamese glyph widths in the exported texture", async () => {
  const widths = await page.run<{ snapshot: number; native: number }>("fontWidths()");
  expect(Math.abs(widths.snapshot - widths.native) / widths.native).toBeLessThan(0.02);
});

test("HTML, CSS animations and canvas snapshots survive nonsequential seeks", async () => {
  const [early, middle, again] = await page.run<number[][]>("pageFrames()");
  expect(early).toEqual(again!);
  expect(middle![3]).toBeGreaterThan(early![3]!);
  expect(middle!.slice(76 * 4, 76 * 4 + 4)).toEqual([0, 0, 255, 255]);
}, 30_000);

test("native motion, fade and HTML cut adapters produce real Three.js pixels and seek deterministically", async () => {
  const results = await page.run<
    { id: string; frames: { red: number; blue: number; hash: number }[] }[]
  >(
    `transitionsNative(${JSON.stringify(
      openFilmCatalog()
        .filter((r) => r.cat === "transition")
        .map((r) => r.id),
    )})`,
  );
  for (const {
    id,
    frames: [early, late, again, end],
  } of results) {
    expect(early, id).toEqual(again!);
    expect(early!.red + early!.blue, id).toBeGreaterThan(0);
    expect(late!.hash, id).not.toBe(early!.hash);
    expect(end!.blue, id).toBeGreaterThan(end!.red);
  }
}, 180_000);

test("all distinct source pages, text variants and template pages support deterministic seeking", async () => {
  const recipes = openFilmCatalog()
    .flatMap((r) => [r, ...(r.children ?? [])])
    .filter((r) => r.render === "page" && !r.id.startsWith("stickers/emoji/"));
  recipes.push(openFilmCatalog().find((r) => r.id === "stickers/emoji/alien")!);
  const bad = [];
  for (let i = 0; i < recipes.length; i += 20) {
    const results = await page.run<
      { id: string; pure?: boolean; alpha?: number; error?: string }[]
    >(`auditPages(${JSON.stringify(recipes.slice(i, i + 20).map((r) => r.id))})`);
    bad.push(...results.filter((r) => r.error || !r.pure || !r.alpha));
  }
  expect(bad).toEqual([]);
}, 180_000);
