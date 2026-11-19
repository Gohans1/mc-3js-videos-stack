// The studio for one film; HELP below
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { createActivity } from "./activity.mjs";
import { createApi } from "./api.mjs";
import { createCliRunner } from "./cli-runner.ts";
import { cliArgs } from "./cli.mjs";
import { openFavorites } from "./favorites.mjs";
import { openFilm } from "./film.mjs";
import { openLessonFiles } from "./lesson-files.mjs";
import { buildPage } from "./page.mjs";
import { openVoiceLibrary } from "./voice-library.mjs";
import { openVoicePlayground } from "./voice-playground.mjs";

const HELP = `The studio for one film: a live preview the creator watches and edits, with the timeline, notes and render. Run
inside the film (or set LIVE_PROJECT); package.json's studio script carries the film's port.
  bun run studio            then open http://localhost:<port>, or the Tailscale link it prints
  bun run studio --detach   start in the background, wait until ready, print URLs, pid and log path
  bun run studio --status   check whether this film's studio is running and print its URL and pid
  bun run studio --stop     stop this film's recorded studio process
  bun run studio --lan      reachable from other machines on the network too (combinable with --detach)
Saving the film's code offers "New version" on the page, never reloading it unasked; saving sound.py or anything
package.json lists under "live-studio".sound remixes. Problems with the film's data print here (offline: bun run check).
Ctrl+C or --stop stops it; a port still taken after that belongs to a studio left running.`;

const DETACH_TIMEOUT_MS = 30000;
const DETACH_POLL_MS = 150;

const canonicalPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

export const sameProjectPath = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ra = canonicalPath(a),
    rb = canonicalPath(b);
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
};

export const readStudioInfo = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const tailscaleHostsForPort = (raw, port) => {
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
          /^https?:\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/.exec(h?.Proxy ?? "")?.[2] ===
          String(port),
      ),
    )
    .map(([host]) => host);
};

// No password here, so nothing but this machine and names the film lists may even ask. A website can point its own name at
// this machine (DNS rebinding), or make the visitor's browser ask it for something. Browsers say where a request comes from
// (Fetch Metadata): another site may link to the studio, nothing more. Origin covers the browsers that don't say
export const isKnownHost = (host, hosts = []) => {
  const n = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  return n === "localhost" || n === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(n) || hosts.includes(n);
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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const probeStudio = async (port, { allowBuildError = false } = {}) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok || (allowBuildError && res.status === 503);
  } catch {
    return false;
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

// The link the creator opens: the Tailscale https names that serve this port. Hosts confirmed by local `tailscale serve`
// for this exact port are allowed automatically via film.allowHost(name), without opening any other hostname.
function tailscaleLink(film, port) {
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
          const name = host.replace(/:\d+$/, "").toLowerCase();
          film.allowHost(name);
          const url = `https://${host}`;
          links.push(url);
          console.log(`creator's link: ${url}`);
        }
        done(links);
      },
    );
  });
}

async function runStatus(project, studioJson, studioLog) {
  const info = readStudioInfo(studioJson);
  const running =
    info &&
    sameProjectPath(info.project, project) &&
    Number.isInteger(info.port) &&
    (!Number.isInteger(info.pid) || isPidAlive(info.pid)) &&
    (await probeStudio(info.port, { allowBuildError: true }));
  if (!running) {
    console.log(`studio is not running (${project})`);
    process.exit(1);
  }
  console.log(`studio running at http://localhost:${info.port}`);
  for (const url of info.tailscale ?? []) console.log(`creator's link: ${url}`);
  console.log(`pid: ${info.pid ?? "unknown"}`);
  console.log(`project: ${project}`);
  if (existsSync(studioLog)) console.log(`log: ${studioLog}`);
  process.exit(0);
}

async function runStop(project, studioJson) {
  if (!existsSync(studioJson)) {
    console.log("studio is not running");
    process.exit(0);
  }
  const info = readStudioInfo(studioJson);
  if (!info) {
    console.error("renders/live/studio.json is unreadable: refusing to stop anything");
    process.exit(1);
  }
  if (!sameProjectPath(info.project, project)) {
    console.error(
      `renders/live/studio.json belongs to another film (${info.project ?? "unknown"}): refusing to stop pid ${info.pid ?? "unknown"}`,
    );
    process.exit(1);
  }
  if (!Number.isInteger(info.pid) || info.pid <= 0 || info.pid === process.pid) {
    console.error("renders/live/studio.json has no valid pid: cannot stop safely");
    process.exit(1);
  }
  if (!isPidAlive(info.pid)) {
    if (readStudioInfo(studioJson)?.pid === info.pid) rmSync(studioJson, { force: true });
    console.log(`studio is not running (cleared stale pid ${info.pid})`);
    process.exit(0);
  }
  const stopped = await terminatePid(info.pid);
  if (!stopped) {
    console.error(`could not stop studio pid ${info.pid}`);
    process.exit(1);
  }
  if (readStudioInfo(studioJson)?.pid === info.pid) rmSync(studioJson, { force: true });
  console.log(`stopped studio (pid ${info.pid}, port ${info.port})`);
  process.exit(0);
}

async function runDetach(project, work, studioJson, studioLog, portArg, port, lan) {
  const existing = readStudioInfo(studioJson);
  if (
    existing &&
    sameProjectPath(existing.project, project) &&
    Number.isInteger(existing.port) &&
    (!Number.isInteger(existing.pid) || isPidAlive(existing.pid)) &&
    (await probeStudio(existing.port, { allowBuildError: true }))
  ) {
    console.error(
      `this film's studio already runs at http://localhost:${existing.port}${existing.pid ? ` (pid ${existing.pid})` : ""}: use that one, or stop it first (bun run studio --stop)`,
    );
    process.exit(1);
  }
  mkdirSync(work, { recursive: true });
  const logFd = openSync(studioLog, "w");
  const childArgs = [
    fileURLToPath(import.meta.url),
    ...(portArg ? [portArg] : []),
    ...(lan ? ["--lan"] : []),
  ];
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
      console.error(`studio failed to start: ${spawnErr.message}`);
      const tail = logTail(studioLog);
      if (tail) console.error(tail);
      process.exit(1);
    }
    if (exited) {
      const why = exited.code !== null ? `code ${exited.code}` : `signal ${exited.signal}`;
      console.error(`studio exited early (${why})`);
      const tail = logTail(studioLog);
      if (tail) console.error(tail);
      process.exit(1);
    }
    const info = readStudioInfo(studioJson);
    if (
      info &&
      info.pid === child.pid &&
      info.port === port &&
      sameProjectPath(info.project, project) &&
      (await probeStudio(port))
    ) {
      child.unref();
      console.log(`live at http://localhost:${port}`);
      for (const url of info.tailscale ?? []) console.log(`creator's link: ${url}`);
      console.log(`pid: ${info.pid}`);
      console.log(`log: ${studioLog}`);
      process.exit(0);
    }
    await sleep(DETACH_POLL_MS);
  }

  if (child.pid && isPidAlive(child.pid)) await terminatePid(child.pid);
  console.error(`studio did not become ready within ${DETACH_TIMEOUT_MS / 1000}s`);
  const tail = logTail(studioLog);
  if (tail) console.error(tail);
  process.exit(1);
}

async function main() {
  // the film's studio script puts its port first, so "bun run studio help" arrives as "<port> help"
  const argv = process.argv.slice(2);
  const portArg = /^\d+$/.test(argv[0] ?? "") ? argv.shift() : undefined;
  if (/^\d+$/.test(argv[0] ?? "") || argv.some((a) => /^--port(=|$)/.test(a))) {
    console.error(
      `the film's port is ${portArg}, set in package.json's "studio" script: change it there, not here (bun run studio)`,
    );
    process.exit(2);
  }
  cliArgs(HELP, ["--lan", "--detach", "--stop", "--status"], 0, argv);
  const PORT = Number(portArg) || 4321;
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
    console.error("--lan only applies when starting the studio (--help for more)");
    process.exit(2);
  }

  const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
  if (DETACH || STOP || STATUS) {
    if (!existsSync(join(PROJECT, "src/scene.ts"))) {
      console.error(`${PROJECT} has no src/scene.ts: run this inside a film, or try bun run demo`);
      process.exit(1);
    }
    const work = join(PROJECT, "renders/live");
    const studioJson = join(work, "studio.json");
    const studioLog = join(work, "studio.log");
    if (STATUS) return runStatus(PROJECT, studioJson, studioLog);
    if (STOP) return runStop(PROJECT, studioJson);
    return runDetach(PROJECT, work, studioJson, studioLog, portArg, PORT, LAN);
  }

  const events = new Set(); // open pages, see /api/events
  const send = (event, data = "") => {
    for (const page of events) page.writeSSE({ event, data: String(data) });
  }; // a page that left is dropped by /api/events itself
  const activity = createActivity(send);
  let film;
  try {
    film = openFilm(PROJECT, { send, activity });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const studioJsonPath = join(film.WORK, "studio.json");
  // One studio per film: it owns notes.jsonl, and note.mjs done finds it through renders/live/studio.json, which a second one
  // would take over
  try {
    const existing = readStudioInfo(studioJsonPath);
    if (
      existing &&
      existing.port !== PORT &&
      (!Number.isInteger(existing.pid) || isPidAlive(existing.pid)) &&
      (
        await fetch(`http://127.0.0.1:${existing.port}/api/notes`, {
          signal: AbortSignal.timeout(1500),
        })
      ).ok
    ) {
      console.error(
        `this film's studio already runs at http://localhost:${existing.port}: use that one, or stop it first`,
      );
      process.exit(1);
    }
  } catch {
    /* none recorded, or it no longer answers */
  }

  let broken = false;
  const page = await buildPage(film, {
    // A build made only because the studio saved the sound lanes or the camera keys is no new code for the creator to load: the
    // page has them already
    onChange: (files) => {
      const own = film.ownWrites(),
        others = files.filter((f) => !own.includes(resolve(f)));
      send("code", files.length && !others.length ? "own" : "");
      // the page's build holds the studio's own code too: named as such, the film's files by their path in it
      // one build has named the same file twice (seen: "studio Compose.tsx, studio Compose.tsx")
      const names = [
        ...new Set(
          others.map((f) => {
            const r = relative(film.PROJECT, resolve(f));
            return r.startsWith("..") || isAbsolute(r)
              ? `studio ${basename(f)}`
              : r.replaceAll("\\", "/");
          }),
        ),
      ];
      if (names.length)
        activity.add({
          surface: "film",
          say: `Changed the code: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`,
        });
      if (broken)
        activity.add({ say: "The film's code builds again", level: "ok", surface: "film" });
      broken = false;
    },
    onError: (message, first) => {
      send("build-error", message); // Vite prints it in this terminal itself
      // once as it breaks: each save while broken shows its own error on the page already
      if (!broken) {
        // "[builtin:vite-transform] Unexpected token": the plugin's name says nothing to the creator. A transform error has no id;
        // loc's line is counted in the code after its TypeScript is stripped (seen 344 for 367), so no line is named
        const what = stripVTControlCharacters(first?.message ?? "")
            .split("\n")[0]
            .replace(/^\[[^\]]*\]\s*/, "")
            .trim(),
          file = first?.id ? relative(film.PROJECT, first.id).replaceAll("\\", "/") : "",
          where = file && !what.includes(file) ? ` (${file})` : "";
        activity.add({
          say: `The film's code does not build${what ? `: ${what.slice(0, 120)}` : ""}${where}`,
          level: "fail",
          surface: "film",
        });
      }
      broken = true;
    },
  });

  const fromElsewhere = (req, host) => {
    const site = req.headers.get("sec-fetch-site");
    if (site)
      return (
        site !== "same-origin" &&
        site !== "none" &&
        !(
          req.method === "GET" &&
          req.headers.get("sec-fetch-mode") === "navigate" &&
          req.headers.get("sec-fetch-dest") === "document"
        )
      );
    if (req.method === "GET" || req.method === "HEAD") return false;
    const origin = req.headers.get("origin");
    try {
      return !!origin && new URL(origin).host !== host;
    } catch {
      return true;
    }
  };

  // The lessons the AI keeps (bun run note learned, or its own edit): both global and this film's lessons/*.md
  const globalLessons = openLessonFiles();
  const projectLessons = openLessonFiles(join(film.PROJECT, "lessons"));
  const lessons = { all: globalLessons, film: projectLessons };
  const voiceLibrary = openVoiceLibrary({
    project: film.PROJECT,
    onEvent: () => send("voice-library"),
  });
  const cliRunner = createCliRunner(film);
  const favorites = openFavorites();
  const voicePlayground = openVoicePlayground({
    project: film.PROJECT,
    archiveExpiry: true,
    voice: film.voice,
    audioFavorites: favorites,
    cachedVoices: voiceLibrary.voices,
    onAudioFavoritesChanged: () => send("favorites"),
    onEvent: (payload) => send("voice-playground", JSON.stringify(payload)),
    onVoiceChanged: () => send("voice"),
  });
  const api = createApi(film, {
    page,
    events,
    send,
    activity,
    lessons,
    voiceLibrary,
    favorites,
    voicePlayground,
    port: PORT,
    cliRunner,
  });
  const cleanStudioFile = () => {
    const cur = readStudioInfo(studioJsonPath);
    if (cur?.pid === process.pid && sameProjectPath(cur.project, film.PROJECT)) {
      rmSync(studioJsonPath, { force: true });
    }
  };
  const stopCli = () => cliRunner.stopActive();
  process.once("exit", () => {
    stopCli();
    cleanStudioFile();
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      stopCli();
      film.stop();
      cleanStudioFile();
      process.exit(0);
    });
  }
  film.start();
  const watchLessons = (store, scope, label) =>
    store.watch((paths) => {
      send("lessons");
      const keys = paths.map((p) => `${scope}:${p}`);
      activity.add({
        say:
          paths.length === 1
            ? `Changed the ${label} lesson ${paths[0]}`
            : `Changed ${paths.length} ${label} lessons: ${paths.slice(0, 4).join(", ")}${paths.length > 4 ? ", …" : ""}`,
        lessons: keys.slice(0, 20),
      });
    });
  watchLessons(projectLessons, "film", "film");
  if (resolve(projectLessons.dir) !== resolve(globalLessons.dir))
    watchLessons(globalLessons, "all", "global");

  // This machine only, unless asked: --lan opens it to the network for a phone, and nothing here asks for a password
  const serve = {
    port: PORT,
    idleTimeout: 255,
    async fetch(req, server) {
      server.timeout(req, 0);
      const host = req.headers.get("host");
      if (!isKnownHost(host, film.hosts) || fromElsewhere(req, host))
        return new Response(null, { status: 403 });
      try {
        decodeURI(new URL(req.url).pathname);
      } catch {
        return new Response(null, { status: 400 });
      } // a path no file can have, before Hono trips on it
      const res = await api.fetch(req);
      // Another site can't load the film as a script, or show the studio in a frame to steal clicks
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
  // The browser tries localhost's IPv6 address first, and on Windows a refused one costs ~300 ms per new connection
  try {
    Bun.serve({ ...serve, hostname: "::1" });
  } catch {
    /* no IPv6 loopback: localhost is 127.0.0.1 alone */
  }
  console.log(`live at http://localhost:${PORT}`);
  const tailscale = await tailscaleLink(film, PORT);
  writeFileSync(
    studioJsonPath,
    JSON.stringify({
      port: PORT,
      project: film.PROJECT,
      pid: process.pid,
      ...(tailscale.length ? { tailscale } : {}),
    }),
  ); // where note.mjs done, --status, and --stop find the studio that owns this film
  if (LAN)
    for (const nets of Object.values(networkInterfaces()))
      for (const n of nets)
        if (n.family === "IPv4" && !n.internal)
          console.log(
            `no password: anyone on this network can open http://${n.address}:${PORT} and change the notes. tailscale serve is the safe way to a phone`,
          );
}

if (import.meta.main) {
  await main();
}
