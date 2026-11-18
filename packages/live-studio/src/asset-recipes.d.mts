import type { Entry } from "../../../scripts/find";

export type AssetRecipe = Record<string, unknown> & {
  id: string;
  source: string;
  kind: string;
  render?: string;
};

export function assetId(entry: Entry): string | undefined;
export function matchesAssetId(entry: Entry, id: string): boolean;
export function assetRecipe(entry: Entry): AssetRecipe | undefined;
export function assetInfo(
  entry: Entry,
):
  | (AssetRecipe & { exampleProps: Record<string, unknown>; units: string; next: string })
  | undefined;
export function resolveAsset(id: string, entries: Entry[], source?: string): AssetRecipe;
