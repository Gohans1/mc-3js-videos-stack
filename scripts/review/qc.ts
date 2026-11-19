#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cameraAt } from "../../packages/film-stage/src/camera.ts";
import {
  analyzeCameraTimeline,
  analyzeKeyFileMotion,
  type CamTimelineKey,
} from "../../packages/live-studio/src/camera-speed.mjs";
import { ratioOf } from "../../packages/live-studio/src/frame.ts";

const ALL_CHECKS = ["probe", "forensics", "sync", "audio", "look", "speed", "cam-motion"] as const;
type CheckId = (typeof ALL_CHECKS)[number];
type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  summary: string;
  metrics?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

interface QcReport {
  ok: boolean;
  video: string | null;
  film: string | null;
  checks: CheckResult[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CINETIC_SCRIPTS = resolve(ROOT, ".claude/skills/cinetic/scripts");
const FRAME_METRICS = resolve(HERE, "frame_metrics.py");

const HELP = `Unified QC and inspection CLI for rendered videos, frames, and camera timelines.

Usage:
  bun scripts/review/qc.ts [video] [options]
  bun scripts/review/qc.ts box <image> <x,y,w,h> [--norm] [--json]
  bun scripts/review/qc.ts compare <before> <after> [--out <path>] [--threshold <n>] [--json]
  bun scripts/review/qc.ts motion [--cam <file>] [--from <s>] [--to <s>] [--json]

Video QC options:
  --checks <list>     Comma-separated check IDs: ${ALL_CHECKS.join(",")}
  --strict            Treat warnings as failures (exit 1 on warn or fail)
  --json              Print machine-readable JSON report to stdout
  -h, --help          Show this help and exit 0

Exit codes:
  0  Pass (or report generated without --strict failure)
  1  QC check failed (or warn with --strict)
  2  Bad arguments, missing explicit input file, or unreadable metrics`;

function failUsage(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function takeFlagValue(
  argv: string[],
  i: number,
  flag: string,
  allowNegativeNumber = false,
): string {
  const val = argv[i + 1];
  if (val === undefined || (val.startsWith("-") && !(allowNegativeNumber && /^-\d/.test(val)))) {
    failUsage(`Missing value for ${flag}`);
  }
  return val;
}

function readJson<T = unknown>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function discoverFilm(dir: string): { dir: string; pkg: Record<string, unknown> } | null {
  const start = resolve(dir);
  const pkgPath = join(start, "package.json");
  const pkg = existsSync(pkgPath) ? (readJson<Record<string, unknown>>(pkgPath) ?? {}) : {};
  const isFilm =
    existsSync(join(start, "src/scene.ts")) ||
    existsSync(join(start, "src/timeline/cam.json")) ||
    Boolean(pkg["live-studio"]);
  return isFilm ? { dir: start, pkg } : null;
}

function findOwningFilm(filePath: string): { dir: string; pkg: Record<string, unknown> } | null {
  let cur = dirname(resolve(filePath));
  for (let depth = 0; depth < 5; depth++) {
    const found = discoverFilm(cur);
    if (found) return found;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function findAutoVideo(filmDir: string | null): string | null {
  const base = filmDir ?? process.cwd();
  const candidates = [
    "renders/final.mp4",
    "renders/draft.mp4",
    "renders/final_video.mp4",
    "renders/draft_video.mp4",
  ];
  for (const rel of candidates) {
    const p = join(base, rel);
    if (existsSync(p) && statSync(p).size > 0) return p;
  }
  return null;
}

interface PyCaps {
  cv2: boolean;
  numpy: boolean;
  pil: boolean;
  scipy: boolean;
  soundfile: boolean;
  librosa: boolean;
}
type PyPkg = keyof PyCaps;
interface PyEnv {
  cmd: string[];
  exe: string;
  caps: PyCaps;
}

const pyProbeCache = new Map<string, PyEnv | null>();

function candidatePythons(): string[][] {
  const win = process.platform === "win32";
  const seen = new Set<string>();
  const out: string[][] = [];
  const pushCmd = (cmd: string[]) => {
    const norm =
      cmd.length === 1 && (cmd[0].includes("/") || cmd[0].includes("\\")) ? [resolve(cmd[0])] : cmd;
    const key = win ? norm.join("\0").toLowerCase() : norm.join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(norm);
    }
  };

  const env = process.env.PYTHON || process.env.CINETIC_PYTHON;
  if (env) pushCmd([env]);

  const venvRoots = [
    process.env.VIRTUAL_ENV,
    join(process.cwd(), ".venv"),
    join(process.cwd(), "venv"),
    join(ROOT, ".venv"),
    join(ROOT, "venv"),
  ];
  for (const dir of venvRoots) {
    if (!dir) continue;
    const exe = join(dir, win ? "Scripts" : "bin", win ? "python.exe" : "python");
    if (existsSync(exe)) pushCmd([exe]);
  }

  const remembered = readJson<{ python?: string }>(
    join(process.env.CINETIC_HOME || join(homedir(), ".cinetic"), "tools.json"),
  );
  if (remembered?.python && existsSync(remembered.python)) pushCmd([remembered.python]);

  if (win) {
    pushCmd(["python"]);
    pushCmd(["py", "-3"]);
    pushCmd(["python3"]);
  } else {
    pushCmd(["python3"]);
    pushCmd(["python"]);
  }
  return out;
}

function probePythonCandidate(cmd: string[]): PyEnv | null {
  const key = process.platform === "win32" ? cmd.join("\0").toLowerCase() : cmd.join("\0");
  if (pyProbeCache.has(key)) return pyProbeCache.get(key) ?? null;

  const code =
    "import sys, importlib.util, json; " +
    "pkgs=['cv2','numpy','PIL','scipy','soundfile','librosa']; " +
    "print(json.dumps({'ok': sys.version_info >= (3, 10), 'exe': sys.executable, " +
    "'caps': {p: importlib.util.find_spec(p) is not None for p in pkgs}}))";
  const r = spawnSync(cmd[0], [...cmd.slice(1), "-c", code], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (r.status !== 0) {
    pyProbeCache.set(key, null);
    return null;
  }
  try {
    const parsed = JSON.parse(r.stdout.trim()) as {
      ok?: boolean;
      exe?: string;
      caps?: Record<string, boolean>;
    };
    if (!parsed.ok) {
      pyProbeCache.set(key, null);
      return null;
    }
    const env: PyEnv = {
      cmd,
      exe: parsed.exe || cmd[0],
      caps: {
        cv2: Boolean(parsed.caps?.cv2),
        numpy: Boolean(parsed.caps?.numpy),
        pil: Boolean(parsed.caps?.PIL),
        scipy: Boolean(parsed.caps?.scipy),
        soundfile: Boolean(parsed.caps?.soundfile),
        librosa: Boolean(parsed.caps?.librosa),
      },
    };
    pyProbeCache.set(key, env);
    return env;
  } catch {
    pyProbeCache.set(key, null);
    return null;
  }
}

function selectPython(required: readonly PyPkg[] = []): PyEnv | null {
  for (const cmd of candidatePythons()) {
    const env = probePythonCandidate(cmd);
    if (!env) continue;
    if (required.every((p) => env.caps[p])) return env;
  }
  return null;
}

function runBox(argv: string[]): number {
  let norm = false;
  let asJson = false;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--norm") norm = true;
    else if (a === "--json") asJson = true;
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      return 0;
    } else if (a.startsWith("-")) failUsage(`Unknown flag for box: ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 2) failUsage("Usage: qc box <image> <x,y,w,h> [--norm] [--json]");
  const [imageArg, rectArg] = pos;
  const imgPath = resolve(imageArg);
  if (!existsSync(imgPath)) failUsage(`Image not found: ${imageArg}`);

  const py = selectPython(["numpy", "pil"]);
  if (!py) {
    console.error("error: Python with numpy + Pillow is required for qc box");
    return 2;
  }
  const pyArgs = [
    ...py.cmd.slice(1),
    FRAME_METRICS,
    "box",
    imgPath,
    rectArg,
    ...(norm ? ["--norm"] : []),
  ];
  const r = spawnSync(py.cmd[0], pyArgs, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status === 1 ? 2 : (r.status ?? 2);
  }
  if (asJson) {
    process.stdout.write(r.stdout);
    return 0;
  }
  const m = JSON.parse(r.stdout);
  const b = m.box;
  console.log(
    `${basename(m.image)} [${b.x},${b.y} ${b.w}x${b.h}]: RGB(${m.meanRgb.map((v: number) => v.toFixed(1)).join(", ")}) | sRGB luma ${m.srgbLuma.mean.toFixed(3)} (std ${m.srgbLuma.std.toFixed(3)}) | linear ${m.linearLuma.mean.toFixed(3)} | WCAG contrast ${m.dynamicRange.wcagContrastRatio.toFixed(2)}:1 (${m.dynamicRange.stops.toFixed(1)} stops)`,
  );
  return 0;
}

function runCompare(argv: string[]): number {
  let outPath: string | null = null;
  let threshold = 4;
  let asJson = false;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      outPath = takeFlagValue(argv, i, "--out");
      i++;
    } else if (a === "--threshold") {
      const raw = takeFlagValue(argv, i, "--threshold", true);
      i++;
      threshold = Number(raw);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
        failUsage(`--threshold must be in 0..255, got ${raw}`);
      }
    } else if (a === "--json") asJson = true;
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      return 0;
    } else if (a.startsWith("-")) failUsage(`Unknown flag for compare: ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 2)
    failUsage("Usage: qc compare <before> <after> [--out <path>] [--threshold <n>] [--json]");

  const beforePath = resolve(pos[0]);
  const afterPath = resolve(pos[1]);
  if (!existsSync(beforePath)) failUsage(`Before image not found: ${pos[0]}`);
  if (!existsSync(afterPath)) failUsage(`After image not found: ${pos[1]}`);

  const dest =
    outPath !== null
      ? resolve(outPath)
      : join(dirname(afterPath), `compare_${basename(afterPath, extname(afterPath))}.png`);

  const py = selectPython(["numpy", "pil"]);
  if (!py) {
    console.error("error: Python with numpy + Pillow is required for qc compare");
    return 2;
  }
  const pyArgs = [
    ...py.cmd.slice(1),
    FRAME_METRICS,
    "compare",
    beforePath,
    afterPath,
    "--out",
    dest,
    "--threshold",
    String(threshold),
  ];
  const r = spawnSync(py.cmd[0], pyArgs, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status === 1 ? 2 : (r.status ?? 2);
  }
  if (asJson) {
    process.stdout.write(r.stdout);
    return 0;
  }
  const m = JSON.parse(r.stdout);
  console.log(
    `compare ${basename(beforePath)} -> ${basename(afterPath)}: ${m.changedPct.toFixed(2)}% pixels changed (${m.changedPixels}/${m.totalPixels}, threshold>${m.threshold}), mean delta ${m.meanAbsDelta.toFixed(2)}, max ${m.maxDelta.toFixed(0)} -> wrote ${m.out}`,
  );
  return 0;
}

function analyzeFilmMotion(opts: {
  filmDir: string | null;
  pkg: Record<string, unknown> | null;
  camOverride?: string;
  from?: number;
  to?: number;
}) {
  const baseDir = opts.filmDir ?? process.cwd();
  const liveCfg = (opts.pkg?.["live-studio"] as Record<string, unknown> | undefined) ?? {};
  const camRel =
    typeof liveCfg.camTimeline === "string" ? liveCfg.camTimeline : "src/timeline/cam.json";
  const camPath = opts.camOverride ? resolve(opts.camOverride) : resolve(baseDir, camRel);
  if (!existsSync(camPath)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(camPath, "utf8"));
  } catch (err) {
    return {
      camFile: camPath,
      error: `invalid JSON in ${camPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const objKeys =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { keys?: unknown }).keys
      : undefined;
  if (!Array.isArray(parsed) && !Array.isArray(objKeys)) {
    return {
      camFile: camPath,
      error: `invalid camera timeline ${camPath}: expected key array or { keys: [] }`,
    };
  }
  const camKeys = (Array.isArray(parsed) ? parsed : objKeys) as CamTimelineKey[];
  const aspect = opts.pkg && ratioOf(opts.pkg) === "9:16" ? 9 / 16 : 16 / 9;

  const canEvalThree =
    camKeys.length > 0 && camKeys.every((k) => Array.isArray(k?.p) && Array.isArray(k?.l));
  const evaluator = canEvalThree
    ? (t: number, a: number, segKeys?: readonly CamTimelineKey[]) => {
        const s = cameraAt(t, segKeys ?? camKeys, { aspect: a });
        const bp = s.base?.p ?? s.p;
        const bl = s.base?.l ?? s.l;
        return {
          p: [bp.x, bp.y, bp.z] as [number, number, number],
          l: [bl.x, bl.y, bl.z] as [number, number, number],
          fov: (s.base?.fov ?? s.fov) as number,
        };
      }
    : undefined;

  const cam = analyzeCameraTimeline(camKeys, {
    from: opts.from,
    to: opts.to,
    aspect,
    evaluator,
  });

  const timelineDir = join(baseDir, "src/timeline");
  const keyFiles: Array<{ file: string; tracks: unknown[] }> = [];
  if (existsSync(timelineDir)) {
    for (const name of readdirSync(timelineDir)) {
      if (!name.endsWith(".json")) continue;
      const full = join(timelineDir, name);
      if (resolve(full) === resolve(camPath)) continue;
      const data = readJson(full);
      if (!data) continue;
      const res = analyzeKeyFileMotion(data, `src/timeline/${name}`, {
        from: opts.from,
        to: opts.to,
      });
      if (res.tracks.length) keyFiles.push(res);
    }
  }

  return {
    camFile: camPath,
    ...cam,
    keyFiles,
  };
}

function runMotionCmd(argv: string[]): number {
  let camOverride: string | undefined;
  let from: number | undefined;
  let to: number | undefined;
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cam") {
      camOverride = takeFlagValue(argv, i, "--cam");
      i++;
    } else if (a === "--from") {
      from = Number(takeFlagValue(argv, i, "--from", true));
      i++;
      if (!Number.isFinite(from) || from < 0) failUsage("--from must be a finite number >= 0");
    } else if (a === "--to") {
      to = Number(takeFlagValue(argv, i, "--to", true));
      i++;
      if (!Number.isFinite(to) || to <= 0) failUsage("--to must be a finite number > 0");
    } else if (a === "--json") asJson = true;
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      return 0;
    } else failUsage(`Unknown argument for motion: ${a}`);
  }
  if (from !== undefined && to !== undefined && to <= from) {
    failUsage(`--to (${to}) must be greater than --from (${from})`);
  }
  if (camOverride && !existsSync(resolve(camOverride))) {
    failUsage(`Camera timeline not found: ${camOverride}`);
  }

  const film =
    (camOverride ? findOwningFilm(resolve(camOverride)) : null) ??
    discoverFilm(process.env.LIVE_PROJECT || process.cwd());
  const report = analyzeFilmMotion({
    filmDir: film?.dir ?? null,
    pkg: film?.pkg ?? null,
    camOverride,
    from,
    to,
  });
  if (!report) {
    failUsage("No cam.json found (run inside a film dir or pass --cam <file>)");
  }
  if ("error" in report && typeof report.error === "string") {
    failUsage(report.error);
  }
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(
    `cam-motion (${report.status.toUpperCase()}): pos peak ${report.posPeak.v.toFixed(2)} m/s at ${report.posPeak.t.toFixed(2)}s (row ${report.posPeak.keyRow}) | turn peak ${report.turnPeak.v.toFixed(1)} deg/s at ${report.turnPeak.t.toFixed(2)}s (keys [${report.turnPeak.span[0]}->${report.turnPeak.span[1]}], row ${report.turnPeak.keyRow}) | FOV peak ${report.fovPeak.v.toFixed(1)} deg/s at ${report.fovPeak.t.toFixed(2)}s (row ${report.fovPeak.keyRow})`,
  );
  for (const f of report.faults) console.log(`  - ${f}`);
  for (const kf of report.keyFiles) {
    for (const tr of kf.tracks as Array<{
      path: string;
      peakPos: { v: number; t: number; rowFrom: number; rowTo: number };
      peakRot: { v: number; t: number; rowFrom: number; rowTo: number };
    }>) {
      console.log(
        `  - ${kf.file}:${tr.path}: pos peak ${tr.peakPos.v.toFixed(2)} m/s at ${tr.peakPos.t.toFixed(2)}s (rows ${tr.peakPos.rowFrom}->${tr.peakPos.rowTo}), rot peak ${tr.peakRot.v.toFixed(1)} deg/s at ${tr.peakRot.t.toFixed(2)}s (rows ${tr.peakRot.rowFrom}->${tr.peakRot.rowTo})`,
      );
    }
  }
  return 0;
}

function runProbeCheck(videoPath: string, py: string[] | null): CheckResult {
  if (!py) return { id: "probe", status: "skip", summary: "skipped: python 3.10+ not found" };
  const pictureOnly = /_video\.mp4$/i.test(videoPath);
  const probeArgs = [
    ...py.slice(1),
    join(CINETIC_SCRIPTS, "probe.py"),
    videoPath,
    ...(pictureOnly ? ["--audio", "any"] : []),
    "--quiet",
  ];
  const r = spawnSync(py[0], probeArgs, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  let parsed: {
    pass?: boolean;
    checks?: Array<{ name: string; ok: boolean; expected: unknown; actual: unknown }>;
    facts?: {
      width?: number;
      height?: number;
      fps?: number;
      duration?: number;
      audio?: unknown;
      [key: string]: unknown;
    };
  } | null = null;
  try {
    parsed = JSON.parse(r.stdout.trim());
  } catch {
    return {
      id: "probe",
      status: r.status === 0 ? "pass" : "fail",
      summary: (r.stderr || r.stdout || "probe failed").trim().split("\n")[0],
    };
  }
  const failed = (parsed?.checks ?? []).filter((c) => !c.ok);
  const ok = Boolean(parsed?.pass) && r.status === 0;
  const f = parsed?.facts;
  return {
    id: "probe",
    status: ok ? "pass" : "fail",
    summary: ok
      ? `ok (${f?.width ?? "?"}x${f?.height ?? "?"}@${f?.fps ?? "?"} ${f?.duration ?? "?"}s)`
      : `failed: ${failed.map((c) => `${c.name}=${String(c.actual)} (want ${String(c.expected)})`).join(", ") || "probe failed"}`,
    metrics: f,
    details: failed.length ? { failed } : undefined,
  };
}

export function countWarnings(data: Record<string, unknown> | null): number {
  if (!data) return 0;
  let count = 0;
  if (typeof data.warnings === "number") count = Math.max(count, data.warnings);
  else if (Array.isArray(data.warnings)) count = Math.max(count, data.warnings.length);
  if (Array.isArray(data.flags)) {
    const flagWarns = data.flags.filter(
      (f) => (f as { severity?: string })?.severity === "warn",
    ).length;
    count = Math.max(count, flagWarns);
  }
  const framesObj = data.frames as Record<string, unknown> | undefined;
  if (framesObj && Array.isArray(framesObj.warnings)) {
    count = Math.max(count, framesObj.warnings.length);
  }
  return count;
}

export function summarizeFailure(data: Record<string, unknown> | null, fallback: string): string {
  if (!data) return fallback;
  const reasons: string[] = [];
  if (typeof data.error === "string" && data.error) reasons.push(data.error);
  if (Array.isArray(data.flags)) {
    for (const fl of data.flags as Array<{ severity?: string; check?: string; note?: string }>) {
      if (fl?.severity === "fail") {
        reasons.push(fl.note || fl.check || "fail");
        if (reasons.length >= 2) break;
      }
    }
  }
  const framesObj = data.frames as Record<string, unknown> | undefined;
  if (reasons.length < 2 && framesObj && Array.isArray(framesObj.fails)) {
    for (const msg of framesObj.fails) {
      if (typeof msg === "string" && msg) {
        reasons.push(msg);
        if (reasons.length >= 2) break;
      }
    }
  }
  return reasons.length ? `failed: ${reasons.join("; ")}` : fallback;
}

function runJsonScriptCheck(
  id: CheckId,
  scriptName: string,
  py: string[],
  args: string[],
  tmpDir: string,
  cwd: string,
): CheckResult {
  const outFile = join(tmpDir, `${id}.json`);
  const fullArgs = [...py.slice(1), join(CINETIC_SCRIPTS, scriptName), ...args, "--json", outFile];
  const r = spawnSync(py[0], fullArgs, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });
  const data = readJson<Record<string, unknown>>(outFile);
  if (!data && r.status !== 0) {
    return {
      id,
      status: "fail",
      summary: (r.stderr || r.stdout || `${scriptName} exited ${r.status}`).trim().split("\n")[0],
    };
  }
  const pass = r.status === 0;
  const warnings = countWarnings(data);
  const status: CheckStatus = !pass ? "fail" : warnings > 0 ? "warn" : "pass";
  return {
    id,
    status,
    summary: pass
      ? warnings
        ? `passed with ${warnings} warning(s)`
        : "ok"
      : summarizeFailure(data, `failed (${scriptName})`),
    metrics: data ?? undefined,
  };
}

function runFfmpegAudioCheck(videoPath: string, hasAudio: boolean): CheckResult {
  if (!hasAudio) {
    return { id: "audio", status: "skip", summary: "skipped: video has no audio stream" };
  }
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", videoPath, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  if (r.error) {
    return { id: "audio", status: "skip", summary: "skipped: ffmpeg not found on PATH" };
  }
  if (r.status !== 0) {
    const firstErr =
      (r.stderr || `ffmpeg exited ${r.status}`).trim().split("\n").at(-1) || "ffmpeg failed";
    return { id: "audio", status: "fail", summary: firstErr };
  }
  const text = r.stderr ?? "";
  const iMatch = [...text.matchAll(/\bI:\s*(-inf|-?\d+(?:\.\d+)?)\s*LUFS/gi)].at(-1);
  const lraMatch = [...text.matchAll(/\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU/g)].at(-1);
  const tpMatch = [...text.matchAll(/Peak:\s*(-inf|-?\d+(?:\.\d+)?)\s*dBFS/gi)].at(-1);
  if (!iMatch) {
    return {
      id: "audio",
      status: "warn",
      summary: "ffmpeg audio decoded without ebur128 summary",
    };
  }
  const rawI = iMatch[1].toLowerCase();
  const lra = lraMatch ? Number(lraMatch[1]) : null;
  const rawTp = tpMatch ? tpMatch[1].toLowerCase() : null;
  const truePeak = rawTp === null ? null : rawTp === "-inf" ? -Infinity : Number(rawTp);
  if (rawI === "-inf") {
    return {
      id: "audio",
      status: "warn",
      summary: "silent audio track (-inf LUFS)",
      metrics: { lufs: null, lra, truePeakDbfs: Number.isFinite(truePeak) ? truePeak : null },
    };
  }
  const lufs = Number(rawI);
  const clipped = truePeak !== null && Number.isFinite(truePeak) && truePeak > 0;
  const loudWarn =
    !clipped &&
    (lufs > -9 ||
      lufs < -24 ||
      (truePeak !== null && Number.isFinite(truePeak) && truePeak > -0.5));
  const status: CheckStatus = clipped ? "fail" : loudWarn ? "warn" : "pass";
  return {
    id: "audio",
    status,
    summary: `${lufs.toFixed(1)} LUFS${truePeak !== null && Number.isFinite(truePeak) ? `, true peak ${truePeak.toFixed(2)} dBFS` : ""}${lra !== null ? `, LRA ${lra.toFixed(1)} LU` : ""}`,
    metrics: { lufs, lra, truePeakDbfs: Number.isFinite(truePeak) ? truePeak : null },
  };
}

function runUnifiedQc(argv: string[]): number {
  let checksList: CheckId[] = [...ALL_CHECKS];
  let strict = false;
  let asJson = false;
  const pos: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--checks") {
      const raw = takeFlagValue(argv, i, "--checks");
      i++;
      const items = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!items.length) failUsage("--checks requires at least one check id");
      for (const item of items) {
        if (!ALL_CHECKS.includes(item as CheckId)) {
          failUsage(`Unknown check id '${item}' (expected one of: ${ALL_CHECKS.join(", ")})`);
        }
      }
      checksList = items as CheckId[];
    } else if (a === "--strict") strict = true;
    else if (a === "--json") asJson = true;
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      return 0;
    } else if (a.startsWith("-")) failUsage(`Unknown flag: ${a}`);
    else pos.push(a);
  }
  if (pos.length > 1) failUsage(`Unexpected extra argument: ${pos[1]}`);

  let videoPath: string | null = null;
  if (pos.length === 1) {
    videoPath = resolve(pos[0]);
    if (!existsSync(videoPath)) failUsage(`Video not found: ${pos[0]}`);
  }
  const film =
    (videoPath ? findOwningFilm(videoPath) : null) ??
    discoverFilm(process.env.LIVE_PROJECT || process.cwd());
  if (!videoPath) {
    videoPath = findAutoVideo(film?.dir ?? null);
  }

  const baseDir = film?.dir ?? process.cwd();
  const cuesFile = join(baseDir, "out/cues.json");
  const hasCues = existsSync(cuesFile);
  const wavCandidates = [
    join(baseDir, "public/audio/soundtrack.wav"),
    join(baseDir, "sound/mix.wav"),
  ];
  const soundtrackWav = wavCandidates.find((p) => existsSync(p)) ?? wavCandidates[0];
  const hasWav = existsSync(soundtrackWav);
  const tmpDir = mkdtempSync(join(tmpdir(), "cinetic-qc-"));

  try {
    const results: CheckResult[] = [];
    let probeFacts: Record<string, unknown> | undefined;
    let audioCached: boolean | undefined;

    const hasAudioStream = (vid: string): boolean => {
      if (audioCached !== undefined) return audioCached;
      if (probeFacts !== undefined) {
        audioCached = Boolean(probeFacts.audio);
        return audioCached;
      }
      const p = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          vid,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 10_000 },
      );
      audioCached = p.status === 0 && p.stdout.trim().length > 0;
      return audioCached;
    };

    for (const id of checksList) {
      if (id === "cam-motion") {
        const m = analyzeFilmMotion({ filmDir: film?.dir ?? null, pkg: film?.pkg ?? null });
        if (!m) {
          results.push({
            id: "cam-motion",
            status: "skip",
            summary: "skipped: no src/timeline/cam.json found",
          });
        } else if ("error" in m && typeof m.error === "string") {
          results.push({
            id: "cam-motion",
            status: "fail",
            summary: m.error,
          });
        } else {
          results.push({
            id: "cam-motion",
            status: m.status,
            summary: m.faults.length
              ? m.faults[0]
              : `ok (pos ${m.posPeak.v.toFixed(2)} m/s, turn ${m.turnPeak.v.toFixed(1)} deg/s, FOV peak ${m.fovPeak.v.toFixed(1)} deg/s)`,
            metrics: {
              posPeak: m.posPeak,
              turnPeak: m.turnPeak,
              fovPeak: m.fovPeak,
              widthSeconds: m.widthSeconds,
              keyFiles: m.keyFiles,
            },
            details: m.faults.length ? { faults: m.faults } : undefined,
          });
        }
        continue;
      }

      if (!videoPath) {
        results.push({
          id,
          status: "skip",
          summary: "skipped: no video file found (render first or pass <video>)",
        });
        continue;
      }

      if (id === "probe") {
        const py = selectPython([]);
        const res = runProbeCheck(videoPath, py?.cmd ?? null);
        probeFacts = res.metrics;
        results.push(res);
      } else if (id === "forensics") {
        const py = selectPython(["cv2", "numpy"]);
        if (!py) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python package cv2 (opencv-python) + numpy",
          });
        } else {
          const withAudio = hasAudioStream(videoPath);
          const args = [
            videoPath,
            ...(withAudio ? [] : ["--no-audio"]),
            ...(hasCues ? ["--cues", cuesFile] : []),
          ];
          results.push(runJsonScriptCheck(id, "forensics.py", py.cmd, args, tmpDir, baseDir));
        }
      } else if (id === "sync") {
        if (!hasAudioStream(videoPath)) {
          results.push({ id, status: "skip", summary: "skipped: video has no audio stream" });
          continue;
        }
        const py = selectPython(["numpy", "soundfile", "scipy"]);
        if (!py) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python audio deps (numpy/soundfile/scipy)",
          });
        } else if (!hasCues && !hasWav) {
          results.push({
            id,
            status: "skip",
            summary:
              "skipped: no out/cues.json, public/audio/soundtrack.wav, or sound/mix.wav for sync reference",
          });
        } else {
          const args = hasCues
            ? hasWav
              ? [videoPath, soundtrackWav, "--cues", cuesFile, "--quiet"]
              : [videoPath, "--cues", cuesFile, "--quiet"]
            : [videoPath, soundtrackWav, "--no-frames", "--quiet"];
          results.push(runJsonScriptCheck(id, "check-sync.py", py.cmd, args, tmpDir, baseDir));
        }
      } else if (id === "audio") {
        const withAudio = hasAudioStream(videoPath);
        if (!withAudio) {
          results.push({ id, status: "skip", summary: "skipped: video has no audio stream" });
          continue;
        }
        const pyAv = hasCues ? selectPython(["numpy", "soundfile", "scipy", "librosa"]) : null;
        if (hasCues && pyAv) {
          results.push(
            runJsonScriptCheck(
              id,
              "av-audit.py",
              pyAv.cmd,
              [videoPath, "--cues", cuesFile],
              tmpDir,
              baseDir,
            ),
          );
        } else {
          results.push(runFfmpegAudioCheck(videoPath, withAudio));
        }
      } else if (id === "look") {
        const py = selectPython(["cv2", "numpy"]);
        if (!py) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python package cv2 (opencv-python) + numpy",
          });
        } else {
          const args = [videoPath, "--look", ...(hasCues ? ["--cues", cuesFile] : [])];
          results.push(runJsonScriptCheck(id, "look-audit.py", py.cmd, args, tmpDir, baseDir));
        }
      } else if (id === "speed") {
        const py = selectPython(["cv2", "numpy", "scipy"]);
        if (!py) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python deps (cv2/numpy/scipy)",
          });
        } else {
          const outFile = join(tmpDir, "speed.json");
          const args = [videoPath, outFile, ...(hasCues ? ["--cues", cuesFile] : []), "--quiet"];
          const r = spawnSync(
            py.cmd[0],
            [...py.cmd.slice(1), join(CINETIC_SCRIPTS, "measure-speed.py"), ...args],
            {
              cwd: baseDir,
              encoding: "utf8",
              windowsHide: true,
              timeout: 120_000,
            },
          );
          const data = readJson<Record<string, unknown>>(outFile);
          const tooFastCount = Array.isArray(data?.too_fast) ? data.too_fast.length : 0;
          const ceilingCount = Array.isArray(data?.speed_ceiling) ? data.speed_ceiling.length : 0;
          const paceWarnCount = Array.isArray(data?.pace_warnings) ? data.pace_warnings.length : 0;
          const hasWarn = tooFastCount > 0 || ceilingCount > 0 || paceWarnCount > 0;
          results.push({
            id,
            status: r.status !== 0 ? "fail" : hasWarn ? "warn" : "pass",
            summary:
              r.status !== 0
                ? (r.stderr || r.stdout || `measure-speed.py exited ${r.status}`)
                    .trim()
                    .split("\n")[0]
                : tooFastCount > 0
                  ? `${tooFastCount} range(s) exceeded blur speed threshold`
                  : ceilingCount > 0 || paceWarnCount > 0
                    ? `passed with ${Math.max(ceilingCount, paceWarnCount)} speed warning(s)`
                    : "ok",
            metrics: data ?? undefined,
          });
        }
      }
    }

    const allSkipped = results.length > 0 && results.every((c) => c.status === "skip");
    const ok =
      !allSkipped && !results.some((c) => c.status === "fail" || (strict && c.status === "warn"));
    const report: QcReport = { ok, video: videoPath, film: film?.dir ?? null, checks: results };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else if (allSkipped) {
      console.log(`QC SKIP${videoPath ? ` (${basename(videoPath)})` : ""} — nothing checked`);
      for (const c of results) {
        console.log(`  [${c.status.toUpperCase().padEnd(4)}] ${c.id.padEnd(10)} ${c.summary}`);
      }
    } else {
      console.log(`QC ${ok ? "PASS" : "FAIL"}${videoPath ? ` (${basename(videoPath)})` : ""}`);
      for (const c of results) {
        console.log(`  [${c.status.toUpperCase().padEnd(4)}] ${c.id.padEnd(10)} ${c.summary}`);
      }
    }
    return allSkipped ? 2 : ok ? 0 : 1;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export { findAutoVideo, selectPython };

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "help") {
    console.log(HELP);
    process.exit(0);
  }
  if (args[0] === "box") process.exit(runBox(args.slice(1)));
  if (args[0] === "compare") process.exit(runCompare(args.slice(1)));
  if (args[0] === "motion") process.exit(runMotionCmd(args.slice(1)));
  process.exit(runUnifiedQc(args));
}
