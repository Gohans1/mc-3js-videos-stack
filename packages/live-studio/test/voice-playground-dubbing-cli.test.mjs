import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSharedArchive } from "../src/voice-playground-archive.mjs";
import { runVoicePlaygroundCli } from "../src/voice-playground-cli.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

const run = async (args, options = {}) => {
  const output = [],
    errors = [];
  const code = await runVoicePlaygroundCli(args, {
    out: (value) => output.push(value),
    err: (value) => errors.push(value),
    ...options,
  });
  return { code, output: output.join("\n"), errors: errors.join("\n") };
};

test.each(["headless", "server"])(
  "%s CLI can reuse a Global recording as a source and resume without another copy",
  async (mode) => {
    const dir = mkdtempSync(join(tmpdir(), "dubbing-cli-recording-")),
      globalDir = join(dir, "global"),
      checkpoint = join(dir, "source.json");
    const controllerOptions = {
      project: dir,
      globalDir,
      env: {},
      configFile: join(dir, "no-config"),
      secretsFile: join(dir, "no-secrets"),
      fetchImpl: () => {
        throw Error("Reusing saved audio must not contact GenVoice");
      },
    };
    const pg = openVoicePlayground(controllerOptions),
      global = pg.forScope("global");
    const audio = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000);
    try {
      const item = await global.acceptCopy(
        { kind: "tts", title: "Saved narrator", createdAt: new Date().toISOString() },
        [["audioFile", "audio", audio, "recording.wav"]],
      );
      const api = playgroundExtensions(pg),
        options = {
          globalDir,
          controllerOptions,
          fetchImpl: async (url, init) => {
            const target = new URL(url);
            return api.request(
              target.pathname.replace("/api/voice/playground", "") + target.search,
              init,
            );
          },
        };
      const result = await run(
        [
          "dubbing",
          "source-add",
          ...(mode === "server" ? ["--server", "http://studio.invalid"] : ["--project", dir]),
          "--scope",
          "global",
          "--input",
          JSON.stringify({ itemId: item.id }),
          "--checkpoint",
          checkpoint,
        ],
        options,
      );
      expect(result.code).toBe(0);
      const { source } = JSON.parse(result.output);
      expect(readFileSync(global.dubbingSourcePath(source.id))).toEqual(audio);
      const resumed = await run(["resume", checkpoint], options);
      expect(resumed.code).toBe(0);
      expect(JSON.parse(resumed.output).source.id).toBe(source.id);
      const bridgeCheckpoint = join(dir, "bridge.json");
      const bridge = await run(
        [
          "dubbing",
          "source-add",
          ...(mode === "server" ? ["--server", "http://studio.invalid"] : ["--project", dir]),
          "--scope",
          "project",
          "--input",
          JSON.stringify({ sourceId: source.id, sourceScope: "global" }),
          "--checkpoint",
          bridgeCheckpoint,
        ],
        options,
      );
      expect(bridge.code).toBe(0);
      const copied = JSON.parse(bridge.output).source;
      expect(copied.id).not.toBe(source.id);
      expect(readFileSync(pg.dubbingSourcePath(copied.id))).toEqual(audio);
      const bridgeResume = await run(["resume", bridgeCheckpoint], options);
      expect(bridgeResume.code).toBe(0);
      expect(JSON.parse(bridgeResume.output).source.id).toBe(copied.id);
    } finally {
      pg.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("Dubbing CLI discovers source preparation, prices, native voice IDs and safe paid previews without requests", async () => {
  const options = {
    fetchImpl: () => {
      throw new Error("Preview must not send requests");
    },
  };
  const help = await run(["dubbing", "--help"], options);
  expect(help.code).toBe(0);
  expect(help.output).toContain("dubbing source-add");
  expect(help.output).toContain("dubbing prepare");
  const schema = await run(["schema", "dubbing", "prepare"], options);
  expect(schema.code).toBe(0);
  expect(schema.output).toContain("ttsVoiceId");
  const preview = await run(["dubbing", "submit", "saved_job"], options);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.output)).toMatchObject({
    preview: true,
    paid: true,
    totalCredits: null,
  });
});
test("headless Dubbing CLI prepares a source for free, submits once and resumes the completed checkpoint without another charge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-cli-")),
    source = join(dir, "scene.wav"),
    result = join(dir, "result.mp3"),
    checkpoint = join(dir, "run.json");
  writeFileSync(source, wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000));
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000",
      "-t",
      "0.4",
      result,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  let paid = 0;
  const options = {
    globalDir: join(dir, "global"),
    fetchImpl: () => {
      throw new Error("Headless mode must not use a Studio server");
    },
    controllerOptions: {
      env: { GENVOICE_API_KEY: "fixture-only" },
      configFile: join(dir, "no-config"),
      secretsFile: join(dir, "no-secrets"),
      pollIntervalMs: 1,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/init"))
          return Response.json({ upload_id: "upload_one", chunk_size: 1024 * 1024 });
        if (path.endsWith("/chunk")) return Response.json({ received: true });
        if (path.endsWith("/complete")) {
          paid++;
          return Response.json({ task_id: "cloud_one" });
        }
        if (path.endsWith("/cloud_one"))
          return Response.json({
            id: "cloud_one",
            status: "completed",
            credits_deducted: 20,
            result: { audio_url: "https://cdn.invalid/result.mp3" },
          });
        if (path.endsWith("/result.mp3")) return new Response(Bun.file(result));
        throw new Error(`Unexpected fixture request ${path}`);
      },
    },
  };
  const context = ["--project", dir, "--scope", "project"];
  try {
    const staged = await run(
      [
        "dubbing",
        "source-add",
        ...context,
        "--input",
        JSON.stringify({ file: source }),
        "--checkpoint",
        join(dir, "source.json"),
      ],
      options,
    );
    expect(staged.code).toBe(0);
    const sourceId = JSON.parse(staged.output).source.id;
    const prepared = await run(
      [
        "dubbing",
        "prepare",
        ...context,
        "--input",
        JSON.stringify({
          sourceId,
          provider: "elevenlabs",
          sourceLanguage: "en",
          targetLanguage: "vi",
          voiceId: "actor",
        }),
      ],
      options,
    );
    expect(prepared.code).toBe(0);
    const { job } = JSON.parse(prepared.output);
    expect(job.estimatedCredits).toBe(20);
    expect(paid).toBe(0);
    const submitted = await run(
      ["dubbing", "submit", job.id, ...context, "--yes", "--wait", "5", "--checkpoint", checkpoint],
      options,
    );
    expect(submitted.code).toBe(0);
    expect(JSON.parse(readFileSync(checkpoint, "utf8")).dubbing.phase).toBe("completed");
    const resumed = await run(["resume", checkpoint], options);
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.output).dubbing.creditsDeducted).toBe(20);
    expect(paid).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("server Dubbing observation respects the remaining wait deadline and preserves its local identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-cli-deadline-")),
    checkpoint = join(dir, "run.json");
  writeFileSync(
    checkpoint,
    JSON.stringify({
      version: 1,
      command: "dubbing submit",
      dubbingId: "saved",
      server: "http://studio.invalid",
      project: dir,
      scope: "project",
      jobs: [],
      items: [],
    }),
  );
  let calls = 0,
    aborted = false;
  const started = performance.now();
  try {
    const result = await run(["resume", checkpoint, "--wait", "1"], {
      fetchImpl: async (url, init) => {
        calls++;
        expect(init.method).toBe("GET");
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve(
                Response.json({ job: { id: "saved", phase: "processing", taskId: "remote" } }),
              ),
            3500,
          );
          init.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              clearTimeout(timer);
              reject(init.signal.reason);
            },
            { once: true },
          );
        });
      },
    });
    expect(result.code).toBe(1);
    expect(performance.now() - started).toBeLessThan(1800);
    expect(aborted).toBe(true);
    expect(calls).toBe(1);
    expect(JSON.parse(readFileSync(checkpoint, "utf8")).dubbingId).toBe("saved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server source upload resumes after losing a chunk acknowledgement, reusing confirmed bytes without spending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-cli-upload-")),
    file = join(dir, "source.wav"),
    checkpoint = join(dir, "upload.json");
  const bytes = wrapPcm16ToWav(Buffer.alloc(16 * 1024 * 1024), 16000);
  writeFileSync(file, bytes);
  const pg = openVoicePlayground({
    dir: join(dir, "archive"),
    env: {},
    configFile: join(dir, "no-config"),
    secretsFile: join(dir, "no-secrets"),
    fetchImpl: () => {
      throw new Error("Staging must not contact GenVoice");
    },
  });
  const app = playgroundExtensions(pg);
  let lost = false;
  const chunks = [];
  const transport = async (url, init) => {
    const target = new URL(url),
      path = target.pathname.replace("/api/voice/playground", "") + target.search;
    const response = await app.request(path, init);
    if (target.pathname.includes("/chunks/")) {
      chunks.push(target.pathname.split("/").at(-1));
      if (chunks.at(-1) === "1" && !lost) {
        lost = true;
        throw new Error("Chunk acknowledgement lost");
      }
    }
    return response;
  };
  try {
    const first = await run(
      [
        "dubbing",
        "source-add",
        "--server",
        "http://studio.invalid",
        "--scope",
        "project",
        "--input",
        JSON.stringify({ file }),
        "--checkpoint",
        checkpoint,
      ],
      { fetchImpl: transport },
    );
    expect(first.code).toBe(1);
    const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
    expect(saved.dubbingSourceId).toBeTruthy();
    const resumed = await run(["resume", checkpoint], { fetchImpl: transport });
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.output).source.phase).toBe("prepared");
    expect(chunks).toEqual(["0", "1"]);
    expect(readFileSync(pg.dubbingSourcePath(saved.dubbingSourceId))).toEqual(bytes);
  } finally {
    pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(["refresh", "import", "link", "retry"])(
  "initial headless Dubbing %s shares the wait deadline and cannot start a late charge",
  async (action) => {
    const dir = mkdtempSync(join(tmpdir(), "dubbing-initial-deadline-")),
      archive = join(dir, "archive"),
      checkpoint = join(dir, "run.json");
    const store = openSharedArchive(archive);
    if (action !== "import")
      store.mutate("dubbing-jobs", (rows) =>
        rows.push({
          id: "saved",
          phase: action === "retry" ? "completed" : action === "link" ? "uncertain" : "processing",
          taskId: action === "link" ? undefined : "remote",
          settings: {
            provider: "elevenlabs",
            voiceId: "actor",
            sourceLanguage: "en",
            targetLanguage: "vi",
            modelId: "eleven_v3",
          },
          createdAt: new Date().toISOString(),
        }),
      );
    store.close();
    let paid = 0,
      first = true;
    const options = {
      globalDir: join(dir, "global"),
      fetchImpl: () => {
        throw Error("No Studio transport");
      },
      controllerOptions: {
        dir: archive,
        env: { GENVOICE_API_KEY: "fixture-only" },
        configFile: join(dir, "no-config"),
        secretsFile: join(dir, "no-secrets"),
        fetchImpl: async (_, init = {}) => {
          if (init.method === "POST") {
            paid++;
            return Response.json({ task_id: "remote", status: "pending" });
          }
          if (first) {
            first = false;
            await new Promise((resolve) => setTimeout(resolve, 2200));
          }
          return Response.json({
            id: "remote",
            status: action === "retry" ? "completed" : "processing",
            provider: "elevenlabs",
            voice_id: "actor",
            source_lang: "en",
            target_lang: "vi",
            updated_at: "2026-11-17T00:00:00Z",
          });
        },
      },
    };
    const args = [
      "dubbing",
      action,
      ...(action === "import" ? [] : ["saved"]),
      "--project",
      dir,
      "--scope",
      "project",
      "--yes",
      "--wait",
      "1",
      "--checkpoint",
      checkpoint,
    ];
    if (action === "import" || action === "link")
      args.push("--input", JSON.stringify({ taskId: "remote" }));
    const started = performance.now();
    try {
      const result = await run(args, options);
      expect(result.code).toBe(1);
      expect(performance.now() - started).toBeLessThan(1600);
      expect(JSON.parse(readFileSync(checkpoint, "utf8")).command).toBe(`dubbing ${action}`);
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(paid).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test.each(["headless-import", "server-global-copy"])(
  "%s exports its archived original through the common recording CLI",
  async (context) => {
    const dir = mkdtempSync(join(tmpdir(), "dubbing-original-export-")),
      audio = join(dir, "original.mp3"),
      out = join(dir, "exported.mp3"),
      archive = join(dir, "project-archive"),
      globalDir = join(dir, "global");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000",
        "-t",
        "0.4",
        audio,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    const controllerOptions = {
      dir: archive,
      globalDir,
      env: { GENVOICE_API_KEY: "fixture-only" },
      configFile: join(dir, "no-config"),
      secretsFile: join(dir, "no-secrets"),
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: async (url, init = {}) => {
        if (init.method && init.method !== "GET") throw Error("Original export must not generate");
        return new URL(url).pathname.endsWith("/remote")
          ? Response.json({
              id: "remote",
              status: "completed",
              provider: "elevenlabs",
              voice_id: "actor",
              source_lang: "en",
              target_lang: "vi",
              source_audio_url: "https://cdn.invalid/original.mp3",
              result: { audio_url: "https://cdn.invalid/result.mp3" },
            })
          : new Response(Bun.file(audio));
      },
    };
    const pg = openVoicePlayground(controllerOptions);
    try {
      const job = await pg.importDubbing("remote");
      let id = job.itemId,
        args;
      const options = {
        globalDir,
        controllerOptions,
        fetchImpl: () => {
          throw Error("No Studio transport");
        },
      };
      if (context === "server-global-copy") {
        id = (await pg.copyToScope(id, "global")).id;
        const api = playgroundExtensions(pg);
        options.fetchImpl = (url, init) => {
          const target = new URL(url);
          return api.request(
            target.pathname.replace("/api/voice/playground", "") + target.search,
            init,
          );
        };
        args = ["--server", "http://studio.invalid", "--scope", "global"];
      } else {
        pg.close();
        args = ["--project", dir, "--scope", "project"];
      }
      const exported = await run(
        [
          "items",
          "export",
          id,
          ...args,
          "--input",
          JSON.stringify({ format: "source" }),
          "--out",
          out,
        ],
        options,
      );
      expect(exported.code).toBe(0);
      expect(readFileSync(out)).toEqual(readFileSync(audio));
    } finally {
      pg.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("an interrupted streamed export preserves the file previously saved at --out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-export-interrupted-")),
    out = join(dir, "original.mp3");
  writeFileSync(out, "previous export");
  try {
    const result = await run(
      [
        "items",
        "export",
        "recording",
        "--server",
        "http://studio.invalid",
        "--scope",
        "global",
        "--input",
        JSON.stringify({ format: "source" }),
        "--out",
        out,
      ],
      {
        fetchImpl: async () => {
          let reads = 0;
          return new Response(
            new ReadableStream({
              pull(controller) {
                if (reads++ === 0) controller.enqueue(new TextEncoder().encode("partial"));
                else controller.error(Error("Connection lost"));
              },
            }),
          );
        },
      },
    );
    expect(result.code).toBe(1);
    expect(readFileSync(out, "utf8")).toBe("previous export");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server Dubbing execution and following observation use one shared wait budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-shared-budget-")),
    checkpoint = join(dir, "run.json");
  let requests = 0;
  const started = performance.now();
  try {
    const result = await run(
      [
        "dubbing",
        "refresh",
        "saved",
        "--server",
        "http://studio.invalid",
        "--wait",
        "1",
        "--checkpoint",
        checkpoint,
      ],
      {
        fetchImpl: async (_, init) => {
          requests++;
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 650);
            init.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(init.signal.reason);
              },
              { once: true },
            );
          });
          return Response.json({
            job: {
              id: "saved",
              phase: requests === 1 ? "processing" : "completed",
              taskId: "remote",
            },
          });
        },
      },
    );
    expect(result.code).toBe(1);
    expect(performance.now() - started).toBeLessThan(1600);
    expect(JSON.parse(readFileSync(checkpoint, "utf8")).dubbingId).toBe("saved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an actual HTTP retry cannot start a paid request after the CLI disconnects during preflight", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dubbing-http-retry-")),
    archive = join(dir, "archive"),
    store = openSharedArchive(archive);
  store.mutate("dubbing-jobs", (rows) =>
    rows.push({
      id: "saved",
      taskId: "remote",
      phase: "completed",
      settings: {
        provider: "elevenlabs",
        voiceId: "actor",
        sourceLanguage: "en",
        targetLanguage: "vi",
        modelId: "eleven_v3",
      },
      createdAt: new Date().toISOString(),
    }),
  );
  store.close();
  let paid = 0,
    reads = 0,
    aborted = false,
    enter,
    release,
    settle,
    disconnect;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    gate = new Promise((resolve) => {
      release = resolve;
    }),
    settled = new Promise((resolve) => {
      settle = resolve;
    }),
    disconnected = new Promise((resolve) => {
      disconnect = resolve;
    });
  const pg = openVoicePlayground({
    dir: archive,
    globalDir: join(dir, "global"),
    env: { GENVOICE_API_KEY: "fixture-only" },
    configFile: join(dir, "no-config"),
    secretsFile: join(dir, "no-secrets"),
    pollIntervalMs: 1,
    fetchImpl: async (_, init = {}) => {
      if (init.method === "POST") {
        paid++;
        return Response.json({ task_id: "remote", status: "pending" });
      }
      if (++reads === 1) {
        aborted = init.signal.aborted;
        init.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        enter();
        await gate;
      }
      return Response.json({
        id: "remote",
        status: reads === 1 ? "completed" : "failed",
        provider: "elevenlabs",
        voice_id: "actor",
        source_lang: "en",
        target_lang: "vi",
      });
    },
  });
  const api = playgroundExtensions(pg),
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        request.signal.addEventListener("abort", () => disconnect(), { once: true });
        const target = new URL(request.url);
        target.pathname = target.pathname.replace("/api/voice/playground", "");
        return api.fetch(new Request(target, request)).finally(() => settle());
      },
    });
  try {
    const pending = run(
      [
        "dubbing",
        "retry",
        "saved",
        "--server",
        server.url.href,
        "--scope",
        "project",
        "--yes",
        "--wait",
        "1",
        "--checkpoint",
        join(dir, "run.json"),
      ],
      { fetchImpl: fetch },
    );
    await entered;
    const result = await pending;
    expect(result.code).toBe(1);
    await disconnected;
    release();
    await settled;
    await pg.waitForAllJobs();
    expect(paid).toBe(0);
    expect(aborted).toBe(true);
  } finally {
    release();
    await server.stop(true);
    pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
