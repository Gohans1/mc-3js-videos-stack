import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { openFilmHTML } from "../../live-studio/src/openfilm.mjs";
import { openPage } from "./gpu";

let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/custom-page.ts"), (req) => {
    const path = new URL(req.url).pathname;
    const mode = path.split("/").at(-1)!;
    const response = (html: string) =>
      new Response(path.startsWith("/_openfilm/") ? openFilmHTML(html) : html, {
        headers: { "content-type": "text/html" },
      });
    if (mode === "sprite-cache")
      return response(`<!doctype html><html><head><style>html,body{margin:0}canvas{display:block}</style></head><body><canvas width="8" height="8"></canvas><script>
      function sprite(color){const c=document.createElement('canvas');c.width=c.height=8;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,8,8);return c}
      const red=sprite('red'),blue=sprite('blue'),ctx=document.querySelector('canvas').getContext('2d');window.film={frame(t){ctx.drawImage(t<0.5?red:blue,0,0);ctx.globalAlpha=0.2}};
    </script></body></html>`);
    if (["body", "cssom"].includes(mode))
      return new Response(
        `<!doctype html><style>html,body{margin:0;width:8px;height:8px}body{background:red}</style><script>window.film={frame(t){${mode === "body" ? "document.body.style.backgroundColor" : "document.styleSheets[0].cssRules[1].style.backgroundColor"}=t<0.5?'red':'blue'}}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    if (
      ![
        "async",
        "async-webgl",
        "lazy-webgl",
        "ready-error",
        "frame-error",
        "ready-stuck",
        "frame-stuck",
      ].includes(mode)
    )
      return;
    return response(
      `<!doctype html><html><head><style>html,body{margin:0}canvas{display:block}</style></head><body><canvas width="8" height="8"></canvas><script>
      let ready=false;
      window.film={
        ready:${mode === "ready-stuck" ? "new Promise(()=>{})" : mode === "ready-error" ? "()=>{throw Error('missing model.glb')}" : "new Promise(r=>setTimeout(()=>{ready=true;r()},30))"},
        async frame(t){
          if(!ready) throw Error('ready was not awaited');
          ${mode === "lazy-webgl" ? "if(t===0)return;" : ""}
          ${mode === "frame-error" ? "if(t>0) throw Error('missing texture.png');" : ""}
          ${mode === "frame-stuck" ? "if(t>0) await new Promise(()=>{});" : ""}
          await new Promise(r=>setTimeout(r,10));
          ${mode === "async-webgl" || mode === "lazy-webgl" ? "const gl=document.querySelector('canvas').getContext('webgl',{preserveDrawingBuffer:true});gl.clearColor(t<0.5?1:0,0,t<0.5?0:1,1);gl.clear(gl.COLOR_BUFFER_BIT);" : "const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle=t<0.5?'red':'blue';ctx.fillRect(0,0,8,8);"}
        }
      };
    </script></body></html>`,
    );
  });
}, 30000);
afterAll(() => page?.close());

test("custom pages await readiness and async 2D/WebGL pixels across serialized seeks", async () => {
  for (const mode of [
    "async",
    "async-webgl",
    "lazy-webgl",
    "body",
    "cssom",
    "_openfilm/library/lazy-webgl",
    "_openfilm/library/sprite-cache",
  ]) {
    const pixels = await page.run<number[][]>(`asyncFrames(${JSON.stringify(mode)})`);
    expect(pixels).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 255],
    ]);
  }
}, 30000);

test("readiness and drawing failures name the page and phase and clean up their iframe", async () => {
  for (const [mode, expected] of [
    ["ready-error", /ready-error.*ready.*missing model.glb/],
    ["frame-error", /frame-error.*frame\(0.7\).*missing texture.png/],
  ] as const) {
    const result = await page.run<{ error: string; leaked: number }>(
      `pageFailure(${JSON.stringify(mode)})`,
    );
    expect(result.error).toMatch(expected);
    expect(result.leaked).toBe(0);
  }
}, 30000);

test("a never-settling ready or frame is bounded and removed", async () => {
  for (const mode of ["ready-stuck", "frame-stuck"]) {
    const result = await page.run<{ error: string; leaked: number }>(
      `pageFailure(${JSON.stringify(mode)},1000)`,
    );
    expect(result.error).toMatch(/did not finish within 1000 ms/);
    expect(result.leaked).toBe(0);
  }
}, 30000);
