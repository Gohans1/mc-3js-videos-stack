// Markdown reading, heading bullet outline, and diacritic-insensitive search helpers ported from md-phone.

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "del"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export interface LessonHeading {
  line: number; // 1-based
  depth: number;
  title: string;
  bullets: number;
}

export interface ListItem {
  line: number;
  checked: boolean | null;
  inlines: InlineToken[];
}

export type LessonBlock =
  | { type: "heading"; line: number; depth: number; title: string; inlines: InlineToken[] }
  | { type: "paragraph"; line: number; inlines: InlineToken[] }
  | { type: "blockquote"; line: number; inlines: InlineToken[] }
  | { type: "list"; line: number; ordered: boolean; items: ListItem[] }
  | { type: "table"; line: number; headers: string[]; rows: string[][] }
  | { type: "code"; line: number; lang: string; code: string }
  | { type: "hr"; line: number };

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BULLET = /^\s*[-*+][ \t]+\S/;
const UL_ITEM = /^ {0,3}[-*+][ \t]+(.*)$/;
const OL_ITEM = /^ {0,3}\d+[.)][ \t]+(.*)$/;
const DIVIDER = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const NOT_PROSE = /^\s*$|^(?: {4}|\t)|^ {0,3}(?:[-*+>|]|\d+[.)])(?:\s|$)/;

const BOM = "\uFEFF";

export const foldText = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();

function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
  let folded = "";
  const offsets: number[] = [];
  let at = 0;
  for (const ch of text) {
    const part = ch.charCodeAt(0) < 0x80 ? ch.toLowerCase() : foldText(ch);
    folded += part;
    for (let i = 0; i < part.length; i++) offsets.push(at);
    at += ch.length;
  }
  offsets.push(at);
  return { folded, offsets };
}

let cachedFold: { text: string; folded: string; offsets: number[] } | null = null;

/** Matches `query` inside `text` without requiring Vietnamese diacritics. */
export function findFoldedMatches(text: string, query: string): { start: number; end: number }[] {
  const needle = foldText(query.trim());
  if (!needle) return [];
  if (cachedFold?.text !== text) cachedFold = { text, ...foldWithOffsets(text) };
  const { folded, offsets } = cachedFold;
  const out: { start: number; end: number }[] = [];
  for (
    let at = folded.indexOf(needle);
    at !== -1;
    at = folded.indexOf(needle, at + needle.length)
  ) {
    out.push({ start: offsets[at]!, end: offsets[at + needle.length]! });
  }
  return out;
}

const stripBomAndLines = (text: string): string[] => {
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  return clean.split(/\r?\n/);
};

const bodyStartIndex = (lines: string[]): number => {
  if (lines[0]?.trimEnd() !== "---") return 0;
  const end = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  return end === -1 ? 0 : end + 1;
};

const plainHeadingTitle = (raw: string): string =>
  raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|\*|~~|`/g, "")
    .trim();

const closesFence = (line: string, fence: string): boolean => {
  const trimmed = line.trim();
  return (
    /^ {0,3}\S/.test(line) &&
    trimmed.length >= fence.length &&
    trimmed === fence[0]!.repeat(trimmed.length)
  );
};

/** Parses headings with bullet counts for the Lessons Contents outline. */
export function parseLessonHeadings(text: string): LessonHeading[] {
  const lines = stripBomAndLines(text);
  const first = bodyStartIndex(lines);
  const headings: LessonHeading[] = [];
  let fence: string | null = null;
  let paragraph: { line: string; index: number } | null = null;

  for (let i = first; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = open[1]!;
      paragraph = null;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      const title = plainHeadingTitle((atx[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, ""));
      if (title) headings.push({ line: i + 1, depth: atx[1]!.length, title, bullets: 0 });
      paragraph = null;
      continue;
    }
    const underline = UNDERLINE.exec(line);
    if (underline) {
      const title = paragraph ? plainHeadingTitle(paragraph.line) : "";
      if (paragraph && title) {
        headings.push({
          line: paragraph.index + 1,
          depth: underline[1]![0] === "=" ? 1 : 2,
          title,
          bullets: 0,
        });
      }
      paragraph = null;
      continue;
    }
    if (BULLET.test(line) && !DIVIDER.test(line) && headings.length) {
      headings[headings.length - 1]!.bullets++;
    }
    paragraph = NOT_PROSE.test(line) ? null : { line, index: i };
  }
  return headings;
}

const isSafeHref = (raw: string): boolean => {
  const s = raw.trim();
  if (!s) return false;
  if (s.startsWith("/") || s.startsWith("#")) return !s.startsWith("//");
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
};

const INLINE_RE =
  /`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]|\([^)\s]*\))+)\)|\*\*([^*]+)\*\*|(?<![\p{L}\p{N}_])__([^_\n]+?)__(?![\p{L}\p{N}_])|~~([^~]+)~~|\*([^*]+)\*|(?<![\p{L}\p{N}_])_((?:[^\s_\n]|(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}]))(?:[^_\n]|(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}]))*?(?<![\s_]))_(?![\p{L}\p{N}_])|(https?:\/\/(?:[^\s<()]|\([^\s<()]*\))+)/gu;

export function parseInlines(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of input.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ kind: "text", text: input.slice(last, idx) });
    if (m[1] !== undefined) tokens.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined && m[3] !== undefined) {
      if (isSafeHref(m[3])) tokens.push({ kind: "link", text: m[2], href: m[3] });
      else tokens.push({ kind: "text", text: m[2] });
    } else if (m[4] !== undefined) tokens.push({ kind: "strong", text: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: "strong", text: m[5] });
    else if (m[6] !== undefined) tokens.push({ kind: "del", text: m[6] });
    else if (m[7] !== undefined) tokens.push({ kind: "em", text: m[7] });
    else if (m[8] !== undefined) tokens.push({ kind: "em", text: m[8] });
    else if (m[9] !== undefined) {
      const raw = m[9];
      const trimmed = raw.replace(/[.,;:!?]+$/, "");
      if (trimmed) tokens.push({ kind: "link", text: trimmed, href: trimmed });
      if (trimmed.length < raw.length) {
        tokens.push({ kind: "text", text: raw.slice(trimmed.length) });
      }
    }
    last = idx + m[0].length;
  }
  if (last < input.length) tokens.push({ kind: "text", text: input.slice(last) });
  return tokens;
}

const splitTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
};

const isTableSeparator = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !/^[-:\s]+$/.test(trimmed)) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
};

const parseTask = (raw: string): { checked: boolean | null; body: string } => {
  const m = /^\[( |x|X)\]\s+(.*)$/.exec(raw);
  if (!m) return { checked: null, body: raw };
  return { checked: m[1]!.toLowerCase() === "x", body: m[2]! };
};

/** Parses a lesson file into line-indexed blocks for Read view rendering. */
export function parseLessonBlocks(text: string): LessonBlock[] {
  const lines = stripBomAndLines(text);
  const start = bodyStartIndex(lines);
  const blocks: LessonBlock[] = [];

  for (let i = start; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fenceOpen = FENCE_OPEN.exec(line);
    if (fenceOpen && !(fenceOpen[1]![0] === "`" && fenceOpen[2]!.includes("`"))) {
      const fence = fenceOpen[1]!;
      const lang = fenceOpen[2]!.trim().split(/\s+/)[0] ?? "";
      const blockLine = i + 1;
      const body: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i]!, fence)) {
        body.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", line: blockLine, lang, code: body.join("\n") });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const raw = (atx[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
      blocks.push({
        type: "heading",
        line: i + 1,
        depth: atx[1]!.length,
        title: plainHeadingTitle(raw),
        inlines: parseInlines(raw),
      });
      i++;
      continue;
    }

    if (DIVIDER.test(line)) {
      blocks.push({ type: "hr", line: i + 1 });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const blockLine = i + 1;
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        rows.push(splitTableRow(lines[i]!));
        i++;
      }
      blocks.push({ type: "table", line: blockLine, headers, rows });
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const blockLine = i + 1;
      const quote: string[] = [];
      while (i < lines.length && /^ {0,3}>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^ {0,3}>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", line: blockLine, inlines: parseInlines(quote.join(" ")) });
      continue;
    }

    const ulFirst = UL_ITEM.exec(line);
    const olFirst = ulFirst ? null : OL_ITEM.exec(line);
    if (ulFirst || olFirst) {
      const ordered = Boolean(olFirst);
      const matcher = ordered ? OL_ITEM : UL_ITEM;
      const blockLine = i + 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const cur = matcher.exec(lines[i]!);
        if (!cur) break;
        const { checked, body } = parseTask(cur[1]!.trim());
        items.push({ line: i + 1, checked, inlines: parseInlines(body) });
        i++;
      }
      blocks.push({ type: "list", line: blockLine, ordered, items });
      continue;
    }

    // Paragraph (or Setext heading if next line underlines)
    const nextLine = lines[i + 1];
    const underline = nextLine ? UNDERLINE.exec(nextLine) : null;
    if (underline && !NOT_PROSE.test(line)) {
      blocks.push({
        type: "heading",
        line: i + 1,
        depth: underline[1]![0] === "=" ? 1 : 2,
        title: plainHeadingTitle(line.trim()),
        inlines: parseInlines(line.trim()),
      });
      i += 2;
      continue;
    }

    const blockLine = i + 1;
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !ATX.test(lines[i]!) &&
      !FENCE_OPEN.test(lines[i]!) &&
      !DIVIDER.test(lines[i]!) &&
      !/^ {0,3}>\s?/.test(lines[i]!) &&
      !UL_ITEM.test(lines[i]!) &&
      !OL_ITEM.test(lines[i]!) &&
      !(lines[i]!.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!))
    ) {
      para.push(lines[i]!.trim());
      i++;
    }
    if (para.length) {
      blocks.push({ type: "paragraph", line: blockLine, inlines: parseInlines(para.join(" ")) });
    } else i++;
  }

  return blocks;
}

export interface FilteredLesson<F extends { path: string; text: string }> {
  file: F;
  matchLine: number | null;
  snippet: string | null;
}

/** Filters lesson files by diacritic-insensitive path or content match and extracts the first matching line. */
export function filterLessons<F extends { path: string; text: string }>(
  files: readonly F[],
  query: string,
): FilteredLesson<F>[] {
  const needle = foldText(query.trim());
  if (!needle) {
    return files.map((file) => ({ file, matchLine: null, snippet: null }));
  }
  const results: FilteredLesson<F>[] = [];
  for (const file of files) {
    const lines = stripBomAndLines(file.text);
    const start = bodyStartIndex(lines);
    let matchLine: number | null = null;
    let snippet: string | null = null;
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i]!;
      if (foldText(raw).includes(needle)) {
        matchLine = i + 1;
        snippet = raw.trim().replace(/^#+\s*/, "");
        break;
      }
    }
    const pathMatches = foldText(file.path).includes(needle);
    if (pathMatches || matchLine !== null) {
      results.push({ file, matchLine, snippet });
    }
  }
  return results;
}

/** Finds the heading line active at or just above `topLine`. */
export function findActiveHeading(heads: readonly LessonHeading[], topLine: number): number | null {
  if (!heads.length) return null;
  let active = heads[0]!.line;
  for (const h of heads) {
    if (h.line <= topLine) active = h.line;
    else break;
  }
  return active;
}
