import { describe, expect, test } from "bun:test";

import { DEFAULT_VOICE_FILTERS } from "../app/sound/voice-library-view";
import {
  activeFilmVoices,
  buildUnifiedEntries,
  composeFilmTakeRemixPreset,
  DEFAULT_COMPOSER_DRAFT,
  DEFAULT_PLAYGROUND_FILTERS,
  detectTextLanguage,
  entryToComposerDraft,
  extractDialogueSpeakerEntries,
  extractPlaygroundFacets,
  filterAndSortEntries,
  filterProviderCastingVoices,
  filterSavedCastingVoices,
  groupDiarizedTranscript,
  isSafeAudioUrl,
  nextTabId,
  parseDialogueTurnNames,
  parseVoicePreviewTarget,
  resolveModeModelId,
  savedFavoriteEntries,
  snapToDiscreteValue,
  speechJobToDraft,
  stripDialogueSpeakerBrackets,
  swapGenerationInput,
  templateToComposerDraft,
  uniqueCastingGroups,
  voiceChangerSourceDraft,
  voiceSettingsForModel,
  withComposerVoice,
  withDialogueVoice,
} from "../app/sound/voice-playground-view";

test("a minimal Gemini Speech template uses Gemini defaults", () => {
  const draft = templateToComposerDraft({
    draft: { mode: "tts", connection: "google", text: "Chào bạn." },
  });
  expect(draft).toMatchObject({
    connection: "google",
    modelId: "gemini-3.8-flash-tts",
    voiceId: "Kore",
    voiceName: "Kore",
  });
});
test("a transcription template identifies Scribe and its source without a default speech actor or prompt", () => {
  const [entry] = buildUnifiedEntries([], [], new Set(), [
    {
      id: "stt_recipe",
      title: "Interview",
      scope: "global",
      draft: {
        mode: "stt",
        sttSourceFile: "src_interview.wav",
        sttSourceLabel: "interview.wav",
        sttLanguageCode: "vi",
      },
    },
  ]);
  expect(entry).toMatchObject({
    kind: "stt",
    voiceName: "Scribe v2",
    voiceId: "",
    modelId: "scribe_v2",
    languageCode: "vi",
    text: "",
    spoken: "interview.wav",
    tags: [],
  });
});
import {
  AUDIO_TAG_CATEGORIES,
  composerAudioTags,
  estimateGenerationCredits,
  insertAudioTagAtSelection,
  modelSupportsAudioTags,
  parsePromptSegments,
} from "../app/sound/voice-tags";
import { parseTakeScript } from "../app/sound/voice-view";

test("duplicating a Dubbing recording keeps its native operation, language pair and voice identities", () => {
  const item = {
    id: "dub_saved",
    scope: "global",
    kind: "dubbing",
    provider: "minimax",
    title: "Vietnamese scene",
    voiceId: "12345",
    voiceName: "Narrator",
    modelId: "speech-2.8-hd",
    languageCode: "vi",
    text: "Xin chào",
    tags: [],
    voiceSettings: {},
    createdAt: new Date().toISOString(),
    dubbing: {
      sourceLanguage: "en",
      targetLanguage: "vi",
      voiceId: "Vietnamese_Man",
      ttsVoiceId: "12345",
      modelId: "speech-2.8-hd",
    },
  };
  const draft = entryToComposerDraft(buildUnifiedEntries([item], [], new Set())[0]);
  expect(draft).toMatchObject({
    mode: "dubbing",
    provider: "minimax",
    voiceId: "12345",
    dubbing: {
      provider: "minimax",
      sourceLanguage: "en",
      targetLanguage: "vi",
      voiceId: "Vietnamese_Man",
      ttsVoiceId: "12345",
      voiceName: "Narrator",
    },
  });
});

test("an applied native film take reuses its complete archived recipe for duplicate, template and remix", () => {
  const source = {
    id: "native",
    scope: "global",
    kind: "tts",
    text: "Xin chao.",
    title: "Narrator",
    provider: "minimax",
    voiceId: "12345",
    voiceName: "My narrator",
    modelId: "speech-2.8-hd",
    languageCode: "Vietnamese",
    voiceSettings: { speed: 1.05, pitch: -1, vol: 1.01 },
    audioFile: "native.wav",
    durationSeconds: 2,
    createdAt: "2026-11-17T00:00:00Z",
  };
  const take = {
    id: "01",
    text: source.text,
    voice: source.voiceId,
    model: source.modelId,
    file: "01.wav",
    seconds: 2,
    playgroundItemId: source.id,
    playgroundScope: "global",
  };
  const entry = buildUnifiedEntries([source], [take], new Set())[1];
  expect(entry.playgroundItem).toBeUndefined();
  expect(entry.sourceRecording).toBe(source);
  expect(entry).toMatchObject({
    origin: "film_take",
    uid: "take:01",
    languageCode: "Vietnamese",
    voiceSettings: source.voiceSettings,
    audioUrl: "/api/voice/audio/takes/01.wav",
  });
  expect(entryToComposerDraft(entry)).toMatchObject({
    provider: "minimax",
    modelId: "speech-2.8-hd",
    languageCode: "Vietnamese",
    pitch: -1,
    vol: 1.01,
  });
  expect(composeFilmTakeRemixPreset(take, source)).toMatchObject({
    provider: "minimax",
    sourceTakeId: "01",
    languageCode: "Vietnamese",
    pitch: -1,
    vol: 1.01,
  });
  expect(composeFilmTakeRemixPreset(take).provider).toBe("minimax");
});

test("preview targets distinguish native providers from legacy ElevenLabs IDs", () => {
  expect(parseVoicePreviewTarget("gv:minimax:12345")).toEqual({ provider: "minimax", id: "12345" });
  expect(parseVoicePreviewTarget("gv:capcut:67890")).toEqual({ provider: "capcut", id: "67890" });
  expect(parseVoicePreviewTarget("gv:actor")).toEqual({ provider: "elevenlabs", id: "actor" });
  expect(parseVoicePreviewTarget("pg:recording")).toBeNull();
});

test("casting and swapping keep the chosen English or Vietnamese synthesis language independently of voice catalog tags", () => {
  const catalog = {
    models: [
      { provider: "elevenlabs", model_id: "eleven_v4", can_do_text_to_speech: true },
      { provider: "minimax", model_id: "speech-2.8-hd", can_do_text_to_speech: true },
      { provider: "capcut", model_id: "capcut", can_do_text_to_speech: true },
    ],
    languages: [
      { code: "en", name: "English" },
      { code: "vi", name: "Vietnamese" },
    ],
  };
  const draft = { ...DEFAULT_COMPOSER_DRAFT, languageCode: "vi" };
  const voice = {
    id: "12345",
    name: "English-tagged narrator",
    provider: "minimax",
    language: "English",
  };
  const native = withComposerVoice(draft, voice, catalog);
  expect(native.languageCode).toBe("Vietnamese");
  expect(withComposerVoice(native, voice, catalog).languageCode).toBe("Vietnamese");
  expect(
    withDialogueVoice({ ...native, id: "elder", name: "Elder" }, voice, catalog).languageCode,
  ).toBe("Vietnamese");
  expect(
    withDialogueVoice(
      { ...native, id: "elder", name: "Elder", languageCode: "" },
      { id: "67890", name: "Vietnamese narrator", provider: "capcut", language: "vi" },
      catalog,
    ).languageCode,
  ).toBe("vi");
  expect(
    withComposerVoice(
      native,
      { id: "67890", name: "Cartoon", provider: "capcut", language: "en" },
      catalog,
    ).languageCode,
  ).toBe("vi");
  expect(
    withComposerVoice(
      native,
      { id: "default", name: "Narrator", provider: "elevenlabs", language: "en" },
      catalog,
    ).languageCode,
  ).toBe("vi");
  expect(
    withComposerVoice(
      { ...draft, languageCode: "en" },
      { ...voice, language: "Vietnamese" },
      catalog,
    ).languageCode,
  ).toBe("English");
  expect(
    withComposerVoice({ ...draft, languageCode: "" }, { ...voice, language: "Vietnamese" }, catalog)
      .languageCode,
  ).toBe("Vietnamese");
});

test("mixed Dialogue tag tools follow its cast and warn only for the role actually containing unsupported tags", () => {
  const draft = {
    mode: "dialogue",
    provider: "capcut",
    modelId: "capcut",
    text: "Narrator: [hushed] Go.\nElder: Wait.\nCartoon: [angry] No.",
    speakers: [
      { name: "Narrator", modelId: "eleven_v4" },
      { name: "Elder", modelId: "speech-2.8-hd" },
      { name: "Cartoon", modelId: "capcut" },
    ],
  };
  expect(composerAudioTags(draft)).toEqual({
    showPalette: true,
    unsupportedTts: false,
    unsupportedSpeakers: ["Cartoon"],
  });
  expect(composerAudioTags({ ...draft, provider: "elevenlabs", modelId: "eleven_v4" })).toEqual(
    composerAudioTags(draft),
  );
  expect(composerAudioTags({ ...draft, mode: "tts", text: "Plain words" })).toMatchObject({
    showPalette: false,
    unsupportedTts: false,
  });
});

test("Swap submits the same compatible recipe it quotes for a custom ID, including an individual Dialogue role", () => {
  const catalog = {
    models: [
      { model_id: "speech-2.8-hd", provider: "minimax", can_do_text_to_speech: true },
      { model_id: "capcut", provider: "capcut", can_do_text_to_speech: true },
    ],
    languages: [
      { code: "ko", name: "Korean" },
      { code: "en", name: "English" },
    ],
    providerLanguages: { capcut: [{ code: "en", name: "English" }] },
  };
  const source = {
    ...DEFAULT_COMPOSER_DRAFT,
    provider: "minimax",
    voiceId: "12345",
    modelId: "speech-2.8-hd",
    languageCode: "Korean",
    speed: 1.6,
    pitch: -3,
    vol: 2,
  };
  const target = withComposerVoice(
    source,
    { id: "67890", name: "CapCut ID", provider: "capcut" },
    catalog,
  );
  const body = swapGenerationInput(target, catalog.models);
  expect(body).toMatchObject({
    provider: "capcut",
    voiceId: "67890",
    modelId: "capcut",
    languageCode: "en",
    voiceSettings: { speed: 1.6, pitch: -3 },
  });
  expect(body.voiceSettings).not.toHaveProperty("vol");
  const elder = withDialogueVoice(
    { ...source, id: "elder", name: "Elder" },
    { id: "67890", name: "CapCut ID", provider: "capcut" },
    catalog,
  );
  expect(
    swapGenerationInput(
      {
        ...source,
        mode: "dialogue",
        speakers: [{ ...DEFAULT_COMPOSER_DRAFT.speakers[0], name: "Narrator" }, elder],
      },
      catalog.models,
      "Elder",
    ),
  ).toEqual({ ...body, speakerKey: "Elder" });
});

test("casting across providers selects a compatible model and language and removes unsupported generation options", () => {
  const catalog = {
    models: [
      {
        model_id: "eleven_v4",
        provider: "elevenlabs",
        can_do_text_to_speech: true,
        stability_values: [0, 0.5, 1],
      },
      { model_id: "speech-2.8-hd", provider: "minimax", can_do_text_to_speech: true },
    ],
    languages: [{ code: "en", name: "English" }],
  };
  const picked = withComposerVoice(
    {
      ...DEFAULT_COMPOSER_DRAFT,
      seedText: "12",
      previousText: "Old context",
      outputFormat: "pcm_44100",
      speed: 1.1,
    },
    { id: "12345", name: "Mini narrator", provider: "minimax", language: "en" },
    catalog,
  );
  expect(picked).toMatchObject({
    provider: "minimax",
    modelId: "speech-2.8-hd",
    languageCode: "English",
    voiceId: "12345",
    seedText: "",
    previousText: "",
    outputFormat: "",
    speed: 1.1,
  });
  expect(
    withComposerVoice(
      { ...picked, speed: 1.8 },
      { id: "actor", name: "Actor", provider: "elevenlabs" },
      catalog,
    ),
  ).toMatchObject({ provider: "elevenlabs", modelId: "eleven_v4", languageCode: "en", speed: 1.2 });
  expect(resolveModeModelId("tts", "eleven_multilingual_sts_v2", catalog.models, "minimax")).toBe(
    "speech-2.8-hd",
  );
});

test("a minimal native CLI template infers providers and gives its roles usable editor defaults", () => {
  const draft = entryToComposerDraft({
    template: {
      id: "template",
      scope: "project",
      draft: {
        mode: "dialogue",
        modelId: "capcut",
        speakers: [
          { id: "elder", name: "Elder", voiceId: "12345", modelId: "speech-2.8-hd", pitch: 12 },
        ],
      },
    },
  });
  expect(draft).toMatchObject({ provider: "capcut" });
  expect(draft.speakers[0]).toMatchObject({
    provider: "minimax",
    voiceName: "12345",
    speed: 1,
    stability: 0.5,
    languageCode: "English",
    pitch: 12,
  });
});

test("native template entries and editor agree on model defaults and the complete saved acting recipe", () => {
  const template = {
    id: "native",
    scope: "project",
    title: "CapCut preset",
    draft: {
      mode: "tts",
      provider: "capcut",
      voiceId: "67890",
      text: "Hello from a template.",
      pitch: -2,
      speed: 1.1,
    },
    favorite: false,
  };
  const entry = buildUnifiedEntries([], [], new Set(), [template])[0];
  expect(entry).toMatchObject({
    modelId: "capcut",
    voiceId: "67890",
    voiceName: "67890",
    voiceSettings: { pitch: -2, speed: 1.1 },
  });
  expect(entryToComposerDraft(entry)).toMatchObject({
    provider: "capcut",
    modelId: "capcut",
    voiceId: "67890",
    voiceName: "67890",
    pitch: -2,
  });
  const minimax = buildUnifiedEntries([], [], new Set(), [
    { ...template, draft: { ...template.draft, provider: "minimax", vol: 1.01 } },
  ])[0];
  expect(minimax).toMatchObject({
    modelId: "speech-2.8-hd",
    voiceSettings: { pitch: -2, vol: 1.01 },
  });
});

test("mixed Dialogue templates expose the same cast and native settings for inspection as their editable recipe", () => {
  const template = {
    id: "dialogue",
    scope: "project",
    title: "Mixed cast",
    draft: {
      mode: "dialogue",
      provider: "capcut",
      text: "Narrator: Go.\nElder: Wait.",
      pauseBetweenTurns: 0.8,
      speakers: [
        { id: "n", name: "Narrator", voiceId: "narrator", modelId: "eleven_v4" },
        {
          id: "e",
          name: "Elder",
          voiceId: "12345",
          modelId: "speech-2.8-hd",
          pitch: -2,
          vol: 1.01,
          speed: 1.1,
        },
      ],
    },
    favorite: false,
  };
  const entry = buildUnifiedEntries([], [], new Set(), [template])[0];
  expect(entry.dialogue).toMatchObject({
    pause_between_turns: 0.8,
    speakers: {
      Elder: {
        provider: "minimax",
        voice_id: "12345",
        model_id: "speech-2.8-hd",
        voice_settings: { pitch: -2, vol: 1.01, speed: 1.1 },
      },
    },
  });
  expect(Object.keys(entry.dialogue.speakers)).toEqual(["Narrator", "Elder"]);
});

test("Change Voice uses a native recording as source audio and requires an ElevenLabs target", () => {
  const source = {
    id: "recorded",
    title: "Native",
    origin: "playground",
    kind: "tts",
    modelId: "capcut",
    voiceId: "67890",
    voiceName: "Cartoon",
    playgroundItem: { provider: "capcut" },
  };
  expect(voiceChangerSourceDraft(source)).toMatchObject({
    mode: "voice_changer",
    provider: "elevenlabs",
    modelId: "eleven_multilingual_sts_v2",
    voiceId: "",
    voiceName: "",
    vcSourceKind: "playground",
    vcSourceItemId: "recorded",
  });
  expect(
    voiceChangerSourceDraft({
      ...source,
      modelId: "eleven_v4",
      playgroundItem: { provider: "elevenlabs" },
    }),
  ).toMatchObject({ voiceId: "67890", voiceName: "Cartoon" });
});

test("saved provider favorites keep language, age, emotion and role filters even when their cloud page is no longer loaded", () => {
  const voices = [
    {
      id: "mini",
      provider: "minimax",
      name: "Warm",
      language: "English",
      age: "Middle-aged",
      gender: "Male",
      accent: "EN-British",
      useCase: "Audiobooks & Novels · Podcast",
    },
    {
      id: "cap",
      provider: "capcut",
      name: "Bright",
      language: "en",
      age: "Teenager",
      emotion: "Excited",
    },
  ];
  expect(
    filterProviderCastingVoices(voices, "minimax", "", {
      language: "English",
      age: "Middle-aged",
      useCase: "Audiobook,Podcast",
    }).map((v) => v.id),
  ).toEqual(["mini"]);
  expect(
    filterProviderCastingVoices(voices, "minimax", "", { age: "Young, Middle-aged" }).map(
      (v) => v.id,
    ),
  ).toEqual(["mini"]);
  expect(filterProviderCastingVoices(voices, "capcut", "", { emotion: "Sad" })).toEqual([]);
  expect(
    filterProviderCastingVoices(voices, "capcut", "Bright", {
      language: "en",
      emotion: "Excited",
    }).map((v) => v.id),
  ).toEqual(["cap"]);
  expect(filterProviderCastingVoices(voices, "minimax", "", { useCase: "Unknown," })).toEqual([]);
});

test("casting a Dialogue role across providers updates its model and language without changing its identity or native performance settings", () => {
  const speaker = {
    ...DEFAULT_COMPOSER_DRAFT.speakers[0],
    id: "role_1",
    name: "Grandfather",
    speed: 1.1,
    pitch: -3,
    vol: 0.8,
  };
  const cast = withDialogueVoice(
    speaker,
    { id: "12345", name: "Warm", provider: "minimax", language: "en" },
    { models: [], languages: [{ code: "en", name: "English" }] },
  );
  expect(cast).toMatchObject({
    id: "role_1",
    name: "Grandfather",
    provider: "minimax",
    voiceId: "12345",
    voiceName: "Warm",
    modelId: "speech-2.8-hd",
    languageCode: "English",
    pitch: -3,
    vol: 0.8,
    speed: 1.1,
  });
  expect(speaker).not.toHaveProperty("provider", "minimax");
});

test("native-provider composer recipes keep their provider and full speed, pitch and volume", () => {
  const entry = {
    id: "native",
    origin: "playground",
    kind: "tts",
    title: "Native take",
    text: "Hello",
    voiceId: "12345",
    voiceName: "Narrator",
    modelId: "speech-2.8-hd",
    languageCode: "English",
    voiceSettings: { speed: 1.6, pitch: -4, vol: 0.8 },
    exportTranscript: false,
    playgroundItem: { provider: "minimax" },
  };
  const draft = entryToComposerDraft(entry);
  expect(draft).toMatchObject({ provider: "minimax", speed: 1.6, pitch: -4, vol: 0.8 });
  expect(voiceSettingsForModel({ model_id: "speech-2.8-hd", provider: "minimax" }, draft)).toEqual({
    speed: 1.6,
    pitch: -4,
    vol: 0.8,
  });
  expect(voiceSettingsForModel({ model_id: "capcut", provider: "capcut" }, draft)).toEqual({
    speed: 1.6,
    pitch: -4,
  });
  const dialogue = entryToComposerDraft({
    ...entry,
    kind: "dialogue",
    playgroundItem: {
      provider: "minimax",
      dialogue: {
        speakers: {
          Grandfather: {
            provider: "minimax",
            voice_id: "12345",
            model_id: "speech-2.8-hd",
            language_code: "English",
            voice_settings: { speed: 1.6, pitch: -4, vol: 0.8 },
          },
        },
      },
    },
  });
  expect(dialogue.speakers[0]).toMatchObject({
    provider: "minimax",
    pitch: -4,
    vol: 0.8,
    speed: 1.6,
  });
});

describe("ElevenLabs v4 Audio Tags & Playground View Helpers", () => {
  test("favorited voices still match the selected language, gender, and role", () => {
    const voices = [
      { id: "lan", name: "Lan", language: "vi", gender: "female", useCase: "narrative_and_story" },
      {
        id: "riley",
        name: "Riley",
        language: "vi",
        gender: "female",
        useCase: "narrative_and_story",
        verifiedLanguages: [{ code: "en", locale: "en-US" }],
      },
      { id: "alex", name: "Alex", language: "en", gender: "male", useCase: "narrative_and_story" },
      { id: "taylor", name: "Taylor", language: "en", gender: "female", useCase: "conversational" },
    ];
    expect(
      filterSavedCastingVoices(
        voices,
        "",
        { ...DEFAULT_VOICE_FILTERS, gender: "female" },
        undefined,
        { language: "en", useCase: "narrative_and_story" },
      ).map(({ id }) => id),
    ).toEqual(["riley"]);
  });

  test("failed Speech opens the accepted take settings, including zero seed and the saved sample", () => {
    const text = "[hushed] Anh yêu em.";
    const voicePreviewUrl = "https://cdn.example.com/free-preview.mp3";
    const draft = speechJobToDraft({
      kind: "tts",
      status: "failed",
      title: "Quiet read",
      voiceId: "actor_a",
      voiceName: "Lan",
      modelId: "eleven_v4",
      generationRecipe: {
        version: 1,
        requested: {
          voiceId: "actor_a",
          text,
          voicePreviewUrl,
          previousText: "Removed by provider fallback",
        },
        effective: {
          path: "/v1/tts/text-to-speech/actor_a",
          body: {
            model_id: "eleven_v4",
            language_code: "vi",
            voice_settings: { stability: 0.6 },
            seed: 0,
            export_transcript: true,
          },
        },
      },
    });
    expect(draft).toMatchObject({
      text,
      title: "Quiet read",
      voiceId: "actor_a",
      languageCode: "vi",
      stability: 0.6,
      seedText: "0",
      previousText: "",
      voicePreviewUrl,
      exportTranscript: true,
      variations: 1,
      recordedSpeech: { modelId: "eleven_v4", settings: { stability: 0.6 } },
    });
  });

  test("casting search matches visible traits and quality without losing exact metadata filters", () => {
    const voices = [
      {
        id: "young",
        name: "Bright",
        age: "young",
        gender: "female",
        language: "en",
        accent: "american",
        category: "professional",
        descriptive: "whispery",
        useCase: "characters_animation",
      },
      {
        id: "older",
        name: "Warm",
        age: "middle_aged",
        gender: "male",
        language: "en",
        accent: "british",
        category: "premade",
        useCase: "narrative_story",
      },
    ];
    for (const query of [
      "young",
      "female",
      "en",
      "american",
      "professional",
      "whispery",
      "characters_animation",
    ]) {
      expect(
        filterSavedCastingVoices(voices, query, DEFAULT_VOICE_FILTERS).some(
          (voice) => voice.id === "young",
        ),
      ).toBe(true);
    }
    expect(
      filterSavedCastingVoices(voices, "", { ...DEFAULT_VOICE_FILTERS, gender: "male" }).map(
        (voice) => voice.id,
      ),
    ).toEqual(["older"]);
  });
  test("casting groups show one row per provider voice while preserving the casting and favorites order", () => {
    const warm = { id: "same", provider: "elevenlabs", name: "Warm" };
    const cloned = { id: "same", provider: "minimax", name: "My clone" };
    const groups = uniqueCastingGroups([
      [warm],
      [warm, cloned],
      [
        { ...warm, provider: undefined },
        { id: "bright", name: "Bright" },
      ],
    ]);
    expect(groups.map((group) => group.map((voice) => voice.name))).toEqual([
      ["Warm"],
      ["My clone"],
      ["Bright"],
    ]);
  });
  test("main Favorites finds starred Project/Global recordings, film takes and editable templates with one search", () => {
    const entries = buildUnifiedEntries(
      [
        { id: "project", scope: "project", title: "Warm project", text: "Hello", favorite: true },
        { id: "global", scope: "global", title: "Warm global", text: "Hello", favorite: true },
        { id: "other", scope: "global", title: "Not saved", text: "Hello", favorite: false },
      ],
      [{ id: "01", text: "Warm film take", file: "01.wav" }],
      new Set(["take:01"]),
      [
        {
          id: "template",
          title: "Warm preset",
          scope: "global",
          favorite: true,
          draft: { mode: "tts", text: "Hello" },
        },
      ],
    );
    expect(savedFavoriteEntries(entries, "warm").map((entry) => entry.uid)).toEqual([
      "pg:project",
      "pg:global",
      "take:01",
      "preset:template",
    ]);
    expect(savedFavoriteEntries(entries, "preset").map((entry) => entry.uid)).toEqual([
      "preset:template",
    ]);
    entries[0].favorite = false;
    expect(savedFavoriteEntries(entries, "project")).toEqual([]);
  });
  test("recordings saved with only a voice ID use its known casting name", () => {
    const [entry] = buildUnifiedEntries(
      [
        {
          id: "named_by_id",
          kind: "tts",
          voiceId: "ZaZosYpkIGmSqOwAlfnk",
          voiceName: "ZaZosYpkIGmSqOwAlfnk",
          text: "A line",
          voiceSettings: {},
        },
      ],
      [],
      new Set(),
    );
    expect(entry.voiceName).toBe("Seff Echo");
  });
  test("the extra favorites shelf excludes already displayed cached voices while keeping other providers", () => {
    const voices = filterSavedCastingVoices(
      [
        { id: "cached", name: "Known voice", provider: "elevenlabs" },
        { id: "cloud_only", name: "Cloud voice", provider: "elevenlabs" },
        { id: "cached", name: "MiniMax voice", provider: "minimax" },
      ],
      "",
      DEFAULT_VOICE_FILTERS,
      new Set(["cached"]),
    );
    expect(voices.map((voice) => voice.name)).toEqual(["Cloud voice", "MiniMax voice"]);
  });
  test("current cast includes every used Dialogue voice and excludes unrecorded or inactive film lines", () => {
    const voices = activeFilmVoices(
      [
        { id: "01", file: "01.wav", voice: "primary" },
        { id: "02", file: null, voice: "not_generated" },
        { id: "03", file: "03.wav", voice: "legacy" },
      ],
      [
        {
          takeId: "01",
          voiceId: "primary",
          provider: "elevenlabs",
          voices: [
            { voiceId: "primary", voiceName: "Alex", provider: "elevenlabs" },
            { voiceId: "secondary", voiceName: "Riley", provider: "elevenlabs" },
          ],
        },
      ],
    );
    expect(voices.map((voice) => voice.voiceId)).toEqual(["primary", "secondary", "legacy"]);
  });
  test("AUDIO_TAG_CATEGORIES groups common ElevenLabs audio tag suggestions", () => {
    const ids = AUDIO_TAG_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(["emotion", "delivery", "pacing", "reaction", "character", "sfx"]);
    const allTags = AUDIO_TAG_CATEGORIES.flatMap((c) => c.tags.map((t) => t.tag));
    expect(allTags).toContain("whispers");
    expect(allTags).toContain("excited");
    expect(allTags).toContain("sighs");
    expect(allTags).toContain("pause");
    expect(allTags).toContain("British accent");
    expect(allTags).toContain("footsteps");
  });

  test("insertAudioTagAtSelection inserts normalized bracketed tag at cursor with crisp spacing", () => {
    const r1 = insertAudioTagAtSelection("Hello world", 6, 6, "excited");
    expect(r1.text).toBe("Hello [excited] world");
    expect(r1.text.slice(0, r1.cursor)).toBe("Hello [excited] ");

    const r2 = insertAudioTagAtSelection("", 0, 0, "[whispers]");
    expect(r2.text).toBe("[whispers] ");

    const r3 = insertAudioTagAtSelection("Wait there", 4, 10, "short pause");
    expect(r3.text).toBe("Wait [short pause]");
  });

  test("parsePromptSegments and parseTakeScript keep [Speaker]: cues out of audio tags", () => {
    const segs = parsePromptSegments("[whispers] Look closely [short pause] now.");
    expect(segs).toEqual([
      { kind: "tag", value: "whispers" },
      { kind: "text", value: " Look closely " },
      { kind: "tag", value: "short pause" },
      { kind: "text", value: " now." },
    ]);

    const dialogueSegs = parsePromptSegments(
      "[Alex]: [curious] Ready?\n  [Riley]: [whispers] Go now.",
    );
    expect(dialogueSegs.filter((s) => s.kind === "tag").map((s) => s.value)).toEqual([
      "curious",
      "whispers",
    ]);
    expect(dialogueSegs[0]).toEqual({ kind: "text", value: "[Alex]: " });

    const takeParsed = parseTakeScript("[Alex]: [curious] Ready?");
    expect(takeParsed.tags).toEqual(["curious"]);
    expect(takeParsed.spoken).toBe("Alex: Ready?");
  });

  test("modelSupportsAudioTags & estimateGenerationCredits compute accurate GenVoice multipliers", () => {
    expect(modelSupportsAudioTags("eleven_v4")).toBe(true);
    expect(modelSupportsAudioTags("eleven_v4_turbo")).toBe(true);
    expect(modelSupportsAudioTags("eleven_v3")).toBe(true);
    expect(modelSupportsAudioTags("eleven_multilingual_v2")).toBe(false);
    expect(modelSupportsAudioTags("eleven_flash_v2_5")).toBe(false);

    expect(
      estimateGenerationCredits(
        100,
        { model_rates: { character_cost_multiplier: 1 } },
        { exportTranscript: false, variations: 1 },
      ),
    ).toBe(100);
    expect(
      estimateGenerationCredits(
        100,
        { model_rates: { character_cost_multiplier: 0.5 } },
        { exportTranscript: true, variations: 2 },
      ),
    ).toBe(116);
  });

  test("buildUnifiedEntries merges playground items + film takes, filters, sorts, and builds swap-voice drafts", () => {
    const playgroundItems = [
      {
        id: "pg_1",
        kind: "tts",
        title: "Dramatic opener",
        text: "[whispers, anxious] Keep moving.",
        tags: ["whispers, anxious"],
        voiceId: "v_seff",
        voiceName: "Seff Echo",
        modelId: "eleven_v4",
        languageCode: "en",
        voiceSettings: { stability: 0.35, similarity_boost: 0.8, speed: 1.05 },
        exportTranscript: true,
        audioFile: "pg_1.mp3",
        mimeType: "audio/mpeg",
        bytes: 12000,
        durationSeconds: 3.4,
        charactersUsed: 34,
        creditsDeducted: 39,
        provider: "elevenlabs",
        favorite: true,
        isTemplate: true,
        templateName: "Tense Whisper Preset",
        notes: "Works well on intro",
        createdAt: "2026-11-15T10:00:00Z",
        updatedAt: "2026-11-15T10:00:00Z",
      },
      {
        id: "pg_2",
        kind: "dialogue",
        title: "Campfire banter",
        text: "A: [excited] Found it!\nB: [skeptical] Show me.",
        tags: ["excited", "skeptical"],
        voiceId: "v_rachel",
        voiceName: "A (Rachel) · B (Seff Echo)",
        modelId: "eleven_v4_turbo",
        languageCode: "en",
        voiceSettings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
        exportTranscript: false,
        dialogue: {
          pause_between_turns: 0.4,
          speakers: {
            A: {
              voice_id: "v_rachel",
              voice_name: "Rachel",
              model_id: "eleven_v4_turbo",
              language_code: "en",
              voice_settings: { stability: 0.5 },
            },
            B: {
              voice_id: "v_seff",
              voice_name: "Seff Echo",
              model_id: "eleven_v4_turbo",
              language_code: "en",
              voice_settings: { stability: 0.6 },
            },
          },
        },
        audioFile: "pg_2.mp3",
        mimeType: "audio/mpeg",
        bytes: 20000,
        durationSeconds: 5.2,
        charactersUsed: 46,
        creditsDeducted: 23,
        provider: "elevenlabs",
        favorite: false,
        isTemplate: false,
        createdAt: "2026-11-15T12:00:00Z",
        updatedAt: "2026-11-15T12:00:00Z",
      },
    ];

    const filmTakes = [
      {
        id: "01",
        text: "[calm] Night settles over the valley.",
        voice: "ZaZosYpkIGmSqOwAlfnk",
        model: "eleven_v4",
        speed: 0.96,
        stability: 0.55,
        file: "01.mp3",
        seconds: 2.1,
        words: 6,
        aligned: true,
        tries: ["01_1.mp3"],
      },
    ];

    const unified = buildUnifiedEntries(playgroundItems, filmTakes, new Set(["take:01"]));
    expect(unified.length).toBe(3);
    expect(unified.find((u) => u.uid === "take:01")?.favorite).toBe(true);

    const facets = extractPlaygroundFacets(unified);
    expect(facets.voices.length).toBe(3);
    expect(facets.models.map((m) => m.id)).toContain("eleven_v4_turbo");
    expect(facets.tags.some((t) => t.id === "whispers, anxious")).toBe(true);

    const templatesOnly = filterAndSortEntries(unified, {
      ...DEFAULT_PLAYGROUND_FILTERS,
      source: "templates",
    });
    expect(templatesOnly.map((e) => e.id)).toEqual(["pg_1"]);

    const longestFirst = filterAndSortEntries(unified, {
      ...DEFAULT_PLAYGROUND_FILTERS,
      sort: "longest",
    });
    expect(longestFirst.map((e) => e.uid)).toEqual(["pg:pg_2", "pg:pg_1", "take:01"]);

    const tagFiltered = filterAndSortEntries(unified, {
      ...DEFAULT_PLAYGROUND_FILTERS,
      tag: "calm",
    });
    expect(tagFiltered.map((e) => e.uid)).toEqual(["take:01"]);

    // Swap voice keeps template prompt & settings verbatim while changing only voice
    const tplEntry = unified.find((u) => u.id === "pg_1");
    const swappedDraft = entryToComposerDraft(tplEntry, { id: "v_new_voice", name: "Clara" });
    expect(swappedDraft.mode).toBe("tts");
    expect(swappedDraft.text).toBe("[whispers, anxious] Keep moving.");
    expect(swappedDraft.modelId).toBe("eleven_v4");
    expect(swappedDraft.stability).toBe(0.35);
    expect(swappedDraft.similarityBoost).toBe(0.8);
    expect(swappedDraft.speed).toBe(1.05);
    expect(swappedDraft.voiceId).toBe("v_new_voice");
    expect(swappedDraft.voiceName).toBe("Clara");
    expect(swappedDraft.fromTemplateId).toBe("pg_1");

    // Dialogue speaker-slot override updates only the targeted speaker while preserving others
    const dlgEntry = unified.find((u) => u.id === "pg_2");
    const dlgDraft = entryToComposerDraft(dlgEntry);
    expect({ voiceId: dlgDraft.voiceId, voiceName: dlgDraft.voiceName }).toEqual({
      voiceId: "v_rachel",
      voiceName: "Rachel",
    });
    const dlgSwapped = entryToComposerDraft(dlgEntry, {
      id: "v_clara",
      name: "Clara",
      speakerKey: "B",
    });
    expect(dlgSwapped.mode).toBe("dialogue");
    expect(dlgSwapped.speakers[0].voiceId).toBe("v_rachel");
    expect(dlgSwapped.speakers[1].voiceId).toBe("v_clara");
    expect(dlgSwapped.speakers[1].voiceName).toBe("Clara");
  });

  test("language auto-detect, dialogue bracket stripping, discrete stability snap, speed capability gating, and remix preset helpers", () => {
    expect(detectTextLanguage("[whispers] Xin chào Việt Nam!")).toBe("vi");
    expect(detectTextLanguage("[hushed] Chào buổi sáng.".normalize("NFD"))).toBe("vi");
    expect(detectTextLanguage("[whispers] Anh yêu em. Em bên anh.")).toBe("vi");
    expect(detectTextLanguage("[shouts] Cháy! Mau lên!")).toBe("vi");
    expect(detectTextLanguage("[cười] Hello friend.")).toBe("en");
    expect(detectTextLanguage("[hushed] We stopped for coffee at the café.")).toBe("en");
    expect(detectTextLanguage("We ate a crêpe at the hôtel.")).toBe("en");

    expect(stripDialogueSpeakerBrackets("[Alex]: Hi\n  [Riley]: Hey")).toBe(
      "Alex: Hi\n  Riley: Hey",
    );
    expect(
      parseDialogueTurnNames("[Alex]: Hi\n__proto__: bad\n[Alex]: Again\n[Sam]: Reply"),
    ).toEqual(["Alex", "Sam"]);

    expect(snapToDiscreteValue(0.32, [0, 0.5, 1])).toBe(0.5);
    expect(snapToDiscreteValue(0.1, [0, 0.5, 1])).toBe(0);

    const v4Settings = voiceSettingsForModel(
      { supports_speed: false, supports_similarity: true, model_id: "eleven_v4" },
      { stability: 0.4, similarityBoost: 0.8, style: 0, useSpeakerBoost: true, speed: 1.1 },
    );
    expect(v4Settings.speed).toBeUndefined();
    expect(v4Settings.similarity_boost).toBe(0.8);

    const v3Settings = voiceSettingsForModel(
      {
        supports_speed: true,
        supports_similarity: false,
        stability_values: [0, 0.5, 1],
        model_id: "eleven_v3",
      },
      { stability: 0.4, similarityBoost: 0.8, style: 0, useSpeakerBoost: true, speed: 1.5 },
    );
    expect(v3Settings.stability).toBe(0.5);
    expect(v3Settings.similarity_boost).toBeUndefined();
    expect(v3Settings.speed).toBe(1.2);

    const remix = composeFilmTakeRemixPreset({
      id: "01",
      voice: "ZaZosYpkIGmSqOwAlfnk",
      model: "eleven_v4",
      text: "[calm] Hello",
      speed: 1.05,
      stability: 0.6,
    });
    expect(remix.mode).toBe("tts");
    expect(remix.speed).toBe(1.05);
    expect(remix.stability).toBe(0.6);
    expect(remix.sourceTakeId).toBe("01");
    expect(remix.languageCode).toBe("en");
    expect(
      composeFilmTakeRemixPreset({
        id: "02",
        voice: "ZaZosYpkIGmSqOwAlfnk",
        model: "eleven_v4",
        text: "[trầm] Xin chào cả nhà nhé!",
      }).languageCode,
    ).toBe("vi");
    expect(DEFAULT_COMPOSER_DRAFT.sttLanguageCode).toBe("en");
  });

  test("Round 5 view helpers sanitize corrupt speakers, pick upload vcSourceKind, and wrap roving tab keys", () => {
    expect(extractDialogueSpeakerEntries("bad")).toEqual([]);
    expect(extractDialogueSpeakerEntries([1, 2])).toEqual([]);
    const safeSpeakers = extractDialogueSpeakerEntries({
      __proto__: { voice_id: "evil" },
      BadNull: null,
      NoVoice: { voice_name: "Missing" },
      Alex: { voice_id: "v_alex", voice_name: "Alex", voice_settings: { stability: 0.4 } },
    });
    expect(safeSpeakers).toHaveLength(1);
    expect(safeSpeakers[0]?.name).toBe("Alex");

    const entries = buildUnifiedEntries(
      [
        {
          id: "pg_corrupt_dlg",
          kind: "dialogue",
          title: "Broken Dlg",
          text: "Alex: Hi",
          tags: [],
          voiceId: "v_alex",
          voiceName: "Alex",
          modelId: "eleven_v4",
          languageCode: "en",
          voiceSettings: {},
          exportTranscript: false,
          dialogue: {
            pause_between_turns: 0.5,
            speakers: {
              Bad: null,
            },
          },
          audioFile: "a.mp3",
          durationSeconds: 1,
          creditsDeducted: 1,
          provider: "elevenlabs",
          favorite: false,
          isTemplate: false,
          createdAt: "2026-11-16T00:00:00Z",
          updatedAt: "2026-11-16T00:00:00Z",
        },
        {
          id: "pg_vc_upload",
          kind: "voice_changer",
          title: "Upload VC",
          text: "[voice-changer]",
          tags: [],
          voiceId: "v_rachel",
          voiceName: "Rachel",
          modelId: "eleven_multilingual_sts_v2",
          languageCode: "",
          voiceSettings: {},
          exportTranscript: false,
          voiceChanger: {
            sourceLabel: "raw.mp3",
            sourceFile: "src_1.mp3",
            remove_background_noise: true,
          },
          audioFile: "b.mp3",
          durationSeconds: 2,
          creditsDeducted: 2,
          provider: "elevenlabs",
          favorite: false,
          isTemplate: false,
          createdAt: "2026-11-16T00:01:00Z",
          updatedAt: "2026-11-16T00:01:00Z",
        },
      ],
      [],
    );
    const corruptEntry = entries.find((e) => e.id === "pg_corrupt_dlg");
    expect(corruptEntry).toBeDefined();
    const corruptDraft = entryToComposerDraft(corruptEntry);
    expect(corruptDraft.speakers.length).toBe(2);
    expect(corruptDraft.speakers[0]?.name).toBe("Alex");

    const uploadVcEntry = entries.find((e) => e.id === "pg_vc_upload");
    expect(uploadVcEntry).toBeDefined();
    const uploadVcDraft = entryToComposerDraft(uploadVcEntry);
    expect(uploadVcDraft.vcSourceKind).toBe("upload");
    expect(uploadVcDraft.vcSourceFile).toBe("src_1.mp3");

    const tabs = ["a", "b", "c"];
    expect(nextTabId(tabs, "c", "ArrowRight")).toBe("a");
    expect(nextTabId(tabs, "a", "ArrowLeft")).toBe("c");
    expect(nextTabId(tabs, "b", "Home")).toBe("a");
    expect(nextTabId(tabs, "a", "End")).toBe("c");
    expect(nextTabId(tabs, "b", "Enter")).toBeNull();

    const sampleModels = [
      {
        model_id: "eleven_v4",
        name: "v4",
        can_do_text_to_speech: true,
        can_do_voice_conversion: false,
      },
      {
        model_id: "eleven_multilingual_sts_v2",
        name: "STS",
        can_do_text_to_speech: false,
        can_do_voice_conversion: true,
      },
    ];
    expect(resolveModeModelId("tts", "eleven_multilingual_sts_v2", sampleModels)).toBe("eleven_v4");
    expect(resolveModeModelId("voice_changer", "eleven_v4", sampleModels)).toBe(
      "eleven_multilingual_sts_v2",
    );
    expect(resolveModeModelId("tts", "eleven_multilingual_sts_v2", [])).toBe("eleven_v4");

    expect(isSafeAudioUrl("https://cdn.example/a.mp3")).toBe(true);
    expect(isSafeAudioUrl("/api/voice/playground/audio/a.mp3")).toBe(true);
    expect(isSafeAudioUrl("//evil.example/a.mp3")).toBe(false);
    expect(isSafeAudioUrl("javascript:alert(1)")).toBe(false);

    expect(
      groupDiarizedTranscript([
        { text: "Hello", start: 0.0, type: "word" },
        { text: " ", type: "spacing" },
        { text: "world", start: 0.4, type: "word" },
      ]),
    ).toEqual([]);
    expect(
      groupDiarizedTranscript([
        { text: "Hi", start: 0.0, type: "word", speaker_id: "speaker_0" },
        { text: " ", type: "spacing", speaker_id: "speaker_0" },
        { text: "there.", start: 0.3, type: "word", speaker_id: "speaker_0" },
        { text: "Hey!", start: 1.2, type: "word", speaker_id: "speaker_1" },
      ]),
    ).toEqual([
      { speaker: "speaker_0", start: 0.0, text: "Hi there." },
      { speaker: "speaker_1", start: 1.2, text: "Hey!" },
    ]);
  });
});
