// How the Sound panel groups the vault: category headings, Real / Studio vs Code-gen, Vanilla vs Modded. Imports nothing, so
// bun run find (scripts/find.ts) groups and filters the vault exactly as the panel does
export type SoundOrigin = "real" | "synth";
export type EditionKind = "vanilla" | "modded";

const CATEGORY_TITLES: Record<string, string> = {
  film: "This film",
  other: "Other",
  magic: "Magic & UI",
  boss: "Boss",
  musical: "Jingles & tones",
  shutter: "Camera shutter",
  "sci-fi": "Sci-fi & lasers",
  game: "Game & arcade",
  comedy: "Comedy & memes",
};

export const MC_HEADINGS: Record<string, string> = {
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

export const ORIGIN_TITLES: Record<SoundOrigin, string> = {
  real: "Real / Studio",
  synth: "Code-gen",
};
export const EDITION_TITLES: Record<EditionKind, string> = {
  vanilla: "Vanilla 26.3",
  modded: "Modded packs",
};

export const sentenceSlug = (slug: string) =>
  slug
    .replace(/[-_/]+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

export const catTitle = (id: string): string => CATEGORY_TITLES[id] ?? sentenceSlug(id);

const SYNTH_SOURCES = new Set(["earshot"]);

export const sourceOf = (item: { source?: string }): string => item.source ?? "film";

export const originOf = (item: { name: string; source?: string; origin?: string }): SoundOrigin => {
  if (item.origin === "real" || item.origin === "synth") return item.origin;
  if (SYNTH_SOURCES.has(sourceOf(item))) return "synth";
  if (/^(?:ear|syn|synth)[-_]/i.test(item.name)) return "synth";
  return "real";
};

export const editionOf = (item: { source?: string }): EditionKind =>
  sourceOf(item) === "minecraft" ? "vanilla" : "modded";
