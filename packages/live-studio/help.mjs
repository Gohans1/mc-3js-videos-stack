// bun run help: every command of the package.json here (the repo root's or a film's), one line each, grouped by the job
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cliArgs } from "./src/cli.mjs";

/** @type {[string, Record<string, string>][]} */
const GROUPS = [
  [
    "Make the film",
    {
      studio: "the live studio: preview, timeline, notes (bun run studio, then open the link)",
      check:
        "is the film's data what the studio expects? after any edit to src/timeline, src/edit.json",
      at: "what the film has at one heard second, each with its file and row: shot, camera, word, sounds, text, moving keys, notes",
      find: "a sound, music, mocap clip, transition, text voice, font or look by words; prints where it goes",
    },
  ],
  [
    "Narration",
    {
      "voice:gen":
        "narration takes from ElevenLabs for src/edit.json takes (spends credits; --dry-run first)",
      "voice:assemble": "lays the takes onto the film: full_voice.wav, voice.lines, Phrase Bricks",
      "voice:cues": "the heard second of every line, word and silent gap (--json for words)",
    },
  ],
  [
    "Sound",
    {
      "sfx:get": "fetch the CC0 Freesound sounds the film pins, or search Freesound (find)",
      mix: "the soundtrack: sound/mix.wav; mix <video> puts it on the draft (renders/draft.mp4)",
      listen:
        "ears: voice buried under beds/sfx, sounds louder than it, jumps at cuts, dead air (--sheet: a picture)",
    },
  ],
  [
    "Look and review",
    {
      render:
        "draft stills (AT=12,30 bun run render stills), the film as video (render clip), the upload (render final, only when asked); CHECK=motion:cam,40,48 charts a move's speed",
      sheet: "contact sheets of the stills or of a video's frames, to look at many at once",
      jumps: "pops in a rendered video: frames that jump away from their neighbours",
      framecheck: "the last check on the encoded video: black, flashes, jumps, shimmer, freezes",
    },
  ],
  [
    "The creator's notes",
    {
      notes: "the creator's open notes (ID for one in full, --shot N for a shot's)",
      note: "answer one: bun run note done (waits for the creator's check), ask, or learned (--help)",
    },
  ],
  [
    "Set up",
    {
      "new-film": "a new film from templates/film: bun run new-film <name> [port]",
      "setup:vault": "fill the vault on a new machine (downloads, verified)",
      "setup:sound": "rebuild vault/sound/{bgm,sfx} with credits and peaks",
      "setup:mc-sound": "rebuild the Minecraft sound vault from the game and packs",
      "fetch:sfx": "download the Mixkit sound effects",
      link: "connect the vault to every film (or the films named)",
    },
  ],
  [
    "Code",
    {
      test: "every package's tests",
      verify: "lint and typecheck together",
      lint: "oxlint",
      typecheck: "bun check",
      check: "the same as typecheck",
      fmt: "format (bun fmt --no-script <files> for a few)",
      "fmt:check": "is everything formatted?",
    },
  ],
];

const HELP = `Every command here, one line each, grouped by the job. Each takes --help for everything it does.
  bun run help`;
const pkgFile = join(process.cwd(), "package.json");
const scripts = existsSync(pkgFile)
  ? (JSON.parse(readFileSync(pkgFile, "utf8")).scripts ?? {})
  : {};
// "bun run help find" is how one asks about one command
const asked = process.argv[2];
if (asked && !asked.startsWith("-") && asked !== "help") {
  if (asked in scripts) {
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
  console.error(`no command ${asked} here: bun run help lists them`);
  process.exit(2);
}
cliArgs(HELP, [], 0);
const film = existsSync(join(process.cwd(), "src/scene.ts"));
// postinstall runs by itself after bun install; a command of the other place (wrong-place.mjs) only says where it runs
const stubs = Object.keys(scripts).filter((k) => String(scripts[k]).includes("wrong-place.mjs"));
const said = new Set(["help", "postinstall", ...stubs]);
const out = [];
for (const [title, cmds] of GROUPS) {
  const lines = Object.entries(cmds)
    // "check" is the film contract in a film and lint plus typecheck at the root
    .filter(([k]) => k in scripts && !said.has(k) && (k !== "check" || (title === "Code") !== film))
    .map(([k, about]) => {
      said.add(k);
      return `  ${k.padEnd(16)}${about}`;
    });
  if (lines.length) out.push(`${out.length ? "\n" : ""}${title}`, ...lines);
}
const rest = Object.keys(scripts).filter((k) => !said.has(k));
if (rest.length) out.push("\nOther", ...rest.map((k) => `  ${k.padEnd(16)}${scripts[k]}`));
// Where a film keeps what: its own package.json "live-studio" names the timeline files, so the map is this film's
if (film) {
  let conf = {};
  try {
    conf = JSON.parse(readFileSync(pkgFile, "utf8"))["live-studio"] ?? {};
  } catch {} // bun run check names a broken package.json
  const what = {
    soundTimeline: "sound: beds, sfx, the narration's place",
    camTimeline: "camera keys and cuts",
    shotsTimeline: "shots: start, name, framing, transition",
    textTimeline: "titles and on-screen text",
    adjustmentTimeline: "colour and look layers",
    timingTimeline: "speed ramps, freezes, velocity",
  };
  const files = [
    ["src/scene.ts", "the film's code: buildScene, draw(t)"],
    ["src/edit.json", "narration takes and script, voice warp, beats, the film's own settings"],
    ...Object.entries(what).flatMap(([k, about]) => (conf[k] ? [[conf[k], about]] : [])),
    ...Object.entries(conf.keyFiles ?? {}).map(([f, name]) => [
      f,
      `${name}: keyed rows (moves, poses, values over time)`,
    ]),
    ["renders/", "what render, sheet, jumps, framecheck write"],
    ["notes/", "the creator's notes (read them with bun run notes)"],
  ].map(
    ([f, about]) =>
      `  ${f.padEnd(28)}${about}${existsSync(join(process.cwd(), f)) ? "" : " (none yet)"}`,
  );
  out.push(
    "\nWhere things are (edit a timeline by hand or in the studio, then bun run check)",
    ...files,
    "  every field of each file: node_modules/live-studio/docs/film-contract.md",
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
        } (a new one: bun run new-film <name>). The packages and the skill: AGENTS.md; the vault and its setup: INSTALL.md`
  }`,
);
