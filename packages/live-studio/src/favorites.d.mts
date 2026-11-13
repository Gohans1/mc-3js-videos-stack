import type * as z from "zod";

export type Favorites = { sounds: string[]; effects: string[] };
export type FavoriteKind = keyof Favorites;
export declare const FAVORITES_DIR: string;
export declare const FAVORITES: string;
export declare const LIST_NAME: RegExp;
export declare const FavoriteChange: z.ZodType<{ kind: FavoriteKind; id: string; on: boolean }>;
export type FavoriteFile = {
  file: string;
  read: () => Favorites;
  shown: () => Favorites;
  set: (change: { kind: FavoriteKind; id: string; on: boolean }) => Favorites;
};
export declare const openFavorites: (file?: string) => FavoriteFile;
export declare const favoriteLists: (dir?: string) => {
  dir: string;
  lists: () => { name: string; count: number }[];
  open: (name?: string) => FavoriteFile;
};
