// bun run voice:lips: Rhubarb Lip Sync mouth shapes for the takes a character speaks on screen, then src/timeline/mouth.json
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, needFilm } from "../../packages/live-studio/src/cli.mjs";
import {
  MOUTH_MAP,
  rhubarbPath,
  shapeTake,
  speakingTakes,
  writeMouthMap,
} from "../../packages/live-studio/src/mouth-map.mjs";
import { stripAudioTags } from "./genvoice.ts";

const HELP = `Lip sync: mouth shapes for every take a character speaks on screen (a take with "by": "<character>" in
src/edit.json; the narrator, off screen, has none). Rhubarb Lip Sync hears each take with its line and writes
voice/takes/<take>.mouth.json, then ${MOUTH_MAP} gathers them where the voice places each take; the scene gives
them to a mouth with mouthCues(EDIT, "<character>") from live-studio/lips (the template does it for Steve). Local and free:
about a take's own length on a CPU; each take is kept as it finishes, so a stopped run picks up where it was. Run inside the film.
  bun run voice:lips          the takes with no shapes yet, or newer audio than their shapes
  bun run voice:lips 03 07    these takes, again
A take whose "language" is not English is heard by sound, less precisely. RHUBARB names another Rhubarb program.
Next: AT=<a second it speaks> bun run render stills, and look at the mouth.`;

const ids = cliArgs(HELP, []);
const film = needFilm(process.env.LIVE_PROJECT);
const said = speakingTakes(film);
const unknown = ids.filter((id) => !said.some((k) => k.id === id));
if (unknown.length) {
  console.error(
    `no take ${unknown.join(", ")} said on screen with audio (takes with "by" and audio in voice/takes: ${said.map((k) => k.id).join(", ") || "none"}). Give a take "by": "<character>" in src/edit.json; bun run voice:gen makes its audio`,
  );
  process.exit(2);
}
if (!said.length) {
  console.log(
    `no take is said on screen: give each take a character speaks "by": "<character>" in src/edit.json (a narrator off screen has none), then bun run voice:lips.\nnext: bun run voice:cues`,
  );
  process.exit(0);
}
const todo = ids.length ? said.filter((k) => ids.includes(k.id)) : said.filter((k) => !k.fresh);
const rhubarb = rhubarbPath();
if (todo.length && !existsSync(rhubarb)) {
  console.error(
    `no Rhubarb Lip Sync at ${rhubarb}: unpack its release into vault/tools/ (INSTALL.md, the lip sync row) or set RHUBARB to its program, then bun run voice:lips again`,
  );
  process.exit(1);
}
const failed: string[] = [];
for (const k of todo) {
  const t0 = performance.now();
  try {
    const cues = shapeTake(k, stripAudioTags(k.text ?? ""), rhubarb);
    console.log(
      `take ${k.id} (by ${k.by}): ${cues.length} mouth shapes in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
  } catch (e) {
    failed.push(k.id);
    console.error(`take ${k.id}: ${(e as Error).message}`);
  }
}
const map = writeMouthMap(film);
const who = [...new Set(said.map((k) => k.by))];
console.log(
  `wrote ${MOUTH_MAP}: ${map.takes.length} take${map.takes.length === 1 ? "" : "s"} for ${who.join(", ")}${todo.length ? "" : " (every take already had its shapes)"}`,
);
const edit = join(film, "src/edit.ts");
if (existsSync(edit) && !readFileSync(edit, "utf8").includes("mouth.json"))
  console.log(
    `src/edit.ts does not import ${MOUTH_MAP}, so no mouth reads it yet: import it as "mouth" into setEdit and give each mouth mouthCues(EDIT, "<character>") (as ${relative(film, fileURLToPath(new URL("../../templates/film/src", import.meta.url))).replaceAll("\\", "/")}/edit.ts and scene.ts do)`,
  );
if (failed.length) {
  console.error(
    `${failed.length} take${failed.length === 1 ? "" : "s"} without shapes (${failed.join(", ")}): bun run voice:lips again resumes`,
  );
  process.exit(1);
}
console.log(
  `next: AT=<a second ${who[0]} speaks> bun run render stills and look at the mouth (bun run voice:cues gives the seconds)`,
);
