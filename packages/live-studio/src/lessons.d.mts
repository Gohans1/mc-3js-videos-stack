export declare const LESSONS: string;
import type { LessonJevConfig } from "./lesson-config";
export type LessonScope = "film" | "all";
export type LessonHead = { line: number; head: string };
// A lesson file as the AI opens it (heads: every heading with its line) and as Jev reads it (jev).
// In dual-scope mode `path` stays "lessons/<rel>" for both scopes; use `key`, `file`, or `(scope, rel)` to disambiguate.
export type LessonFile = {
  key?: string;
  path: string;
  heads: LessonHead[];
  jev: string;
  scope?: LessonScope;
  rel?: string;
  file?: string;
};
export type LessonPick = {
  path: string;
  sure: boolean;
  heads: LessonHead[];
  scope?: LessonScope;
  rel?: string;
  file?: string;
};
export type LessonJudge = (
  text: string,
  pool: LessonFile[],
  show: number,
) => Promise<[number, LessonFile, number?][]>;
export declare const lessonTopics: (dir?: string) => string[];
export declare function lessonsFor(
  notes: { id: string; text: string; asks?: { text: string }[] }[],
  options?: {
    dir?: string;
    projectDir?: string | null;
    cache?: string | null;
    judge?: LessonJudge;
    config?: Partial<LessonJevConfig>;
  },
): Promise<
  Map<string, { picks: LessonPick[]; why?: undefined } | { why: string; picks?: undefined }>
>;
