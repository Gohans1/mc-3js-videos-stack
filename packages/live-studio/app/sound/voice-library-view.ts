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

const titleCaseSlug = (raw: string): string =>
  raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

export const voiceLeafTitle = (leaf: string): string => LEAF_TITLES[leaf] ?? titleCaseSlug(leaf);

export const voiceTitle = (value: string): string => VALUE_TITLES[value] ?? titleCaseSlug(value);

const normUseCase = (raw: string): string => raw.trim().toLowerCase() || "other";

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

export const voiceFacetOptions = (
  voices: readonly SharedVoiceEntry[],
  leaf: string,
  filters: VoiceFilters,
  effectFavs: readonly string[] = [],
): VoiceFacetSummary => {
  const favSet = leaf === "fav" ? favVoiceSet(effectFavs) : null;
  const catMap = new Map<string, number>();
  const genMap = new Map<string, number>();
  const ageMap = new Map<string, number>();
  const accMap = new Map<string, number>();
  const descMap = new Map<string, number>();
  let total = 0;
  let v4Count = 0;
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
    allCount++;
    if (v.v4) v4Count++;
    if (!matchesV4Mode(v, filters.v4Mode)) continue;
    total++;
    if (v.rate <= 1) standardCount++;
    if (v.free) freeCount++;
    tallyFacet(catMap, v.category);
    tallyFacet(genMap, v.gender);
    tallyFacet(ageMap, v.age);
    tallyFacet(accMap, v.accent);
    tallyFacet(descMap, v.descriptive);
  }

  return {
    total,
    v4Count,
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

const SORT_COMPARATORS: Record<VoiceSortKey, (a: SharedVoiceEntry, b: SharedVoiceEntry) => number> =
  {
    usage1y: (a, b) =>
      b.usage1y - a.usage1y || b.likes - a.likes || COLLATOR.compare(a.name, b.name),
    trending: (a, b) =>
      b.usage7d - a.usage7d || b.usage1y - a.usage1y || COLLATOR.compare(a.name, b.name),
    clones: (a, b) =>
      b.clones - a.clones || b.usage1y - a.usage1y || COLLATOR.compare(a.name, b.name),
    newest: (a, b) =>
      b.addedAt - a.addedAt || b.usage1y - a.usage1y || COLLATOR.compare(a.name, b.name),
    name: (a, b) => COLLATOR.compare(a.name, b.name) || b.usage1y - a.usage1y,
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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
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
