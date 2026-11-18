import { expect, test } from "bun:test";

import {
  appliedEditRows,
  recordingEditRecipe,
  regionGenerationRecipe,
  replaceUniquePhrase,
  samePhraseGeneration,
  wordRangeSelection,
} from "../app/sound/voice-region-view";
import { recordingCandidatesForClip } from "../app/sound/voice-view";
import { recordingWords } from "../src/voice-playground-text.mjs";

test("region regeneration submits a compatible custom-ID recipe and keeps its source recording unchanged", () => {
  const item = {
    provider: "minimax",
    voiceId: "old",
    voiceName: "Korean narrator",
    modelId: "speech-2.8-hd",
    languageCode: "Korean",
    voiceSettings: { speed: 1.1, pitch: -2, vol: 1.01 },
  };
  const catalog = {
    languages: [
      { code: "ko", name: "Korean" },
      { code: "en", name: "English" },
    ],
    providerLanguages: {
      capcut: [
        { code: "en", name: "English" },
        { code: "vi", name: "Vietnamese" },
      ],
    },
    models: [
      {
        provider: "capcut",
        model_id: "capcut",
        can_do_text_to_speech: true,
        supports_speed: true,
        languages: [
          { language_id: "en", name: "English" },
          { language_id: "vi", name: "Vietnamese" },
        ],
      },
    ],
  };
  const selected = { id: "67890", name: "Custom CapCut", provider: "capcut" };
  const recipe = regionGenerationRecipe(
    item,
    { seed: 9, previousText: "Before" },
    selected,
    item.modelId,
    catalog,
  );
  expect(recipe).toMatchObject({
    provider: "capcut",
    voiceId: "67890",
    modelId: "capcut",
    languageCode: "en",
    voiceSettings: { speed: 1.1, pitch: -2 },
  });
  expect(recipe.seed).toBeUndefined();
  expect(recipe.previousText).toBeUndefined();
  expect(recipe.voiceSettings.vol).toBeUndefined();
  expect(
    regionGenerationRecipe(item, null, { ...selected, language: "vi" }, "capcut", catalog)
      .languageCode,
  ).toBe("vi");
  expect(item.languageCode).toBe("Korean");
  expect(item.voiceSettings.vol).toBe(1.01);
  expect(
    regionGenerationRecipe(
      { ...item, languageCode: "English" },
      null,
      { ...selected, language: "en" },
      "capcut",
      catalog,
      "vi",
    ).languageCode,
  ).toBe("vi");
});

test("a phrase selection includes every timed word between its endpoints in either click order", () => {
  const words = [
    { w: "Fix", s: 0, e: 0.4 },
    { w: "this", s: 0.5, e: 0.8 },
    { w: "phrase", s: 1, e: 1.4 },
    { w: "later", s: 2, e: 3 },
  ];
  expect(wordRangeSelection(words, 0, 2)).toEqual({ from: 0, to: 1.4, text: "Fix this phrase" });
  expect(wordRangeSelection(words, 2, 0)).toEqual({ from: 0, to: 1.4, text: "Fix this phrase" });
});

test("a generated phrase can be reused after changing the splice but never after changing its words or acting", () => {
  const original = {
    mode: "regenerate",
    from: 0,
    to: 1,
    replacementText: "Stay here.",
    fullText: "Stay here. I will return.",
    voiceId: "actor",
    modelId: "eleven_v4",
    voiceSettings: { speed: 0.9 },
    seed: 4,
  };
  expect(
    samePhraseGeneration(original, { ...original, to: 2, fitToSelection: false, gainDb: -6 }),
  ).toBe(true);
  expect(samePhraseGeneration(original, { ...original, replacementText: "Come here." })).toBe(
    false,
  );
  expect(samePhraseGeneration(original, { ...original, voiceSettings: { speed: 1.1 } })).toBe(
    false,
  );
  expect(samePhraseGeneration(original, { mode: "local", from: 0, to: 1 })).toBe(false);
  expect(samePhraseGeneration(original, { ...original, provider: "minimax" })).toBe(false);
});

test("updating a selected phrase keeps the rest of the script exact and refuses ambiguous matches", () => {
  expect(replaceUniquePhrase("[hushed] One two three.", "two", "new words")).toBe(
    "[hushed] One new words three.",
  );
  expect(replaceUniquePhrase("One two two three.", "two", "new words")).toBeNull();
  expect(replaceUniquePhrase("One two three.", "missing", "new words")).toBeNull();
  expect(replaceUniquePhrase("One two three.", "", "new words")).toBeNull();
});

test("fresh transcription supplies actual timing after unaligned edits and takes precedence over older alignment", () => {
  const sttResult = {
    words: [
      { text: " ", start: 0, end: 0.1 },
      { text: "new", start: 0.1, end: 0.4 },
      { text: "words", start: 0.5, end: 0.9 },
    ],
  };
  const expected = [
    { w: "new", s: 0.1, e: 0.4 },
    { w: "words", s: 0.5, e: 0.9 },
  ];
  expect(recordingWords({ wordTimings: [], sttResult })).toEqual(expected);
  expect(recordingWords({ wordTimings: [{ w: "old", s: 0, e: 0.8 }], sttResult })).toEqual(
    expected,
  );
  expect(recordingWords({ wordTimings: expected })).toEqual(expected);
});

test("timeline repair finds real recorded takes from assembly placements even without word alignment", () => {
  const takes = [
    { id: "01", file: "01.wav", aligned: false },
    { id: "02", file: "02.wav", aligned: false },
    { id: "03", file: null, aligned: false },
  ];
  const placements = [
    { id: "01", start: 0, naturalEnd: 3 },
    { id: "02", start: 3.5, naturalEnd: 7 },
  ];
  expect(
    recordingCandidatesForClip(
      { name: "narration", start: 4, length: 1 },
      "narration",
      8,
      placements,
      takes,
    ).map((take) => take.id),
  ).toEqual(["02"]);
  expect(
    recordingCandidatesForClip(
      { name: "narration", start: 0, length: 8 },
      "narration",
      8,
      placements,
      takes,
    ).map((take) => take.id),
  ).toEqual(["01", "02"]);
  expect(
    recordingCandidatesForClip(
      { name: "narration", start: 0, length: 8 },
      "narration",
      8,
      [],
      takes,
    ).map((take) => take.id),
  ).toEqual(["01", "02"]);
  expect(
    recordingCandidatesForClip(
      { name: "music", start: 0, length: 8 },
      "narration",
      8,
      placements,
      takes,
    ),
  ).toEqual([]);
});

test("saved edit details expose the applied region and settings independently of the next edit defaults", () => {
  const local = {
    text: "A line",
    version: {
      edit: {
        mode: "local",
        from: 0.5,
        to: 2.5,
        rate: 0.8,
        pitch: 1,
        gainDb: -3,
        pause: 0.2,
        blendMs: 6,
      },
      regionSeconds: 2.7,
    },
  };
  const rows = Object.fromEntries(appliedEditRows(local).map((row) => [row.label, row.value]));
  expect(rows).toMatchObject({
    Region: "0.50–2.50 s",
    Speed: "0.8×",
    Pitch: "+1 semitones",
    Volume: "-3 dB",
    "Pause after": "0.2 s",
    "Join blend": "6 ms",
  });
  expect(recordingEditRecipe(local)).toMatchObject({
    mode: "local",
    from: 0.5,
    to: 2.5,
    rate: 0.8,
    gainDb: -3,
  });
  const regenerated = {
    ...local,
    version: {
      edit: {
        mode: "regenerate",
        from: 0.5,
        to: 2.5,
        replacementText: "Changed",
        fullText: "A changed line",
        fitToSelection: true,
      },
      replacement: {
        voiceId: "new_actor",
        voiceName: "New actor",
        modelId: "eleven_v4",
        voiceSettings: { speed: 0.9 },
        seed: 42,
      },
    },
  };
  expect(recordingEditRecipe(regenerated)).toMatchObject({
    mode: "regenerate",
    voiceId: "new_actor",
    modelId: "eleven_v4",
    voiceSettings: { speed: 0.9 },
    seed: 42,
    replacementText: "Changed",
  });
  expect(appliedEditRows(regenerated)).toEqual(
    expect.arrayContaining([
      { label: "Replacement voice", value: "New actor (new_actor)" },
      { label: "Replacement seed", value: "42" },
    ]),
  );
});
