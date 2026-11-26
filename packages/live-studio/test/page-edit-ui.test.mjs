import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createApi } from "../src/api.mjs";
import { openFilm } from "../src/film.mjs";
import { buildPage } from "../src/page.mjs";

let dir, film, page, server, view;
let favoritesFailure = 0;
let favoritesRequests = 0;
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
  throw new Error(
    `Timed out: ${expr}\n${await view.evaluate("document.body.innerText.slice(-1600)")}`,
  );
};
const fill = async (name, value) => {
  await until(`(() => {
    const el = ${input(name)};
    if (!el) return false;
    el.focus();
    el.select();
    return document.activeElement === el;
  })()`);
  if (value) await view.type(value);
  else await view.press("Backspace");
  await view.press("Enter");
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
const geometry = (id) =>
  view.evaluate(
    `(() => {
      const frame = document.querySelector('iframe');
      const r = frame.contentDocument.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      const center = [r.x + r.width / 2, r.y + r.height / 2];
      const scale = [canvas.width / frame.clientWidth, canvas.height / frame.clientHeight];
      return { center, scale, pointer: [canvas.x + center[0] * scale[0], canvas.y + center[1] * scale[1]] };
    })()`,
  );
const pick = async (id) => {
  await view.click(...(await geometry(id)).pointer);
  await until(`${button("Back to layer")}`);
};
const clickWhenReady = (target) =>
  until(`(()=>{const target=${target};if(!target)return false;target.click();return true})()`);
const effectsTab =
  "[...document.querySelectorAll('[role=tab]')].find(n=>n.textContent==='Effects')";
const editFront = async () => {
  await pick("front");
  await until(`${input("Text")}?.value === 'Front'`);
};
const overrides = async () =>
  (await (await fetch(new URL("/api/openfilm", server.url))).json()).data.items[0].elements ?? [];
const confirmSaved = async (matches, read = overrides) => {
  await view.click('[aria-label="Confirm pending changes"]', { timeout: 4000 });
  await until(`!document.querySelector('[aria-label="Unconfirmed Studio changes"]:not([inert])')`);
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
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/api/favorites") {
        favoritesRequests++;
        if (favoritesFailure) return new Response(null, { status: favoritesFailure });
      }
      return path === "/_openfilm/catalog"
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
        : app.fetch(req);
    },
  });
}, 30000);

beforeEach(async () => {
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
  const current = film.openfilm.read();
  film.openfilm.write(current.version, {
    items: [{ id: "own-page", asset: "/custom-title.html", from: 0, to: 6 }],
  });
  await view.navigate(server.url.href);
  await until("window.__readyAt");
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

afterEach(() => {
  view?.close();
});

afterAll(async () => {
  server?.stop(true);
  await page?.close();
  film?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("picture picking follows the painted stacking order", async () => {
  await editFront();
}, 20000);

const startupPaths = async () => {
  await view.navigate(server.url.href);
  await until("window.__readyAt");
  return view.evaluate(
    "performance.getEntriesByType('resource').map(({name})=>new URL(name).pathname)",
  );
};

test("loading the Studio reads the overlay timeline once", async () => {
  expect((await startupPaths()).filter((path) => path === "/api/openfilm")).toHaveLength(1);
});

test("opening Compare loads its catalog on demand", async () => {
  expect(await startupPaths()).not.toContain("/api/compare-videos");
  await view.click('button[aria-label="Compare video"]');
  await until(
    "performance.getEntriesByType('resource').some(({name})=>new URL(name).pathname==='/api/compare-videos')",
  );
});

test("holding Space pauses once even when the keyboard repeats", async () => {
  await view.click('button[aria-label="Play"]');
  await until("document.querySelector('button[aria-label=\"Pause\"]')");
  await view.evaluate("document.activeElement.blur()");
  const space = (type, autoRepeat = false) =>
    view.cdp("Input.dispatchKeyEvent", {
      type,
      code: "Space",
      key: " ",
      windowsVirtualKeyCode: 32,
      autoRepeat,
    });
  await space("rawKeyDown");
  await until("document.querySelector('button[aria-label=\"Play\"]')");
  await space("rawKeyDown", true);
  await space("keyUp");
  expect(
    await view.evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve(Boolean(document.querySelector('button[aria-label="Play"]')))
      )))`,
    ),
  ).toBe(true);
});

test("Pause updates the controls before restoring the full-resolution picture", async () => {
  const fullWidth = await view.evaluate("document.querySelector('canvas').width");
  await view.click('button[aria-label="Play"]');
  await until(`document.querySelector('canvas').width < ${fullWidth}`);
  await view.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const playingWidth = canvas.width;
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
    let painted = false;
    addEventListener('click', () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        painted = Boolean(document.querySelector('button[aria-label="Play"]'));
      }));
    }, { capture: true, once: true });
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get() { return width.get.call(this); },
      set(value) {
        if (value > playingWidth) {
          window.__pausePicture = { painted, width: value };
          delete canvas.width;
        }
        width.set.call(this, value);
      },
    });
  })()`);
  await view.click('button[aria-label="Pause"]');
  await until("window.__pausePicture");
  expect(await view.evaluate("window.__pausePicture")).toEqual({ painted: true, width: fullWidth });
});

test("an unavailable optional document leaves the first picture usable", async () => {
  favoritesFailure = 403;
  try {
    await view.navigate(server.url.href);
    await until(
      "window.__live && document.querySelector('button[aria-label=Play]')?.disabled === false",
    );
    expect(
      await view.evaluate("document.querySelector('[role=alert] pre')?.textContent ?? null"),
    ).toBeNull();
    await until("window.__readyAt");
  } finally {
    favoritesFailure = 0;
  }
}, 30000);

test("a note link opens while an optional document retries after the first usable picture", async () => {
  film.notes.add({ note: { id: "startup-link", t: 1, text: "Review the opening" } }, {});
  favoritesFailure = 503;
  favoritesRequests = 0;
  try {
    await view.navigate(new URL("?startup-link=1#note=startup-link", server.url).href);
    await until("window.__live && !document.querySelector('button[aria-label=Play]')?.disabled");
    await until(`document.querySelector('[aria-label="Review notes"] [data-note="startup-link"]')`);
    const boot = await view.evaluate("performance.timeOrigin");
    expect(await view.evaluate("Boolean(window.__readyAt)")).toBe(false);
    const deadline = Date.now() + 10_000;
    while (favoritesRequests < 3 && Date.now() < deadline) await Bun.sleep(25);
    expect(favoritesRequests).toBeGreaterThanOrEqual(3);
    favoritesFailure = 0;
    await until("window.__readyAt");
    expect(favoritesRequests).toBeGreaterThanOrEqual(4);
    expect(await view.evaluate("performance.timeOrigin")).toBe(boot);
  } finally {
    favoritesFailure = 0;
  }
}, 30000);

test("dragging through scaled and rotated parents follows the pointer and is one undo step", async () => {
  const start = await geometry("move");
  await drag(start.pointer, [start.pointer[0] + 35, start.pointer[1] + 20]);
  await until(`${iframe}.getElementById('move').style.translate !== ''`);
  const moved = await geometry("move");
  expect((moved.center[0] - start.center[0]) * start.scale[0]).toBeCloseTo(35, 0);
  expect((moved.center[1] - start.center[1]) * start.scale[1]).toBeCloseTo(20, 0);
  await view.click('[aria-label="Undo"]');
  await until(`${iframe}.getElementById('move').style.translate === ''`);
  expect((await geometry("move")).center).toEqual(start.center);
}, 20000);

test("empty text keeps its editor and accepts a replacement", async () => {
  await editFront();
  await fill("Text", "");
  await until(`${iframe}.getElementById('front').textContent === ''`);
  await confirmSaved((items) => items.some((it) => it.selector === "#front" && it.text === ""));
  expect(await view.evaluate(`Boolean(${input("Text")})`)).toBe(true);
  await fill("Text", "Replacement");
  await until(`${iframe}.getElementById('front').textContent === 'Replacement'`);
  await confirmSaved((items) =>
    items.some((it) => it.selector === "#front" && it.text === "Replacement"),
  );
}, 20000);

test("numeric-looking text stays a string editor", async () => {
  await editFront();
  await fill("Text", "42");
  await until(`${iframe}.getElementById('front').textContent === '42'`);
  await confirmSaved((items) => items.some((it) => it.selector === "#front" && it.text === "42"));
  await fill("Text", "Words");
  await until(`${iframe}.getElementById('front').textContent === 'Words'`);
  await confirmSaved((items) =>
    items.some((it) => it.selector === "#front" && it.text === "Words"),
  );
}, 20000);

test("a hidden override remains selectable after reload and can reset to source", async () => {
  const library = '[aria-label="Effects library from OpenFilm"]';
  const libraryButton = (name) =>
    `[...document.querySelectorAll(${JSON.stringify(`${library} button`)})].find(b => b.textContent.trim() === ${JSON.stringify(name)})`;
  const opacityDown = `${library} button[aria-label="opacity down"]`;
  const opacity = `document.querySelector(${JSON.stringify(`${library} input[aria-label="opacity"]`)})`;
  const reset = libraryButton("Reset element to source");
  await editFront();
  for (let tenth = 9; tenth >= 0; tenth--) {
    await view.scrollTo(opacityDown);
    await view.click(opacityDown);
    await until(`Number(${opacity}?.value) === ${tenth / 10}`);
  }
  await until(`getComputedStyle(${iframe}.getElementById('front')).opacity === '0'`);
  await until(`(${reset})?.disabled === false`);
  await until(`document.querySelector('[aria-label="Undo"]:not([disabled])')`);
  await confirmSaved((items) =>
    items.some((it) => it.selector === "#front" && it.style.opacity === "0"),
  );
  await view.navigate(server.url.href);
  await until("window.__readyAt");
  await until("document.querySelector('iframe')?.contentDocument?.getElementById('front')");
  await clickWhenReady(effectsTab);
  await until(
    "document.querySelector('[aria-label=\"Overlay layers: click to edit, drag to move, drag either edge to trim\"]')?.width > 300",
  );
  await view.click(
    '[aria-label="Overlay layers: click to edit, drag to move, drag either edge to trim"]',
  );
  await clickWhenReady(libraryButton("front"));
  await clickWhenReady(reset);
  await until(`getComputedStyle(${iframe}.getElementById('front')).opacity === '1'`);
  await confirmSaved((items) => !items.some((it) => it.selector === "#front"));
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
  await view.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.8);
  await until(input("Position X"));
  expect(await view.evaluate(`Boolean(${button("Custom fields")})`)).toBe(false);
}, 20000);

test("native text handles and inline typing each undo as one edit; Escape discards typing", async () => {
  const textAnchor = () =>
    view.evaluate(`(() => {
      const stage = document.querySelector('canvas').getBoundingClientRect();
      return [stage.x + stage.width * 0.5, stage.y + stage.height * 0.8];
    })()`);
  const anchor = await textAnchor();
  await view.click(...anchor);
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
  await until(`!document.querySelector('[aria-label="Unconfirmed Studio changes"]')`);
  const pivot = await textAnchor();
  const turn = await handle(4),
    dx = turn[0] - pivot[0],
    dy = turn[1] - pivot[1],
    angle = (20 * Math.PI) / 180;
  await drag(turn, [
    pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
  ]);
  await until(`Math.abs(Number(${input("Rotate")}.value) - ${initialRotation + 20}) < 0.5`);
  await view.click('[aria-label="Undo"]');
  await until(`Number(${input("Rotate")}.value) === ${initialRotation}`);
  const words = "document.querySelector('textarea[aria-label=\"Text\"]')";
  const original = await view.evaluate(`${words}.value`);
  const open = async () => {
    const [x, y] = await textAnchor();
    await view.cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      modifiers: 2,
      clickCount: 2,
    });
    await view.cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
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
  await view.click(track.x + track.width * 0.25, track.y + track.height / 2);
  await until(button("Custom fields"));
  if (await view.evaluate(`${button("Custom fields")}.getAttribute('aria-expanded') !== 'true'`))
    await view.evaluate(`${button("Custom fields")}.click()`);
  await fill("strength", "2");
  await confirmSaved(
    (items) => items[0].custom.strength === 2 && !("custom" in items[1]),
    async () => (await (await fetch(endpoint)).json()).data.items,
  );
}, 30000);

test("page edits and undo refresh the visible Final quality canvas at the same playhead", async () => {
  await editFront();
  await view.press("g", { modifiers: ["Shift"] });
  await until("document.querySelectorAll('canvas')[1]?.hidden === false");
  await until("document.querySelectorAll('iframe').length >= 2");
  await view.evaluate("window.__finalBefore=document.querySelectorAll('canvas')[1].toDataURL()");
  await fill("Text", "Final changed");
  await confirmSaved((items) =>
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
  await confirmSaved((items) => items.length === 0);
}, 45000);
