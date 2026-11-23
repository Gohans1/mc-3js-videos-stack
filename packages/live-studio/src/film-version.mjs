import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const canonicalPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const normKey = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

const isInsideRoot = (rootReal, targetReal) => {
  const r =
    process.platform === "win32"
      ? relative(rootReal.toLowerCase(), targetReal.toLowerCase())
      : relative(rootReal, targetReal);
  return Boolean(r) && r.split(/[\\/]/)[0] !== ".." && !isAbsolute(r);
};

export const localFingerprint = (project) => {
  const root = resolve(project);
  const rootReal = canonicalPath(root);
  const files = [];
  let truncated = false;
  const seenDirs = new Set([normKey(rootReal)]);

  const collectFile = (fullPath, rel) => {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let lst;
    try {
      lst = lstatSync(fullPath);
    } catch {
      return;
    }
    let targetPath = fullPath;
    let st = lst;
    if (lst.isSymbolicLink()) {
      try {
        const real = realpathSync(fullPath);
        if (!isInsideRoot(rootReal, real)) return;
        st = statSync(real);
        targetPath = real;
      } catch {
        return;
      }
    }
    if (!st.isFile()) return;
    files.push({ rel, path: targetPath, size: st.size, mtimeMs: st.mtimeMs });
  };

  const walkDir = (dirPath, relPrefix) => {
    if (files.length >= MAX_FILES) return;
    let lst;
    try {
      lst = lstatSync(dirPath);
    } catch {
      return;
    }
    let realDir;
    if (lst.isSymbolicLink()) {
      try {
        realDir = realpathSync(dirPath);
        if (!isInsideRoot(rootReal, realDir) || !statSync(realDir).isDirectory()) return;
      } catch {
        return;
      }
    } else if (lst.isDirectory()) {
      realDir = canonicalPath(dirPath);
    } else {
      return;
    }
    const dirKey = normKey(realDir);
    if (seenDirs.has(dirKey)) return;
    seenDirs.add(dirKey);

    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => byCodePoint(a.name, b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dirPath, entry.name);
      const rel = `${relPrefix}/${entry.name}`;
      let entryStat;
      try {
        entryStat = lstatSync(full);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) {
        try {
          const real = realpathSync(full);
          if (!isInsideRoot(rootReal, real)) continue;
          const targetStat = statSync(real);
          if (targetStat.isDirectory()) walkDir(full, rel);
          else if (targetStat.isFile())
            files.push({ rel, path: real, size: targetStat.size, mtimeMs: targetStat.mtimeMs });
        } catch {
          continue;
        }
      } else if (entryStat.isDirectory()) {
        walkDir(full, rel);
      } else if (entryStat.isFile()) {
        files.push({ rel, path: full, size: entryStat.size, mtimeMs: entryStat.mtimeMs });
      }
    }
  };

  collectFile(join(root, "package.json"), "package.json");
  walkDir(join(root, "src"), "src");
  files.sort((a, b) => byCodePoint(a.rel, b.rel));

  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const f of files) {
    if (f.size <= MAX_FILE_BYTES && totalBytes + f.size <= MAX_TOTAL_BYTES) {
      let buf;
      try {
        buf = readFileSync(f.path);
      } catch {
        continue;
      }
      totalBytes += buf.length;
      hash.update("F\0");
      hash.update(f.rel);
      hash.update(`\0${buf.length}\0`);
      hash.update(buf);
      hash.update("\0");
    } else {
      hash.update("M\0");
      hash.update(f.rel);
      hash.update(`\0${f.size}:${Math.trunc(f.mtimeMs)}\0`);
    }
  }
  if (truncated) hash.update("T\0");
  return `local-${hash.digest("hex").slice(0, 8)}`;
};

const gitTrackedVersion = (root) => {
  const tracked = spawnSync("git", ["ls-files", "--", "."], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (tracked.status !== 0 || !(tracked.stdout ?? "").trim()) return null;
  const desc = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  const out = (desc.stdout ?? "").trim();
  return desc.status === 0 && out ? out : null;
};

const runGitAsync = (args, cwd, maxBuffer) =>
  new Promise((done) =>
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", windowsHide: true, ...(maxBuffer ? { maxBuffer } : {}) },
      (err, stdout) => done({ ok: !err, stdout: err ? "" : (stdout ?? "") }),
    ),
  );

const gitTrackedVersionAsync = async (root) => {
  const tracked = await runGitAsync(["ls-files", "--", "."], root, GIT_MAX_BUFFER);
  if (!tracked.ok || !tracked.stdout.trim()) return null;
  const desc = await runGitAsync(["describe", "--tags", "--always", "--dirty"], root);
  const out = desc.stdout.trim();
  return desc.ok && out ? out : null;
};

export const filmVersion = (project) => {
  const root = resolve(project);
  try {
    return gitTrackedVersion(root) ?? localFingerprint(root);
  } catch {
    return localFingerprint(root);
  }
};

export const filmVersionAsync = async (project) => {
  const root = resolve(project);
  try {
    return (await gitTrackedVersionAsync(root)) ?? localFingerprint(root);
  } catch {
    return localFingerprint(root);
  }
};
