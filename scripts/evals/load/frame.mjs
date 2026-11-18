import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, needFilm } from "../../../packages/live-studio/src/cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = cliArgs(
  `Measure frame scheduling in a real browser.
  bun scripts/evals/load/frame.mjs [--film <path>] [--objects]
--film selects a film directory. Defaults to the current directory.
--objects measures Minecraft add/replace/remove with prepared asset caches.
Writes scripts/evals/load/runs/frame-*/ evidence; stops after 180 seconds. No paid requests.`,
  ["--film <path>", "--objects"],
  0,
);
const filmArg = args.indexOf("--film");
const film = needFilm(filmArg === -1 ? process.cwd() : resolve(args[filmArg + 1]));
const objects = args.includes("--objects");
const dir = join(here, "runs", `frame-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
mkdirSync(dir, { recursive: true });
const result = {
  complete: false,
  scope: objects
    ? "Real Minecraft add/replace/remove with prepared asset cache; no performance claim"
    : "Film at 960x540 draft; paired shadow scheduling in one renderer",
  trials: [],
};
const save = () => writeFileSync(join(dir, "results.json"), JSON.stringify(result, null, 2));
let server, view;
const stop = setTimeout(() => {
  save();
  view?.close();
  server?.stop(true);
  process.exit(1);
}, 180000);
try {
  const built = await Bun.build({
    entrypoints: [join(here, "frame-page.ts")],
    target: "browser",
    plugins: [
      {
        name: "film",
        setup(build) {
          build.onResolve({ filter: /^film\/(edit|scene)$/ }, ({ path }) => ({
            path: join(film, "src", `${path.slice("film/".length)}.ts`),
          }));
        },
      },
    ],
  });
  if (!built.success) throw new AggregateError(built.logs, "Could not bundle frame eval");
  const files = new Map(built.outputs.map((o) => [o.path.replace(/^\.\//, "/"), o]));
  const entry = built.outputs.find((o) => o.kind === "entry-point").path.replace(/^\.\//, "/");
  const css = [...files.keys()]
    .filter((p) => p.endsWith(".css"))
    .map((p) => `<link rel="stylesheet" href="${p}">`)
    .join("");
  const publicDir = join(film, "assets/public");
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname,
        output = files.get(path);
      if (output) return new Response(output);
      if (path === "/")
        return new Response(`<!doctype html>${css}<script type="module" src="${entry}"></script>`, {
          headers: { "content-type": "text/html" },
        });
      const file = resolve(publicDir, `.${decodeURIComponent(path)}`),
        rel = relative(publicDir, file);
      if (isAbsolute(rel) || rel.startsWith("..")) return new Response(null, { status: 403 });
      const asset = Bun.file(file);
      return (await asset.exists()) ? new Response(asset) : new Response(null, { status: 404 });
    },
  });
  view = new Bun.WebView({
    backend: {
      type: "chrome",
      argv: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
    },
  });
  await view.navigate(server.url.href);
  for (let i = 0; !(await view.evaluate("!!window.frameReady")); i++) {
    if (i > 300) throw new Error("Frame scene not ready after 60 seconds");
    await Bun.sleep(200);
  }
  result.environment = await view.evaluate("window.frameEnvironment");
  if (objects) {
    const { images, ...checks } = await view.evaluate("objectTrial()");
    for (const [name, data] of Object.entries(images))
      writeFileSync(join(dir, `${name}.png`), Buffer.from(data.split(",")[1], "base64"));
    result.objects = checks;
    save();
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
  } else {
    for (let i = 0; i < 3; i++) {
      result.trials.push(await view.evaluate("shadowTrial()"));
      save();
    }
  }
  result.complete = true;
  save();
  console.log(
    JSON.stringify({
      file: join(dir, "results.json"),
      environment: result.environment,
      same: result.trials[0]?.same,
      objects: result.objects,
    }),
  );
} catch (error) {
  result.error = String(error);
  save();
  throw error;
} finally {
  clearTimeout(stop);
  view?.close();
  server?.stop(true);
}
