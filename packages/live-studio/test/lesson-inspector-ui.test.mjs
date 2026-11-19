import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createServer } from "vite";

import { JevRunError } from "../../clip-catalog/jev.ts";
import { inspectLessons, inspectorInfo } from "../src/lesson-inspector.mjs";
import { filmPlugin } from "../src/vite_film.mjs";

let server,
  view,
  root,
  paidCalls = 0,
  judgeFailure = "",
  holdInfo = null;
const errors = [];
const studio = resolve(import.meta.dir, "..");
const entryId = `${studio.replaceAll("\\", "/")}/app/__inspect-test__.tsx`;
const file = { key: "all:camera.md", scope: "all", path: "camera.md", tag: "1", text: "# Camera" };
const browser = (width = 960, height = 720) =>
  new Bun.WebView({
    backend: { type: "chrome" },
    width,
    height,
    console: (type, ...args) => {
      if (type === "error") errors.push(args.map(String).join(" "));
    },
  });
const entry = `
import './index.css';
import { createRoot } from 'react-dom/client';
import { LessonsPanel } from '@/lessons/LessonsPanel';
import { studio } from '@/core/store';
import { lessons } from '@/lessons/lessons';
import { useInspectorSession } from '@/lessons/inspector-session';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
lessons.setState({ loaded: true, files: [${JSON.stringify(file)}], subTab: 'inspector' });
window.inspectTest = { lessons, session: useInspectorSession, studio };
studio.setState({lib:'lessons',side:'lessons'});
if(location.search.includes('shell') || location.search.includes('broken')) {
  if(location.search.includes('broken')) sessionStorage.setItem('loadTries','3');
  import('@/App').then(({App})=>createRoot(document.getElementById('root')).render(<App />)).catch(e=>document.body.dataset.error=String(e));
} else createRoot(document.getElementById('root')).render(<Toaster><TooltipProvider><main style={{display:'flex',height:'100vh',width:'100%'}}><LessonsPanel desktop /></main></TooltipProvider></Toaster>);
`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "inspector-ui-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "lessons"));
  writeFileSync(join(root, "lessons/camera.md"), file.text);
  writeFileSync(
    join(root, "src/scene.ts"),
    "export const SHOTS = [], SHOTS_OUT = [], DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => { if(location.search.includes('broken')) throw new Error('Missing fixture FBX'); return Object.assign(() => ({}), { tools: {} }); };",
  );
  writeFileSync(
    join(root, "src/edit.ts"),
    "export const EDIT = {}; export const fromSource = t => t; export const toSource = t => t;",
  );
  server = await createServer({
    configFile: join(studio, "vite.config.ts"),
    logLevel: "silent",
    optimizeDeps: { exclude: ["loudness-worklet/worklet?url"] },
    plugins: [
      filmPlugin({ SRC: join(root, "src"), threeFrom: studio }),
      {
        name: "inspector-test",
        resolveId(id) {
          return id === "/__inspect-test__.tsx" ? entryId : null;
        },
        load(id) {
          if (id.replaceAll("\\", "/").endsWith("/app/shell/boot.ts"))
            return "import {useEffect} from 'react'; export const useBoot = el => useEffect(() => { if(location.search.includes('broken')) import('../start').then(({start})=>start(el.current)).catch(e=>window.bootFailure=String(e)); },[]);";
          return id.replaceAll("\\", "/") === entryId ? entry : null;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            const path = req.url?.split("?")[0];
            const editData = {
              "/api/film.json": {
                name: "broken-scene",
                ratio: "16:9",
                has: { cam: true, text: true, keys: true, adjustment: true },
              },
              "/api/cam": { version: "cam-1", data: [{ t: 0, p: [0, 1, 5], l: [0, 1, 0] }] },
              "/api/text": { version: "text-1", data: { items: [] } },
              "/api/keys": [{ file: "src/actor.json", edit: "actor", requiredRows: [] }],
              "/api/keys/0": { version: "keys-1", data: {} },
              "/api/adjustment": { version: "layers-1", data: { items: [] } },
              "/api/notes": [],
            };
            if (path in editData) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(editData[path]));
              return;
            }
            if (path === "/api/lessons") {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ dir: join(root, "lessons"), files: [file] }));
              return;
            }
            if (path === "/api/lessons/inspect") {
              const options = {
                root,
                dir: join(root, "lessons"),
                judge: async (_words, pool) => {
                  paidCalls++;
                  if (judgeFailure) throw judgeFailure;
                  return [[1, pool[0], 0.9]];
                },
              };
              res.setHeader("content-type", "application/json");
              try {
                if (req.method === "GET") {
                  if (holdInfo) await holdInfo;
                  res.end(JSON.stringify({ ...inspectorInfo(options), notes: [] }));
                } else {
                  let body = "";
                  for await (const chunk of req) body += chunk;
                  res.end(JSON.stringify(await inspectLessons(JSON.parse(body), options)));
                }
              } catch (e) {
                const outcome = e instanceof JevRunError ? e.outcome : undefined;
                res.statusCode = outcome === "not-started" ? 424 : 400;
                res.end(JSON.stringify({ error: e.message, outcome }));
              }
              return;
            }
            if (path === "/__inspect-test__.html") {
              res.setHeader("content-type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  path,
                  '<html class="dark"><body style="margin:0"><div id="root"></div><script>window.addEventListener("error",e=>document.body.dataset.error=e.message);window.addEventListener("unhandledrejection",e=>document.body.dataset.error=String(e.reason));</script><script type="module" src="/__inspect-test__.tsx"></script></body></html>',
                ),
              );
              return;
            }
            next();
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  view = browser();
  await view.navigate(`http://127.0.0.1:${server.httpServer.address().port}/__inspect-test__.html`);
});
afterAll(async () => {
  view?.close();
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test.each([1920, 960])(
  "editing tabs stay after Audio while the scene is unavailable at %ipx",
  async (width) => {
    await view.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigateFixture("?shell");
    await waitFor("window.inspectTest && document.querySelector('[role=tablist]')");
    await view.evaluate(`(() => {
    window.inspectTest.lessons.setState({subTab:'deck'});
    window.inspectTest.studio.setState({lib:'notes',side:'notes',sound:false,text:false,cam:false,placed:false,keyFiles:[]});
  })()`);
    const label = width >= 1280 ? "Libraries" : "Panels";
    await waitFor(`document.querySelector('[aria-label="${label}"]')`);
    const tabs = await view.evaluate(`(() => {
    const list=document.querySelector('[aria-label="${label}"]');
    return [...list.querySelectorAll('[role=tab]')].map(tab=>({text:tab.textContent.trim(),disabled:tab.disabled}));
  })()`);
    const editingTabs =
      width >= 1280
        ? ["Audio", "Text", "Effects", "Objects", "Transitions", "Adjustment"]
        : ["Audio", "Text", "Effects", "Objects", "Keyframes", "Transitions", "Camera"];
    expect(tabs.filter((tab) => editingTabs.includes(tab.text))).toEqual(
      editingTabs.map((text) => ({ text, disabled: text !== "Effects" && text !== "Objects" })),
    );
  },
);

test("a missing scene asset still loads the film's editable files", async () => {
  await navigateFixture("?broken");
  await waitFor("window.bootFailure");
  expect(await view.evaluate("window.bootFailure")).toContain("Missing fixture FBX");
  await waitFor(
    "window.inspectTest.studio.getState().cam && window.inspectTest.studio.getState().text && window.inspectTest.studio.getState().keyFiles?.length === 1",
  );
  expect(await view.evaluate("window.inspectTest.studio.getState().ready")).toBe(false);
});

test("external lesson edits refresh the dry Inspector even when note and drafts stay unchanged", async () => {
  const wait = async (text) =>
    view.evaluate(`new Promise((resolve,reject) => {
    const start=Date.now(); const tick=()=>{if(document.body.textContent.includes(${JSON.stringify(text)})) return resolve(true); if(Date.now()-start>12000) return reject(new Error("Missing preview: " + ${JSON.stringify(text)})); setTimeout(tick,20);}; tick();
  })`);
  await wait("Extracted lessons");
  await view.evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Extracted lessons').click()",
  );
  await wait("lessons/camera.md: # Camera");
  writeFileSync(join(root, "lessons/camera.md"), "# External camera edit");
  await view.evaluate(
    `window.inspectTest.lessons.setState({ files: [{...${JSON.stringify(file)},text:'# External camera edit',tag:'2'}] })`,
  );
  await wait("lessons/camera.md: # External camera edit");
  expect(paidCalls).toBe(0);
  writeFileSync(join(root, "lessons/camera.md"), file.text);
  await view.evaluate(`window.inspectTest.lessons.setState({ files: [${JSON.stringify(file)}] })`);
  await wait("lessons/camera.md: # Camera");
});

test("mounted Inspector keeps previews free, runs only after opt-in, reacts to lesson drafts and disarms when leaving", async () => {
  const wait = (expression) =>
    view.evaluate(`new Promise((resolve,reject) => {
    const start=Date.now(); const tick=()=>{if(${expression}) return resolve(true); if(Date.now()-start>8000) return reject(new Error(${JSON.stringify(expression)})); setTimeout(tick,20);}; tick();
  })`);
  const click = (text) =>
    view.evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  await wait("document.getElementById('inspect-note-text')");
  await click("Note for AI");
  expect(await view.evaluate("document.getElementById('inspect-new-path')")).toBeNull();
  expect(await view.evaluate("document.body.textContent.includes('Try lesson edits')")).toBe(false);
  await view.evaluate(`(() => {
    const input = document.getElementById('inspect-note-text');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Move camera closer');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait("document.body.textContent.includes('dry simulation;')");
  expect(
    await view.evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked')"),
  ).toBe("false");
  await click("Run Jev");
  expect(paidCalls).toBe(0);
  await view.evaluate("document.querySelector('[role=switch]').click()");
  await wait(
    "![...document.querySelectorAll('button')].find(b=>b.textContent==='Run Jev').disabled",
  );
  expect(paidCalls).toBe(0);
  await click("Run Jev");
  await wait("document.body.textContent.includes('lesson: lessons/camera.md')");
  expect(paidCalls).toBe(1);
  await view.evaluate(
    "window.inspectTest.lessons.setState({ edits: { 'all:camera.md': { text: '# Handheld', base: '1' } } })",
  );
  await click("Extracted lessons");
  await wait("document.body.textContent.includes('lessons/camera.md: # Handheld')");
  const layout = await view.evaluate(`(() => {
    const controls=document.querySelector('[data-inspector-controls]');
    const output=document.querySelector('[data-inspector-output]');
    const before=output.getBoundingClientRect();
    controls.scrollTop=controls.scrollHeight;
    const after=output.getBoundingClientRect();
    return {visible:before.height>150&&before.top>=0&&before.bottom<=innerHeight,stable:before.top===after.top&&before.bottom===after.bottom};
  })()`);
  expect(layout).toEqual({ visible: true, stable: true });
  await click("Deck");
  await wait(
    "window.inspectTest.lessons.getState().subTab==='deck' && !window.inspectTest.lessons.getState().inspectorLiveEnabled",
  );
  await click("AI Inspector");
  await wait("document.querySelector('[role=switch]').getAttribute('aria-checked')==='false'");
  expect(await view.evaluate("document.getElementById('inspect-note-text').value")).toBe(
    "Move camera closer",
  );
  await view.navigate(`http://127.0.0.1:${server.httpServer.address().port}/__inspect-test__.html`);
  await wait("document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false'");
  expect(paidCalls).toBe(1);
  expect(errors).toEqual([]);
});

test("changing a note or advanced prompt highlights the related live output without a Jev call", async () => {
  const callsBefore = paidCalls;
  const wait = (expression) =>
    view.evaluate(
      `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${expression})return resolve(true);if(Date.now()-start>8000)return reject(new Error(${JSON.stringify(expression)}));setTimeout(tick,20);};tick();})`,
    );
  const fill = (id, text) =>
    view.evaluate(
      `(()=>{const input=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await wait("document.getElementById('inspect-note-text')");
  await fill("inspect-note-text", "First note");
  await wait(
    "document.querySelector('[data-inspector-result]').textContent.includes('NOTE: First note')",
  );
  await fill("inspect-note-text", "Move closer instead");
  await wait(
    "[...document.querySelectorAll('[data-changed=true]')].some(e=>e.textContent.includes('NOTE: Move closer instead'))",
  );
  expect(
    await view.evaluate(
      "document.querySelector('[data-inspector-result]').textContent.includes('NOTE: First note')",
    ),
  ).toBe(false);
  await view.evaluate(
    `(()=>{for(const text of ['Advanced settings','Prompts for Jev']){const d=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes(text));d.open=true;}})()`,
  );
  const promptId = await view.evaluate(
    "[...document.querySelectorAll('label')].find(l=>l.textContent==='Extra instructions').htmlFor",
  );
  await fill(promptId, "Prioritize camera distance");
  await wait(
    "document.querySelector('[data-inspector-output]').textContent.includes('Assembled Jev prompts')",
  );
  await wait(
    "[...document.querySelectorAll('[data-changed=true]')].some(e=>e.textContent.includes('Prioritize camera distance'))",
  );
  expect(paidCalls).toBe(callsBefore);
  expect(errors).toEqual([]);
});

test("a narrow short Inspector keeps actual output inside its visible pane", async () => {
  const result = await view.evaluate(`(async()=>{
    const main=document.querySelector('main');main.style.width='320px';main.style.height='344px';
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const pane=document.querySelector('[data-inspector-output]').getBoundingClientRect();
    const text=document.querySelector('[data-inspector-result]').getBoundingClientRect();
    const controls=document.querySelector('[data-inspector-controls]');
    return {textHeight:text.height,inside:text.bottom<=pane.bottom&&pane.bottom<=main.getBoundingClientRect().bottom,overflow:controls.scrollWidth>controls.clientWidth,debug:{pane:pane.toJSON(),text:text.toJSON(),header:document.querySelector('[data-inspector-output]').firstElementChild.getBoundingClientRect().toJSON(),main:main.getBoundingClientRect().toJSON()}};
  })()`);
  expect(result.textHeight, JSON.stringify(result.debug)).toBeGreaterThanOrEqual(24);
  expect(result.inside).toBe(true);
  expect(result.overflow).toBe(false);
});

test("an excluded real Deck file can be restored individually without changing its contents", async () => {
  const callsBefore = paidCalls;
  await view.evaluate(
    `(()=>{const main=document.querySelector('main');main.style.width='960px';main.style.height='720px';const s=[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Lesson files'));s.parentElement.open=true;})()`,
  );
  await view.evaluate("document.querySelector('[data-inspector-file] [role=checkbox]').click()");
  await view.evaluate(
    "new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(document.body.textContent.includes('Files: 0'))return resolve(true);if(Date.now()-start>4000)return reject(new Error('Exclusion did not reach preview'));setTimeout(tick,20);};tick();})",
  );
  expect(readFileSync(join(root, "lessons/camera.md"), "utf8")).toBe(file.text);
  await view.evaluate("document.querySelector('[data-inspector-file] [role=checkbox]').click()");
  await view.evaluate(
    "new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(document.body.textContent.includes('Files: 1'))return resolve(true);if(Date.now()-start>4000)return reject(new Error('Restore did not reach preview'));setTimeout(tick,20);};tick();})",
  );
  expect(paidCalls).toBe(callsBefore);
});

test("invalid matching settings explain the error at the focused field and recover in place", async () => {
  await view.evaluate(
    "new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(document.getElementById('inspect-note-text'))return resolve(true);if(document.body.dataset.error)return reject(new Error(document.body.dataset.error));if(Date.now()-start>12000)return reject(new Error('Inspector missing'));setTimeout(tick,20);};tick();})",
  );
  const result = await view.evaluate(`(async()=>{
    for(const text of ['Advanced settings','Select matching lessons'])
      [...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes(text)).open=true;
    const label=[...document.querySelectorAll('label')].find(l=>l.textContent==='Maximum results to check');
    const input=document.getElementById(label.htmlFor);
    input.scrollIntoView({block:'center'}); input.focus();
    const top=input.getBoundingClientRect().top;
    const fill=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
    fill('0'); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const description=input.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id)?.textContent).join(' ');
    const invalid=input.getAttribute('aria-invalid');
    const retryOffered=[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retry preview');
    const stayed=document.activeElement===input&&Math.abs(input.getBoundingClientRect().top-top)<2;
    fill('5'); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {invalid,description,retryOffered,stayed,recovered:input.getAttribute('aria-invalid')!=='true'};
  })()`);
  expect(result.invalid).toBe("true");
  expect(result.description).toContain("Enter 1–50 results");
  expect(result.retryOffered).toBe(false);
  expect(result.stayed).toBe(true);
  expect(result.recovered).toBe(true);
});

test("the full 960px Studio shell reserves multiline Inspector output and restores the timeline in Deck", async () => {
  await view.navigate(
    `http://127.0.0.1:${server.httpServer.address().port}/__inspect-test__.html?shell`,
  );
  await view.evaluate(
    "new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(document.querySelector('[data-inspector-result]'))return resolve(true);if(document.body.dataset.error)return reject(new Error(document.body.dataset.error));if(Date.now()-start>12000)return reject(new Error('Shell Inspector missing: '+document.body.textContent));setTimeout(tick,20);};tick();})",
  );
  const result = await view.evaluate(`(async()=>{
    const text=document.querySelector('[data-inspector-result]');
    const switcher=document.querySelector('[role=switch]');
    const off=text.getBoundingClientRect();
    switcher.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const on=text.getBoundingClientRect();
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Deck').click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {off:off.height,on:on.height,stable:off.top===on.top&&off.height===on.height,
      restored:!document.querySelector('[data-lessons-focused]')&&!!document.querySelector('[aria-label="Time ruler: click or drag to jump, Ctrl+scroll to zoom"]')?.getBoundingClientRect().height};
  })()`);
  expect(result.off).toBeGreaterThanOrEqual(180);
  expect(result.on).toBeGreaterThanOrEqual(180);
  expect(result.stable).toBe(true);
  expect(result.restored).toBe(true);
  expect(errors).toEqual([]);
});

const waitFor = (expression) =>
  view.evaluate(
    `new Promise((resolve,reject)=>{const end=Date.now()+12000;const tick=()=>{if(${expression})return resolve(true);if(Date.now()>end)return reject(new Error(${JSON.stringify(expression)}));setTimeout(tick,20);};tick();})`,
  );
const fillNote = (text) =>
  view.evaluate(
    `(()=>{const input=document.getElementById('inspect-note-text');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
const clickButton = (text) =>
  view.evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
  );
const navigateFixture = async (query = "") => {
  await view.navigate(
    `http://127.0.0.1:${server.httpServer.address().port}/__inspect-test__.html${query}`,
  );
  await waitFor("document.getElementById('inspect-note-text')");
};

test("Escape cancels an in-flight pointer-opened Inspector dialog", async () => {
  await navigateFixture();
  await waitFor("window.inspectTest.session.getState().hydrated");
  await view.cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  const point = await view.evaluate(`(async () => {
    [...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('Advanced settings')).open = true;
    const trigger = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear Inspector cache');
    trigger.scrollIntoView({block:'center'});
    window.slowDialogFade = false;
    document.addEventListener('transitionrun', event => {
      if (event.propertyName !== 'opacity' || event.target.dataset.slot !== 'dialog-content') return;
      const transition = event.target.getAnimations().find(animation => animation.transitionProperty === 'opacity');
      if (!transition) return;
      transition.playbackRate = 0.02;
      window.slowDialogFade = true;
    });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = trigger.getBoundingClientRect();
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
  })()`);
  await view.cdp("Input.dispatchMouseEvent", {
    ...point,
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await view.cdp("Input.dispatchMouseEvent", {
    ...point,
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await waitFor("window.slowDialogFade");
  await view.press("Escape");
  expect(
    await view.evaluate(`(async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        popup: Boolean(document.querySelector('[data-slot=dialog-content]')),
        backdrop: Boolean(document.querySelector('[data-slot=dialog-overlay]')),
        focus: document.activeElement.textContent.trim(),
      };
    })()`),
  ).toEqual({ popup: false, backdrop: false, focus: "Clear Inspector cache" });
});

test("an oversized preview note keeps its text and identifies the field to shorten", async () => {
  await navigateFixture();
  await fillNote("x".repeat(50_001));
  await waitFor("document.querySelector('#inspect-note-error')");
  expect(
    await view.evaluate(`(()=>{
      const input=document.getElementById('inspect-note-text');
      return {
        length:input.value.length,
        description:document.getElementById(input.getAttribute('aria-describedby'))?.textContent,
        retryOffered:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retry preview')
      };
    })()`),
  ).toEqual({
    length: 50_001,
    description: "Shorten the note to 50,000 characters or fewer.",
    retryOffered: false,
  });
  await fillNote("Shorten the opening shot");
  await waitFor(
    "document.querySelector('[data-inspector-result]').textContent.includes('NOTE: Shorten the opening shot')",
  );
});

test("resetting Inspector settings confirms before discarding a draft and leaves the CLI save intact", async () => {
  await navigateFixture();
  await waitFor("window.inspectTest.session.getState().hydrated");
  const promptField = await view.evaluate(`(()=>{
    for(const name of ['Advanced settings','Prompts for Jev'])
      [...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes(name)).open=true;
    const label=[...document.querySelectorAll('label')].find(l=>l.textContent==='Extra instructions');
    const field=document.getElementById(label.htmlFor);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Keep this unsaved direction');
    field.dispatchEvent(new Event('input',{bubbles:true}));
    return field.id;
  })()`);
  const promptValue = `document.getElementById(${JSON.stringify(promptField)}).value`;
  const savedValue = "window.inspectTest.session.getState().saved";
  const savedBefore = await view.evaluate(savedValue);
  await clickButton("Reset defaults");
  await waitFor(
    "document.querySelector('[role=dialog]')?.textContent.includes('discards unsaved edits')",
  );
  expect(await view.evaluate(promptValue)).toBe("Keep this unsaved direction");
  await clickButton("Cancel");
  await waitFor("!document.querySelector('[role=dialog]')");
  expect(await view.evaluate(promptValue)).toBe("Keep this unsaved direction");
  await clickButton("Reset defaults");
  await waitFor("document.querySelector('[role=dialog]')");
  await view.evaluate(
    "[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Reset defaults').click()",
  );
  await waitFor(`${promptValue} === ''`);
  expect(await view.evaluate(savedValue)).toBe(savedBefore);
});

test("a failed manual run stays visible until an explicit retry and a successful run remains live", async () => {
  const callsBefore = paidCalls;
  await navigateFixture();
  await waitFor(
    "!document.getElementById('inspect-note-text').disabled && window.inspectTest.session.getState().hydrated",
  );
  await fillNote("Provider retry: move the camera closer");
  await waitFor(
    "document.querySelector('[data-inspector-result]').textContent.includes('NOTE: Provider retry')",
  );
  judgeFailure = new Error("Provider unavailable. Try Run Jev again.");
  try {
    await view.evaluate("document.querySelector('[role=switch]').click()");
    await clickButton("Run Jev");
    await waitFor("document.body.textContent.includes('Provider unavailable.')");
    await waitFor(
      "document.querySelector('[data-inspector-output]').textContent.includes('Previous preview')",
    );
    expect(
      await view.evaluate("document.body.textContent.includes('The provider may still charge')"),
    ).toBe(true);
    await view.evaluate("new Promise(r=>setTimeout(r,900))");
    expect(await view.evaluate("document.body.textContent.includes('Provider unavailable.')")).toBe(
      true,
    );
    expect(
      await view.evaluate("document.querySelector('[aria-label=\"Copy preview\"]').disabled"),
    ).toBe(true);
    await view.evaluate("document.querySelector('[role=switch]').click()");
    expect(await view.evaluate("document.body.textContent")).toContain(
      "Turn on Jev calls to retry.",
    );
    await view.evaluate("document.querySelector('[role=switch]').click()");
    judgeFailure = new JevRunError(
      "Jev stopped after a reported charge of $0.0600.",
      "charge-reported",
    );
    await clickButton("Retry Jev");
    await waitFor(
      "document.querySelector('[data-inspector-controls]').textContent.includes('reported charge')",
    );
    expect(
      await view.evaluate("document.querySelector('[data-inspector-controls]').textContent"),
    ).not.toContain("The provider may still charge");
    expect(
      await view.evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Run Jev').disabled",
      ),
    ).toBe(true);
    await clickButton("Review Provider & billing");
    expect(await view.evaluate("document.activeElement.id")).toEndWith("-spendCap");
    await view.evaluate(`(() => {
      const input=document.activeElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0.07');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    judgeFailure = "";
    await waitFor(
      "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Run Jev'&&!b.disabled)",
    );
    await clickButton("Run Jev");
    await waitFor("document.body.textContent.includes('Live result')");
    await view.evaluate("new Promise(r=>setTimeout(r,900))");
    expect(await view.evaluate("document.body.textContent.includes('Live result')")).toBe(true);
    expect(paidCalls).toBe(callsBefore + 3);
  } finally {
    judgeFailure = "";
  }
});

test("an oversized lesson draft can be excluded without losing its text", async () => {
  await navigateFixture();
  await waitFor("window.inspectTest.session.getState().hydrated");
  await fillNote("Camera framing");
  await waitFor("document.body.textContent.includes('Files: 1')");
  await view.evaluate(
    "window.inspectTest.lessons.setState({edits:{'all:camera.md':{text:'x'.repeat(1000001),base:'fixture'}}})",
  );
  await waitFor("document.body.textContent.includes('Lesson draft is too long')");
  expect(
    await view.evaluate("document.querySelector('[data-inspector-controls]').textContent"),
  ).toContain("Shorten camera.md in Deck to 1,000,000 characters");
  await clickButton("Exclude this lesson");
  await waitFor("document.body.textContent.includes('Files: 0')");
  expect(
    await view.evaluate("window.inspectTest.lessons.getState().edits['all:camera.md'].text.length"),
  ).toBe(1000001);
});

test("a failed lesson list load offers recovery without claiming there are no lessons", async () => {
  await navigateFixture();
  await waitFor("window.inspectTest.session.getState().hydrated");
  await fillNote("Camera framing");
  await waitFor("document.body.textContent.includes('Files: 1')");
  await view.evaluate(
    "window.inspectTest.lessons.setState({files:[],loaded:false,loadFailed:true,inspectorLiveEnabled:true})",
  );
  await waitFor("document.body.textContent.includes('Could not load lesson files.')");
  const controls = await view.evaluate(
    "document.querySelector('[data-inspector-controls]').textContent",
  );
  expect(controls).toContain("Retry loading lesson files.");
  expect(controls).not.toContain("Add a lesson in Deck.");
  expect(controls).not.toContain("0 of 0 included");
  await clickButton("Retry loading lessons");
  await waitFor("document.body.textContent.includes('Lesson files · 1 of 1 included')");
});

test("cold settings stay locked until the genuine initial response arrives", async () => {
  let release;
  holdInfo = new Promise((resolve) => {
    release = resolve;
  });
  try {
    await navigateFixture();
    await view.evaluate(
      `(()=>{for(const text of ['Advanced settings','Prompts for Jev'])[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes(text)).open=true;})()`,
    );
    const state = await view.evaluate(
      `(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent==='Extra instructions');const input=document.getElementById(label.htmlFor);return {disabled:input.matches(':disabled'),loading:document.querySelector('[data-inspector-output]').textContent.includes('Loading')};})()`,
    );
    expect(state).toEqual({ disabled: true, loading: true });
  } finally {
    holdInfo = null;
    release();
    await waitFor("window.inspectTest.session.getState().hydrated");
  }
  await view.evaluate(
    `(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent==='Extra instructions');const input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Keep this camera instruction');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await waitFor(
    "document.querySelector('[data-inspector-result]').textContent.includes('Keep this camera instruction')",
  );
});

test.each([
  [1920, 1080, 3],
  [960, 720, 3],
  [800, 480, 2],
  [390, 844, 3],
  [320, 568, 2],
])(
  "enlarged text at %i×%i keeps multiple output lines visible",
  async (width, height, minimumLines) => {
    view.close();
    view = browser(width, height);
    await navigateFixture("?shell");
    await view.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    expect(await view.evaluate("({width:innerWidth,height:innerHeight})")).toEqual({
      width,
      height,
    });
    await waitFor("window.inspectTest.session.getState().hydrated");
    await fillNote("The face needs to read clearly");
    await waitFor(
      "document.querySelector('[data-inspector-result]').textContent.includes('NOTE: The face')",
    );
    const result = await view.evaluate(`(async()=>{
      document.documentElement.style.fontSize='32px';
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const text=document.querySelector('[data-inspector-result]'),r=text.getBoundingClientRect();
      return {height:r.height,line:parseFloat(getComputedStyle(text.querySelector('pre')).lineHeight),inside:r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    expect(result.height, JSON.stringify({ width, ...result })).toBeGreaterThanOrEqual(
      result.line * minimumLines,
    );
    expect(result.inside, JSON.stringify({ width, ...result })).toBe(true);
    expect(result.overflow).toBe(false);
    await view.evaluate("document.documentElement.style.fontSize=''");
    expect(errors).toEqual([]);
  },
);

test("a stored folded panel cannot hide the focused Inspector workspace", async () => {
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width: 960,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const previous = await view.evaluate("localStorage.getItem('studio.lessonsWidth')");
  try {
    await view.evaluate("localStorage.setItem('studio.lessonsWidth','0')");
    await navigateFixture("?shell");
    await waitFor(
      "document.querySelector('[data-inspector-output]')?.textContent.includes('Add a note to preview')",
    );
    expect(
      await view.evaluate(
        "document.querySelector('[data-inspector-result]').getBoundingClientRect().height",
      ),
    ).toBeGreaterThanOrEqual(180);
    expect(await view.evaluate("document.querySelector('[data-side-folded]')")).toBeNull();
  } finally {
    await view.evaluate(
      previous === null
        ? "localStorage.removeItem('studio.lessonsWidth')"
        : `localStorage.setItem('studio.lessonsWidth',${JSON.stringify(previous)})`,
    );
  }
});

test("settings and preview failures can be reviewed and retried independently", async () => {
  const callsBefore = paidCalls;
  await navigateFixture();
  await waitFor("window.inspectTest.session.getState().hydrated");
  await view.evaluate(`(()=>{
    const original=window.fetch;
    let releaseDry;const gate=new Promise(resolve=>{releaseDry=resolve;});
    window.saveProbe={calls:0,release:releaseDry,restore:()=>{releaseDry();window.fetch=original;}};
    window.fetch=async(url,options)=>{
      if(String(url)==='/api/lessons/inspect'&&options?.method==='PUT'){
        const failed=++window.saveProbe.calls===1;
        return new Response(JSON.stringify(failed?{error:'QA settings unavailable'}:{saved:true}),{status:failed?503:200,headers:{'content-type':'application/json'}});
      }
      if(String(url)==='/api/lessons/inspect'&&options?.method==='POST'&&window.saveProbe.rejectDry){
        window.saveProbe.rejectDry=false;
        return Response.json({error:'QA preview unavailable'},{status:503});
      }
      const response=await original(url,options);
      if(String(url)==='/api/lessons/inspect'&&options?.method==='POST')await gate;
      return response;
    };
    for(const text of ['Advanced settings','Prompts for Jev'])[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes(text)).open=true;
    const label=[...document.querySelectorAll('label')].find(l=>l.textContent==='Extra instructions');
    const input=document.getElementById(label.htmlFor);
    input.scrollIntoView({block:'center'});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Save recovery instruction');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  try {
    await waitFor(
      "[...document.querySelectorAll('button')].some(b=>b.textContent==='Save CLI settings'&&!b.disabled)",
    );
    await clickButton("Save CLI settings");
    await waitFor("document.body.textContent.includes('QA settings unavailable')");
    const named = await view.evaluate(
      "document.querySelector('[data-inspector-controls]').textContent.includes('Settings were not saved')",
    );
    await view.evaluate("window.saveProbe.release()");
    await waitFor(
      "document.querySelector('[data-inspector-result]').textContent.includes('Save recovery instruction')",
    );
    expect({
      named,
      persistent: await view.evaluate(
        "document.querySelector('[data-inspector-controls]').textContent.includes('QA settings unavailable')",
      ),
      visibleRecovery: await view.evaluate(`(()=>{
        return [...document.querySelectorAll('button')].some(button=>{
          const r=button.getBoundingClientRect();
          return button.textContent==='Retry save'&&!button.disabled&&r.top>=0&&r.bottom<=innerHeight;
        });
      })()`),
    }).toEqual({ named: true, persistent: true, visibleRecovery: true });
    const recoveryName = await view.evaluate(`(()=>{
      const button=[...document.querySelectorAll('button')].find(button=>{
        const r=button.getBoundingClientRect();
        return button.textContent==='Retry save'&&r.top>=0&&r.bottom<=innerHeight;
      });
      return button?.getAttribute('aria-label')??button?.textContent??'';
    })()`);
    expect(recoveryName).toContain("Retry save");
    expect(
      await view.evaluate("document.querySelector('[aria-label=\"Copy preview\"]').disabled"),
    ).toBe(false);
    await view.evaluate(
      "(()=>{window.inspectTest.lessons.setState({inspectorLiveEnabled:true}); window.saveProbe.rejectDry=true;})()",
    );
    await fillNote("Try a second framing note");
    await waitFor("document.body.textContent.includes('QA preview unavailable')");
    expect(
      await view.evaluate("document.getElementById('jev-mode-description').textContent"),
    ).toContain("Retry the preview to run Jev.");
    await clickButton("Review error");
    expect(await view.evaluate("document.activeElement.textContent")).toContain("Retry preview");
    await clickButton("Retry preview");
    await waitFor(
      "document.querySelector('[data-inspector-result]').textContent.includes('Try a second framing note')",
    );
    expect(
      await view.evaluate("document.body.textContent.includes('QA settings unavailable')"),
    ).toBe(true);
    await clickButton("Retry save");
    await waitFor(
      "[...document.querySelectorAll('button')].some(b=>b.textContent==='Settings up to date'&&b.disabled)",
    );
    expect(await view.evaluate("window.saveProbe.calls")).toBe(2);
    expect(
      await view.evaluate(
        "document.querySelector('[data-inspector-controls]').textContent.includes('QA settings unavailable')",
      ),
    ).toBe(false);
    expect(paidCalls).toBe(callsBefore);
  } finally {
    await view.evaluate("window.saveProbe.restore()");
  }
});

test.each([
  [1920, 1080, 16],
  [800, 480, 32],
])(
  "native keyboard focus stays visible at %i×%i with root font %ipx",
  async (width, height, fontSize) => {
    view.close();
    view = browser(width, height);
    await navigateFixture("?shell");
    await view.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    expect(await view.evaluate("({width:innerWidth,height:innerHeight})")).toEqual({
      width,
      height,
    });
    await waitFor("window.inspectTest.session.getState().hydrated");
    const focused = () =>
      view.evaluate(`(()=>{
    const element=document.activeElement,r=element.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    const label=[...document.querySelectorAll('label')].find(label=>label.htmlFor===element.id);
    return {target:label?.textContent.trim()||element.textContent.trim(),visible:!!hit&&element.contains(hit),rect:r.toJSON(),hit:hit?.textContent.slice(0,80)};
  })()`);
    try {
      await view.evaluate(`(async()=>{
      document.documentElement.style.fontSize='${fontSize}px';
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      document.getElementById('inspect-note-text').focus();
    })()`);
      await view.press("Tab");
      await view.press("Tab");
      let state = await focused();
      expect(state.target).toBe("Edit in Deck");
      expect(state.visible, JSON.stringify(state)).toBe(true);
      await view.press("Tab");
      state = await focused();
      expect(state.target).toBe("Lesson scope");
      expect(state.visible, JSON.stringify(state)).toBe(true);
      await view.evaluate(`(()=>{
      for(const text of ['Advanced settings','Read lesson files'])
        [...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes(text)).open=true;
      const label=[...document.querySelectorAll('label')].find(label=>label.textContent==='Every-film input label');
      document.getElementById(label.htmlFor).focus();
    })()`);
      await view.press("Tab", { modifiers: ["Shift"] });
      state = await focused();
      expect(state.target).toBe("This-film input label");
      expect(state.visible, JSON.stringify(state)).toBe(true);
    } finally {
      await view.evaluate("document.documentElement.style.fontSize=''");
    }
  },
);

test("the Inspector includes only files from the chosen lesson scope", async () => {
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigateFixture("");
  await waitFor("document.querySelector('#inspect-scope:enabled')");
  await fillNote("Camera framing");
  await view.evaluate("document.querySelector('#inspect-scope').focus()");
  await view.press("Enter");
  await view.press("ArrowDown");
  await view.press("Enter");
  await view.evaluate(`(() => {
    [...document.querySelectorAll("summary")].find(s => s.textContent.includes("Lesson files")).parentElement.open = true;
  })()`);
  await waitFor("document.body.textContent.includes('Files: 0')");
  expect(await view.evaluate("document.querySelectorAll('[data-inspector-file]').length")).toBe(0);
  expect(
    await view.evaluate(
      `[...document.querySelectorAll("summary")].find(s => s.textContent.includes("Lesson files")).textContent`,
    ),
  ).toContain("0 of 0");
});

test("the Lessons splitter keeps its width across Deck, Reader and Inspector and leaves Notes independent", async () => {
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await view.evaluate("localStorage.removeItem('studio.lessonsWidth')");
  await navigateFixture("?shell");
  const sizes = await view.evaluate(`(async () => {
    const { lessons, studio } = window.inspectTest;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const splitter = () => document.querySelector('[aria-label="Library width"]');
    const width = () => Number(splitter().getAttribute("aria-valuenow"));
    lessons.setState({ subTab: "deck", folder: [], open: null });
    await frame();
    const deck = width();
    document.querySelector('[data-lesson-row="file:all:camera.md"]').click();
    await frame();
    const reader = width();
    document.querySelector("[data-lesson-back]").click();
    await frame();
    const handle = splitter();
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await frame();
    const custom = width();
    document.querySelector('[data-lesson-row="file:all:camera.md"]').click();
    await frame();
    const customReader = width();
    lessons.setState({ subTab: "inspector" });
    await frame();
    const inspector = width();
    studio.setState({ lib: "notes" });
    await frame();
    return { deck, reader, custom, customReader, inspector, notes: width() };
  })()`);
  expect(sizes.reader).toBe(sizes.deck);
  expect(sizes.custom).toBeLessThan(sizes.deck);
  expect(sizes.customReader).toBe(sizes.custom);
  expect(sizes.inspector).toBe(sizes.custom);
  expect(sizes.notes).not.toBe(sizes.custom);
  await view.evaluate("localStorage.removeItem('studio.lessonsWidth')");
});

test("a reader remains usable at 200% desktop magnification", async () => {
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width: 960,
    height: 540,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await navigateFixture("?shell");
  await waitFor("window.inspectTest && document.querySelector('[data-inspector-output]')");
  await view.evaluate(`(() => {
    const { lessons, studio } = window.inspectTest;
    studio.setState({ side: "lessons" });
    lessons.setState({ subTab: "deck", open: "all:camera.md" });
  })()`);
  await waitFor("document.querySelector('[data-lessons-focused] [data-lesson-content]')");
  const visible = await view.evaluate(`(() => {
    const sheet = document.querySelector("[data-lesson-content]");
    const edit = [...sheet.querySelectorAll("[role=radio]")].find(button => button.textContent.trim() === "Edit");
    const { x, y, width, height } = edit.getBoundingClientRect();
    return edit.contains(document.elementFromPoint(x + width / 2, y + height / 2));
  })()`);
  expect(visible).toBe(true);
});
