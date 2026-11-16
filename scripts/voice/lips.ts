// bun run voice:lips: Rhubarb Lip Sync mouth shapes for the takes a character speaks on screen, then src/timeline/mouth.json
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, envTypos, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import {
  MOUTH_MAP,
  rhubarbPath,
  shapeTake,
  speakingTakes,
  writeMouthMap,
} from "../../packages/live-studio/src/mouth-map.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import { assertInsideDir, TAKE_ID } from "../../packages/live-studio/src/voice-map.mjs";
import { stripAudioTags } from "./genvoice.ts";

const HELP = `Lip sync: mouth shapes for every take a character speaks on screen (a take with "by": "<character>" in
src/edit.json; the narrator, off screen, has none). Rhubarb Lip Sync hears each take with its line and writes
voice/takes/<take>.{mp3,wav}.mouth.json, then ${MOUTH_MAP} gathers them where the voice places each take; the scene gives
them to a mouth with mouthCues(EDIT, "<character>") from live-studio/lips (the template does it for Steve). Local and free:
about a take's own length on a CPU; each take is kept as it finishes, so a stopped run picks up where it was. Run inside the film.
  bun run voice:lips          the takes with no shapes yet, or newer audio than their shapes
  bun run voice:lips 03 07    these takes, again
A take whose "language" is not English is heard by sound, less precisely. RHUBARB names another Rhubarb program.
Next: AT=<a second it speaks> bun run render stills, and look at the mouth.`;

function existsOrLink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function resolveRhubarb(bin: string): string {
  if (existsSync(bin)) {
    if (statSync(bin).isDirectory()) {
      const exe = process.platform === "win32" ? "rhubarb.exe" : "rhubarb";
      console.error(
        `RHUBARB (${bin}) is a directory, not the Rhubarb executable: point RHUBARB to ${exe} inside it`,
      );
      process.exit(1);
    }
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
      console.error(
        `RHUBARB (${bin}) is a Windows .cmd/.bat script; point RHUBARB to a native .exe because voice:lips spawns it directly`,
      );
      process.exit(1);
    }
    return bin;
  }
  const fromPath = bin ? Bun.which(bin) : null;
  if (fromPath) return fromPath;
  console.error(
    `no Rhubarb Lip Sync at ${bin}: unpack its release into vault/tools/ (INSTALL.md, the lip sync row) or set RHUBARB to its program, then bun run voice:lips again`,
  );
  process.exit(1);
}

const ids = cliArgs(HELP, []);
envTypos(["LIVE_PROJECT", "RHUBARB"]);
const film = needFilm(process.env.LIVE_PROJECT);

try {
  const editRel = "src/edit.json";
  if (existsOrLink(join(film, editRel))) assertInsideDir(film, join(film, editRel), editRel);
  for (const rel of ["voice", "voice/takes", "src/timeline", MOUTH_MAP]) {
    const p = join(film, rel);
    if (existsOrLink(p)) assertInsideDir(film, p, rel);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const editFile = join(film, "src/edit.json");
if (!existsSync(editFile)) {
  console.error(`no src/edit.json in ${film}: make a take list first.\nnext: bun run voice:gen`);
  process.exit(2);
}

let editRaw: unknown;
try {
  editRaw = jsonFile(editFile, film);
} catch (e) {
  console.error(`src/edit.json: ${(e as Error).message}`);
  process.exit(1);
}

const edit = editRaw as { takes?: unknown };
if (!edit || typeof edit !== "object" || Array.isArray(edit) || !Array.isArray(edit.takes)) {
  console.error(
    `src/edit.json must have a "takes" list: fix src/edit.json, then run bun run voice:lips again`,
  );
  process.exit(1);
}

const seenIds = new Set<string>();
const byTakes: { id: string; by: string }[] = [];
const editTakesById = new Map<string, { id: string; by?: string }>();
for (const item of edit.takes) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    console.error(`src/edit.json has an invalid entry in "takes": fix it, then run again`);
    process.exit(1);
  }
  const entry = item as { id?: unknown; by?: unknown };
  const id = typeof entry.id === "string" ? entry.id : "";
  if (!id || !TAKE_ID.test(id)) {
    console.error(
      `invalid take id ${JSON.stringify(entry.id)} in src/edit.json: use 1-80 letters, numbers, "_" or "-"`,
    );
    process.exit(1);
  }
  if (seenIds.has(id)) {
    console.error(`duplicate take id "${id}" in src/edit.json: keep every take id unique`);
    process.exit(1);
  }
  seenIds.add(id);
  const by = typeof entry.by === "string" ? entry.by.trim() : "";
  editTakesById.set(id, { id, by: by || undefined });
  if (by) byTakes.push({ id, by });
}

const said = speakingTakes(film);
const saidIds = new Set(said.map((k) => k.id));
const missingAudio = byTakes.filter((t) => !saidIds.has(t.id));

const unknown = ids.filter((id) => !saidIds.has(id));
if (unknown.length) {
  const details = unknown.map((id) => {
    const t = editTakesById.get(id);
    if (!t) return `${id} (not in src/edit.json)`;
    if (!t.by) return `${id} (has no "by" character in src/edit.json)`;
    return `${id} (by ${t.by}, no audio in voice/takes yet — run bun run voice:gen)`;
  });
  console.error(
    `cannot lip-sync ${details.join("; ")}. Takes with "by" and audio in voice/takes: ${said.map((k) => k.id).join(", ") || "none"}`,
  );
  process.exit(2);
}

if (!said.length) {
  if (existsSync(join(film, MOUTH_MAP))) writeMouthMap(film);
  if (missingAudio.length) {
    const list = missingAudio.map((t) => `${t.id} (by ${t.by})`).join(", ");
    console.log(
      `${missingAudio.length === 1 ? "take" : "takes"} ${list} ${missingAudio.length === 1 ? "has" : "have"} "by" in src/edit.json but no audio in voice/takes yet.\nnext: bun run voice:gen`,
    );
    process.exit(0);
  }
  console.log(
    `no take is said on screen: give each take a character speaks "by": "<character>" in src/edit.json (a narrator off screen has none), then bun run voice:lips.\nnext: bun run voice:cues`,
  );
  process.exit(0);
}

const todo = ids.length ? said.filter((k) => ids.includes(k.id)) : said.filter((k) => !k.fresh);

let rhubarb = "";
if (todo.length) {
  rhubarb = resolveRhubarb(rhubarbPath());
  if (!Bun.which("ffmpeg")) {
    console.error(
      `ffmpeg not found in PATH: Rhubarb needs ffmpeg to decode audio before lip-sync. Install ffmpeg and add it to PATH, then run bun run voice:lips again`,
    );
    process.exit(1);
  }
}

const failed: string[] = [];
const ended = todo.length
  ? await startJob(film, "voice:lips", {
      say: `Shaping the mouths of take${todo.length > 1 ? "s" : ""} ${todo.map((k) => k.id).join(", ")}`,
    })
  : undefined;

let map: ReturnType<typeof writeMouthMap>;
try {
  for (const k of todo) {
    const t0 = performance.now();
    try {
      const line = typeof k.text === "string" ? stripAudioTags(k.text) : "";
      const cues = shapeTake(k, line, rhubarb);
      if (!cues.length) {
        throw new Error(`Rhubarb wrote 0 mouth cues to ${k.shapes}`);
      }
      console.log(
        `take ${k.id} (by ${k.by}): ${cues.length} mouth shapes in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
      );
    } catch (e) {
      failed.push(k.id);
      console.error(`take ${k.id}: ${(e as Error).message}`);
    }
  }
  map = writeMouthMap(film);
} catch (e) {
  await ended?.({
    say: `Mouth shapes failed: ${(e as Error).message}`,
    level: "fail",
  });
  console.error((e as Error).message);
  process.exit(1);
}

await ended?.(
  failed.length
    ? {
        say: `Mouth shapes failed for take${failed.length > 1 ? "s" : ""} ${failed.join(", ")}`,
        level: "fail",
      }
    : { say: `Shaped the mouths of ${todo.length} take${todo.length > 1 ? "s" : ""}`, level: "ok" },
);

const who = [...new Set(said.map((k) => k.by))];
console.log(
  `wrote ${MOUTH_MAP}: ${map.takes.length} take${map.takes.length === 1 ? "" : "s"} for ${who.join(", ")}${todo.length ? "" : " (every take already had its shapes)"}`,
);
if (missingAudio.length) {
  const list = missingAudio.map((t) => `${t.id} (by ${t.by})`).join(", ");
  console.log(
    `note: ${list} ${missingAudio.length === 1 ? "has" : "have"} "by" in src/edit.json without audio in voice/takes yet (bun run voice:gen)`,
  );
}

const editTs = join(film, "src/edit.ts");
if (existsSync(editTs) && !readFileSync(editTs, "utf8").includes("mouth.json")) {
  const tplSrcAbs = fileURLToPath(new URL("../../templates/film/src", import.meta.url));
  const tplNear = relative(film, tplSrcAbs).replaceAll("\\", "/");
  const tplRef = tplNear.startsWith("../../../") ? tplSrcAbs.replaceAll("\\", "/") : tplNear;
  console.log(
    `src/edit.ts does not import ${MOUTH_MAP}, so no mouth reads it yet: import it as "mouth" into setEdit and give each mouth mouthCues(EDIT, "<character>") (as ${tplRef}/edit.ts and scene.ts do)`,
  );
}

if (failed.length) {
  console.error(
    `${failed.length} take${failed.length === 1 ? "" : "s"} without shapes (${failed.join(", ")}): bun run voice:lips again resumes`,
  );
  process.exit(1);
}

console.log(
  `next: AT=<a second ${who[0]} speaks> bun run render stills and look at the mouth (bun run voice:cues gives the seconds)`,
);
