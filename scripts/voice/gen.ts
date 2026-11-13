import { spawnSync } from "node:child_process";
// Generates narration takes in src/edit.json sequentially per voice so adjacent lines share prosody context
// (previous_text / next_text + request-id stitching), with --try [--takes N] casting and Voice Changer (--guide / take.guide).
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import { assertInsideDir, wordsCommand } from "../../packages/live-studio/src/voice-map.mjs";
import { sts, tts } from "./genvoice.ts";

const HELP = `Narration takes for the lines in src/edit.json "takes", from ElevenLabs (via genvoice.pro unless ELEVENLABS_API_KEY
is set). Run inside the film. Credits are spent only with --yes; without it every run only previews.
  bun run voice:gen               every take with no audio yet in voice/takes, or whose words changed since: what it
                                  would write and spend
  bun run voice:gen ID [ID ...]   those takes again, replacing their audio
  --try ID [ID ...] [--takes N]   new tries of those takes (N each, 1-20) into voice/try/<id>_<n>.mp3, the takes kept
  --guide FILE        speech-to-speech from this recording (exactly one ID; take.guide sets it per take)
  --yes               send them: spends credits, billed by the character (the preview's next line has the command)
  --dry-run           preview only, even with --yes
Takes of one voice go in story order so neighbours share prosody (previous/next text, request ids).
Next: bun run voice:assemble lays the takes onto the film, then bun run voice:cues gives their heard seconds.`;

export const DEFAULT_NARRATOR = "ZaZosYpkIGmSqOwAlfnk"; // Seff Echo - Cinematic Storyteller
const TAKE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const STITCH_TTL_MS = 110 * 60_000; // < 2h ElevenLabs request_id expiry so expired IDs never suppress previous_text/next_text

interface StoredRequestId {
  id: string;
  at: number;
  voiceId: string;
  model: string;
}

const inside = (root: string, file: string) => {
  const r = relative(root, file);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
};

const freshReqId = (
  entry: string | StoredRequestId | undefined,
  voiceId: string,
  model: string,
  now: number,
): string | undefined => {
  if (!entry || typeof entry !== "object") return undefined;
  if (typeof entry.id !== "string" || !entry.id || typeof entry.at !== "number") return undefined;
  if (entry.voiceId !== voiceId || entry.model !== model) return undefined;
  if (now - entry.at < 0 || now - entry.at > STITCH_TTL_MS) return undefined;
  return entry.id;
};

interface TakeSpec {
  id: string;
  text: string;
  t?: number;
  voice?: string;
  model?: string;
  language?: string;
  speed?: number;
  stability?: number;
  guide?: string;
}

export interface GenRunOptions {
  cwd?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

const hasTakeAudio = (dir: string, stem: string) =>
  existsSync(join(dir, `${stem}.mp3`)) || existsSync(join(dir, `${stem}.wav`));

const nextTryOut = (tryDir: string, id: string) => {
  let n = 1;
  while (hasTakeAudio(tryDir, `${id}_${n}`)) n++;
  return join(tryDir, `${id}_${n}.mp3`);
};

// asked wrong (exit 2), as against a take or a request that failed (exit 1)
const usage = (message: string) => Object.assign(new Error(message), { usage: true });

export const runGen = async (opts: GenRunOptions = {}) => {
  const filmDir = resolve(opts.cwd ?? process.cwd());
  const args = opts.args ?? process.argv.slice(2);
  const env = opts.env ?? process.env;

  let trying = false,
    dryRun = false,
    confirmed = false,
    takesCount = 1,
    cliGuide: string | undefined;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--try") trying = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--yes") confirmed = true;
    else if (a === "--takes") {
      const rawTakes = args[++i] ?? "";
      if (!/^[1-9]\d*$/.test(rawTakes) || Number(rawTakes) > 20) {
        throw usage("--takes requires an integer between 1 and 20");
      }
      takesCount = Number(rawTakes);
    } else if (a === "--guide") {
      const next = args[++i];
      if (!next || next.startsWith("-")) {
        throw usage("--guide requires a path to a guide audio file");
      }
      cliGuide = next;
    } else if (!a.startsWith("--")) names.push(a);
  }
  if (takesCount > 1 && !trying) {
    throw usage(
      "--takes N makes N new tries of a take: add --try (bun run voice:gen --try ID --takes 3)",
    );
  }
  // tries spend credits on takes that already have audio: only ever for takes named (a bare --try once tried them all)
  if (trying && !names.length) {
    throw usage(
      "--try needs the takes to try, by id: bun run voice:gen --try 01 03 (previews; --yes sends)",
    );
  }
  if (cliGuide && names.length !== 1) {
    throw usage("--guide requires exactly one explicit take id");
  }

  const editPath = assertInsideDir(filmDir, "src/edit.json", "src/edit.json");
  const edit = jsonFile(editPath, filmDir) as {
    takes?: TakeSpec[];
  };
  const ordered = edit.takes ?? [];
  const byId = new Map<string, TakeSpec>();
  for (const t of ordered) {
    if (!t || typeof t.id !== "string" || !TAKE_ID.test(t.id)) {
      throw new Error(`Invalid take id "${String(t?.id ?? "")}" in src/edit.json`);
    }
    if (byId.has(t.id)) {
      throw new Error(`Duplicate take id "${t.id}" in src/edit.json`);
    }
    byId.set(t.id, t);
  }
  for (const id of names) {
    if (!byId.has(id))
      throw usage(
        `Unknown take id "${id}": src/edit.json takes are ${[...byId.keys()].join(", ") || "none yet"}`,
      );
  }

  const voiceRoot = assertInsideDir(filmDir, "voice", "Voice directory");
  const takesDir = assertInsideDir(filmDir, join(voiceRoot, "takes"), "Voice takes directory"),
    tryDir = assertInsideDir(filmDir, join(voiceRoot, "try"), "Voice try directory");
  mkdirSync(takesDir, { recursive: true });
  mkdirSync(tryDir, { recursive: true });

  // the words each take's audio was made from: a take whose words changed since is due again (a take made before this
  // file existed is not known, so not offered)
  const textsFile = assertInsideDir(filmDir, join(takesDir, ".texts.json"), "Take texts file");
  const spoken: Record<string, string> = existsSync(textsFile) ? jsonFile(textsFile, filmDir) : {};
  const reworded = (t: TakeSpec) =>
    hasTakeAudio(takesDir, t.id) && spoken[t.id] !== undefined && spoken[t.id] !== t.text;
  const want = names.length
    ? names
    : trying
      ? ordered.map((t) => t.id)
      : ordered.filter((t) => !hasTakeAudio(takesDir, t.id) || reworded(t)).map((t) => t.id);
  const wantSet = new Set(want);

  // checked before a dry run returns, so the dry run says what the real one would fail on
  const realFilmDir = realpathSync(filmDir);
  for (const t of ordered) {
    if (!wantSet.has(t.id)) continue;
    const guideRel = names.length === 1 && cliGuide ? cliGuide : t.guide;
    if (!guideRel) continue;
    const guideAbs = resolve(filmDir, guideRel);
    if (!existsSync(guideAbs) || lstatSync(guideAbs).isSymbolicLink()) {
      throw new Error(`Guide audio file not found: "${guideRel}"`);
    }
    const realGuide = realpathSync(guideAbs);
    if (!inside(realFilmDir, realGuide) || !statSync(realGuide).isFile()) {
      throw new Error(`Guide audio file not found inside film directory: "${guideRel}"`);
    }
  }
  // spending needs --yes (no one is at a prompt to ask); without it, or with --dry-run, the run only says what it would do
  if (dryRun || !confirmed) {
    const rel = (p: string) => relative(filmDir, p).replaceAll("\\", "/");
    return ordered
      .filter((t) => wantSet.has(t.id))
      .flatMap((t) => {
        const first = trying ? Number(/_(\d+)\.mp3$/.exec(nextTryOut(tryDir, t.id))![1]) : 0;
        return Array.from({ length: trying ? takesCount : 1 }, (_, k) => ({
          id: t.id,
          out: trying
            ? `would write voice/try/${t.id}_${first + k}.mp3`
            : `would write ${rel(join(takesDir, `${t.id}.mp3`))}${hasTakeAudio(takesDir, t.id) ? `, replacing its audio${reworded(t) ? ": its words changed since" : ""}` : ""}`,
          info: { chars: t.text.length, voice: t.voice ?? DEFAULT_NARRATOR },
        }));
      });
  }

  const reqFile = assertInsideDir(filmDir, join(takesDir, ".request_ids.json"), "Request IDs file");
  const reqIds: Record<string, string | StoredRequestId> = existsSync(reqFile)
    ? jsonFile(reqFile, filmDir)
    : {};
  const saveReqIds = () =>
    writeFileSync(
      assertInsideDir(filmDir, reqFile, "Request IDs file"),
      JSON.stringify(reqIds, null, 1) + "\n",
      "utf8",
    );

  const saveSpoken = (t: TakeSpec) => {
    spoken[t.id] = t.text;
    writeFileSync(textsFile, JSON.stringify(spoken, null, 1) + "\n", "utf8");
  };

  const provider = env.ELEVENLABS_API_KEY ? "elevenlabs" : "genvoice";
  const apiKey = provider === "elevenlabs" ? env.ELEVENLABS_API_KEY : env.GENVOICE_API_KEY;
  const apiBase = provider === "elevenlabs" ? env.ELEVENLABS_API_BASE : env.GENVOICE_API_BASE;

  // Walk in narrative order so sequential takes feed request IDs and prosody into neighbors of the same voice
  const results: { id: string; out: string; info: unknown }[] = [];
  for (let idx = 0; idx < ordered.length; idx++) {
    const t = ordered[idx];
    if (!wantSet.has(t.id)) continue;
    const voiceId = t.voice ?? DEFAULT_NARRATOR;
    const model = t.model ?? "eleven_v4";
    const now = Date.now();

    // Neighbor takes spoken by the same voice
    const sameVoiceBefore = ordered
      .slice(0, idx)
      .filter((x) => (x.voice ?? DEFAULT_NARRATOR) === voiceId);
    const sameVoiceAfter = ordered
      .slice(idx + 1)
      .filter((x) => (x.voice ?? DEFAULT_NARRATOR) === voiceId);
    const previousText = sameVoiceBefore.at(-1)?.text;
    const nextText = sameVoiceAfter[0]?.text;
    const previousRequestIds = sameVoiceBefore
      .map((x) => freshReqId(reqIds[x.id], voiceId, model, now))
      .filter((id): id is string => Boolean(id))
      .slice(-3);
    const nextRequestIds = sameVoiceAfter
      .map((x) => freshReqId(reqIds[x.id], voiceId, model, now))
      .filter((id): id is string => Boolean(id))
      .slice(0, 3);

    const guideRel = names.length === 1 && cliGuide ? cliGuide : t.guide;
    const repeats = trying ? takesCount : 1;
    for (let c = 0; c < repeats; c++) {
      const out = assertInsideDir(
        filmDir,
        trying ? nextTryOut(tryDir, t.id) : join(takesDir, `${t.id}.mp3`),
        "Voice take output",
      );
      const staleWav = assertInsideDir(filmDir, join(takesDir, `${t.id}.wav`), "Voice take wav");
      const staleWords = assertInsideDir(
        filmDir,
        join(takesDir, `${t.id}.wav.words.json`),
        "Voice take words",
      );
      if (guideRel) {
        const info = await sts({
          voiceId,
          audioPath: resolve(filmDir, guideRel),
          out,
          stability: t.stability ?? 0.5,
          provider,
          apiKey,
          apiBase,
          env,
        });
        if (!trying) {
          rmSync(staleWav, { force: true });
          rmSync(staleWords, { force: true });
          saveSpoken(t);
          if (info.requestId) {
            reqIds[t.id] = {
              id: info.requestId,
              at: Date.now(),
              voiceId,
              model: "eleven_multilingual_sts_v2",
            };
            saveReqIds();
          }
        }
        results.push({ id: t.id, out, info });
      } else {
        const info = await tts({
          voiceId,
          text: t.text,
          out,
          model,
          language: t.language,
          speed: t.speed ?? 1.0,
          stability: t.stability ?? 0.5,
          previousText,
          nextText,
          previousRequestIds,
          nextRequestIds,
          provider,
          apiKey,
          apiBase,
          env,
        });
        if (!trying) {
          rmSync(staleWav, { force: true });
          rmSync(staleWords, { force: true });
          saveSpoken(t);
          if (info.requestId) {
            reqIds[t.id] = { id: info.requestId, at: Date.now(), voiceId, model };
            saveReqIds();
          }
        }
        results.push({ id: t.id, out, info });
      }
    }
  }

  return results;
};

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cliArgs(HELP, ["--try", "--takes N", "--guide FILE", "--dry-run", "--yes"]);
  const film = needFilm(process.env.LIVE_PROJECT);
  const results = await runGen({ cwd: film }).catch((e: Error & { usage?: boolean }) => {
    console.error(e.message);
    process.exit(e.usage ? 2 : 1);
  });
  for (const r of results) console.log(r.id, r.out, JSON.stringify(r.info));
  const sent = process.argv.includes("--yes") && !process.argv.includes("--dry-run");
  if (results.length && !sent) {
    const real = [
      ...process.argv.slice(2).filter((a) => a !== "--dry-run" && a !== "--yes"),
      "--yes",
    ];
    const chars = results.reduce((n, r) => n + ((r.info as { chars?: number }).chars ?? 0), 0);
    const what =
      results.length === 1
        ? `this ${process.argv.includes("--try") ? "try" : "take"}`
        : `these ${results.length} ${process.argv.includes("--try") ? "tries" : "takes"}`;
    console.log(
      `nothing sent.\nnext: bun run voice:gen ${real.join(" ")} sends ${what} (${chars} characters, billed by the character)`,
    );
  }
  // voice:assemble needs every take's word timings and a genvoice.pro take comes without them: whisperX writes them now
  const unaligned =
    sent && !process.argv.includes("--try")
      ? results.map((r) => r.out).filter((out) => !existsSync(`${out}.words.json`))
      : [];
  if (unaligned.length) {
    const [py, ...args] = wordsCommand(unaligned);
    console.log(
      `aligning the words of ${unaligned.length === 1 ? "this take" : `these ${unaligned.length} takes`} with whisperX (a few minutes on a CPU)...`,
    );
    // its stderr is library warnings on every run: shown only when it fails
    const run = existsSync(py)
      ? spawnSync(py, args, { encoding: "utf8", timeout: 20 * 60_000 })
      : null;
    if (run?.stdout) process.stdout.write(run.stdout);
    if (run?.status !== 0) {
      if (run?.stderr) console.error(run.stderr.trim().split(/\r?\n/).slice(-15).join("\n"));
      console.error(
        `${run ? "whisperX failed" : `no whisperX python at ${py} (THREEJS_LAB names the lab folder)`}: the audio is saved, only its word timings are missing, and bun run voice:assemble needs them: ${[py, ...args].join(" ")}`,
      );
      process.exit(1);
    }
  }
  if (results.length && sent)
    console.log(
      process.argv.includes("--try")
        ? "next: hear the tries in the studio and keep one there (they are in voice/try), then bun run voice:assemble"
        : "next: bun run voice:assemble lays them on the film",
    );
  if (!results.length) {
    const ids = (
      (jsonFile(join(film, "src/edit.json"), film) as { takes?: { id: string }[] }).takes ?? []
    ).map((t) => t.id);
    console.log(
      `nothing to generate: every take in src/edit.json has audio in voice/takes. Redo some: bun run voice:gen ${ids[0] ?? "ID"} previews it (the ids: ${ids.join(", ") || "none yet"}); new tries beside them: --try ID`,
    );
  }
}
