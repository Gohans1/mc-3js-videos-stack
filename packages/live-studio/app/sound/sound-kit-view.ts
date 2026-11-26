import {
  classifyPopularSound,
  isSafeSoundId,
  KIT_CATEGORIES,
  KIT_CATEGORY_IDS,
  type KitCategoryId,
  type KitStatus,
  soundMetaText,
} from "../../src/sound-kit-classify.mjs";
import type { KitItem, SoundKitState } from "../../src/sound-kit.d.mts";
import {
  cleanAudioTitle,
  compareVariants,
  formatSoundDuration,
  originOf,
  sourceOf,
  sourceTitle,
} from "./library-view";
import type { LibraryItem } from "./sound";

export type KitViewTab = "inbox" | "core" | "popular" | "ban";
export type KitCategoryFilter = "all" | KitCategoryId;
export type PopularPoolScope = "curated" | "all";

export interface PopularPoolOptions {
  scope?: PopularPoolScope;
  includeSynth?: boolean;
  includeMc?: boolean;
  narrationName?: string | null;
}

export interface KitRow {
  id: string;
  title: string;
  category: KitCategoryId;
  status: KitStatus | null;
  item: KitItem | null;
  libraryItem: LibraryItem | null;
  missingFromLibrary: boolean;
  seconds: number;
  durationLabel: string;
  sourceLabel: string;
  kind: "bgm" | "sfx" | "mc";
  variantCount: number;
  variantIds: readonly string[];
  abIndex: number;
  tags: readonly string[];
  note: string;
  tier: 0 | 1;
  elo: number;
  wins: number;
  losses: number;
  picks: number;
}

export interface KitCategoryCounts {
  totals: { inbox: number; core: number; pass: number; ban: number; popular: number };
  byCategory: Record<
    KitCategoryId,
    { inbox: number; core: number; pass: number; ban: number; popular: number }
  >;
}

const ownItem = (items: Readonly<Record<string, KitItem>>, id: string): KitItem | undefined =>
  Object.hasOwn(items, id) ? items[id] : undefined;

const BULK_SOURCES = new Set(["openfilm", "sonniss"]);

const POPULAR_NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const isBulkPopularSource = (item: Pick<LibraryItem, "source">): boolean =>
  BULK_SOURCES.has(sourceOf(item));

const popularSourceTier = (item: LibraryItem): number => {
  if (originOf(item) === "synth") return 6;
  const src = sourceOf(item);
  if (src === "film") return 0;
  if (item.kind === "mc") return 5;
  if (src === "openfilm") return 4;
  if (src === "sonniss") return 3;
  if (src === "kenney") return 2;
  return 1;
};

const queryWords = (raw: string): string[] => raw.trim().toLowerCase().split(/\s+/).filter(Boolean);

const matchesQuery = (
  id: string,
  lib: LibraryItem | null,
  kit: KitItem | null,
  words: readonly string[],
): boolean => {
  if (!words.length) return true;
  const hay = [
    id,
    lib ? soundMetaText(lib) : "",
    lib?.source ?? "",
    kit?.category ?? "",
    kit?.tags.join(" ") ?? "",
    kit?.note ?? "",
  ]
    .join(" ")
    .replaceAll("_", " ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
};

export interface PopularPoolEntry {
  item: LibraryItem;
  category: KitCategoryId;
  variantCount: number;
  variantIds: readonly string[];
}

export const buildPopularPool = (
  library: readonly LibraryItem[],
  kitState: SoundKitState,
  opts: PopularPoolOptions = {},
): PopularPoolEntry[] => {
  const scope: PopularPoolScope = opts.scope ?? "curated";
  const includeSynth = opts.includeSynth ?? false;
  const includeMc = opts.includeMc ?? false;
  const narrationName = opts.narrationName ?? null;
  const byFamily = new Map<string, { items: LibraryItem[]; category: KitCategoryId }>();
  const order: string[] = [];
  for (const item of library) {
    if (item.name === narrationName) continue;
    const kit = ownItem(kitState.items, item.name);
    if (kit?.status === "ban") continue;
    if (!includeMc && item.kind === "mc" && !kit) continue;
    if (!includeSynth && originOf(item) === "synth" && !kit) continue;
    if (scope === "curated" && isBulkPopularSource(item) && !kit) continue;
    const category = kit?.category ?? classifyPopularSound(item);
    if (!category) continue;
    const famKey = item.family ? `fam:${item.family}` : `id:${item.name}`;
    let bucket = byFamily.get(famKey);
    if (!bucket) {
      bucket = { items: [], category };
      byFamily.set(famKey, bucket);
      order.push(famKey);
    }
    bucket.items.push(item);
  }
  const out: PopularPoolEntry[] = [];
  for (const key of order) {
    const bucket = byFamily.get(key)!;
    bucket.items.sort(compareVariants);
    const preferred =
      bucket.items.find((x) => ownItem(kitState.items, x.name)?.status === "core") ??
      bucket.items.find((x) => ownItem(kitState.items, x.name)?.status === "inbox") ??
      bucket.items.find((x) => ownItem(kitState.items, x.name)?.status === "pass") ??
      bucket.items[0]!;
    const prefKit = ownItem(kitState.items, preferred.name);
    out.push({
      item: preferred,
      category: prefKit?.category ?? bucket.category,
      variantCount: bucket.items.length,
      variantIds: bucket.items.map((x) => x.name),
    });
  }
  return out;
};

const toRow = (
  id: string,
  category: KitCategoryId,
  kit: KitItem | null,
  lib: LibraryItem | null,
  abIndexMap: ReadonlyMap<string, number>,
  variantCount: number,
  variantIds: readonly string[] = [id],
): KitRow => {
  const kind: "bgm" | "sfx" | "mc" = lib?.kind ?? (category === "bgm" ? "bgm" : "sfx");
  const seconds = Number(lib?.seconds ?? 0);
  const rawTitle = lib?.title?.trim() || id;
  const title = cleanAudioTitle(rawTitle, { mc: kind === "mc" });
  return {
    id,
    title,
    category,
    status: kit?.status ?? null,
    item: kit,
    libraryItem: lib,
    missingFromLibrary: !lib,
    seconds,
    durationLabel: seconds > 0 ? formatSoundDuration(seconds, kind) : "—",
    sourceLabel: lib ? sourceTitle(sourceOf(lib)) : "Not in film library",
    kind,
    variantCount,
    variantIds: variantIds.includes(id) ? variantIds : [id, ...variantIds],
    abIndex: abIndexMap.get(id) ?? -1,
    tags: kit?.tags ?? [],
    note: kit?.note ?? "",
    tier: kit?.tier ?? 0,
    elo: kit?.elo ?? 1500,
    wins: kit?.wins ?? 0,
    losses: kit?.losses ?? 0,
    picks: kit?.picks ?? 0,
  };
};

export const buildKitRows = ({
  library,
  kitState,
  tab,
  category,
  query,
  tag,
  poolScope = "curated",
  includeSynth = false,
  includeMc,
  narrationName,
  popularPool,
}: {
  library: readonly LibraryItem[];
  kitState: SoundKitState;
  tab: KitViewTab;
  category: KitCategoryFilter;
  query: string;
  tag: string;
  poolScope?: PopularPoolScope;
  includeSynth?: boolean;
  includeMc: boolean;
  narrationName: string | null;
  popularPool?: readonly PopularPoolEntry[];
}): KitRow[] => {
  const words = queryWords(query);
  const wantTag = tag.trim().toLowerCase();
  const abIndexMap = new Map<string, number>();
  kitState.abSlots.forEach((slotId, idx) => abIndexMap.set(slotId, idx));

  if (tab === "popular") {
    const entries =
      popularPool ??
      buildPopularPool(library, kitState, {
        scope: poolScope,
        includeSynth,
        includeMc,
        narrationName,
      });
    const rows: KitRow[] = [];
    const wantTagPhrase = wantTag.replaceAll("-", " ");
    for (const entry of entries) {
      if (category !== "all" && entry.category !== category) continue;
      const kit = ownItem(kitState.items, entry.item.name) ?? null;
      if (wantTag) {
        const meta = soundMetaText(entry.item);
        const tagMatch =
          kit?.tags.includes(wantTag) ||
          meta.includes(wantTag) ||
          (wantTagPhrase !== wantTag && meta.includes(wantTagPhrase));
        if (!tagMatch) continue;
      }
      if (!matchesQuery(entry.item.name, entry.item, kit, words)) continue;
      rows.push(
        toRow(
          entry.item.name,
          entry.category,
          kit,
          entry.item,
          abIndexMap,
          entry.variantCount,
          entry.variantIds,
        ),
      );
    }
    rows.sort((a, b) => {
      const aPass = a.status === "pass" ? 1 : 0;
      const bPass = b.status === "pass" ? 1 : 0;
      if (aPass !== bPass) return aPass - bPass;
      if (aPass === 1) {
        return (
          (a.item?.updatedAt ?? "").localeCompare(b.item?.updatedAt ?? "") ||
          a.id.localeCompare(b.id)
        );
      }
      const aTier = a.libraryItem ? popularSourceTier(a.libraryItem) : 7;
      const bTier = b.libraryItem ? popularSourceTier(b.libraryItem) : 7;
      if (aTier !== bTier) return aTier - bTier;
      return POPULAR_NATURAL_COLLATOR.compare(a.title, b.title) || a.id.localeCompare(b.id);
    });
    return rows;
  }

  const libByName = new Map(library.map((x) => [x.name, x]));
  const familyMembers = new Map<string, string[]>();
  for (const x of library) {
    if (!x.family) continue;
    const list = familyMembers.get(x.family);
    if (list) list.push(x.name);
    else familyMembers.set(x.family, [x.name]);
  }
  const tabMatchedItems = Object.values(kitState.items).filter((kit) =>
    tab === "inbox" ? kit.status === "inbox" || kit.status === "pass" : kit.status === tab,
  );
  const inSameTab = new Set(tabMatchedItems.map((kit) => kit.id));
  const rows: KitRow[] = [];
  for (const kit of tabMatchedItems) {
    if (category !== "all" && kit.category !== category) continue;
    const lib = libByName.get(kit.id) ?? null;
    if (wantTag && !kit.tags.includes(wantTag)) continue;
    if (!matchesQuery(kit.id, lib, kit, words)) continue;
    const members = lib?.family ? (familyMembers.get(lib.family) ?? [kit.id]) : [kit.id];
    const variantIds = [kit.id, ...members.filter((m) => m !== kit.id && !inSameTab.has(m))];
    rows.push(toRow(kit.id, kit.category, kit, lib, abIndexMap, members.length, variantIds));
  }

  if (tab === "core") {
    rows.sort(
      (a, b) => b.tier - a.tier || b.elo - a.elo || b.picks - a.picks || a.id.localeCompare(b.id),
    );
  } else if (tab === "inbox") {
    rows.sort((a, b) => {
      const aPass = a.status === "pass" ? 1 : 0;
      const bPass = b.status === "pass" ? 1 : 0;
      if (aPass !== bPass) return aPass - bPass;
      if (aPass === 1) {
        return (
          (a.item?.updatedAt ?? "").localeCompare(b.item?.updatedAt ?? "") ||
          a.id.localeCompare(b.id)
        );
      }
      return (
        (b.item?.updatedAt ?? "").localeCompare(a.item?.updatedAt ?? "") || a.id.localeCompare(b.id)
      );
    });
  } else {
    rows.sort(
      (a, b) =>
        (b.item?.updatedAt ?? "").localeCompare(a.item?.updatedAt ?? "") ||
        a.id.localeCompare(b.id),
    );
  }
  return rows;
};

export const computeCategoryCounts = (
  library: readonly LibraryItem[],
  kitState: SoundKitState,
  opts: PopularPoolOptions = {},
  popularPool?: readonly PopularPoolEntry[],
): KitCategoryCounts => {
  const byCategory = Object.fromEntries(
    KIT_CATEGORY_IDS.map((id) => [id, { inbox: 0, core: 0, pass: 0, ban: 0, popular: 0 }]),
  ) as KitCategoryCounts["byCategory"];
  const totals = { inbox: 0, core: 0, pass: 0, ban: 0, popular: 0 };

  for (const item of Object.values(kitState.items)) {
    const bucket = byCategory[item.category];
    if (!bucket) continue;
    bucket[item.status] += 1;
    totals[item.status] += 1;
  }
  for (const entry of popularPool ?? buildPopularPool(library, kitState, opts)) {
    const bucket = byCategory[entry.category];
    if (!bucket) continue;
    bucket.popular += 1;
    totals.popular += 1;
  }
  return { totals, byCategory };
};

export const nextFocusAfterTriage = (
  rows: readonly { id: string }[],
  currentId: string | null,
): string | null => {
  if (!rows.length || !currentId) return rows[0]?.id ?? null;
  const idx = rows.findIndex((r) => r.id === currentId);
  if (idx < 0) return rows[0]?.id ?? null;
  if (idx + 1 < rows.length) return rows[idx + 1]!.id;
  if (idx - 1 >= 0) return rows[idx - 1]!.id;
  return null;
};

export const toggleAbSlot = (currentSlots: readonly string[], id: string): string[] => {
  if (!isSafeSoundId(id)) return [...currentSlots];
  const existingIdx = currentSlots.indexOf(id);
  if (existingIdx >= 0) {
    return currentSlots.filter((s) => s !== id);
  }
  if (currentSlots.length < 4) {
    return [...currentSlots, id];
  }
  return [...currentSlots.slice(0, 3), id];
};

export const stepFocusIndex = (currentIdx: number, delta: -1 | 1, length: number): number => {
  if (length <= 0) return -1;
  if (currentIdx < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, currentIdx + delta));
};

export const inferClipKitCategory = (
  clipName: string,
  list: "beds" | "sfx",
  libraryItem: LibraryItem | undefined,
  kitState: SoundKitState,
): KitCategoryId | null => {
  const tracked = ownItem(kitState.items, clipName);
  if (tracked) return tracked.category;
  if (libraryItem) {
    const classified = classifyPopularSound(libraryItem);
    if (classified) return classified;
  }
  if (list === "beds") return "bgm";
  return null;
};

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => ElementLike | null;
  hasAttribute?: (name: string) => boolean;
  getAttribute?: (name: string) => string | null;
}

export const resolveKitTargetRowId = (target: EventTarget | ElementLike | null): string | null => {
  if (!target || typeof target !== "object") return null;
  const el = target as ElementLike;
  const direct = el.getAttribute?.("data-kit-row");
  if (direct) return direct;
  if (typeof el.closest === "function") {
    return el.closest("[data-kit-row]")?.getAttribute?.("data-kit-row") ?? null;
  }
  return null;
};

const INTERACTIVE_SELECTOR =
  'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="menuitem"]';

export const isInteractiveControlTarget = (target: EventTarget | ElementLike | null): boolean => {
  if (!target || typeof target !== "object") return false;
  const el = target as ElementLike;
  const tag = String(el.tagName ?? "").toUpperCase();
  if (tag === "BUTTON" || tag === "A") return true;
  if (typeof el.closest === "function" && el.closest(INTERACTIVE_SELECTOR)) return true;
  return false;
};

export const isKitRowFocusTarget = (target: EventTarget | ElementLike | null): boolean => {
  if (!target || typeof target !== "object") return false;
  const el = target as ElementLike;
  if (el.hasAttribute?.("data-kit-row-focus")) return true;
  if (typeof el.closest === "function" && el.closest("[data-kit-row-focus]")) return true;
  return false;
};

export const isKitHotkeyBlockedTarget = (target: EventTarget | ElementLike | null): boolean => {
  if (!target || typeof target !== "object") return false;
  const el = target as ElementLike;
  const tag = String(el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function") {
    if (el.closest('[role="alertdialog"], [role="menu"]')) return true;
    const dialog = el.closest('[role="dialog"]');
    if (dialog && !dialog.hasAttribute?.("data-sound-kit-dialog")) return true;
  }
  return false;
};

export const shouldInterceptKitKey = (
  target: EventTarget | ElementLike | null,
  key: string,
): boolean => {
  if (isKitHotkeyBlockedTarget(target)) return false;
  if (key === "Enter") return false;
  if (key === " ") {
    if (isKitRowFocusTarget(target)) return true;
    return !isInteractiveControlTarget(target);
  }
  return true;
};

export const isSoundKitModalFallbackTarget = (
  target: EventTarget | ElementLike | null,
): boolean => {
  const el = target as ElementLike | null;
  if (!el || typeof el.closest !== "function") return true;
  return !el.closest(
    "[data-sound-kit], input, textarea, [contenteditable='true'], [contenteditable='']",
  );
};

const CATEGORY_NOTE_PLACEHOLDERS: Record<KitCategoryId, string> = {
  bgm: "e.g. upbeat loop, clean under voice…",
  whoosh: "e.g. tight whip, no harsh tail…",
  "pop-ui": "e.g. crisp pop for callout badge…",
  impact: "e.g. punchy low thud for title slam…",
  riser: "e.g. clean 2s tension swell…",
  ambience: "e.g. soft room tone, low noise floor…",
  "foley-core": "e.g. dry wooden tap, crisp transient…",
  "comedy-glitch": "e.g. snappy boing for visual gag…",
};

export const notePlaceholderForCategory = (category: KitCategoryId): string =>
  CATEGORY_NOTE_PLACEHOLDERS[category] ?? "e.g. short taste note…";

export const suggestedTagsForCategory = (category: KitCategoryFilter): readonly string[] => {
  if (category === "all") return [];
  return KIT_CATEGORIES.find((c) => c.id === category)?.suggestedTags ?? [];
};
