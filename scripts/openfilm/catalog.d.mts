import type { Entry } from "../find";

export type CatalogItem = {
  id: string;
  cat: string;
  kind: string;
  name: { en: string };
  [key: string]: unknown;
};
export const PIN: string;
export const HOST: string;
export const ARCHIVE_SHA256: string;
export const LICENCE_URL: string;
export function safePath(root: string, path: string): string;
export function readCatalog(root: string): CatalogItem[];
export function audioEntry(item: CatalogItem): Record<string, unknown>;
export function assetEntries(items: CatalogItem[], root: string): Entry[];
export function writeAssetCatalog(items: CatalogItem[], root: string): Entry[];
export function readAssetCatalog(home: string): Entry[];
