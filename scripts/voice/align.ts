// bun run voice:align: whisperX word timings (<take>.words.json) for the takes that lack them, which voice:assemble needs
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative } from "node:path";

import { cliArgs, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import { takeAudios, wordsCommand } from "../../packages/live-studio/src/voice-map.mjs";

const HELP = `Writes the word timings voice:assemble needs (voice/takes/<take>.words.json) with whisperX, for every take of
src/edit.json that has none. Local and free: minutes on a CPU, faster on a GPU; each take is kept as it finishes, so a
stopped run picks up where it was. Run inside the film.
  bun run voice:align          every take with no word timings
  bun run voice:align 03 07    these takes, again even if they have them (after replacing the audio by hand)
The python is WHISPERX_PYTHON, a python with whisperX installed (INSTALL.md says how).
Next: bun run voice:assemble.`;

const ids = cliArgs(HELP, []);
const film = needFilm(process.env.LIVE_PROJECT);
const all = takeAudios(film);
const unknown = ids.filter((id) => !all.some((x) => x.id === id));
if (unknown.length) {
  console.error(
    `no take ${unknown.join(", ")} with audio in voice/takes (takes of src/edit.json with audio: ${all.map((x) => x.id).join(", ") || "none"}; bun run voice:gen makes them)`,
  );
  process.exit(2);
}
const todo = ids.length ? all.filter((x) => ids.includes(x.id)) : all.filter((x) => !x.aligned);
if (!todo.length) {
  console.log(
    all.length
      ? `every take (${all.length}) has its word timings.\nnext: bun run voice:assemble`
      : "no takes with audio in voice/takes yet.\nnext: bun run voice:gen",
  );
  process.exit(0);
}

const [py, ...args] = wordsCommand(todo.map((x) => x.audio));
if (!existsSync(py)) {
  console.error(
    `no whisperX python at ${py}: set WHISPERX_PYTHON to a python with whisperX installed (INSTALL.md, the narration row), then bun run voice:align again`,
  );
  process.exit(1);
}
console.log(
  `aligning ${todo.length} take${todo.length === 1 ? "" : "s"} (${todo.map((x) => x.id).join(", ")}) with whisperX; torch and the model load first (a minute, much longer off a busy hard disk), then a few seconds a take on a GPU, minutes on a CPU`,
);
const ended = await startJob(film, "voice:align", {
  say: `Aligning the words of take${todo.length > 1 ? "s" : ""} ${todo.map((x) => x.id).join(", ")}`,
});
// stderr is library warnings on every run: shown only when it fails. A cold start (torch read off a busy hard disk) took
// over 8 min before any take, so the limit only ends a model that is stuck
const run = spawnSync(py, args, {
  stdio: ["ignore", "inherit", "pipe"],
  encoding: "utf8",
  timeout: (20 + 3 * todo.length) * 60_000,
});
const done = todo.filter((x) => existsSync(`${x.audio}.words.json`));
if (run.status !== 0) {
  console.error(run.stderr?.trim().split(/\r?\n/).slice(-15).join("\n") ?? "");
  const left = todo.filter((x) => !done.includes(x)).map((x) => x.id);
  console.error(
    `whisperX ${run.error ? `did not finish (${run.error.message})` : "failed"}: ${done.length} of ${todo.length} aligned; still without timings: ${left.join(", ")}. bun run voice:align again resumes`,
  );
  await ended({
    say: `Aligned ${done.length} of ${todo.length} takes: whisperX failed`,
    level: "fail",
  });
  process.exit(1);
}
await ended({
  say: `Aligned the words of ${done.length} take${done.length > 1 ? "s" : ""}`,
  level: "ok",
});
console.log(
  `wrote ${done.length} word timing file${done.length === 1 ? "" : "s"} (${relative(film, `${done[0].audio}.words.json`).replaceAll("\\", "/")}${done.length > 1 ? " and the rest beside their takes" : ""})\nnext: bun run voice:assemble`,
);
