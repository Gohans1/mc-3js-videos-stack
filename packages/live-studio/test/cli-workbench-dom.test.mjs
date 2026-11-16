import { afterAll, beforeAll, beforeEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer as createViteServer } from "vite";

import { CLI_CATEGORIES, CLI_COMMANDS } from "../src/cli-catalog.ts";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = join(import.meta.dirname, "..");
const TEMP_ROOT = realpathSync(tmpdir());
const HARNESS = `
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import '/index.css';
import {TooltipProvider} from '/components/ui/tooltip.tsx';
import {Toaster} from '/components/ui/toast.tsx';
import {CliPanel} from '/cli/CliPanel.tsx';
import {cliStore,openCommandWorkbench,ensureCliLoaded} from '/cli/cli-store.ts';
const root=createRoot(document.getElementById('root'));
let generation=0;
const render=()=>root.render(
  <TooltipProvider><div id="cli-test-panel" style={{height:570,width:360}} className="bg-background text-foreground flex flex-col overflow-hidden"><CliPanel key={generation}/></div><Toaster/></TooltipProvider>
);
window.__CLI_TEST__={open:openCommandWorkbench,ready:()=>!!cliStore.getState().catalog,remount:()=>{generation++;render()},seedRun:async run=>{await ensureCliLoaded();cliStore.setState({lastRun:run})}};
render();
`;
const moreButton = `[...document.querySelectorAll('button')].find(n=>n.textContent.startsWith('More options'))`;
const field = (name) =>
  `[...document.querySelectorAll('input')].find(n=>[...(n.labels??[])].some(l=>l.textContent.startsWith(${JSON.stringify(name)})))`;
const completedHelpRun = {
  runId: "fixture-completed-help",
  commandId: "help",
  subcommandPath: [],
  mode: "execute",
  displayCommand: "bun run help",
  cwd: "fixture",
  targetFilm: "fixture",
  status: "done",
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1,
  exitCode: 0,
  truncated: false,
  output: [{ seq: 0, stream: "stdout", chunk: "fixture output\n" }],
};

describe("CLI workbench keyboard and validation in Chrome", () => {
  let tempDir, vite, server, webview, baseUrl;
  let runRequests = 0;
  let postedRequests = [];

  const waitUntil = async (expression, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await webview.evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const fill = async (name, value) => {
    await waitUntil(field(name), name);
    await webview.evaluate(
      `(()=>{const n=${field(name)};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(TEMP_ROOT, "cli-workbench-dom-"));
    const src = join(tempDir, "src");
    mkdirSync(src);
    writeFileSync(
      join(src, "scene.ts"),
      "export const SHOTS=[],SHOTS_OUT=[],DURATION=10;export const applyEdit=()=>{};export const buildScene=async()=>Object.assign(()=>({}),{tools:{}});",
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT={};export const fromSource=t=>t;export const toSource=t=>t;",
    );
    const harnessPath = join(STUDIO_DIR, "app", "__cli_test_virtual__.tsx").replaceAll("\\", "/");
    vite = await createViteServer({
      configFile: false,
      logLevel: "silent",
      root: join(STUDIO_DIR, "app"),
      cacheDir: join(tempDir, ".vite"),
      optimizeDeps: { exclude: ["loudness-worklet"] },
      plugins: [
        {
          name: "cli-test-harness",
          enforce: "pre",
          resolveId(id) {
            if (id === "/cli-test.tsx") return harnessPath;
            if (id.startsWith("loudness-worklet/worklet")) return "\0cli-worklet-stub";
          },
          load(id) {
            if (id.replaceAll("\\", "/") === harnessPath) return HARNESS;
            if (id === "\0cli-worklet-stub") return 'export default "/unused-worklet.js"';
          },
        },
        react(),
        tailwindcss(),
        filmPlugin({ SRC: src, threeFrom: STUDIO_DIR }),
      ],
      resolve: { alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }] },
      server: { middlewareMode: true, hmr: false, fs: { strict: false } },
    });
    const context = {
      repoName: "fixture",
      repoRoot: tempDir,
      projectRoot: src,
      copyShell: process.platform === "win32" ? "powershell" : "posix",
      activeFilm: "fixture",
      isDemo: true,
      films: ["fixture"],
      runningFilms: ["fixture"],
      envStatus: {},
      choices: {
        films: ["fixture"],
        filmDirs: [],
        notes: [],
        shots: [],
        takes: [],
        skills: ["core"],
        skillRefs: [],
        favLists: [],
        findKinds: ["sfx", "mocap"],
        findSources: [],
        postures: [],
        renders: [],
        labs: [],
        packages: [],
      },
    };
    server = createHttpServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const json =
          url.pathname === "/api/cli/catalog"
            ? { categories: CLI_CATEGORIES, commands: CLI_COMMANDS, context }
            : url.pathname === "/api/cli/templates"
              ? { templates: [], warning: null }
              : { active: null, last: null };
        if (req.method === "POST") {
          runRequests++;
          let body = "";
          for await (const chunk of req) body += chunk;
          postedRequests.push({ path: url.pathname, body: JSON.parse(body) });
        }
        res.writeHead(req.method === "POST" ? 400 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
        return;
      }
      if (url.pathname === "/cli-test.tsx") {
        vite
          .transformRequest("/cli-test.tsx")
          .then((out) => {
            res.writeHead(200, { "content-type": "application/javascript" });
            res.end(out.code);
          })
          .catch((err) => {
            res.writeHead(500);
            res.end(String(err));
          });
        return;
      }
      if (url.pathname === "/cli-test.html") {
        vite
          .transformIndexHtml(
            "/cli-test.html",
            '<!doctype html><html class="dark" lang="en"><head></head><body><div id="root"></div><script type="module" src="/cli-test.tsx"></script></body></html>',
          )
          .then((html) => {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(html);
          });
        return;
      }
      vite.middlewares(req, res);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/cli-test.html`;
    webview = new Bun.WebView({
      backend: { type: "chrome", argv: ["--headless=new", "--window-size=1600,1000"] },
    });
  }, 30000);

  beforeEach(async () => {
    runRequests = 0;
    postedRequests = [];
    await webview.navigate(baseUrl);
    await waitUntil("window.__CLI_TEST__?.ready()", "catalog loaded");
  });
  afterAll(async () => {
    webview?.close();
    await vite?.close();
    server?.closeAllConnections?.();
    server?.close();
    if (tempDir && dirname(tempDir) === TEMP_ROOT)
      rmSync(tempDir, { recursive: true, force: true });
  }, 30000);

  test("Run opens More options and focuses its invalid field without executing", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('earshot')");
    await fill("Audio or video file", "sound/fixture.wav");
    await webview.evaluate(`(${moreButton}).click()`);
    await fill("CPU Threads", "wrong");
    await webview.evaluate(`(${moreButton}).click()`);
    await waitUntil(`!(${field("CPU Threads")})`, "advanced field closed");
    await webview.evaluate(
      "[...document.querySelectorAll('button')].find(n=>n.textContent==='Run command').click()",
    );
    await waitUntil(
      "document.querySelector('[role=alert]')?.textContent.includes('CPU Threads')",
      "validation message",
    );
    assert.equal(await webview.evaluate(`(${moreButton}).getAttribute('aria-expanded')`), "true");
    await waitUntil(`document.activeElement===(${field("CPU Threads")})`, "invalid field focused");
    await webview.evaluate(
      `(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.querySelector('[data-cli-workbench]').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));})()`,
    );
    await waitUntil(
      `(()=>{const n=${field("CPU Threads")};const r=n.getBoundingClientRect();const p=n.closest('[class*=overflow-y-auto]').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;})()`,
      "invalid field fully visible in the scroll area",
      3000,
    );
    assert.equal(
      await webview.evaluate(`(${field("CPU Threads")}).getAttribute('aria-invalid')`),
      "true",
    );
    assert.equal(runRequests, 0);
  });

  for (const history of [null, completedHelpRun]) {
    test(`changing a command keeps keyboard focus${history ? " with historical output" : " without output"}`, async () => {
      if (history)
        await webview.evaluate(`window.__CLI_TEST__.seedRun(${JSON.stringify(history)})`);
      await webview.evaluate("window.__CLI_TEST__.open('find')");
      const command = "document.querySelector('[role=combobox][aria-label=Command]')";
      await waitUntil(command, "command selector");
      await webview.evaluate(`(${command}).focus()`);
      await webview.press("Space");
      await waitUntil("document.querySelector('[role=listbox]')", "command list open");
      await webview.press("Home");
      await webview.press("Enter");
      await waitUntil(
        "document.querySelector('[data-cli-workbench] h2')?.textContent==='help'",
        "help selected",
      );
      await waitUntil(
        `(${command})?.getAttribute('aria-expanded')==='false'`,
        "command list closed",
      );
      await waitUntil(
        `document.activeElement===(${command})`,
        "focus returned to command selector",
      );
      await webview.press("Tab");
      assert.equal(
        await webview.evaluate("document.activeElement?.getAttribute('aria-label')"),
        "Copy command",
      );
      assert.equal(runRequests, 0);
    });
  }

  test("uncommitted token text survives a panel remount and resets with the command", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('find')");
    await fill("Query Words / Scene", "stone");
    await webview.evaluate(`(${field("Query Words / Scene")}).focus()`);
    await webview.press("Enter");
    await fill("Query Words / Scene", "during-resize");
    await webview.evaluate("window.__CLI_TEST__.remount()");
    await waitUntil(field("Query Words / Scene"), "query field remounted");
    assert.equal(
      await webview.evaluate(`(${field("Query Words / Scene")}).value`),
      "during-resize",
    );
    await webview.evaluate(`(${field("Query Words / Scene")}).focus()`);
    await webview.press("Enter");
    await waitUntil(
      "document.querySelector('code')?.textContent.includes('stone during-resize')",
      "both tokens committed",
    );
    await fill("Query Words / Scene", "reset-me");
    await webview.evaluate("document.querySelector('[aria-label=\"Reset options\"]').click()");
    await waitUntil(`(${field("Query Words / Scene")}).value===''`, "pending text reset");
    assert.equal(runRequests, 0);
  });

  test("opening a long command guide starts at its heading without execution", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('find')");
    await waitUntil("document.querySelector('[data-cli-workbench] h2')", "find workbench");
    await webview.evaluate(
      "(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent==='Command guide');b.focus();b.click();})()",
    );
    await waitUntil("document.querySelector('[data-cli-dialog]')", "guide open");
    await webview.evaluate(
      "(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.querySelector('[data-cli-dialog]').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));})()",
    );
    assert.equal(
      await webview.evaluate(
        "document.activeElement===document.querySelector('[data-cli-dialog] [data-slot=dialog-title]')",
      ),
      true,
    );
    assert.equal(
      await webview.evaluate("document.querySelector('[data-cli-dialog]').scrollTop"),
      0,
    );
    assert.equal(
      await webview.evaluate(
        "[...document.querySelectorAll('[data-cli-dialog] dt')].find(n=>n.textContent.startsWith('Limit')).textContent",
      ),
      "Limit (-n)",
    );
    assert.equal(runRequests, 0);
    await webview.evaluate(
      "(()=>{window.__CLI_PREVIOUS_GUIDE__=document.querySelector('[data-cli-dialog]');window.__CLI_TEST__.remount();})()",
    );
    await waitUntil("!window.__CLI_PREVIOUS_GUIDE__.isConnected", "old guide unmounted");
    await waitUntil(
      "document.querySelector('[data-cli-dialog]')",
      "guide preserved across remount",
    );
    await webview.press("Escape");
    await waitUntil("!document.querySelector('[data-cli-dialog]')", "guide closed");
    await waitUntil(
      "document.activeElement?.textContent==='Command guide'",
      "guide trigger focused",
    );
  });

  test("the first native click after typing a token activates its control without moving it", async () => {
    await webview.evaluate(
      "(()=>{Object.assign(document.querySelector('#cli-test-panel').style,{width:'1200px',height:'1000px'});window.__CLI_TEST__.open('find');})()",
    );
    await fill("Query Words / Scene", "stone");
    await webview.evaluate(`(${field("Query Words / Scene")}).focus()`);
    await webview.press("Enter");
    await fill("Query Words / Scene", "click-test");
    await webview.evaluate(`(${field("Query Words / Scene")}).focus()`);
    const kind =
      "[...document.querySelectorAll('[data-slot=field-label]')].find(n=>n.textContent.startsWith('Kind / Group')).closest('[data-slot=field]').querySelector('[role=switch]')";
    await webview.evaluate(`(${kind}).scrollIntoView({block:'center'})`);
    await webview.evaluate(
      "(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.querySelector('[data-cli-workbench]').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));})()",
    );
    const before = await webview.evaluate(`(${kind}).getBoundingClientRect().toJSON()`);
    await webview.click(before.x + before.width / 2, before.y + before.height / 2);
    assert.equal(await webview.evaluate(`(${kind}).getAttribute('aria-checked')`), "true");
    assert.equal(await webview.evaluate(`(${kind}).getBoundingClientRect().top`), before.top);
    assert.equal(runRequests, 0);
  });

  test("removing an existing token preserves text still being typed", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('find')");
    await fill("Query Words / Scene", "stone");
    await webview.evaluate(`(${field("Query Words / Scene")}).focus()`);
    await webview.press("Enter");
    await fill("Query Words / Scene", "still-typing");
    await webview.evaluate("document.querySelector('[aria-label=\"Remove stone\"]').click()");
    assert.equal(await webview.evaluate(`(${field("Query Words / Scene")}).value`), "still-typing");
    assert.equal(
      await webview.evaluate("document.querySelector('code').textContent"),
      "bun run find still-typing",
    );
    assert.equal(runRequests, 0);
  });

  test("disabling an optional token flag clears its text while preserving another field", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('find')");
    await fill("Query Words / Scene", "in-progress");
    const kind =
      "[...document.querySelectorAll('[data-slot=field-label]')].find(n=>n.textContent.startsWith('Kind / Group')).closest('[data-slot=field]').querySelector('[role=switch]')";
    const input = "document.querySelector('input[aria-label=\"Kind / Group (--kind)\"]')";
    await webview.evaluate(`(${kind}).click()`);
    await waitUntil(input, "kind value visible");
    await webview.evaluate(
      `(()=>{const n=${input};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'mocap');n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await webview.evaluate(`(${kind}).click()`);
    await waitUntil(`!(${input})`, "kind value hidden");
    await webview.evaluate(`(${kind}).click()`);
    await waitUntil(input, "kind value shown again");
    assert.equal(await webview.evaluate(`(${input}).value`), "");
    assert.equal(await webview.evaluate(`(${field("Query Words / Scene")}).value`), "in-progress");
    assert.equal(runRequests, 0);
  });

  test("pending token text is included in the live preview, copied command and run request", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('find')");
    await fill("Query Words / Scene", "pending-word");
    assert.equal(
      await webview.evaluate("document.querySelector('code').textContent.includes('pending-word')"),
      true,
    );
    await webview.evaluate(
      "(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__COPIED_COMMAND__=value}}});document.querySelector('[aria-label=\"Copy command\"]').click()})()",
    );
    await waitUntil("window.__COPIED_COMMAND__?.includes('pending-word')", "pending value copied");
    await webview.evaluate(
      "[...document.querySelectorAll('button')].find(n=>n.textContent==='Run command').click()",
    );
    await waitUntil(
      "document.querySelector('[data-cli-workbench]')?.textContent.includes('Command could not run')",
      "fixture run rejection",
    );
    assert.equal(postedRequests[0]?.path, "/api/cli/run");
    assert.deepEqual(postedRequests[0]?.body.args.words, ["pending-word"]);
    assert.equal(runRequests, 1);
  });

  test("saving a template includes pending text after its input remounts", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('find')");
    await fill("Query Words / Scene", "save-pending");
    await webview.evaluate(`(${field("Query Words / Scene")}).focus()`);
    await webview.evaluate("window.__CLI_TEST__.remount()");
    await waitUntil(field("Query Words / Scene"), "pending field remounted");
    await webview.click('[aria-label="Save template"]');
    await fill("Template name", "Pending fixture");
    const button = await webview.evaluate(
      "[...document.querySelectorAll('[data-cli-dialog] button')].find(n=>n.textContent==='Save template').getBoundingClientRect().toJSON()",
    );
    await webview.click(button.x + button.width / 2, button.y + button.height / 2);
    await waitUntil(
      "document.querySelector('[data-cli-dialog] [role=alert]')",
      "fixture save rejection",
    );
    assert.equal(postedRequests[0]?.path, "/api/cli/templates");
    assert.deepEqual(postedRequests[0]?.body.args.words, ["save-pending"]);
    assert.equal(runRequests, 1);
  });

  for (const width of [360, 320]) {
    test(`output remains readable in a ${width}px embedded pane only 335px tall`, async () => {
      await webview.evaluate(
        `(async()=>{Object.assign(document.querySelector('#cli-test-panel').style,{width:'${width}px',height:'335px'});await window.__CLI_TEST__.seedRun(${JSON.stringify(completedHelpRun)});window.__CLI_TEST__.open('help');})()`,
      );
      await fill("Command to look up", "find");
      const outputTab =
        "[...document.querySelectorAll('[role=radio]')].find(n=>n.textContent==='Output')";
      const tab = await webview.evaluate(`(${outputTab}).getBoundingClientRect().toJSON()`);
      await webview.click(tab.x + tab.width / 2, tab.y + tab.height / 2);
      await waitUntil(
        "document.querySelector('[aria-label=\"Verbatim command output\"]')",
        "output ready",
      );
      const visibleOutputLines = `(()=>{const p=document.querySelector('[aria-label="Verbatim command output"]'),s=getComputedStyle(p),r=p.getBoundingClientRect();let top=r.top+parseFloat(s.paddingTop),bottom=r.bottom-parseFloat(s.paddingBottom);for(let n=p.parentElement;n;n=n.parentElement){if(/auto|scroll|hidden|clip/.test(getComputedStyle(n).overflowY)){const a=n.getBoundingClientRect();top=Math.max(top,a.top);bottom=Math.min(bottom,a.bottom)}}return Math.max(0,bottom-top)/parseFloat(s.lineHeight)})()`;
      await waitUntil(`(${visibleOutputLines})>=3`, "at least three visible output lines", 3000);
      await webview.click('[aria-label="Expand output"]');
      await waitUntil(
        "document.querySelector('[aria-label=\"Restore builder\"]')",
        "output expanded",
      );
      assert.equal(await webview.evaluate(`(${visibleOutputLines})>=3`), true);
      await webview.click('[aria-label="Restore builder"]');
      const configure = await webview.evaluate(
        "[...document.querySelectorAll('[role=radio]')].find(n=>n.textContent==='Configure').getBoundingClientRect().toJSON()",
      );
      await webview.click(configure.x + configure.width / 2, configure.y + configure.height / 2);
      await waitUntil(field("Command to look up"), "configuration restored");
      assert.equal(await webview.evaluate(`(${field("Command to look up")}).value`), "find");
      assert.equal(
        await webview.evaluate("!!document.querySelector('[data-cli-actions] button')"),
        true,
      );
      assert.equal(runRequests, 0);
    });
  }

  test("a new run moves keyboard focus to output when the compact form is replaced", async () => {
    await webview.evaluate("window.__CLI_TEST__.open('help')");
    await fill("Command to look up", "find");
    await webview.evaluate(
      "[...document.querySelectorAll('button')].find(n=>n.textContent==='Run command').focus()",
    );
    await webview.evaluate(`window.__CLI_TEST__.seedRun(${JSON.stringify(completedHelpRun)})`);
    await waitUntil(
      "document.activeElement===document.querySelector('[aria-label=\"Verbatim command output\"]')",
      "keyboard focus follows the completed command into output",
      3000,
    );
    assert.equal(runRequests, 0);
  });

  test("output and its expand control stay reachable at 200% text size", async () => {
    await webview.evaluate(
      `(()=>{document.documentElement.style.fontSize='32px';Object.assign(document.querySelector('#cli-test-panel').style,{width:'1400px',height:'740px'});window.__CLI_TEST__.seedRun(${JSON.stringify(completedHelpRun)});window.__CLI_TEST__.open('help');})()`,
    );
    await waitUntil(
      "document.querySelector('[aria-label=\"Verbatim command output\"]')",
      "output ready",
    );
    await webview.evaluate(
      "document.querySelector('[aria-label=\"Expand output\"]').scrollIntoView({block:'nearest'})",
    );
    await waitUntil(
      `(()=>{const b=document.querySelector('[aria-label="Expand output"]');const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
      "expand output is hit-testable above the footer",
      3000,
    );
    assert.equal(
      await webview.evaluate(
        `(()=>{const p=document.querySelector('[aria-label="Verbatim command output"]');return p.clientHeight>=4*parseFloat(getComputedStyle(p).lineHeight);})()`,
      ),
      true,
      "at least four output lines fit without clipping the toolbar",
    );
    await webview.click('[aria-label="Expand output"]');
    await waitUntil(
      "document.querySelector('[aria-label=\"Restore builder\"]')",
      "expanded output",
    );
    assert.equal(runRequests, 0);
  });

  test("a checked comfortable switch reaches the track end at 200% text size", async () => {
    await webview.evaluate(
      "(()=>{document.documentElement.style.fontSize='32px';window.__CLI_TEST__.open('find');})()",
    );
    const kind =
      "[...document.querySelectorAll('[data-slot=field-label]')].find(n=>n.textContent.startsWith('Kind / Group')).closest('[data-slot=field]').querySelector('[role=switch]')";
    await waitUntil(kind, "kind switch ready");
    await webview.evaluate(`(${kind}).click()`);
    await waitUntil(`(${kind}).getAttribute('aria-checked')==='true'`, "kind enabled");
    await webview.evaluate(
      `Promise.all((${kind}).getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))`,
    );
    assert.equal(
      await webview.evaluate(
        `(()=>{const s=${kind};const t=s.querySelector('[data-slot=switch-thumb]');return s.getBoundingClientRect().right-t.getBoundingClientRect().right<=3;})()`,
      ),
      true,
      "checked thumb remains inset at most three pixels from the right edge",
    );
    assert.equal(runRequests, 0);
  });

  test("clipboard errors remain until dismissed for both command and output", async () => {
    await webview.evaluate(
      "(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError')}}});window.__CLI_TEST__.open('help')})()",
    );
    await waitUntil(
      "document.querySelector('[aria-label=\"Copy command\"]')",
      "command copy ready",
    );
    await webview.evaluate("document.querySelector('[aria-label=\"Copy command\"]').click()");
    const errorToast = (kind) =>
      `[...document.querySelectorAll('[data-slot=toast]')].find(n=>n.querySelector('[data-slot=toast-title]')?.textContent===${JSON.stringify(`Could not copy ${kind}`)})`;
    await waitUntil(errorToast("command"), "command copy error");
    await webview.evaluate(`window.__CLI_TEST__.seedRun(${JSON.stringify(completedHelpRun)})`);
    await waitUntil(
      "document.querySelector('[aria-label=\"Copy verbatim output\"]:not(:disabled)')",
      "output copy ready",
    );
    await webview.evaluate(
      "document.querySelector('[aria-label=\"Copy verbatim output\"]').click()",
    );
    await waitUntil(errorToast("output"), "output copy error");
    await webview.evaluate("new Promise(r=>setTimeout(r,7000))");
    for (const kind of ["output", "command"]) {
      assert.equal(
        await webview.evaluate(
          `(()=>{const n=${errorToast(kind)};return !!n&&!n.hasAttribute('data-ending-style')&&n.textContent.includes('Allow clipboard access');})()`,
        ),
        true,
        `${kind} recovery remains available`,
      );
      await webview.evaluate(`(${errorToast(kind)}).querySelector('[aria-label=Close]').click()`);
      await waitUntil(`!(${errorToast(kind)})`, `${kind} error dismissed`);
    }
    assert.equal(runRequests, 0);
  });
});
