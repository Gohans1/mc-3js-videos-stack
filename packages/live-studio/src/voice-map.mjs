// Builds renders/live/voice_map.json natively in JS: 0.04s waveform peaks from full_voice.wav and per-take whisperX word
// times shifted onto where voice/assemble placed each take in full_voice.wav.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { wavInfo, wavPeaks } from "./sound.mjs";

export const VOICE_STEP = 0.04;
export const TAKE_ID = /^[A-Za-z0-9_-]{1,80}$/;

// The command that writes FILE.words.json for each take: whisperX runs in the lab venv (THREEJS_LAB moves the lab), as
// scripts/voice/words.py says. voice:gen runs it for the takes it makes; a genvoice.pro take comes with no timings
export const wordsCommand = (takes) => {
  const lab = process.env.THREEJS_LAB || "E:/threejs_lab";
  return [
    join(lab, process.platform === "win32" ? "py/venv/Scripts/python.exe" : "py/venv/bin/python"),
    fileURLToPath(new URL("../../../scripts/voice/words.py", import.meta.url)),
    ...takes,
  ];
};
const DEFAULT_GAP = 0.4;
const r3 = (x) => Math.round(x * 1000) / 1000;
let tmpSeq = 0;
const nextTmp = () => `${process.pid}.${Date.now()}.${++tmpSeq}`;

const inside = (root, file) => {
  const r = relative(root, file);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
};

export const assertInsideDir = (baseDir, targetPath, label = "Path") => {
  const absBase = resolve(baseDir);
  const realBase = existsSync(absBase) ? realpathSync(absBase) : absBase;
  const absTarget = resolve(absBase, targetPath);
  const rootPrefix = inside(absBase, absTarget)
    ? absBase
    : inside(realBase, absTarget)
      ? realBase
      : null;
  if (!rootPrefix) {
    throw new Error(`${label} escapes film directory: "${targetPath}"`);
  }
  let cur = rootPrefix;
  for (const seg of relative(rootPrefix, absTarget)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    cur = join(cur, seg);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      break;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`${label} cannot traverse symlink or junction: "${targetPath}"`);
    }
    if (!inside(realBase, realpathSync(cur))) {
      throw new Error(`${label} escapes film directory: "${targetPath}"`);
    }
  }
  return absTarget;
};

const isAlignedWord = (w) =>
  Boolean(
    w &&
    typeof w.w === "string" &&
    Number.isFinite(w.s) &&
    Number.isFinite(w.e) &&
    w.s >= 0 &&
    w.e >= w.s,
  );

export const voiceFileOf = (projectDir) => {
  const root = resolve(projectDir);
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const conf = JSON.parse(readFileSync(pkgPath, "utf8"))["live-studio"] ?? {};
      const audioPath = conf.soundTimeline && join(root, conf.soundTimeline);
      const narration =
        audioPath && existsSync(audioPath)
          ? JSON.parse(readFileSync(audioPath, "utf8")).narration
          : "narration";
      const rel = narration && conf.soundSources?.[narration];
      if (rel) return join(root, rel);
    } catch {
      /* fall back to default path */
    }
  }
  return join(root, "assets/public/agent/full_voice.wav");
};

const pickSafeTakeAudio = (realTakes, id) => {
  const candidates = [`${id}.mp3`, `${id}.wav`]
    .map((name) => {
      const p = join(realTakes, name);
      if (!existsSync(p)) return null;
      try {
        if (lstatSync(p).isSymbolicLink()) return null;
        const real = realpathSync(p);
        if (!inside(realTakes, real)) return null;
        const st = statSync(real);
        return st.isFile() ? { name, real, mtimeMs: st.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
};

export const planVoicePlacements = (projectDir, { fallbackSecondsOf, strict = false } = {}) => {
  const root = resolve(projectDir);
  const takesDir = join(root, "voice/takes");
  const editFile = join(root, "src/edit.json");
  if (!existsSync(root) || !existsSync(editFile)) {
    if (strict) throw new Error(`Missing src/edit.json in "${root}"`);
    return [];
  }
  const parsedEdit = strict
    ? JSON.parse(readFileSync(editFile, "utf8"))
    : (() => {
        try {
          return JSON.parse(readFileSync(editFile, "utf8"));
        } catch {
          return {};
        }
      })();
  const rawTakes = Array.isArray(parsedEdit?.takes) ? parsedEdit.takes : [];
  if (!rawTakes.length) return [];

  if (!existsSync(takesDir)) {
    if (strict)
      throw new Error(`Missing audio take for "${rawTakes[0]?.id ?? ""}" in voice/takes/`);
    return [];
  }

  let realRoot, realTakes;
  try {
    if (lstatSync(takesDir).isSymbolicLink()) {
      if (strict) throw new Error("Voice folders must stay inside the film directory");
      return [];
    }
    realRoot = realpathSync(root);
    realTakes = realpathSync(takesDir);
    if (!inside(realRoot, realTakes)) {
      if (strict) throw new Error("Voice folders must stay inside the film directory");
      return [];
    }
  } catch (err) {
    if (strict) throw err;
    return [];
  }

  const placed = [];
  let cursor = 0;
  for (const k of rawTakes) {
    if (!k || typeof k.id !== "string" || !TAKE_ID.test(k.id)) {
      if (strict) throw new Error(`Invalid take id "${String(k?.id ?? "")}" in src/edit.json`);
      continue;
    }
    const active = pickSafeTakeAudio(realTakes, k.id);
    if (!active) {
      if (strict) throw new Error(`Missing audio take for "${k.id}" in voice/takes/`);
      continue;
    }

    let words = [];
    let alignedDur = 0;
    const wf = `${active.real}.words.json`;
    if (existsSync(wf)) {
      try {
        if (!lstatSync(wf).isSymbolicLink() && inside(realTakes, realpathSync(wf))) {
          const info = JSON.parse(readFileSync(wf, "utf8"));
          const rawWords = Array.isArray(info.words) ? info.words : [];
          words = rawWords.filter(isAlignedWord);
          if (typeof info.dur === "number" && Number.isFinite(info.dur)) alignedDur = info.dur;
        } else if (strict) {
          throw new Error(`Unsafe word alignment path "${wf}"`);
        }
      } catch (err) {
        if (strict) throw err;
        words = [];
      }
    } else if (strict) {
      throw new Error(
        `Missing word alignment "${wf}": whisperX writes it (minutes on a CPU): ${wordsCommand([active.real]).join(" ")}`,
      );
    }

    if (strict && !words.length) {
      throw new Error(`No words aligned in "${wf}"`);
    }

    if (words.length) {
      const firstWord = words[0].s;
      const lastWord = words.at(-1).e;
      const takeDur = Math.max(lastWord, alignedDur || lastWord);
      const start =
        typeof k.start === "number" && Number.isFinite(k.start)
          ? Math.max(0, k.start)
          : typeof k.t === "number" && Number.isFinite(k.t)
            ? Math.max(0, k.t - firstWord)
            : cursor;
      const ws = words.map((x) => ({ w: x.w, s: r3(x.s + start), e: r3(x.e + start) }));
      const naturalEnd = r3(start + Math.min(takeDur, lastWord + 0.2));
      placed.push({
        id: k.id,
        file: active.real,
        start: r3(start),
        spokenStart: ws[0].s,
        spokenEnd: ws.at(-1).e,
        naturalEnd,
        words: ws,
      });
      cursor = Math.max(cursor, r3(naturalEnd + DEFAULT_GAP));
    } else {
      const fallback =
        Number(fallbackSecondsOf?.(active.real) ?? wavInfo(active.real)?.seconds ?? 0) || 0;
      const start =
        typeof k.start === "number" && Number.isFinite(k.start)
          ? Math.max(0, k.start)
          : typeof k.t === "number" && Number.isFinite(k.t)
            ? Math.max(0, k.t)
            : cursor;
      const naturalEnd = r3(start + Math.max(0.05, fallback));
      placed.push({
        id: k.id,
        file: active.real,
        start: r3(start),
        spokenStart: r3(start),
        spokenEnd: naturalEnd,
        naturalEnd,
        words: [],
      });
      cursor = Math.max(cursor, r3(naturalEnd + DEFAULT_GAP));
    }
  }
  return placed;
};

export const voiceFilterGraph = (placements, end) => {
  const inputs = [];
  const chains = [];
  placements.forEach((p, idx) => {
    inputs.push("-i", p.file);
    let nextStart = Infinity;
    for (const other of placements) {
      if (other !== p && other.start > p.start + 0.01 && other.start < nextStart)
        nextStart = other.start;
    }
    const shouldTrim = p.words.length > 0 || Number.isFinite(nextStart);
    const trimEnd = Math.min(
      p.naturalEnd,
      Number.isFinite(nextStart) ? Math.max(p.start + 0.05, nextStart - 0.01) : Infinity,
    );
    const trimDur = Math.max(0.05, r3(trimEnd - p.start));
    const fadeDur = trimDur >= 0.04 ? 0.015 : 0;
    const fadeStart = r3(Math.max(0, trimDur - fadeDur));
    const trimPart = shouldTrim
      ? `,atrim=0:${trimDur},asetpts=PTS-STARTPTS${fadeDur > 0 ? `,afade=t=out:st=${fadeStart}:d=${fadeDur}` : ""}`
      : "";
    chains.push(
      `[${idx}:a]aresample=48000${trimPart},adelay=${Math.max(0, Math.round(p.start * 1000))}:all=1[v${idx}]`,
    );
  });
  if (!chains.length) return { inputs, filter: "" };
  const tail =
    chains.length === 1
      ? `[v0]apad=whole_dur=${end}[out]`
      : `${chains.map((_, i) => `[v${i}]`).join("")}amix=inputs=${chains.length}:normalize=0,apad=whole_dur=${end}[out]`;
  return { inputs, filter: `${chains.join(";")};${tail}` };
};

export const buildVoiceMap = (projectDir, precomputedPlacements) => {
  const root = resolve(projectDir);
  const voiceFile = voiceFileOf(root);
  if (!existsSync(root) || !existsSync(voiceFile))
    return { step: VOICE_STEP, peaks: [], lines: [] };
  let peaks = [];
  try {
    if (
      !lstatSync(voiceFile).isSymbolicLink() &&
      inside(realpathSync(root), realpathSync(voiceFile))
    ) {
      peaks = wavPeaks(voiceFile, VOICE_STEP, 3)?.peaks ?? [];
    }
  } catch {
    peaks = [];
  }
  const placements = Array.isArray(precomputedPlacements)
    ? precomputedPlacements
    : planVoicePlacements(root);
  const lines = placements
    .filter((p) => p.words.length > 0)
    .map((p) => ({
      s: p.spokenStart,
      e: p.spokenEnd,
      text: p.words.map((x) => x.w).join(" "),
      words: p.words,
    }));
  return { step: VOICE_STEP, peaks, lines };
};

export const writeVoiceMap = (projectDir, outFile, precomputedPlacements) => {
  const safeOut = assertInsideDir(projectDir, outFile, "Voice map output");
  const map = buildVoiceMap(projectDir, precomputedPlacements);
  mkdirSync(dirname(safeOut), { recursive: true });
  const part = `${safeOut}.${nextTmp()}.part`;
  writeFileSync(part, JSON.stringify(map));
  renameSync(part, safeOut);
  return { ...map, words: map.lines.reduce((n, l) => n + l.words.length, 0) };
};
