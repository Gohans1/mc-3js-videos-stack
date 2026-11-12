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
from the downloaded Mixkit, Freesound CC0, Earshot bank and Cinetic BGM sources. From the repo root:
  bun run setup:sound
A rebuild that re-files a sound moves it, so it never sits in two categories. Look a sound up: bun run find <words>.`;
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

async function convertToPcmWav(raw, target, { rate = 44100, channels } = {}) {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.${process.pid}.part.wav`;
  try {
    const stat = await run(
      "ffmpeg",
      ["-i", raw, "-af", "astats=metadata=0:reset=0", "-f", "null", "-"],
      { timeout: 60_000, windowsHide: true },
    );
    const peaks = [...stat.stderr.matchAll(/Peak level dB:\s*([-\d.]+)/g)]
      .map((m) => Number(m[1]))
      .filter(Number.isFinite);
    const peak = peaks.length ? Math.max(...peaks) : -1;
    const af = peak > -1 ? ["-af", `volume=${(-1 - peak).toFixed(2)}dB`] : [];
    const ac = channels ? ["-ac", String(channels)] : [];
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
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

export async function buildSoundVault({
  root = ROOT,
  local = LOCAL,
  external = EXTERNAL,
  skipBgm = false,
  skipEarshot = false,
  skipFreesound = false,
  pixabayDir,
} = {}) {
  const vaultSound = join(local, "sound"),
    sourcesFile = join(vaultSound, "SOURCES.json");
  const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, "utf8")) : {};
  const dropDir = pixabayDir ?? (local === LOCAL ? join(homedir(), "Downloads") : undefined);

  // 1. Mixkit curated SFX (all 93 in catalogue.sounds; catalogue.rejected excluded; reuse vault/sfx/mixkit cache)
  const catalogue = JSON.parse(readFileSync(join(root, "scripts/sfx-catalogue.json"), "utf8"));
  const mixkitKept = catalogue.sounds ?? [];
  let mixLinked = 0,
    mixFetched = 0,
    mixReused = 0;
  for (const s of mixkitKept) {
    const cat = MIXKIT_ID_CATEGORY[s.id] ?? MIXKIT_CATEGORY[s.role] ?? "foley";
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
      for: s.ear?.query ?? s.role,
      source: "mixkit",
      kind: "sfx",
      origin: "real",
      ...(MIXKIT_SWEETENERS[s.id] && { role: MIXKIT_SWEETENERS[s.id] }),
    };
  }
  saveSources(sourcesFile, sources);
  console.log(
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
    console.log(
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
    console.log(
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
    console.log(
      `Cinetic BGM: ${bgmConverted + bgmReused} tracks (${bgmConverted} converted, ${bgmReused} reused)`,
    );
  }
  syncSoundVaultPeaks(vaultSound);
  return { vaultSound, count: Object.keys(sources).length };
}

if (import.meta.main) await buildSoundVault();
