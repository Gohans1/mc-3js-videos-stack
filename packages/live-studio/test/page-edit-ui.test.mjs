import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createApi } from "../src/api.mjs";
import { openFilm } from "../src/film.mjs";
import { buildPage } from "../src/page.mjs";

let dir, film, page, server, view;
const input = (name) => `document.querySelector('input[aria-label=${JSON.stringify(name)}]')`;
const button = (text) =>
  `[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)}||n.querySelector('span')?.textContent===${JSON.stringify(text)})`;
const iframe = "document.querySelector('iframe').contentDocument";
const until = async (expr) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await view.evaluate(`Boolean(${expr})`)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out: ${expr}\n${await view.evaluate("document.body.innerText.slice(-1600)")}`);
};
const fill = (name, value) =>
  until(
    `(()=>{const el=${input(name)};if(!el)return false;el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();return true})()`,
  );
const click = async (x, y, button = "right") => {
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    clickCount: 1,
  });
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount: 1,
  });
};
const drag = async (from, to) => {
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from[0],
    y: from[1],
    button: "left",
    clickCount: 1,
  });
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: to[0],
    y: to[1],
    buttons: 1,
  });
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to[0],
    y: to[1],
    button: "left",
    clickCount: 1,
  });
};
const center = (id) =>
  view.evaluate(
    `(()=>{const frame=document.querySelector('iframe'),r=frame.contentDocument.getElementById(${JSON.stringify(id)}).getBoundingClientRect(),s=document.querySelector('canvas').getBoundingClientRect();return [s.x+(r.x+r.width/2)/frame.clientWidth*s.width,s.y+(r.y+r.height/2)/frame.clientHeight*s.height]})()`,
  );
const pick = async (id) => {
  await click(...(await center(id)));
  await until(`${button("Back to layer")}`);
};
const clickWhenReady = (target) => until(`(()=>{const target=${target};if(!target)return false;target.click();return true})()`);
const effectsTab = "[...document.querySelectorAll('[role=tab]')].find(n=>n.textContent==='Effects')";
const editFront = async () => {
  await pick("front");
  await until(`${input("Text")}?.value === 'Front'`);
};
const overrides = async () =>
  (await (await fetch(new URL("/api/openfilm", server.url))).json()).data.items[0].elements ?? [];
const saved = async (matches, read = overrides) => {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (matches(await read())) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Element edits did not reach the saved timeline");
};

beforeAll(async () => {
  const cache = resolve(import.meta.dir, "../node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  dir = mkdtempSync(join(cache, "page-edit-ui-"));
  cpSync(join(import.meta.dir, "fixtures/direct-edit-film"), dir, {
    recursive: true,
    filter: (file) => !/[\\/](renders|notes|node_modules)([\\/]|$)/.test(file),
  });
  writeFileSync(
    join(dir, "assets/public/custom-title.html"),
    `<!doctype html><style>body{margin:0}#front,#back{position:absolute;left:200px;top:200px;width:400px;height:120px;font:50px Arial}#front{z-index:10;background:lime}#back{z-index:1;background:red}#parent{position:absolute;left:1100px;top:200px;transform:rotate(25deg) scale(1.5);transform-origin:top left}#move{width:200px;height:120px;background:cyan;font:50px Arial;translate:180px 0}</style><div id="front">Front</div><div id="back">Back</div><div id="parent"><div id="move">Move me</div></div><script>window.film={frame(){}}</script>`,
  );
  film = openFilm(dir, { send() {} });
  page = await buildPage(film);
  if (page.error()) throw new Error(page.error());
  const app = createApi(film, { page, events: new Set(), send() {} });
  server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/_openfilm/catalog"
        ? Response.json([
            {
              id: "fixture-card",
              title: "Another card",
              cat: "effect",
              group: "Test",
              render: "page",
              url: "/custom-title.html",
              w: 1920,
              h: 1080,
            },
          ])
        : app.fetch(req),
  });
  view = new Bun.WebView({
    backend: { type: "chrome", argv: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  });
  await view.navigate("about:blank");
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
}, 30000);

beforeEach(async () => {
  const current = film.openfilm.read();
  film.openfilm.write(current.version, {
    items: [{ id: "own-page", asset: "/custom-title.html", from: 0, to: 6 }],
  });
  await view.navigate(server.url.href);
  await until("document.querySelector('iframe')?.contentDocument?.getElementById('front')");
  await clickWhenReady(effectsTab);
  await until(button("Another card"));
  await until(
    "document.querySelector('[aria-label=\"Overlay layers: click to edit, drag to move, drag either edge to trim\"]')?.width > 300",
  );
  await until(
    "(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2'),p=new Uint8Array(4);if(!g)return false;g.readPixels(c.width*400/1920,c.height*(1-260/1080),1,1,g.RGBA,g.UNSIGNED_BYTE,p);return p[1]>200&&p[0]<20})()",
  );
}, 60000);

afterAll(async () => {
  view?.close();
  server?.stop(true);
  await page?.close();
  film?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("picture picking follows the painted stacking order", async () => {
  await pick("front");
  await until(input("Text"));
  expect(await view.evaluate(`${input("Text")}.value`)).toBe("Front");
}, 20000);

test("dragging through scaled and rotated parents follows the pointer and is one undo step", async () => {
  const start = await center("move");
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start[0],
    y: start[1],
    button: "left",
    clickCount: 1,
  });
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start[0] + 35,
    y: start[1] + 20,
    buttons: 1,
  });
  await view.cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: start[0] + 35,
    y: start[1] + 20,
    button: "left",
    clickCount: 1,
  });
  await until(`${iframe}.getElementById('move').style.translate !== ''`);
  const moved = await center("move");
  expect(moved[0] - start[0]).toBeCloseTo(35, 0);
  expect(moved[1] - start[1]).toBeCloseTo(20, 0);
  await view.click('[aria-label="Undo"]');
  await until(`${iframe}.getElementById('move').style.translate === ''`);
  expect(await center("move")).toEqual(start);
}, 20000);

test("empty text keeps its editor and accepts a replacement", async () => {
  await editFront();
  await fill("Text", "");
  await until(`${iframe}.getElementById('front').textContent === ''`);
  await view.evaluate("new Promise(r=>setTimeout(r,200))");
  expect(await view.evaluate(`Boolean(${input("Text")})`)).toBe(true);
  await fill("Text", "Replacement");
  await until(`${iframe}.getElementById('front').textContent === 'Replacement'`);
  await saved((items) => items.some((it) => it.selector === "#front" && it.text === "Replacement"));
}, 20000);

test("numeric-looking text stays a string editor", async () => {
  await editFront();
  await fill("Text", "42");
  await until(`${iframe}.getElementById('front').textContent === '42'`);
  await view.evaluate("new Promise(r=>setTimeout(r,200))");
  await fill("Text", "Words");
  await until(`${iframe}.getElementById('front').textContent === 'Words'`);
  await saved((items) => items.some((it) => it.selector === "#front" && it.text === "Words"));
}, 20000);

test("a hidden override remains selectable after reload and can reset to source", async () => {
  await editFront();
  await fill("opacity", "0");
  await until(`getComputedStyle(${iframe}.getElementById('front')).opacity === '0'`);
  await view.evaluate("new Promise(r=>setTimeout(r,200))");
  expect(await view.evaluate(`Boolean(${button("Reset element to source")})`)).toBe(true);
  await until(`document.querySelector('[aria-label="Undo"]:not([disabled])')`);
  await saved((items) => items.some((it) => it.selector === "#front" && it.style.opacity === "0"));
  await view.navigate(server.url.href);
  await until("document.querySelector('iframe')?.contentDocument?.getElementById('front')");
  await clickWhenReady(effectsTab);
  await until(
    "document.querySelector('[aria-label=\"Overlay layers: click to edit, drag to move, drag either edge to trim\"]')?.width > 300",
  );
  await view.click(
    '[aria-label="Overlay layers: click to edit, drag to move, drag either edge to trim"]',
  );
  await clickWhenReady(button("front"));
  await clickWhenReady(button("Reset element to source"));
  await until(`getComputedStyle(${iframe}.getElementById('front')).opacity === '1'`);
  await saved((items) => !items.some((it) => it.selector === "#front"));
}, 45000);

test("choosing a catalog recipe after a page element opens its placement form", async () => {
  await pick("front");
  await view.evaluate(`${button("Another card")}.click()`);
  await until(button("Use in film"));
  expect(await view.evaluate(`Boolean(${button("Use in film")})`)).toBe(true);
}, 20000);

test("native text custom fields exclude the built-in title controls", async () => {
  const stage = await view.evaluate(
    "document.querySelector('canvas').getBoundingClientRect().toJSON()",
  );
  await click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.8);
  await until(input("Position X"));
  expect(await view.evaluate(`Boolean(${button("Custom fields")})`)).toBe(false);
}, 20000);

test("native text handles and inline typing each undo as one edit; Escape discards typing", async () => {
  const stage = await view.evaluate(
    "document.querySelector('canvas').getBoundingClientRect().toJSON()",
  );
  const anchor = [stage.x + stage.width * 0.5, stage.y + stage.height * 0.8];
  await click(...anchor);
  await until("document.querySelector('svg[data-text-index] circle[cx]')");
  await until(input("Scale"));
  await until(input("Rotate"));
  const initialScale = await view.evaluate(`Number(${input("Scale")}.value)`);
  const initialRotation = await view.evaluate(`Number(${input("Rotate")}.value)`);
  const handle = (index) =>
    view.evaluate(
      `(()=>{const r=document.querySelectorAll('svg[data-text-index] circle')[${index}].getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
    );
  const corner = await handle(0);
  await drag(
    corner,
    corner.map((value, i) => anchor[i] + (value - anchor[i]) * 0.75),
  );
  await until(`Math.abs(Number(${input("Scale")}.value)-${initialScale * 0.75}) < 0.5`);
  await view.click('[aria-label="Undo"]');
  await until(`Number(${input("Scale")}.value) === ${initialScale}`);
  const turn = await handle(4),
    dx = turn[0] - anchor[0],
    dy = turn[1] - anchor[1],
    angle = (20 * Math.PI) / 180;
  await drag(turn, [
    anchor[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    anchor[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
  ]);
  await until(`Number(${input("Rotate")}.value) === ${initialRotation + 20}`);
  await view.click('[aria-label="Undo"]');
  await until(`Number(${input("Rotate")}.value) === ${initialRotation}`);
  const words = "document.querySelector('textarea[aria-label=\"Text\"]')";
  const original = await view.evaluate(`${words}.value`);
  const open = async () => {
    await view.cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: anchor[0],
      y: anchor[1],
      button: "left",
      modifiers: 2,
      clickCount: 2,
    });
    await view.cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: anchor[0],
      y: anchor[1],
      button: "left",
      modifiers: 2,
      clickCount: 2,
    });
    await until("document.querySelector('textarea[aria-label=\"Edit text on picture\"]')");
    await view.evaluate(
      "(()=>{const el=document.querySelector('textarea[aria-label=\"Edit text on picture\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Typed on picture');el.dispatchEvent(new Event('input',{bubbles:true}))})()",
    );
  };
  await open();
  await view.press("Escape");
  expect(await view.evaluate(`${words}.value`)).toBe(original);
  await open();
  await view.press("Enter");
  await until(`${words}.value === 'Typed on picture'`);
  await view.click('[aria-label="Undo"]');
  await until(`${words}.value === ${JSON.stringify(original)}`);
}, 30000);

test("custom text fields require one owner and preserve differently shaped neighbours", async () => {
  const endpoint = new URL("/api/text", server.url);
  const current = await (await fetch(endpoint)).json();
  const original = current.data.items[0];
  const changed = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base: current.version,
      data: {
        ...current.data,
        items: [
          { ...original, from: 0, to: 3, custom: { strength: 1 } },
          { ...original, from: 3, to: 6, text: "Second" },
        ],
      },
    }),
  });
  expect(changed.status).toBe(200);
  await view.navigate(server.url.href);
  await until("document.querySelector('iframe')?.contentDocument?.getElementById('front')");
  await clickWhenReady("document.querySelector('[aria-label=\"Select Text 1\"]')");
  await until(input("Scale"));
  if (await view.evaluate(`Boolean(${button("Custom fields")})`)) {
    await view.evaluate(`${button("Custom fields")}.click()`);
    await until(`${button("Custom fields")}.getAttribute('aria-expanded') === 'true'`);
  }
  expect(await view.evaluate(`Boolean(${input("strength")})`)).toBe(false);
  const track = await view.evaluate(
    "document.querySelector('canvas[aria-label^=\"Text tracks:\"]').getBoundingClientRect().toJSON()",
  );
  await click(track.x + track.width * 0.25, track.y + track.height / 2, "left");
  await until(button("Custom fields"));
  if (await view.evaluate(`${button("Custom fields")}.getAttribute('aria-expanded') !== 'true'`))
    await view.evaluate(`${button("Custom fields")}.click()`);
  await fill("strength", "2");
  await saved(
    (items) => items[0].custom.strength === 2 && !("custom" in items[1]),
    async () => (await (await fetch(endpoint)).json()).data.items,
  );
}, 30000);

test("page edits and undo refresh the visible Final quality canvas at the same playhead", async () => {
  await editFront();
  await view.press("g");
  await until("document.querySelectorAll('canvas')[1]?.hidden === false");
  await until("document.querySelectorAll('iframe').length >= 2");
  await view.evaluate("window.__finalBefore=document.querySelectorAll('canvas')[1].toDataURL()");
  await fill("Text", "Final changed");
  await saved((items) =>
    items.some((it) => it.selector === "#front" && it.text === "Final changed"),
  );
  await until("document.querySelectorAll('canvas')[1].toDataURL() !== window.__finalBefore");
  expect(
    await view.evaluate(
      "[...document.querySelectorAll('iframe')].at(-1).contentDocument.getElementById('front').textContent",
    ),
  ).toBe("Final changed");
  await view.click('[aria-label="Undo"]');
  await until(
    "[...document.querySelectorAll('iframe')].at(-1).contentDocument.getElementById('front').textContent === 'Front'",
  );
  await until("document.querySelectorAll('canvas')[1].toDataURL() === window.__finalBefore");
  await saved((items) => items.length === 0);
}, 45000);
