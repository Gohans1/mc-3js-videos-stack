// Connects a film project to this studio: node init.mjs PROJECT [--dry]
// The film keeps only what is its own, plus package.json scripts that point here (bun run studio, notes, note, render, framecheck, check).
// It never holds a copy of the studio, so a fix made here reaches every film at once. What a project lacks comes from the demo,
// and nothing it already has is overwritten (its src/edit.ts may merge files of its own).
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, jsonFile } from "./src/cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTER = [
  "src/scene.ts",
  "src/edit.ts",
  "src/edit.json",
  "sound.py",
  "assets/public",
  ".gitignore",
];
// What the film used to hold to reach the studio; package.json scripts do it now (bun run studio, notes, note, render)
const OLD_POINTERS = {
  "src/live.mjs": `// Opens this film in the studio, which lives in its own repo: node_modules/live-studio links to it.
import { fileURLToPath } from "node:url";

process.env.LIVE_PROJECT = fileURLToPath(new URL("..", import.meta.url));
await import("live-studio/src/live.mjs");
`,
  "notes_report.py": `"""Reads this film's notes with the studio's report: python notes_report.py [ID ...] [--shot N]"""
import os
import runpy
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)
runpy.run_path("node_modules/live-studio/notes_report.py", run_name="__main__")
`,
};

const HELP = `Connect a new or existing project to this Studio; preserve its custom files and scripts.
  bun packages/live-studio/init.mjs PROJECT [--dry-run]
  --dry-run    preview without writing files, registering links or installing dependencies
  --dry        alias for --dry-run
In this monorepo, use bun run new-film <name> instead: it also links the vault and builds picks.
Workspace dependencies stay workspace:*; standalone projects register this Studio with bun link.
Installs dependencies (network, up to 5 minutes). On failure, fix the error and rerun this command.
next: cd PROJECT and run bun run studio`;
const args = cliArgs(HELP, ["--dry-run", "--dry"], 1);
const dry = args.includes("--dry") || args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("PROJECT is required: bun packages/live-studio/init.mjs PROJECT [--dry-run]");
  process.exit(2);
}
const PROJECT = resolve(target);
if (existsSync(PROJECT) && realpathSync(PROJECT) === realpathSync(HERE)) {
  console.error("that's the studio itself: point this at a film");
  process.exit(1);
}
const inProject = (f) => join(PROJECT, f);
const say = (what, file) => console.log(`${what.padEnd(9)} ${file}`);
const write = (file, text) => {
  if (!dry) {
    mkdirSync(dirname(inProject(file)), { recursive: true });
    writeFileSync(inProject(file), text);
  }
};
const run = (args, cwd) => {
  const r = spawnSync("bun", args, { cwd, stdio: "inherit", windowsHide: true, timeout: 300_000 });
  if (r.error || r.status !== 0) {
    console.error(
      `bun ${args.join(" ")} failed${r.error ? `: ${r.error.message}` : ""}. Files are kept; fix the error and retry.\nnext: bun ${JSON.stringify(join(HERE, "init.mjs"))} ${JSON.stringify(PROJECT)}`,
    );
    process.exit(1);
  }
};

const pkgFile = inProject("package.json");
const pkg = existsSync(pkgFile)
  ? jsonFile(pkgFile, PROJECT)
  : { name: "film", private: true, type: "module", dependencies: { three: "0.187.0" } };

for (const f of STARTER) {
  if (existsSync(inProject(f))) continue;
  say("starter", f);
  if (!dry) cpSync(join(HERE, "demo", f), inProject(f), { recursive: true });
}
for (const [f, text] of Object.entries(OLD_POINTERS)) {
  if (
    existsSync(inProject(f)) &&
    readFileSync(inProject(f), "utf8").replace(/\r\n/g, "\n") === text
  ) {
    say("removed", f);
    if (!dry) rmSync(inProject(f));
  }
}

// Linked by the name `bun link` registers, so node_modules/live-studio is this folder itself, never a copy. Bun 1.4 on
// Windows fails a link: given as a path ("failed linking dependency"), and file: copies the folder
// A film inside a monorepo that holds the studio as a workspace package keeps its "workspace:*"
const spec = pkg.dependencies?.["live-studio"]?.startsWith("workspace:")
  ? pkg.dependencies["live-studio"]
  : "link:live-studio";
pkg.dependencies = { ...pkg.dependencies, "live-studio": spec };
const SCRIPTS = {
  history: "bun node_modules/live-studio/history.mjs",
  collab: "bun node_modules/live-studio/collab.mjs",
  studio: "bun node_modules/live-studio/src/live.mjs", // add the film's port, e.g. 4324
  notes: "bun node_modules/live-studio/notes.mjs",
  note: "bun node_modules/live-studio/note.mjs",
  render: "bun node_modules/live-studio/render.mjs",
  framecheck: "bun node_modules/live-studio/framecheck.mjs",
  check: "bun node_modules/live-studio/check.mjs",
  help: "bun node_modules/live-studio/help.mjs",
  // the repo's commands typed in a film: bun would run the system fmt or link, or say only "Script not found"
  ...Object.fromEntries(
    [
      "new-film",
      "link",
      "setup:vault",
      "setup:sound",
      "setup:mc-sound",
      "fetch:sfx",
      "fetch:sound-raw",
      "setup",
      "pack:sound",
      "assets:semantic",
      "eval:find",
      "eval:lessons",
      "eval:load",
      "test",
      "verify",
      "lint",
      "typecheck",
      "fmt",
      "fmt:check",
    ].map((c) => [c, `bun node_modules/live-studio/wrong-place.mjs ${c}`]),
  ),
};
// A script that only opened the old pointer files goes; one a film wrote its own way stays
const old = { studio: /^node src\/live\.mjs/, notes: /notes_report\.py/ };
pkg.scripts = {
  ...SCRIPTS,
  ...Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter(([k, v]) => !old[k]?.test(v))),
};
say("linked", `live-studio -> ${spec}`);
write("package.json", JSON.stringify(pkg, null, 2) + "\n");
if (!dry) {
  if (spec === "link:live-studio") run(["link"], HERE);
  run(["install"], PROJECT);
}
console.log(dry ? "nothing changed" : `next: cd ${JSON.stringify(PROJECT)} and run bun run studio`);
