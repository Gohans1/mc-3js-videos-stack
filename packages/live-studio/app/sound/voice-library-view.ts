// Pure view, category, facet, search, and sort helpers for the shared English voice library.
import type { SharedVoiceEntry } from "../../src/voice-library.mjs";
import { words } from "../core/search";

const ALL = "all" as const;

export interface VoiceNavLeaf {
  id: string;
  title: string;
  count: number;
}

export const VOICE_STAR_PREFIX = "voice:";
export const voiceStarId = (id: string) => `${VOICE_STAR_PREFIX}${id}`;
export const isVoiceStarId = (id: string) => id.startsWith(VOICE_STAR_PREFIX);

export type VoiceV4Mode = "v4" | "v4Post" | "v4Turbo" | "v4Fast" | "all";
export type VoiceAccessMode = typeof ALL | "standard" | "free";
export type VoiceSortKey = "usage1y" | "trending" | "clones" | "newest" | "name";

export interface VoiceFilters {
  v4Mode: VoiceV4Mode;
  category: string;
  gender: string;
  age: string;
  accent: string;
  descriptive: string;
  access: VoiceAccessMode;
  sort: VoiceSortKey;
}

export const DEFAULT_VOICE_FILTERS: VoiceFilters = {
  v4Mode: "v4",
  category: ALL,
  gender: ALL,
  age: ALL,
  accent: ALL,
  descriptive: ALL,
  access: ALL,
  sort: "usage1y",
};

export interface VoiceFacetOption {
  id: string;
  title: string;
  count: number;
}

export interface VoiceFacetSummary {
  total: number;
  v4Count: number;
  v4PostCount: number;
  v4TurboCount: number;
  v4FastCount: number;
  allCount: number;
  categories: VoiceFacetOption[];
  genders: VoiceFacetOption[];
  ages: VoiceFacetOption[];
  accents: VoiceFacetOption[];
  descriptives: VoiceFacetOption[];
  standardCount: number;
  freeCount: number;
}

const USE_CASE_ORDER = [
  "narrative_story",
  "conversational",
  "informative_educational",
  "social_media",
  "characters_animation",
  "advertisement",
  "entertainment_tv",
  "other",
] as const;

const LEAF_TITLES: Record<string, string> = {
  all: "All",
  fav: "Favorites",
  narrative_story: "Narrative & Story",
  conversational: "Conversational",
  informative_educational: "Informative",
  social_media: "Social Media",
  characters_animation: "Characters",
  advertisement: "Advertisement",
  entertainment_tv: "Entertainment & TV",
  other: "Other",
};

const VALUE_TITLES: Record<string, string> = {
  v4: "ElevenLabs v4",
  v4Post: "v4 Post-trained",
  v4Turbo: "v4 Turbo",
  v4Fast: "v4 Fast",
  all: "All",
  professional: "Professional",
  high_quality: "High quality",
  middle_aged: "Middle aged",
  standard: "1× credit",
  free: "Free tier",
  usage1y: "Most used",
  trending: "Trending (7d)",
  clones: "Most cloned",
  newest: "Newest",
  name: "Name (A–Z)",
};

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const SLUG_UPPER = new Set([
  "ai",
  "au",
  "bgm",
  "dj",
  "eq",
  "eu",
  "fx",
  "hd",
  "mc",
  "nz",
  "ost",
  "sfx",
  "tv",
  "uk",
  "us",
  "vr",
]);

const titleCaseSlug = (raw: string): string =>
  (typeof raw === "string" ? raw : "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      return SLUG_UPPER.has(lower) ? lower.toUpperCase() : lower[0].toUpperCase() + lower.slice(1);
    })
    .join(" ");

export const voiceDisplayName = (raw: string): string =>
  raw
    .replace(/\s+-\s+/g, " — ")
    .replace(/\s+—\s+(\S)/g, (_, ch: string) => ` — ${ch.toUpperCase()}`);

export const voiceoverDisplayText = (raw: string): string => raw.replace(/\.{3}/g, "…");

export const voiceLeafTitle = (leaf: string): string => LEAF_TITLES[leaf] ?? titleCaseSlug(leaf);

export const voiceTitle = (value: string): string => VALUE_TITLES[value] ?? titleCaseSlug(value);

const normUseCase = (raw: string): string =>
  (typeof raw === "string" ? raw : "").trim().toLowerCase() || "other";

export const matchesV4Mode = (v: SharedVoiceEntry, mode: VoiceV4Mode): boolean => {
  if (mode === "all") return true;
  if (mode === "v4") return v.v4;
  if (mode === "v4Post") return v.v4Post;
  if (mode === "v4Turbo") return v.v4Turbo;
  if (mode === "v4Fast") return v.v4Fast;
  return v.v4;
};

export const hasActiveVoiceFilters = (f: VoiceFilters): boolean =>
  f.v4Mode !== DEFAULT_VOICE_FILTERS.v4Mode ||
  f.category !== ALL ||
  f.gender !== ALL ||
  f.age !== ALL ||
  f.accent !== ALL ||
  f.descriptive !== ALL ||
  f.access !== ALL;

export type VoiceFilterPillId =
  "v4Mode" | "access" | "gender" | "age" | "accent" | "descriptive" | "category" | "sort";

export interface VoiceFilterPill {
  id: VoiceFilterPillId;
  label: string;
  clear: () => VoiceFilters;
}

export const voiceFilterPills = (filters: VoiceFilters): VoiceFilterPill[] => {
  const pills: VoiceFilterPill[] = [];
  if (filters.v4Mode !== DEFAULT_VOICE_FILTERS.v4Mode) {
    pills.push({
      id: "v4Mode",
      label: filters.v4Mode === ALL ? "All models" : voiceTitle(filters.v4Mode),
      clear: () => ({ ...filters, v4Mode: DEFAULT_VOICE_FILTERS.v4Mode }),
    });
  }
  if (filters.access !== ALL) {
    pills.push({
      id: "access",
      label: voiceTitle(filters.access),
      clear: () => ({ ...filters, access: ALL }),
    });
  }
  if (filters.gender !== ALL) {
    pills.push({
      id: "gender",
      label: `Gender: ${voiceTitle(filters.gender)}`,
      clear: () => ({ ...filters, gender: ALL }),
    });
  }
  if (filters.age !== ALL) {
    pills.push({
      id: "age",
      label: voiceTitle(filters.age),
      clear: () => ({ ...filters, age: ALL }),
    });
  }
  if (filters.accent !== ALL) {
    pills.push({
      id: "accent",
      label: voiceTitle(filters.accent),
      clear: () => ({ ...filters, accent: ALL }),
    });
  }
  if (filters.descriptive !== ALL) {
    pills.push({
      id: "descriptive",
      label: `Tone: ${voiceTitle(filters.descriptive)}`,
      clear: () => ({ ...filters, descriptive: ALL }),
    });
  }
  if (filters.category !== ALL) {
    pills.push({
      id: "category",
      label: `Tier: ${voiceTitle(filters.category)}`,
      clear: () => ({ ...filters, category: ALL }),
    });
  }
  if (filters.sort !== DEFAULT_VOICE_FILTERS.sort) {
    pills.push({
      id: "sort",
      label: `Sort: ${voiceTitle(filters.sort)}`,
      clear: () => ({ ...filters, sort: DEFAULT_VOICE_FILTERS.sort }),
    });
  }
  return pills;
};

const favVoiceSet = (effectFavs: readonly string[]): Set<string> => {
  const ids = new Set<string>();
  for (const s of effectFavs) {
    if (isVoiceStarId(s)) ids.add(s.slice(VOICE_STAR_PREFIX.length));
  }
  return ids;
};

const resolveFilters = (filters: VoiceFilters | VoiceV4Mode): VoiceFilters =>
  typeof filters === "string" ? { ...DEFAULT_VOICE_FILTERS, v4Mode: filters } : filters;

const matchesVoiceFilters = (v: SharedVoiceEntry, filters: VoiceFilters): boolean => {
  if (!matchesV4Mode(v, filters.v4Mode)) return false;
  if (filters.category !== ALL && v.category !== filters.category) return false;
  if (filters.gender !== ALL && v.gender !== filters.gender) return false;
  if (filters.age !== ALL && v.age !== filters.age) return false;
  if (filters.accent !== ALL && v.accent !== filters.accent) return false;
  if (filters.descriptive !== ALL && v.descriptive !== filters.descriptive) return false;
  if (filters.access === "standard" && v.rate > 1) return false;
  if (filters.access === "free" && !v.free) return false;
  return true;
};

export interface VoiceUseCaseIndex {
  matchingIds: Set<string>;
  total: number;
  categoryLeaves: VoiceNavLeaf[];
}

export const buildVoiceUseCaseIndex = (
  voices: readonly SharedVoiceEntry[],
  filters: VoiceFilters | VoiceV4Mode = "v4",
  query = "",
): VoiceUseCaseIndex => {
  const resolved = resolveFilters(filters);
  const wantWords = words(query);
  const rawQuery = query.trim().toLowerCase();
  const matchingIds = new Set<string>();
  const counts = new Map<string, number>();

  for (const v of voices) {
    if (!matchesVoiceFilters(v, resolved)) continue;
    if (wantWords.length && !matchesVoiceQuery(v, wantWords, rawQuery)) continue;
    matchingIds.add(v.id);
    const uc = normUseCase(v.useCase);
    counts.set(uc, (counts.get(uc) ?? 0) + 1);
  }

  const categoryLeaves: VoiceNavLeaf[] = [];
  const seen = new Set<string>();
  for (const uc of USE_CASE_ORDER) {
    const n = counts.get(uc) ?? 0;
    if (!n) continue;
    seen.add(uc);
    categoryLeaves.push({ id: uc, title: voiceLeafTitle(uc), count: n });
  }
  const extra = [...counts.keys()]
    .filter((k) => !seen.has(k))
    .sort((a, b) => COLLATOR.compare(a, b));
  for (const uc of extra) {
    categoryLeaves.push({ id: uc, title: voiceLeafTitle(uc), count: counts.get(uc)! });
  }
  return { matchingIds, total: matchingIds.size, categoryLeaves };
};

export const voiceLeavesWithFavs = (
  index: VoiceUseCaseIndex,
  effectFavs: readonly string[],
): VoiceNavLeaf[] => {
  let favCount = 0;
  for (const id of favVoiceSet(effectFavs)) {
    if (index.matchingIds.has(id)) favCount++;
  }
  return [
    { id: ALL, title: "All", count: index.total },
    { id: "fav", title: "Favorites", count: favCount },
    ...index.categoryLeaves,
  ];
};

export const buildVoiceLeaves = (
  voices: readonly SharedVoiceEntry[],
  effectFavs: readonly string[],
  filters: VoiceFilters | VoiceV4Mode = "v4",
  query = "",
): VoiceNavLeaf[] =>
  voiceLeavesWithFavs(buildVoiceUseCaseIndex(voices, filters, query), effectFavs);

const tallyFacet = (map: Map<string, number>, val: string) => {
  if (!val) return;
  map.set(val, (map.get(val) ?? 0) + 1);
};

const finalizeFacet = (map: Map<string, number>, selected: string): VoiceFacetOption[] => {
  if (selected !== ALL && !map.has(selected)) map.set(selected, 0);
  const out = [...map.entries()].map(([id, count]) => ({
    id,
    title: voiceTitle(id),
    count,
  }));
  out.sort((a, b) => b.count - a.count || COLLATOR.compare(a.title, b.title));
  return out;
};

export const EMPTY_VOICE_FACETS: VoiceFacetSummary = {
  total: 0,
  v4Count: 0,
  v4PostCount: 0,
  v4TurboCount: 0,
  v4FastCount: 0,
  allCount: 0,
  categories: [],
  genders: [],
  ages: [],
  accents: [],
  descriptives: [],
  standardCount: 0,
  freeCount: 0,
};

export const voiceFacetOptions = (
  voices: readonly SharedVoiceEntry[],
  leaf: string,
  filters: VoiceFilters,
  effectFavs: readonly string[] = [],
  query = "",
): VoiceFacetSummary => {
  const favSet = leaf === "fav" ? favVoiceSet(effectFavs) : null;
  const wantWords = words(query);
  const rawQuery = query.trim().toLowerCase();
  const catMap = new Map<string, number>();
  const genMap = new Map<string, number>();
  const ageMap = new Map<string, number>();
  const accMap = new Map<string, number>();
  const descMap = new Map<string, number>();
  let total = 0;
  let v4Count = 0;
  let v4PostCount = 0;
  let v4TurboCount = 0;
  let v4FastCount = 0;
  let allCount = 0;
  let standardCount = 0;
  let freeCount = 0;

  for (const v of voices) {
    if (leaf !== ALL) {
      if (favSet) {
        if (!favSet.has(v.id)) continue;
      } else if (normUseCase(v.useCase) !== leaf) {
        continue;
      }
    }
    if (wantWords.length && !matchesVoiceQuery(v, wantWords, rawQuery)) continue;

    const mCat = filters.category === ALL || v.category === filters.category;
    const mGen = filters.gender === ALL || v.gender === filters.gender;
    const mAge = filters.age === ALL || v.age === filters.age;
    const mAcc = filters.accent === ALL || v.accent === filters.accent;
    const mDesc = filters.descriptive === ALL || v.descriptive === filters.descriptive;
    const mAccs = filters.access === ALL || (filters.access === "standard" ? v.rate <= 1 : v.free);

    if (mCat && mGen && mAge && mAcc && mDesc && mAccs) {
      allCount++;
      if (v.v4) v4Count++;
      if (v.v4Post) v4PostCount++;
      if (v.v4Turbo) v4TurboCount++;
      if (v.v4Fast) v4FastCount++;
    }

    if (!matchesV4Mode(v, filters.v4Mode)) continue;

    const misses =
      (mCat ? 0 : 1) +
      (mGen ? 0 : 1) +
      (mAge ? 0 : 1) +
      (mAcc ? 0 : 1) +
      (mDesc ? 0 : 1) +
      (mAccs ? 0 : 1);
    if (misses > 1) continue;

    if (misses === 0) {
      total++;
      if (v.rate <= 1) standardCount++;
      if (v.free) freeCount++;
      tallyFacet(catMap, v.category);
      tallyFacet(genMap, v.gender);
      tallyFacet(ageMap, v.age);
      tallyFacet(accMap, v.accent);
      tallyFacet(descMap, v.descriptive);
    } else if (!mCat) {
      tallyFacet(catMap, v.category);
    } else if (!mGen) {
      tallyFacet(genMap, v.gender);
    } else if (!mAge) {
      tallyFacet(ageMap, v.age);
    } else if (!mAcc) {
      tallyFacet(accMap, v.accent);
    } else if (!mDesc) {
      tallyFacet(descMap, v.descriptive);
    } else {
      if (v.rate <= 1) standardCount++;
      if (v.free) freeCount++;
    }
  }

  return {
    total,
    v4Count,
    v4PostCount,
    v4TurboCount,
    v4FastCount,
    allCount,
    categories: finalizeFacet(catMap, filters.category),
    genders: finalizeFacet(genMap, filters.gender),
    ages: finalizeFacet(ageMap, filters.age),
    accents: finalizeFacet(accMap, filters.accent),
    descriptives: finalizeFacet(descMap, filters.descriptive),
    standardCount,
    freeCount,
  };
};

export type VoiceEmptyKind =
  "loading" | "fetch-error" | "sync-error" | "uncached" | "empty-catalog" | "nomatch";

export interface VoiceEmptyStateInput {
  loaded: boolean;
  loading: boolean;
  status: string;
  syncedAt: string | null;
  hasKey: boolean;
  error: string | null;
  totalVoices: number;
  leaf: string;
  query: string;
  hasVoiceFavs: boolean;
}

export interface VoiceEmptyStateResult {
  kind: VoiceEmptyKind;
  title: string;
  detail: string;
}

/** Picks unambiguous title and action-aligned guidance when no voice cards match or load. */
export const voiceEmptyState = ({
  loaded,
  loading,
  status,
  syncedAt,
  hasKey,
  error,
  totalVoices,
  leaf,
  query,
  hasVoiceFavs,
}: VoiceEmptyStateInput): VoiceEmptyStateResult => {
  const busy = totalVoices === 0 && (loading || status === "syncing" || (!loaded && !error));
  if (busy) {
    return {
      kind: "loading",
      title: "Loading English voices",
      detail:
        status === "syncing"
          ? "Downloading English voice catalog…"
          : "Loading cached ElevenLabs v4 English voice library…",
    };
  }
  if (totalVoices === 0 && error && status !== "error") {
    return {
      kind: "fetch-error",
      title: "Could not load voice library",
      detail: "Failed to fetch the voice library from the studio server.",
    };
  }
  if (totalVoices === 0) {
    if (status === "error") {
      return {
        kind: "sync-error",
        title: "Sync failed",
        detail: hasKey
          ? "Could not download the remote English voice catalog."
          : "Set GENVOICE_API_KEY or ELEVENLABS_API_KEY in your environment, then retry syncing.",
      };
    }
    if (syncedAt) {
      return {
        kind: "empty-catalog",
        title: "No English voices in catalog",
        detail: "Sync completed with 0 English voices in this catalog.",
      };
    }
    return {
      kind: "uncached",
      title: "Voice library not synced yet",
      detail: hasKey
        ? "No local English voice cache yet. Click Sync below to download the remote voice library."
        : "Set GENVOICE_API_KEY or ELEVENLABS_API_KEY in your environment (or run bun run setup:voices) to sync all English ElevenLabs v4 voices.",
    };
  }
  const trimmed = query.trim();
  if (trimmed) {
    return {
      kind: "nomatch",
      title: "No matching voices",
      detail: `No voices match "${trimmed}".`,
    };
  }
  if (leaf === "fav") {
    return hasVoiceFavs
      ? {
          kind: "nomatch",
          title: "No matching favorite voices",
          detail: "Your favorite voices do not match the selected filters.",
        }
      : {
          kind: "nomatch",
          title: "No favorite voices yet",
          detail: "No favorite voices yet. Click the star on any voice to save it here.",
        };
  }
  return {
    kind: "nomatch",
    title: "No matching voices",
    detail: "No voices match the selected filters.",
  };
};

const tokenCache = new WeakMap<SharedVoiceEntry, readonly string[]>();

const tokensOf = (v: SharedVoiceEntry): readonly string[] => {
  const hit = tokenCache.get(v);
  if (hit) return hit;
  const tokens = words(
    `${v.name} ${v.id} ${v.category} ${v.accent} ${v.descriptive} ${voiceLeafTitle(normUseCase(v.useCase))} ${v.gender} ${v.age} ${v.description}`,
  );
  tokenCache.set(v, tokens);
  return tokens;
};

const matchesVoiceQuery = (
  v: SharedVoiceEntry,
  wantWords: readonly string[],
  rawQuery: string,
): boolean => {
  if (!wantWords.length) return true;
  if (rawQuery.length >= 4 && v.id.toLowerCase().includes(rawQuery)) return true;
  const have = tokensOf(v);
  return wantWords.every((w) => have.some((h) => h.startsWith(w)));
};

export const warmVoiceSearchTokens = (
  voices: readonly SharedVoiceEntry[],
  startIndex = 0,
  batchSize = 600,
): number => {
  const start = Math.max(0, startIndex);
  const end = Math.min(voices.length, start + Math.max(1, batchSize));
  for (let i = start; i < end; i++) {
    tokensOf(voices[i]);
  }
  return end;
};

const nval = (n: number): number => (Number.isFinite(n) ? n : 0);

const SORT_COMPARATORS: Record<VoiceSortKey, (a: SharedVoiceEntry, b: SharedVoiceEntry) => number> =
  {
    usage1y: (a, b) =>
      nval(b.usage1y) - nval(a.usage1y) ||
      nval(b.likes) - nval(a.likes) ||
      COLLATOR.compare(a.name ?? "", b.name ?? ""),
    trending: (a, b) =>
      nval(b.usage7d) - nval(a.usage7d) ||
      nval(b.usage1y) - nval(a.usage1y) ||
      COLLATOR.compare(a.name ?? "", b.name ?? ""),
    clones: (a, b) =>
      nval(b.clones) - nval(a.clones) ||
      nval(b.usage1y) - nval(a.usage1y) ||
      COLLATOR.compare(a.name ?? "", b.name ?? ""),
    newest: (a, b) =>
      nval(b.addedAt) - nval(a.addedAt) ||
      nval(b.usage1y) - nval(a.usage1y) ||
      COLLATOR.compare(a.name ?? "", b.name ?? ""),
    name: (a, b) =>
      COLLATOR.compare(a.name ?? "", b.name ?? "") || nval(b.usage1y) - nval(a.usage1y),
  };

const sortCache = new WeakMap<
  readonly SharedVoiceEntry[],
  Partial<Record<VoiceSortKey, SharedVoiceEntry[]>>
>();

const sortedVoices = (
  voices: readonly SharedVoiceEntry[],
  sort: VoiceSortKey,
): readonly SharedVoiceEntry[] => {
  const key = sort in SORT_COMPARATORS ? sort : "usage1y";
  let byKey = sortCache.get(voices);
  if (!byKey) {
    byKey = {};
    sortCache.set(voices, byKey);
  }
  const hit = byKey[key];
  if (hit) return hit;
  const sorted = voices.slice().sort(SORT_COMPARATORS[key]);
  byKey[key] = sorted;
  return sorted;
};

export const filterAndSortVoices = (
  voices: readonly SharedVoiceEntry[],
  leaf: string,
  query: string,
  filters: VoiceFilters,
  effectFavs: readonly string[],
): SharedVoiceEntry[] => {
  if (!voices.length) return [];
  const favSet = leaf === "fav" ? favVoiceSet(effectFavs) : null;
  const wantWords = words(query);
  const rawQuery = query.trim().toLowerCase();
  const ordered = sortedVoices(voices, filters.sort);

  return ordered.filter((v) => {
    if (!matchesVoiceFilters(v, filters)) return false;
    if (leaf !== ALL) {
      if (favSet) {
        if (!favSet.has(v.id)) return false;
      } else if (normUseCase(v.useCase) !== leaf) {
        return false;
      }
    }
    if (!wantWords.length) return true;
    return matchesVoiceQuery(v, wantWords, rawQuery);
  });
};

export const formatCompactCount = (n: number): string => {
  const val = nval(n);
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(val);
};

export const voiceDetailLine = (v: SharedVoiceEntry): string => {
  const parts: string[] = [];
  if (v.gender) parts.push(voiceTitle(v.gender));
  if (v.age) parts.push(voiceTitle(v.age));
  if (v.accent) parts.push(voiceTitle(v.accent));
  if (v.descriptive) parts.push(voiceTitle(v.descriptive));
  if (v.clones > 0) parts.push(`${formatCompactCount(v.clones)} clones`);
  return parts.join(" · ");
};

export const VOICE_GRID_MIN_CARD_PX = 310;
export const VOICE_GRID_GAP_PX = 8;
// shortcut: capped at 6 columns to match static grid-cols-1..6 classes (extend lookup alongside if widened)
export const VOICE_GRID_MAX_COLS = 6;

export interface VoiceScrollAnchor {
  voiceIndex: number;
  offsetWithinRow: number;
  topRatio: number;
}

/** Captures the top-visible voice item and proportional row offset before a column count change. */
export const captureVoiceRowAnchor = (
  topRowIndex: number,
  prevCols: number,
  offsetWithinRow: number,
  rowHeightPx: number,
): VoiceScrollAnchor => {
  const safeRow = Math.max(0, Math.floor(topRowIndex));
  const safeCols = Math.max(1, Math.floor(prevCols));
  const topRatio =
    offsetWithinRow < 0 && rowHeightPx > 0
      ? Math.min(0.9, Math.max(0, -offsetWithinRow / rowHeightPx))
      : 0;
  return {
    voiceIndex: safeRow * safeCols,
    offsetWithinRow,
    topRatio,
  };
};

/** Resolves row viewport offset after reflow, scaling negative offsets proportionally to keep the row visible. */
export const resolveVoiceRowOffset = (
  anchor: Pick<VoiceScrollAnchor, "offsetWithinRow" | "topRatio">,
  measuredRowHeightPx: number,
): number => {
  if (anchor.offsetWithinRow >= 0) return anchor.offsetWithinRow;
  if (!(measuredRowHeightPx > 0)) return anchor.offsetWithinRow;
  const maxHiddenPx = Math.max(0, measuredRowHeightPx - 24);
  const scaled = -anchor.topRatio * measuredRowHeightPx;
  return Math.max(-maxHiddenPx, Math.max(anchor.offsetWithinRow, scaled));
};

export const voiceRowKey = (row: readonly { id: string }[]): string =>
  row.map((v) => v.id).join(":");

export const voiceGridCols = (width: number, minCardPx = VOICE_GRID_MIN_CARD_PX): number => {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const min = Number.isFinite(minCardPx) && minCardPx > 0 ? minCardPx : VOICE_GRID_MIN_CARD_PX;
  const cols = Math.floor((width + VOICE_GRID_GAP_PX) / (min + VOICE_GRID_GAP_PX));
  return Math.max(1, Math.min(VOICE_GRID_MAX_COLS, cols));
};

export const stickyVoiceRowKeys = (
  rows: readonly (readonly { id: string }[])[],
  activeVoiceIds: readonly string[],
): string[] => {
  if (!activeVoiceIds.length || !rows.length) return [];
  const wanted = new Set(activeVoiceIds);
  const keys: string[] = [];
  for (const row of rows) {
    if (row.some((v) => wanted.has(v.id))) keys.push(voiceRowKey(row));
  }
  return keys;
};
