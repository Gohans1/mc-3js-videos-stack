import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openPage } from "./gpu";

test("picking respects visible children, background images, pseudo elements and transparent SVG viewports", async () => {
  const html = `<!doctype html><style>body{margin:0}#under{position:absolute;inset:0;background:blue}.tile{position:absolute;top:0;width:80px;height:80px}#hidden{visibility:hidden}#visible{visibility:visible;background:red;width:80px;height:80px}#image{left:100px;background-image:linear-gradient(green,green)}svg{left:200px}#pseudo{left:300px}#pseudo:before{content:"";display:block;width:80px;height:80px;background:yellow}</style><div id="under"></div><div class="tile" id="hidden"><div id="visible"></div></div><div class="tile" id="image"></div><svg class="tile" id="svg"></svg><div class="tile" id="pseudo"></div><script>window.film={frame(){}}</script>`;
  const page = await openPage(join(import.meta.dir, "gpu/page-edit.ts"), (req) =>
    new URL(req.url).pathname === "/picking.html"
      ? new Response(html, { headers: { "content-type": "text/html" } })
      : undefined,
  );
  try {
    expect(await page.run("pickingProbe()")).toEqual(["#visible", "#image", "#under", "#pseudo"]);
  } finally {
    page.close();
  }
}, 30000);

test("a full-size local HTML overlay shares inspection and human edits with the final composite", async () => {
  const html = readFileSync(
    join(
      import.meta.dir,
      "../../live-studio/test/fixtures/direct-edit-film/assets/public/custom-title.html",
    ),
    "utf8",
  );
  const page = await openPage(join(import.meta.dir, "gpu/page-edit.ts"), (req) =>
    new URL(req.url).pathname === "/editable.html"
      ? new Response(html, { headers: { "content-type": "text/html" } })
      : undefined,
  );
  try {
    expect(await page.run("overlayProbe()")).toMatchObject({
      color: "rgb(0, 255, 0)",
      width: 1920,
      text: "AI made this ",
    });
  } finally {
    page.close();
  }
}, 30000);

test("a local page keeps its authored layout when the video resolution changes", async () => {
  const html = readFileSync(
    join(
      import.meta.dir,
      "../../live-studio/test/fixtures/direct-edit-film/assets/public/custom-title.html",
    ),
    "utf8",
  );
  const page = await openPage(join(import.meta.dir, "gpu/page-edit.ts"), (req) =>
    new URL(req.url).pathname === "/editable.html"
      ? new Response(html, { headers: { "content-type": "text/html" } })
      : undefined,
  );
  try {
    const preview = await page.run<{ rect: number[] }>("overlayProbe(1920)");
    const draft = await page.run<{ rect: number[] }>("overlayProbe(960)");
    expect(draft.rect).toEqual(preview.rect);
  } finally {
    page.close();
  }
}, 30000);

test("human element edits survive animated shuffled frames, stay instance-local and reset to source", async () => {
  const html = `<!doctype html><style>body{margin:0}#box{width:80px;height:40px;background:red}#title{margin:0;font:16px sans-serif}</style><div id="box"></div><p id="title">Source <em>kept</em></p><script>window.film={frame(t){document.querySelector('#box').style.translate='calc(50% + '+(t>1?20:10)+'px) 0';document.querySelector('#box').style.background=t>1?'blue':'red';document.querySelector('#title').firstChild.data='Source '+t+' '}}</script>`;
  const page = await openPage(join(import.meta.dir, "gpu/page-edit.ts"), (req) =>
    new URL(req.url).pathname === "/editable.html"
      ? new Response(html, { headers: { "content-type": "text/html" } })
      : undefined,
  );
  try {
    const result = await page.run<{
      colors: number[][];
      positions: number[];
      reset: number[];
      other: number[];
      text: string;
      child: string;
      stable: boolean;
      selectors: string[];
      restored: string;
    }>("editProbe()");
    expect(result.colors).toEqual(Array(4).fill([0, 255, 0, 255]));
    expect(result.positions).toEqual([72, 62, 62, 72]);
    expect(result.reset).toEqual([0, 0, 255, 255]);
    expect(result.other).toEqual([255, 0, 0, 255]);
    expect(result.text).toBe("Human kept");
    expect(result.child).toBe("kept");
    expect(result.stable).toBe(true);
    expect(result.selectors).toContain("#title");
    expect(result.restored).toBe("Source 2 kept");
  } finally {
    page.close();
  }
}, 30000);
