export const LESSON_PATH_MAX = 200;
export const LESSON_TEXT_MAX = 1_000_000;
export const lessonPath = (name: string) => `${name.replace(/\.md$/, "")}.md`;

const RULE = "A rule, said as one line";

export const lessonTemplate = (path: string) => {
  const topic = path.split("/").pop()!.replace(/\.md$/, "").replace(/[-_]+/g, " ");
  const head = `---\nwhen: ${topic}\n---\n\n# ${topic[0]!.toUpperCase()}${topic.slice(1)}\n\n## `,
    text = `${head}${RULE}\n\nExplain why the rule matters and how to check it under the heading. Use a descriptive file name, when: line, and headings to help Jev find the rule in headings mode.\n`;
  return { text, pick: [head.length, head.length + RULE.length] as const };
};
