import { describe, expect, test } from "bun:test";

import {
  buildUnifiedEntries,
  composeFilmTakeRemixPreset,
  DEFAULT_COMPOSER_DRAFT,
  DEFAULT_PLAYGROUND_FILTERS,
  detectTextLanguage,
  entryToComposerDraft,
  extractDialogueSpeakerEntries,
  extractPlaygroundFacets,
  filterAndSortEntries,
  groupDiarizedTranscript,
  isSafeAudioUrl,
  nextTabId,
  parseDialogueTurnNames,
  resolveModeModelId,
  snapToDiscreteValue,
  stripDialogueSpeakerBrackets,
  voiceSettingsForModel,
} from "../app/sound/voice-playground-view";
import {
  AUDIO_TAG_CATEGORIES,
  estimateGenerationCredits,
  insertAudioTagAtSelection,
  modelSupportsAudioTags,
  parsePromptSegments,
} from "../app/sound/voice-tags";
import { parseTakeScript } from "../app/sound/voice-view";

describe("ElevenLabs v4 Audio Tags & Playground View Helpers", () => {
  test("AUDIO_TAG_CATEGORIES exposes complete categorized ElevenLabs v4 tags", () => {
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
    expect(detectTextLanguage("[cười] Hello friend.")).toBe("en");

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
