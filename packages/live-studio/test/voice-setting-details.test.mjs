import { expect, test } from "bun:test";

import { recordedCastSummary, recordedVoiceSettings } from "../app/sound/voice-setting-details";

test("mixed recording summaries retain every source, model and role", () => {
  const summary = recordedCastSummary([
    { name: "Narrator", model_id: "eleven_v4", voice_id: "a" },
    { name: "Old Man", provider: "minimax", model_id: "speech-2.8-hd", voice_id: "b" },
    { name: "Cartoon", provider: "capcut", model_id: "capcut", voice_id: "c" },
  ]);
  expect(summary.modelLabel).toBe("Mixed models · eleven_v4, speech-2.8-hd, capcut");
  expect(summary.sources).toBe("ElevenLabs, MiniMax, CapCut");
  expect(summary.voices).toBe("Narrator: a; Old Man: b; Cartoon: c");
  expect(
    recordedCastSummary([
      { name: "A", model_id: "eleven_v4", voice_id: "a" },
      { name: "B", model_id: "eleven_v4", voice_id: "b" },
    ]).modelLabel,
  ).toBe("eleven_v4");
});

test("recorded native settings expose pitch and MiniMax volume without inventing ElevenLabs controls", () => {
  expect(recordedVoiceSettings("minimax", { speed: 1.05, pitch: 12, vol: 10 })).toEqual([
    { label: "Speed", value: "1.05×", mono: true },
    { label: "Pitch", value: "12 semitones", mono: true },
    { label: "Volume", value: "10.00×", mono: true },
  ]);
  expect(
    recordedVoiceSettings("capcut", { speed: 0.6, pitch: -12, vol: 9 }).map((row) => row.label),
  ).toEqual(["Speed", "Pitch"]);
  expect(
    recordedVoiceSettings("elevenlabs", {
      stability: 0,
      similarity_boost: 0.7,
      speed: 1.2,
      pitch: 3,
      vol: 4,
    }).find((row) => row.label === "Stability").value,
  ).toBe("0.00");
  expect(
    recordedVoiceSettings("elevenlabs", { pitch: 3, vol: 4 }).some((row) =>
      ["Pitch", "Volume"].includes(row.label),
    ),
  ).toBe(false);
});
