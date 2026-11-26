import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)),
  ROOT = join(HERE, "../../..");
const DESKTOP = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };

const HELP = `Usage: bun run eval:load [--film <name>] [--runs N] [--only desk|phone] [--note "<what changed>"] [--profile] [--panels] [--frames <s,...>] [--audio] [--playback]
Starts the studio for films/<name> (default cell-break) on port 4391, opens it N times (default 5) per profile in
headless Chrome, and prints the medians:
  server     ms from bun run studio to "live at" (the page's build)
  connect    ms to look up localhost and connect     ttfb      first byte of the page
  fcp        first paint of the page                 picture   the film's first frame drawn
  ready      every panel's data loaded (__readyAt)   tbt       main thread blocked past 50 ms per task, until ready
  kb         bytes over the wire                     js        JavaScript bytes over the wire     req   requests
Profiles: desk (${DESKTOP.width}x${DESKTOP.height}, localhost) and phone (412x915 touch, 4x slower CPU, 20 Mbit/s and 40 ms like Tailscale), each
cold and warm. Each finished run adds one line to scripts/evals/load/runs/history.jsonl.
--profile also samples the CPU through the first measured cold and warm visit of each profile and prints where its main
thread spent the time, by function (self and total; the page keeps its names, see src/page.mjs), and the libraries' time
under the page's function that called into them. Phone runs swing ~30%: repeat one before calling it a win.
--panels also measures the first opening of Settings after the warm desktop visit (cold panel cache).
--frames 0,2.4,4.7 captures the film canvas at fixed seconds after the measured visits, once per profile.
--audio renders the live audio lanes offline from 0 to 15 seconds after measuring, for before/after RMS comparison.
--playback records eight seconds of real play/pause cadence and checks opening/cancelling a note after measuring.
Raw samples are saved after each visit in scripts/evals/load/runs/<timestamp>/, even if a later visit fails.
The complete eval stops after 20 minutes.
The film's own studio must not be running (one studio per film); the eval stops its studio when done.`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i < 0 ? undefined : args[i + 1];
};
const KNOWN = new Set(["--film", "--runs", "--only", "--note", "--frames"]);
const switches = new Set(["--profile", "--panels", "--audio", "--playback"]);
for (let i = 0; i < args.length; i += switches.has(args[i]!) ? 1 : 2)
  if (!KNOWN.has(args[i]!) && !switches.has(args[i]!)) {
    console.error(`unknown option ${args[i]}\n\n${HELP}`);
    process.exit(2);
  }
const FILM = flag("--film") ?? "cell-break",
  RUNS = Number(flag("--runs") ?? 5),
  ONLY = flag("--only"),
  NOTE = flag("--note") ?? "",
  PROFILE = args.includes("--profile");
const FRAMES = flag("--frames")?.split(",").map(Number) ?? [];
if (FRAMES.some((t) => !Number.isFinite(t) || t < 0)) {
  console.error("--frames takes comma-separated nonnegative seconds");
  process.exit(2);
}
const FILM_DIR = join(ROOT, "films", FILM);
if (!existsSync(join(FILM_DIR, "package.json"))) {
  console.error(`no film at films/${FILM}`);
  process.exit(2);
}
if (!(RUNS >= 1)) {
  console.error("--runs takes a number from 1");
  process.exit(2);
}
if (ONLY && ONLY !== "desk" && ONLY !== "phone") {
  console.error("--only takes desk or phone");
  process.exit(2);
}
const PORT = 4391,
  URL_ = `http://localhost:${PORT}/`;
const pkg = JSON.parse(readFileSync(join(FILM_DIR, "package.json"), "utf8"));
const CHROME = join(
  FILM_DIR,
  pkg["live-studio"]?.chrome ?? "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe",
);
if (!existsSync(CHROME)) {
  console.error(`no headless Chrome at ${CHROME}`);
  process.exit(2);
}

const children: ChildProcess[] = [];
const dirs: string[] = [];
const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
const runDir = join(HERE, "runs", runId);
mkdirSync(runDir, { recursive: true });
const cleanup = async () => {
  await Promise.all(
    children
      .filter((c) => c.exitCode === null)
      .map((c) => new Promise((done) => c.once("exit", done).kill())),
  );
  await sleep(500); // Chrome's helper processes let go of the profile a little after the browser exits
  for (const d of dirs)
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      console.log(`left behind: ${d}`);
    }
};
process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

const waitOutput = (p: ChildProcess, pattern: RegExp, ms: number, what: string) =>
  new Promise<RegExpMatchArray>((done, fail) => {
    let seen = "";
    const t = setTimeout(
      () => fail(new Error(`${what}: nothing after ${ms / 1000} s\n${seen}`)),
      ms,
    );
    const read = (b: Buffer) => {
      seen += b.toString();
      const m = seen.match(pattern);
      if (m) {
        clearTimeout(t);
        done(m);
      }
    };
    p.stdout?.on("data", read);
    p.stderr?.on("data", read);
    p.on("exit", (code) => fail(new Error(`${what} exited (${code})\n${seen}`)));
  });

const startStudio = async () => {
  const t0 = performance.now();
  const studio = spawn(
    process.execPath,
    [join(ROOT, "packages/live-studio/src/live.mjs"), String(PORT)],
    {
      cwd: FILM_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(studio);
  await waitOutput(studio, /live at http/, 300e3, "the studio");
  return Math.round(performance.now() - t0);
};

type Msg = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
  sessionId?: string;
};
const openChrome = async () => {
  const profile = mkdtempSync(join(tmpdir(), "load_eval_"));
  dirs.push(profile);
  const chrome = spawn(
    CHROME,
    [
      "--headless",
      "--use-gl=angle",
      "--use-angle=d3d11",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--no-first-run",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(chrome);
  // Chrome writes its port and path here once it listens (chrome-headless-shell prints nothing on Windows)
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; !existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n"); i++) {
    if (i > 300) throw new Error(`Chrome: no ${portFile} after 30 s`);
    await sleep(100);
  }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const sock = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((r) => sock.addEventListener("open", r, { once: true }));
  let next = 0;
  const pending = new Map<number, { done: (v: any) => void; fail: (e: Error) => void }>();
  const listeners = new Set<(m: Msg) => void>();
  sock.addEventListener("message", (e) => {
    const m: Msg = JSON.parse(String(e.data));
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p?.fail(new Error(`${m.error.message}`));
      else p?.done(m.result);
    } else for (const l of listeners) l(m);
  });
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((done, fail) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`${method}: no DevTools reply after 60 s`));
      }, 60_000);
      pending.set(id, {
        done: (value) => {
          clearTimeout(timer);
          done(value);
        },
        fail: (error) => {
          clearTimeout(timer);
          fail(new Error(`${method}: ${error.message}`));
        },
      });
      sock.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return { send, listeners, close: () => sock.close() };
};
type Cdp = Awaited<ReturnType<typeof openChrome>>;

const PROBE = `(() => {
  const m = (window.__loadEval = { long: [], errors: [] });
  addEventListener('error', e => { if (!e.message?.startsWith('ResizeObserver loop')) m.errors.push(e.error?.stack || e.message); });
  addEventListener('unhandledrejection', e => m.errors.push(e.reason?.stack || String(e.reason)));
  new PerformanceObserver((l) => { for (const e of l.getEntries()) m.long.push([e.startTime, e.duration]); })
    .observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) m.lcp = e.startTime; })
    .observe({ type: "largest-contentful-paint", buffered: true });
  const poll = () => {
    if (m.picture == null && window.__live) m.picture = performance.now();
    if (window.__readyAt) { m.ready = window.__readyAt - performance.timeOrigin; return; }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
})();`;

const READ = `(() => {
  const m = window.__loadEval, nav = performance.getEntriesByType("navigation")[0];
  const res = [nav, ...performance.getEntriesByType("resource")].filter((e) => e.name.startsWith(location.origin));
  const until = m.ready ?? performance.now();
  return {
    phone: matchMedia("(pointer: coarse)").matches,
    connect: nav.connectEnd - nav.domainLookupStart,
    ttfb: nav.responseStart,
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    lcp: m.lcp ?? null,
    picture: m.picture ?? null,
    ready: m.ready ?? null,
    tbt: m.long.filter(([s]) => s < until).reduce((a, [, d]) => a + Math.max(0, d - 50), 0),
    longest: m.long.reduce((a, [, d]) => Math.max(a, d), 0),
    req: res.length,
    kb: res.reduce((a, e) => a + (e.transferSize || 0), 0) / 1024,
    js: res.filter((e) => /\\.m?js(\\?|$)/.test(e.name)).reduce((a, e) => a + (e.transferSize || 0), 0) / 1024,
    files: res.map((e) => [new URL(e.name).pathname, Math.round(e.transferSize || 0), Math.round(e.startTime), Math.round(e.responseEnd)]),
    errors: [...m.errors, ...document.querySelectorAll("pre, [role=alert]")].map((p) => typeof p === 'string' ? p : p?.textContent).filter(Boolean),
  };
})()`;

type Profile = { name: "desk" | "phone"; setup: (cdp: Cdp, s: string) => Promise<void> };
const PROFILES: Profile[] = [
  {
    name: "desk",
    setup: async (cdp, s) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", DESKTOP, s);
    },
  },
  {
    name: "phone",
    setup: async (cdp, s) => {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true },
        s,
      );
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, s);
      await cdp.send(
        "Emulation.setUserAgentOverride",
        {
          userAgent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        },
        s,
      );
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }, s);
      await cdp.send(
        "Network.emulateNetworkConditions",
        { offline: false, latency: 40, downloadThroughput: 2.5e6, uploadThroughput: 0.6e6 },
        s,
      );
    },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type CpuProfile = {
  nodes: {
    id: number;
    children?: number[];
    callFrame: { functionName: string; url: string; lineNumber: number };
  }[];
  samples: number[];
  timeDeltas: number[];
};
const cpuTimes = (p: CpuProfile, name: string) => {
  const file = join(runDir, `${name}.cpuprofile`);
  writeFileSync(file, JSON.stringify(p));
  const node = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const keyOf = (id: number) => {
    const f = node.get(id)!.callFrame;
    return `${f.url.replace(/^.*\//, "") || "(native)"}:${f.lineNumber + 1} ${f.functionName || "(anonymous)"}`;
  };
  const self = new Map<string, number>(),
    total = new Map<string, number>(),
    caller = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const inLib = (id: number) => /\/vendor-[\w~-]+\.js$/.test(node.get(id)!.callFrame.url);
  p.samples.forEach((id, i) => {
    const ms = (p.timeDeltas[i] ?? 0) / 1000,
      seen = new Set<string>();
    add(self, keyOf(id), ms);
    let page: number | undefined = id;
    while (page !== undefined && inLib(page)) page = parent.get(page);
    if (page !== id && page !== undefined) add(caller, keyOf(page), ms);
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const k = keyOf(at);
      if (!seen.has(k)) add(total, k, ms);
      seen.add(k);
    }
  });
  const top = (m: Map<string, number>) =>
    [...m]
      .filter(([k]) => !/\((idle|program|root)\)/.test(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`);
  return [
    `profile: ${file}`,
    "self:",
    ...top(self),
    "total:",
    ...top(total),
    "in vendor chunks, by the page's caller:",
    ...top(caller),
  ];
};
const visit = async (cdp: Cdp, profile: Profile, profileThis = false, capture = false) => {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, s);
  await cdp.send("Network.enable", {}, s);
  await cdp.send("Runtime.enable", {}, s);
  await cdp.send("Log.enable", {}, s);
  await profile.setup(cdp, s);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE }, s);
  const network = new Map<
    string,
    { path: string; priority: string; status?: number; error?: string }
  >();
  const preloadWarnings: string[] = [];
  const onNetwork = (m: Msg) => {
    if (m.sessionId !== s) return;
    const p = m.params;
    if (m.method === "Log.entryAdded" && /preload/i.test(p.entry?.text ?? ""))
      preloadWarnings.push(p.entry.text);
    if (m.method === "Network.requestWillBeSent" && p.request.url.startsWith(URL_))
      network.set(p.requestId, {
        path: new URL(p.request.url).pathname,
        priority: p.request.initialPriority,
      });
    const entry = network.get(p?.requestId);
    if (!entry) return;
    if (m.method === "Network.responseReceived") entry.status = p.response.status;
    if (m.method === "Network.loadingFailed") entry.error = p.errorText;
  };
  cdp.listeners.add(onNetwork);
  const load = async (kind: "cold" | "warm", cpu: string | null = null) => {
    network.clear();
    preloadWarnings.length = 0;
    if (cpu) {
      await cdp.send("Profiler.enable", {}, s);
      await cdp.send("Profiler.setSamplingInterval", { interval: 500 }, s);
      await cdp.send("Profiler.start", {}, s);
    }
    const navigation = await cdp.send("Page.navigate", { url: URL_ }, s);
    if (!navigation.loaderId)
      throw new Error(`Navigation did not create a document: ${JSON.stringify(navigation)}`);
    const t0 = Date.now();
    for (;;) {
      await sleep(250);
      const frame = await cdp.send("Page.getFrameTree", {}, s);
      if (frame.frameTree.frame.loaderId !== navigation.loaderId) {
        if (Date.now() - t0 > 180e3)
          throw new Error("Expected document was not committed after 180 s");
        continue;
      }
      const r = await cdp
        .send("Runtime.evaluate", { expression: READ, returnByValue: true }, s)
        .catch(() => null);
      const v = r?.result?.value;
      if (!v && Date.now() - t0 > 180e3) throw new Error(`${profile.name}: no metrics after 180 s`);
      if (v && (v.ready != null || v.errors.length || Date.now() - t0 > 180e3)) {
        if (cpu) v.cpu = cpuTimes((await cdp.send("Profiler.stop", {}, s)).profile, cpu);
        if (v.errors.length) return { ...v, network: [...network.values()] };
        if (v.ready == null || v.picture == null)
          return { ...v, timedOut: true, network: [...network.values()] };
        await sleep(1000);
        const settled = (
          await cdp.send("Runtime.evaluate", { expression: READ, returnByValue: true }, s)
        ).result.value;
        for (const key of ["files", "kb", "js", "req", "errors", "fcp", "lcp"])
          v[key] = settled[key];
        v.network = [...network.values()];
        v.preloadWarnings = [...preloadWarnings];
        const settledFrame = await cdp.send("Page.getFrameTree", {}, s);
        if (settledFrame.frameTree.frame.loaderId !== navigation.loaderId)
          throw new Error("The page reloaded during the measurement");
        v.loaderId = navigation.loaderId;
        appendFileSync(
          join(runDir, "navigations.jsonl"),
          JSON.stringify({ profile: profile.name, kind, ...v }) + "\n",
        );
        if (capture) {
          v.gpu = (
            await cdp.send(
              "Runtime.evaluate",
              {
                expression: `(() => { const g=document.querySelector('canvas').getContext('webgl2'), d=g?.getExtension('WEBGL_debug_renderer_info'); return {renderer:g?.getParameter(d?.UNMASKED_RENDERER_WEBGL??g.RENDERER), parallelShaders:!!g?.getExtension('KHR_parallel_shader_compile')}; })()`,
                returnByValue: true,
              },
              s,
            )
          ).result.value;
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, s);
          writeFileSync(join(runDir, `${profile.name}-${kind}.png`), data, "base64");
          const bounds = (
            await cdp.send(
              "Runtime.evaluate",
              {
                expression: `(() => { const {x,y,width,height} = document.querySelector('canvas').getBoundingClientRect(); return {x,y,width,height,scale:1}; })()`,
                returnByValue: true,
              },
              s,
            )
          ).result.value;
          const frame = await cdp.send(
            "Page.captureScreenshot",
            { format: "png", clip: bounds },
            s,
          );
          writeFileSync(join(runDir, `${profile.name}-${kind}-frame.png`), frame.data, "base64");
        }
        return v;
      }
    }
  };
  const cold = await load("cold", profileThis ? `${profile.name}-cold` : null);
  await sleep(500);
  const warm = await load("warm", profileThis ? `${profile.name}-warm` : null);
  let settings;
  if (args.includes("--panels") && profile.name === "desk") {
    const r = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(async () => {
        const start = performance.now();
        document.querySelector('button[aria-label="Settings"]').click();
        while (!document.querySelector('#settings')) {
          if (performance.now() - start > 10000) throw new Error('Settings did not open');
          await new Promise(r => setTimeout(r, 16));
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const files = performance.getEntriesByType('resource').filter(e => e.startTime >= start);
        const result = { ms: performance.now() - start,
          kb: files.reduce((a,e) => a + e.transferSize, 0) / 1024,
          files: files.map(e => [new URL(e.name).pathname, e.transferSize]) };
        document.querySelector('button[aria-label="Close settings"]').click();
        return result;
      })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      s,
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    settings = r.result.value;
  }
  if (capture && FRAMES.length) {
    const seen = new Map<number, number>();
    for (const t of FRAMES) {
      if (profile.name === "phone") {
        const { result } = await cdp.send(
          "Runtime.evaluate",
          {
            expression: `(() => { const e=document.querySelector('[role="slider"][aria-label="Playhead"]'), b=e.getBoundingClientRect(); return {x:b.x+b.width*${t}/Number(e.getAttribute('aria-valuemax')),y:b.y+b.height/2}; })()`,
            returnByValue: true,
          },
          s,
        );
        for (const type of ["mousePressed", "mouseReleased"])
          await cdp.send(
            "Input.dispatchMouseEvent",
            { type, ...result.value, button: "left", clickCount: 1 },
            s,
          );
      } else {
        const { exceptionDetails } = await cdp.send(
          "Runtime.evaluate",
          { expression: `window.__editor.seek(${t})` },
          s,
        );
        if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
      }
      const r = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=document.querySelector('canvas'),b=c.getBoundingClientRect();return {t:window.__live.t,clip:{x:b.x,y:b.y,width:b.width,height:b.height,scale:1}}})()`,
          awaitPromise: true,
          returnByValue: true,
        },
        s,
      );
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      if (Math.abs(r.result.value.t - t) > 0.05) throw new Error(`Seek did not reach ${t}`);
      const shot = await cdp.send(
        "Page.captureScreenshot",
        { format: "png", clip: r.result.value.clip },
        s,
      );
      const repeat = seen.get(t) ?? 0;
      seen.set(t, repeat + 1);
      const name = `${profile.name}-at-${t}${repeat ? `-repeat-${repeat}` : ""}`;
      writeFileSync(join(runDir, `${name}.png`), shot.data, "base64");
      appendFileSync(
        join(runDir, "frames.jsonl"),
        JSON.stringify({
          profile: profile.name,
          requested: t,
          ...r.result.value,
          file: `${name}.png`,
        }) + "\n",
      );
    }
  }
  if (capture && args.includes("--audio")) {
    const r = await cdp.send(
      "Runtime.evaluate",
      {
        expression: "window.__lanesRender(0, 15)",
        awaitPromise: true,
        returnByValue: true,
      },
      s,
    );
    if (r.exceptionDetails || !r.result.value?.rms?.length)
      throw new Error(
        `Audio verification failed: ${JSON.stringify(r.exceptionDetails ?? r.result.value)}`,
      );
    writeFileSync(
      join(runDir, `${profile.name}-audio.json`),
      JSON.stringify(r.result.value, null, 2),
    );
  }
  if (capture && args.includes("--playback")) {
    const r = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(async()=>{
        const start=performance.now(), from=window.__live.t, samples=[];
        document.querySelector('button[aria-label="Play"]').click();
        let previous=-1;
        while(performance.now()-start<8000){
          await new Promise(requestAnimationFrame);
          const v=window.__live;
          if(v.t!==previous){samples.push({at:performance.now()-start,t:v.t,drawMs:v.drawMs});previous=v.t;}
        }
        const pause=document.querySelector('button[aria-label="Pause"]');
        if(!pause)throw Error('Playback did not enter the playing state');
        const playbackMs=performance.now()-start;
        pause.click();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const stopped=window.__live.t;
        const note=document.querySelector('button[aria-label="Add note"]')??[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Note');
        const waitNote=async visible=>{const until=performance.now()+2500;while(!!document.querySelector('textarea[aria-label="Note"]')?.getBoundingClientRect().width!==visible&&performance.now()<until)await new Promise(r=>setTimeout(r,50));return !!document.querySelector('textarea[aria-label="Note"]')?.getBoundingClientRect().width===visible};
        note.click();const opened=await waitNote(true);
        const cancel=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Cancel');
        if(!cancel)throw Error('Note cancel is missing');
        cancel.click();const closed=await waitNote(false);
        return {from,stopped,playbackMs,totalInteractionMs:performance.now()-start,samples,note:{opened,closed,saved:false},paused:!!document.querySelector('button[aria-label="Play"]'),errors:window.__loadEval.errors};
      })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      s,
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    writeFileSync(
      join(runDir, `${profile.name}-playback.json`),
      JSON.stringify(r.result.value, null, 2),
    );
    const v = r.result.value;
    if (v.stopped <= v.from + 1 || !v.note.opened || !v.note.closed || !v.paused || v.errors.length)
      throw new Error(
        `Playback verification failed: ${JSON.stringify({ from: v.from, stopped: v.stopped, note: v.note, paused: v.paused, errors: v.errors })}`,
      );
  }
  await cdp.send("Target.closeTarget", { targetId });
  await cdp.send("Target.disposeBrowserContext", { browserContextId });
  cdp.listeners.delete(onNetwork);
  return { cold, warm, settings };
};

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const KEYS = [
  "connect",
  "ttfb",
  "fcp",
  "lcp",
  "picture",
  "ready",
  "tbt",
  "longest",
  "req",
  "kb",
  "js",
] as const;
const summarize = (rows: any[]) =>
  Object.fromEntries(KEYS.map((k) => [k, Math.round(median(rows.map((r) => r[k])) ?? NaN)]));

let failed = false;
const deadline = setTimeout(() => {
  console.error("Load eval exceeded 20 minutes; completed visits remain in the run directory");
  void cleanup().then(() => process.exit(124));
}, 20 * 60_000);
try {
  const server = await startStudio();
  console.log(`studio up in ${server} ms`);
  const cdp = await openChrome();
  const browser = await cdp.send("Browser.getVersion");
  const results: Record<string, any> = { server };
  for (const profile of PROFILES.filter((p) => !ONLY || p.name === ONLY)) {
    await visit(cdp, profile);
    const cold: any[] = [],
      warm: any[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await visit(cdp, profile, PROFILE && i === 0, i === 0);
      appendFileSync(
        join(runDir, "samples.jsonl"),
        JSON.stringify({ profile: profile.name, iteration: i + 1, ...r }) + "\n",
      );
      if (r.cold.cpu) results[`${profile.name}.cold.cpu`] = r.cold.cpu;
      if (r.warm.cpu) results[`${profile.name}.warm.cpu`] = r.warm.cpu;
      for (const [kind, v] of [
        ["cold", r.cold],
        ["warm", r.warm],
      ] as const) {
        if (v.timedOut || v.errors?.length) {
          failed = true;
          console.error(
            `${profile.name} ${kind}: ${v.timedOut ? "never ready" : v.errors.join("\n")}`,
          );
        }
        if (profile.name === "phone" && !v.phone) {
          failed = true;
          console.error(
            "phone: (pointer: coarse) does not match, so the page loaded the desk layout",
          );
        }
      }
      cold.push(r.cold);
      warm.push(r.warm);
      process.stdout.write(".");
    }
    console.log();
    results[`${profile.name}.cold`] = summarize(cold);
    results[`${profile.name}.warm`] = summarize(warm);
    for (const [kind, rows] of [
      ["cold", cold],
      ["warm", warm],
    ] as const) {
      const mid = [...rows].sort((a, b) => (a.ready ?? 1e9) - (b.ready ?? 1e9))[rows.length >> 1];
      results[`${profile.name}.${kind}.files`] = [
        ...[...(mid?.files ?? [])].sort((a: any, b: any) => b[3] - a[3]).slice(0, 10),
        ["-- heaviest:"],
        ...[...(mid?.files ?? [])].sort((a: any, b: any) => b[1] - a[1]).slice(0, 10),
      ];
    }
  }
  cdp.close();
  writeFileSync(
    join(runDir, "results.json"),
    JSON.stringify(
      {
        film: FILM,
        runs: RUNS,
        note: NOTE,
        failed,
        browser,
        bun: process.versions.bun,
        resourceSettleMs: 1000,
        desktop: DESKTOP,
        ...results,
      },
      null,
      2,
    ),
  );
  console.log(`raw results: ${runDir}`);
  const extra = (k: string) => k.endsWith(".files") || k.endsWith(".cpu");
  for (const k of Object.keys(results).filter((k) => !extra(k) && k !== "server"))
    console.log(`${k.padEnd(11)} ${KEYS.map((m) => `${m} ${results[k][m]}`).join("  ")}`);
  for (const k of Object.keys(results).filter((k) => k.endsWith(".files"))) {
    console.log(`\n${k} (path, bytes, start ms, end ms), latest to end first:`);
    for (const f of results[k]) console.log(`  ${f.join("  ")}`);
  }
  for (const k of Object.keys(results).filter((k) => k.endsWith(".cpu")))
    console.log(`\n${k}, until ready:\n${results[k].join("\n")}`);
  if (!failed) {
    const git = (a: string[]) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    const commit = git(["rev-parse", "--short", "HEAD"]);
    const dirty = git(["status", "--porcelain", "packages", FILM_DIR]);
    mkdirSync(join(HERE, "runs"), { recursive: true });
    appendFileSync(
      join(HERE, "runs/history.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        commit: commit + (dirty ? "+" : ""),
        film: FILM,
        runs: RUNS,
        note: NOTE,
        desktop: DESKTOP,
        ...Object.fromEntries(Object.entries(results).filter(([k]) => !extra(k))),
      }) + "\n",
    );
  }
} catch (e) {
  failed = true;
  console.error((e as Error).message);
} finally {
  clearTimeout(deadline);
  await cleanup();
}
process.exit(failed ? 1 : 0);
