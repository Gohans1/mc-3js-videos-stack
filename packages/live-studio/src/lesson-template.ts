// What the Lessons tab's New starts a file with: the shape Jev finds a lesson file by (lessons.mjs reads its path, its "when:"
// frontmatter line and its headings, never the words under them), filled from the file's name. pick: the rule heading's
// words, picked in the editor so the creator's first words replace them
export const LESSON_PATH_MAX = 200;
export const LESSON_TEXT_MAX = 1_000_000;
export const lessonPath = (name: string) => `${name.replace(/\.md$/, "")}.md`;

const RULE = "A rule, said as one line";

export const lessonTemplate = (path: string) => {
  const topic = path.split("/").pop()!.replace(/\.md$/, "").replace(/[-_]+/g, " ");
  const head = `---\nwhen: ${topic}\n---\n\n# ${topic[0]!.toUpperCase()}${topic.slice(1)}\n\n## `,
    text = `${head}${RULE}\n\nWhy it matters, and how to tell it is kept: the details under the heading. Jev finds this file by its name, the when: line (what the notes it helps are about) and its headings.\n`;
  return { text, pick: [head.length, head.length + RULE.length] as const };
};
