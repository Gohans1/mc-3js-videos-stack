import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  matchChoice,
  speechAccountMatches,
  speechUrl,
  validateBatchManifest,
  validateScene,
  voiceSampleUrl,
} from "./input";

test("TTS URLs are limited to the AI Studio speech workspace and selected speech model", () => {
  expect(speechUrl("gemini-3.8-flash-tts", "5")).toBe(
    "https://aistudio.google.com/u/5/generate-speech?model=gemini-3.8-flash-tts",
  );
  expect(() => speechUrl("gemini-4-neon")).toThrow("TTS model");
  expect(() => speechUrl("gemini-3.8-flash-tts", "../library")).toThrow("account");
});

test("a screenplay preserves inline expressions, Vietnamese text, and an empty optional style", () => {
  const scene = {
    blocks: [{ text: "<gasp> Đừng quay lại.\nChạy đi!", style: "", speaker: 1 as const }],
  };
  expect(validateScene(scene)).toEqual(scene);
});

test("invalid screenplay data fails with the exact field before opening Chrome", () => {
  expect(() => validateScene({ blocks: [{ text: "line", speaker: 3 }] })).toThrow(
    "blocks[0].speaker",
  );
  expect(() => validateScene({ blocks: [{ text: "line", speaker: 2 }] })).toThrow(
    "alternates speakers",
  );
  expect(() => validateScene({ voices: ["Fola", "Rami"], blocks: [{ text: "line" }] })).toThrow(
    "two speech blocks",
  );
  expect(validateScene({ voices: [" Cruz "], blocks: [{ text: "line" }] }).voices).toEqual([
    "Cruz",
  ]);
  expect(() => validateScene({ blocks: [{ text: "", typo: true }] })).toThrow("blocks[0].typo");
  expect(() => validateScene({ blocks: [{ text: " " }] })).toThrow("blocks[0].text");
});

test("sample export accepts only the public WAV assets observed in the catalog player", () => {
  const valid = "https://www.gstatic.com/aistudio/voices/samples/daikon/en-us-fola.wav";
  expect(voiceSampleUrl(valid)).toBe(valid);
  for (const invalid of [
    "https://someone.example/aistudio/voices/samples/en-us-fola.wav",
    "https://www.gstatic.com/not-a-voice.wav",
    "https://www.gstatic.com/aistudio/voices/samples/draft.wav?token=secret",
  ])
    expect(voiceSampleUrl(invalid)).toBeUndefined();
});

test("an explicitly requested account never falls through to the default or a neighboring slot", () => {
  expect(speechAccountMatches("/u/5/generate-speech", "5")).toBe(true);
  expect(speechAccountMatches("/u/50/generate-speech", "5")).toBe(false);
  expect(speechAccountMatches("/u/0/generate-speech", "5")).toBe(false);
  expect(speechAccountMatches("/generate-speech", "5")).toBe(false);
});

test("matchChoice matches case-insensitively and returns the live option label", () => {
  expect(matchChoice(["All genders", "Feminine", "Masculine"], "masculine")).toBe("Masculine");
  expect(matchChoice(["All genders", "Feminine", "Masculine"], "  FEMININE  ")).toBe("Feminine");
  expect(matchChoice(["All genders", "Feminine", "Masculine"], "Male")).toBeUndefined();
});

test("validateBatchManifest validates shared defaults and per-take text or blocks", () => {
  const manifest = validateBatchManifest({
    temperature: 0.9,
    voices: ["Cruz"],
    takes: [
      { out: "takes/01.wav", text: "First line.", style: "Calm" },
      { out: "takes/02.wav", text: "Second line." },
    ],
  });
  expect(manifest.takes).toHaveLength(2);
  const dialogueManifest = validateBatchManifest({
    voices: ["Fola", "Rami"],
    takes: [
      {
        out: "takes/dialogue.wav",
        blocks: [
          { speaker: 1, text: "Hello." },
          { speaker: 2, text: "Hi there.", style: "Warm" },
        ],
      },
    ],
  });
  expect(dialogueManifest.takes[0]?.blocks).toHaveLength(2);
  expect(() => validateBatchManifest({ takes: [] })).toThrow("takes");
  expect(() => validateBatchManifest({ takes: [{ out: "takes/01.mp3", text: "Line" }] })).toThrow(
    ".wav",
  );
  expect(() =>
    validateBatchManifest({
      takes: [{ out: "takes/both.wav", text: "Hi", blocks: [{ text: "Hi" }] }],
    }),
  ).toThrow("not both");
  expect(() =>
    validateBatchManifest({
      takes: [{ out: "takes/bad-style.wav", style: "Calm", blocks: [{ text: "Hi" }] }],
    }),
  ).toThrow("cannot be combined with blocks");
  expect(() =>
    validateBatchManifest({
      voices: ["Fola", "Rami"],
      takes: [{ out: "takes/one.wav", text: "Only one block." }],
    }),
  ).toThrow("two speech blocks");
  expect(() =>
    validateBatchManifest({
      takes: [
        { out: "takes/dup.wav", text: "One" },
        { out: "takes/dup.wav", text: "Two" },
      ],
    }),
  ).toThrow("duplicate");
});

test("cli.ts enforces --tab naming rules and returns valid JSON for close on an unregistered tab", () => {
  const cli = resolve(import.meta.dir, "cli.ts");
  const badTab = Bun.spawnSync(["bun", cli, "--tab", "tts-bad_name", "status"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(badTab.exitCode).toBe(2);
  expect(badTab.stderr.toString()).toContain("no underscores");
  expect(badTab.stderr.toString()).toContain("5–31");

  const closeMissing = Bun.spawnSync(
    ["bun", cli, "--tab", "tts-never-registered", "--json", "close"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(closeMissing.exitCode).toBe(0);
  expect(JSON.parse(closeMissing.stdout.toString())).toBe("tab already closed");

  const speakNoOut = Bun.spawnSync(["bun", cli, "--tab", "tts-check", "speak", "scene.json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(speakNoOut.exitCode).toBe(2);
  expect(speakNoOut.stderr.toString()).toContain("speak requires --out");

  const badKeepOpen = Bun.spawnSync(["bun", cli, "--tab", "tts-check", "--keep-open", "open"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(badKeepOpen.exitCode).toBe(2);
  expect(badKeepOpen.stderr.toString()).toContain(
    "--keep-open is only accepted by speak and batch",
  );
}, 60_000);
