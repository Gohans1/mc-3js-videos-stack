import { afterEach, describe, expect, test } from "bun:test";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApi } from "../src/api.mjs";
import { openFavorites } from "../src/favorites.mjs";
import { openVoiceLibrary } from "../src/voice-library.mjs";
import { runVoicePlaygroundCli } from "../src/voice-playground-cli.mjs";
import { cloneVoiceOption } from "../src/voice-playground-clone-view.mjs";
import {
  assertSafeMediaUrl,
  isNonGlobalIp,
  isRawHeaderlessPcm,
  wrapPcm16ToWav,
} from "../src/voice-playground-genvoice.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";
import { openVoice } from "../src/voice.mjs";

test("clone favorites accept their actual archived preview through the same HTTP entrypoint used by the picker and Dock", async () => {
  const audio = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 12), 16000);
  const { api, voicePlayground } = makeHarness({
    fetchImpl: async (raw) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/minimax/voices/clone"))
        return jsonRes({ id: "own_preview", status: "processing" });
      if (path.endsWith("/minimax/voices"))
        return jsonRes({
          voices: [
            {
              id: "own_preview",
              status: "done",
              sample_audio_url: "https://cdn.example.com/clone.wav",
            },
          ],
        });
      if (path.endsWith("/clone.wav"))
        return new Response(audio, { headers: { "content-type": "audio/wav" } });
      if (path.endsWith("/models") || path.endsWith("/languages")) return jsonRes([]);
      return jsonRes({ voices: [] });
    },
  });
  const created = await voicePlayground.createClone(new File([audio], "me.wav"), {
    name: "My narrator",
    language: "English",
    permissionConfirmed: true,
  });
  const voice = cloneVoiceOption(await voicePlayground.refreshClone(created.id));
  expect(voice.previewUrl).toStartWith("/api/voice/playground/audio/");
  for (const favorite of [true, false]) {
    const response = await api.request("/api/voice/playground/voice-favorites", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice, favorite }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(voicePlayground.getClone(created.id).favorite).toBe(favorite);
    const saved = voicePlayground.listVoiceFavorites().find((row) => row.id === voice.id);
    expect(Boolean(saved)).toBe(favorite);
    if (saved) expect(saved.previewUrl).toBe(voice.previewUrl);
  }
  for (const previewUrl of [
    "/api/voice/playground/config",
    "//external.invalid/audio.wav",
    "/api/voice/playground/audio/../private.wav?scope=project",
  ]) {
    const response = await api.request("/api/voice/playground/voice-favorites", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: { ...voice, previewUrl }, favorite: true }),
    });
    expect(response.status).toBe(400);
  }
});

test("a deleted cloned voice cannot spend generation credits through TTS or a Dialogue role", async () => {
  let paidPosts = 0;
  const { api } = makeHarness({
    fetchImpl: async (url, init = {}) => {
      if (init.method === "POST") paidPosts++;
      return jsonRes(
        init.method === "DELETE"
          ? { success: true }
          : {
              voices: [
                {
                  id: "own_clone",
                  voice_name: "My voice",
                  language_tag: "Vietnamese",
                  status: "done",
                },
              ],
            },
      );
    },
  });
  const adopted = await (
    await api.request("/api/voice/playground/clones/adopt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remoteId: "own_clone", permissionConfirmed: true }),
    })
  ).json();
  expect(adopted.clone.id).toBeDefined();
  expect(
    (
      await api.request(`/api/voice/playground/clones/${adopted.clone.id}/cloud`, {
        method: "DELETE",
      })
    ).status,
  ).toBe(200);
  for (const { route, input } of [
    {
      route: "tts",
      input: {
        provider: "minimax",
        voiceId: "own_clone",
        modelId: "speech-2.8-hd",
        text: "Xin chào",
      },
    },
    {
      route: "dialogue",
      input: {
        text: "Alex: Xin chào\nBob: Chào bạn",
        speakers: {
          Alex: { provider: "minimax", voice_id: "own_clone", model_id: "speech-2.8-hd" },
          Bob: { voice_id: "other", model_id: "eleven_v4" },
        },
      },
    },
  ]) {
    const response = await api.request(`/api/voice/playground/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("deleted");
  }
  expect(paidPosts).toBe(0);
});

test.each(["minimax", "capcut"])(
  "%s casting forwards native filters and returns reusable voice metadata",
  async (provider) => {
    const queries = [];
    const { api } = makeHarness({
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        queries.push(url);
        return jsonRes({
          has_more: true,
          total: 2,
          voice_list:
            provider === "minimax"
              ? [
                  {
                    voice_id: "12345",
                    uniq_id: "English_Actor",
                    voice_name: "British actor",
                    tag_list: ["English", "EN-British", "Male", "Young", "Audiobook"],
                    sample_audio: "https://cdn.example/actor.mp3",
                  },
                ]
              : [
                  {
                    voice_id: "777",
                    name: "Cartoon",
                    language: "en",
                    gender: "Female",
                    tags: ["Young", "Excited", "English", "steady"],
                    preview_url: "https://api.genvoice.pro/v1/capcut/voices/777/preview",
                  },
                ],
        });
      },
    });
    const response = await api.request(
      `/api/voice/playground/shared-voices?provider=${provider}&page=0&pageSize=30&language=en&gender=Male&age=Young&accent=EN-British&useCase=Audiobook&emotion=Angery`,
    );
    expect(response.status).toBe(200);
    expect(queries[0].pathname).toBe(`/v1/${provider}/system-voices`);
    expect(queries[0].searchParams.get("page")).toBe("1");
    expect(queries[0].searchParams.get("language")).toBe(provider === "minimax" ? "English" : "en");
    expect(queries[0].searchParams.get(provider === "minimax" ? "use_cases" : "emotion")).toBe(
      provider === "minimax" ? "Audiobook" : "Angery",
    );
    const result = await response.json();
    expect(result.hasMore).toBe(true);
    expect(result.voices[0]).toMatchObject(
      provider === "minimax"
        ? {
            id: "12345",
            provider,
            name: "British actor",
            language: "English",
            gender: "Male",
            age: "Young",
            accent: "EN-British",
            useCase: "Audiobook",
            dubbingVoiceId: "English_Actor",
          }
        : {
            id: "777",
            provider,
            name: "Cartoon",
            language: "en",
            gender: "Female",
            age: "Young",
            accent: "Steady",
          },
    );
    if (provider === "capcut") expect(result.voices[0].useCase).toBe("");
  },
);

test("mixed-provider Dialogue keeps each role's acting recipe and swaps just the selected role", async () => {
  const sent = [];
  const { api, voicePlayground } = makeHarness({
    fetchImpl: async (raw, init = {}) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/models")) return jsonRes([]);
      if (path.endsWith("/languages")) return jsonRes([{ code: "en", name: "English" }]);
      if (path.endsWith("/default-voices")) return jsonRes({ voices: [] });
      if (path.endsWith("/dialogue")) {
        sent.push(JSON.parse(init.body));
        return jsonRes({ id: `mixed_${sent.length}` });
      }
      if (path.includes("/history/"))
        return jsonRes({
          status: "completed",
          credits_deducted: 21,
          result: { audio_url: "https://cdn.example/mixed.mp3" },
        });
      if (path.endsWith("/mixed.mp3"))
        return new Response(makeMinimalMp3(), { headers: { "content-type": "audio/mpeg" } });
      if (path.endsWith("/auth/me")) return jsonRes({ credit_balance: 99 });
      throw new Error(`Unexpected isolated request ${path}`);
    },
  });
  const speakers = {
    Alice: {
      provider: "elevenlabs",
      voice_id: "alice",
      model_id: "eleven_v4",
      voice_settings: { stability: 0.5 },
    },
    Bob: {
      provider: "minimax",
      voice_id: "12345",
      model_id: "speech-2.8-hd",
      language_code: "en",
      voice_settings: { speed: 1.6, pitch: -4, vol: 0.8 },
    },
    Cara: {
      provider: "capcut",
      voice_id: "777",
      model_id: "capcut",
      voice_settings: { speed: 1.4, pitch: 3 },
    },
  };
  const response = await api.request("/api/voice/playground/dialogue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Alice: Hello.\nBob: Stay here.\nCara: Bye.", speakers }),
  });
  expect(response.status, await response.clone().text()).toBe(202);
  await voicePlayground.waitForAllJobs();
  expect(sent[0].speakers.Bob).toMatchObject({
    provider: "minimax",
    language_code: "English",
    voice_settings: speakers.Bob.voice_settings,
  });
  expect(sent[0].speakers.Cara).toMatchObject({
    provider: "capcut",
    voice_settings: speakers.Cara.voice_settings,
  });
  const item = voicePlayground.listItems()[0];
  expect(item.dialogue.speakers.Bob.provider).toBe("minimax");
  await voicePlayground.retryItem(item.id, {
    speakerKey: "Bob",
    provider: "capcut",
    voiceId: "999",
    modelId: "capcut",
    languageCode: "en",
    voiceSettings: { speed: 1.5, pitch: -2 },
  });
  await voicePlayground.waitForAllJobs();
  expect(sent[1].speakers.Bob).toMatchObject({
    provider: "capcut",
    voice_id: "999",
    model_id: "capcut",
    voice_settings: { speed: 1.5, pitch: -2 },
  });
  expect(sent[1].speakers.Alice).toEqual(sent[0].speakers.Alice);
});

test.each(["minimax", "capcut"])(
  "%s TTS accepts its provider-specific settings through the HTTP contract",
  async (provider) => {
    const sent = [],
      modelId = provider === "minimax" ? "speech-2.8-hd" : "capcut";
    const settings = { speed: 1.6, pitch: -4, ...(provider === "minimax" ? { vol: 0.8 } : {}) };
    const { api, voicePlayground } = makeHarness({
      fetchImpl: async (raw, init = {}) => {
        const path = new URL(raw).pathname;
        if (path.endsWith("/models"))
          return jsonRes([
            {
              model_id: modelId,
              provider,
              name: provider,
              credit_ratio: provider === "capcut" ? 0 : 1,
            },
          ]);
        if (path.endsWith("/languages")) return jsonRes([{ code: "en", name: "English" }]);
        if (path.endsWith("/default-voices")) return jsonRes({ voices: [] });
        if (path.includes("/text-to-speech/")) {
          sent.push(JSON.parse(init.body));
          return jsonRes({ id: `provider_task_${sent.length}` });
        }
        if (path.includes("/history/"))
          return jsonRes({
            status: "completed",
            credits_deducted: 0,
            result: { audio_url: "https://cdn.example/provider.mp3" },
          });
        if (path.endsWith("/provider.mp3"))
          return new Response(makeMinimalMp3(), { headers: { "content-type": "audio/mpeg" } });
        if (path.endsWith("/auth/me")) return jsonRes({ credit_balance: 99 });
        throw new Error(`Unexpected isolated request ${path}`);
      },
    });
    const response = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        modelId,
        voiceId: "12345",
        text: "Hello",
        languageCode: "en",
        voiceSettings: settings,
        applyTextNormalization: "auto",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(sent[0]).toMatchObject({
      provider,
      voice_settings: settings,
      language_code: provider === "minimax" ? "English" : "en",
    });
    const original = voicePlayground.listItems()[0];
    expect(original).toMatchObject({
      provider,
      voiceSettings: settings,
      creditsDeducted: 0,
    });
    await voicePlayground.retryItem(original.id);
    await voicePlayground.waitForAllJobs();
    expect(sent[0].apply_text_normalization).toBe("auto");
    expect(sent[1]).toEqual(sent[0]);
  },
);

test("Cloud history applies its advertised kind filter through the HTTP API and shared engine", async () => {
  const { api, voicePlayground } = makeHarness({
    fetchImpl: async (raw) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/voice-changer/history"))
        return jsonRes({
          tasks: [{ id: "vc_task", status: "completed", text: "Converted" }],
          has_more: false,
        });
      if (path.endsWith("/history"))
        return jsonRes({
          tasks: [{ id: "tts_task", status: "completed", text: "Speech" }],
          has_more: false,
        });
      throw new Error(`Unexpected fixture request ${path}`);
    },
  });
  const vc = await api.request("/api/voice/playground/remote-history?kind=voice_changer");
  expect(vc.status).toBe(200);
  expect((await vc.json()).items.map((item) => item.kind)).toEqual(["voice_changer"]);
  expect(
    (await voicePlayground.fetchRemoteHistory({ kind: "tts" })).items.map((item) => item.kind),
  ).toEqual(["tts"]);
  expect((await api.request("/api/voice/playground/remote-history?kind=unknown")).status).toBe(400);
});

const tempDirs = [];
const playgroundControllers = [];
const makeDir = (prefix = "vp-api-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const controller of playgroundControllers.splice(0)) controller.close();
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

test("Speech keeps the selected connection through generation, archive and retry", async () => {
  const wav = wrapPcm16ToWav(Buffer.alloc(24000 * 2), 24000);
  const calls = [];
  const { api, voicePlayground } = makeHarness({
    env: { ELEVENLABS_API_KEY: "direct-test-key", GEMINI_API_KEY: "google-test-key" },
    fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) });
      if (url.hostname === "api.elevenlabs.io") {
        return new Response(wav, {
          headers: {
            "content-type": "audio/wav",
            "character-cost": "16",
            "request-id": "eleven-run-123",
          },
        });
      }
      return jsonRes({
        steps: [
          { type: "model_output", content: [{ type: "audio", data: wav.toString("base64") }] },
        ],
      });
    },
  });
  const post = (route, body) =>
    api.request(`/api/voice/playground/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const speech of [
    {
      connection: "elevenlabs",
      modelId: "eleven_v4",
      voiceId: "narrator",
      outputFormat: "wav_24000",
      text: "A quiet evening.",
    },
    {
      connection: "google",
      modelId: "gemini-3.8-flash-tts",
      voiceId: "Kore",
      speechStyle: "Softly, with a brief pause.",
      text: "Xin chào.",
    },
  ]) {
    const response = await post("tts", speech);
    expect(response.status, await response.clone().text()).toBe(202);
    const { jobs } = await response.json();
    const item = await voicePlayground.waitForJob(jobs[0].id);
    expect(item).toMatchObject({ connection: speech.connection, modelId: speech.modelId });
    expect(item.creditsDeducted).toBeUndefined();
    if (speech.connection === "elevenlabs") {
      expect(item.actualCost).toEqual({ unit: "elevenlabs_credits", amount: 16 });
      expect(item.providerRequestId).toBe("eleven-run-123");
      const originalCalls = calls.length;
      const edit = await post(`items/${item.id}/versions`, {
        mode: "local",
        from: 0,
        to: 0.5,
        gainDb: -3,
      });
      expect(edit.status, await edit.clone().text()).toBe(202);
      const edited = await voicePlayground.waitForJob((await edit.json()).job.id);
      expect(edited.version.parentId).toBe(item.id);
      expect(edited.actualCost).toBeUndefined();
      expect(edited.providerRequestId).toBeUndefined();
      expect(calls).toHaveLength(originalCalls);
    }
    const audio = await api.request(`/api/voice/playground/audio/${item.audioFile}`);
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(wav);
    expect((await post(`items/${item.id}/retry`, { speakerKey: "Alex" })).status).toBe(400);
    const retry = await post(`items/${item.id}/retry`, {});
    expect(retry.status, await retry.clone().text()).toBe(202);
    const retryResult = await voicePlayground.waitForJob((await retry.json()).jobs[0].id);
    expect(retryResult.connection).toBe(speech.connection);
  }
  expect(calls.map(({ url }) => url.hostname)).toEqual([
    "api.elevenlabs.io",
    "api.elevenlabs.io",
    "generativelanguage.googleapis.com",
    "generativelanguage.googleapis.com",
  ]);
  expect(calls[0].url.pathname).toBe("/v1/text-to-dialogue");
  expect(calls[0].url.searchParams.get("output_format")).toBe("wav_24000");
  expect(calls[0].headers.get("xi-api-key")).toBe("direct-test-key");
  expect(calls[0].body.inputs).toEqual([{ text: "A quiet evening.", voice_id: "narrator" }]);
  expect(calls[2].url.pathname).toBe("/v1beta/interactions");
  expect(calls[2].headers.get("x-goog-api-key")).toBe("google-test-key");
  expect(calls[2].headers.has("xi-api-key")).toBe(false);
  expect(calls[3].body.input[0].content[0]).toEqual({
    type: "text",
    text: "Xin chào.",
    annotations: [{ type: "speech_metadata", style: "Softly, with a brief pause." }],
  });
});

test("manual credentials and voice stars are isolated by service", async () => {
  const requests = [];
  const { api, voicePlayground } = makeHarness({
    env: { ELEVENLABS_API_KEY: "initial-eleven-key" },
    fetchImpl: async (url, options) => {
      requests.push({ host: new URL(url).host, headers: new Headers(options.headers) });
      return jsonRes({ models: [] });
    },
  });
  const configure = (connection, fields) =>
    api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connection, ...fields }),
    });
  const saved = await configure("google", { apiKey: "google-manual-test-key" });
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect(await saved.clone().text()).not.toContain("google-manual-test-key");
  expect((await saved.json()).connections).toMatchObject({
    elevenlabs: { configured: true, source: "env" },
    google: { configured: true, source: "override" },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].host).toBe("generativelanguage.googleapis.com");
  expect(requests[0].headers.get("x-goog-api-key")).toBe("google-manual-test-key");
  expect(requests[0].headers.get("xi-api-key")).toBeNull();
  expect(
    (await configure("google", { apiKey: "third-key", apiBase: "https://example.com" })).status,
  ).toBe(400);
  expect(requests).toHaveLength(1);

  const voice = { id: "shared_id", name: "Same provider voice ID", provider: "elevenlabs" };
  for (const connection of ["genvoice", "elevenlabs"]) {
    const res = await api.request("/api/voice/playground/voice-favorites", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: { ...voice, connection }, favorite: true }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
  }
  expect(voicePlayground.listVoiceFavorites().map((row) => row.connection)).toEqual([
    "elevenlabs",
    "genvoice",
  ]);
  const cleared = await configure("google", { clearOverride: true });
  expect((await cleared.json()).connections).toMatchObject({
    elevenlabs: { configured: true, source: "env" },
    google: { configured: false, source: "none" },
  });
});

test("Dialogue uses provider-specific speaker contracts and archives a repeatable scene", async () => {
  const wav = wrapPcm16ToWav(Buffer.alloc(24000 * 2), 24000);
  const characters = "Xin chào.Chào Mai.Bắt đầu nhé.".split("");
  const lengths = [9, 9, 12];
  let low = 0;
  const voiceSegments = lengths.map((length, dialogue_input_index) => {
    const character_start_index = low;
    low += length;
    return { character_start_index, character_end_index: low, dialogue_input_index };
  });
  const requests = [];
  const { api, voicePlayground } = makeHarness({
    env: { ELEVENLABS_API_KEY: "test-eleven", GEMINI_API_KEY: "test-google" },
    fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      requests.push({ url, input: JSON.parse(init.body) });
      if (url.pathname.endsWith("/with-timestamps")) {
        const times = characters.map((_, index) => index * 0.025);
        return jsonRes({
          audio_base64: wav.toString("base64"),
          voice_segments: voiceSegments,
          [requests.length === 1 ? "alignment" : "normalized_alignment"]: {
            characters,
            character_start_times_seconds: times,
            character_end_times_seconds: times.map((time) => time + 0.025),
          },
        });
      }
      return url.host === "api.elevenlabs.io"
        ? new Response(wav, { headers: { "content-type": "audio/wav" } })
        : jsonRes({
            steps: [
              { type: "model_output", content: [{ type: "audio", data: wav.toString("base64") }] },
            ],
          });
    },
  });
  for (const connection of ["elevenlabs", "google"]) {
    const response = await api.request("/api/voice/playground/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connection,
        fromTemplateId: "pt_dialogue_fixture",
        text: "[Mai]: Xin chào.\nNam: Chào Mai.\nMai: Bắt đầu nhé.",
        speakers: {
          Mai: {
            voice_id: "Kore",
            ...(connection === "google" ? { speech_style: "Quiet and deliberate." } : {}),
          },
          Nam: { voice_id: "Puck" },
          ...(connection === "elevenlabs" ? { Guest: { voice_id: "guest_voice" } } : {}),
        },
        ...(connection === "elevenlabs"
          ? { outputFormat: "wav_24000", exportTranscript: true }
          : {}),
      }),
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const item = await voicePlayground.waitForJob((await response.json()).job.id);
    expect(item).toMatchObject({
      kind: "dialogue",
      connection,
      durationSeconds: 1,
      fromTemplateId: "pt_dialogue_fixture",
    });
    expect(item.dialogue.speakers.Mai.voice_id).toBe("Kore");
    if (connection === "elevenlabs") {
      expect(item.dialogue.speakers.Guest.voice_id).toBe("guest_voice");
      expect(item.wordTimings.map(({ w, speakerId }) => [w, speakerId])).toEqual([
        ["Xin", "Mai"],
        ["chào.", "Mai"],
        ["Chào", "Nam"],
        ["Mai.", "Nam"],
        ["Bắt", "Mai"],
        ["đầu", "Mai"],
        ["nhé.", "Mai"],
      ]);
    }
    const beforeRejectedRetry = requests.length;
    const rejectedRetry = await api.request(`/api/voice/playground/items/${item.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speakerKey: "Mia", voiceId: "Puck" }),
    });
    expect(rejectedRetry.status).toBe(400);
    expect(requests).toHaveLength(beforeRejectedRetry);
    const retry = await voicePlayground.retryItem(item.id);
    const repeated = await voicePlayground.waitForJob(retry.job.id);
    expect(repeated.connection).toBe(connection);
    expect(repeated.fromTemplateId).toBe("pt_dialogue_fixture");
    expect(repeated.retry).toEqual({ parentId: item.id, rootId: item.id });
    expect(voicePlayground.listVersions(repeated.id).map(({ id }) => id)).toEqual([
      item.id,
      repeated.id,
    ]);
    expect(repeated.wordTimings).toEqual(item.wordTimings);
  }
  expect(requests[0].url.pathname).toBe("/v1/text-to-dialogue/with-timestamps");
  expect(requests[0].input.inputs).toEqual([
    { voice_id: "Kore", text: "Xin chào." },
    { voice_id: "Puck", text: "Chào Mai." },
    { voice_id: "Kore", text: "Bắt đầu nhé." },
  ]);
  expect(requests[1].input).toEqual(requests[0].input);
  expect(requests[2].url.pathname).toBe("/v1beta/interactions");
  expect(requests[2].input.generation_config.speech_config.speakers).toEqual([
    { speaker: "Mai", voice: "Kore" },
    { speaker: "Nam", voice: "Puck" },
  ]);
  expect(requests[2].input.input[0].content[0]).toEqual({
    type: "text",
    text: "Xin chào.",
    annotations: [{ type: "speech_metadata", speaker: "Mai", style: "Quiet and deliberate." }],
  });
  expect(requests[3].input).toEqual(requests[2].input);

  for (const input of [
    {
      modelId: "eleven_v4",
      speakers: { Mai: { voice_id: "Kore", provider: "minimax" }, Nam: { voice_id: "Puck" } },
    },
    {
      modelId: "eleven_v4",
      speakers: { Mai: { voice_id: "Kore", model_id: "eleven_v3" }, Nam: { voice_id: "Puck" } },
    },
    {
      modelId: "eleven_v3",
      voiceSettings: { similarity_boost: 0.5 },
      speakers: { Mai: { voice_id: "Kore" }, Nam: { voice_id: "Puck" } },
    },
    {
      connection: "google",
      pauseBetweenTurns: 0.5,
      speakers: { Mai: { voice_id: "Kore" }, Nam: { voice_id: "Puck" } },
    },
  ]) {
    const res = await api.request("/api/voice/playground/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connection: "elevenlabs",
        text: "Mai: Xin chào.\nNam: Chào.",
        ...input,
      }),
    });
    expect(res.status, await res.clone().text()).toBe(400);
  }
  expect(requests).toHaveLength(4);
  const english = await voicePlayground.startDialogue({
    connection: "elevenlabs",
    text: "Châu: Let's start.\nNam: Ready when you are.",
    speakers: { Châu: { voice_id: "Kore" }, Nam: { voice_id: "Puck" } },
  });
  await voicePlayground.waitForJob(english.job.id);
  expect(requests[4].input.language_code).toBeUndefined();
  expect(english.job.dialogueRecipe).toMatchObject({
    connection: "elevenlabs",
    languageCode: "auto",
    text: "Châu: Let's start.\nNam: Ready when you are.",
    speakers: { Châu: { voice_id: "Kore" }, Nam: { voice_id: "Puck" } },
  });
});

test("an imported Dialogue recording without its cast stays playable and cannot retry as Speech", async () => {
  const wav = wrapPcm16ToWav(Buffer.alloc(16000 * 2), 16000);
  let paidPosts = 0;
  const { api } = makeHarness({
    fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      if (init?.method === "POST") paidPosts++;
      if (
        url.pathname.endsWith("/history/scene-only") ||
        url.pathname.endsWith("/history/scene-recovered")
      )
        return jsonRes({
          status: "completed",
          text: "Alex: Hello.\nRiley: Hi.",
          voice_id: "actor",
          result: { audio_url: "https://cdn.example/scene.wav" },
        });
      if (url.pathname === "/scene.wav") return new Response(wav);
      return jsonRes({ id: "unexpected-charge" }, 202);
    },
  });
  const post = (suffix, input) =>
    api.request(`/api/voice/playground/${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const imported = await post("remote-history/import", { taskId: "scene-only", kind: "dialogue" });
  expect(imported.status).toBe(200);
  const { item } = await imported.json();
  expect(item).toMatchObject({ kind: "dialogue", durationSeconds: 1 });
  const retry = await post(`items/${item.id}/retry`, {});
  expect(retry.status).toBe(400);
  expect((await retry.json()).error).toContain("saved Dialogue cast");
  const recovery = await post("remote-history/import", {
    taskId: "scene-recovered",
    kind: "dialogue",
    dialogueRecipe: {
      connection: "genvoice",
      text: "Alex: Xin chào.\nRiley: Bắt đầu.",
      fromTemplateId: "pt_saved_scene",
      speakers: {
        Alex: { voice_id: "actor_a", language_code: "vi", voice_settings: { stability: 0.6 } },
        Riley: { voice_id: "actor_b", language_code: "vi" },
      },
      pause_between_turns: 0.35,
    },
  });
  expect(recovery.status).toBe(200);
  expect((await recovery.json()).item).toMatchObject({
    languageCode: "vi",
    fromTemplateId: "pt_saved_scene",
    dialogue: {
      pause_between_turns: 0.35,
      speakers: { Alex: { voice_settings: { stability: 0.6 } } },
    },
  });
  expect(paidPosts).toBe(0);
});

test("GenVoice batch quotes without spending, preflights every entry and saves the effective recipe", async () => {
  const audio = Object.fromEntries(
    [1, 2, 3].map((id) => [`/paid_${id}.wav`, wrapPcm16ToWav(Buffer.alloc(32000, id), 16000)]),
  );
  const accepted = [];
  let attempts = 0;
  const pendingDownload = Promise.withResolvers();
  const downloadStarted = Promise.withResolvers();
  const pendingFeePoll = Promise.withResolvers();
  const feeReported = Promise.withResolvers();
  let downloadsOfSecondTake = 0;
  let subtitleDownloads = 0;
  let readsOfSecondHistory = 0;
  let readsOfThirdHistory = 0;
  let readsOfFirstHistory = 0;
  const { api, voicePlayground } = makeHarness({
    fetchImpl: async (raw, init = {}) => {
      const url = new URL(raw);
      if (url.pathname.endsWith("/auth/me")) return jsonRes({ id: "account_no_balance" });
      if (url.pathname.endsWith("/models"))
        return jsonRes(
          url.searchParams.has("provider")
            ? []
            : [
                {
                  model_id: "eleven_v4",
                  can_do_text_to_speech: true,
                  maximum_text_length_per_request: 60,
                  model_rates: { character_cost_multiplier: 0.5 },
                },
              ],
        );
      if (url.pathname.includes("/text-to-speech/") && init.method === "POST") {
        const body = JSON.parse(init.body);
        attempts++;
        if ("seed" in body) return jsonRes({ message: "unsupported seed" }, 422);
        accepted.push({ voice: url.pathname.split("/").at(-1), body });
        return jsonRes({ id: `paid_${accepted.length}` }, 202);
      }
      if (url.pathname.includes("/history/paid_")) {
        if (url.pathname.endsWith("_1")) {
          if (readsOfFirstHistory++ === 0)
            return jsonRes({ id: "paid_1", status: "processing", credits_deducted: 19 });
          feeReported.resolve();
          await pendingFeePoll.promise;
        }
        const second = url.pathname.endsWith("_2");
        const original = second && readsOfSecondHistory++ === 0;
        const lateSrt = url.pathname.endsWith("_3") && readsOfThirdHistory++ > 0;
        return jsonRes({
          status: "completed",
          ...(url.pathname.endsWith("_1") || (second && !original)
            ? {}
            : { credits_deducted: url.pathname.endsWith("_3") ? 7 : 0 }),
          result: {
            audio_url: `https://cdn.example.com/${url.pathname.split("/").at(-1)}.wav`,
            ...(original || lateSrt
              ? { srt_url: `https://cdn.example.com/${url.pathname.split("/").at(-1)}.srt` }
              : {}),
          },
        });
      }
      if (url.pathname === "/paid_2.srt")
        return new Response("1\n00:00:00,000 --> 00:00:01,000\nChào.");
      if (url.pathname === "/paid_3.srt")
        return subtitleDownloads++ === 0
          ? new Response("<html>Expired URL</html>", { headers: { "content-type": "text/html" } })
          : new Response("1\n00:00:00,000 --> 00:00:01,000\nChào.");
      if (url.pathname === "/paid_2.wav" && downloadsOfSecondTake++ === 0) {
        downloadStarted.resolve();
        await pendingDownload.promise;
      }
      if (/^\/paid_\d+\.wav$/.test(url.pathname))
        return new Response(audio[url.pathname], { headers: { "content-type": "audio/wav" } });
      return url.pathname.endsWith("/languages") ? jsonRes([]) : jsonRes({ voices: [] });
    },
  });
  const send = (path, entries) =>
    api.request(`/api/voice/playground/tts/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    });
  const text = "  [hushed] Chào.\n";
  const voicePreviewUrl = "https://cdn.example.com/free-preview.mp3";
  const entries = [
    { voiceId: "actor_a", text, modelId: "eleven_v4", seed: 0, voicePreviewUrl },
    { voiceId: "actor_b", text, modelId: "eleven_v4" },
  ];
  const quote = await send("quote", entries);
  expect(quote.status).toBe(200);
  expect(await quote.json()).toMatchObject({
    balanceCredits: null,
    totalCredits: null,
    modelEstimateCredits: Math.ceil(text.trim().length * 0.5) * 2,
    rows: [{ modelRateSource: "provider" }, { modelRateSource: "provider" }],
  });
  expect(attempts).toBe(0);
  const invalid = await send("batch", [entries[0], { ...entries[1], provider: "minimax" }]);
  expect(invalid.status).toBe(400);
  const unknownModel = await send("batch", [
    entries[0],
    { ...entries[1], modelId: "eleven_v4_typo" },
  ]);
  expect(unknownModel.status).toBe(400);
  for (const wrong of [
    { modelId: "eleven_v4_typo" },
    { text: "A".repeat(61) },
    { exportTranscipt: true },
  ]) {
    const response = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entries[0], ...wrong }),
    });
    expect(response.status).toBe(400);
  }
  expect(attempts).toBe(0);
  const launched = await send("batch", entries);
  expect(launched.status).toBe(202);
  const { batchId, jobs } = await launched.json();
  expect(jobs.map(({ batch }) => batch)).toEqual([
    { id: batchId, index: 0, variationIndex: 0 },
    { id: batchId, index: 1, variationIndex: 0 },
  ]);
  const cloud = (body) =>
    api.request("/api/voice/playground/remote-history/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "paid_3", kind: "tts", ...body }),
    });
  await downloadStarted.promise;
  let recovered;
  try {
    await feeReported.promise;
    expect(voicePlayground.getSpeechReceipt(jobs[1].id)).toMatchObject({
      remoteTaskId: "paid_1",
      creditsDeducted: 19,
    });
    const pending = await api.request(`/api/voice/playground/tts/receipts/${jobs[0].id}`);
    expect(await pending.json()).toMatchObject({
      receipt: { remoteTaskId: "paid_2", creditsDeducted: 0, batch: { id: batchId, index: 0 } },
    });
    expect((await cloud({ taskId: "paid_2", kind: "dialogue" })).status).toBe(409);
    const response = await cloud({ taskId: "paid_2" });
    expect(response.status).toBe(200);
    recovered = (await response.json()).item;
    await voicePlayground.patchItem(recovered.id, { title: "Chosen variant", rating: 5 });
  } finally {
    pendingDownload.resolve();
    pendingFeePoll.resolve();
  }
  await voicePlayground.waitForAllJobs();
  expect(accepted.map(({ voice }) => voice)).toEqual(["actor_b", "actor_a"]);
  expect(accepted[1].body).not.toHaveProperty("voicePreviewUrl");
  const archived = voicePlayground.getItem(recovered.id);
  expect(
    voicePlayground.listItems().filter(({ remoteTaskId }) => remoteTaskId === "paid_2"),
  ).toHaveLength(1);
  expect(archived).toMatchObject({
    title: "Chosen variant",
    rating: 5,
    kind: "tts",
    creditsDeducted: 0,
    voicePreviewUrl,
    srtText: expect.stringContaining("Chào."),
  });
  const completed = await api.request(`/api/voice/playground/tts/receipts/${jobs[0].id}`);
  expect(await completed.json()).toMatchObject({
    receipt: { itemId: archived.id, remoteTaskId: "paid_2" },
  });
  const recipe = await api.request(`/api/voice/playground/items/${archived.id}/recipe`);
  expect(await recipe.json()).toMatchObject({
    command: "generate tts",
    input: { text: text.trim(), voiceId: "actor_a" },
    requestedInput: { text, seed: 0, voiceId: "actor_a" },
    effectiveRequest: { body: { text: text.trim(), model_id: "eleven_v4" } },
  });
  expect(archived.generationRecipe.effective.body.seed).toBeUndefined();
  expect(voicePlayground.getItem(jobs[1].id).creditsDeducted).toBe(19);
  expect(readFileSync(voicePlayground.audioFile(archived.audioFile))).toEqual(audio["/paid_2.wav"]);
  expect(
    readFileSync(voicePlayground.audioFile(voicePlayground.getItem(jobs[1].id).audioFile)),
  ).toEqual(audio["/paid_1.wav"]);
  const mismatch = await cloud({
    taskId: "paid_2",
    kind: "dialogue",
    dialogueRecipe: {
      text: "Alex: Wrong audio.\nMai: Chào.",
      speakers: { Alex: { voice_id: "wrong_voice" }, Mai: { voice_id: "actor_a" } },
    },
  });
  expect((await mismatch.json()).item).toMatchObject({ kind: "tts", text, voiceId: "actor_a" });
  const first = await cloud({});
  expect(first.status).toBe(200);
  const firstItem = (await first.json()).item;
  expect(firstItem.srtFile).toBeUndefined();
  const spoofed = await cloud({ generationRecipe: archived.generationRecipe });
  expect(spoofed.status).toBe(400);
  const firstSrtRetry = await cloud({});
  expect((await firstSrtRetry.json()).item.srtFile).toBeUndefined();
  const withSrt = await cloud({});
  expect(withSrt.status).toBe(200);
  expect(await withSrt.json()).toMatchObject({
    alreadyImported: true,
    item: {
      id: firstItem.id,
      cloudRecipeUnverified: true,
      srtText: expect.stringContaining("Chào."),
      creditsDeducted: 7,
    },
  });
  const captions = await api.request(`/api/voice/playground/items/${firstItem.id}/captions`);
  expect(await captions.json()).toMatchObject({
    source: "cues",
    parts: [{ text: "Chào.", from: 0, to: 1 }],
  });
});

test.each([
  ["", 6, "built-in"],
  ["0", 0, "provider"],
])("the Speech quote distinguishes multiplier %j from a known zero", async (rate, fee, source) => {
  const { voicePlayground } = makeHarness({
    fetchImpl: async (raw, init) => {
      expect(init.method).not.toBe("POST");
      const path = new URL(raw).pathname;
      if (path.endsWith("/models"))
        return jsonRes([
          { model_id: "eleven_v4", model_rates: { character_cost_multiplier: rate } },
        ]);
      if (path.endsWith("/auth/me")) return jsonRes({ credit_balance: 100 });
      return jsonRes([]);
    },
  });
  expect(
    await voicePlayground.quoteTtsBatch({
      entries: [{ text: "Hello.", voiceId: "narrator" }],
    }),
  ).toMatchObject({
    balanceCredits: 100,
    modelEstimateCredits: fee,
    totalCredits: null,
    rows: [{ modelRateSource: source }],
  });
});

test("the charge observed during Speech processing remains provisional until final History", async () => {
  const wav = wrapPcm16ToWav(Buffer.alloc(32000, 20), 16000);
  let polls = 0;
  const { voicePlayground } = makeHarness({
    fetchImpl: async (raw, init) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/text-to-speech/narrator") && init.method === "POST")
        return jsonRes({ id: "fee_pending" }, 202);
      if (path.endsWith("/history/fee_pending")) {
        if (++polls === 1) return jsonRes({ status: "processing", credits_deducted: 3 });
        return jsonRes({
          status: "completed",
          ...(polls >= 3 ? { credits_deducted: 7 } : {}),
          result: {
            audio_url: "https://cdn.example.com/take.wav",
            srt_url: "https://cdn.example.com/take.srt",
          },
        });
      }
      if (path === "/take.wav") return new Response(wav);
      if (path === "/take.srt") return new Response("1\n00:00:00,000 --> 00:00:01,000\nChào.");
      return jsonRes([]);
    },
  });
  await voicePlayground.startTts({ text: "Chào.", voiceId: "narrator", exportTranscript: true });
  await voicePlayground.waitForAllJobs();
  const original = voicePlayground.listItems()[0];
  expect(original).toMatchObject({
    creditsDeducted: 3,
    creditsSource: "processing",
    srtText: expect.stringContaining("Chào."),
  });
  expect(await voicePlayground.importRemoteTask("fee_pending")).toMatchObject({
    item: { id: original.id, creditsDeducted: 7, creditsSource: "history" },
  });
  expect(polls).toBe(3);
});

test("a canceled Speech task stops polling and keeps the provider's error", async () => {
  let polls = 0;
  const { voicePlayground } = makeHarness({
    fetchImpl: async (raw, init) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/text-to-speech/narrator") && init.method === "POST")
        return jsonRes({ id: "cancelled_task" }, 202);
      if (path.endsWith("/history/cancelled_task")) {
        polls++;
        return jsonRes({ status: "cancelled", detail_error: "Rendering canceled upstream" });
      }
      return jsonRes([]);
    },
  });
  await voicePlayground.startTts({ text: "Chào.", voiceId: "narrator" });
  await voicePlayground.waitForAllJobs();
  expect(voicePlayground.listJobs()).toMatchObject([
    { remoteTaskId: "cancelled_task", status: "failed", error: "Rendering canceled upstream" },
  ]);
  expect(polls).toBe(1);
});

test("a concurrent Cloud import keeps the final History charge from the original Speech job", async () => {
  const polling = Promise.withResolvers();
  const complete = Promise.withResolvers();
  const wav = wrapPcm16ToWav(Buffer.alloc(32000, 19), 16000);
  let historyReads = 0;
  let submits = 0;
  const { voicePlayground } = makeHarness({
    fetchImpl: async (raw, init) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/text-to-speech/narrator") && init.method === "POST") {
        submits++;
        return jsonRes({ id: "same_audio_task", credits_deducted: 3 }, 202);
      }
      if (path.endsWith("/history/same_audio_task")) {
        const originalPoll = ++historyReads === 1;
        if (originalPoll) {
          polling.resolve();
          await complete.promise;
        }
        return jsonRes({
          id: "same_audio_task",
          status: "completed",
          ...(originalPoll ? { credits_deducted: 7 } : {}),
          result: { audio_url: "https://cdn.example.com/same.wav" },
        });
      }
      if (path === "/same.wav") return new Response(wav);
      return jsonRes([]);
    },
  });
  const {
    jobs: [job],
  } = await voicePlayground.startTts({
    text: "Chào.",
    voiceId: "narrator",
  });
  await polling.promise;
  let id;
  try {
    const { item } = await voicePlayground.importRemoteTask("same_audio_task");
    expect(item.creditsDeducted).toBe(3);
    id = item.id;
  } finally {
    complete.resolve();
  }
  await voicePlayground.waitForAllJobs();
  expect(submits).toBe(1);
  expect(voicePlayground.listItems()).toMatchObject([
    { id, creditsDeducted: 7, creditsSource: "history" },
  ]);
  expect(voicePlayground.getSpeechReceipt(job.id)).toMatchObject({
    itemId: id,
    creditsDeducted: 7,
    creditsSource: "history",
  });
});

test("a Speech acknowledgement reconciles an earlier Cloud import and both scopes reuse the saved audio", async () => {
  const submitted = Promise.withResolvers();
  const acknowledge = Promise.withResolvers();
  let audioDownloads = 0;
  let reportFee = false;
  const pcm = Buffer.alloc(32000, 17);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(pcm);
  const { voicePlayground: project } = makeHarness({
    fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      if (url.pathname.endsWith("/text-to-speech/narrator") && init?.method === "POST") {
        submitted.resolve();
        await acknowledge.promise;
        return jsonRes({ id: "cloud_take", credits_deducted: 0 }, 202);
      }
      const task = {
        id: "cloud_take",
        status: "completed",
        ...(reportFee ? { credits_deducted: 11 } : {}),
        result: {
          audio_url: "https://cdn.example.com/take.raw",
          srt_url: "https://cdn.example.com/take.srt",
        },
      };
      if (url.pathname.endsWith("/history/cloud_take")) return jsonRes(task);
      if (url.pathname.endsWith("/history")) return jsonRes({ tasks: [task] });
      if (url.pathname === "/take.srt")
        return new Response("1\n00:00:00,000 --> 00:00:01,000\nLời thoại thật.");
      if (url.pathname === "/take.raw") {
        audioDownloads++;
        return new Response(pcm, { headers: { "content-type": "audio/pcm" } });
      }
      return jsonRes([]);
    },
  });
  const global = project.forScope("global");
  await project.startTts({
    text: "Lời thoại thật.",
    voiceId: "narrator",
    seed: 0,
    outputFormat: "pcm_16000",
  });
  await submitted.promise;
  let imported;
  let importedGlobal;
  try {
    ({ item: imported } = await project.importRemoteTask("cloud_take", "dialogue", {
      dialogueRecipe: {
        text: "Alex: Wrong audio.\nMai: Chào.",
        speakers: { Alex: { voice_id: "actor_a" }, Mai: { voice_id: "actor_b" } },
      },
    }));
    await project.patchItem(imported.id, { title: "Keep this title", rating: 5 });
    reportFee = true;
    ({ item: importedGlobal } = await global.importRemoteTask("cloud_take"));
    await global.patchItem(importedGlobal.id, { title: "Global title", rating: 4 });
    await project.readSource({ sourceItemId: importedGlobal.id, allowOtherScope: true });
  } finally {
    reportFee = false;
    acknowledge.resolve();
  }
  await project.waitForAllJobs();
  expect(project.listItems()).toMatchObject([
    {
      id: imported.id,
      title: "Keep this title",
      rating: 5,
      kind: "tts",
      text: "Lời thoại thật.",
      voiceId: "narrator",
      seed: 0,
      generationRecipe: { version: 1 },
    },
  ]);
  expect(project.getItem(imported.id).dialogue).toBeUndefined();
  const wav = wrapPcm16ToWav(pcm, 16000);
  expect(readFileSync(project.audioFile(project.getItem(imported.id).audioFile))).toEqual(wav);
  const copied = await project.copyToScope(imported.id, "global");
  expect(copied).toMatchObject({
    id: importedGlobal.id,
    title: "Global title",
    rating: 4,
    mimeType: "audio/wav",
    creditsDeducted: 11,
    retentionPinned: true,
    srtFile: importedGlobal.srtFile,
  });
  expect(readFileSync(global.audioFile(copied.audioFile))).toEqual(wav);
  expect((await project.copyToScope(imported.id, "global")).id).toBe(copied.id);
  expect(global.listItems()).toHaveLength(1);
  rmSync(global.audioFile(copied.audioFile));
  const repaired = await project.copyToScope(imported.id, "global");
  expect(repaired).toMatchObject({ id: copied.id, rating: 4, creditsDeducted: 11 });
  expect(readFileSync(global.audioFile(repaired.audioFile))).toEqual(wav);
  const recovered = await global.importRemoteTask("cloud_take");
  expect(recovered).toMatchObject({ alreadyImported: true, item: { id: copied.id, seed: 0 } });
  expect(await global.fetchRemoteHistory({ kind: "tts" })).toMatchObject({
    items: [{ id: "cloud_take", importedItemId: copied.id }],
  });
  expect(audioDownloads).toBe(3);
});

test.each([
  ["text/html", "<html>Link expired</html>"],
  ["application/octet-stream", "The signed audio link has expired."],
  ["application/octet-stream", '{"error":"ExpiredToken"}'],
])(
  "an expired audio response (%s) leaves a paid Speech job recoverable",
  async (contentType, body) => {
    const wav = wrapPcm16ToWav(Buffer.alloc(32000, 17), 16000);
    let expired = true;
    let lateSubtitles = false;
    let submissions = 0;
    const { voicePlayground } = makeHarness({
      fetchImpl: async (raw, init) => {
        const url = new URL(raw);
        if (init.method === "POST" && url.pathname.endsWith("/text-to-speech/narrator")) {
          submissions++;
          return jsonRes({ id: "expired_task", credits_deducted: 11 }, 202);
        }
        if (url.pathname.endsWith("/history/expired_task"))
          return jsonRes({
            id: "expired_task",
            status: "completed",
            ...(!expired && !lateSubtitles ? { credits_deducted: 7 } : {}),
            result: {
              audio_url: "https://cdn.example.com/expired.wav",
              ...(lateSubtitles ? { srt_url: "https://cdn.example.com/late.srt" } : {}),
            },
          });
        if (url.pathname === "/expired.wav")
          return expired
            ? new Response(body, { headers: { "content-type": contentType } })
            : new Response(wav);
        if (url.pathname === "/late.srt")
          return new Response("1\n00:00:00,000 --> 00:00:01,000\nChào buổi sáng.");
        return jsonRes([]);
      },
    });
    const { jobs } = await voicePlayground.startTts({
      text: "Chào buổi sáng.",
      voiceId: "narrator",
      name: "Opening narration",
      notes: "Approved line reading",
    });
    await voicePlayground.waitForAllJobs();
    expect(voicePlayground.listJobs()).toMatchObject([{ id: jobs[0].id, status: "failed" }]);
    expect(voicePlayground.listItems()).toEqual([]);
    expect(voicePlayground.getSpeechReceipt(jobs[0].id)).toMatchObject({
      remoteTaskId: "expired_task",
      creditsDeducted: 11,
    });
    expired = false;
    const { item } = await voicePlayground.importRemoteTask("expired_task");
    expect(item).toMatchObject({
      creditsDeducted: 7,
      mimeType: "audio/wav",
      text: "Chào buổi sáng.",
      title: "Opening narration",
      notes: "Approved line reading",
    });
    expect(readFileSync(voicePlayground.audioFile(item.audioFile))).toEqual(wav);
    expect(voicePlayground.listJobs()).toMatchObject([
      { id: jobs[0].id, status: "completed", itemId: item.id, creditsDeducted: 7 },
    ]);
    expect(voicePlayground.listJobs()[0].error).toBeUndefined();
    lateSubtitles = true;
    expect(await voicePlayground.importRemoteTask("expired_task")).toMatchObject({
      item: {
        id: item.id,
        creditsDeducted: 7,
        srtText: expect.stringContaining("Chào buổi sáng."),
      },
    });
    expect(submissions).toBe(1);
  },
);

test.each([
  ["task_a", "task_b"],
  [301, 302],
])(
  "history for a different GenVoice task (%s) never supplies audio or charges to a Speech receipt",
  async (taskId, otherId) => {
    let audioDownloads = 0;
    const { voicePlayground, api } = makeHarness({
      fetchImpl: async (raw, init) => {
        const url = new URL(raw);
        if (url.pathname.endsWith("/text-to-speech/narrator") && init?.method === "POST")
          return jsonRes({ id: taskId }, 202);
        if (url.pathname.endsWith(`/history/${taskId}`))
          return jsonRes({
            id: otherId,
            status: "completed",
            credits_deducted: 5,
            result: { audio_url: "https://cdn.example.com/task_b.wav" },
          });
        if (url.pathname === "/task_b.wav") {
          audioDownloads++;
          return new Response(wrapPcm16ToWav(Buffer.alloc(32000), 16000));
        }
        return jsonRes([]);
      },
    });
    const { jobs } = await voicePlayground.startTts({
      text: "Original script",
      voiceId: "narrator",
    });
    await voicePlayground.waitForAllJobs();
    expect(voicePlayground.listJobs()).toMatchObject([
      { id: jobs[0].id, status: "failed", error: "GenVoice returned a different task ID" },
    ]);
    expect(voicePlayground.getSpeechReceipt(jobs[0].id).creditsDeducted).toBeUndefined();
    const response = await api.request("/api/voice/playground/remote-history/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: String(taskId) }),
    });
    expect(response.status).toBe(502);
    expect(voicePlayground.listItems()).toEqual([]);
    expect(audioDownloads).toBe(0);
  },
);

test("Speech refuses an expired submission and preserves a recoverable run identity before charging", async () => {
  let posts = 0;
  const {
    api,
    voicePlayground,
    dir: project,
  } = makeHarness({
    fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      if (init.method === "POST" && url.pathname.endsWith("/text-to-speech/narrator")) {
        posts++;
        return jsonRes({ id: "paid_run" }, 202);
      }
      if (url.pathname.endsWith("/history/paid_run"))
        return jsonRes({
          id: "paid_run",
          status: "completed",
          credits_deducted: 0,
          result: { audio_url: "https://cdn.example.com/run.wav" },
        });
      if (url.pathname === "/run.wav")
        return new Response(wrapPcm16ToWav(Buffer.alloc(32000, 17), 16000));
      return jsonRes([]);
    },
  });
  const send = (deadline) =>
    api.request("/api/voice/playground/tts/batch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-voice-playground-run": "test-speech-run",
        "x-voice-playground-deadline": String(deadline),
      },
      body: JSON.stringify({ entries: [{ text: "Voice audition.", voiceId: "narrator" }] }),
    });
  expect((await send(Date.now() - 1)).status).toBe(408);
  expect(posts).toBe(0);
  const launched = await send(Date.now() + 30_000);
  expect(launched.status).toBe(202);
  const {
    jobs: [job],
  } = await launched.json();
  await voicePlayground.waitForAllJobs();
  const repeated = await send(Date.now() + 30_000);
  expect((await repeated.json()).jobs).toMatchObject([{ id: job.id, status: "completed" }]);
  const reopened = openVoicePlayground({ project });
  try {
    expect(reopened.getSpeechRun("test-speech-run")).toMatchObject({
      jobs: [
        {
          id: job.id,
          status: "completed",
          itemId: job.id,
          remoteTaskId: "paid_run",
          creditsDeducted: 0,
        },
      ],
    });
  } finally {
    reopened.close();
  }
  expect(posts).toBe(1);
});

test("Speech job history survives reopening with both the provider rejection and the archived take", async () => {
  let posts = 0;
  const { voicePlayground, playgroundDir } = makeHarness({
    fetchImpl: async (raw, init) => {
      const path = new URL(raw).pathname;
      if (init.method === "POST" && path.includes("/text-to-speech/")) {
        posts++;
        return path.endsWith("/denied")
          ? jsonRes({ error: "Insufficient credits" }, 402)
          : jsonRes({ id: "recorded" }, 202);
      }
      if (path.endsWith("/history/recorded"))
        return jsonRes({
          id: "recorded",
          status: "completed",
          credits_deducted: 3,
          result: { audio_url: "https://cdn.example.com/recorded.wav" },
        });
      if (path === "/recorded.wav") return new Response(wrapPcm16ToWav(Buffer.alloc(32000), 16000));
      return jsonRes([]);
    },
  });
  const {
    jobs: [recorded, denied],
  } = await voicePlayground.startTtsBatch(
    {
      entries: [
        { text: "First line", voiceId: "narrator" },
        { text: "Second line", voiceId: "denied" },
      ],
    },
    { runId: "reopened-run" },
  );
  await voicePlayground.waitForAllJobs();
  const reopened = openVoicePlayground({ dir: playgroundDir });
  try {
    const jobs = [
      { id: recorded.id, status: "completed", itemId: recorded.id, creditsDeducted: 3 },
      { id: denied.id, status: "failed", error: expect.stringContaining("Insufficient credits") },
    ];
    expect(reopened.listJobs()).toEqual(expect.arrayContaining(jobs.map(expect.objectContaining)));
    expect(reopened.getSpeechRun("reopened-run").jobs).toMatchObject(jobs);
    expect(posts).toBe(2);
  } finally {
    reopened.close();
  }
});

test("Cloud recovery repairs an empty archived WAV and keeps the existing take and its metadata", async () => {
  const audio = wrapPcm16ToWav(Buffer.alloc(32000, 6), 16000);
  const empty = wrapPcm16ToWav(Buffer.alloc(0), 16000);
  const { voicePlayground, playgroundDir } = makeHarness({
    fetchImpl: async (raw, init) => {
      expect(init.method).not.toBe("POST");
      const path = new URL(raw).pathname;
      if (path === "/repaired.wav") return new Response(audio);
      expect(path).toEndWith("/history/existing_speech");
      return jsonRes({
        id: "existing_speech",
        status: "completed",
        credits_deducted: 0,
        result: { audio_url: "https://cdn.example.com/repaired.wav" },
      });
    },
  });
  const id = "pg_existing";
  const audioFile = `${id}.wav`;
  mkdirSync(join(playgroundDir, "audio"), { recursive: true });
  writeFileSync(join(playgroundDir, "audio", audioFile), empty);
  writeFileSync(
    join(playgroundDir, "items.json"),
    JSON.stringify({
      version: 1,
      items: [
        {
          id,
          audioFile,
          kind: "tts",
          mimeType: "audio/wav",
          title: "Edited by user",
          rating: 5,
          durationSeconds: 0,
          bytes: empty.length,
          remoteTaskId: "existing_speech",
          srtText: "Existing subtitle",
          creditsDeducted: 0,
          creditsSource: "history",
        },
      ],
    }),
  );
  const { item } = await voicePlayground.importRemoteTask("existing_speech");
  expect(item).toMatchObject({
    id,
    title: "Edited by user",
    rating: 5,
    srtText: "Existing subtitle",
    durationSeconds: 1,
    creditsDeducted: 0,
    replacedAudioFiles: [audioFile],
  });
  expect(voicePlayground.listItems()).toHaveLength(1);
  expect(readFileSync(voicePlayground.audioFile(item.audioFile))).toEqual(audio);
});

test("replaying a saved Speech recipe keeps its effective contexts and tuning", async () => {
  const bodies = [];
  const audio = wrapPcm16ToWav(Buffer.alloc(32000, 9), 16000);
  const { api, voicePlayground } = makeHarness({
    fetchImpl: async (raw, init) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/text-to-speech/narrator") && init.method === "POST") {
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 3) return jsonRes({ error: "Settings no longer available" }, 422);
        return jsonRes({ id: `speech_${bodies.length}` }, 202);
      }
      if (path.includes("/history/speech_"))
        return jsonRes({
          id: path.split("/").at(-1),
          status: "completed",
          credits_deducted: 1,
          result: { audio_url: "https://cdn.example.com/replay.wav" },
        });
      if (path === "/replay.wav") return new Response(audio);
      return jsonRes([]);
    },
  });
  const {
    jobs: [first],
  } = await voicePlayground.startTts({
    voiceId: "narrator",
    text: "[hushed] Chào buổi sáng.",
    seed: 0,
    previousText: "Chào.",
  });
  await voicePlayground.waitForAllJobs();
  const recipe = await api
    .request(`/api/voice/playground/items/${first.id}/recipe`)
    .then((r) => r.json());
  const submit = () =>
    api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipe.input),
    });
  expect((await submit()).status).toBe(202);
  await voicePlayground.waitForAllJobs();
  const rejected = await submit();
  const {
    jobs: [last],
  } = await rejected.json();
  await voicePlayground.waitForAllJobs();
  expect(bodies).toHaveLength(3);
  expect(bodies.slice(1)).toEqual([bodies[0], bodies[0]]);
  expect(voicePlayground.listJobs().find((job) => job.id === last.id)).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Settings no longer available"),
  });
});

test.each(["missing audio", "truncated audio", "missing index"])(
  "Studio CLI resume repairs %s without submitting again",
  async (damage) => {
    const audio = wrapPcm16ToWav(Buffer.alloc(32000, 4), 16000);
    let submissions = 0;
    let downloads = 0;
    const { api, dir, voicePlayground } = makeHarness({
      fetchImpl: async (raw, init) => {
        const path = new URL(raw).pathname;
        if (path.endsWith("/text-to-speech/narrator") && init.method === "POST") {
          submissions++;
          return jsonRes({ id: "recover_audio" }, 202);
        }
        if (path.endsWith("/history/recover_audio"))
          return jsonRes({
            id: "recover_audio",
            status: "completed",
            credits_deducted: 7,
            result: { audio_url: "https://cdn.example.com/resume.wav" },
          });
        if (path === "/resume.wav") {
          downloads++;
          return new Response(audio);
        }
        return jsonRes([]);
      },
    });
    const output = [];
    const errors = [];
    const options = {
      fetchImpl: (url, init) => api.request(new Request(url, init)),
      out: (line) => output.push(line),
      err: (line) => errors.push(line),
    };
    const checkpoint = join(dir, "resume.json");
    expect(
      await runVoicePlaygroundCli(
        [
          "generate",
          "tts",
          "--server",
          "http://studio.invalid",
          "--yes",
          "--wait",
          "3",
          "--checkpoint",
          checkpoint,
          "--input",
          '{"voiceId":"narrator","text":"Chào buổi sáng."}',
        ],
        options,
      ),
      errors.join("\n"),
    ).toBe(0);
    const original = JSON.parse(output.at(-1)).items[0];
    const file = voicePlayground.audioFile(original.audioFile);
    if (damage === "missing index") rmSync(join(voicePlayground.storageDir, "items.json"));
    else if (damage === "truncated audio") writeFileSync(file, audio.subarray(0, 32));
    else rmSync(file);
    expect(
      await runVoicePlaygroundCli(["resume", checkpoint, "--wait", "3"], options),
      errors.join("\n"),
    ).toBe(0);
    const repaired = JSON.parse(output.at(-1)).items[0];
    expect(repaired.id).toBe(original.id);
    expect(repaired.creditsDeducted).toBe(7);
    expect(repaired.generationRecipe).toEqual(original.generationRecipe);
    expect(readFileSync(voicePlayground.audioFile(repaired.audioFile))).toEqual(audio);
    expect(downloads).toBe(2);
    expect(submissions).toBe(1);
  },
);

test("concurrent Cloud recovery keeps the media of the same take after loss of the index", async () => {
  const wav = wrapPcm16ToWav(Buffer.alloc(32000, 10), 16000);
  let recovering = false;
  let recoveringDownloads = 0;
  let submissions = 0;
  const bothDownloading = Promise.withResolvers();
  const fetchImpl = async (raw, init) => {
    const path = new URL(raw).pathname;
    if (path.endsWith("/text-to-speech/narrator") && init.method === "POST") {
      submissions++;
      return jsonRes({ id: "recover_twice" }, 202);
    }
    if (path.endsWith("/history/recover_twice"))
      return jsonRes({
        status: "completed",
        credits_deducted: 7,
        result: { audio_url: "https://cdn.example.com/once.wav" },
      });
    if (path === "/once.wav") {
      if (recovering) {
        if (++recoveringDownloads === 2) bothDownloading.resolve();
        await bothDownloading.promise;
      }
      return new Response(wav);
    }
    return jsonRes([]);
  };
  const { voicePlayground, dir, playgroundDir } = makeHarness({ fetchImpl });
  const {
    jobs: [original],
  } = await voicePlayground.startTts({ voiceId: "narrator", text: "Chào." });
  await voicePlayground.waitForAllJobs();
  rmSync(join(playgroundDir, "items.json"));
  const reopened = openVoicePlayground({
    dir: playgroundDir,
    project: dir,
    globalDir: join(playgroundDir, "global"),
    fetchImpl,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    configFile: join(dir, "other-voice.json"),
    secretsFile: join(dir, "missing.env"),
    env: { GENVOICE_API_KEY: "fixture-only" },
  });
  recovering = true;
  try {
    const results = await Promise.all([
      voicePlayground.importRemoteTask("recover_twice"),
      reopened.importRemoteTask("recover_twice"),
    ]);
    expect(results.map(({ item }) => item.id)).toEqual([original.id, original.id]);
    expect(voicePlayground.listItems()).toHaveLength(1);
    expect(readFileSync(voicePlayground.audioFile(results[0].item.audioFile))).toEqual(wav);
    expect(submissions).toBe(1);
  } finally {
    reopened.close();
  }
});

test("recordings search ranks Vietnamese text and returns a reusable GenVoice recipe", async () => {
  const { api, playgroundDir } = makeHarness();
  mkdirSync(playgroundDir, { recursive: true });
  const createdAt = "2026-11-18T12:00:00Z";
  const lead = {
    id: "pg_scene_viet",
    title: "Mai chào Việt Nam",
    kind: "tts",
    provider: "elevenlabs",
    voiceId: "actor_vi",
    voiceName: "Vietnamese narrator",
    text: "[softly] Chào Việt Nam.",
    tags: ["narration", "softly"],
    modelId: "eleven_v4",
    languageCode: "vi",
    voiceSettings: { stability: 0.43, similarity_boost: 0.76 },
    exportTranscript: true,
    seed: 0,
    durationSeconds: 4.1,
    favorite: true,
    creditsDeducted: 23,
    rating: 5,
    createdAt,
  };
  writeFileSync(
    join(playgroundDir, "items.json"),
    JSON.stringify({
      version: 1,
      items: [
        lead,
        {
          ...lead,
          id: "plain_take",
          title: "Other take",
          voiceId: "other_actor",
          rating: 2,
          favorite: false,
          creditsDeducted: 0,
        },
      ],
    }),
  );
  const results = await api.request(
    "/api/voice/playground/recordings?q=viet+nam&favorite=1&minRating=4&tag=narration&minSeconds=4&sort=relevance",
  );
  expect(results.status).toBe(200);
  const legacy = await (await api.request("/api/voice/playground/items/plain_take")).json();
  expect(legacy.item.creditsDeducted).toBeUndefined();
  expect(legacy.item.legacyCreditsDeducted).toBe(0);
  expect(await results.json()).toMatchObject({
    total: 1,
    items: [{ id: lead.id, rating: 5, creditsDeducted: 23, scope: "project" }],
  });
  const recipe = await api.request(`/api/voice/playground/items/${lead.id}/recipe`);
  expect(recipe.status).toBe(200);
  expect(await recipe.json()).toMatchObject({
    command: "generate tts",
    input: {
      connection: "genvoice",
      provider: "elevenlabs",
      voiceId: "actor_vi",
      text: lead.text,
      modelId: "eleven_v4",
      languageCode: "vi",
      voiceSettings: lead.voiceSettings,
      seed: 0,
      exportTranscript: true,
    },
  });
  const base = "/api/voice/playground";
  const archived = await api.request(`${base}/items/${lead.id}`, { method: "DELETE" });
  expect((await archived.json()).archived).toBe(true);
  expect((await (await api.request(`${base}/recordings?favorite=1`)).json()).total).toBe(0);
  expect((await (await api.request(`${base}/recordings?archived=1`)).json()).items[0].id).toBe(
    lead.id,
  );
  const restored = await api.request(`${base}/recordings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [lead.id, "missing"], patch: { archived: false, rating: 4 } }),
  });
  expect(await restored.json()).toMatchObject({
    items: [{ id: lead.id, rating: 4 }],
    missing: ["missing"],
  });
  expect((await (await api.request(`${base}/recordings?archived=1`)).json()).total).toBe(0);
});

test("archive expiry removes only eligible audio beyond the retention period", async () => {
  const { api, playgroundDir } = makeHarness();
  const old = "2025-01-01T00:00:00Z";
  const audio = join(playgroundDir, "audio");
  mkdirSync(audio, { recursive: true });
  const items = [
    { id: "expired", title: "Expired", archivedAt: old },
    { id: "protected", title: "A film uses this", archivedAt: old, sourceTakeId: "01" },
    { id: "parent", title: "Original", archivedAt: old },
    { id: "replacement", title: "Replacement phrase", archivedAt: old },
    { id: "shared_expired", title: "Expired alias", archivedAt: old },
    { id: "shared_active", title: "Active alias" },
    {
      id: "edit",
      title: "Edited take in use",
      archivedAt: old,
      sourceTakeId: "02",
      version: { parentId: "parent", rootId: "parent", replacement: { id: "replacement" } },
    },
    { id: "new", title: "Recently archived", archivedAt: new Date().toISOString() },
    { id: "active", title: "Active" },
  ].map((item) => ({
    ...item,
    kind: "tts",
    audioFile:
      item.id === "shared_expired"
        ? "Shared.wav"
        : item.id === "shared_active"
          ? "shared.wav"
          : `${item.id}.wav`,
    createdAt: old,
  }));
  const wav = wrapPcm16ToWav(Buffer.alloc(16000 * 2), 16000);
  for (const item of items) writeFileSync(join(audio, item.audioFile), wav);
  writeFileSync(join(playgroundDir, "items.json"), JSON.stringify({ items }));
  const base = "/api/voice/playground/recordings";
  expect(await (await api.request(`${base}/expired`)).json()).toMatchObject({
    retentionDays: 30,
    eligible: [{ id: "expired" }],
    protected: 5,
  });
  const response = await api.request(`${base}/purge-expired`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: items.map(({ id }) => id) }),
  });
  const result = await response.json();
  expect(result.purged).toEqual(["expired"]);
  expect(result.failed.map(({ id }) => id)).toEqual([
    "protected",
    "parent",
    "replacement",
    "shared_expired",
    "shared_active",
    "edit",
    "new",
    "active",
  ]);
  expect(existsSync(join(audio, "expired.wav"))).toBe(false);
  expect(existsSync(join(audio, "shared.wav"))).toBe(true);
  for (const id of ["protected", "parent", "replacement", "edit", "new", "active"])
    expect(existsSync(join(audio, `${id}.wav`))).toBe(true);
});

test("template PATCH accepts a replacement draft and archive metadata together", async () => {
  const { api } = makeHarness();
  const base = "/api/voice/playground/templates";
  const send = (path, method, input) =>
    api.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const created = await send(base, "POST", {
    title: "Initial setting",
    draft: { mode: "tts", voiceId: "actor_a", text: "Hello" },
  });
  expect(created.status).toBe(201);
  const { template } = await created.json();
  const updated = await send(`${base}/${template.id}`, "PATCH", {
    draft: { mode: "tts", voiceId: "actor_b", text: "[whispers] Chào" },
    tags: ["quiet"],
    rating: 5,
    archived: true,
  });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({
    template: {
      draft: { voiceId: "actor_b", text: "[whispers] Chào" },
      tags: ["quiet"],
      rating: 5,
    },
  });
  expect((await (await api.request(base)).json()).templates).toEqual([]);
});

test("a shortlisted voice keeps its provider identity and separate Project and Global aliases", async () => {
  const { api, playgroundDir } = makeHarness();
  const voice = {
    id: "actor_snapshot",
    name: "Deep Storyteller",
    provider: "elevenlabs",
    language: "vi",
    gender: "female",
  };
  const send = (path, method, body) =>
    api.request(`/api/voice/playground/${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const global = await send("profiles?scope=global", "POST", {
    voice,
    alias: "Narrator",
    tags: ["casting"],
  });
  expect(global.status).toBe(201);
  const { profile } = await global.json();
  const local = await send("profiles?scope=project", "POST", {
    voice,
    alias: "Cô Mai",
    rating: 5,
    color: "#205080",
  });
  expect(local.status).toBe(201);
  expect((await local.json()).profile).toMatchObject({
    id: profile.id,
    scope: "project",
    alias: "Cô Mai",
    voice: { name: "Deep Storyteller" },
  });
  const found = await api.request(
    "/api/voice/playground/profiles?q=co+mai&includeGlobal=1&minRating=4&gender=female",
  );
  expect(await found.json()).toMatchObject({
    total: 1,
    profiles: [{ id: profile.id, alias: "Cô Mai", rating: 5 }],
  });
  const globalAgain = await api.request(
    `/api/voice/playground/profiles/${profile.id}?scope=global`,
  );
  expect((await globalAgain.json()).profile.alias).toBe("Narrator");
  const previewUrl = "/api/voice/playground/audio/actor_preview.wav?scope=project";
  mkdirSync(join(playgroundDir, "audio"), { recursive: true });
  writeFileSync(
    join(playgroundDir, "audio", "actor_preview.wav"),
    wrapPcm16ToWav(Buffer.alloc(32000), 16000),
  );
  const preview = await send("profiles?scope=project", "POST", {
    voice: { ...voice, previewUrl },
  });
  expect(preview.status).toBe(201);
  expect((await preview.json()).profile.voice.previewUrl).toBe(previewUrl);
  const update = await send("profiles?scope=project", "POST", { voice, alias: "Cô Mai" });
  expect((await update.json()).profile.voice.previewUrl).toBe(previewUrl);
  const notShareable = await send("profiles?scope=global", "POST", {
    voice: { ...voice, previewUrl },
  });
  expect(notShareable.status).toBe(400);
  const projectOnly = await send("profiles", "POST", {
    voice: { ...voice, id: "local_preview_actor", previewUrl },
  });
  const { profile: toShare } = await projectOnly.json();
  const promoted = await send(`profiles/${toShare.id}/copies`, "POST", { scope: "global" });
  expect(promoted.status).toBe(201);
  const sharedPreview = (await promoted.json()).profile.voice.previewUrl;
  expect(sharedPreview).toEndWith("?scope=global");
  const playable = await api.request(sharedPreview);
  expect(playable.status).toBe(200);
  expect(Buffer.from(await playable.arrayBuffer())).toEqual(
    readFileSync(join(playgroundDir, "audio", "actor_preview.wav")),
  );
  await send(`profiles/${profile.id}`, "PATCH", { archived: true });
  expect((await (await api.request("/api/voice/playground/profiles")).json()).total).toBe(1);
  expect(
    (await (await api.request("/api/voice/playground/profiles?archived=1")).json()).profiles[0].id,
  ).toBe(profile.id);
  await send(`profiles/${profile.id}`, "PATCH", { archived: false });
  expect(
    (await (await api.request("/api/voice/playground/profiles")).json()).profiles.find(
      (row) => row.id === profile.id,
    ).alias,
  ).toBe("Cô Mai");
});

test("Gemini casting maps Vietnamese to an exact locale and preserves the voice context", async () => {
  const { api } = makeHarness({
    env: { GEMINI_API_KEY: "a-gemini-testing-key" },
    fetchImpl: async (raw) => {
      const url = new URL(raw);
      return jsonRes({
        voices:
          url.searchParams.get("language_code") === "vi-VN"
            ? [
                {
                  id: "voice_narrator",
                  display_name: "Narrator",
                  language_code: "vi-VN",
                  context: ["Audiobook"],
                },
              ]
            : [],
        next_page_token: "another-page",
      });
    },
  });
  const response = await api.request(
    "/api/voice/playground/shared-voices?connection=google&language=vi",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    voices: [
      { connection: "google", id: "voice_narrator", language: "vi-VN", useCase: "Audiobook" },
    ],
    hasMore: true,
    nextPageToken: "another-page",
  });
});

const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

let mp3Fixture;
const makeMinimalMp3 = () => {
  if (!mp3Fixture) {
    const result = Bun.spawnSync(
      [
        "ffmpeg",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=250:sample_rate=44100",
        "-t",
        "0.12",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe", timeout: 10_000 },
    );
    if (!result.success) throw new Error(result.stderr.toString());
    mp3Fixture = result.stdout;
  }
  return mp3Fixture;
};

test("Cloud history distinguishes unknown charges from an explicitly reported free task", async () => {
  const { api } = makeHarness({
    fetchImpl: async (url) => {
      if (String(url).includes("/voice-changer/history")) return jsonRes({ tasks: [] });
      return jsonRes({
        tasks: [
          { id: "unknown_fee", status: "completed" },
          { id: "free_task", status: "completed", credits_deducted: 0 },
        ],
      });
    },
  });
  const result = await (await api.request("/api/voice/playground/remote-history")).json();
  expect(result.items.find((item) => item.id === "unknown_fee").creditsDeducted).toBeUndefined();
  expect(result.items.find((item) => item.id === "free_task").creditsDeducted).toBe(0);
});

test("casting favorites stay synchronized between the picker and the main library", async () => {
  const { api } = makeHarness({ env: {} });
  const voice = {
    id: "cloud_actor",
    name: "Cloud Actor",
    age: "old",
    accent: "british",
    category: "shared",
  };
  const add = await api.request("/api/voice/playground/voice-favorites", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voice, favorite: true }),
  });
  expect(add.status).toBe(200);
  expect((await (await api.request("/api/favorites")).json()).effects).toContain(
    "voice:cloud_actor",
  );
  const remove = await api.request("/api/favorites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "effects", id: "voice:cloud_actor", on: false }),
  });
  expect(remove.status).toBe(200);
  expect(
    (await (await api.request("/api/voice/playground/voice-favorites")).json()).voices,
  ).toEqual([]);
});

test.each(["playground", "film_take"])(
  "Voice Changer preserves %s input for retry and composer reuse",
  async (sourceKind) => {
    const original = makeMinimalMp3();
    const sentInputs = [];
    const { api, voicePlayground, playgroundDir, dir } = makeHarness({
      fetchImpl: async (url, init = {}) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/models") || path.endsWith("/languages")) return jsonRes([]);
        if (path.endsWith("/default-voices")) return jsonRes({ voices: [] });
        if (path.endsWith("/auth/me")) return jsonRes({ credit_balance: 100 });
        if (path.endsWith("/voice-changer")) {
          sentInputs.push(Buffer.from(await init.body.get("audio").arrayBuffer()));
          return jsonRes({ task_id: `vc_${sentInputs.length}` }, 202);
        }
        if (path.includes("/history/"))
          return jsonRes({
            status: "completed",
            result: { audio_url: "https://cdn.example/voice.mp3" },
          });
        if (path.endsWith("/voice.mp3"))
          return new Response(original, { headers: { "content-type": "audio/mpeg" } });
        throw new Error(`Unexpected upstream URL: ${url}`);
      },
    });
    mkdirSync(join(playgroundDir, "audio"), { recursive: true });
    writeFileSync(join(playgroundDir, "audio/source.mp3"), original);
    writeFileSync(
      join(playgroundDir, "items.json"),
      JSON.stringify({
        items: [
          {
            id: "source",
            audioFile: "source.mp3",
            mimeType: "audio/mpeg",
            title: "Original source",
          },
        ],
      }),
    );
    writeFileSync(join(dir, "voice/takes/01.mp3"), original);
    const post = (path, body) =>
      api.request(`/api/voice/playground/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const first = await post("voice-changer", {
      voiceId: "v1",
      ...(sourceKind === "playground"
        ? { sourceItemId: "source" }
        : { sourceTakeKind: "takes", sourceTakeFile: "01.mp3" }),
    });
    expect(first.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    const child = voicePlayground.listItems().find((item) => item.remoteTaskId === "vc_1");
    if (sourceKind === "playground") await voicePlayground.deleteItem("source");
    else writeFileSync(join(dir, "voice/takes/01.mp3"), Buffer.from("replaced take"));
    expect((await post(`items/${child.id}/retry`, { voiceId: "v2" })).status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(sentInputs[1]).toEqual(original);
    expect(child.voiceChanger.sourceFile).toBeTruthy();
    expect(
      (await post("voice-changer", { voiceId: "v3", sourceFile: child.voiceChanger.sourceFile }))
        .status,
    ).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(sentInputs[2]).toEqual(original);
    expect(
      voicePlayground.listItems().find((item) => item.remoteTaskId === "vc_3").voiceChanger
        .sourceLabel,
    ).toBe(child.voiceChanger.sourceLabel);
  },
);

test.each(["tts", "stt"])(
  "%s task errors redact the API key before reaching the client",
  async (mode) => {
    const key = "gv_test_secret_9988";
    const { api, voicePlayground } = makeHarness({
      fetchImpl: async (url, init = {}) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/models") || path.endsWith("/languages")) return jsonRes([]);
        if (path.endsWith("/default-voices")) return jsonRes({ voices: [] });
        if (init.method === "POST") return jsonRes({ task_id: "failed_task" }, 202);
        return jsonRes({
          status: "failed",
          detail_error: `Generation failed with xi-api-key: ${key}`,
        });
      },
    });
    let error;
    if (mode === "tts") {
      await voicePlayground.startTts({ voiceId: "v1", text: "Hello" });
      await voicePlayground.waitForAllJobs();
      error = voicePlayground.listJobs()[0].error;
    } else {
      const form = new FormData();
      form.set("file", new File([makeMinimalMp3()], "audio.mp3", { type: "audio/mpeg" }));
      form.set("languageCode", "en");
      const response = await api.request("/api/voice/playground/stt", {
        method: "POST",
        body: form,
      });
      error = (await response.json()).error;
    }
    expect(error).toContain("Generation failed");
    expect(error).not.toContain(key);
  },
);

const makeHarness = (opts = {}) => {
  const dir = makeDir("vp-film-");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "assets/public"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "voice/try"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      voice: { lines: [], edits: {}, warp: [] },
      takes: [{ id: "01", t: 1.5, voice: "ZaZosYpkIGmSqOwAlfnk", text: "[low] Take one." }],
      beats: {},
    }),
  );

  const cacheFile = join(dir, "shared-en.json");
  writeFileSync(
    cacheFile,
    JSON.stringify({
      version: 1,
      syncedAt: "2026-11-15T00:00:00Z",
      totalScanned: 1,
      totalEnglish: 1,
      totalEnglishV4: 1,
      voices: [
        {
          id: "v_cached_01",
          name: "Cached Narrator",
          category: "professional",
          useCase: "narrative_story",
          gender: "male",
          age: "middle_aged",
          accent: "american",
          descriptive: "deep",
          description: "Cached shared voice.",
          previewUrl: "https://cdn.example/cached.mp3",
          v4: true,
          v4Post: true,
          v4Turbo: false,
          v4Fast: false,
          rate: 1,
          free: false,
          usage1y: 12000,
          usage7d: 500,
          clones: 100,
          likes: 50,
          featured: false,
          addedAt: 1750000000,
        },
      ],
    }),
  );

  const events = new Set();
  const emitted = [];
  const send = (event, data = "") => emitted.push({ event, data });
  const voice = openVoice(dir);
  const voiceLibrary = openVoiceLibrary({ project: dir, cacheFile, autoSync: false, env: {} });
  const secretsFile = opts.secretsFile ?? join(dir, "missing.env");
  const configFile = opts.configFile ?? join(dir, "pg-config.json");
  const playgroundDir = join(dir, "voice/playground");

  const voicePlayground = openVoicePlayground({
    dir: playgroundDir,
    project: dir,
    configFile,
    secretsFile,
    env: opts.env ?? { GENVOICE_API_KEY: "gv_test_secret_9988" },
    fetchImpl: opts.fetchImpl,
    lookup: opts.lookup ?? (async () => [{ address: "93.184.216.34", family: 4 }]),
    pollIntervalMs: 2,
    maxPollMs: 3000,
    voice,
    voiceLibrary,
    onEvent: (payload) => send("voice-playground", JSON.stringify(payload)),
    onVoiceChanged: () => send("voice"),
  });
  playgroundControllers.push(voicePlayground);

  const film = {
    PROJECT: dir,
    PUBLIC: join(dir, "assets/public"),
    ASSETS: join(dir, "assets"),
    LITE: join(dir, "lite"),
    WORK: join(dir, "work"),
    RENDERS: join(dir, "renders"),
    EDIT: join(dir, "src/edit.json"),
    VOICE_MAP: join(dir, "voice_map.json"),
    favoritesDir: join(dir, "favorites"),
    sound: null,
    voice,
    lessonFiles: null,
    grades: null,
    readChoices: () => ({}),
    choose: () => {},
    shotComments: () => [],
    trials: () => null,
    notes: {
      list: () => [],
      add: () => ({}),
      edit: () => ({}),
      remove: () => ({}),
      restore: () => ({}),
      flush: () => {},
    },
    readEdit: () => ({}),
    timeline: () => ({}),
    openRead: (file, range) => createReadStream(file, range),
  };
  const page = { dir, html: () => "<html><head></head><body></body></html>", error: () => null };
  const lessons = {
    list: () => [],
    read: () => ({ error: "none" }),
    write: () => ({ error: "none" }),
    create: () => ({ error: "none" }),
  };
  const api = createApi(film, {
    page,
    events,
    send,
    lessons,
    voiceLibrary,
    voicePlayground,
    favorites: openFavorites(join(dir, "favorites/default.json")),
  });
  return { dir, playgroundDir, configFile, secretsFile, api, voicePlayground, emitted };
};

describe("GenVoice Voice Playground API", () => {
  test("key resolution priority, masking, override reset, and HTML SPA fallback error detection", async () => {
    const tmp = makeDir("vp-secrets-");
    const secretsFile = join(tmp, "genvoice.env");
    writeFileSync(secretsFile, 'export GENVOICE_API_KEY="gv_file_secret_4321"\n');

    const seenKeys = [];
    const { api, voicePlayground } = makeHarness({
      secretsFile,
      env: {},
      fetchImpl: async (url, init) => {
        const key = String(init?.headers?.["xi-api-key"] ?? "");
        seenKeys.push(key);
        if (String(url).endsWith("/auth/me")) {
          if (key === "gv_bad_401") {
            return jsonRes({ detail: "Invalid API key" }, 401);
          }
          return jsonRes({
            id: "u1",
            email: "dev@gohans.test",
            name: "Gohans",
            credit_balance: 481800,
          });
        }
        return new Response("<!doctype html><html><body>SPA</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    });

    const stRes = await api.request("/api/voice/playground/status?live=1");
    expect(stRes.status).toBe(200);
    const st = await stRes.json();
    expect(st.configured).toBe(true);
    expect(st.source).toBe("secrets_file");
    expect(st.maskedKey).not.toContain("gv_file_secret");
    expect(st.maskedKey.endsWith("4321")).toBe(true);
    expect(st.account.credit_balance).toBe(481800);

    const badBase = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiBase: "http://evil.example/v1" }),
    });
    expect(badBase.status).toBe(400);

    const badAuthRes = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "gv_bad_401" }),
    });
    expect(badAuthRes.status).toBe(401);
    const afterRejected = await (await api.request("/api/voice/playground/status")).json();
    expect(afterRejected.source).toBe("secrets_file");
    expect(afterRejected.maskedKey.endsWith("4321")).toBe(true);

    const saveRes = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "gv_manual_override_7777" }),
    });
    expect(saveRes.status).toBe(200);
    const saved = await saveRes.json();
    expect(saved.source).toBe("override");
    expect(saved.hasOverride).toBe(true);
    expect(saved.maskedKey.endsWith("7777")).toBe(true);
    expect(seenKeys).toContain("gv_file_secret_4321");
    expect(seenKeys).toContain("gv_manual_override_7777");

    const clrRes = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearOverride: true }),
    });
    expect(clrRes.status).toBe(200);
    const cleared = await clrRes.json();
    expect(cleared.source).toBe("secrets_file");
    expect(cleared.hasOverride).toBe(false);

    await expect(voicePlayground.fetchRemoteHistory()).rejects.toThrow(/HTML|JSON|unsupported/i);
  });

  test("isNonGlobalIp and assertSafeMediaUrl reject private, loopback, ULA, NAT64, 6to4, and DNS-rebound targets", async () => {
    expect(isNonGlobalIp("127.0.0.1")).toBe(true);
    expect(isNonGlobalIp("10.0.0.5")).toBe(true);
    expect(isNonGlobalIp("172.16.0.1")).toBe(true);
    expect(isNonGlobalIp("192.168.1.1")).toBe(true);
    expect(isNonGlobalIp("169.254.169.254")).toBe(true);
    expect(isNonGlobalIp("::1")).toBe(true);
    expect(isNonGlobalIp("::ffff:127.0.0.1")).toBe(true);
    expect(isNonGlobalIp("fc00::1")).toBe(true);
    expect(isNonGlobalIp("fe80::1")).toBe(true);
    expect(isNonGlobalIp("64:ff9b::10.0.0.1")).toBe(true);
    expect(isNonGlobalIp("2002:0a00:0001::1")).toBe(true);
    expect(isNonGlobalIp("93.184.216.34")).toBe(false);

    const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(
      assertSafeMediaUrl(
        "https://cdn.example/clip.mp3",
        "https://api.genvoice.pro/v1",
        publicLookup,
      ),
    ).resolves.toBeUndefined();

    await expect(
      assertSafeMediaUrl(
        "http://cdn.example/clip.mp3",
        "https://api.genvoice.pro/v1",
        publicLookup,
      ),
    ).rejects.toThrow(/protocol/i);
    await expect(
      assertSafeMediaUrl("https://localhost/clip.mp3", "https://api.genvoice.pro/v1", publicLookup),
    ).rejects.toThrow(/local/i);
    await expect(
      assertSafeMediaUrl(
        "https://169.254.169.254/latest",
        "https://api.genvoice.pro/v1",
        publicLookup,
      ),
    ).rejects.toThrow(/non-global/i);
    await expect(
      assertSafeMediaUrl(
        "https://rebound.example/a.mp3",
        "https://api.genvoice.pro/v1",
        async () => [{ address: "10.0.0.8", family: 4 }],
      ),
    ).rejects.toThrow(/DNS/i);
  });

  test("TTS archival blocks 302 redirects to internal/private media targets", async () => {
    const { api, voicePlayground } = makeHarness({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.endsWith("/models")) return jsonRes([]);
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.includes("/text-to-speech/"))
          return jsonRes({ id: "task_redir", status: "pending" }, 202);
        if (u.endsWith("/history/task_redir")) {
          return jsonRes({
            id: "task_redir",
            status: "completed",
            result: { audio_url: "https://cdn.example/redir.mp3" },
          });
        }
        if (u === "https://cdn.example/redir.mp3") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/latest/meta-data" },
          });
        }
        return jsonRes({}, 404);
      },
    });

    const res = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voiceId: "v_1",
        text: "Redirect guard test",
        voiceSettings: { stability: 0.5 },
      }),
    });
    expect(res.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    const job = voicePlayground.listJobs().find((j) => j.remoteTaskId === "task_redir");
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/non-global/i);
    expect(voicePlayground.listItems().length).toBe(0);
  });

  test("catalog and searchSharedVoices respect pageSize and strip unsafe preview URLs", async () => {
    let seenQuery = "";
    const { api } = makeHarness({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.endsWith("/models")) return jsonRes([]);
        if (u.endsWith("/languages")) return jsonRes([{ code: "en", name: "English" }]);
        if (u.includes("/default-voices")) {
          return jsonRes({
            voices: [
              { voice_id: "v_safe", name: "Safe", preview_url: "https://cdn.example/safe.mp3" },
              { voice_id: "v_xss", name: "Bad", preview_url: "javascript:alert(1)" },
            ],
          });
        }
        if (u.includes("/shared-voices?")) {
          seenQuery = u.split("/shared-voices?")[1] ?? "";
          return jsonRes({
            voices: [
              {
                voice_id: "sh_1",
                name: "Clara",
                preview_url: "http://evil.insecure/clara.mp3",
              },
              {
                voice_id: "sh_2",
                name: "Liam",
                preview_url: "https://cdn.example/liam.mp3",
              },
            ],
            has_more: true,
          });
        }
        return jsonRes({}, 404);
      },
    });

    const cat = await (await api.request("/api/voice/playground/catalog")).json();
    expect(cat.defaultVoices.find((v) => v.id === "v_safe")?.previewUrl).toBe(
      "https://cdn.example/safe.mp3",
    );
    expect(cat.defaultVoices.find((v) => v.id === "v_xss")?.previewUrl).toBe("");

    const shRes = await api.request(
      "/api/voice/playground/shared-voices?search=narrator&pageSize=25&page=2&useCase=narration",
    );
    expect(shRes.status).toBe(200);
    expect(seenQuery).toContain("page_size=25");
    expect(seenQuery).toContain("page=2");
    expect(seenQuery).toContain("use_cases%5B%5D=narration");
    const shBody = await shRes.json();
    expect(shBody.hasMore).toBe(true);
    expect(shBody.voices[0].previewUrl).toBe("");
    expect(shBody.voices[1].previewUrl).toBe("https://cdn.example/liam.mp3");
  });

  test("TTS multi-variation forwards context/seed/format/normalization, archives audio + SRT, and cleans up on delete", async () => {
    const mp3 = makeMinimalMp3();
    const ttsBodies = [];
    const pollCounts = new Map();

    const { api, voicePlayground, emitted } = makeHarness({
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.endsWith("/models")) {
          return jsonRes([
            {
              model_id: "eleven_v4",
              name: "Eleven v4",
              can_do_text_to_speech: true,
              supports_context: true,
              supports_speed: false,
              supports_similarity: true,
              maximum_text_length_per_request: 10000,
              model_rates: { character_cost_multiplier: 1 },
            },
          ]);
        }
        if (u.endsWith("/languages")) return jsonRes([{ code: "en", name: "English" }]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.includes("/text-to-speech/")) {
          const parsed = JSON.parse(String(init.body));
          ttsBodies.push(parsed);
          expect(parsed.provider).toBe("elevenlabs");
          return jsonRes({ id: `task_tts_${ttsBodies.length}`, status: "pending" }, 202);
        }
        if (u.includes("/history/task_tts_")) {
          const taskId = u.split("/history/")[1];
          const c = (pollCounts.get(taskId) ?? 0) + 1;
          pollCounts.set(taskId, c);
          if (c === 1) return jsonRes({ id: taskId, status: "processing", progress: 50 });
          return jsonRes({
            id: taskId,
            status: "completed",
            progress: 100,
            characters_used: 42,
            credits_deducted: 48,
            result: {
              audio_url: `https://cdn.example/audio/${taskId}.mp3`,
              srt_url: `https://cdn.example/audio/${taskId}.srt`,
            },
          });
        }
        if (u.endsWith(".mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        if (u.endsWith(".srt")) {
          return new Response("1\n00:00:00,000 --> 00:00:01,000\nHello world\n", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        return jsonRes({}, 404);
      },
    });

    const genRes = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voiceId: "ZaZosYpkIGmSqOwAlfnk",
        voiceName: "Seff Echo",
        modelId: "eleven_v4",
        languageCode: "en",
        text: "[excited] Hello [pause] world!",
        voiceSettings: { stability: 0.4, similarity_boost: 0.8, speed: 1.05 },
        previousText: "Earlier line.",
        nextText: "Following line.",
        seed: 42,
        outputFormat: "mp3_44100_192",
        applyTextNormalization: "on",
        exportTranscript: true,
        variations: 2,
        name: "Intro test",
        notes: "Opening line take",
      }),
    });
    expect(genRes.status).toBe(202);
    expect((await genRes.json()).jobs.length).toBe(2);

    await voicePlayground.waitForAllJobs();
    expect(emitted.some((e) => e.event === "voice-playground")).toBe(true);
    expect(ttsBodies[0].previous_text).toBe("Earlier line.");
    expect(ttsBodies[0].next_text).toBe("Following line.");
    expect(ttsBodies[0].seed).toBe(42);
    expect(ttsBodies[1].seed).toBe(43);
    expect(ttsBodies[0].output_format).toBe("mp3_44100_192");
    expect(ttsBodies[0].apply_text_normalization).toBe("on");
    expect(ttsBodies[0].voice_settings.speed).toBeUndefined();
    expect(ttsBodies[0].name).toBeUndefined();

    const { items } = await (await api.request("/api/voice/playground/items")).json();
    expect(items.length).toBe(2);
    expect(items.map(({ seed }) => seed).sort()).toEqual([42, 43]);
    const first = items.find(({ seed }) => seed === 43);
    expect(first.tags).toEqual(["excited", "pause"]);
    expect(first.voiceSettings).toEqual({ stability: 0.4, similarity_boost: 0.8 });
    expect(first.generationRecipe).toMatchObject({
      requested: { seed: 42, variations: 2 },
      effective: { body: { seed: 43 } },
    });
    expect(first.outputFormat).toBe("mp3_44100_192");
    expect(first.srtText).toContain("Hello world");

    const audioRes = await api.request(`/api/voice/playground/audio/${first.audioFile}`, {
      headers: { range: "bytes=0-15" },
    });
    expect(audioRes.status).toBe(206);

    const srtRes = await api.request(`/api/voice/playground/srt/${first.srtFile}`);
    expect(srtRes.status).toBe(200);
    expect(srtRes.headers.get("cache-control")).toBe("no-store");
    expect(await srtRes.text()).toBe("1\n00:00:00,000 --> 00:00:01,000\nHello world\n");
    const captionTrack = await api.request(`/api/voice/playground/srt/${first.srtFile}?format=vtt`);
    expect(captionTrack.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(await captionTrack.text()).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello world\n",
    );

    const delRes = await api.request(`/api/voice/playground/items/${first.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const afterDel = await (await api.request("/api/voice/playground/items")).json();
    expect(afterDel.items.some((x) => x.id === first.id)).toBe(false);
  });

  test("PATCH favorite/template, promote emits SSE update, and retryItem preserves TTS params + swaps Dialogue speakerKey", async () => {
    const mp3 = makeMinimalMp3();
    const sentTts = [];
    const sentDialogue = [];
    let taskCounter = 0;

    const { api, voicePlayground, emitted } = makeHarness({
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.endsWith("/models")) return jsonRes([]);
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.includes("/text-to-speech/")) {
          sentTts.push(JSON.parse(String(init.body)));
          return jsonRes({ id: `task_tts_${++taskCounter}`, status: "pending" }, 202);
        }
        if (u.endsWith("/dialogue")) {
          sentDialogue.push(JSON.parse(String(init.body)));
          return jsonRes({ id: `task_dlg_${++taskCounter}`, status: "pending" }, 202);
        }
        if (u.includes("/history/task_")) {
          const tid = u.split("/history/")[1];
          return jsonRes({
            id: tid,
            status: "completed",
            result: { audio_url: `https://cdn.example/${tid}.mp3` },
          });
        }
        if (u.endsWith(".mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        return jsonRes({}, 404);
      },
    });

    await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voiceId: "v_orig",
        voiceName: "Orig",
        text: "[excited] Base line",
        voiceSettings: { stability: 0.45 },
        previousText: "Prev ctx",
        seed: 77,
        outputFormat: "mp3_44100_192",
      }),
    });
    await voicePlayground.waitForAllJobs();
    const baseItem = voicePlayground.listItems()[0];

    const patchRes = await api.request(`/api/voice/playground/items/${baseItem.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        favorite: true,
        isTemplate: true,
        templateName: "Hero Hook",
      }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).item.templateName).toBe("Hero Hook");

    await api.request(`/api/voice/playground/items/${baseItem.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v_swapped", voiceName: "Clara" }),
    });
    await voicePlayground.waitForAllJobs();
    expect(sentTts[1].previous_text).toBe("Prev ctx");
    expect(sentTts[1].seed).toBe(77);
    expect(sentTts[1].output_format).toBe("mp3_44100_192");

    const swappedItem = voicePlayground.listItems().find((x) => x.voiceId === "v_swapped");
    emitted.length = 0;
    const promoRes = await api.request("/api/voice/playground/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: swappedItem.id, takeId: "01" }),
    });
    expect(promoRes.status).toBe(200);
    expect((await promoRes.json()).tryFile).toMatch(/^01_pg_.*\.mp3$/);
    expect(
      emitted.some((e) => {
        if (e.event !== "voice-playground") return false;
        const p = JSON.parse(e.data);
        return p.type === "item" && p.item.sourceTakeId === "01";
      }),
    ).toBe(true);

    await api.request("/api/voice/playground/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Should be local only",
        text: "[Alex]: [curious] Ready?\n[Sam]: [excited] Go!",
        speakers: {
          Alex: { voice_id: "v_alex", voice_name: "AlexV", voice_settings: { stability: 0.5 } },
          Sam: { voice_id: "v_sam", voice_name: "SamV", voice_settings: { stability: 0.6 } },
        },
      }),
    });
    await voicePlayground.waitForAllJobs();
    expect(sentDialogue[0].text).toBe("Alex: [curious] Ready?\nSam: [excited] Go!");
    expect(sentDialogue[0].name).toBeUndefined();
    const dlgItem = voicePlayground.listItems().find((x) => x.kind === "dialogue");
    expect(dlgItem.tags).toEqual(["curious", "excited"]);

    const dlgSingleSpeaker = await api.request("/api/voice/playground/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Alex: Only one turn here.",
        speakers: {
          Alex: { voice_id: "v_alex", voice_name: "AlexV", voice_settings: { stability: 0.5 } },
          Sam: { voice_id: "v_sam", voice_name: "SamV", voice_settings: { stability: 0.6 } },
        },
      }),
    });
    expect(dlgSingleSpeaker.status).toBe(400);

    const dlgRetry = await api.request(`/api/voice/playground/items/${dlgItem.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v_clara", voiceName: "Clara", speakerKey: "Sam" }),
    });
    expect(dlgRetry.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(sentDialogue[1].speakers.Alex.voice_id).toBe("v_alex");
    expect(sentDialogue[1].speakers.Sam.voice_id).toBe("v_clara");
  });

  test("Voice Changer archives source audio cleanly, retries via archived source, and rejects missing-source retries", async () => {
    const mp3 = makeMinimalMp3();
    let vcSeq = 0;
    const { api, playgroundDir, voicePlayground } = makeHarness({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.endsWith("/models")) return jsonRes([]);
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.endsWith("/voice-changer")) {
          return jsonRes({ task_id: `task_vc_${++vcSeq}`, status: "pending" }, 202);
        }
        if (u.includes("/voice-changer/history/task_vc_")) {
          const tid = u.split("/voice-changer/history/")[1];
          return jsonRes({
            id: tid,
            status: "completed",
            result: { audio_url: `https://cdn.example/${tid}.mp3` },
          });
        }
        if (u.endsWith(".mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        return jsonRes({}, 404);
      },
    });

    const uploadForm = new FormData();
    uploadForm.set("audio", new File([mp3], "raw.mp3", { type: "audio/mpeg" }));
    uploadForm.set("voiceId", "v_rachel");
    uploadForm.set("voiceName", "Rachel");
    uploadForm.set("modelId", "eleven_multilingual_sts_v2");
    uploadForm.set("voiceSettings", JSON.stringify({ stability: 0.5 }));
    uploadForm.set("seed", "123");

    const vcRes = await api.request("/api/voice/playground/voice-changer", {
      method: "POST",
      body: uploadForm,
    });
    expect(vcRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    const vcItem = voicePlayground.listItems()[0];
    expect(vcItem.voiceChanger.sourceFile).toBeTruthy();

    const retryRes = await api.request(`/api/voice/playground/items/${vcItem.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v_other", voiceName: "Other" }),
    });
    expect(retryRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();

    await api.request(`/api/voice/playground/items/${vcItem.id}`, { method: "DELETE" });
    const retriedVc = voicePlayground.listItems()[0];
    expect(retriedVc.voiceChanger.sourceFile).toBe(vcItem.voiceChanger.sourceFile);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(playgroundDir, "sources", vcItem.voiceChanger.sourceFile))).toBe(true);

    const itemsFile = join(playgroundDir, "items.json");
    const legacy = {
      ...retriedVc,
      id: "pg_legacy_vc",
      voiceChanger: { sourceLabel: "lost", remove_background_noise: false },
    };
    writeFileSync(itemsFile, JSON.stringify({ version: 1, items: [retriedVc, legacy] }, null, 2));
    await expect(
      voicePlayground.retryItem("pg_legacy_vc", { voiceId: "v_new" }),
    ).rejects.toMatchObject({
      status: 400,
    });
    const legacyRetryRes = await api.request("/api/voice/playground/items/pg_legacy_vc/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v_new" }),
    });
    expect(legacyRetryRes.status).toBe(400);
  });

  test("Voice Changer and STT multipart routes reject malformed JSON, NaN numbers, and missing sources", async () => {
    const mp3 = makeMinimalMp3();
    const { api } = makeHarness({ fetchImpl: async () => jsonRes({}, 404) });

    const badVcJson = new FormData();
    badVcJson.set("audio", new File([mp3], "raw.mp3", { type: "audio/mpeg" }));
    badVcJson.set("voiceId", "v1");
    badVcJson.set("voiceSettings", "{broken");
    expect(
      (
        await api.request("/api/voice/playground/voice-changer", {
          method: "POST",
          body: badVcJson,
        })
      ).status,
    ).toBe(400);

    const badVcSeed = new FormData();
    badVcSeed.set("audio", new File([mp3], "raw.mp3", { type: "audio/mpeg" }));
    badVcSeed.set("voiceId", "v1");
    badVcSeed.set("seed", "NaN");
    expect(
      (
        await api.request("/api/voice/playground/voice-changer", {
          method: "POST",
          body: badVcSeed,
        })
      ).status,
    ).toBe(400);

    const badSttNum = new FormData();
    badSttNum.set("file", new File([mp3], "raw.mp3", { type: "audio/mpeg" }));
    badSttNum.set("numSpeakers", "abc");
    expect(
      (await api.request("/api/voice/playground/stt", { method: "POST", body: badSttNum })).status,
    ).toBe(400);

    const badSttJson = await api.request("/api/voice/playground/stt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diarizationThreshold: 0.9 }),
    });
    expect(badSttJson.status).toBe(400);
  });

  test("Speech-to-Text (Scribe v2), remote history import deduplication, and audio traversal guard", async () => {
    const mp3 = makeMinimalMp3();
    let historyFetchCount = 0;
    let lastSttForm = null;

    const { api } = makeHarness({
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.endsWith("/speech-to-text")) {
          lastSttForm = init.body;
          return jsonRes({ task_id: "task_stt_1", status: "pending" }, 202);
        }
        if (u.endsWith("/speech-to-text/task_stt_1")) {
          return jsonRes({
            id: "task_stt_1",
            status: "completed",
            result: {
              text: "Hello Alex.",
              language_code: "en",
              words: [
                { text: "Hello", start: 0.1, end: 0.4, speaker_id: "speaker_0", type: "word" },
              ],
              additional_formats: [
                {
                  file_extension: "srt",
                  content: "1\n00:00:00,100 --> 00:00:00,400\nHello\n",
                },
              ],
            },
          });
        }
        if (u.includes("/v1/history?")) {
          return jsonRes({
            tasks: [
              {
                id: "remote_hist_1",
                status: "completed",
                voice_id: "ZaZosYpkIGmSqOwAlfnk",
                model_id: "eleven_v4",
                text: "[calm] Remote AI clip",
                metadata: { voice_name: "Seff Echo", language_code: "en" },
                result: { audio_url: "https://cdn.example/remote.mp3" },
              },
            ],
            has_more: false,
          });
        }
        if (u.includes("/v1/voice-changer/history?"))
          return jsonRes({ tasks: [], has_more: false });
        if (u.endsWith("/history/remote_hist_1")) {
          historyFetchCount++;
          await new Promise((r) => setTimeout(r, 15));
          return jsonRes({
            id: "remote_hist_1",
            status: "completed",
            voice_id: "ZaZosYpkIGmSqOwAlfnk",
            model_id: "eleven_v4",
            text: "[calm] Remote AI clip",
            metadata: {
              voice_name: "Seff Echo",
              language_code: "en",
              previous_text: "Prev remote.",
              next_text: "Next remote.",
              seed: 9191,
              output_format: "mp3_44100_128",
              apply_text_normalization: "on",
            },
            result: { audio_url: "https://cdn.example/remote.mp3" },
          });
        }
        if (u.endsWith(".mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        return jsonRes({}, 404);
      },
    });

    const sttForm = new FormData();
    sttForm.set("file", new File([mp3], "take.mp3", { type: "audio/mpeg" }));
    sttForm.set("languageCode", "en");
    sttForm.set("diarize", "true");
    sttForm.set("diarizationThreshold", "1.2");
    sttForm.set("keyterms", JSON.stringify(["Gohans", "Redstone"]));
    sttForm.set("additionalFormats", JSON.stringify(["srt"]));
    const sttRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: sttForm,
    });
    expect(sttRes.status).toBe(200);
    const sttBody = await sttRes.json();
    expect(sttBody.sttResult.text).toBe("Hello Alex.");
    expect(sttBody.sttResult.srtText).toContain("Hello");
    expect(lastSttForm.get("diarization_threshold")).toBe("1.2");
    expect(lastSttForm.getAll("keyterms")).toEqual(["Gohans", "Redstone"]);
    expect(lastSttForm.getAll("additional_formats")).toEqual(["srt"]);

    const hist = await (await api.request("/api/voice/playground/remote-history")).json();
    expect(hist.items.some((x) => x.id === "remote_hist_1")).toBe(true);

    const [r1, r2] = await Promise.all([
      api.request("/api/voice/playground/remote-history/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: "remote_hist_1" }),
      }),
      api.request("/api/voice/playground/remote-history/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: "remote_hist_1" }),
      }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(historyFetchCount).toBe(1);
    const { items } = await (await api.request("/api/voice/playground/items")).json();
    const importedRemote = items.filter((x) => x.remoteTaskId === "remote_hist_1");
    expect(importedRemote.length).toBe(1);
    expect(importedRemote[0].seed).toBe(9191);
    expect(importedRemote[0].previousText).toBe("Prev remote.");
    expect(importedRemote[0].nextText).toBe("Next remote.");
    expect(importedRemote[0].outputFormat).toBe("mp3_44100_128");
    expect(importedRemote[0].applyTextNormalization).toBe("on");

    const badHistPage = await api.request("/api/voice/playground/remote-history?page=NaN");
    expect(badHistPage.status).toBe(400);

    const badPath = await api.request("/api/voice/playground/audio/..%2F..%2Fedit.json");
    expect(badPath.status).toBe(404);
  });

  test("enforces per-route >20MB limits, clean 400/404/413 JSON errors, catalog resilience, PCM WAV, and safe promote", async () => {
    const mp3 = makeMinimalMp3();
    let modelFail = true;
    const sttFormSeen = [];
    const vcFormCount = { n: 0 };

    const { api, playgroundDir, voicePlayground, dir } = makeHarness({
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.endsWith("/minimax/voices/clone"))
          return jsonRes({ id: "clone_large", status: "processing" });
        if (u.endsWith("/models")) {
          if (modelFail) return jsonRes({ detail: "temporary upstream error" }, 503);
          return jsonRes([
            { model_id: "eleven_v3", name: "Eleven v3", can_do_text_to_speech: true },
          ]);
        }
        if (u.endsWith("/languages")) return jsonRes([{ code: "en", name: "English" }]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.includes("/text-to-speech/")) {
          return jsonRes({ id: "task_pcm_1", status: "pending" }, 202);
        }
        if (u.endsWith("/history/task_pcm_1")) {
          return jsonRes({
            id: "task_pcm_1",
            status: "completed",
            result: { audio_url: "https://cdn.example/task_pcm_1.bin" },
          });
        }
        if (u.endsWith("/task_pcm_1.bin")) {
          return new Response(new Uint8Array(320), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          });
        }
        if (u.endsWith("/voice-changer")) {
          vcFormCount.n++;
          return jsonRes({ error: "rejected" }, 400);
        }
        if (u.endsWith("/speech-to-text")) {
          sttFormSeen.push(init.body);
          return jsonRes({ task_id: "task_stt_auto", status: "pending" }, 202);
        }
        if (u.endsWith("/speech-to-text/task_stt_auto")) {
          return jsonRes({
            id: "task_stt_auto",
            status: "completed",
            result: { text: "Auto lang.", language_code: "vi", words: [] },
          });
        }
        if (u.includes("/v1/history?")) {
          return jsonRes({ tasks: [], has_more: false });
        }
        if (u.includes("/v1/voice-changer/history?")) {
          return jsonRes({
            tasks: [
              {
                id: "remote_vc_only",
                status: "completed",
                voice_id: "v1",
                model_id: "eleven_multilingual_sts_v2",
                text: "VC clip",
              },
            ],
            has_more: true,
          });
        }
        if (u.endsWith("/voice-changer/history/remote_vc_only")) {
          return jsonRes({
            id: "remote_vc_only",
            status: "completed",
            voice_id: "v1",
            model_id: "eleven_multilingual_sts_v2",
            metadata: { source_label: "mic.wav", remove_background_noise: true },
            result: { audio_url: "https://cdn.example/remote_vc.mp3" },
          });
        }
        if (u.endsWith("/remote_vc.mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        return jsonRes({}, 404);
      },
    });

    const badTts = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "missing voiceId" }),
    });
    expect(badTts.status).toBe(400);
    expect(typeof (await badTts.json()).error).toBe("string");

    const missingPatch = await api.request("/api/voice/playground/items/missing_id", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: true }),
    });
    expect(missingPatch.status).toBe(404);
    expect((await missingPatch.json()).error).toBe("Playground item not found");

    const badKeyRes = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "gv_bad\nkey" }),
    });
    expect(badKeyRes.status).toBe(400);

    const firstCatalog = await (await api.request("/api/voice/playground/catalog")).json();
    expect(firstCatalog.error).toBeTruthy();
    modelFail = false;
    const secondCatalog = await (await api.request("/api/voice/playground/catalog")).json();
    expect(secondCatalog.liveSynced).toBe(true);
    const v3 = secondCatalog.models.find((m) => m.model_id === "eleven_v3");
    expect(v3.supports_context).toBe(false);
    expect(v3.supports_speed).toBe(true);
    expect(v3.supports_similarity).toBe(false);
    expect(v3.stability_values).toEqual([0, 0.5, 1]);

    const bigVcForm = new FormData();
    bigVcForm.set(
      "audio",
      new File([Buffer.alloc(21 * 1024 * 1024)], "big.wav", { type: "audio/wav" }),
    );
    bigVcForm.set("voiceId", "v1");
    const bigVcRes = await api.request("/api/voice/playground/voice-changer", {
      method: "POST",
      body: bigVcForm,
    });
    expect(bigVcRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(vcFormCount.n).toBe(1);
    const sourcesPath = join(playgroundDir, "sources");
    expect(readdirSync(sourcesPath)).toEqual([]);

    const largeSample = new File(
      [wrapPcm16ToWav(Buffer.alloc(21 * 1024 * 1024), 192000)],
      "sample.wav",
      { type: "audio/wav" },
    );
    const cloneForm = new FormData();
    cloneForm.set("file", largeSample);
    cloneForm.set(
      "settings",
      JSON.stringify({ name: "My voice", language: "English", permissionConfirmed: true }),
    );
    const cloneResponse = await api.request("/api/voice/playground/clones", {
      method: "POST",
      body: cloneForm,
    });
    expect(cloneResponse.status).toBe(202);
    expect((await cloneResponse.json()).clone.remoteId).toBe("clone_large");
    const largeSttForm = new FormData();
    largeSttForm.set("file", largeSample);
    largeSttForm.set("languageCode", "vi");
    const largeSttResponse = await api.request("/api/voice/playground/stt/jobs", {
      method: "POST",
      body: largeSttForm,
    });
    expect(largeSttResponse.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(
      voicePlayground.listJobs().some((job) => job.kind === "stt" && job.status === "completed"),
    ).toBe(true);
    sttFormSeen.length = 0;

    const bigTtsRes = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(21 * 1024 * 1024, 32),
    });
    expect(bigTtsRes.status).toBe(413);
    expect((await bigTtsRes.json()).error).toContain("20 MB");

    await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v1", text: "PCM take", outputFormat: "pcm_24000" }),
    });
    await voicePlayground.waitForAllJobs();
    const pcmItem = voicePlayground.listItems().find((x) => x.outputFormat === "pcm_24000");
    expect(pcmItem.audioFile).toMatch(/\.wav$/);
    expect(pcmItem.mimeType).toBe("audio/wav");

    const autoSttForm = new FormData();
    autoSttForm.set("file", new File([mp3], "clip.mp3", { type: "audio/mpeg" }));
    autoSttForm.set("languageCode", "auto");
    const autoRejectRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: autoSttForm,
    });
    expect(autoRejectRes.status).toBe(400);
    expect((await autoRejectRes.json()).error).toContain("auto");

    const explicitSttForm = new FormData();
    explicitSttForm.set("file", new File([mp3], "clip.mp3", { type: "audio/mpeg" }));
    explicitSttForm.set("languageCode", "vi");
    explicitSttForm.set("diarize", "true");
    explicitSttForm.set("numSpeakers", "2");
    explicitSttForm.set("diarizationThreshold", "0.3");
    expect(
      (await api.request("/api/voice/playground/stt", { method: "POST", body: explicitSttForm }))
        .status,
    ).toBe(200);
    expect(sttFormSeen[0].get("language_code")).toBe("vi");
    expect(sttFormSeen[0].get("num_speakers")).toBe("2");
    expect(sttFormSeen[0].get("diarization_threshold")).toBeNull();

    const rh = await (await api.request("/api/voice/playground/remote-history")).json();
    expect(rh.hasMore).toBe(true);
    const impVc = await api.request("/api/voice/playground/remote-history/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "remote_vc_only", kind: "voice_changer" }),
    });
    const impItem = (await impVc.json()).item;
    expect(impItem.voiceChanger?.sourceLabel).toBe("mic.wav");
    expect(impItem.voiceChanger?.remove_background_noise).toBe(true);

    await expect(
      voicePlayground.startDialogue({
        text: "[__proto__]: Hack",
        speakers: JSON.parse('{"__proto__":{"voice_id":"v1"}}'),
      }),
    ).rejects.toThrow(/speaker/i);

    writeFileSync(join(playgroundDir, "audio", "pg_bad_ogg.ogg"), Buffer.from("not-valid-ogg"));
    const curStore = JSON.parse(await Bun.file(join(playgroundDir, "items.json")).text());
    curStore.items.unshift({
      ...pcmItem,
      id: "pg_bad_ogg",
      audioFile: "pg_bad_ogg.ogg",
      mimeType: "audio/ogg",
    });
    writeFileSync(join(playgroundDir, "items.json"), JSON.stringify(curStore, null, 2));
    const promoOgg = await api.request("/api/voice/playground/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "pg_bad_ogg", takeId: "01" }),
    });
    expect(promoOgg.status).toBe(422);
    expect(readdirSync(join(dir, "voice", "try")).some((f) => f.includes("pg_bad_ogg.mp3"))).toBe(
      false,
    );
  });

  test("TTS falls back cleanly on 400/422 advanced params, derives languageCode, STT reports detail_error, and remoteHistory warns on VC error", async () => {
    const mp3 = makeMinimalMp3();
    const ttsPayloads = [];

    const { api, voicePlayground } = makeHarness({
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.endsWith("/models")) return jsonRes([]);
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.includes("/text-to-speech/")) {
          const parsed = JSON.parse(String(init.body));
          ttsPayloads.push(parsed);
          if (parsed.seed != null) {
            return jsonRes({ detail: "Unsupported advanced parameters" }, 422);
          }
          return jsonRes({ id: "task_tts_fallback", status: "pending" }, 202);
        }
        if (u.endsWith("/history/task_tts_fallback")) {
          return jsonRes({
            id: "task_tts_fallback",
            status: "completed",
            result: { audio_url: "https://cdn.example/fb.mp3" },
          });
        }
        if (u.endsWith("/fb.mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        if (u.endsWith("/speech-to-text")) {
          return jsonRes({ task_id: "task_stt_err", status: "pending" }, 202);
        }
        if (u.endsWith("/speech-to-text/task_stt_err")) {
          return jsonRes({
            id: "task_stt_err",
            status: "failed",
            detail_error: "Corrupt audio header",
          });
        }
        if (u.includes("/v1/history?")) {
          return jsonRes({ tasks: [], has_more: false });
        }
        if (u.includes("/v1/voice-changer/history?")) {
          return jsonRes({ detail: "VC history temporary outage" }, 502);
        }
        return jsonRes({}, 404);
      },
    });

    const ttsRes = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voiceId: "v1",
        modelId: "eleven_v4",
        languageCode: "",
        text: "[calm] Xin chào thế giới hôm nay!",
        previousText: "Câu trước",
        seed: 777,
        outputFormat: "mp3_44100_192",
        applyTextNormalization: "on",
      }),
    });
    expect(ttsRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(ttsPayloads.length).toBe(2);
    expect(ttsPayloads[0].language_code).toBe("vi");
    expect(ttsPayloads[0].seed).toBe(777);
    expect(ttsPayloads[1].seed).toBeUndefined();
    expect(ttsPayloads[1].previous_text).toBeUndefined();
    expect(ttsPayloads[1].output_format).toBeUndefined();

    const savedTts = voicePlayground.listItems()[0];
    expect(savedTts.languageCode).toBe("vi");
    expect(savedTts.seed).toBeUndefined();
    expect(savedTts.previousText).toBeUndefined();
    expect(savedTts.fallbackNote).toContain("base settings");

    const sttForm = new FormData();
    sttForm.set("file", new File([mp3], "bad.mp3", { type: "audio/mpeg" }));
    sttForm.set("languageCode", "en");
    const sttFail = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: sttForm,
    });
    expect(sttFail.status).toBe(400);
    expect((await sttFail.json()).error).toContain("Corrupt audio header");

    const rhRes = await api.request("/api/voice/playground/remote-history");
    expect(rhRes.status).toBe(200);
    const rh = await rhRes.json();
    expect(rh.warning).toContain("VC history temporary outage");
  });

  test("STT multipart repeated fields/empty formats, SSRF & key-exfil config guards, and GenVoice schema alignment", async () => {
    const mp3 = makeMinimalMp3();
    const seenSharedUrls = [];
    const seenSttForms = [];
    const seenConfigUrls = [];
    let nextIp = "93.184.216.34";

    const { api, voicePlayground } = makeHarness({
      lookup: async () => [{ address: nextIp, family: 4 }],
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.includes("/auth/me")) {
          seenConfigUrls.push(u);
          return jsonRes({ id: "u", email: "ok@gohans.test", name: "Ok", credit_balance: 500 });
        }
        if (u.endsWith("/models")) return jsonRes([]);
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) {
          return jsonRes({
            voices: [
              {
                voice_id: "def_flat_1",
                name: "Flat Voice",
                category: "premade",
                gender: "female",
                age: "young",
                accent: "american",
                language: "en",
                use_case: "narration",
                descriptive: "warm",
                preview_url: "https://cdn.example/def.mp3",
              },
            ],
          });
        }
        if (u.includes("/v1/shared-voices?")) {
          seenSharedUrls.push(u);
          return jsonRes({ voices: [], has_more: false });
        }
        if (u.endsWith("/v1/dialogue")) {
          return jsonRes({ task_id: "dlg_trim_1", status: "pending" }, 202);
        }
        if (u.endsWith("/v1/history/dlg_trim_1")) {
          return jsonRes({
            id: "dlg_trim_1",
            status: "completed",
            result: { audio_url: "https://cdn.example/dlg_trim.mp3" },
          });
        }
        if (u.endsWith("/v1/speech-to-text")) {
          seenSttForms.push(init.body);
          return jsonRes({ task_id: `stt_ok_${seenSttForms.length}`, status: "pending" }, 202);
        }
        if (u.includes("/v1/speech-to-text/stt_ok_")) {
          return jsonRes({
            id: u.split("/").pop(),
            status: "completed",
            result: { text: "Transcribed", srt: "" },
          });
        }
        if (
          u.includes("/v1/history?") ||
          u.includes("/v1/text-to-dialogue/history?") ||
          u.includes("/v1/sound-generation/history?") ||
          u.includes("/v1/speech-to-text/history?")
        ) {
          return jsonRes({ tasks: [] });
        }
        if (u.endsWith("/v1/voice-changer/history/vc_hist_1")) {
          return jsonRes({
            id: "vc_hist_1",
            status: "completed",
            type: "voice_changer",
            created_at: "2026-11-16T00:00:00Z",
            metadata: { voice_id: "v1", voice_name: "Aria", remove_noise: true },
            result: { audio_url: "https://cdn.example/vc.mp3" },
          });
        }
        if (u.includes("/v1/voice-changer/history?")) {
          return jsonRes({
            tasks: [
              {
                id: "vc_hist_1",
                status: "completed",
                type: "voice_changer",
                created_at: "2026-11-16T00:00:00Z",
                metadata: { voice_id: "v1", voice_name: "Aria", remove_noise: true },
                result: { audio_url: "https://cdn.example/vc.mp3" },
              },
            ],
          });
        }
        if (u.endsWith("/vc.mp3") || u.endsWith("/dlg_trim.mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        throw new Error(`Unexpected upstream URL: ${u}`);
      },
    });

    const privateBase = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiBase: "https://169.254.169.254/v1", apiKey: "gv_custom_1" }),
    });
    expect(privateBase.status).toBe(400);

    nextIp = "10.0.0.5";
    const reboundBase = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiBase: "https://rebound.example/v1", apiKey: "gv_custom_1" }),
    });
    expect(reboundBase.status).toBe(400);
    nextIp = "93.184.216.34";

    const exfilAttempt = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiBase: "https://evil-proxy.example/v1" }),
    });
    expect(exfilAttempt.status).toBe(400);
    expect(seenConfigUrls.length).toBe(0);

    const loopbackAllowed = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiBase: "http://127.0.0.1:8787/v1", apiKey: "gv_local_1" }),
    });
    expect(loopbackAllowed.status).toBe(200);
    const dropKeyWithCustomBase = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "" }),
    });
    expect(dropKeyWithCustomBase.status).toBe(400);
    await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearOverride: true }),
    });

    const catRes = await api.request("/api/voice/playground/catalog");
    expect(catRes.status).toBe(200);
    const cat = await catRes.json();
    expect(cat.defaultVoices[0].gender).toBe("female");
    expect(cat.defaultVoices[0].accent).toBe("american");
    expect(cat.defaultVoices[0].language).toBe("en");
    expect(cat.defaultVoices[0].useCase).toBe("narration");
    expect(cat.defaultVoices[0].descriptive).toBe("warm");

    const sharedRes = await api.request(
      "/api/voice/playground/shared-voices?language=vi&sort=cloned_by_count",
    );
    expect(sharedRes.status).toBe(200);
    expect(seenSharedUrls[0]).toContain("required_languages=vi");
    expect(seenSharedUrls[0]).toContain("sort=cloned_by_count");
    expect(seenSharedUrls[0]).not.toMatch(/[?&]language=/);

    const sttRepeated = new FormData();
    sttRepeated.set("file", new File([mp3], "clip.mp3", { type: "audio/mpeg" }));
    sttRepeated.set("languageCode", "en");
    sttRepeated.append("keyterms", "Gohans");
    sttRepeated.append("keyterms", "Antigravity");
    sttRepeated.append("additionalFormats", "txt");
    sttRepeated.append("additionalFormats", "srt");
    const sttRepRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: sttRepeated,
    });
    expect(sttRepRes.status).toBe(200);
    expect(seenSttForms[0].getAll("keyterms")).toEqual(["Gohans", "Antigravity"]);
    expect(seenSttForms[0].getAll("additional_formats")).toEqual(["txt", "srt"]);

    const sttEmptyFmt = new FormData();
    sttEmptyFmt.set("file", new File([mp3], "clip.mp3", { type: "audio/mpeg" }));
    sttEmptyFmt.set("languageCode", "en");
    sttEmptyFmt.set("additionalFormats", "[]");
    const sttEmptyRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: sttEmptyFmt,
    });
    expect(sttEmptyRes.status).toBe(200);
    expect(seenSttForms[1].getAll("additional_formats")).toEqual([]);

    const sttDefaultFmt = new FormData();
    sttDefaultFmt.set("file", new File([mp3], "clip.mp3", { type: "audio/mpeg" }));
    sttDefaultFmt.set("languageCode", "en");
    const sttDefRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: sttDefaultFmt,
    });
    expect(sttDefRes.status).toBe(200);
    expect(seenSttForms[2].getAll("additional_formats")).toEqual(["srt"]);

    const sttBadJson = new FormData();
    sttBadJson.set("file", new File([mp3], "clip.mp3", { type: "audio/mpeg" }));
    sttBadJson.set("additionalFormats", "[bad");
    const sttBadRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: sttBadJson,
    });
    expect(sttBadRes.status).toBe(400);

    const rhRes = await api.request("/api/voice/playground/remote-history");
    expect(rhRes.status).toBe(200);
    const rhBody = await rhRes.json();
    const rhVc = rhBody.items.find((x) => x.id === "vc_hist_1" && x.kind === "voice_changer");
    expect(rhVc?.voiceId).toBe("v1");
    expect(rhVc?.voiceName).toBe("Aria");
    const importVcRes = await api.request("/api/voice/playground/remote-history/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "vc_hist_1", kind: "voice_changer" }),
    });
    expect(importVcRes.status).toBe(200);
    const { item: vcItem } = await importVcRes.json();
    expect(vcItem?.voiceId).toBe("v1");
    expect(vcItem?.voiceName).toBe("Aria");
    expect(vcItem?.voiceChanger?.remove_background_noise).toBe(true);

    const dlgRes = await api.request("/api/voice/playground/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Alice: Hello there\nBob: General Kenobi",
        speakers: {
          " Alice ": { voice_id: "v1", voice_name: "Alice" },
          "Bob ": { voice_id: "v2", voice_name: "Bob" },
        },
      }),
    });
    expect(dlgRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    const dlgItem = voicePlayground.listItems().find((x) => x.remoteTaskId === "dlg_trim_1");
    expect(dlgItem?.kind).toBe("dialogue");
    expect(Object.keys(dlgItem?.dialogue?.speakers ?? {})).toEqual(["Alice", "Bob"]);
  });

  test("Round 5 hardening: smart PCM check, malformed speaker sanitization, VC speed/seed fallback, and Scribe v2 constraints", async () => {
    const mp3 = makeMinimalMp3();
    const oggBytes = Buffer.from("OggS\x00\x02");
    const rawPcmBytes = Buffer.alloc(128, 0x05);
    expect(isRawHeaderlessPcm(mp3, "https://cdn.example/x.mp3", "audio/mpeg")).toBe(false);
    expect(
      isRawHeaderlessPcm(
        Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2]),
        "https://cdn.example/blob",
        "application/octet-stream",
      ),
    ).toBe(false);
    expect(isRawHeaderlessPcm(oggBytes, "https://cdn.example/blob", "")).toBe(false);
    expect(
      isRawHeaderlessPcm(rawPcmBytes, "https://cdn.example/raw.pcm", "application/octet-stream"),
    ).toBe(true);

    const vcPayloads = [];
    const sttPayloads = [];
    let ttsCount = 0;

    const { api, voicePlayground } = makeHarness({
      apiKey: "gv_r5_test",
      fetchImpl: async (url, init = {}) => {
        const u = String(url);
        if (u.endsWith("/models")) {
          return jsonRes([
            {
              model_id: "eleven_multilingual_sts_v2",
              name: "STS v2",
              can_do_voice_conversion: true,
              supports_speed: true,
              can_use_style: true,
              can_use_speaker_boost: true,
              model_rates: { character_cost_multiplier: 1 },
            },
          ]);
        }
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.includes("/text-to-speech/")) {
          ttsCount += 1;
          return jsonRes({ task_id: `pcm_test_${ttsCount}`, status: "pending" }, 202);
        }
        if (u.endsWith("/history/pcm_test_1")) {
          return jsonRes({
            id: "pcm_test_1",
            status: "completed",
            result: { audio_url: "https://cdn.example/ignored_pcm.mp3" },
          });
        }
        if (u.endsWith("/history/pcm_test_2")) {
          return jsonRes({
            id: "pcm_test_2",
            status: "completed",
            result: { audio_url: "https://cdn.example/actual.pcm" },
          });
        }
        if (u.endsWith("/ignored_pcm.mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        if (u.endsWith("/actual.pcm")) {
          return new Response(rawPcmBytes, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          });
        }
        if (u.endsWith("/history/bad_speakers")) {
          return jsonRes({
            id: "bad_speakers",
            status: "completed",
            text: "Corrupt speakers payload",
            metadata: {
              voice_settings: [0.5],
              speakers: {
                __proto__: { voice_id: "evil" },
                NullEntry: null,
                MissingVoice: { voice_name: "Nobody" },
              },
            },
            result: { audio_url: "https://cdn.example/vc.mp3" },
          });
        }
        if (u.endsWith("/vc.mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        if (u.endsWith("/v1/voice-changer")) {
          vcPayloads.push(init.body);
          if (init.body.get("seed")) {
            return jsonRes({ detail: "Unsupported seed field" }, 422);
          }
          return jsonRes({ task_id: "vc_fallback_1", status: "pending" }, 202);
        }
        if (u.endsWith("/v1/voice-changer/history/vc_fallback_1")) {
          return jsonRes({
            id: "vc_fallback_1",
            status: "completed",
            result: { audio_url: "https://cdn.example/vc.mp3" },
          });
        }
        if (u.endsWith("/v1/speech-to-text")) {
          sttPayloads.push(init.body);
          return jsonRes({ task_id: "stt_adv_1", status: "pending" }, 202);
        }
        if (u.endsWith("/v1/speech-to-text/stt_adv_1")) {
          return jsonRes({
            id: "stt_adv_1",
            status: "completed",
            language_code: "en",
            result: {
              text: "Clean audio",
              language_code: "en",
              language_probability: 0.9746,
              entities: [{ text: "Clean", entity_type: "name", start_char: 0, end_char: 5 }],
              words: [
                { text: "Clean", start: 0.0, end: 0.3, type: "word", speaker_id: "speaker_0" },
                { text: " ", start: 0.3, end: 0.35, type: "spacing", speaker_id: "speaker_0" },
                { text: "audio", start: 0.35, end: 0.8, type: "word", speaker_id: "speaker_0" },
              ],
              additional_formats: [{ file_extension: "txt", content: "Clean audio" }],
            },
          });
        }
        throw new Error(`Unexpected upstream URL: ${u}`);
      },
    });

    await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voiceId: "v1",
        text: "MP3 fallback test",
        outputFormat: "pcm_44100",
      }),
    });
    await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        voiceId: "v1",
        text: "Raw PCM test",
        outputFormat: "pcm_44100",
      }),
    });
    await voicePlayground.waitForAllJobs();
    const mp3Clip = voicePlayground.listItems().find((x) => x.remoteTaskId === "pcm_test_1");
    const wavClip = voicePlayground.listItems().find((x) => x.remoteTaskId === "pcm_test_2");
    expect(mp3Clip?.audioFile?.endsWith(".mp3")).toBe(true);
    const mp3Bytes = new Uint8Array(
      await (await api.request(`/api/voice/playground/audio/${mp3Clip?.audioFile}`)).arrayBuffer(),
    );
    expect(Buffer.from(mp3Bytes.subarray(0, 4)).toString("ascii")).not.toBe("RIFF");
    expect(wavClip?.audioFile?.endsWith(".wav")).toBe(true);
    const wavBytes = new Uint8Array(
      await (await api.request(`/api/voice/playground/audio/${wavClip?.audioFile}`)).arrayBuffer(),
    );
    expect(Buffer.from(wavBytes.subarray(0, 4)).toString("ascii")).toBe("RIFF");

    const badImportRes = await api.request("/api/voice/playground/remote-history/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "bad_speakers", kind: "tts" }),
    });
    expect(badImportRes.status).toBe(200);
    const { item: safeImported } = await badImportRes.json();
    expect(safeImported.kind).toBe("tts");
    expect(safeImported.dialogue).toBeUndefined();
    expect(safeImported.voiceSettings).toEqual({});

    const vcForm = new FormData();
    vcForm.set("audio", new File([mp3], "raw.mp3", { type: "audio/mpeg" }));
    vcForm.set("voiceId", "v1");
    vcForm.set("modelId", "eleven_multilingual_sts_v2");
    vcForm.set("voiceSettings", JSON.stringify({ stability: 0.5, speed: 1.15 }));
    vcForm.set("seed", "99");
    const vcRes = await api.request("/api/voice/playground/voice-changer", {
      method: "POST",
      body: vcForm,
    });
    expect(vcRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(vcPayloads.length).toBe(2);
    expect(vcPayloads[0].get("seed")).toBe("99");
    expect(vcPayloads[1].get("seed")).toBeNull();
    expect(JSON.parse(String(vcPayloads[0].get("voice_settings"))).speed).toBeUndefined();
    const vcFallbackItem = voicePlayground
      .listItems()
      .find((x) => x.remoteTaskId === "vc_fallback_1");
    expect(vcFallbackItem?.seed).toBeUndefined();
    expect(vcFallbackItem?.fallbackNote).toContain("seed");

    const badSeedForm = new FormData();
    badSeedForm.set("file", new File([mp3], "a.mp3", { type: "audio/mpeg" }));
    badSeedForm.set("languageCode", "en");
    badSeedForm.set("seed", "2147483648");
    expect(
      (await api.request("/api/voice/playground/stt", { method: "POST", body: badSeedForm }))
        .status,
    ).toBe(400);

    const conflictForm = new FormData();
    conflictForm.set("file", new File([mp3], "a.mp3", { type: "audio/mpeg" }));
    conflictForm.set("languageCode", "en");
    conflictForm.set("diarize", "true");
    conflictForm.set("useMultiChannel", "true");
    expect(
      (await api.request("/api/voice/playground/stt", { method: "POST", body: conflictForm }))
        .status,
    ).toBe(400);

    const badRedactForm = new FormData();
    badRedactForm.set("file", new File([mp3], "a.mp3", { type: "audio/mpeg" }));
    badRedactForm.set("languageCode", "en");
    badRedactForm.append("entityDetection", "pii");
    badRedactForm.append("entityRedaction", "phi");
    expect(
      (await api.request("/api/voice/playground/stt", { method: "POST", body: badRedactForm }))
        .status,
    ).toBe(400);

    const goodSttForm = new FormData();
    goodSttForm.set("file", new File([mp3], "a.mp3", { type: "audio/mpeg" }));
    goodSttForm.set("languageCode", "en");
    goodSttForm.set("seed", "2147483647");
    goodSttForm.set("fileFormat", "pcm_s16le_16");
    goodSttForm.set("diarize", "false");
    goodSttForm.set("useMultiChannel", "true");
    goodSttForm.append("entityDetection", "pii");
    goodSttForm.append("entityDetection", "phi");
    goodSttForm.append("entityRedaction", "pii");
    goodSttForm.set("entityRedactionMode", "entity_type");
    const goodSttRes = await api.request("/api/voice/playground/stt", {
      method: "POST",
      body: goodSttForm,
    });
    expect(goodSttRes.status).toBe(200);
    const goodSttBody = await goodSttRes.json();
    expect(goodSttBody.sttResult?.language_probability).toBeCloseTo(0.9746, 4);
    expect(goodSttBody.sttResult?.entities).toEqual([
      { text: "Clean", entity_type: "name", start_char: 0, end_char: 5 },
    ]);
    expect(goodSttBody.sttResult?.additional_formats).toEqual([
      { file_extension: "txt", content: "Clean audio" },
    ]);
    expect(sttPayloads[0].get("seed")).toBe("2147483647");
    expect(sttPayloads[0].get("file_format")).toBe("pcm_s16le_16");
    expect(sttPayloads[0].get("use_multi_channel")).toBe("true");
    expect(sttPayloads[0].getAll("entity_detection")).toEqual(["pii", "phi"]);
    expect(sttPayloads[0].getAll("entity_redaction")).toEqual(["pii"]);
    expect(sttPayloads[0].get("entity_redaction_mode")).toBe("entity_type");
  });

  test("Round 6: remote ID path traversal, dialogue export_transcript fallback, remote PCM WAV import, and VC retry source preservation", async () => {
    const mp3 = makeMinimalMp3();
    const rawPcm = Buffer.alloc(128, 0x07);
    const dialogueBodies = [];
    let vcCallCount = 0;
    let releaseRetryPoll = null;
    const retryPollBarrier = new Promise((r) => {
      releaseRetryPoll = r;
    });
    let retryPollHitResolve = null;
    const retryPollReached = new Promise((r) => {
      retryPollHitResolve = r;
    });

    const { api, playgroundDir, voicePlayground } = makeHarness({
      apiKey: "gv_r6_test",
      pollIntervalMs: 5,
      fetchImpl: async (url, init = {}) => {
        const u = String(url);
        if (u.endsWith("/models")) {
          return jsonRes([
            {
              model_id: "eleven_v4",
              name: "Eleven v4",
              can_do_text_to_speech: true,
              can_do_voice_conversion: false,
            },
            {
              model_id: "eleven_multilingual_sts_v2",
              name: "STS v2",
              can_do_text_to_speech: false,
              can_do_voice_conversion: true,
            },
          ]);
        }
        if (u.endsWith("/languages")) return jsonRes([]);
        if (u.includes("/default-voices")) return jsonRes({ voices: [], has_more: false });
        if (u.endsWith("/v1/dialogue")) {
          const parsed = JSON.parse(String(init.body));
          dialogueBodies.push(parsed);
          if (parsed.export_transcript) {
            return jsonRes({ detail: "Unsupported export_transcript on dialogue" }, 422);
          }
          return jsonRes({ id: "dlg_fb_1", status: "pending" }, 202);
        }
        if (u.endsWith("/v1/history/dlg_fb_1")) {
          return jsonRes({
            id: "dlg_fb_1",
            status: "completed",
            result: { audio_url: "https://cdn.example/vc.mp3" },
          });
        }
        if (u.endsWith("/v1/history/remote_pcm_1")) {
          return jsonRes({
            id: "remote_pcm_1",
            status: "completed",
            text: "Remote PCM",
            metadata: { voice_id: "v_pcm", voice_name: "PCM Voice", output_format: "pcm_24000" },
            result: { audio_url: "https://cdn.example/raw.pcm" },
          });
        }
        if (u.endsWith("/raw.pcm")) {
          return new Response(rawPcm, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          });
        }
        if (u.endsWith("/vc.mp3")) {
          return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
        }
        if (u.endsWith("/v1/voice-changer")) {
          vcCallCount += 1;
          return jsonRes({ task_id: `vc_race_${vcCallCount}`, status: "pending" }, 202);
        }
        if (u.endsWith("/v1/voice-changer/history/vc_race_1")) {
          return jsonRes({
            id: "vc_race_1",
            status: "completed",
            result: { audio_url: "https://cdn.example/vc.mp3" },
          });
        }
        if (u.endsWith("/v1/voice-changer/history/vc_race_2")) {
          retryPollHitResolve?.();
          await retryPollBarrier;
          return jsonRes({
            id: "vc_race_2",
            status: "completed",
            result: { audio_url: "https://cdn.example/vc.mp3" },
          });
        }
        throw new Error(`Unexpected upstream URL: ${u}`);
      },
    });

    for (const badId of ["..", ".", "foo/bar", "v1?evil=1"]) {
      const badTts = await api.request("/api/voice/playground/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: badId, text: "Hello" }),
      });
      expect(badTts.status).toBe(400);

      const badImp = await api.request("/api/voice/playground/remote-history/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: badId, kind: "tts" }),
      });
      expect(badImp.status).toBe(400);
    }

    const dlgRes = await api.request("/api/voice/playground/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Alice: Hi\nBob: Yo",
        speakers: {
          Alice: { voice_id: "v1", voice_name: "Alice" },
          Bob: { voice_id: "v2", voice_name: "Bob" },
        },
        exportTranscript: true,
      }),
    });
    expect(dlgRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();
    expect(dialogueBodies.length).toBe(2);
    expect(dialogueBodies[0].export_transcript).toBe(true);
    expect(dialogueBodies[1].export_transcript).toBeUndefined();
    const dlgItem = voicePlayground.listItems().find((x) => x.remoteTaskId === "dlg_fb_1");
    expect(dlgItem?.exportTranscript).toBe(false);
    expect(dlgItem?.fallbackNote).toContain("export_transcript");
    const tuned = await voicePlayground.retryItem(dlgItem.id, {
      speakerKey: "Bob",
      voiceSettings: { stability: 0.83 },
    });
    await voicePlayground.waitForJob(tuned.job.id);
    expect(dialogueBodies.at(-1).speakers.Bob.voice_settings.stability).toBe(0.83);
    expect(dialogueBodies.at(-1).speakers.Alice.voice_settings).toEqual(
      dialogueBodies[1].speakers.Alice.voice_settings,
    );

    const pcmRes = await api.request("/api/voice/playground/remote-history/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "remote_pcm_1", kind: "tts" }),
    });
    expect(pcmRes.status).toBe(200);
    const { item: pcmItem } = await pcmRes.json();
    expect(pcmItem?.voiceId).toBe("v_pcm");
    expect(pcmItem?.audioFile?.endsWith(".wav")).toBe(true);
    const wavHeader = readFileSync(join(playgroundDir, "audio", pcmItem.audioFile)).subarray(0, 4);
    expect(wavHeader.toString("ascii")).toBe("RIFF");

    const vcForm = new FormData();
    vcForm.set("audio", new File([mp3], "source.mp3", { type: "audio/mpeg" }));
    vcForm.set("voiceId", "v1");
    vcForm.set("voiceSettings", JSON.stringify({ stability: 0.5 }));
    expect(
      (await api.request("/api/voice/playground/voice-changer", { method: "POST", body: vcForm }))
        .status,
    ).toBe(202);
    await voicePlayground.waitForAllJobs();
    const firstVc = voicePlayground.listItems().find((x) => x.remoteTaskId === "vc_race_1");
    expect(firstVc?.voiceChanger?.sourceFile).toBeTruthy();
    const sourcePath = join(playgroundDir, "sources", firstVc.voiceChanger.sourceFile);
    expect(existsSync(sourcePath)).toBe(true);

    const retryRes = await api.request(
      `/api/voice/playground/items/${encodeURIComponent(firstVc.id)}/retry`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: "v2" }),
      },
    );
    expect(retryRes.status).toBe(202);
    await retryPollReached;
    const delRes = await api.request(
      `/api/voice/playground/items/${encodeURIComponent(firstVc.id)}`,
      { method: "DELETE" },
    );
    expect(delRes.status).toBe(200);
    expect(existsSync(sourcePath)).toBe(true);

    releaseRetryPoll?.();
    await voicePlayground.waitForAllJobs();
    const retriedVc = voicePlayground.listItems().find((x) => x.remoteTaskId === "vc_race_2");
    expect(retriedVc?.voiceChanger?.sourceFile).toBe(firstVc.voiceChanger.sourceFile);
    expect(existsSync(sourcePath)).toBe(true);
  });
});
