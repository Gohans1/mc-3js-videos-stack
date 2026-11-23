import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { cliArgs, envTypos, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import {
  assertInsideDir,
  TAKE_ID,
  takeAudios,
  wordsCommand,
} from "../../packages/live-studio/src/voice-map.mjs";
import { detectLanguage } from "./genvoice.ts";

const HELP = `Writes the word timings voice:assemble needs (voice/takes/<take>.words.json) with whisperX, for every take of
src/edit.json that has none or has newer audio than its timings. Local and free: minutes on a CPU, faster on a GPU; each
take is kept as it finishes, so a stopped run picks up where it was. Run inside the film.
  bun run voice:align          every take with no or stale word timings
  bun run voice:align 03 07    these takes, again even if they are already aligned
The python is WHISPERX_PYTHON, a python with whisperX installed (INSTALL.md says how).
Next: bun run voice:assemble.`;

const fail = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

const hasEntry = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const assertRegularInside = (baseDir: string, targetPath: string, label: string): void => {
  try {
    assertInsideDir(baseDir, targetPath, label);
  } catch (e) {
    fail((e as Error).message);
  }
  if (hasEntry(targetPath) && !statSync(targetPath).isFile()) {
    fail(`${label} is not a regular file: "${targetPath}"`);
  }
};

const isAlignedWord = (w: unknown): boolean =>
  Boolean(
    w &&
    typeof w === "object" &&
    typeof (w as { w?: unknown }).w === "string" &&
    Number.isFinite((w as { s?: unknown }).s) &&
    Number.isFinite((w as { e?: unknown }).e) &&
    (w as { s: number }).s >= 0 &&
    (w as { e: number }).e >= (w as { s: number }).s,
  );

const wordsStatus = (
  takesDir: string,
  audioPath: string,
): { valid: boolean; fresh: boolean; mtimeNs: bigint | null } => {
  const wf = `${audioPath}.words.json`;
  if (!hasEntry(wf)) return { valid: false, fresh: false, mtimeNs: null };
  assertRegularInside(takesDir, wf, "Word alignment file");
  const mtimeNs = statSync(wf, { bigint: true }).mtimeNs;
  const wfMs = statSync(wf).mtimeMs;
  const audioMs = statSync(audioPath).mtimeMs;
  try {
    const info = JSON.parse(readFileSync(wf, "utf8")) as { words?: unknown };
    const valid = Array.isArray(info?.words) && info.words.some(isAlignedWord);
    return { valid, fresh: valid && wfMs >= audioMs, mtimeNs };
  } catch {
    return { valid: false, fresh: false, mtimeNs };
  }
};

const resolvePython = (cmd: string): string | null => {
  if (/[\\/]/.test(cmd)) {
    try {
      return statSync(cmd).isFile() ? cmd : null;
    } catch {
      return null;
    }
  }
  return Bun.which(cmd) ?? null;
};

const resolveLanguage = (meta?: { text?: unknown; language?: unknown }): string => {
  if (typeof meta?.language === "string" && meta.language.trim()) {
    const base = meta.language.trim().toLowerCase().split(/[-_]/)[0];
    if (/^[a-z]{2,3}$/.test(base)) return base;
  }
  if (typeof meta?.text === "string" && meta.text.trim()) {
    return detectLanguage(meta.text);
  }
  return "en";
};

const requestedIds = [...new Set(cliArgs(HELP, []))];
envTypos(["LIVE_PROJECT", "WHISPERX_PYTHON", "THREEJS_LAB", "WHISPER_DEVICE"]);
const film = needFilm(process.env.LIVE_PROJECT);

const editFile = join(film, "src/edit.json");
if (!existsSync(editFile)) fail(`Missing src/edit.json in "${film}"`);
const editData = ((): { takes?: unknown } => {
  try {
    return jsonFile(editFile, film) as { takes?: unknown };
  } catch (e) {
    return fail((e as Error).message);
  }
})();
if (!editData || typeof editData !== "object" || Array.isArray(editData)) {
  fail("src/edit.json must be a JSON object: fix it, then run bun run voice:align again");
}
if (editData?.takes !== undefined && !Array.isArray(editData.takes)) {
  fail('src/edit.json "takes" must be an array');
}

const takeMetaById = new Map<string, { text?: unknown; language?: unknown }>();
for (const entry of (editData?.takes as unknown[] | undefined) ?? []) {
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof (entry as { id?: unknown }).id !== "string" ||
    !TAKE_ID.test((entry as { id: string }).id)
  ) {
    const rawId = (entry as { id?: unknown } | null | undefined)?.id;
    const shownId = typeof rawId === "string" ? rawId : JSON.stringify(rawId ?? "");
    fail(`Invalid take id "${shownId}" in src/edit.json`);
  }
  const typed = entry as { id: string; text?: unknown; language?: unknown };
  if (!takeMetaById.has(typed.id)) takeMetaById.set(typed.id, typed);
}

const voiceDir = join(film, "voice");
const takesDir = join(film, "voice/takes");
if (hasEntry(voiceDir)) {
  try {
    assertInsideDir(film, "voice", "Voice directory");
    if (hasEntry(takesDir)) assertInsideDir(film, "voice/takes", "Voice takes directory");
  } catch (e) {
    fail((e as Error).message);
  }
}

const seenIds = new Set<string>();
const all = takeAudios(film).filter((x) => {
  if (seenIds.has(x.id)) return false;
  seenIds.add(x.id);
  return true;
});

const unknown = requestedIds.filter((id) => !all.some((x) => x.id === id));
if (unknown.length) {
  fail(
    `no take ${unknown.join(", ")} with audio in voice/takes (takes of src/edit.json with audio: ${all.map((x) => x.id).join(", ") || "none"}; bun run voice:gen makes them)`,
    2,
  );
}

const statusBefore = new Map(all.map((x) => [x.audio, wordsStatus(takesDir, x.audio)]));
const todo = requestedIds.length
  ? all.filter((x) => requestedIds.includes(x.id))
  : all.filter((x) => !statusBefore.get(x.audio)?.fresh);

if (!todo.length) {
  console.log(
    all.length
      ? `every take (${all.length}) has its word timings.\nnext: bun run voice:assemble`
      : "no takes with audio in voice/takes yet.\nnext: bun run voice:gen",
  );
  process.exit(0);
}

const [py, ...args] = wordsCommand(todo.map((x) => x.audio));
const pyExec =
  resolvePython(py) ??
  fail(
    `no whisperX python at ${py}: set WHISPERX_PYTHON to a python with whisperX installed (INSTALL.md, the narration row), then bun run voice:align again`,
  );

const langByAudio = Object.fromEntries(
  todo.map((x) => [x.audio, resolveLanguage(takeMetaById.get(x.id))]),
);

console.log(
  `aligning ${todo.length} take${todo.length === 1 ? "" : "s"} (${todo.map((x) => x.id).join(", ")}) with whisperX; torch and the model load first (a minute, much longer off a busy hard disk), then a few seconds a take on a GPU, minutes on a CPU`,
);
const ended = await startJob(film, "voice:align", {
  surface: "sound",
  say: `Aligning the words of take${todo.length > 1 ? "s" : ""} ${todo.map((x) => x.id).join(", ")}`,
});

const run = await (async () => {
  try {
    // stderr is library warnings on every run: shown only when it fails. A cold start (torch read off a busy hard disk) took
    // over 8 min before any take, so the limit only ends a model that is stuck
    return spawnSync(pyExec, args, {
      stdio: ["ignore", "inherit", "pipe"],
      encoding: "utf8",
      env: {
        ...process.env,
        WHISPERX_LANGS: JSON.stringify(langByAudio),
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      timeout: (20 + 3 * todo.length) * 60_000,
    });
  } catch (e) {
    await ended({ say: "Word alignment failed to start", level: "fail" });
    return fail(`whisperX failed to run (${(e as Error).message})`);
  }
})();

const done = todo.filter((x) => {
  const prevNs = statusBefore.get(x.audio)?.mtimeNs ?? null;
  const after = wordsStatus(takesDir, x.audio);
  return after.fresh && (prevNs === null || (after.mtimeNs !== null && after.mtimeNs > prevNs));
});

if (run.status !== 0 || done.length < todo.length) {
  const errTail =
    typeof run.stderr === "string"
      ? run.stderr.trim().split(/\r?\n/).slice(-15).join("\n").trim()
      : "";
  if (errTail) console.error(errTail);
  const left = todo.filter((x) => !done.includes(x)).map((x) => x.id);
  const why = run.error
    ? `did not finish (${run.error.message})`
    : run.status !== 0
      ? `failed (exit ${run.status ?? "unknown"})`
      : "did not write valid word timings for all takes";
  console.error(
    `whisperX ${why}: ${done.length} of ${todo.length} aligned; still without timings: ${left.join(", ")}. bun run voice:align again resumes`,
  );
  await ended({
    say: `Aligned ${done.length} of ${todo.length} take${todo.length > 1 ? "s" : ""}: whisperX failed`,
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
