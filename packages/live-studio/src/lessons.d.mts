export declare const LESSONS: string;
import type { LessonJevConfig } from "./lesson-config";
export type LessonScope = "film" | "all";
export type LessonHead = { line: number; head: string };
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
  config?: LessonJevConfig,
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
    concurrency?: number;
  },
): Promise<
  Map<string, { picks: LessonPick[]; why?: undefined } | { why: string; picks?: undefined }>
>;
