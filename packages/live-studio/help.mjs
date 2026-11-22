// bun run help: every command of the package.json here (the repo root's or a film's), one line each, grouped by the job
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCliInvocation, CLI_COMMANDS } from "./src/cli-catalog.ts";
import { cliArgs } from "./src/cli.mjs";

/** @type {[string, Record<string, string>][]} */
const GROUPS = [
  [
    "Start here",
    {
      skills:
        "Start here (for AI): bun run skills get core — version-matched workflow, clocks, costs and --ref topics",
      gap: 'keep a missing capability and what you tried (or why blocked): bun run gap "<need>" --did "<outcome>"; bare, historical reports',
    },
  ],
  [
    "Make the film",
    {
      studio:
        "the live studio: preview, timeline, notes (bun run studio --detach to start in background; --status, --stop, --lan)",
      collab:
        "read protected Studio edits; write or write-many intentional AI changes with an explicit current base (--help)",
      history:
        "named versions and autosaves for one film; restore with a recovery version kept first (--help)",
      check:
        "is the film's data what the studio expects? after any edit to src/timeline, src/edit.json or pack/picks.json",
      at: "what the film has at one heard second, each with its file and row: shot, camera (optics), word, sounds, text, moving keys, notes",
      find: "native/imported assets, 3D blocks/items/mobs/props and code helpers; BM25 + OpenFilm semantic; --kind object searches 3D",
      "assets:semantic":
        "incremental multimodal search: plan, build/resume, query, remove/redo or backup; API only with --yes (--help)",
      asset:
        "pick/unpick pack blocks & items, preview 3D models beside Steve, place/edit 2D lanes & placed objects, or copy Global props to src/props/",
    },
  ],
  [
    "Narration",
    {
      "voice:playground":
        "GenVoice casting, Project/Global archives, templates and section editing; --help then schema <command>; paid actions preview until --yes",
      "voice:gen":
        "narration takes from ElevenLabs for src/edit.json takes (previews; spends credits only with --yes)",
      "voice:align":
        "word timings for takes that lack them (whisperX, local and free); voice:assemble needs them",
      "voice:lips":
        'lip sync: mouth shapes for the takes a character says on screen ("by"; Rhubarb, local and free)',
      "voice:assemble": "lays the takes onto the film: full_voice.wav, voice.lines, Phrase Bricks",
      "voice:cues": "the heard second of every line, word and silent gap (--json for words)",
    },
  ],
  [
    "Sound",
    {
      "sfx:get": "fetch the CC0 Freesound sounds the film pins, or search Freesound (find)",
      mix: "film soundtrack; mix <video> writes draft/final for whole-film renders, a separate preview for excerpts",
      listen:
        "current mix before mastering: masking, loud SFX, level jumps, mono and near silence; --at for one window",
    },
  ],
  [
    "Look and review",
    {
      render:
        "draft stills (bun run render stills --at 12,30), the film as video (render clip), the upload (render final, only when asked), one frame at its size (bun run render poster --at 12); --check motion:cam,40,48 charts a move; --check probe:4 logs live 3D bounds/screen coords; --check order checks history-dependent frames; --views, --crop and --compare inspect stills",
      sheet:
        "contact sheets; overview [A-B[/N]] for a bounded picture map, frames TIMES for native evidence (--vs references/ref.mp4 sets each beside the reference's frame), or explicit image grids; each new run has index.json",
      scenes:
        "suggest cuts in a local reference video (PySceneDetect, optional CPU tool): JSON, CSV, scene images and HTML; file seconds",
      media:
        "local media/AI tools (media list / doctor): audio stems/beats/locate/VAD/denoise, OCR/vision/tracking, OTIO, QC and FFmpeg (media --help)",
      qc: "inspect an encoded video, camera motion, an image region (box), or pixel changes (compare); --help for checks",
      framecheck:
        "encoded picture faults: black, flashes, jumps, shimmer, freezes; --json gives retained evidence",
      sweep:
        "a whole draft against the reference, heaviest first: our pops and stutters, blur, light, cuts; new and gone since the last sweep",
      reference:
        "add <video> to references/, timecode <video> for a bottom timecode strip copy, inspect <video|URL> for pictures/captions, study/compare timing or solve a shot's camera; optional, no quality gate",
      pace: "current whole-film render: shot lengths and picture holds with planned narration",
      deliver:
        "technical upload profile (renders/final.mp4); --youtube adds a local compression and banding preview",
    },
  ],
  [
    "The creator's notes",
    {
      notes:
        "the creator's open notes (up to 25; ID for one in full, --shot N, --sort, --limit, --no-lessons)",
      note: 'answer one: bun run note done (requires --after <img> or --no-after "<reason>", optional --cam/--t custom view), ask, learned, or restore (--help)',
    },
  ],
  [
    "Set up",
    {
      "new-film":
        "create from templates/film, install dependencies, link vault and build picks: bun run new-film <name> [port]; prepared vault required",
      setup:
        "a new machine in one go: bun install, setup:vault, link (--vault-zip <core.zip> --vault-zip <heavy.zip> restores private vault zips)",
      "pack:vault":
        "pack pure static vault assets into split private core (~1.2 GB) + heavy (~13.8 GB) zips (excludes tools/ and cache/) for setup --vault-zip",
      "pack:sound":
        "every sound and the complete OpenFilm source in one private zip, for setup --sound-zip on another machine",
      "setup:vault": "fill the vault on a new machine (downloads, verified)",
      "setup:sound": "rebuild vault/sound/{bgm,sfx} with credits and peaks",
      "setup:mc-sound": "rebuild the Minecraft sound vault from the game and packs",
      "setup:voices":
        "sync the English voice catalogue to vault/voices/shared-en.json (network, no voice credits)",
      "fetch:sfx": "download the Mixkit sound effects",
      "fetch:sound-raw": "download the raw sound packs (Kenney) into the external vault",
      "fetch:openfilm":
        "import all OpenFilm audio as native WAVs and keep editable visual source; resumable, --verify checks coverage",
      openfilm:
        "compatibility alias for asset with the OpenFilm source selected; use asset for the shared workflow",
      link: "reconnect the prepared vault and rebuild picks for every film (or those named); no install or download",
    },
  ],
  [
    "Code",
    {
      test: "every package's tests; accepts native Bun test flags",
      "test:parallel": "the full suite with 2 isolated Bun workers; supports timings and shards",
      ci: "lint, typecheck and the full parallel test suite together; includes Studio build tests",
      doctor:
        "React Doctor source diagnostics (advisory, 120s budget); --json for structured results",
      verify: "lint and typecheck together",
      lint: "oxlint",
      typecheck: "bun check",
      fmt: "format (bun fmt --no-script <files> for a few)",
      "fmt:check": "is everything formatted?",
      "eval:find":
        "search diagnostics; --mode dual checks BM25/OpenFilm separately without Jev, cached-only unless --live (--help)",
      "eval:lessons": "how well notes ID picks the lessons for a note (Jev)",
      "eval:load": "how fast the studio page loads, desk and phone",
    },
  ],
];

const HELP = `Discover mc-films commands from the repo root or a film folder.

Usage: bun run help [command] [--json]

Start here:
  bun run skills get core              Read the workflow and time conventions
  bun run skills get core --ref review Choose picture, sound, and timing checks
  bun run skills get core --ref contract Read the film contract and scene hooks

Commands:
  bun run help                         List commands by task and show the film file map when available
  bun run help <command>               Find where to run the command and how to open its help
  bun run help direct                  List direct tools and package commands with catalog IDs

Options:
  --json                               List command IDs and summaries as JSON
  <command> --json                     Show one command's catalog schema, e.g. bun run help at --json

Run a command's own --help for its current flags and examples.`;
const argv = cliArgs(HELP, ["--json"], 1, process.argv.slice(2), {
  helpWord: !process.argv.includes("--json"),
});
const asked = argv.find((a) => a !== "--json");
const pkgFile = join(process.cwd(), "package.json");
const scripts = existsSync(pkgFile)
  ? (JSON.parse(readFileSync(pkgFile, "utf8")).scripts ?? {})
  : {};
const film = existsSync(join(process.cwd(), "src/scene.ts"));
const scope = film ? "film" : "root";
const direct = CLI_COMMANDS.filter(
  (c) =>
    c.runner !== "bun-script" &&
    c.runner !== "earshot" &&
    !(Object.hasOwn(scripts, c.id) && !String(scripts[c.id]).includes("wrong-place.mjs")),
);
const known = CLI_COMMANDS.find((c) => c.id === asked);
if (argv.includes("--json")) {
  if (asked && asked !== "direct" && !known && !Object.hasOwn(scripts, asked)) {
    console.error(`no command ${asked}; bun run help --json lists command IDs`);
    process.exit(2);
  }
  const catalog = asked === "direct" ? direct : asked ? (known ? [known] : []) : CLI_COMMANDS;
  const commands = catalog.map((c) => ({
    ...(asked && asked !== "direct"
      ? c
      : {
          id: c.id,
          summary: c.summary,
          runner: c.runner,
          cwdModes: c.cwdModes,
          helpMode: c.meta.helpMode,
        }),
    availableHere:
      c.runner === "bun-script"
        ? Object.hasOwn(scripts, c.target) && !String(scripts[c.target]).includes("wrong-place.mjs")
        : c.cwdModes.includes(scope),
  }));
  const listed = new Set(commands.map((command) => command.id));
  for (const [id, script] of Object.entries(scripts)) {
    if (
      listed.has(id) ||
      (id === "postinstall" && !asked) ||
      CLI_COMMANDS.some((c) => c.runner === "bun-script" && c.target === id) ||
      (asked && asked !== id)
    )
      continue;
    if (asked === "direct") continue;
    commands.push({
      id,
      script,
      runner: "bun-script",
      availableHere: !String(script).includes("wrong-place.mjs"),
    });
  }
  console.log(JSON.stringify({ success: true, data: { cwd: process.cwd(), scope, commands } }));
  process.exit(0);
}
const describe = (command) => {
  const helpId =
    process.platform === "win32" &&
    ["catalog:tag-sh", "catalog:review-sh", "catalog:sweep-sh"].includes(command.id)
      ? "catalog:batch"
      : command.id;
  const invocation =
    command.meta.helpMode === "none"
      ? null
      : buildCliInvocation(
          { commandId: helpId, mode: "help" },
          {
            activeFilm: film ? "." : null,
            repoRoot: fileURLToPath(new URL("../..", import.meta.url))
              .replaceAll("\\", "/")
              .replace(/\/+$/, ""),
          },
        );
  const directory = command.packageDir ?? invocation?.cwdMode ?? command.cwdModes.join(" or ");
  const helpCommand =
    command.runner === "package-script" && invocation
      ? `bun run ${command.target} ${invocation.argvTokens.join(" ")}`
      : invocation?.displayCommand;
  return `${command.id}: ${command.summary}\n  run in ${directory}: ${helpCommand ?? "no standalone help; read this command's schema with bun run help " + command.id + " --json"}`;
};
// "bun run help find" is how one asks about one command
if (asked) {
  if (Object.hasOwn(scripts, asked)) {
    // a command of the other place: point there at once, not at a stub that only redirects
    const elsewhere = String(scripts[asked]).includes("wrong-place.mjs");
    const inFilm = existsSync(join(process.cwd(), "src/scene.ts"));
    console.log(
      elsewhere
        ? inFilm
          ? `${asked} runs at the repo root: cd ../.. && bun run ${asked} --help`
          : `${asked} runs in a film: cd films/<name> && bun run ${asked} --help`
        : `for one command: bun run ${asked} --help`,
    );
    process.exit(0);
  }
  if (asked === "earshot") {
    console.log(
      "earshot is a CLI of its own: earshot -h, and earshot <command> -h for one command",
    );
    process.exit(0);
  }
  if (asked === "direct") {
    console.log(direct.map(describe).join("\n\n"));
    process.exit(0);
  }
  if (known) {
    console.log(describe(known));
    process.exit(0);
  }
  console.error(`no command ${asked} here: bun run help lists them`);
  process.exit(2);
}
// postinstall runs by itself after bun install; a command of the other place (wrong-place.mjs) only says where it runs
const stubs = Object.keys(scripts).filter((k) => String(scripts[k]).includes("wrong-place.mjs"));
const said = new Set(["help", "postinstall", ...stubs]);
const out = [];
for (const [title, cmds] of GROUPS) {
  const lines = Object.entries(cmds)
    .filter(([k]) => k in scripts && !said.has(k))
    .map(([k, about]) => {
      said.add(k);
      return `  ${k.padEnd(18)}${about}`;
    });
  // earshot is a CLI of its own, not a script here: named so an AI knows it can hear what a sound is, not only its level
  if (title === "Sound")
    lines.push(
      `  ${"earshot".padEnd(18)}ears, its own CLI (earshot <command> -h): which sound fits, what plays when, hits on the cuts${Bun.which("earshot") ? "" : " (not on PATH: INSTALL.md)"}; which call for what: bun run skills get core --ref sound`,
    );
  if (lines.length) out.push(`${out.length ? "\n" : ""}${title}`, ...lines);
}
const rest = Object.keys(scripts).filter((k) => !said.has(k));
if (rest.length) out.push("\nOther", ...rest.map((k) => `  ${k.padEnd(18)}${scripts[k]}`));
out.push(
  "\nDirect maintenance scripts",
  "  mocap catalogue, sweep, review/eval; asset pick/unpick; timeline formatting",
  "  bun run help direct — paths, working directory and workflow: bun run skills get core --ref film",
  "  bun run help --json — all command IDs; bun run help <id> --json — arguments, flags, cost and effects",
);
// Where a film keeps what: its own package.json "live-studio" names the timeline files, so the map is this film's
if (film) {
  let conf = {};
  try {
    conf = JSON.parse(readFileSync(pkgFile, "utf8"))["live-studio"] ?? {};
  } catch {} // bun run check names a broken package.json
  const what = {
    soundTimeline: "sound: beds, sfx, narration, room reverb and 3D anchors",
    camTimeline: "camera keys and cuts",
    lightsTimeline: "light keys, atmosphere, fog and practicals",
    shotsTimeline: "shots: start, name, framing, transition",
    textTimeline: "titles and on-screen text",
    adjustmentTimeline: "colour and look layers",
    timingTimeline: "speed ramps, freezes, velocity",
  };
  const files = [
    ["src/scene.ts", "the film's code: buildScene, draw(t)"],
    ["src/edit.json", "narration takes and script, voice warp, beats, the film's own settings"],
    ...Object.entries(what).flatMap(([k, about]) => (conf[k] ? [[conf[k], about]] : [])),
    [
      conf.openfilmTimeline ?? "src/timeline/openfilm.json",
      "HTML/CSS/canvas effects, stickers and animated text",
    ],
    ...Object.entries(conf.keyFiles ?? {}).map(([f, name]) => [
      f,
      `${name}: keyed rows (moves, poses, placed objects, values over time)`,
    ]),
    ["pack/picks.json", "cherry-picked mod/RP blocks & items for assets/public/picked.zip"],
    ["src/props/", "custom TypeScript/GLB props for this film"],
    ["renders/", "what render, sheet, framecheck write"],
    ["notes/", "the creator's notes (read them with bun run notes)"],
    [
      "lessons/",
      "this film's lessons (every film's: ../../lessons/, nested .md allowed; notes ID picks both)",
    ],
  ].map(
    ([f, about]) =>
      `  ${f.padEnd(28)}${about}${existsSync(join(process.cwd(), f)) ? "" : " (none yet)"}`,
  );
  out.push(
    "\nWhere things are (edit a timeline by hand or in the studio, then bun run check)",
    ...files,
    "  what the studio needs from each file, and the hooks: bun run skills get core --ref contract",
  );
}
console.log(
  `${film ? "This film's" : "The repo's"} commands: bun run <command> [--help]\n\n${out.join("\n")}${
    film
      ? `\n\nThe repo's commands (${stubs.join(", ") || "test, lint, new-film ..."}): at the repo root, bun run help there`
      : `\n\nA film's own commands (${stubs.join(", ") || "studio, render, notes ..."}): cd films/<name> && bun run help` +
        `\nThe films: ${
          existsSync("films")
            ? readdirSync("films")
                .filter((f) => existsSync(join("films", f, "src/scene.ts")))
                .join(", ") || "none yet"
            : "none yet"
        } (a new one: bun run new-film <name>). The packages: AGENTS.md; the vault and its setup: INSTALL.md`
  }`,
);
