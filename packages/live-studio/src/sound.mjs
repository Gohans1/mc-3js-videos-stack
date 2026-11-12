// The film's sound lanes as the studio edits them: package.json "live-studio": { "soundTimeline": file, "sfx": folder } names
// the timeline (beds that run from..to, one-shots at a time) and the folder of WAV/OGG files it plays, with SOURCES.json beside them for
// titles and licences (and kind: "bgm", "sfx" or "mc"). The page drags, trims and levels clips; timeline_file.mjs writes the file, and the film's sound watcher remixes.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { SoundTimeline } from "./contract.ts";
import { openTimelineFile } from "./timeline_file.mjs";
import { assertInsideDir } from "./voice-map.mjs";

const inside = (root, file) => {
  const r = relative(root, file);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
};

// ---------- WAV & Ogg Vorbis: length from headers, and a coarse level curve for the lanes
const chunks = (fd, size) => {
  if (size < 44) return null;
  const head = Buffer.alloc(12);
  if (readSync(fd, head, 0, 12, 0) < 12) return null;
  if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE")
    return null;
  const found = {};
  for (let at = 12; at + 8 <= size;) {
    const h = Buffer.alloc(8);
    if (readSync(fd, h, 0, 8, at) < 8) break;
    const id = h.toString("ascii", 0, 4),
      len = h.readUInt32LE(4),
      avail = size - at - 8;
    found[id.trim()] = { at: at + 8, len: Math.min(len, avail) };
    if (len > avail) break;
    at += 8 + len + (len % 2);
  }
  return found;
};
const format = (fd, c) => {
  if (!c?.fmt || c.fmt.len < 16) return null;
  const f = Buffer.alloc(16);
  if (readSync(fd, f, 0, 16, c.fmt.at) < 16) return null;
  const tag = f.readUInt16LE(0),
    channels = f.readUInt16LE(2),
    rate = f.readUInt32LE(4),
    bits = f.readUInt16LE(14);
  if (
    channels < 1 ||
    channels > 32 ||
    rate < 100 ||
    rate > 384_000 ||
    ![8, 16, 24, 32].includes(bits)
  ) {
    return null;
  }
  return { tag, channels, rate, bits };
};
export const wavInfo = (file) => {
  const fd = openSync(file, "r");
  try {
    const c = chunks(fd, statSync(file).size);
    if (!c?.fmt || !c.data) return null;
    const f = format(fd, c);
    if (!f) return null;
    return { ...f, seconds: c.data.len / (f.rate * f.channels * (f.bits / 8)) };
  } finally {
    closeSync(fd);
  }
};
export const oggInfo = (file) => {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    if (size <= 44) return null;
    const headLen = Math.min(size, 512),
      head = Buffer.alloc(headLen);
    readSync(fd, head, 0, headLen, 0);
    if (head.toString("ascii", 0, 4) !== "OggS") return null;
    const pktAt = 27 + head[26];
    if (
      pktAt + 16 > headLen ||
      head[pktAt] !== 1 ||
      head.toString("ascii", pktAt + 1, pktAt + 7) !== "vorbis"
    )
      return null;
    const serial = head.readUInt32LE(14),
      channels = head[pktAt + 11],
      rate = head.readUInt32LE(pktAt + 12);
    if (!rate || !channels) return null;
    const tailLen = Math.min(size, 65536),
      tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    for (let i = tailLen - 27; i >= 0; i--) {
      if (
        tail[i] === 0x4f &&
        tail[i + 1] === 0x67 &&
        tail[i + 2] === 0x67 &&
        tail[i + 3] === 0x53 &&
        tail[i + 4] === 0 &&
        (tail[i + 5] & 0x02) === 0 &&
        tail.readUInt32LE(i + 14) === serial
      ) {
        const gran = tail.readBigInt64LE(i + 6);
        if (gran >= 0n) return { channels, rate, bits: 16, seconds: Number(gran) / rate };
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
};
export const audioInfo = (file) =>
  file.toLowerCase().endsWith(".ogg") ? oggInfo(file) : wavInfo(file);

const PEAK_STEP = 0.02;
export const wavPeaks = (file, step = PEAK_STEP, digits = 6) => {
  const fd = openSync(file, "r");
  try {
    const c = chunks(fd, statSync(file).size);
    if (!c?.fmt || !c.data) return null;
    const fmt = format(fd, c);
    if (!fmt) return null;
    const { tag, channels, rate, bits } = fmt,
      bytes = bits / 8,
      frame = bytes * channels;
    const read =
      tag === 3 && bits === 32
        ? (b, i) => b.readFloatLE(i)
        : bits === 16
          ? (b, i) => b.readInt16LE(i) / 32768
          : bits === 24
            ? (b, i) => b.readIntLE(i, 3) / 8388608
            : bits === 32
              ? (b, i) => b.readInt32LE(i) / 2147483648
              : null;
    if (!read) return null;
    const per = Math.max(1, Math.round(rate * step)),
      windowBytes = per * frame,
      scale = 10 ** digits,
      peaks = [];
    const block = Buffer.alloc(Math.max(1, Math.floor(262144 / windowBytes)) * windowBytes);
    for (let at = 0; at + frame <= c.data.len; at += block.length) {
      const got = readSync(fd, block, 0, Math.min(block.length, c.data.len - at), c.data.at + at);
      if (got < frame) break;
      for (let w = 0; w + frame <= got; w += windowBytes) {
        const wEnd = Math.min(got, w + windowBytes);
        let p = 0;
        for (let i = w; i + bytes <= wEnd; i += bytes) {
          const v = Math.abs(read(block, i));
          if (Number.isFinite(v) && v > p) p = v;
        }
        peaks.push(Math.round(p * scale) / scale);
      }
    }
    return { step, peaks };
  } finally {
    closeSync(fd);
  }
};
const MAX_OGG_PEAK_BYTES = 64 * 1024 * 1024;
const pcm16BufferToPeaks = (buf, rate, step, digits) => {
  if (!buf?.length) return null;
  const per = Math.max(1, Math.round(rate * step)),
    scale = 10 ** digits,
    peaks = [];
  for (let at = 0; at + 2 <= buf.length; at += per * 2) {
    const end = Math.min(buf.length, at + per * 2);
    let p = 0;
    for (let i = at; i + 2 <= end; i += 2) {
      const v = Math.abs(buf.readInt16LE(i)) / 32768;
      if (v > p) p = v;
    }
    peaks.push(Math.min(1, Math.round(p * scale) / scale));
  }
  return { step, peaks };
};
export const oggPeaks = (file, step = PEAK_STEP, digits = 3) => {
  const rate = 8000;
  const res = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"],
    {
      maxBuffer: MAX_OGG_PEAK_BYTES,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (res.status !== 0 || !res.stdout?.length) return null;
  return pcm16BufferToPeaks(res.stdout, rate, step, digits);
};
export const oggPeaksAsync = (file, step = PEAK_STEP, digits = 3) =>
  new Promise((done) => {
    const rate = 8000;
    let settled = false;
    const finish = (val) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        done(val);
      }
    };
    const child = spawn(
      "ffmpeg",
      ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 30_000);
    const chunks = [];
    let total = 0;
    child.stdout.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_OGG_PEAK_BYTES) {
        child.kill();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0 || total === 0) {
        finish(null);
        return;
      }
      finish(pcm16BufferToPeaks(Buffer.concat(chunks, total), rate, step, digits));
    });
  });
export const audioPeaks = (file, step = PEAK_STEP, digits) =>
  file.toLowerCase().endsWith(".ogg") ? oggPeaks(file, step, digits) : wavPeaks(file, step, digits);
export const audioPeaksAsync = async (file, step = PEAK_STEP, digits) =>
  file.toLowerCase().endsWith(".ogg")
    ? oggPeaksAsync(file, step, digits)
    : wavPeaks(file, step, digits);

const jsonCache = new Map();
const readJsonCached = (file) => {
  if (!file || !existsSync(file)) return {};
  try {
    const { mtimeMs } = statSync(file),
      hit = jsonCache.get(file);
    if (hit?.mtimeMs === mtimeMs) return hit.data;
    const data = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (jsonCache.size >= 64 && !jsonCache.has(file)) {
      jsonCache.delete(jsonCache.keys().next().value);
    }
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch {
    return {};
  }
};

const findRepoVaultRoot = (project) => {
  for (let d = resolve(project), prev = ""; d !== prev; prev = d, d = dirname(d)) {
    if (existsSync(join(d, "vault.json"))) {
      try {
        return realpathSync(d);
      } catch {
        return d;
      }
    }
  }
  return null;
};

const validateStringVault = (project, rawVault) => {
  const absProj = resolve(project);
  const realProj = existsSync(absProj) ? realpathSync(absProj) : absProj;
  const repoRoot = findRepoVaultRoot(absProj);
  const dir = resolve(absProj, rawVault);
  let targetCheck = dir;
  if (existsSync(dir)) {
    if (lstatSync(dir).isSymbolicLink()) {
      throw new Error(`soundVault cannot be a symlink or junction: "${rawVault}"`);
    }
    targetCheck = realpathSync(dir);
  }
  const inProj = inside(absProj, dir) || inside(realProj, targetCheck);
  const inRepo = repoRoot ? inside(repoRoot, targetCheck) : false;
  if (!inProj && !inRepo) {
    throw new Error(`soundVault escapes allowed project/vault root: "${rawVault}"`);
  }
  return dir;
};

export const findVaults = (project, conf) => {
  if (conf.soundVault === false) return [];
  if (typeof conf.soundVault === "string") {
    const dir = validateStringVault(project, conf.soundVault);
    return existsSync(dir) ? [dir] : [];
  }
  for (let d = resolve(project), prev = ""; d !== prev; prev = d, d = dirname(d)) {
    const vf = join(d, "vault.json");
    if (existsSync(vf)) {
      const vcfg = readJsonCached(vf),
        vroot = resolve(d, vcfg.root ?? "vault");
      const mcLocal = join(vroot, "mc-sound");
      const mcExt = vcfg.externalRoot ? resolve(d, vcfg.externalRoot, "mc-sound") : null;
      const mcDir = existsSync(mcLocal) ? mcLocal : mcExt && existsSync(mcExt) ? mcExt : null;
      const sndDir = existsSync(join(vroot, "sound")) ? join(vroot, "sound") : null;
      return [mcDir, sndDir].filter(Boolean);
    }
  }
  return [];
};

const safeLocalFile = (realProject, candidate) => {
  if (!realProject || !candidate || !existsSync(candidate)) return null;
  try {
    if (lstatSync(candidate).isSymbolicLink()) return null;
    const real = realpathSync(candidate);
    if (!inside(realProject, real) || !statSync(real).isFile()) return null;
    return candidate;
  } catch {
    return null;
  }
};

const treeStamp = (root, maxDepth = 2, includeFiles = false) => {
  if (!root || !existsSync(root)) return "-";
  const out = [];
  const visit = (dir, depth) => {
    try {
      const st = lstatSync(dir);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        out.push(`L:${dir}`);
        return;
      }
      out.push(`D:${Math.round(st.mtimeMs)}`);
      if (depth >= maxDepth) return;
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.name.startsWith(".")) continue;
        const full = join(dir, d.name);
        if (d.isDirectory()) visit(full, depth + 1);
        else if (includeFiles && /\.(?:wav|ogg|json)$/i.test(d.name)) {
          try {
            const fst = lstatSync(full);
            out.push(
              `${d.name}:${fst.isSymbolicLink() ? "S" : Math.round(fst.mtimeMs)}:${fst.size}`,
            );
          } catch {
            out.push(`${d.name}:X`);
          }
        }
      }
    } catch {
      out.push("E");
    }
  };
  visit(root, 0);
  return out.join(";");
};

const walkAudio = (root, vaultDir, realBound, parts = [], out = new Map()) => {
  if (!root || !realBound || !existsSync(root)) return out;
  if (parts.length === 0 && !vaultDir) {
    try {
      if (lstatSync(root).isSymbolicLink() || !inside(realBound, realpathSync(root))) return out;
    } catch {
      return out;
    }
  }
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return out;
  }
  for (const d of entries) {
    if (d.name.startsWith(".")) continue;
    if (!vaultDir && d.isSymbolicLink()) continue;
    const full = join(root, d.name);
    if (d.isDirectory()) {
      if (d.isSymbolicLink()) {
        try {
          if (!inside(realBound, realpathSync(full))) continue;
        } catch {
          continue;
        }
      }
      walkAudio(full, vaultDir, realBound, [...parts, d.name], out);
    } else if (/\.(?:wav|ogg)$/i.test(d.name)) {
      if (!d.isSymbolicLink() && d.isFile()) {
        // Regular file inside an already-confined directory: zero extra stat/realpath syscalls
      } else if (!vaultDir) {
        continue;
      } else {
        let ok = false;
        try {
          const real = realpathSync(full);
          ok = inside(realBound, real) && statSync(real).isFile();
        } catch {
          ok = false;
        }
        if (!ok) continue;
      }
      const ext = extname(d.name);
      const kind =
        parts[0] === "bgm" || parts[0] === "sfx" || parts[0] === "mc" ? parts[0] : undefined;
      const category = (kind ? parts.slice(1) : parts).join("/") || undefined;
      out.set(d.name.slice(0, -ext.length), {
        file: full,
        kind,
        category,
        fromVault: !!vaultDir,
        vaultDir,
      });
    }
  }
  return out;
};

export const openSound = (project, conf = {}) => {
  if (!conf.soundTimeline || !conf.sfx) return null;
  const DIR = assertInsideDir(project, conf.sfx, "SFX folder");
  if (typeof conf.soundVault === "string") validateStringVault(project, conf.soundVault);
  const currentVaults = () => findVaults(project, conf);
  const timeline = openTimelineFile(project, conf.soundTimeline, SoundTimeline);
  const NAME = /^\w[\w.-]*$/;
  const ROLES = ["riser", "whoosh", "impact", "downlifter"]; // a cut sweetener's part (get_sfx.py sweeteners; app/sound/hit.ts)
  const ORIGINS = ["real", "synth"];
  const KINDS = ["bgm", "sfx", "mc"];

  const infos = new Map();
  const peaksCache = new Map();
  const inFlightPeaks = new Map();
  let localCache = null;
  let vaultCache = null;

  const getRealProject = () => {
    try {
      return existsSync(project) ? realpathSync(project) : null;
    } catch {
      return null;
    }
  };

  const statStamp = (p) => {
    try {
      return existsSync(p) ? `${Math.round(statSync(p).mtimeMs)}` : "-";
    } catch {
      return "-";
    }
  };
  const vaultStamp = (vaults) =>
    vaults
      .map(
        (v) =>
          `${v}:${treeStamp(v, 2, false)}:${statStamp(join(v, "SOURCES.json"))}:${statStamp(join(v, "PEAKS.json"))}`,
      )
      .join("|");

  const info = (name, file) => {
    const resolved = file ?? fileOf(name);
    if (!resolved) return null;
    try {
      const { mtimeMs } = statSync(resolved),
        have = infos.get(resolved);
      if (have?.mtimeMs === mtimeMs) return have;
      const fresh = { mtimeMs, wav: audioInfo(resolved) };
      if (infos.size >= 2048 && !infos.has(resolved)) {
        infos.delete(infos.keys().next().value);
      }
      infos.set(resolved, fresh);
      return fresh;
    } catch {
      return null;
    }
  };

  const buildItem = (name, entry, vaultSrc, filmSrc, vaultPeaks) => {
    let seconds =
      entry?.fromVault && entry.vaultDir
        ? (vaultPeaks ?? readJsonCached(join(entry.vaultDir, "PEAKS.json")))?.[name]?.seconds
        : undefined;
    if (!(seconds > 0)) {
      const file = entry?.file ?? fileOf(name);
      const meta = info(name, file);
      if (!meta) return null;
      seconds = meta.wav?.seconds ?? 0;
    }
    const s = filmSrc ? { ...vaultSrc, ...filmSrc } : (vaultSrc ?? {});
    const kind = KINDS.includes(s.kind) ? s.kind : entry?.kind;
    const category = (typeof s.category === "string" && s.category) || entry?.category;
    const source = entry?.fromVault ? (s.source ?? "vault") : filmSrc?.source;
    const family = typeof s.family === "string" && s.family ? s.family : undefined;
    const variant = Number.isInteger(s.variant) && s.variant > 0 ? s.variant : undefined;
    const url = typeof s.url === "string" && /^https?:\/\//i.test(s.url) ? s.url : undefined;
    return {
      name,
      seconds: +seconds.toFixed(3),
      title: s.title,
      license: s.license,
      url,
      for: s.for,
      kind,
      role: ROLES.includes(s.role) ? s.role : undefined,
      ...(ORIGINS.includes(s.origin) && { origin: s.origin }),
      ...(category && { category }),
      ...(source && { source }),
      ...(family && { family }),
      ...(variant !== undefined && { variant }),
      ...(s.contentId === true && { contentId: true }),
    };
  };

  const ensureVault = (force = false) => {
    const vaults = currentVaults();
    const stamp = vaultStamp(vaults);
    if (!vaultCache || force || stamp !== vaultCache.stamp) {
      const entries = new Map();
      const sources = {};
      const peaksByVault = new Map();
      for (const v of vaults) {
        let realV = null;
        try {
          realV = existsSync(v) ? realpathSync(v) : null;
        } catch {
          realV = null;
        }
        if (realV) walkAudio(v, v, realV, [], entries);
        Object.assign(sources, readJsonCached(join(v, "SOURCES.json")));
        peaksByVault.set(v, readJsonCached(join(v, "PEAKS.json")));
      }
      const items = [...entries.keys()]
        .filter((n) => NAME.test(n))
        .sort((a, b) => a.localeCompare(b))
        .flatMap((n) => {
          const e = entries.get(n);
          const item = buildItem(n, e, sources[n], undefined, peaksByVault.get(e?.vaultDir));
          return item ? [item] : [];
        });
      vaultCache = { stamp, entries, sources, items };
    }
    return vaultCache;
  };

  const scanLocal = () => {
    const stamp = treeStamp(DIR, 3, true);
    if (!localCache || localCache.stamp !== stamp) {
      localCache = {
        stamp,
        entries: walkAudio(DIR, null, getRealProject(), [], new Map()),
      };
    }
    return localCache.entries;
  };

  function resolveSound(name) {
    if (!NAME.test(name)) return null;
    const realProj = getRealProject();
    if (Object.hasOwn(conf.soundSources ?? {}, name)) {
      const f = safeLocalFile(realProj, join(project, conf.soundSources[name]));
      return f ? { file: f, entry: null } : null;
    }
    for (const ext of [".wav", ".ogg"]) {
      const direct = safeLocalFile(realProj, join(DIR, `${name}${ext}`));
      if (direct) return { file: direct, entry: null };
    }
    const localEntry = scanLocal().get(name);
    if (localEntry?.file && safeLocalFile(realProj, localEntry.file)) {
      return { file: localEntry.file, entry: localEntry };
    }
    const vaultEntry = ensureVault(false).entries.get(name);
    if (vaultEntry?.file && existsSync(vaultEntry.file)) {
      return { file: vaultEntry.file, entry: vaultEntry };
    }
    if (name === "narration") {
      const f = safeLocalFile(realProj, join(project, "assets/public/agent/full_voice.wav"));
      return f ? { file: f, entry: null } : null;
    }
    return null;
  }

  function fileOf(name) {
    return resolveSound(name)?.file ?? null;
  }

  let libCache = null;
  const library = () => {
    const vc = ensureVault(false);
    const locals = scanLocal();
    const realProj = getRealProject();
    const rawSourcesPath = join(DIR, "SOURCES.json");
    const filmSourcesPath = safeLocalFile(realProj, rawSourcesPath);
    const filmSources = filmSourcesPath ? readJsonCached(filmSourcesPath) : {};
    const srcStamp = Object.entries(conf.soundSources ?? {})
      .map(([k, rel]) => `${k}:${statStamp(join(project, rel))}`)
      .join(",");
    const defaultNarrFile = join(project, "assets/public/agent/full_voice.wav");
    const libStamp = `${vc.stamp}|${localCache?.stamp ?? "-"}|${statStamp(filmSourcesPath)}|${srcStamp}|${statStamp(defaultNarrFile)}`;
    if (libCache?.stamp === libStamp) return libCache.items;

    const defaultNarration = safeLocalFile(realProj, defaultNarrFile) ? ["narration"] : [];
    const overrideSet = new Set([
      ...locals.keys(),
      ...Object.keys(conf.soundSources ?? {}),
      ...defaultNarration,
      ...Object.keys(filmSources).filter((n) => vc.entries.has(n)),
    ]);
    if (overrideSet.size === 0) {
      libCache = { stamp: libStamp, items: vc.items };
      return vc.items;
    }

    const localItems = [...overrideSet]
      .filter((n) => NAME.test(n) && (locals.has(n) || vc.entries.has(n) || fileOf(n)))
      .sort((a, b) => a.localeCompare(b))
      .flatMap((name) => {
        const entry = Object.hasOwn(conf.soundSources ?? {}, name)
          ? undefined
          : (locals.get(name) ?? vc.entries.get(name));
        const item = buildItem(name, entry, vc.sources[name], filmSources[name]);
        return item ? [item] : [];
      });

    const base = vc.items.filter((x) => !overrideSet.has(x.name));
    if (localItems.length === 0) {
      libCache = { stamp: libStamp, items: base };
      return base;
    }
    const merged = [];
    let cursor = 0;
    for (const loc of localItems) {
      let lo = cursor,
        hi = base.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (base[mid].name.localeCompare(loc.name) < 0) lo = mid + 1;
        else hi = mid;
      }
      if (lo > cursor) merged.push(...base.slice(cursor, lo));
      merged.push(loc);
      cursor = lo;
    }
    if (cursor < base.length) merged.push(...base.slice(cursor));
    libCache = { stamp: libStamp, items: merged };
    return merged;
  };

  const storePeaks = (f, mtimeMs, data) => {
    if (!data) return null;
    if (peaksCache.size >= 256 && !peaksCache.has(f)) {
      peaksCache.delete(peaksCache.keys().next().value);
    }
    peaksCache.set(f, { mtimeMs, data });
    return data;
  };

  const precomputedVaultPeaks = (name, resolved) => {
    const { file: f, entry } = resolved;
    if (entry?.fromVault && entry.vaultDir && entry.file === f) {
      const pre = readJsonCached(join(entry.vaultDir, "PEAKS.json"))?.[name];
      if (pre && Array.isArray(pre.peaks)) return { step: pre.step ?? PEAK_STEP, peaks: pre.peaks };
    }
    return null;
  };

  const peaks = (name) => {
    const resolved = resolveSound(name);
    if (!resolved) return null;
    const pre = precomputedVaultPeaks(name, resolved);
    if (pre) return pre;
    const f = resolved.file;
    const i = info(name, f);
    if (!i) return null;
    try {
      const hit = peaksCache.get(f);
      if (hit?.mtimeMs === i.mtimeMs) return hit.data;
      return storePeaks(f, i.mtimeMs, audioPeaks(f));
    } catch {
      return null;
    }
  };

  const peaksAsync = async (name) => {
    const resolved = resolveSound(name);
    if (!resolved) return null;
    const pre = precomputedVaultPeaks(name, resolved);
    if (pre) return pre;
    const f = resolved.file;
    const i = info(name, f);
    if (!i) return null;
    const hit = peaksCache.get(f);
    if (hit?.mtimeMs === i.mtimeMs) return hit.data;
    const inflightKey = `${f}:${i.mtimeMs}`;
    let pending = inFlightPeaks.get(inflightKey);
    if (!pending) {
      pending = audioPeaksAsync(f)
        .then((data) => storePeaks(f, i.mtimeMs, data))
        .catch(() => null)
        .finally(() => {
          inFlightPeaks.delete(inflightKey);
        });
      inFlightPeaks.set(inflightKey, pending);
    }
    return pending;
  };

  return {
    ...timeline,
    DIR,
    get VAULT() {
      return currentVaults().at(-1) ?? null;
    },
    get VAULTS() {
      return currentVaults();
    },
    library,
    peaks,
    peaksAsync,
    fileOf,
  };
};
