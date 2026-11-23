import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isAllowedComment, normalizeRelPath } from "./comment-rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");
const DEFAULT_RATCHET = resolve(HERE, "comment-ratchet.json");

const loadRatchet = () => {
  const ratchetPath = process.env.MC_COMMENTS_RATCHET || DEFAULT_RATCHET;
  if (!existsSync(ratchetPath)) return {};
  const parsed = JSON.parse(readFileSync(ratchetPath, "utf8"));
  if (
    !parsed ||
    typeof parsed.files !== "object" ||
    parsed.files === null ||
    Array.isArray(parsed.files)
  ) {
    throw new Error(`Invalid comment ratchet schema in ${ratchetPath}: expected "files" object`);
  }
  return parsed.files;
};

const RATCHET_FILES = loadRatchet();
const REPO_ROOT = process.env.MC_COMMENTS_ROOT
  ? resolve(process.env.MC_COMMENTS_ROOT)
  : DEFAULT_ROOT;

const noCommentsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban prose comments with a strict per-file ratchet ceiling for legacy comments.",
    },
    messages: {
      banned:
        "Comments are banned. Express intent in names, types or tests, or move decisions to docs/adr/.",
      ratchetExceeded:
        "File has {{actual}} prose comments (ratchet ceiling is {{ceiling}}). Delete added comments.",
      ratchetStale:
        "File dropped from {{ceiling}} to {{actual}} prose comments. Run `bun run comments ratchet` to tighten scripts/lint/comment-ratchet.json.",
    },
  },
  create(context) {
    return {
      Program() {
        const filename = context.filename ?? "";
        const relPath = normalizeRelPath(filename, REPO_ROOT);
        const rawCeiling = Object.hasOwn(RATCHET_FILES, relPath) ? RATCHET_FILES[relPath] : 0;
        const ceiling = Number.isInteger(rawCeiling) && rawCeiling > 0 ? rawCeiling : 0;
        const prose = context.sourceCode
          .getAllComments()
          .filter((comment) => !isAllowedComment(comment, filename));

        if (prose.length > ceiling) {
          if (ceiling === 0) {
            for (const comment of prose) {
              context.report({ loc: comment.loc, messageId: "banned" });
            }
          } else {
            for (const comment of prose.slice(ceiling)) {
              context.report({
                loc: comment.loc,
                messageId: "ratchetExceeded",
                data: { actual: String(prose.length), ceiling: String(ceiling) },
              });
            }
          }
          return;
        }

        if (prose.length < ceiling) {
          const loc = prose[0]?.loc ?? {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 0 },
          };
          context.report({
            loc,
            messageId: "ratchetStale",
            data: { actual: String(prose.length), ceiling: String(ceiling) },
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "mc-comments" },
  rules: {
    "no-comments": noCommentsRule,
  },
};
