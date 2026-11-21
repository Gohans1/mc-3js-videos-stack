import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openFavorites } from "../src/favorites.mjs";
import { runVoicePlaygroundCli } from "../src/voice-playground-cli.mjs";
import { BUILTIN_GENVOICE_MODELS, wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

const roots = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temporary = () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-cli-"));
  roots.push(dir);
  return dir;
};
const run = async (args, options = {}) => {
  const output = [],
    errors = [];
  const isolated = temporary();
  const code = await runVoicePlaygroundCli(args, {
    globalDir: join(isolated, "global"),
    controllerOptions: {
      env: {},
      secretsFile: join(isolated, "none.env"),
      configFile: join(isolated, "config.json"),
    },
    fetchImpl: () => {
      throw new Error("External transport is not allowed in CLI tests");
    },
    out: (message) => output.push(message),
    err: (message) => errors.push(message),
    ...options,
  });
  return { code, output: output.join("\n"), errors: errors.join("\n") };
};

test("CLI reads Audio stars and intersects favorite voices with favorite creators without losing metadata", async () => {
  const dir = temporary();
  const favorites = openFavorites(join(dir, "favorites.json"));
  favorites.set({ kind: "effects", id: "voice:legacy", on: true });
  const options = { globalDir: join(dir, "global"), favorites };
  const invoke = (command, input = {}) =>
    run([...command.split(" "), "--input", JSON.stringify(input)], options);
  expect(JSON.parse((await invoke("favorites voices")).output).voices).toEqual([
    expect.objectContaining({ id: "legacy" }),
  ]);
  const write = await invoke("favorites voices-set", {
    favorite: true,
    voices: [
      { id: "a", name: "Warm A", creatorId: "creator-1", category: "professional" },
      { id: "b", creatorId: "creator-2" },
      { id: "c", creatorId: "creator-1", category: "professional" },
    ],
  });
  expect(write.code).toBe(0);
  expect(favorites.read().effects).toEqual(["voice:legacy", "voice:a", "voice:b", "voice:c"]);
  expect((await invoke("favorites voice", { favorite: true, voice: { id: "a" } })).code).toBe(0);
  expect((await invoke("favorites creator", { id: "creator-1", favorite: true })).code).toBe(0);
  const filtered = await invoke("favorites voices", {
    favoriteCreatorsOnly: true,
    category: "professional",
  });
  const { voices } = JSON.parse(filtered.output);
  expect(voices).toHaveLength(2);
  expect(voices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "a", name: "Warm A", creatorId: "creator-1" }),
      expect.objectContaining({ id: "c", creatorId: "creator-1" }),
    ]),
  );
  expect(
    (
      await invoke("creators save", {
        id: "creator-1",
        name: "Giọng kể",
        description: "My narrator shortlist",
      })
    ).code,
  ).toBe(0);
  expect(
    (await invoke("profiles save", { voice: { id: "a", creatorId: "creator-1" }, rating: 5 })).code,
  ).toBe(0);
  const rated = await invoke("favorites voices", {
    favoriteCreatorsOnly: true,
    minRating: 5,
    maxRating: 5,
    q: "giong ke",
  });
  expect(JSON.parse(rated.output).voices).toEqual([
    expect.objectContaining({ id: "a", creatorName: "Giọng kể", rating: 5 }),
  ]);
  expect((await invoke("favorites creator", { id: "creator-1", favorite: false })).code).toBe(0);
  expect(JSON.parse((await invoke("creators list")).output).creators).toEqual([
    expect.objectContaining({
      id: "creator-1",
      name: "Giọng kể",
      description: "My narrator shortlist",
      favorite: false,
    }),
  ]);
});

test("an Audio star uses the matching voice profile's creator and category when filtering favorites", async () => {
  const dir = temporary();
  const favorites = openFavorites(join(dir, "favorites.json"));
  favorites.set({ kind: "effects", id: "voice:legacy-actor", on: true });
  const invoke = (command, input) =>
    run([...command.split(" "), "--project", dir, "--input", JSON.stringify(input)], {
      globalDir: join(dir, "global"),
      favorites,
    });
  expect(
    (
      await invoke("profiles save", {
        voice: {
          id: "legacy-actor",
          name: "Legacy Actor",
          creatorId: "actor-studio",
          category: "professional",
          language: "en",
        },
        rating: 5,
      })
    ).code,
  ).toBe(0);
  expect((await invoke("favorites creator", { id: "actor-studio", favorite: true })).code).toBe(0);
  const result = await invoke("favorites voices", {
    creatorId: "actor-studio",
    category: "professional",
    favoriteCreatorsOnly: true,
    language: "en",
    minRating: 5,
  });
  expect(JSON.parse(result.output).voices).toEqual([
    expect.objectContaining({
      id: "legacy-actor",
      name: "Legacy Actor",
      creatorId: "actor-studio",
      rating: 5,
    }),
  ]);
});

test.each(["headless", "server"])(
  "%s CLI templates turn a saved Speech recipe into editable settings and archive or restore a selection",
  async (transport) => {
    const dir = temporary();
    const store = join(dir, "voice/playground");
    mkdirSync(store, { recursive: true });
    const requested = {
      connection: "genvoice",
      provider: "elevenlabs",
      voiceId: "actor",
      voiceName: "Narrator",
      creatorId: "owner",
      text: "[hushed] Come in.",
      modelId: "eleven_v4",
      seed: 42,
      exportTranscript: true,
    };
    writeFileSync(
      join(store, "items.json"),
      JSON.stringify({
        items: [
          {
            id: "original",
            title: "Old narrator",
            kind: "tts",
            ...requested,
            generationRecipe: {
              version: 1,
              requested,
              effective: {
                path: "/text-to-speech/actor",
                body: {
                  text: requested.text,
                  model_id: "eleven_v4",
                  provider: "elevenlabs",
                  voice_settings: { stability: 0.37, use_speaker_boost: false },
                  language_code: "en",
                  seed: 0,
                  previous_text: "Before.",
                  next_text: "After.",
                  output_format: "mp3_44100_128",
                  export_transcript: true,
                },
              },
            },
          },
          {
            id: "scene",
            title: "Two roles",
            kind: "dialogue",
            connection: "genvoice",
            text: "Alex: In.\nRiley: Out.",
            exportTranscript: true,
            dialogue: {
              pause_between_turns: 0.7,
              speakers: {
                Alex: {
                  voice_id: "actor",
                  voice_name: "Narrator",
                  model_id: "eleven_v4",
                  language_code: "en",
                  voice_settings: { stability: 0.37, use_speaker_boost: false },
                },
                Riley: {
                  voice_id: "other",
                  model_id: "speech-2.8-hd",
                  provider: "minimax",
                  voice_settings: { pitch: 2, vol: 0.8 },
                },
              },
            },
          },
          {
            id: "changed-voice",
            title: "Converted",
            kind: "voice_changer",
            connection: "genvoice",
            voiceId: "actor",
            modelId: "eleven_multilingual_sts_v2",
            seed: 0,
            voiceSettings: { use_speaker_boost: false },
            voiceChanger: { sourceFile: "src_voice.wav", remove_background_noise: true },
          },
        ],
      }),
    );
    mkdirSync(join(store, "sources"));
    writeFileSync(join(store, "sources/src_voice.wav"), wrapPcm16ToWav(Buffer.alloc(32000), 16000));
    const globalDir = join(dir, "global");
    const { playgroundExtensions } = await import("../src/voice-playground-routes.mjs");
    const server = transport === "server";
    const fetchImpl = async (raw, init) => {
      const controller = openVoicePlayground({
        project: dir,
        globalDir,
        env: {},
        configFile: join(dir, "none.json"),
      });
      try {
        const url = new URL(raw);
        return await playgroundExtensions(controller).request(
          url.pathname.replace("/api/voice/playground", "") + url.search,
          init,
        );
      } finally {
        controller.close();
      }
    };
    const invoke = (args, input = {}) =>
      run(
        [
          ...args,
          ...(server ? ["--server", "http://127.0.0.1:4398"] : ["--project", dir]),
          "--input",
          JSON.stringify(input),
        ],
        { globalDir, ...(server ? { fetchImpl } : {}) },
      );
    const save = async (title) => {
      const result = await invoke(["templates", "from-recording", "original"], { title });
      expect(result.code, result.errors).toBe(0);
      return JSON.parse(result.output).template;
    };
    const first = await save("Narrator A");
    const second = await save("Narrator B");
    const inspect = async () =>
      JSON.parse((await invoke(["templates", "recipe", first.id])).output);
    expect(await inspect()).toMatchObject({
      command: "generate tts",
      input: {
        ...requested,
        seed: 0,
        previousText: "Before.",
        nextText: "After.",
        outputFormat: "mp3_44100_128",
        preserveSettings: true,
        voiceSettings: { stability: 0.37, use_speaker_boost: false },
        fromTemplateId: first.id,
      },
    });
    expect(
      (
        await invoke(["templates", "update", first.id], {
          draft: {
            ...first.draft,
            text: "[hushed] Wait.",
            stability: 0.85,
            applyTextNormalization: "off",
          },
        })
      ).code,
    ).toBe(0);
    const changed = await inspect();
    expect(changed.input).toMatchObject({
      text: "[hushed] Wait.",
      creatorId: "owner",
      voiceSettings: { stability: 0.85, use_speaker_boost: false },
      applyTextNormalization: "off",
    });
    expect((await invoke(changed.command.split(" "), changed.input)).code).toBe(0);
    const current = JSON.parse((await invoke(["templates", "info", first.id])).output).template
      .draft;
    expect(
      (
        await invoke(["templates", "update", first.id], {
          draft: {
            ...current,
            voiceId: "other",
            recordedSpeech: {
              ...current.recordedSpeech,
              settings: { ...current.recordedSpeech.settings, stability: 0.72 },
            },
          },
        })
      ).code,
    ).toBe(0);
    const swapped = await inspect();
    expect(swapped.input).toMatchObject({
      voiceId: "other",
      voiceSettings: { stability: 0.72, use_speaker_boost: false },
    });
    expect(swapped.input).not.toHaveProperty("creatorId");
    expect(swapped.input).not.toHaveProperty("voiceName");
    for (const [modelId, stability] of [
      ["eleven_v3", 0.65],
      ["eleven_v4", 0.8],
    ]) {
      const saved = JSON.parse((await invoke(["templates", "info", first.id])).output).template
        .draft;
      expect(
        (
          await invoke(["templates", "update", first.id], {
            draft: { ...saved, modelId, stability },
          })
        ).code,
      ).toBe(0);
      expect((await inspect()).input).toMatchObject({ modelId, voiceSettings: { stability } });
    }
    const ids = [first.id, second.id, "missing"];
    const bulk = await invoke(["templates", "bulk"], {
      ids,
      patch: { archived: true, rating: 5, tags: ["favorite narrators"] },
    });
    expect(JSON.parse(bulk.output)).toMatchObject({
      updated: [{ id: first.id }, { id: second.id }],
      missing: ["missing"],
    });
    expect(
      JSON.parse((await invoke(["templates", "find"], { archived: true, minRating: 5 })).output)
        .total,
    ).toBe(2);
    expect(
      (await invoke(["templates", "bulk"], { ids: [first.id], patch: { archived: false } })).code,
    ).toBe(0);
    expect(
      JSON.parse((await invoke(["templates", "find"])).output).templates.map(({ id }) => id),
    ).toEqual([first.id]);
    const invalid = await invoke(["templates", "save"], {
      title: "Wrong shape",
      draft: { mode: "tts", voiceSettings: { stability: 0.3 } },
    });
    expect(invalid.code).toBe(2);
    for (const [id, command, input] of [
      [
        "scene",
        "generate dialogue",
        {
          text: "Alex: In.\nRiley: Out.",
          pause_between_turns: 0.7,
          exportTranscript: true,
          speakers: {
            Alex: {
              voice_id: "actor",
              voice_settings: { stability: 0.37, use_speaker_boost: false },
            },
            Riley: {
              voice_id: "other",
              provider: "minimax",
              voice_settings: { pitch: 2, vol: 0.8 },
            },
          },
        },
      ],
      [
        "changed-voice",
        "generate voice-changer",
        {
          sourceFile: "src_voice.wav",
          voiceId: "actor",
          seed: 0,
          removeBackgroundNoise: true,
          voiceSettings: { use_speaker_boost: false },
        },
      ],
    ]) {
      const created = await invoke(["templates", "from-recording", id]);
      expect(created.code, created.errors).toBe(0);
      const { template } = JSON.parse(created.output);
      const result = await invoke(["templates", "recipe", template.id]);
      expect(result.code, result.errors).toBe(0);
      expect(JSON.parse(result.output)).toMatchObject({ command, input });
    }
  },
);

test.each([false, true])(
  "voice search keeps exact categories and exposes the next page through both CLI transports (server %s)",
  async (server) => {
    const dir = temporary();
    const fetchImpl = async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json({
        voices: [
          { voice_id: `unexpected-${page}`, category: "high_quality" },
          { voice_id: `target-${page}`, category: "professional", public_owner_id: "creator-1" },
        ],
        has_more: page === 0,
      });
    };
    const controllerOptions = {
      env: { GENVOICE_API_KEY: "fake-key" },
      fetchImpl,
      configFile: join(dir, "key.json"),
    };
    const controller = server
      ? openVoicePlayground({ ...controllerOptions, project: dir, globalDir: join(dir, "global") })
      : undefined;
    try {
      const { playgroundExtensions } = await import("../src/voice-playground-routes.mjs");
      const api = controller && playgroundExtensions(controller);
      const result = await run(
        [
          "voices",
          "search",
          ...(server ? ["--server", "http://127.0.0.1:4398"] : ["--project", dir]),
          "--input",
          JSON.stringify({ category: "professional", pageSize: 2 }),
        ],
        {
          controllerOptions,
          ...(api
            ? {
                fetchImpl: (url, init) =>
                  api.request(
                    new URL(url).pathname.replace("/api/voice/playground", "") +
                      new URL(url).search,
                    init,
                  ),
              }
            : {}),
        },
      );
      expect(result.code, result.errors).toBe(0);
      expect(JSON.parse(result.output)).toMatchObject({
        voices: [expect.objectContaining({ id: "target-0", creatorId: "creator-1" })],
        hasMore: true,
        nextPage: 1,
      });
    } finally {
      controller?.close();
    }
  },
);

test("a ten-voice comparison accepts locked identities and one marked script in its paid preview", async () => {
  const voices = Array.from({ length: 10 }, (_, index) => ({
    voiceId: `voice-${index + 1}`,
    voiceName: `Narrator ${index + 1}`,
    creatorId: "creator-1",
  }));
  const input = { label: "Forest audition", text: "Listen closely to the trees.", voices };
  const preview = await run(["generate", "batch", "--input", JSON.stringify(input)]);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.output)).toMatchObject({ preview: true, paid: true });
});

test("clone CLI discovers its actions and previews paid creation with unknown cost before any request", async () => {
  const help = await run(["clones", "--help"]);
  expect(help.code).toBe(0);
  expect(help.output).toContain("clones create");
  expect(help.output).toContain("clones link");
  const preview = await run([
    "clones",
    "create",
    "--input",
    JSON.stringify({ file: "my-voice.wav", name: "My narrator", permissionConfirmed: true }),
  ]);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.output)).toMatchObject({
    preview: true,
    paid: true,
    totalCredits: null,
    input: { permissionConfirmed: true, language: "English", noiseReduction: true },
  });
});

test.each(["headless-status", "headless-preview", "headless-preview-dns", "server"])(
  "%s clone observation aborts its active request at the remaining --wait deadline",
  async (context) => {
    const dir = temporary(),
      source = join(dir, "sample.wav"),
      checkpoint = join(dir, "bounded.json");
    writeFileSync(source, wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 12), 16000));
    let aborted = false,
      submissions = 0,
      lookupFinished = false;
    const delayed = (init, data, ms = 3500) =>
      new Promise((resolve, reject) => {
        const abort = () => {
          aborted = true;
          clearTimeout(timer);
          reject(init.signal.reason);
        };
        const timer = setTimeout(() => {
          init.signal?.removeEventListener("abort", abort);
          resolve(Response.json(data));
        }, ms);
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) abort();
      });
    const clone = {
      id: "saved",
      remoteId: "remote",
      phase: "processing",
      scope: "project",
      settings: { name: "Me" },
    };
    const transport = async (raw, init = {}) => {
      const path = new URL(raw).pathname;
      if (
        path.endsWith("/minimax/voices/clone") ||
        (path.endsWith("/clones") && init.method === "POST")
      ) {
        submissions++;
        return Response.json(
          path.endsWith("/clones") ? { clone } : { id: "remote", status: "processing" },
        );
      }
      if (path.endsWith("/clones/saved")) return delayed(init, { clone }, 700);
      if (path.endsWith("/clones/saved/refresh")) return delayed(init, { clone }, 700);
      if (path.endsWith("/minimax/voices"))
        return context.startsWith("headless-preview")
          ? Response.json({
              voices: [
                {
                  id: "remote",
                  status: "done",
                  sample_audio_url: "https://cdn.example.com/preview.wav",
                },
              ],
            })
          : delayed(init, { voices: [{ id: "remote", status: "processing" }] });
      if (path.endsWith("/preview.wav")) return delayed(init, {});
      if (path.endsWith("/models")) return Response.json(BUILTIN_GENVOICE_MODELS);
      if (path.endsWith("/languages")) return Response.json([{ code: "English", name: "English" }]);
      return Response.json({ voices: [] });
    };
    const result = await run(
      [
        "clones",
        "create",
        ...(context === "server" ? ["--server", "http://127.0.0.1:4398"] : ["--project", dir]),
        "--scope",
        "project",
        "--input",
        JSON.stringify({ file: source, name: "Me", permissionConfirmed: true }),
        "--yes",
        "--wait",
        "1",
        "--checkpoint",
        checkpoint,
      ],
      {
        globalDir: join(dir, "global"),
        fetchImpl:
          context === "server"
            ? transport
            : () => {
                throw new Error("Unexpected HTTP transport");
              },
        controllerOptions: {
          env: { GENVOICE_API_KEY: "isolated-key" },
          secretsFile: join(dir, "none.env"),
          configFile: join(dir, "config.json"),
          lookup: async () => {
            if (context === "headless-preview-dns")
              await new Promise((resolve) => setTimeout(resolve, 3500));
            lookupFinished = true;
            return [{ address: "93.184.216.34", family: 4 }];
          },
          fetchImpl: transport,
        },
      },
    );
    expect(result.code).toBe(1);
    if (context === "headless-preview-dns") expect(lookupFinished).toBe(false);
    else expect(aborted).toBe(true);
    expect(result.errors).toContain("Wait limit reached");
    expect(JSON.parse(readFileSync(checkpoint, "utf8")).cloneId).toBeDefined();
    expect(submissions).toBe(1);
  },
);

test.each(["server", "headless"])(
  "%s clone CLI checkpoints, resumes observation and exports its original sample without another paid create",
  async (context) => {
    const dir = temporary(),
      source = join(dir, "sample.wav"),
      checkpoint = join(dir, "clone-run.json"),
      out = join(dir, "original.wav");
    const bytes = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 12), 16000);
    writeFileSync(source, bytes);
    let completed = false,
      submissions = 0;
    const remote = () => ({
      id: "clone_remote",
      voice_name: "My narrator",
      status: completed ? "done" : "processing",
      language_tag: "English",
    });
    const local = () => ({
      id: "clone_local",
      remoteId: "clone_remote",
      phase: completed ? "ready" : "processing",
      scope: "project",
    });
    const options = {
      globalDir: join(dir, "global"),
      controllerOptions: {
        env: { GENVOICE_API_KEY: "isolated-clone-fixture" },
        secretsFile: join(dir, "none.env"),
        configFile: join(dir, "none.json"),
        fetchImpl: async (raw) => {
          const path = new URL(raw).pathname;
          if (path.endsWith("/minimax/voices/clone")) {
            submissions++;
            return Response.json(remote());
          }
          if (path.endsWith("/minimax/voices")) return Response.json({ voices: [remote()] });
          return Response.json({}, 404);
        },
      },
      fetchImpl: async (raw, init = {}) => {
        const path = new URL(raw).pathname;
        if (path.endsWith("/clones") && init.method === "POST") {
          submissions++;
          return Response.json({ clone: local() }, { status: 202 });
        }
        if (path.endsWith("/source"))
          return new Response(bytes, { headers: { "content-type": "audio/wav" } });
        return Response.json({ clone: local() });
      },
    };
    const mode = context === "server" ? ["--server", "http://127.0.0.1:4398"] : ["--project", dir];
    const started = performance.now();
    const pending = await run(
      [
        "clones",
        "create",
        ...mode,
        "--scope",
        "project",
        "--input",
        JSON.stringify({ file: source, name: "My narrator", permissionConfirmed: true }),
        "--yes",
        "--wait",
        "1",
        "--checkpoint",
        checkpoint,
      ],
      options,
    );
    expect(pending.code).toBe(1);
    expect(performance.now() - started).toBeLessThan(2400);
    expect(submissions).toBe(1);
    const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
    expect(saved.cloneId).toBeTruthy();
    expect(saved.clone.remoteId).toBe("clone_remote");
    completed = true;
    const resumed = await run(["resume", checkpoint, "--wait", "2"], options);
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.output).clone.phase).toBe("ready");
    expect(submissions).toBe(1);
    const exported = await run(
      ["clones", "export-source", saved.cloneId, ...mode, "--scope", "project", "--out", out],
      options,
    );
    expect(exported.code).toBe(0);
    expect(readFileSync(out)).toEqual(bytes);
  },
);

test.each(["server", "headless"])(
  "%s CLI exports inline Scribe subtitles without requiring a separate SRT file",
  async (context) => {
    const dir = temporary(),
      out = join(dir, "captions.srt"),
      srt = "1\n00:00:00,000 --> 00:00:01,000\nHello\n";
    const item = { id: "speech", kind: "tts", text: "Hello", sttResult: { srtText: srt } };
    mkdirSync(join(dir, "voice/playground"), { recursive: true });
    writeFileSync(join(dir, "voice/playground/items.json"), JSON.stringify({ items: [item] }));
    const result = await run(
      [
        "items",
        "export",
        item.id,
        ...(context === "server" ? ["--server", "http://127.0.0.1:4398"] : ["--project", dir]),
        "--scope",
        "project",
        "--input",
        JSON.stringify({ format: "srt" }),
        "--out",
        out,
      ],
      { fetchImpl: async () => Response.json({ item }) },
    );
    expect(result.code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(srt);
  },
);

test("explicit Project library commands keep actor aliases and recording recipes scoped", async () => {
  const dir = temporary();
  const globalDir = join(dir, "global");
  const options = { globalDir };
  const recording = {
    id: "a_take",
    kind: "tts",
    title: "Lời chào",
    text: "[softly] Chào Việt Nam",
    voiceId: "actor",
    voiceName: "Original actor",
    modelId: "eleven_v4",
    voiceSettings: { stability: 0.53 },
    languageCode: "vi",
    favorite: true,
    rating: 5,
    createdAt: "2026-11-18T00:00:00Z",
  };
  mkdirSync(join(dir, "voice/playground"), { recursive: true });
  writeFileSync(join(dir, "voice/playground/items.json"), JSON.stringify({ items: [recording] }));
  const project = (...args) => run([...args, "--project", dir], options);
  const saved = await project(
    "profiles",
    "save",
    "--input",
    JSON.stringify({
      voice: { id: "actor", name: "Original actor" },
      alias: "Cô Mai",
      rating: 5,
    }),
  );
  expect(saved.code).toBe(0);
  expect(JSON.parse(saved.output).profile).toMatchObject({ scope: "project", alias: "Cô Mai" });
  const global = await project("profiles", "list", "--scope", "global");
  expect(JSON.parse(global.output).total).toBe(0);
  const found = await project(
    "items",
    "find",
    "--input",
    JSON.stringify({ q: "viet nam", favorite: true }),
  );
  expect(JSON.parse(found.output).items.map(({ id }) => id)).toEqual([recording.id]);
  const recipe = await project("items", "recipe", recording.id);
  expect(JSON.parse(recipe.output)).toMatchObject({
    command: "generate tts",
    input: { text: recording.text, voiceSettings: recording.voiceSettings },
  });
  const archived = await project("items", "delete", recording.id, "--yes");
  expect(JSON.parse(archived.output)).toMatchObject({ archived: true });
  const restored = await project("items", "restore", recording.id);
  expect(JSON.parse(restored.output).item.archivedAt).toBeUndefined();
});

test("concurrent Project CLI edits preserve changes to both recordings", async () => {
  const dir = temporary();
  const options = { globalDir: join(dir, "global") };
  const storage = join(dir, "voice/playground");
  mkdirSync(storage, { recursive: true });
  writeFileSync(
    join(storage, "items.json"),
    JSON.stringify({ items: [{ id: "first" }, { id: "second" }] }),
  );
  const project = (...args) => run([...args, "--project", dir], options);
  const edit = (id, rating) =>
    project("items", "bulk", "--input", JSON.stringify({ ids: [id], patch: { rating } }));
  const results = await Promise.all([edit("first", 4), edit("second", 5)]);
  expect(results.map(({ code }) => code)).toEqual([0, 0]);
  const found = await project("items", "find");
  expect(JSON.parse(found.output).items).toMatchObject([
    { id: "first", rating: 4 },
    { id: "second", rating: 5 },
  ]);
});

test("paid transcription checkpoints its task, bounds observation and resumes without another paid submission", async () => {
  const dir = temporary(),
    file = join(dir, "source.wav"),
    checkpoint = join(dir, "stt-run.json");
  writeFileSync(file, wrapPcm16ToWav(Buffer.alloc(8820), 44100));
  let completed = false,
    submissions = 0;
  const options = {
    globalDir: join(dir, "global"),
    controllerOptions: {
      env: { GENVOICE_API_KEY: "isolated-stt-fixture" },
      secretsFile: join(dir, "none.env"),
      configFile: join(dir, "none.json"),
      pollIntervalMs: 25,
      maxPollMs: 3000,
      fetchImpl: async (raw, init = {}) => {
        const path = new URL(raw).pathname;
        if (path.endsWith("/speech-to-text") && init.method === "POST") {
          submissions++;
          return Response.json({ task_id: "stt_existing" });
        }
        if (path.endsWith("/speech-to-text/stt_existing"))
          return Response.json(
            completed
              ? {
                  status: "completed",
                  result: {
                    text: "Hello",
                    language_code: "en",
                    words: [{ text: "Hello", start: 0, end: 0.1 }],
                  },
                }
              : { status: "processing" },
          );
        if (path.endsWith("/auth/me")) return Response.json({ credit_balance: 99 });
        throw new Error(`Unexpected isolated STT request ${path}`);
      },
    },
  };
  const started = performance.now();
  const pending = await run(
    [
      "transcribe",
      "--project",
      dir,
      "--input",
      JSON.stringify({
        file,
        languageCode: "en",
        diarize: true,
        numSpeakers: 2,
        keyterms: ["Gohans"],
      }),
      "--yes",
      "--wait",
      "1",
      "--checkpoint",
      checkpoint,
    ],
    options,
  );
  expect(existsSync(checkpoint)).toBe(true);
  expect(performance.now() - started).toBeLessThan(2200);
  expect(pending.code).toBe(1);
  expect(JSON.parse(readFileSync(checkpoint, "utf8")).jobs[0]).toMatchObject({
    kind: "stt",
    remoteTaskId: "stt_existing",
  });
  const originalAudio = readFileSync(file);
  rmSync(file);
  completed = true;
  const resumed = await run(["resume", checkpoint, "--wait", "2"], options);
  expect(resumed.code).toBe(0);
  expect(JSON.parse(resumed.output).jobs).toHaveLength(1);
  expect(JSON.parse(resumed.output).transcriptions[0]).toMatchObject({
    taskId: "stt_existing",
    sttResult: { text: "Hello" },
  });
  const archived = JSON.parse(resumed.output).transcriptions[0].item;
  expect(archived.transcription.settings).toMatchObject({
    languageCode: "en",
    diarize: true,
    numSpeakers: 2,
    keyterms: ["Gohans"],
  });
  expect(archived.audioFile).toBeTruthy();
  const pg = openVoicePlayground({
    project: dir,
    globalDir: options.globalDir,
    ...options.controllerOptions,
  });
  try {
    expect(readFileSync(pg.forScope(archived.scope).audioFile(archived.audioFile))).toEqual(
      originalAudio,
    );
  } finally {
    pg.close();
  }
  expect(submissions).toBe(1);
});

test("CLI help and JSON schema are progressive, complete and never contact a server", async () => {
  const options = {
    fetchImpl: () => {
      throw new Error("Help made a request");
    },
  };
  const help = await run(["generate", "tts", "--help", "--server", "http://127.0.0.1:1"], options);
  expect(help.code).toBe(0);
  expect(help.output).toContain("previousText");
  const schema = await run(["schema", "region", "edit"], options);
  expect(schema.code).toBe(0);
  const spec = JSON.parse(schema.output);
  expect(spec.input.oneOf.flatMap((variant) => Object.keys(variant.properties))).toContain(
    "fitToSelection",
  );
  expect(spec.input.oneOf.flatMap((variant) => Object.keys(variant.properties))).toContain(
    "gainDb",
  );
});

test.each(["failed", "completed"])(
  "resume retains a %s transcription's captured remote task and result without submitting again",
  async (status) => {
    const dir = temporary(),
      checkpoint = join(dir, "stt.json"),
      result = {
        taskId: "existing_stt",
        sttResult: { text: "Kept", language_code: "en", words: [] },
      };
    writeFileSync(
      checkpoint,
      JSON.stringify({
        version: 1,
        command: "transcribe",
        project: dir,
        scope: "project",
        server: null,
        input: { languageCode: "en" },
        items: [],
        jobs: [
          {
            id: "old_stt",
            kind: "stt",
            status,
            remoteTaskId: "existing_stt",
            ...(status === "completed" ? { result } : {}),
          },
        ],
      }),
    );
    const resumed = await run(["resume", checkpoint, "--wait", "2"], {
      globalDir: join(dir, "global"),
      controllerOptions: {
        env: { GENVOICE_API_KEY: "isolated-stt-fixture" },
        secretsFile: join(dir, "none"),
        configFile: join(dir, "none.json"),
        pollIntervalMs: 1,
        maxPollMs: 1000,
        fetchImpl: async (raw, init = {}) => {
          if (init.method === "POST") throw new Error("Resume must not submit a paid request");
          if (new URL(raw).pathname.endsWith("/auth/me"))
            return Response.json({ credit_balance: 99 });
          return Response.json({ status: "completed", result: result.sttResult });
        },
      },
    });
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.output).transcriptions[0]).toMatchObject({
      taskId: "existing_stt",
      sttResult: { text: "Kept" },
    });
  },
);

test("paid CLI commands only preview without --yes and reject unknown fields instead of silently dropping them", async () => {
  const dir = temporary(),
    file = join(dir, "tts.json");
  writeFileSync(
    file,
    "\uFEFF" +
      JSON.stringify({
        voiceId: "actor",
        text: "Hello",
        voiceSettings: { speed: 1.1 },
        variations: 3,
      }),
  );
  const options = {
    fetchImpl: () => {
      throw new Error("Dry run spent credits");
    },
  };
  const preview = await run(
    ["generate", "tts", "--input-file", file, "--server", "http://127.0.0.1:1"],
    options,
  );
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.output)).toMatchObject({
    preview: true,
    paid: true,
    input: { variations: 3 },
  });
  const invalid = await run(
    [
      "generate",
      "tts",
      "--input",
      JSON.stringify({ voiceId: "actor", text: "Hello", varations: 3 }),
      "--yes",
    ],
    options,
  );
  expect(invalid.code).toBe(2);
  expect(invalid.errors).toContain("varations");
  const nested = await run(
    [
      "generate",
      "tts",
      "--server",
      "http://127.0.0.1:1",
      "--input",
      JSON.stringify({ voiceId: "actor", text: "Hello", voiceSettings: { spead: 0.9 } }),
      "--yes",
    ],
    options,
  );
  expect(nested.code).toBe(2);
  expect(nested.errors).toContain("spead");
  const typo = await run(["items", "list", "--scpoe", "global"], options);
  expect(typo.code).toBe(2);
  expect(typo.errors).toContain("--scpoe");
});

test("headless CLI templates persist in the shared library and another project sees only Global plus its own", async () => {
  const dir = temporary(),
    globalDir = join(dir, "global"),
    project = join(dir, "film-a"),
    other = join(dir, "film-b");
  const create = await run(
    [
      "templates",
      "save",
      "--project",
      project,
      "--scope",
      "global",
      "--input",
      JSON.stringify({
        title: "Reusable narrator",
        draft: { mode: "tts", voiceId: "actor", text: "Hello" },
      }),
    ],
    { globalDir },
  );
  expect(create.code).toBe(0);
  const pg = openVoicePlayground({
    project: other,
    globalDir,
    env: {},
    secretsFile: join(dir, "none"),
  });
  try {
    expect(pg.listTemplates({ includeGlobal: true })).toHaveLength(1);
    expect(pg.listTemplates()).toHaveLength(0);
  } finally {
    pg.close();
  }
  const list = await run(["templates", "list", "--project", other, "--scope", "global"], {
    globalDir,
  });
  expect(JSON.parse(list.output).templates[0].title).toBe("Reusable narrator");
});

test("server CLI waits for its own jobs and checkpoints actual cost and IDs without regenerating", async () => {
  const dir = temporary(),
    checkpoint = join(dir, "run.json"),
    sent = [];
  let polls = 0;
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw);
    if (url.pathname.endsWith("/tts")) {
      sent.push(JSON.parse(init.body));
      return Response.json(
        { jobs: [{ id: "job_a", status: "pending", remoteTaskId: "remote_a" }] },
        { status: 202 },
      );
    }
    if (url.pathname.includes("/tts/runs/"))
      return Response.json({
        run: {
          jobs: [{ id: "job_a", status: "completed", itemId: "item_a", remoteTaskId: "remote_a" }],
        },
      });
    if (url.pathname.endsWith("/items")) {
      polls++;
      return Response.json({
        jobs: [{ id: "job_a", status: "completed", itemId: "item_a", remoteTaskId: "remote_a" }],
        items: [{ id: "item_a", title: "Hello", creditsDeducted: 7 }],
        templates: [],
      });
    }
    throw new Error(`Unexpected URL ${url.pathname}`);
  };
  const result = await run(
    [
      "generate",
      "tts",
      "--server",
      "http://127.0.0.1:4398",
      "--scope",
      "global",
      "--input",
      JSON.stringify({ voiceId: "actor", text: "Hello", previousText: "Before" }),
      "--yes",
      "--checkpoint",
      checkpoint,
    ],
    { fetchImpl },
  );
  expect(result.code).toBe(0);
  expect(sent).toHaveLength(1);
  expect(sent[0].previousText).toBe("Before");
  expect(polls).toBeGreaterThan(0);
  const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
  expect(saved.items[0].creditsDeducted).toBe(7);
  expect(saved.jobs[0].remoteTaskId).toBe("remote_a");
  const resumed = await run(["resume", checkpoint], { fetchImpl });
  expect(resumed.code).toBe(0);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(resumed.output).items[0].id).toBe("item_a");
});

test("resume recovers a completed remote task after a server restart in the original project scope without spending again", async () => {
  const dir = temporary(),
    checkpoint = join(dir, "restart.json"),
    seen = [];
  writeFileSync(
    checkpoint,
    JSON.stringify({
      version: 1,
      server: "http://127.0.0.1:4398",
      scope: "project",
      project: dir,
      command: "generate tts",
      jobs: [{ id: "lost", kind: "tts", status: "processing", remoteTaskId: "kept" }],
      items: [],
    }),
  );
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw);
    seen.push({
      path: url.pathname,
      scope: url.searchParams.get("scope"),
      body: init.body && JSON.parse(init.body),
    });
    if (url.pathname.endsWith("/items")) return Response.json({ items: [], jobs: [] });
    if (url.pathname.endsWith("/remote-history/import"))
      return Response.json({ item: { id: "recovered", remoteTaskId: "kept", creditsDeducted: 9 } });
    throw new Error("Resume tried to generate again");
  };
  const result = await run(["resume", checkpoint, "--wait", "1"], { fetchImpl });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.output).items[0].id).toBe("recovered");
  expect(seen.every((request) => request.scope === "project")).toBe(true);
  expect(seen.find((request) => request.path.endsWith("/import")).body).toMatchObject({
    taskId: "kept",
    kind: "tts",
  });
});

test("server resume recovers every registered take when a batch checkpoint only contains one", async () => {
  const project = temporary();
  const checkpoint = join(project, "partial.json");
  const jobs = ["first", "second"].map((id) => ({
    id,
    kind: "tts",
    status: "completed",
    itemId: id,
    remoteTaskId: `task_${id}`,
  }));
  const items = jobs.map(({ id, remoteTaskId }, index) => ({
    id,
    kind: "tts",
    scope: "project",
    remoteTaskId,
    creditsDeducted: index * 7,
    creditsSource: "history",
  }));
  writeFileSync(
    checkpoint,
    JSON.stringify({
      version: 1,
      id: "local-run",
      serverRunId: "studio-run",
      command: "generate batch",
      scope: "project",
      server: "http://studio.invalid",
      project,
      jobs: jobs.slice(0, 1),
      items: [],
    }),
  );
  const resumed = await run(["resume", checkpoint, "--wait", "2"], {
    fetchImpl: (url, init) => {
      expect(init.method).toBe("GET");
      if (url.pathname.endsWith("/tts/runs/studio-run")) return Response.json({ run: { jobs } });
      if (url.pathname.endsWith("/items")) return Response.json({ jobs, items });
      throw new Error(`Unexpected request ${url.pathname}`);
    },
  });
  expect(resumed.code, resumed.errors).toBe(0);
  expect(JSON.parse(resumed.output)).toMatchObject({ jobs, items });
});

test("batch resume records each outcome and recovers saved items despite an independent failure", async () => {
  const project = temporary();
  const checkpoint = join(project, "batch.json");
  const stored = {
    id: "archived_take",
    kind: "tts",
    scope: "project",
    creditsDeducted: 0,
    remoteTaskId: "remote_archived",
  };
  const draftReceipt = {
    version: 1,
    id: "batch_receipt",
    command: "generate batch",
    project,
    server: "http://studio.invalid",
    scope: "project",
    items: [],
    jobs: [
      { id: "missing", kind: "tts", status: "processing" },
      { id: "failed", kind: "tts", status: "downloading", remoteTaskId: "remote_failed" },
      {
        id: "saved",
        kind: "tts",
        status: "completed",
        itemId: stored.id,
        remoteTaskId: stored.remoteTaskId,
      },
      { id: "recover", kind: "tts", status: "downloading" },
    ],
  };
  writeFileSync(checkpoint, JSON.stringify(draftReceipt));
  const history = [];
  const options = {
    fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      if (url.pathname.endsWith("/items") && init.method === "GET")
        return Response.json({
          items: [
            { ...stored, id: "copied_take", copiedFrom: { scope: "global", id: "global_take" } },
            stored,
          ],
          jobs: [],
        });
      if (url.pathname.endsWith("/tts/receipts/recover"))
        return Response.json({ receipt: { jobId: "recover", remoteTaskId: "remote_ready" } });
      if (url.pathname.endsWith("/remote-history/import")) {
        const { taskId } = JSON.parse(init.body);
        history.push(taskId);
        return taskId === "remote_failed"
          ? Response.json(
              { error: "Task is not ready (failed)", creditsDeducted: 7 },
              { status: 400 },
            )
          : Response.json({ item: { id: "recovered_take", kind: "tts", creditsDeducted: 17 } });
      }
      throw new Error("Recovery contacted a synthesis endpoint");
    },
  };
  const partial = await run(["resume", checkpoint, "--wait", "2"], options);
  expect(partial.code).toBe(1);
  expect(history).toEqual(["remote_failed", "remote_ready"]);
  // a provider outage read as a Studio fault was retried blind, with no word on what it had cost: each failure says
  // its own cause (a local one here, the provider's there) and its cost
  const failure = JSON.parse(partial.errors);
  expect(failure.failed).toEqual([
    {
      id: "missing",
      error: "Remote task ID missing. Check saved recordings and Cloud history before retrying.",
      credits: null,
    },
    { id: "failed", error: "Task is not ready (failed)", credits: 7 },
  ]);
  expect(failure.next).toMatch(/^failed\[\]\.error says where each job failed/);
  expect(JSON.parse(readFileSync(checkpoint, "utf8"))).toMatchObject({
    items: [stored, { id: "recovered_take", creditsDeducted: 17 }],
    jobs: [
      { id: "missing", status: "failed" },
      { id: "failed", status: "failed", creditsDeducted: 7 },
      { id: "saved", status: "completed", creditsDeducted: 0 },
      { id: "recover", status: "completed", creditsDeducted: 17 },
    ],
  });
  writeFileSync(checkpoint, JSON.stringify({ ...draftReceipt, jobs: [draftReceipt.jobs[2]] }));
  const completed = await run(["resume", checkpoint, "--wait", "2"], options);
  expect(completed.code).toBe(0);
  expect(JSON.parse(completed.output).items).toEqual([stored]);
});

test("resume uses one wait budget and preserves the first recovered take when the second times out", async () => {
  const project = temporary();
  const checkpoint = join(project, "batch.json");
  const jobs = ["fast", "slow"].map((name) => ({
    id: name,
    kind: "tts",
    status: "downloading",
    remoteTaskId: `task_${name}`,
  }));
  writeFileSync(
    checkpoint,
    JSON.stringify({
      version: 1,
      project,
      scope: "project",
      server: "http://studio.invalid",
      items: [],
      jobs,
    }),
  );
  const seen = [],
    aborted = [];
  const result = await run(["resume", checkpoint, "--wait", "1"], {
    fetchImpl: async (url, init) => {
      if (url.pathname.endsWith("/items")) return Response.json({ items: [], jobs: [] });
      if (!url.pathname.endsWith("/remote-history/import"))
        throw new Error("Unexpected request during checkpoint recovery");
      const { taskId } = JSON.parse(init.body);
      seen.push(taskId);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 720);
        init.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            aborted.push(taskId);
            reject(init.signal.reason);
          },
          { once: true },
        );
      });
      return Response.json({ item: { id: taskId, kind: "tts", creditsDeducted: 7 } });
    },
  });
  expect(result.code).toBe(1);
  expect(result.errors).toContain("Wait limit reached");
  expect(seen).toEqual(["task_fast", "task_slow"]);
  expect(aborted).toContain("task_slow");
  expect(JSON.parse(readFileSync(checkpoint, "utf8"))).toMatchObject({
    items: [{ id: "task_fast", creditsDeducted: 7 }],
    jobs: [
      { status: "completed", itemId: "task_fast" },
      { status: "downloading", remoteTaskId: "task_slow" },
    ],
  });
});

test("voices preview refuses an expired URL response and exports the actual preview audio", async () => {
  const project = temporary();
  const output = join(project, "sample.wav");
  const audio = wrapPcm16ToWav(Buffer.alloc(32000, 5), 16000);
  let cdnReady = false;
  const args = [
    "voices",
    "preview",
    "--project",
    project,
    "--input",
    JSON.stringify({
      previewUrl: "https://cdn.example.com/preview.wav",
    }),
    "--out",
    output,
  ];
  const options = {
    controllerOptions: {
      env: {},
      secretsFile: join(project, "none"),
      configFile: join(project, "config"),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async (raw, init) => {
        expect(init.method).toBeUndefined();
        expect(new URL(raw).pathname).toBe("/preview.wav");
        return cdnReady
          ? new Response(audio)
          : new Response("<html>Link expired</html>", { headers: { "content-type": "text/html" } });
      },
    },
  };
  const invalid = await run(args, options);
  expect(invalid.code).toBe(1);
  expect(invalid.errors).toContain("Voice preview is not an audio file");
  expect(existsSync(output)).toBe(false);
  cdnReady = true;
  const valid = await run(args, options);
  expect(valid.code).toBe(0);
  expect(readFileSync(output)).toEqual(audio);
});

test("server preview preserves the destination when Studio returns a non-audio response", async () => {
  const project = temporary();
  const output = join(project, "sample.wav");
  const audio = wrapPcm16ToWav(Buffer.alloc(32000, 5), 16000);
  writeFileSync(output, audio);
  const result = await run(
    [
      "voices",
      "preview",
      "--server",
      "http://studio.invalid",
      "--input",
      JSON.stringify({ previewUrl: "https://cdn.example.com/sample.wav" }),
      "--out",
      output,
    ],
    {
      fetchImpl: async (url) => {
        expect(url.pathname).toBe("/api/voice/playground/voices/preview");
        return new Response("<html>Link expired</html>");
      },
    },
  );
  expect(result.code).toBe(1);
  expect(result.errors).toContain("Voice preview is not an audio file");
  expect(readFileSync(output)).toEqual(audio);
});

test("server preview checks the tracks of an MP4 container before writing it", async () => {
  const project = temporary();
  const path = join(project, "preview.m4a");
  const encode = (input, codec) => {
    const result = Bun.spawnSync(
      [
        "ffmpeg",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        input,
        ...codec,
        "-t",
        "0.1",
        "-f",
        "mp4",
        "-movflags",
        "empty_moov+frag_keyframe",
        "pipe:1",
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe", timeout: 10_000 },
    );
    expect(result.exitCode).toBe(0);
    return result.stdout;
  };
  const audio = encode("sine=frequency=250:sample_rate=16000", ["-c:a", "aac"]);
  const video = encode("color=size=16x16", ["-c:v", "libx264"]);
  const args = [
    "voices",
    "preview",
    "--server",
    "http://studio.invalid",
    "--input",
    JSON.stringify({ previewUrl: "https://cdn.example.com/preview.m4a" }),
    "--out",
    path,
  ];
  expect((await run(args, { fetchImpl: () => new Response(audio) })).code).toBe(0);
  expect((await run(args, { fetchImpl: () => new Response(video) })).code).toBe(1);
  const id3WithoutAudio = Buffer.alloc(10);
  id3WithoutAudio.write("ID3");
  expect((await run(args, { fetchImpl: () => new Response(id3WithoutAudio) })).code).toBe(1);
  const wavWithoutSamples = wrapPcm16ToWav(Buffer.alloc(0), 16000);
  expect((await run(args, { fetchImpl: () => new Response(wavWithoutSamples) })).code).toBe(1);
  expect(readFileSync(path)).toEqual(audio);
});

test("Global resume restores the accepted recipe after loss of the index without repeating the charge", async () => {
  const dir = temporary();
  const globalDir = join(dir, "global");
  const checkpoint = join(dir, "resume-global.json");
  const wav = wrapPcm16ToWav(Buffer.alloc(32000, 12), 16000);
  let submitted = 0;
  let history = 0;
  const controllerOptions = {
    env: { GENVOICE_API_KEY: "fixture-only" },
    configFile: join(dir, "config"),
    secretsFile: join(dir, "missing.env"),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    pollIntervalMs: 1,
    fetchImpl: async (raw, init) => {
      const path = new URL(raw).pathname;
      if (path.endsWith("/text-to-speech/actor") && init.method === "POST") {
        submitted++;
        return Response.json({ id: "global_task" }, { status: 202 });
      }
      if (path.endsWith("/history/global_task")) {
        history++;
        return Response.json({
          status: "completed",
          credits_deducted: 7,
          result: { audio_url: "https://cdn.example.com/global.wav" },
        });
      }
      if (path === "/global.wav") return new Response(wav);
      return Response.json([]);
    },
  };
  const options = { globalDir, controllerOptions };
  const generated = await run(
    [
      "generate",
      "tts",
      "--scope",
      "global",
      "--checkpoint",
      checkpoint,
      "--wait",
      "3",
      "--yes",
      "--input",
      '{"voiceId":"actor","text":"Cháy! Mau lên!","seed":0}',
    ],
    options,
  );
  expect(generated.code, generated.errors).toBe(0);
  const {
    items: [original],
  } = JSON.parse(generated.output);
  rmSync(join(globalDir, "archive.sqlite"));
  const resumed = await run(["resume", checkpoint, "--wait", "3"], options);
  expect(resumed.code, resumed.errors).toBe(0);
  const {
    items: [restored],
  } = JSON.parse(resumed.output);
  expect(restored).toMatchObject({
    id: original.id,
    languageCode: "vi",
    generationRecipe: original.generationRecipe,
    creditsDeducted: 7,
  });
  expect(readFileSync(join(globalDir, "audio", restored.audioFile))).toEqual(wav);
  expect(submitted).toBe(1);
  expect(history).toBe(2);
});

test("resume help and dry-run never contact a server or rewrite a checkpoint", async () => {
  const dir = temporary(),
    checkpoint = join(dir, "paused.json");
  const original = JSON.stringify({
    version: 1,
    server: "http://127.0.0.1:1",
    project: dir,
    scope: "project",
    jobs: [{ id: "job", kind: "tts", status: "processing", remoteTaskId: "remote" }],
    items: [],
  });
  writeFileSync(checkpoint, original);
  const options = {
    fetchImpl: () => {
      throw new Error("A resume preview contacted the server");
    },
  };
  const help = await run(["resume", checkpoint, "--help"], options);
  expect(help.code).toBe(0);
  expect(help.output).toContain("checkpoint");
  expect(readFileSync(checkpoint, "utf8")).toBe(original);
  const bare = await run(["resume", "--help"], options);
  expect(bare.code).toBe(0);
  const preview = await run(["resume", checkpoint, "--dry-run"], options);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.output)).toMatchObject({ preview: true });
  expect(readFileSync(checkpoint, "utf8")).toBe(original);
});

test("headless resume and history import return the archived item rather than an import wrapper", async () => {
  const dir = temporary(),
    globalDir = join(dir, "global"),
    checkpoint = join(dir, "resume.json"),
    audio = wrapPcm16ToWav(Buffer.alloc(48000 * 2), 48000);
  let historyReady = false;
  let audioDownloads = 0;
  const controllerOptions = {
    env: { GENVOICE_API_KEY: "fake-key" },
    secretsFile: join(dir, "none"),
    configFile: join(dir, "config"),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (raw, init = {}) => {
      if (init.method === "POST") throw new Error("Recovery attempted a paid request");
      const url = new URL(raw);
      if (url.pathname === "/take.srt")
        return new Response("1\n00:00:00,000 --> 00:00:01,000\nSaved phrase.");
      if (url.hostname === "cdn.example.com") {
        audioDownloads++;
        return new Response(audio, { headers: { "content-type": "audio/wav" } });
      }
      if (url.pathname.endsWith("/history/saved_task"))
        return Response.json({
          id: "saved_task",
          status: "completed",
          text: "Saved phrase",
          ...(historyReady ? { credits_deducted: 7 } : {}),
          metadata: { voice_id: "actor", model_id: "eleven_v4" },
          result: {
            audio_url: "https://cdn.example.com/audio.wav",
            ...(historyReady ? { srt_url: "https://cdn.example.com/take.srt" } : {}),
          },
        });
      throw new Error(`Unexpected fixture request ${url.pathname}`);
    },
  };
  writeFileSync(
    checkpoint,
    JSON.stringify({
      version: 1,
      server: null,
      scope: "global",
      project: dir,
      jobs: [{ id: "lost", kind: "tts", status: "processing", remoteTaskId: "saved_task" }],
      items: [],
    }),
  );
  const resumed = await run(["resume", checkpoint], { globalDir, controllerOptions });
  expect(resumed.code).toBe(0);
  const receipt = JSON.parse(resumed.output);
  expect(receipt.items[0].id).toEqual(expect.any(String));
  expect(receipt.jobs[0].itemId).toBe(receipt.items[0].id);
  expect(receipt.items[0].item).toBeUndefined();
  expect(receipt.items[0].creditsDeducted).toBeUndefined();
  historyReady = true;
  const refreshed = await run(["resume", checkpoint], { globalDir, controllerOptions });
  expect(refreshed.code).toBe(0);
  expect(JSON.parse(refreshed.output)).toMatchObject({
    items: [
      {
        id: receipt.items[0].id,
        creditsDeducted: 7,
        srtText: expect.stringContaining("Saved phrase."),
      },
    ],
    jobs: [{ itemId: receipt.items[0].id, creditsDeducted: 7 }],
  });
  expect(audioDownloads).toBe(1);
  const imported = await run(
    [
      "history",
      "import",
      "--project",
      dir,
      "--scope",
      "global",
      "--input",
      JSON.stringify({ taskId: "saved_task" }),
    ],
    { globalDir, controllerOptions },
  );
  expect(imported.code).toBe(0);
  expect(JSON.parse(imported.output)).toMatchObject({
    item: { id: receipt.items[0].id },
    alreadyImported: true,
  });
});

test("headless Speech saves its acknowledgement before starting the observation wait", async () => {
  const project = temporary();
  const checkpoint = join(project, "speech.json");
  let submissions = 0;
  const result = await run(
    [
      "generate",
      "tts",
      "--project",
      project,
      "--checkpoint",
      checkpoint,
      "--yes",
      "--wait",
      "1",
      "--input",
      JSON.stringify({ voiceId: "actor", text: "A short line." }),
    ],
    {
      controllerOptions: {
        env: { GENVOICE_API_KEY: "fixture" },
        secretsFile: join(project, "none"),
        configFile: join(project, "config"),
        pollIntervalMs: 1,
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async (raw, init) => {
          const url = new URL(raw);
          if (init.method === "POST" && url.pathname.endsWith("/text-to-speech/actor")) {
            submissions++;
            await Bun.sleep(1100);
            return Response.json({ id: "slow_ack" }, { status: 202 });
          }
          if (url.pathname.endsWith("/history/slow_ack"))
            return Response.json({
              id: "slow_ack",
              status: "completed",
              credits_deducted: 7,
              result: { audio_url: "https://cdn.example.com/take.wav" },
            });
          if (url.pathname === "/take.wav")
            return new Response(wrapPcm16ToWav(Buffer.alloc(32000, 5), 16000));
          return Response.json([]);
        },
      },
    },
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(readFileSync(checkpoint, "utf8"))).toMatchObject({
    jobs: [{ remoteTaskId: "slow_ack", status: "completed", creditsDeducted: 7 }],
    items: [{ remoteTaskId: "slow_ack" }],
  });
  expect(submissions).toBe(1);
});

test.each(["tts", "batch"])(
  "headless %s retains completed recordings and casting identity",
  async (command) => {
    const dir = temporary(),
      globalDir = join(dir, "global"),
      checkpoint = join(dir, "run.json");
    const audio = wrapPcm16ToWav(Buffer.alloc(48000 * 2), 48000);
    let submissions = 0;
    const controllerOptions = {
      env: { GENVOICE_API_KEY: "test-key" },
      secretsFile: join(dir, "none"),
      configFile: join(dir, "config"),
      pollIntervalMs: 2,
      maxPollMs: 1000,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async (raw, init = {}) => {
        const url = new URL(raw);
        if (url.hostname === "cdn.example.com")
          return new Response(audio, { headers: { "content-type": "audio/wav" } });
        if (url.pathname.endsWith("/models")) return Response.json(BUILTIN_GENVOICE_MODELS);
        if (url.pathname.endsWith("/languages")) return Response.json([]);
        if (url.pathname.endsWith("/default-voices")) return Response.json({ voices: [] });
        if (url.pathname.endsWith("/auth/me")) return Response.json({ credit_balance: 1000 });
        if (init.method === "POST")
          return Response.json({ id: `task_${url.pathname.split("/").at(-1)}_${++submissions}` });
        if (url.pathname.includes("/history/task_"))
          return Response.json({
            id: url.pathname.split("/").at(-1),
            status: "completed",
            credits_deducted: 7,
            result: { audio_url: "https://cdn.example.com/audio.wav" },
          });
        throw new Error(`Unexpected fake transport request ${url.pathname}`);
      },
    };
    const casting = Array.from({ length: 10 }, (_, index) => ({
      voiceId: `actor${index}`,
      voiceName: `Actor ${index}`,
      creatorId: "qa-creator",
    }));
    const input =
      command === "batch"
        ? { label: "Moonlight auditions", text: "Hello", voices: casting }
        : { voiceId: "actor", creatorId: "qa-creator", text: "Hello" };
    const result = await run(
      [
        "generate",
        command,
        "--project",
        dir,
        "--scope",
        "global",
        "--input",
        JSON.stringify(input),
        "--yes",
        "--checkpoint",
        checkpoint,
      ],
      { globalDir, controllerOptions },
    );
    expect(result.code, result.errors).toBe(0);
    const receipt = JSON.parse(result.output);
    const total = command === "batch" ? casting.length : 1;
    expect(receipt.items).toHaveLength(total);
    expect(receipt.items[0].creditsDeducted).toBe(7);
    expect(readFileSync(join(globalDir, "audio", receipt.items[0].audioFile)).byteLength).toBe(
      audio.byteLength,
    );
    expect(JSON.parse(readFileSync(checkpoint, "utf8")).items).toHaveLength(total);
    if (command === "batch") {
      const { batchId } = receipt;
      const query = await run(
        [
          "items",
          "find",
          "--scope",
          "global",
          "--input",
          JSON.stringify({ batchId, creatorId: "qa-creator", tag: input.label }),
        ],
        { globalDir },
      );
      const recordings = JSON.parse(query.output);
      expect(recordings.total).toBe(10);
      const first = recordings.items.find((item) => item.voiceId === "actor0");
      expect(first).toMatchObject({
        title: "Moonlight auditions · Actor 0",
        tags: [input.label],
        batch: { id: batchId, index: 0 },
      });
      const prior = join(dir, "prior-film");
      const { creatorId: _creatorId, generationRecipe: _generationRecipe, ...legacy } = first;
      mkdirSync(join(prior, "voice/playground/audio"), { recursive: true });
      writeFileSync(join(prior, "voice/playground/audio", first.audioFile), audio);
      writeFileSync(
        join(prior, "voice/playground/items.json"),
        JSON.stringify({
          items: [
            {
              ...legacy,
              id: "old-take",
              rating: 5,
              originProject: "prior-film",
              createdAt: "2026-08-18T12:00:00Z",
            },
          ],
        }),
      );
      const profile = await run(
        [
          "profiles",
          "save",
          "--project",
          prior,
          "--input",
          JSON.stringify({
            voice: {
              id: first.voiceId,
              provider: first.provider,
              creatorId: "qa-creator",
            },
          }),
        ],
        { globalDir },
      );
      expect(profile.code).toBe(0);
      const history = await run(
        [
          "items",
          "find",
          "--project",
          prior,
          "--input",
          JSON.stringify({
            voiceId: first.voiceId,
            creatorId: "qa-creator",
            project: "prior-film",
            after: "2026-08-18",
            before: "2026-08-18",
            minRating: 5,
          }),
        ],
        { globalDir },
      );
      expect(JSON.parse(history.output).items.map(({ id }) => id)).toEqual(["old-take"]);
      const usage = await run(["voices", "usage", "--scope", "global"], { globalDir });
      expect(JSON.parse(usage.output).voices).toHaveLength(10);
      expect(JSON.parse(usage.output).voices[0]).toMatchObject({ recordings: 1, inFilm: 0 });
      const media = await run(["items", "media", "old-take", "--project", prior], { globalDir });
      expect(JSON.parse(media.output).media).toMatchObject({
        codec: "pcm_s16le",
        sampleRateHz: 48000,
        channels: 1,
        bitRateBps: 768000,
      });
      const out = join(prior, "preview.wav");
      const preview = await run(
        [
          "voices",
          "preview",
          "--project",
          prior,
          "--out",
          out,
          "--input",
          JSON.stringify({
            previewUrl: `/api/voice/playground/audio/${first.audioFile}?scope=project`,
          }),
        ],
        { globalDir },
      );
      expect(preview.code, preview.errors).toBe(0);
      expect(readFileSync(out).equals(audio)).toBe(true);
    } else {
      const retry = (input, index) =>
        run(
          [
            "items",
            "retry",
            receipt.items[0].id,
            "--scope",
            "global",
            "--yes",
            "--checkpoint",
            join(dir, `retry-${index}.json`),
            "--input",
            JSON.stringify(input),
          ],
          { globalDir, controllerOptions },
        );
      const same = await retry({}, 1);
      expect(same.code, same.errors).toBe(0);
      expect(JSON.parse(same.output).items[0]).toMatchObject({
        voiceId: "actor",
        creatorId: "qa-creator",
      });
      const swapped = await retry({ voiceId: "other-actor" }, 2);
      expect(swapped.code, swapped.errors).toBe(0);
      expect(JSON.parse(swapped.output).items[0].creatorId).toBeUndefined();
      const attributed = await retry({ voiceId: "other-actor", creatorId: "other-creator" }, 3);
      expect(attributed.code, attributed.errors).toBe(0);
      expect(JSON.parse(attributed.output).items[0].creatorId).toBe("other-creator");
    }
  },
);

test("resume finishes a saved phrase splice after restart using its existing fragment and no paid endpoint", async () => {
  const dir = temporary(),
    checkpoint = join(dir, "splice.json"),
    calls = [];
  const fragment = {
    id: "fragment",
    remoteTaskId: "phrase_remote",
    text: "new words",
    creditsDeducted: 7,
  };
  writeFileSync(
    checkpoint,
    JSON.stringify({
      version: 1,
      server: "http://127.0.0.1:4398",
      project: dir,
      scope: "project",
      command: "region edit",
      argument: "parent",
      input: {
        mode: "regenerate",
        from: 1,
        to: 2,
        replacementText: "new words",
        fullText: "One new words three",
        voiceId: "actor",
      },
      jobs: [
        { id: "outer", kind: "region_edit", status: "processing" },
        {
          id: "child",
          kind: "tts",
          status: "completed",
          itemId: "fragment",
          remoteTaskId: "phrase_remote",
        },
      ],
      items: [fragment],
    }),
  );
  let started = false;
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    if (url.pathname.endsWith("/versions/resume")) {
      expect(JSON.parse(init.body).replacementItemId).toBe("fragment");
      started = true;
      return Response.json(
        { job: { id: "restored", kind: "region_edit", status: "processing" } },
        { status: 202 },
      );
    }
    if (url.pathname.endsWith("/items"))
      return Response.json({
        items: [fragment, ...(started ? [{ id: "version", creditsDeducted: 0 }] : [])],
        jobs: started
          ? [{ id: "restored", kind: "region_edit", status: "completed", itemId: "version" }]
          : [],
      });
    throw new Error("Resume attempted a paid request");
  };
  const result = await run(["resume", checkpoint, "--wait", "2"], { fetchImpl });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.output).items.some((item) => item.id === "version")).toBe(true);
  expect(calls.filter((path) => path.endsWith("/versions/resume"))).toHaveLength(1);
});
