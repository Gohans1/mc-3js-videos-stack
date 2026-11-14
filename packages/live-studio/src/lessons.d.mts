export declare const LESSONS: string;
export type LessonFile = { path: string; jev: string };
export type LessonJudge = (
  text: string,
  pool: LessonFile[],
  show: number,
) => Promise<[number, LessonFile, number?][]>;
export declare function lessonsFor(
  notes: { id: string; text: string }[],
  options?: { dir?: string; cache?: string | null; judge?: LessonJudge },
): Promise<Map<string, { paths: string[]; why?: undefined } | { why: string; paths?: undefined }>>;
