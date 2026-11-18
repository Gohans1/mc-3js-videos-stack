import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { submitCloneRecord } from "../src/voice-playground-clone-protocol.mjs";

test("a clone checkpoints its source and remote identity and sends provider field names exactly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-protocol-"));
  const file = join(dir, "source.wav");
  writeFileSync(file, "fixture source");
  const record = {
    id: "local_clone",
    phase: "prepared",
    sourceFile: "source.wav",
    settings: {
      name: "My narrator",
      language: "English",
      gender: "Female",
      noiseReduction: false,
      previewText: "Hello",
    },
  };
  const saved = [],
    sent = [];
  try {
    const result = await submitCloneRecord(
      record,
      file,
      async (path, init) => {
        const form = await new Request("https://fixture.invalid", init).formData();
        sent.push({ path, form });
        expect(saved.at(-1).phase).toBe("submitting");
        return { id: "remote_123", status: "processing", voice_name: "My narrator" };
      },
      (next) => saved.push(structuredClone(next)),
    );
    expect(result).toMatchObject({
      phase: "processing",
      remoteId: "remote_123",
      sourceFile: "source.wav",
    });
    expect(sent[0].path).toBe("/minimax/voices/clone");
    expect(sent[0].form.get("file").name).toBe("source.wav");
    expect(Object.fromEntries([...sent[0].form].filter(([key]) => key !== "file"))).toEqual({
      voice_name: "My narrator",
      language_tag: "English",
      gender: "Female",
      need_noise_reduction: "false",
      preview_text: "Hello",
    });
    await expect(
      submitCloneRecord(
        result,
        file,
        () => {
          throw new Error("must not submit again");
        },
        () => {},
      ),
    ).rejects.toThrow("already submitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a lost clone response remains uncertain and can never silently submit a duplicate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-uncertain-"));
  const file = join(dir, "source.wav");
  writeFileSync(file, "fixture source");
  const saved = [];
  let submissions = 0;
  try {
    await expect(
      submitCloneRecord(
        {
          id: "local_clone",
          phase: "prepared",
          sourceFile: "source.wav",
          settings: {
            name: "My narrator",
            language: "English",
            gender: "Male",
            noiseReduction: true,
            previewText: "Hello",
          },
        },
        file,
        async () => {
          submissions++;
          throw new Error("Connection lost");
        },
        (next) => saved.push(structuredClone(next)),
      ),
    ).rejects.toThrow("Connection lost");
    expect(saved.at(-1)).toMatchObject({ phase: "uncertain", sourceFile: "source.wav" });
    await expect(
      submitCloneRecord(
        saved.at(-1),
        file,
        async () => {
          submissions++;
        },
        () => {},
      ),
    ).rejects.toThrow("already submitted");
    expect(submissions).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
