import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { assertInsideDir } from "./voice-map.mjs";

const SOURCE_EXT = /\.[mc]?[jt]sx?$/;
const EDIT_FILE = /^src\/edit\.[mc]?[jt]s$/;
const LOOKDEV_HUB_FILE = /^src\/lookdev\.[mc]?[jt]s$/;
const PER_FRAME_FN =
  /^(?:frame|draw|render|renderFrame|tick|update|animate|step|onFrame|applyLight\w*|setLight\w*|updateLight\w*|syncLight\w*)$/i;
const REGEX_PREV_KEYWORDS = new Set([
  "return",
  "case",
  "throw",
  "in",
  "of",
  "typeof",
  "void",
  "delete",
  "yield",
  "await",
  "new",
  "else",
  "do",
]);
const REGEX_PREV_PUNCT = new Set([
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "?",
  "!",
  "~",
  "+",
  "-",
  "*",
  "%",
  "&",
  "|",
  "^",
  "=",
  "<",
  ">",
]);

function canStartRegex(codeOnly) {
  let k = codeOnly.length - 1;
  while (k >= 0 && /\s/.test(codeOnly[k])) k--;
  if (k < 0) return true;
  const ch = codeOnly[k];
  if (REGEX_PREV_PUNCT.has(ch)) {
    if ((ch === "+" || ch === "-") && k > 0 && codeOnly[k - 1] === ch) return false;
    return true;
  }
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let start = k;
    while (start > 0 && /[A-Za-z0-9_$]/.test(codeOnly[start - 1])) start--;
    let prev = start - 1;
    while (prev >= 0 && /\s/.test(codeOnly[prev])) prev--;
    if (prev >= 0 && codeOnly[prev] === ".") return false;
    return REGEX_PREV_KEYWORDS.has(codeOnly.slice(start, k + 1));
  }
  return false;
}

function scanRegexLiteral(src, start) {
  let noComments = "/";
  let codeOnly = "/";
  let i = start + 1;
  let inClass = false;
  let closed = false;

  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n" || ch === "\r") break;
    if (ch === "\\" && i + 1 < src.length && src[i + 1] !== "\n" && src[i + 1] !== "\r") {
      noComments += ch + src[i + 1];
      codeOnly += "  ";
      i += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      noComments += ch;
      codeOnly += " ";
      i++;
      continue;
    }
    if (ch === "]" && inClass) {
      inClass = false;
      noComments += ch;
      codeOnly += " ";
      i++;
      continue;
    }
    if (ch === "/" && !inClass) {
      noComments += "/";
      codeOnly += "/";
      i++;
      closed = true;
      break;
    }
    noComments += ch;
    codeOnly += " ";
    i++;
  }

  if (!closed) return null;

  while (i < src.length && /[a-zA-Z]/.test(src[i])) {
    noComments += src[i];
    codeOnly += src[i];
    i++;
  }
  return { noComments, codeOnly, nextIndex: i };
}

function readTemplateSegment(src, start) {
  let noComments = "";
  let codeOnly = "";
  let i = start;
  let openedExpr = false;
  const contentStart = start;
  let contentEnd = start;

  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      noComments += ch + src[i + 1];
      codeOnly += src[i + 1] === "\n" ? " \n" : "  ";
      i += 2;
      contentEnd = i;
      continue;
    }
    if (ch === "`") {
      contentEnd = i;
      noComments += "`";
      codeOnly += "`";
      i++;
      break;
    }
    if (ch === "$" && src[i + 1] === "{") {
      contentEnd = i;
      noComments += "${";
      codeOnly += "${";
      i += 2;
      openedExpr = true;
      break;
    }
    noComments += ch;
    codeOnly += ch === "\n" ? "\n" : " ";
    i++;
    contentEnd = i;
  }

  return { noComments, codeOnly, nextIndex: i, openedExpr, contentStart, contentEnd };
}

function scanSource(src) {
  let noComments = "";
  let codeOnly = "";
  const literalSpans = [];
  const tplBraces = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "/" && next === "/") {
      noComments += "  ";
      codeOnly += "  ";
      i += 2;
      while (i < src.length && src[i] !== "\n") {
        noComments += " ";
        codeOnly += " ";
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      noComments += "  ";
      codeOnly += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        const keep = src[i] === "\n" ? "\n" : " ";
        noComments += keep;
        codeOnly += keep;
        i++;
      }
      if (i < src.length) {
        noComments += "  ";
        codeOnly += "  ";
        i += 2;
      }
      continue;
    }

    if (ch === "/" && canStartRegex(codeOnly)) {
      const re = scanRegexLiteral(src, i);
      if (re) {
        noComments += re.noComments;
        codeOnly += re.codeOnly;
        i = re.nextIndex;
        continue;
      }
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      noComments += quote;
      codeOnly += quote;
      i++;
      const contentStart = i;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          noComments += src[i] + src[i + 1];
          codeOnly += src[i + 1] === "\n" ? " \n" : "  ";
          i += 2;
          continue;
        }
        noComments += src[i];
        codeOnly += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      literalSpans.push([contentStart, i]);
      if (i < src.length) {
        noComments += quote;
        codeOnly += quote;
        i++;
      }
      continue;
    }

    if (ch === "`") {
      noComments += "`";
      codeOnly += "`";
      i++;
      const res = readTemplateSegment(src, i);
      noComments += res.noComments;
      codeOnly += res.codeOnly;
      if (res.contentEnd > res.contentStart) literalSpans.push([res.contentStart, res.contentEnd]);
      i = res.nextIndex;
      if (res.openedExpr) tplBraces.push(0);
      continue;
    }

    if (tplBraces.length > 0) {
      if (ch === "{") {
        tplBraces[tplBraces.length - 1]++;
      } else if (ch === "}") {
        if (tplBraces[tplBraces.length - 1] === 0) {
          tplBraces.pop();
          noComments += "}";
          codeOnly += "}";
          i++;
          const res = readTemplateSegment(src, i);
          noComments += res.noComments;
          codeOnly += res.codeOnly;
          if (res.contentEnd > res.contentStart)
            literalSpans.push([res.contentStart, res.contentEnd]);
          i = res.nextIndex;
          if (res.openedExpr) tplBraces.push(0);
          continue;
        }
        tplBraces[tplBraces.length - 1]--;
      }
    }

    noComments += ch;
    codeOnly += ch;
    i++;
  }

  return { noComments, codeOnly, literalSpans };
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function findMatchingParen(codeOnly, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < codeOnly.length; i++) {
    const ch = codeOnly[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripTrailingParens(text) {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(")")) return null;
  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) return trimmed.slice(0, i).trimEnd();
    }
  }
  return null;
}

function stripTrailingReturnType(text) {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(")")) {
    const beforeGroup = stripTrailingParens(trimmed);
    if (beforeGroup !== null && beforeGroup.endsWith(":")) {
      const beforeColon = beforeGroup.slice(0, -1).trimEnd();
      if (beforeColon.endsWith(")")) return beforeColon;
    }
    return trimmed;
  }
  let parenDepth = 0;
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch === ")") parenDepth++;
    else if (ch === "(") {
      if (parenDepth === 0) break;
      parenDepth--;
    } else if (ch === ">") {
      if (trimmed[i - 1] !== "=") angleDepth++;
    } else if (ch === "<") angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === "]") bracketDepth++;
    else if (ch === "[") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === "}") braceDepth++;
    else if (ch === "{") {
      if (braceDepth === 0) break;
      braceDepth--;
    } else if (
      ch === ";" &&
      parenDepth === 0 &&
      angleDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      break;
    } else if (
      ch === ":" &&
      parenDepth === 0 &&
      angleDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      const beforeColon = trimmed.slice(0, i).trimEnd();
      if (beforeColon.endsWith(")")) return beforeColon;
      break;
    }
  }
  return trimmed;
}

function extractAssignedName(head) {
  const assignTail = /=\s*(?:async\s+)?$/.exec(head);
  if (assignTail) {
    const lhs = head.slice(0, assignTail.index);
    let declStart = lhs.length;
    let parenDepth = 0;
    let braceDepth = 0;
    for (let i = lhs.length - 1; i >= 0; i--) {
      const ch = lhs[i];
      if (ch === ")") parenDepth++;
      else if (ch === "(") parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === "}") braceDepth++;
      else if (ch === "{") {
        if (braceDepth === 0) break;
        braceDepth--;
      } else if ((ch === ";" || ch === "\n") && parenDepth === 0 && braceDepth === 0) {
        break;
      }
      declStart = i;
    }
    const typedDecl = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:/.exec(
      lhs.slice(declStart),
    );
    if (typedDecl) return typedDecl[1];
  }

  const direct = /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?$/.exec(head);
  return direct ? direct[1] : null;
}

function isInsideUnclosedCall(head, callPattern) {
  let lastOpen = -1;
  for (const match of head.matchAll(callPattern)) {
    lastOpen = match.index + match[0].length - 1;
  }
  if (lastOpen < 0) return false;
  let depth = 0;
  for (let i = lastOpen; i < head.length; i++) {
    if (head[i] === "(") depth++;
    else if (head[i] === ")") {
      depth--;
      if (depth === 0) return false;
    }
  }
  return depth > 0;
}

function isPerFrameCallbackContext(head, enclosingFn) {
  if (enclosingFn === "buildScene" && /\breturn\s*$/.test(head)) return true;
  if (isInsideUnclosedCall(head, /\brequestAnimationFrame\s*\(/g)) return true;
  if (isInsideUnclosedCall(head, /\bmakeTransitions\s*\(/g)) return true;
  return false;
}

function classifyArrowHead(beforeArrow, enclosingFn) {
  const noRet = stripTrailingReturnType(beforeArrow);
  const beforeParams = stripTrailingParens(noRet);
  if (beforeParams !== null) {
    if (isPerFrameCallbackContext(beforeParams, enclosingFn)) return "perFrameFn";
    const assigned = extractAssignedName(beforeParams);
    if (assigned) {
      if (assigned === "buildScene") return "buildScene";
      if (PER_FRAME_FN.test(assigned)) return "perFrameFn";
    }
    return "fn";
  }
  const singleArg = /([A-Za-z_$][\w$]*)\s*$/.exec(beforeArrow);
  const beforeSingle = singleArg ? beforeArrow.slice(0, singleArg.index).trimEnd() : beforeArrow;
  if (isPerFrameCallbackContext(beforeSingle, enclosingFn)) return "perFrameFn";
  const assignedSingle = extractAssignedName(beforeSingle);
  if (assignedSingle) {
    if (assignedSingle === "buildScene") return "buildScene";
    if (PER_FRAME_FN.test(assignedSingle)) return "perFrameFn";
  }
  return "fn";
}

function nearestEnclosingFn(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === "buildScene" || stack[i] === "perFrameFn" || stack[i] === "fn") {
      return stack[i];
    }
  }
  return null;
}

function classifyBraceScope(codeOnly, braceIndex, enclosingFn) {
  const before = codeOnly.slice(Math.max(0, braceIndex - 260), braceIndex).trimEnd();
  if (/\bdo$/.test(before)) return "loop";

  if (before.endsWith("=>")) {
    return classifyArrowHead(before.slice(0, -2).trimEnd(), enclosingFn);
  }

  const withoutRetType = stripTrailingReturnType(before);
  const beforeParens = stripTrailingParens(withoutRetType);
  if (beforeParens !== null) {
    if (/\b(?:for|while)$/.test(beforeParens)) return "loop";
    const fnDecl = /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)$/.exec(beforeParens);
    if (fnDecl) {
      const beforeFn = beforeParens.slice(0, fnDecl.index).trimEnd();
      if (isPerFrameCallbackContext(beforeFn, enclosingFn)) return "perFrameFn";
      const assigned = extractAssignedName(beforeFn);
      if (assigned === "buildScene" || fnDecl[1] === "buildScene") return "buildScene";
      if ((assigned && PER_FRAME_FN.test(assigned)) || PER_FRAME_FN.test(fnDecl[1]))
        return "perFrameFn";
      return "fn";
    }
    const anonFn = /\b(?:async\s+)?function\s*\*?$/.exec(beforeParens);
    if (anonFn) {
      const beforeAnon = beforeParens.slice(0, anonFn.index).trimEnd();
      if (isPerFrameCallbackContext(beforeAnon, enclosingFn)) return "perFrameFn";
      const assigned = extractAssignedName(beforeAnon);
      if (assigned === "buildScene") return "buildScene";
      if (assigned && PER_FRAME_FN.test(assigned)) return "perFrameFn";
      return "fn";
    }
    const methodDecl = /(?:^|[{;,\n]\s*)(?:async\s+)?([A-Za-z_$][\w$]*)$/.exec(beforeParens);
    if (methodDecl && !/^(?:if|for|while|switch|catch|with)$/.test(methodDecl[1])) {
      if (methodDecl[1] === "buildScene") return "buildScene";
      if (PER_FRAME_FN.test(methodDecl[1])) return "perFrameFn";
      return "fn";
    }
  }

  return "block";
}

function crossesAsiStatement(gap) {
  const body = gap.replace(/^(?:[ \t]*\r?\n)+/, "");
  const nl = body.indexOf("\n");
  if (nl < 0) return false;
  const firstLine = body.slice(0, nl).trimEnd();
  if (!firstLine) return false;
  if (/[([,?:&|=+-]$/.test(firstLine)) return false;
  return true;
}

function isPerFrameAllocation(codeOnly, index) {
  const stack = [];
  for (let i = 0; i < index; i++) {
    const ch = codeOnly[i];
    if (ch === "{") {
      stack.push(classifyBraceScope(codeOnly, i, nearestEnclosingFn(stack)));
    } else if (ch === "}" && stack.length > 0) {
      stack.pop();
    }
  }

  if (stack.includes("loop") || stack.includes("perFrameFn")) return true;

  let stmtStart = index;
  let parenDepth = 0;
  while (stmtStart > 0) {
    const ch = codeOnly[stmtStart - 1];
    if (ch === ")") {
      parenDepth++;
    } else if (ch === "(") {
      if (parenDepth > 0) parenDepth--;
    } else if (parenDepth === 0 && ";{}".includes(ch)) {
      break;
    }
    stmtStart--;
  }
  const stmtPrefix = codeOnly.slice(stmtStart, index);

  for (const loopMatch of stmtPrefix.matchAll(/\b(?:for|while)\s*\(/g)) {
    const openIdx = stmtStart + loopMatch.index + loopMatch[0].length - 1;
    const closeIdx = findMatchingParen(codeOnly, openIdx);
    if (closeIdx >= 0 && closeIdx < index) {
      const gap = codeOnly.slice(closeIdx + 1, index);
      if (!/[{;]/.test(gap) && !crossesAsiStatement(gap)) {
        return true;
      }
    }
  }

  const arrowIdx = stmtPrefix.lastIndexOf("=>");
  if (arrowIdx >= 0) {
    const gap = stmtPrefix.slice(arrowIdx + 2);
    if (!/[{;]/.test(gap) && !crossesAsiStatement(gap)) {
      const scope = classifyArrowHead(
        stmtPrefix.slice(0, arrowIdx).trimEnd(),
        nearestEnclosingFn(stack),
      );
      if (scope === "perFrameFn") return true;
    }
  }

  return false;
}

function maskStringHookCalls(noComments, codeOnly) {
  const chars = noComments.split("");
  for (const match of codeOnly.matchAll(/\.(?:replace|replaceAll|includes|indexOf)\s*\(/g)) {
    const openIdx = match.index + match[0].length - 1;
    const closeIdx = findMatchingParen(codeOnly, openIdx);
    if (closeIdx < 0) continue;
    for (let i = openIdx + 1; i < closeIdx; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

function stripGlslComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/" && text[i + 1] === "/") {
      out += "  ";
      i += 2;
      while (i < text.length && text[i] !== "\n" && !(text[i] === "\\" && text[i + 1] === "n")) {
        out += " ";
        i++;
      }
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function collectSourceFiles(projectDir) {
  const srcDir = join(projectDir, "src");
  if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const entries = readdirSync(srcDir, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
    const abs = join(entry.parentPath, entry.name);
    const rel = relative(projectDir, abs).replaceAll("\\", "/");
    const raw = readFileSync(abs, "utf8");
    const { noComments, codeOnly, literalSpans } = scanSource(raw);
    files.push({ rel, noComments, codeOnly, literalSpans });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

function countLightKeys(lightsPath) {
  try {
    const doc = JSON.parse(readFileSync(lightsPath, "utf8"));
    if (Array.isArray(doc)) return doc.length;
    if (doc && typeof doc === "object" && Array.isArray(doc.keys)) return doc.keys.length;
    return 0;
  } catch {
    return 0;
  }
}

export function lookdevWarnings(projectDir, conf = {}) {
  const files = collectSourceFiles(projectDir);
  if (!files.length) return [];

  const warnings = [];
  const sceneFiles = files.filter((f) => !EDIT_FILE.test(f.rel) && !LOOKDEV_HUB_FILE.test(f.rel));
  const usesVsm = files.some((f) => /\bVSMShadowMap\b/.test(f.codeOnly));
  const usesPostPipeline = sceneFiles.some((f) =>
    /\b(?:EffectComposer|createPostPipeline|setupLookdev)\b/.test(f.codeOnly),
  );

  for (const file of files) {
    const { rel, noComments, codeOnly, literalSpans } = file;

    for (const match of codeOnly.matchAll(/\bPCFSoftShadowMap\b/g)) {
      const line = lineAt(codeOnly, match.index);
      warnings.push(
        `⚠ ${rel}:${line}: uses deprecated PCFSoftShadowMap (Three.js r187 uses THREE.PCFShadowMap + shadow.radius 1.5–3.5); use createFilmRenderer from "film-stage/post" (or src/lookdev.ts)`,
      );
    }

    if (!usesVsm) {
      for (const match of codeOnly.matchAll(/\.shadow\.radius\s*=\s*(\d+(?:\.\d+)?)\b/g)) {
        const radius = Number(match[1]);
        if (radius > 4) {
          const line = lineAt(codeOnly, match.index);
          warnings.push(
            `⚠ ${rel}:${line}: shadow.radius = ${match[1]} exceeds 4 on PCFShadowMap (causes 5-sample PCF edge grain); keep 1.5–3.5 or use createLightingRig from "film-stage/lights"`,
          );
        }
      }
    }

    for (const match of codeOnly.matchAll(
      /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=;]+)?\s*=\s*|(?<![.\w$])([A-Za-z_$][\w$]*)\s*=\s*)?\bnew\s+(?:THREE\.)?PMREMGenerator\s*\(/g,
    )) {
      const varName = match[1] || match[2] || null;
      const openIdx = match.index + match[0].length - 1;
      const closeIdx = findMatchingParen(codeOnly, openIdx);
      const afterCtor = closeIdx >= 0 ? codeOnly.slice(closeIdx + 1) : "";
      const immediateDispose = /^\s*\.\s*dispose\s*\(/.test(afterCtor);
      const chainedOther = /^\s*\.\s*(?!dispose\b)[A-Za-z_$]/.test(afterCtor);

      let disposed = false;
      if (immediateDispose) {
        disposed = true;
      } else if (!chainedOther && varName) {
        const escapedName = varName.replaceAll("$", "\\$");
        disposed = new RegExp(
          `(?<![A-Za-z0-9_$])${escapedName}\\s*[!?]?\\.\\s*dispose\\s*\\(`,
        ).test(codeOnly);
      }

      if (!disposed) {
        const line = lineAt(codeOnly, match.index);
        warnings.push(
          `⚠ ${rel}:${line}: un-disposed PMREMGenerator leaks GPU memory; call .dispose() or use createEnvironment / createSkyEnvironment / bakeSceneProbe from "film-stage/lights" (src/lookdev.ts)`,
        );
      }
    }

    for (const match of codeOnly.matchAll(/\bnew\s+(?:THREE\.)?(Fog(?:Exp2)?)\s*\(/g)) {
      if (isPerFrameAllocation(codeOnly, match.index)) {
        const line = lineAt(codeOnly, match.index);
        warnings.push(
          `⚠ ${rel}:${line}: allocates new THREE.${match[1]}(...) inside a per-frame callback/loop; reuse one Fog instance or use createLightingRig / applySetLight from "film-stage/lights" (src/lookdev.ts)`,
        );
      }
    }

    if (
      usesPostPipeline &&
      (/\b(?:Raw)?ShaderMaterial\b/.test(codeOnly) || /\bfragmentShader\s*:/.test(codeOnly))
    ) {
      const masked = maskStringHookCalls(noComments, codeOnly);
      const chunks = new Set();
      let firstLine = 0;
      for (const [spanStart, spanEnd] of literalSpans) {
        const body = stripGlslComments(masked.slice(spanStart, spanEnd));
        for (const m of body.matchAll(/#include\s*<(tonemapping_fragment|colorspace_fragment)>/g)) {
          if (!firstLine) firstLine = lineAt(masked, spanStart + m.index);
          chunks.add(m[1]);
        }
      }
      if (chunks.size > 0) {
        const list = [...chunks].map((c) => `#include <${c}>`).join(", ");
        warnings.push(
          `⚠ ${rel}:${firstLine}: custom shader includes ${list} inside EffectComposer/post pipeline (double tone-map/sRGB linear-HDR hazard); keep custom shaders linear HDR or use film-stage/sky / film-stage/surfaces (src/lookdev.ts)`,
        );
      }
    }

    const composerMatch = /\bnew\s+EffectComposer\s*\(/.exec(codeOnly);
    if (composerMatch && /\bnew\s+N8AOPostPass\s*\(/.test(codeOnly)) {
      const line = lineAt(codeOnly, composerMatch.index);
      warnings.push(
        `⚠ ${rel}:${line}: hand-rolled EffectComposer + N8AOPostPass pipeline boilerplate; use setupLookdev from "./lookdev" or createPostPipeline from "film-stage/post"`,
      );
    }
  }

  const lightsRel =
    typeof conf?.lightsTimeline === "string" && conf.lightsTimeline
      ? conf.lightsTimeline
      : "src/timeline/lights.json";
  let lightsAbs = null;
  try {
    lightsAbs = assertInsideDir(projectDir, lightsRel, "Lights timeline");
  } catch {
    lightsAbs = null;
  }
  if (lightsAbs && existsSync(lightsAbs)) {
    const keyCount = countLightKeys(lightsAbs);
    if (keyCount > 0) {
      const escapedBase = basename(lightsRel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const importRe = new RegExp(
        `\\bimport\\b[^;\\n]*\\bfrom\\s*["'](?:[^"'\\n]*[/\\\\])?${escapedBase}["']`,
      );
      const globRe = new RegExp(
        `\\bimport\\.meta\\.glob\\s*\\([^)]*["'](?:[^"'\\n]*[/\\\\])?${escapedBase}["']`,
      );
      const readsLights = sceneFiles.some(
        (f) =>
          /\bEDIT\s*\??\.\s*lights\b|\b(?:lightsAt|applyLightingRig|updateLighting)\b/.test(
            f.codeOnly,
          ) ||
          importRe.test(f.noComments) ||
          globRe.test(f.noComments),
      );
      if (!readsLights) {
        warnings.push(
          `⚠ ${lightsRel}: timeline has ${keyCount} light key${keyCount === 1 ? "" : "s"}, but scene code never reads EDIT.lights, lightsAt, applyLightingRig, or lookdev.updateLighting (breaks Studio LightPanel); wire lighting via src/lookdev.ts or remove ${lightsRel}`,
        );
      }
    }
  }

  return warnings;
}
