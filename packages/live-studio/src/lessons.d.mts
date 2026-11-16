export declare const LESSONS: string;
export type LessonHead = { line: number; head: string };
// A lesson file as the AI opens it (heads: every heading with its line) and as Jev reads it (jev)
export type LessonFile = { path: string; heads: LessonHead[]; jev: string };
export type LessonPick = { path: string; sure: boolean; heads: LessonHead[] };
export type LessonJudge = (
  text: string,
  pool: LessonFile[],
  show: number,
) => Promise<[number, LessonFile, number?][]>;
export declare const lessonTopics: (dir?: string) => string[];
export declare function lessonsFor(
  notes: { id: string; text: string; asks?: { text: string }[] }[],
  options?: { dir?: string; cache?: string | null; judge?: LessonJudge },
): Promise<
  Map<string, { picks: LessonPick[]; why?: undefined } | { why: string; picks?: undefined }>
>;
