import { describe, expect, test } from "bun:test";

import {
  ALL,
  buildNavTree,
  categoryHeading,
  filterAndSortLibrary,
  INITIAL_NAV,
  INITIAL_OPEN_GROUPS,
  searchPlaceholder,
  stepNavHeader,
} from "../app/sound/library-view";
import {
  buildVoiceLeaves,
  captureVoiceRowAnchor,
  DEFAULT_VOICE_FILTERS,
  filterAndSortVoices,
  formatCompactCount,
  hasActiveVoiceFilters,
  resolveVoiceRowOffset,
  stickyVoiceRowKeys,
  VOICE_GRID_GAP_PX,
  VOICE_GRID_MAX_COLS,
  VOICE_GRID_MIN_CARD_PX,
  voiceDisplayName,
  voiceEmptyState,
  voiceFacetOptions,
  voiceFilterPills,
  voiceGridCols,
  voiceLeafTitle,
  voiceoverDisplayText,
  voiceStarId,
  voiceTitle,
  warmVoiceSearchTokens,
} from "../app/sound/voice-library-view";
import { registerVoiceNames, voiceActorTitle } from "../app/sound/voice-view";

const v = (overrides = {}) => ({
  id: "id_1",
  name: "Voice One",
  category: "professional",
  useCase: "narrative_story",
  gender: "male",
  age: "middle_aged",
  accent: "american",
  descriptive: "calm",
  description: "Clear warm narrator.",
  previewUrl: "https://storage.googleapis.com/example/a.mp3",
  v4: true,
  v4Post: true,
  v4Turbo: true,
  v4Fast: false,
  rate: 1,
  free: true,
  usage1y: 5000,
  usage7d: 500,
  clones: 20,
  likes: 10,
  featured: false,
  addedAt: 1750000000,
  ...overrides,
});

const SAMPLE_VOICES = [
  v({
    id: "v_seff",
    name: "Seff Echo",
    useCase: "narrative_story",
    category: "professional",
    gender: "male",
    age: "young",
    accent: "american",
    descriptive: "deep",
    usage1y: 90000,
    usage7d: 3000,
    clones: 100,
    likes: 40,
    addedAt: 1740000000,
  }),
  v({
    id: "v_clara",
    name: "Clara",
    useCase: "conversational",
    category: "high_quality",
    gender: "female",
    age: "young",
    accent: "british",
    descriptive: "warm",
    v4Post: false,
    rate: 2,
    free: false,
    usage1y: 45000,
    usage7d: 8000,
    clones: 250,
    likes: 70,
    addedAt: 1755000000,
  }),
  v({
    id: "v_legacy",
    name: "Old Guard",
    useCase: "informative_educational",
    category: "professional",
    gender: "male",
    age: "old",
    accent: "australian",
    descriptive: "authoritative",
    v4: false,
    v4Post: false,
    v4Turbo: false,
    usage1y: 120000,
    usage7d: 100,
    clones: 10,
    likes: 15,
    addedAt: 1720000000,
  }),
  v({
    id: "v_fast",
    name: "Zippy",
    useCase: "",
    category: "professional",
    gender: "neutral",
    age: "middle_aged",
    accent: "indian",
    descriptive: "energetic",
    v4Fast: true,
    usage1y: 10000,
    usage7d: 9500,
    clones: 5,
    likes: 3,
    addedAt: 1760000000,
  }),
];

describe("voice-library-view", () => {
  test("buildVoiceLeaves respects v4Mode and favorites count in deterministic category order", () => {
    const v4Leaves = buildVoiceLeaves(SAMPLE_VOICES, [voiceStarId("v_clara")], "v4");
    expect(v4Leaves.map((l) => [l.id, l.title, l.count])).toEqual([
      [ALL, "All", 3],
      ["fav", "Favorites", 1],
      ["narrative_story", "Narrative & Story", 1],
      ["conversational", "Conversational", 1],
      ["other", "Other", 1],
    ]);

    const allLeaves = buildVoiceLeaves(SAMPLE_VOICES, [voiceStarId("v_legacy")], "all");
    expect(allLeaves.find((l) => l.id === ALL)?.count).toBe(4);
    expect(allLeaves.find((l) => l.id === "informative_educational")?.count).toBe(1);
    expect(voiceLeafTitle("entertainment_tv")).toBe("Entertainment & TV");

    const matchingLeaves = buildVoiceLeaves(SAMPLE_VOICES, [voiceStarId("v_clara")], "v4", "clara");
    expect(matchingLeaves.map((l) => [l.id, l.count])).toEqual([
      [ALL, 1],
      ["fav", 1],
      ["conversational", 1],
    ]);

    const emptyLeaves = buildVoiceLeaves(
      SAMPLE_VOICES,
      [voiceStarId("v_clara")],
      "v4",
      "zzzz_no_match",
    );
    expect(emptyLeaves.map((l) => [l.id, l.count])).toEqual([
      [ALL, 0],
      ["fav", 0],
    ]);
  });

  test("filterAndSortVoices filters by v4Mode, category, facets, favorites, search, and all sort orders", () => {
    const favorites = [voiceStarId("v_clara"), voiceStarId("v_seff")];

    const defaultV4 = filterAndSortVoices(SAMPLE_VOICES, ALL, "", DEFAULT_VOICE_FILTERS, favorites);
    expect(defaultV4.map((x) => x.id)).toEqual(["v_seff", "v_clara", "v_fast"]);

    const legacyIncluded = filterAndSortVoices(
      SAMPLE_VOICES,
      ALL,
      "",
      { ...DEFAULT_VOICE_FILTERS, v4Mode: "all" },
      favorites,
    );
    expect(legacyIncluded.map((x) => x.id)).toEqual(["v_legacy", "v_seff", "v_clara", "v_fast"]);

    const fastOnly = filterAndSortVoices(
      SAMPLE_VOICES,
      ALL,
      "",
      { ...DEFAULT_VOICE_FILTERS, v4Mode: "v4Fast" },
      favorites,
    );
    expect(fastOnly.map((x) => x.id)).toEqual(["v_fast"]);

    const byStandardCredit = filterAndSortVoices(
      SAMPLE_VOICES,
      ALL,
      "",
      { ...DEFAULT_VOICE_FILTERS, access: "standard", gender: "female" },
      favorites,
    );
    expect(byStandardCredit).toEqual([]);

    const byBritishTrending = filterAndSortVoices(
      SAMPLE_VOICES,
      "conversational",
      "clar brit",
      { ...DEFAULT_VOICE_FILTERS, accent: "british", sort: "trending" },
      favorites,
    );
    expect(byBritishTrending.map((x) => x.id)).toEqual(["v_clara"]);

    const favOnly = filterAndSortVoices(
      SAMPLE_VOICES,
      "fav",
      "",
      { ...DEFAULT_VOICE_FILTERS, sort: "clones" },
      favorites,
    );
    expect(favOnly.map((x) => x.id)).toEqual(["v_clara", "v_seff"]);

    const newestFirst = filterAndSortVoices(
      SAMPLE_VOICES,
      ALL,
      "",
      { ...DEFAULT_VOICE_FILTERS, v4Mode: "all", sort: "newest" },
      favorites,
    );
    expect(newestFirst.map((x) => x.id)).toEqual(["v_fast", "v_clara", "v_seff", "v_legacy"]);

    const byName = filterAndSortVoices(
      SAMPLE_VOICES,
      ALL,
      "",
      { ...DEFAULT_VOICE_FILTERS, v4Mode: "all", sort: "name" },
      favorites,
    );
    expect(byName.map((x) => x.name)).toEqual(["Clara", "Old Guard", "Seff Echo", "Zippy"]);

    expect(hasActiveVoiceFilters(DEFAULT_VOICE_FILTERS)).toBe(false);
    expect(hasActiveVoiceFilters({ ...DEFAULT_VOICE_FILTERS, accent: "british" })).toBe(true);
  });

  test("voiceFacetOptions computes non-empty facet counts sorted by count desc", () => {
    const facets = voiceFacetOptions(SAMPLE_VOICES, ALL, {
      ...DEFAULT_VOICE_FILTERS,
      v4Mode: "all",
    });
    expect(facets.accents.map((a) => a.id)).toEqual([
      "american",
      "australian",
      "british",
      "indian",
    ]);
    expect(facets.genders.find((g) => g.id === "male")?.count).toBe(2);
    expect(facets.categories.find((c) => c.id === "high_quality")?.count).toBe(1);
    expect(facets.standardCount).toBe(3);
    expect(facets.freeCount).toBe(3);
    expect(facets.v4PostCount).toBe(2);
    expect(facets.v4TurboCount).toBe(3);
    expect(facets.v4FastCount).toBe(1);
  });

  test("voiceTitle preserves regional acronyms and voiceDisplayName uses em-dash separators", () => {
    expect(voiceTitle("us_southern")).toBe("US Southern");
    expect(voiceDisplayName("Adam - Deep Narrator")).toBe("Adam — Deep Narrator");
  });

  test("library-view includes voices group in CategoryTree, stepNavHeader, search, and headings", () => {
    const leaves = buildVoiceLeaves(SAMPLE_VOICES, [], "v4");
    const tree = buildNavTree([], [], () => "sfx", 0, {
      count: 3,
      leaves,
    });
    expect(tree.map((s) => s.id)).toEqual(["yours", "bgm", "sfx", "mc", "voices"]);
    expect(tree.at(-1)?.count).toBe(3);

    const stepped = stepNavHeader(INITIAL_NAV, INITIAL_OPEN_GROUPS, "voices", tree);
    expect(stepped.nav).toEqual({ group: "voices", leaf: ALL });
    expect(stepped.open.voices).toBe(true);
    expect(stepped.open.sfx).toBe(false);

    expect(searchPlaceholder({ group: "voices", leaf: ALL })).toBe("Search English voices");
    expect(searchPlaceholder({ group: "voices", leaf: "fav" })).toBe("Search favorite voices");
    expect(categoryHeading({ group: "voices", leaf: "narrative_story" })).toBe("Narrative & Story");
  });

  test("voiceActorTitle resolves synced dynamic voice IDs alongside hardcoded defaults", () => {
    expect(voiceActorTitle("ZaZosYpkIGmSqOwAlfnk")).toBe("Seff Echo");
    expect(voiceActorTitle("customVoiceId12345678")).toBe("Voice · custom");
    registerVoiceNames([{ id: "customVoiceId12345678", name: "Atlas Hero" }]);
    expect(voiceActorTitle("customVoiceId12345678")).toBe("Atlas Hero");
  });

  test("warmVoiceSearchTokens warms slices cleanly and preserves search & cached sort results", () => {
    const freshVoices = SAMPLE_VOICES.map((item) => ({ ...item }));
    const cold = filterAndSortVoices(freshVoices, ALL, "brit", DEFAULT_VOICE_FILTERS, []).map(
      (x) => x.id,
    );
    expect(warmVoiceSearchTokens(freshVoices, 0, 2)).toBe(2);
    expect(warmVoiceSearchTokens(freshVoices, 2, 10)).toBe(freshVoices.length);
    const warm = filterAndSortVoices(freshVoices, ALL, "brit", DEFAULT_VOICE_FILTERS, []).map(
      (x) => x.id,
    );
    expect(warm).toEqual(cold);
    expect(warm).toEqual(["v_clara"]);

    // Subsequent filtered pass reuses cached sort order cleanly without mutating or reordering
    const nameSortedAll = filterAndSortVoices(
      freshVoices,
      ALL,
      "",
      { ...DEFAULT_VOICE_FILTERS, v4Mode: "all", sort: "name" },
      [],
    ).map((x) => x.id);
    const nameSortedNar = filterAndSortVoices(
      freshVoices,
      "narrative_story",
      "",
      { ...DEFAULT_VOICE_FILTERS, v4Mode: "all", sort: "name" },
      [],
    ).map((x) => x.id);
    expect(nameSortedAll).toEqual(["v_clara", "v_legacy", "v_seff", "v_fast"]);
    expect(nameSortedNar).toEqual(["v_seff"]);
  });

  test("buildVoiceLeaves filters category counts by query and search matches category + 4-char IDs", () => {
    const voices = [
      v({
        id: "6OzrBCQf8cjERkYgzSg8",
        name: "Jamal",
        useCase: "narrative_story",
        category: "generated",
        accent: "american",
      }),
      v({
        id: "pNInz6obpgDQGcFmaJgB",
        name: "Clara",
        useCase: "conversational",
        category: "professional",
        accent: "british",
      }),
    ];
    const favs = [voiceStarId("6OzrBCQf8cjERkYgzSg8"), voiceStarId("pNInz6obpgDQGcFmaJgB")];

    const byCat = filterAndSortVoices(voices, ALL, "generated", DEFAULT_VOICE_FILTERS, favs);
    expect(byCat.map((x) => x.id)).toEqual(["6OzrBCQf8cjERkYgzSg8"]);

    const byShortId = filterAndSortVoices(voices, ALL, "6ozr", DEFAULT_VOICE_FILTERS, favs);
    expect(byShortId.map((x) => x.id)).toEqual(["6OzrBCQf8cjERkYgzSg8"]);

    const searchedLeaves = buildVoiceLeaves(voices, favs, "v4", "generated");
    expect(searchedLeaves).toEqual([
      { id: ALL, title: "All", count: 1 },
      { id: "fav", title: "Favorites", count: 1 },
      { id: "narrative_story", title: "Narrative & Story", count: 1 },
    ]);
  });

  test("voiceFilterPills assigns unique keys and unambiguous labels for overlapping facet values", () => {
    const crowded = {
      ...DEFAULT_VOICE_FILTERS,
      v4Mode: "all",
      gender: "neutral",
      descriptive: "professional",
      category: "professional",
      accent: "british",
      sort: "trending",
    };
    const pills = voiceFilterPills(crowded);
    expect(new Set(pills.map((p) => p.id)).size).toBe(pills.length);
    expect(new Set(pills.map((p) => p.label)).size).toBe(pills.length);
    expect(pills.map((p) => [p.id, p.label])).toEqual([
      ["v4Mode", "All models"],
      ["gender", "Gender: Neutral"],
      ["accent", "British"],
      ["descriptive", "Tone: Professional"],
      ["category", "Tier: Professional"],
      ["sort", "Sort: Trending (7d)"],
    ]);
    const clearedCat = pills.find((p) => p.id === "category").clear();
    expect(clearedCat.category).toBe(ALL);
    expect(clearedCat.descriptive).toBe("professional");
  });

  test("buildVoiceUseCaseIndex respects full VoiceFilters consistently with filterAndSortVoices", () => {
    const voices = [
      v({ id: "m_free", name: "Alex", gender: "male", free: true, useCase: "narrative_story" }),
      v({ id: "f_paid", name: "Clara", gender: "female", free: false, useCase: "conversational" }),
      v({ id: "f_free", name: "Beth", gender: "female", free: true, useCase: "conversational" }),
    ];
    const filters = { ...DEFAULT_VOICE_FILTERS, gender: "female", access: "free" };
    const leaves = buildVoiceLeaves(
      voices,
      [voiceStarId("m_free"), voiceStarId("f_free")],
      filters,
      "",
    );
    const allFiltered = filterAndSortVoices(voices, ALL, "", filters, []);
    expect(leaves).toEqual([
      { id: ALL, title: "All", count: allFiltered.length },
      { id: "fav", title: "Favorites", count: 1 },
      { id: "conversational", title: "Conversational", count: 1 },
    ]);
    expect(allFiltered.map((x) => x.id)).toEqual(["f_free"]);
  });

  test("filterAndSortLibrary preserves selected voice leaf even when search or filters leave zero matches in that category", () => {
    const out = filterAndSortLibrary({
      items: [],
      favs: [],
      nav: { group: "voices", leaf: "narrative_story" },
      source: ALL,
      query: "nomatch",
      kindOf: () => "sfx",
      voiceSection: {
        count: 2,
        leaves: [
          { id: ALL, title: "All", count: 2 },
          { id: "fav", title: "Favorites", count: 0 },
          { id: "conversational", title: "Conversational", count: 2 },
        ],
      },
    });
    expect(out.activeNav).toEqual({ group: "voices", leaf: "narrative_story" });
    expect(categoryHeading(out.activeNav)).toBe("Narrative & Story");
  });

  test("voiceFacetOptions cross-filters dimensions, includes model variant counts, and narrows by query", () => {
    const voices = [
      v({
        id: "v_af",
        name: "Alice Star",
        gender: "female",
        accent: "american",
        v4: true,
        v4Post: true,
        v4Turbo: false,
        v4Fast: false,
        free: true,
        rate: 1,
        category: "professional",
      }),
      v({
        id: "v_bf",
        name: "Beth Spark",
        gender: "female",
        accent: "british",
        v4: true,
        v4Post: false,
        v4Turbo: true,
        v4Fast: false,
        free: false,
        rate: 1,
        category: "generated",
      }),
      v({
        id: "v_am",
        name: "Adam Old",
        gender: "male",
        accent: "american",
        v4: true,
        v4Post: false,
        v4Turbo: false,
        v4Fast: true,
        free: true,
        rate: 1,
        category: "professional",
      }),
      v({
        id: "v_leg",
        name: "Raj Legacy",
        gender: "male",
        accent: "indian",
        v4: false,
        v4Post: false,
        v4Turbo: false,
        v4Fast: false,
        free: true,
        rate: 1,
        category: "high_quality",
      }),
    ];

    const cross = voiceFacetOptions(
      voices,
      ALL,
      { ...DEFAULT_VOICE_FILTERS, gender: "female", access: "free" },
      [],
      "",
    );
    expect(cross.total).toBe(1);
    expect(cross.accents).toEqual([{ id: "american", title: "American", count: 1 }]);
    expect(cross.genders).toEqual([
      { id: "female", title: "Female", count: 1 },
      { id: "male", title: "Male", count: 1 },
    ]);
    expect(cross.standardCount).toBe(2);
    expect(cross.freeCount).toBe(1);
    expect(cross.v4Count).toBe(1);
    expect(cross.v4PostCount).toBe(1);
    expect(cross.v4TurboCount).toBe(0);
    expect(cross.v4FastCount).toBe(0);
    expect(cross.allCount).toBe(1);

    const searched = voiceFacetOptions(voices, ALL, DEFAULT_VOICE_FILTERS, [], "spark");
    expect(searched.total).toBe(1);
    expect(searched.accents).toEqual([{ id: "british", title: "British", count: 1 }]);
    expect(searched.genders).toEqual([{ id: "female", title: "Female", count: 1 }]);
  });

  test("voiceEmptyState distinguishes syncing with loaded catalog, cold sync failure, and filtered-out favorites", () => {
    const syncingWithItems = voiceEmptyState({
      loaded: true,
      loading: false,
      status: "syncing",
      syncedAt: "2026-11-15T00:00:00Z",
      hasKey: true,
      error: null,
      totalVoices: 100,
      leaf: ALL,
      query: "zzz",
      hasVoiceFavs: false,
    });
    expect(syncingWithItems.kind).toBe("nomatch");
    expect(syncingWithItems.title).toBe("No matching voices");

    const coldSyncFailed = voiceEmptyState({
      loaded: true,
      loading: false,
      status: "error",
      syncedAt: null,
      hasKey: true,
      error: "Shared voices API 503",
      totalVoices: 0,
      leaf: ALL,
      query: "",
      hasVoiceFavs: false,
    });
    expect(coldSyncFailed.kind).toBe("sync-error");
    expect(coldSyncFailed.title).toBe("Sync failed");

    const hiddenFavs = voiceEmptyState({
      loaded: true,
      loading: false,
      status: "ready",
      syncedAt: "2026-11-15T00:00:00Z",
      hasKey: true,
      error: null,
      totalVoices: 10,
      leaf: "fav",
      query: "",
      hasVoiceFavs: true,
    });
    expect(hiddenFavs.kind).toBe("nomatch");
    expect(hiddenFavs.title).toBe("No matching favorite voices");

    const trulyNoFavs = voiceEmptyState({
      loaded: true,
      loading: false,
      status: "ready",
      syncedAt: "2026-11-15T00:00:00Z",
      hasKey: true,
      error: null,
      totalVoices: 10,
      leaf: "fav",
      query: "",
      hasVoiceFavs: false,
    });
    expect(trulyNoFavs.title).toBe("No favorite voices yet");
  });

  test("voiceGridCols scales column counts cleanly at thresholds and clamps bounds", () => {
    const twoColMin = VOICE_GRID_MIN_CARD_PX * 2 + VOICE_GRID_GAP_PX;
    expect(voiceGridCols(-100)).toBe(1);
    expect(voiceGridCols(0)).toBe(1);
    expect(voiceGridCols(Number.NaN)).toBe(1);
    expect(voiceGridCols(Number.POSITIVE_INFINITY)).toBe(1);
    expect(voiceGridCols(twoColMin - 1)).toBe(1);
    expect(voiceGridCols(twoColMin)).toBe(2);
    expect(voiceGridCols(VOICE_GRID_MIN_CARD_PX * 3 + VOICE_GRID_GAP_PX * 2)).toBe(3);
    expect(voiceGridCols(VOICE_GRID_MIN_CARD_PX * 4 + VOICE_GRID_GAP_PX * 3)).toBe(4);
    expect(voiceGridCols(4000)).toBe(VOICE_GRID_MAX_COLS);
    expect(voiceGridCols(twoColMin, VOICE_GRID_MIN_CARD_PX * 1.15)).toBe(1);
    expect(
      voiceGridCols(
        VOICE_GRID_MIN_CARD_PX * 2.5 + VOICE_GRID_GAP_PX,
        VOICE_GRID_MIN_CARD_PX * 1.15,
      ),
    ).toBe(2);
    // Invalid minCardPx falls back safely to VOICE_GRID_MIN_CARD_PX
    expect(voiceGridCols(twoColMin, 0)).toBe(2);
    expect(voiceGridCols(twoColMin - 1, -50)).toBe(1);
    expect(voiceGridCols(twoColMin, Number.NaN)).toBe(2);
  });

  test("formatCompactCount scales thousands, millions, and billions concisely", () => {
    expect(formatCompactCount(450)).toBe("450");
    expect(formatCompactCount(4_200)).toBe("4.2k");
    expect(formatCompactCount(12_000_000)).toBe("12M");
    expect(formatCompactCount(19_912_500_000)).toBe("19.9B");
  });

  test("captureVoiceRowAnchor & resolveVoiceRowOffset keep tall scrolled rows visible on shrink", () => {
    // Partially scrolled past a tall 343px row (-318px above viewport top, 25px still visible)
    const anchor = captureVoiceRowAnchor(5, 4, -318, 343);
    expect(anchor.voiceIndex).toBe(20);
    // When widened columns reduce that row height to 205px, resolved offset stays inside row (>= -181px)
    const resolved = resolveVoiceRowOffset(anchor, 205);
    expect(resolved).toBeGreaterThanOrEqual(-181);
    expect(resolved).toBeLessThan(0);
    // Positive offsets remain unchanged
    expect(resolveVoiceRowOffset(captureVoiceRowAnchor(2, 3, 12, 64), 64)).toBe(12);
  });

  test("stickyVoiceRowKeys preserves row order and deduplicates active chunk keys", () => {
    const rows = [[{ id: "a" }, { id: "b" }], [{ id: "c" }, { id: "d" }], [{ id: "e" }]];
    expect(stickyVoiceRowKeys(rows, [])).toEqual([]);
    expect(stickyVoiceRowKeys(rows, ["c", "d", "missing"])).toEqual(["c:d"]);
    expect(stickyVoiceRowKeys(rows, ["e", "a"])).toEqual(["a:b", "e"]);
  });

  test("voiceDisplayName normalizes em dashes and subtitle capitalization; voiceoverDisplayText converts ellipses", () => {
    expect(voiceDisplayName("Hope - upbeat and clear")).toBe("Hope — Upbeat and clear");
    expect(voiceDisplayName("Jake - Crisp & Clear")).toBe("Jake — Crisp & Clear");
    expect(voiceoverDisplayText("Bare concrete... on every side.")).toBe(
      "Bare concrete… on every side.",
    );
  });
});
