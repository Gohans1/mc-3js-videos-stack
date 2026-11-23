import { relative } from "node:path";

const LINE_DIRECTIVE_RE =
  /^(?:\/\s*<reference\s|@ts-(?:nocheck|check)(?=$|\s)|#(?:region|endregion)(?=$|\s))/;
const ANY_DIRECTIVE_RE =
  /^(?:@ts-(?:expect-error|ignore)(?=$|[\s:])|(?:oxlint|eslint)-(?:disable(?:-next-line|-line)?|enable)(?=$|\s)|prettier-ignore(?=$|\s)|biome-ignore\s|(?:v8|c8|istanbul)\s+ignore(?=$|\s)|@vite-ignore(?=$|\s)|@(?:jsx|jsxImportSource|jsxFrag|jsxRuntime)\s)/;

const PLAIN_JS_RE = /\.[cm]?js$/i;
const JSX_EXT_RE = /\.[jt]sx$/i;
const TYPE_TAG_RE =
  /^@(?:type|typedef|param|returns|return|template|satisfies|overload|import|callback)\b/;
const IDENT_CHAR_RE = /[A-Za-z0-9_$]/;
const DIGIT_RE = /[0-9]/;
const MERGEABLE_OPS = new Set([
  "++",
  "--",
  "//",
  "/*",
  "==",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "&&",
  "||",
  "??",
  "?.",
  "**",
  "=>",
]);

export const normalizeRelPath = (filePath, rootDir) =>
  relative(rootDir, filePath).replaceAll("\\", "/");

const isTypeOnlyJsdoc = (comment, filename) => {
  if (!PLAIN_JS_RE.test(filename)) return false;
  if (comment.type !== "Block") return false;
  if (!comment.value.startsWith("*") || comment.value.startsWith("**")) return false;
  const lines = comment.value
    .slice(1)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  let braceDepth = 0;
  for (const line of lines) {
    if (braceDepth === 0 && !TYPE_TAG_RE.test(line)) return false;
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth--;
        if (braceDepth < 0) return false;
      }
    }
  }
  return braceDepth === 0;
};

export const isAllowedComment = (comment, filename = "") => {
  if (!comment) return true;
  if (comment.type === "Shebang") return true;
  const trimmed = String(comment.value ?? "").trim();
  if (comment.type === "Line" && LINE_DIRECTIVE_RE.test(trimmed)) return true;
  if (ANY_DIRECTIVE_RE.test(trimmed)) return true;
  if (isTypeOnlyJsdoc(comment, filename)) return true;
  return false;
};

const getLineStarts = (source) => {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
};

const offsetToLine = (starts, offset) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
};

const lineBounds = (source, starts, lineNum) => {
  const start = starts[lineNum - 1] ?? 0;
  const nextStart = starts[lineNum] ?? source.length;
  let contentEnd = nextStart;
  if (contentEnd > start && source.charCodeAt(contentEnd - 1) === 10) contentEnd--;
  if (contentEnd > start && source.charCodeAt(contentEnd - 1) === 13) contentEnd--;
  return { start, contentEnd, nextStart };
};

const findJsxRangeIndex = (start, end, filename, jsxEmptyRanges) => {
  if (!JSX_EXT_RE.test(filename) || !Array.isArray(jsxEmptyRanges) || jsxEmptyRanges.length === 0) {
    return -1;
  }
  for (let i = 0; i < jsxEmptyRanges.length; i++) {
    const [rStart, rEnd] = jsxEmptyRanges[i];
    if (rStart <= start && end <= rEnd) return i;
  }
  return -1;
};

export const groupProseBlocks = (source, comments, filename = "", jsxEmptyRanges = null) => {
  const starts = getLineStarts(source);
  const blocks = [];

  const jsxContainerInfo = new Map();
  if (JSX_EXT_RE.test(filename) && Array.isArray(jsxEmptyRanges) && jsxEmptyRanges.length > 0) {
    for (const comment of comments) {
      const rawStart = comment.range ? comment.range[0] : comment.start;
      const rawEnd = comment.range ? comment.range[1] : comment.end;
      const idx = findJsxRangeIndex(rawStart, rawEnd, filename, jsxEmptyRanges);
      if (idx === -1) continue;
      let entry = jsxContainerInfo.get(idx);
      if (!entry) {
        entry = { range: jsxEmptyRanges[idx], hasAllowed: false, prose: [] };
        jsxContainerInfo.set(idx, entry);
      }
      if (isAllowedComment(comment, filename)) {
        entry.hasAllowed = true;
      } else {
        entry.prose.push({ comment, rawStart, rawEnd });
      }
    }
  }

  const emittedJsxContainers = new Set();

  for (const comment of comments) {
    if (isAllowedComment(comment, filename)) continue;
    const rawStart = comment.range ? comment.range[0] : comment.start;
    const rawEnd = comment.range ? comment.range[1] : comment.end;
    const jsxIdx = findJsxRangeIndex(rawStart, rawEnd, filename, jsxEmptyRanges);
    const container = jsxIdx !== -1 ? jsxContainerInfo.get(jsxIdx) : null;

    if (container && !container.hasAllowed) {
      if (emittedJsxContainers.has(jsxIdx)) continue;
      emittedJsxContainers.add(jsxIdx);
      const [effStart, effEnd] = container.range;
      const startLine = offsetToLine(starts, effStart);
      const endLine = offsetToLine(starts, Math.max(effStart, effEnd - 1));
      const firstBounds = lineBounds(source, starts, startLine);
      const lastBounds = lineBounds(source, starts, endLine);
      const before = source.slice(firstBounds.start, effStart).trim();
      const after = source.slice(effEnd, lastBounds.contentEnd).trim();
      const standalone = before.length === 0 && after.length === 0;
      const lineSpan = endLine - startLine + 1;
      const shedLines = standalone ? lineSpan : Math.max(0, lineSpan - 1);
      const text = container.prose.map((p) => source.slice(p.rawStart, p.rawEnd)).join("\n");

      blocks.push({
        line: startLine,
        end: endLine,
        start: effStart,
        stop: effEnd,
        tokens: container.prose.length,
        shedLines,
        trailing: !standalone,
        jsxWrapped: true,
        kind: "block",
        text,
      });
      continue;
    }

    const effStart = rawStart;
    const effEnd = rawEnd;
    const startLine = offsetToLine(starts, effStart);
    const endLine = offsetToLine(starts, Math.max(effStart, effEnd - 1));
    const firstBounds = lineBounds(source, starts, startLine);
    const lastBounds = lineBounds(source, starts, endLine);
    const before = source.slice(firstBounds.start, effStart).trim();
    const after = source.slice(effEnd, lastBounds.contentEnd).trim();
    const standalone = before.length === 0 && after.length === 0;
    const rawText = source.slice(rawStart, rawEnd);
    const lineSpan = endLine - startLine + 1;
    const shedLines = standalone ? lineSpan : Math.max(0, lineSpan - 1);

    const prev = blocks[blocks.length - 1];
    if (
      prev &&
      comment.type === "Line" &&
      prev.kind === "line" &&
      standalone &&
      !prev.trailing &&
      !prev.jsxWrapped &&
      prev.end + 1 === startLine
    ) {
      prev.end = endLine;
      prev.stop = effEnd;
      prev.tokens += 1;
      prev.shedLines += shedLines;
      prev.text += `\n${rawText}`;
      continue;
    }

    blocks.push({
      line: startLine,
      end: endLine,
      start: effStart,
      stop: effEnd,
      tokens: 1,
      shedLines,
      trailing: !standalone,
      jsxWrapped: false,
      kind: comment.type === "Line" ? "line" : "block",
      text: rawText,
    });
  }

  return blocks;
};

const needsSeparatorSpace = (leftChar, rightChar) => {
  if (!leftChar || !rightChar) return false;
  if (IDENT_CHAR_RE.test(leftChar) && IDENT_CHAR_RE.test(rightChar)) return true;
  if (DIGIT_RE.test(leftChar) && rightChar === ".") return true;
  if (MERGEABLE_OPS.has(leftChar + rightChar)) return true;
  return false;
};

export const applyStrips = (source, blocks) => {
  if (blocks.length === 0) return source;
  const sorted = [...blocks].sort((a, b) => b.start - a.start);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let out = source;

  for (const block of sorted) {
    const curStarts = getLineStarts(out);
    const firstBounds = lineBounds(out, curStarts, block.line);
    const lastBounds = lineBounds(out, curStarts, block.end);
    const before = out.slice(firstBounds.start, block.start).trim();
    const after = out.slice(block.stop, lastBounds.contentEnd).trim();

    if (before.length === 0 && after.length === 0) {
      let delStart = firstBounds.start;
      let delEnd = lastBounds.nextStart;
      if (delEnd === out.length && lastBounds.contentEnd === lastBounds.nextStart && delStart > 0) {
        if (out.charCodeAt(delStart - 1) === 10) delStart--;
        if (delStart > 0 && out.charCodeAt(delStart - 1) === 13) delStart--;
      }
      out = out.slice(0, delStart) + out.slice(delEnd);
    } else if (block.kind === "line" && after.length === 0) {
      let delStart = block.start;
      while (
        delStart > firstBounds.start &&
        (out[delStart - 1] === " " || out[delStart - 1] === "\t")
      ) {
        delStart--;
      }
      out = out.slice(0, delStart) + out.slice(block.stop);
    } else {
      let delStart = block.start;
      let delEnd = block.stop;
      if (after.length === 0) {
        while (
          delStart > firstBounds.start &&
          (out[delStart - 1] === " " || out[delStart - 1] === "\t")
        ) {
          delStart--;
        }
      }
      const preserveLineBreak = block.line !== block.end && before.length > 0 && after.length > 0;
      const leftChar = delStart > 0 ? out[delStart - 1] : "";
      const rightChar = delEnd < out.length ? out[delEnd] : "";
      const replacement = preserveLineBreak
        ? eol
        : needsSeparatorSpace(leftChar, rightChar)
          ? " "
          : "";
      out = out.slice(0, delStart) + replacement + out.slice(delEnd);
    }
  }

  return out;
};
