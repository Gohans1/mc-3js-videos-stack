import type { Timing, TimingPlan } from "./timing.mjs";
export type LinkageKind = "text" | "adjustment" | "audio" | "sfx" | "voice";
export type LinkageSettings = Record<LinkageKind, boolean>;
export const LINKAGE_DEFAULTS: LinkageSettings;
export const LINKAGE_KINDS: LinkageKind[];
export function timingPlan(timing: Timing): TimingPlan;
export function recordLinkage(
  timing: Timing,
  before: TimingPlan,
  after: TimingPlan,
  enabled: boolean,
  settings: LinkageSettings,
): void;
