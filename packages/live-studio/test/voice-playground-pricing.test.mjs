import { expect, test } from "bun:test";

import { quoteGeneration } from "../app/sound/voice-playground-pricing.ts";

const models = [
  { model_id: "eleven_v4", model_rates: { character_cost_multiplier: 1 } },
  { model_id: "eleven_v4_turbo", model_rates: { character_cost_multiplier: 0.5 } },
];
test("an unverified voice fee never becomes a quoted total, including free-looking catalog rates", () => {
  const quote = quoteGeneration(
    {
      mode: "tts",
      text: "Hello",
      modelId: "eleven_v4",
      voiceId: "actor",
      voiceName: "Actor",
      variations: 3,
      exportTranscript: true,
      voiceRate: 0,
    },
    models,
  );
  expect(quote.totalCredits).toBeNull();
  expect(quote.baseCredits).toBe(18);
  expect(quote.rows[0].characters).toBe(5);
});
test("dialogue estimates each role with its own model and excludes speaker cues", () => {
  const quote = quoteGeneration(
    {
      mode: "dialogue",
      text: "Alex: Hello\nRiley: Hi\nAlex: Bye",
      speakers: [
        { name: "Alex", voiceId: "a", modelId: "eleven_v4" },
        { name: "Riley", voiceId: "b", modelId: "eleven_v4_turbo" },
      ],
    },
    models,
  );
  expect(quote.rows.map((r) => [r.label, r.characters, r.baseCredits])).toEqual([
    ["Alex", 8, 8],
    ["Riley", 2, 1],
  ]);
  expect(quote.baseCredits).toBe(9);
  expect(quote.totalCredits).toBeNull();
});
test("unknown models and duration billed modes do not silently inherit a rate of one", () => {
  expect(
    quoteGeneration({ mode: "tts", text: "Hello", modelId: "new_model" }, models).baseCredits,
  ).toBeNull();
  expect(quoteGeneration({ mode: "voice_changer", text: "" }, models).totalCredits).toBeNull();
});
