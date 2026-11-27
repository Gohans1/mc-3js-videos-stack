import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs } from "./cli.mjs";

const HELP = `Live Studio Lite for one film: lightweight desktop & mobile video review & notes with zero file watchers and zero Three.js.
Run inside the film (or set LIVE_PROJECT). Defaults to the film's studio port + 1000 (fallback 5321).
  bun run studio:lite [port]            start in the foreground and open http://localhost:<port> (or Tailscale link)
  bun run studio:lite [port] --detach   start in the background, wait for readiness, print URLs, pid and log path
  bun run studio:lite --status          check whether this film's lite studio is running and print its URL and pid
  bun run studio:lite --stop            stop this film's recorded lite studio process
  bun run studio:lite [port] --lan      reachable from other machines on the network too (combinable with --detach)
Pass the film's studio port explicitly (when full studio is stopped) to reuse an existing Tailscale Serve route.
Process state is stored in renders/live/studio-lite.json (separate from full studio's studio.json).`;

const DETACH_TIMEOUT_MS = 60_000;
const DETACH_POLL_MS = 100;
const RETRYABLE_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const canonicalPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

export const sameProjectPath = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ra = canonicalPath(a);
  const rb = canonicalPath(b);
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
};

export const defaultLitePort = (projectDir) => {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    const match = /live\.mjs\s+(\d+)/.exec(pkg?.scripts?.studio ?? "");
    if (match) {
      const candidate = Number(match[1]) + 1000;
      if (Number.isInteger(candidate) && candidate >= 1024 && candidate <= 65535) return candidate;
    }
  } catch {}
  return 5321;
};

const readStudioInfo = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeStudioInfo = async (file, info) => {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(info));
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(tmp, file);
        return;
      } catch (e) {
        if (!RETRYABLE_RENAME.has(e?.code) || attempt >= 5) throw e;
        await sleep(25 * (attempt + 1));
      }
    }
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    throw e;
  }
};

const tailscaleHostsForPort = (raw, port) => {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const web = parsed?.Web;
  if (!web || typeof web !== "object") return [];
  return Object.entries(web)
    .filter(([, w]) =>
      Object.values(w?.Handlers ?? {}).some(
        (h) =>
          /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d+)\/?$/i.exec(h?.Proxy ?? "")?.[2] ===
          String(port),
      ),
    )
    .map(([host]) => host);
};

const normHost = (name) =>
  String(name ?? "")
    .trim()
    .replace(/:\d+$/, "")
    .toLowerCase();

const isKnownHost = (host, hosts = []) => {
  const n = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (n === "localhost" || n === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(n)) return true;
  const allowed = typeof hosts === "function" ? hosts() : hosts;
  return allowed.includes(n);
};

const fromElsewhere = (req, host) => {
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    return (
      site !== "same-origin" &&
      site !== "none" &&
      !(
        req.method === "GET" &&
        req.headers.get("sec-fetch-mode") === "navigate" &&
        req.headers.get("sec-fetch-dest") === "document"
      )
    );
  }
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  try {
    return !!origin && new URL(origin).host !== host;
  } catch {
    return true;
  }
};

const createHostAllowlist = (projectDir) => {
  const hostsFile = join(projectDir, ".live_hosts");
  let stamp = "";
  let fileHosts = [];
  const runtimeHosts = new Set();
  const readFileHosts = () => {
    let st;
    try {
      st = statSync(hostsFile, { throwIfNoEntry: false });
    } catch {
      fileHosts = [];
      stamp = "";
      return fileHosts;
    }
    const nextStamp = st?.isFile() ? `${st.mtimeMs}:${st.ctimeMs}:${st.size}` : "missing";
    if (nextStamp !== stamp) {
      stamp = nextStamp;
      if (nextStamp === "missing") {
        fileHosts = [];
      } else {
        try {
          fileHosts = readFileSync(hostsFile, "utf8").split(/\s+/).map(normHost).filter(Boolean);
        } catch {
          fileHosts = [];
          stamp = "";
        }
      }
    }
    return fileHosts;
  };
  return {
    allow: (name) => {
      const clean = normHost(name);
      if (clean) runtimeHosts.add(clean);
      return clean;
    },
    list: () => [...new Set([...readFileHosts(), ...runtimeHosts])],
  };
};

const splitCmdline = (cmdline) => {
  const args = [];
  let cur = "";
  let inQuotes = false;
  let inToken = false;
  for (let i = 0; i < cmdline.length; i += 1) {
    const ch = cmdline[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      inToken = true;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (inToken) {
        args.push(cur);
        cur = "";
        inToken = false;
      }
    } else {
      cur += ch;
      inToken = true;
    }
  }
  if (inQuotes) return null;
  if (inToken) args.push(cur);
  return args;
};

export const isLiteProcessCmdline = (cmdline, expectedPort) => {
  let tokens;
  if (Array.isArray(cmdline)) {
    if (!cmdline.every((t) => typeof t === "string")) return false;
    tokens = cmdline;
  } else if (typeof cmdline === "string" && cmdline.trim()) {
    tokens = splitCmdline(cmdline);
  } else {
    return false;
  }
  if (!tokens || tokens.length < 2) return false;
  const exe = tokens[0].replace(/^.*[\\/]/, "").toLowerCase();
  if (exe !== "bun" && exe !== "bun.exe") return false;
  const scriptIdx = tokens[1].toLowerCase() === "run" ? 2 : 1;
  const script = tokens[scriptIdx];
  if (!script || script.replace(/^.*[\\/]/, "").toLowerCase() !== "lite.mjs") return false;
  const rest = tokens.slice(scriptIdx + 1);
  const portArg = /^\d+$/.test(rest[0] ?? "") ? rest[0] : undefined;
  const flags = portArg ? rest.slice(1) : rest;
  if (flags.some((a) => a !== "--lan")) return false;
  if (Number.isInteger(expectedPort) && portArg !== undefined) {
    return Number(portArg) === expectedPort;
  }
  return true;
};

const readProcessCmdline = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: true, cmdline: null };
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).CommandLine`,
      ],
      { encoding: "utf8", timeout: 12_000, windowsHide: true },
    );
    if (r.error || r.status !== 0) return { ok: false, cmdline: null };
    const line = (r.stdout ?? "").trim();
    return { ok: true, cmdline: line || null };
  }
  if (process.platform === "linux") {
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!raw) return { ok: true, cmdline: null };
      const argv = (raw.endsWith("\0") ? raw.slice(0, -1) : raw).split("\0");
      return { ok: true, cmdline: argv.length ? argv : null };
    } catch (e) {
      if (e?.code === "ENOENT" || e?.code === "ESRCH") return { ok: true, cmdline: null };
      return { ok: false, cmdline: null };
    }
  }
  const r = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (r.error) return { ok: false, cmdline: null };
  const line = (r.stdout ?? "").trim();
  return { ok: true, cmdline: r.status === 0 && line ? line : null };
};

const isPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};

const probeLite = async (port, project) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/film.json`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { ok: false, otherProject: null };
    const meta = await res.json();
    if (!meta || typeof meta !== "object") return { ok: false, otherProject: null };
    if (sameProjectPath(meta.project, project) && meta.port === port && meta.lite === true) {
      return { ok: true, meta, otherProject: null };
    }
    return {
      ok: false,
      otherProject: typeof meta.project === "string" ? meta.project : null,
    };
  } catch {
    return { ok: false, otherProject: null };
  }
};

const logTail = (file, maxLines = 30) => {
  try {
    const text = readFileSync(file, "utf8").trimEnd();
    if (!text) return "";
    return text.split(/\r?\n/).slice(-maxLines).join("\n");
  } catch {
    return "";
  }
};

const terminatePid = async (pid) => {
  if (!isPidAlive(pid)) return true;
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    if (e?.code === "ESRCH") return true;
  }
  const gracefulEnd = Date.now() + 5000;
  while (Date.now() < gracefulEnd) {
    if (!isPidAlive(pid)) return true;
    await sleep(50);
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {}
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  const hardEnd = Date.now() + 2000;
  while (Date.now() < hardEnd) {
    if (!isPidAlive(pid)) return true;
    await sleep(50);
  }
  return !isPidAlive(pid);
};

function tailscaleLink(hosts, port) {
  return new Promise((done) => {
    execFile(
      "tailscale",
      ["serve", "status", "--json"],
      { timeout: 3000, windowsHide: true },
      (e, out) => {
        let parsed = null;
        let web = null;
        try {
          parsed = JSON.parse(out);
          web = parsed?.Web ?? {};
        } catch {}
        if (e || !web) {
          console.log(
            "Tailscale is not answering: start the Tailscale app (often not running after a reboot); its links come back with it",
          );
          done([]);
          return;
        }
        const mine = tailscaleHostsForPort(parsed, port);
        if (!mine.length) {
          console.log(
            `no Tailscale link to port ${port}: tailscale serve --bg --https=<a free port> http://127.0.0.1:${port}`,
          );
          done([]);
          return;
        }
        const links = [];
        for (const host of mine) {
          hosts.allow(host);
          const url = `https://${host}`;
          links.push(url);
          console.log(`creator's link: ${url}`);
        }
        done(links);
      },
    );
  });
}

async function runStatus(project, infoFile, logFile) {
  const info = readStudioInfo(infoFile);
  const running =
    info &&
    sameProjectPath(info.project, project) &&
    Number.isInteger(info.port) &&
    (!Number.isInteger(info.pid) || isPidAlive(info.pid)) &&
    (await probeLite(info.port, project)).ok;
  if (!running) {
    console.log(`studio:lite is not running (${project})`);
    process.exit(1);
  }
  console.log(`studio:lite running at http://localhost:${info.port}`);
  for (const url of Array.isArray(info.tailscale) ? info.tailscale : []) {
    console.log(`creator's link: ${url}`);
  }
  console.log(`pid: ${info.pid ?? "unknown"}`);
  console.log(`project: ${project}`);
  if (existsSync(logFile)) console.log(`log: ${logFile}`);
  process.exit(0);
}

async function runStop(project, infoFile) {
  if (!existsSync(infoFile)) {
    console.log("studio:lite is not running");
    process.exit(0);
  }
  const info = readStudioInfo(infoFile);
  if (!info) {
    console.error("renders/live/studio-lite.json is unreadable: refusing to stop anything");
    process.exit(1);
  }
  if (!sameProjectPath(info.project, project)) {
    console.error(
      `renders/live/studio-lite.json belongs to another film (${info.project ?? "unknown"}): refusing to stop pid ${info.pid ?? "unknown"}`,
    );
    process.exit(1);
  }
  if (!Number.isInteger(info.pid) || info.pid <= 0 || info.pid === process.pid) {
    console.error("renders/live/studio-lite.json has no valid pid: cannot stop safely");
    process.exit(1);
  }
  if (!Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) {
    console.error("renders/live/studio-lite.json has no valid port: cannot stop safely");
    process.exit(1);
  }
  if (!isPidAlive(info.pid)) {
    if (readStudioInfo(infoFile)?.pid === info.pid) rmSync(infoFile, { force: true });
    console.log(`studio:lite is not running (cleared stale pid ${info.pid})`);
    process.exit(0);
  }
  const probe = await probeLite(info.port, project);
  const proc = readProcessCmdline(info.pid);
  if (!proc.ok) {
    console.error(`could not verify studio:lite process pid ${info.pid}: refusing to stop`);
    process.exit(1);
  }
  if (!proc.cmdline) {
    if (isPidAlive(info.pid) && probe.ok) {
      console.error(
        `could not read command line for running studio:lite pid ${info.pid}: refusing to stop`,
      );
      process.exit(1);
    }
    if (readStudioInfo(infoFile)?.pid === info.pid) rmSync(infoFile, { force: true });
    console.log(`studio:lite is not running (cleared stale pid ${info.pid})`);
    process.exit(0);
  }
  if (!isLiteProcessCmdline(proc.cmdline, info.port)) {
    if (!probe.ok) {
      if (readStudioInfo(infoFile)?.pid === info.pid) rmSync(infoFile, { force: true });
      console.log(
        `studio:lite is not running (pid ${info.pid} is not a studio:lite process; cleared stale studio-lite.json)`,
      );
      process.exit(0);
    }
    console.error(`pid ${info.pid} is not a studio:lite process: refusing to stop it`);
    process.exit(1);
  }
  if (probe.otherProject && !sameProjectPath(probe.otherProject, project)) {
    console.error(
      `port ${info.port} is serving another film (${probe.otherProject}): refusing to stop pid ${info.pid}`,
    );
    process.exit(1);
  }
  const stopped = await terminatePid(info.pid);
  if (!stopped) {
    console.error(`could not stop studio:lite pid ${info.pid}`);
    process.exit(1);
  }
  if (readStudioInfo(infoFile)?.pid === info.pid) rmSync(infoFile, { force: true });
  console.log(`stopped studio:lite (pid ${info.pid}, port ${info.port})`);
  process.exit(0);
}

async function runDetach(project, work, infoFile, logFile, port, lan) {
  const existing = readStudioInfo(infoFile);
  if (
    existing &&
    sameProjectPath(existing.project, project) &&
    Number.isInteger(existing.port) &&
    (!Number.isInteger(existing.pid) || isPidAlive(existing.pid)) &&
    (await probeLite(existing.port, project)).ok
  ) {
    console.error(
      `this film's studio:lite already runs at http://localhost:${existing.port}${existing.pid ? ` (pid ${existing.pid})` : ""}: use that one, or stop it first (bun run studio:lite --stop)`,
    );
    process.exit(1);
  }
  mkdirSync(work, { recursive: true });
  const logFd = openSync(logFile, "w");
  const childArgs = [fileURLToPath(import.meta.url), String(port), ...(lan ? ["--lan"] : [])];
  let child;
  try {
    child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: { ...process.env, LIVE_PROJECT: project },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  let exited = null;
  let spawnErr = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  child.once("error", (err) => {
    spawnErr = err;
  });

  const deadline = Date.now() + DETACH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnErr) {
      console.error(`studio:lite failed to start: ${spawnErr.message}`);
      const tail = logTail(logFile);
      if (tail) console.error(tail);
      process.exit(1);
    }
    if (exited) {
      const why = exited.code !== null ? `code ${exited.code}` : `signal ${exited.signal}`;
      console.error(`studio:lite exited early (${why})`);
      const tail = logTail(logFile);
      if (tail) console.error(tail);
      process.exit(1);
    }
    const info = readStudioInfo(infoFile);
    if (
      info &&
      info.pid === child.pid &&
      info.port === port &&
      sameProjectPath(info.project, project) &&
      (await probeLite(port, project)).ok
    ) {
      child.unref();
      console.log(`studio:lite live at http://localhost:${port}`);
      for (const url of Array.isArray(info.tailscale) ? info.tailscale : []) {
        console.log(`creator's link: ${url}`);
      }
      console.log(`pid: ${info.pid}`);
      console.log(`log: ${logFile}`);
      process.exit(0);
    }
    await sleep(DETACH_POLL_MS);
  }

  if (child.pid && isPidAlive(child.pid)) await terminatePid(child.pid);
  if (readStudioInfo(infoFile)?.pid === child.pid) rmSync(infoFile, { force: true });
  console.error(`studio:lite did not become ready within ${DETACH_TIMEOUT_MS / 1000}s`);
  const tail = logTail(logFile);
  if (tail) console.error(tail);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const portArg = /^\d+$/.test(argv[0] ?? "") ? argv.shift() : undefined;
  if (/^\d+$/.test(argv[0] ?? "") || argv.some((a) => /^--port(=|$)/.test(a))) {
    console.error(
      "pass at most one positional port (bun run studio:lite [port] [--detach|--lan]); do not use --port",
    );
    process.exit(2);
  }
  cliArgs(HELP, ["--lan", "--detach", "--stop", "--status"], 0, argv);
  if (portArg !== undefined) {
    const parsed = Number(portArg);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      console.error(`port must be a number from 1024 to 65535, got ${portArg}`);
      process.exit(2);
    }
  }
  const LAN = argv.includes("--lan");
  const DETACH = argv.includes("--detach");
  const STOP = argv.includes("--stop");
  const STATUS = argv.includes("--status");
  const modes = [DETACH && "--detach", STOP && "--stop", STATUS && "--status"].filter(Boolean);
  if (modes.length > 1) {
    console.error(`choose only one of ${modes.join(", ")} (--help for more)`);
    process.exit(2);
  }
  if (LAN && (STOP || STATUS)) {
    console.error("--lan only applies when starting studio:lite (--help for more)");
    process.exit(2);
  }

  const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
  if (!existsSync(join(PROJECT, "src/scene.ts"))) {
    console.error(`${PROJECT} has no src/scene.ts: run this inside a film, or try bun run demo`);
    process.exit(1);
  }

  const PORT = portArg ? Number(portArg) : defaultLitePort(PROJECT);
  const work = join(PROJECT, "renders/live");
  const infoFile = join(work, "studio-lite.json");
  const logFile = join(work, "studio-lite.log");

  if (STATUS) return runStatus(PROJECT, infoFile, logFile);
  if (STOP) return runStop(PROJECT, infoFile);
  if (DETACH) return runDetach(PROJECT, work, infoFile, logFile, PORT, LAN);

  const existing = readStudioInfo(infoFile);
  if (
    existing &&
    sameProjectPath(existing.project, PROJECT) &&
    Number.isInteger(existing.port) &&
    (!Number.isInteger(existing.pid) || isPidAlive(existing.pid)) &&
    (await probeLite(existing.port, PROJECT)).ok
  ) {
    console.error(
      `this film's studio:lite already runs at http://localhost:${existing.port}${existing.pid ? ` (pid ${existing.pid})` : ""}: use that one, or stop it first (bun run studio:lite --stop)`,
    );
    process.exit(1);
  }

  mkdirSync(work, { recursive: true });
  const buildOpts = {
    ...(process.env.LIVE_LITE_ROOT ? { root: process.env.LIVE_LITE_ROOT } : {}),
    ...(process.env.LIVE_LITE_OUT ? { outDir: process.env.LIVE_LITE_OUT } : {}),
  };
  const [{ createLiteApi }, { ensureLitePage }] = await Promise.all([
    import("./lite-api.mjs"),
    import("./lite-page.mjs"),
  ]);
  const page = await ensureLitePage(buildOpts);
  const hosts = createHostAllowlist(PROJECT);
  const api = createLiteApi({ projectDir: PROJECT, page, port: PORT });

  const cleanInfoFile = () => {
    const cur = readStudioInfo(infoFile);
    if (cur?.pid === process.pid && sameProjectPath(cur.project, PROJECT)) {
      rmSync(infoFile, { force: true });
    }
  };
  process.once("exit", cleanInfoFile);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      cleanInfoFile();
      process.exit(0);
    });
  }

  const serve = {
    port: PORT,
    idleTimeout: 255,
    async fetch(req, server) {
      server.timeout(req, 0);
      const host = req.headers.get("host");
      if (!isKnownHost(host, () => hosts.list()) || fromElsewhere(req, host)) {
        return new Response(null, { status: 403 });
      }
      try {
        decodeURI(new URL(req.url).pathname);
      } catch {
        return new Response(null, { status: 400 });
      }
      const res = await api.fetch(req);
      res.headers.set("cross-origin-resource-policy", "same-origin");
      res.headers.set(
        "content-security-policy",
        "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
      );
      res.headers.set("x-content-type-options", "nosniff");
      return res;
    },
  };

  Bun.serve({ ...serve, hostname: LAN ? "0.0.0.0" : "127.0.0.1" });
  try {
    Bun.serve({ ...serve, hostname: "::1" });
  } catch {}

  console.log(`studio:lite live at http://localhost:${PORT}${page.cached ? " (cached)" : ""}`);
  const tailscale = await tailscaleLink(hosts, PORT);
  await writeStudioInfo(infoFile, {
    port: PORT,
    project: PROJECT,
    pid: process.pid,
    mode: "lite",
    ...(tailscale.length ? { tailscale } : {}),
  });
  if (LAN) {
    for (const nets of Object.values(networkInterfaces())) {
      for (const n of nets ?? []) {
        if (n.family === "IPv4" && !n.internal) {
          console.log(
            `no password: anyone on this network can open http://${n.address}:${PORT} and change the notes. tailscale serve is the safe way to a phone`,
          );
        }
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
