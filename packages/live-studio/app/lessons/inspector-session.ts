import { create } from "zustand";

import { DEFAULT_LESSON_JEV_CONFIG, type LessonJevConfig } from "../../src/lesson-config";
import type { InspectNote } from "./inspector-types";

export const useInspectorSession = create<{
  config: LessonJevConfig;
  note: InspectNote;
  excluded: string[];
  saved: string;
  hydrated: boolean;
}>(() => ({
  config: DEFAULT_LESSON_JEV_CONFIG,
  note: { text: "", asks: [] },
  excluded: [],
  saved: JSON.stringify(DEFAULT_LESSON_JEV_CONFIG),
  hydrated: false,
}));
