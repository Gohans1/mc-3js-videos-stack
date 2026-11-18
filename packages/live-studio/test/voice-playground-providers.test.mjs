import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openGenvoiceClient, wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { providerLanguageOptions } from "../src/voice-playground-providers.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

const json = (value) => Response.json(value);
test("native language capabilities stay separate from ElevenLabs and restrict model choices", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-provider-languages-"));
  const calls = [];
  const pg = openVoicePlayground({
    project: join(root, "film"),
    globalDir: join(root, "global"),
    env: { GENVOICE_API_KEY: "isolated-languages" },
    secretsFile: join(root, "absent.env"),
    configFile: join(root, "absent.json"),
    fetchImpl: async (raw) => {
      const url = new URL(raw);
      calls.push(url.pathname + url.search);
      if (url.pathname.endsWith("/models")) return json([]);
      if (url.pathname.endsWith("/languages"))
        return json(
          url.searchParams.get("provider") === "capcut"
            ? [{ code: "en", name: "English" }]
            : url.searchParams.get("provider") === "minimax"
              ? [
                  { code: "English", name: "English" },
                  { code: "Vietnamese", name: "Vietnamese" },
                ]
              : [
                  { code: "en", name: "English" },
                  { code: "ko", name: "Korean" },
                ],
        );
      if (url.pathname.endsWith("/default-voices")) return json({ voices: [] });
      throw new Error("No paid request expected");
    },
  });
  try {
    const catalog = await pg.getCatalog({ refresh: true });
    expect(calls).toContain("/v1/languages?provider=minimax");
    expect(calls).toContain("/v1/languages?provider=capcut");
    expect(
      providerLanguageOptions(
        "capcut",
        catalog,
        catalog.models.find((model) => model.model_id === "capcut"),
      ),
    ).toEqual([{ code: "en", name: "English" }]);
    expect(providerLanguageOptions("minimax", catalog).map((language) => language.code)).toEqual([
      "English",
      "Vietnamese",
    ]);
    await expect(
      pg.startTts({ provider: "capcut", voiceId: "67890", languageCode: "ko", text: "Hello" }),
    ).rejects.toThrow("does not support");
    await expect(
      pg.startDialogue({
        text: "A: Hello\nB: Hi",
        speakers: {
          A: { provider: "capcut", voice_id: "67890", language_code: "ko" },
          B: { provider: "minimax", voice_id: "12345", language_code: "English" },
        },
      }),
    ).rejects.toThrow("does not support");
  } finally {
    pg.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("provider mismatches and unverified provider options are rejected before any network request", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-provider-validation-"));
  const calls = [];
  const pg = openVoicePlayground({
    project: join(root, "film"),
    globalDir: join(root, "global"),
    env: { GENVOICE_API_KEY: "isolated-provider-validation" },
    secretsFile: join(root, "absent.env"),
    configFile: join(root, "absent.json"),
    fetchImpl: async (url) => {
      calls.push(url);
      throw new Error("Network must not run");
    },
  });
  try {
    await expect(
      pg.startTts({ provider: "capcut", modelId: "eleven_v4", voiceId: "12345", text: "Hello" }),
    ).rejects.toThrow("model does not belong");
    for (const option of [
      { seed: 7 },
      { previousText: "Previous" },
      { nextText: "Next" },
      { outputFormat: "pcm_44100" },
      { applyTextNormalization: "on" },
    ])
      await expect(
        pg.startTts({ provider: "minimax", voiceId: "12345", text: "Hello", ...option }),
      ).rejects.toThrow("not verified");
    expect(calls).toEqual([]);
  } finally {
    pg.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("live provider catalogs preserve zero and fractional model rates instead of inventing a rate of one", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-model-rates-"));
  const client = openGenvoiceClient({
    env: { GENVOICE_API_KEY: "isolated-model-fixture" },
    secretsFile: join(root, "absent.env"),
    configFile: join(root, "absent.json"),
    fetchImpl: async (raw) => {
      const url = new URL(raw),
        provider = url.searchParams.get("provider");
      if (url.pathname.endsWith("/models"))
        return json(
          provider === "capcut"
            ? [{ model_id: "capcut", name: "CapCut", credit_ratio: 0 }]
            : provider === "minimax"
              ? [{ model_id: "speech-2.8-turbo", name: "MiniMax Turbo", credit_ratio: 0.6 }]
              : [
                  {
                    model_id: "eleven_v4",
                    name: "Eleven v4",
                    can_do_text_to_speech: true,
                    model_rates: { character_cost_multiplier: 1 },
                  },
                ],
        );
      if (url.pathname.endsWith("/languages")) return json([]);
      if (url.pathname.endsWith("/default-voices")) return json({ voices: [] });
      throw new Error("Unexpected isolated catalog request");
    },
  });
  try {
    const catalog = await client.getCatalog({ refresh: true });
    expect(catalog.models.find((model) => model.model_id === "capcut")).toMatchObject({
      provider: "capcut",
      can_do_text_to_speech: true,
      model_rates: { character_cost_multiplier: 0 },
    });
    expect(catalog.models.find((model) => model.model_id === "speech-2.8-turbo")).toMatchObject({
      provider: "minimax",
      can_do_text_to_speech: true,
      model_rates: { character_cost_multiplier: 0.6 },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test.each(["minimax", "capcut"])(
  "%s generation keeps its provider, language and acting settings through durable archive/retry",
  async (provider) => {
    const root = mkdtempSync(join(tmpdir(), "pg-provider-")),
      sent = [];
    const model = provider === "minimax" ? "speech-2.8-hd" : "capcut";
    const settings = { speed: 1.6, pitch: -4, ...(provider === "minimax" ? { vol: 0.8 } : {}) };
    const pg = openVoicePlayground({
      project: join(root, "film"),
      globalDir: join(root, "global"),
      env: { GENVOICE_API_KEY: "isolated-provider-fixture" },
      secretsFile: join(root, "absent.env"),
      configFile: join(root, "absent.json"),
      pollIntervalMs: 1,
      maxPollMs: 2000,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async (raw, init = {}) => {
        const url = new URL(raw);
        if (url.pathname.endsWith("/models"))
          return json([
            {
              model_id: model,
              name: provider,
              provider,
              credit_ratio: provider === "capcut" ? 0 : 1,
              can_do_text_to_speech: true,
            },
          ]);
        if (url.pathname.endsWith("/languages")) return json([{ code: "en", name: "English" }]);
        if (url.pathname.endsWith("/default-voices")) return json({ voices: [] });
        if (url.pathname.includes("/text-to-speech/")) {
          sent.push(JSON.parse(init.body));
          return json({ id: `task_${sent.length}` });
        }
        if (url.pathname.endsWith("/voice-changer/history")) return json({ tasks: [] });
        if (url.pathname.endsWith("/history"))
          return json({
            tasks: [
              {
                id: "remote_native",
                provider,
                model_id: model,
                status: "completed",
                text: "Archived",
                result: { audio_url: "https://fixture.example/voice.wav" },
              },
            ],
          });
        if (url.pathname.includes("/history/"))
          return json({
            provider,
            model_id: model,
            metadata: {
              provider,
              voice_id: "12345",
              voice_settings: settings,
              language_code: provider === "minimax" ? "English" : "en",
            },
            status: "completed",
            credits_deducted: provider === "capcut" ? 0 : 5,
            result: { audio_url: "https://fixture.example/voice.wav" },
          });
        if (url.pathname === "/voice.wav")
          return new Response(wrapPcm16ToWav(Buffer.alloc(8820), 44100), {
            headers: { "content-type": "audio/wav" },
          });
        throw new Error(`Unexpected isolated request ${url.pathname}`);
      },
    });
    try {
      const queued = await pg.startTts({
        provider,
        modelId: model,
        voiceId: "12345",
        text: "Hello",
        languageCode: provider === "minimax" ? "English" : "en",
        voiceSettings: settings,
      });
      const item = await pg.waitForJob(queued.jobs[0].id);
      expect(sent[0]).toMatchObject({
        provider,
        model_id: model,
        language_code: provider === "minimax" ? "English" : "en",
        voice_settings: settings,
      });
      expect(item).toMatchObject({
        provider,
        voiceSettings: settings,
        creditsDeducted: provider === "capcut" ? 0 : 5,
      });
      await pg.retryItem(item.id);
      await pg.waitForAllJobs();
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject(sent[0]);
      const history = await pg.fetchRemoteHistory();
      expect(history.items.find((item) => item.id === "remote_native")).toMatchObject({
        provider,
        modelId: model,
      });
      const imported = await pg.importRemoteTask("remote_native");
      expect(imported.item).toMatchObject({ provider, modelId: model, voiceSettings: settings });
      const swappedProvider = provider === "minimax" ? "capcut" : "minimax";
      const swapped = await pg.retryItem(item.id, {
        provider: swappedProvider,
        voiceId: "other_voice",
      });
      await pg.waitForJob(swapped.jobs[0].id);
      expect(sent[2]).toMatchObject({
        provider: swappedProvider,
        model_id: swappedProvider === "capcut" ? "capcut" : "speech-2.8-hd",
        language_code: swappedProvider === "capcut" ? "en" : "English",
      });
    } finally {
      pg.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
