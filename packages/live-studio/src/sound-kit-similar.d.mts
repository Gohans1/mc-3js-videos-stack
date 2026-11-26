import type { KitCategoryId, SoundKitState } from "./sound-kit.mjs";

export interface ClassifiableSound {
  name: string;
  kind?: string;
  category?: string;
  title?: string;
  for?: string;
  role?: string;
  seconds?: number;
  source?: string;
  family?: string;
}

export interface SimilarSoundHit {
  name: string;
  title: string;
  category: string;
  kitCategory: KitCategoryId | null;
  kind: string;
  seconds: number;
  source: string;
  score: number;
}

export interface SimilarSoundResult {
  target: string;
  mode: "vector" | "metadata";
  hits: SimilarSoundHit[];
}

export interface RecommendedSound {
  id: string;
  category: KitCategoryId;
  title: string;
  seconds: number;
  source: string;
  tags: string[];
  note: string;
  tier: 0 | 1;
  elo: number;
  wins: number;
  losses: number;
  picks: number;
  score: number;
  why: string[];
}

export interface RecommendResult {
  category: KitCategoryId | null;
  query: string;
  mode: "empty" | "preference-mmr" | "hybrid-vector-mmr";
  totalCore: number;
  picks: RecommendedSound[];
}

export declare function classifyPopularSound(item: ClassifiableSound): KitCategoryId | null;
export declare function findSimilarSounds(
  targetName: string,
  library: readonly ClassifiableSound[],
  options?: {
    limit?: number;
    semanticDb?: string;
    bannedIds?: ReadonlySet<string>;
    excludeIds?: ReadonlySet<string>;
  },
): SimilarSoundResult;
export declare function recommendCoreSounds(
  kitState: SoundKitState,
  library: readonly ClassifiableSound[],
  options?: {
    query?: string;
    category?: KitCategoryId | null;
    topN?: number;
    durMin?: number;
    durMax?: number;
    refSound?: string;
    recentIds?: readonly string[];
    semanticDb?: string;
  },
): RecommendResult;
