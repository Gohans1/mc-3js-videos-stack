import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { unzipSync } from "fflate";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { EXTERNAL, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Rebuilds <externalRoot>/mc-sound/mc/<category>/*.ogg from vanilla Minecraft and the packs in scripts/mc-sound-packs.json
(licence-checked; restricted packs are left out), with SOURCES.json, PEAKS.json and take families (x.ogg, x2.ogg ...).
From the repo root, with the external vault present (vault.json "externalRoot" or MC_VAULT_EXTERNAL):
  bun run setup:mc-sound
Takes are compared by content, so a renumbered take never keeps an old file. Look a sound up: bun run find <words>.`;
cliArgs(HELP, [], 0);

const WITHER_STORM_JAR = "crackers-wither-storm-mod-v-sides-soundtrack.jar";
const SKIP_MUSIC_RE = /(?:^|\/)(?:music|records|music_disc)/i;

// Asset-restricted or unverified-attribution archives excluded even if present in local packs/
const EXCLUDED_PACK_FILES = new Set([
  "eerie-the-horror-soundpack.zip",
  "betterend.jar",
  "betternether.jar",
  "superb-warfare.jar",
]);

const SLUG_OVERRIDES = {
  "crackers-wither-storm-mod-v-sides-soundtrack": "wither-storm",
  "willows-scary-cave-sounds": "willows-horror",
  "artemis-laboratory-blocks": "laboratory-blocks",
  immersive_weapons_sounds: "immersive-weapons",
  "immersive-weapons-sounds": "immersive-weapons",
  "nhatjs-furniture-mod": "nhatjs-furniture",
  createnuclear: "create-nuclear",
};

const LICENSE_OVERRIDES = {
  "LicenseRef-Polyform-Shield-1.0": "Polyform-Shield-1.0",
  "LicenseRef-MIT-License": "MIT",
};

const HORROR_PACKS = new Set(["willows-horror", "horror-sounds"]);
const COMBAT_PACKS = new Set(["betterexpsounds", "immersive-weapons", "spartan-weaponry"]);
const AMBIENCE_PACKS = new Set([
  "ambientsounds",
  "charmonium",
  "gentler-weather-sounds",
  "immersive-sound",
  "immersivethunder",
  "particle-rain",
  "world-alive",
]);

const VEHICLE_PACKS = new Set(["immersive-aircraft"]);
const MACHINE_PACKS = new Set(["security-craft", "refined-storage"]);

const STRIP_TITLE_HEAD = new Set(["block", "entity", "item", "mob", "ambient", "tile", "random"]);
const ACTION_HEAD = new Set(["step", "dig", "fall", "jump", "swim", "climb"]);

function defaultMcAssetsDir() {
  if (process.env.MC_ASSETS_DIR) return process.env.MC_ASSETS_DIR;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData/Roaming");
    return join(appData, ".minecraft/assets");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library/Application Support/minecraft/assets");
  }
  return join(homedir(), ".minecraft/assets");
}

function isOggBuffer(buf) {
  return (
    buf &&
    buf.length > 28 &&
    buf[0] === 0x4f &&
    buf[1] === 0x67 &&
    buf[2] === 0x67 &&
    buf[3] === 0x53
  );
}

// Content, not size: a rebuild that renumbers takes must not keep an old take of the same length under the new name
function holdsSameOgg(path, { bytes, sha1, size }) {
  if (!existsSync(path) || statSync(path).size !== size) return false;
  const have = readFileSync(path);
  return bytes ? have.equals(bytes) : sha1Hex(have) === sha1;
}

function sha1Hex(buf) {
  return createHash("sha1").update(buf).digest("hex");
}

function writeAtomic(target, bytes) {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.part`;
  try {
    writeFileSync(part, bytes);
    renameSync(part, target);
  } finally {
    rmSync(part, { force: true });
  }
}

async function fetchBytes(url, retries = 2, timeoutMs = 30_000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "mc-films-vault/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function mapPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
}

function slugTokens(str) {
  return String(str)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function dedupeAdjacent(tokens) {
  const out = [];
  for (const tok of tokens) {
    if (out[out.length - 1] !== tok) out.push(tok);
  }
  return out;
}

function titleCaseWords(raw) {
  return String(raw)
    .split(/[^a-zA-Z0-9']+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function formatMcTitle(relBase, { stripSingleDigit = false } = {}) {
  const rawParts = relBase.split("/").filter(Boolean);
  if (stripSingleDigit && rawParts.length > 0) {
    const last = rawParts[rawParts.length - 1];
    const stripped = last.replace(/(?:[_-]\d+|(?<=[a-z]{3})\d)$/i, "");
    if (stripped) rawParts[rawParts.length - 1] = stripped;
  }
  if (rawParts.length === 2 && ACTION_HEAD.has(rawParts[0].toLowerCase())) {
    if (rawParts[0].toLowerCase() === rawParts[1].toLowerCase()) {
      return titleCaseWords(rawParts[0]);
    }
    return `${titleCaseWords(rawParts[1])} · ${titleCaseWords(rawParts[0])}`;
  }
  const parts =
    rawParts.length > 1 && STRIP_TITLE_HEAD.has(rawParts[0].toLowerCase())
      ? rawParts.slice(1)
      : rawParts.slice();

  // Strip redundant parent prefix or trailing parent noun on child segment (e.g. bluntwood/bluntwood_walk, cave_book/book_close)
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1].toLowerCase();
    const cur = parts[i];
    const curLower = cur.toLowerCase();
    if (curLower.startsWith(`${prev}_`) || curLower.startsWith(`${prev}-`)) {
      const rest = cur.slice(prev.length + 1);
      if (rest) parts[i] = rest;
      continue;
    }
    const prevWords = slugTokens(prev);
    const tailWord = prevWords.at(-1);
    if (
      tailWord &&
      tailWord.length >= 3 &&
      (curLower.startsWith(`${tailWord}_`) || curLower.startsWith(`${tailWord}-`))
    ) {
      const rest = cur.slice(tailWord.length + 1);
      if (rest) parts[i] = rest;
    }
  }

  const cleaned = dedupeAdjacent(parts.map(titleCaseWords).filter(Boolean));
  if (cleaned.length <= 1) return cleaned[0] ?? titleCaseWords(relBase);
  return `${cleaned[0]} · ${cleaned.slice(1).join(" ")}`;
}

export function classifyMcSound(source, relNoExt) {
  const p = relNoExt.toLowerCase();
  if (HORROR_PACKS.has(source)) return "horror";
  if (
    p.startsWith("ambient/cave") ||
    p.includes("warden") ||
    p.includes("sculk_shrieker") ||
    p.includes("creaking") ||
    /(?:^|\/|_)(?:horror|scare|eerie|spooky|jumpscare)(?:$|\/|_|\d)/.test(p)
  ) {
    return "horror";
  }

  if (source === "presence-footsteps") return "footsteps";
  if (
    p.startsWith("step/") ||
    (!p.startsWith("mob/") &&
      !p.startsWith("entity/") &&
      /(?:^|\/|_)(?:footsteps?|walk|sprint|sneak|wander)(?:$|\/|_|\d)/.test(p))
  ) {
    return "footsteps";
  }

  if (
    VEHICLE_PACKS.has(source) ||
    /^(?:minecart\/|entity\/(?:boat|minecart))/.test(p) ||
    /(?:^|\/|_)(?:submarine|propeller|engine|warship|airship)(?:$|\/|_|\d)/.test(p)
  ) {
    return "vehicles";
  }
  if (
    MACHINE_PACKS.has(source) ||
    /(?:^|\/|_)(?:geiger|reactor|siren|alarm)(?:$|\/|_|\d)/.test(p)
  ) {
    return "machines";
  }

  if (COMBAT_PACKS.has(source)) return "combat";
  if (
    p.startsWith("damage/") ||
    /(?:^|\/|_)(?:explosion|explode|tnt|gun|rifle|pistol|shotgun|cannon|grenade|sniper|bullet|sword|weapon|mace|trident|crossbow|arrow|bow|shield|sweep|crit|attack|hurt_flesh|fuse|successful_hit|bowhit|classic_hurt|raidhorn|tephra)(?:$|\/|_|\d)/.test(
      p,
    )
  ) {
    return "combat";
  }

  if (AMBIENCE_PACKS.has(source)) return "ambience";
  if (
    p.startsWith("ambient/") ||
    p.startsWith("weather/") ||
    p.startsWith("liquid/") ||
    p.startsWith("fire/") ||
    p.startsWith("random/splash") ||
    /(?:^|\/|_)(?:rain|thunder|lightning|wind|weather|ocean|waterfall|lava|campfire)(?:$|\/|_|\d)/.test(
      p,
    )
  ) {
    return "ambience";
  }

  if (p.startsWith("mob/") || p.startsWith("entity/")) {
    if (
      /^entity\/(?:item|experience_orb|painting|item_?frame|leash_?knot|armor_?stand|fishing_bobber|boat|minecart|snowball|egg|ender_pearl|ender_eye|splash_potion|lingering_potion|wind_charge|firework_rocket)/.test(
        p,
      )
    ) {
      if (p.includes("experience_orb") || p.includes("ender_eye") || p.includes("firework")) {
        return "magic";
      }
      if (p.includes("minecart") || p.includes("boat")) return "blocks";
      return "items";
    }
    return "mobs";
  }

  if (
    source === "extrasounds" ||
    p.startsWith("note/") ||
    p.startsWith("ui/") ||
    p.startsWith("enchant/") ||
    p.startsWith("portal/") ||
    p.startsWith("fireworks/") ||
    /(?:^|\/|_)(?:beacon|conduit|totem|levelup|omen|amethyst_block\/chime|amethyst_block\/resonate|spell|magic|bell_resonate|orb|dark_cloud|darkness_incarnate|sugar_rush)(?:$|\/|_|\d)/.test(
      p,
    )
  ) {
    return "magic";
  }

  if (
    source === "lightmans-currency" ||
    p.startsWith("item/") ||
    p.startsWith("armor/") ||
    /^random\/(?:eat|drink|burp|pop|break)/.test(p) ||
    /(?:^|\/|_)(?:equip|bottle|bucket|brush|spyglass|goat_horn|bundle|coin|wallet|eat|drink|fry|sizzle|polaroid_flash)(?:$|\/|_|\d)/.test(
      p,
    )
  ) {
    return "items";
  }

  return "blocks";
}

// Minecraft's own captions for its sounds ("Creeper hisses", "Rain falls"), the words a player reads and an editor searches
// by: sounds.json maps each event to its files and a subtitle key, lang/en_us.json the key to words. A file in several
// events gets each caption; events that point at other events carry none of their own. Keys: "<ns>:<path>" lowercase
export function captionsOf(soundsJson, lang, ns, into = new Map()) {
  for (const ev of Object.values(soundsJson ?? {})) {
    const text = ev?.subtitle && lang[ev.subtitle];
    if (typeof text !== "string" || !Array.isArray(ev.sounds)) continue;
    for (const s of ev.sounds) {
      if (s?.type === "event") continue;
      const name = typeof s === "string" ? s : s?.name;
      if (typeof name !== "string") continue;
      const key = (name.includes(":") ? name : `${ns}:${name}`).toLowerCase();
      into.set(key, new Set([...(into.get(key) ?? []), text]));
    }
  }
  return into;
}
const parseJson = (bytes) => {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
};

function splitTrailingIndex(relNoExt) {
  const slash = relNoExt.lastIndexOf("/");
  const dir = slash >= 0 ? relNoExt.slice(0, slash) : "";
  const stem = slash >= 0 ? relNoExt.slice(slash + 1) : relNoExt;
  const m = stem.match(/^(.+?)[_-]?(\d+)$/);
  if (!m) return { dir, stem, base: stem, num: null };
  return { dir, stem, base: m[1], num: Number(m[2]) };
}

export async function buildMcSoundVault({
  root = ROOT,
  external = EXTERNAL,
  mcAssetsDir = defaultMcAssetsDir(),
  resourcesBaseUrl = "https://resources.download.minecraft.net",
  skipPeaks = false,
  // the game's en_us.json lives in its client jar (vault/jar, bun run setup:vault); without it sounds keep no captions
  clientJar = join(LOCAL, "jar/client.jar"),
} = {}) {
  const outDir = join(external, "mc-sound");
  const cacheDir = join(outDir, ".cache");
  mkdirSync(cacheDir, { recursive: true });

  const vaultAssets = JSON.parse(readFileSync(join(root, "scripts/vault-assets.json"), "utf8"));
  const mcMetaUrl = vaultAssets.minecraft.metadata;
  const mcVersion = vaultAssets.minecraft.version ?? "26.3";

  // 1. Load Mojang version manifest + assetIndex (reuse local .minecraft/assets/indexes/<id>.json or .cache)
  const verCache = join(cacheDir, `version-${mcVersion}.json`);
  let verJson;
  if (existsSync(verCache)) {
    verJson = JSON.parse(readFileSync(verCache, "utf8"));
  } else {
    verJson = JSON.parse((await fetchBytes(mcMetaUrl)).toString("utf8"));
    writeAtomic(verCache, Buffer.from(JSON.stringify(verJson, null, 2) + "\n"));
  }

  const indexId = verJson.assetIndex.id;
  const localIndexFile = join(mcAssetsDir, "indexes", `${indexId}.json`);
  const cachedIndexFile = join(cacheDir, `asset-index-${indexId}.json`);
  let assetIndex;
  if (existsSync(localIndexFile)) {
    assetIndex = JSON.parse(readFileSync(localIndexFile, "utf8"));
  } else if (existsSync(cachedIndexFile)) {
    assetIndex = JSON.parse(readFileSync(cachedIndexFile, "utf8"));
  } else {
    assetIndex = JSON.parse((await fetchBytes(verJson.assetIndex.url)).toString("utf8"));
    writeAtomic(cachedIndexFile, Buffer.from(JSON.stringify(assetIndex) + "\n"));
  }

  const rawItems = [];

  // 1b. Vanilla captions: sounds.json is an asset object (local cache, else Mojang's CDN), en_us.json is in the client jar
  const vanillaLang = existsSync(clientJar)
    ? (parseJson(
        unzipSync(readFileSync(clientJar), {
          filter: (f) => f.name === "assets/minecraft/lang/en_us.json",
        })["assets/minecraft/lang/en_us.json"] ?? [],
      ) ?? {})
    : {};
  const soundsHash = assetIndex.objects?.["minecraft/sounds.json"]?.hash;
  let vanillaSounds = {};
  if (soundsHash) {
    const localObj = join(mcAssetsDir, "objects", soundsHash.slice(0, 2), soundsHash);
    const cached = join(cacheDir, `sounds-${soundsHash}.json`);
    let buf = existsSync(localObj)
      ? readFileSync(localObj)
      : existsSync(cached)
        ? readFileSync(cached)
        : null;
    if (!buf || sha1Hex(buf) !== soundsHash) {
      buf = await fetchBytes(`${resourcesBaseUrl}/${soundsHash.slice(0, 2)}/${soundsHash}`);
      if (sha1Hex(buf) !== soundsHash)
        throw new Error(`SHA1 mismatch for minecraft/sounds.json (${soundsHash})`);
      writeAtomic(cached, buf);
    }
    vanillaSounds = parseJson(buf) ?? {};
  }
  const captions = captionsOf(vanillaSounds, vanillaLang, "minecraft");

  // 2. Collect Vanilla sound candidates (excluding music/ and records/)
  for (const [objKey, meta] of Object.entries(assetIndex.objects ?? {})) {
    if (!objKey.startsWith("minecraft/sounds/") || !objKey.toLowerCase().endsWith(".ogg")) continue;
    const relNoExt = objKey.slice("minecraft/sounds/".length, -4);
    if (SKIP_MUSIC_RE.test(relNoExt)) continue;
    rawItems.push({
      kind: "mc",
      source: "minecraft",
      packTitle: `Minecraft ${mcVersion}`,
      license: `Minecraft ${mcVersion} Assets`,
      url: "https://www.minecraft.net/en-us/usage-guidelines",
      ns: "minecraft",
      relNoExt,
      vanillaHash: meta.hash,
      vanillaSize: meta.size,
      bytes: null,
    });
  }

  // 3. Collect vetted Modrinth pack sounds (from scripts/mc-sound-packs.json, auto-fetching missing archives with SHA1 check)
  const packsDir = join(external, "packs");
  const packsManifestPath = join(root, "scripts/mc-sound-packs.json");
  const packSpecs = [];

  if (existsSync(packsManifestPath)) {
    mkdirSync(packsDir, { recursive: true });
    const manifest = JSON.parse(readFileSync(packsManifestPath, "utf8"));
    const entries = (manifest.packs ?? []).filter((p) => !EXCLUDED_PACK_FILES.has(p.file));
    await mapPool(entries, 4, async (p) => {
      const target = join(packsDir, p.file);
      if (existsSync(target) && (!p.sha1 || sha1Hex(readFileSync(target)) === p.sha1)) return;
      if (!p.downloadUrl) throw new Error(`Missing pack ${p.file} and no downloadUrl provided`);
      const buf = await fetchBytes(p.downloadUrl, 2, 180_000);
      if (p.sha1 && sha1Hex(buf) !== p.sha1) {
        throw new Error(`SHA1 mismatch for Modrinth pack ${p.file}`);
      }
      writeAtomic(target, buf);
    });
    for (const p of entries) {
      packSpecs.push({
        file: p.file,
        source: p.source,
        packTitle: p.title ?? p.source,
        license: p.license ?? "Custom",
        credits: p.credits,
        url: p.url ?? "",
      });
    }
  } else if (existsSync(packsDir)) {
    const triagePath = join(external, "tools/triage_result.json");
    const indexPath = join(external, "packs_index.json");
    const triage = existsSync(triagePath) ? JSON.parse(readFileSync(triagePath, "utf8")) : {};
    const packsIndex = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
    const archives = readdirSync(packsDir)
      .filter(
        (f) =>
          /\.(?:jar|zip)$/i.test(f) && !EXCLUDED_PACK_FILES.has(f) && triage[f]?.verdict === "keep",
      )
      .sort((a, b) => a.localeCompare(b));
    for (const file of archives) {
      const info = packsIndex[file] ?? {};
      const rawSlug = info.slug ?? file.replace(/\.(?:jar|zip)$/i, "");
      const source = SLUG_OVERRIDES[rawSlug] ?? rawSlug.toLowerCase().replaceAll("_", "-");
      const rawLic = info.license?.id ?? "Custom";
      packSpecs.push({
        file,
        source,
        packTitle: info.title ?? source,
        license: LICENSE_OVERRIDES[rawLic] ?? rawLic,
        credits: undefined,
        url: info.url ?? "",
      });
    }
  }

  for (const spec of packSpecs) {
    const isWitherStorm = spec.file === WITHER_STORM_JAR;
    const entries = unzipSync(readFileSync(join(packsDir, spec.file)), {
      filter: (f) =>
        f.name.startsWith("assets/") &&
        (/^assets\/[^/]+\/(?:sounds\.json|lang\/en_us\.json)$/i.test(f.name) ||
          (f.name.toLowerCase().endsWith(".ogg") &&
            !f.name.startsWith("assets/presencefootstepsmono/"))),
    });
    // the pack's own captions; its subtitle keys may be vanilla's, so its words go over the game's
    for (const name of Object.keys(entries)) {
      const s = name.match(/^assets\/([^/]+)\/sounds\.json$/i);
      if (!s) continue;
      const lang = parseJson(entries[`assets/${s[1]}/lang/en_us.json`] ?? []) ?? {};
      captionsOf(parseJson(entries[name]), { ...vanillaLang, ...lang }, s[1], captions);
    }

    for (const entryName of Object.keys(entries).sort((a, b) => a.localeCompare(b))) {
      const m = entryName.match(/^assets\/([^/]+)\/sounds\/(.+)\.ogg$/i);
      if (!m) continue;
      const [, ns, relNoExt] = m;
      if (!isWitherStorm && SKIP_MUSIC_RE.test(relNoExt)) continue;
      const bytes = Buffer.from(entries[entryName]);
      if (!isOggBuffer(bytes)) continue;

      rawItems.push({
        kind: isWitherStorm ? "bgm" : "mc",
        source: spec.source,
        packTitle: spec.packTitle,
        license: spec.license,
        credits: spec.credits,
        url: spec.url,
        ns,
        relNoExt,
        vanillaHash: null,
        vanillaSize: bytes.length,
        bytes,
      });
    }
  }

  // 4. Group multi-variation families within (kind, source, ns, dir, base)
  const familyBuckets = new Map();
  for (const item of rawItems) {
    const parsed = splitTrailingIndex(item.relNoExt);
    item.parsed = parsed;
    if (item.kind === "mc" && parsed.num !== null) {
      const key = `${item.source}|${item.ns}|${parsed.dir.toLowerCase()}|${parsed.base.toLowerCase()}`;
      let arr = familyBuckets.get(key);
      if (!arr) {
        arr = [];
        familyBuckets.set(key, arr);
      }
      arr.push(item);
    }
  }
  // Minecraft names takes cricket.ogg, cricket2.ogg, cricket3.ogg: the unnumbered file is take #1 of that family
  for (const item of rawItems) {
    const { dir, stem, num } = item.parsed;
    if (item.kind !== "mc" || num !== null) continue;
    const bucket = familyBuckets.get(
      `${item.source}|${item.ns}|${dir.toLowerCase()}|${stem.toLowerCase()}`,
    );
    if (!bucket) continue;
    item.parsed = { ...item.parsed, base: stem, num: 0 };
    bucket.push(item);
  }

  const usedNames = new Set();
  const usedFamilies = new Set();
  const allocUnique = (set, candidate) => {
    if (!set.has(candidate)) {
      set.add(candidate);
      return candidate;
    }
    let n = 2;
    while (set.has(`${candidate}-${n}`)) n++;
    const unique = `${candidate}-${n}`;
    set.add(unique);
    return unique;
  };
  const allocName = (candidate) => allocUnique(usedNames, candidate);

  for (const bucket of familyBuckets.values()) {
    // Only treat as a variation family when 2+ distinct numbered siblings exist
    const distinctNums = new Set(bucket.map((x) => x.parsed.num));
    if (bucket.length < 2 || distinctNums.size < 2) continue;
    bucket.sort((a, b) => a.parsed.num - b.parsed.num || a.relNoExt.localeCompare(b.relNoExt));
    const sample = bucket[0];
    const relBase = sample.parsed.dir
      ? `${sample.parsed.dir}/${sample.parsed.base}`
      : sample.parsed.base;
    const prefixTokens =
      sample.source === "minecraft" ? ["mc"] : ["mc", ...slugTokens(sample.source)];
    const baseFamily = dedupeAdjacent([...prefixTokens, ...slugTokens(relBase)]).join("-");
    const familyCandidate = usedFamilies.has(baseFamily)
      ? dedupeAdjacent([...prefixTokens, ...slugTokens(sample.ns), ...slugTokens(relBase)]).join(
          "-",
        )
      : baseFamily;
    const familySlug = allocUnique(usedFamilies, familyCandidate);
    bucket.forEach((item, idx) => {
      item.family = familySlug;
      item.variant = idx + 1;
      item.relBase = relBase;
    });
  }

  // 5. Finalize target paths & SOURCES.json metadata
  const sources = {};
  const vanillaFetchQueue = [];
  const expectedFiles = new Set();

  for (const item of rawItems) {
    if (item.kind === "bgm") {
      const baseSlug = dedupeAdjacent([
        "bgm",
        ...slugTokens(item.source),
        ...slugTokens(item.relNoExt),
      ]).join("-");
      const name = allocName(baseSlug);
      const target = join(outDir, "bgm/boss", `${name}.ogg`);
      expectedFiles.add(target);
      if (!holdsSameOgg(target, { bytes: item.bytes, size: item.bytes.length }))
        writeAtomic(target, item.bytes);
      const shortCreator = item.packTitle
        .split(":")[0]
        .replace(/\s+Mod$/i, "")
        .trim();
      sources[name] = {
        title: `${titleCaseWords(item.parsed.stem)} — ${shortCreator}`,
        license: item.license,
        ...(item.url && { url: item.url }),
        for: `Boss soundtrack (${item.ns}:${item.relNoExt})`,
        source: item.source,
        kind: "bgm",
        origin: "real",
      };
      continue;
    }

    const category = classifyMcSound(item.source, item.relNoExt);
    const prefixTokens = item.source === "minecraft" ? ["mc"] : ["mc", ...slugTokens(item.source)];
    const candidate = item.family
      ? `${item.family}-${item.variant}`
      : dedupeAdjacent([...prefixTokens, ...slugTokens(item.relNoExt)]).join("-");
    const name = allocName(candidate);
    const target = join(outDir, "mc", category, `${name}.ogg`);
    expectedFiles.add(target);

    if (item.bytes) {
      if (!holdsSameOgg(target, { bytes: item.bytes, size: item.bytes.length }))
        writeAtomic(target, item.bytes);
    } else if (!holdsSameOgg(target, { sha1: item.vanillaHash, size: item.vanillaSize })) {
      vanillaFetchQueue.push({ item, target });
    }

    const relBase = item.relBase ?? item.relNoExt;
    const words = slugTokens(relBase).join(" ");
    const creditNote = item.credits ? ` · Credits: ${item.credits}` : "";
    const heard = [...(captions.get(`${item.ns}:${item.relNoExt}`.toLowerCase()) ?? [])];
    sources[name] = {
      title: formatMcTitle(relBase, { stripSingleDigit: !item.family }),
      license: item.license,
      ...(item.url && { url: item.url }),
      for: `${item.packTitle} ${category} — ${heard.length ? `${heard.join("; ")}; ` : ""}${words} (${item.ns}:${item.relNoExt})${creditNote}`,
      ...(heard.length && { heard }),
      source: item.source,
      kind: "mc",
      origin: "real",
      ...(item.family && { family: item.family, variant: item.variant }),
    };
  }

  // 6. Materialize Vanilla .ogg files from local .minecraft cache or Mojang CDN
  let vanillaCached = 0;
  let vanillaFetched = 0;
  await mapPool(vanillaFetchQueue, 16, async ({ item, target }) => {
    const hash = item.vanillaHash;
    const localObj = join(mcAssetsDir, "objects", hash.slice(0, 2), hash);
    if (existsSync(localObj)) {
      const buf = readFileSync(localObj);
      if (sha1Hex(buf) === hash && isOggBuffer(buf)) {
        writeAtomic(target, buf);
        vanillaCached++;
        return;
      }
    }
    const url = `${resourcesBaseUrl}/${hash.slice(0, 2)}/${hash}`;
    const buf = await fetchBytes(url);
    if (sha1Hex(buf) !== hash || !isOggBuffer(buf)) {
      throw new Error(`SHA1/Ogg mismatch for ${item.relNoExt} (${hash})`);
    }
    writeAtomic(target, buf);
    vanillaFetched++;
  });

  // 6b. Prune stale audio files from earlier runs
  const pruneDir = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) pruneDir(p);
      else if (/\.(?:ogg|wav)$/i.test(ent.name) && !expectedFiles.has(p))
        rmSync(p, { force: true });
    }
  };
  pruneDir(join(outDir, "mc"));
  pruneDir(join(outDir, "bgm"));

  // 7. Write sorted SOURCES.json atomically
  const sortedSources = Object.fromEntries(
    Object.keys(sources)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => [k, sources[k]]),
  );
  writeAtomic(
    join(outDir, "SOURCES.json"),
    Buffer.from(JSON.stringify(sortedSources, null, 2) + "\n"),
  );

  // 8. Build PEAKS.json via multi-threaded compute_mc_peaks.py (prefer uv run --no-project python)
  if (!skipPeaks) {
    const scriptPath = existsSync(join(root, "scripts/compute_mc_peaks.py"))
      ? join(root, "scripts/compute_mc_peaks.py")
      : join(ROOT, "scripts/compute_mc_peaks.py");
    const hasUv =
      spawnSync("uv", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;
    const [cmd, args] = hasUv
      ? ["uv", ["run", "--no-project", "python", scriptPath, outDir]]
      : [process.platform === "win32" ? "python" : "python3", [scriptPath, outDir]];
    const res = spawnSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
      throw new Error(`compute_mc_peaks.py failed: ${res.stderr}`);
    }
    if (res.stdout?.trim()) console.log(res.stdout.trim());
  }

  const total = Object.keys(sortedSources).length;
  console.log(
    `MC Sound Vault: ${total} sounds (${vanillaCached} from .minecraft, ${vanillaFetched} fetched from CDN)`,
  );
  return { outDir, total, vanillaCached, vanillaFetched };
}

if (import.meta.main) await buildMcSoundVault();
