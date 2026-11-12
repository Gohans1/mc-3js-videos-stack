// The film's per-take voiceover script and audio takes (src/edit.json -> takes[], voice/takes/*, voice/try/*).
// Served read-only over /api/voice and /api/voice/audio/:kind/:file, with non-destructive try-take promotion (/api/voice/use-try).
import { spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { wavInfo } from "./sound.mjs";
import {
  planVoicePlacements,
  TAKE_ID,
  voiceFileOf,
  voiceFilterGraph,
  writeVoiceMap,
} from "./voice-map.mjs";

const AUDIO_FILE = /^[A-Za-z0-9_-]{1,120}\.(mp3|wav)$/;
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
let tmpSeq = 0;
const nextTmp = () => `${process.pid}.${Date.now()}.${++tmpSeq}`;

const inside = (root, file) => {
  const r = relative(root, file);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
};

const copyAtomic = (src, dest) => {
  const part = `${dest}.${nextTmp()}.part`;
  copyFileSync(src, part);
  renameSync(part, dest);
};

const runFfmpeg = (args, timeoutMs = 60_000) =>
  new Promise((done) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(ok);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false);
    }, timeoutMs);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });

const replaceTarget = async (fresh, target, releaseFile) => {
  for (let i = 0; i < 20; i++) {
    releaseFile?.(target);
    try {
      renameSync(fresh, target);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  rmSync(fresh, { force: true });
  return false;
};

const MP3_BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SR_BASE = [44100, 48000, 32000];

const mp3Seconds = (file, size) => {
  if (size < 4) return 0;
  const fd = openSync(file, "r");
  try {
    const head = Buffer.allocUnsafe(10);
    const headRead = readSync(fd, head, 0, Math.min(10, size), 0);
    let audioStart = 0;
    if (
      headRead === 10 &&
      head[0] === 0x49 &&
      head[1] === 0x44 &&
      head[2] === 0x33 &&
      head[6] < 0x80 &&
      head[7] < 0x80 &&
      head[8] < 0x80 &&
      head[9] < 0x80
    ) {
      const tagLen =
        ((head[6] & 0x7f) << 21) |
        ((head[7] & 0x7f) << 14) |
        ((head[8] & 0x7f) << 7) |
        (head[9] & 0x7f);
      audioStart = 10 + tagLen + (head[5] & 0x10 ? 10 : 0);
    }
    if (audioStart + 4 > size) return 0;

    let hasId3v1 = false;
    if (size >= audioStart + 128) {
      const tail = Buffer.allocUnsafe(3);
      if (
        readSync(fd, tail, 0, 3, size - 128) === 3 &&
        tail[0] === 0x54 &&
        tail[1] === 0x41 &&
        tail[2] === 0x47
      ) {
        hasId3v1 = true;
      }
    }
    const audioBytes = Math.max(0, size - audioStart - (hasId3v1 ? 128 : 0));
    const probeCap = Math.min(16384, size - audioStart);
    const probe = Buffer.allocUnsafe(probeCap);
    const probeLen = readSync(fd, probe, 0, probeCap, audioStart);

    for (let pos = 0; pos + 4 <= probeLen; pos++) {
      if (probe[pos] !== 0xff || (probe[pos + 1] & 0xe0) !== 0xe0) continue;
      const ver = (probe[pos + 1] >> 3) & 0x03;
      const layer = (probe[pos + 1] >> 1) & 0x03;
      if (ver === 1 || layer !== 1) continue;
      const brIdx = (probe[pos + 2] >> 4) & 0x0f;
      const srIdx = (probe[pos + 2] >> 2) & 0x03;
      if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue;

      const kbps = ver === 3 ? MP3_BR_V1[brIdx] : MP3_BR_V2[brIdx];
      const sr = MP3_SR_BASE[srIdx] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
      const spf = ver === 3 ? 1152 : 576;
      const pad = (probe[pos + 2] >> 1) & 0x01;
      const frameLen = Math.floor(((spf / 8) * kbps * 1000) / sr) + pad;
      if (frameLen < 24) continue;

      const mono = ((probe[pos + 3] >> 6) & 0x03) === 3;
      const sideInfo = ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
      const xing = pos + 4 + sideInfo;
      if (xing + 12 <= probeLen) {
        const tag = probe.toString("latin1", xing, xing + 4);
        if ((tag === "Xing" || tag === "Info") && (probe[xing + 7] & 0x01) !== 0) {
          const frames = probe.readUInt32BE(xing + 8);
          if (frames > 0) return (frames * spf) / sr;
        }
      }
      const vbri = pos + 36;
      if (vbri + 18 <= probeLen && probe.toString("latin1", vbri, vbri + 4) === "VBRI") {
        const frames = probe.readUInt32BE(vbri + 14);
        if (frames > 0) return (frames * spf) / sr;
      }

      if (
        pos + frameLen + 2 <= probeLen &&
        (probe[pos + frameLen] !== 0xff || (probe[pos + frameLen + 1] & 0xe0) !== 0xe0)
      ) {
        continue;
      }
      return (audioBytes * 8) / (kbps * 1000);
    }
    return 0;
  } finally {
    closeSync(fd);
  }
};

export const openVoice = (project, conf = {}, hooks = {}) => {
  const ROOT = resolve(project);
  const EDIT = join(ROOT, "src/edit.json");
  const VOICE_DIR = join(ROOT, "voice");
  const TAKES_DIR = join(VOICE_DIR, "takes");
  const TRY_DIR = join(VOICE_DIR, "try");
  const VOICE_MAP = join(ROOT, "renders/live/voice_map.json");
  const wordCache = new Map();
  let readCache = null;

  const getRealRoot = () => {
    try {
      return existsSync(ROOT) ? realpathSync(ROOT) : null;
    } catch {
      return null;
    }
  };

  const audioFile = (kind, file, roots) => {
    if ((kind !== "takes" && kind !== "try") || typeof file !== "string" || !AUDIO_FILE.test(file))
      return null;
    const base = kind === "takes" ? TAKES_DIR : TRY_DIR;
    if (!existsSync(base) || !existsSync(ROOT)) return null;
    const target = join(base, file);
    if (!existsSync(target)) return null;
    try {
      if (lstatSync(target).isSymbolicLink()) return null;
      const realRoot = roots?.realRoot ?? realpathSync(ROOT);
      const realBase =
        (kind === "takes" ? roots?.realTakes : roots?.realTries) ?? realpathSync(base);
      if (!realRoot || !realBase || !inside(realRoot, realBase)) return null;
      const realTarget = realpathSync(target);
      if (!inside(realBase, realTarget)) return null;
      if (!statSync(realTarget).isFile()) return null;
      return realTarget;
    } catch {
      return null;
    }
  };

  const readWordsMeta = (realAudioPath, realRoot = getRealRoot()) => {
    const wf = `${realAudioPath}.words.json`;
    if (existsSync(wf) && realRoot) {
      try {
        if (!lstatSync(wf).isSymbolicLink()) {
          const realWf = realpathSync(wf);
          if (inside(realRoot, realWf)) {
            const { mtimeMs } = statSync(realWf);
            const hit = wordCache.get(realWf);
            if (hit?.mtimeMs === mtimeMs) return hit.meta;
            const parsed = JSON.parse(readFileSync(realWf, "utf8"));
            const rawWords = Array.isArray(parsed.words) ? parsed.words : [];
            const words = rawWords.filter(
              (w) =>
                w &&
                typeof w.w === "string" &&
                Number.isFinite(w.s) &&
                Number.isFinite(w.e) &&
                w.s >= 0 &&
                w.e >= w.s,
            );
            const lastEnd = words.length ? Number(words.at(-1)?.e ?? 0) : 0;
            const dur =
              typeof parsed.dur === "number" && Number.isFinite(parsed.dur)
                ? Math.max(parsed.dur, lastEnd)
                : lastEnd;
            const meta = {
              seconds: Math.max(0, dur),
              words: words.length,
              aligned: words.length > 0,
            };
            wordCache.set(realWf, { mtimeMs, meta });
            if (wordCache.size > 500) wordCache.clear();
            return meta;
          }
        }
      } catch {
        // Fall through to header/zero fallback
      }
    }
    try {
      const { mtimeMs, size } = statSync(realAudioPath);
      const hit = wordCache.get(realAudioPath);
      if (hit?.mtimeMs === mtimeMs) return hit.meta;
      const lower = realAudioPath.toLowerCase();
      const seconds = lower.endsWith(".wav")
        ? (wavInfo(realAudioPath)?.seconds ?? 0)
        : lower.endsWith(".mp3")
          ? mp3Seconds(realAudioPath, size)
          : 0;
      const meta = { seconds: Math.max(0, seconds), words: 0, aligned: false };
      wordCache.set(realAudioPath, { mtimeMs, meta });
      if (wordCache.size > 500) wordCache.clear();
      return meta;
    } catch {
      return { seconds: 0, words: 0, aligned: false };
    }
  };

  const readEditTakes = () => {
    if (!existsSync(EDIT)) return [];
    try {
      const edit = JSON.parse(readFileSync(EDIT, "utf8"));
      return Array.isArray(edit.takes) ? edit.takes : [];
    } catch {
      return [];
    }
  };

  const scanTriesByTake = (takeIds, roots) => {
    const byId = new Map(takeIds.map((id) => [id, []]));
    if (!takeIds.length || !existsSync(TRY_DIR)) return byId;
    let names = [];
    try {
      names = readdirSync(TRY_DIR).filter((n) => AUDIO_FILE.test(n));
    } catch {
      return byId;
    }
    names.sort(NATURAL_COLLATOR.compare);
    // Match longest takeId prefix first so take "01_a" never steals "01_a_1.mp3" into take "01"
    const sortedIds = [...takeIds].sort((a, b) => b.length - a.length);
    for (const file of names) {
      if (!audioFile("try", file, roots)) continue;
      const owner = sortedIds.find((id) => file.startsWith(`${id}_`));
      if (owner) byId.get(owner).push(file);
    }
    return byId;
  };

  const pickActiveTakeFile = (id, roots) => {
    const candidates = [`${id}.mp3`, `${id}.wav`]
      .map((name) => {
        const real = audioFile("takes", name, roots);
        return real ? { name, real, mtimeMs: statSync(real).mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0] ?? null;
  };

  const DEFAULT_VOICE_FILE = join(ROOT, "assets/public/agent/full_voice.wav");

  const hasNarration = (realRoot) => {
    if (typeof conf?.soundSources?.narration === "string" && conf.soundSources.narration) {
      const f = join(ROOT, conf.soundSources.narration);
      if (!inside(ROOT, f)) return false;
      if (!existsSync(f)) return true;
      try {
        return Boolean(
          !lstatSync(f).isSymbolicLink() && realRoot && inside(realRoot, realpathSync(f)),
        );
      } catch {
        return false;
      }
    }
    const rel = conf?.soundTimeline;
    if (rel) {
      const f = join(ROOT, rel);
      if (existsSync(f)) {
        try {
          if (!lstatSync(f).isSymbolicLink() && realRoot && inside(realRoot, realpathSync(f))) {
            return Boolean(JSON.parse(readFileSync(f, "utf8")).narration);
          }
        } catch {
          /* ignore */
        }
      }
    }
    const vf = voiceFileOf(ROOT);
    if (!existsSync(vf)) return false;
    try {
      return Boolean(
        realRoot && !lstatSync(vf).isSymbolicLink() && inside(realRoot, realpathSync(vf)),
      );
    } catch {
      return false;
    }
  };

  const fileStamp = (p) => {
    try {
      const s = lstatSync(p);
      return `${s.isSymbolicLink() ? "L" : "F"}:${s.size}:${Math.round(s.mtimeMs)}`;
    } catch {
      return "-";
    }
  };

  const takesDirStamp = (d) => {
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const parts = [];
      for (const e of entries) {
        if (!AUDIO_FILE.test(e.name) && !e.name.endsWith(".words.json")) continue;
        if (e.isSymbolicLink()) parts.push(`${e.name}:L`);
        else if (e.isFile()) parts.push(`${e.name}:${fileStamp(join(d, e.name))}`);
      }
      return parts.join(",");
    } catch {
      return "-";
    }
  };

  const triesDirStamp = (d) => {
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const parts = [];
      for (const e of entries) {
        if (!AUDIO_FILE.test(e.name)) continue;
        parts.push(`${e.name}:${e.isSymbolicLink() ? "L" : e.isFile() ? "F" : "O"}`);
      }
      return parts.join(",");
    } catch {
      return "-";
    }
  };

  const computeReadStamp = () => {
    const tl = conf?.soundTimeline ? join(ROOT, conf.soundTimeline) : "";
    const nr = conf?.soundSources?.narration ? join(ROOT, conf.soundSources.narration) : "";
    return [
      fileStamp(EDIT),
      takesDirStamp(TAKES_DIR),
      triesDirStamp(TRY_DIR),
      tl ? fileStamp(tl) : "-",
      nr ? fileStamp(nr) : "-",
      fileStamp(DEFAULT_VOICE_FILE),
    ].join("|");
  };

  const read = () => {
    const stamp = computeReadStamp();
    if (readCache?.stamp === stamp) return readCache.value;
    const realRoot = getRealRoot();
    const resolveSubdir = (d) => {
      if (!realRoot || !existsSync(d)) return null;
      try {
        if (lstatSync(d).isSymbolicLink()) return null;
        const r = realpathSync(d);
        return inside(realRoot, r) ? r : null;
      } catch {
        return null;
      }
    };
    const roots = {
      realRoot,
      realTakes: resolveSubdir(TAKES_DIR),
      realTries: resolveSubdir(TRY_DIR),
    };
    const rawTakes = readEditTakes().filter(
      (k) => k && typeof k.id === "string" && TAKE_ID.test(k.id),
    );
    const triesById = scanTriesByTake(
      rawTakes.map((k) => k.id),
      roots,
    );
    const takes = rawTakes.map((k) => {
      const active = pickActiveTakeFile(k.id, roots);
      const meta = active
        ? readWordsMeta(active.real, realRoot)
        : { seconds: 0, words: 0, aligned: false };
      return {
        id: k.id,
        text: typeof k.text === "string" ? k.text : "",
        ...(typeof k.t === "number" && Number.isFinite(k.t) && { t: k.t }),
        ...(typeof k.start === "number" && Number.isFinite(k.start) && { start: k.start }),
        ...(typeof k.voice === "string" && k.voice && { voice: k.voice }),
        ...(typeof k.model === "string" && k.model && { model: k.model }),
        ...(typeof k.speed === "number" && Number.isFinite(k.speed) && { speed: k.speed }),
        ...(typeof k.stability === "number" &&
          Number.isFinite(k.stability) && { stability: k.stability }),
        ...(typeof k.guide === "string" && k.guide && { guide: k.guide }),
        file: active?.name ?? null,
        seconds: +meta.seconds.toFixed(3),
        words: meta.words,
        aligned: meta.aligned,
        tries: triesById.get(k.id) ?? [],
      };
    });
    const value = { narration: hasNarration(realRoot), takes };
    readCache = { stamp, value };
    return value;
  };

  const fallbackSecondsOf = (realPath) => readWordsMeta(realPath).seconds;
  let lastEditWrite = null;
  const ownEditWrite = () => existsSync(EDIT) && readFileSync(EDIT, "utf8") === lastEditWrite;

  const syncEditVoiceLines = (placements, wavEnd) => {
    if (!existsSync(EDIT)) return;
    try {
      if (lstatSync(EDIT).isSymbolicLink()) return;
      const realRoot = realpathSync(ROOT);
      const realEdit = realpathSync(EDIT);
      if (!inside(realRoot, realEdit)) return;
      const edit = JSON.parse(readFileSync(realEdit, "utf8"));
      if (!edit || typeof edit !== "object") return;
      if (!edit.voice || typeof edit.voice !== "object") {
        edit.voice = { lines: [], edits: {}, warp: [] };
      }
      const nextLines = placements.map((p) => [p.spokenStart, p.spokenEnd]);
      let dirty = false;
      if (JSON.stringify(edit.voice.lines ?? []) !== JSON.stringify(nextLines)) {
        edit.voice.lines = nextLines;
        dirty = true;
      }
      if (typeof edit.end === "number" && wavEnd > edit.end) {
        edit.end = wavEnd;
        dirty = true;
      }
      if (dirty) {
        const text = JSON.stringify(edit, null, 1) + "\n";
        const part = `${realEdit}.${nextTmp()}.part`;
        writeFileSync(part, text, "utf8");
        renameSync(part, realEdit);
        lastEditWrite = text;
      }
    } catch {
      /* ignore edit sync errors */
    }
  };

  const reassembleFullVoice = async (fullVoice) => {
    let edit = {};
    if (existsSync(EDIT)) {
      try {
        edit = JSON.parse(readFileSync(EDIT, "utf8"));
      } catch {
        edit = {};
      }
    }
    const placements = planVoicePlacements(ROOT, { fallbackSecondsOf });
    let maxEnd = 0;
    for (const p of placements) maxEnd = Math.max(maxEnd, p.naturalEnd + 0.5);

    const existingDur = wavInfo(fullVoice)?.seconds ?? 0;
    const end = Math.max(
      1,
      Math.round(Math.max(existingDur, Number(edit.end) || 0, maxEnd) * 1000) / 1000,
    );
    const { inputs, filter } = voiceFilterGraph(placements, end);
    const freshWav = `${fullVoice}.${nextTmp()}.new.wav`;
    const ok = !filter
      ? await runFfmpeg([
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-t",
          String(end),
          "-i",
          "anullsrc=r=48000:cl=mono",
          "-c:a",
          "pcm_s16le",
          freshWav,
        ])
      : await runFfmpeg([
          "-v",
          "error",
          "-y",
          ...inputs,
          "-filter_complex",
          filter,
          "-map",
          "[out]",
          "-t",
          String(end),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          freshWav,
        ]);
    if (!ok) {
      rmSync(freshWav, { force: true });
      return { ok: false, placements, end };
    }
    const replaced = await replaceTarget(freshWav, fullVoice, hooks.releaseFile);
    return { ok: replaced, placements, end };
  };

  let swapChain = Promise.resolve();

  const runUseTry = async ({ takeId, tryFile }) => {
    if (!TAKE_ID.test(takeId) || !AUDIO_FILE.test(tryFile) || !tryFile.startsWith(`${takeId}_`)) {
      return { error: "Try file does not belong to the requested take", status: 400 };
    }
    const rawTakes = readEditTakes();
    if (!rawTakes.some((k) => k?.id === takeId)) {
      return { error: `Unknown take "${takeId}"`, status: 404 };
    }
    const srcAudio = audioFile("try", tryFile);
    if (!srcAudio) {
      return { error: "Try audio file is unavailable", status: 404 };
    }

    mkdirSync(TAKES_DIR, { recursive: true });
    mkdirSync(TRY_DIR, { recursive: true });
    const realRoot = realpathSync(ROOT);
    const realTakes = realpathSync(TAKES_DIR);
    const realTries = realpathSync(TRY_DIR);
    if (
      !inside(realRoot, realTakes) ||
      !inside(realRoot, realTries) ||
      lstatSync(TAKES_DIR).isSymbolicLink() ||
      lstatSync(TRY_DIR).isSymbolicLink()
    ) {
      return { error: "Voice folders must stay inside the film directory", status: 400 };
    }

    const ext = extname(tryFile).toLowerCase();
    const siblingExt = ext === ".mp3" ? ".wav" : ".mp3";
    const destAudio = join(realTakes, `${takeId}${ext}`);
    const destWords = `${destAudio}.words.json`;
    const siblingAudio = join(realTakes, `${takeId}${siblingExt}`);
    const siblingWords = `${siblingAudio}.words.json`;
    for (const p of [destAudio, destWords, siblingAudio, siblingWords]) {
      if (existsSync(p) && lstatSync(p).isSymbolicLink()) {
        return { error: "Refusing to overwrite symlinked take file", status: 400 };
      }
    }

    const fullVoice = voiceFileOf(ROOT);
    const hasFullVoice =
      existsSync(fullVoice) &&
      !lstatSync(fullVoice).isSymbolicLink() &&
      inside(realRoot, realpathSync(fullVoice));
    if (!hasFullVoice) {
      const decodable = await runFfmpeg(["-v", "error", "-i", srcAudio, "-f", "null", "-"]);
      if (!decodable) {
        return { error: "Try audio file is invalid or unreadable", status: 422 };
      }
    }

    const prevPlacements = planVoicePlacements(ROOT, { fallbackSecondsOf });
    const prevById = new Map(prevPlacements.map((p) => [p.id, p]));
    const prevActive = pickActiveTakeFile(takeId);
    const prevWordsPath = prevActive ? `${prevActive.real}.words.json` : null;
    const hadPrevWords = Boolean(
      prevWordsPath && existsSync(prevWordsPath) && !lstatSync(prevWordsPath).isSymbolicLink(),
    );

    // Stage rollback files so an ffmpeg reassemble failure leaves voice/takes/ unchanged
    const stamp = nextTmp();
    const audioBak = prevActive ? join(realTakes, `.${takeId}.${stamp}.audio.bak`) : null;
    const wordsBak = hadPrevWords ? join(realTakes, `.${takeId}.${stamp}.words.bak`) : null;
    if (audioBak && prevActive) copyFileSync(prevActive.real, audioBak);
    if (wordsBak && prevWordsPath) copyFileSync(prevWordsPath, wordsBak);

    try {
      let createdOrigAudio = null;
      let createdOrigWords = null;
      // Back up original active take once into voice/try/<id>_orig.<prevExt> before overwriting or cross-ext swapping
      const hasOrigBackup =
        existsSync(join(realTries, `${takeId}_orig.mp3`)) ||
        existsSync(join(realTries, `${takeId}_orig.wav`));
      if (
        prevActive &&
        tryFile !== `${takeId}_orig.mp3` &&
        tryFile !== `${takeId}_orig.wav` &&
        !hasOrigBackup
      ) {
        const prevExt = extname(prevActive.name).toLowerCase();
        const origBackup = join(realTries, `${takeId}_orig${prevExt}`);
        copyAtomic(prevActive.real, origBackup);
        createdOrigAudio = origBackup;
        if (hadPrevWords && prevWordsPath) {
          createdOrigWords = `${origBackup}.words.json`;
          copyAtomic(prevWordsPath, createdOrigWords);
        }
      }

      copyAtomic(srcAudio, destAudio);
      const srcWords = `${srcAudio}.words.json`;
      if (
        existsSync(srcWords) &&
        !lstatSync(srcWords).isSymbolicLink() &&
        inside(realTries, realpathSync(srcWords))
      ) {
        copyAtomic(srcWords, destWords);
      } else {
        rmSync(destWords, { force: true });
      }
      rmSync(siblingAudio, { force: true });
      rmSync(siblingWords, { force: true });
      wordCache.delete(destAudio);
      wordCache.delete(siblingAudio);
      if (prevActive?.real) wordCache.delete(prevActive.real);
      readCache = null;

      let nextPlacements = [];
      if (hasFullVoice) {
        const assembled = await reassembleFullVoice(fullVoice);
        if (!assembled.ok) {
          rmSync(destAudio, { force: true });
          rmSync(destWords, { force: true });
          if (createdOrigAudio) rmSync(createdOrigAudio, { force: true });
          if (createdOrigWords) rmSync(createdOrigWords, { force: true });
          if (audioBak && prevActive) copyAtomic(audioBak, prevActive.real);
          if (wordsBak && prevWordsPath) copyAtomic(wordsBak, prevWordsPath);
          wordCache.delete(destAudio);
          wordCache.delete(siblingAudio);
          if (prevActive?.real) wordCache.delete(prevActive.real);
          readCache = null;
          return { error: "Failed to rebuild full_voice.wav with ffmpeg", status: 500 };
        }
        nextPlacements = assembled.placements;
        syncEditVoiceLines(assembled.placements, assembled.end);
        writeVoiceMap(ROOT, VOICE_MAP, assembled.placements);
        await hooks.onAssemble?.();
      } else {
        nextPlacements = planVoicePlacements(ROOT, { fallbackSecondsOf });
      }

      const swappedSpans = [];
      for (const nextP of nextPlacements) {
        const prevP = prevById.get(nextP.id);
        if (!prevP) continue;
        if (
          nextP.id === takeId ||
          prevP.start !== nextP.start ||
          prevP.naturalEnd !== nextP.naturalEnd
        ) {
          swappedSpans.push({
            takeId: nextP.id,
            prevStart: prevP.start,
            prevEnd: prevP.naturalEnd,
            prevSpokenStart: prevP.spokenStart,
            prevSpokenEnd: prevP.spokenEnd,
            nextStart: nextP.start,
            nextEnd: nextP.naturalEnd,
          });
        }
      }
      const swapped = swappedSpans.find((s) => s.takeId === takeId);
      return {
        ...read(),
        ...(swapped ? { swapped } : {}),
        ...(swappedSpans.length ? { swappedSpans } : {}),
      };
    } finally {
      if (audioBak) rmSync(audioBak, { force: true });
      if (wordsBak) rmSync(wordsBak, { force: true });
    }
  };

  const useTry = (params) => {
    const next = swapChain.then(() => runUseTry(params));
    swapChain = next.catch(() => {});
    return next;
  };

  return { VOICE_DIR, TAKES_DIR, TRY_DIR, read, audioFile, ownEditWrite, useTry };
};
