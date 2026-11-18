import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uploadDubbingSource } from "../src/voice-playground-dubbing-upload.mjs";

const parameters = {
  sourceLanguage: "en",
  targetLanguage: "vi",
  provider: "minimax",
  voiceId: "English_Resonant_Man",
  filename: "scene.wav",
  contentType: "audio/wav",
};
test("Dubbing resumes the documented chunk session without uploading confirmed chunks again", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-upload-")),
    file = join(root, "scene.wav");
  writeFileSync(file, "abcdefghij");
  let checkpoint = {},
    failSecond = true,
    initializations = 0,
    completions = 0;
  const chunks = new Map(),
    confirmed = [];
  const request = async (path, init) => {
    if (path.endsWith("/init")) {
      initializations++;
      return { data: { upload_id: "session", chunk_size: 3 } };
    }
    if (path.endsWith("/chunk")) {
      const index = Number(init.body.get("index"));
      if (index === 1 && failSecond) {
        failSecond = false;
        throw new Error("Connection interrupted");
      }
      expect(init.body.get("chunk")).toBeInstanceOf(Blob);
      expect(init.body.has("file")).toBe(false);
      chunks.set(index, await init.body.get("chunk").text());
      confirmed.push(index);
      return { data: { ok: true } };
    }
    if (path.endsWith("/complete")) {
      completions++;
      expect(init.body.get("total_chunks")).toBe("4");
      expect(init.body.get("source_language")).toBe("en");
      return { data: { task_id: "existing_dub" } };
    }
    throw new Error("Unexpected isolated upload request");
  };
  const options = {
    request,
    save: async (next) => {
      checkpoint = structuredClone(next);
    },
  };
  try {
    await expect(uploadDubbingSource(file, parameters, { ...options, checkpoint })).rejects.toThrow(
      "Connection interrupted",
    );
    expect(checkpoint.uploaded).toEqual([0]);
    const result = await uploadDubbingSource(file, parameters, { ...options, checkpoint });
    expect(result.taskId).toBe("existing_dub");
    expect(
      [...chunks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, text]) => text)
        .join(""),
    ).toBe("abcdefghij");
    expect(confirmed).toEqual([0, 1, 2, 3]);
    expect(initializations).toBe(1);
    expect(completions).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lost Dubbing completion response leaves an uncertain checkpoint and never repeats the charge", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-uncertain-")),
    file = join(root, "scene.wav");
  writeFileSync(file, "abc");
  let checkpoint = {},
    completions = 0;
  const request = async (path) => {
    if (path.endsWith("/init")) return { data: { upload_id: "session", chunk_size: 10 } };
    if (path.endsWith("/chunk")) return { data: { ok: true } };
    completions++;
    throw new Error("Response lost after submission");
  };
  const options = {
    request,
    save: async (next) => {
      checkpoint = structuredClone(next);
    },
  };
  try {
    await expect(uploadDubbingSource(file, parameters, { ...options, checkpoint })).rejects.toThrow(
      "Response lost",
    );
    expect(checkpoint.phase).toBe("uncertain");
    await expect(uploadDubbingSource(file, parameters, { ...options, checkpoint })).rejects.toThrow(
      /history/i,
    );
    expect(completions).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
