import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { resolveOpenFilmRecipe } from "../packages/film-stage/src/openfilm-recipes.ts";
import { resolveAsset } from "../packages/live-studio/src/asset-recipes.mjs";
import { ASSET_LANES, openAssets } from "../packages/live-studio/src/assets.mjs";
import { cliArgs, numberArg, secondArg } from "../packages/live-studio/src/cli.mjs";
import { AssetUsageError } from "../packages/live-studio/src/placed-lane.mjs";
import { allEntries, kindFilter } from "./find.ts";

const HELP = `Usage: bun run asset <command> [id-or-target] [options]

Place and edit assets selected with find: 2D effects/text/cuts/grades/audio, 3D Minecraft blocks/mobs (placed lane),
pack cherry-picks (pick/unpick), and reusable Global props (prop:global:<id> -> src/props/).
OpenFilm is a source filter. Operations run offline, without credits or downloads.
Start here: bun run skills get core; details: bun run skills get core --ref contract.

Discover -> inspect -> place -> inspect the saved lane -> render -> edit:
  bun run find chair --kind object
  bun run find --show <id>
  bun run asset pick block:decor:oak_chair --film films/<name>
  bun run asset use block:decor:oak_chair --film films/<name> --from 2 --props '{"at":[1,0,3]}'
  bun run asset use prop:global:<id> --film films/<name>
  bun run asset timeline --film films/<name> --lane placed
  bun run asset edit placed:oak_chair --film films/<name> --from 4 --props '{"at":[2,0,3]}'

plan <template-id>           Preview layers, original music and camera-slot timings; writes nothing.
pick <id[,id]>               Add block:<ns>:<id> or item:<ns>:<id> to pack/picks.json and rebuild picked.zip.
unpick <id[,id]>             Remove from pack/picks.json, warn on placed.json refs, rebuild picked.zip.
use <id>                     Place 2D effect/cut/grade/audio/3D block/mob in its lane, or copy prop:global:<id> to src/props/.
use /page.html               Place a local page from the film's public assets.
timeline                     Read one lane in heard/output seconds (effects default, or placed/picks/text/adjustment/transitions/audio).
edit <target>                Merge controls into one item; targets: effects:ID, placed:NAME, text:ID, adjustment:ID,
                             transitions:N, audio:beds:ID or audio:sfx:ID. With placed:NAME use --from <heard s> for keyframes.
remove <target>              Remove that item; transitions:N removes the transition, preserving the shot.
validate                     Validate configured lanes, placed.json and pack/picks.json schemas; does not render.

--film <path>                Film folder, default current folder. Required for film operations from root.
--duration <scene seconds>   Code-defined source DURATION; required for retiming/cuts without edit.end.
--kind <type>                Optional find kind/category to disambiguate (use/pick/unpick/plan).
--source <source>            Optional pack slug, jar or source filter to disambiguate (pick/unpick/use/plan).
--from <seconds> --to <seconds>   Heard/output seconds (65, 1:05 or 01:05.250); placed objects take --from only (not --to).
--shot <N>                   Cut into shot N; 1 = second shot. use keeps the cut time, --to minus --from sets duration.
--lane <name>                effects, text, adjustment, transitions, audio, placed, picks (timeline).
--no-build                   With pick/unpick: update pack/picks.json without rebuilding assets/public/picked.zip.
--no-pick                    With use on a mod block: write placed.json without modifying pack/picks.json.
--force                      With use prop:global:<id>: overwrite existing files in src/props/.
--props <JSON>               Creative controls (placed key: at, rot, scale, visible, ease, keyClip, keyRate, removeKey; object: name, properties, clip, rate).
--props-file <file>          UTF-8 JSON object, BOM accepted; recommended on PowerShell. Choose one props option.
--json                       Accepted for automation; output is already JSON. Errors go to stderr.

Native text example: {"text":"Hello","x":0.5,"y":0.8,"size":56,"color":"#ffd86b"}.
HTML text example: {"text":{".t":"Hello"},"vars":{"--color":"#ffd86b"},"size":0.2}.
Placed example: {"at":[1,0,3],"rot":[0,90,0],"scale":1.5}. Mobs take {"clip":"walk","rate":1}.
Positions x/y use 0-1. Native text/shape size uses pixels at a 1080px short side; HTML overlay size is a scale.
Native grades accept grade controls; text/shapes retain custom fields. Overlay controls include x/y, size,
rotate, opacity, rate, offset, loop, blend, track, fadeIn/fadeOut, text selectors and CSS vars (find --show lists them).
Audio defaults to music beds or one-shot SFX; {"bed":true} places ambience as a bed. Gain is dB.
An audio time inside a linked hold may not map to source time; the command rejects it before writing.
Use an independent audio/SFX clock in timing.json or a custom output-time mix for those cues.
edit uses heard seconds; transition edit's len is heard duration. Keep the target returned by use.
Templates add overlays and music; their camera slots guide your own 3D scene, not an automatic scene rewrite.

Create freely in src/scene.ts or edit source; this catalog is a starting kit, not a limit.
HTML/CSS/canvas recipes become Three.js textures; audio/cuts/grades keep their native lanes.
Imported source: vault/openfilm/library. Reload after HTML edits; restart Studio after _definitions/catalog edits.
Raw asset bytes are outside render stamps: force affected video chunks with CHUNKS=N after source edits.
Studio groups assets under Audio, Text, Transitions, Adjustment, Effects and Objects; OpenFilm is a source filter.
Pack/restore editable source, WAVs and licenses: bun run pack:sound; bun run setup --sound-zip <zip>.
Legacy list/info forward to find's text output; plan/pick/unpick/use/timeline/edit/remove/validate return JSON.
Exit: 0 success, 1 operation/data error, 2 usage error. Verify placed visuals with a still/clip; validate is data-only.`;

const flags = [
  "film",
  "duration",
  "kind",
  "source",
  "query",
  "group",
  "limit",
  "offset",
  "from",
  "to",
  "shot",
  "lane",
  "props",
  "props-file",
];
export async function runAsset(input = process.argv.slice(2), defaultSource) {
  const argv = cliArgs(
    HELP,
    [...flags.map((f) => `--${f} value`), "--json", "--no-build", "--no-pick", "--force"],
    2,
    input,
  );
  const usage = (message) => {
    console.error(`${message}; bun run asset --help`);
    process.exit(2);
  };
  let args, command, id;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ...Object.fromEntries(flags.map((f) => [f, { type: "string" }])),
        json: { type: "boolean" },
        "no-build": { type: "boolean" },
        "no-pick": { type: "boolean" },
        force: { type: "boolean" },
      },
    });
    [command, id] = parsed.positionals;
    args = parsed.values;
  } catch (error) {
    usage(error.message);
  }
  if (!command) {
    console.log(HELP);
    process.exit(0);
  }
  const allowed = {
    list: ["kind", "source", "query", "group", "limit", "offset"],
    info: ["source", "kind"],
    plan: ["kind", "source", "from", "to"],
    pick: ["kind", "source", "no-build"],
    unpick: ["kind", "source", "no-build"],
    use: [
      "kind",
      "source",
      "from",
      "to",
      "shot",
      "props",
      "props-file",
      "duration",
      "no-pick",
      "force",
    ],
    timeline: ["lane", "duration"],
    edit: ["from", "props", "props-file", "duration"],
    remove: ["duration"],
    validate: [],
  };
  if (!Object.hasOwn(allowed, command)) usage(`Unknown command ${command}`);
  if (defaultSource && ["list", "info", "plan", "use"].includes(command))
    args.source ??= defaultSource;
  const takesId = ["info", "plan", "pick", "unpick", "use", "edit", "remove"].includes(command);
  if (takesId !== Boolean(id))
    usage(takesId ? `${command} needs an asset ID or saved target` : `${command} takes no ID`);
  for (const flag of Object.keys(args))
    if (!["film", "json", ...allowed[command]].includes(flag))
      usage(`--${flag} does not apply to ${command}`);
  if (args.lane && !ASSET_LANES.includes(args.lane))
    usage(`Unknown lane ${args.lane}; lanes: ${ASSET_LANES.join(", ")}`);
  if (args.props && args["props-file"]) usage("Choose --props or --props-file");
  let props = {};
  try {
    props = args["props-file"]
      ? JSON.parse(readFileSync(resolve(args["props-file"]), "utf8").trimStart())
      : args.props
        ? JSON.parse(args.props)
        : {};
    if (!props || typeof props !== "object" || Array.isArray(props))
      usage("Creative controls must be a JSON object");
  } catch (error) {
    usage(`Cannot read creative controls: ${error.message}`);
  }
  if (command === "edit" && !args.props && !args["props-file"])
    usage("edit needs --props or --props-file");
  const times = Object.fromEntries(
    ["from", "to"]
      .filter((key) => args[key] !== undefined)
      .map((key) => [key, secondArg(`--${key}`, args[key])]),
  );
  if (times.to !== undefined && times.to <= (times.from ?? 0)) usage("--to must follow --from");
  const shot =
    args.shot === undefined ? undefined : numberArg("--shot", args.shot, { min: 1, int: true });
  const limit =
    args.limit === undefined
      ? 40
      : numberArg("--limit", args.limit, { min: 1, max: 200, int: true });
  const offset =
    args.offset === undefined ? 0 : numberArg("--offset", args.offset, { min: 0, int: true });
  try {
    const project = resolve(args.film ?? process.cwd()),
      pkgFile = join(project, "package.json");
    const conf = existsSync(pkgFile)
      ? (JSON.parse(readFileSync(pkgFile, "utf8"))["live-studio"] ?? {})
      : {};
    const writesFilm = ["pick", "unpick", "use", "timeline", "edit", "remove", "validate"].includes(
      command,
    );
    if (writesFilm && !existsSync(join(project, "src/scene.ts")))
      usage("Choose a film with --film films/<name>, or run inside it");
    const duration =
      args.duration === undefined
        ? undefined
        : numberArg("--duration", args.duration, { min: Number.MIN_VALUE });
    if (command === "list" || command === "info") {
      if (args.json)
        usage("Discovery aliases use find's text output; drop --json and use bun run find");
      const forwarded =
        command === "info"
          ? ["--show", id]
          : ["--kind", args.kind ?? "transition,look,text,shape,asset"];
      if (command === "info" && args.kind) forwarded.push("--kind", args.kind);
      if (args.source) forwarded.push("--source", args.source);
      if (args.query) forwarded.push(args.query);
      if (args.group) forwarded.push("--group", args.group);
      if (args.limit) forwarded.push("-n", String(limit));
      if (args.offset) forwarded.push("--offset", String(offset));
      console.error(
        `asset ${command} is a compatibility alias; use bun run find${command === "info" ? " --show <id>" : " <words> [filters]"}. Discovery follows find's text output.`,
      );
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL("./find.ts", import.meta.url)), ...forwarded],
        { cwd: project, stdio: "inherit", timeout: 30000, windowsHide: true },
      );
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
      return;
    }
    const api = openAssets(project, conf, { duration });
    let result;
    if (command === "pick" || command === "unpick") {
      const ids = id
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) usage(`${command} needs one or more asset IDs`);
      result = await (command === "pick" ? api.pick : api.unpick)(ids, {
        kind: args.kind?.toLowerCase(),
        source: args.source,
        build: !args["no-build"],
      });
    } else if (command === "plan" || command === "use") {
      const mPref = /^(block|item|mob|prop):/i.exec(id);
      const idPrefix = mPref?.[1]?.toLowerCase();
      const kindLower = args.kind?.toLowerCase();
      if (kindLower === "object" || kindLower === "3d") {
        usage(
          `--kind ${kindLower} is a search umbrella; pass --kind block, item, mob, or prop (or prefix with block:/item:/mob:/prop:)`,
        );
      }
      const objectKinded = Boolean(
        kindLower && ["block", "item", "mob", "prop"].includes(kindLower),
      );
      if (command === "use" && idPrefix && kindLower && idPrefix !== kindLower) {
        usage(`--kind ${kindLower} contradicts "${id}"`);
      }
      if (command === "use" && (idPrefix || objectKinded)) {
        if (shot !== undefined) {
          usage("--shot applies to transitions and 2D effects, not 3D placed objects");
        }
        result = await api.use(id, {
          ...times,
          kind: idPrefix ?? kindLower,
          source: args.source,
          noPick: Boolean(args["no-pick"]),
          force: Boolean(args.force),
          props,
        });
      } else {
        if (command === "use" && (args["no-pick"] || args.force)) {
          usage("--no-pick and --force apply only to 3D blocks and prop:global:<id>");
        }
        const entries = allEntries(false, project),
          selection = args.kind ? kindFilter(args.kind.split(","), entries) : undefined;
        if (selection?.bad.length) usage(selection.bad.join("; "));
        const page =
          command === "use" && (!args.source || args.source === "openfilm")
            ? resolveOpenFilmRecipe(id, [])
            : undefined;
        const recipe = page
          ? { source: "openfilm", kind: "asset", upstreamId: page.id }
          : resolveAsset(id, selection ? entries.filter(selection.test) : entries, args.source);
        result =
          command === "plan"
            ? api.plan(recipe, times.from ?? 0, times.to)
            : await api.use(recipe, { ...props, ...times, ...(shot !== undefined && { shot }) });
      }
    } else if (command === "timeline") result = await api.timeline(args.lane);
    else if (command === "validate") result = api.validate();
    else result = await api.change(id, props, command === "remove", { ...times });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = error instanceof AssetUsageError ? error.code : 1;
  }
}

if (import.meta.main) await runAsset();
