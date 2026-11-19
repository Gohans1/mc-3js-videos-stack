import type * as z from "zod";

export type ActivitySurface =
  | "film"
  | "cli"
  | "sound"
  | "text"
  | "cam"
  | "light"
  | "adjust"
  | "openfilm"
  | "keys"
  | "speed"
  | "transition"
  | "objects";

export type ActivityIn = {
  surface?: ActivitySurface;
  say: string;
  notes?: string[];
  lessons?: string[];
  at?: number;
  to?: number;
  level?: "ok" | "warn" | "fail";
  marks?: { at: number; to?: number; say?: string }[];
  job?: { key: string; end?: boolean; pid?: number };
};
// as the pages get it: numbered in the order the studio heard them, when in ms since 1970
export type ActivityEntry = ActivityIn & { id: number; when: number };
// GET /api/activity: boot and now by the studio's clock
export type ActivityState = {
  boot: number;
  now: number;
  lines: ActivityEntry[];
  running: ActivityEntry[];
};
export declare const Activity: z.ZodType<ActivityIn>;
export declare const createActivity: (
  send: (event: string, data: string) => void,
  options?: { keep?: number; every?: number },
) => { add: (entry: ActivityIn) => ActivityEntry; state: () => ActivityState };
