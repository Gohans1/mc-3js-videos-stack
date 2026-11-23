import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliArgs, envTypos, jsonFile, needFilm } from "../../packages/live-studio/src/cli.mjs";
import {
  rhubarbPath,
  shapeTake,
  speakingTakes,
  writeMouthMap,
} from "../../packages/live-studio/src/mouth-map.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import {
  assertInsideDir,
  unalignedTakes,
  wordsCommand,
} from "../../packages/live-studio/src/voice-map.mjs";
import {
  MAX_AUDIO_BYTES,
  resolveVoiceProvider,
  sanitizeErrorText,
  stripAudioTags,
  sts,
  tts,
} from "./genvoice.ts";

const HELP = `Narration takes for the lines in src/edit.json "takes", from ElevenLabs (via genvoice.pro unless ELEVENLABS_API_KEY
is set). Run inside the film. Credits are spent only with --yes; without it every run only previews.
  bun run voice:gen               every take with no audio yet in voice/takes, or reworded since voice:gen made it: what
                                  it would write and spend (a take whose audio's words differ is only named: give its ID)
  bun run voice:gen ID [ID ...]   those takes again, replacing their audio
  --try ID [ID ...] [--takes N]   new tries of those takes (N each, 1-20) into voice/try/<id>_<n>.mp3, the takes kept
  --guide FILE        speech-to-speech from this recording (exactly one ID; take.guide sets it per take)
  --yes               send them: spends credits, billed by the character (the preview's next line has the command)
  --dry-run           preview only, even with --yes
Takes of one voice go in story order so neighbours share prosody (previous/next text, request ids).
Next: bun run voice:assemble lays the takes onto the film, then bun run voice:cues gives their heard seconds.`;

export const DEFAULT_NARRATOR = "ZaZosYpkIGmSqOwAlfnk";
const TAKE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const STITCH_TTL_MS = 110 * 60_000; // < 2h ElevenLabs request_id expiry so expired IDs never suppress previous_text/next_text

interface StoredRequestId {
  id: string;
  at: number;
  voiceId: string;
  model: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

let tmpSeq = 0;
const atomicWriteText = (out: string, text: string) => {
  const target = resolve(out);
  const part = `${target}.${process.pid}.${Date.now()}.${++tmpSeq}.part`;
  try {
    writeFileSync(part, text, "utf8");
    renameSync(part, target);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
};

const readTextMap = (file: string, filmDir: string, label: string): Record<string, string> => {
  if (!existsSync(file)) return {};
  const raw = jsonFile(file, filmDir);
  if (!isPlainObject(raw)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return raw as Record<string, string>;
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
  text?: string;
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
  onTake?: (take: TakeSpec) => unknown;
}

const ensureRegularOrAbsent = (file: string, label: string) => {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`${label} cannot be a symlink or junction: "${file}"`);
  }
  if (!st.isFile()) {
    throw new Error(`${label} exists as a directory or non-file: "${file}"`);
  }
  return true;
};

const ensureDirOrAbsent = (dir: string, label: string) => {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`${label} must be a regular directory: "${dir}"`);
  }
};

const hasTakeAudio = (dir: string, stem: string) =>
  [".mp3", ".wav"].some((ext) => {
    try {
      const st = lstatSync(join(dir, `${stem}${ext}`));
      return !st.isSymbolicLink() && st.isFile();
    } catch {
      return false;
    }
  });

const staleTakeArtifacts = (filmDir: string, takesDir: string, id: string) =>
  [`${id}.wav`, `${id}.wav.words.json`, `${id}.mp3.mouth.json`, `${id}.wav.mouth.json`].map(
    (name) => assertInsideDir(filmDir, join(takesDir, name), "Voice take artifact"),
  );

export const unheardWords = (filmDir: string) => {
  const takesDir = assertInsideDir(filmDir, "voice/takes", "Voice takes directory");
  const plain = (text: string) =>
    stripAudioTags(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const textsFile = assertInsideDir(filmDir, join(takesDir, ".texts.json"), "Take texts file");
  const kept = readTextMap(textsFile, filmDir, "voice/takes/.texts.json");
  const rawEdit = jsonFile(assertInsideDir(filmDir, "src/edit.json", "src/edit.json"), filmDir);
  const takes: TakeSpec[] =
    isPlainObject(rawEdit) && Array.isArray(rawEdit.takes) ? (rawEdit.takes as TakeSpec[]) : [];
  return takes.flatMap((t) => {
    if (typeof kept[t.id] === "string" || typeof t.text !== "string") return [];
    const wordsFile = [`${t.id}.mp3`, `${t.id}.wav`]
      .map((f) => assertInsideDir(filmDir, join(takesDir, `${f}.words.json`), "Take words file"))
      .find((f) => existsSync(f) && statSync(f).isFile());
    if (!wordsFile) return [];
    const rawWords = jsonFile(wordsFile, filmDir);
    const words =
      isPlainObject(rawWords) && Array.isArray(rawWords.words)
        ? (rawWords.words as { w?: unknown }[])
        : [];
    const heard = words
      .map((w) => (typeof w?.w === "string" ? w.w : ""))
      .filter(Boolean)
      .join(" ");
    return heard && plain(heard) !== plain(t.text) ? [{ id: t.id, heard, text: t.text }] : [];
  });
};

const nextTryOut = (tryDir: string, id: string) => {
  let n = 1;
  while (hasTakeAudio(tryDir, `${id}_${n}`)) n++;
  return join(tryDir, `${id}_${n}.mp3`);
};

const previewTryOuts = (tryDir: string, id: string, count: number) => {
  const outs: string[] = [];
  for (let n = 1; outs.length < count; n++) {
    if (!hasTakeAudio(tryDir, `${id}_${n}`)) outs.push(`voice/try/${id}_${n}.mp3`);
  }
  return outs;
};

const usage = (message: string) => Object.assign(new Error(message), { usage: true });

export const runGen = async (opts: GenRunOptions = {}) => {
  const filmDir = resolve(opts.cwd ?? process.cwd());
  const args = opts.args ?? process.argv.slice(2);
  const env = opts.env ?? process.env;

  let trying = false,
    dryRun = false,
    confirmed = false,
    sawTakes = false,
    takesCount = 1,
    cliGuide: string | undefined;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--try") trying = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--yes") confirmed = true;
    else if (a === "--takes" || a.startsWith("--takes=")) {
      sawTakes = true;
      const rawTakes = a.startsWith("--takes=") ? a.slice("--takes=".length) : (args[++i] ?? "");
      if (!/^[1-9]\d*$/.test(rawTakes) || Number(rawTakes) > 20) {
        throw usage("--takes requires an integer between 1 and 20");
      }
      takesCount = Number(rawTakes);
    } else if (a === "--guide" || a.startsWith("--guide=")) {
      const next = a.startsWith("--guide=") ? a.slice("--guide=".length) : args[++i];
      if (!next || !next.trim() || next.startsWith("-")) {
        throw usage("--guide requires a path to a guide audio file");
      }
      cliGuide = next;
    } else if (a.startsWith("-")) {
      throw usage(`Unknown option "${a}"`);
    } else {
      names.push(a);
    }
  }
  if (sawTakes && !trying) {
    throw usage(
      "--takes N makes N new tries of a take: add --try (bun run voice:gen --try ID --takes 3)",
    );
  }
  if (trying && !names.length) {
    throw usage(
      "--try needs the takes to try, by id: bun run voice:gen --try 01 03 (previews; --yes sends)",
    );
  }
  if (cliGuide && names.length !== 1) {
    throw usage("--guide requires exactly one explicit take id");
  }

  const editPath = assertInsideDir(filmDir, "src/edit.json", "src/edit.json");
  if (!existsSync(editPath)) {
    throw new Error(
      'Missing src/edit.json: create it with "takes": [{"id": "01", "text": "..."}] (compare templates/film/src/edit.json)',
    );
  }
  if (!statSync(editPath).isFile()) {
    throw new Error("src/edit.json must be a file, not a directory");
  }
  const rawEdit = jsonFile(editPath, filmDir);
  if (!isPlainObject(rawEdit)) {
    throw new Error("src/edit.json must be a JSON object");
  }
  if (rawEdit.takes !== undefined && !Array.isArray(rawEdit.takes)) {
    throw new Error('src/edit.json "takes" must be an array');
  }
  const ordered = (rawEdit.takes ?? []) as TakeSpec[];
  const byId = new Map<string, TakeSpec>();
  for (const t of ordered) {
    if (!isPlainObject(t) || typeof t.id !== "string" || !TAKE_ID.test(t.id)) {
      const rawId = isPlainObject(t) ? t.id : undefined;
      const idLabel =
        typeof rawId === "string" || typeof rawId === "number"
          ? String(rawId)
          : rawId === undefined
            ? ""
            : JSON.stringify(rawId);
      throw new Error(`Invalid take id "${idLabel}" in src/edit.json`);
    }
    if (byId.has(t.id)) {
      throw new Error(`Duplicate take id "${t.id}" in src/edit.json`);
    }
    if (t.text !== undefined && typeof t.text !== "string") {
      throw new Error(`Take "${t.id}" text must be a string in src/edit.json`);
    }
    for (const key of ["voice", "model", "language", "guide"] as const) {
      const val = t[key];
      if (val !== undefined && (typeof val !== "string" || !val.trim())) {
        throw new Error(`Take "${t.id}" ${key} must be a non-empty string in src/edit.json`);
      }
    }
    if (
      t.speed !== undefined &&
      (typeof t.speed !== "number" || !Number.isFinite(t.speed) || t.speed <= 0)
    ) {
      throw new Error(`Take "${t.id}" speed must be a finite number > 0 in src/edit.json`);
    }
    if (
      t.stability !== undefined &&
      (typeof t.stability !== "number" ||
        !Number.isFinite(t.stability) ||
        t.stability < 0 ||
        t.stability > 1)
    ) {
      throw new Error(
        `Take "${t.id}" stability must be a finite number between 0 and 1 in src/edit.json`,
      );
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
  ensureDirOrAbsent(voiceRoot, "Voice directory");
  ensureDirOrAbsent(takesDir, "Voice takes directory");
  if (trying) ensureDirOrAbsent(tryDir, "Voice try directory");

  const textsFile = assertInsideDir(filmDir, join(takesDir, ".texts.json"), "Take texts file");
  ensureRegularOrAbsent(textsFile, "Take texts file");
  const spoken = readTextMap(textsFile, filmDir, "voice/takes/.texts.json");
  const reworded = (t: TakeSpec) =>
    hasTakeAudio(takesDir, t.id) &&
    typeof spoken[t.id] === "string" &&
    spoken[t.id] !== (t.text ?? "");
  const want = names.length
    ? names
    : ordered.filter((t) => !hasTakeAudio(takesDir, t.id) || reworded(t)).map((t) => t.id);
  const wantSet = new Set(want);
  const guideFor = (t: TakeSpec) => (names.length === 1 && cliGuide ? cliGuide : t.guide);

  for (const t of ordered) {
    if (!wantSet.has(t.id)) continue;
    const guideRel = guideFor(t);
    if (guideRel) {
      const guideAbs = assertInsideDir(filmDir, guideRel, "Guide audio file");
      if (!existsSync(guideAbs) || !statSync(guideAbs).isFile()) {
        throw new Error(`Guide audio file not found: "${guideRel}"`);
      }
      const guideSize = statSync(guideAbs).size;
      if (guideSize === 0) {
        throw new Error(`Guide audio file is empty (0 bytes): "${guideRel}"`);
      }
      if (guideSize > MAX_AUDIO_BYTES) {
        throw new Error(
          `Guide audio file "${guideRel}" exceeds maximum size limit (${MAX_AUDIO_BYTES} bytes)`,
        );
      }
    } else if (typeof t.text !== "string" || !t.text.trim()) {
      throw new Error(`Take "${t.id}" is missing non-empty text in src/edit.json`);
    }
    if (trying) {
      for (const relTry of previewTryOuts(tryDir, t.id, takesCount)) {
        const absTry = assertInsideDir(filmDir, join(filmDir, relTry), "Voice try output");
        ensureRegularOrAbsent(absTry, "Voice try output");
        ensureRegularOrAbsent(
          assertInsideDir(filmDir, `${absTry}.words.json`, "Take words file"),
          "Take words file",
        );
      }
    } else {
      const targetMp3 = assertInsideDir(
        filmDir,
        join(takesDir, `${t.id}.mp3`),
        "Voice take output",
      );
      ensureRegularOrAbsent(targetMp3, "Voice take output");
      ensureRegularOrAbsent(
        assertInsideDir(filmDir, `${targetMp3}.words.json`, "Take words file"),
        "Take words file",
      );
      for (const stale of staleTakeArtifacts(filmDir, takesDir, t.id)) {
        ensureRegularOrAbsent(stale, "Voice take artifact");
      }
    }
  }
  if (dryRun || !confirmed) {
    const rel = (p: string) => relative(filmDir, p).replaceAll("\\", "/");
    return ordered
      .filter((t) => wantSet.has(t.id))
      .flatMap((t) => {
        const guideRel = guideFor(t);
        const outs = trying
          ? previewTryOuts(tryDir, t.id, takesCount)
          : [
              `${rel(join(takesDir, `${t.id}.mp3`))}${hasTakeAudio(takesDir, t.id) ? `, replacing its audio${reworded(t) ? ": its words changed since" : ""}` : ""}`,
            ];
        return outs.map((out) => ({
          id: t.id,
          out: `would write ${out}`,
          info: guideRel
            ? { guide: guideRel, chars: 0, voice: t.voice ?? DEFAULT_NARRATOR }
            : { chars: (t.text ?? "").length, voice: t.voice ?? DEFAULT_NARRATOR },
        }));
      });
  }

  const reqFile = assertInsideDir(filmDir, join(takesDir, ".request_ids.json"), "Request IDs file");
  ensureRegularOrAbsent(reqFile, "Request IDs file");
  let reqIds: Record<string, string | StoredRequestId> = {};
  if (existsSync(reqFile)) {
    try {
      const rawReq = jsonFile(reqFile, filmDir);
      if (isPlainObject(rawReq)) reqIds = rawReq as Record<string, string | StoredRequestId>;
      else console.error("ignoring non-object voice/takes/.request_ids.json");
    } catch (err) {
      console.error(`ignoring unreadable voice/takes/.request_ids.json: ${(err as Error).message}`);
    }
  }
  const saveReqIds = () =>
    atomicWriteText(
      assertInsideDir(filmDir, reqFile, "Request IDs file"),
      JSON.stringify(reqIds, null, 1) + "\n",
    );

  const saveSpoken = (t: TakeSpec) => {
    spoken[t.id] = t.text ?? "";
    atomicWriteText(textsFile, JSON.stringify(spoken, null, 1) + "\n");
  };

  let provider: "elevenlabs" | "genvoice" = "genvoice",
    apiKey = "",
    apiBase = "";
  if (want.length > 0) {
    const resolved = resolveVoiceProvider({}, env);
    provider = resolved.provider;
    apiKey = resolved.apiKey;
    apiBase = resolved.apiBase;
    if (
      provider !== "elevenlabs" &&
      ordered.some((t) => wantSet.has(t.id) && Boolean(guideFor(t)))
    ) {
      throw new Error(
        "Speech-to-Speech (Voice Changer) here requires ELEVENLABS_API_KEY (api.genvoice.pro/v1 returns 405 on /speech-to-speech); with a GenVoice key: bun run voice:playground sources add <recording>, then voice:playground generate voice-changer (schema generate voice-changer shows its input)",
      );
    }
    mkdirSync(takesDir, { recursive: true });
    if (trying) mkdirSync(tryDir, { recursive: true });
  }

  const results: { id: string; out: string; info: unknown }[] = [];
  for (let idx = 0; idx < ordered.length; idx++) {
    const t = ordered[idx];
    if (!wantSet.has(t.id)) continue;
    await opts.onTake?.(t);
    const voiceId = t.voice ?? DEFAULT_NARRATOR;
    const model = t.model ?? "eleven_v4";
    const now = Date.now();

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

    const guideRel = guideFor(t);
    const repeats = trying ? takesCount : 1;
    for (let c = 0; c < repeats; c++) {
      const out = assertInsideDir(
        filmDir,
        trying ? nextTryOut(tryDir, t.id) : join(takesDir, `${t.id}.mp3`),
        "Voice take output",
      );
      const staleOutputs = trying ? [] : staleTakeArtifacts(filmDir, takesDir, t.id);
      let usedModel = model;
      let info: Awaited<ReturnType<typeof tts>> | Awaited<ReturnType<typeof sts>>;
      if (guideRel) {
        usedModel = "eleven_multilingual_sts_v2";
        info = await sts({
          voiceId,
          audioPath: resolve(filmDir, guideRel),
          out,
          stability: t.stability ?? 0.5,
          provider,
          apiKey,
          apiBase,
          env,
        });
      } else {
        info = await tts({
          voiceId,
          text: t.text ?? "",
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
      }
      if (!trying) {
        for (const stale of staleOutputs) rmSync(stale, { force: true });
        saveSpoken(t);
        if (info.requestId) {
          reqIds[t.id] = { id: info.requestId, at: Date.now(), voiceId, model: usedModel };
          saveReqIds();
        }
      }
      results.push({ id: t.id, out, info });
    }
  }

  return results;
};

const shellQuote = (s: string) => (/[\s"'$`]/.test(s) ? `"${s.replace(/(["$`])/g, "\\$1")}"` : s);

const resolveExecutable = (cmd: string): string | null => {
  if (/[\\/]/.test(cmd)) {
    try {
      return statSync(cmd).isFile() ? cmd : null;
    } catch {
      return null;
    }
  }
  return Bun.which(cmd);
};

const hasValidMouthFile = (shapes: string) => {
  try {
    const data = JSON.parse(readFileSync(shapes, "utf8")) as { cues?: unknown };
    return Array.isArray(data?.cues) && data.cues.length > 0;
  } catch {
    return false;
  }
};

const printUnheardWords = (film: string, hasExplicitIds: boolean) => {
  if (hasExplicitIds) return;
  try {
    for (const u of unheardWords(film))
      console.log(
        `take ${u.id}: its audio says "${u.heard}", src/edit.json says "${u.text}". Reworded since? bun run voice:gen ${u.id} previews it again (a misheard word reads otherwise too)`,
      );
  } catch (err) {
    console.error(`skipping word-mismatch check: ${(err as Error).message}`);
  }
};

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cliArgs(HELP, ["--try", "--takes N", "--guide FILE", "--dry-run", "--yes"]);
  envTypos(["LIVE_PROJECT", "WHISPERX_PYTHON", "THREEJS_LAB", "RHUBARB"]);
  const film = needFilm(process.env.LIVE_PROJECT);
  const cliRest = process.argv.slice(2);
  const trying = cliRest.includes("--try");
  const sent = cliRest.includes("--yes") && !cliRest.includes("--dry-run");
  const hasExplicitIds = cliRest.some((a) => !a.startsWith("-"));
  const redact = (msg: string) =>
    sanitizeErrorText(msg, process.env.ELEVENLABS_API_KEY, process.env.GENVOICE_API_KEY);
  let ended: Awaited<ReturnType<typeof startJob>> | undefined;
  const finishJob = async (payload: { say: string; level: "ok" | "warn" | "fail" }) => {
    const end = ended;
    ended = undefined;
    await end?.(payload);
  };
  const results = await runGen({
    cwd: film,
    onTake: sent
      ? async (t) => {
          ended = await startJob(film, "voice:gen", {
            surface: "sound",
            say: t.text
              ? `Voicing take ${t.id}: "${stripAudioTags(t.text)}"`
              : `Voicing take ${t.id} (from guide)`,
          });
        }
      : undefined,
  }).catch(async (e: Error & { usage?: boolean }) => {
    const msg = redact(e.message);
    console.error(msg);
    await finishJob({ say: `Voicing stopped: ${msg}`, level: "fail" });
    process.exit(e.usage ? 2 : 1);
  });
  try {
    for (const r of results) console.log(r.id, r.out, JSON.stringify(r.info));
    if (results.length && !sent) {
      printUnheardWords(film, hasExplicitIds);
      const real = [
        ...cliRest.filter((a) => a !== "--dry-run" && a !== "--yes").map(shellQuote),
        "--yes",
      ];
      const chars = results.reduce((n, r) => n + ((r.info as { chars?: number }).chars ?? 0), 0);
      const guideCount = results.filter((r) =>
        Boolean((r.info as { guide?: unknown }).guide),
      ).length;
      const what =
        results.length === 1
          ? `this ${trying ? "try" : "take"}`
          : `these ${results.length} ${trying ? "tries" : "takes"}`;
      const billing =
        guideCount === 0
          ? `${chars} characters, billed by the character`
          : guideCount === results.length
            ? `${results.length === 1 ? "voice changer" : `${results.length} voice changer takes`}, billed by ElevenLabs STS credits`
            : `${chars} TTS characters + ${guideCount} voice changer`;
      console.log(
        `nothing sent.\nnext: bun run voice:gen ${real.join(" ")} sends ${what} (${billing})`,
      );
    }
    let lipsFailed = false;
    if (sent && !trying) {
      const madeIds = new Set(results.map((r) => r.id));
      const lips = speakingTakes(film).filter(
        (k) => madeIds.has(k.id) && (!k.fresh || !hasValidMouthFile(k.shapes)),
      );
      if (lips.length && !resolveExecutable(rhubarbPath())) {
        lipsFailed = true;
        console.error(
          `no Rhubarb Lip Sync at ${rhubarbPath()} for the mouth shapes of ${lips.map((k) => k.id).join(", ")} (INSTALL.md, the lip sync row): bun run voice:lips once it is there`,
        );
      } else if (lips.length) {
        for (const k of lips)
          try {
            const cues = shapeTake(k, stripAudioTags(k.text ?? ""));
            if (!cues.length) {
              rmSync(k.shapes, { force: true });
              throw new Error("Rhubarb produced 0 mouth shapes");
            }
            console.log(`take ${k.id} (by ${k.by}): ${cues.length} mouth shapes`);
          } catch (e) {
            lipsFailed = true;
            console.error(`take ${k.id}: ${(e as Error).message}: bun run voice:lips tries again`);
          }
        writeMouthMap(film);
      }
    }
    const unaligned =
      sent && !trying
        ? results.map((r) => r.out).filter((out) => !existsSync(`${out}.words.json`))
        : [];
    if (unaligned.length) {
      const [py, ...args] = wordsCommand(unaligned);
      console.log(
        `aligning the words of ${unaligned.length === 1 ? "this take" : `these ${unaligned.length} takes`} with whisperX (a few minutes on a CPU)...`,
      );
      const resolvedPy = resolveExecutable(py);
      const run = resolvedPy
        ? spawnSync(resolvedPy, args, { encoding: "utf8", timeout: 20 * 60_000 })
        : null;
      if (run?.stdout) process.stdout.write(run.stdout);
      if (run?.status !== 0) {
        if (run?.stderr) console.error(run.stderr.trim().split(/\r?\n/).slice(-15).join("\n"));
        else if (run?.error) console.error(run.error.message);
        console.error(
          `${run ? "whisperX failed" : `no whisperX python at ${py} (WHISPERX_PYTHON names one: INSTALL.md)`}: the audio is saved, only its word timings are missing, and bun run voice:assemble needs them: bun run voice:align`,
        );
        await finishJob({
          say: `Voiced ${results.length} take${results.length > 1 ? "s" : ""}; their word timings are missing`,
          level: "warn",
        });
        process.exit(1);
      }
    }
    await finishJob({
      say: lipsFailed
        ? `Voiced ${results.length} take${results.length > 1 ? "s" : ""}; mouth shapes need bun run voice:lips`
        : `Voiced ${results.length} take${results.length > 1 ? "s" : ""}: ${results.map((r) => r.id).join(", ")}`,
      level: lipsFailed ? "warn" : "ok",
    });
    if (results.length && sent) {
      printUnheardWords(film, hasExplicitIds);
      console.log(
        trying
          ? "next: hear the tries in the studio and keep one there (they are in voice/try), then bun run voice:assemble"
          : lipsFailed
            ? "next: bun run voice:lips writes their mouth shapes, then bun run voice:assemble"
            : "next: bun run voice:assemble lays them on the film",
      );
    }
    if (!results.length) {
      const ids = (
        (jsonFile(join(film, "src/edit.json"), film) as { takes?: { id: string }[] }).takes ?? []
      ).map((t) => t.id);
      if (!ids.length) {
        console.log(
          'nothing to generate: src/edit.json has no takes yet.\nnext: add takes to src/edit.json "takes", then bun run voice:gen',
        );
      } else {
        console.log(
          `nothing to generate: every take in src/edit.json has audio in voice/takes. Redo some: bun run voice:gen ${ids[0]} previews it (the ids: ${ids.join(", ")}); new tries beside them: --try ID`,
        );
        printUnheardWords(film, hasExplicitIds);
        const nextStep = unalignedTakes(film).length
          ? "bun run voice:align aligns the takes whose word timings are missing"
          : speakingTakes(film).some((k) => !k.fresh || !hasValidMouthFile(k.shapes))
            ? "bun run voice:lips writes mouth shapes for speaking takes"
            : "bun run voice:assemble lays them on the film";
        console.log(`next: ${nextStep}`);
      }
    }
  } catch (err) {
    const msg = redact((err as Error).message);
    console.error(msg);
    await finishJob({ say: `Voicing failed: ${msg}`, level: "fail" });
    process.exit(1);
  }
}
