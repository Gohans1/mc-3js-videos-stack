import { execFile, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { wavInfo, wavPeaks } from "../packages/live-studio/src/sound.mjs";
import { download, validAudio, validWav } from "./download.mjs";
import { EXTERNAL, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Rebuilds vault/sound/{bgm,sfx}/<category>/ (WAV, -1 dBFS peaks) with SOURCES.json (title, licence, url) and PEAKS.json
from the downloaded Mixkit, Freesound CC0, Earshot bank and Cinetic BGM sources, and from the raw packs that
bun run fetch:sound-raw unpacked, filed by each pack's sort rules in scripts/sound-raw.json. From the repo root:
  bun run setup:sound
A rebuild that re-files a sound moves it, so it never sits in two categories; a raw pack's sound its rules no longer
take leaves the vault. Look a sound up: bun run find <words>.`;
cliArgs(HELP, [], 0);

const run = promisify(execFile);

const MIXKIT_CATEGORY = {
  "whoosh.short": "transitions",
  "whoosh.medium": "transitions",
  "whoosh.long": "transitions",
  riser: "transitions",
  reverse: "transitions",
  impact: "impacts",
  sub: "impacts",
  lockup: "impacts",
  "click.hard": "clicks",
  "click.soft": "clicks",
  pop: "clicks",
  key: "typing",
  typing: "typing",
  notification: "notifications",
  note: "musical",
  glass: "musical",
  shutter: "shutter",
  tick: "foley",
  paper: "foley",
};
// The catalogue's role is the sound's job, not always its category: a UI chime and a glass clink
const MIXKIT_ID_CATEGORY = { "mixkit-1107": "notifications", "mixkit-154": "foley" };

const MIXKIT_SWEETENERS = {
  "mixkit-790": "riser",
  "mixkit-784": "riser",
  "mixkit-168": "whoosh",
  "mixkit-1465": "whoosh",
  "mixkit-1486": "whoosh",
  "mixkit-2908": "impact",
  "mixkit-2299": "impact",
  "mixkit-2182": "impact",
};

// Public CDN -hq.ogg previews for Earshot's 15 CC0 1.0 Freesound source recordings (earshot/forge/bank/fit.json).
const FREESOUND_PREVIEWS = {
  "fs-452379": "https://cdn.freesound.org/previews/452/452379_1844073-hq.ogg",
  "fs-167829": "https://cdn.freesound.org/previews/167/167829_71257-hq.ogg",
  "fs-386888": "https://cdn.freesound.org/previews/386/386888_3094998-hq.ogg",
  "fs-789630": "https://cdn.freesound.org/previews/789/789630_5287430-hq.ogg",
  "fs-665075": "https://cdn.freesound.org/previews/665/665075_2686637-hq.ogg",
  "fs-378084": "https://cdn.freesound.org/previews/378/378084_6260145-hq.ogg",
  "fs-789628": "https://cdn.freesound.org/previews/789/789628_5287430-hq.ogg",
  "fs-704862": "https://cdn.freesound.org/previews/704/704862_2628405-hq.ogg",
  "fs-452621": "https://cdn.freesound.org/previews/452/452621_612689-hq.ogg",
  "fs-760337": "https://cdn.freesound.org/previews/760/760337_9616576-hq.ogg",
  "fs-202230": "https://cdn.freesound.org/previews/202/202230_3725006-hq.ogg",
  "fs-181907": "https://cdn.freesound.org/previews/181/181907_850742-hq.ogg",
  "fs-278205": "https://cdn.freesound.org/previews/278/278205_4965320-hq.ogg",
  "fs-329098": "https://cdn.freesound.org/previews/329/329098_3035766-hq.ogg",
  "fs-427979": "https://cdn.freesound.org/previews/427/427979_2247456-hq.ogg",
};

const FREESOUND_FOLEY = new Set(["fs-452621", "fs-760337", "fs-329098"]);

// journey-roa excluded: roa-music.com/how-to-use states copyrighted (disputes Chosic CC BY 3.0).
const DISPUTED_BGM = new Set(["journey-roa"]);

const BGM_DIRECT_URLS = {
  "limit-70": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Limit%2070.mp3",
  convergence: "https://www.scottbuckley.com.au/library/wp-content/uploads/2026/04/Convergence.mp3",
  "night-owl":
    "https://upload.wikimedia.org/wikipedia/commons/6/68/Broke_For_Free_-_01_-_Night_Owl.ogg",
  "code-switch": "https://www.free-stock-music.com/music/punch-deck/mp3/punch-deck-code-switch.mp3",
};

const BGM_REFERERS = {
  "code-switch": "https://www.free-stock-music.com/punch-deck-code-switch.html",
};

const BGM_META_OVERRIDES = {
  "code-switch": { source: "punch-deck", url: "https://soundcloud.com/punch-deck/code-switch" },
};

const BGM_CATEGORY = {
  "deep-urban": "electronic",
  "tech-house-vibes": "electronic",
  "minimal-techno-01": "electronic",
  "close-up": "electronic",
  "brain-dance": "electronic",
  "hazy-after-hours": "chill",
  "digital-clouds": "chill",
  "beauty-flow": "chill",
  "limit-70": "chill",
  "night-owl": "chill",
  convergence: "cinematic",
  amalgam: "cinematic",
  "code-switch": "cinematic",
};

const hasRiffWave = (p) => {
  if (!existsSync(p) || statSync(p).size <= 44) return false;
  const fd = openSync(p, "r");
  try {
    const b = Buffer.alloc(12);
    if (readSync(fd, b, 0, 12, 0) < 12) return false;
    return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";
  } finally {
    closeSync(fd);
  }
};

export function syncSoundVaultPeaks(vaultSound) {
  if (!existsSync(vaultSound)) return 0;
  const peaksFile = join(vaultSound, "PEAKS.json");
  let prev = {};
  if (existsSync(peaksFile)) {
    try {
      prev = JSON.parse(readFileSync(peaksFile, "utf8"));
    } catch {
      prev = {};
    }
  }
  const next = {};
  let computed = 0;
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (d.name.startsWith(".")) continue;
      const full = join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.toLowerCase().endsWith(".wav")) {
        const stem = d.name.slice(0, -extname(d.name).length);
        const st = statSync(full);
        const mtimeMs = Math.round(st.mtimeMs);
        const old = prev[stem];
        if (
          old &&
          old.size === st.size &&
          old.mtimeMs === mtimeMs &&
          typeof old.seconds === "number" &&
          Array.isArray(old.peaks)
        ) {
          next[stem] = old;
        } else {
          const info = wavInfo(full);
          const pk = wavPeaks(full, 0.02, 3);
          if (info && pk) {
            next[stem] = {
              seconds: +info.seconds.toFixed(3),
              step: pk.step,
              peaks: pk.peaks,
              size: st.size,
              mtimeMs,
            };
            computed++;
          }
        }
      }
    }
  };
  walk(vaultSound);
  const part = `${peaksFile}.${process.pid}.${Date.now()}.part`;
  writeFileSync(part, JSON.stringify(next) + "\n");
  renameSync(part, peaksFile);
  return computed;
}

const cleanSoundTitle = (raw) => {
  const s = String(raw ?? "")
    .replace(/\.(?:wav|flac|ogg|mp3|m4a)$/i, "")
    .replaceAll("_", " ")
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

const fitCategoryOf = (fitId, fsId) => {
  if (FREESOUND_FOLEY.has(fsId)) return "foley";
  const role = fitId.split("/")[1] ?? "";
  if (role.startsWith("whoosh")) return "transitions";
  if (role === "hit") return "impacts";
  if (role.startsWith("key")) return "typing";
  if (role === "bell") return "musical";
  return "clicks";
};

// A rebuild that re-files a sound moves it, so it never sits in two categories
const moveIntoCategory = (vaultSound, kind, target) => {
  if (existsSync(target)) return;
  const kindDir = join(vaultSound, kind);
  if (!existsSync(kindDir)) return;
  for (const cat of readdirSync(kindDir, { withFileTypes: true })) {
    const old = join(kindDir, cat.name, basename(target));
    if (cat.isDirectory() && existsSync(old)) {
      mkdirSync(dirname(target), { recursive: true });
      renameSync(old, target);
      return;
    }
  }
};

// normalize: bring every sound's peak to -1 dBFS (a library's quiet takes come up, at most MAX_BOOST_DB); otherwise only
// a hot one comes down
const MAX_BOOST_DB = 30;
const peakOf = async (raw, seek = []) => {
  const stat = await run(
    "ffmpeg",
    [...seek, "-i", raw, "-af", "astats=metadata=0:reset=0", "-f", "null", "-"],
    { timeout: 120_000, windowsHide: true },
  );
  const peaks = [...stat.stderr.matchAll(/Peak level dB:\s*([-\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter(Number.isFinite);
  return peaks.length ? Math.max(...peaks) : -1;
};
// from/to: one take of a longer file, faded in 3 ms and out 10 ms so its cut never clicks
async function convertToPcmWav(
  raw,
  target,
  { rate = 44100, channels, normalize = false, from, to } = {},
) {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.${process.pid}.part.wav`;
  try {
    const seek = to === undefined ? [] : ["-ss", from.toFixed(3), "-to", to.toFixed(3)];
    const peak = await peakOf(raw, seek);
    const gainDb = normalize ? Math.min(-1 - peak, MAX_BOOST_DB) : peak > -1 ? -1 - peak : 0;
    const filters = [
      ...(gainDb ? [`volume=${gainDb.toFixed(2)}dB`] : []),
      ...(to === undefined
        ? []
        : ["afade=t=in:d=0.003", `afade=t=out:st=${(to - from - 0.01).toFixed(3)}:d=0.01`]),
    ];
    const af = filters.length ? ["-af", filters.join(",")] : [];
    const ac = channels ? ["-ac", String(channels)] : [];
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        ...seek,
        "-i",
        raw,
        ...af,
        "-ar",
        String(rate),
        ...ac,
        "-c:a",
        "pcm_s16le",
        part,
      ],
      { timeout: 90_000, windowsHide: true },
    );
    if (!hasRiffWave(part)) throw new Error(`Invalid WAV converted from ${raw}`);
    renameSync(part, target);
  } finally {
    rmSync(part, { force: true });
  }
}

function findPixabayDropFile(dropDir, track) {
  if (!dropDir || !existsSync(dropDir)) return null;
  const numId = track.page?.match(/-(\d+)\/?$/)?.[1];
  const files = readdirSync(dropDir);
  const hit = files.find((f) => {
    const lower = f.toLowerCase();
    if (!lower.endsWith(".mp3") && !lower.endsWith(".wav")) return false;
    return (
      (numId && new RegExp(`-${numId}\\.(?:mp3|wav)$`, "i").test(f)) ||
      lower === `${track.id}.mp3` ||
      lower === `${track.id}.wav`
    );
  });
  return hit ? join(dropDir, hit) : null;
}

const saveSources = (file, sources) => {
  mkdirSync(dirname(file), { recursive: true });
  const sorted = Object.fromEntries(
    Object.keys(sources)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => [k, sources[k]]),
  );
  writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
};

const RAW_AUDIO = /\.(?:ogg|wav|mp3|flac)$/i;
const NATURAL = new Intl.Collator(undefined, { numeric: true });
const slug = (s) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
// "impactWood_heavy" -> "Impact wood heavy"; an all-caps word stays ("jingles_NES" -> "Jingles NES")
const humanize = (s) => {
  const t = s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s*,\s*/g, ", ")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// Takes of one sound differ only by a trailing number ("click_003", "footstep07"); a name that is only a number is its own
const baseOf = (stem) => stem.match(/^(.*?[^\d\s_-])[\s_-]*\d+$/)?.[1] ?? stem;
const audioFiles = (dir, at = "") =>
  readdirSync(join(dir, at), { withFileTypes: true })
    .flatMap((d) => {
      const rel = at ? `${at}/${d.name}` : d.name;
      if (d.name.startsWith(".")) return [];
      if (d.isDirectory()) return audioFiles(dir, rel);
      return RAW_AUDIO.test(d.name) ? [rel] : [];
    })
    .sort(NATURAL.compare);
const secondsOf = async (file) => {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { timeout: 30_000, windowsHide: true },
  );
  return Number(stdout.trim());
};
// A file of many takes cut at its silences, as an editor's strip silence does (Sound Forge "remove silence between
// phrases"), on a 5 ms peak envelope: a gap is 0.35 s below 45 dB under the file's peak. A stretch more than
// MAX_BOOST_DB under that peak is noise between takes, not a take. Each take's edges are found again against its own
// peak (a quiet take's file-level gap is still inside its attack and tail): 10 ms before the first block within 40 dB
// of it, 20 ms after the last, at most 0.5 s past where the file-level gap began, never past half the gap
const TAKE = {
  rate: 16000,
  blockS: 0.005,
  gapDb: 45,
  gapS: 0.35,
  edgeDb: 40,
  preS: 0.01,
  releaseS: 0.02,
  tailMaxS: 0.5,
  shortestS: 0.05,
};
// Longer than this is an ambience, not a row of takes: never decoded to look for gaps
const SPLIT_MAX_S = 300;
async function takesOf(file) {
  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(TAKE.rate), "-f", "f32le", "-"],
    { encoding: "buffer", maxBuffer: 2 ** 30, timeout: 300_000, windowsHide: true },
  );
  const samples = stdout.length >> 2;
  const per = Math.round(TAKE.rate * TAKE.blockS);
  const env = new Float64Array(Math.ceil(samples / per));
  for (let i = 0; i < samples; i++)
    env[(i / per) | 0] = Math.max(env[(i / per) | 0], Math.abs(stdout.readFloatLE(i * 4)));
  const maxOf = (a, z) => env.subarray(a, z + 1).reduce((m, v) => Math.max(m, v), 0);
  const peak = maxOf(0, env.length - 1);
  const db = (d) => peak * 10 ** (-d / 20);
  const gapBlocks = Math.round(TAKE.gapS / TAKE.blockS);
  const runs = [];
  for (let b = 0; b < env.length; b++) {
    if (env[b] <= db(TAKE.gapDb)) continue;
    const last = runs.at(-1);
    if (last && b - last[1] <= gapBlocks) last[1] = b;
    else runs.push([b, b]);
  }
  const s = (b) => b * TAKE.blockS;
  return runs.flatMap(([a, z], i) => {
    const top = maxOf(a, z);
    if (top < db(MAX_BOOST_DB)) return [];
    const from = i ? Math.ceil((runs[i - 1][1] + a) / 2) : 0;
    const to = Math.min(
      i + 1 < runs.length ? Math.floor((z + runs[i + 1][0]) / 2) : env.length - 1,
      z + Math.round(TAKE.tailMaxS / TAKE.blockS),
    );
    const edge = top * 10 ** (-TAKE.edgeDb / 20);
    while (a > from && env[a - 1] > edge) a--;
    while (z < to && env[z + 1] > edge) z++;
    const span = [
      Math.max(s(from), s(a) - TAKE.preS),
      Math.min(s(to + 1), samples / TAKE.rate, s(z + 1) + TAKE.releaseS),
    ];
    return span[1] - span[0] >= TAKE.shortestS ? [span] : [];
  });
}
// Each file's length and takes, kept beside the pack so a rebuild reads no long file twice
const packCache = (dir) => {
  const file = join(dir, ".sort-cache.json");
  const params = JSON.stringify(TAKE);
  let saved = {};
  try {
    const got = JSON.parse(readFileSync(file, "utf8"));
    if (got.params === params) saved = got.files;
  } catch {}
  const files = {};
  const entry = (rel) => {
    if (files[rel]) return files[rel];
    const st = statSync(join(dir, rel));
    const had = saved[rel];
    files[rel] =
      had && had.size === st.size && had.mtimeMs === st.mtimeMs
        ? had
        : { size: st.size, mtimeMs: st.mtimeMs };
    return files[rel];
  };
  const write = (all) => writeFileSync(file, JSON.stringify({ params, files: all }) + "\n");
  return {
    seconds: async (rel) => {
      const e = entry(rel);
      e.seconds ??= await secondsOf(join(dir, rel));
      return e.seconds;
    },
    // Saved after each file it decodes (seconds each on a busy disk), so a stopped build loses none of them
    takes: async (rel) => {
      const e = entry(rel);
      if (!e.takes) {
        e.takes = await takesOf(join(dir, rel));
        write({ ...saved, ...files });
      }
      return e.takes;
    },
    save: () => write(files),
  };
};
const pool = async (items, n, work) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
};

// The raw packs fetch:sound-raw unpacked, each file filed by the first sort rule that matches its name, else its path
// in the pack (a folder named "Hits & Whooshes" holds both): the pack's own rules, then its source's. A file longer
// than "maxSeconds" (the rule's, else the source's) gives one sound per take when its silences cut it into takes
// that fit, and is left out otherwise.
// A file no rule takes is named, never guessed into a category; a rule with "skip" leaves files out on
// purpose. Sounds whose names differ only by a trailing number become one family of takes, unless the rule says
// "takes": false. A rule's "title" wraps the file's name ("{name} (female voice)")
async function buildRawPacks({ root, external, vaultSound, sources, log }) {
  const file = join(root, "scripts/sound-raw.json");
  if (!existsSync(file)) return;
  for (const [srcId, src] of Object.entries(JSON.parse(readFileSync(file, "utf8")).sources)) {
    const skip = src.skip ? new RegExp(src.skip) : null;
    for (const pack of src.packs) {
      const dir = join(external, "sound-raw", srcId, pack.id),
        packId = `${srcId}/${pack.id}`;
      // fetch:sound-raw writes .pack.json once a pack is whole: a torrent still running holds half-written files
      if (!existsSync(join(dir, ".pack.json"))) {
        log(`${packId}: not downloaded yet (bun run fetch:sound-raw)`);
        continue;
      }
      const rules = [...(pack.sort ?? []), ...(src.sort ?? [])].map((r) => ({
        ...r,
        re: new RegExp(r.match),
      }));
      const files = audioFiles(dir).filter((rel) => !skip?.test(rel));
      // "take 12.M": a mono file's mark, not part of its name
      const stemOf = (rel) =>
        basename(rel)
          .replace(RAW_AUDIO, "")
          .replace(/\.(?:M|MS)$/i, "");
      const titleDrop = src.titleDrop ? new RegExp(src.titleDrop, "g") : null;
      const stems = Map.groupBy(files, stemOf);
      const unsorted = [];
      let picked = [];
      for (const rel of files) {
        const rule =
          rules.find((r) => r.re.test(basename(rel))) ?? rules.find((r) => r.re.test(rel));
        if (!rule) unsorted.push(rel);
        if (!rule || rule.skip) continue;
        // "takes": false = the number names a different line ("round_2"), not another take of one sound
        const stem = stemOf(rel),
          base = rule.takes === false ? stem : baseOf(stem);
        // the same file name in two folders of a pack (Female/go, Male/go) takes its folder into its name
        const own = stems.get(stem).length > 1 ? `${basename(dirname(rel))}-${stem}` : stem;
        picked.push({
          rel,
          rule,
          limit: rule.maxSeconds ?? src.maxSeconds,
          name: `${src.prefix}-${pack.key}-${slug(own)}`,
          family: `${src.prefix}-${pack.key}-${slug(rule.takes === false ? own : base)}`,
          title: (rule.title ?? "{name}").replace(
            "{name}",
            humanize(titleDrop ? base.replace(titleDrop, " ") : base),
          ),
        });
      }
      // A long file is an ambience or many takes in one: not a sound to drop on a cue as it is. One whose silences cut
      // it into takes that each fit the limit gives one sound per take; any other stays out
      const cache = packCache(dir);
      const long = new Map();
      await pool(
        picked.filter((p) => p.limit),
        6,
        async (p) => {
          const seconds = await cache.seconds(p.rel);
          if (!(seconds <= p.limit)) long.set(p, seconds);
        },
      );
      const cut = new Map();
      await pool(
        [...long].filter(([, seconds]) => seconds <= SPLIT_MAX_S),
        6,
        async ([p]) => {
          const takes = await cache.takes(p.rel);
          if (takes.length > 1 && takes.every(([a, b]) => b - a <= p.limit)) cut.set(p, takes);
        },
      );
      cache.save();
      // A take's span (seconds in its file, to the ms) is kept in SOURCES.json: a take whose span moved is cut again
      picked = picked.flatMap((p) =>
        !long.has(p)
          ? [p]
          : (cut.get(p)?.map((span, i) => ({
              ...p,
              name: `${p.name}-take-${i + 1}`,
              span: span.map((s) => Math.round(s * 1000) / 1000),
            })) ?? []),
      );
      const families = Map.groupBy(picked, (p) => p.family);
      let converted = 0;
      await pool(picked, 6, async (p) => {
        const target = join(vaultSound, "sfx", p.rule.category, `${p.name}.wav`);
        moveIntoCategory(vaultSound, "sfx", target);
        if (hasRiffWave(target) && String(sources[p.name]?.span) === String(p.span)) return;
        await convertToPcmWav(join(dir, p.rel), target, {
          rate: 48000,
          normalize: true,
          ...(p.span && { from: p.span[0], to: p.span[1] }),
        });
        converted++;
      });
      const kept = new Set(picked.map((p) => p.name));
      for (const [name, v] of Object.entries(sources)) {
        if (v.pack !== packId || kept.has(name)) continue;
        delete sources[name];
        for (const cat of readdirSync(join(vaultSound, "sfx")))
          rmSync(join(vaultSound, "sfx", cat, `${name}.wav`), { force: true });
      }
      for (const p of picked) {
        const takes = families.get(p.family);
        sources[p.name] = {
          title: p.title,
          license: src.licence,
          url: pack.page,
          for: p.rule.for,
          source: srcId,
          kind: "sfx",
          origin: "real",
          ...(takes.length > 1 && { family: p.family, variant: takes.indexOf(p) + 1 }),
          pack: packId,
          ...(p.span && { span: p.span }),
        };
      }
      log(
        `${packId}: ${picked.length} sounds in ${families.size} families (${converted} converted)`,
      );
      if (cut.size)
        log(
          `${packId}: ${cut.size} files cut into ${[...cut.values()].reduce((n, t) => n + t.length, 0)} takes`,
        );
      if (long.size > cut.size)
        log(
          `${packId}: ${long.size - cut.size} files longer than its limit left out (maxSeconds in scripts/sound-raw.json)`,
        );
      if (unsorted.length)
        log(
          `${packId}: ${unsorted.length} files no sort rule takes (add a rule, or one with "skip"): ${unsorted.slice(0, 20).join(", ")}${unsorted.length > 20 ? ", ..." : ""}`,
        );
    }
  }
}

export async function buildSoundVault({
  root = ROOT,
  local = LOCAL,
  external = EXTERNAL,
  skipBgm = false,
  skipEarshot = false,
  skipFreesound = false,
  pixabayDir,
  log = console.log,
} = {}) {
  const vaultSound = join(local, "sound"),
    sourcesFile = join(vaultSound, "SOURCES.json");
  const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, "utf8")) : {};
  const dropDir = pixabayDir ?? (local === LOCAL ? join(homedir(), "Downloads") : undefined);

  // 1. Mixkit curated SFX: the cinetic kit's catalogue.sounds (catalogue.rejected excluded), filed by role, and the
  // vault's own picks (scripts/sfx-picks.json), each naming its category; reuse the vault/sfx/mixkit cache
  const catalogue = JSON.parse(readFileSync(join(root, "scripts/sfx-catalogue.json"), "utf8"));
  const picksFile = join(root, "scripts/sfx-picks.json");
  const picks = existsSync(picksFile) ? JSON.parse(readFileSync(picksFile, "utf8")).sounds : [];
  const mixkitKept = [...(catalogue.sounds ?? []), ...picks];
  let mixLinked = 0,
    mixFetched = 0,
    mixReused = 0;
  for (const s of mixkitKept) {
    const cat = s.category ?? MIXKIT_ID_CATEGORY[s.id] ?? MIXKIT_CATEGORY[s.role] ?? "foley";
    const target = join(vaultSound, "sfx", cat, `${s.id}.wav`),
      cached = join(local, "sfx/mixkit", `${s.id}.wav`);
    moveIntoCategory(vaultSound, "sfx", target);
    if (hasRiffWave(target)) mixReused++;
    else if (hasRiffWave(cached)) {
      mkdirSync(dirname(target), { recursive: true });
      try {
        linkSync(cached, target);
      } catch {
        copyFileSync(cached, target);
      }
      mixLinked++;
    } else {
      await download(s.file_url, target, validWav);
      mixFetched++;
    }
    sources[s.id] = {
      title: s.title,
      license: "Mixkit Sound Effects Free License",
      url: s.page,
      for: s.for ?? s.ear?.query ?? s.role,
      source: "mixkit",
      kind: "sfx",
      origin: "real",
      ...(MIXKIT_SWEETENERS[s.id] && { role: MIXKIT_SWEETENERS[s.id] }),
    };
  }
  saveSources(sourcesFile, sources);
  log(
    `Mixkit SFX: ${mixkitKept.length} curated (${mixLinked} linked, ${mixFetched} fetched, ${mixReused} reused)`,
  );

  // 2. Earshot 252 DSP recipes + 15 curated CC0 1.0 Freesound original recordings (fit.json)
  const earshotDir = join(external, "tools/earshot");
  if (!skipEarshot && existsSync(join(earshotDir, "earshot/forge/bank.py"))) {
    const py = process.platform === "win32" ? "python" : "python3";
    const res = spawnSync(
      py,
      [join(root, "scripts/render_earshot_bank.py"), earshotDir, vaultSound],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`render_earshot_bank.py failed: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    Object.assign(sources, out.sources);
    saveSources(sourcesFile, sources);
    log(
      `Earshot SFX: ${Object.keys(out.sources).length} recipes (${out.rendered} rendered, ${out.reused} reused)`,
    );
  }

  const fitFile = join(earshotDir, "earshot/forge/bank/fit.json");
  if (!skipFreesound && existsSync(fitFile)) {
    const fitEntries = Object.entries(JSON.parse(readFileSync(fitFile, "utf8")).entries ?? {});
    let fsConverted = 0,
      fsReused = 0;
    for (const [fitId, val] of fitEntries) {
      const src = val?.source;
      const previewUrl = src?.preview_url ?? FREESOUND_PREVIEWS[src?.id];
      if (!src?.id || !previewUrl) continue;
      const cat = fitCategoryOf(fitId, src.id);
      const target = join(vaultSound, "sfx", cat, `${src.id}.wav`);
      moveIntoCategory(vaultSound, "sfx", target);
      if (hasRiffWave(target)) fsReused++;
      else {
        const raw = join(local, "sfx/freesound-cache", `${src.id}.ogg`);
        await download(previewUrl, raw, validAudio);
        await convertToPcmWav(raw, target, { rate: 48000 });
        fsConverted++;
      }
      const desc = String(val.notes ?? "")
        .split(", fitted from")[0]
        .trim();
      sources[src.id] = {
        title: cleanSoundTitle(src.title),
        license: src.license ?? "CC0 1.0",
        url: src.url,
        for: desc ? desc[0].toUpperCase() + desc.slice(1) : cat,
        source: "freesound",
        kind: "sfx",
        origin: "real",
      };
    }
    saveSources(sourcesFile, sources);
    log(
      `Earshot Freesound CC0 Originals: ${fsConverted + fsReused} recordings (${fsConverted} converted, ${fsReused} reused)`,
    );
  }

  // 3. Cinetic BGM shortlist (direct URLs + user-dropped Pixabay files -> -1 dBFS 44.1 kHz PCM WAV)
  const shortlistPath = [".claude", ".agents"]
    .map((d) => join(root, d, "skills/cinetic/assets/music/shortlist.json"))
    .find(existsSync);
  if (!skipBgm && shortlistPath) {
    const shortlist = JSON.parse(readFileSync(shortlistPath, "utf8"));
    const licences = shortlist.licences ?? {};
    const tracks = [...(shortlist.tracks ?? []), ...(shortlist.bench ?? [])];
    let bgmConverted = 0,
      bgmReused = 0;
    for (const t of tracks) {
      if (DISPUTED_BGM.has(t.id)) continue;
      const cat = BGM_CATEGORY[t.id] ?? (t.profile === "calm" ? "chill" : "electronic");
      const name = `bgm-${t.id}`,
        target = join(vaultSound, "bgm", cat, `${name}.wav`);
      moveIntoCategory(vaultSound, "bgm", target);
      if (hasRiffWave(target)) bgmReused++;
      else if (t.source === "Pixabay") {
        const cachedRaw = join(local, "sfx/bgm-cache", `${t.id}.mp3`);
        if (!existsSync(cachedRaw)) {
          const dropped = findPixabayDropFile(dropDir, t);
          if (!dropped) continue;
          mkdirSync(dirname(cachedRaw), { recursive: true });
          copyFileSync(dropped, cachedRaw);
        }
        await convertToPcmWav(cachedRaw, target, { rate: 44100, channels: 2 });
        bgmConverted++;
      } else {
        const url = t.file_url ?? BGM_DIRECT_URLS[t.id];
        if (!url) continue;
        const ext = url.match(/\.(ogg|flac|wav|m4a)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "mp3";
        const raw = join(local, "sfx/bgm-cache", `${t.id}.${ext}`);
        await download(url, raw, validAudio, { referer: BGM_REFERERS[t.id] });
        await convertToPcmWav(raw, target, { rate: 44100, channels: 2 });
        bgmConverted++;
      }
      const lic = licences[t.licence_id];
      const override = BGM_META_OVERRIDES[t.id];
      sources[name] = {
        title: `${String(t.title).replaceAll("_", " ").trim()} — ${t.artist}`,
        license: lic?.name ?? t.licence_id,
        url: override?.url ?? t.page,
        for: t.mood,
        source: override?.source ?? String(t.source).toLowerCase().replace(/\s+/g, "-"),
        kind: "bgm",
        origin: "real",
        // Registered with YouTube Content ID: an upload gets a claim, disputed with the Pixabay certificate
        ...(t.content_id === "registered" && { contentId: true }),
      };
    }
    saveSources(sourcesFile, sources);
    log(
      `Cinetic BGM: ${bgmConverted + bgmReused} tracks (${bgmConverted} converted, ${bgmReused} reused)`,
    );
  }

  // 4. Raw packs (scripts/sound-raw.json), when the external vault holds them
  await buildRawPacks({ root, external, vaultSound, sources, log });
  saveSources(sourcesFile, sources);
  syncSoundVaultPeaks(vaultSound);
  return { vaultSound, count: Object.keys(sources).length };
}

if (import.meta.main) await buildSoundVault();
