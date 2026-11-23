import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { scanCssFiles, scanPyFiles, stripCssFile, stripPyFiles } from "./lint/comment-nonjs.mjs";
import { applyStrips, normalizeRelPath } from "./lint/comment-rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const EXTRACT_PLUGIN = join(HERE, "lint/oxlint-comments-extract.mjs");
const OXLINT_CLI = join(REPO_ROOT, "node_modules/oxlint/dist/cli.js");
const DEFAULT_TARGETS = ["packages", "scripts", "templates", ".claude/hooks"];
const JS_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const PY_EXTS = new Set([".py"]);
const CSS_EXTS = new Set([".css"]);
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "vault/**",
  "**/renders/**",
  "**/chunks/**",
  "**/demo/**",
  "**/test/fixtures/**",
  "films/**",
  "**/.venv/**",
];
const IGNORED_PATH_RE =
  /(?:^|\/)(?:node_modules|renders|chunks|demo|\.venv|\.git)(?:\/|$)|(?:^|\/)test\/fixtures(?:\/|$)|^(?:vault|films)(?:\/|$)/;

const HELP = `Inspect, safely strip, and ratchet code comments across the repository.

Usage:
  bun run comments list [paths...] [--out <file>]       Emit UTF-8 JSONL of prose comment blocks (excludes tool directives)
  bun run comments stats [paths...] [--json]            Show per-package comment counts and sheddable LOC estimate
  bun run comments strip <jsonl> [--dry-run]            Safely strip selected blocks after AST/token verification
  bun run comments ratchet [--check|--init] [paths...]  Tighten or check scripts/lint/comment-ratchet.json

Defaults to: ${DEFAULT_TARGETS.join(" ")}
`;

const getWorkRoot = () =>
  process.env.MC_COMMENTS_ROOT ? resolve(process.env.MC_COMMENTS_ROOT) : REPO_ROOT;

const getRatchetPath = () =>
  process.env.MC_COMMENTS_RATCHET
    ? resolve(process.env.MC_COMMENTS_RATCHET)
    : join(REPO_ROOT, "scripts/lint/comment-ratchet.json");

const resolveSafeWorkFile = (rawPath, workRoot) => {
  if (typeof rawPath !== "string" || !rawPath.trim()) return null;
  if (isAbsolute(rawPath) || /^[A-Za-z]:/.test(rawPath)) return null;
  const abs = resolve(workRoot, rawPath);
  const rel = relative(workRoot, abs);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
    return null;
  }
  return rel.replaceAll("\\", "/");
};

const isIgnoredRelPath = (rel) => IGNORED_PATH_RE.test(rel.replaceAll("\\", "/"));

const assertTargetsExist = (targets, workRoot) => {
  for (const t of targets) {
    if (!existsSync(resolve(workRoot, t))) {
      console.error(`target path not found: ${t}`);
      process.exit(2);
    }
  }
};

const resolveCliTargets = (paths, workRoot) => {
  if (paths.length > 0) {
    assertTargetsExist(paths, workRoot);
    return paths;
  }
  return DEFAULT_TARGETS.filter((t) => existsSync(resolve(workRoot, t)));
};

const cmpCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const runOxlintExtract = (targets, mode, workRoot, { applyIgnores = true } = {}) => {
  const scratch = mkdtempSync(join(tmpdir(), "mc-comments-ext-"));
  const outPath = join(scratch, "out.jsonl");
  const cfgPath = join(scratch, ".oxlintrc.json");
  writeFileSync(outPath, "");
  writeFileSync(
    cfgPath,
    JSON.stringify({
      plugins: [],
      jsPlugins: [EXTRACT_PLUGIN.replaceAll("\\", "/")],
      rules: { "mc-comments-extract/extract": "warn" },
    }),
  );

  try {
    const cliTargets = targets
      .map((t) => {
        const rel = relative(workRoot, resolve(workRoot, t)).replaceAll("\\", "/");
        return rel || ".";
      })
      .filter((t) => !applyIgnores || !isIgnoredRelPath(t));
    if (cliTargets.length === 0) {
      return { status: 0, stdout: "", stderr: "", records: [] };
    }
    const ignoreArgs = applyIgnores
      ? IGNORE_PATTERNS.flatMap((pattern) => ["--ignore-pattern", pattern])
      : [];
    const batchSize = 200;
    const stdouts = [];
    const stderrs = [];
    for (let i = 0; i < cliTargets.length; i += batchSize) {
      const batch = cliTargets.slice(i, i + batchSize);
      const res = spawnSync(
        process.execPath,
        [
          OXLINT_CLI,
          "-c",
          cfgPath,
          "--disable-nested-config",
          "--threads",
          "1",
          "-A",
          "all",
          ...ignoreArgs,
          ...batch,
        ],
        {
          cwd: workRoot,
          env: {
            ...process.env,
            MC_COMMENTS_EXTRACT_OUT: outPath,
            MC_COMMENTS_EXTRACT_MODE: mode,
            MC_COMMENTS_ROOT: workRoot,
          },
          encoding: "utf8",
          timeout: 120000,
        },
      );
      if (res.stdout) stdouts.push(res.stdout);
      if (res.stderr) stderrs.push(res.stderr);
      if ((res.status ?? 1) !== 0) {
        return {
          status: res.status ?? 1,
          stdout: stdouts.join(""),
          stderr: stderrs.join(""),
          records: [],
        };
      }
    }
    const raw = existsSync(outPath) ? readFileSync(outPath, "utf8").trim() : "";
    const records = raw
      ? raw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    return { status: 0, stdout: stdouts.join(""), stderr: stderrs.join(""), records };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const walkFilesWithExt = (targets, exts, workRoot) => {
  const realRoot = realpathSync(workRoot);
  const seenFiles = new Set();
  const seenDirs = new Set();
  const found = [];
  const visit = (absPath) => {
    if (!existsSync(absPath)) return;
    const rel = normalizeRelPath(absPath, workRoot);
    if (rel && isIgnoredRelPath(rel)) return;
    let realPath;
    try {
      realPath = realpathSync(absPath);
    } catch {
      return;
    }
    const relToRoot = relative(realRoot, realPath);
    if (
      relToRoot === ".." ||
      relToRoot.startsWith("../") ||
      relToRoot.startsWith("..\\") ||
      isAbsolute(relToRoot)
    ) {
      return;
    }
    const st = statSync(realPath);
    if (st.isFile()) {
      if (exts.has(extname(absPath).toLowerCase()) && !seenFiles.has(realPath)) {
        seenFiles.add(realPath);
        found.push(absPath);
      }
      return;
    }
    if (!st.isDirectory()) return;
    if (seenDirs.has(realPath)) return;
    seenDirs.add(realPath);
    for (const entry of readdirSync(absPath, { withFileTypes: true })) {
      visit(join(absPath, entry.name));
    }
  };
  for (const t of targets) visit(resolve(workRoot, t));
  return found.sort(cmpCodePoint);
};

const scanNonJsTargets = (targets, workRoot) => {
  const pyFiles = walkFilesWithExt(targets, PY_EXTS, workRoot);
  const cssFiles = walkFilesWithExt(targets, CSS_EXTS, workRoot);
  const pyRes = scanPyFiles(pyFiles, workRoot);
  if (!pyRes.ok) {
    console.error(`python comment scan failed: ${pyRes.error}`);
    process.exit(1);
  }
  const cssRes = scanCssFiles(cssFiles, workRoot);
  if (!cssRes.ok) {
    console.error(`css comment scan failed: ${cssRes.error}`);
    process.exit(1);
  }
  return [...pyRes.records, ...cssRes.records];
};

const atomicWriteFile = (absPath, content) => {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmpPath = join(
    dirname(absPath),
    `.${basename(absPath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, absPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      void 0;
    }
    throw err;
  }
};

const cmdList = (targets, outFile, workRoot) => {
  if (outFile !== null && !outFile.trim()) {
    console.error("--out requires a non-empty file path");
    process.exit(2);
  }
  const jsFiles = walkFilesWithExt(targets, JS_EXTS, workRoot);
  const allBlocks = [];
  if (jsFiles.length > 0) {
    const res = runOxlintExtract(targets, "comments", workRoot);
    if (res.status !== 0) {
      console.error(res.stderr || res.stdout || "oxlint extract failed");
      process.exit(1);
    }
    for (const rec of res.records) {
      for (const block of rec.blocks) allBlocks.push(block);
    }
  }
  for (const rec of scanNonJsTargets(targets, workRoot)) {
    for (const block of rec.blocks) allBlocks.push(block);
  }
  allBlocks.sort((a, b) => cmpCodePoint(a.file, b.file) || a.line - b.line);
  const outLines = allBlocks.map((block) =>
    JSON.stringify({
      file: block.file,
      line: block.line,
      end: block.end,
      tokens: block.tokens,
      shedLines: block.shedLines,
      trailing: block.trailing,
      kind: block.kind,
      text: block.text,
    }),
  );
  const payload = outLines.length > 0 ? `${outLines.join("\n")}\n` : "";
  if (outFile) {
    const absOut = resolve(workRoot, outFile);
    atomicWriteFile(absOut, payload);
    console.log(`wrote ${outLines.length} blocks to ${outFile}`);
    return;
  }
  if (payload) process.stdout.write(payload);
};

const bucketOf = (relPath) => {
  const parts = relPath.split("/");
  if (parts[0] === "packages" && parts[1]) return `packages/${parts[1]}`;
  if (parts[0] === ".claude" && parts[1]) return `.claude/${parts[1]}`;
  return parts[0] || ".";
};

const cmdStats = (targets, asJson, workRoot) => {
  const jsFiles = walkFilesWithExt(targets, JS_EXTS, workRoot);
  let jsRecords = [];
  if (jsFiles.length > 0) {
    const jsRes = runOxlintExtract(targets, "comments", workRoot);
    if (jsRes.status !== 0) {
      console.error(jsRes.stderr || jsRes.stdout || "oxlint extract failed");
      process.exit(1);
    }
    jsRecords = jsRes.records;
  }
  const nonJs = scanNonJsTargets(targets, workRoot);
  const buckets = new Map();
  const touch = (key) => {
    if (!buckets.has(key)) {
      buckets.set(key, {
        files: 0,
        filesWithComments: 0,
        loc: 0,
        blocks: 0,
        tokens: 0,
        directives: 0,
        shedLines: 0,
      });
    }
    return buckets.get(key);
  };

  let jsTotals = {
    files: 0,
    filesWithComments: 0,
    loc: 0,
    blocks: 0,
    tokens: 0,
    directives: 0,
    shedLines: 0,
  };
  for (const rec of jsRecords) {
    const b = touch(bucketOf(rec.file));
    const shed = rec.blocks.reduce((sum, blk) => sum + blk.shedLines, 0);
    b.files += 1;
    if (rec.proseTokens > 0) b.filesWithComments += 1;
    b.loc += rec.totalLines;
    b.blocks += rec.blocks.length;
    b.tokens += rec.proseTokens;
    b.directives += rec.directiveCount;
    b.shedLines += shed;

    jsTotals.files += 1;
    if (rec.proseTokens > 0) jsTotals.filesWithComments += 1;
    jsTotals.loc += rec.totalLines;
    jsTotals.blocks += rec.blocks.length;
    jsTotals.tokens += rec.proseTokens;
    jsTotals.directives += rec.directiveCount;
    jsTotals.shedLines += shed;
  }

  let nonJsTotals = {
    files: 0,
    filesWithComments: 0,
    loc: 0,
    blocks: 0,
    tokens: 0,
    directives: 0,
    shedLines: 0,
  };
  for (const rec of nonJs) {
    const b = touch(`${bucketOf(rec.file)} (${rec.lang})`);
    b.files += 1;
    if (rec.tokens > 0) b.filesWithComments += 1;
    b.loc += rec.loc;
    b.blocks += rec.blocks.length;
    b.tokens += rec.tokens;
    b.directives += rec.directives;
    b.shedLines += rec.shedLines;

    nonJsTotals.files += 1;
    if (rec.tokens > 0) nonJsTotals.filesWithComments += 1;
    nonJsTotals.loc += rec.loc;
    nonJsTotals.blocks += rec.blocks.length;
    nonJsTotals.tokens += rec.tokens;
    nonJsTotals.directives += rec.directives;
    nonJsTotals.shedLines += rec.shedLines;
  }

  const total = {
    files: jsTotals.files + nonJsTotals.files,
    filesWithComments: jsTotals.filesWithComments + nonJsTotals.filesWithComments,
    loc: jsTotals.loc + nonJsTotals.loc,
    blocks: jsTotals.blocks + nonJsTotals.blocks,
    tokens: jsTotals.tokens + nonJsTotals.tokens,
    directives: jsTotals.directives + nonJsTotals.directives,
    shedLines: jsTotals.shedLines + nonJsTotals.shedLines,
  };

  const ratchetPath = getRatchetPath();
  let ratchetFilesCount = 0;
  let ratchetTokenTotal = 0;
  if (existsSync(ratchetPath)) {
    const r = JSON.parse(readFileSync(ratchetPath, "utf8"));
    const entries = Object.values(r.files ?? {});
    ratchetFilesCount = entries.length;
    ratchetTokenTotal = entries.reduce((sum, n) => sum + Number(n), 0);
  }

  const payload = {
    jsTs: jsTotals,
    pyCss: nonJsTotals,
    total,
    ratchet: { files: ratchetFilesCount, tokens: ratchetTokenTotal },
    byScope: Object.fromEntries([...buckets.entries()].sort((a, b) => b[1].tokens - a[1].tokens)),
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  for (const [scope, st] of Object.entries(payload.byScope)) {
    console.log(
      `${scope.padEnd(28)} files:${String(st.files).padStart(4)} (w/:${String(st.filesWithComments).padStart(3)}) blocks:${String(st.blocks).padStart(4)} tokens:${String(st.tokens).padStart(4)} shed:${String(st.shedLines).padStart(4)}L`,
    );
  }
  const pct = total.loc > 0 ? ((total.shedLines / total.loc) * 100).toFixed(2) : "0.00";
  console.log(
    `TOTAL: ${total.files} files (${total.filesWithComments} w/ prose comments), ${total.blocks} blocks, ${total.tokens} tokens, ~${total.shedLines} sheddable lines (${pct}% of ${total.loc} LOC); ratchet=${ratchetTokenTotal} tokens across ${ratchetFilesCount} files`,
  );
  console.log("next: bun run comments list [paths...]  |  bun run comments ratchet --check");
};

const matchWantedBlocks = (relFile, blocks, wanted) => {
  const matched = [];
  const seenBlockIdx = new Set();
  let skipped = 0;
  for (const w of wanted) {
    const idx = blocks.findIndex((b, bi) => {
      if (seenBlockIdx.has(bi) || b.line !== w.line) return false;
      if (typeof w.text === "string") return b.text === w.text;
      return true;
    });
    if (idx === -1) {
      const anyOnLine = blocks.some((b, bi) => !seenBlockIdx.has(bi) && b.line === w.line);
      console.error(
        `skipped ${relFile}:${w.line}: ${anyOnLine ? "comment text changed since inventory" : `no comment block starts on line ${w.line}`}`,
      );
      skipped++;
      continue;
    }
    seenBlockIdx.add(idx);
    matched.push(blocks[idx]);
  }
  return { matched, skipped };
};

const cmdStrip = (jsonlPath, dryRun, workRoot) => {
  const absJsonl = resolve(workRoot, jsonlPath);
  if (!existsSync(absJsonl)) {
    console.error(`selection file not found: ${jsonlPath}`);
    process.exit(2);
  }
  const rawLines = readFileSync(absJsonl, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const wantedByFile = new Map();
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    let item;
    try {
      item = JSON.parse(line);
    } catch (err) {
      console.error(`invalid JSON on selection line ${i + 1}: ${err.message}`);
      process.exit(2);
    }
    if (
      !item ||
      typeof item !== "object" ||
      !item.file ||
      !Number.isInteger(item.line) ||
      item.line < 1
    ) {
      console.error(
        `invalid selection entry on line ${i + 1} (needs file and positive integer line)`,
      );
      process.exit(2);
    }
    if (item.text !== undefined && (typeof item.text !== "string" || item.text.length === 0)) {
      console.error(`invalid selection text on line ${i + 1}: must be a non-empty string`);
      process.exit(2);
    }
    const norm = resolveSafeWorkFile(item.file, workRoot);
    if (!norm) {
      console.error(`refusing path outside workspace on line ${i + 1}: ${String(item.file)}`);
      process.exit(2);
    }
    if (!wantedByFile.has(norm)) wantedByFile.set(norm, []);
    wantedByFile.get(norm).push(item);
  }

  const fileList = [...wantedByFile.keys()].sort(cmpCodePoint);
  if (fileList.length === 0) {
    console.log("stripped 0 blocks in 0 files, skipped 0, rejected 0");
    return;
  }

  const realWorkRoot = realpathSync(workRoot);
  const jsFiles = [];
  const pyFiles = [];
  const cssFiles = [];
  let skipped = 0;
  for (const f of fileList) {
    const absTarget = resolve(workRoot, f);
    if (!existsSync(absTarget)) {
      console.error(`skipped ${f}: file does not exist`);
      skipped += wantedByFile.get(f).length;
    } else {
      const realRel = relative(realWorkRoot, realpathSync(absTarget));
      if (
        !realRel ||
        realRel === ".." ||
        realRel.startsWith("../") ||
        realRel.startsWith("..\\") ||
        isAbsolute(realRel)
      ) {
        console.error(`refusing symlink resolving outside workspace: ${f}`);
        process.exit(2);
      }
      const ext = extname(f).toLowerCase();
      if (JS_EXTS.has(ext)) jsFiles.push(f);
      else if (PY_EXTS.has(ext)) pyFiles.push(f);
      else if (CSS_EXTS.has(ext)) cssFiles.push(f);
      else {
        console.error(`skipped ${f}: unsupported extension`);
        skipped += wantedByFile.get(f).length;
      }
    }
  }
  if (jsFiles.length === 0 && pyFiles.length === 0 && cssFiles.length === 0) {
    console.log(`stripped 0 blocks in 0 files, skipped ${skipped}, rejected 0`);
    return;
  }

  let strippedBlocks = 0;
  let modifiedFiles = 0;
  let rejected = 0;

  if (jsFiles.length > 0) {
    const extracted = runOxlintExtract(jsFiles, "strip-prep", workRoot, {
      applyIgnores: false,
    });
    if (extracted.status !== 0) {
      console.error(extracted.stderr || extracted.stdout || "oxlint extract failed");
      process.exit(1);
    }
    const byFile = new Map(extracted.records.map((r) => [r.file, r]));
    const scratch = mkdtempSync(join(tmpdir(), "mc-comments-verify-"));
    try {
      const staged = [];
      for (const relFile of jsFiles) {
        const rec = byFile.get(relFile);
        const wanted = wantedByFile.get(relFile) ?? [];
        if (!rec) {
          for (const w of wanted) {
            console.error(`skipped ${relFile}:${w.line}: file failed to parse`);
            skipped++;
          }
          continue;
        }
        const m = matchWantedBlocks(relFile, rec.blocks, wanted);
        skipped += m.skipped;
        if (m.matched.length === 0) continue;
        const absFile = resolve(workRoot, relFile);
        const rawOriginal = readFileSync(absFile, "utf8");
        const hasBom = rawOriginal.startsWith("\uFEFF");
        const original = hasBom ? rawOriginal.slice(1) : rawOriginal;
        const candidateBody = applyStrips(original, m.matched);
        const candidate = hasBom ? `\uFEFF${candidateBody}` : candidateBody;
        const ext = /\.d\.[cm]?ts$/i.exec(relFile)?.[0] || extname(relFile) || ".ts";
        const stagedPath = join(scratch, `f${staged.length}${ext}`);
        writeFileSync(stagedPath, candidate, "utf8");
        staged.push({
          relFile,
          absFile,
          stagedPath,
          stagedRel: normalizeRelPath(stagedPath, scratch),
          candidate,
          beforeHash: rec.verifyHash,
          count: m.matched.length,
        });
      }

      if (staged.length > 0) {
        const afterVerify = runOxlintExtract(
          staged.map((s) => s.stagedRel),
          "verify",
          scratch,
          { applyIgnores: false },
        );
        const afterHashByRel = new Map(afterVerify.records.map((r) => [r.file, r.verifyHash]));

        for (const item of staged) {
          const afterHash = afterHashByRel.get(item.stagedRel);
          if (!item.beforeHash || !afterHash || item.beforeHash !== afterHash) {
            console.error(
              `rejected ${item.relFile}: code AST/tokens changed after stripping (${item.count} blocks kept untouched)`,
            );
            rejected += item.count;
            continue;
          }
          if (!dryRun) atomicWriteFile(item.absFile, item.candidate);
          strippedBlocks += item.count;
          modifiedFiles += 1;
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  if (pyFiles.length > 0) {
    const pyRes = scanPyFiles(
      pyFiles.map((f) => resolve(workRoot, f)),
      workRoot,
    );
    if (!pyRes.ok) {
      console.error(`python comment scan failed: ${pyRes.error}`);
      process.exit(1);
    }
    const byFile = new Map(pyRes.records.map((r) => [r.file, r]));
    const tasks = [];
    for (const relFile of pyFiles) {
      const rec = byFile.get(relFile);
      const wanted = wantedByFile.get(relFile) ?? [];
      if (!rec) {
        for (const w of wanted) {
          console.error(`skipped ${relFile}:${w.line}: file failed to parse`);
          skipped++;
        }
        continue;
      }
      const m = matchWantedBlocks(relFile, rec.blocks, wanted);
      skipped += m.skipped;
      if (m.matched.length === 0) continue;
      tasks.push({
        file: relFile,
        absPath: resolve(workRoot, relFile),
        blocks: m.matched,
      });
    }
    if (tasks.length > 0) {
      const stripped = stripPyFiles(tasks, workRoot);
      if (!stripped.ok) {
        console.error(`python strip failed: ${stripped.error}`);
        process.exit(1);
      }
      const byRes = new Map(stripped.results.map((r) => [r.file, r]));
      for (const task of tasks) {
        const res = byRes.get(task.file);
        if (!res?.ok) {
          console.error(
            `rejected ${task.file}: ${res?.error || "AST verification failed"} (${task.blocks.length} blocks kept untouched)`,
          );
          rejected += task.blocks.length;
          continue;
        }
        if (!dryRun) atomicWriteFile(task.absPath, res.candidate);
        strippedBlocks += task.blocks.length;
        modifiedFiles += 1;
      }
    }
  }

  if (cssFiles.length > 0) {
    const cssRes = scanCssFiles(
      cssFiles.map((f) => resolve(workRoot, f)),
      workRoot,
    );
    if (!cssRes.ok) {
      console.error(`css comment scan failed: ${cssRes.error}`);
      process.exit(1);
    }
    const byFile = new Map(cssRes.records.map((r) => [r.file, r]));
    for (const relFile of cssFiles) {
      const rec = byFile.get(relFile);
      const wanted = wantedByFile.get(relFile) ?? [];
      if (!rec) {
        for (const w of wanted) {
          console.error(`skipped ${relFile}:${w.line}: file failed to parse`);
          skipped++;
        }
        continue;
      }
      const m = matchWantedBlocks(relFile, rec.blocks, wanted);
      skipped += m.skipped;
      if (m.matched.length === 0) continue;
      const absFile = resolve(workRoot, relFile);
      const rawOriginal = readFileSync(absFile, "utf8");
      const res = stripCssFile(rawOriginal, m.matched, relFile);
      if (!res.ok) {
        console.error(
          `rejected ${relFile}: ${res.error} (${m.matched.length} blocks kept untouched)`,
        );
        rejected += m.matched.length;
        continue;
      }
      if (!dryRun) atomicWriteFile(absFile, res.candidate);
      strippedBlocks += m.matched.length;
      modifiedFiles += 1;
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}stripped ${strippedBlocks} blocks in ${modifiedFiles} files, skipped ${skipped}, rejected ${rejected}`,
  );
  if (!dryRun && modifiedFiles > 0) {
    console.log("next: bun run comments ratchet && bun run lint");
  }
};

const pathMatchesTargets = (relFile, targets, workRoot) => {
  const normTargets = targets.map((t) => normalizeRelPath(resolve(workRoot, t), workRoot));
  return normTargets.some(
    (t) => t === "" || t === "." || relFile === t || relFile.startsWith(`${t}/`),
  );
};

const cmdRatchet = (targets, { check, init, scoped }, workRoot) => {
  const ratchetPath = getRatchetPath();
  const jsFiles = walkFilesWithExt(targets, JS_EXTS, workRoot);
  let records = [];
  if (jsFiles.length > 0) {
    const res = runOxlintExtract(targets, "comments", workRoot);
    if (res.status !== 0) {
      console.error(res.stderr || res.stdout || "oxlint extract failed");
      process.exit(1);
    }
    records = res.records;
  }

  const liveCounts = new Map();
  for (const rec of records) {
    if (rec.proseTokens > 0) liveCounts.set(rec.file, rec.proseTokens);
  }
  for (const rec of scanNonJsTargets(targets, workRoot)) {
    if (rec.tokens > 0) liveCounts.set(rec.file, rec.tokens);
  }

  if (init) {
    const sortedLiveObj = Object.fromEntries(
      [...liveCounts.entries()].sort((a, b) => cmpCodePoint(a[0], b[0])),
    );
    atomicWriteFile(
      ratchetPath,
      `${JSON.stringify({ version: 1, files: sortedLiveObj }, null, 2)}\n`,
    );
    const totalTokens = [...liveCounts.values()].reduce((s, n) => s + Number(n), 0);
    console.log(
      `initialized ${normalizeRelPath(ratchetPath, workRoot)}: ${totalTokens} prose comment tokens across ${liveCounts.size} files`,
    );
    return;
  }

  if (!existsSync(ratchetPath)) {
    console.error(
      `ratchet file missing (${ratchetPath}); run \`bun run comments ratchet --init\` to create baseline`,
    );
    process.exit(1);
  }

  let current;
  try {
    current = JSON.parse(readFileSync(ratchetPath, "utf8"));
  } catch (err) {
    console.error(`invalid JSON in ratchet file (${ratchetPath}): ${err.message}`);
    process.exit(1);
  }
  if (
    !current ||
    typeof current.files !== "object" ||
    current.files === null ||
    Array.isArray(current.files)
  ) {
    console.error(`invalid ratchet schema in ${ratchetPath}: expected "files" object`);
    process.exit(1);
  }
  const existingFiles = current.files;

  const increased = [];
  const lowered = [];
  const staleMissing = [];
  const invalidValues = [];
  const nextFiles = new Map();

  for (const [file, ceiling] of Object.entries(existingFiles)) {
    if (!Number.isInteger(ceiling) || ceiling <= 0) {
      invalidValues.push(`${file}=${ceiling}`);
      continue;
    }
    if (scoped && !pathMatchesTargets(file, targets, workRoot)) {
      nextFiles.set(file, ceiling);
      continue;
    }
    if (!liveCounts.has(file)) {
      if (!existsSync(resolve(workRoot, file)) || isIgnoredRelPath(file)) staleMissing.push(file);
      else lowered.push(`${file}: ${ceiling} -> 0`);
    }
  }

  for (const [file, actual] of liveCounts.entries()) {
    const rawExisting = Object.hasOwn(existingFiles, file) ? existingFiles[file] : 0;
    const ceiling = Number.isInteger(rawExisting) && rawExisting > 0 ? rawExisting : 0;
    if (actual > ceiling) increased.push(`${file}: ${ceiling} -> ${actual}`);
    else if (actual < ceiling) lowered.push(`${file}: ${ceiling} -> ${actual}`);
    nextFiles.set(file, actual);
  }

  const sortedNextObj = Object.fromEntries(
    [...nextFiles.entries()].sort((a, b) => cmpCodePoint(a[0], b[0])),
  );

  if (check) {
    const problems = [
      ...increased.map((x) => `increased: ${x}`),
      ...lowered.map((x) => `stale ceiling (run \`bun run comments ratchet\`): ${x}`),
      ...staleMissing.map((x) => `missing or ignored file in ratchet: ${x}`),
      ...invalidValues.map((x) => `invalid ceiling: ${x}`),
    ];
    if (problems.length > 0) {
      for (const p of problems.slice(0, 30)) console.error(p);
      if (problems.length > 30) console.error(`...and ${problems.length - 30} more`);
      process.exit(1);
    }
    const totalTokens = [...nextFiles.values()].reduce((s, n) => s + Number(n), 0);
    console.log(`ratchet ok: ${totalTokens} prose comment tokens across ${nextFiles.size} files`);
    return;
  }

  if (invalidValues.length > 0) {
    console.error("Invalid entries in comment ratchet file:");
    for (const item of invalidValues.slice(0, 30)) console.error(`  ${item}`);
    if (invalidValues.length > 30) console.error(`  ...and ${invalidValues.length - 30} more`);
    process.exit(1);
  }

  if (increased.length > 0) {
    console.error("Refusing to raise comment ratchet ceilings:");
    for (const item of increased.slice(0, 30)) console.error(`  ${item}`);
    if (increased.length > 30) console.error(`  ...and ${increased.length - 30} more`);
    console.error("Delete the added comments instead of raising the ratchet.");
    process.exit(1);
  }

  atomicWriteFile(
    ratchetPath,
    `${JSON.stringify({ version: 1, files: sortedNextObj }, null, 2)}\n`,
  );
  const totalTokens = [...nextFiles.values()].reduce((s, n) => s + Number(n), 0);
  console.log(
    `tightened ratchet: lowered ${lowered.length} files, pruned ${staleMissing.length} deleted/ignored files -> ${totalTokens} tokens across ${nextFiles.size} files`,
  );
  console.log("next: bun run lint");
};

const rawArgv = process.argv.slice(2);
if (
  rawArgv.length === 0 ||
  rawArgv.includes("-h") ||
  rawArgv.includes("--help") ||
  rawArgv[0] === "help"
) {
  console.log(HELP.trim());
  process.exit(0);
}

const sub = rawArgv[0];
const rest = rawArgv.slice(1);
const workRoot = getWorkRoot();

if (sub === "list") {
  const args = cliArgs(HELP, ["--out <file>"], Infinity, rest, { helpWord: false });
  let outFile = null;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      outFile = args[++i];
    } else {
      paths.push(args[i]);
    }
  }
  cmdList(resolveCliTargets(paths, workRoot), outFile, workRoot);
} else if (sub === "stats") {
  const args = cliArgs(HELP, ["--json"], Infinity, rest, { helpWord: false });
  const asJson = args.includes("--json");
  const paths = args.filter((a) => a !== "--json");
  cmdStats(resolveCliTargets(paths, workRoot), asJson, workRoot);
} else if (sub === "strip") {
  const args = cliArgs(HELP, ["--dry-run"], 1, rest, { helpWord: false });
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => a !== "--dry-run");
  if (positional.length !== 1) {
    console.error("strip requires one JSONL file path (--help for usage)");
    process.exit(2);
  }
  cmdStrip(positional[0], dryRun, workRoot);
} else if (sub === "ratchet") {
  const args = cliArgs(HELP, ["--check", "--init"], Infinity, rest, { helpWord: false });
  const check = args.includes("--check");
  const init = args.includes("--init");
  if (check && init) {
    console.error("cannot combine --check and --init");
    process.exit(2);
  }
  const paths = args.filter((a) => a !== "--check" && a !== "--init");
  cmdRatchet(
    resolveCliTargets(paths, workRoot),
    { check, init, scoped: paths.length > 0 },
    workRoot,
  );
} else {
  console.error(
    `unknown subcommand ${sub}: expected list, stats, strip or ratchet (--help for usage)`,
  );
  process.exit(2);
}
