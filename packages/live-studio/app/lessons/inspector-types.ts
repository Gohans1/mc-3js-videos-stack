import type { LessonJevConfig } from "../../src/lesson-config";
export type InspectorView =
  "ai" | "lessons" | "prompt" | "learn" | "requests" | "trace" | "metadata";

export interface InspectNote {
  id?: string;
  text: string;
  asks?: { text: string; at?: string }[];
}
export interface InspectorInfo {
  defaults: LessonJevConfig;
  config: LessonJevConfig;
  keys: { free: boolean; paid: boolean };
  notes: (InspectNote & { n?: number })[];
  engine: Record<string, unknown>;
}
export interface InspectResult {
  config: LessonJevConfig;
  status: "dry" | "cached" | "live";
  fingerprint: string;
  pool: { key: string; jev: string; chars: number; truncated: boolean }[];
  ranked: { key: string; vote: number; fit?: number }[] | null;
  trace: Record<string, unknown>[];
  requests: Record<string, unknown>;
  output: string;
  noteOutput: string;
  noteInput: Record<string, unknown>;
  learnPrompt: string;
  words: string;
  cache: { inspector: boolean; cli: boolean; entries: number; limit: number };
}
