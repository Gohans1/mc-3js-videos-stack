import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { LessonJevConfigSchema } from "./lesson-config.ts";

export const readLessonConfig = (root) => {
  const file = join(root, "notes/lessons-config.json");
  return LessonJevConfigSchema.parse(
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {},
  );
};
export const writeLessonJson = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.new`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { flush: true });
  renameSync(tmp, file);
};
