import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { normalizeRelPath } from "./comment-rules.mjs";

const runPython = (script, inputObj, workRoot) => {
  const input = JSON.stringify(inputObj);
  const opts = {
    cwd: workRoot,
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: "1" },
  };
  let res = spawnSync("python", ["-X", "utf8", "-c", script], opts);
  if (res.error?.code === "ENOENT") {
    res = spawnSync("python3", ["-X", "utf8", "-c", script], opts);
  }
  return res;
};

const PY_SCAN_SCRIPT = `
import ast, io, json, re, sys, tokenize

DIRECTIVE_RE = re.compile(
    r"^#[ \\t]*(?:type:[ \\t]*ignore(?:$|\\s|\\[)|noqa(?:$|\\s|:)|pyright:|ruff:|pylint:|pragma:|fmt:|isort:|mypy:|coding[:=]|-\\*-)"
)

for path in json.load(sys.stdin):
    try:
        raw = open(path, "rb").read()
        text = raw.decode("utf-8")
    except Exception as exc:
        print(json.dumps({"path": path, "error": str(exc)}))
        continue
    if text.startswith("\\ufeff"):
        text = text[1:]
    try:
        ast.parse(text, filename=path)
    except SyntaxError as exc:
        print(json.dumps({"path": path, "error": f"SyntaxError: {exc}"}))
        continue
    lines = io.StringIO(text).readlines()
    directives = 0
    tokens = 0
    blocks = []
    cur = None
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type != tokenize.COMMENT:
                continue
            line_no, col = tok.start
            end_line, end_col = tok.end
            val = tok.string
            if line_no == 1 and col == 0 and val.startswith("#!"):
                directives += 1
                cur = None
                continue
            if DIRECTIVE_RE.match(val):
                directives += 1
                cur = None
                continue
            tokens += 1
            before = lines[line_no - 1][:col].strip() if line_no - 1 < len(lines) else ""
            standalone = before == ""
            span = {"line": line_no, "col": col, "endCol": end_col, "raw": val}
            if cur and standalone and cur["standalone"] and line_no == cur["end"] + 1 and col == cur["col"]:
                cur["end"] = end_line
                cur["tokens"] += 1
                cur["shedLines"] += 1
                cur["spans"].append(span)
                cur["text"] = cur["text"] + "\\n" + val
            else:
                cur = {
                    "line": line_no,
                    "end": end_line,
                    "col": col,
                    "tokens": 1,
                    "shedLines": 1 if standalone else 0,
                    "trailing": not standalone,
                    "standalone": standalone,
                    "kind": "line",
                    "text": val,
                    "spans": [span],
                }
                blocks.append(cur)
                if not standalone:
                    cur = None
    except (tokenize.TokenError, IndentationError) as exc:
        print(json.dumps({"path": path, "error": f"TokenError: {exc}"}))
        continue
    shed_total = sum(b["shedLines"] for b in blocks)
    print(json.dumps({
        "path": path,
        "loc": len(lines),
        "tokens": tokens,
        "directives": directives,
        "shedLines": shed_total,
        "blocks": blocks,
    }))
`;

const PY_STRIP_SCRIPT = `
import ast, io, json, sys

for task in json.load(sys.stdin):
    path = task["absPath"]
    rel = task["file"]
    try:
        orig_raw = open(path, "rb").read().decode("utf-8")
    except Exception as exc:
        print(json.dumps({"file": rel, "ok": False, "error": str(exc)}))
        continue
    has_bom = orig_raw.startswith("\\ufeff")
    orig_text = orig_raw[1:] if has_bom else orig_raw
    had_trailing_nl = orig_text.endswith("\\n")
    lines = io.StringIO(orig_text).readlines()

    full_delete = set()
    inline_edits = {}
    for blk in task["blocks"]:
        for sp in blk["spans"]:
            if blk["standalone"]:
                full_delete.add(sp["line"])
            else:
                inline_edits[sp["line"]] = sp["col"]

    out_lines = []
    for ln, line in enumerate(lines, start=1):
        if ln in full_delete:
            continue
        if ln in inline_edits:
            col = inline_edits[ln]
            eol = "\\r\\n" if line.endswith("\\r\\n") else ("\\n" if line.endswith("\\n") else "")
            prefix = line[:col].rstrip(" \\t")
            out_lines.append(prefix + eol)
        else:
            out_lines.append(line)

    new_text = "".join(out_lines)
    if had_trailing_nl and new_text and not new_text.endswith("\\n"):
        eol = "\\r\\n" if "\\r\\n" in orig_text else "\\n"
        new_text += eol

    try:
        before_ast = ast.dump(ast.parse(orig_text, filename=rel))
        after_ast = ast.dump(ast.parse(new_text, filename=rel))
    except SyntaxError as exc:
        print(json.dumps({"file": rel, "ok": False, "error": f"SyntaxError: {exc}"}))
        continue

    if before_ast != after_ast:
        print(json.dumps({"file": rel, "ok": False, "error": "AST changed after stripping"}))
        continue

    candidate = ("\\ufeff" + new_text) if has_bom else new_text
    print(json.dumps({"file": rel, "ok": True, "candidate": candidate}))
`;

export const scanPyFiles = (pyAbsPaths, workRoot) => {
  if (pyAbsPaths.length === 0) return { ok: true, records: [], error: "" };
  const res = runPython(PY_SCAN_SCRIPT, pyAbsPaths, workRoot);
  if (res.status !== 0) {
    return {
      ok: false,
      records: [],
      error: res.error?.message || res.stderr?.trim() || `python exited ${res.status}`,
    };
  }
  const records = [];
  const rawLines = res.stdout ? res.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  for (const line of rawLines) {
    const rec = JSON.parse(line);
    const file = normalizeRelPath(rec.path, workRoot);
    if (rec.error) {
      return { ok: false, records: [], error: `${file}: ${rec.error}` };
    }
    const blocks = rec.blocks.map((b) => ({ ...b, file }));
    records.push({
      file,
      lang: "py",
      loc: rec.loc,
      tokens: rec.tokens,
      directives: rec.directives,
      shedLines: rec.shedLines,
      blocks,
    });
  }
  return { ok: true, records, error: "" };
};

export const stripPyFiles = (tasks, workRoot) => {
  if (tasks.length === 0) return { ok: true, results: [], error: "" };
  const res = runPython(PY_STRIP_SCRIPT, tasks, workRoot);
  if (res.status !== 0) {
    return {
      ok: false,
      results: [],
      error: res.error?.message || res.stderr?.trim() || `python exited ${res.status}`,
    };
  }
  const results = res.stdout
    ? res.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { ok: true, results, error: "" };
};

const isCssIdent = (c) => /[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80;

export const scanCssFile = (rawSrc, relFile = "") => {
  const src = rawSrc.startsWith("\uFEFF") ? rawSrc.slice(1) : rawSrc;
  const lines = src.length === 0 ? [] : src.replace(/\r?\n$/, "").split(/\r?\n/);
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) starts.push(i + 1);
  }
  const offsetToLine = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi + 1;
  };

  const blocks = [];
  let shedTotal = 0;
  let i = 0;
  let quote = "";
  let quoteStartLine = 0;
  let openBraces = 0;
  let closeBraces = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\" && i + 1 < src.length) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoteStartLine = offsetToLine(i);
      i++;
      continue;
    }
    if (ch === "{") {
      openBraces++;
      i++;
      continue;
    }
    if (ch === "}") {
      closeBraces++;
      i++;
      continue;
    }
    if (
      (ch === "u" || ch === "U") &&
      src.slice(i, i + 4).toLowerCase() === "url(" &&
      (i === 0 || !isCssIdent(src[i - 1]))
    ) {
      let j = i + 4;
      while (j < src.length && /[ \t\r\n\f]/.test(src[j])) j++;
      if (j < src.length && src[j] !== '"' && src[j] !== "'") {
        const urlStartLine = offsetToLine(i);
        while (j < src.length && src[j] !== ")") {
          if (src[j] === "\\" && j + 1 < src.length) {
            j += 2;
            continue;
          }
          j++;
        }
        if (j >= src.length) {
          return {
            file: relFile,
            lang: "css",
            error: `Unclosed CSS url() starting at line ${urlStartLine}`,
            loc: lines.length,
            tokens: 0,
            directives: 0,
            shedLines: 0,
            blocks: [],
            openBraces,
            closeBraces,
          };
        }
        i = j + 1;
        continue;
      }
    }
    if (ch === "/" && src[i + 1] === "*") {
      const start = i;
      const closeIdx = src.indexOf("*/", i + 2);
      if (closeIdx === -1) {
        return {
          file: relFile,
          lang: "css",
          error: `Unclosed CSS comment starting at line ${offsetToLine(start)}`,
          loc: lines.length,
          tokens: 0,
          directives: 0,
          shedLines: 0,
          blocks: [],
          openBraces,
          closeBraces,
        };
      }
      const end = closeIdx + 2;
      const startLine = offsetToLine(start);
      const endLine = offsetToLine(Math.max(start, end - 1));
      const firstLineStart = starts[startLine - 1] ?? 0;
      const nextAfterEnd = starts[endLine] ?? src.length;
      let lastLineEnd = nextAfterEnd;
      if (lastLineEnd > 0 && src.charCodeAt(lastLineEnd - 1) === 10) lastLineEnd--;
      if (lastLineEnd > 0 && src.charCodeAt(lastLineEnd - 1) === 13) lastLineEnd--;
      const before = src.slice(firstLineStart, start).trim();
      const after = src.slice(end, lastLineEnd).trim();
      const standalone = before.length === 0 && after.length === 0;
      const span = endLine - startLine + 1;
      const shedLines = standalone ? span : Math.max(0, span - 1);
      shedTotal += shedLines;
      blocks.push({
        file: relFile,
        line: startLine,
        end: endLine,
        tokens: 1,
        shedLines,
        trailing: !standalone,
        kind: "block",
        text: src.slice(start, end),
        startOffset: start,
        endOffset: end,
      });
      i = end;
      continue;
    }
    i++;
  }

  if (quote) {
    return {
      file: relFile,
      lang: "css",
      error: `Unclosed CSS string literal starting at line ${quoteStartLine}`,
      loc: lines.length,
      tokens: 0,
      directives: 0,
      shedLines: 0,
      blocks: [],
      openBraces,
      closeBraces,
    };
  }

  return {
    file: relFile,
    lang: "css",
    loc: lines.length,
    tokens: blocks.length,
    directives: 0,
    shedLines: shedTotal,
    blocks,
    openBraces,
    closeBraces,
  };
};

const cssNeedsSeparator = (leftCh, rightCh, nextRightCh) => {
  if (!leftCh || !rightCh) return false;
  if (isCssIdent(leftCh) && (isCssIdent(rightCh) || rightCh === "(")) return true;
  if ((leftCh === "%" || leftCh === ")") && isCssIdent(rightCh)) return true;
  if (/[0-9]/.test(leftCh) && rightCh === "." && /[0-9]/.test(nextRightCh)) return true;
  if (leftCh === "/" && rightCh === "*") return true;
  if (leftCh === "-" && rightCh === "-") return true;
  return false;
};

export const scanCssFiles = (cssAbsPaths, workRoot) => {
  const records = [];
  for (const absPath of cssAbsPaths) {
    const file = normalizeRelPath(absPath, workRoot);
    const parsed = scanCssFile(readFileSync(absPath, "utf8"), file);
    if (parsed.error) {
      return { ok: false, records: [], error: `${file}: ${parsed.error}` };
    }
    records.push(parsed);
  }
  return { ok: true, records, error: "" };
};

export const stripCssFile = (rawOriginal, matchedBlocks, relFile = "") => {
  const hasBom = rawOriginal.startsWith("\uFEFF");
  const origText = hasBom ? rawOriginal.slice(1) : rawOriginal;
  const beforeScan = scanCssFile(origText, relFile);
  if (beforeScan.error) return { ok: false, error: beforeScan.error };

  const hadTrailingNl = origText.endsWith("\n");
  let text = origText;
  const sorted = [...matchedBlocks].sort((a, b) => b.startOffset - a.startOffset);
  for (const blk of sorted) {
    const s = blk.startOffset;
    const e = blk.endOffset;
    const lineStart = text.lastIndexOf("\n", s - 1) + 1;
    const nlAfter = text.indexOf("\n", e);
    const lineEnd = nlAfter === -1 ? text.length : nlAfter + 1;
    const beforeOnLine = text.slice(lineStart, s);
    const afterOnLine = text.slice(e, nlAfter === -1 ? text.length : nlAfter);
    if (beforeOnLine.trim() === "" && afterOnLine.trim() === "") {
      let delStart = lineStart;
      if (nlAfter === -1 && delStart > 0) {
        if (text.charCodeAt(delStart - 1) === 10) delStart--;
        if (delStart > 0 && text.charCodeAt(delStart - 1) === 13) delStart--;
      }
      text = text.slice(0, delStart) + text.slice(lineEnd);
    } else if (afterOnLine.trim() === "") {
      let trimS = s;
      while (trimS > lineStart && (text[trimS - 1] === " " || text[trimS - 1] === "\t")) trimS--;
      let restStart = nlAfter === -1 ? text.length : nlAfter;
      if (nlAfter !== -1 && restStart > e && text[restStart - 1] === "\r") restStart--;
      text = text.slice(0, trimS) + text.slice(restStart);
    } else if (beforeOnLine.trim() === "") {
      let trimE = e;
      while (trimE < text.length && (text[trimE] === " " || text[trimE] === "\t")) trimE++;
      text = text.slice(0, s) + text.slice(trimE);
    } else {
      const hasSpaceBefore = s > lineStart && /[ \t]/.test(text[s - 1]);
      const hasSpaceAfter = e < text.length && /[ \t]/.test(text[e]);
      let trimS = s;
      if (hasSpaceBefore && hasSpaceAfter) {
        while (trimS > lineStart && /[ \t]/.test(text[trimS - 1])) trimS--;
      }
      const leftCh = trimS > lineStart ? text[trimS - 1] : "";
      const rightCh = e < text.length ? text[e] : "";
      const nextRightCh = e + 1 < text.length ? text[e + 1] : "";
      const needSpace =
        !hasSpaceBefore && !hasSpaceAfter && cssNeedsSeparator(leftCh, rightCh, nextRightCh);
      text = text.slice(0, trimS) + (needSpace ? " " : "") + text.slice(e);
    }
  }

  if (hadTrailingNl && text.length > 0 && !text.endsWith("\n")) {
    const eol = origText.includes("\r\n") ? "\r\n" : "\n";
    text += eol;
  }

  const afterScan = scanCssFile(text, relFile);
  if (afterScan.error) return { ok: false, error: afterScan.error };
  if (
    beforeScan.openBraces !== afterScan.openBraces ||
    beforeScan.closeBraces !== afterScan.closeBraces
  ) {
    return { ok: false, error: "CSS brace balance changed after stripping" };
  }
  if (afterScan.tokens !== beforeScan.tokens - matchedBlocks.length) {
    return { ok: false, error: "CSS comment count mismatch after stripping" };
  }

  return { ok: true, candidate: hasBom ? `\uFEFF${text}` : text };
};
