import type { Grade } from "./grade";

export interface AdjustmentLayer {
  id: string;
  name: string;
  from: number;
  to: number;
  track: number;
  grade: Grade;
}
export interface AdjustmentTrack {
  lock?: boolean;
  hidden?: boolean;
}
export interface AdjustmentFile {
  items: AdjustmentLayer[];
  tracks?: Record<string, AdjustmentTrack>;
}

export const activeAdjustments = (
  file: AdjustmentFile | undefined,
  t: number,
  timeAt?: (item: AdjustmentLayer) => number,
) =>
  (file?.items ?? [])
    .filter((it) => {
      const at = timeAt ? timeAt(it) : t;
      return at >= it.from && at < it.to && !file?.tracks?.[it.track]?.hidden;
    })
    .toSorted((a, b) => a.track - b.track);
