import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildNavTree,
  categoryHeading,
  collapseSwapFamilies,
  editionOptions,
  editionTitle,
  filterAndSortLibrary,
  formatAuditionTime,
  formatSoundDuration,
  groupLibraryFamilies,
  INITIAL_NAV,
  INITIAL_OPEN_GROUPS,
  itemVariantTitle,
  originOf,
  originOptions,
  originTitle,
  searchPlaceholder,
  siblingsOf,
  sortLibraryItems,
  soundCardDetail,
  soundCardText,
  sourceOptions,
  sourceTitle,
  stepNavHeader,
  warmSearchTokens,
} from "../app/sound/library-view.ts";

const SAMPLE = [
  {
    name: "ear-click-double",
    seconds: 0.08,
    title: "Click · double",
    for: "Double UI click",
    kind: "sfx",
    category: "clicks",
    source: "earshot",
  },
  {
    name: "mixkit-1107",
    seconds: 1.4,
    title: "Page forward single chime",
    kind: "sfx",
    category: "tones",
    source: "mixkit",
  },
  {
    name: "mixkit-168",
    seconds: 1.2,
    title: "Fast air sweep",
    for: "Quick camera whoosh",
    kind: "sfx",
    category: "transitions",
    source: "mixkit",
  },
  {
    name: "paper_grab",
    seconds: 1.8,
    kind: "sfx",
    category: "foley",
  },
  {
    name: "bgm-deep-urban",
    seconds: 288.7,
    title: "Deep Urban — Eugenio Mininni",
    kind: "bgm",
    category: "electronic",
    source: "mixkit",
  },
  {
    name: "bgm-night-owl",
    seconds: 194.2,
    title: "Night Owl — Broke For Free",
    kind: "bgm",
    category: "electronic",
    source: "free-music-archive",
  },
];

describe("sourceTitle & formatSoundDuration", () => {
  test("maps known sources including pixabay, freesound, punch-deck, free-music-archive and title-cases unknown slugs", () => {
    assert.equal(sourceTitle("film"), "This film");
    assert.equal(sourceTitle("pixabay"), "Pixabay");
    assert.equal(sourceTitle("freesound"), "Freesound");
    assert.equal(sourceTitle("punch-deck"), "Punch Deck");
    assert.equal(sourceTitle("free-music-archive"), "Free Music Archive");
    assert.equal(sourceTitle("scott-buckley"), "Scott Buckley");
    assert.equal(sourceTitle("custom-studio-pack"), "Custom Studio Pack");

    const ordered = sourceOptions([
      { name: "ear-click", seconds: 0.1, source: "earshot" },
      { name: "vault-hit", seconds: 0.2, source: "vault" },
      { name: "bgm-code-switch", seconds: 148, source: "punch-deck" },
      { name: "fs-704862", seconds: 0.4, source: "freesound" },
      { name: "bgm-amalgam", seconds: 254, source: "pixabay" },
      { name: "mixkit-168", seconds: 1.2, source: "mixkit" },
    ]);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["all", "mixkit", "pixabay", "freesound", "punch-deck", "vault", "earshot"],
    );
  });

  test("formats >=1s and BGM as CapCut MM:SS, rounds 0.996s cleanly to 00:01, and formats sub-second SFX with hundredths", () => {
    assert.equal(formatSoundDuration(288.7, "bgm"), "04:49");
    assert.equal(formatSoundDuration(189, "bgm"), "03:09");
    assert.equal(formatSoundDuration(1.2, "sfx"), "00:01");
    assert.equal(formatSoundDuration(0.996, "sfx"), "00:01");
    assert.equal(formatSoundDuration(65, "sfx"), "01:05");
    assert.equal(formatSoundDuration(0.08, "sfx"), "0.08s");
    assert.equal(formatSoundDuration(0.28, "sfx"), "0.28s");
  });
});

describe("soundCardText & soundCardDetail", () => {
  test("extracts human title, truncatable subtitle, and non-truncatable duration without leaking raw file stem", () => {
    const inAll = soundCardText(SAMPLE[4], "bgm", { showCategory: true, showSource: true });
    assert.equal(inAll.title, "Deep Urban");
    assert.equal(inAll.subtitle, "Eugenio Mininni · Electronic");
    assert.equal(inAll.duration, "04:49");
    assert.equal(inAll.meta, "Eugenio Mininni · Electronic · 04:49");

    const inCat = soundCardText(SAMPLE[4], "bgm", { showCategory: false, showSource: false });
    assert.equal(inCat.title, "Deep Urban");
    assert.equal(inCat.subtitle, "Eugenio Mininni");
    assert.equal(inCat.duration, "04:49");
    assert.equal(inCat.meta, "Eugenio Mininni · 04:49");
  });

  test("formats SFX cards with human title, category/source context, and inline duration", () => {
    const sweep = soundCardText(SAMPLE[2], "sfx", { showCategory: true, showSource: true });
    assert.equal(sweep.title, "Fast air sweep");
    assert.equal(sweep.meta, "Transitions · Mixkit · 00:01");

    const click = soundCardText(SAMPLE[0], "sfx", { showCategory: false, showSource: true });
    assert.equal(click.title, "Click · double");
    assert.equal(click.meta, "Earshot · 0.08s");
  });

  test("humanizes untitled film-local stems while keeping exact stem in detail tooltip", () => {
    const local = soundCardText(SAMPLE[3], "sfx", { showCategory: true, showSource: true });
    assert.equal(local.title, "Paper grab");
    assert.equal(local.meta, "Foley · This film · 00:02");
    assert.match(soundCardDetail(SAMPLE[2]), /mixkit-168/);
    assert.match(soundCardDetail(SAMPLE[2]), /Quick camera whoosh/);
  });
});

describe("buildNavTree, stepNavHeader & filtering/sorting", () => {
  test("builds CapCut Yours / Music / Sound effects tree with accurate counts and Voiceover leaf", () => {
    const tree = buildNavTree(SAMPLE, ["mixkit-168", "bgm-night-owl"], (x) => x.kind ?? "sfx", 4);
    assert.deepEqual(
      tree.map((g) => ({
        id: g.id,
        title: g.title,
        count: g.count,
        leaves: g.leaves.map((l) => [l.id, l.count]),
      })),
      [
        {
          id: "yours",
          title: "Yours",
          count: 7,
          leaves: [
            ["fav", 2],
            ["voice", 4],
            ["film", 1],
          ],
        },
        {
          id: "bgm",
          title: "Music",
          count: 2,
          leaves: [
            ["all", 2],
            ["electronic", 2],
          ],
        },
        {
          id: "sfx",
          title: "Sound effects",
          count: 4,
          leaves: [
            ["all", 4],
            ["clicks", 1],
            ["foley", 1],
            ["tones", 1],
            ["transitions", 1],
          ],
        },
        {
          id: "mc",
          title: "Minecraft",
          count: 0,
          leaves: [["all", 0]],
        },
      ],
    );
  });

  test("excludes narration stem from Music, Sound effects, and Yours > This film so SFX stays 100% pure", () => {
    const withNarration = [...SAMPLE, { name: "narration", seconds: 107.52 }];
    const sfxView = filterAndSortLibrary({
      items: withNarration,
      favs: [],
      nav: { group: "sfx", leaf: "all" },
      source: "all",
      query: "",
      kindOf: (x) => (x.name === "narration" ? "sfx" : (x.kind ?? "sfx")),
      narrationName: "narration",
      voiceCount: 4,
    });
    assert.ok(!sfxView.shown.some((x) => x.name === "narration"));
    assert.equal(sfxView.tree.find((g) => g.id === "sfx").count, 4);
    assert.deepEqual(
      sfxView.tree.find((g) => g.id === "yours").leaves.map((l) => [l.id, l.count]),
      [
        ["fav", 0],
        ["voice", 4],
        ["film", 1],
      ],
    );
  });

  test("stepNavHeader opens only the active group like CapCut 9.7 and toggles collapse on repeat clicks", () => {
    const tree = buildNavTree(SAMPLE, ["mixkit-168"], (x) => x.kind ?? "sfx");
    assert.deepEqual(INITIAL_NAV, { group: "sfx", leaf: "all" });
    assert.deepEqual(INITIAL_OPEN_GROUPS, { yours: false, bgm: false, sfx: true, mc: false });

    // Clicking Music while on SFX opens Music, closes SFX, and selects Music > All immediately
    const toMusic = stepNavHeader(INITIAL_NAV, INITIAL_OPEN_GROUPS, "bgm", tree);
    assert.deepEqual(toMusic.nav, { group: "bgm", leaf: "all" });
    assert.deepEqual(toMusic.open, { yours: false, bgm: true, sfx: false, mc: false });

    // Clicking Music again while already in Music collapses its accordion without losing selection
    const collapsed = stepNavHeader(toMusic.nav, toMusic.open, "bgm", tree);
    assert.deepEqual(collapsed.nav, { group: "bgm", leaf: "all" });
    assert.equal(collapsed.open.bgm, false);

    // Clicking Yours opens Yours and picks Favorites when non-empty, else Voiceover when non-empty, else This film
    const toYours = stepNavHeader(collapsed.nav, collapsed.open, "yours", tree);
    assert.deepEqual(toYours.nav, { group: "yours", leaf: "fav" });
    assert.deepEqual(toYours.open, { yours: true, bgm: false, sfx: false, mc: false });

    const voiceTree = buildNavTree(SAMPLE, [], (x) => x.kind ?? "sfx", 4);
    const toVoice = stepNavHeader(INITIAL_NAV, INITIAL_OPEN_GROUPS, "yours", voiceTree);
    assert.deepEqual(toVoice.nav, { group: "yours", leaf: "voice" });

    const emptyFavTree = buildNavTree(SAMPLE, [], (x) => x.kind ?? "sfx", 0);
    const toFilm = stepNavHeader(INITIAL_NAV, INITIAL_OPEN_GROUPS, "yours", emptyFavTree);
    assert.deepEqual(toFilm.nav, { group: "yours", leaf: "film" });
  });

  test("sorts film sounds first, then recorded curated sources before synthetic earshot, alphabetically by human title", () => {
    const sfxAll = filterAndSortLibrary({
      items: SAMPLE,
      favs: ["ear-click-double", "mixkit-168"],
      nav: { group: "sfx", leaf: "all" },
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.deepEqual(
      sfxAll.shown.map((x) => x.name),
      ["paper_grab", "mixkit-168", "mixkit-1107", "ear-click-double"],
    );

    // Favorites preserves newest-starred-first order
    const favView = filterAndSortLibrary({
      items: SAMPLE,
      favs: ["ear-click-double", "mixkit-168"],
      nav: { group: "yours", leaf: "fav" },
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.deepEqual(
      favView.shown.map((x) => x.name),
      ["mixkit-168", "ear-click-double"],
    );

    // Source options include Free Music Archive on Music
    const bgmSrcs = sourceOptions(SAMPLE.filter((x) => x.kind === "bgm"));
    assert.deepEqual(
      bgmSrcs.map((s) => [s.id, s.title, s.count]),
      [
        ["all", "All sources", 2],
        ["mixkit", "Mixkit", 1],
        ["free-music-archive", "Free Music Archive", 1],
      ],
    );
  });

  test("returns CapCut-accurate placeholders and category headings", () => {
    assert.equal(searchPlaceholder({ group: "bgm", leaf: "all" }), "Search music");
    assert.equal(searchPlaceholder({ group: "sfx", leaf: "transitions" }), "Search sound effects");
    assert.equal(searchPlaceholder({ group: "yours", leaf: "fav" }), "Search favorites");
    assert.equal(searchPlaceholder({ group: "yours", leaf: "voice" }), "Search voiceover & script");
    assert.equal(searchPlaceholder({ group: "yours", leaf: "film" }), "Search film sounds");

    assert.equal(categoryHeading({ group: "bgm", leaf: "all" }), "All music");
    assert.equal(categoryHeading({ group: "bgm", leaf: "electronic" }), "Electronic");
    assert.equal(categoryHeading({ group: "sfx", leaf: "all" }), "All sound effects");
    assert.equal(categoryHeading({ group: "sfx", leaf: "transitions" }), "Transitions");
    assert.equal(categoryHeading({ group: "yours", leaf: "fav" }), "Favorites");
    assert.equal(categoryHeading({ group: "yours", leaf: "voice" }), "Voiceover");
    assert.equal(categoryHeading({ group: "yours", leaf: "film" }), "This film");
  });

  test("distinguishes Real / Studio vs Code-gen (synth), filters strictly by origin without silent fallback, and updates sources", () => {
    assert.equal(originTitle("all"), "All types");
    assert.equal(originTitle("real"), "Real / Studio");
    assert.equal(originTitle("synth"), "Code-gen");

    // Electronic music produced by humans is Real / Studio, while Earshot / syn_* / explicit origin="synth" is Code-gen
    assert.equal(originOf(SAMPLE[4]), "real");
    assert.equal(originOf(SAMPLE[2]), "real");
    assert.equal(originOf(SAMPLE[3]), "real");
    assert.equal(originOf(SAMPLE[0]), "synth");
    assert.equal(originOf({ name: "syn_heartbeat", source: "film" }), "synth");
    assert.equal(originOf({ name: "ai_whoosh", source: "lion-edit", origin: "synth" }), "synth");
    assert.equal(originOf({ name: "syn_organ_live", source: "film", origin: "real" }), "real");

    assert.match(soundCardDetail(SAMPLE[0]), /Code-gen/);
    assert.match(soundCardDetail(SAMPLE[2]), /Real \/ Studio/);

    // Music > All reports 2 Real / Studio and 0 Code-gen so the user immediately sees 0 code-gen tracks
    assert.deepEqual(
      originOptions(SAMPLE.filter((x) => x.kind === "bgm")).map((o) => [o.id, o.title, o.count]),
      [
        ["all", "All types", 2],
        ["real", "Real / Studio", 2],
        ["synth", "Code-gen", 0],
      ],
    );

    const mixed = [
      ...SAMPLE,
      {
        name: "syn_tick",
        seconds: 0.1,
        title: "Tick pulse",
        kind: "sfx",
        category: "clicks",
        origin: "synth",
      },
    ];

    // Sort order: film real -> film synth -> vault real -> vault synth
    const allSfx = filterAndSortLibrary({
      items: mixed,
      favs: [],
      nav: { group: "sfx", leaf: "all" },
      origin: "all",
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.deepEqual(
      allSfx.shown.map((x) => x.name),
      ["paper_grab", "syn_tick", "mixkit-168", "mixkit-1107", "ear-click-double"],
    );

    // Filtering by Real / Studio keeps film + Mixkit real recordings, drops all synth items, and scopes sources to real sources only
    const realOnly = filterAndSortLibrary({
      items: mixed,
      favs: [],
      nav: { group: "sfx", leaf: "all" },
      origin: "real",
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.equal(realOnly.activeOrigin, "real");
    assert.equal(realOnly.activeSource, "all");
    assert.deepEqual(
      realOnly.shown.map((x) => x.name),
      ["paper_grab", "mixkit-168", "mixkit-1107"],
    );
    assert.deepEqual(
      realOnly.sources.map((s) => [s.id, s.count]),
      [
        ["all", 3],
        ["film", 1],
        ["mixkit", 2],
      ],
    );

    // Selecting a specific Source stays strict on single-source searches and 0-match categories (never leaks other sources)
    const fmaInElectronic = filterAndSortLibrary({
      items: mixed,
      favs: [],
      nav: { group: "bgm", leaf: "electronic" },
      origin: "all",
      source: "free-music-archive",
      query: "Night Owl",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.equal(fmaInElectronic.activeSource, "free-music-archive");
    assert.deepEqual(
      fmaInElectronic.shown.map((x) => x.name),
      ["bgm-night-owl"],
    );
    assert.ok(fmaInElectronic.sources.some((s) => s.id === "free-music-archive" && s.count === 1));

    const scottInFoley = filterAndSortLibrary({
      items: mixed,
      favs: [],
      nav: { group: "sfx", leaf: "foley" },
      origin: "all",
      source: "scott-buckley",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.equal(scottInFoley.activeSource, "scott-buckley");
    assert.deepEqual(scottInFoley.shown, []);
    assert.ok(scottInFoley.sources.some((s) => s.id === "scott-buckley" && s.count === 0));

    // Selecting Code-gen on a category with 0 synth items stays strict (never silently leaks real recordings)
    const synthInFoley = filterAndSortLibrary({
      items: mixed,
      favs: [],
      nav: { group: "sfx", leaf: "foley" },
      origin: "synth",
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.equal(synthInFoley.activeOrigin, "synth");
    assert.deepEqual(synthInFoley.shown, []);
  });

  test("formatAuditionTime handles 00:00 start, sub-second SFX decimals, and unknown pre-metadata duration; Yours count deduplicates starred film sounds", () => {
    assert.equal(formatAuditionTime(0, 1.12, "sfx", true), "00:00 / 00:01");
    assert.equal(formatAuditionTime(0.4, 1.12, "sfx", true), "00:00 / 00:01");
    assert.equal(formatAuditionTime(1.05, 288.7, "bgm", true), "00:01 / 04:49");
    assert.equal(formatAuditionTime(0, 0.28, "sfx", true), "0.00s / 0.28s");
    assert.equal(formatAuditionTime(0.05, 0.28, "sfx", true), "0.05s / 0.28s");
    assert.equal(formatAuditionTime(0, 0.01, "sfx", false), "00:00 / --:--");

    // Star paper_grab (a film sound): Yours total count must not double-count paper_grab across Favorites + This film
    const navWithStarredFilm = buildNavTree(SAMPLE, ["paper_grab"], (x) => x.kind ?? "sfx", 2);
    const yours = navWithStarredFilm.find((s) => s.id === "yours");
    assert.equal(yours.leaves.find((l) => l.id === "fav").count, 1);
    assert.equal(yours.leaves.find((l) => l.id === "voice").count, 2);
    assert.equal(yours.leaves.find((l) => l.id === "film").count, 1);
    assert.equal(yours.count, 3);
  });

  test("Minecraft section filters by Vanilla 26.3 vs Modded edition, orders pack sources by count, and groups multi-variant families naturally", () => {
    const mcSample = [
      ...SAMPLE,
      {
        name: "mc-step-stone-10",
        seconds: 0.26,
        title: "Stone · Step",
        kind: "mc",
        category: "footsteps",
        source: "minecraft",
        family: "mc-step-stone",
        variant: 10,
      },
      {
        name: "mc-step-stone-1",
        seconds: 0.22,
        title: "Stone · Step",
        kind: "mc",
        category: "footsteps",
        source: "minecraft",
        family: "mc-step-stone",
        variant: 1,
      },
      {
        name: "mc-step-stone-2",
        seconds: 0.24,
        title: "Stone · Step",
        kind: "mc",
        category: "footsteps",
        source: "minecraft",
        family: "mc-step-stone",
        variant: 2,
      },
      {
        name: "mc-block-chest-open",
        seconds: 0.48,
        title: "Chest · Open",
        kind: "mc",
        category: "blocks",
        source: "minecraft",
      },
      {
        name: "mc-presence-footsteps-bluntwood-walk-1",
        seconds: 0.3,
        title: "Bluntwood · Walk",
        kind: "mc",
        category: "footsteps",
        source: "presence-footsteps",
        family: "mc-presence-footsteps-bluntwood-walk",
        variant: 1,
      },
      {
        name: "mc-presence-footsteps-bluntwood-walk-2",
        seconds: 0.31,
        title: "Bluntwood · Walk",
        kind: "mc",
        category: "footsteps",
        source: "presence-footsteps",
        family: "mc-presence-footsteps-bluntwood-walk",
        variant: 2,
      },
      {
        name: "mc-immersivethunder-thunder-close-1",
        seconds: 4.8,
        title: "Thunder Close",
        kind: "mc",
        category: "ambience",
        source: "immersivethunder",
      },
    ];

    assert.equal(sourceTitle("minecraft"), "Minecraft Vanilla");
    assert.equal(sourceTitle("presence-footsteps"), "Presence Footsteps");
    assert.equal(sourceTitle("immersivethunder"), "ImmersiveThunder");
    assert.equal(sourceTitle("quality-sounds"), "Quality Sounds");
    assert.equal(sourceTitle("create-nuclear"), "Create Nuclear");
    assert.equal(sourceTitle("laboratory-blocks"), "Laboratory Blocks");
    assert.equal(searchPlaceholder({ group: "mc", leaf: "all" }), "Search Minecraft");
    assert.equal(categoryHeading({ group: "mc", leaf: "all" }), "All Minecraft");
    assert.equal(categoryHeading({ group: "mc", leaf: "blocks" }), "Blocks & mechanisms");
    assert.equal(categoryHeading({ group: "mc", leaf: "horror" }), "Horror & caves");
    assert.equal(editionTitle("all"), "All editions");
    assert.equal(editionTitle("vanilla"), "Vanilla 26.3");
    assert.equal(editionTitle("modded"), "Modded packs");

    const allMc = filterAndSortLibrary({
      items: mcSample,
      favs: [],
      nav: { group: "mc", leaf: "all" },
      edition: "all",
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.equal(allMc.shown.length, 7);
    // Nav tree, Edition filter, and Source filter all count collapsed sound families (4), matching rendered cards 1:1!
    const mcNav = allMc.tree.find((t) => t.id === "mc");
    assert.equal(mcNav.count, 4);
    assert.deepEqual(
      mcNav.leaves.map((l) => [l.id, l.count]),
      [
        ["all", 4],
        ["ambience", 1],
        ["blocks", 1],
        ["footsteps", 2],
      ],
    );
    assert.deepEqual(
      editionOptions(allMc.shown).map((e) => [e.id, e.count]),
      [
        ["all", 4],
        ["vanilla", 2],
        ["modded", 2],
      ],
    );
    assert.deepEqual(
      sourceOptions(allMc.shown).map((s) => [s.id, s.count]),
      [
        ["all", 4],
        ["minecraft", 2],
        ["immersivethunder", 1],
        ["presence-footsteps", 1],
      ],
    );

    // SoundSwapPicker default browse collapses multi-variant families to 1 item while preserving the active variant if selected
    assert.deepEqual(
      collapseSwapFamilies(allMc.shown, "mc-step-stone-10").map((x) => x.name),
      [
        "mc-block-chest-open",
        "mc-step-stone-10",
        "mc-presence-footsteps-bluntwood-walk-1",
        "mc-immersivethunder-thunder-close-1",
      ],
    );

    // Grouping collapses 3 stone steps + 2 bluntwood steps + 2 singletons -> 4 family cards,
    // with Vanilla 26.3 prioritized ahead of modded packs, and variants sorted 1 -> 2 -> 10 inside Stone
    const groups = groupLibraryFamilies(allMc.shown);
    assert.equal(groups.length, 4);
    assert.deepEqual(
      groups.map((g) => g.key),
      [
        "name:mc-block-chest-open",
        "family:mc-step-stone",
        "family:mc-presence-footsteps-bluntwood-walk",
        "name:mc-immersivethunder-thunder-close-1",
      ],
    );
    const stoneGroup = groups.find((g) => g.key === "family:mc-step-stone");
    assert.deepEqual(
      stoneGroup.variants.map((v) => v.name),
      ["mc-step-stone-1", "mc-step-stone-2", "mc-step-stone-10"],
    );
    assert.equal(stoneGroup.primary.name, "mc-step-stone-1");
    assert.equal(
      soundCardText(stoneGroup.primary, "mc", { showCategory: false, showSource: true }).subtitle,
      "Vanilla",
    );
    assert.equal(
      soundCardText(stoneGroup.primary, "mc", { showCategory: true, showSource: true }).subtitle,
      "Footsteps · Vanilla",
    );
    assert.equal(
      soundCardText(stoneGroup.variants[1], "mc", {
        showCategory: false,
        showSource: true,
        showVariant: false,
      }).title,
      "Stone · Step",
    );
    assert.equal(
      soundCardText(stoneGroup.variants[1], "mc", {
        showCategory: false,
        showSource: true,
        showVariant: true,
      }).title,
      "Stone · Step #2",
    );
    assert.equal(itemVariantTitle(stoneGroup.variants[1]), "Stone · Step #2");
    assert.equal(
      itemVariantTitle(mcSample.find((x) => x.name === "mc-block-chest-open")),
      "Chest · Open",
    );

    // siblingsOf returns all sorted variants for Inspector quick-switching
    assert.deepEqual(
      siblingsOf(
        mcSample,
        mcSample.find((x) => x.name === "mc-step-stone-10"),
      ).map((v) => v.name),
      ["mc-step-stone-1", "mc-step-stone-2", "mc-step-stone-10"],
    );
    assert.deepEqual(
      siblingsOf(
        mcSample,
        mcSample.find((x) => x.name === "mc-block-chest-open"),
      ).map((v) => v.name),
      ["mc-block-chest-open"],
    );

    // Modded edition filter keeps only modded packs and scopes sources to modded packs sorted by count
    const moddedFootsteps = filterAndSortLibrary({
      items: mcSample,
      favs: [],
      nav: { group: "mc", leaf: "footsteps" },
      edition: "modded",
      source: "all",
      query: "",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.equal(moddedFootsteps.activeEdition, "modded");
    assert.deepEqual(
      moddedFootsteps.shown.map((x) => x.name),
      ["mc-presence-footsteps-bluntwood-walk-1", "mc-presence-footsteps-bluntwood-walk-2"],
    );
  });

  test("warmSearchTokens incrementally warms search tokens in bounded slices without changing search results", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      name: `sfx-slice-${i}`,
      seconds: 0.5,
      title: `Slice Sound ${i}`,
      kind: "sfx",
      category: "foley",
      source: "mixkit",
    }));
    assert.equal(warmSearchTokens(items, 0, 2), 2);
    assert.equal(warmSearchTokens(items, 2, 2), 4);
    assert.equal(warmSearchTokens(items, 4, 2), 5);
    const res = filterAndSortLibrary({
      items,
      favs: [],
      nav: { group: "sfx", leaf: "all" },
      source: "all",
      query: "slice sound 3",
      kindOf: (x) => x.kind ?? "sfx",
    });
    assert.deepEqual(
      res.shown.map((x) => x.name),
      ["sfx-slice-3"],
    );
  });
  test("a lone sound named like a family slug keeps its own card and counts once", () => {
    const items = [
      {
        name: "mc-cricket-1",
        seconds: 1,
        kind: "mc",
        category: "ambience",
        source: "ambientsounds",
        family: "mc-cricket",
        variant: 1,
      },
      {
        name: "mc-cricket-2",
        seconds: 1,
        kind: "mc",
        category: "ambience",
        source: "ambientsounds",
        family: "mc-cricket",
        variant: 2,
      },
      { name: "mc-cricket", seconds: 1, kind: "mc", category: "ambience", source: "ambientsounds" },
    ];
    assert.deepEqual(
      groupLibraryFamilies(items).map((g) => g.variants.map((v) => v.name)),
      [["mc-cricket-1", "mc-cricket-2"], ["mc-cricket"]],
    );
    const mc = buildNavTree(items, [], () => "mc").find((s) => s.id === "mc");
    assert.equal(mc.count, 2);
  });
  test("YouTube Content ID tracks sort after clean ones of the same tier and say so in their detail", () => {
    const items = [
      {
        name: "bgm-a",
        seconds: 90,
        kind: "bgm",
        title: "Alpha — X",
        source: "pixabay",
        origin: "real",
        contentId: true,
      },
      {
        name: "bgm-b",
        seconds: 90,
        kind: "bgm",
        title: "Beta — Y",
        source: "pixabay",
        origin: "real",
      },
    ];
    assert.deepEqual(
      sortLibraryItems(items).map((x) => x.name),
      ["bgm-b", "bgm-a"],
    );
    assert.match(soundCardDetail(items[0]), /YouTube Content ID/);
    assert.doesNotMatch(soundCardDetail(items[1]), /Content ID/);
  });
});
