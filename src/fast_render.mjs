// Serves the film to a headless Chrome on the GPU and writes back what the page posts: stills and finished mp4s
// that the page encoded itself with WebCodecs (mediabunny). node src/fast_render.mjs CONFIG.json
// CONFIG: { W, H, draft, quality, timeoutS, public, bundleDir, stillDir?, stills?: [{name, frame}],
//           jobs?: [{index, start, stop, samples, out}], webcodecs: {bitrate, hardware} }
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const CHROME = resolve(here, "../tools/chrome-headless-shell/chrome-headless-shell.exe");
// application/wasm is required: WebAssembly.instantiateStreaming refuses anything else
const MIME = { ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const body = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });

let finish;
const finished = new Promise((res) => { finish = res; });
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "POST") {
    const b = await body(req);
    if (url === "/log") { const m = b.toString(); console.log(m); if (m.startsWith("ERROR")) { process.exitCode = 1; finish(); } }
    else if (url.startsWith("/still/")) writeFileSync(join(cfg.stillDir, url.slice(7)), b);
    else if (url.startsWith("/file/")) writeFileSync(cfg.jobs.find((j) => j.index === +url.slice(6)).out, b);
    else if (url === "/done") finish();
    res.end("ok");
    return;
  }
  if (url === "/") { res.setHeader("content-type", "text/html"); // the classic script reports errors thrown while the module's imports evaluate, before the page's own handler exists (else the run waits out timeoutS)
    res.end('<!doctype html><canvas id="gl"></canvas><script>onerror = (m, s, l, c, e) => { fetch("/log", { method: "POST", body: "ERROR " + (e && e.stack || m) }); };</script><script type="module" src="/fast_page.js"></script>'); return; }
  if (url === "/config") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(cfg)); return; }
  // MineRender fetches its entity dataset and vanilla files from mcasset.cloud: mirror them once into a disk cache on E:
  // (Mojang files, never in the repo) so later renders run offline and every run sees the same data
  if (url.startsWith("/mcasset/")) {
    const cached = join(cfg.mcassetCache, url.slice(9));
    if (!existsSync(cached)) {
      const r = await fetch("https://assets.mcasset.cloud/" + url.slice(9));
      if (!r.ok) { res.statusCode = r.status; res.end(); return; }
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, Buffer.from(await r.arrayBuffer()));
    }
    res.setHeader("content-type", MIME[extname(cached)] ?? "application/octet-stream");
    createReadStream(cached).pipe(res);
    return;
  }
  const file = url === "/fast_page.js" ? join(cfg.bundleDir, "fast_page.js") : join(cfg.public, url);
  if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const profile = join(tmpdir(), "mc2_fast_" + process.pid);
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ["--headless", "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit", "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { stdio: "ignore" });
// A page that dies before posting /done would otherwise leave this waiting forever
const limit = setTimeout(() => { console.log(`ERROR no /done after ${cfg.timeoutS}s`); process.exitCode = 1; finish(); }, cfg.timeoutS * 1000);
await finished;
clearTimeout(limit);
chrome.kill();
server.close();
server.closeAllConnections?.();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it for a moment */ }
process.exit(process.exitCode ?? 0);
