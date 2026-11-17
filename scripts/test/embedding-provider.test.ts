import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runIndex } from "../semantic/engine";
import { configuredProvider, createEmbedder } from "../semantic/model";
import { openIndex } from "../semantic/store";

test("a backup is an independent resumable SQLite snapshot and refuses to overwrite a destination", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-backup-"));
  const index = openIndex(":memory:");
  try {
    const asset = { key: "a", title: "Rain", text: "Rain" };
    index.stage(asset, "bytes", [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
    index.complete(index.pending("a")[0]!, {
      vector: Array.from({ length: 768 }, (_, i) => (i ? 0 : 1)),
      usage: {},
    });
    const target = join(folder, "snapshot.sqlite");
    index.backup(target);
    expect(() => index.backup(target)).toThrow(/exists/);
    index.remove("a", true);
    const restored = openIndex(target);
    try {
      expect(restored.ready()).toEqual(["a"]);
      expect(restored.pending("a")).toHaveLength(1);
      expect(
        restored.search(
          Array.from({ length: 768 }, (_, i) => (i ? 0 : 1)),
          new Set(["a"]),
        ),
      ).toHaveLength(1);
    } finally {
      restored.close();
    }
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("automatic provider selection prefers the configured Google key; explicit selection never switches providers", () => {
  const keys = { GEMINI_API_KEY: "google-offline", OPENROUTER_API_KEY: "router-offline" };
  expect(configuredProvider("auto", keys)).toEqual({
    provider: "gemini",
    apiKey: "google-offline",
  });
  expect(configuredProvider("openrouter", keys)).toEqual({
    provider: "openrouter",
    apiKey: "router-offline",
  });
  expect(configuredProvider("gemini", { OPENROUTER_API_KEY: "router-offline" }).apiKey).toBe("");
  expect(() => configuredProvider("wrong", keys)).toThrow(/provider/i);
});

test("Gemini receives one multimodal content with native authentication and dimensions", async () => {
  let body: unknown;
  let credential = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      credential = request.headers.get("x-goog-api-key") ?? "";
      body = await request.json();
      return Response.json({
        embedding: { values: Array.from({ length: 768 }, (_, i) => (i === 1 ? 2 : 0)) },
      });
    },
  });
  try {
    const embed = createEmbedder({
      provider: "gemini",
      apiKey: "offline-secret",
      endpoint: String(server.url),
    });
    const result = await embed([
      { type: "text", text: "short metallic impact" },
      { type: "input_audio", input_audio: { data: "data:audio/mp3;base64,AA==", format: "mp3" } },
    ]);
    expect(result.vector[1]).toBe(1);
    expect(credential).toBe("offline-secret");
    expect(body).toEqual({
      model: "models/gemini-embedding-2",
      outputDimensionality: 768,
      content: {
        parts: [
          { text: "short metallic impact" },
          { inlineData: { mimeType: "audio/mp3", data: "AA==" } },
        ],
      },
    });
  } finally {
    server.stop(true);
  }
});

test("quota failures are identifiable and cannot disclose a provider credential or error body", async () => {
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      return Response.json(
        { error: { message: "offline-secret private body", status: "RESOURCE_EXHAUSTED" } },
        { status: 429, headers: { "retry-after": "60" } },
      );
    },
  });
  try {
    const embed = createEmbedder({
      provider: "gemini",
      apiKey: "offline-secret",
      endpoint: String(server.url),
    });
    const error = await embed([{ type: "text", text: "rain" }]).catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(60000);
    expect(error.message).not.toContain("offline-secret");
    expect(error.message).not.toContain("private body");
    expect(calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("rate pacing respects the build deadline and leaves unfinished chunks resumable", async () => {
  const index = openIndex(":memory:");
  let requests = 0;
  try {
    const result = await runIndex(
      [
        { key: "a", title: "rain", text: "rain" },
        { key: "b", title: "wind", text: "wind" },
      ],
      index,
      {
        allowApi: true,
        maxRequests: 10,
        deadline: Date.now() + 3000,
        pace: { rpm: 1, tpm: 24000 },
        embed: async () => {
          requests++;
          return { vector: Array.from({ length: 768 }, (_, i) => (i ? 0 : 1)), usage: {} };
        },
      },
    );
    expect(result.stopped).toBe("time-limit");
    expect(requests).toBe(1);
    expect(index.ready()).toEqual(["a"]);
    expect(index.pending("b")).toHaveLength(1);
  } finally {
    index.close();
  }
});

for (const [basis, pace] of [
  ["RPM", { rpm: 400, tpm: 10000000 }],
  ["TPM", { rpm: 10000, tpm: 40000 }],
] as const)
  test(`successful consecutive embeddings wait for the configured ${basis} interval`, async () => {
    const index = openIndex(":memory:"),
      starts: number[] = [];
    try {
      const result = await runIndex(
        [
          { key: "a", title: "rain", text: "rain" },
          { key: "b", title: "wind", text: "wind" },
        ],
        index,
        {
          allowApi: true,
          maxRequests: 2,
          deadline: Date.now() + 3000,
          pace,
          embed: async () => {
            starts.push(Date.now());
            return { vector: Array.from({ length: 768 }, (_, i) => (i ? 0 : 1)), usage: {} };
          },
        },
      );
      expect(result.stopped).toBe("complete");
      expect(starts).toHaveLength(2);
      expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(145);
    } finally {
      index.close();
    }
  });
