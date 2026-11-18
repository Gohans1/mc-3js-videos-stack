import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

let root, server, browser;
const studio = resolve(import.meta.dir, "..");
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "mc-note-frame-"));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src/scene.ts"),
    "export const SHOTS=[], SHOTS_OUT=[], DURATION=10; export const applyEdit=()=>{}; export const buildScene=()=>{};",
  );
  writeFileSync(
    join(root, "src/edit.ts"),
    "export const EDIT={}; export const fromSource=t=>t; export const toSource=t=>t;",
  );
  const entry = `${studio.replaceAll("\\", "/")}/app/__note-frame-test__.ts`;
  server = await createServer({
    configFile: join(studio, "vite.config.ts"),
    logLevel: "silent",
    cacheDir: join(root, "vite-cache"),
    optimizeDeps: { exclude: ["loudness-worklet/worklet?url"] },
    plugins: [
      filmPlugin({ SRC: join(root, "src"), threeFrom: studio }),
      {
        name: "note-frame-test",
        resolveId: (id) => (id === "/__note-frame-test__.ts" ? entry : null),
        load(id) {
          if (id !== entry) return;
          return `
          import { S } from '@/core/state';
          import { registerEngine } from '@/core/engine';
          import { render } from '@/picture/render';
          import { setFilmSource } from '@/core/filmMeta';
          import { nowPicture } from '@/notes/notes';
          import { momentStrip } from '@/notes/pictures';
          const canvas=document.createElement('canvas'); canvas.width=960; canvas.height=540;
          const ctx=canvas.getContext('2d'); ctx.fillStyle='green'; ctx.fillRect(0,0,960,540);
          S.el={canvas}; S.t=0;
          setFilmSource({DURATION:10,SHOTS:[],SHOTS_OUT:[],applyEdit(){}});
          S.render=Object.assign(()=>{}, {async renderFrame(t){ctx.fillStyle=t<1?'red':'blue';ctx.fillRect(0,0,960,540);await new Promise(r=>setTimeout(r,25));}});
          registerEngine({render});
          window.noteFrame=async t=>{
            const url=await nowPicture({id:'frame-'+t,t,text:'check',at:'2026-01-01',time:'',shot:0,done:false});
            const img=new Image(); img.src=url; await img.decode();
            const copy=document.createElement('canvas');copy.width=copy.height=1;
            const g=copy.getContext('2d');g.drawImage(img,0,0,1,1);return [...g.getImageData(0,0,1,1).data];
          };
          window.noteStrip=async()=>{
            const previous=S.render;
            S.render=Object.assign(()=>{}, {async renderFrame(t){await new Promise(r=>setTimeout(r,25));ctx.fillStyle='rgb('+Math.round(t*50)+','+Math.round(t*20)+',0)';ctx.fillRect(0,0,960,540);}});
            try {
            const img=new Image();img.src=await momentStrip(3);await img.decode();
            const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
            return [0,1,2,3].map(i=>[...g.getImageData((i+.5)*img.width/4,img.height/2,1,1).data]);
            } finally { S.render=previous; }
          };
        `;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/test.html") return next();
            res.setHeader("content-type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                "/test.html",
                '<!doctype html><body><script>addEventListener("error",e=>window.testError=e.message);addEventListener("unhandledrejection",e=>window.testError=String(e.reason));</script><script type="module" src="/__note-frame-test__.ts"></script>',
              ),
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = new Bun.WebView({ backend: { type: "chrome" } });
  await browser.navigate(new URL("test.html", server.resolvedUrls.local[0]).href);
  const deadline = Date.now() + 10000;
  while (!(await browser.evaluate("typeof window.noteFrame === 'function'"))) {
    if (Date.now() > deadline)
      throw new Error(
        "Note frame fixture did not load: " + (await browser.evaluate("window.testError")),
      );
    await new Promise((r) => setTimeout(r, 25));
  }
}, 30000);

test("each note-strip panel contains the frame printed on its timestamp", async () => {
  const pixels = await browser.evaluate("noteStrip()");
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(pixels[i][0] - (i + 1) * 50)).toBeLessThan(3);
    expect(Math.abs(pixels[i][1] - (i + 1) * 20)).toBeLessThan(3);
  }
}, 30000);
afterAll(async () => {
  browser?.close();
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

test("a note's current image waits for its requested async film frame", async () => {
  const deadline = Date.now() + 10000;
  while (!(await browser.evaluate("typeof window.noteFrame === 'function'"))) {
    if (Date.now() > deadline)
      throw new Error(
        "Note frame fixture did not load: " + (await browser.evaluate("window.testError")),
      );
    await new Promise((r) => setTimeout(r, 25));
  }
  const red = await browser.evaluate("noteFrame(0.5)"),
    blue = await browser.evaluate("noteFrame(3)");
  expect(red[0]).toBeGreaterThan(240);
  expect(red[1]).toBeLessThan(10);
  expect(blue[2]).toBeGreaterThan(240);
  expect(blue[0]).toBeLessThan(10);
  const simultaneous = await browser.evaluate("Promise.all([noteFrame(0.6),noteFrame(3.6)])");
  expect(simultaneous[0][0]).toBeGreaterThan(240);
  expect(simultaneous[1][2]).toBeGreaterThan(240);
}, 30000);
