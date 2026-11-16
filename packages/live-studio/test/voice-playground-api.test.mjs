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
import {
  assertSafeMediaUrl,
  isNonGlobalIp,
  isRawHeaderlessPcm,
} from "../src/voice-playground-genvoice.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";
import { openVoice } from "../src/voice.mjs";

const tempDirs = [];
const makeDir = (prefix = "vp-api-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const makeMinimalMp3 = () => {
  // Minimal valid MPEG1 Layer3 128kbps 44.1kHz frame (417 bytes) so mp3Seconds returns > 0
  const frame = Buffer.alloc(417, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  return frame;
};

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
    const first = items[0];
    expect(first.tags).toEqual(["excited", "pause"]);
    expect(first.voiceSettings).toEqual({ stability: 0.4, similarity_boost: 0.8 });
    expect(first.seed).toBe(43);
    expect(first.outputFormat).toBe("mp3_44100_192");
    expect(first.srtText).toContain("Hello world");

    const audioRes = await api.request(`/api/voice/playground/audio/${first.audioFile}`, {
      headers: { range: "bytes=0-15" },
    });
    expect(audioRes.status).toBe(206);

    const srtRes = await api.request(`/api/voice/playground/srt/${first.srtFile}`);
    expect(srtRes.status).toBe(200);
    expect(srtRes.headers.get("cache-control")).toBe("no-store");

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

    // Dialogue retry swaps only targeted speakerKey, strips [Name]: brackets, and omits undocumented name
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

    // Retry succeeds using archived sourceFile
    const retryRes = await api.request(`/api/voice/playground/items/${vcItem.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v_other", voiceName: "Other" }),
    });
    expect(retryRes.status).toBe(202);
    await voicePlayground.waitForAllJobs();

    // Deleting first item keeps shared archived source file because retry item still references it
    await api.request(`/api/voice/playground/items/${vcItem.id}`, { method: "DELETE" });
    const retriedVc = voicePlayground.listItems()[0];
    expect(retriedVc.voiceChanger.sourceFile).toBe(vcItem.voiceChanger.sourceFile);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(playgroundDir, "sources", vcItem.voiceChanger.sourceFile))).toBe(true);

    // Retry fails cleanly (400) if legacy VC item has no recorded source reference
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

    // Concurrent imports of the same remote taskId coalesce cleanly to 1 stored item
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
          // Raw signed 16-bit PCM mono samples without RIFF header
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

    // 1. Validation 400 & unknown item 404 always return { error: string }
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

    // 2. Reject invalid ASCII control chars in API key
    const badKeyRes = await api.request("/api/voice/playground/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "gv_bad\nkey" }),
    });
    expect(badKeyRes.status).toBe(400);

    // 3. Catalog does not cache failed live sync and preserves builtin eleven_v3 flags on recovery
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

    // 4. >20 MB Voice Changer upload bypasses global 20MB limit, and cleans up orphaned source file on failure
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

    // Non-VC/STT routes still enforce the default 20 MB limit with JSON 413 error
    const bigTtsRes = await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(21 * 1024 * 1024, 32),
    });
    expect(bigTtsRes.status).toBe(413);
    expect((await bigTtsRes.json()).error).toContain("20 MB");

    // 5. PCM outputFormat wraps raw PCM16 into playable WAV
    await api.request("/api/voice/playground/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: "v1", text: "PCM take", outputFormat: "pcm_24000" }),
    });
    await voicePlayground.waitForAllJobs();
    const pcmItem = voicePlayground.listItems().find((x) => x.outputFormat === "pcm_24000");
    expect(pcmItem.audioFile).toMatch(/\.wav$/);
    expect(pcmItem.mimeType).toBe("audio/wav");

    // 6. STT rejects "auto" (400), accepts explicit languageCode, and suppresses diarization_threshold when numSpeakers is set
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

    // 7. Remote history propagates vc hasMore & voiceChanger metadata
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

    // 8. Dialogue ignores __proto__ key safely
    await expect(
      voicePlayground.startDialogue({
        text: "[__proto__]: Hack",
        speakers: JSON.parse('{"__proto__":{"voice_id":"v1"}}'),
      }),
    ).rejects.toThrow(/speaker/i);

    // 9. Corrupt .ogg archive cannot be promoted blindly as .mp3
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

    // 1. Config SSRF & custom-base key exfiltration guards
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

    // 2. Upstream /v1/default-voices flat fields + /v1/shared-voices required_languages + sort
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

    // 3. STT multipart repeated keyterms & additionalFormats, explicit "[]", omitted default, bad JSON
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

    // 4. Voice Changer remote history remove_noise + Dialogue speaker key trimming
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

    // 1. Output format pcm_44100 does not corrupt MP3 response, still wraps genuine raw PCM in RIFF WAV
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

    // 2. importRemoteTask strips malformed/prototype-polluted speaker entries and non-object voice_settings
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

    // 3. Voice Changer excludes speed even on supports_speed catalog entry and retries 422 without seed
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

    // 4. Scribe v2 rejects seed > 2147483647, diarize + useMultiChannel conflict, invalid redaction subset, and forwards new params
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

    // 1. Path-segment ID traversal checks
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

    // 2. /v1/dialogue 422 fallback omitting export_transcript
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

    // 3. Remote import with metadata.output_format=pcm_24000 wraps WAV and reads metadata.voice_id
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

    // 4. Async VC retry vs deleteItem preserves shared source file until retry finishes
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
