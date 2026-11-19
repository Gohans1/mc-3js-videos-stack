import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliArgs, needFilm } from "./src/cli.mjs";

const HELP = `Read and update a Studio document without undoing the creator's edits. Studio must be running.
  bun run collab [--film films/name] read cam            current version, data, protected paths and notices
  bun run collab [--film films/name] write cam <file|->  JSON payload {"base":"version from read","data":...}
--film is optional inside a film folder; pass - with write to read the JSON payload from stdin.
Use bun run --silent collab read cam when piping JSON stdout (omits Bun's script banner).
Names: sound, cam, lights, shots, text, adjustment, timing, openfilm, keys/0 (as /api names them).
Direct filesystem writes cannot acknowledge protected units. Cam and shots merge by stable row ID.
Keep existing IDs when editing or moving rows. Use a new ID for each new row.
The notices preserve rejected input in .studio/collaboration/notices.jsonl. Read the canonical result after writing.`;
const argv = cliArgs(HELP, ["--film PATH"], 3);
const at = argv.indexOf("--film");
const projectArg = at < 0 ? (process.env.LIVE_PROJECT ?? process.cwd()) : argv[at + 1];
const [action, name, input] = argv.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
if (
  !["read", "write"].includes(action) ||
  !/^(sound|cam|lights|shots|text|adjustment|timing|openfilm|keys\/\d+)$/.test(name ?? "") ||
  (action === "write") !== !!input
) {
  console.error(HELP);
  process.exit(2);
}
try {
  const project = resolve(needFilm(projectArg, { warnProtected: false }));
  const info = JSON.parse(readFileSync(join(project, "renders/live/studio.json"), "utf8"));
  if (
    resolve(info.project) !== project ||
    !Number.isInteger(info.port) ||
    info.port < 1 ||
    info.port > 65535
  )
    throw new Error("Studio belongs to another film; start this film's Studio");
  const body =
    action === "write"
      ? input === "-"
        ? readFileSync(0, "utf8")
        : readFileSync(resolve(input), "utf8")
      : undefined;
  const response = await fetch(
    `http://127.0.0.1:${info.port}/api/collaboration/${name.split("/").map(encodeURIComponent).join("/")}`,
    {
      ...(action === "write"
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }
        : {}),
      signal: AbortSignal.timeout(10000),
    },
  );
  console.log(await response.text());
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(`collab: ${error.message}`);
  process.exitCode = 1;
}
