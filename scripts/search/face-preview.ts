import { build, spawn, which, write } from "bun";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LOCAL } from "../vault.mjs";
import type { FaceResult } from "./faces";

const entry = fileURLToPath(new URL("./face-preview-page.ts", import.meta.url));
const levels = ["light", "medium", "strong"] as const;
export type FaceSample = FaceResult & { level?: (typeof levels)[number] };

export async function facePreview(recipes: FaceResult[], filmChrome?: string): Promise<string> {
  const configured = filmChrome ? resolve(filmChrome) : undefined;
  const shell = join(LOCAL, "tools/chrome-headless-shell", process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
  const chrome = [configured, shell, which("chromium"), which("google-chrome")].find(
    (file): file is string => !!file && existsSync(file),
  );
  if (!chrome) return "preview unavailable: install the repo headless Chrome or set live-studio.chrome in this film";
  const samples: FaceSample[] = recipes.flatMap((recipe) =>
    recipe.type === "ramp" ? levels.map((level) => ({ ...recipe, level })) : [recipe]);
  const folder = mkdtempSync(join(tmpdir(), "gohans-face-"));
  const png = join(folder, "faces.png");
  const profile = join(folder, "chrome");
  const html = join(folder, "preview.html");
  try {
    const built = await build({ entrypoints: [entry], target: "browser", format: "iife", minify: true });
    if (!built.success) return "preview unavailable: could not bundle the face renderer";
    const js = await built.outputs[0]!.text();
    const columns = Math.min(6, Math.ceil(Math.sqrt(samples.length)));
    const width = columns * 224 + 16;
    const height = Math.ceil(samples.length / columns) * 248 + 16;
    await write(html, `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{display:grid;grid-template-columns:repeat(${columns},224px);margin:8px;background:#14191d;color:#f2eee7;font:600 15px system-ui}
      article{height:248px;padding:10px;text-align:center}canvas{display:block;background:#7fb8f5;border-radius:8px}p{margin:6px 0 0}
      </style><body><script type="application/json" id="recipes">${JSON.stringify(samples).replaceAll("<", "\\u003c")}</script>
      <script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
    const browser = spawn(
      [
        chrome,
        "--headless",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        `--screenshot=${png}`,
        pathToFileURL(html).href,
      ],
      { stdout: "ignore", stderr: "ignore", signal: AbortSignal.timeout(25_000) },
    );
    await browser.exited;
    if (!existsSync(png))
      return "preview unavailable: headless Chrome did not capture the face";
    return `preview PNG: ${png}`;
  } catch (error) {
    return `preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await Promise.allSettled([
      rm(profile, { recursive: true, force: true, maxRetries: 3 }),
      rm(html, { force: true }),
    ]);
  }
}
