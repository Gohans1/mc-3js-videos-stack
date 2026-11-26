import type * as z from "zod";

export type KitCategoryId =
  "bgm" | "whoosh" | "pop-ui" | "impact" | "riser" | "ambience" | "foley-core" | "comedy-glitch";
export type KitStatus = "inbox" | "core" | "pass" | "ban";
export type KitActor = "human" | "ai";

export interface KitCategoryMeta {
  id: KitCategoryId;
  title: string;
  hint: string;
  suggestedTags: string[];
}

export interface KitItem {
  id: string;
  category: KitCategoryId;
  status: KitStatus;
  tags: string[];
  note: string;
  addedBy: KitActor;
  tier: 0 | 1;
  elo: number;
  wins: number;
  losses: number;
  picks: number;
  lastUsedAt: string | null;
  updatedAt: string;
}

export interface KitItemInput {
  id: string;
  category: KitCategoryId;
  status?: KitStatus;
  tags?: string[];
  note?: string;
  tier?: 0 | 1;
  addedBy?: KitActor;
}

export type KitItemParsed = KitItemInput;

export interface KitDecision {
  winner: string;
  rejected: string[];
  category: KitCategoryId;
  reason: string;
  context: string;
  at: string;
}

export interface SoundKitState {
  version: 1;
  items: Record<string, KitItem>;
  abSlots: string[];
  decisions: KitDecision[];
}

export interface SoundKitSummary {
  totals: { inbox: number; core: number; pass: number; ban: number; total: number };
  byCategory: Record<
    KitCategoryId,
    { inbox: number; core: number; pass: number; ban: number; total: number }
  >;
  abCount: number;
  decisionCount: number;
}

export interface KitAbResolveInput {
  winner: string;
  rejected?: string[];
  category: KitCategoryId;
  reason?: string;
  context?: string;
  banRejected?: boolean;
  clearTray?: boolean;
}

export interface KitUseInput {
  id: string;
  category?: KitCategoryId;
  rejected?: string[];
  reason?: string;
  context?: string;
}

export interface KitRestoreInput {
  items?: Record<string, KitItem | null>;
  abSlots?: string[];
  decisions?: KitDecision[];
}

export interface SoundKitStore {
  file: string;
  read(): SoundKitState;
  shown(): SoundKitState;
  shownWithWarning(): { state: SoundKitState; warning: string | null };
  setItem(input: KitItemInput): SoundKitState;
  batchSet(
    items: KitItemInput[],
    opts?: { skipExisting?: boolean },
  ): { state: SoundKitState; added: number; updated: number; skipped: number };
  removeItem(id: string): SoundKitState;
  removeItems(ids: readonly string[]): SoundKitState;
  setAb(slots: string[]): SoundKitState;
  resolveAb(input: KitAbResolveInput): SoundKitState;
  updateAb(payload: { slots?: string[]; resolve?: KitAbResolveInput }): SoundKitState;
  recordUse(input: KitUseInput): SoundKitState;
  restoreSnapshot(input: KitRestoreInput): SoundKitState;
  watch(onChange: () => void): () => void;
}

export declare class SoundKitCorruptError extends Error {}
export declare const SOUND_KIT_DIR: string;
export declare const SOUND_KIT_FILE: string;
export declare const SOUND_ID_RE: RegExp;
export declare function isSafeSoundId(value: unknown): value is string;
export declare const KIT_CATEGORIES: readonly KitCategoryMeta[];
export declare const KIT_CATEGORY_IDS: readonly KitCategoryId[];
export declare const KIT_STATUSES: readonly KitStatus[];
export declare const TASTE_REASONS: readonly string[];
export declare const KitCategorySchema: z.ZodType<KitCategoryId>;
export declare const KitStatusSchema: z.ZodType<KitStatus>;
export declare const KitActorSchema: z.ZodType<KitActor>;
export declare const KitItemSchema: z.ZodType<KitItem>;
export declare const KitItemInputSchema: z.ZodType<KitItemParsed, KitItemInput>;
export declare const KitBatchInputSchema: z.ZodType<
  { items: KitItemParsed[]; skipExisting: boolean },
  { items: KitItemInput[]; skipExisting?: boolean }
>;
export declare const KitDecisionSchema: z.ZodType<KitDecision>;
export declare const KitAbResolveSchema: z.ZodType<
  {
    winner: string;
    rejected: string[];
    category: KitCategoryId;
    reason: string;
    context: string;
    banRejected: boolean;
    clearTray: boolean;
  },
  KitAbResolveInput
>;
export declare const KitAbInputSchema: z.ZodType<
  {
    slots?: string[];
    resolve?: {
      winner: string;
      rejected: string[];
      category: KitCategoryId;
      reason: string;
      context: string;
      banRejected: boolean;
      clearTray: boolean;
    };
  },
  { slots?: string[]; resolve?: KitAbResolveInput }
>;
export declare const KitUseInputSchema: z.ZodType<
  {
    id: string;
    category?: KitCategoryId;
    rejected: string[];
    reason: string;
    context: string;
  },
  KitUseInput
>;
export declare const KitRestoreInputSchema: z.ZodType<
  {
    items: Record<string, KitItem | null>;
    abSlots?: string[];
    decisions?: KitDecision[];
  },
  KitRestoreInput
>;
export declare function summarizeSoundKit(state: SoundKitState): SoundKitSummary;
export declare function openSoundKit(file?: string): SoundKitStore;
