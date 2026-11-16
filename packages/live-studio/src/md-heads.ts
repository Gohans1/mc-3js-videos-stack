// A Markdown file's frontmatter lines and ATX headings (CommonMark: up to 3 spaces, 1-6 #, then a space or the line's end),
// skipping fenced code. What Jev reads of a lesson file (lessons.mjs) and the Lessons tab's contents are the same headings
export interface MdHead {
  line: number; // 1-based
  depth: number;
  head: string; // the heading line, whitespace folded
}
const BOM = String.fromCharCode(0xfeff);
export const mdHeads = (text: string) => {
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/),
    front: string[] = [],
    heads: MdHead[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) {
      front.push(...lines.slice(1, end));
      i = end + 1;
    }
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const l = lines[i]!,
      open = /^ {0,3}(`{3,}|~{3,})/.exec(l)?.[1];
    if (fence) {
      if (
        open?.[0] === fence[0] &&
        open.length >= fence.length &&
        !/\S/.test(l.trim().slice(open.length))
      )
        fence = null;
    } else if (open) fence = open;
    else {
      const h = /^ {0,3}(#{1,6})(\s|$)/.exec(l);
      if (h) heads.push({ line: i + 1, depth: h[1]!.length, head: l.replace(/\s+/g, " ").trim() });
    }
  }
  return { front, heads };
};
