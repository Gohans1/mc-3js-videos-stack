// The film's sound lanes as the studio edits them: package.json "live-studio": { "soundTimeline": file, "sfx": folder } names
// the timeline (beds that run from..to, one-shots at a time) and the folder of WAVs it plays, with SOURCES.json beside them for
// titles and licences (and kind: "bgm" or "sfx" where a file's length would put it in the wrong library tab). The page drags, trims and levels clips; timeline_file.mjs writes the file, and the film's sound watcher remixes.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { SoundTimeline } from "./contract.mjs";
import { openTimelineFile } from "./timeline_file.mjs";

// ---------- WAV: length from the header, and a coarse level curve for the lanes (PCM 16/24/32 bit and 32 bit float)
const chunks = (fd, size) => {
  const head = Buffer.alloc(12);
  readSync(fd, head, 0, 12, 0);
  if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
  const found = {};
  for (let at = 12; at + 8 <= size;) {
    const h = Buffer.alloc(8);
    readSync(fd, h, 0, 8, at);
    const id = h.toString("ascii", 0, 4), len = h.readUInt32LE(4);
    found[id.trim()] = { at: at + 8, len: Math.min(len, size - at - 8) };
    at += 8 + len + (len % 2);
  }
  return found;
};
const format = (fd, c) => {
  const f = Buffer.alloc(16);
  readSync(fd, f, 0, 16, c.fmt.at);
  return { tag: f.readUInt16LE(0), channels: f.readUInt16LE(2), rate: f.readUInt32LE(4), bits: f.readUInt16LE(14) };
};
export const wavInfo = (file) => {
  const fd = openSync(file, "r");
  try {
    const c = chunks(fd, statSync(file).size);
    if (!c?.fmt || !c.data) return null;
    const f = format(fd, c);
    return { ...f, seconds: c.data.len / (f.rate * f.channels * (f.bits / 8)) };
  } finally { closeSync(fd); }
};
const PEAK_STEP = 0.02;
export const wavPeaks = (file) => {
  const fd = openSync(file, "r");
  try {
    const c = chunks(fd, statSync(file).size);
    if (!c?.fmt || !c.data) return null;
    const { tag, channels, rate, bits } = format(fd, c), bytes = bits / 8, frame = bytes * channels;
    const read = tag === 3 && bits === 32 ? (b, i) => b.readFloatLE(i)
      : bits === 16 ? (b, i) => b.readInt16LE(i) / 32768
      : bits === 24 ? (b, i) => b.readIntLE(i, 3) / 8388608
      : bits === 32 ? (b, i) => b.readInt32LE(i) / 2147483648 : null;
    if (!read) return null;
    const per = Math.max(1, Math.round(rate * PEAK_STEP)), peaks = [];
    const block = Buffer.alloc(per * frame);
    for (let at = 0; at + frame <= c.data.len; at += per * frame) {
      const got = readSync(fd, block, 0, Math.min(block.length, c.data.len - at), c.data.at + at);
      let p = 0;
      for (let i = 0; i + bytes <= got; i += bytes) { const v = Math.abs(read(block, i)); if (Number.isFinite(v) && v > p) p = v; }
      peaks.push(Math.round(p * 1e6) / 1e6);
    }
    return { step: PEAK_STEP, peaks };
  } finally { closeSync(fd); }
};

export const openSound = (project, conf = {}) => {
  if (!conf.soundTimeline || !conf.sfx) return null;
  const DIR = join(project, conf.sfx), timeline = openTimelineFile(project, conf.soundTimeline, SoundTimeline);

  const infos = new Map();
  const info = (name) => {
    const file = join(DIR, `${name}.wav`), { mtimeMs } = statSync(file), have = infos.get(name);
    if (have?.mtimeMs === mtimeMs) return have;
    const fresh = { mtimeMs, wav: wavInfo(file), peaks: null };
    infos.set(name, fresh);
    return fresh;
  };
  const NAME = /^[\w.-]+$/;
  const ROLES = ["riser", "whoosh", "impact", "downlifter"]; // a cut sweetener's part (get_sfx.py sweeteners; app/sound/hit.ts)
  const fileOf = (name) => (NAME.test(name) && existsSync(join(DIR, `${name}.wav`)) ? join(DIR, `${name}.wav`) : null);
  const library = () => {
    if (!existsSync(DIR)) return [];
    const sources = existsSync(join(DIR, "SOURCES.json")) ? JSON.parse(readFileSync(join(DIR, "SOURCES.json"), "utf8")) : {};
    return readdirSync(DIR).filter((f) => f.endsWith(".wav")).map((f) => basename(f, ".wav")).filter((n) => NAME.test(n)).sort().map((name) => {
      const s = sources[name] ?? {};
      return { name, seconds: +(info(name).wav?.seconds ?? 0).toFixed(3), title: s.title, license: s.license, url: s.url, for: s.for, kind: ["bgm", "sfx"].includes(s.kind) ? s.kind : undefined, role: ROLES.includes(s.role) ? s.role : undefined };
    });
  };
  const peaks = (name) => { const i = info(name); return (i.peaks ??= wavPeaks(join(DIR, `${name}.wav`))); };

  return { ...timeline, DIR, library, peaks, fileOf };
};
