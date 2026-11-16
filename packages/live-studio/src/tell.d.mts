import type { ActivityIn } from "./activity.mjs";

export declare const studioPort: (project: string) => number | null;
export declare const tell: (project: string, entry: ActivityIn) => Promise<boolean>;
export declare const startJob: (
  project: string,
  key: string,
  entry: Omit<ActivityIn, "job">,
) => Promise<(last: Omit<ActivityIn, "job">) => Promise<boolean>>;
