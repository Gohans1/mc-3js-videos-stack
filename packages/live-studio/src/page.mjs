// The studio page for one film: Vite builds it (the studio's app/ with the film's src/ inside) and builds it again on every save
// of either. A page only hears about a build that came out different, so a saved comment or a save of the same text reloads
// nothing. Built, not served by Vite's dev server: that server reloads every open page whenever its connection drops, and a
// phone's connection drops each time its screen locks.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { brotliCompress as brotliCb, constants, gzip as gzipCb } from "node:zlib";

import { build as buildCn } from "cn/build";
import { build } from "vite";

import { STUDIO } from "./film.mjs";
import { filmPlugin } from "./vite_film.mjs";

const CN_CSS = join(STUDIO, "app/index.css");
const CN_TABLES = join(STUDIO, "app/lib/cn-tables.ts");
let lastCheckedCssMtime = 0;
let cnBuildInFlight = null;

const normalizeLf = (text) => text.replaceAll("\r\n", "\n");
const cnTranspiler = globalThis.Bun?.Transpiler
  ? new globalThis.Bun.Transpiler({ loader: "ts", minifyWhitespace: true })
  : null;
const canonicalCn = (text) => {
  const lf = normalizeLf(text);
  try {
    return cnTranspiler ? cnTranspiler.transformSync(lf) : lf;
  } catch {
    return lf;
  }
};

export const syncCnTables = async ({
  cssPath = CN_CSS,
  outPath = CN_TABLES,
  cwd = STUDIO,
} = {}) => {
  const tmpDir = mkdtempSync(join(tmpdir(), "studio-cn-"));
  try {
    const tmpOut = join(tmpDir, basename(outPath));
    const { source } = await buildCn({
      cwd,
      css: cssPath,
      full: true,
      out: tmpOut,
    });
    let prev = null;
    try {
      prev = readFileSync(outPath, "utf8");
    } catch {
      /* missing output file: write fresh */
    }
    if (prev !== null && canonicalCn(prev) === canonicalCn(source)) return false;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, source);
    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

// Regenerate precompiled cn tables only when app/index.css (@theme tokens) is newer on disk.
const cnTablesPlugin = () => ({
  name: "live-studio:cn-tables",
  async buildStart() {
    let cssMtime = 0;
    try {
      cssMtime = statSync(CN_CSS).mtimeMs;
    } catch {
      return;
    }
    if (cssMtime <= lastCheckedCssMtime) return;
    let outMtime = 0;
    try {
      outMtime = statSync(CN_TABLES).mtimeMs;
    } catch {
      /* missing: regenerate below */
    }
    if (cssMtime <= outMtime) {
      lastCheckedCssMtime = cssMtime;
      return;
    }
    await (cnBuildInFlight ??= syncCnTables().finally(() => {
      cnBuildInFlight = null;
    }));
    lastCheckedCssMtime = cssMtime;
  },
});

const desktopPreloadPlugin = () => ({
  name: "live-studio:desktop-preload",
  transformIndexHtml: {
    order: "post",
    handler(html, ctx) {
      const bundle = ctx.bundle;
      if (!bundle) return html;
      const chunks = new Map();
      let entry = null;
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        chunks.set(item.fileName, item);
        if (item.isEntry) entry = item;
      }
      if (!entry) return html;
      const base = new Set();
      const walkStatic = (name, into) => {
        const c = chunks.get(name);
        if (!c || into.has(name)) return;
        into.add(name);
        for (const dep of c.imports) walkStatic(dep, into);
      };
      walkStatic(entry.fileName, base);
      const collectBranch = (app) => {
        const seen = new Set(base);
        for (const name of base) {
          const c = chunks.get(name);
          if (!c) continue;
          for (const dyn of c.dynamicImports) {
            if (app.test(dyn)) walkStatic(dyn, seen);
          }
        }
        const out = [];
        for (const name of seen) {
          if (!base.has(name)) out.push(`/${name}`);
        }
        return out;
      };
      const desktop = collectBranch(/(?:^|\/)App-/);
      const phone = collectBranch(/(?:^|\/)PhoneApp-/);
      if (!desktop.length && !phone.length) return html;
      const esc = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
      const tag = `<script>{const p=matchMedia("(pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 599px)").matches?${esc(phone)}:${esc(desktop)};for(const h of p){const l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href=h;document.head.appendChild(l)}}</script>`;
      return html.includes('<link rel="stylesheet"')
        ? html.replace('<link rel="stylesheet"', `${tag}<link rel="stylesheet"`)
        : html.replace("</head>", `${tag}</head>`);
    },
  },
});

const brotli = promisify(brotliCb),
  gzip = promisify(gzipCb);
// Q6 saves ~1% vs Q5 in the load eval at similar CPU cost; Q11 costs ~40x more CPU.
const BROTLI_OPTS = { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } };
const GZIP_OPTS = { level: 4 };

// Precompresses hashed _studio/ text assets once with Brotli-6 + Gzip. Unchanged chunks (like vendor-three and vendor-ui on a
// scene.ts save) keep their hash, so we only refresh their .br/.gz mtimes for clearOld() instead of re-squeezing ~2.5 MB of JS.
const precompress = (outDir) => ({
  name: "live-studio-precompress",
  async writeBundle(_, bundle) {
    const now = new Date(),
      jobs = [];
    for (const [rel, item] of Object.entries(bundle)) {
      if (!rel.startsWith(`${ASSETS}/`) || !/\.(?:js|mjs|css|svg|json)$/i.test(rel)) continue;
      const raw = item.type === "chunk" ? Buffer.from(item.code) : Buffer.from(item.source);
      if (raw.byteLength < 1024) continue;
      const base = join(outDir, rel),
        br = `${base}.br`,
        gz = `${base}.gz`;
      try {
        if (statSync(br).size > 0 && statSync(gz).size > 0) {
          utimesSync(br, now, now);
          utimesSync(gz, now, now);
          continue;
        }
      } catch {
        /* missing: squeeze below */
      }
      jobs.push(
        Promise.all([
          brotli(raw, BROTLI_OPTS).then((b) => writeFile(br, b)),
          gzip(raw, GZIP_OPTS).then((g) => writeFile(gz, g)),
        ]),
      );
    }
    await Promise.all(jobs);
  },
});

export const ASSETS = "_studio"; // the page's own files, under a name no film folder in assets/public uses
// How long a build's files outlive it. A page that loaded the last build's index.html still fetches its code (and App later, on
// its own), and a page left open asks for its source maps when it throws
const KEEP = 3600e3;
// A file's path as a pattern that matches however a module id writes it (either slash, any case of the drive letter)
export const pathPattern = (f) =>
  new RegExp(
    `^${f
      .split(/[\\/]/)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\\\/]")}$`,
    "i",
  );
const pathPrefixPattern = (d) =>
  new RegExp(
    `^${d
      .split(/[\\/]/)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\\\/]")}(?:[\\\\/]|$)`,
    "i",
  );

export const buildPage = (film, { onChange = () => {}, onError = () => {} } = {}) =>
  new Promise((ready, fail) => {
    // One per film, since several films run this studio at once
    const dir = join(film.PROJECT, "node_modules/.vite/live-studio-page");
    let html = null,
      error = null,
      started = false;
    const warned = new Set();
    // Every build writes all its files again, unchanged ones too, so a file's age on disk is the time since a build last used it
    const clearOld = () => {
      const code = join(dir, ASSETS),
        now = Date.now();
      for (const f of readdirSync(code)) {
        try {
          if (now - statSync(join(code, f)).mtimeMs > KEEP) rmSync(join(code, f), { force: true });
        } catch (e) {
          console.log(`not cleared: ${f}: ${e.message}`);
        } // a file Windows holds open goes next time
      }
    };
    const page = {
      dir,
      html: () => html,
      error: () => error,
      watcher: null,
      close: () => page.watcher?.close(),
    };
    const start = () => {
      if (!started) {
        started = true;
        ready(page);
      }
    };
    build({
      configFile: join(STUDIO, "vite.config.ts"),
      logLevel: "warn",
      // Squeezed once per content hash beside each file, so a phone over Tailscale downloads about a quarter and scene saves skip unchanged vendor chunks
      plugins: [
        cnTablesPlugin(),
        filmPlugin(film, { deferScene: true }),
        desktopPreloadPlugin(),
        precompress(dir),
      ],
      build: {
        outDir: dir,
        emptyOutDir: false, // see clearOld
        assetsDir: ASSETS,
        sourcemap: true,
        // Names kept: a film that throws shows its stack in the page and in this terminal, where no source map reaches
        rolldownOptions: {
          output: {
            keepNames: true,
            minify: {
              mangle: { keepNames: true },
              compress: { keepNames: { function: true, class: true } },
            },
            codeSplitting: {
              groups: [
                {
                  name: "vendor-react",
                  test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                  priority: 50,
                },
                {
                  name: "vite-helpers",
                  test: /\0vite[\\/]preload-helper|preload-helper/,
                  priority: 40,
                },
                {
                  name: "vendor-three",
                  entriesAware: true,
                  test: /[\\/]node_modules[\\/](?:three|three-mesh-bvh|postprocessing|n8ao|three-good-godrays|gl-transitions|block-model-renderer|minerender|fflate|math)[\\/]/,
                  priority: 30,
                },
                {
                  name: "vendor-ui",
                  entriesAware: true,
                  entriesAwareMergeThreshold: 20000,
                  test: (id) =>
                    /[\\/]node_modules[\\/]/.test(id) &&
                    !/[\\/]node_modules[\\/](?:zod|diff|d3-shape|d3-path|bezier-easing-editor|perfect-freehand|@base-ui[\\/]react[\\/](?:select|switch))[\\/]/.test(
                      id,
                    ),
                  priority: 20,
                },
                {
                  name: "studio-core",
                  test: /[\\/]packages[\\/]live-studio[\\/](?:app[\\/](?:core[\\/](?:events|storage|net|time|device|warmup|boot)\.ts|lib[\\/](?:utils|cn-tables)\.ts)|src[\\/](?:frame|contract-keys)\.ts)$/,
                  priority: 15,
                },
                // mc-actor (film-free) on its own: its clips.ts keeps mocap bakes under this chunk's bytes, which a film's
                // edit must not change
                {
                  name: "mocap",
                  test: /[\\/]packages[\\/]mc-actor[\\/]src[\\/]/,
                  priority: 10, // under the vendor chunks, which keep the libraries it imports
                },
              ],
            },
          },
          // Each warning once per run: a film's Node libraries would otherwise repeat theirs on every save
          onLog: (level, log, show) => {
            if (level !== "warn" || !warned.has(log.message)) {
              if (level === "warn") warned.add(log.message);
              show(level, log);
            }
          },
        },
        reportCompressedSize: false,
        chunkSizeWarningLimit: Infinity,
        // A save of a file the page loads itself (camera keys, Steve's keys...) builds nothing: a build takes ~3 s of the machine
        // the film plays on, which the creator felt as a second of lag after every edit
        watch: {
          exclude: [
            ...film.handEdited.map(pathPattern),
            /[\\/]node_modules[\\/]/,
            /[\\/]\.git[\\/]/,
            ...(film.PROJECT
              ? ["assets", "renders", "vault", ".venv"].map((d) =>
                  pathPrefixPattern(join(film.PROJECT, d)),
                )
              : []),
          ],
        },
      },
    }).then((watcher) => {
      page.watcher = watcher;
      // Which files this build is for, so the studio can tell its own save of the sound lanes from new code
      let changed = [];
      watcher.on("change", (id) => {
        changed.push(id);
      });
      watcher.on("event", (e) => {
        e.result?.close?.();
        if (e.code === "ERROR") {
          error = stripVTControlCharacters(e.error.message); // the page shows it as text, and Rolldown colours it for a terminal
          onError(error, e.error.errors?.[0]); // Rolldown's first error, as {message, id, loc}
          start(); // the page answers with the error until a save fixes it
        }
        if (e.code === "BUNDLE_END") {
          const next = readFileSync(join(dir, "index.html"), "utf8");
          // File names carry a hash of their contents and of what they import, so the same index.html is the same page. A page
          // that saw an error needs the fixed build even when it came out the same as before
          const differs = next !== html || error !== null;
          html = next;
          error = null;
          clearOld();
          if (started && differs) onChange(changed);
          changed = [];
          start();
        }
      });
    }, fail);
  });
