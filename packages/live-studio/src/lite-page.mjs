import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brotliCompress as brotliCb, constants, gzip as gzipCb } from "node:zlib";

export const LITE_ASSETS = "_lite";

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIG_VERSION = "lite-build-v1";
const brotli = promisify(brotliCb);
const gzip = promisify(gzipCb);
const BROTLI_OPTS = { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } };
const GZIP_OPTS = { level: 4 };

const SHARED_FILES = [
  "app/index.css",
  "app/studio.css",
  "app/core/time.ts",
  "app/notes/shape.ts",
  "app/notes/ink-gesture.ts",
  "app/notes/pinfade.ts",
  "app/picture/compare-video-model.ts",
  "src/compare-video-meta.ts",
  "src/frame.ts",
  "package.json",
];

const SHARED_DIRS = ["app/components/ui", "app/lib"];

const collectDir = (baseDir, targetDir, out) => {
  if (!existsSync(targetDir)) return;
  let entries;
  try {
    entries = readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      collectDir(baseDir, full, out);
    } else if (entry.isFile()) {
      try {
        const st = statSync(full);
        out.push({
          rel: relative(baseDir, full).replaceAll("\\", "/"),
          size: st.size,
          mtimeMs: Math.trunc(st.mtimeMs),
        });
      } catch {}
    }
  }
};

export const computeLiteSignature = ({
  studioDir = STUDIO,
  root = join(studioDir, "app/lite"),
} = {}) => {
  const studio = resolve(studioDir);
  const entryRoot = resolve(root);
  const files = [];
  collectDir(entryRoot, entryRoot, files);
  const isDefaultRoot =
    (process.platform === "win32" ? entryRoot.toLowerCase() : entryRoot) ===
    (process.platform === "win32"
      ? resolve(studio, "app/lite").toLowerCase()
      : resolve(studio, "app/lite"));
  if (isDefaultRoot) {
    for (const rel of SHARED_FILES) {
      const full = join(studio, rel);
      try {
        const st = statSync(full);
        if (st.isFile()) files.push({ rel, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) });
      } catch {}
    }
    for (const dirRel of SHARED_DIRS) {
      collectDir(studio, join(studio, dirRel), files);
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  hash.update(`${SIG_VERSION}\0${entryRoot}\0`);
  for (const f of files) {
    hash.update(`${f.rel}\0${f.size}:${f.mtimeMs}\n`);
  }
  return hash.digest("hex");
};

const readSig = (sigFile) => {
  try {
    const parsed = JSON.parse(readFileSync(sigFile, "utf8"));
    return typeof parsed?.sig === "string" ? parsed.sig : null;
  } catch {
    return null;
  }
};

const writeSig = (sigFile, sig) => {
  const tmp = `${sigFile}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ sig }));
    renameSync(tmp, sigFile);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
};

const precompressLite = (outDir) => ({
  name: "live-studio-lite-precompress",
  async writeBundle(_, bundle) {
    const jobs = [];
    for (const [rel, item] of Object.entries(bundle)) {
      if (!rel.startsWith(`${LITE_ASSETS}/`) || !/\.(?:js|mjs|css|svg|json)$/i.test(rel)) continue;
      const raw = item.type === "chunk" ? Buffer.from(item.code) : Buffer.from(item.source);
      if (raw.byteLength < 1024) continue;
      const base = join(outDir, rel);
      jobs.push(
        Promise.all([
          brotli(raw, BROTLI_OPTS).then((b) => writeFile(`${base}.br`, b)),
          gzip(raw, GZIP_OPTS).then((g) => writeFile(`${base}.gz`, g)),
        ]),
      );
    }
    await Promise.all(jobs);
  },
});

const maybeSyncCnTables = async (studioDir) => {
  const cssPath = join(studioDir, "app/index.css");
  const outPath = join(studioDir, "app/lib/cn-tables.ts");
  let cssMtime = 0;
  try {
    cssMtime = statSync(cssPath).mtimeMs;
  } catch {
    return;
  }
  let outMtime = 0;
  try {
    outMtime = statSync(outPath).mtimeMs;
  } catch {}
  if (cssMtime <= outMtime) return;
  const { syncCnTables } = await import("./page.mjs");
  await syncCnTables({ cssPath, outPath, cwd: studioDir });
};

export const readCachedLitePage = ({
  studioDir = STUDIO,
  root = join(studioDir, "app/lite"),
  outDir = join(studioDir, "node_modules/.vite/live-studio-lite"),
} = {}) => {
  const studio = resolve(studioDir);
  const entryRoot = resolve(root);
  const targetOut = resolve(outDir);
  const indexFile = join(targetOut, "index.html");
  const sigFile = join(targetOut, ".build-sig.json");
  const sig = computeLiteSignature({ studioDir: studio, root: entryRoot });

  if (!existsSync(indexFile) || readSig(sigFile) !== sig) return null;
  const cachedHtml = readFileSync(indexFile, "utf8");
  return {
    dir: targetOut,
    html: () => cachedHtml,
    error: () => null,
    cached: true,
  };
};

export const buildLitePage = async ({
  studioDir = STUDIO,
  root = join(studioDir, "app/lite"),
  outDir = join(studioDir, "node_modules/.vite/live-studio-lite"),
  force = false,
} = {}) => {
  const studio = resolve(studioDir);
  const entryRoot = resolve(root);
  const targetOut = resolve(outDir);
  const indexFile = join(targetOut, "index.html");
  const sigFile = join(targetOut, ".build-sig.json");

  if (!force) {
    const cached = readCachedLitePage({ studioDir: studio, root: entryRoot, outDir: targetOut });
    if (cached) return cached;
  }

  await maybeSyncCnTables(studio);
  const finalSig = computeLiteSignature({ studioDir: studio, root: entryRoot });
  const [{ build }, { default: react }, { default: tailwindcss }] = await Promise.all([
    import("vite"),
    import("@vitejs/plugin-react"),
    import("@tailwindcss/vite"),
  ]);

  mkdirSync(targetOut, { recursive: true });
  await build({
    configFile: false,
    root: entryRoot,
    logLevel: "warn",
    plugins: [react(), tailwindcss(), precompressLite(targetOut)],
    resolve: {
      alias: [{ find: "@", replacement: join(studio, "app") }],
    },
    build: {
      outDir: targetOut,
      emptyOutDir: true,
      assetsDir: LITE_ASSETS,
      sourcemap: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: Infinity,
    },
  });

  const builtHtml = readFileSync(indexFile, "utf8");
  writeSig(sigFile, finalSig);
  return {
    dir: targetOut,
    html: () => builtHtml,
    error: () => null,
    cached: false,
  };
};

const runIsolatedBuild = ({ studioDir, root, outDir, force }) =>
  new Promise((done, fail) => {
    const modUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
    const code =
      'const { buildLitePage } = await import(process.env.LITE_BUILD_MOD); await buildLitePage({ studioDir: process.env.LITE_BUILD_STUDIO, root: process.env.LITE_BUILD_ROOT, outDir: process.env.LITE_BUILD_OUT, force: process.env.LITE_BUILD_FORCE === "1" });';
    const child = spawn(process.execPath, ["-e", code], {
      cwd: studioDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LITE_BUILD_MOD: modUrl,
        LITE_BUILD_STUDIO: studioDir,
        LITE_BUILD_ROOT: root,
        LITE_BUILD_OUT: outDir,
        LITE_BUILD_FORCE: force ? "1" : "0",
      },
    });
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", fail);
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        done();
        return;
      }
      const detail = (stderr || stdout).trim();
      fail(
        new Error(
          `lite build child failed (${exitCode !== null ? `code ${exitCode}` : `signal ${signal}`})${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });

export const ensureLitePage = async ({
  studioDir = STUDIO,
  root = join(studioDir, "app/lite"),
  outDir = join(studioDir, "node_modules/.vite/live-studio-lite"),
  force = false,
} = {}) => {
  const studio = resolve(studioDir);
  const entryRoot = resolve(root);
  const targetOut = resolve(outDir);

  if (!force) {
    const cached = readCachedLitePage({ studioDir: studio, root: entryRoot, outDir: targetOut });
    if (cached) return cached;
  }

  await runIsolatedBuild({ studioDir: studio, root: entryRoot, outDir: targetOut, force });
  const builtHtml = readFileSync(join(targetOut, "index.html"), "utf8");
  return {
    dir: targetOut,
    html: () => builtHtml,
    error: () => null,
    cached: false,
  };
};
