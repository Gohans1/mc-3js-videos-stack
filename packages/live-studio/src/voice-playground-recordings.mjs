import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

import {
  AUDIO_TAG_RE,
  DANGEROUS_KEYS,
  isUnverifiedCloudSpeech,
  recordingWords,
  stripDialogueSpeakerBrackets,
} from "./voice-playground-text.mjs";

const toSeconds = (value) => {
  const [hours, minutes, seconds] = value.replace(",", ".").split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};

export const parseSrtCues = (srt) =>
  srt
    .split(/\r?\n[ \t]*\r?\n/)
    .flatMap((block) => {
      const match =
        /^(\d+:\d{2}:\d{2}[,.]\d{3})[ \t]*-->[ \t]*(\d+:\d{2}:\d{2}[,.]\d{3})[^\r\n]*\r?\n([\s\S]+)/m.exec(
          block,
        );
      if (!match) return [];
      const from = toSeconds(match[1]),
        to = toSeconds(match[2]),
        text = match[3].trim();
      return text && to >= from ? [{ text, from, to }] : [];
    })
    .sort((a, b) => a.from - b.from);

export function srtAsWebVtt(srt) {
  const timestamp = (seconds) => {
    const millis = Math.round(seconds * 1000);
    const hours = String(Math.floor(millis / 3_600_000)).padStart(2, "0");
    const minutes = String(Math.floor(millis / 60_000) % 60).padStart(2, "0");
    const second = String(Math.floor(millis / 1000) % 60).padStart(2, "0");
    return `${hours}:${minutes}:${second}.${String(millis % 1000).padStart(3, "0")}`;
  };
  return (
    "WEBVTT\n\n" +
    parseSrtCues(srt)
      .map(
        ({ from, to, text }) =>
          `${timestamp(from)} --> ${timestamp(to)}\n${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}`,
      )
      .join("\n\n") +
    "\n"
  );
}

export function recordingCaptions(item, resolveSrt) {
  const words = recordingWords(item)
    .filter(
      (word) =>
        typeof word?.w === "string" &&
        word.w.trim() &&
        Number.isFinite(word.s) &&
        Number.isFinite(word.e) &&
        word.s >= 0 &&
        word.e >= word.s,
    )
    .map(({ w, s, e, speakerId }) => ({ text: w, from: s, to: e, speakerId }))
    .sort((a, b) => a.from - b.from);
  const plain =
    ["tts", "dialogue", "stt"].includes(item.kind) &&
    !String(item.text ?? "").startsWith("[imported] ")
      ? stripDialogueSpeakerBrackets(item.text).replace(AUDIO_TAG_RE, "").trim()
      : "";
  if (words.length)
    return {
      source: "words",
      parts: words,
      text: item.sttResult?.text?.trim() || plain || words.map((p) => p.text).join(" "),
    };
  const file = !item.srtText && item.srtFile ? resolveSrt(item.srtFile) : null;
  const srt = item.srtText || item.sttResult?.srtText || (file ? readFileSync(file, "utf8") : "");
  const cues = parseSrtCues(srt);
  if (cues.length)
    return { source: "cues", parts: cues, text: cues.map(({ text }) => text).join("\n") };
  return { source: "script", parts: [], text: plain };
}

export const foldVoiceText = (value = "") =>
  String(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d");

const castEntries = (speakers) =>
  Object.entries(speakers ?? {}).filter(
    ([name, voice]) => !DANGEROUS_KEYS.has(name) && voice?.voice_id,
  );
const recordingVoices = (item) => {
  const cast = castEntries(item.dialogue?.speakers);
  return [
    ...(cast.length
      ? cast.map(([speaker, voice]) => ({
          speaker,
          voiceId: voice.voice_id,
          voiceName: voice.voice_name,
          modelId: voice.model_id || item.modelId,
          provider: voice.provider || item.provider,
          connection: item.connection,
          creatorId: voice.creatorId,
          languageCode: voice.language_code || item.languageCode,
        }))
      : [item]),
    ...(item.voicesUsed ?? []),
    ...(item.version?.replacement ? [item.version.replacement] : []),
  ];
};
const recordedProject = (item) =>
  item.originProject ||
  String(item.filmTakeSource?.project ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);

export function rankVoiceLibrary(items, query, fields) {
  const tokens = foldVoiceText(query)
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 24);
  if (!tokens?.length) return [];
  const db = new Database(":memory:");
  try {
    db.run("CREATE VIRTUAL TABLE docs USING fts5(label, actor, details, script)");
    const insert = db.prepare(
      "INSERT INTO docs(rowid, label, actor, details, script) VALUES (?, ?, ?, ?, ?)",
    );
    db.transaction(() => {
      for (const [index, item] of items.entries())
        insert.run(index + 1, ...fields(item).map(foldVoiceText));
    })();
    const results = db
      .query("SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY bm25(docs, 5, 3, 2, 1), rowid")
      .all(tokens.map((token) => `"${token}"*`).join(" AND "));
    return results.map(({ rowid }) => items[rowid - 1]);
  } finally {
    db.close();
  }
}

export function findVoiceRecordings(items, query, knownCreator = () => undefined) {
  const {
    q,
    kind,
    connection,
    provider,
    voiceId,
    creatorId,
    batchId,
    modelId,
    language,
    gender,
    tag,
    project,
    favorite,
    archived = false,
    minRating,
    maxRating,
    minSeconds,
    maxSeconds,
    after,
    before,
    sort = q ? "relevance" : "newest",
    page = 0,
    pageSize = 30,
  } = query;
  const start = after ? Date.parse(after) : -Infinity;
  const end = before ? Date.parse(before) + 86400000 : Infinity;
  let matches = items.filter((item) => {
    const date = Date.parse(item.createdAt);
    const rating = item.rating ?? 0;
    return (
      (!kind || item.kind === kind) &&
      (!connection || (item.connection ?? "genvoice") === connection) &&
      (!batchId || item.batch?.id === batchId) &&
      (!(provider || voiceId || creatorId || modelId || language) ||
        recordingVoices(item).some(
          (voice) =>
            (!provider || (voice.provider ?? "elevenlabs") === provider) &&
            (!voiceId || voice.voiceId === voiceId) &&
            (!creatorId || (voice.creatorId ?? knownCreator(voice, item)) === creatorId) &&
            (!modelId || voice.modelId === modelId) &&
            (!language || foldVoiceText(voice.languageCode) === foldVoiceText(language)),
        )) &&
      (!tag || item.tags?.some((entry) => foldVoiceText(entry) === foldVoiceText(tag))) &&
      (!gender || foldVoiceText(item.voiceGender) === foldVoiceText(gender)) &&
      (!project || foldVoiceText(recordedProject(item)) === foldVoiceText(project)) &&
      (favorite === undefined || Boolean(item.favorite) === favorite) &&
      Boolean(item.archivedAt) === archived &&
      rating >= (minRating ?? 0) &&
      rating <= (maxRating ?? 5) &&
      (minSeconds === undefined || item.durationSeconds >= minSeconds) &&
      (maxSeconds === undefined || item.durationSeconds <= maxSeconds) &&
      (!after || date >= start) &&
      (!before || date < end)
    );
  });
  matches.sort(
    (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id),
  );
  if (q)
    matches = rankVoiceLibrary(matches, q, (item) => [
      item.title,
      recordingVoices(item)
        .flatMap(({ speaker, voiceId, voiceName, modelId }) => [
          speaker,
          voiceId,
          voiceName,
          modelId,
        ])
        .join(" "),
      [item.description, item.notes, ...(item.tags ?? [])].join(" "),
      item.text,
    ]);
  const sorters = {
    newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    oldest: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
    shortest: (a, b) => (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0),
    longest: (a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  };
  if (sort !== "relevance") matches.sort(sorters[sort]);
  const offset = page * pageSize;
  return {
    items: matches.slice(offset, offset + pageSize),
    total: matches.length,
    page,
    pageSize,
    hasMore: offset + pageSize < matches.length,
  };
}

export function rankVoiceUsage(
  items,
  usage,
  { sort = "in-film", provider, page = 0, pageSize = 30 } = {},
) {
  const counts = new Map();
  const count = (voices, owner, field, id) => {
    for (const voice of voices) {
      const { voiceId, voiceName } = voice;
      const engine = voice.provider ?? owner.provider ?? "elevenlabs";
      if (
        !voiceId ||
        (voice.connection ?? owner.connection ?? "genvoice") !== "genvoice" ||
        (provider && provider !== engine)
      )
        continue;
      const key = `${engine}:${voiceId}`;
      const result = counts.get(key) ?? {
        voiceId,
        voiceName: voiceName || voiceId,
        provider: engine,
        recordings: new Set(),
        inFilm: new Set(),
      };
      result[field].add(id);
      counts.set(key, result);
    }
  };
  for (const use of usage)
    count(use.voices?.length ? use.voices : [use], use, "inFilm", use.takeId);
  for (const item of items) {
    const id =
      item.remoteTaskId && !item.version
        ? `${item.kind}:${item.remoteTaskId}`
        : (item.copiedFrom?.id ?? item.id);
    count(recordingVoices(item), item, "recordings", id);
  }
  const voices = [...counts.values()].map((entry) => ({
    ...entry,
    recordings: entry.recordings.size,
    inFilm: entry.inFilm.size,
    takeIds: [...entry.inFilm].sort((a, b) => a.localeCompare(b)),
  }));
  const [first, second] =
    sort === "recordings" ? ["recordings", "inFilm"] : ["inFilm", "recordings"];
  voices.sort(
    (a, b) =>
      b[first] - a[first] ||
      b[second] - a[second] ||
      a.voiceName.localeCompare(b.voiceName) ||
      a.voiceId.localeCompare(b.voiceId),
  );
  const offset = page * pageSize;
  return {
    voices: voices.slice(offset, offset + pageSize),
    total: voices.length,
    page,
    pageSize,
    hasMore: offset + pageSize < voices.length,
  };
}

export function recordingRecipe(item, getItem = () => null) {
  const connection = item.connection ?? "genvoice";
  const metadata = {
    recordingId: item.id,
    scope: item.scope,
    originProject: recordedProject(item),
    rights: item.rights,
    version: item.version,
    fallbackNote: item.fallbackNote,
  };
  const common = {
    connection,
    name: item.title,
    notes: item.notes,
    fromTemplateId: item.fromTemplateId,
  };
  const version = item.version;
  if (version) {
    const parent = version.parentId && getItem(version.parentId);
    const argument = parent?.id ?? version.parentId;
    const edit = version.edit;
    if (parent?.audioFile && edit?.mode === "local")
      return {
        ...metadata,
        argument,
        command: "region edit",
        input: edit,
      };
    const replacement = version.replacement?.id && getItem(version.replacement.id);
    if (parent?.audioFile && replacement?.audioFile && edit?.mode === "regenerate") {
      const { rate: _rate, ...settings } = edit;
      return {
        ...metadata,
        argument,
        command: "region resume",
        input: {
          replacementItemId: replacement.id,
          edit: { ...settings, voiceId: replacement.voiceId },
        },
      };
    }
    return {
      ...metadata,
      command: null,
      reason:
        "Open the archived audio. The original or replacement audio needed to repeat the edit is missing from this library.",
    };
  }
  if (isUnverifiedCloudSpeech(item))
    return {
      ...metadata,
      requestedInput: item.requestedTts,
      command: null,
      reason:
        "This Cloud recording has audio and available metadata. The settings accepted for the original request were unavailable.",
    };
  if (item.kind === "tts" && item.generationRecipe) {
    const { requested, effective } = item.generationRecipe;
    const body = effective.body;
    return {
      ...metadata,
      command: "generate tts",
      input: {
        ...requested,
        variations: 1,
        text: body.text,
        modelId: body.model_id,
        provider: body.provider,
        languageCode: body.language_code,
        voiceSettings: body.voice_settings,
        preserveSettings: true,
        previousText: body.previous_text,
        nextText: body.next_text,
        seed: body.seed,
        outputFormat: body.output_format,
        applyTextNormalization: body.apply_text_normalization,
        exportTranscript: Boolean(body.export_transcript),
      },
      requestedInput: requested,
      effectiveRequest: effective,
    };
  }
  if (
    item.kind === "tts" &&
    item.voiceId &&
    item.modelId &&
    item.text?.trim() &&
    !item.text.startsWith("[imported] ")
  )
    return {
      ...metadata,
      command: "generate tts",
      input: {
        ...common,
        text: item.text,
        voiceId: item.voiceId,
        voiceName: item.voiceName,
        creatorId: item.creatorId,
        modelId: item.modelId,
        languageCode: item.languageCode,
        voiceSettings: item.voiceSettings,
        ...(connection === "genvoice" ? { provider: item.provider } : {}),
        speechStyle: item.speechStyle,
        previousText: item.previousText,
        nextText: item.nextText,
        seed: item.seed,
        outputFormat: item.outputFormat,
        applyTextNormalization: item.applyTextNormalization,
        exportTranscript: item.exportTranscript,
        sourceTakeId: item.sourceTakeId,
      },
    };
  if (item.kind === "dialogue") {
    const cast = castEntries(item.dialogue?.speakers);
    if (cast.length >= 2 && item.text)
      return {
        ...metadata,
        command: "generate dialogue",
        input: {
          ...common,
          text: item.text,
          exportTranscript: item.exportTranscript,
          speakers: Object.fromEntries(
            cast.map(([name, voice]) => [
              name,
              connection === "genvoice"
                ? voice
                : {
                    voice_id: voice.voice_id,
                    voice_name: voice.voice_name,
                    speech_style: voice.speech_style,
                  },
            ]),
          ),
          ...(connection === "genvoice"
            ? { pause_between_turns: item.dialogue.pause_between_turns }
            : {
                modelId: item.modelId,
                languageCode: item.languageCode,
                voiceSettings: item.voiceSettings,
                seed: item.seed,
                outputFormat: item.outputFormat,
              }),
        },
      };
  }
  if (item.kind === "voice_changer" && item.voiceChanger) {
    const source = item.voiceChanger;
    const sourceItemId =
      source.sourceItemId && (item.scope !== "global" || getItem(source.sourceItemId))
        ? source.sourceItemId
        : undefined;
    if (source.sourceFile || sourceItemId || (item.scope !== "global" && source.sourceTakeFile))
      return {
        ...metadata,
        command: "generate voice-changer",
        input: {
          sourceFile: source.sourceFile,
          sourceItemId,
          sourceTakeKind: item.scope === "global" ? undefined : source.sourceTakeKind,
          sourceTakeFile: item.scope === "global" ? undefined : source.sourceTakeFile,
          voiceId: item.voiceId,
          voiceName: item.voiceName,
          modelId: item.modelId,
          voiceSettings: item.voiceSettings,
          seed: item.seed,
          name: item.title,
          notes: item.notes,
          removeBackgroundNoise: source.remove_background_noise,
        },
      };
  }
  if (item.kind === "stt" && item.audioFile && item.transcription?.settings)
    return {
      ...metadata,
      originalSettings: item.transcription.settings,
      command: "transcribe",
      input: {
        ...item.transcription.settings,
        sourceItemId: item.id,
        ...(item.transcription.settings.fileFormat === "pcm_s16le_16" &&
        item.audioFile.endsWith(".wav")
          ? { fileFormat: "other" }
          : {}),
      },
    };
  return {
    ...metadata,
    command: null,
    reason:
      item.kind === "dubbing"
        ? "Use the linked Dubbing job to repeat this take."
        : "This recording is missing a complete generation recipe.",
    ...(item.dubbing?.jobId ? { dubbingJobId: item.dubbing.jobId } : {}),
  };
}

export function findVoiceTemplates(
  templates,
  { q, mode, favorite, tag, minRating, page = 0, pageSize = 30 },
) {
  let matches = templates.filter(
    (template) =>
      (!mode || template.draft?.mode === mode) &&
      (favorite === undefined || Boolean(template.favorite) === favorite) &&
      (!tag || template.tags?.some((value) => foldVoiceText(value) === foldVoiceText(tag))) &&
      (template.rating ?? 0) >= (minRating ?? 0),
  );
  matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  if (q)
    matches = rankVoiceLibrary(matches, q, (template) => [
      template.title,
      [
        template.draft?.voiceName,
        template.draft?.voiceId,
        template.draft?.modelId,
        ...(template.draft?.speakers ?? []).flatMap((voice) => [
          voice.name,
          voice.voiceId,
          voice.voiceName,
          voice.modelId,
        ]),
      ].join(" "),
      [template.description, template.draft?.notes, ...(template.tags ?? [])].join(" "),
      template.draft?.text,
    ]);
  const offset = page * pageSize;
  return {
    templates: matches.slice(offset, offset + pageSize),
    total: matches.length,
    page,
    pageSize,
    hasMore: offset + pageSize < matches.length,
  };
}
