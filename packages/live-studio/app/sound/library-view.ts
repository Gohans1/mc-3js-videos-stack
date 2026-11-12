import { words } from "../core/search";
import type { LibraryItem } from "./sound";

const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const SIMPLE_COLLATOR = new Intl.Collator(undefined);
const splitTitleCache = new WeakMap<
  object,
  { name: string; title: string | undefined; value: { title: string; creator?: string } }
>();
const searchTokensCache = new WeakMap<
  object,
  {
    name: string;
    family: string | undefined;
    title: string | undefined;
    for: string | undefined;
    category: string | undefined;
    source: string | undefined;
    tokens: readonly string[];
  }
>();

export type SoundKind = "bgm" | "sfx" | "mc";
export type SoundOrigin = "real" | "synth";
export type OriginFilter = typeof ALL | SoundOrigin;
export type EditionKind = "vanilla" | "modded";
export type EditionFilter = typeof ALL | EditionKind;
export type NavGroupId = "yours" | "bgm" | "sfx" | "mc";
export type YoursLeaf = "fav" | "voice" | "film";
export type NavPick =
  { group: "yours"; leaf: YoursLeaf } | { group: "bgm" | "sfx" | "mc"; leaf: string };
export type OpenGroups = Record<NavGroupId, boolean>;

export interface NavLeaf {
  id: string;
  title: string;
  count: number;
}

export interface NavSection {
  id: NavGroupId;
  title: string;
  one: string;
  count: number;
  leaves: NavLeaf[];
}

export interface OriginOption {
  id: OriginFilter;
  title: string;
  count: number;
}

export interface EditionOption {
  id: EditionFilter;
  title: string;
  count: number;
}

export interface SourceOption {
  id: string;
  title: string;
  count: number;
}

export interface LibraryGroup<T = LibraryItem> {
  key: string;
  primary: T;
  variants: T[];
}

export const ALL = "all";

export const INITIAL_NAV: NavPick = { group: "sfx", leaf: ALL };
export const INITIAL_OPEN_GROUPS: OpenGroups = {
  yours: false,
  bgm: false,
  sfx: true,
  mc: false,
};

const SOURCE_ORDER = [
  "film",
  "mixkit",
  "pixabay",
  "freesound",
  "incompetech",
  "scott-buckley",
  "punch-deck",
  "free-music-archive",
  "minecraft",
  "vault",
  "earshot",
];

const SOURCE_NAMES: Record<string, string> = {
  film: "This film",
  mixkit: "Mixkit",
  pixabay: "Pixabay",
  freesound: "Freesound",
  incompetech: "Incompetech",
  "scott-buckley": "Scott Buckley",
  "punch-deck": "Punch Deck",
  "free-music-archive": "Free Music Archive",
  minecraft: "Minecraft Vanilla",
  "presence-footsteps": "Presence Footsteps",
  immersivethunder: "ImmersiveThunder",
  "wither-storm": "Wither Storm",
  "auditory-continued": "Auditory",
  "willows-horror": "Willow's Horror",
  "gentler-weather-sounds": "Gentler Weather",
  betterexpsounds: "Better Explosions",
  "alexs-caves": "Alex's Caves",
  "farmers-delight": "Farmer's Delight",
  "security-craft": "SecurityCraft",
  "lightmans-currency": "Lightman's Currency",
  "macaws-doors": "Macaw's Doors",
  "macaws-fences-and-walls": "Macaw's Fences",
  "nhatjs-furniture": "NhatJS Furniture",
  "dawn-of-time": "Dawn of Time",
  ambientsounds: "AmbientSounds",
  extrasounds: "ExtraSounds",
  storagedrawers: "Storage Drawers",
  "quality-sounds": "Quality Sounds",
  charmonium: "Charmonium",
  "particle-rain": "Particle Rain",
  "create-nuclear": "Create Nuclear",
  "world-alive": "World Alive",
  "dusty-decorations": "Dusty Decorations",
  "immersive-aircraft": "Immersive Aircraft",
  "laboratory-blocks": "Laboratory Blocks",
  "horror-sounds": "Horror Sounds",
  "immersive-sound": "Immersive Sound",
  "immersive-weapons": "Immersive Weapons",
  "immersive-weathering": "Immersive Weathering",
  cluttered: "Cluttered",
  "refined-storage": "Refined Storage",
  vault: "Vault",
  earshot: "Earshot",
};

const CATEGORY_TITLES: Record<string, string> = {
  film: "This film",
  other: "Other",
  magic: "Magic & UI",
  boss: "Boss",
  musical: "Musical tones",
  shutter: "Camera shutter",
};

const MC_HEADINGS: Record<string, string> = {
  ambience: "Ambience & weather",
  blocks: "Blocks & mechanisms",
  combat: "Combat & explosions",
  footsteps: "Footsteps",
  horror: "Horror & caves",
  items: "Items & gear",
  machines: "Machines & alarms",
  magic: "Magic, UI & notes",
  mobs: "Mobs & creatures",
  vehicles: "Vehicles & boats",
};

const sentenceSlug = (slug: string) =>
  slug
    .replace(/[-_/]+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

const titleSlug = (slug: string) =>
  slug
    .replace(/[-_/]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const SYNTH_SOURCES = new Set(["earshot"]);

export const sourceOf = (item: Pick<LibraryItem, "source">): string => item.source ?? "film";

export const sourceTitle = (id: string): string => SOURCE_NAMES[id] ?? titleSlug(id);

export const originOf = (item: Pick<LibraryItem, "name" | "source" | "origin">): SoundOrigin => {
  if (item.origin === "real" || item.origin === "synth") return item.origin;
  if (SYNTH_SOURCES.has(sourceOf(item))) return "synth";
  if (/^(?:ear|syn|synth)[-_]/i.test(item.name)) return "synth";
  return "real";
};

export const originTitle = (id: OriginFilter): string =>
  id === "real" ? "Real / Studio" : id === "synth" ? "Code-gen" : "All types";

export const editionOf = (item: Pick<LibraryItem, "source">): EditionKind =>
  sourceOf(item) === "minecraft" ? "vanilla" : "modded";

export const editionTitle = (id: EditionFilter): string =>
  id === "vanilla" ? "Vanilla 26.3" : id === "modded" ? "Modded packs" : "All editions";

export const catOf = (item: Pick<LibraryItem, "category" | "source">): string =>
  item.category ?? (item.source ? "other" : "film");

export const catTitle = (id: string): string => CATEGORY_TITLES[id] ?? sentenceSlug(id);

const formatClockSeconds = (wholeSeconds: number): string => {
  const clamped = Math.max(0, Math.floor(wholeSeconds));
  const mins = Math.floor(clamped / 60);
  const rem = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
};

export const formatSoundDuration = (seconds: number, kind: SoundKind): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.00s";
  if (kind !== "bgm" && Math.round(seconds * 100) < 100) return `${seconds.toFixed(2)}s`;
  return formatClockSeconds(Math.max(1, Math.round(seconds)));
};

export const formatAuditionTime = (
  at: number,
  duration: number,
  kind: SoundKind,
  knownDuration = true,
): string => {
  if (!knownDuration || !Number.isFinite(duration) || duration <= 0) return "00:00 / --:--";
  const clampedAt = Number.isFinite(at) ? Math.max(0, Math.min(at, duration)) : 0;
  if (kind !== "bgm" && Math.round(duration * 100) < 100) {
    return `${clampedAt.toFixed(2)}s / ${duration.toFixed(2)}s`;
  }
  return `${formatClockSeconds(clampedAt)} / ${formatSoundDuration(duration, kind)}`;
};

const splitTitleAndCreator = (
  item: Pick<LibraryItem, "name" | "title">,
): { title: string; creator?: string } => {
  const cached = splitTitleCache.get(item);
  if (cached && cached.name === item.name && cached.title === item.title) return cached.value;
  const raw = item.title?.trim();
  let value: { title: string; creator?: string };
  if (!raw) {
    const cleaned = item.name.replace(/^(?:bgm|sfx)-/i, "");
    value = { title: sentenceSlug(cleaned || item.name) };
  } else {
    const emDash = raw.indexOf(" — ");
    value =
      emDash > 0
        ? {
            title: raw.slice(0, emDash).trim(),
            creator: raw.slice(emDash + 3).trim() || undefined,
          }
        : { title: raw };
  }
  splitTitleCache.set(item, { name: item.name, title: item.title, value });
  return value;
};

export const itemSearchTokens = (x: LibraryItem): readonly string[] => {
  const hit = searchTokensCache.get(x);
  if (
    hit &&
    hit.name === x.name &&
    hit.family === x.family &&
    hit.title === x.title &&
    hit.for === x.for &&
    hit.category === x.category &&
    hit.source === x.source
  ) {
    return hit.tokens;
  }
  const tokens = words(
    `${x.name} ${x.family ?? ""} ${x.title ?? ""} ${x.for ?? ""} ${x.category ?? ""} ${x.source ?? ""} ${sourceTitle(sourceOf(x))}`,
  );
  searchTokensCache.set(x, {
    name: x.name,
    family: x.family,
    title: x.title,
    for: x.for,
    category: x.category,
    source: x.source,
    tokens,
  });
  return tokens;
};

export const warmSearchTokens = (
  items: readonly LibraryItem[],
  startIndex = 0,
  batchSize = 600,
): number => {
  const start = Math.max(0, startIndex);
  const end = Math.min(items.length, start + Math.max(1, batchSize));
  for (let i = start; i < end; i++) {
    itemSearchTokens(items[i]);
  }
  return end;
};

export const displayTitleOf = (item: Pick<LibraryItem, "name" | "title">): string =>
  splitTitleAndCreator(item).title;

export const itemVariantTitle = (item: Pick<LibraryItem, "name" | "title" | "variant">): string => {
  const base = displayTitleOf(item);
  return item.variant !== undefined ? `${base} #${item.variant}` : base;
};

const cardSourceLabel = (id: string): string => (id === "minecraft" ? "Vanilla" : sourceTitle(id));

export const soundCardText = (
  item: Pick<LibraryItem, "name" | "seconds" | "title" | "category" | "source" | "variant">,
  kind: SoundKind,
  opts: { showCategory: boolean; showSource: boolean; showVariant?: boolean },
): { title: string; subtitle: string; duration: string; meta: string } => {
  const { title: baseTitle, creator } = splitTitleAndCreator(item);
  const title =
    opts.showVariant && item.variant !== undefined ? `${baseTitle} #${item.variant}` : baseTitle;
  const duration = formatSoundDuration(item.seconds, kind);
  const subParts: string[] = [];
  if (creator) {
    subParts.push(creator);
    if (opts.showCategory && item.category) subParts.push(catTitle(item.category));
  } else {
    if (opts.showCategory && item.category) subParts.push(catTitle(item.category));
    if (opts.showSource) subParts.push(cardSourceLabel(sourceOf(item)));
  }
  const subtitle = subParts.join(" · ");
  const meta = subtitle ? `${subtitle} · ${duration}` : duration;
  return { title, subtitle, duration, meta };
};

export const CONTENT_ID_NOTE =
  "YouTube Content ID: an upload gets a claim (dispute it with the licence certificate)";

export const soundCardDetail = (
  item: Pick<
    LibraryItem,
    "name" | "title" | "for" | "source" | "license" | "origin" | "variant" | "contentId"
  >,
): string => {
  const originLabel = originTitle(originOf(item));
  const srcLabel = item.license
    ? `${sourceTitle(sourceOf(item))} (${item.license})`
    : sourceTitle(sourceOf(item));
  const fullTitle =
    item.variant !== undefined
      ? `${item.title ?? displayTitleOf(item)} #${item.variant}`
      : (item.title ?? displayTitleOf(item));
  const parts = [
    fullTitle,
    item.for,
    `${originLabel} · ${srcLabel}`,
    item.contentId && CONTENT_ID_NOTE,
    `ID: ${item.name}`,
  ].filter(Boolean);
  return parts.join(" — ");
};

const sourceTier = (item: Pick<LibraryItem, "name" | "source" | "origin" | "kind">): number => {
  const src = sourceOf(item);
  if (src === "film") return originOf(item) === "synth" ? 1 : 0;
  if (originOf(item) === "synth") return 4;
  if ((item.kind === "mc" || item.name.startsWith("mc-")) && src !== "minecraft") return 3;
  return 2;
};

export const compareVariants = (
  a: Pick<LibraryItem, "name" | "variant">,
  b: Pick<LibraryItem, "name" | "variant">,
): number => {
  if (a.variant !== undefined && b.variant !== undefined && a.variant !== b.variant) {
    return a.variant - b.variant;
  }
  return NATURAL_COLLATOR.compare(a.name, b.name);
};

// Separate namespaces: a lone sound may be named exactly like some family's slug
const familyKeyOf = (item: Pick<LibraryItem, "name" | "family">): string =>
  item.family ? `family:${item.family}` : `name:${item.name}`;

const countDistinctFamilies = (items: readonly Pick<LibraryItem, "name" | "family">[]): number => {
  const seen = new Set<string>();
  for (const item of items) seen.add(familyKeyOf(item));
  return seen.size;
};

export const sortLibraryItems = <
  T extends Pick<
    LibraryItem,
    "name" | "title" | "source" | "origin" | "variant" | "kind" | "contentId"
  >,
>(
  items: readonly T[],
): T[] => {
  if (items.length <= 1) return [...items];
  return items
    .map((item) => ({ item, tier: sourceTier(item), title: displayTitleOf(item) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (!a.item.contentId !== !b.item.contentId) return a.item.contentId ? 1 : -1;
      const byTitle = NATURAL_COLLATOR.compare(a.title, b.title);
      return byTitle !== 0 ? byTitle : compareVariants(a.item, b.item);
    })
    .map((d) => d.item);
};

export const groupLibraryFamilies = <T extends Pick<LibraryItem, "name" | "family" | "variant">>(
  items: readonly T[],
): LibraryGroup<T>[] => {
  const byKey = new Map<string, LibraryGroup<T>>();
  const groups: LibraryGroup<T>[] = [];
  for (const item of items) {
    const key = familyKeyOf(item);
    let group = byKey.get(key);
    if (!group) {
      group = { key, primary: item, variants: [item] };
      byKey.set(key, group);
      groups.push(group);
    } else {
      group.variants.push(item);
    }
  }
  for (const group of groups) {
    if (group.variants.length > 1) {
      group.variants.sort(compareVariants);
      group.primary = group.variants[0];
    }
  }
  return groups;
};

export const collapseSwapFamilies = <T extends Pick<LibraryItem, "name" | "family" | "variant">>(
  items: readonly T[],
  selectedName?: string,
): T[] =>
  groupLibraryFamilies(items).map(
    (g) => (selectedName && g.variants.find((v) => v.name === selectedName)) || g.primary,
  );

export const siblingsOf = <T extends Pick<LibraryItem, "name" | "family" | "variant">>(
  allItems: readonly T[],
  current: T | undefined,
): T[] => {
  if (!current) return [];
  if (!current.family) return [current];
  const siblings = allItems.filter((x) => x.family === current.family);
  return siblings.length > 1 ? [...siblings].sort(compareVariants) : [current];
};

const categoryLeaves = (items: readonly LibraryItem[]): NavLeaf[] => {
  const byCat = new Map<string, Set<string>>();
  for (const x of items) {
    if (!x.category) continue;
    let seen = byCat.get(x.category);
    if (!seen) {
      seen = new Set<string>();
      byCat.set(x.category, seen);
    }
    seen.add(familyKeyOf(x));
  }
  return [
    { id: ALL, title: "All", count: countDistinctFamilies(items) },
    ...[...byCat.keys()]
      .sort(SIMPLE_COLLATOR.compare)
      .map((id) => ({ id, title: catTitle(id), count: byCat.get(id)!.size })),
  ];
};

export const buildNavTree = (
  items: readonly LibraryItem[],
  favs: readonly string[],
  kindOf: (item: LibraryItem) => SoundKind,
  voiceCount = 0,
): NavSection[] => {
  const byName = new Map<string, LibraryItem>();
  const filmItems: LibraryItem[] = [];
  const bgm: LibraryItem[] = [];
  const sfx: LibraryItem[] = [];
  const mc: LibraryItem[] = [];
  for (const x of items) {
    byName.set(x.name, x);
    if (sourceOf(x) === "film") filmItems.push(x);
    const k = kindOf(x);
    if (k === "bgm") bgm.push(x);
    else if (k === "mc") mc.push(x);
    else sfx.push(x);
  }
  const validFavs = favs.filter((n) => byName.has(n));
  const favCount = validFavs.length;
  const filmCount = countDistinctFamilies(filmItems);
  const uniqueYoursSounds = new Set([
    ...validFavs.map((n) => familyKeyOf(byName.get(n)!)),
    ...filmItems.map(familyKeyOf),
  ]).size;
  return [
    {
      id: "yours",
      title: "Yours",
      one: "sound",
      count: uniqueYoursSounds + voiceCount,
      leaves: [
        { id: "fav", title: "Favorites", count: favCount },
        { id: "voice", title: "Voiceover", count: voiceCount },
        { id: "film", title: "This film", count: filmCount },
      ],
    },
    {
      id: "bgm",
      title: "Music",
      one: "music track",
      count: countDistinctFamilies(bgm),
      leaves: categoryLeaves(bgm),
    },
    {
      id: "sfx",
      title: "Sound effects",
      one: "sound effect",
      count: countDistinctFamilies(sfx),
      leaves: categoryLeaves(sfx),
    },
    {
      id: "mc",
      title: "Minecraft",
      one: "Minecraft sound",
      count: countDistinctFamilies(mc),
      leaves: categoryLeaves(mc),
    },
  ];
};

export const stepNavHeader = (
  current: NavPick,
  open: OpenGroups,
  clicked: NavGroupId,
  tree: readonly NavSection[],
): { nav: NavPick; open: OpenGroups } => {
  if (current.group === clicked) {
    return { nav: current, open: { ...open, [clicked]: !open[clicked] } };
  }
  const singleOpen: OpenGroups = {
    yours: false,
    bgm: false,
    sfx: false,
    mc: false,
    [clicked]: true,
  };
  const section = tree.find((s) => s.id === clicked);
  if (clicked === "yours") {
    const favCount = section?.leaves.find((l) => l.id === "fav")?.count ?? 0;
    const voiceCount = section?.leaves.find((l) => l.id === "voice")?.count ?? 0;
    const filmCount = section?.leaves.find((l) => l.id === "film")?.count ?? 0;
    const leaf: YoursLeaf =
      favCount > 0 ? "fav" : voiceCount > 0 ? "voice" : filmCount > 0 ? "film" : "fav";
    return { nav: { group: "yours", leaf }, open: singleOpen };
  }
  return { nav: { group: clicked, leaf: ALL }, open: singleOpen };
};

export const originOptions = (items: readonly LibraryItem[]): OriginOption[] => {
  if (!items.length) return [];
  const real = new Set<string>();
  const synth = new Set<string>();
  for (const x of items) {
    if (originOf(x) === "synth") synth.add(familyKeyOf(x));
    else real.add(familyKeyOf(x));
  }
  return [
    { id: ALL, title: originTitle(ALL), count: countDistinctFamilies(items) },
    { id: "real", title: originTitle("real"), count: real.size },
    { id: "synth", title: originTitle("synth"), count: synth.size },
  ];
};

export const editionOptions = (items: readonly LibraryItem[]): EditionOption[] => {
  if (!items.length) return [];
  const vanilla = new Set<string>();
  const modded = new Set<string>();
  for (const x of items) {
    if (editionOf(x) === "vanilla") vanilla.add(familyKeyOf(x));
    else modded.add(familyKeyOf(x));
  }
  return [
    { id: ALL, title: editionTitle(ALL), count: countDistinctFamilies(items) },
    { id: "vanilla", title: editionTitle("vanilla"), count: vanilla.size },
    { id: "modded", title: editionTitle("modded"), count: modded.size },
  ];
};

export const sourceOptions = (
  items: readonly LibraryItem[],
  activeSource = ALL,
): SourceOption[] => {
  const bySource = new Map<string, Set<string>>();
  for (const x of items) {
    const s = sourceOf(x);
    let seen = bySource.get(s);
    if (!seen) {
      seen = new Set<string>();
      bySource.set(s, seen);
    }
    seen.add(familyKeyOf(x));
  }
  if (activeSource !== ALL && !bySource.has(activeSource)) {
    bySource.set(activeSource, new Set());
  }
  if (bySource.size <= 1 && activeSource === ALL) return [];
  return [
    { id: ALL, title: "All sources", count: countDistinctFamilies(items) },
    ...[...bySource.keys()]
      .sort((a, b) => {
        const ia = SOURCE_ORDER.indexOf(a);
        const ib = SOURCE_ORDER.indexOf(b);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        const byCount = (bySource.get(b)?.size ?? 0) - (bySource.get(a)?.size ?? 0);
        return byCount !== 0 ? byCount : SIMPLE_COLLATOR.compare(a, b);
      })
      .map((id) => ({ id, title: sourceTitle(id), count: bySource.get(id)!.size })),
  ];
};

export const searchPlaceholder = (nav: NavPick): string => {
  if (nav.group === "bgm") return "Search music";
  if (nav.group === "sfx") return "Search sound effects";
  if (nav.group === "mc") return "Search Minecraft";
  if (nav.leaf === "voice") return "Search voiceover & script";
  return nav.leaf === "fav" ? "Search favorites" : "Search film sounds";
};

export const categoryHeading = (nav: NavPick): string => {
  if (nav.group === "yours") {
    return nav.leaf === "fav" ? "Favorites" : nav.leaf === "voice" ? "Voiceover" : "This film";
  }
  if (nav.group === "mc") {
    return nav.leaf === ALL ? "All Minecraft" : (MC_HEADINGS[nav.leaf] ?? catTitle(nav.leaf));
  }
  if (nav.leaf === ALL) return nav.group === "bgm" ? "All music" : "All sound effects";
  return catTitle(nav.leaf);
};

export const filterAndSortLibrary = ({
  items,
  favs,
  nav,
  origin = ALL,
  edition = ALL,
  source,
  query,
  kindOf,
  narrationName = null,
  voiceCount = 0,
}: {
  items: readonly LibraryItem[];
  favs: readonly string[];
  nav: NavPick;
  origin?: OriginFilter;
  edition?: EditionFilter;
  source: string;
  query: string;
  kindOf: (item: LibraryItem) => SoundKind;
  narrationName?: string | null;
  voiceCount?: number;
}) => {
  const want = words(query);
  const soundItems = narrationName ? items.filter((x) => x.name !== narrationName) : items;
  const matched = !want.length
    ? soundItems
    : soundItems.filter((x) => {
        const have = itemSearchTokens(x);
        return want.every((w) => have.some((h) => h.startsWith(w)));
      });
  const tree = buildNavTree(matched, favs, kindOf, voiceCount);

  // Resolve valid leaf (if current category has 0 items under active query/library, fall back to "all" for bgm/sfx/mc)
  const section = tree.find((s) => s.id === nav.group)!;
  const validLeaf =
    nav.group === "yours" || section.leaves.some((l) => l.id === nav.leaf) ? nav.leaf : ALL;
  const activeNav: NavPick = nav.group === "yours" ? nav : { group: nav.group, leaf: validLeaf };

  let scoped: LibraryItem[];
  if (activeNav.group === "yours") {
    if (activeNav.leaf === "voice") {
      scoped = [];
    } else if (activeNav.leaf === "fav") {
      const matchedByName = new Map(matched.map((x) => [x.name, x]));
      scoped = [...favs]
        .reverse()
        .map((name) => matchedByName.get(name))
        .filter((x): x is LibraryItem => x !== undefined);
    } else {
      scoped = matched.filter((x) => sourceOf(x) === "film");
    }
  } else {
    const byKind = matched.filter((x) => kindOf(x) === activeNav.group);
    scoped = activeNav.leaf === ALL ? byKind : byKind.filter((x) => x.category === activeNav.leaf);
  }

  const isMc = activeNav.group === "mc";
  const activeOrigin: OriginFilter =
    !isMc && (origin === "real" || origin === "synth") ? origin : ALL;
  const origins: OriginOption[] = isMc
    ? []
    : scoped.length
      ? originOptions(scoped)
      : activeOrigin !== ALL
        ? [
            { id: ALL, title: originTitle(ALL), count: 0 },
            { id: "real", title: originTitle("real"), count: 0 },
            { id: "synth", title: originTitle("synth"), count: 0 },
          ]
        : [];
  const activeEdition: EditionFilter =
    isMc && (edition === "vanilla" || edition === "modded") ? edition : ALL;
  const editions: EditionOption[] = !isMc
    ? []
    : scoped.length
      ? editionOptions(scoped)
      : activeEdition !== ALL
        ? [
            { id: ALL, title: editionTitle(ALL), count: 0 },
            { id: "vanilla", title: editionTitle("vanilla"), count: 0 },
            { id: "modded", title: editionTitle("modded"), count: 0 },
          ]
        : [];

  const byFirstFilter = isMc
    ? activeEdition === ALL
      ? scoped
      : scoped.filter((x) => editionOf(x) === activeEdition)
    : activeOrigin === ALL
      ? scoped
      : scoped.filter((x) => originOf(x) === activeOrigin);
  const noSourceFilter =
    activeNav.group === "yours" && (activeNav.leaf === "film" || activeNav.leaf === "voice");
  const activeSource = noSourceFilter || !source || source === ALL ? ALL : source;
  const sources = noSourceFilter ? [] : sourceOptions(byFirstFilter, activeSource);
  const bySource =
    activeSource === ALL
      ? byFirstFilter
      : byFirstFilter.filter((x) => sourceOf(x) === activeSource);
  const keepOrder = activeNav.group === "yours" && activeNav.leaf === "fav";
  const shown = keepOrder ? bySource : sortLibraryItems(bySource);

  const elsewhere = tree.filter((s) => s.id !== activeNav.group && s.count > 0);
  return {
    tree,
    activeNav,
    origins,
    activeOrigin,
    editions,
    activeEdition,
    sources,
    activeSource,
    shown,
    elsewhere,
  };
};
