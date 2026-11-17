import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliArgs, needFilm } from "./src/cli.mjs";
import { openFilmHistory } from "./src/history.mjs";

const HELP = `Versions of one film's editing files, independent of the monorepo's Git.
  bun run history --film films/name list                 current fingerprint and latest versions (JSON)
  bun run history --film films/name save "Cold light"    keep the files currently on disk
  bun run history --film films/name restore <id> --base <fingerprint>  restore; keep a recovery version first
  list --before <sequence>                              older versions
In a film folder --film is optional. Uses the running Studio when available, otherwise the local history.
Studio: Film > Versions. Studio saves pending edits first; CLI save captures disk files only.
Scope: src source/data, configured timelines/key files, package.json, sound.py, choices and pack/picks.json; 8 MB per file, 64 MB per snapshot.
Media, shared packages, vault, notes and renders are not versioned here. This does not reproduce past renders exactly.
History is local in .studio/history.sqlite; stop Studio before copying .studio to back up or move a film. A failed/interrupted restore can
be recovered from its Before restoring version; apply that version with the current fingerprint.
Restoring configuration may require restarting Studio. Autosaves run only while Studio runs.`;
const argv = [...cliArgs(HELP, ["--film PATH", "--base HASH", "--before SEQUENCE"], 2)];
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv.splice(i, 2)[1];
};
const film = flag("--film"),
  base = flag("--base"),
  before = flag("--before");
const [action, value] = argv;
if (
  !["list", "save", "restore"].includes(action) ||
  (action !== "list") !== !!value ||
  (action === "restore" ? !/^[a-f0-9]{64}$/.test(base ?? "") : base !== undefined) ||
  (before !== undefined &&
    (action !== "list" || !Number.isSafeInteger(Number(before)) || Number(before) < 1))
) {
  console.error(HELP);
  process.exit(2);
}
let history;
try {
  const candidate = resolve(film ?? process.env.LIVE_PROJECT ?? process.cwd());
  const project = existsSync(join(candidate, ".studio/history.sqlite"))
    ? candidate
    : resolve(needFilm(candidate));
  const metadata = join(project, "renders/live/studio.json");
  let url, viewed;
  if (existsSync(metadata)) {
    const info = JSON.parse(readFileSync(metadata, "utf8"));
    if (
      resolve(info.project) !== project ||
      !Number.isInteger(info.port) ||
      info.port < 1 ||
      info.port > 65535
    )
      throw new Error("Studio metadata belongs to another film");
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${info.port}/api/history`, {
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      /* no live Studio */
    }
    if (response) {
      if (!response.ok)
        throw new Error("The running Studio cannot serve history; restart it from this checkout");
      viewed = await response.json();
      if (resolve(viewed.project) !== project) throw new Error("The port belongs to another film");
      url = `http://127.0.0.1:${info.port}/api/history`;
    }
  }
  let result;
  if (url) {
    const response =
      action === "list" && before === undefined
        ? null
        : await fetch(
            url +
              (action === "restore" ? "/restore" : action === "list" ? `?before=${before}` : ""),
            {
              ...(action === "list"
                ? {}
                : {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(action === "save" ? { name: value } : { id: value, base }),
                  }),
              signal: AbortSignal.timeout(15000),
            },
          );
    result = response ? await response.json() : viewed;
    if (response && !response.ok)
      throw new Error(result.error ?? `History request failed (${response.status})`);
  } else {
    history = openFilmHistory(project);
    result =
      action === "save"
        ? history.capture(value, "named")
        : action === "restore"
          ? history.restore(value, base)
          : {
              project,
              current: history.current(),
              revisions: history.list(100, before === undefined ? undefined : Number(before)),
            };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`history: ${error.message}`);
  process.exitCode = 1;
} finally {
  history?.close();
}
