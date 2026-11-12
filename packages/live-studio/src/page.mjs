// The studio page for one film: Vite builds it (the studio's app/ with the film's src/ inside) and builds it again on every save
// of either. A page only hears about a build that came out different, so a saved comment or a save of the same text reloads
// nothing. Built, not served by Vite's dev server: that server reloads every open page whenever its connection drops, and a
// phone's connection drops each time its screen locks.
import { readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { brotliCompress as brotliCb, constants, gzip as gzipCb } from "node:zlib";

import { build } from "vite";

import { STUDIO } from "./film.mjs";
import { filmPlugin } from "./vite_film.mjs";

const brotli = promisify(brotliCb),
  gzip = promisify(gzipCb);
const BROTLI_OPTS = { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } };

// Precompresses hashed _studio/ text assets once with Brotli-9 + Gzip. Unchanged chunks (like vendor-three and vendor-ui on a
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
          gzip(raw).then((g) => writeFile(gz, g)),
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
      plugins: [filmPlugin(film), precompress(dir)],
      build: {
        outDir: dir,
        emptyOutDir: false, // see clearOld
        assetsDir: ASSETS,
        sourcemap: true,
        // Names kept: a film that throws shows its stack in the page and in this terminal, where no source map reaches
        rolldownOptions: {
          output: {
            minify: { mangle: false },
            codeSplitting: {
              groups: [
                {
                  name: "vendor-three",
                  test: /[\\/]node_modules[\\/](?:three|three-mesh-bvh|postprocessing|n8ao|gl-transitions|block-model-renderer|minerender|fflate|math)[\\/]/,
                  priority: 20,
                },
                { name: "vendor-ui", test: /[\\/]node_modules[\\/]/, priority: 10 },
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
        watch: { exclude: film.handEdited.map(pathPattern) },
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
          onError(error);
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
