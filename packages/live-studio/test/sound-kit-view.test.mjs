import { describe, expect, test } from "bun:test";

import {
  buildKitRows,
  buildPopularPool,
  computeCategoryCounts,
  inferClipKitCategory,
  isKitHotkeyBlockedTarget,
  isSoundKitModalFallbackTarget,
  nextFocusAfterTriage,
  notePlaceholderForCategory,
  resolveKitTargetRowId,
  shouldInterceptKitKey,
  stepFocusIndex,
  suggestedTagsForCategory,
  toggleAbSlot,
} from "../app/sound/sound-kit-view.ts";

const LIBRARY = [
  {
    name: "whoosh-v1-raw",
    title: "Fast Air Whoosh 1",
    kind: "sfx",
    category: "whoosh",
    source: "mixkit",
    seconds: 0.45,
    family: "whoosh-fast-air",
    variant: 1,
  },
  {
    name: "whoosh-v2-core",
    title: "Fast Air Whoosh 2",
    kind: "sfx",
    category: "whoosh",
    source: "mixkit",
    seconds: 0.48,
    family: "whoosh-fast-air",
    variant: 2,
  },
  {
    name: "whoosh-banned-noise",
    title: "Harsh Wind Whoosh",
    kind: "sfx",
    category: "whoosh",
    source: "freesound",
    seconds: 1.2,
  },
  {
    name: "impact-soft-hit-1",
    title: "Soft Hit Thud",
    kind: "sfx",
    category: "impact",
    source: "sonniss",
    seconds: 0.35,
  },
  {
    name: "pop-clean-click",
    title: "Clean Pop Click",
    kind: "sfx",
    category: "ui",
    source: "kenney",
    seconds: 0.14,
  },
  {
    name: "bgm-tense-pulse",
    title: "Tense Pulse",
    kind: "bgm",
    category: "bgm",
    source: "pixabay",
    seconds: 95,
  },
  {
    name: "mc-wood-step-1",
    title: "Wood Step",
    kind: "mc",
    category: "step",
    source: "minecraft",
    seconds: 0.18,
  },
  {
    name: "mc-tracked-core",
    title: "Plop Orb",
    kind: "mc",
    category: "ui",
    source: "minecraft",
    seconds: 0.22,
  },
  {
    name: "narration-guide",
    title: "Voice Narration Whoosh",
    kind: "sfx",
    category: "whoosh",
    source: "film",
    seconds: 30,
  },
  {
    name: "niche-whale-song",
    title: "Deep Whale Song",
    kind: "sfx",
    category: "animal",
    source: "freesound",
    seconds: 5.5,
  },
];

const KIT_STATE = {
  version: 1,
  abSlots: ["whoosh-v2-core", "pop-clean-click"],
  decisions: [],
  items: {
    "whoosh-v2-core": {
      id: "whoosh-v2-core",
      category: "whoosh",
      status: "core",
      tier: 1,
      tags: ["tight", "whip"],
      note: "go-to camera whip",
      elo: 1450,
      wins: 1,
      losses: 0,
      picks: 0,
      addedBy: "human",
      updatedAt: "2026-11-24T00:00:00Z",
    },
    "pop-clean-click": {
      id: "pop-clean-click",
      category: "pop-ui",
      status: "core",
      tier: 0,
      tags: ["clean"],
      note: "",
      elo: 1620,
      wins: 3,
      losses: 0,
      picks: 1,
      addedBy: "human",
      updatedAt: "2026-11-24T00:00:00Z",
    },
    "bgm-tense-pulse": {
      id: "bgm-tense-pulse",
      category: "bgm",
      status: "core",
      tier: 0,
      tags: ["tense"],
      note: "",
      elo: 1500,
      wins: 0,
      losses: 0,
      picks: 5,
      addedBy: "human",
      updatedAt: "2026-11-24T00:00:00Z",
    },
    "mc-tracked-core": {
      id: "mc-tracked-core",
      category: "pop-ui",
      status: "core",
      tier: 0,
      tags: [],
      note: "",
      elo: 1500,
      wins: 0,
      losses: 0,
      picks: 2,
      addedBy: "human",
      updatedAt: "2026-11-24T00:00:00Z",
    },
    "missing-old-hit": {
      id: "missing-old-hit",
      category: "impact",
      status: "core",
      tier: 0,
      tags: [],
      note: "",
      elo: 1500,
      wins: 0,
      losses: 0,
      picks: 2,
      addedBy: "human",
      updatedAt: "2026-11-24T00:00:00Z",
    },
    "inbox-older": {
      id: "inbox-older",
      category: "impact",
      status: "inbox",
      tier: 0,
      tags: [],
      note: "",
      elo: 1500,
      wins: 0,
      losses: 0,
      picks: 0,
      addedBy: "ai",
      updatedAt: "2026-11-24T00:01:00Z",
    },
    "inbox-newer": {
      id: "inbox-newer",
      category: "impact",
      status: "inbox",
      tier: 0,
      tags: [],
      note: "",
      elo: 1500,
      wins: 0,
      losses: 0,
      picks: 0,
      addedBy: "ai",
      updatedAt: "2026-11-24T00:05:00Z",
    },
    "whoosh-banned-noise": {
      id: "whoosh-banned-noise",
      category: "whoosh",
      status: "ban",
      tier: 0,
      tags: [],
      note: "too harsh",
      elo: 1420,
      wins: 0,
      losses: 2,
      picks: 0,
      addedBy: "human",
      updatedAt: "2026-11-24T00:01:00Z",
    },
    "ban-newer": {
      id: "ban-newer",
      category: "whoosh",
      status: "ban",
      tier: 0,
      tags: [],
      note: "",
      elo: 1410,
      wins: 0,
      losses: 1,
      picks: 0,
      addedBy: "human",
      updatedAt: "2026-11-24T00:09:00Z",
    },
  },
};

describe("buildKitRows and computeCategoryCounts", () => {
  test("popular pool defaults to curated real studio sounds, supports all/synth/mc toggles, promotes core variant #2 over #1, and sorts real studio ahead of synth", () => {
    const libraryWithBulkAndSynth = [
      ...LIBRARY,
      {
        name: "ear-riser-synth",
        title: "Downlifter Air Fall",
        kind: "sfx",
        category: "riser",
        source: "earshot",
        origin: "synth",
        seconds: 1.5,
      },
      {
        name: "of-riser-bulk",
        title: "OpenFilm Riser Bulk",
        kind: "sfx",
        category: "riser",
        source: "openfilm",
        seconds: 2.1,
      },
      {
        name: "mixkit-riser-real",
        title: "Zebra Tension Riser",
        kind: "sfx",
        category: "riser",
        source: "mixkit",
        seconds: 2.0,
      },
    ];

    const curatedRows = buildKitRows({
      library: libraryWithBulkAndSynth,
      kitState: KIT_STATE,
      tab: "popular",
      category: "all",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: "narration-guide",
    });

    expect(curatedRows.map((r) => r.id)).toEqual([
      "whoosh-v2-core",
      "bgm-tense-pulse",
      "mixkit-riser-real",
      "pop-clean-click",
      "mc-tracked-core",
    ]);
    expect(curatedRows.some((r) => r.id === "impact-soft-hit-1")).toBe(false);
    expect(curatedRows.some((r) => r.id === "of-riser-bulk")).toBe(false);
    expect(curatedRows.some((r) => r.id === "ear-riser-synth")).toBe(false);
    expect(curatedRows[0].variantCount).toBe(2);
    expect(curatedRows[0].variantIds).toEqual(["whoosh-v1-raw", "whoosh-v2-core"]);
    expect(curatedRows[0].abIndex).toBe(0);
    expect(curatedRows.find((r) => r.id === "pop-clean-click")?.abIndex).toBe(1);

    const allAndSynthRows = buildKitRows({
      library: libraryWithBulkAndSynth,
      kitState: KIT_STATE,
      tab: "popular",
      category: "riser",
      query: "",
      tag: "",
      poolScope: "all",
      includeSynth: true,
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(allAndSynthRows.map((r) => r.id)).toEqual([
      "mixkit-riser-real",
      "of-riser-bulk",
      "ear-riser-synth",
    ]);

    const allOpts = {
      scope: "all",
      includeSynth: false,
      includeMc: false,
      narrationName: "narration-guide",
    };
    const pool = buildPopularPool(LIBRARY, KIT_STATE, allOpts);
    const allIds = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "popular",
      category: "all",
      query: "",
      tag: "",
      poolScope: "all",
      includeMc: false,
      narrationName: "narration-guide",
    }).map((r) => r.id);
    expect(
      buildKitRows({
        library: LIBRARY,
        kitState: KIT_STATE,
        tab: "popular",
        category: "all",
        query: "",
        tag: "",
        poolScope: "all",
        includeMc: false,
        narrationName: "narration-guide",
        popularPool: pool,
      }).map((r) => r.id),
    ).toEqual(allIds);
    expect(computeCategoryCounts(LIBRARY, KIT_STATE, allOpts, pool)).toEqual(
      computeCategoryCounts(LIBRARY, KIT_STATE, allOpts),
    );

    const hyphenTag = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "popular",
      category: "impact",
      query: "",
      tag: "soft-hit",
      poolScope: "all",
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(hyphenTag.map((r) => r.id)).toEqual(["impact-soft-hit-1"]);

    const withMc = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "popular",
      category: "all",
      query: "",
      tag: "",
      includeMc: true,
      narrationName: "narration-guide",
    });
    expect(withMc.some((r) => r.id === "mc-wood-step-1")).toBe(true);
  });

  test("pass items sink to the bottom in both inbox and popular tabs while keeping inbox counts unreviewed-only", () => {
    const stateWithPass = {
      ...KIT_STATE,
      items: {
        ...KIT_STATE.items,
        "pass-earlier": {
          id: "pass-earlier",
          category: "impact",
          status: "pass",
          tier: 0,
          tags: [],
          note: "",
          elo: 1500,
          wins: 0,
          losses: 0,
          picks: 0,
          addedBy: "human",
          updatedAt: "2026-11-24T00:02:00Z",
        },
        "pass-later": {
          id: "pass-later",
          category: "impact",
          status: "pass",
          tier: 0,
          tags: [],
          note: "",
          elo: 1500,
          wins: 0,
          losses: 0,
          picks: 0,
          addedBy: "human",
          updatedAt: "2026-11-24T00:08:00Z",
        },
        "pop-clean-click": {
          ...KIT_STATE.items["pop-clean-click"],
          status: "pass",
          updatedAt: "2026-11-24T00:03:00Z",
        },
      },
    };

    const inboxRows = buildKitRows({
      library: LIBRARY,
      kitState: stateWithPass,
      tab: "inbox",
      category: "impact",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(inboxRows.map((r) => r.id)).toEqual([
      "inbox-newer",
      "inbox-older",
      "pass-earlier",
      "pass-later",
    ]);

    const popularRows = buildKitRows({
      library: LIBRARY,
      kitState: stateWithPass,
      tab: "popular",
      category: "all",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(popularRows.at(-1)?.id).toBe("pop-clean-click");
    expect(popularRows.at(-1)?.status).toBe("pass");

    const counts = computeCategoryCounts(LIBRARY, stateWithPass, {
      scope: "curated",
      narrationName: "narration-guide",
    });
    expect(counts.totals.inbox).toBe(2);
    expect(counts.totals.pass).toBe(3);
    expect(counts.byCategory.impact.inbox).toBe(2);
    expect(counts.byCategory.impact.pass).toBe(2);

    const coreRows = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "core",
      category: "whoosh",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(coreRows[0]?.id).toBe("whoosh-v2-core");
    expect(coreRows[0]?.variantIds).toEqual(["whoosh-v2-core", "whoosh-v1-raw"]);
  });

  test("core tab enforces independent tie-breakers: tier > elo > picks > id, and flags missing library items", () => {
    const core = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "core",
      category: "all",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: null,
    });
    expect(core.map((r) => r.id)).toEqual([
      "whoosh-v2-core",
      "pop-clean-click",
      "bgm-tense-pulse",
      "mc-tracked-core",
      "missing-old-hit",
    ]);
    expect(core[4].missingFromLibrary).toBe(true);
    expect(core[4].durationLabel).toBe("—");

    const byNote = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "core",
      category: "whoosh",
      query: "camera whip",
      tag: "tight",
      includeMc: false,
      narrationName: null,
    });
    expect(byNote.map((r) => r.id)).toEqual(["whoosh-v2-core"]);
  });

  test("inbox and ban tabs sort newest updatedAt first and computeCategoryCounts matches visible totals", () => {
    const inbox = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "inbox",
      category: "all",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(inbox.map((r) => r.id)).toEqual(["inbox-newer", "inbox-older"]);

    const banned = buildKitRows({
      library: LIBRARY,
      kitState: KIT_STATE,
      tab: "ban",
      category: "all",
      query: "",
      tag: "",
      includeMc: false,
      narrationName: "narration-guide",
    });
    expect(banned.map((r) => r.id)).toEqual(["ban-newer", "whoosh-banned-noise"]);

    const counts = computeCategoryCounts(LIBRARY, KIT_STATE, {
      scope: "all",
      narrationName: "narration-guide",
    });
    expect(counts.totals).toEqual({ inbox: 2, core: 5, pass: 0, ban: 2, popular: 5 });
    expect(counts.byCategory.whoosh).toEqual({ inbox: 0, core: 1, pass: 0, ban: 2, popular: 1 });
    expect(counts.byCategory["pop-ui"]).toEqual({ inbox: 0, core: 2, pass: 0, ban: 0, popular: 2 });
  });
});

describe("triage navigation, A/B slots, category metadata, and keyboard guards", () => {
  test("nextFocusAfterTriage steps forward, falls back to previous on tail, and returns null when last item removed", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(nextFocusAfterTriage(rows, "a")).toBe("b");
    expect(nextFocusAfterTriage(rows, "c")).toBe("b");
    expect(nextFocusAfterTriage([{ id: "only" }], "only")).toBeNull();
    expect(nextFocusAfterTriage([], "a")).toBeNull();
  });

  test("toggleAbSlot adds up to 4, removes existing, replaces slot 4 when full, and ignores unsafe ids", () => {
    expect(toggleAbSlot([], "s1")).toEqual(["s1"]);
    expect(toggleAbSlot(["s1", "s2"], "s1")).toEqual(["s2"]);
    expect(toggleAbSlot(["s1", "s2", "s3", "s4"], "s5")).toEqual(["s1", "s2", "s3", "s5"]);
    expect(toggleAbSlot(["s1"], "../evil")).toEqual(["s1"]);
  });

  test("stepFocusIndex clamps within bounds and starts at tail when stepping up from unset", () => {
    expect(stepFocusIndex(-1, 1, 3)).toBe(0);
    expect(stepFocusIndex(-1, -1, 3)).toBe(2);
    expect(stepFocusIndex(0, -1, 3)).toBe(0);
    expect(stepFocusIndex(2, 1, 3)).toBe(2);
    expect(stepFocusIndex(0, 1, 0)).toBe(-1);
  });

  test("inferClipKitCategory, suggestedTagsForCategory, and notePlaceholderForCategory handle all categories", () => {
    expect(inferClipKitCategory("whoosh-v2-core", "sfx", LIBRARY[1], KIT_STATE)).toBe("whoosh");
    expect(inferClipKitCategory("unknown-bed", "beds", undefined, KIT_STATE)).toBe("bgm");
    expect(inferClipKitCategory("niche-whale-song", "sfx", LIBRARY[9], KIT_STATE)).toBeNull();
    expect(suggestedTagsForCategory("all")).toEqual([]);
    expect(suggestedTagsForCategory("whoosh").length).toBeGreaterThan(0);
    expect(notePlaceholderForCategory("bgm")).not.toBe(notePlaceholderForCategory("whoosh"));
  });

  test("shouldInterceptKitKey never hijacks Enter or Space on buttons/checkboxes/tabs while keeping triage hotkeys and row Space working", () => {
    const fakeEl = (opts) => ({
      tagName: opts.tag ?? "DIV",
      isContentEditable: Boolean(opts.editable),
      hasAttribute: (attr) => (attr === "data-kit-row-focus" ? Boolean(opts.rowFocus) : false),
      closest: (sel) => {
        if (opts.rowFocus && sel.includes("data-kit-row-focus")) return {};
        if (
          sel.includes("button") &&
          ((opts.tag ?? "").toUpperCase() === "BUTTON" ||
            opts.role === "checkbox" ||
            opts.role === "tab" ||
            opts.role === "radio")
        ) {
          return {};
        }
        if (
          sel.includes("alertdialog") &&
          (opts.overlay === "alertdialog" || opts.overlay === "menu")
        ) {
          return {};
        }
        if (sel === '[role="dialog"]' && opts.dialog) {
          return {
            hasAttribute: (attr) => attr === "data-sound-kit-dialog" && opts.dialog === "kit",
          };
        }
        return null;
      },
    });

    const inputEl = fakeEl({ tag: "INPUT" });
    const alertEl = fakeEl({ overlay: "alertdialog" });
    const menuEl = fakeEl({ overlay: "menu" });
    const foreignDlgEl = fakeEl({ tag: "DIV", dialog: "foreign" });
    const kitButton = fakeEl({ tag: "BUTTON", dialog: "kit" });
    const kitCheckbox = fakeEl({ tag: "SPAN", role: "checkbox", dialog: "kit" });
    const kitTab = fakeEl({ tag: "BUTTON", role: "tab", dialog: "kit" });
    const kitRowFocus = fakeEl({ tag: "BUTTON", rowFocus: true, dialog: "kit" });
    const kitContainer = fakeEl({ tag: "DIV", dialog: "kit" });

    expect(isKitHotkeyBlockedTarget(inputEl)).toBe(true);
    expect(isKitHotkeyBlockedTarget(alertEl)).toBe(true);
    expect(isKitHotkeyBlockedTarget(menuEl)).toBe(true);
    expect(isKitHotkeyBlockedTarget(foreignDlgEl)).toBe(true);
    expect(isKitHotkeyBlockedTarget(kitButton)).toBe(false);

    expect(shouldInterceptKitKey(kitButton, "Enter")).toBe(false);
    expect(shouldInterceptKitKey(kitButton, " ")).toBe(false);
    expect(shouldInterceptKitKey(kitCheckbox, " ")).toBe(false);
    expect(shouldInterceptKitKey(kitTab, " ")).toBe(false);
    expect(shouldInterceptKitKey(kitTab, "Enter")).toBe(false);
    expect(shouldInterceptKitKey(kitRowFocus, "Enter")).toBe(false);

    expect(shouldInterceptKitKey(kitRowFocus, " ")).toBe(true);
    expect(shouldInterceptKitKey(kitContainer, " ")).toBe(true);
    expect(shouldInterceptKitKey(kitButton, "k")).toBe(true);
    expect(shouldInterceptKitKey(kitButton, "s")).toBe(true);
    expect(shouldInterceptKitKey(inputEl, "k")).toBe(false);
    expect(shouldInterceptKitKey(alertEl, "k")).toBe(false);
  });

  test("resolveKitTargetRowId extracts owning row id from row element or nested control", () => {
    const rowEl = { getAttribute: (name) => (name === "data-kit-row" ? "bgm-beauty-flow" : null) };
    const childBtn = {
      closest: (sel) => (sel === "[data-kit-row]" ? rowEl : null),
    };
    const outsideEl = { closest: () => null };
    expect(resolveKitTargetRowId(rowEl)).toBe("bgm-beauty-flow");
    expect(resolveKitTargetRowId(childBtn)).toBe("bgm-beauty-flow");
    expect(resolveKitTargetRowId(outsideEl)).toBeNull();
    expect(resolveKitTargetRowId(null)).toBeNull();
  });

  test("isSoundKitModalFallbackTarget fires on dialog shell/close button but defers inside workbench or text inputs", () => {
    const withMatch = (matches) => ({
      closest: (sel) => (matches.some((m) => sel.includes(m)) ? {} : null),
    });
    expect(isSoundKitModalFallbackTarget(null)).toBe(true);
    expect(isSoundKitModalFallbackTarget(withMatch([]))).toBe(true);
    expect(isSoundKitModalFallbackTarget(withMatch(["[data-sound-kit]"]))).toBe(false);
    expect(isSoundKitModalFallbackTarget(withMatch(["input"]))).toBe(false);
    expect(isSoundKitModalFallbackTarget(withMatch(["textarea"]))).toBe(false);
    expect(isSoundKitModalFallbackTarget(withMatch(["contenteditable"]))).toBe(false);
  });
});
