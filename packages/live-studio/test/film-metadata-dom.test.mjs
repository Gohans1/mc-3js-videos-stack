import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO = join(import.meta.dirname, "..");
const ENTRY = `
import {createElement} from "react";
import {createRoot} from "react-dom/client";
import "/index.css";
import {TooltipProvider} from "/components/ui/tooltip.tsx";
import {setFilmSource} from "/core/filmMeta.ts";
import {S} from "/core/state.ts";
import {set} from "/core/store.ts";
import {OwnPanel} from "/own/OwnPanel.tsx";
import {FullscreenTransport} from "/shell/FullscreenTransport.tsx";

const view=document.getElementById("view");
const render=Object.assign(()=>({}),{transitions:[]});
S.render=render;
S.el={view};
const metadata=duration=>({DURATION:duration,SHOTS:[],SHOTS_OUT:[],applyEdit(){}});
window.fixture={
  reset(){
    render.transitions=[{id:"first-custom",title:"First custom cut"}];
    set({filmKind:"transitions",ready:true});
    setFilmSource(metadata(10));
  },
  refresh(){
    render.transitions.push({id:"later-custom",title:"Later custom cut"});
    setFilmSource(metadata(20));
  },
};
window.fixture.reset();
createRoot(view).render(
  <TooltipProvider>
    <button id="enter-fullscreen" onClick={()=>view.requestFullscreen()}>Enter full screen</button>
    <OwnPanel/>
    <FullscreenTransport/>
  </TooltipProvider>
);
`;

let dir, vite, page;
const waitUntil = async (expression) => {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await page.evaluate(`Boolean(${expression})`)) return;
    await Bun.sleep(20);
  }
  throw new Error(
    `Timed out: ${expression}; ${JSON.stringify(await page.evaluate("window.errors"))}`,
  );
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "film-metadata-dom-"));
  const src = join(dir, "src");
  mkdirSync(src);
  writeFileSync(
    join(src, "scene.ts"),
    "export const SHOTS=[],SHOTS_OUT=[],DURATION=10;export const applyEdit=()=>{};export const buildScene=()=>()=>({});",
  );
  writeFileSync(
    join(src, "edit.ts"),
    "export const EDIT={end:10};export const fromSource=t=>t;export const toSource=t=>t;",
  );
  const entry = join(STUDIO, "app/__metadata_fixture__.tsx").replaceAll("\\", "/");
  vite = await createServer({
    configFile: false,
    logLevel: "silent",
    root: join(STUDIO, "app"),
    cacheDir: join(dir, ".vite"),
    optimizeDeps: { exclude: ["loudness-worklet"] },
    resolve: { alias: [{ find: "@", replacement: join(STUDIO, "app") }] },
    plugins: [
      {
        name: "film-metadata-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/metadata-fixture.tsx") return entry;
          if (id.startsWith("loudness-worklet/worklet")) return "\0metadata-worklet";
        },
        load(id) {
          if (id.replaceAll("\\", "/") === entry) return ENTRY;
          if (id === "\0metadata-worklet") return 'export default "/unused-worklet.js"';
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(
                "/",
                `<!doctype html><script>window.errors=[];window.__STUDIO_BOOT={features:{},tags:{},small:false};addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)))</script><div id="view" style="position:relative;width:100vw;height:100vh;display:flex;flex-direction:column"></div><script type="module" src="/metadata-fixture.tsx"></script>`,
              ),
            );
          });
        },
      },
      react(),
      tailwindcss(),
      filmPlugin({ SRC: src, threeFrom: STUDIO }),
    ],
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { strict: false } },
  });
  await vite.listen();
  page = new Bun.WebView({ backend: { type: "chrome" } });
  await page.navigate(vite.resolvedUrls.local[0]);
  await waitUntil("document.body.textContent.includes('First custom cut')");
}, 60000);

afterAll(async () => {
  page?.close();
  await vite?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await page.evaluate("window.fixture.reset()");
  await waitUntil("!document.body.textContent.includes('Later custom cut')");
});
afterEach(async () => {
  if (await page.evaluate("Boolean(document.fullscreenElement)"))
    await page.evaluate("document.exitFullscreen()");
  expect(await page.evaluate("window.errors")).toEqual([]);
});

test("mounted film choices refresh when new film metadata arrives", async () => {
  await page.evaluate("window.fixture.refresh()");
  await waitUntil("document.body.textContent.includes('Later custom cut')");
  expect(await page.evaluate("document.body.textContent.includes('First custom cut')")).toBe(true);
});

test("full screen playback keeps compact slider geometry and updates its duration", async () => {
  await page.evaluate("document.getElementById('enter-fullscreen').focus()");
  await page.press("Enter");
  const input = "document.querySelector('input[aria-label=\"Full screen playhead\"]')";
  await waitUntil(input);
  const geometry = await page.evaluate(`(() => {
    const root=${input}.closest('[data-slot="slider"]');
    const thumb=root.querySelector('[data-slot="slider-thumb"]').getBoundingClientRect();
    const track=root.querySelector('[data-slot="slider-track"]').getBoundingClientRect();
    return {thumb:thumb.width,track:track.height,inset:thumb.left-track.left};
  })()`);
  expect(geometry.thumb).toBeCloseTo(8);
  expect(geometry.track).toBeCloseTo(2);
  expect(geometry.inset).toBeCloseTo(0);
  expect(await page.evaluate(`${input}.max`)).toBe("299");
  await page.evaluate("window.fixture.refresh()");
  await waitUntil(`${input}.max === '599'`);
});
