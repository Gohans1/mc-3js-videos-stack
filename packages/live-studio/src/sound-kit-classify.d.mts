export type KitCategoryId =
  "bgm" | "whoosh" | "pop-ui" | "impact" | "riser" | "ambience" | "foley-core" | "comedy-glitch";
export type KitStatus = "inbox" | "core" | "pass" | "ban";

export interface KitCategoryMeta {
  id: KitCategoryId;
  title: string;
  hint: string;
  suggestedTags: string[];
}

export interface ClassifiableSound {
  name: string;
  title?: string;
  for?: string;
  kind?: string;
  category?: string;
  role?: string;
  seconds?: number;
  source?: string;
  family?: string;
}

export declare const KIT_CATEGORIES: readonly KitCategoryMeta[];
export declare const KIT_CATEGORY_IDS: readonly KitCategoryId[];
export declare const KIT_STATUSES: readonly KitStatus[];
export declare const TASTE_REASONS: readonly string[];
export declare const SOUND_ID_RE: RegExp;
export declare function isSafeSoundId(value: unknown): value is string;
export declare function soundMetaText(item: ClassifiableSound): string;
export declare function classifyPopularSound(item: ClassifiableSound): KitCategoryId | null;
