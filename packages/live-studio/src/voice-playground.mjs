import { createHash, randomUUID } from "node:crypto";
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
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_VOICE_FILTERS, filterAndSortVoices } from "../app/sound/voice-library-view.ts";
import { sanitizeError } from "./voice-library.mjs";
import { TAKE_ID } from "./voice-map.mjs";
import { openSharedArchive } from "./voice-playground-archive.mjs";
import {
  findFavoriteVoices,
  matchesCastingVoice,
  voiceIdentity,
} from "./voice-playground-casting.mjs";
import { createPlaygroundClones } from "./voice-playground-clones.mjs";
import { openDirectVoiceConnections } from "./voice-playground-connections.mjs";
import {
  PlaygroundTts,
  PlaygroundTtsBatch,
  PlaygroundTtsRecipe,
  speechBatchEntries,
} from "./voice-playground-contract.ts";
import {
  SAFE_DUBBING_SOURCE_FILE,
  SAFE_DUBBING_VIDEO_FILE,
} from "./voice-playground-dubbing-contract.ts";
import { downloadDubbingFile } from "./voice-playground-dubbing-download.mjs";
import { createPlaygroundDubbing } from "./voice-playground-dubbing.mjs";
import { createPlaygroundEditing } from "./voice-playground-editing.mjs";
import {
  assertGenVoiceTaskIdentity,
  assertSafeMediaUrl,
  audioDurationFromFile,
  audioMimeForExt,
  BUILTIN_GENVOICE_MODELS,
  BUILTIN_LANGUAGES,
  clampNum,
  containerHasAudio,
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
  sniffContainerMagic,
  stripDialogueSpeakerBrackets,
  summarizeTitle,
  wrapPcm16ToWav,
  writeAtomic,
} from "./voice-playground-genvoice.mjs";
import { createPlaygroundLibrary } from "./voice-playground-library.mjs";
import {
  defaultProviderModel,
  providerForModel,
  resolveProviderLanguage,
} from "./voice-playground-providers.mjs";
import {
  findVoiceRecordings,
  parseSrtCues,
  rankVoiceUsage,
} from "./voice-playground-recordings.mjs";
import { probeAudioDuration, probeAudioMedia } from "./voice-playground-region.mjs";
import {
  recordingTemplateDraft,
  voiceTemplateRecipe,
} from "./voice-playground-template-recipe.mjs";
import {
  estimateSpeechModelCredits,
  genVoiceTaskChargeSource,
  hasProvisionalGenVoiceCharge,
  isUnverifiedCloudSpeech,
  recordingAudioFiles,
  recordingRootId,
  recordingWords,
  withChargeEvidence,
} from "./voice-playground-text.mjs";
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
  const scope = opts.scope ?? "project";
  const globalDir = resolve(
    opts.globalDir ??
      (opts.dir
        ? join(opts.dir, "global")
        : fileURLToPath(new URL("../../../voice/playground", import.meta.url))),
  );
  let sharedArchive;
  const shared = () => (sharedArchive ??= openSharedArchive(globalDir, { migrateItems: true }));
  let projectArchive;
  const metadata = () =>
    scope === "global" ? shared() : (projectArchive ??= openSharedArchive(storageDir));
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
    (scope === "global" ? globalDir : opts.dir) ??
      (opts.project
        ? join(resolve(opts.project), "voice", "playground")
        : join(homedir(), ".cache", "mc-films", "voice-playground")),
  );
  const audioDir = join(storageDir, "audio");
  const srtDir = join(storageDir, "srt");
  const sourcesDir = join(storageDir, "sources");
  const itemsFile = join(storageDir, "items.json");
  const archiveFile = join(storageDir, "archive.sqlite");
  const speechFile = join(storageDir, "speech-jobs.sqlite");
  let speechArchive;
  const speechLedger = () => {
    if (speechArchive) return speechArchive;
    const initialCollections =
      !existsSync(speechFile) && existsSync(archiveFile)
        ? {
            "speech-runs": metadata().list("speech-runs"),
            "speech-receipts": metadata().list("speech-receipts"),
          }
        : {};
    return (speechArchive = openSharedArchive(storageDir, {
      fileName: basename(speechFile),
      initialCollections,
    }));
  };
  const originProject = opts.project ? basename(resolve(opts.project)) : undefined;

  let closed = false;
  const jobs = new Map();
  const pendingPromises = new Set();
  const jobPromises = new Map();
  const inflightImports = new Map();
  const activeSourceRefs = new Map();
  const archiveRetentionMs = 30 * 24 * 60 * 60 * 1000;
  let archiveTimer;

  const emit = (payload) => {
    try {
      opts.onEvent?.({
        ...payload,
        ...(payload.item ? { item: { ...withChargeEvidence(payload.item), scope } } : {}),
        scope,
      });
    } catch {
      /* ignore SSE listener errors */
    }
  };

  const {
    resolveKeyConfig,
    genvoiceRequest,
    fetchAccount,
    getStatus: getGenvoiceStatus,
    setConfig: setGenvoiceConfig,
    getCatalog: getGenvoiceCatalog,
    searchSharedVoices: searchGenvoiceVoices,
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
  const directConnections = openDirectVoiceConnections({
    env,
    fetchImpl,
    configFile: `${configFile}.connections.json`,
  });
  const getStatus = async ({ live, connection = "genvoice" } = {}) => {
    const status = await getGenvoiceStatus({ live: live && connection === "genvoice" });
    const connections = directConnections.connectionStatus();
    if (live && connection !== "genvoice") {
      try {
        await directConnections.verifyConnection(connection);
        connections[connection].verified = true;
      } catch (err) {
        connections[connection].error = err.message;
      }
    }
    return { ...status, connections };
  };
  const setConfig = async (options = {}) => {
    if (options.connection && options.connection !== "genvoice") {
      await directConnections.setConnection(options.connection, options);
      return getStatus();
    }
    return {
      ...(await setGenvoiceConfig(options)),
      connections: directConnections.connectionStatus(),
    };
  };
  const getCatalog = async ({ connection = "genvoice", ...options } = {}) =>
    connection === "genvoice"
      ? getGenvoiceCatalog(options)
      : directConnections.getCatalog(connection, options);
  const searchSharedVoices = ({ connection = "genvoice", ...query } = {}) =>
    connection === "genvoice"
      ? searchGenvoiceVoices(query)
      : directConnections.searchVoices(connection, query);
  const searchCastingVoices = async (query = {}) => {
    if (query.connection && query.connection !== "genvoice") return searchSharedVoices(query);
    if (query.pageToken)
      throw Object.assign(new Error("For GenVoice use page and follow nextPage."), { status: 400 });
    const {
      page: firstPage = 0,
      scanPages = 1,
      creatorId,
      favoriteCreatorsOnly,
      descriptive,
      category,
    } = query;
    const creatorIds = new Set(
      favoriteCreatorsOnly ? library.listCreatorFavorites().map(({ id }) => id) : [],
    );
    if (favoriteCreatorsOnly && (!creatorIds.size || (creatorId && !creatorIds.has(creatorId))))
      return { voices: [], hasMore: false, nextPage: null, pagesScanned: 0 };
    const result = new Map();
    let page = firstPage;
    let hasMore;
    let total;
    do {
      const received = await searchGenvoiceVoices({ ...query, page });
      for (const voice of received.voices) {
        if (
          matchesCastingVoice(
            voice,
            { creatorId, favoriteCreatorsOnly, descriptive, category },
            creatorIds,
          )
        )
          result.set(voiceIdentity(voice), voice);
      }
      hasMore = received.hasMore;
      total = received.total;
      page++;
    } while (hasMore && page - firstPage < scanPages);
    return {
      voices: [...result.values()],
      hasMore,
      nextPage: hasMore ? page : null,
      pagesScanned: page - firstPage,
      ...(!creatorId && !favoriteCreatorsOnly && !descriptive && !category && total !== undefined
        ? { total }
        : {}),
    };
  };
  const searchCachedVoices = ({
    q = "",
    useCase = "all",
    page = 0,
    pageSize = 30,
    creatorId,
    favoriteCreatorsOnly,
    ...filters
  } = {}) => {
    const all = opts.cachedVoices?.() ?? [];
    const stars = cloning
      .listVoiceFavorites()
      .filter((voice) => !voice.connection || voice.connection === "genvoice");
    const effects = stars
      .filter((voice) => voice.provider === "elevenlabs")
      .map((voice) => `voice:${voice.id}`);
    const creatorIds = new Set(library.listCreatorFavorites().map(({ id }) => id));
    const matches = filterAndSortVoices(
      all,
      useCase,
      q,
      { ...DEFAULT_VOICE_FILTERS, ...filters },
      effects,
    ).filter((voice) =>
      matchesCastingVoice(voice, { creatorId, favoriteCreatorsOnly }, creatorIds),
    );
    const offset = page * pageSize;
    return {
      voices: matches.slice(offset, offset + pageSize),
      total: matches.length,
      page,
      pageSize,
      hasMore: offset + pageSize < matches.length,
      cachedVoices: all.length,
    };
  };
  const readVoicePreview = async (previewUrl) => {
    const maxBytes = 16 * 1024 * 1024;
    if (!previewUrl.startsWith("/api/voice/playground/audio/"))
      return (
        await downloadMediaWithRedirects(
          previewUrl,
          maxBytes,
          "Voice preview",
          resolveKeyConfig().apiBase,
        )
      ).bytes;
    const url = new URL(previewUrl, "http://localhost");
    const file = forScope(url.searchParams.get("scope")).audioFile(basename(url.pathname));
    if (!file || statSync(file).size > maxBytes)
      throw Object.assign(new Error("Saved preview is unavailable or too large"), { status: 404 });
    return Bun.file(file).bytes();
  };
  const downloadVoicePreview = async ({ previewUrl }) => {
    const bytes = await readVoicePreview(previewUrl);
    const extension = sniffContainerMagic(bytes);
    if (!extension || !(await containerHasAudio(extension, bytes)))
      throw Object.assign(new Error("Voice preview is not an audio file"), { status: 502 });
    return { bytes, mimeType: audioMimeForExt(extension) };
  };

  const readStoreRaw = () => {
    if (scope === "global")
      return shared()
        .list("items")
        .map((item) => ({ ...item, scope }));
    if (!existsSync(itemsFile)) return [];
    try {
      if (lstatSync(itemsFile).isSymbolicLink()) return [];
      const parsed = JSON.parse(readFileSync(itemsFile, "utf8"));
      return Array.isArray(parsed?.items)
        ? parsed.items.map((item) => ({ originProject, ...item, scope }))
        : [];
    } catch {
      return [];
    }
  };
  const hasArchiveIndex = () =>
    scope === "global" ? existsSync(archiveFile) && shared().has("items") : existsSync(itemsFile);

  const writeStoreRaw = (items) => {
    mkdirSync(audioDir, { recursive: true });
    mkdirSync(srtDir, { recursive: true });
    writeAtomic(itemsFile, JSON.stringify({ version: 1, items }, null, 2));
  };

  const mutateStore = (fn) => {
    if (scope === "global")
      return shared().mutate("items", (items) => {
        const existing = new Set(items.map(({ id }) => id));
        const result = fn(items);
        for (const item of items) {
          if (!existing.has(item.id)) {
            item.retentionTracked = true;
            item.originProject ??= originProject;
          }
        }
        return result;
      });
    return metadata().write(() => {
      const items = readStoreRaw();
      const res = fn(items);
      writeStoreRaw(items);
      return res;
    });
  };

  const reportedGenVoiceCredits = (value, source) =>
    Number.isFinite(value) && value >= 0
      ? {
          creditsDeducted: value,
          creditsReported: true,
          ...(source ? { creditsSource: source } : {}),
        }
      : {};
  const listItems = ({ includeGlobal = false, includeArchived = false, archived = false } = {}) => [
    ...readStoreRaw()
      .filter((item) => includeArchived || Boolean(item.archivedAt) === archived)
      .map(withChargeEvidence),
    ...(includeGlobal && scope === "project"
      ? forScope("global").listItems({ includeArchived, archived })
      : []),
  ];

  const listJobs = ({ includeGlobal = false } = {}) =>
    [
      ...listSpeechJobs(),
      ...[...jobs.values()].filter((job) => job.kind !== "tts"),
      ...(includeGlobal && scope === "project" ? forScope("global").listJobs() : []),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const getItem = (id) => withChargeEvidence(readStoreRaw().find((x) => x.id === id) ?? null);

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

  const sourceIsReferenced = (sf, itemsList) =>
    Array.from(activeSourceRefs.values()).includes(sf) ||
    itemsList.some(
      (x) => x.voiceChanger?.sourceFile === sf || x.transcription?.sourceFile === sf,
    ) ||
    metadata()
      .list("templates")
      .some(
        (template) => template.draft?.vcSourceFile === sf || template.draft?.sttSourceFile === sf,
      );
  const ownedMediaFile = (folder, file, pattern) => {
    if (!file || !pattern.test(file)) return null;
    const dir = join(storageDir, folder);
    if (!existsSync(dir)) return null;
    const realDir = realpathSync(dir);
    if (
      lstatSync(storageDir).isSymbolicLink() ||
      lstatSync(dir).isSymbolicLink() ||
      !inside(realpathSync(storageDir), realDir)
    ) {
      throw new Error("Playground media folder points outside its library");
    }
    const target = join(realDir, file);
    if (!existsSync(target)) return null;
    if (!lstatSync(target).isFile() || !inside(realDir, realpathSync(target)))
      throw new Error("Playground media is not owned by its library");
    return target;
  };
  const removeSourceFileIfUnused = (sf, itemsList = readStoreRaw()) => {
    if (!sf || !SAFE_MEDIA_FILE.test(sf) || !existsSync(sourcesDir)) return;
    if (sourceIsReferenced(sf, itemsList)) return;
    const target = ownedMediaFile("sources", sf, SAFE_MEDIA_FILE);
    if (target) rmSync(target, { force: true });
  };

  const writeArchivedAudio = (idBase, ext, bytes) => {
    const realAudio = ensureSafeDir(audioDir);
    const audioFile = `${idBase}${ext}`;
    const target = join(realAudio, audioFile);
    if (!SAFE_MEDIA_FILE.test(audioFile) || !inside(realAudio, target))
      throw new Error("Unsafe audio target filename");
    writeAtomic(target, bytes);
    return {
      audioFile,
      mimeType: audioMimeForExt(ext),
      bytes: bytes.byteLength,
      durationSeconds: audioDurationFromFile(target),
    };
  };
  const archiveAudio = async (idBase, ext, bytes) => {
    const audio = writeArchivedAudio(idBase, ext, bytes);
    if (!audio.durationSeconds && ext === ".ogg") {
      audio.durationSeconds = await probeAudioDuration(join(audioDir, audio.audioFile)).catch(
        () => 0,
      );
    }
    return audio;
  };

  const isBinaryPcm = (bytes, contentType = "") => {
    if (
      !bytes.byteLength ||
      bytes.byteLength % 2 ||
      /^(?:text\/|application\/(?:json|xml)\b)/i.test(contentType)
    )
      return false;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 4096), {
        stream: true,
      });
      return /\p{Cc}/u.test(text.replace(/[\t\r\n]/g, ""));
    } catch {
      return true;
    }
  };
  const invalidTaskAudio = () =>
    Object.assign(new Error("GenVoice did not return audio for this task"), { status: 502 });

  const downloadSrtText = async (url, apiBase, signal) => {
    const srt = await downloadMediaWithRedirects(
      url,
      MAX_SRT_BYTES,
      "GenVoice SRT",
      apiBase,
      lookupFn,
      signal,
    );
    const text = srt.bytes.toString("utf8");
    if (!parseSrtCues(text).length) throw new Error("GenVoice returned invalid SRT captions");
    return text;
  };
  const writeArchivedSrt = (id, text) => {
    const dir = ensureSafeDir(srtDir);
    const file = `${id}.srt`;
    if (!SAFE_SRT_FILE.test(file)) throw new Error("Unsafe subtitle filename");
    writeAtomic(join(dir, file), text);
    return file;
  };
  const archiveTaskMedia = async ({
    audioUrl,
    srtUrl,
    apiBase,
    idBase,
    outputFormat,
    allowProvisionalPcm = false,
    signal,
  }) => {
    const downloaded = await downloadMediaWithRedirects(
      audioUrl,
      MAX_AUDIO_BYTES,
      "GenVoice audio",
      apiBase,
      lookupFn,
      signal,
    );
    let audioBytes = downloaded.bytes;
    let ext = sniffContainerMagic(audioBytes);
    const rate = /^pcm_(\d+)$/.exec(outputFormat ?? "");
    const contentIsPcm = /audio\/(?:pcm|l16)\b/i.test(downloaded.contentType);
    const canBePcm = rate || allowProvisionalPcm;
    const claimsPcm = ext === ".mp3" && contentIsPcm && canBePcm;
    const validContainer = !claimsPcm && (await containerHasAudio(ext, audioBytes, signal));
    let pcmFormatPending = false;
    if (!validContainer) {
      const possiblePcm =
        !ext ||
        (ext === ".mp3" &&
          (contentIsPcm ||
            !downloaded.contentType ||
            downloaded.contentType.startsWith("application/octet-stream")));
      if (!possiblePcm || !canBePcm || !isBinaryPcm(audioBytes, downloaded.contentType))
        throw invalidTaskAudio();
      if (rate) {
        audioBytes = wrapPcm16ToWav(audioBytes, Number(rate[1]));
        ext = ".wav";
      } else {
        ext = extFromDownload(downloaded.url, downloaded.contentType, audioBytes);
        pcmFormatPending = true;
      }
    }
    let srtText;
    if (srtUrl) {
      try {
        srtText = await downloadSrtText(srtUrl, apiBase, signal);
      } catch {
        /* keep generation usable even if optional SRT fails */
      }
    }
    signal?.throwIfAborted();
    const audio = await archiveAudio(idBase, ext, audioBytes);
    const srtFile = srtText && writeArchivedSrt(idBase, srtText);
    return {
      ...audio,
      srtFile,
      srtText,
      ...(pcmFormatPending ? { pcmFormatPending } : {}),
      ...(srtUrl && !srtFile ? { srtPending: true } : {}),
    };
  };

  const pruneJobs = () => {
    if (jobs.size <= 40) return;
    for (const [id, entry] of jobs) {
      if (entry.status === "completed" || entry.status === "failed") {
        jobs.delete(id);
        jobPromises.delete(id);
        if (jobs.size <= 40) break;
      }
    }
  };

  const trackJob = (job, runner, speechRunId) => {
    pruneJobs();
    jobs.set(job.id, job);
    emit({ type: "job", job: { ...job } });
    const p = (async () => {
      try {
        const item = await runner();
        job.finishedAt = new Date().toISOString();
        job.status = "completed";
        job.progress = 100;
        if (job.kind === "stt") {
          job.result = item;
          job.itemId = item.item?.id;
        } else job.itemId = item.id;
        if (speechRunId) {
          storeSpeechRunJob(speechRunId, job);
          if (job.generationRecipe && job.remoteTaskId) clearSpeechReceipt(job.remoteTaskId);
        }
        emit({ type: "job", job: { ...job } });
        if (job.kind !== "stt") emit({ type: "item", item });
        if (!job.connection || job.connection === "genvoice") {
          fetchAccount()
            .then((account) => emit({ type: "account", account }))
            .catch(() => {});
        }
        return item;
      } catch (err) {
        job.finishedAt = new Date().toISOString();
        job.status = "failed";
        job.error = err.message;
        if (speechRunId) storeSpeechRunJob(speechRunId, job);
        emit({ type: "job", job: { ...job } });
        throw err;
      } finally {
        pendingPromises.delete(p);
      }
    })();
    p.catch(() => {});
    pendingPromises.add(p);
    jobPromises.set(job.id, p);
    return job;
  };

  const prepareTts = async (input, suppliedCatalog) => {
    const connection = input.connection ?? "genvoice";
    const genvoice = connection === "genvoice";
    if (genvoice && !resolveKeyConfig().apiKey) throw new Error("Missing GenVoice API key");
    if (genvoice && input.speechStyle?.trim())
      throw Object.assign(new Error("Speech direction is only supported by Google Gemini"), {
        status: 400,
      });
    const voiceId = String(input.voiceId ?? "").trim();
    const writtenText = String(input.text ?? "");
    const text = writtenText.trim();
    if (!voiceId) throw Object.assign(new Error("voiceId is required"), { status: 400 });
    if (!isSafeRemoteId(voiceId))
      throw Object.assign(new Error("Invalid voiceId"), { status: 400 });
    if (!text) throw Object.assign(new Error("text is required"), { status: 400 });

    const provider = genvoice ? (input.provider ?? providerForModel(input.modelId)) : connection;
    if (genvoice) cloning.assertCloneAvailable(provider, voiceId);
    const modelId = genvoice
      ? String(input.modelId ?? defaultProviderModel(provider)).trim() ||
        defaultProviderModel(provider)
      : directConnections.prepareSpeech(connection, { ...input, voiceId });
    if (genvoice && providerForModel(modelId) !== provider)
      throw Object.assign(new Error("The selected model does not belong to this voice provider"), {
        status: 400,
      });
    if (
      genvoice &&
      provider !== "elevenlabs" &&
      (input.seed !== undefined ||
        input.previousText?.trim() ||
        input.nextText?.trim() ||
        input.outputFormat?.trim() ||
        (input.applyTextNormalization && input.applyTextNormalization !== "auto"))
    )
      throw Object.assign(
        new Error(
          "Seed, context, output format and text normalization are not verified for this provider",
        ),
        { status: 400 },
      );
    const speechCatalog = genvoice ? (suppliedCatalog ?? (await getGenvoiceCatalog())) : undefined;
    const modelMeta = genvoice ? await resolveModelMeta(modelId, speechCatalog) : undefined;
    if (genvoice) {
      const fail = (message) => {
        throw Object.assign(new Error(message), { status: 400 });
      };
      if (modelMeta?.model_id !== modelId) fail(`Unknown model: ${modelId}`);
      if (modelMeta.can_do_text_to_speech === false) fail("This model does not support Speech");
      if (
        modelMeta.maximum_text_length_per_request &&
        text.length > modelMeta.maximum_text_length_per_request
      )
        fail(`The script exceeds ${modelMeta.maximum_text_length_per_request} characters`);
    }
    const preserveSettings = genvoice && input.preserveSettings === true;
    const voiceSettings = genvoice
      ? preserveSettings
        ? (PlaygroundTts.shape.voiceSettings.parse(input.voiceSettings) ?? {})
        : sanitizeVoiceSettings(input.voiceSettings, modelMeta, provider)
      : directConnections.speechSettings(connection, modelId, input.voiceSettings);
    const requestedLanguage = input.languageCode?.trim() || detectTextLanguage(text);
    const languageCode = genvoice
      ? resolveProviderLanguage(provider, requestedLanguage, speechCatalog, modelMeta)
      : connection === "google" || modelId === "eleven_multilingual_v2"
        ? "auto"
        : requestedLanguage;
    const speechStyle = connection === "google" ? input.speechStyle?.trim() : undefined;
    const exportTranscript = Boolean(input.exportTranscript);
    const previousText =
      (preserveSettings || modelMeta?.supports_context !== false) &&
      typeof input.previousText === "string"
        ? input.previousText.trim().slice(0, 5000)
        : "";
    const nextText =
      (preserveSettings || modelMeta?.supports_context !== false) &&
      typeof input.nextText === "string"
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
    return {
      input,
      connection,
      genvoice,
      voiceId,
      text,
      writtenText,
      provider,
      modelId,
      modelMeta,
      voiceSettings,
      languageCode,
      speechStyle,
      exportTranscript,
      previousText,
      nextText,
      seed,
      outputFormat,
      applyTextNormalization,
      preserveSettings,
      voiceName,
      variations,
      baseTitle,
    };
  };

  const ttsRecipeFields = (recipe) => ({
    kind: "tts",
    cloudImported: false,
    generationRecipe: recipe,
    cloudRecipeUnverified: false,
    connection: "genvoice",
    text: recipe.requested.text,
    ...(recipe.requested.creatorId ? { creatorId: recipe.requested.creatorId } : {}),
    voiceId: recipe.requested.voiceId,
    voiceName: recipe.requested.voiceName || recipe.requested.voiceId,
    voiceGender: recipe.requested.voiceGender,
    voicePreviewUrl: recipe.requested.voicePreviewUrl,
    modelId: recipe.effective.body.model_id,
    provider: recipe.effective.body.provider,
    languageCode: recipe.effective.body.language_code ?? "",
    voiceSettings: recipe.effective.body.voice_settings ?? {},
    previousText: recipe.effective.body.previous_text,
    nextText: recipe.effective.body.next_text,
    seed: recipe.effective.body.seed,
    outputFormat: recipe.effective.body.output_format,
    applyTextNormalization: recipe.effective.body.apply_text_normalization,
    exportTranscript: Boolean(recipe.effective.body.export_transcript),
    fromTemplateId: recipe.requested.fromTemplateId,
    sourceTakeId: recipe.requested.sourceTakeId,
  });
  const needsSpeechRecipe = (item) =>
    isUnverifiedCloudSpeech(item) || (item.cloudImported && item.kind === "dialogue");
  const restoreSpeechRecipe = (item, recipe) => ({
    ...item,
    ...(item.kind === "tts"
      ? {}
      : { dialogue: undefined, voiceChanger: undefined, retry: undefined }),
    ...ttsRecipeFields(recipe),
  });
  const restorePcmAudio = (item, recipe) => {
    const rate = /^pcm_(\d+)$/.exec(recipe.effective.body.output_format ?? "");
    if (!rate) return {};
    const source = ownedMediaFile("audio", item.audioFile, SAFE_MEDIA_FILE);
    if (!source) return {};
    const bytes = readCheckedFileBytes(
      source,
      MAX_AUDIO_BYTES,
      "Archived audio exceeds size limit",
    );
    if (sniffContainerMagic(bytes) && !item.pcmFormatPending) return {};
    if (!isBinaryPcm(bytes)) return {};
    return {
      ...writeArchivedAudio("pg_" + randomUUID(), ".wav", wrapPcm16ToWav(bytes, Number(rate[1]))),
      pcmFormatPending: undefined,
      replacedAudioFiles: recordingAudioFiles(item),
    };
  };
  const storeSpeechReceipt = (job) =>
    speechLedger().mutate("speech-receipts", (receipts) => {
      const index = receipts.findIndex((receipt) => receipt.remoteTaskId === job.remoteTaskId);
      const saved = {
        ...receipts[index],
        jobId: job.id,
        remoteTaskId: job.remoteTaskId,
        generationRecipe: job.generationRecipe,
        title: job.title ?? receipts[index]?.title,
        batch: job.batch,
        ...(receipts[index]?.creditsSource === "history" && hasProvisionalGenVoiceCharge(job)
          ? {}
          : reportedGenVoiceCredits(job.creditsDeducted, job.creditsSource)),
      };
      if (index < 0) receipts.push(saved);
      else receipts[index] = saved;
    });
  const clearSpeechReceipt = (remoteTaskId) =>
    speechLedger().mutate("speech-receipts", (receipts) => {
      const index = receipts.findIndex((receipt) => receipt.remoteTaskId === remoteTaskId);
      if (index >= 0) receipts.splice(index, 1);
    });
  const cloudOrigin = (items, taskId) =>
    items.find((item) => item.remoteTaskId === taskId && !item.copiedFrom && !item.version);
  const cloudArchiveItem = (items, taskId) =>
    cloudOrigin(items, taskId) ??
    items.find((item) => item.remoteTaskId === taskId && !item.version);
  const savedSpeechJobs = () => {
    const receipts = new Map(
      speechLedger()
        .list("speech-receipts")
        .map((row) => [row.jobId, row]),
    );
    const recordings = new Map();
    for (const item of readStoreRaw()) {
      if (item.kind === "tts" && !item.version && !item.copiedFrom && item.remoteTaskId) {
        recordings.set(item.id, item);
        if (item.generationJobId) recordings.set(item.generationJobId, item);
      }
    }
    return { receipts, recordings };
  };
  const getSpeechReceipt = (jobId, saved = savedSpeechJobs()) => {
    const receipt = saved.receipts.get(jobId);
    const recording = saved.recordings.get(jobId);
    if (!recording) return receipt ?? null;
    const archivedCharge = withChargeEvidence(recording);
    const charge =
      receipt?.creditsSource === "history" ||
      (receipt?.creditsSource === "processing" && hasProvisionalGenVoiceCharge(archivedCharge)) ||
      !Number.isFinite(archivedCharge.creditsDeducted)
        ? receipt
        : archivedCharge;
    return {
      ...receipt,
      jobId,
      remoteTaskId: recording.remoteTaskId,
      itemId: recording.id,
      batch: recording.batch,
      generationRecipe: recording.generationRecipe ?? receipt?.generationRecipe,
      ...reportedGenVoiceCredits(charge?.creditsDeducted, charge?.creditsSource),
    };
  };

  const createSpeechJobs = (prepared, batch) => {
    const {
      input,
      connection,
      genvoice,
      voiceId,
      text,
      writtenText,
      provider,
      modelId,
      voiceSettings,
      languageCode,
      speechStyle,
      exportTranscript,
      previousText,
      nextText,
      seed,
      outputFormat,
      applyTextNormalization,
      preserveSettings,
      voiceName,
      variations,
      baseTitle,
    } = prepared;
    const createdJobs = [];
    for (let idx = 0; idx < variations; idx++) {
      const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
      const title = variations > 1 ? `${baseTitle} (${idx + 1}/${variations})` : baseTitle;
      const itemSeed =
        seed !== undefined && variations > 1 ? Math.min(4294967295, seed + idx) : seed;
      const requestedRecipe = genvoice
        ? {
            ...PlaygroundTts.parse(input),
            connection,
            provider,
            modelId,
          }
        : undefined;
      const batchEntry = batch && { ...batch, variationIndex: idx };
      const job = {
        id,
        kind: "tts",
        connection,
        ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
        status: "pending",
        ...(batchEntry ? { batch: batchEntry } : {}),
        progress: 0,
        title,
        voiceId,
        voiceName,
        modelId,
        createdAt: new Date().toISOString(),
      };
      const run = async () => {
        let usedFallback = false;
        let media;
        let upstream;
        let generationRecipe;
        if (!genvoice) {
          const { bytes, ext, ...details } = await directConnections.renderSpeech(connection, {
            voiceId,
            text,
            modelId,
            languageCode: languageCode === "auto" ? undefined : languageCode,
            voiceSettings,
            speechStyle,
            previousText,
            nextText,
            seed: itemSeed,
            outputFormat,
            applyTextNormalization,
            exportTranscript,
          });
          media = await archiveAudio(id, ext, bytes);
          upstream = details;
        } else {
          const body = {
            text,
            model_id: modelId,
            provider,
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
          let created;
          let effective = body;
          try {
            ({ data: created } = await genvoiceRequest(
              `/text-to-speech/${encodeURIComponent(voiceId)}`,
              { method: "POST", body: JSON.stringify(body) },
            ));
          } catch (err) {
            if (
              !preserveSettings &&
              hasPassthrough &&
              (err?.status === 400 || err?.status === 422)
            ) {
              usedFallback = true;
              effective = {
                text,
                model_id: modelId,
                provider,
                language_code: languageCode,
                voice_settings: voiceSettings,
                ...(exportTranscript && { export_transcript: true }),
              };
              ({ data: created } = await genvoiceRequest(
                `/text-to-speech/${encodeURIComponent(voiceId)}`,
                { method: "POST", body: JSON.stringify(effective) },
              ));
            } else {
              throw err;
            }
          }
          const taskId = String(created.id ?? created.task_id ?? "");
          if (!taskId) throw new Error("GenVoice TTS response missing task id");
          job.remoteTaskId = taskId;
          Object.assign(job, reportedGenVoiceCredits(created.credits_deducted, "acknowledgement"));
          generationRecipe = {
            version: 1,
            requested: requestedRecipe,
            effective: { path: `/text-to-speech/${encodeURIComponent(voiceId)}`, body: effective },
          };
          job.generationRecipe = generationRecipe;
          storeSpeechReceipt(job);
          emit({ type: "job", job: { ...job } });
          const { data: task, cfg: pollCfg } = await pollGenvoiceTask({
            pollPath: `/history/${encodeURIComponent(taskId)}`,
            job,
            onCharge: storeSpeechReceipt,
          });
          const audioUrl = task?.result?.audio_url;
          if (!audioUrl) throw new Error("Completed TTS task missing audio_url");
          media = await archiveTaskMedia({
            audioUrl,
            srtUrl: task?.result?.srt_url,
            apiBase: pollCfg.apiBase,
            idBase: id,
            outputFormat: usedFallback ? "" : outputFormat,
          });
          const latestCharge = getSpeechReceipt(job.id) ?? job;
          upstream = {
            remoteTaskId: taskId,
            charactersUsed: Number(task.characters_used ?? text.length),
            ...reportedGenVoiceCredits(latestCharge.creditsDeducted, latestCharge.creditsSource),
          };
        }
        const now = new Date().toISOString();
        const item = {
          id,
          kind: "tts",
          ...(originProject ? { originProject } : {}),
          connection,
          title,
          text: genvoice ? writtenText : text,
          ...(generationRecipe ? { generationRecipe } : {}),
          ...(generationRecipe ? { generationJobId: job.id } : {}),
          ...(batchEntry ? { batch: batchEntry } : {}),
          tags: [...new Set([...extractAudioTags(text), ...(batch?.label ? [batch.label] : [])])],
          voiceId,
          voiceName,
          ...(input.creatorId ? { creatorId: input.creatorId } : {}),
          modelId,
          languageCode,
          voiceSettings,
          ...(input.voiceGender ? { voiceGender: input.voiceGender } : {}),
          ...(input.voicePreviewUrl ? { voicePreviewUrl: input.voicePreviewUrl } : {}),
          ...(speechStyle ? { speechStyle } : {}),
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
          ...upstream,
          provider,
          favorite: false,
          isTemplate: false,
          ...(input.notes ? { notes: String(input.notes).trim() } : {}),
          ...(input.sourceTakeId ? { sourceTakeId: String(input.sourceTakeId) } : {}),
          ...(input.fromTemplateId ? { fromTemplateId: String(input.fromTemplateId) } : {}),
          createdAt: now,
          updatedAt: now,
        };
        const saved = await mutateStore((items) => {
          const origin = generationRecipe ? cloudArchiveItem(items, item.remoteTaskId) : undefined;
          const duplicate =
            origin && (origin.kind === "tts" || needsSpeechRecipe(origin))
              ? items.indexOf(origin)
              : -1;
          if (duplicate < 0) {
            items.unshift(item);
            return item;
          }
          const previous = items[duplicate];
          const restore = needsSpeechRecipe(previous);
          return (items[duplicate] = {
            ...(restore ? restoreSpeechRecipe(previous, generationRecipe) : previous),
            copiedFrom: undefined,
            generationJobId: job.id,
            ...(batchEntry ? { batch: batchEntry } : {}),
            fallbackNote: item.fallbackNote,
            ...(restore || !previous.audioFile
              ? {
                  audioFile: item.audioFile,
                  bytes: item.bytes,
                  durationSeconds: item.durationSeconds,
                  mimeType: item.mimeType,
                  pcmFormatPending: undefined,
                  replacedAudioFiles: recordingAudioFiles(previous),
                }
              : {}),
            srtFile: previous.srtFile || item.srtFile,
            srtText: previous.srtText || item.srtText,
            ...(previous.creditsSource === "history" && item.creditsSource !== "history"
              ? {}
              : reportedGenVoiceCredits(item.creditsDeducted, item.creditsSource)),
            tags: [...new Set([...(previous.tags ?? []), ...item.tags])],
            updatedAt: now,
          });
        });
        if (saved.audioFile !== item.audioFile) {
          const duplicate = ownedMediaFile("audio", item.audioFile, SAFE_MEDIA_FILE);
          if (duplicate) rmSync(duplicate, { force: true });
        }
        if (saved.srtFile !== item.srtFile) {
          const duplicate = ownedMediaFile("srt", item.srtFile, SAFE_SRT_FILE);
          if (duplicate) rmSync(duplicate, { force: true });
        }
        if (generationRecipe)
          Object.assign(job, reportedGenVoiceCredits(saved.creditsDeducted, saved.creditsSource));
        return withChargeEvidence(saved);
      };
      createdJobs.push({ job, run });
    }
    return createdJobs;
  };

  const isFinishedJob = (job) => job?.status === "completed" || job?.status === "failed";
  const restoreSpeechJob = (job, savedJobs) => {
    const live = jobs.get(job.id);
    if (live && !isFinishedJob(live)) return { ...live };
    const saved = getSpeechReceipt(job.id, savedJobs);
    if (saved?.itemId)
      return { ...job, ...live, ...saved, status: "completed", progress: 100, error: undefined };
    if (isFinishedJob(live ?? job)) return { ...job, ...live, ...saved };
    return {
      ...job,
      ...saved,
      status: "failed",
      error: saved?.remoteTaskId
        ? "Speech was interrupted. Recover the result from Cloud history."
        : "Speech submission was interrupted before the task ID was saved. Check Cloud history.",
    };
  };
  const listSpeechJobs = () => {
    const live = [...jobs.values()].filter((job) => job.kind === "tts");
    if (!existsSync(speechFile) && !existsSync(archiveFile)) return live;
    const recent = speechLedger()
      .list("speech-runs")
      .slice(-40)
      .reverse()
      .flatMap((run) => run.jobs)
      .filter((job) => !jobs.has(job.id))
      .slice(0, 40);
    if (!recent.length && !live.length) return [];
    const savedJobs = savedSpeechJobs();
    return [...recent, ...live].map((job) => restoreSpeechJob(job, savedJobs));
  };
  const storeSpeechRunJob = (runId, job) =>
    speechLedger().mutate("speech-runs", (runs) => {
      const run = runs.find((row) => row.id === runId);
      const index = run?.jobs.findIndex((row) => row.id === job.id) ?? -1;
      if (index >= 0) run.jobs[index] = job;
    });
  const getSpeechRun = (runId) => {
    const record = speechLedger()
      .list("speech-runs")
      .find((run) => run.id === runId);
    if (!record) return null;
    const savedJobs = savedSpeechJobs();
    return {
      ...record,
      jobs: record.jobs.map((job) => restoreSpeechJob(job, savedJobs)),
    };
  };
  const queueSpeechJobs = (entries, { batchId, signal, runId, deadline } = {}) => {
    const ensureActiveRequest = () => {
      signal?.throwIfAborted();
      if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= Date.now()))
        throw Object.assign(new Error("Speech submission expired before it was accepted"), {
          status: 408,
        });
    };
    ensureActiveRequest();
    const hasGenVoiceJobs = entries.some(({ job }) => job.connection === "genvoice");
    const receiptId = runId ?? (hasGenVoiceJobs ? randomUUID() : undefined);
    if (receiptId) {
      if (!isSafeRemoteId(receiptId))
        throw Object.assign(new Error("Invalid Speech run ID"), { status: 400 });
      ensureSafeDir(audioDir);
      ensureSafeDir(srtDir);
      metadata().write(() => {});
      const registered = speechLedger().mutate("speech-runs", (runs) => {
        if (runs.some((run) => run.id === receiptId)) return false;
        runs.push({ id: receiptId, batchId, jobs: entries.map(({ job }) => job) });
        return true;
      });
      if (!registered) return getSpeechRun(receiptId);
    }
    ensureActiveRequest();
    return {
      ...(batchId ? { batchId } : {}),
      jobs: entries.map(({ job, run }) => ({ ...trackJob(job, run, receiptId) })),
    };
  };
  const startTts = async (input, options) =>
    queueSpeechJobs(createSpeechJobs(await prepareTts(input)), options);

  const prepareTtsBatch = async (input) => {
    const parsed = PlaygroundTtsBatch.safeParse(input);
    if (!parsed.success)
      throw Object.assign(new Error(parsed.error.issues[0]?.message || "Invalid Speech batch"), {
        status: 400,
      });
    if (!resolveKeyConfig().apiKey)
      throw Object.assign(new Error("Missing GenVoice API key"), { status: 400 });
    const speechCatalog = await getGenvoiceCatalog();
    const entries = [];
    for (const [index, entry] of speechBatchEntries(parsed.data).entries()) {
      try {
        const name =
          entry.name ||
          (parsed.data.label &&
            `${parsed.data.label.slice(0, 60)} · ${entry.voiceName || entry.voiceId}`);
        entries.push(await prepareTts({ ...entry, name }, speechCatalog));
      } catch (error) {
        throw Object.assign(new Error(`Voice ${index + 1}: ${error.message}`), {
          status: error.status ?? 400,
        });
      }
    }
    return { entries, label: parsed.data.label };
  };

  const quoteTtsBatch = async (input) => {
    const { entries } = await prepareTtsBatch(input);
    const status = await getStatus({ live: true });
    const rows = entries.map((entry) => {
      const model = entry.modelMeta?.model_id === entry.modelId ? entry.modelMeta : undefined;
      const rate = model?.model_rates?.character_cost_multiplier;
      const characters = Array.from(entry.text).length;
      const estimate = estimateSpeechModelCredits(
        characters,
        rate,
        entry.variations,
        entry.exportTranscript,
      );
      return {
        provider: entry.provider,
        modelId: entry.modelId,
        voiceId: entry.voiceId,
        voiceName: entry.voiceName,
        characters,
        takes: entry.variations,
        modelEstimateCredits: estimate,
        modelRateSource: estimate === null ? null : (model.rateSource ?? "built-in"),
        totalCredits: null,
      };
    });
    return {
      balanceCredits: status.error ? null : (status.account?.credit_balance ?? null),
      modelEstimateCredits: rows.every((row) => row.modelEstimateCredits !== null)
        ? rows.reduce((sum, row) => sum + row.modelEstimateCredits, 0)
        : null,
      totalCredits: null,
      rows,
    };
  };

  const startTtsBatch = async (input, options) => {
    const { entries, label } = await prepareTtsBatch(input);
    const batchId = `pg_batch_${randomUUID()}`;
    return queueSpeechJobs(
      entries.flatMap((entry, index) =>
        createSpeechJobs(entry, {
          id: batchId,
          index,
          ...(label ? { label } : {}),
        }),
      ),
      { ...options, batchId },
    );
  };

  const startDirectDialogue = (connection, input, retry) => {
    const google = connection === "google";
    const fail = (message) => {
      throw Object.assign(new Error(message), { status: 400 });
    };
    const text = stripDialogueSpeakerBrackets(input.text).trim();
    const cast = new Map();
    for (const [rawName, speaker] of Object.entries(input.speakers ?? {})) {
      const name = rawName.trim();
      if (!name || DANGEROUS_KEYS.has(name) || cast.has(name))
        fail("Give each dialogue speaker a unique name.");
      if (!isSafeRemoteId(speaker.voice_id)) fail(`Choose a valid voice for ${name}.`);
      if (google && !directConnections.supportsGeminiDialogueVoice(speaker.voice_id))
        fail("Choose prebuilt Gemini voices for a two-speaker take.");
      if (!google && speaker.speech_style) fail("Use inline audio tags for ElevenLabs delivery.");
      if (
        speaker.model_id !== undefined ||
        speaker.language_code !== undefined ||
        Object.keys(speaker.voice_settings ?? {}).length
      )
        fail(
          "This service uses a single model and settings for the scene. Remove model, language, and settings from each role.",
        );
      if (speaker.provider && speaker.provider !== connection)
        fail("Choose a voice from the selected Dialogue service.");
      cast.set(name, speaker);
    }
    if (
      google &&
      (cast.size !== 2 || new Set([...cast.values()].map((s) => s.voice_id)).size !== 2)
    )
      fail("Gemini Dialogue requires two speakers with different prebuilt voices.");
    if (input.pause_between_turns !== undefined || input.pauseBetweenTurns !== undefined)
      fail("Custom pause between all turns is available with GenVoice Dialogue.");
    if (google && input.languageCode?.trim() && input.languageCode.trim() !== "auto")
      fail("Gemini detects the language from the spoken text.");
    const turns = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const labeled = /^([^:\r\n]{1,80}):\s*(.*)$/.exec(line);
      const speakerName = labeled?.[1].trim();
      const entry = cast.get(speakerName);
      if (entry) {
        turns.push({
          speaker: speakerName,
          text: labeled[2],
          voiceId: entry.voice_id,
          speechStyle: entry.speech_style,
        });
      } else if (turns.length && !labeled) {
        turns[turns.length - 1].text += `\n${line}`;
      } else {
        fail("Every turn must start with a configured speaker name.");
      }
    }
    const spoken = turns.filter((turn) => turn.text.trim());
    const names = [...new Set(spoken.map((turn) => turn.speaker))];
    if (names.length < 2) fail("Add a line for at least two speakers.");
    if (!google && new Set(spoken.map((turn) => turn.voiceId)).size > 10)
      fail("ElevenLabs Dialogue supports up to 10 distinct voices.");
    const modelId = directConnections.prepareSpeech(connection, input);
    if (!google && modelId !== "eleven_v4" && modelId !== "eleven_v3")
      fail("Select Eleven v4 or Eleven v3 for direct Dialogue.");
    if (!google) {
      const limit = modelId === "eleven_v4" ? 10000 : 5000;
      if (spoken.reduce((total, turn) => total + turn.text.trim().length, 0) > limit)
        fail(`Split this script into scenes of up to ${limit.toLocaleString()} characters.`);
    }
    const first = cast.get(names[0]);
    const requestedLanguage = input.languageCode?.trim();
    const languageCode = google ? "auto" : requestedLanguage || "auto";
    const supported = modelId === "eleven_v3" ? ["stability"] : ["stability", "similarity_boost"];
    if (!google && Object.keys(input.voiceSettings ?? {}).some((key) => !supported.includes(key)))
      fail(
        "Use scene settings supported by the selected model. Eleven v3 supports stability; Eleven v4 also supports similarity.",
      );
    const voiceSettings = input.voiceSettings ?? {};
    const speakers = names.map((name) => ({ name, voiceId: cast.get(name).voice_id }));
    const savedSpeakers = Object.fromEntries(
      Array.from(cast).map(([name, role]) => {
        return [
          name,
          {
            voice_id: role.voice_id,
            voice_name: role.voice_name || role.voice_id,
            model_id: modelId,
            language_code: languageCode,
            ...(role.speech_style ? { speech_style: role.speech_style } : {}),
          },
        ];
      }),
    );
    const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const title = summarizeTitle(text, input.name);
    const job = {
      id,
      kind: "dialogue",
      scope,
      connection,
      ...(retry?.parentId ? { dialogueParentId: retry.parentId } : {}),
      dialogueRecipe: {
        connection,
        text,
        speakers: Object.fromEntries(cast),
        modelId,
        languageCode,
        voiceSettings,
        outputFormat: input.outputFormat,
        seed: input.seed,
        exportTranscript: Boolean(input.exportTranscript),
        notes: input.notes,
        fromTemplateId: input.fromTemplateId,
      },
      title,
      status: "pending",
      progress: 0,
      modelId,
      voiceId: first.voice_id,
      voiceName: names.map((name) => `${name} (${savedSpeakers[name].voice_name})`).join(" · "),
      createdAt: new Date().toISOString(),
    };
    trackJob(job, async () => {
      const { bytes, ext, ...details } = await directConnections.renderSpeech(connection, {
        ...input,
        text,
        modelId,
        voiceSettings,
        languageCode: languageCode === "auto" ? undefined : languageCode,
        turns: spoken,
        speakers,
      });
      const audio = await archiveAudio(id, ext, bytes);
      const now = new Date().toISOString();
      const item = {
        id,
        kind: "dialogue",
        connection,
        title,
        text,
        tags: extractAudioTags(text),
        voiceId: job.voiceId,
        voiceName: job.voiceName,
        modelId,
        languageCode,
        voiceSettings,
        dialogue: { speakers: savedSpeakers },
        outputFormat: input.outputFormat,
        seed: input.seed,
        exportTranscript: Boolean(input.exportTranscript),
        ...(input.fromTemplateId ? { fromTemplateId: input.fromTemplateId } : {}),
        ...(retry ? { retry } : {}),
        ...audio,
        ...details,
        provider: connection,
        favorite: false,
        isTemplate: false,
        notes: input.notes?.trim(),
        createdAt: now,
        updatedAt: now,
      };
      await mutateStore((items) => items.unshift(item));
      return item;
    });
    return { job: { ...job } };
  };

  const startDialogue = async (input, retry) => {
    if (input.connection && input.connection !== "genvoice") {
      return startDirectDialogue(input.connection, input, retry);
    }
    const cfg = resolveKeyConfig();
    if (!cfg.apiKey) throw new Error("Missing GenVoice API key");
    if (
      input.modelId ||
      input.languageCode ||
      input.outputFormat ||
      input.seed !== undefined ||
      Object.keys(input.voiceSettings ?? {}).length
    )
      throw Object.assign(
        new Error("GenVoice Dialogue takes model, language and voice settings per speaker."),
        { status: 400 },
      );
    const text = stripDialogueSpeakerBrackets(input.text).trim();
    const rawSpeakers = input.speakers && typeof input.speakers === "object" ? input.speakers : {};
    const speakerEntries = Object.entries(rawSpeakers)
      .map(([k, v]) => [k.trim(), v])
      .filter(([k]) => k && !DANGEROUS_KEYS.has(k));
    const speakerNames = speakerEntries.map(([k]) => k);
    if (new Set(speakerNames).size !== speakerNames.length)
      throw Object.assign(new Error("Give each dialogue speaker a unique name."), { status: 400 });
    if (speakerEntries.some(([, speaker]) => speaker?.speech_style?.trim()))
      throw Object.assign(
        new Error(
          "Speech direction per role is available with Gemini. GenVoice uses audio tags in the script.",
        ),
        { status: 400 },
      );
    if (!text) throw Object.assign(new Error("Dialogue text is required"), { status: 400 });
    if (speakerNames.length < 2) {
      throw Object.assign(new Error("GenVoice Dialogue requires at least 2 speakers"), {
        status: 400,
      });
    }
    const configuredSet = new Set(speakerNames);
    const matchedTurnSpeakers = parseDialogueTurnNames(text);
    if (matchedTurnSpeakers.some((name) => !configuredSet.has(name)))
      throw Object.assign(new Error("Every named turn must match a speaker in the cast."), {
        status: 400,
      });
    if (matchedTurnSpeakers.length < 2) {
      throw Object.assign(
        new Error(
          'Dialogue script must include "SpeakerName: line" turns for at least 2 configured speakers.',
        ),
        { status: 400 },
      );
    }

    const catalog = await getCatalog();
    const defaultLang = detectTextLanguage(text.replace(/^[^:\r\n]{1,80}:\s*/gm, ""));
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
      const provider = s.provider ?? providerForModel(s.model_id);
      cloning.assertCloneAvailable(provider, vId);
      const mId =
        String(s?.model_id ?? defaultProviderModel(provider)).trim() ||
        defaultProviderModel(provider);
      if (providerForModel(mId) !== provider)
        throw Object.assign(
          new Error(`Speaker "${name}" model does not belong to its voice provider`),
          { status: 400 },
        );
      const modelMeta =
        catalog.models.find((m) => m.model_id === mId) ??
        BUILTIN_GENVOICE_MODELS.find((m) => m.model_id === mId) ??
        BUILTIN_GENVOICE_MODELS[0];
      const settings = sanitizeVoiceSettings(s.voice_settings, modelMeta, provider);
      const lang = resolveProviderLanguage(
        provider,
        (typeof s.language_code === "string" ? s.language_code.trim() : "") || defaultLang,
        catalog,
        modelMeta,
      );
      speakers[name] = {
        provider,
        voice_id: vId,
        model_id: mId,
        language_code: lang,
        voice_settings: settings,
      };
      speakerSummary[name] = {
        provider,
        voice_id: vId,
        voice_name: String(s?.voice_name ?? vId),
        model_id: mId,
        language_code: lang,
        voice_settings: settings,
      };
    }

    const pauseBetweenTurns = +(
      clampNum(input.pause_between_turns ?? input.pauseBetweenTurns, 0, 3) ?? 0.5
    ).toFixed(2);
    const exportTranscript = Boolean(input.exportTranscript);
    const id = `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const title = summarizeTitle(text, input.name);
    const primarySpeaker = speakerSummary[speakerNames[0]];
    if (retry?.parentId) protectRecording(retry.parentId);

    const job = {
      id,
      kind: "dialogue",
      scope,
      dialogueRecipe: {
        connection: "genvoice",
        text,
        speakers: speakerSummary,
        pause_between_turns: pauseBetweenTurns,
        exportTranscript,
        name: title,
        notes: input.notes,
        fromTemplateId: input.fromTemplateId,
      },
      ...(retry?.parentId ? { dialogueParentId: retry.parentId } : {}),
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
        pause_between_turns: pauseBetweenTurns,
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
      job.dialogueRecipe = {
        ...job.dialogueRecipe,
        exportTranscript: !usedFallback && exportTranscript,
      };
      emit({ type: "job", job: { ...job } });
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
          : exportTranscript && !media.srtFile
            ? { fallbackNote: "GenVoice returned dialogue audio without the requested subtitles." }
            : {}),
        dialogue: { pause_between_turns: pauseBetweenTurns, speakers: speakerSummary },
        ...(input.fromTemplateId ? { fromTemplateId: input.fromTemplateId } : {}),
        ...(retry ? { retry } : {}),
        ...media,
        remoteTaskId: taskId,
        charactersUsed: Number(task.characters_used ?? text.length),
        ...reportedGenVoiceCredits(job.creditsDeducted),
        provider: primarySpeaker.provider,
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
    const ext = SAFE_MEDIA_FILE.test(`source${extname(String(fileName ?? "")).toLowerCase()}`)
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
    allowOtherScope = true,
    protectCrossScope = false,
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
    if (
      sourceFile &&
      SAFE_MEDIA_FILE.test(sourceFile) &&
      existsSync(join(sourcesDir, sourceFile))
    ) {
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
    if (sourceFile && allowOtherScope) {
      const other = forScope(scope === "project" ? "global" : "project").readSource({
        sourceFile,
        maxBytes,
        limitLabel,
        allowOtherScope: false,
      });
      return { ...other, sourceFile: undefined };
    }
    if (sourceItemId) {
      const found = getItem(sourceItemId);
      if (!found && allowOtherScope)
        return forScope(scope === "project" ? "global" : "project").readSource({
          sourceItemId,
          maxBytes,
          limitLabel,
          allowOtherScope: false,
          protectCrossScope: true,
        });
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
      if (protectCrossScope) protectRecording(sourceItemId);
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
    throw new Error("Choose an audio file, a saved recording, or a film take.");
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
      if (!source.sourceFile) removeSourceFileIfUnused(savedSourceFile);
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
    const title = summarizeTitle(source.label, input.name || `Voice change · ${source.label}`);

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
          ...reportedGenVoiceCredits(job.creditsDeducted),
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
        if (!source.sourceFile && !job.remoteTaskId && savedSourceFile) {
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

  const submitSpeechToText = async (input) => {
    const cfg = resolveKeyConfig();
    if (!cfg.apiKey) throw new Error("Missing GenVoice API key");
    const source = resolveSourceAudio({
      fileBytes: input.fileBytes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sourceItemId: input.itemId ?? input.sourceItemId,
      sourceFile: input.sourceFile,
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

    source.sourceFile ||= persistUploadSource(source.bytes, source.name, ".mp3");
    const { data: created } = await genvoiceRequest("/speech-to-text", {
      method: "POST",
      body: form,
    });
    const taskId = String(created.task_id ?? created.id ?? "");
    if (!taskId) throw new Error("GenVoice STT response missing task_id");

    return { taskId, source };
  };

  const finishSpeechToText = async (taskId, input, job, source) => {
    const rawLang = input.languageCode || input.language_code || "";
    const deadline = Date.now() + maxPollMs;
    let sttData = null;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const { data, cfg: pollCfg } = await genvoiceRequest(
        `/speech-to-text/${encodeURIComponent(taskId)}`,
      );
      if (job) {
        job.status = "processing";
        job.progress = typeof data.progress === "number" ? data.progress : job.progress;
        emit({ type: "job", job: { ...job } });
      }
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
    if (closed)
      throw new Error(`Transcription workspace closed; resume task ${taskId} to save it.`);

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
            ...(typeof f.requested_format === "string"
              ? { requested_format: f.requested_format }
              : {}),
            content: String(f.content),
            ...(typeof f.is_base64_encoded === "boolean"
              ? { is_base64_encoded: f.is_base64_encoded }
              : {}),
          }))
      : [];
    const srtEntry = extraFormats.find((f) => f.file_extension === "srt") ?? null;
    const rawProb = Number(resObj.language_probability);
    const sttResult = {
      ...(typeof sttData.credits_deducted === "number" &&
      Number.isFinite(sttData.credits_deducted) &&
      sttData.credits_deducted >= 0
        ? { creditsDeducted: sttData.credits_deducted }
        : {}),
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
      const owner = getItem(input.itemId)
        ? controller
        : forScope(scope === "project" ? "global" : "project");
      const original = owner.getItem(input.itemId);
      if (original)
        await owner.patchItem(input.itemId, {
          sttResult,
          ...(sttResult.srtText && !original.srtText ? { srtText: sttResult.srtText } : {}),
        });
    }

    const id = `pg_stt_${createHash("sha256").update(taskId).digest("hex").slice(0, 24)}`;
    const item = await mutateStore((items) => {
      const index = items.findIndex((row) => row.id === id);
      const archived = items[index];
      const now = new Date().toISOString();
      const settings = Object.fromEntries(
        [
          "languageCode",
          "fileFormat",
          "timestampsGranularity",
          "diarize",
          "numSpeakers",
          "diarizationThreshold",
          "tagAudioEvents",
          "noVerbatim",
          "temperature",
          "seed",
          "useMultiChannel",
          "keyterms",
          "entityDetection",
          "entityRedaction",
          "entityRedactionMode",
          "additionalFormats",
        ]
          .filter((key) => input[key] !== undefined)
          .map((key) => [key, structuredClone(input[key])]),
      );
      const sourceLabel = input.sourceLabel || source?.label || input.fileName || "Transcription";
      const previousSettings = archived?.transcription?.settings ?? {};
      const missingSettings = Object.keys(settings).some((key) => !(key in previousSettings));
      if (archived && (archived.audioFile || !source?.bytes) && !missingSettings) return archived;
      let audioFile = "",
        mimeType = source?.mime || "",
        bytes = 0,
        durationSeconds = 0;
      if (source?.bytes && !archived?.audioFile) {
        const pcm =
          input.fileFormat === "pcm_s16le_16" &&
          isRawHeaderlessPcm(source.bytes, source.name, source.mime);
        const audio = pcm ? wrapPcm16ToWav(source.bytes, 16000) : source.bytes;
        const originalExt = extname(source.name).toLowerCase();
        const ext = pcm
          ? ".wav"
          : SAFE_MEDIA_FILE.test(`source${originalExt}`)
            ? originalExt
            : extFromDownload(
                `https://source.invalid/${encodeURIComponent(source.name)}`,
                source.mime,
                audio,
              );
        audioFile = `${id}${ext}`;
        mimeType = audioMimeForExt(ext);
        bytes = audio.byteLength;
        const target = join(ensureSafeDir(audioDir), audioFile);
        writeAtomic(target, audio);
        durationSeconds = audioDurationFromFile(target);
      }
      const archivedItem = {
        id,
        scope,
        kind: "stt",
        provider: "elevenlabs",
        title: `${sourceLabel} · transcript`,
        text: sttResult.text,
        tags: [],
        voiceId: "",
        voiceName: "Scribe v2",
        modelId: "scribe_v2",
        languageCode: sttResult.language_code || rawLang,
        voiceSettings: {},
        exportTranscript: Boolean(sttResult.srtText),
        audioFile,
        mimeType,
        bytes,
        durationSeconds,
        sttResult,
        ...(sttResult.srtText ? { srtText: sttResult.srtText } : {}),
        transcription: { sourceLabel, settings },
        remoteTaskId: taskId,
        ...reportedGenVoiceCredits(sttResult.creditsDeducted),
        favorite: false,
        isTemplate: false,
        createdAt: now,
        updatedAt: now,
      };
      if (archived) {
        items[index] = {
          ...archived,
          ...(audioFile ? { audioFile, mimeType, bytes, durationSeconds } : {}),
          transcription: {
            sourceLabel: archived.audioFile
              ? (archived.transcription?.sourceLabel ?? sourceLabel)
              : sourceLabel,
            settings: { ...settings, ...previousSettings },
          },
          updatedAt: now,
        };
        return items[index];
      }
      items.unshift(archivedItem);
      return archivedItem;
    });
    emit({ type: "item", item });
    return { taskId, sttResult, item };
  };
  const runSpeechToText = async (input) => {
    const { taskId, source } = await submitSpeechToText(input);
    return finishSpeechToText(taskId, input, undefined, source);
  };
  const startSpeechToText = (input, taskId) => {
    const job = {
      id: `stt_${randomUUID()}`,
      kind: "stt",
      status: "pending",
      progress: 0,
      title:
        `Transcribe ${input.sourceLabel || input.fileName || getItem(input.itemId)?.title || "recording"}`.slice(
          0,
          180,
        ),
      voiceId: "",
      voiceName: "Scribe v2",
      modelId: "scribe_v2",
      createdAt: new Date().toISOString(),
      ...(taskId ? { remoteTaskId: taskId } : {}),
    };
    trackJob(job, async () => {
      const submitted = taskId
        ? {
            taskId,
            ...(input.sourceFile || input.itemId || input.sourceItemId || input.sourceTakeFile
              ? {
                  source: resolveSourceAudio({
                    ...input,
                    sourceItemId: input.itemId ?? input.sourceItemId,
                    maxBytes: MAX_STT_BYTES,
                  }),
                }
              : {}),
          }
        : await submitSpeechToText(input);
      job.remoteTaskId = submitted.taskId;
      if (submitted.source) {
        job.sourceFile = submitted.source.sourceFile;
        job.sourceLabel = input.sourceLabel || submitted.source.label;
      }
      emit({ type: "job", job: { ...job } });
      return finishSpeechToText(job.remoteTaskId, input, job, submitted.source);
    });
    return { job: { ...job } };
  };

  const patchItems = async (ids, patch) => {
    const selected = new Set(ids);
    const now = new Date().toISOString();
    const updated = await mutateStore((items) => {
      const result = [];
      for (const [idx, cur] of items.entries()) {
        if (!selected.has(cur.id)) continue;
        selected.delete(cur.id);
        const next = { ...cur };
        if (patch.sttResult) next.sttResult = patch.sttResult;
        if (typeof patch.srtText === "string") next.srtText = patch.srtText;
        if (typeof patch.favorite === "boolean") next.favorite = patch.favorite;
        if (typeof patch.description === "string") next.description = patch.description.trim();
        if ("rating" in patch) next.rating = patch.rating;
        if ("color" in patch) next.color = patch.color;
        if (patch.archived === true) next.archivedAt ??= now;
        if (patch.archived === false) delete next.archivedAt;
        if (typeof patch.isTemplate === "boolean") next.isTemplate = patch.isTemplate;
        if (typeof patch.templateName === "string")
          next.templateName = patch.templateName.trim().slice(0, 120);
        if (typeof patch.title === "string" && patch.title.trim())
          next.title = patch.title.trim().slice(0, 120);
        if (typeof patch.notes === "string") next.notes = patch.notes.trim().slice(0, 2000);
        if (patch.rights) next.rights = { ...patch.rights, checkedAt: new Date().toISOString() };
        if (Array.isArray(patch.tags)) {
          next.tags = patch.tags
            .map((t) => String(t).trim())
            .filter(Boolean)
            .slice(0, 40);
        }
        next.updatedAt = now;
        items[idx] = next;
        result.push({ ...withChargeEvidence(next), scope });
      }
      return result;
    });
    for (const item of updated) {
      if (item.archivedAt) emit({ type: "deleted", id: item.id });
      else emit({ type: "item", item });
    }
    return { items: updated, missing: [...selected] };
  };
  const patchItem = async (id, patch) => (await patchItems([id], patch)).items[0] ?? null;

  const expiresBefore = (item, cutoff) =>
    Boolean(item.archivedAt) && Date.parse(item.archivedAt) <= cutoff;
  const sameMediaName = (a, b) =>
    typeof a === "string" &&
    Boolean(a) &&
    typeof b === "string" &&
    a.toLowerCase() === b.toLowerCase();
  const retentionReferences = () => ({
    templates: metadata().list("templates"),
    previews: new Set(
      metadata()
        .list("voice-profiles")
        .map(({ voice }) => voice?.previewUrl?.toLowerCase()),
    ),
    film: new Set(
      [...metadata().list("usage"), ...metadata().list("alternatives")]
        .filter((record) => (record.scope ?? "project") === scope)
        .map((record) => record.itemId),
    ),
  });
  const protectRecording = (id) =>
    mutateStore((items) => {
      const item = items.find((row) => row.id === id);
      if (!item)
        throw Object.assign(new Error("Recording is no longer available"), { status: 404 });
      item.retentionPinned = true;
    });
  const canPurgeArchived = (item, items, { templates, film, previews }, cutoff) =>
    expiresBefore(item, cutoff) &&
    (scope !== "global" || item.retentionTracked) &&
    !item.retentionPinned &&
    !film.has(item.id) &&
    !recordingAudioFiles(item).some((file) =>
      previews.has(`/api/voice/playground/audio/${file}?scope=${scope}`.toLowerCase()),
    ) &&
    !item.sourceTakeId &&
    !item.filmTakeSource &&
    !item.dubbing?.jobId &&
    !templates.some(
      ({ draft }) => draft?.vcSourceItemId === item.id || draft?.sttSourceItemId === item.id,
    ) &&
    !items.some(
      (other) =>
        other.id !== item.id &&
        (other.voiceChanger?.sourceItemId === item.id ||
          other.version?.replacement?.id === item.id ||
          other.transcription?.sourceItemId === item.id ||
          recordingRootId(other) === recordingRootId(item) ||
          recordingAudioFiles(item).some((file) =>
            recordingAudioFiles(other).some((linked) => sameMediaName(file, linked)),
          ) ||
          sameMediaName(item.srtFile, other.srtFile)),
    );

  const deleteItem = async (id, { cutoff } = {}) => {
    const moved = [];
    let removed;
    try {
      removed = await mutateStore((items) => {
        const idx = items.findIndex((x) => x.id === id);
        if (idx < 0) return false;
        const item = items[idx];
        if (cutoff !== undefined && !canPurgeArchived(item, items, retentionReferences(), cutoff))
          return false;
        const remaining = items.filter((_, index) => index !== idx);
        const source = cutoff === undefined ? item.voiceChanger?.sourceFile : undefined;
        const video = item.dubbing?.resultFile;
        const paths = [
          ...recordingAudioFiles(item)
            .filter(
              (file) =>
                !remaining.some((row) =>
                  recordingAudioFiles(row).some((linked) => sameMediaName(file, linked)),
                ),
            )
            .map((file) => ownedMediaFile("audio", file, SAFE_MEDIA_FILE)),
          !remaining.some((row) => sameMediaName(row.srtFile, item.srtFile)) &&
            ownedMediaFile("srt", item.srtFile, SAFE_SRT_FILE),
          source &&
            !sourceIsReferenced(source, remaining) &&
            ownedMediaFile("sources", source, SAFE_MEDIA_FILE),
          video &&
            !remaining.some((row) => sameMediaName(row.dubbing?.resultFile, video)) &&
            ownedMediaFile("video", video, SAFE_DUBBING_VIDEO_FILE),
        ];
        for (const path of paths.filter(Boolean)) {
          const pending = `${path}.${nextTmp()}.purge`;
          renameSync(path, pending);
          moved.push({ path, pending });
        }
        items.splice(idx, 1);
        return true;
      });
    } catch (error) {
      for (const { path, pending } of moved.reverse()) renameSync(pending, path);
      throw error;
    }
    if (!removed) return false;
    emit({ type: "deleted", id });
    for (const { pending } of moved) rmSync(pending, { force: true });
    return true;
  };
  const recordingArchivePolicy = (id) => {
    const items = readStoreRaw();
    const item = items.find((row) => row.id === id);
    if (!item?.archivedAt) return null;
    return {
      deleteAfter: canPurgeArchived(item, items, retentionReferences(), Infinity)
        ? new Date(Date.parse(item.archivedAt) + archiveRetentionMs).toISOString()
        : null,
    };
  };
  const previewExpiredRecordings = () => {
    const cutoff = Date.now() - archiveRetentionMs;
    const items = readStoreRaw();
    const expired = items.filter((item) => expiresBefore(item, cutoff));
    const references = expired.length ? retentionReferences() : null;
    const eligible = expired.filter((item) => canPurgeArchived(item, items, references, cutoff));
    return {
      retentionDays: 30,
      eligible: eligible.map(({ id, title, archivedAt }) => ({ id, title, archivedAt })),
      protected: expired.length - eligible.length,
    };
  };
  const purgeExpiredRecordings = async (ids) => {
    const cutoff = Date.now() - archiveRetentionMs;
    const purged = [];
    const failed = [];
    for (const id of new Set(ids)) {
      try {
        if (await deleteItem(id, { cutoff })) purged.push(id);
        else
          failed.push({
            id,
            reason: "Recording is active, protected, missing or still inside the retention period.",
          });
      } catch (error) {
        failed.push({ id, reason: error.message });
      }
    }
    return { purged, failed };
  };

  const retryItem = async (id, overrides = {}, options) => {
    const item = getItem(id);
    if (!item) return null;
    if (overrides.creatorId && item.kind !== "tts")
      throw Object.assign(new Error("Creator ID overrides apply to Speech retries"), {
        status: 400,
      });
    if (isUnverifiedCloudSpeech(item))
      throw Object.assign(
        new Error(
          "Review the Speech settings before generating. The original Cloud settings are unavailable.",
        ),
        { status: 409 },
      );
    if (item.kind === "dubbing")
      throw Object.assign(
        new Error("Use the saved Dubbing job to retry, or prepare a new dubbing from its source"),
        { status: 400 },
      );
    if (item.kind === "dialogue") {
      const fail = (message) => {
        throw Object.assign(new Error(message), { status: 400 });
      };
      const direct = Boolean(item.connection && item.connection !== "genvoice");
      if (overrides.connection && overrides.connection !== (item.connection ?? "genvoice"))
        fail("Duplicate the scene into the editor to switch services.");
      if (
        [
          "speechStyle",
          "previousText",
          "nextText",
          "applyTextNormalization",
          "variations",
          "removeBackgroundNoise",
        ].some((key) => overrides[key] !== undefined) ||
        (!direct && (overrides.seed !== undefined || overrides.outputFormat !== undefined))
      )
        fail("Those retry options are unavailable for this Dialogue service.");
      if (direct && overrides.provider && overrides.provider !== item.connection)
        fail("Choose a voice from the saved Dialogue service.");
      const savedSpeakers = item.dialogue?.speakers;
      const cast = overrides.speakers ?? savedSpeakers;
      if (!isPlainObject(cast) || Object.keys(cast).length < 2)
        fail(
          "This recording has no complete saved Dialogue cast. Add at least two speakers to recreate it.",
        );
      const roleChange =
        overrides.voiceId !== undefined ||
        overrides.voiceName !== undefined ||
        (!direct &&
          ["provider", "modelId", "languageCode", "voiceSettings"].some(
            (key) => overrides[key] !== undefined,
          ));
      if (overrides.speakers && (roleChange || overrides.speakerKey !== undefined))
        fail("Send a complete replacement cast or changes to one speaker.");
      if (
        overrides.speakerKey !== undefined &&
        (!Object.hasOwn(cast, overrides.speakerKey) || DANGEROUS_KEYS.has(overrides.speakerKey))
      )
        fail("The selected speaker is absent from the saved scene.");
      if (overrides.speakerKey !== undefined && !roleChange)
        fail("Provide a change for the selected speaker.");
      let nextSpeakers = cast;
      if (roleChange) {
        const cloned = Object.assign(Object.create(null), cast);
        const names = Object.keys(cloned).filter((k) => !DANGEROUS_KEYS.has(k));
        const targetKey = overrides.speakerKey ?? names[0];
        if (targetKey && Object.hasOwn(cloned, targetKey)) {
          const prior = cloned[targetKey];
          const provider =
            overrides.provider ??
            (overrides.modelId
              ? providerForModel(overrides.modelId)
              : (prior.provider ?? providerForModel(prior.model_id)));
          cloned[targetKey] = {
            ...cloned[targetKey],
            voice_id: overrides.voiceId ?? prior.voice_id,
            voice_name: overrides.voiceName ?? overrides.voiceId ?? prior.voice_name,
            provider,
            model_id:
              overrides.modelId ??
              (provider !== (prior.provider ?? providerForModel(prior.model_id))
                ? defaultProviderModel(provider)
                : prior.model_id),
            language_code: overrides.languageCode ?? cloned[targetKey].language_code,
            voice_settings: overrides.voiceSettings ?? prior.voice_settings,
          };
          nextSpeakers = cloned;
        }
      }
      if (direct && !overrides.speakers)
        nextSpeakers = Object.fromEntries(
          Object.entries(nextSpeakers).map(([name, { voice_id, voice_name, speech_style }]) => [
            name,
            { voice_id, voice_name, ...(speech_style ? { speech_style } : {}) },
          ]),
        );
      return startDialogue(
        {
          connection: item.connection,
          fromTemplateId: item.fromTemplateId,
          ...(direct
            ? {
                modelId: overrides.modelId ?? item.modelId,
                languageCode: overrides.languageCode ?? item.languageCode,
                voiceSettings: overrides.voiceSettings ?? item.voiceSettings,
                outputFormat: overrides.outputFormat ?? item.outputFormat,
                seed: overrides.seed ?? item.seed,
              }
            : {}),
          text: overrides.text ?? item.text,
          speakers: nextSpeakers,
          pauseBetweenTurns: overrides.pauseBetweenTurns ?? item.dialogue?.pause_between_turns,
          exportTranscript: overrides.exportTranscript ?? item.exportTranscript,
          name: overrides.name ?? item.title,
          notes: overrides.notes ?? item.notes,
        },
        { rootId: recordingRootId(item), parentId: item.id },
      );
    }
    if (item.kind === "voice_changer") {
      const vc = item.voiceChanger;
      const sourceItemId =
        vc?.sourceItemId && (scope === "project" || getItem(vc.sourceItemId))
          ? vc.sourceItemId
          : undefined;
      const sourceTakeFile = scope === "project" ? vc?.sourceTakeFile : undefined;
      if (!sourceItemId && !vc?.sourceFile && !(vc?.sourceTakeKind && sourceTakeFile)) {
        const err = new Error(
          "Original source audio is unavailable for retry — select a source clip or upload audio",
        );
        err.status = 400;
        throw err;
      }
      return startVoiceChanger({
        sourceItemId,
        sourceFile: vc.sourceFile,
        fileName: vc.sourceLabel,
        sourceTakeKind: vc.sourceTakeKind,
        sourceTakeFile,
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
    const unsupported = [
      "speakerKey",
      "speakers",
      "pauseBetweenTurns",
      "removeBackgroundNoise",
    ].find((key) => overrides[key] !== undefined);
    if (unsupported)
      throw Object.assign(new Error(`${unsupported} is unavailable when retrying Speech`), {
        status: 400,
      });
    const connection = overrides.connection ?? item.connection ?? "genvoice";
    if (connection !== (item.connection ?? "genvoice")) {
      throw Object.assign(
        new Error("To switch services, duplicate this recording into the composer first."),
        { status: 400 },
      );
    }
    const provider =
      overrides.provider ??
      (overrides.modelId
        ? providerForModel(overrides.modelId)
        : (item.provider ?? providerForModel(item.modelId)));
    const preserveSettings = Boolean(
      item.generationRecipe &&
      provider === item.provider &&
      (!overrides.modelId || overrides.modelId === item.modelId),
    );
    const voiceId = overrides.voiceId ?? item.voiceId;
    const sameVoice =
      voiceId === item.voiceId && provider === (item.provider ?? providerForModel(item.modelId));
    return startTts(
      {
        connection,
        ...(connection === "genvoice" ? { provider } : {}),
        speechStyle: overrides.speechStyle ?? item.speechStyle,
        voiceId,
        voiceName: overrides.voiceName ?? (overrides.voiceId ? overrides.voiceId : item.voiceName),
        creatorId: overrides.creatorId ?? (sameVoice ? item.creatorId : undefined),
        voiceGender: overrides.voiceId ? undefined : item.voiceGender,
        voicePreviewUrl: overrides.voiceId ? undefined : item.voicePreviewUrl,
        modelId:
          overrides.modelId ??
          (connection === "genvoice" &&
          provider !== (item.provider ?? providerForModel(item.modelId))
            ? defaultProviderModel(provider)
            : item.modelId),
        languageCode: overrides.languageCode ?? item.languageCode,
        text: overrides.text ?? item.text,
        voiceSettings: overrides.voiceSettings ?? item.voiceSettings,
        preserveSettings,
        previousText:
          provider === "elevenlabs"
            ? (overrides.previousText ?? item.previousText)
            : overrides.previousText,
        nextText:
          provider === "elevenlabs" ? (overrides.nextText ?? item.nextText) : overrides.nextText,
        seed: provider === "elevenlabs" ? (overrides.seed ?? item.seed) : overrides.seed,
        outputFormat:
          provider === "elevenlabs"
            ? (overrides.outputFormat ?? item.outputFormat)
            : overrides.outputFormat,
        applyTextNormalization:
          provider === "elevenlabs" || preserveSettings
            ? (overrides.applyTextNormalization ?? item.applyTextNormalization)
            : overrides.applyTextNormalization,
        exportTranscript: overrides.exportTranscript ?? item.exportTranscript,
        name: overrides.name ?? item.title,
        notes: overrides.notes ?? item.notes,
        variations: overrides.variations ?? 1,
        fromTemplateId: item.id,
      },
      options,
    );
  };

  const extractHistoryTasks = (data) =>
    Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data?.items) ? data.items : [];

  const fetchRemoteHistory = async ({ page = 0, pageSize = 30, kind = "all" } = {}) => {
    if (!["all", "tts", "voice_changer"].includes(kind))
      throw Object.assign(new Error("History kind must be all, tts or voice_changer"), {
        status: 400,
      });
    const safePage = Number.isFinite(Number(page)) ? Math.max(0, Math.trunc(Number(page))) : 0;
    const rawSize = Number(pageSize);
    const safePageSize = Number.isFinite(rawSize)
      ? Math.min(100, Math.max(1, Math.trunc(rawSize)))
      : 30;
    const safeApiBase = resolveKeyConfig().apiBase;
    let vcWarning = "";
    const [ttsRes, vcRes] = await Promise.all([
      kind === "voice_changer"
        ? { data: { tasks: [], has_more: false } }
        : genvoiceRequest(`/history?page_size=${safePageSize}&page=${safePage}`),
      kind === "tts"
        ? { data: { tasks: [], has_more: false } }
        : genvoiceRequest(
            `/voice-changer/history?page_size=${safePageSize}&page=${safePage}`,
          ).catch((err) => {
            vcWarning = err?.message || "Voice Changer history unavailable";
            return { data: { tasks: [], has_more: false } };
          }),
    ]);
    const archivedByRemoteId = new Map();
    for (const item of readStoreRaw()) {
      if (!item.remoteTaskId || item.version) continue;
      const existing = archivedByRemoteId.get(item.remoteTaskId);
      if (!existing || (existing.copiedFrom && !item.copiedFrom))
        archivedByRemoteId.set(item.remoteTaskId, item);
    }
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
      const remoteId = String(raw.id ?? raw.task_id ?? "");
      const archived = archivedByRemoteId.get(remoteId);
      const remoteSpeakers = sanitizeDialogueSpeakers(raw?.metadata?.speakers);
      const detectedKind = archived?.kind ?? (remoteSpeakers ? "dialogue" : kindHint);
      const meta = resolveRemoteMeta(raw, detectedKind);
      const modelId = String(raw?.model_id ?? raw?.metadata?.model_id ?? "");
      const provider = ["elevenlabs", "minimax", "capcut"].includes(
        raw.provider ?? raw?.metadata?.provider,
      )
        ? (raw.provider ?? raw.metadata.provider)
        : providerForModel(modelId);
      return {
        provider,
        id: remoteId,
        kind: detectedKind,
        status: String(raw.status ?? "completed"),
        text: String(raw.text ?? ""),
        title: summarizeTitle(raw.text ?? "", raw.name),
        voiceId: meta.voiceId,
        voiceName: meta.voiceName,
        modelId,
        languageCode: meta.languageCode,
        voiceSettings: meta.voiceSettings,
        exportTranscript: Boolean(raw?.metadata?.export_transcript),
        charactersUsed: Number(raw.characters_used ?? 0),
        creditsDeducted:
          typeof raw.credits_deducted === "number" && Number.isFinite(raw.credits_deducted)
            ? raw.credits_deducted
            : undefined,
        createdAt: String(raw.created_at ?? ""),
        audioUrl: sanitizeRemoteMediaUrl(raw?.result?.audio_url, safeApiBase),
        srtUrl: sanitizeRemoteMediaUrl(raw?.result?.srt_url, safeApiBase),
        importedItemId: archived?.id ?? null,
      };
    };
    const ttsItems = extractHistoryTasks(ttsRes.data).map((r) => normalizeRemote(r, "tts"));
    const vcItems = extractHistoryTasks(vcRes.data).map((r) => normalizeRemote(r, "voice_changer"));
    const merged = [...ttsItems, ...vcItems].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return {
      items: kind === "all" ? merged : merged.filter((item) => item.kind === kind),
      hasMore: Boolean(ttsRes.data?.has_more || vcRes.data?.has_more),
      ...(vcWarning ? { warning: vcWarning } : {}),
    };
  };

  const importRemoteTask = async (taskId, kind = "tts", recovery = {}, { signal } = {}) => {
    signal?.throwIfAborted();
    const cleanId = String(taskId ?? "").trim();
    if (!cleanId) throw Object.assign(new Error("taskId is required"), { status: 400 });
    if (!isSafeRemoteId(cleanId)) {
      throw Object.assign(new Error("Invalid taskId"), { status: 400 });
    }
    const recipe =
      kind === "dialogue" &&
      (!recovery.dialogueRecipe?.connection || recovery.dialogueRecipe.connection === "genvoice")
        ? recovery.dialogueRecipe
        : undefined;
    const recipeSpeakers = sanitizeDialogueSpeakers(recipe?.speakers);
    const requestedTts =
      kind === "tts" &&
      (!recovery.requestedTts?.connection || recovery.requestedTts.connection === "genvoice")
        ? recovery.requestedTts
        : undefined;
    const parent =
      kind === "dialogue" && recovery.dialogueParentId
        ? getItem(recovery.dialogueParentId)
        : undefined;
    const existing = cloudArchiveItem(readStoreRaw(), cleanId);
    let speechReceipt = speechLedger()
      .list("speech-receipts")
      .find((row) => row.remoteTaskId === cleanId);
    if (!speechReceipt && !existing) {
      const saved = speechLedger()
        .list("speech-runs")
        .reverse()
        .flatMap((run) => run.jobs)
        .find((job) => job.remoteTaskId === cleanId && job.generationRecipe && job.kind === "tts");
      if (saved) speechReceipt = { ...saved, jobId: saved.id };
    }
    if (speechReceipt && kind !== "tts")
      throw Object.assign(new Error("This GenVoice task is a Speech generation"), { status: 409 });
    const accepted = PlaygroundTtsRecipe.safeParse(speechReceipt?.generationRecipe).data;
    const speechMetadata = accepted && ttsRecipeFields(accepted);
    const historyPath = (itemKind) =>
      itemKind === "voice_changer"
        ? `/voice-changer/history/${encodeURIComponent(cleanId)}`
        : `/history/${encodeURIComponent(cleanId)}`;
    const repairImported = async (existing) => {
      if (
        (accepted && needsSpeechRecipe(existing)) ||
        (isUnverifiedCloudSpeech(existing) && requestedTts && !existing.requestedTts)
      ) {
        const updated = await mutateStore((items) => {
          const index = items.findIndex((row) => row.id === existing.id);
          if (index < 0)
            throw Object.assign(new Error("Recording was removed. Import the task again."), {
              status: 404,
            });
          const current = items[index];
          if (accepted && needsSpeechRecipe(current)) {
            items[index] = {
              ...restoreSpeechRecipe(current, accepted),
              ...restorePcmAudio(current, accepted),
              copiedFrom: undefined,
              generationJobId: speechReceipt.jobId,
              ...(speechReceipt.batch ? { batch: speechReceipt.batch } : {}),
              tags: [
                ...new Set([
                  ...(current.tags ?? []),
                  ...extractAudioTags(speechMetadata.text),
                  ...(speechReceipt.batch?.label ? [speechReceipt.batch.label] : []),
                ]),
              ],
              updatedAt: new Date().toISOString(),
            };
          } else if (isUnverifiedCloudSpeech(current) && !current.requestedTts) {
            items[index] = {
              ...current,
              requestedTts,
              updatedAt: new Date().toISOString(),
            };
          }
          return items[index];
        });
        emit({ type: "item", item: updated });
        return { item: updated, alreadyImported: true };
      }
      if (
        !recipe ||
        Object.keys(recipeSpeakers ?? {}).length < 2 ||
        existing.kind === "voice_changer" ||
        existing.kind === "stt" ||
        existing.kind === "dubbing" ||
        (existing.kind === "tts" && !existing.cloudRecipeUnverified) ||
        Object.keys(existing.dialogue?.speakers ?? {}).length >= 2
      )
        return { item: existing, alreadyImported: true };
      const cast = Object.entries(recipeSpeakers);
      const primary = cast[0][1];
      const changed = await mutateStore((items) => {
        const index = items.findIndex((item) => item.id === existing.id);
        if (index < 0)
          throw Object.assign(new Error("Archived audio was removed. Import the task again."), {
            status: 404,
          });
        if (
          Object.keys(items[index].dialogue?.speakers ?? {}).length >= 2 ||
          (items[index].kind === "tts" && !items[index].cloudRecipeUnverified)
        )
          return items[index];
        items[index] = {
          ...items[index],
          kind: "dialogue",
          text: recipe.text,
          tags: [...new Set([...(items[index].tags ?? []), ...extractAudioTags(recipe.text)])],
          voiceId: primary.voice_id,
          voiceName: cast.map(([name, speaker]) => `${name}: ${speaker.voice_name}`).join(" / "),
          provider: primary.provider,
          modelId: primary.model_id,
          languageCode: primary.language_code ?? "",
          voiceSettings: primary.voice_settings,
          dialogue: {
            pause_between_turns: recipe.pause_between_turns ?? 0.5,
            speakers: recipeSpeakers,
          },
          ...(recipe.exportTranscript === undefined
            ? {}
            : { exportTranscript: recipe.exportTranscript }),
          ...(recipe.fromTemplateId ? { fromTemplateId: recipe.fromTemplateId } : {}),
          ...(recipe.notes && !items[index].notes ? { notes: recipe.notes } : {}),
          ...(parent?.kind === "dialogue" && parent.id !== existing.id
            ? { retry: { rootId: recordingRootId(parent), parentId: parent.id } }
            : {}),
          updatedAt: new Date().toISOString(),
        };
        return items[index];
      });
      emit({ type: "item", item: changed });
      return { item: changed, alreadyImported: true };
    };
    const finishExisting = async (existing) => {
      const result = await repairImported(existing);
      const item = withChargeEvidence(result.item);
      const needCaptions = !item.srtFile && !item.srtText;
      const audioPath = ownedMediaFile("audio", item.audioFile, SAFE_MEDIA_FILE);
      const playable = async () => {
        if (!audioPath) return false;
        const { size } = statSync(audioPath);
        if (Number.isFinite(item.bytes) && size !== item.bytes) return false;
        if (item.durationSeconds > 0 && size === item.bytes) return true;
        const bytes = readCheckedFileBytes(
          audioPath,
          MAX_AUDIO_BYTES,
          "Archived audio exceeds size limit",
        );
        if (item.pcmFormatPending) return isBinaryPcm(bytes);
        return containerHasAudio(sniffContainerMagic(bytes), bytes, signal);
      };
      const needAudio = !(await playable());
      if (
        !needAudio &&
        !needCaptions &&
        Number.isFinite(item.creditsDeducted) &&
        !hasProvisionalGenVoiceCharge(item)
      )
        return { ...result, item };
      let subtitles;
      const history = await genvoiceRequest(historyPath(item.kind), { signal }).catch((error) => {
        if (needAudio) throw error;
        return null;
      });
      if (history) {
        assertGenVoiceTaskIdentity(history.data, cleanId);
        if (needCaptions && history.data.result?.srt_url)
          subtitles = await downloadSrtText(
            history.data.result.srt_url,
            history.cfg.apiBase,
            signal,
          ).catch(() => undefined);
      }
      signal?.throwIfAborted();
      const observedCharge = reportedGenVoiceCredits(
        history?.data.credits_deducted,
        genVoiceTaskChargeSource(history?.data.status),
      );
      if (speechReceipt && observedCharge.creditsReported)
        storeSpeechReceipt({ ...speechReceipt, id: speechReceipt.jobId, ...observedCharge });
      const charge =
        observedCharge.creditsReported || Number.isFinite(item.creditsDeducted)
          ? observedCharge
          : reportedGenVoiceCredits(speechReceipt?.creditsDeducted, speechReceipt?.creditsSource);
      let repairedAudio;
      if (needAudio) {
        const task = history.data;
        if (task.status !== "completed" || !task.result?.audio_url)
          throw Object.assign(
            new Error(`Remote task ${cleanId} is not ready (${task.status ?? "unknown"})`),
            charge,
          );
        const outputFormat =
          item.generationRecipe?.effective.body.output_format ??
          task.metadata?.output_format ??
          item.outputFormat;
        repairedAudio = await archiveTaskMedia({
          audioUrl: task.result.audio_url,
          apiBase: history.cfg.apiBase,
          idBase: "pg_" + randomUUID(),
          outputFormat,
          signal,
        }).catch((error) => {
          throw Object.assign(error, charge);
        });
      }
      if (!repairedAudio && !subtitles && charge.creditsDeducted === undefined)
        return { ...result, item };
      const updated = await mutateStore((items) => {
        const index = items.findIndex((row) => row.id === item.id);
        if (index < 0)
          throw Object.assign(new Error("Recording was removed before recovery completed"), {
            status: 404,
          });
        const current = items[index];
        return (items[index] = {
          ...current,
          ...(repairedAudio && current.audioFile === item.audioFile
            ? {
                audioFile: repairedAudio.audioFile,
                bytes: repairedAudio.bytes,
                mimeType: repairedAudio.mimeType,
                durationSeconds: repairedAudio.durationSeconds,
                pcmFormatPending: undefined,
                replacedAudioFiles: recordingAudioFiles(current),
              }
            : {}),
          ...((observedCharge.creditsReported &&
            (current.creditsSource !== "history" ||
              !hasProvisionalGenVoiceCharge(observedCharge))) ||
          !Number.isFinite(withChargeEvidence(current).creditsDeducted)
            ? charge
            : {}),
          ...(subtitles && !current.srtFile && !current.srtText
            ? {
                srtFile: writeArchivedSrt(current.id, subtitles),
                srtText: subtitles,
                srtPending: false,
              }
            : {}),
          updatedAt: new Date().toISOString(),
        });
      });
      if (repairedAudio && updated.audioFile !== repairedAudio.audioFile) {
        const unused = ownedMediaFile("audio", repairedAudio.audioFile, SAFE_MEDIA_FILE);
        if (unused) rmSync(unused, { force: true });
      }
      emit({ type: "item", item: updated });
      return { ...result, item: withChargeEvidence(updated) };
    };
    const inflight = inflightImports.get(cleanId);
    if (inflight) {
      const result = await repairImported((await inflight).item);
      return { ...result, item: withChargeEvidence(result.item) };
    }
    const work = (async () => {
      if (existing) return finishExisting(existing);
      const { data: task, cfg } = await genvoiceRequest(historyPath(kind), { signal });
      assertGenVoiceTaskIdentity(task, cleanId);
      const observedCharge = reportedGenVoiceCredits(
        task.credits_deducted,
        genVoiceTaskChargeSource(task.status),
      );
      const charge = observedCharge.creditsReported
        ? observedCharge
        : reportedGenVoiceCredits(speechReceipt?.creditsDeducted, speechReceipt?.creditsSource);
      if (speechReceipt && observedCharge.creditsReported)
        storeSpeechReceipt({ ...speechReceipt, id: speechReceipt.jobId, ...observedCharge });
      if (task.status !== "completed" || !task?.result?.audio_url) {
        throw Object.assign(
          new Error(`Remote task ${cleanId} is not ready (${task.status ?? "unknown"})`),
          charge,
        );
      }
      const id =
        speechReceipt?.itemId && SAFE_MEDIA_FILE.test(`${speechReceipt.itemId}.wav`)
          ? speechReceipt.itemId
          : `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
      const media = await archiveTaskMedia({
        audioUrl: task.result.audio_url,
        srtUrl: task?.result?.srt_url,
        apiBase: cfg.apiBase,
        idBase: id,
        signal,
        allowProvisionalPcm: !accepted && !task?.metadata?.output_format,
        outputFormat: accepted
          ? accepted.effective.body.output_format
          : task?.metadata?.output_format
            ? String(task.metadata.output_format)
            : undefined,
      }).catch((error) => {
        throw Object.assign(error, charge);
      });
      const text = String(
        recipe?.text ?? speechMetadata?.text ?? task.text ?? `[imported] ${cleanId}`,
      );
      const now = String(task.created_at ?? new Date().toISOString());
      const importedSpeakers = accepted
        ? undefined
        : (recipeSpeakers ?? sanitizeDialogueSpeakers(task?.metadata?.speakers));
      const detectedKind = importedSpeakers ? "dialogue" : kind;
      const importedCast = Object.entries(importedSpeakers ?? {});
      const first = importedCast[0]?.[1];
      const voiceId = String(first?.voice_id ?? task.voice_id ?? task?.metadata?.voice_id ?? "");
      const modelId = String(
        first?.model_id ??
          task.model_id ??
          task?.metadata?.model_id ??
          (detectedKind === "voice_changer" ? "eleven_multilingual_sts_v2" : "eleven_v4"),
      );
      const item = {
        id,
        kind: detectedKind,
        cloudImported: !accepted,
        ...(detectedKind === "tts" ? { cloudRecipeUnverified: true, requestedTts } : {}),
        title: summarizeTitle(
          text,
          speechReceipt?.title ?? accepted?.requested.name ?? recipe?.name ?? task.name,
        ),
        text,
        tags: [
          ...new Set([
            ...extractAudioTags(text),
            ...(accepted && speechReceipt?.batch?.label ? [speechReceipt.batch.label] : []),
          ]),
        ],
        voiceId,
        voiceName: importedCast.length
          ? importedCast
              .map(([name, speaker]) => `${name}: ${speaker.voice_name || speaker.voice_id}`)
              .join(" / ")
          : String(task?.metadata?.voice_name ?? (voiceId || "Voice")),
        modelId,
        languageCode: String(first?.language_code ?? task?.metadata?.language_code ?? ""),
        voiceSettings:
          first?.voice_settings ??
          (isPlainObject(task?.metadata?.voice_settings) ? task.metadata.voice_settings : {}),
        ...(recipe?.fromTemplateId ? { fromTemplateId: recipe.fromTemplateId } : {}),
        ...(accepted?.requested.notes || recipe?.notes
          ? { notes: accepted?.requested.notes ?? recipe.notes }
          : {}),
        ...(parent?.kind === "dialogue"
          ? { retry: { rootId: recordingRootId(parent), parentId: parent.id } }
          : {}),
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
        exportTranscript: recipe?.exportTranscript ?? Boolean(task?.metadata?.export_transcript),
        ...(importedSpeakers
          ? {
              dialogue: {
                pause_between_turns:
                  clampNum(
                    recipe?.pause_between_turns ?? task?.metadata?.pause_between_turns,
                    0,
                    3,
                  ) ?? 0.5,
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
        ...charge,
        provider: ["elevenlabs", "minimax", "capcut"].includes(
          task.provider ?? task?.metadata?.provider,
        )
          ? (task.provider ?? task.metadata.provider)
          : providerForModel(modelId),
        ...(detectedKind === "tts" ? speechMetadata : {}),
        ...(detectedKind === "tts" && speechReceipt?.jobId
          ? { generationJobId: speechReceipt.jobId }
          : {}),
        ...(detectedKind === "tts" && accepted && speechReceipt?.batch
          ? { batch: speechReceipt.batch }
          : {}),
        favorite: false,
        isTemplate: false,
        createdAt: now,
        updatedAt: new Date().toISOString(),
      };
      let raceWinner = null;
      await mutateStore((items) => {
        const dup = cloudArchiveItem(items, cleanId);
        if (dup) {
          raceWinner = dup;
          return;
        }
        items.unshift(item);
      });
      if (raceWinner) {
        if (media.audioFile && media.audioFile !== raceWinner.audioFile && existsSync(audioDir)) {
          rmSync(join(audioDir, media.audioFile), { force: true });
        }
        if (media.srtFile && media.srtFile !== raceWinner.srtFile && existsSync(srtDir)) {
          rmSync(join(srtDir, media.srtFile), { force: true });
        }
        return finishExisting(raceWinner);
      }
      emit({ type: "item", item });
      return { item, alreadyImported: false };
    })();

    inflightImports.set(cleanId, work);
    try {
      const result = await work;
      const recoveredJob = jobs.get(result.item.generationJobId);
      if (recoveredJob?.status === "failed") {
        Object.assign(recoveredJob, {
          status: "completed",
          itemId: result.item.id,
          progress: 100,
          error: undefined,
          ...reportedGenVoiceCredits(result.item.creditsDeducted, result.item.creditsSource),
        });
        emit({ type: "job", job: { ...recoveredJob } });
      }
      return result;
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
      protectRecording(itemId);
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
      const words = recordingWords(item);
      if (words.length)
        writeAtomic(`${dest}.words.json`, JSON.stringify({ words, dur: item.durationSeconds }));
      else rmSync(`${dest}.words.json`, { force: true });
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
    library.rememberAlternative({
      takeId,
      file: tryFile,
      itemId: item.id,
      scope,
      title: item.title,
      audioHash: createHash("sha256").update(readFileSync(dest)).digest("hex"),
    });
    opts.onVoiceChanged?.();
    return { ok: true, takeId, tryFile };
  };

  const safeMediaPath = (kind, rawFile) => {
    const file = typeof rawFile === "string" ? rawFile : "";
    if (kind === "audio" && !SAFE_MEDIA_FILE.test(file)) return null;
    if (kind === "srt" && !SAFE_SRT_FILE.test(file)) return null;
    if (kind === "video" && !SAFE_DUBBING_VIDEO_FILE.test(file)) return null;
    if (kind === "sources" && !SAFE_DUBBING_SOURCE_FILE.test(file)) return null;
    const dir = kind === "audio" ? audioDir : kind === "srt" ? srtDir : join(storageDir, kind);
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

  const saveSource = ({ bytes, name }) => {
    if (!bytes?.byteLength || bytes.byteLength > MAX_STT_BYTES)
      throw Object.assign(new Error("Upload audio between 1 byte and 90 MB"), { status: 400 });
    return { sourceFile: persistUploadSource(bytes, name, ".mp3"), sourceLabel: name };
  };
  const archiveTemplateSource = (draft) => {
    if (draft.mode === "dubbing") return dubbing.retainDubbingTemplateSource(draft);
    if (draft.mode === "stt") {
      const [kind, ...file] = String(draft.sttSourceTakeValue ?? "").split(":");
      const input =
        draft.sttSourceKind === "upload"
          ? { sourceFile: draft.sttSourceFile }
          : draft.sttSourceKind === "playground"
            ? { sourceItemId: draft.sttSourceItemId }
            : { sourceTakeKind: kind, sourceTakeFile: file.join(":") };
      if (!input.sourceFile && !input.sourceItemId && !input.sourceTakeFile) return draft;
      const source = resolveSourceAudio({ ...input, maxBytes: MAX_STT_BYTES });
      return {
        ...draft,
        sttSourceKind: "upload",
        sttSourceFile: source.sourceFile || persistUploadSource(source.bytes, source.name, ".mp3"),
        sttSourceLabel: draft.sttSourceLabel || source.label,
        sttSourceItemId: "",
        sttSourceTakeValue: "",
      };
    }
    if (draft.mode !== "voice_changer") return draft;
    const [kind, ...file] = String(draft.vcSourceTakeValue ?? "").split(":");
    const input =
      draft.vcSourceKind === "upload"
        ? { sourceFile: draft.vcSourceFile }
        : draft.vcSourceKind === "playground"
          ? { sourceItemId: draft.vcSourceItemId }
          : { sourceTakeKind: kind, sourceTakeFile: file.join(":") };
    if (!input.sourceFile && !input.sourceItemId && !input.sourceTakeFile) return draft;
    const source = resolveSourceAudio({ ...input, maxBytes: MAX_UPLOAD_BYTES });
    const saved = source.sourceFile
      ? { sourceFile: source.sourceFile }
      : saveSource({ bytes: source.bytes, name: source.name });
    return {
      ...draft,
      vcSourceKind: "upload",
      vcSourceFile: saved.sourceFile,
      vcSourceItemId: "",
      vcSourceTakeValue: "",
    };
  };
  const library = createPlaygroundLibrary({
    archiveTemplateSource,
    scope,
    project: opts.project,
    storageDir,
    emit,
    getItem,
    mutateStore,
    protectRecording,
    ensureSafeDir,
    shared,
    metadata,
    voice: opts.voice,
    onVoiceChanged: opts.onVoiceChanged,
    audioFavorites: opts.audioFavorites,
    cachedVoices: opts.cachedVoices,
    onAudioFavoritesChanged: opts.onAudioFavoritesChanged,
    apiBase: () => resolveKeyConfig().apiBase,
    parentController: opts.parentController,
    getController: () => controller,
    createScope: (nextScope) =>
      openVoicePlayground({ ...opts, globalDir, scope: nextScope, parentController: controller }),
  });
  const { forScope } = library;
  const cloning = createPlaygroundClones({
    scope,
    projectKey: resolve(opts.project ?? storageDir),
    storageDir,
    metadata,
    shared,
    request: (path, init) => genvoiceRequest(path, init).then((result) => result.data),
    download: downloadMediaWithRedirects,
    apiBase: () => resolveKeyConfig().apiBase,
    getCatalog,
    getController: () => controller,
    emit,
    baseFavorites: library.listVoiceFavorites,
    baseSetFavorite: library.setVoiceFavorite,
  });
  const dubbing = createPlaygroundDubbing({
    scope,
    projectKey: resolve(opts.project ?? storageDir),
    storageDir,
    metadata,
    shared,
    request: genvoiceRequest,
    apiBase: () => resolveKeyConfig().apiBase,
    download: (input) =>
      downloadDubbingFile({
        ...input,
        fetchImpl,
        checkUrl: (url) => assertSafeMediaUrl(url, resolveKeyConfig().apiBase, lookupFn),
      }),
    saveItem: async (item) => {
      const saved = await mutateStore((items) => {
        if (closed) throw new Error("Dubbing workspace closed; resume from saved progress");
        const existing = items.find((entry) => entry.id === item.id);
        if (existing) return existing;
        items.unshift(item);
        return item;
      });
      emit({ type: "item", item: saved });
      return saved;
    },
    getController: () => controller,
    assertVoiceAvailable: cloning.assertCloneAvailable,
    emit,
    pollMs: pollIntervalMs,
    ensureStorage: () => {
      for (const folder of ["audio", "srt", "sources", "video"])
        ensureSafeDir(join(storageDir, folder));
    },
  });
  const waitForJob = (id) => {
    const pending = jobPromises.get(id);
    if (!pending) throw new Error("Job unavailable; refresh the queue");
    return pending;
  };
  const editing = createPlaygroundEditing({
    getController: () => controller,
    filmRegionSource: library.filmRegionSource,
    synthesizePhrase: async (input) => {
      const { jobs: children } = await startTts({ ...input, variations: 1 });
      return waitForJob(children[0].id);
    },
  });
  const queueRegionEdit = (parent, input, resume) => {
    protectRecording(parent.id);
    if (resume?.replacementItemId) protectRecording(resume.replacementItemId);
    const job = {
      id: `edit_${randomUUID()}`,
      kind: "region_edit",
      scope,
      regionEdit: { itemId: parent.id, input, replacementItemId: resume?.replacementItemId },
      connection: input.mode === "local" ? parent.connection : input.connection,
      status: "processing",
      progress: 0,
      title: input.name?.trim() || `${parent.title} · edited`,
      voiceId: input.mode === "local" ? parent.voiceId : input.voiceId,
      voiceName: input.mode === "local" ? parent.voiceName : input.voiceName || input.voiceId,
      modelId: input.mode === "local" ? "Local audio edit" : input.modelId || "eleven_v4",
      createdAt: new Date().toISOString(),
    };
    trackJob(job, () =>
      editing.createVersion(parent.id, input, { ...resume, parentJobId: job.id }),
    );
    return { job: { ...job } };
  };

  const waitForAllJobs = async () => [
    ...(await Promise.allSettled(pendingPromises)),
    ...(await dubbing.waitForDubbing()),
  ];

  const controller = {
    ...library,
    ...cloning,
    ...dubbing,
    startRegionEdit: async (id, input) =>
      queueRegionEdit(await editing.assertSelection(id, input), input),
    resumeRegionEdit: async (id, { edit, replacementItemId }) =>
      queueRegionEdit(await editing.assertSelection(id, edit), edit, { replacementItemId }),
    inspectFilmRegion: editing.inspectFilmRegion,
    previewFilmRegion: editing.previewFilmRegion,
    startFilmRegionEdit: async (takeId, input, sourceId) =>
      queueRegionEdit(await editing.saveFilmRegionSource(takeId, input, sourceId), input),
    inspectRegion: editing.inspectRegion,
    previewRegion: editing.previewRegion,
    listVersions: editing.listVersions,
    saveSource,
    readSource: resolveSourceAudio,
    scope,
    close: () => {
      if (closed) return;
      closed = true;
      if (archiveTimer) clearInterval(archiveTimer);
      dubbing.closeDubbing();
      projectArchive?.close();
      sharedArchive?.close();
      speechArchive?.close();
      library.closeOtherScope();
    },
    storageDir,
    hasArchiveIndex,
    getStatus,
    setConfig,
    getCatalog,
    searchSharedVoices,
    searchCastingVoices,
    searchCachedVoices,
    findFavoriteVoices: (query) =>
      findFavoriteVoices(
        cloning.listVoiceFavorites(),
        query,
        library.listCreatorProfiles(),
        library.listVoiceProfiles({ includeGlobal: true }),
      ),
    setVoiceFavorites: async ({ voices, favorite }) => {
      const failed = [];
      for (const voice of voices) {
        try {
          await cloning.setVoiceFavorite(voice, favorite);
        } catch (error) {
          failed.push({
            id: voice.id,
            provider: voice.provider,
            connection: voice.connection,
            error: error.message,
          });
        }
      }
      return { voices: cloning.listVoiceFavorites(), failed };
    },
    downloadVoicePreview,
    listItems,
    findRecordings: (query) => {
      const items = listItems(query);
      if (!query.creatorId) return findVoiceRecordings(items, query);
      const creators = new Map();
      const sources = [
        ...library.listVoiceProfiles({ includeGlobal: true }).map(({ voice }) => voice),
        ...cloning.listVoiceFavorites(),
        ...(opts.cachedVoices?.() ?? []),
      ];
      for (const voice of sources) {
        const id = voiceIdentity(voice);
        if (voice.creatorId && !creators.has(id)) creators.set(id, voice.creatorId);
      }
      return findVoiceRecordings(items, query, (voice, item) =>
        creators.get(
          voiceIdentity({
            id: voice.voiceId,
            connection: voice.connection ?? item.connection,
            provider: voice.provider ?? item.provider,
          }),
        ),
      );
    },
    rankVoiceUsage: (query) =>
      rankVoiceUsage(
        listItems(query),
        library
          .listUsage()
          .filter((use) => use.scope === scope || (scope === "project" && query.includeGlobal)),
        query,
      ),
    saveTemplateFromRecording: async (id, metadata) => {
      const item = getItem(id);
      if (!item)
        throw Object.assign(new Error("Recording not found in this library"), { status: 404 });
      const draft = recordingTemplateDraft(item, getItem);
      const title = metadata.title ?? (item.title || "Voice template").slice(0, 120);
      return library.saveTemplate({ ...metadata, title, draft: { ...draft, title } });
    },
    templateRecipe: (id) => {
      const template = library.getTemplate(id);
      if (!template)
        throw Object.assign(new Error("Template not found in this library"), { status: 404 });
      return voiceTemplateRecipe(template);
    },
    listJobs,
    getItem,
    startTts,
    inspectRecordingMedia: async (id) => {
      const item = getItem(id);
      const file = item?.audioFile && safeMediaPath("audio", item.audioFile);
      if (!file)
        throw Object.assign(new Error("Recording audio not found in this library"), {
          status: 404,
        });
      const requested = item.generationRecipe?.requested?.outputFormat ?? item.outputFormat ?? null;
      const sent =
        item.generationRecipe?.effective?.body?.output_format ?? item.outputFormat ?? null;
      const media = await probeAudioMedia(file).catch(() => {
        throw Object.assign(new Error("Unable to inspect saved audio with ffprobe"), {
          status: 422,
        });
      });
      return { id, requestedOutputFormat: requested, sentOutputFormat: sent, media };
    },
    quoteTtsBatch,
    startTtsBatch,
    getSpeechReceipt,
    startDialogue,
    startVoiceChanger,
    runSpeechToText,
    startSpeechToText,
    resumeSpeechToText: ({ taskId, ...input }) => startSpeechToText(input, taskId),
    patchItem,
    patchItems,
    recordingArchivePolicy,
    previewExpiredRecordings,
    purgeExpiredRecordings,
    deleteItem,
    retryItem,
    fetchRemoteHistory,
    getSpeechRun,
    importRemoteTask,
    promoteToFilmTake,
    audioFile: (file) => safeMediaPath("audio", file),
    srtFile: (file) => safeMediaPath("srt", file),
    dubbingAsset: (id, asset) => {
      const item = getItem(id);
      if (item?.kind !== "dubbing") return null;
      return asset === "source"
        ? safeMediaPath("sources", item.dubbing?.sourceFile)
        : asset === "result"
          ? item.dubbing?.resultFile && !item.version?.edit
            ? safeMediaPath("video", item.dubbing.resultFile)
            : safeMediaPath("audio", item.audioFile)
          : null;
    },
    waitForAllJobs,
    waitForJob,
  };
  if (opts.archiveExpiry && !opts.parentController) {
    const expireArchived = async () => {
      for (const library of [controller, forScope("global")]) {
        if (closed) break;
        const { eligible } = library.previewExpiredRecordings();
        await library.purgeExpiredRecordings(eligible.slice(0, 100).map(({ id }) => id));
      }
    };
    const sweep = () =>
      void expireArchived().catch((error) =>
        console.warn("Voice Playground archive cleanup:", error.message),
      );
    archiveTimer = setInterval(sweep, 60 * 60 * 1000);
    archiveTimer.unref();
    sweep();
  }
  return controller;
};
