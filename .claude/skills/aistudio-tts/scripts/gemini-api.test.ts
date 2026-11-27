import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  batchGeminiApi,
  buildInteractionsPayload,
  decodeInteractionsAudio,
  listGeminiApiVoices,
  parseInteractionsRetryAfterMs,
  speakGeminiApi,
} from "./gemini-api";
import { validateBatchManifest, validateScene } from "./input";

function makeValidWav(sampleCount = 240, sampleRate = 24_000, corruptByteRate = false) {
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(corruptByteRate ? sampleRate * 4 : sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i++) {
    wav.writeInt16LE((i % 16) * 500, 44 + i * 2);
  }
  return wav;
}

function makeAudioResponse(
  wav: Buffer,
  usage = { total_input_tokens: 12, total_output_tokens: 90, total_tokens: 102 },
) {
  return new Response(
    JSON.stringify({
      steps: [
        { type: "model_thought", content: [{ type: "text", text: "planning" }] },
        {
          type: "model_output",
          content: [{ type: "audio", mime_type: "audio/wav", data: wav.toString("base64") }],
        },
      ],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeTempPool(keys: Array<{ label: string; value: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "aistudio-tts-gmn-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ keys }, null, 2));
  return dir;
}

test("buildInteractionsPayload builds single-speaker request with style and temperature", () => {
  const scene = validateScene({
    temperature: 0.65,
    voices: ["Rasalgethi"],
    blocks: [{ style: "Crisp, clear explainer.", text: "Hello world." }],
  });
  const payload = buildInteractionsPayload(scene, "gemini-3.8-flash-tts");
  expect(payload).toEqual({
    model: "gemini-3.8-flash-tts",
    store: false,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: "Hello world.",
            annotations: [{ type: "speech_metadata", style: "Crisp, clear explainer." }],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: {
      temperature: 0.65,
      speech_config: [{ voice: "Rasalgethi" }],
    },
  });
});

test("buildInteractionsPayload omits annotations when style is empty or omitted", () => {
  const scene = validateScene({
    voices: ["Zeno"],
    blocks: [{ style: "   ", text: "Plain read." }],
  });
  const payload = buildInteractionsPayload(scene, "gemini-3.8-flash-tts");
  expect(payload.input[0]?.content[0]).toEqual({ type: "text", text: "Plain read." });
  expect(payload.generation_config.temperature).toBeUndefined();
});

test("buildInteractionsPayload uses single-speaker config when both voice slots match", () => {
  const scene = validateScene({
    temperature: 0.75,
    voices: ["Cruz", "cruz"],
    blocks: [
      { speaker: 1, style: "Calm setup.", text: "Part one." },
      { speaker: 2, style: "Urgent reveal.", text: "Part two." },
    ],
  });
  const payload = buildInteractionsPayload(scene, "gemini-3.8-flash-tts");
  expect(payload.generation_config.speech_config).toEqual([{ voice: "Cruz" }]);
  expect(payload.input[0]?.content).toEqual([
    {
      type: "text",
      text: "Part one.",
      annotations: [{ type: "speech_metadata", style: "Calm setup." }],
    },
    {
      type: "text",
      text: "Part two.",
      annotations: [{ type: "speech_metadata", style: "Urgent reveal." }],
    },
  ]);
});

test("buildInteractionsPayload builds two-speaker dialogue config with speaker annotations", () => {
  const scene = validateScene({
    temperature: 0.7,
    voices: ["Zeno", "Cruz"],
    blocks: [
      { speaker: 1, style: "Quiet and tense.", text: "Don't open it." },
      { speaker: 2, text: "Why not?" },
    ],
  });
  const payload = buildInteractionsPayload(scene, "gemini-3.8-flash-tts");
  expect(payload.generation_config.speech_config).toEqual({
    speakers: [
      { speaker: "Speaker 1", voice: "Zeno" },
      { speaker: "Speaker 2", voice: "Cruz" },
    ],
  });
  expect(payload.input[0]?.content).toEqual([
    {
      type: "text",
      text: "Don't open it.",
      annotations: [{ type: "speech_metadata", speaker: "Speaker 1", style: "Quiet and tense." }],
    },
    {
      type: "text",
      text: "Why not?",
      annotations: [{ type: "speech_metadata", speaker: "Speaker 2" }],
    },
  ]);
});

test("buildInteractionsPayload rejects banned flash-lite models, missing voices, and invalid temperature", () => {
  const scene = validateScene({ voices: ["Rasalgethi"], blocks: [{ text: "Hi." }] });
  expect(() => buildInteractionsPayload(scene, "gemini-3.8-flash-lite-tts")).toThrow(/flash-lite/i);
  expect(() => buildInteractionsPayload(scene, "gemini-3.8-flash")).toThrow(/TTS model/i);
  expect(() => buildInteractionsPayload(validateScene({ blocks: [{ text: "Hi." }] }))).toThrow(
    /voice/i,
  );
  expect(() =>
    buildInteractionsPayload(
      validateScene({ voices: ["Cruz"], blocks: [{ text: "One." }, { text: "Two." }] }),
    ),
  ).toThrow(/voices\[1\]/i);
  expect(() =>
    buildInteractionsPayload(
      validateScene({ temperature: 2.5, voices: ["Cruz"], blocks: [{ text: "Hi." }] }),
    ),
  ).toThrow(/temperature/i);
  expect(() =>
    buildInteractionsPayload({
      temperature: Number.NaN,
      voices: ["Cruz"],
      blocks: [{ text: "Hi." }],
    }),
  ).toThrow(/temperature/i);
});

test("decodeInteractionsAudio extracts WAV, repairs byte rate, and reads token usage", () => {
  const corrupted = makeValidWav(480, 24_000, true);
  const decoded = decodeInteractionsAudio({
    steps: [
      {
        type: "model_output",
        content: [{ type: "audio", data: corrupted.toString("base64") }],
      },
    ],
    usage: { total_input_tokens: 15, total_output_tokens: 120, total_tokens: 135 },
  });
  expect(decoded.bytes.readUInt32LE(28)).toBe(48_000);
  expect(decoded.duration).toBeCloseTo(0.02, 5);
  expect(decoded.usage).toEqual({ inputTokens: 15, outputTokens: 120, totalTokens: 135 });
});

test("decodeInteractionsAudio rejects missing, non-WAV, malformed, or incomplete audio responses", () => {
  const wav = makeValidWav(240);
  expect(() => decodeInteractionsAudio({ steps: [] })).toThrow(/no audio/i);
  expect(() => decodeInteractionsAudio({ steps: "not-an-array" })).toThrow(/invalid/i);
  expect(() =>
    decodeInteractionsAudio({
      status: "incomplete",
      steps: [{ type: "model_output", content: [{ type: "audio", data: wav.toString("base64") }] }],
    }),
  ).toThrow(/incomplete/i);
  expect(() =>
    decodeInteractionsAudio({
      steps: [
        {
          type: "model_output",
          content: [{ type: "audio", data: Buffer.from("not wav").toString("base64") }],
        },
      ],
    }),
  ).toThrow(/RIFF WAVE/i);
});

test("parseInteractionsRetryAfterMs parses Interactions message delay, headers, fallthrough, and defaults", () => {
  expect(
    parseInteractionsRetryAfterMs(
      null,
      {
        error: {
          message:
            "Rate limit exceeded for model gemini-3.8-flash-tts (limit: 3 requests per minute on Free Tier). Please retry in 14s or upgrade your tier.",
        },
      },
      "",
    ),
  ).toBe(14_000);
  expect(parseInteractionsRetryAfterMs(new Headers({ "retry-after": "7" }), null, "")).toBe(7_000);
  expect(
    parseInteractionsRetryAfterMs(
      new Headers({ "retry-after": "0" }),
      { error: { message: "Rate limit exceeded. Please retry in 14s." } },
      "",
    ),
  ).toBe(14_000);
  expect(
    parseInteractionsRetryAfterMs(null, null, "Temporary throttle. Please retry in 2.5s."),
  ).toBe(2_500);
  expect(parseInteractionsRetryAfterMs(null, null, "Transient 503", 2_000)).toBe(2_000);
});

test("speakGeminiApi rotates keys on 429 rate limit, records state, and writes WAV atomically", async () => {
  const poolDir = makeTempPool([
    { label: "key-a", value: "AIza-key-a" },
    { label: "key-b", value: "AIza-key-b" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  const outPath = join(outDir, "take.wav");
  const wav = makeValidWav(2400);
  const seenKeys: string[] = [];
  try {
    const result = await speakGeminiApi(
      validateScene({
        temperature: 0.65,
        voices: ["Rasalgethi"],
        blocks: [{ style: "Clear narrator.", text: "Magnet test." }],
      }),
      {
        out: outPath,
        keyPoolDir: poolDir,
        switchDelayMs: 0,
        fetchImpl: async (_url, init) => {
          const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
          seenKeys.push(key);
          if (key === "AIza-key-a") {
            return new Response(
              JSON.stringify({
                error: {
                  message: "Rate limit exceeded. Please retry in 18s.",
                  code: "too_many_requests",
                },
              }),
              { status: 429, headers: { "content-type": "application/json" } },
            );
          }
          return makeAudioResponse(wav);
        },
      },
    );
    expect(seenKeys).toEqual(["AIza-key-a", "AIza-key-b"]);
    expect(result.keyLabel).toBe("key-b");
    expect(result.model).toBe("gemini-3.8-flash-tts");
    expect(result.bytes).toBe(wav.length);
    expect(readFileSync(outPath)).toEqual(wav);
    const state = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8"));
    expect(state.until["key-a"]).toBeGreaterThan(Date.now());
    expect(state.stats["key-b"].ok).toBe(1);
    expect(state.cursor).toBe(0);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("speakGeminiApi marks 403 key dead and rotates to next healthy key", async () => {
  const poolDir = makeTempPool([
    { label: "dead-key", value: "AIza-dead" },
    { label: "live-key", value: "AIza-live" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  const outPath = join(outDir, "take.wav");
  const wav = makeValidWav(1200);
  try {
    const result = await speakGeminiApi(
      validateScene({ voices: ["Zeno"], blocks: [{ text: "Hello." }] }),
      {
        out: outPath,
        keyPoolDir: poolDir,
        switchDelayMs: 0,
        fetchImpl: async (_url, init) => {
          const key = new Headers(init?.headers).get("x-goog-api-key");
          if (key === "AIza-dead") {
            return new Response(
              JSON.stringify({ error: { message: "API key expired.", code: "permission_denied" } }),
              { status: 403 },
            );
          }
          return makeAudioResponse(wav);
        },
      },
    );
    expect(result.keyLabel).toBe("live-key");
    const state = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8"));
    expect(state.dead["dead-key"]).toBeDefined();
    expect(state.dead["live-key"]).toBeUndefined();
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("speakGeminiApi fails immediately on HTTP 400 invalid voice without rotating keys", async () => {
  const poolDir = makeTempPool([
    { label: "key-1", value: "AIza-1" },
    { label: "key-2", value: "AIza-2" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  let calls = 0;
  try {
    await expect(
      speakGeminiApi(validateScene({ voices: ["NotARealVoice"], blocks: [{ text: "Hello." }] }), {
        out: join(outDir, "bad.wav"),
        keyPoolDir: poolDir,
        switchDelayMs: 0,
        fetchImpl: async () => {
          calls++;
          return new Response(
            JSON.stringify({
              error: {
                message: "No matching speaker voice found for name: NotARealVoice",
                code: "invalid_request",
              },
            }),
            { status: 400 },
          );
        },
      }),
    ).rejects.toThrow(/No matching speaker voice/);
    expect(calls).toBe(1);
    expect(existsSync(join(outDir, "bad.wav"))).toBe(false);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("speakGeminiApi refuses to overwrite existing file unless force is true", async () => {
  const poolDir = makeTempPool([{ label: "key-1", value: "AIza-1" }]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  const outPath = join(outDir, "existing.wav");
  writeFileSync(outPath, "keep-me");
  let calls = 0;
  try {
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: outPath,
        keyPoolDir: poolDir,
        force: false,
        fetchImpl: async () => {
          calls++;
          return makeAudioResponse(makeValidWav(480));
        },
      }),
    ).rejects.toThrow(/already exists/);
    expect(calls).toBe(0);
    expect(readFileSync(outPath, "utf8")).toBe("keep-me");

    const wav = makeValidWav(480);
    await speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
      out: outPath,
      keyPoolDir: poolDir,
      force: true,
      fetchImpl: async () => makeAudioResponse(wav),
    });
    expect(readFileSync(outPath)).toEqual(wav);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("batchGeminiApi checks all output paths before requesting and rotates keys across takes", async () => {
  const poolDir = makeTempPool([
    { label: "k1", value: "AIza-k1" },
    { label: "k2", value: "AIza-k2" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-batch-"));
  const out1 = join(outDir, "01.wav");
  const out2 = join(outDir, "02.wav");
  const wav = makeValidWav(1200);
  const usedKeys: string[] = [];
  const temps: Array<number | undefined> = [];
  try {
    writeFileSync(out2, "already-there");
    const manifest = validateBatchManifest({
      temperature: 0.65,
      voices: ["Rasalgethi"],
      takes: [
        { out: out1, text: "Take one.", style: "Crisp." },
        { out: out2, text: "Take two.", temperature: 0.75 },
      ],
    });
    await expect(
      batchGeminiApi(manifest, {
        keyPoolDir: poolDir,
        force: false,
        fetchImpl: async () => makeAudioResponse(wav),
      }),
    ).rejects.toThrow(/already exists/);
    expect(existsSync(out1)).toBe(false);

    const res = await batchGeminiApi(manifest, {
      keyPoolDir: poolDir,
      force: true,
      switchDelayMs: 0,
      fetchImpl: async (_url, init) => {
        usedKeys.push(new Headers(init?.headers).get("x-goog-api-key") ?? "");
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        temps.push(body.generation_config?.temperature);
        return makeAudioResponse(wav);
      },
    });
    expect(res.takes).toHaveLength(2);
    expect(usedKeys).toEqual(["AIza-k1", "AIza-k2"]);
    expect(temps).toEqual([0.65, 0.75]);
    expect(readFileSync(out1)).toEqual(wav);
    expect(readFileSync(out2)).toEqual(wav);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("listGeminiApiVoices queries /v1beta/voices and normalizes catalog entries", async () => {
  const poolDir = makeTempPool([{ label: "k1", value: "AIza-k1" }]);
  let requestedUrl = "";
  try {
    const result = await listGeminiApiVoices({
      search: "Zeno",
      keyPoolDir: poolDir,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            voices: [
              {
                id: "en-us-zeno",
                type: "prebuilt",
                display_name: "Zeno",
                language_code: "en-US",
                region_code: "US",
                accent: "Northwest",
                gender: "male",
                pitch: "high",
                persona: "Character",
                context: "Entertainment & Gaming",
                description: "Cool voice.",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(requestedUrl).toContain("/v1beta/voices?");
    expect(requestedUrl).toContain("search=Zeno");
    expect(result.voices).toEqual([
      {
        id: "en-us-zeno",
        name: "Zeno",
        type: "prebuilt",
        language: "en-US",
        region: "US",
        accent: "Northwest",
        gender: "male",
        pitch: "high",
        persona: "Character",
        context: "Entertainment & Gaming",
        description: "Cool voice.",
      },
    ]);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
  }
});

test("cli.ts enforces --backend api rules and bans flash-lite-tts on every backend", () => {
  const cli = resolve(import.meta.dir, "cli.ts");
  const badModelApi = Bun.spawnSync(
    [
      "bun",
      cli,
      "--backend",
      "api",
      "--model",
      "gemini-3.8-flash-lite-tts",
      "speak",
      "scene.json",
      "--out",
      "out.wav",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(badModelApi.exitCode).toBe(2);
  expect(badModelApi.stderr.toString()).toMatch(/flash-lite/i);

  const badModelWeb = Bun.spawnSync(["bun", cli, "--model", "gemini-3.8-flash-lite-tts", "open"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(badModelWeb.exitCode).toBe(2);
  expect(badModelWeb.stderr.toString()).toMatch(/flash-lite/i);

  const badCmdApi = Bun.spawnSync(["bun", cli, "--backend", "api", "open"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(badCmdApi.exitCode).toBe(2);
  expect(badCmdApi.stderr.toString()).toContain("speak, batch, and voices");

  const accountWithApi = Bun.spawnSync(
    ["bun", cli, "--backend", "api", "--account", "1", "voices"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(accountWithApi.exitCode).toBe(2);
  expect(accountWithApi.stderr.toString()).toContain("--account");

  const poolWithWeb = Bun.spawnSync(["bun", cli, "--key-pool-dir", "pool", "tabs"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(poolWithWeb.exitCode).toBe(2);
  expect(poolWithWeb.stderr.toString()).toContain("--backend api");

  const roundsWithWeb = Bun.spawnSync(["bun", cli, "--rounds", "2", "tabs"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(roundsWithWeb.exitCode).toBe(2);
  expect(roundsWithWeb.stderr.toString()).toContain("--backend api");

  const keepOpenWithApi = Bun.spawnSync(["bun", cli, "--backend", "api", "--keep-open", "voices"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(keepOpenWithApi.exitCode).toBe(2);
  expect(keepOpenWithApi.stderr.toString()).toContain("--keep-open");

  const roundsZero = Bun.spawnSync(["bun", cli, "--backend", "api", "--rounds", "0", "voices"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(roundsZero.exitCode).toBe(2);

  const roundsTooHigh = Bun.spawnSync(
    ["bun", cli, "--backend", "api", "--rounds", "11", "voices"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(roundsTooHigh.exitCode).toBe(2);
  expect(roundsTooHigh.stderr.toString()).toContain("1 and 10");

  const emptyPoolDirArg = Bun.spawnSync(
    ["bun", cli, "--backend", "api", "--key-pool-dir", "   ", "voices"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(emptyPoolDirArg.exitCode).toBe(2);
  expect(emptyPoolDirArg.stderr.toString()).toContain("--key-pool-dir");
}, 60_000);

test("explicit --key-pool-dir fails closed on empty or whitespace dir instead of falling back to GEMINI_API_KEY", async () => {
  const emptyPoolDir = mkdtempSync(join(tmpdir(), "aistudio-tts-empty-pool-"));
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "AIza-env-should-not-be-used";
  let calls = 0;
  try {
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: join(outDir, "out.wav"),
        keyPoolDir: emptyPoolDir,
        fetchImpl: async () => {
          calls++;
          return makeAudioResponse(makeValidWav(240));
        },
      }),
    ).rejects.toThrow(/--key-pool-dir/i);
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: join(outDir, "out-ws.wav"),
        keyPoolDir: "   ",
        fetchImpl: async () => {
          calls++;
          return makeAudioResponse(makeValidWav(240));
        },
      }),
    ).rejects.toThrow(/--key-pool-dir/i);
    expect(calls).toBe(0);
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    rmSync(emptyPoolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("executeWithKeyPool fails fast when all keys cool down longer than roundWaitCapMs", async () => {
  const poolDir = makeTempPool([
    { label: "k1", value: "AIza-k1" },
    { label: "k2", value: "AIza-k2" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  let calls = 0;
  const started = Date.now();
  try {
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: join(outDir, "out.wav"),
        keyPoolDir: poolDir,
        rounds: 3,
        roundWaitCapMs: 2_000,
        switchDelayMs: 0,
        fetchImpl: async () => {
          calls++;
          return new Response(
            JSON.stringify({
              error: {
                message: "Rate limit exceeded. Please retry in 120s.",
                code: "too_many_requests",
              },
            }),
            { status: 429 },
          );
        },
      }),
    ).rejects.toThrow(/rate limit.*next key frees in/i);
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(1_500);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("executeWithKeyPool waits for a short cooldown within roundWaitCapMs and succeeds on round 2", async () => {
  const poolDir = makeTempPool([{ label: "k1", value: "AIza-k1" }]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  const wav = makeValidWav(480);
  let calls = 0;
  try {
    const result = await speakGeminiApi(
      validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }),
      {
        out: join(outDir, "out.wav"),
        keyPoolDir: poolDir,
        rounds: 2,
        roundWaitCapMs: 2_000,
        switchDelayMs: 0,
        fetchImpl: async () => {
          calls++;
          if (calls === 1) {
            return new Response(
              JSON.stringify({
                error: { message: "Rate limit. Please retry in 1s.", code: "too_many_requests" },
              }),
              { status: 429 },
            );
          }
          return makeAudioResponse(wav);
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.keyLabel).toBe("k1");
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("speakGeminiApi rotates past 400 API_KEY_INVALID and 503 capacity errors and redacts leaked keys", async () => {
  const poolDir = makeTempPool([
    { label: "k-bad", value: "AIza-bad" },
    { label: "k-503", value: "AIza-503" },
    { label: "k-ok", value: "AIza-ok" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-out-"));
  const wav = makeValidWav(480);
  try {
    const ok = await speakGeminiApi(
      validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }),
      {
        out: join(outDir, "ok.wav"),
        keyPoolDir: poolDir,
        switchDelayMs: 0,
        fetchImpl: async (_url, init) => {
          const key = new Headers(init?.headers).get("x-goog-api-key");
          if (key === "AIza-bad") {
            return new Response(
              JSON.stringify({
                error: {
                  message: "API key not valid: AIzaSySecretKeyLeakTest1234567890",
                  status: "INVALID_ARGUMENT",
                },
              }),
              { status: 400 },
            );
          }
          if (key === "AIza-503") {
            return new Response(JSON.stringify({ error: { message: "Overloaded" } }), {
              status: 503,
            });
          }
          return makeAudioResponse(wav);
        },
      },
    );
    expect(ok.keyLabel).toBe("k-ok");
    const state = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8"));
    expect(state.dead["k-bad"]).toBeDefined();
    expect(state.dead["k-bad"].reason).not.toContain("AIzaSySecretKeyLeakTest1234567890");
    expect(state.dead["k-bad"].reason).toContain("[redacted-api-key]");
    expect(state.dead["k-503"]).toBeUndefined();
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("speakGeminiApi stops after round 0 on HTTP 404 model errors without waiting", async () => {
  const poolDir = makeTempPool([
    { label: "k1", value: "AIza-1" },
    { label: "k2", value: "AIza-2" },
  ]);
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-404-"));
  let modelCalls = 0;
  const t0 = Date.now();
  try {
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: join(outDir, "404.wav"),
        keyPoolDir: poolDir,
        rounds: 3,
        switchDelayMs: 0,
        fetchImpl: async () => {
          modelCalls++;
          return new Response(
            JSON.stringify({ error: { message: "Model not found", code: "not_found" } }),
            {
              status: 404,
            },
          );
        },
      }),
    ).rejects.toThrow(/unavailable/i);
    expect(modelCalls).toBe(2);
    expect(Date.now() - t0).toBeLessThan(1_500);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("single-key fallback fails fast on long 429 cooldowns and retries promptly on transient 503", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-single-"));
  const wav = makeValidWav(480);
  let rateCalls = 0;
  let capCalls = 0;
  try {
    const tRate = Date.now();
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: join(outDir, "rate.wav"),
        apiKey: "AIza-direct",
        rounds: 3,
        roundWaitCapMs: 2_000,
        fetchImpl: async () => {
          rateCalls++;
          return new Response(
            JSON.stringify({
              error: {
                message: "Rate limit exceeded. Please retry in 120s.",
                code: "too_many_requests",
              },
            }),
            { status: 429 },
          );
        },
      }),
    ).rejects.toThrow(/Rate limit exceeded/i);
    expect(rateCalls).toBe(1);
    expect(Date.now() - tRate).toBeLessThan(1_500);

    const tCap = Date.now();
    const res = await speakGeminiApi(
      validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }),
      {
        out: join(outDir, "single.wav"),
        apiKey: "AIza-direct",
        rounds: 2,
        fetchImpl: async (_url, init) => {
          capCalls++;
          expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("AIza-direct");
          if (capCalls === 1) {
            return new Response(JSON.stringify({ error: { message: "Busy" } }), { status: 503 });
          }
          return makeAudioResponse(wav);
        },
      },
    );
    expect(capCalls).toBe(2);
    expect(Date.now() - tCap).toBeLessThan(5_000);
    expect(res.keyLabel).toBeNull();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("speakGeminiApi reports auth exhaustion when all pool keys are disabled", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "aistudio-tts-dead-"));
  const deadPoolDir = makeTempPool([{ label: "only-key", value: "AIza-only" }]);
  try {
    await expect(
      speakGeminiApi(validateScene({ voices: ["Zeno"], blocks: [{ text: "Hi." }] }), {
        out: join(outDir, "dead.wav"),
        keyPoolDir: deadPoolDir,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "Revoked" } }), { status: 401 }),
      }),
    ).rejects.toThrow(/all keys in pool are disabled/i);
  } finally {
    rmSync(deadPoolDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("listGeminiApiVoices guards NaN pageSize and malformed response payloads", async () => {
  const poolDir = makeTempPool([{ label: "k1", value: "AIza-k1" }]);
  let requestedUrl = "";
  try {
    const ok = await listGeminiApiVoices({
      keyPoolDir: poolDir,
      pageSize: Number.NaN,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ voices: [] }), { status: 200 });
      },
    });
    expect(requestedUrl).toContain("page_size=50");
    expect(ok.voices).toEqual([]);

    await expect(
      listGeminiApiVoices({
        keyPoolDir: poolDir,
        fetchImpl: async () => new Response(JSON.stringify({ voices: "invalid" }), { status: 200 }),
      }),
    ).rejects.toThrow(/invalid/i);
  } finally {
    rmSync(poolDir, { recursive: true, force: true });
  }
});
