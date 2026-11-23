import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { noteState } from "./note-state.mjs";

const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CACHE_TTL_MS = 2000;
const COMMAND_TIMEOUT_MS = 4000;
const WINDOWS_NETSTAT_TIMEOUT_MS = 3000;
const WINDOWS_SCAN_TIMEOUT_MS = 10_000;
const TAILSCALE_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 800;

const WINDOWS_PROCS_SCRIPT =
  "$procs = @(Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%live.mjs%'\" -ErrorAction SilentlyContinue | Select-Object ProcessId, CommandLine); @{ procs = $procs } | ConvertTo-Json -Depth 3 -Compress";

const isValidPort = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;

export const normalizePath = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  const driveMatch = /^([A-Za-z]:)(\/.*)?$/.exec(raw);
  const prefix = driveMatch ? driveMatch[1] : raw.startsWith("/") ? "/" : "";
  const rest = driveMatch ? (driveMatch[2] ?? "") : prefix ? raw.slice(1) : raw;
  const parts = [];
  for (const seg of rest.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length && parts.at(-1) !== "..") parts.pop();
      else if (!prefix) parts.push("..");
    } else {
      parts.push(seg);
    }
  }
  const joined = prefix ? `${prefix}/${parts.join("/")}` : parts.join("/");
  if (!joined) return prefix || ".";
  return joined.length > 3 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
};

const pathKey = (normalized, platform = process.platform) =>
  platform === "win32" || /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;

const baseNameOf = (normalized) => {
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
};

const isLiveCmdline = (cmdline) => {
  if (typeof cmdline !== "string" || !cmdline.trim()) return false;
  const trimmed = cmdline.trim();
  if (/^"?(?:[^"\s]*[\\/])?(?:powershell|pwsh|cmd)(?:\.exe)?(?:"|\s|$)/i.test(trimmed)) {
    return false;
  }
  return /(?:^|[\s"'\\/])live\.mjs(?=$|[\s"'])/i.test(trimmed);
};

const portFromCmdline = (cmdline) => {
  const m = /(?:^|[\s"'\\/])live\.mjs["']?\s+(\d{1,5})(?=$|\s)/i.exec(cmdline ?? "");
  if (!m) return null;
  const port = Number(m[1]);
  return isValidPort(port) ? port : null;
};

const toArray = (value) =>
  Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];

export const parseWindowsListeners = (jsonText) => {
  if (typeof jsonText !== "string" || !jsonText.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const procs = new Map();
  for (const proc of toArray(parsed.procs)) {
    if (!proc || typeof proc !== "object") continue;
    const pid = Number(proc.ProcessId ?? proc.pid);
    const cmdline = typeof proc.CommandLine === "string" ? proc.CommandLine : proc.cmdline;
    if (!Number.isInteger(pid) || pid <= 0 || !isLiveCmdline(cmdline)) continue;
    procs.set(pid, cmdline);
  }

  const deduped = new Map();
  for (const conn of toArray(parsed.conns)) {
    if (!conn || typeof conn !== "object") continue;
    const pid = Number(conn.OwningProcess ?? conn.pid);
    const cmdline = procs.get(pid);
    if (!cmdline) continue;
    const rawPort = Number(conn.LocalPort ?? conn.port);
    const port = isValidPort(rawPort) ? rawPort : portFromCmdline(cmdline);
    if (!port) continue;
    const key = `${pid}:${port}`;
    if (!deduped.has(key)) deduped.set(key, { pid, port, cmdline });
  }

  return [...deduped.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
};

export const parseNetstatListeners = (text) => {
  if (typeof text !== "string" || !text.trim()) return [];
  const deduped = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+(?:0\.0\.0\.0:0|\[::\]:0)\s+\S+\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    const port = Number(m[1]);
    const pid = Number(m[2]);
    if (!isValidPort(port) || !Number.isInteger(pid) || pid <= 0) continue;
    const key = `${pid}:${port}`;
    if (!deduped.has(key)) deduped.set(key, { port, pid });
  }
  return [...deduped.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
};

const mergeWindowsListeners = (netstatConns, psJsonText) => {
  if (typeof psJsonText !== "string" || !psJsonText.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(psJsonText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  if (netstatConns.length === 0 && parsed.conns !== undefined) {
    return parseWindowsListeners(psJsonText);
  }
  const procs = new Map();
  for (const proc of toArray(parsed.procs)) {
    if (!proc || typeof proc !== "object") continue;
    const pid = Number(proc.ProcessId ?? proc.pid);
    const cmdline = typeof proc.CommandLine === "string" ? proc.CommandLine : proc.cmdline;
    if (!Number.isInteger(pid) || pid <= 0 || !isLiveCmdline(cmdline)) continue;
    procs.set(pid, cmdline);
  }
  const deduped = new Map();
  for (const conn of netstatConns) {
    const cmdline = procs.get(conn.pid);
    if (!cmdline) continue;
    const key = `${conn.pid}:${conn.port}`;
    if (!deduped.has(key)) deduped.set(key, { pid: conn.pid, port: conn.port, cmdline });
  }
  return [...deduped.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
};

export const parsePosixListeners = (socketText, psText, kind = "lsof") => {
  if (typeof psText !== "string" || !psText.trim()) return [];
  const procs = new Map();
  for (const line of psText.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmdline = m[2];
    if (Number.isInteger(pid) && pid > 0 && isLiveCmdline(cmdline)) {
      procs.set(pid, cmdline);
    }
  }
  if (!procs.size || typeof socketText !== "string" || !socketText.trim()) return [];

  const deduped = new Map();
  if (kind === "lsof") {
    let currentPid = null;
    for (const line of socketText.split(/\r?\n/)) {
      if (line.startsWith("p")) {
        const pid = Number(line.slice(1));
        currentPid = Number.isInteger(pid) && pid > 0 ? pid : null;
      } else if (line.startsWith("n") && currentPid !== null) {
        const cmdline = procs.get(currentPid);
        if (!cmdline) continue;
        const m = /:(\d+)$/.exec(line.slice(1).trim());
        const port = m ? Number(m[1]) : null;
        if (!port || !isValidPort(port)) continue;
        const key = `${currentPid}:${port}`;
        if (!deduped.has(key)) deduped.set(key, { pid: currentPid, port, cmdline });
      }
    }
  } else {
    for (const line of socketText.split(/\r?\n/)) {
      const portMatch = /(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|\*|\[::\]):(\d+)\b/.exec(
        line,
      );
      if (!portMatch) continue;
      const port = Number(portMatch[1]);
      if (!isValidPort(port)) continue;
      for (const pidMatch of line.matchAll(/\bpid=(\d+)\b/g)) {
        const pid = Number(pidMatch[1]);
        const cmdline = procs.get(pid);
        if (!cmdline) continue;
        const key = `${pid}:${port}`;
        if (!deduped.has(key)) deduped.set(key, { pid, port, cmdline });
      }
    }
  }

  return [...deduped.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
};

export const parseWorktreeList = (porcelainText) => {
  if (typeof porcelainText !== "string" || !porcelainText.trim()) return [];
  const entries = [];
  let current = null;

  const flush = () => {
    if (!current || !current.path) return;
    entries.push({
      path: current.path,
      name: baseNameOf(current.path),
      branch: current.branch,
      isMain: entries.length === 0,
    });
    current = null;
  };

  for (const rawLine of porcelainText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: normalizePath(line.slice("worktree ".length)), branch: null };
    } else if (current && line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (current && line === "detached") {
      current.branch = null;
    }
  }
  flush();
  return entries;
};

export const parseTailscaleServe = (jsonText) => {
  if (typeof jsonText !== "string" || !jsonText.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const web = parsed?.Web;
  if (!web || typeof web !== "object") return [];

  const tcp = parsed?.TCP && typeof parsed.TCP === "object" ? parsed.TCP : {};
  const routes = [];
  const seen = new Set();

  for (const [webKey, entry] of Object.entries(web)) {
    if (!entry || typeof entry !== "object") continue;
    const portMatch = /:(\d+)$/.exec(webKey);
    const portKey = portMatch?.[1] ?? "";
    const tcpCfg = tcp[portKey];
    const scheme = tcpCfg?.HTTP && !tcpCfg?.HTTPS ? "http:" : "https:";

    let urlObj;
    try {
      urlObj = new URL(`${scheme}//${webKey.trim()}`);
    } catch {
      continue;
    }
    if (urlObj.protocol !== "https:" && urlObj.protocol !== "http:") continue;
    if (
      urlObj.username ||
      urlObj.password ||
      urlObj.pathname !== "/" ||
      urlObj.search ||
      urlObj.hash
    ) {
      continue;
    }

    const url = urlObj.origin;
    const host = urlObj.hostname.toLowerCase();
    if (!host) continue;

    const handlers = entry.Handlers && typeof entry.Handlers === "object" ? entry.Handlers : {};
    for (const handler of Object.values(handlers)) {
      const proxy = typeof handler?.Proxy === "string" ? handler.Proxy.trim() : "";
      const m = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\/?$/i.exec(proxy);
      if (!m) continue;
      const targetPort = Number(m[1]);
      if (!isValidPort(targetPort)) continue;
      const dedupeKey = `${url}|${targetPort}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      routes.push({ url, host, targetPort });
    }
  }

  return routes.sort((a, b) => a.targetPort - b.targetPort || a.url.localeCompare(b.url));
};

export const parseLiveHosts = (text) => {
  if (typeof text !== "string" || !text.trim()) return [];
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n.toLowerCase());
};

export const countNotes = (notesArray) => {
  if (!Array.isArray(notesArray)) return null;
  let open = 0;
  let check = 0;
  let done = 0;
  for (const note of notesArray) {
    if (!note || typeof note !== "object") continue;
    if (note.deleted === true || note.removed === true || note.gone === true) continue;
    const state = noteState(note);
    if (state === "open") open++;
    else if (state === "check") check++;
    else if (state === "done") done++;
  }
  return { open, check, done, total: open + check + done };
};

const safeJsonParse = (text) => {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const longestWorktreePrefix = (targetPath, worktrees, platform) => {
  const normTarget = pathKey(normalizePath(targetPath), platform);
  if (!normTarget) return null;
  let best = null;
  let bestLen = -1;
  for (const wt of worktrees) {
    const normWt = pathKey(wt.path, platform);
    if (!normWt) continue;
    const prefix = normWt.endsWith("/") ? normWt : `${normWt}/`;
    if ((normTarget === normWt || normTarget.startsWith(prefix)) && normWt.length > bestLen) {
      best = wt;
      bestLen = normWt.length;
    }
  }
  return best;
};

const findWorktreeInCmdline = (cmdline, worktrees, platform) => {
  if (typeof cmdline !== "string" || !cmdline) return null;
  const cmdNorm = cmdline.replaceAll("\\", "/");
  const sorted = [...worktrees].sort((a, b) => b.path.length - a.path.length);
  for (const wt of sorted) {
    const wtPath = normalizePath(wt.path);
    if (!wtPath) continue;
    const isWin = platform === "win32" || /^[A-Za-z]:\//.test(wtPath);
    const haystack = isWin ? cmdNorm.toLowerCase() : cmdNorm;
    const needle = isWin ? wtPath.toLowerCase() : wtPath;
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
      const before = idx === 0 ? "" : haystack[idx - 1];
      const afterIdx = idx + needle.length;
      const after = afterIdx >= haystack.length ? "" : haystack[afterIdx];
      const okBefore = !before || /[\s"']/.test(before);
      const okAfter = !after || /[/\s"']/.test(after);
      if (okBefore && okAfter) return wt;
      idx = haystack.indexOf(needle, idx + 1);
    }
  }
  return null;
};

const readWorktreeFilms = (wt, { readText, readdir }, cache) => {
  if (cache.has(wt.path)) return cache.get(wt.path);
  const filmsDir = `${wt.path}/films`;
  const dirNames = readdir(filmsDir);
  const items = [];
  if (Array.isArray(dirNames)) {
    for (const dirName of dirNames) {
      const project = `${filmsDir}/${dirName}`;
      const pkg = safeJsonParse(safeReadText(readText, `${project}/package.json`));
      const studioJson = safeJsonParse(
        safeReadText(readText, `${project}/renders/live/studio.json`),
      );
      const name = typeof pkg?.name === "string" && pkg.name.trim() ? pkg.name.trim() : dirName;
      const studioPort = isValidPort(Number(studioJson?.port)) ? Number(studioJson.port) : null;
      items.push({ wt, project, dirName, name, studioPort });
    }
  }
  cache.set(wt.path, items);
  return items;
};

function safeReadText(readText, filePath) {
  try {
    return readText(filePath);
  } catch {
    return null;
  }
}

const findFilmInWorktree = (wt, filmName, io, filmCache) => {
  if (!filmName) return null;
  const films = readWorktreeFilms(wt, io, filmCache);
  const byDir = films.find((f) => f.dirName === filmName);
  if (byDir) return byDir.project;
  const byPkgName = films.find((f) => f.name === filmName);
  if (byPkgName) return byPkgName.project;

  const candidate = `${wt.path}/films/${filmName}`;
  if (
    safeReadText(io.readText, `${candidate}/package.json`) !== null ||
    safeReadText(io.readText, `${candidate}/src/scene.ts`) !== null ||
    io.readdir(candidate) !== null
  ) {
    return candidate;
  }
  return null;
};

const matchWorktreeFilms = (worktrees, io, filmCache, predicate) => {
  const matches = [];
  const seen = new Set();
  for (const wt of worktrees) {
    for (const item of readWorktreeFilms(wt, io, filmCache)) {
      if (!predicate(item)) continue;
      if (seen.has(wt.path)) continue;
      seen.add(wt.path);
      matches.push(item);
    }
  }
  return matches;
};

export const resolveStudioWorktree = (
  { port, cmdline, filmJson, worktrees, platform = process.platform, readText, readdir },
  filmCache = new Map(),
) => {
  const io = { readText, readdir };
  const probeName =
    typeof filmJson?.name === "string" && filmJson.name.trim() ? filmJson.name.trim() : null;
  const probeProject =
    typeof filmJson?.project === "string" && filmJson.project.trim()
      ? normalizePath(filmJson.project)
      : null;

  if (probeProject) {
    const wt = longestWorktreePrefix(probeProject, worktrees, platform);
    const film = probeName ?? (baseNameOf(probeProject) || null);
    if (wt) {
      return {
        film,
        project: probeProject,
        worktree: wt,
        matchConfidence: "exact",
        candidateWorktrees: [wt],
      };
    }
    return {
      film,
      project: probeProject,
      worktree: null,
      matchConfidence: "unknown",
      candidateWorktrees: [],
    };
  }

  const cmdWt = findWorktreeInCmdline(cmdline, worktrees, platform);
  if (cmdWt) {
    const project = probeName ? findFilmInWorktree(cmdWt, probeName, io, filmCache) : null;
    return {
      film: probeName,
      project,
      worktree: cmdWt,
      matchConfidence: project ? "exact" : "inferred",
      candidateWorktrees: [cmdWt],
    };
  }

  const matchesFilmName = (item) =>
    !probeName || item.name === probeName || item.dirName === probeName;
  const portMatches = matchWorktreeFilms(
    worktrees,
    io,
    filmCache,
    (item) => item.studioPort === port && matchesFilmName(item),
  );
  const matches =
    portMatches.length > 0 || !probeName
      ? portMatches
      : matchWorktreeFilms(
          worktrees,
          io,
          filmCache,
          (item) => item.name === probeName || item.dirName === probeName,
        );

  if (matches.length === 1) {
    const hit = matches[0];
    return {
      film: probeName ?? hit.name,
      project: hit.project,
      worktree: hit.wt,
      matchConfidence: "inferred",
      candidateWorktrees: [hit.wt],
    };
  }
  if (matches.length >= 2) {
    return {
      film: probeName,
      project: null,
      worktree: null,
      matchConfidence: "ambiguous",
      candidateWorktrees: matches.map((m) => m.wt),
    };
  }

  return {
    film: probeName,
    project: null,
    worktree: null,
    matchConfidence: "unknown",
    candidateWorktrees: [],
  };
};

const defaultRunCommand = async (cmd, args, { cwd, timeoutMs = COMMAND_TIMEOUT_MS } = {}) => {
  let proc;
  try {
    proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      windowsHide: true,
    });
  } catch (err) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      timedOut: false,
    };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
  }, timeoutMs);

  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { ok: code === 0 && !timedOut, code, stdout, stderr, timedOut };
  } catch (err) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};

const defaultFetchJson = async (url, { signal } = {}) => {
  const res = await fetch(url, { signal });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, kind: "http", data: null };
  try {
    return { ok: true, status: res.status, kind: "ok", data: JSON.parse(body) };
  } catch {
    return { ok: false, status: res.status, kind: "invalid-json", data: null };
  }
};

const defaultReadText = (filePath) => {
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
};

const defaultReaddir = (dirPath) => {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
};

const normalizeProbeResult = async (fetchJson, url) => {
  try {
    const raw = await fetchJson(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (raw === null || raw === undefined) {
      return { status: "error", data: null };
    }
    if (typeof raw === "object" && "ok" in raw) {
      if (raw.ok) return { status: "ready", data: raw.data ?? null };
      return { status: "error", data: null };
    }
    return { status: "ready", data: raw };
  } catch (err) {
    if (typeof err?.httpStatus === "number" || typeof err?.statusCode === "number") {
      return { status: "error", data: null };
    }
    return { status: "unreachable", data: null };
  }
};

const isProjectAccessible = (project, readText, readdir) =>
  safeReadText(readText, join(project, "package.json")) !== null ||
  safeReadText(readText, join(project, "src/scene.ts")) !== null ||
  readdir(project) !== null;

const loadAllowedHosts = (project, { readText, readdir }, cache) => {
  if (!project) return null;
  if (cache.has(project)) return cache.get(project);

  const hostsPath = join(project, ".live_hosts");
  let result = null;
  try {
    const text = readText(hostsPath);
    if (typeof text === "string") {
      result = new Set(parseLiveHosts(text));
    } else {
      result = isProjectAccessible(project, readText, readdir) ? new Set() : null;
    }
  } catch (err) {
    result =
      err?.code === "ENOENT" && isProjectAccessible(project, readText, readdir) ? new Set() : null;
  }

  cache.set(project, result);
  return result;
};

const applyCurrentPort = (snapshot, rawCurrentPort) => {
  const currentPort = isValidPort(rawCurrentPort) ? rawCurrentPort : null;
  const studios = snapshot.studios
    .map((studio) => ({
      ...studio,
      current: currentPort !== null && studio.port === currentPort,
      candidateWorktrees: [...studio.candidateWorktrees],
      tailscale: studio.tailscale.map((ep) => ({ ...ep })),
      notes: studio.notes ? { ...studio.notes } : null,
    }))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.port !== b.port) return a.port - b.port;
      return a.pid - b.pid;
    });

  return {
    scannedAt: snapshot.scannedAt,
    currentPort,
    studios,
    tailscale: {
      available: snapshot.tailscale.available,
      error: snapshot.tailscale.error,
      unmatched: snapshot.tailscale.unmatched.map((u) => ({ ...u })),
    },
    worktrees: snapshot.worktrees.map((w) => ({ ...w })),
    warnings: [...snapshot.warnings],
  };
};

export const createPortsService = ({
  repoRoot = STUDIO_ROOT,
  platform = process.platform,
  selfPort = null,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  runCommand = defaultRunCommand,
  fetchJson = defaultFetchJson,
  readText = defaultReadText,
  readdir = defaultReaddir,
  now = () => Date.now(),
} = {}) => {
  let cached = null;
  let inflight = null;
  let inflightForced = null;

  const scanListeners = async (warnings) => {
    if (platform === "win32") {
      const [netstatRes, psRes] = await Promise.all([
        runCommand("netstat", ["-ano"], { timeoutMs: WINDOWS_NETSTAT_TIMEOUT_MS }),
        runCommand(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCS_SCRIPT],
          { timeoutMs: WINDOWS_SCAN_TIMEOUT_MS },
        ),
      ]);
      const netstatConns = netstatRes.ok ? parseNetstatListeners(netstatRes.stdout) : [];
      if (!psRes.ok) {
        return {
          listeners: [],
          netstatConns,
          processFailed: true,
          timedOut: Boolean(psRes.timedOut),
          errorReason: psRes.timedOut
            ? "timed out"
            : (psRes.stderr || psRes.stdout || "powershell error").trim().slice(0, 160),
        };
      }
      return {
        listeners: mergeWindowsListeners(netstatConns, psRes.stdout),
        netstatConns,
        processFailed: false,
        timedOut: false,
        errorReason: null,
      };
    }

    const [lsofRes, psRes] = await Promise.all([
      runCommand("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], {
        timeoutMs: COMMAND_TIMEOUT_MS,
      }),
      runCommand("ps", ["-ax", "-o", "pid=,args="], { timeoutMs: COMMAND_TIMEOUT_MS }),
    ]);
    if (!psRes.ok) {
      warnings.push(`Process scan failed: ${(psRes.stderr || "ps error").trim().slice(0, 160)}`);
      return {
        listeners: [],
        netstatConns: [],
        processFailed: true,
        timedOut: Boolean(psRes.timedOut),
        errorReason: null,
      };
    }
    if (lsofRes.ok) {
      return {
        listeners: parsePosixListeners(lsofRes.stdout, psRes.stdout, "lsof"),
        netstatConns: [],
        processFailed: false,
        timedOut: false,
        errorReason: null,
      };
    }

    const ssRes = await runCommand("ss", ["-ltnp"], { timeoutMs: COMMAND_TIMEOUT_MS });
    if (ssRes.ok) {
      return {
        listeners: parsePosixListeners(ssRes.stdout, psRes.stdout, "ss"),
        netstatConns: [],
        processFailed: false,
        timedOut: false,
        errorReason: null,
      };
    }

    warnings.push("Listener scan failed: neither lsof nor ss succeeded");
    return {
      listeners: [],
      netstatConns: [],
      processFailed: true,
      timedOut: false,
      errorReason: null,
    };
  };

  const scanWorktrees = async (warnings) => {
    const primaryRoot = repoRoot || STUDIO_ROOT;
    let res = await runCommand("git", ["worktree", "list", "--porcelain"], {
      cwd: primaryRoot,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (!res.ok && resolve(primaryRoot) !== resolve(STUDIO_ROOT)) {
      res = await runCommand("git", ["worktree", "list", "--porcelain"], {
        cwd: STUDIO_ROOT,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
    }
    if (!res.ok) {
      warnings.push(
        `Git worktree scan failed: ${(res.stderr || "git error").trim().slice(0, 160)}`,
      );
      return [];
    }
    return parseWorktreeList(res.stdout);
  };

  const scanTailscale = async () => {
    const res = await runCommand("tailscale", ["serve", "status", "--json"], {
      timeoutMs: TAILSCALE_TIMEOUT_MS,
    });
    if (!res.ok) {
      const error = res.timedOut
        ? "Tailscale status timed out"
        : (res.stderr || res.stdout || "Tailscale unavailable").trim().slice(0, 200);
      return {
        available: false,
        error,
        routes: [],
      };
    }
    try {
      JSON.parse(res.stdout || "{}");
    } catch {
      return {
        available: false,
        error: "Invalid JSON from tailscale serve status",
        routes: [],
      };
    }
    return {
      available: true,
      error: null,
      routes: parseTailscaleServe(res.stdout),
    };
  };

  const runScan = async () => {
    const warnings = [];
    const [listenerMeta, worktrees, tailscaleScan] = await Promise.all([
      scanListeners(warnings),
      scanWorktrees(warnings),
      scanTailscale(),
    ]);

    const probeOne = async (listener) => {
      const base = `http://127.0.0.1:${listener.port}`;
      const [filmRes, notesRes] = await Promise.all([
        normalizeProbeResult(fetchJson, `${base}/api/film.json`),
        normalizeProbeResult(fetchJson, `${base}/api/notes`),
      ]);
      return { listener, filmRes, notesRes };
    };

    const probed = await Promise.all(listenerMeta.listeners.map(probeOne));

    if (listenerMeta.processFailed) {
      let recoveredSelf = false;
      if (isValidPort(selfPort) && !probed.some((p) => p.listener.port === selfPort)) {
        const netstatHit = listenerMeta.netstatConns.find((c) => c.port === selfPort);
        const selfProbe = await probeOne({
          pid: netstatHit?.pid ?? process.pid,
          port: selfPort,
          cmdline: "",
        });
        if (selfProbe.filmRes.status !== "unreachable" || netstatHit) {
          probed.push(selfProbe);
          recoveredSelf = true;
        }
      }
      if (listenerMeta.errorReason) {
        if (listenerMeta.timedOut && recoveredSelf) {
          warnings.push("Listener process scan timed out (showing active studio only)");
        } else {
          warnings.push(
            recoveredSelf
              ? `Listener process scan failed (${listenerMeta.errorReason}; showing active studio only)`
              : `Listener scan failed: ${listenerMeta.errorReason}`,
          );
        }
      }
    }

    const filmCache = new Map();
    const hostsCache = new Map();
    const io = { readText, readdir };

    const studios = probed.map(({ listener, filmRes, notesRes }) => {
      const validFilmJson =
        filmRes.status === "ready" &&
        filmRes.data &&
        typeof filmRes.data === "object" &&
        !Array.isArray(filmRes.data);
      const status = filmRes.status === "ready" && !validFilmJson ? "error" : filmRes.status;
      const filmJson = validFilmJson ? filmRes.data : null;

      const attr = resolveStudioWorktree(
        {
          port: listener.port,
          cmdline: listener.cmdline,
          filmJson,
          worktrees,
          platform,
          readText,
          readdir,
        },
        filmCache,
      );

      const ratio =
        typeof filmJson?.ratio === "string" && filmJson.ratio.trim() ? filmJson.ratio.trim() : null;
      const notes =
        notesRes.status === "ready" && Array.isArray(notesRes.data)
          ? countNotes(notesRes.data)
          : null;

      return {
        id: `${listener.pid}:${listener.port}`,
        port: listener.port,
        pid: listener.pid,
        current: false,
        film: attr.film,
        ratio,
        project: attr.project,
        worktree: attr.worktree,
        matchConfidence: attr.matchConfidence,
        candidateWorktrees: attr.candidateWorktrees,
        localUrl: `http://localhost:${listener.port}`,
        tailscale: [],
        notes,
        status,
      };
    });

    const studiosByPort = new Map();
    for (const studio of studios) {
      const list = studiosByPort.get(studio.port) ?? [];
      list.push(studio);
      studiosByPort.set(studio.port, list);
    }

    const unmatched = [];
    for (const route of tailscaleScan.routes) {
      const matched = studiosByPort.get(route.targetPort);
      if (!matched?.length) {
        unmatched.push(route);
        continue;
      }
      for (const studio of matched) {
        const allowedSet = loadAllowedHosts(studio.project, io, hostsCache);
        const allowed = allowedSet === null ? null : allowedSet.has(route.host);
        studio.tailscale.push({
          url: route.url,
          host: route.host,
          targetPort: route.targetPort,
          allowed,
        });
      }
    }

    return {
      scannedAt: now(),
      currentPort: null,
      studios,
      tailscale: {
        available: tailscaleScan.available,
        error: tailscaleScan.error,
        unmatched,
      },
      worktrees,
      warnings,
    };
  };

  const getSnapshot = async ({ currentPort = null, forceRefresh = false } = {}) => {
    if (inflightForced) {
      return applyCurrentPort(await inflightForced, currentPort);
    }

    if (!forceRefresh && cached && now() - cached.scannedAt < cacheTtlMs) {
      return applyCurrentPort(cached, currentPort);
    }

    if (forceRefresh) {
      inflightForced = runScan()
        .then((snap) => {
          cached = snap;
          return snap;
        })
        .finally(() => {
          inflightForced = null;
        });
      return applyCurrentPort(await inflightForced, currentPort);
    }

    if (!inflight) {
      inflight = runScan()
        .then((snap) => {
          cached = snap;
          return snap;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return applyCurrentPort(await inflight, currentPort);
  };

  return { getSnapshot };
};
