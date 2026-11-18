import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { cliArgs, numberArg, secondArg } from "../packages/live-studio/src/cli.mjs";
import { openFilmCatalog, openOpenFilm } from "../packages/live-studio/src/openfilm.mjs";
import { expandTemplate } from "./openfilm/native.mjs";

const HELP = `Usage: bun run openfilm <command> [id] [options]

list                         Find usable OpenFilm assets (JSON, default 40 results).
info <asset-id>              Full recipe, editable text selectors, CSS variables, dimensions and source path.
plan <template-id>           Expand a template into overlay items, music and camera-slot timings without saving.
use <asset-id>               Apply to the film using its native timelines. Returns the exact file and saved data.
use /your-page.html          Use assets/public/your-page.html without a catalog or metadata.
timeline                     Read the film's OpenFilm layers in HEARD/output seconds and their version.
edit <layer-id> --props JSON  Merge changes into an existing OpenFilm layer.
remove <layer-id>            Remove one OpenFilm layer. Native cut/grade/audio edits use their existing lanes.
validate                     Check the film's OpenFilm timeline and all referenced asset IDs.

--film <path>                Film folder (default current folder); required from the monorepo root for writes.
--kind <category>            transition, effect, text, filter, sticker, template.
--group <group> --query <text> --limit <N>   Library filters; list --limit 2066 returns the whole catalog.
--from <seconds> --to <seconds>            HEARD/output seconds, start inclusive and end exclusive.
--shot <N>                   Transition boundary index (1 = second shot). Cut time stays unchanged.
--props <JSON>               Full creative controls: text selector map, vars, x/y, size, rotate, opacity,
                             rate, offset, loop, blend, track, fadeIn/fadeOut, elements (selector, text, style,
                             translate, scale, rotate). All persist as editable JSON.
--props-file <path>          Read these controls from UTF-8 JSON (recommended on PowerShell; avoids quote escaping).
Text example: --props '{"text":{".t":"Hello"},"vars":{"--color":"#ffd86b"},"x":0.5,"y":0.8,"size":0.15}'
All source pages, fonts, PNGs and licenses remain editable under vault/openfilm/library.
Reload the page after editing source HTML; restart Studio after editing _definitions or the catalog.
After source asset edits, force affected video chunks with CHUNKS=N (asset bytes are outside render stamps).
Overlays: src/timeline/openfilm.json (or live-studio.openfilmTimeline). Effects are GPU textures in Three.js,
not DOM overlays over the picture. CSS/canvas snapshots await each explicit film time, including motion blur.
Filters reuse native LUT/adjustment layers; three fade transitions reuse existing shaders.
Templates apply overlays and the original music. Their camera slots describe timings for your own 3D scenes.
Audio is already native: bun run find --source openfilm --kind sound. Change or replace any recipe freely.
Exit: 0 success, 1 operation/data error, 2 usage error. No network or download is required.`;

const names = [
  "film",
  "kind",
  "group",
  "query",
  "limit",
  "from",
  "to",
  "shot",
  "props",
  "props-file",
];
const argv = cliArgs(
  HELP,
  names.map((name) => `--${name} value`),
  2,
);
let parsed;
try {
  parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries(names.map((n) => [n, { type: "string" }])),
  });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const [command, id] = parsed.positionals,
  args = parsed.values;
if (args.props && args["props-file"]) {
  console.error("Use either --props or --props-file");
  process.exit(2);
}
if (
  !["list", "info", "plan", "use", "timeline", "edit", "remove", "validate"].includes(command) ||
  (["info", "plan", "use", "edit", "remove"].includes(command) && !id)
) {
  console.error(
    "Choose list, info <id>, plan <id>, use <id>, timeline, edit <id>, remove <id> or validate (--help for options)",
  );
  process.exit(2);
}
const number = (name, fallback) => {
  if (args[name] === undefined) return fallback;
  return ["from", "to"].includes(name)
    ? secondArg(`--${name}`, args[name])
    : numberArg(`--${name}`, args[name], { min: 0, int: true });
};
try {
  const catalog = openFilmCatalog();
  if (!catalog.length && ["list", "info", "plan"].includes(command))
    throw new Error("No OpenFilm library installed: bun run fetch:openfilm");
  const custom = args["props-file"]
    ? JSON.parse(readFileSync(resolve(args["props-file"]), "utf8").trimStart())
    : args.props
      ? JSON.parse(args.props)
      : {};
  let result;
  if (command === "list") {
    const matches = catalog.filter(
      (r) =>
        (!args.kind || r.cat === args.kind) &&
        (!args.group || r.group === args.group) &&
        (!args.query ||
          JSON.stringify([r.id, r.title, r.about, r.tags])
            .toLowerCase()
            .includes(args.query.toLowerCase())),
    );
    const limit = number("limit", 40);
    if (!Number.isInteger(limit) || limit < 1 || limit > catalog.length)
      throw new Error(`--limit must be 1-${catalog.length}`);
    result = {
      total: matches.length,
      groups: [...new Set(matches.map((r) => r.group))],
      items: matches.slice(0, limit).map(({ id, title, cat, group, render, durationMs }) => ({
        id,
        title,
        cat,
        group,
        render,
        durationMs,
      })),
    };
  } else if (command === "info" || command === "plan") {
    const recipe = catalog.find((r) => r.id === id);
    if (!recipe) throw new Error(`Unknown asset: ${id}; bun run openfilm list --query <word>`);
    if (command === "plan" && recipe.render !== "group")
      throw new Error("plan requires a template ID");
    result =
      command === "info"
        ? recipe
        : expandTemplate(recipe, number("from", 0), number("to", undefined));
  } else {
    const project = resolve(args.film ?? process.cwd()),
      pkgFile = join(project, "package.json");
    if (!existsSync(pkgFile) || !existsSync(join(project, "src/scene.ts")))
      throw new Error("Choose a film: --film films/<name>, or run inside the film");
    const conf = JSON.parse(readFileSync(pkgFile, "utf8"))["live-studio"] ?? {},
      timeline = openOpenFilm(project, conf);
    if (command === "timeline") result = timeline.view();
    else if (command === "use")
      result = timeline.use({
        ...custom,
        asset: id,
        ...(args.from !== undefined && { from: number("from") }),
        ...(args.to !== undefined && { to: number("to") }),
        ...(args.shot !== undefined && { shot: number("shot") }),
      });
    else {
      const current = timeline.read();
      if (command === "validate") {
        const problem = timeline.check(current.version, current.data);
        if (problem) throw new Error(JSON.stringify(problem));
        result = { valid: true, items: current.data.items.length, file: timeline.FILE };
      } else {
        const selected = current.data.items.find((it) => it.id === id);
        if (!selected) throw new Error(`No layer ${id}; bun run openfilm timeline --film <path>`);
        if (command === "edit" && !args.props && !args["props-file"])
          throw new Error("edit requires --props JSON or --props-file path");
        if (command === "edit") result = timeline.edit(id, custom);
        else {
          const data = { items: current.data.items.filter((it) => it.id !== id) };
          const saved = timeline.write(current.version, data);
          if (saved.conflict || saved.problems) throw new Error(JSON.stringify(saved));
          result = { ...saved, data };
        }
      }
    }
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
