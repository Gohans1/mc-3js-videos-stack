import { join, relative, resolve } from "node:path";

import { DEFAULT_LESSON_JEV_CONFIG, fillTemplate } from "./lesson-config.ts";
import { LESSONS, lessonTopics } from "./lessons.mjs";

export const toLearn = (n) => n.remember && !(n.learned && n.learned.at >= n.remember.at);

export const noteLessonFormat = ({
  root,
  dir = LESSONS,
  projectDir = join(root, "lessons"),
  config = DEFAULT_LESSON_JEV_CONFIG,
  topics,
}) => {
  const hasProjectLessons = Boolean(projectDir && resolve(projectDir) !== resolve(dir));
  const globalPath = relative(root, dir).replaceAll("\\", "/");
  const learnPrompt = () => {
    const globalTopics = topics?.all ?? lessonTopics(dir);
    const filmTopics = topics?.film ?? (hasProjectLessons ? lessonTopics(projectDir) : []);
    const filmTarget = hasProjectLessons
      ? `this film's src, beside what it rules, or in lessons/<topic>.md (nested subfolders ok, letters/digits/-/_ only; ${filmTopics.length ? `this film's topics now: ${filmTopics.join(", ")}; ` : ""}same frontmatter/heading format)`
      : "this film's src, beside what it rules";
    const standard = `keep it as a rule that outlives this chat: in code where you can (a default, or a check that fails); else, for every film, in ${globalPath}/<topic>.md (nested subfolders ok, letters/digits/-/_ only; ${globalTopics.length ? `topics now: ${globalTopics.join(", ")}; ` : ""}a rule joins its topic's file, a new file only for a new topic; write it any way, but Jev finds it for later notes by its path, frontmatter and headings only, never the words under them, so write those with care: a "when:" frontmatter line naming the notes the file is for, each rule a heading that says it, the details under it); a this-film rule in ${filmTarget}; then`;
    return fillTemplate(config.learnTemplate, {
      default: standard,
      globalPath,
      globalTopics: globalTopics.join(", "),
      filmTopics: filmTopics.join(", "),
    });
  };
  const lessonLines = (l) =>
    !l
      ? []
      : l.why
        ? [
            fillTemplate(config.errorTemplate, {
              why: l.why,
              globalPath,
              default: hasProjectLessons
                ? `lessons: Jev did not run (${l.why}); the files are in lessons/ (this film) and ${globalPath}/ (every film)`
                : `lessons: Jev did not run (${l.why}); the files are in ${globalPath}/`,
            }),
          ]
        : !l.picks.length
          ? [
              fillTemplate(config.emptyTemplate, {
                globalPath,
                default: hasProjectLessons
                  ? `lessons: Jev says none fits this note (none in lessons/ or ${globalPath}/)`
                  : `lessons: Jev says none fits this note (all in ${globalPath}/)`,
              }),
            ]
          : [
              ...l.picks.flatMap((p) => {
                const file = p.file ?? join(dir, "..", p.path);
                const path = relative(root, file).replaceAll("\\", "/");
                const kind = [
                  hasProjectLessons && config.showScope
                    ? p.scope === "film"
                      ? config.filmLabel
                      : config.allLabel
                    : "",
                  p.sure ? config.sureLabel : config.maybeLabel,
                ]
                  .filter(Boolean)
                  .join(", ");
                return [
                  fillTemplate(config.fileTemplate, {
                    section: config.sectionLabel,
                    kind: kind ? ` (${kind})` : "",
                    path,
                    headingsLabel: p.heads.length ? config.headingsLabel : "",
                  }),
                  ...p.heads.map((h) =>
                    fillTemplate(config.headingTemplate, {
                      line: config.showLines ? `${h.line} ` : "",
                      head: h.head,
                    }),
                  ),
                ];
              }),
              ...(config.footer ? [config.footer] : []),
            ];
  return { learnPrompt, lessonLines };
};
