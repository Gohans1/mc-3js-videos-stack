import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { groupProseBlocks, isAllowedComment, normalizeRelPath } from "./comment-rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");

const SKIP_AST_KEYS = new Set(["parent", "loc", "range", "start", "end", "tokens", "comments"]);

const isJsxEmptyContainer = (node) =>
  Boolean(
    node &&
    node.type === "JSXExpressionContainer" &&
    node.expression &&
    node.expression.type === "JSXEmptyExpression",
  );

const isBlankMultilineJsxText = (node) =>
  Boolean(
    node &&
    node.type === "JSXText" &&
    typeof node.value === "string" &&
    node.value.includes("\n") &&
    /^[\t\r\n ]*$/.test(node.value),
  );

const collectJsxEmptyRanges = (ast) => {
  const ranges = [];
  const stack = [ast];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (isJsxEmptyContainer(node)) {
      const range = node.range ?? [node.start, node.end];
      ranges.push(range);
      continue;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_AST_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i] === "object") stack.push(val[i]);
        }
      } else if (val && typeof val === "object" && typeof val.type === "string") {
        stack.push(val);
      }
    }
  }
  return ranges;
};

const isInAnyRange = (start, end, ranges) => {
  for (const [rStart, rEnd] of ranges) {
    if (start >= rStart && end <= rEnd) return true;
  }
  return false;
};

const computeTokenHash = (sourceCode, jsxEmptyRanges) => {
  const hash = createHash("sha256");
  const tokens = sourceCode.getTokens(sourceCode.ast);
  for (const tok of tokens) {
    const start = tok.range ? tok.range[0] : tok.start;
    const end = tok.range ? tok.range[1] : tok.end;
    if (
      tok.type === "Punctuator" &&
      (tok.value === "{" || tok.value === "}") &&
      isInAnyRange(start, end, jsxEmptyRanges)
    ) {
      continue;
    }
    if (tok.type === "JSXText" && tok.value.includes("\n") && /^[\t\r\n ]*$/.test(tok.value)) {
      continue;
    }
    hash.update(tok.type);
    hash.update("\0");
    hash.update(tok.value);
    hash.update("\n");
  }
  return hash.digest("hex");
};

const hashAstValue = (hash, val) => {
  if (val === null) {
    hash.update("null;");
    return;
  }
  const t = typeof val;
  if (t === "undefined") {
    hash.update("undef;");
    return;
  }
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
    hash.update(`${t}:${String(val)};`);
    return;
  }
  if (val instanceof RegExp) {
    hash.update(`re:${val.source}/${val.flags};`);
    return;
  }
  if (Array.isArray(val)) {
    hash.update("[");
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      if (isJsxEmptyContainer(item) || isBlankMultilineJsxText(item)) continue;
      hashAstValue(hash, item);
      hash.update(",");
    }
    hash.update("]");
    return;
  }
  if (t === "object") {
    hash.update("{");
    const keys = Object.keys(val).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      if (SKIP_AST_KEYS.has(key)) continue;
      hash.update(`${key}=`);
      hashAstValue(hash, val[key]);
      hash.update(";");
    }
    hash.update("}");
  }
};

const computeVerifyHash = (sourceCode, ast, jsxEmptyRanges) => {
  const tokenHash = computeTokenHash(sourceCode, jsxEmptyRanges);
  const astHash = createHash("sha256");
  hashAstValue(astHash, ast);
  return `${tokenHash}:${astHash.digest("hex")}`;
};

const extractRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Internal comment and AST/token extractor for scripts/comments.mjs." },
  },
  create(context) {
    return {
      Program(ast) {
        const outPath = process.env.MC_COMMENTS_EXTRACT_OUT;
        if (!outPath) return;
        const mode = process.env.MC_COMMENTS_EXTRACT_MODE || "comments";
        const root = process.env.MC_COMMENTS_ROOT
          ? resolve(process.env.MC_COMMENTS_ROOT)
          : DEFAULT_ROOT;
        const filename = context.filename ?? "";
        const relPath = normalizeRelPath(filename, root);
        const sourceCode = context.sourceCode;
        const source = sourceCode.text;
        const jsxEmptyRanges = collectJsxEmptyRanges(ast);

        if (mode === "verify") {
          const record = {
            file: relPath,
            verifyHash: computeVerifyHash(sourceCode, ast, jsxEmptyRanges),
          };
          appendFileSync(outPath, `${JSON.stringify(record)}\n`);
          return;
        }

        const allComments = sourceCode.getAllComments();
        const proseComments = allComments.filter((c) => !isAllowedComment(c, filename));
        const directiveCount = allComments.length - proseComments.length;
        const blocks = groupProseBlocks(source, allComments, filename, jsxEmptyRanges);
        const totalLines =
          source.length === 0 ? 0 : source.replace(/\r?\n$/, "").split(/\r?\n/).length;

        const record = {
          file: relPath,
          totalLines,
          proseTokens: proseComments.length,
          directiveCount,
          ...(mode === "strip-prep"
            ? { verifyHash: computeVerifyHash(sourceCode, ast, jsxEmptyRanges) }
            : {}),
          blocks: blocks.map((b) => ({
            file: relPath,
            line: b.line,
            end: b.end,
            start: b.start,
            stop: b.stop,
            tokens: b.tokens,
            shedLines: b.shedLines,
            trailing: b.trailing,
            jsxWrapped: b.jsxWrapped,
            kind: b.kind,
            text: b.text,
          })),
        };
        appendFileSync(outPath, `${JSON.stringify(record)}\n`);
      },
    };
  },
};

export default {
  meta: { name: "mc-comments-extract" },
  rules: {
    extract: extractRule,
  },
};
