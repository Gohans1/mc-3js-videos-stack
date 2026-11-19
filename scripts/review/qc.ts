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

function takeFlagValue(argv: string[], i: number, flag: string): string {
  const val = argv[i + 1];
  if (val === undefined || val.startsWith("-")) {
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

function discoverFilm(cwd: string): { dir: string; pkg: Record<string, unknown> } | null {
  const start = resolve(process.env.LIVE_PROJECT || cwd);
  const pkgPath = join(start, "package.json");
  const pkg = existsSync(pkgPath) ? (readJson<Record<string, unknown>>(pkgPath) ?? {}) : {};
  const isFilm =
    existsSync(join(start, "src/scene.ts")) ||
    existsSync(join(start, "src/timeline/cam.json")) ||
    Boolean(pkg["live-studio"]);
  return isFilm ? { dir: start, pkg } : null;
}

function findAutoVideo(filmDir: string | null): string | null {
  const base = filmDir ?? process.cwd();
  const candidates = [
    "renders/final_video.mp4",
    "renders/final.mp4",
    "renders/draft_video.mp4",
    "renders/draft.mp4",
  ];
  for (const rel of candidates) {
    const p = join(base, rel);
    if (existsSync(p) && statSync(p).size > 0) return p;
  }
  return null;
}

function getPython(): string[] | null {
  const env = process.env.PYTHON || process.env.CINETIC_PYTHON;
  const win = process.platform === "win32";
  const cands: string[][] = [];
  if (env) cands.push([env]);
  for (const dir of [
    process.env.VIRTUAL_ENV,
    join(process.cwd(), ".venv"),
    join(process.cwd(), "venv"),
  ]) {
    if (!dir) continue;
    const exe = join(dir, win ? "Scripts" : "bin", win ? "python.exe" : "python");
    if (existsSync(exe)) cands.push([exe]);
  }
  const remembered = readJson<{ python?: string }>(
    join(process.env.CINETIC_HOME || join(homedir(), ".cinetic"), "tools.json"),
  );
  if (remembered?.python && existsSync(remembered.python)) cands.push([remembered.python]);
  if (win) cands.push(["python"], ["py", "-3"], ["python3"]);
  else cands.push(["python3"], ["python"]);

  for (const cand of cands) {
    const r = spawnSync(
      cand[0],
      [...cand.slice(1), "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"],
      { encoding: "utf8", windowsHide: true, timeout: 5000 },
    );
    if (r.status === 0) return cand;
  }
  return null;
}

function probePythonPackages(py: string[] | null): Record<string, boolean> {
  const caps = {
    cv2: false,
    numpy: false,
    pil: false,
    scipy: false,
    soundfile: false,
    librosa: false,
  };
  if (!py) return caps;
  const code =
    "import importlib, json; pkgs=['cv2','numpy','PIL','scipy','soundfile','librosa']; " +
    "print(json.dumps({p: importlib.util.find_spec(p) is not None for p in pkgs}))";
  const r = spawnSync(py[0], [...py.slice(1), "-c", code], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (r.status !== 0) return caps;
  try {
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, boolean>;
    return {
      cv2: Boolean(parsed.cv2),
      numpy: Boolean(parsed.numpy),
      pil: Boolean(parsed.PIL),
      scipy: Boolean(parsed.scipy),
      soundfile: Boolean(parsed.soundfile),
      librosa: Boolean(parsed.librosa),
    };
  } catch {
    return caps;
  }
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

  const py = getPython();
  if (!py) {
    console.error("error: Python with numpy + Pillow is required for qc box");
    return 2;
  }
  const pyArgs = [
    ...py.slice(1),
    FRAME_METRICS,
    "box",
    imgPath,
    rectArg,
    ...(norm ? ["--norm"] : []),
  ];
  const r = spawnSync(py[0], pyArgs, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
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
    if (a === "--out") outPath = takeFlagValue(argv, ++i - 1, "--out");
    else if (a === "--threshold") {
      const raw = takeFlagValue(argv, ++i - 1, "--threshold");
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

  const py = getPython();
  if (!py) {
    console.error("error: Python with numpy + Pillow is required for qc compare");
    return 2;
  }
  const pyArgs = [
    ...py.slice(1),
    FRAME_METRICS,
    "compare",
    beforePath,
    afterPath,
    "--out",
    dest,
    "--threshold",
    String(threshold),
  ];
  const r = spawnSync(py[0], pyArgs, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
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
  const rawCam = readJson<CamTimelineKey[] | { keys?: CamTimelineKey[] }>(camPath);
  const camKeys = Array.isArray(rawCam) ? rawCam : (rawCam?.keys ?? []);
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
    if (a === "--cam") camOverride = takeFlagValue(argv, ++i - 1, "--cam");
    else if (a === "--from") {
      from = Number(takeFlagValue(argv, ++i - 1, "--from"));
      if (!Number.isFinite(from)) failUsage("--from must be a finite number");
    } else if (a === "--to") {
      to = Number(takeFlagValue(argv, ++i - 1, "--to"));
      if (!Number.isFinite(to)) failUsage("--to must be a finite number");
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
    discoverFilm(process.cwd()) ??
    (camOverride ? discoverFilm(resolve(dirname(resolve(camOverride)), "../..")) : null);
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
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(
    `cam-motion (${report.status.toUpperCase()}): pos peak ${report.posPeak.v.toFixed(2)} m/s at ${report.posPeak.t.toFixed(2)}s (row ${report.posPeak.keyRow}) | turn peak ${report.turnPeak.v.toFixed(1)} deg/s at ${report.turnPeak.t.toFixed(2)}s (keys [${report.turnPeak.span[0]}->${report.turnPeak.span[1]}], row ${report.turnPeak.keyRow}) | FOV peak ${report.fovPeak.v.toFixed(1)} deg/s at ${report.fovPeak.t.toFixed(2)}s (row ${report.fovPeak.keyRow})`,
  );
  for (const f of report.faults) console.log(`  - ${f}`);
  return 0;
}

function runProbeCheck(videoPath: string, py: string[] | null): CheckResult {
  if (!py) return { id: "probe", status: "skip", summary: "skipped: python not found on PATH" };
  const r = spawnSync(
    py[0],
    [...py.slice(1), join(CINETIC_SCRIPTS, "probe.py"), videoPath, "--quiet"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    },
  );
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

function runJsonScriptCheck(
  id: CheckId,
  scriptName: string,
  py: string[],
  args: string[],
  tmpDir: string,
  writeFlag: "--json" | "--pos" = "--json",
): CheckResult {
  const outFile = join(tmpDir, `${id}.json`);
  const fullArgs =
    writeFlag === "--json"
      ? [...py.slice(1), join(CINETIC_SCRIPTS, scriptName), ...args, "--json", outFile]
      : [...py.slice(1), join(CINETIC_SCRIPTS, scriptName), ...args, outFile];
  const r = spawnSync(py[0], fullArgs, { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  const data = readJson<Record<string, unknown>>(outFile);
  if (!data && r.status !== 0) {
    return {
      id,
      status: "fail",
      summary: (r.stderr || r.stdout || `${scriptName} exited ${r.status}`).trim().split("\n")[0],
    };
  }
  const pass = r.status === 0;
  const warnings = Array.isArray(data?.warnings) ? data.warnings.length : 0;
  const status: CheckStatus = !pass ? "fail" : warnings > 0 ? "warn" : "pass";
  return {
    id,
    status,
    summary: pass
      ? warnings
        ? `passed with ${warnings} warning(s)`
        : "ok"
      : `failed (${scriptName})`,
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
  const text = r.stderr ?? "";
  const iMatch = [...text.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)].at(-1);
  const lraMatch = [...text.matchAll(/\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU/g)].at(-1);
  const tpMatch = [...text.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)].at(-1);
  if (!iMatch) {
    return {
      id: "audio",
      status: r.status === 0 ? "pass" : "skip",
      summary: r.status === 0 ? "ffmpeg audio decode ok" : "skipped: ebur128 unavailable",
    };
  }
  const lufs = Number(iMatch[1]);
  const lra = lraMatch ? Number(lraMatch[1]) : null;
  const truePeak = tpMatch ? Number(tpMatch[1]) : null;
  const clipped = truePeak !== null && truePeak > 0;
  const loudWarn = !clipped && (lufs > -9 || lufs < -24 || (truePeak !== null && truePeak > -0.5));
  const status: CheckStatus = clipped ? "fail" : loudWarn ? "warn" : "pass";
  return {
    id: "audio",
    status,
    summary: `${lufs.toFixed(1)} LUFS${truePeak !== null ? `, true peak ${truePeak.toFixed(2)} dBFS` : ""}${lra !== null ? `, LRA ${lra.toFixed(1)} LU` : ""}`,
    metrics: { lufs, lra, truePeakDbfs: truePeak },
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
      const raw = takeFlagValue(argv, ++i - 1, "--checks");
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
    discoverFilm(process.cwd()) ??
    (videoPath ? discoverFilm(resolve(dirname(videoPath), "..")) : null);
  if (!videoPath) {
    videoPath = findAutoVideo(film?.dir ?? null);
  }

  const needsPython = checksList.some((c) => c !== "cam-motion");
  const py = needsPython ? getPython() : null;
  const caps =
    needsPython && py
      ? probePythonPackages(py)
      : { cv2: false, numpy: false, pil: false, scipy: false, soundfile: false, librosa: false };

  const baseDir = film?.dir ?? process.cwd();
  const cuesFile = join(baseDir, "out/cues.json");
  const hasCues = existsSync(cuesFile);
  const soundtrackWav = join(baseDir, "public/audio/soundtrack.wav");
  const tmpDir = mkdtempSync(join(tmpdir(), "cinetic-qc-"));

  try {
    const results: CheckResult[] = [];
    let probeFacts: Record<string, unknown> | undefined;

    for (const id of checksList) {
      if (id === "cam-motion") {
        const m = analyzeFilmMotion({ filmDir: film?.dir ?? null, pkg: film?.pkg ?? null });
        if (!m) {
          results.push({
            id: "cam-motion",
            status: "skip",
            summary: "skipped: no src/timeline/cam.json found",
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
        const res = runProbeCheck(videoPath, py);
        probeFacts = res.metrics;
        results.push(res);
      } else if (id === "forensics") {
        if (!py || !caps.cv2 || !caps.numpy) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python package cv2 (opencv-python)",
          });
        } else {
          const args = [
            videoPath,
            ...(probeFacts?.audio ? [] : ["--no-audio"]),
            ...(hasCues ? ["--cues", cuesFile] : []),
          ];
          results.push(runJsonScriptCheck(id, "forensics.py", py, args, tmpDir));
        }
      } else if (id === "sync") {
        if (!py || !caps.numpy || !caps.soundfile || !caps.scipy) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python audio deps (numpy/soundfile/scipy)",
          });
        } else if (!hasCues && !existsSync(soundtrackWav)) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: no out/cues.json or public/audio/soundtrack.wav for sync reference",
          });
        } else {
          const args = hasCues
            ? [videoPath, "--cues", cuesFile, "--quiet"]
            : [videoPath, soundtrackWav, "--no-frames", "--quiet"];
          results.push(runJsonScriptCheck(id, "check-sync.py", py, args, tmpDir));
        }
      } else if (id === "audio") {
        if (hasCues && py && caps.numpy && caps.soundfile && caps.scipy && caps.librosa) {
          results.push(
            runJsonScriptCheck(id, "av-audit.py", py, [videoPath, "--cues", cuesFile], tmpDir),
          );
        } else {
          const hasAudio =
            probeFacts !== undefined
              ? Boolean(probeFacts.audio)
              : spawnSync(
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
                    videoPath,
                  ],
                  {
                    encoding: "utf8",
                    windowsHide: true,
                  },
                ).stdout.trim().length > 0;
          results.push(runFfmpegAudioCheck(videoPath, hasAudio));
        }
      } else if (id === "look") {
        if (!py || !caps.cv2 || !caps.numpy) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python package cv2 (opencv-python)",
          });
        } else {
          const args = [videoPath, "--look", ...(hasCues ? ["--cues", cuesFile] : [])];
          results.push(runJsonScriptCheck(id, "look-audit.py", py, args, tmpDir));
        }
      } else if (id === "speed") {
        if (!py || !caps.cv2 || !caps.numpy) {
          results.push({
            id,
            status: "skip",
            summary: "skipped: missing optional Python package cv2 (opencv-python)",
          });
        } else {
          const outFile = join(tmpDir, "speed.json");
          const args = [videoPath, outFile, ...(hasCues ? ["--cues", cuesFile] : []), "--quiet"];
          const r = spawnSync(
            py[0],
            [...py.slice(1), join(CINETIC_SCRIPTS, "measure-speed.py"), ...args],
            {
              encoding: "utf8",
              windowsHide: true,
              timeout: 120_000,
            },
          );
          const data = readJson<Record<string, unknown>>(outFile);
          const tooFast = Boolean(data?.too_fast);
          results.push({
            id,
            status: r.status !== 0 ? "fail" : tooFast ? "warn" : "pass",
            summary: tooFast ? "motion speed exceeded ceiling" : "ok",
            metrics: data ?? undefined,
          });
        }
      }
    }

    const ok = !results.some((c) => c.status === "fail" || (strict && c.status === "warn"));
    const report: QcReport = { ok, video: videoPath, film: film?.dir ?? null, checks: results };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`QC ${ok ? "PASS" : "FAIL"}${videoPath ? ` (${basename(videoPath)})` : ""}`);
      for (const c of results) {
        console.log(`  [${c.status.toUpperCase().padEnd(4)}] ${c.id.padEnd(10)} ${c.summary}`);
      }
    }
    return ok ? 0 : 1;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args[0] === "help") {
  console.log(HELP);
  process.exit(0);
}
if (args[0] === "box") process.exit(runBox(args.slice(1)));
if (args[0] === "compare") process.exit(runCompare(args.slice(1)));
if (args[0] === "motion") process.exit(runMotionCmd(args.slice(1)));
process.exit(runUnifiedQc(args));
