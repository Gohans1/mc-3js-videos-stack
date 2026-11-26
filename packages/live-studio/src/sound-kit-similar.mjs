import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyPopularSound, soundMetaText } from "./sound-kit-classify.mjs";

export { classifyPopularSound };

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const defaultSemanticDb = () => {
  const configured = process.env.MC_SEMANTIC_DB?.trim();
  if (configured) return resolve(REPO_ROOT, configured);
  return resolve(REPO_ROOT, ".studio/asset-search.sqlite");
};

const textOf = soundMetaText;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "sound",
  "sfx",
  "of",
  "bgm",
  "son",
  "mixkit",
  "ken",
  "ear",
  "fs",
  "mc",
  "take",
  "var",
  "various",
  "wav",
  "ogg",
  "mp3",
  "seq",
  "hk1",
  "96",
  "48",
]);

const tokenizeText = (raw) =>
  new Set(
    String(raw ?? "")
      .replaceAll("_", " ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)),
  );

const tokenizeItem = (item, extra = "") => tokenizeText(`${textOf(item)} ${extra}`);

const vectorCache = new Map();
const MAX_CACHE_DBS = 8;

const dbCompositeStamp = (dbPath) => {
  const part = (p) => {
    try {
      const st = statSync(p);
      return `${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {
      return "none";
    }
  };
  return `${part(dbPath)}|${part(`${dbPath}-wal`)}`;
};

const toAlignedFloat32 = (bytes) => {
  if (bytes.byteOffset % 4 === 0) {
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
};

const loadVectorMap = (dbPath) => {
  if (!dbPath || !existsSync(dbPath)) return null;
  const stamp = dbCompositeStamp(dbPath);
  const cached = vectorCache.get(dbPath);
  if (cached && cached.stamp === stamp) return cached.map;
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    try {
      db.run("PRAGMA busy_timeout = 5000");
    } catch {}
    const hasErrTable = Boolean(
      db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_errors'").get(),
    );
    const sql = hasErrTable
      ? "SELECT j.asset, c.vector FROM jobs j JOIN cache c ON c.key = j.asset AND c.fingerprint = j.fingerprint WHERE j.state = 'done' AND j.part = 0 AND (j.asset LIKE '[\"sfx\",%' OR j.asset LIKE '[\"bgm\",%' OR j.asset LIKE '[\"mc\",%') AND NOT EXISTS (SELECT 1 FROM asset_errors e WHERE e.key = j.asset)"
      : "SELECT j.asset, c.vector FROM jobs j JOIN cache c ON c.key = j.asset AND c.fingerprint = j.fingerprint WHERE j.state = 'done' AND j.part = 0 AND (j.asset LIKE '[\"sfx\",%' OR j.asset LIKE '[\"bgm\",%' OR j.asset LIKE '[\"mc\",%')";
    const rows = db.query(sql).all();
    const map = new Map();
    for (const row of rows) {
      let parsed;
      try {
        parsed = JSON.parse(row.asset);
      } catch {
        continue;
      }
      const kind = Array.isArray(parsed) ? String(parsed[0] ?? "").toLowerCase() : "";
      const id = Array.isArray(parsed) ? parsed[2] : null;
      if (!kind || typeof id !== "string" || !id || !(row.vector instanceof Uint8Array)) continue;
      if (row.vector.byteLength < 16 || row.vector.byteLength % 4 !== 0) continue;
      const vec = toAlignedFloat32(row.vector);
      map.set(`${kind}\0${id}`, vec);
      if (!map.has(id)) map.set(id, vec);
    }
    if (vectorCache.size >= MAX_CACHE_DBS && !vectorCache.has(dbPath)) {
      vectorCache.delete(vectorCache.keys().next().value);
    }
    vectorCache.set(dbPath, { stamp, map });
    return map;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
};

const vectorFor = (map, item) => {
  if (!map || !item) return undefined;
  const kind = String(item.kind ?? "sfx").toLowerCase();
  return map.get(`${kind}\0${item.name}`) ?? map.get(item.name);
};

const dotProduct = (a, b) => {
  if (!a || !b || a.length !== b.length) return -1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
};

const normalizeVec = (vec) => {
  let sq = 0;
  for (let i = 0; i < vec.length; i += 1) sq += vec[i] * vec[i];
  const norm = Math.sqrt(sq);
  if (!norm || !Number.isFinite(norm)) return null;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
};

const meanVector = (vecs) => {
  if (!vecs.length) return null;
  const dim = vecs[0].length;
  const acc = new Float32Array(dim);
  let used = 0;
  for (const v of vecs) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i += 1) acc[i] += v[i];
    used += 1;
  }
  if (!used) return null;
  for (let i = 0; i < dim; i += 1) acc[i] /= used;
  return normalizeVec(acc);
};

const durationProximity = (a, b) => {
  const sa = Number(a);
  const sb = Number(b);
  if (!Number.isFinite(sa) || !Number.isFinite(sb) || sa <= 0 || sb <= 0) return 0;
  return Math.min(sa, sb) / Math.max(sa, sb);
};

const jaccardTokens = (a, b) => {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) overlap += 1;
  }
  const union = a.size + b.size - overlap;
  return union > 0 ? overlap / union : 0;
};

const sanitizeLimit = (raw, fallback = 12, max = 50) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

export const findSimilarSounds = (targetName, library, options = {}) => {
  const limit = sanitizeLimit(options.limit, 12, 50);
  const banned = options.bannedIds ?? new Set();
  const excluded = options.excludeIds ?? new Set();
  const byName = new Map(library.map((item) => [item.name, item]));
  const target = byName.get(targetName);
  if (!target) return { target: targetName, mode: "metadata", hits: [] };

  const targetCat = classifyPopularSound(target);
  const targetKind = String(target.kind ?? "").toLowerCase();
  const dbPath = options.semanticDb ?? defaultSemanticDb();
  const vectors = loadVectorMap(dbPath);
  const targetVec = vectorFor(vectors, target);

  const eligible = (item) => {
    if (item.name === targetName) return false;
    if (banned.has(item.name) || excluded.has(item.name)) return false;
    if (target.family && item.family && item.family === target.family) return false;
    if (targetKind === "bgm" && String(item.kind ?? "").toLowerCase() !== "bgm") return false;
    if (targetKind !== "bgm" && String(item.kind ?? "").toLowerCase() === "bgm") return false;
    return true;
  };

  const collapseByFamily = (list) => {
    const seenFam = new Set();
    const out = [];
    for (const entry of list) {
      const famKey = entry.family || entry.name;
      if (seenFam.has(famKey)) continue;
      seenFam.add(famKey);
      const { family: _fam, ...clean } = entry;
      out.push(clean);
      if (out.length >= limit) break;
    }
    return out;
  };

  if (targetVec && vectors) {
    const scored = [];
    for (const item of library) {
      if (!eligible(item)) continue;
      const vec = vectorFor(vectors, item);
      if (!vec) continue;
      const cos = dotProduct(targetVec, vec);
      if (!Number.isFinite(cos) || cos <= 0) continue;
      const itemCat = classifyPopularSound(item);
      const sameKitCat = targetCat && itemCat === targetCat ? 0.06 : 0;
      const durBonus = durationProximity(target.seconds, item.seconds) * 0.04;
      scored.push({
        name: item.name,
        family: item.family,
        title: item.title ?? item.name,
        category: item.category ?? "",
        kitCategory: itemCat,
        kind: item.kind ?? "sfx",
        seconds: item.seconds ?? 0,
        source: item.source ?? "",
        score: Number(Math.min(1, cos + sameKitCat + durBonus).toFixed(4)),
      });
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      return { target: targetName, mode: "vector", hits: collapseByFamily(scored) };
    }
  }

  const targetTokens = tokenizeItem(target);
  const scored = [];
  for (const item of library) {
    if (!eligible(item)) continue;
    const itemCat = classifyPopularSound(item);
    const jaccard = jaccardTokens(targetTokens, tokenizeItem(item));
    const sameRawCat = target.category && item.category === target.category ? 0.25 : 0;
    const sameKitCat = targetCat && itemCat === targetCat ? 0.3 : 0;
    const durBonus = durationProximity(target.seconds, item.seconds) * 0.15;
    const score = jaccard * 0.6 + sameRawCat + sameKitCat + durBonus;
    if (score <= 0.05) continue;
    scored.push({
      name: item.name,
      family: item.family,
      title: item.title ?? item.name,
      category: item.category ?? "",
      kitCategory: itemCat,
      kind: item.kind ?? "sfx",
      seconds: item.seconds ?? 0,
      source: item.source ?? "",
      score: Number(score.toFixed(4)),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { target: targetName, mode: "metadata", hits: collapseByFamily(scored) };
};

const parseOptNum = (v) =>
  v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

export const recommendCoreSounds = (kitState, library, options = {}) => {
  const topN = sanitizeLimit(options.topN, 5, 25);
  const category = options.category ?? null;
  const query = String(options.query ?? "").trim();
  const queryTokens = tokenizeText(query);
  const durMin = parseOptNum(options.durMin);
  const durMax = parseOptNum(options.durMax);
  const recentIds = new Set(options.recentIds ?? []);
  const byName = new Map(library.map((item) => [item.name, item]));
  const dbPath = options.semanticDb ?? defaultSemanticDb();
  const vectors = loadVectorMap(dbPath);
  const refVec = options.refSound
    ? vectorFor(
        vectors,
        byName.get(options.refSound) ?? {
          name: options.refSound,
          kind: category === "bgm" ? "bgm" : "sfx",
        },
      )
    : null;

  const coreEntries = Object.values(kitState.items ?? {}).filter(
    (entry) => entry.status === "core" && (!category || entry.category === category),
  );
  if (!coreEntries.length) {
    return {
      category,
      query,
      mode: "empty",
      totalCore: 0,
      picks: [],
    };
  }

  const starPosVecs = [];
  const allCoreVecs = [];
  const negVecs = [];
  if (vectors) {
    for (const entry of Object.values(kitState.items ?? {})) {
      if (category && entry.category !== category) continue;
      const libItem = byName.get(entry.id) ?? {
        name: entry.id,
        kind: entry.category === "bgm" ? "bgm" : "sfx",
      };
      const v = vectorFor(vectors, libItem);
      if (!v) continue;
      if (entry.status === "core") {
        allCoreVecs.push(v);
        if (entry.tier === 1 || entry.wins > 0 || entry.picks > 0) starPosVecs.push(v);
      } else if (entry.status === "ban") {
        negVecs.push(v);
      }
    }
  }
  const posMean = meanVector(starPosVecs.length ? starPosVecs : allCoreVecs);
  const negMean = meanVector(negVecs);
  let tasteVec = null;
  if (posMean || refVec) {
    const dim = (refVec ?? posMean).length;
    const raw = new Float32Array(dim);
    const hasPos = posMean && posMean.length === dim;
    const hasNeg = negMean && negMean.length === dim;
    for (let i = 0; i < dim; i += 1) {
      const r = refVec ? refVec[i] : 0;
      const p = hasPos ? posMean[i] * 0.75 : 0;
      const n = hasNeg ? negMean[i] * 0.15 : 0;
      raw[i] = r + p - n;
    }
    tasteVec = normalizeVec(raw);
  }

  const candidates = [];
  for (const entry of coreEntries) {
    const lib = byName.get(entry.id);
    const hasDur = Number.isFinite(lib?.seconds) && lib.seconds > 0;
    const secs = hasDur ? Number(lib.seconds) : 0;
    if ((durMin !== null || durMax !== null) && !hasDur) continue;
    if (durMin !== null && secs < durMin) continue;
    if (durMax !== null && secs > durMax) continue;

    const tagsText = `${entry.tags.join(" ")} ${entry.note}`;
    const tokens = tokenizeItem(lib ?? { name: entry.id, title: entry.id }, tagsText);
    const why = [];

    let queryScore = 0;
    if (queryTokens.size > 0) {
      let matched = 0;
      let tagMatched = 0;
      const tagSet = new Set(entry.tags.map((t) => t.toLowerCase()));
      const tagTokens = tokenizeText(entry.tags.join(" "));
      for (const qt of queryTokens) {
        if (tagSet.has(qt) || tagTokens.has(qt)) {
          matched += 1;
          tagMatched += 1;
        } else if (tokens.has(qt)) {
          matched += 1;
        }
      }
      queryScore = matched / queryTokens.size;
      if (tagMatched > 0) {
        queryScore = Math.min(1, queryScore + 0.2);
        why.push(`tag match (${tagMatched})`);
      } else if (matched > 0) {
        why.push(`text match (${matched}/${queryTokens.size})`);
      }
    }

    const eloNorm = 1 / (1 + Math.exp(-(entry.elo - 1500) / 120));
    const picksNorm = Math.min(1, Math.log1p(entry.picks) / Math.log1p(8));
    const tierBonus = entry.tier === 1 ? 0.18 : 0;
    if (entry.tier === 1) why.push("signature");
    if (entry.wins > 0 || entry.losses > 0) {
      why.push(`elo ${Math.round(entry.elo)} (${entry.wins}W/${entry.losses}L)`);
    }
    if (entry.picks > 0) why.push(`used ${entry.picks}x`);

    const vec = vectorFor(
      vectors,
      lib ?? { name: entry.id, kind: entry.category === "bgm" ? "bgm" : "sfx" },
    );
    let vecScore = 0;
    if (vec && tasteVec) {
      const cos = dotProduct(vec, tasteVec);
      if (Number.isFinite(cos) && cos > 0) {
        vecScore = cos;
        why.push(
          refVec
            ? `audio match ${(cos * 100).toFixed(0)}%`
            : `taste vector ${(cos * 100).toFixed(0)}%`,
        );
      }
    }

    const cooldownPenalty = recentIds.has(entry.id) ? 0.25 : 0;
    if (cooldownPenalty > 0) why.push("recently used (-)");

    const hasQuery = queryTokens.size > 0;
    const relevance =
      (hasQuery ? queryScore * 0.45 : 0) +
      eloNorm * (hasQuery ? 0.25 : 0.45) +
      picksNorm * 0.15 +
      vecScore * (refVec ? 0.35 : 0.15) +
      tierBonus -
      cooldownPenalty;

    candidates.push({
      id: entry.id,
      category: entry.category,
      title: lib?.title ?? entry.id,
      seconds: secs,
      source: lib?.source ?? "",
      family: lib?.family ?? entry.id,
      tags: entry.tags,
      note: entry.note,
      tier: entry.tier,
      elo: entry.elo,
      wins: entry.wins,
      losses: entry.losses,
      picks: entry.picks,
      relevance,
      tokens,
      vec,
      why,
    });
  }

  const pairSim = (a, b) => {
    if (a.family && b.family && a.family === b.family) return 1;
    if (a.vec && b.vec) {
      const c = dotProduct(a.vec, b.vec);
      if (Number.isFinite(c)) return Math.max(0, c);
    }
    return jaccardTokens(a.tokens, b.tokens) * 0.7 + durationProximity(a.seconds, b.seconds) * 0.3;
  };

  const lambda = 0.72;
  const remaining = [...candidates].sort(
    (a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id),
  );
  const selected = [];
  const selectedMeta = [];
  while (selected.length < topN && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const picked of selectedMeta) {
        const s = pairSim(cand, picked);
        if (s > maxSim) maxSim = s;
      }
      const mmr =
        selectedMeta.length === 0
          ? cand.relevance
          : lambda * cand.relevance - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    const [winner] = remaining.splice(bestIdx, 1);
    selectedMeta.push(winner);
    selected.push({
      id: winner.id,
      category: winner.category,
      title: winner.title,
      seconds: winner.seconds,
      source: winner.source,
      tags: winner.tags,
      note: winner.note,
      tier: winner.tier,
      elo: winner.elo,
      wins: winner.wins,
      losses: winner.losses,
      picks: winner.picks,
      score: Number(winner.relevance.toFixed(4)),
      why: winner.why,
    });
  }

  return {
    category,
    query,
    mode: tasteVec ? "hybrid-vector-mmr" : "preference-mmr",
    totalCore: coreEntries.length,
    picks: selected,
  };
};
