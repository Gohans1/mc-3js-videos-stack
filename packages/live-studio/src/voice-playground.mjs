// GenVoice (ElevenLabs v4 wrapper) Voice Playground engine and persistent local archive.
// Manages async TTS/Dialogue/Voice-Changer/STT jobs, permanent local media+SRT storage,
// template remixing, remote history import, and film take promotion.
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

import { sanitizeError } from "./voice-library.mjs";
import { TAKE_ID } from "./voice-map.mjs";
import {
  audioDurationFromFile,
  audioMimeForExt,
  BUILTIN_GENVOICE_MODELS,
  BUILTIN_LANGUAGES,
  clampNum,
  DANGEROUS_KEYS,
  detectTextLanguage,
  extFromDownload,
  extractAudioTags,
  inside,
  isRawHeaderlessPcm,
  isSafeRemoteId,
  maskApiKey,
  MAX_AUDIO_BYTES,
  MAX_SRT_BYTES,
  MAX_STT_BYTES,
  MAX_UPLOAD_BYTES,
  nextTmp,
  normalizeApiBase,
  openGenvoiceClient,
  parseDialogueTurnNames,
  parseEnvFile,
  SAFE_MEDIA_FILE,
  SAFE_SRT_FILE,
  sanitizeRemoteMediaUrl,
  sanitizeVoiceSettings,
  sleep,
  stripDialogueSpeakerBrackets,
  summarizeTitle,
  wrapPcm16ToWav,
  writeAtomic,
} from "./voice-playground-genvoice.mjs";
import { runFfmpeg } from "./voice.mjs";

export {
  BUILTIN_GENVOICE_MODELS,
  BUILTIN_LANGUAGES,
  detectTextLanguage,
  extractAudioTags,
  maskApiKey,
  normalizeApiBase,
  parseDialogueTurnNames,
  parseEnvFile,
  stripDialogueSpeakerBrackets,
};

export const openVoicePlayground = (opts = {}) => {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const env = opts.env ?? process.env;
  const lookupFn = opts.lookup;
  const pollIntervalMs = Math.max(1, Math.trunc(opts.pollIntervalMs ?? 1500));
  const maxPollMs = Math.max(100, Math.trunc(opts.maxPollMs ?? 180_000));
  const secretsFile = opts.secretsFile ?? join(homedir(), ".secrets", "genvoice.env");
  const configFile = resolve(
    opts.configFile ?? join(homedir(), ".cache", "mc-films", "voice-playground-config.json"),
  );
  const storageDir = resolve(
    opts.dir ??
      (opts.project
        ? join(resolve(opts.project), "voice", "playground")
        : join(homedir(), ".cache", "mc-films", "voice-playground")),
  );
  const audioDir = join(storageDir, "audio");
  const srtDir = join(storageDir, "srt");
  const sourcesDir = join(storageDir, "sources");
  const itemsFile = join(storageDir, "items.json");

  const jobs = new Map();
  const pendingPromises = new Set();
  const inflightImports = new Map();
  const activeSourceRefs = new Map();
  let writeChain = Promise.resolve();

  const emit = (payload) => {
    try {
      opts.onEvent?.(payload);
    } catch {
      /* ignore SSE listener errors */
    }
  };

  const {
    resolveKeyConfig,
    genvoiceRequest,
    fetchAccount,
    getStatus,
    setConfig,
    getCatalog,
    searchSharedVoices,
    resolveModelMeta,
    downloadMediaWithRedirects,
    pollGenvoiceTask,
  } = openGenvoiceClient({
    fetchImpl,
    env,
    lookupFn,
    secretsFile,
    configFile,
    pollIntervalMs,
    maxPollMs,
    onEmit: emit,
  });

  const readStoreRaw = () => {
    if (!existsSync(itemsFile)) return [];
    try {
      if (lstatSync(itemsFile).isSymbolicLink()) return [];
      const parsed = JSON.parse(readFileSync(itemsFile, "utf8"));
      return Array.isArray(parsed?.items) ? parsed.items : [];
    } catch {
      return [];
    }
  };

  const writeStoreRaw = (items) => {
    mkdirSync(audioDir, { recursive: true });
    mkdirSync(srtDir, { recursive: true });
    writeAtomic(itemsFile, JSON.stringify({ version: 1, items }, null, 2));
  };

  const mutateStore = (fn) => {
    const nextRun = writeChain.then(async () => {
      const items = readStoreRaw();
      const res = await fn(items);
      writeStoreRaw(items);
      return res;
    });
    writeChain = nextRun.catch(() => {});
    return nextRun;
  };

  const listItems = () => readStoreRaw();

  const listJobs = () => [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const getItem = (id) => readStoreRaw().find((x) => x.id === id) ?? null;

  const ensureSafeDir = (targetDir) => {
    mkdirSync(targetDir, { recursive: true });
    if (lstatSync(targetDir).isSymbolicLink()) {
      throw new Error("Playground storage folder must not be a symlink");
    }
    return realpathSync(targetDir);
  };

  const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

  const sanitizeDialogueSpeakers = (raw) => {
    if (!isPlainObject(raw)) return null;
    const out = Object.create(null);
    let count = 0;
    for (const [k, v] of Object.entries(raw)) {
      const name = String(k).trim();
      if (!name || DANGEROUS_KEYS.has(name) || !isPlainObject(v)) continue;
      const voiceId = typeof v.voice_id === "string" ? v.voice_id.trim() : "";
      if (!voiceId) continue;
      out[name] = {
        provider: typeof v.provider === "string" ? v.provider : "elevenlabs",
        voice_id: voiceId,
        voice_name:
          typeof v.voice_name === "string" && v.voice_name.trim() ? v.voice_name.trim() : voiceId,
        model_id:
          typeof v.model_id === "string" && v.model_id.trim() ? v.model_id.trim() : "eleven_v4",
        ...(typeof v.language_code === "string" && v.language_code.trim()
          ? { language_code: v.language_code.trim() }
          : {}),
        voice_settings: isPlainObject(v.voice_settings) ? v.voice_settings : {},
      };
      count += 1;
    }
    return count > 0 ? out : null;
  };

  const removeSourceFileIfUnused = (sf, itemsList = readStoreRaw()) => {
    if (!sf || !SAFE_MEDIA_FILE.test(sf) || !existsSync(sourcesDir)) return;
    if (Array.from(activeSourceRefs.values()).includes(sf)) return;
    const stillReferenced = itemsList.some((x) => x.voiceChanger?.sourceFile === sf);
    if (stillReferenced) return;
    const realSources = realpathSync(sourcesDir);
    const target = join(realSources, sf);
    if (inside(realSources, target)) rmSync(target, { force: true });
  };

  const archiveTaskMedia = async ({ audioUrl, srtUrl, apiBase, idBase, outputFormat }) => {
    const realAudio = ensureSafeDir(audioDir);
    const realSrt = ensureSafeDir(srtDir);
    const downloaded = await downloadMediaWithRedirects(
      audioUrl,
      MAX_AUDIO_BYTES,
      "GenVoice audio",
      apiBase,
      lookupFn,
    );
    let audioBytes = downloaded.bytes;
    let ext = extFromDownload(downloaded.url, downloaded.contentType, downloaded.bytes);
    if (
      typeof outputFormat === "string" &&
      outputFormat.startsWith("pcm_") &&
      isRawHeaderlessPcm(downloaded.bytes, downloaded.url, downloaded.contentType)
    ) {
      const rateMatch = /^pcm_(\d+)$/.exec(outputFormat);
      audioBytes = wrapPcm16ToWav(downloaded.bytes, rateMatch ? Number(rateMatch[1]) : 44100);
      ext = ".wav";
    }
    const audioFile = `${idBase}${ext}`;
    const targetAudio = join(realAudio, audioFile);
    if (!inside(realAudio, targetAudio)) throw new Error("Unsafe audio target filename");
    writeAtomic(targetAudio, audioBytes);
    const durationSeconds = audioDurationFromFile(targetAudio);

    let srtFile;
    let srtText;
    if (srtUrl) {
      try {
        const srtDl = await downloadMediaWithRedirects(
          srtUrl,
          MAX_SRT_BYTES,
          "GenVoice SRT",
          apiBase,
          lookupFn,
        );
        srtText = srtDl.bytes.toString("utf8");
        srtFile = `${idBase}.srt`;
        const targetSrt = join(realSrt, srtFile);
        if (inside(realSrt, targetSrt)) writeAtomic(targetSrt, srtText);
      } catch {
        /* keep generation usable even if optional SRT fails */
      }
    }
    return {
      audioFile,
      mimeType: audioMimeForExt(ext),
      bytes: audioBytes.byteLength,
      durationSeconds,
      srtFile,
      srtText,
    };
  };

  const pruneJobs = () => {
    if (jobs.size <= 40) return;
    for (const [id, entry] of jobs) {
      if (entry.status === "completed" || entry.status === "failed") {
        jobs.delete(id);
        if (jobs.size <= 40) break;
      }
    }
  };

  const trackJob = (job, runner) => {
    pruneJobs();
    jobs.set(job.id, job);
    emit({ type: "job", job: { ...job } });
    const p = (async () => {
      try {
        const item = await runner();
        job.status = "completed";
        job.progress = 100;
        job.itemId = item.id;
        emit({ type: "job", job: { ...job } });
        emit({ type: "item", item });
        fetchAccount()
          .then((account) => emit({ type: "account", account }))
          .catch(() => {});
        return item;
      } catch (err) {
        job.status = "failed";
        job.error = err.message;
        emit({ type: "job", job: { ...job } });
        throw err;
      } finally {
        pendingPromises.delete(p);
      }
    })();
    p.catch(() => {});
    pendingPromises.add(p);
    return job;
  };

  const startTts = async (input) => {
    const cfg = resolveKeyConfig();
    if (!cfg.apiKey) throw new Error("Missing GenVoice API key");
    const voiceId = String(input.voiceId ?? "").trim();
    const text = String(input.text ?? "").trim();
    if (!voiceId) throw Object.assign(new Error("voiceId is required"), { status: 400 });
    if (!isSafeRemoteId(voiceId))
      throw Object.assign(new Error("Invalid voiceId"), { status: 400 });
    if (!text) throw Object.assign(new Error("text is required"), { status: 400 });

    const modelId = String(input.modelId ?? "eleven_v4").trim() || "eleven_v4";
    const modelMeta = await resolveModelMeta(modelId);
    const voiceSettings = sanitizeVoiceSettings(input.voiceSettings, modelMeta);
    const languageCode =
      (typeof input.languageCode === "string" ? input.languageCode.trim() : "") ||
      detectTextLanguage(text);
    const exportTranscript = Boolean(input.exportTranscript);
    const previousText =
      modelMeta?.supports_context !== false && typeof input.previousText === "string"
        ? input.previousText.trim().slice(0, 5000)
        : "";
    const nextText =
      modelMeta?.supports_context !== false && typeof input.nextText === "string"
        ? input.nextText.trim().slice(0, 5000)
        : "";
    const rawSeed = clampNum(input.seed, 0, 4294967295);
    const seed = rawSeed !== undefined ? Math.trunc(rawSeed) : undefined;
    const outputFormat =
      typeof input.outputFormat === "string" ? input.outputFormat.trim().slice(0, 40) : "";
    const applyTextNormalization =
      input.applyTextNormalization === "on" ||
      input.applyTextNormalization === "off" ||
      input.applyTextNormalization === "auto"
        ? input.applyTextNormalization
        : undefined;
    const voiceName = String(input.voiceName ?? voiceId).trim() || voiceId;
    const variations = Math.min(3, Math.max(1, Math.trunc(Number(input.variations ?? 1))));
    const baseTitle = summarizeTitle(text, input.name);

    const createdJobs = [];
    for (let idx = 0; idx < variations; idx++) {
      const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
      const title = variations > 1 ? `${baseTitle} (${idx + 1}/${variations})` : baseTitle;
      const itemSeed =
        seed !== undefined && variations > 1 ? Math.min(4294967295, seed + idx) : seed;
      const job = {
        id,
        kind: "tts",
        status: "pending",
        progress: 0,
        title,
        voiceId,
        voiceName,
        modelId,
        createdAt: new Date().toISOString(),
      };
      trackJob(job, async () => {
        const body = {
          text,
          model_id: modelId,
          provider: "elevenlabs",
          language_code: languageCode,
          voice_settings: voiceSettings,
          ...(previousText && { previous_text: previousText }),
          ...(nextText && { next_text: nextText }),
          ...(itemSeed !== undefined && { seed: itemSeed }),
          ...(outputFormat && { output_format: outputFormat }),
          ...(applyTextNormalization && { apply_text_normalization: applyTextNormalization }),
          ...(exportTranscript && { export_transcript: true }),
        };
        const hasPassthrough = Boolean(
          previousText ||
          nextText ||
          itemSeed !== undefined ||
          outputFormat ||
          applyTextNormalization,
        );
        let usedFallback = false;
        let created;
        try {
          ({ data: created } = await genvoiceRequest(
            `/text-to-speech/${encodeURIComponent(voiceId)}`,
            { method: "POST", body: JSON.stringify(body) },
          ));
        } catch (err) {
          if (hasPassthrough && (err?.status === 400 || err?.status === 422)) {
            usedFallback = true;
            const fallbackBody = {
              text,
              model_id: modelId,
              provider: "elevenlabs",
              language_code: languageCode,
              voice_settings: voiceSettings,
              ...(exportTranscript && { export_transcript: true }),
            };
            ({ data: created } = await genvoiceRequest(
              `/text-to-speech/${encodeURIComponent(voiceId)}`,
              { method: "POST", body: JSON.stringify(fallbackBody) },
            ));
          } else {
            throw err;
          }
        }
        const taskId = String(created.id ?? created.task_id ?? "");
        if (!taskId) throw new Error("GenVoice TTS response missing task id");
        job.remoteTaskId = taskId;
        const { data: task, cfg: pollCfg } = await pollGenvoiceTask({
          pollPath: `/history/${encodeURIComponent(taskId)}`,
          job,
        });
        const audioUrl = task?.result?.audio_url;
        if (!audioUrl) throw new Error("Completed TTS task missing audio_url");
        const media = await archiveTaskMedia({
          audioUrl,
          srtUrl: task?.result?.srt_url,
          apiBase: pollCfg.apiBase,
          idBase: id,
          outputFormat: usedFallback ? "" : outputFormat,
        });
        const now = new Date().toISOString();
        const item = {
          id,
          kind: "tts",
          title,
          text,
          tags: extractAudioTags(text),
          voiceId,
          voiceName,
          modelId,
          languageCode,
          voiceSettings,
          ...(!usedFallback && previousText ? { previousText } : {}),
          ...(!usedFallback && nextText ? { nextText } : {}),
          ...(!usedFallback && itemSeed !== undefined ? { seed: itemSeed } : {}),
          ...(!usedFallback && outputFormat ? { outputFormat } : {}),
          ...(!usedFallback && applyTextNormalization ? { applyTextNormalization } : {}),
          ...(usedFallback
            ? {
                fallbackNote:
                  "GenVoice rejected advanced options (seed, context, format, or normalization); generated with base settings.",
              }
            : {}),
          exportTranscript,
          ...media,
          remoteTaskId: taskId,
          charactersUsed: Number(task.characters_used ?? text.length),
          creditsDeducted: Number(task.credits_deducted ?? 0),
          provider: "elevenlabs",
          favorite: false,
          isTemplate: false,
          ...(input.notes ? { notes: String(input.notes).trim() } : {}),
          ...(input.sourceTakeId ? { sourceTakeId: String(input.sourceTakeId) } : {}),
          ...(input.fromTemplateId ? { fromTemplateId: String(input.fromTemplateId) } : {}),
          createdAt: now,
          updatedAt: now,
        };
        await mutateStore((items) => {
          items.unshift(item);
        });
        return item;
      });
      createdJobs.push({ ...job });
    }
    return { jobs: createdJobs };
  };

  const startDialogue = async (input) => {
    const cfg = resolveKeyConfig();
    if (!cfg.apiKey) throw new Error("Missing GenVoice API key");
    const text = stripDialogueSpeakerBrackets(input.text).trim();
    const rawSpeakers = input.speakers && typeof input.speakers === "object" ? input.speakers : {};
    const speakerEntries = Object.entries(rawSpeakers)
      .map(([k, v]) => [k.trim(), v])
      .filter(([k]) => k && !DANGEROUS_KEYS.has(k));
    const speakerNames = speakerEntries.map(([k]) => k);
    if (!text) throw Object.assign(new Error("Dialogue text is required"), { status: 400 });
    if (speakerNames.length < 2) {
      throw Object.assign(new Error("GenVoice Dialogue requires at least 2 speakers"), {
        status: 400,
      });
    }
    const configuredSet = new Set(speakerNames);
    const matchedTurnSpeakers = parseDialogueTurnNames(text).filter((n) => configuredSet.has(n));
    if (matchedTurnSpeakers.length < 2) {
      throw Object.assign(
        new Error(
          'Dialogue script must include "SpeakerName: line" turns for at least 2 configured speakers.',
        ),
        { status: 400 },
      );
    }

    const catalog = await getCatalog();
    const defaultLang = detectTextLanguage(text);
    const speakers = Object.create(null);
    const speakerSummary = Object.create(null);
    for (const [name, s] of speakerEntries) {
      const vId = String(s?.voice_id ?? "").trim();
      if (!vId) {
        throw Object.assign(new Error(`Speaker "${name}" missing voice_id`), { status: 400 });
      }
      if (!isSafeRemoteId(vId)) {
        throw Object.assign(new Error(`Speaker "${name}" has invalid voice_id`), { status: 400 });
      }
      const mId = String(s?.model_id ?? "eleven_v4").trim() || "eleven_v4";
      const modelMeta =
        catalog.models.find((m) => m.model_id === mId) ??
        BUILTIN_GENVOICE_MODELS.find((m) => m.model_id === mId) ??
        BUILTIN_GENVOICE_MODELS[0];
      const settings = sanitizeVoiceSettings(s.voice_settings, modelMeta);
      const lang =
        (typeof s.language_code === "string" ? s.language_code.trim() : "") || defaultLang;
      speakers[name] = {
        provider: "elevenlabs",
        voice_id: vId,
        model_id: mId,
        language_code: lang,
        voice_settings: settings,
      };
      speakerSummary[name] = {
        voice_id: vId,
        voice_name: String(s?.voice_name ?? vId),
        model_id: mId,
        language_code: lang,
        voice_settings: settings,
      };
    }

    const pauseBetweenTurns =
      clampNum(input.pause_between_turns ?? input.pauseBetweenTurns, 0, 3) ?? 0.5;
    const exportTranscript = Boolean(input.exportTranscript);
    const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const title = summarizeTitle(text, input.name);
    const primarySpeaker = speakerSummary[speakerNames[0]];

    const job = {
      id,
      kind: "dialogue",
      status: "pending",
      progress: 0,
      title,
      voiceId: primarySpeaker.voice_id,
      voiceName: speakerNames.map((n) => `${n}: ${speakerSummary[n].voice_name}`).join(" / "),
      modelId: primarySpeaker.model_id,
      createdAt: new Date().toISOString(),
    };

    trackJob(job, async () => {
      const baseBody = {
        text,
        speakers,
        pause_between_turns: +pauseBetweenTurns.toFixed(2),
      };
      let usedFallback = false;
      let created;
      try {
        ({ data: created } = await genvoiceRequest("/dialogue", {
          method: "POST",
          body: JSON.stringify({
            ...baseBody,
            ...(exportTranscript && { export_transcript: true }),
          }),
        }));
      } catch (err) {
        if (exportTranscript && (err?.status === 400 || err?.status === 422)) {
          usedFallback = true;
          ({ data: created } = await genvoiceRequest("/dialogue", {
            method: "POST",
            body: JSON.stringify(baseBody),
          }));
        } else {
          throw err;
        }
      }
      const taskId = String(created.id ?? created.task_id ?? "");
      if (!taskId) throw new Error("GenVoice Dialogue response missing task id");
      job.remoteTaskId = taskId;
      const { data: task, cfg: pollCfg } = await pollGenvoiceTask({
        pollPath: `/history/${encodeURIComponent(taskId)}`,
        job,
      });
      const audioUrl = task?.result?.audio_url;
      if (!audioUrl) throw new Error("Completed dialogue task missing audio_url");
      const media = await archiveTaskMedia({
        audioUrl,
        srtUrl: task?.result?.srt_url,
        apiBase: pollCfg.apiBase,
        idBase: id,
      });
      const now = new Date().toISOString();
      const item = {
        id,
        kind: "dialogue",
        title,
        text,
        tags: extractAudioTags(text),
        voiceId: primarySpeaker.voice_id,
        voiceName: speakerNames.map((n) => `${n} (${speakerSummary[n].voice_name})`).join(" · "),
        modelId: primarySpeaker.model_id,
        languageCode: primarySpeaker.language_code,
        voiceSettings: primarySpeaker.voice_settings,
        exportTranscript: !usedFallback && exportTranscript,
        ...(usedFallback
          ? {
              fallbackNote:
                "GenVoice rejected export_transcript on /dialogue; generated without transcript.",
            }
          : {}),
        dialogue: { pause_between_turns: pauseBetweenTurns, speakers: speakerSummary },
        ...media,
        remoteTaskId: taskId,
        charactersUsed: Number(task.characters_used ?? text.length),
        creditsDeducted: Number(task.credits_deducted ?? 0),
        provider: "elevenlabs",
        favorite: false,
        isTemplate: false,
        ...(input.notes ? { notes: String(input.notes).trim() } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await mutateStore((items) => {
        items.unshift(item);
      });
      return item;
    });

    return { job: { ...job } };
  };

  const persistUploadSource = (bytes, fileName, extFallback) => {
    const ext = [".mp3", ".wav", ".ogg", ".m4a", ".webm"].includes(
      extname(String(fileName ?? "")).toLowerCase(),
    )
      ? extname(String(fileName ?? "")).toLowerCase()
      : extFallback;
    const realSources = ensureSafeDir(sourcesDir);
    const sourceFile = `src_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}${ext}`;
    const target = join(realSources, sourceFile);
    if (!inside(realSources, target)) throw new Error("Unsafe source audio filename");
    writeAtomic(target, bytes);
    return sourceFile;
  };

  const readCheckedFileBytes = (filePath, maxBytes, limitLabel) => {
    const st = statSync(filePath);
    if (typeof maxBytes === "number" && st.size > maxBytes) {
      throw Object.assign(new Error(`${limitLabel} (${maxBytes} bytes)`), { status: 413 });
    }
    return readFileSync(filePath);
  };

  const resolveSourceAudio = ({
    fileBytes,
    fileName,
    mimeType,
    sourceItemId,
    sourceFile,
    sourceTakeKind,
    sourceTakeFile,
    maxBytes,
    limitLabel = "Audio exceeds size limit",
  }) => {
    if (fileBytes && fileBytes.byteLength > 0) {
      if (typeof maxBytes === "number" && fileBytes.byteLength > maxBytes) {
        throw Object.assign(new Error(`${limitLabel} (${maxBytes} bytes)`), { status: 413 });
      }
      return {
        bytes: fileBytes,
        name: fileName || "audio.mp3",
        mime: mimeType || "audio/mpeg",
        label: fileName || "Uploaded audio",
        fromUpload: true,
      };
    }
    if (sourceFile && SAFE_MEDIA_FILE.test(sourceFile) && existsSync(sourcesDir)) {
      const realSources = ensureSafeDir(sourcesDir);
      const srcPath = join(realSources, sourceFile);
      if (
        !inside(realSources, srcPath) ||
        !existsSync(srcPath) ||
        lstatSync(srcPath).isSymbolicLink()
      ) {
        throw new Error("Archived source audio file unavailable");
      }
      return {
        bytes: readCheckedFileBytes(srcPath, maxBytes, limitLabel),
        name: sourceFile,
        mime: audioMimeForExt(extname(sourceFile).toLowerCase()),
        label:
          fileName ||
          readStoreRaw().find((item) => item.voiceChanger?.sourceFile === sourceFile)?.voiceChanger
            ?.sourceLabel ||
          sourceFile,
        sourceFile,
      };
    }
    if (sourceItemId) {
      const found = getItem(sourceItemId);
      if (!found?.audioFile) throw new Error(`Source playground item "${sourceItemId}" not found`);
      const realAudio = ensureSafeDir(audioDir);
      const srcPath = join(realAudio, found.audioFile);
      if (
        !inside(realAudio, srcPath) ||
        !existsSync(srcPath) ||
        lstatSync(srcPath).isSymbolicLink()
      ) {
        throw new Error("Source playground audio file unavailable");
      }
      return {
        bytes: readCheckedFileBytes(srcPath, maxBytes, limitLabel),
        name: found.audioFile,
        mime: found.mimeType || "audio/mpeg",
        label: found.title || found.audioFile,
        itemId: found.id,
      };
    }
    if (sourceTakeKind && sourceTakeFile && opts.voice) {
      const f = opts.voice.audioFile(sourceTakeKind, sourceTakeFile);
      if (!f || !existsSync(f)) throw new Error("Source film take audio unavailable");
      return {
        bytes: readCheckedFileBytes(f, maxBytes, limitLabel),
        name: sourceTakeFile,
        mime: audioMimeForExt(extname(sourceTakeFile).toLowerCase()),
        label: sourceTakeFile,
        takeKind: sourceTakeKind,
        takeFile: sourceTakeFile,
      };
    }
    throw new Error("Source audio file, itemId, or take is required");
  };

  const startVoiceChanger = async (input) => {
    const cfg = resolveKeyConfig();
    if (!cfg.apiKey) throw new Error("Missing GenVoice API key");
    const voiceId = String(input.voiceId ?? "").trim();
    if (!voiceId) throw Object.assign(new Error("voiceId is required"), { status: 400 });
    if (!isSafeRemoteId(voiceId)) {
      throw Object.assign(new Error("Invalid voiceId"), { status: 400 });
    }
    const source = resolveSourceAudio({
      ...input,
      maxBytes: MAX_UPLOAD_BYTES,
      limitLabel: "Audio exceeds GenVoice Voice Changer limit",
    });

    const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const savedSourceFile =
      source.sourceFile || persistUploadSource(source.bytes, source.name, ".mp3");
    if (savedSourceFile) activeSourceRefs.set(id, savedSourceFile);

    let modelMeta;
    const modelId =
      String(input.modelId ?? "eleven_multilingual_sts_v2").trim() || "eleven_multilingual_sts_v2";
    try {
      modelMeta = await resolveModelMeta(modelId);
    } catch (err) {
      activeSourceRefs.delete(id);
      removeSourceFileIfUnused(savedSourceFile);
      throw err;
    }
    const voiceSettings = sanitizeVoiceSettings(input.voiceSettings, {
      ...modelMeta,
      supports_speed: false,
    });
    const removeBg = Boolean(input.removeBackgroundNoise);
    const rawSeed = clampNum(input.seed, 0, 4294967295);
    const seed = rawSeed !== undefined ? Math.trunc(rawSeed) : undefined;
    const voiceName = String(input.voiceName ?? voiceId).trim() || voiceId;
    const title = summarizeTitle(source.label, input.name || `STS: ${source.label}`);

    const job = {
      id,
      kind: "voice_changer",
      status: "pending",
      progress: 0,
      title,
      voiceId,
      voiceName,
      modelId,
      createdAt: new Date().toISOString(),
    };

    trackJob(job, async () => {
      try {
        const buildVcForm = (includeSeed) => {
          const form = new FormData();
          form.append("audio", new Blob([source.bytes], { type: source.mime }), source.name);
          form.append("voice_id", voiceId);
          form.append("model_id", modelId);
          form.append("remove_background_noise", removeBg ? "true" : "false");
          form.append("voice_settings", JSON.stringify(voiceSettings));
          if (includeSeed && seed !== undefined) form.append("seed", String(seed));
          return form;
        };
        let usedFallback = false;
        let created;
        try {
          ({ data: created } = await genvoiceRequest("/voice-changer", {
            method: "POST",
            body: buildVcForm(seed !== undefined),
          }));
        } catch (err) {
          if (seed !== undefined && (err?.status === 400 || err?.status === 422)) {
            usedFallback = true;
            ({ data: created } = await genvoiceRequest("/voice-changer", {
              method: "POST",
              body: buildVcForm(false),
            }));
          } else {
            throw err;
          }
        }
        const taskId = String(created.task_id ?? created.id ?? "");
        if (!taskId) throw new Error("GenVoice Voice Changer response missing task_id");
        job.remoteTaskId = taskId;
        const { data: task, cfg: pollCfg } = await pollGenvoiceTask({
          pollPath: `/voice-changer/history/${encodeURIComponent(taskId)}`,
          job,
        });
        const audioUrl = task?.result?.audio_url;
        if (!audioUrl) throw new Error("Completed Voice Changer task missing audio_url");
        const media = await archiveTaskMedia({
          audioUrl,
          apiBase: pollCfg.apiBase,
          idBase: id,
        });
        const now = new Date().toISOString();
        const item = {
          id,
          kind: "voice_changer",
          title,
          text: `[voice-changer] Source: ${source.label}`,
          tags: [],
          voiceId,
          voiceName,
          modelId,
          languageCode: "",
          voiceSettings,
          ...(!usedFallback && seed !== undefined ? { seed } : {}),
          ...(usedFallback
            ? {
                fallbackNote:
                  "GenVoice rejected the undocumented seed parameter for Voice Changer; generated without seed.",
              }
            : {}),
          exportTranscript: false,
          voiceChanger: {
            sourceLabel: source.label,
            ...(source.itemId ? { sourceItemId: source.itemId } : {}),
            ...(savedSourceFile ? { sourceFile: savedSourceFile } : {}),
            ...(source.takeKind ? { sourceTakeKind: source.takeKind } : {}),
            ...(source.takeFile ? { sourceTakeFile: source.takeFile } : {}),
            remove_background_noise: removeBg,
          },
          ...media,
          remoteTaskId: taskId,
          creditsDeducted: Number(task.credits_deducted ?? 0),
          provider: "elevenlabs",
          favorite: false,
          isTemplate: false,
          ...(input.notes ? { notes: String(input.notes).trim() } : {}),
          createdAt: now,
          updatedAt: now,
        };
        await mutateStore((items) => {
          items.unshift(item);
        });
        activeSourceRefs.delete(id);
        return item;
      } catch (err) {
        activeSourceRefs.delete(id);
        if (savedSourceFile) {
          try {
            removeSourceFileIfUnused(savedSourceFile);
          } catch {
            /* best effort cleanup */
          }
        }
        throw err;
      }
    });

    return { job: { ...job } };
  };

  const runSpeechToText = async (input) => {
    const cfg = resolveKeyConfig();
    if (!cfg.apiKey) throw new Error("Missing GenVoice API key");
    const source = resolveSourceAudio({
      fileBytes: input.fileBytes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sourceItemId: input.itemId ?? input.sourceItemId,
      sourceTakeKind: input.sourceTakeKind,
      sourceTakeFile: input.sourceTakeFile,
      maxBytes: MAX_STT_BYTES,
      limitLabel: "Audio exceeds GenVoice STT limit",
    });
    const rawLang =
      typeof (input.languageCode ?? input.language_code) === "string"
        ? (input.languageCode ?? input.language_code).trim()
        : "";
    if (!rawLang || rawLang.toLowerCase() === "auto") {
      throw Object.assign(
        new Error(
          "GenVoice Scribe v2 requires an explicit language_code (e.g. 'en', 'vi'); 'auto' is not supported.",
        ),
        { status: 400 },
      );
    }
    if (input.diarize === true && input.useMultiChannel === true) {
      throw Object.assign(
        new Error("GenVoice Scribe v2 does not allow diarize and use_multi_channel together."),
        { status: 400 },
      );
    }
    const form = new FormData();
    form.append("file", new Blob([source.bytes], { type: source.mime }), source.name);
    form.append("language_code", rawLang);
    form.append("model_id", "scribe_v2");
    if (input.fileFormat === "pcm_s16le_16" || input.fileFormat === "other") {
      form.append("file_format", input.fileFormat);
    }
    if (input.timestampsGranularity)
      form.append("timestamps_granularity", String(input.timestampsGranularity));
    if (typeof input.diarize === "boolean") form.append("diarize", String(input.diarize));
    if (typeof input.useMultiChannel === "boolean") {
      form.append("use_multi_channel", String(input.useMultiChannel));
    }
    const hasNumSpeakers =
      typeof input.numSpeakers === "number" &&
      Number.isFinite(input.numSpeakers) &&
      input.numSpeakers > 0;
    if (hasNumSpeakers) {
      form.append("num_speakers", String(Math.trunc(input.numSpeakers)));
    } else if (
      typeof input.diarizationThreshold === "number" &&
      Number.isFinite(input.diarizationThreshold)
    ) {
      const thresh = clampNum(input.diarizationThreshold, 0, 1.5);
      if (thresh !== undefined) form.append("diarization_threshold", String(thresh));
    }
    if (typeof input.tagAudioEvents === "boolean") {
      form.append("tag_audio_events", String(input.tagAudioEvents));
    }
    if (typeof input.noVerbatim === "boolean") form.append("no_verbatim", String(input.noVerbatim));
    if (typeof input.temperature === "number" && Number.isFinite(input.temperature)) {
      const temp = clampNum(input.temperature, 0, 2);
      if (temp !== undefined) form.append("temperature", String(temp));
    }
    if (typeof input.seed === "number" && Number.isFinite(input.seed)) {
      const sttSeed = Math.trunc(input.seed);
      if (sttSeed < 0 || sttSeed > 2147483647) {
        throw Object.assign(
          new Error("GenVoice Scribe v2 seed must be an integer between 0 and 2147483647."),
          { status: 400 },
        );
      }
      form.append("seed", String(sttSeed));
    }
    if (Array.isArray(input.keyterms) && input.keyterms.length) {
      for (const term of input.keyterms.slice(0, 1000)) {
        const cleanTerm = String(term ?? "")
          .trim()
          .slice(0, 49);
        if (cleanTerm) form.append("keyterms", cleanTerm);
      }
    }
    const entityDetectionList = Array.isArray(input.entityDetection)
      ? input.entityDetection.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    for (const cat of entityDetectionList.slice(0, 20)) {
      form.append("entity_detection", cat);
    }
    const entityRedactionList = Array.isArray(input.entityRedaction)
      ? input.entityRedaction.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    if (entityRedactionList.length) {
      const allowedDetection = new Set(entityDetectionList);
      if (!allowedDetection.has("all")) {
        const invalid = entityRedactionList.find((x) => !allowedDetection.has(x));
        if (invalid) {
          throw Object.assign(
            new Error(
              `entity_redaction item "${invalid}" must also be enabled in entity_detection.`,
            ),
            { status: 400 },
          );
        }
      }
      for (const cat of entityRedactionList.slice(0, 20)) {
        form.append("entity_redaction", cat);
      }
    }
    if (
      input.entityRedactionMode === "redacted" ||
      input.entityRedactionMode === "entity_type" ||
      input.entityRedactionMode === "enumerated_entity_type"
    ) {
      form.append("entity_redaction_mode", input.entityRedactionMode);
    }
    const formats =
      input.additionalFormats === undefined
        ? ["srt"]
        : Array.isArray(input.additionalFormats)
          ? input.additionalFormats
          : [];
    for (const fmt of formats) {
      const cleanFmt = String(fmt ?? "").trim();
      if (cleanFmt) form.append("additional_formats", cleanFmt);
    }

    const { data: created } = await genvoiceRequest("/speech-to-text", {
      method: "POST",
      body: form,
    });
    const taskId = String(created.task_id ?? created.id ?? "");
    if (!taskId) throw new Error("GenVoice STT response missing task_id");

    const deadline = Date.now() + maxPollMs;
    let sttData = null;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const { data, cfg: pollCfg } = await genvoiceRequest(
        `/speech-to-text/${encodeURIComponent(taskId)}`,
      );
      if (data.status === "completed") {
        sttData = data;
        break;
      }
      if (data.status === "failed") {
        throw new Error(
          sanitizeError(
            data.detail_error || data.error || "GenVoice STT task failed",
            pollCfg.apiKey,
          ),
        );
      }
    }
    if (!sttData) throw new Error(`GenVoice STT task ${taskId} timed out`);

    const resObj = sttData.result ?? {};
    const extraFormats = Array.isArray(resObj.additional_formats)
      ? resObj.additional_formats
          .filter(
            (f) =>
              isPlainObject(f) &&
              typeof (f.file_extension ?? f.requested_format) === "string" &&
              typeof f.content === "string",
          )
          .map((f) => ({
            file_extension: String(f.file_extension ?? f.requested_format),
            content: String(f.content),
            ...(typeof f.is_base64_encoded === "boolean"
              ? { is_base64_encoded: f.is_base64_encoded }
              : {}),
          }))
      : [];
    const srtEntry = extraFormats.find((f) => f.file_extension === "srt") ?? null;
    const rawProb = Number(resObj.language_probability);
    const sttResult = {
      text: String(resObj.text ?? ""),
      language_code: String(resObj.language_code ?? rawLang),
      ...(Number.isFinite(rawProb) && rawProb >= 0 && rawProb <= 1
        ? { language_probability: rawProb }
        : {}),
      words: Array.isArray(resObj.words) ? resObj.words : [],
      ...(Array.isArray(resObj.entities)
        ? {
            entities: resObj.entities
              .filter(
                (entity) =>
                  isPlainObject(entity) &&
                  typeof entity.text === "string" &&
                  typeof entity.entity_type === "string" &&
                  Number.isInteger(entity.start_char) &&
                  Number.isInteger(entity.end_char) &&
                  entity.start_char >= 0 &&
                  entity.end_char >= entity.start_char,
              )
              .map(({ text, entity_type, start_char, end_char }) => ({
                text,
                entity_type,
                start_char,
                end_char,
              })),
          }
        : {}),
      ...(srtEntry?.content ? { srtText: srtEntry.content } : {}),
      ...(extraFormats.length ? { additional_formats: extraFormats } : {}),
      createdAt: new Date().toISOString(),
    };

    if (input.itemId) {
      const updated = await mutateStore((items) => {
        const idx = items.findIndex((x) => x.id === input.itemId);
        if (idx < 0) return null;
        items[idx] = {
          ...items[idx],
          sttResult,
          ...(sttResult.srtText && !items[idx].srtText ? { srtText: sttResult.srtText } : {}),
          updatedAt: new Date().toISOString(),
        };
        return items[idx];
      });
      if (updated) emit({ type: "item", item: updated });
    }
    return { taskId, sttResult };
  };

  const patchItem = async (id, patch) => {
    const updated = await mutateStore((items) => {
      const idx = items.findIndex((x) => x.id === id);
      if (idx < 0) return null;
      const cur = items[idx];
      const next = { ...cur };
      if (typeof patch.favorite === "boolean") next.favorite = patch.favorite;
      if (typeof patch.isTemplate === "boolean") next.isTemplate = patch.isTemplate;
      if (typeof patch.templateName === "string")
        next.templateName = patch.templateName.trim().slice(0, 120);
      if (typeof patch.title === "string" && patch.title.trim())
        next.title = patch.title.trim().slice(0, 120);
      if (typeof patch.notes === "string") next.notes = patch.notes.trim().slice(0, 2000);
      if (Array.isArray(patch.tags)) {
        next.tags = patch.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 40);
      }
      next.updatedAt = new Date().toISOString();
      items[idx] = next;
      return next;
    });
    if (updated) emit({ type: "item", item: updated });
    return updated;
  };

  const deleteItem = async (id) => {
    let remainingItems = null;
    const removed = await mutateStore((items) => {
      const idx = items.findIndex((x) => x.id === id);
      if (idx < 0) return null;
      const victim = items.splice(idx, 1)[0];
      remainingItems = items;
      return victim;
    });
    if (!removed) return false;
    if (removed.audioFile && SAFE_MEDIA_FILE.test(removed.audioFile) && existsSync(audioDir)) {
      const realAudio = realpathSync(audioDir);
      const target = join(realAudio, removed.audioFile);
      if (inside(realAudio, target)) rmSync(target, { force: true });
    }
    if (removed.srtFile && SAFE_SRT_FILE.test(removed.srtFile) && existsSync(srtDir)) {
      const realSrt = realpathSync(srtDir);
      const target = join(realSrt, removed.srtFile);
      if (inside(realSrt, target)) rmSync(target, { force: true });
    }
    removeSourceFileIfUnused(removed.voiceChanger?.sourceFile, remainingItems ?? undefined);
    emit({ type: "deleted", id });
    return true;
  };

  const retryItem = async (id, overrides = {}) => {
    const item = getItem(id);
    if (!item) return null;
    if (item.kind === "dialogue" && item.dialogue) {
      let nextSpeakers = overrides.speakers ?? item.dialogue.speakers;
      if (!overrides.speakers && overrides.voiceId) {
        const cloned = Object.assign(Object.create(null), item.dialogue.speakers);
        const names = Object.keys(cloned).filter((k) => !DANGEROUS_KEYS.has(k));
        const hasRequested =
          typeof overrides.speakerKey === "string" &&
          !DANGEROUS_KEYS.has(overrides.speakerKey) &&
          Object.hasOwn(cloned, overrides.speakerKey);
        const targetKey = hasRequested ? overrides.speakerKey : names[0];
        if (targetKey && Object.hasOwn(cloned, targetKey)) {
          cloned[targetKey] = {
            ...cloned[targetKey],
            voice_id: overrides.voiceId,
            voice_name: overrides.voiceName ?? overrides.voiceId,
          };
          nextSpeakers = cloned;
        }
      }
      return startDialogue({
        text: overrides.text ?? item.text,
        speakers: nextSpeakers,
        pauseBetweenTurns: overrides.pauseBetweenTurns ?? item.dialogue.pause_between_turns,
        exportTranscript: overrides.exportTranscript ?? item.exportTranscript,
        name: overrides.name ?? item.title,
        notes: overrides.notes ?? item.notes,
      });
    }
    if (item.kind === "voice_changer") {
      const vc = item.voiceChanger;
      if (!vc?.sourceItemId && !vc?.sourceFile && !(vc?.sourceTakeKind && vc?.sourceTakeFile)) {
        const err = new Error(
          "Original source audio is unavailable for retry — select a source clip or upload audio",
        );
        err.status = 400;
        throw err;
      }
      return startVoiceChanger({
        sourceItemId: vc.sourceItemId,
        sourceFile: vc.sourceFile,
        fileName: vc.sourceLabel,
        sourceTakeKind: vc.sourceTakeKind,
        sourceTakeFile: vc.sourceTakeFile,
        voiceId: overrides.voiceId ?? item.voiceId,
        voiceName: overrides.voiceName ?? overrides.voiceId ?? item.voiceName,
        modelId: overrides.modelId ?? item.modelId,
        removeBackgroundNoise:
          overrides.removeBackgroundNoise ?? vc.remove_background_noise ?? false,
        voiceSettings: overrides.voiceSettings ?? item.voiceSettings,
        seed: overrides.seed ?? item.seed,
        name: overrides.name ?? item.title,
        notes: overrides.notes ?? item.notes,
      });
    }
    return startTts({
      voiceId: overrides.voiceId ?? item.voiceId,
      voiceName: overrides.voiceName ?? (overrides.voiceId ? overrides.voiceId : item.voiceName),
      modelId: overrides.modelId ?? item.modelId,
      languageCode: overrides.languageCode ?? item.languageCode,
      text: overrides.text ?? item.text,
      voiceSettings: overrides.voiceSettings ?? item.voiceSettings,
      previousText: overrides.previousText ?? item.previousText,
      nextText: overrides.nextText ?? item.nextText,
      seed: overrides.seed ?? item.seed,
      outputFormat: overrides.outputFormat ?? item.outputFormat,
      applyTextNormalization: overrides.applyTextNormalization ?? item.applyTextNormalization,
      exportTranscript: overrides.exportTranscript ?? item.exportTranscript,
      name: overrides.name ?? item.title,
      notes: overrides.notes ?? item.notes,
      variations: overrides.variations ?? 1,
      fromTemplateId: item.id,
    });
  };

  const extractHistoryTasks = (data) =>
    Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data?.items) ? data.items : [];

  const fetchRemoteHistory = async ({ page = 0, pageSize = 30 } = {}) => {
    const safePage = Number.isFinite(Number(page)) ? Math.max(0, Math.trunc(Number(page))) : 0;
    const rawSize = Number(pageSize);
    const safePageSize = Number.isFinite(rawSize)
      ? Math.min(100, Math.max(1, Math.trunc(rawSize)))
      : 30;
    const safeApiBase = resolveKeyConfig().apiBase;
    let vcWarning = "";
    const [ttsRes, vcRes] = await Promise.all([
      genvoiceRequest(`/history?page_size=${safePageSize}&page=${safePage}`),
      genvoiceRequest(`/voice-changer/history?page_size=${safePageSize}&page=${safePage}`).catch(
        (err) => {
          vcWarning = err?.message || "Voice Changer history unavailable";
          return { data: { tasks: [], has_more: false } };
        },
      ),
    ]);
    const archivedByRemoteId = new Map(
      readStoreRaw()
        .filter((x) => x.remoteTaskId)
        .map((x) => [x.remoteTaskId, x.id]),
    );
    const resolveRemoteMeta = (raw, kindHint) => {
      const voiceId = String(raw?.voice_id ?? raw?.metadata?.voice_id ?? "");
      const modelId = String(
        raw?.model_id ??
          raw?.metadata?.model_id ??
          (kindHint === "voice_changer" ? "eleven_multilingual_sts_v2" : "eleven_v4"),
      );
      return {
        voiceId,
        voiceName: String(raw?.metadata?.voice_name ?? (voiceId || "Voice")),
        modelId,
        languageCode: String(raw?.metadata?.language_code ?? ""),
        voiceSettings: isPlainObject(raw?.metadata?.voice_settings)
          ? raw.metadata.voice_settings
          : {},
      };
    };

    const normalizeRemote = (raw, kindHint) => {
      const remoteSpeakers = sanitizeDialogueSpeakers(raw?.metadata?.speakers);
      const detectedKind = remoteSpeakers ? "dialogue" : kindHint;
      const meta = resolveRemoteMeta(raw, detectedKind);
      return {
        id: String(raw.id ?? raw.task_id ?? ""),
        kind: detectedKind,
        status: String(raw.status ?? "completed"),
        text: String(raw.text ?? ""),
        title: summarizeTitle(raw.text ?? "", raw.name),
        voiceId: meta.voiceId,
        voiceName: meta.voiceName,
        modelId: String(raw?.model_id ?? raw?.metadata?.model_id ?? ""),
        languageCode: meta.languageCode,
        voiceSettings: meta.voiceSettings,
        exportTranscript: Boolean(raw?.metadata?.export_transcript),
        charactersUsed: Number(raw.characters_used ?? 0),
        creditsDeducted: Number(raw.credits_deducted ?? 0),
        createdAt: String(raw.created_at ?? ""),
        audioUrl: sanitizeRemoteMediaUrl(raw?.result?.audio_url, safeApiBase),
        srtUrl: sanitizeRemoteMediaUrl(raw?.result?.srt_url, safeApiBase),
        importedItemId: archivedByRemoteId.get(String(raw.id ?? raw.task_id ?? "")) ?? null,
      };
    };
    const ttsItems = extractHistoryTasks(ttsRes.data).map((r) => normalizeRemote(r, "tts"));
    const vcItems = extractHistoryTasks(vcRes.data).map((r) => normalizeRemote(r, "voice_changer"));
    const merged = [...ttsItems, ...vcItems].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return {
      items: merged,
      hasMore: Boolean(ttsRes.data?.has_more || vcRes.data?.has_more),
      ...(vcWarning ? { warning: vcWarning } : {}),
    };
  };

  const importRemoteTask = async (taskId, kind = "tts") => {
    const cleanId = String(taskId ?? "").trim();
    if (!cleanId) throw Object.assign(new Error("taskId is required"), { status: 400 });
    if (!isSafeRemoteId(cleanId)) {
      throw Object.assign(new Error("Invalid taskId"), { status: 400 });
    }
    const existing = readStoreRaw().find((x) => x.remoteTaskId === cleanId);
    if (existing) return { item: existing, alreadyImported: true };
    if (inflightImports.has(cleanId)) return inflightImports.get(cleanId);

    const work = (async () => {
      const pollPath =
        kind === "voice_changer"
          ? `/voice-changer/history/${encodeURIComponent(cleanId)}`
          : `/history/${encodeURIComponent(cleanId)}`;
      const { data: task, cfg } = await genvoiceRequest(pollPath);
      if (task.status !== "completed" || !task?.result?.audio_url) {
        throw new Error(`Remote task ${cleanId} is not ready (${task.status ?? "unknown"})`);
      }
      const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
      const media = await archiveTaskMedia({
        audioUrl: task.result.audio_url,
        srtUrl: task?.result?.srt_url,
        apiBase: cfg.apiBase,
        idBase: id,
        outputFormat: task?.metadata?.output_format
          ? String(task.metadata.output_format)
          : undefined,
      });
      const text = String(task.text ?? `[imported] ${cleanId}`);
      const now = String(task.created_at ?? new Date().toISOString());
      const importedSpeakers = sanitizeDialogueSpeakers(task?.metadata?.speakers);
      const detectedKind = importedSpeakers ? "dialogue" : kind;
      const voiceId = String(task.voice_id ?? task?.metadata?.voice_id ?? "");
      const modelId = String(
        task.model_id ??
          task?.metadata?.model_id ??
          (detectedKind === "voice_changer" ? "eleven_multilingual_sts_v2" : "eleven_v4"),
      );
      const item = {
        id,
        kind: detectedKind,
        title: summarizeTitle(text, task.name),
        text,
        tags: extractAudioTags(text),
        voiceId,
        voiceName: String(task?.metadata?.voice_name ?? (voiceId || "Voice")),
        modelId,
        languageCode: String(task?.metadata?.language_code ?? ""),
        voiceSettings: isPlainObject(task?.metadata?.voice_settings)
          ? task.metadata.voice_settings
          : {},
        ...(task?.metadata?.previous_text
          ? { previousText: String(task.metadata.previous_text) }
          : {}),
        ...(task?.metadata?.next_text ? { nextText: String(task.metadata.next_text) } : {}),
        ...(typeof task?.metadata?.seed === "number" && Number.isFinite(task.metadata.seed)
          ? { seed: task.metadata.seed }
          : {}),
        ...(task?.metadata?.output_format
          ? { outputFormat: String(task.metadata.output_format) }
          : {}),
        ...(task?.metadata?.apply_text_normalization === "on" ||
        task?.metadata?.apply_text_normalization === "off" ||
        task?.metadata?.apply_text_normalization === "auto"
          ? { applyTextNormalization: task.metadata.apply_text_normalization }
          : {}),
        exportTranscript: Boolean(task?.metadata?.export_transcript),
        ...(importedSpeakers
          ? {
              dialogue: {
                pause_between_turns: clampNum(task?.metadata?.pause_between_turns, 0, 3) ?? 0.5,
                speakers: importedSpeakers,
              },
            }
          : {}),
        ...(detectedKind === "voice_changer"
          ? {
              voiceChanger: {
                sourceLabel: String(task?.metadata?.source_label ?? "GenVoice Cloud"),
                remove_background_noise: Boolean(
                  task?.metadata?.remove_noise ?? task?.metadata?.remove_background_noise,
                ),
              },
            }
          : {}),
        ...media,
        remoteTaskId: cleanId,
        charactersUsed: Number(task.characters_used ?? 0),
        creditsDeducted: Number(task.credits_deducted ?? 0),
        provider: "elevenlabs",
        favorite: false,
        isTemplate: false,
        createdAt: now,
        updatedAt: new Date().toISOString(),
      };
      let raceWinner = null;
      await mutateStore((items) => {
        const dup = items.find((x) => x.remoteTaskId === cleanId);
        if (dup) {
          raceWinner = dup;
          return;
        }
        items.unshift(item);
      });
      if (raceWinner) {
        if (media.audioFile && existsSync(audioDir)) {
          rmSync(join(audioDir, media.audioFile), { force: true });
        }
        if (media.srtFile && existsSync(srtDir)) {
          rmSync(join(srtDir, media.srtFile), { force: true });
        }
        return { item: raceWinner, alreadyImported: true };
      }
      emit({ type: "item", item });
      return { item, alreadyImported: false };
    })();

    inflightImports.set(cleanId, work);
    try {
      return await work;
    } finally {
      inflightImports.delete(cleanId);
    }
  };

  const promoteToFilmTake = async ({ itemId, takeId }) => {
    if (!opts.voice) return { error: "Film voiceover folder unavailable", status: 404 };
    if (!TAKE_ID.test(String(takeId ?? ""))) return { error: "Invalid takeId", status: 400 };
    const item = getItem(itemId);
    if (!item?.audioFile || !SAFE_MEDIA_FILE.test(item.audioFile)) {
      return { error: "Playground item audio not found", status: 404 };
    }
    const realAudio = existsSync(audioDir) ? realpathSync(audioDir) : null;
    const src = realAudio ? join(realAudio, item.audioFile) : "";
    if (
      !realAudio ||
      !inside(realAudio, src) ||
      !existsSync(src) ||
      lstatSync(src).isSymbolicLink()
    ) {
      return { error: "Playground audio file unavailable", status: 404 };
    }
    const tryDir = opts.voice.TRY_DIR;
    mkdirSync(tryDir, { recursive: true });
    if (lstatSync(tryDir).isSymbolicLink()) {
      return { error: "Film try folder cannot be a symlink", status: 400 };
    }
    const rawExt = extname(item.audioFile).toLowerCase();
    const directAudio = rawExt === ".mp3" || rawExt === ".wav";
    const ext = directAudio ? rawExt : ".wav";
    const safeSlug = item.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    const tryFile = `${takeId}_${safeSlug}${ext}`;
    const dest = join(realpathSync(tryDir), tryFile);
    if (!inside(realpathSync(tryDir), dest))
      return { error: "Unsafe target try filename", status: 400 };
    const part = `${dest}.${nextTmp()}.part`;
    try {
      if (directAudio) {
        copyFileSync(src, part);
      } else {
        const ok = await runFfmpeg([
          "-v",
          "error",
          "-y",
          "-i",
          src,
          "-f",
          "wav",
          "-acodec",
          "pcm_s16le",
          "-ar",
          "44100",
          part,
        ]);
        if (!ok) {
          return { error: "Only MP3/WAV clips can be promoted without ffmpeg", status: 422 };
        }
      }
      renameSync(part, dest);
    } finally {
      rmSync(part, { force: true });
    }
    const updated = await mutateStore((items) => {
      const idx = items.findIndex((x) => x.id === itemId);
      if (idx < 0) return null;
      items[idx] = { ...items[idx], sourceTakeId: takeId, updatedAt: new Date().toISOString() };
      return items[idx];
    });
    if (updated) emit({ type: "item", item: updated });
    opts.onVoiceChanged?.();
    return { ok: true, takeId, tryFile };
  };

  const safeMediaPath = (kind, rawFile) => {
    const file = typeof rawFile === "string" ? rawFile : "";
    if (kind === "audio" && !SAFE_MEDIA_FILE.test(file)) return null;
    if (kind === "srt" && !SAFE_SRT_FILE.test(file)) return null;
    const dir = kind === "audio" ? audioDir : srtDir;
    if (!existsSync(dir)) return null;
    try {
      if (lstatSync(dir).isSymbolicLink()) return null;
      const realBase = realpathSync(dir);
      const target = join(dir, file);
      if (!existsSync(target) || lstatSync(target).isSymbolicLink()) return null;
      const realTarget = realpathSync(target);
      return inside(realBase, realTarget) ? realTarget : null;
    } catch {
      return null;
    }
  };

  const waitForAllJobs = () => Promise.allSettled(pendingPromises);

  return {
    storageDir,
    getStatus,
    setConfig,
    getCatalog,
    searchSharedVoices,
    listItems,
    listJobs,
    getItem,
    startTts,
    startDialogue,
    startVoiceChanger,
    runSpeechToText,
    patchItem,
    deleteItem,
    retryItem,
    fetchRemoteHistory,
    importRemoteTask,
    promoteToFilmTake,
    audioFile: (file) => safeMediaPath("audio", file),
    srtFile: (file) => safeMediaPath("srt", file),
    waitForAllJobs,
  };
};
