import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { alignmentToWords } from "../../../scripts/voice/genvoice.ts";
import {
  isSafeRemoteId,
  maskApiKey,
  MAX_AUDIO_BYTES,
  readBoundedBytes,
  wrapPcm16ToWav,
  writeAtomic,
} from "./voice-playground-genvoice.mjs";

const ELEVENLABS = "https://api.elevenlabs.io";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const ELEVEN_MODELS = [
  ["eleven_v4", "Eleven v4", 10000],
  ["eleven_v3", "Eleven v3", 5000],
  ["eleven_multilingual_v2", "Eleven Multilingual v2", 10000],
  ["eleven_flash_v2_5", "Eleven Flash v2.5", 40000],
  ["eleven_turbo_v2_5", "Eleven Turbo v2.5", 40000],
];
const GEMINI_VOICES =
  "Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat".split(
    " ",
  );
const FORMATS = {
  mp3: ".mp3",
  opus: ".ogg",
  pcm: ".wav",
  wav: ".wav",
};
const ELEVEN_FORMATS = new Set([
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
  ...[32, 64, 96, 128, 192].map((bitrate) => `opus_48000_${bitrate}`),
  ...["pcm", "wav"].flatMap((codec) =>
    [8000, 16000, 22050, 24000, 32000, 44100, 48000].map((sampleRate) => `${codec}_${sampleRate}`),
  ),
]);
const MAX_AUDIO_JSON_BYTES = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4 * 1024 * 1024;
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const readJson = async (response, label, limit = 4 * 1024 * 1024) =>
  JSON.parse((await readBoundedBytes(response, limit, label)).toString("utf8"));
const dialogueWords = (alignment, segments, turns) => {
  if (!turns || !Array.isArray(segments) || !Array.isArray(alignment.characters)) {
    return alignmentToWords(alignment).words;
  }
  const ranges = [];
  for (const segment of segments) {
    const start = segment?.character_start_index;
    const end = segment?.character_end_index;
    const turn = turns[segment?.dialogue_input_index];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > alignment.characters.length ||
      !turn
    )
      continue;
    const previous = ranges.at(-1);
    if (previous?.turn === turn && previous.end === start) previous.end = end;
    else ranges.push({ start, end, turn });
  }
  return ranges.length
    ? ranges.flatMap(({ start, end, turn }) =>
        alignmentToWords({
          characters: alignment.characters.slice(start, end),
          character_start_times_seconds: (alignment.character_start_times_seconds ?? []).slice(
            start,
            end,
          ),
          character_end_times_seconds: (alignment.character_end_times_seconds ?? []).slice(
            start,
            end,
          ),
        }).words.map((word) => ({ ...word, speakerId: turn.speaker })),
      )
    : alignmentToWords(alignment).words;
};
const EN_VI = [
  { code: "en", name: "English" },
  { code: "vi", name: "Vietnamese" },
];
const googleBuiltIns = GEMINI_VOICES.map((id) => ({
  connection: "google",
  id,
  name: id,
  category: "prebuilt",
  source: "default",
}));
const modelInfo = (connection, { model_id, name, description, ...added }) => ({
  ...(connection === "elevenlabs" ? { provider: connection } : {}),
  model_id,
  name: name ?? model_id,
  description: description ?? "",
  can_do_text_to_speech: true,
  can_do_voice_conversion: false,
  can_use_style: false,
  can_use_speaker_boost: false,
  model_rates: {},
  languages: EN_VI.filter(({ code }) => model_id !== "eleven_multilingual_v2" || code !== "vi").map(
    ({ code, name: language }) => ({ language_id: code, name: language }),
  ),
  ...added,
});

const audioFromBase64 = (data, label) => {
  if (
    typeof data !== "string" ||
    !data.length ||
    data.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3)
  ) {
    throw new Error(`${label} returned missing or oversized audio`);
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES)
    throw new Error(`${label} returned invalid audio`);
  return bytes;
};

export const openDirectVoiceConnections = ({ env, fetchImpl, configFile }) => {
  const readOverrides = () => {
    try {
      if (lstatSync(configFile).isSymbolicLink()) return {};
      const parsed = JSON.parse(readFileSync(configFile, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch (err) {
      if (err?.code === "ENOENT") return {};
      throw new Error("Could not read voice service connection settings.");
    }
  };
  const envKey = (connection) => {
    if (connection === "elevenlabs") return env.ELEVENLABS_API_KEY?.trim() ?? "";
    if (connection === "google")
      return env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || "";
    return "";
  };
  const overrideKey = (overrides, connection) =>
    typeof overrides[connection] === "string" ? overrides[connection].trim() : "";
  const keyFor = (connection) => overrideKey(readOverrides(), connection) || envKey(connection);

  const connectionStatus = () => {
    let overrides = {};
    let error;
    try {
      overrides = readOverrides();
    } catch (err) {
      error = err.message;
    }
    return Object.fromEntries(
      ["elevenlabs", "google"].map((connection) => {
        const override = overrideKey(overrides, connection);
        const key = override || envKey(connection);
        return [
          connection,
          {
            configured: Boolean(key),
            maskedKey: maskApiKey(key),
            source: override ? "override" : key ? "env" : "none",
            hasOverride: Boolean(override),
            ...(error ? { error } : {}),
          },
        ];
      }),
    );
  };

  const request = async (
    connection,
    path,
    { method = "GET", body, accept = "application/json", keyOverride } = {},
  ) => {
    const eleven = connection === "elevenlabs";
    const label = eleven ? "ElevenLabs" : "Google Gemini";
    const apiKey = keyOverride ?? keyFor(connection);
    if (!apiKey)
      throw invalid(
        `Configure ${eleven ? "ELEVENLABS_API_KEY" : "GEMINI_API_KEY"} to use ${label}.`,
      );
    let res;
    try {
      res = await fetchImpl(`${eleven ? ELEVENLABS : GEMINI}${path}`, {
        method,
        headers: {
          [eleven ? "xi-api-key" : "x-goog-api-key"]: apiKey,
          accept,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw new Error(`${label} request failed. Check your connection and try again.`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`${label} returned HTTP ${res.status} for this request.`), {
        status: res.status,
      });
    }
    return res;
  };

  const verifyConnection = async (connection, keyOverride) => {
    const path = connection === "elevenlabs" ? "/v1/models" : "/models?pageSize=1";
    const response = await request(connection, path, { keyOverride });
    await response.body?.cancel().catch(() => {});
  };

  const setConnection = async (connection, { apiKey, apiBase, clearOverride }) => {
    if (apiBase !== undefined) throw invalid("This service uses its official API endpoint.");
    const key = apiKey?.trim();
    if (!clearOverride) {
      if (!key || !/^[!-~]{1,500}$/.test(key)) {
        throw invalid("Enter an API key with no spaces or control characters.");
      }
      await verifyConnection(connection, key);
    }
    const next = { ...readOverrides() };
    if (clearOverride) delete next[connection];
    else next[connection] = key;
    mkdirSync(dirname(configFile), { recursive: true, mode: 0o700 });
    writeAtomic(configFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  };

  const searchVoices = async (connection, query = {}) => {
    const google = connection === "google";
    const params = new URLSearchParams({
      page_size: String(Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize)) || 30))),
    });
    const fields = google
      ? {
          search: "search",
          language: "language_code",
          gender: "gender",
          accent: "accent",
          useCase: "context",
          pitch: "pitch",
          persona: "persona",
          region: "region_code",
        }
      : {
          search: "search",
          language: "language",
          gender: "gender",
          age: "age",
          accent: "accent",
          category: "category",
          useCase: "use_cases",
        };
    for (const [key, target] of Object.entries(fields)) {
      if (typeof query[key] === "string" && query[key].trim()) {
        const raw = query[key].trim();
        const value =
          google && key === "language"
            ? ({ vi: "vi-VN", en: "en-US" }[raw.toLowerCase()] ?? raw)
            : raw;
        params.set(
          target,
          !google && (key === "language" || key === "useCase") ? JSON.stringify([value]) : value,
        );
      }
    }
    if (query.pageToken) params.set(google ? "page_token" : "next_page_token", query.pageToken);
    const response = await request(connection, `${google ? "/voices" : "/v2/voices"}?${params}`);
    const data = await readJson(response, "Voice catalog");
    const voices = (data.voices ?? []).flatMap((voice) => {
      const id = google ? voice.id : voice.voice_id;
      if (!isSafeRemoteId(id)) return [];
      const preview = voice.preview_url;
      const labels = voice.labels ?? voice;
      const contexts = voice.context ?? voice.contexts;
      return [
        {
          id,
          name: (google ? voice.display_name : voice.name) ?? id,
          connection,
          ...(google ? {} : { provider: connection }),
          category: (google ? voice.type : voice.category) ?? "voice",
          description: voice.description,
          gender: labels.gender,
          age: labels.age,
          accent: labels.accent,
          language: labels.language_code ?? labels.language,
          useCase: google
            ? Array.isArray(contexts)
              ? contexts.join(", ")
              : contexts
            : labels.use_case,
          ...(typeof preview === "string" && preview.startsWith("https://")
            ? { previewUrl: preview }
            : {}),
          source: "shared",
        },
      ];
    });
    const nextPageToken = data.next_page_token || undefined;
    return {
      voices,
      nextPageToken,
      hasMore: Boolean(nextPageToken) && (google || Boolean(data.has_more)),
    };
  };

  const getCatalog = async (connection, { refresh } = {}) => {
    const google = connection === "google";
    const base = {
      models: google
        ? GEMINI_MODELS.map((model_id, index) =>
            modelInfo(connection, {
              model_id,
              name: index ? "Gemini 3.8 Flash-Lite TTS" : "Gemini 3.8 Flash TTS",
              supports_similarity: false,
              supports_context: false,
            }),
          )
        : ELEVEN_MODELS.map(([model_id, name, maximum_text_length_per_request]) =>
            modelInfo(connection, { model_id, name, maximum_text_length_per_request }),
          ),
      languages: EN_VI,
      defaultVoices: google ? googleBuiltIns : [],
      liveSynced: false,
    };
    if (!refresh) return base;
    try {
      if (!keyFor(connection)) return base;
      const voices = await searchVoices(connection);
      if (google) return { ...base, liveSynced: true };
      const rows = await readJson(await request(connection, "/v1/models"), "ElevenLabs models");
      const models = rows
        .filter((model) => model.can_do_text_to_speech && model.model_id !== "eleven_v4_turbo")
        .map((model) => modelInfo(connection, model));
      return {
        ...base,
        models: models.length ? models : base.models,
        defaultVoices: voices.voices,
        liveSynced: true,
      };
    } catch (err) {
      return { ...base, error: err.message };
    }
  };

  const prepareSpeech = (connection, input) => {
    const google = connection === "google";
    if (!keyFor(connection)) {
      throw invalid(
        `Configure ${google ? "GEMINI_API_KEY" : "ELEVENLABS_API_KEY"} before generating.`,
      );
    }
    const modelId = input.modelId?.trim() || (google ? GEMINI_MODELS[0] : "eleven_v4");
    if (google) {
      if (input.voiceId?.startsWith("voicekey_"))
        throw invalid(
          "Use a saved Gemini voice ID. Temporary replication keys are not stored in Playground.",
        );
      if (!GEMINI_MODELS.includes(modelId))
        throw invalid("Select a supported Gemini speech model.");
      if (
        Object.keys(input.voiceSettings ?? {}).length ||
        input.previousText?.trim() ||
        input.nextText?.trim() ||
        input.seed !== undefined ||
        input.outputFormat?.trim() ||
        (input.applyTextNormalization && input.applyTextNormalization !== "auto") ||
        input.exportTranscript
      )
        throw invalid(
          "These speech options are unavailable for Gemini. Adjust the performance with Speech direction.",
        );
    } else {
      if (modelId === "eleven_multilingual_v2" && input.languageCode?.toLowerCase() === "vi") {
        throw invalid("Select Eleven v4, v3 or Flash v2.5 for Vietnamese speech.");
      }
      if (input.speechStyle?.trim())
        throw invalid("For ElevenLabs, add delivery instructions using audio tags in the script.");
      const v4 = modelId === "eleven_v4";
      if (modelId === "eleven_v4_turbo")
        throw invalid(
          "Eleven v4 Turbo requires realtime synthesis. Select Eleven v4 for a saved take.",
        );
      if (v4 && (input.previousText?.length > 100 || input.nextText?.length > 100)) {
        throw invalid("Eleven v4 accepts up to 100 characters of preceding or following context.");
      }
      if (input.outputFormat && !ELEVEN_FORMATS.has(input.outputFormat)) {
        throw invalid("Select an MP3, Opus, PCM or WAV output format.");
      }
    }
    return modelId;
  };

  const speechSettings = (connection, modelId, input) => {
    if (connection === "google") return {};
    const keys =
      modelId === "eleven_v4"
        ? ["stability", "similarity_boost"]
        : ["stability", "similarity_boost", "style", "use_speaker_boost", "speed"];
    return Object.fromEntries(
      keys.filter((key) => input?.[key] !== undefined).map((key) => [key, input[key]]),
    );
  };

  const renderSpeech = async (connection, input) => {
    const { modelId, voiceId, text, speechStyle, turns, speakers } = input;
    if (connection === "google") {
      const res = await request(connection, "/interactions", {
        method: "POST",
        body: {
          model: modelId,
          store: false,
          input: [
            {
              type: "user_input",
              content: turns
                ? turns.map((turn) => ({
                    type: "text",
                    text: turn.text,
                    annotations: [
                      {
                        type: "speech_metadata",
                        speaker: turn.speaker,
                        ...(turn.speechStyle ? { style: turn.speechStyle } : {}),
                      },
                    ],
                  }))
                : [
                    {
                      type: "text",
                      text,
                      ...(speechStyle
                        ? { annotations: [{ type: "speech_metadata", style: speechStyle }] }
                        : {}),
                    },
                  ],
            },
          ],
          response_format: { type: "audio" },
          generation_config: {
            speech_config: turns
              ? {
                  speakers: speakers.map(({ name, voiceId }) => ({
                    speaker: name,
                    voice: voiceId,
                  })),
                }
              : [{ voice: voiceId }],
          },
        },
      });
      const result = await readJson(res, "Gemini speech", MAX_AUDIO_JSON_BYTES);
      const audio = (result.steps ?? [])
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .findLast((part) => part.type === "audio");
      const bytes = audioFromBase64(audio?.data, "Google Gemini");
      if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("Google Gemini returned an unexpected audio format.");
      }
      const inputTokens = result.usage?.total_input_tokens;
      const outputTokens = result.usage?.total_output_tokens;
      return {
        bytes,
        ext: ".wav",
        ...(Number.isSafeInteger(inputTokens) &&
        inputTokens >= 0 &&
        Number.isSafeInteger(outputTokens) &&
        outputTokens >= 0
          ? { providerUsage: { inputTokens, outputTokens } }
          : {}),
      };
    }

    const dialogue = Boolean(turns) || modelId === "eleven_v4";
    const format = input.outputFormat || "mp3_44100_128";
    const codec = format.split("_")[0];
    const settings = input.voiceSettings;
    const body = {
      ...(dialogue
        ? {
            inputs: turns?.map((turn) => ({ text: turn.text, voice_id: turn.voiceId })) ?? [
              { text, voice_id: voiceId },
            ],
            ...(settings && {
              settings: {
                stability: settings.stability,
                similarity: settings.similarity_boost,
              },
            }),
          }
        : { text, voice_settings: settings }),
      model_id: modelId,
      language_code: input.languageCode || undefined,
      previous_text: input.previousText || undefined,
      [dialogue ? "future_text" : "next_text"]: input.nextText || undefined,
      seed: input.seed,
      apply_text_normalization: input.applyTextNormalization,
    };
    const path = dialogue
      ? "/v1/text-to-dialogue"
      : `/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const withTimestamps = input.exportTranscript ? "/with-timestamps" : "";
    const res = await request(connection, `${path}${withTimestamps}?output_format=${format}`, {
      method: "POST",
      body,
      accept: input.exportTranscript ? "application/json" : "audio/*",
    });
    let bytes;
    let wordTimings;
    if (input.exportTranscript) {
      const result = await readJson(res, "ElevenLabs speech", MAX_AUDIO_JSON_BYTES);
      bytes = audioFromBase64(result.audio_base64, "ElevenLabs");
      const alignment = result.alignment ?? result.normalized_alignment;
      if (alignment) wordTimings = dialogueWords(alignment, result.voice_segments, turns);
    } else {
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("audio/") && !contentType.includes("application/octet-stream")) {
        await res.body?.cancel().catch(() => {});
        throw new Error("ElevenLabs returned an unexpected audio format.");
      }
      bytes = await readBoundedBytes(res, MAX_AUDIO_BYTES, "ElevenLabs speech");
      if (!bytes.length) throw new Error("ElevenLabs returned empty audio.");
    }
    const charged = res.headers.get("character-cost")?.trim();
    return {
      bytes: codec === "pcm" ? wrapPcm16ToWav(bytes, Number(format.split("_")[1])) : bytes,
      ext: FORMATS[codec],
      ...(wordTimings?.length ? { wordTimings } : {}),
      providerRequestId: res.headers.get("request-id") ?? undefined,
      ...(charged && /^\d+$/.test(charged) && Number.isSafeInteger(Number(charged))
        ? { actualCost: { unit: "elevenlabs_credits", amount: Number(charged) } }
        : {}),
    };
  };

  return {
    connectionStatus,
    verifyConnection,
    setConnection,
    getCatalog,
    searchVoices,
    supportsGeminiDialogueVoice: (id) => GEMINI_VOICES.includes(id),
    prepareSpeech,
    renderSpeech,
    speechSettings,
  };
};
