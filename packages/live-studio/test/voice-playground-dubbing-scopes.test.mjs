import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

test("a Global dubbing copy owns its video, audio, original source and translated subtitles independently of its project", async () => {
  const root = mkdtempSync(join(tmpdir(), "dubbing-scopes-"));
  const dir = join(root, "project-a"),
    globalDir = join(root, "global");
  const item = {
    id: "pg_dub_one",
    kind: "dubbing",
    title: "Vietnamese scene",
    audioFile: "pg_dub_one.mp3",
    srtFile: "pg_dub_one.srt",
    dubbing: {
      taskId: "cloud_one",
      sourceFile: "dubsrc_one.mp4",
      resultFile: "pg_dub_one.mp4",
      sourceLanguage: "en",
      targetLanguage: "vi",
    },
    createdAt: new Date().toISOString(),
  };
  for (const folder of ["audio", "srt", "video", "sources"])
    mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, "items.json"), JSON.stringify({ items: [item] }));
  writeFileSync(join(dir, "audio", item.audioFile), "audio bytes");
  writeFileSync(join(dir, "srt", item.srtFile), "translated words");
  writeFileSync(join(dir, "video", item.dubbing.resultFile), "dubbed video bytes");
  writeFileSync(join(dir, "sources", item.dubbing.sourceFile), "original source bytes");
  const a = openVoicePlayground({
    dir,
    globalDir,
    env: {},
    configFile: join(root, "no-config"),
    secretsFile: join(root, "no-secrets"),
  });
  const b = openVoicePlayground({
    dir: join(root, "project-b"),
    globalDir,
    env: {},
    configFile: join(root, "no-config"),
    secretsFile: join(root, "no-secrets"),
  });
  try {
    expect(b.listItems({ includeGlobal: true })).toEqual([]);
    const copy = await a.copyToScope(item.id, "global");
    const global = b.forScope("global");
    expect(b.listItems({ includeGlobal: true }).map((entry) => entry.id)).toEqual([copy.id]);
    expect(readFileSync(global.dubbingAsset(copy.id, "source"), "utf8")).toBe(
      "original source bytes",
    );
    expect(readFileSync(global.dubbingAsset(copy.id, "result"), "utf8")).toBe("dubbed video bytes");
    expect(readFileSync(global.audioFile(copy.audioFile), "utf8")).toBe("audio bytes");
    expect(readFileSync(global.srtFile(copy.srtFile), "utf8")).toBe("translated words");
    const legacy = await a.acceptCopy(
      {
        ...item,
        version: {
          rootId: item.id,
          parentId: item.id,
          edit: { mode: "local", from: 0, to: 0.1 },
          regionSeconds: 0.1,
        },
      },
      [["audioFile", "audio", Buffer.from("legacy edited audio"), "legacy.wav"]],
    );
    await a.deleteItem(legacy.id);
    expect(readFileSync(a.dubbingAsset(item.id, "result"), "utf8")).toBe("dubbed video bytes");
    await a.deleteItem(item.id);
    expect(readFileSync(global.dubbingAsset(copy.id, "result"), "utf8")).toBe("dubbed video bytes");
    expect(readFileSync(join(dir, "sources", item.dubbing.sourceFile), "utf8")).toBe(
      "original source bytes",
    );
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Dubbing template keeps full settings and an independent Global source for future projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "dubbing-template-")),
    globalDir = join(root, "global");
  const options = {
    globalDir,
    env: {},
    configFile: join(root, "no-config"),
    secretsFile: join(root, "no-secrets"),
  };
  const a = openVoicePlayground({ ...options, project: join(root, "a") }),
    b = openVoicePlayground({ ...options, project: join(root, "b") });
  const original = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000),
    api = playgroundExtensions(a);
  try {
    const source = await a.stageDubbingFile(new File([original], "scene.wav"));
    const response = await api.request("/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Vietnamese narrator",
        draft: {
          mode: "dubbing",
          dubbing: {
            sourceId: source.id,
            sourceLanguage: "en",
            targetLanguage: "vi",
            provider: "minimax",
            voiceId: "Wise_Woman",
            ttsVoiceId: "123",
            voiceName: "Wise Woman",
          },
        },
      }),
    });
    expect(response.status).toBe(201);
    const { template } = await response.json();
    const global = await a.copyTemplateToScope(template.id, "global");
    expect(global.draft.dubbing.sourceId).not.toBe(source.id);
    expect(global.draft.dubbing).toMatchObject({
      sourceLanguage: "en",
      targetLanguage: "vi",
      provider: "minimax",
      voiceId: "Wise_Woman",
      ttsVoiceId: "123",
    });
    const saved = b.listTemplates({ includeGlobal: true })[0];
    expect(
      readFileSync(b.forScope("global").dubbingSourcePath(saved.draft.dubbing.sourceId)),
    ).toEqual(original);
    const copied = await playgroundExtensions(b).request("/dubbing/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: saved.draft.dubbing.sourceId, sourceScope: "global" }),
    });
    expect(copied.status).toBe(201);
    const projectSource = (await copied.json()).source;
    expect(projectSource.id).not.toBe(saved.draft.dubbing.sourceId);
    expect(readFileSync(b.dubbingSourcePath(projectSource.id))).toEqual(original);
    const edited = await b.forScope("global").saveTemplate({
      id: saved.id,
      title: "Second version",
      draft: {
        ...saved.draft,
        dubbing: { ...saved.draft.dubbing, voiceId: "Other_Actor", ttsVoiceId: "456" },
      },
    });
    expect(edited.draft.dubbing.sourceId).toBe(saved.draft.dubbing.sourceId);
    expect(a.listTemplates()[0].draft.dubbing.voiceId).toBe("Wise_Woman");
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a saved Global recording can supply a reusable Dubbing source without downloading and re-uploading it in the browser", async () => {
  const root = mkdtempSync(join(tmpdir(), "dubbing-recording-source-")),
    dir = join(root, "global"),
    audio = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000);
  mkdirSync(join(dir, "audio"), { recursive: true });
  writeFileSync(join(dir, "audio", "recording.wav"), audio);
  const pg = openVoicePlayground({
    dir: join(root, "project"),
    globalDir: dir,
    env: {},
    configFile: join(root, "no-config"),
    secretsFile: join(root, "no-secrets"),
    fetchImpl: () => {
      throw Error("Source copies are local and free");
    },
  });
  const global = pg.forScope("global"),
    api = playgroundExtensions(pg);
  try {
    const item = await global.acceptCopy(
      {
        id: "recording",
        kind: "tts",
        title: "Saved narration",
        audioFile: "recording.wav",
        createdAt: new Date().toISOString(),
      },
      [["audioFile", "audio", audio, "recording.wav"]],
    );
    const request = () =>
      api.request("/dubbing/sources?scope=global", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, asset: "audio" }),
      });
    const response = await request();
    expect(response.status).toBe(201);
    const { source } = await response.json();
    expect(source.phase).toBe("prepared");
    expect(source.filename).toBe("Saved narration.wav");
    expect(readFileSync(global.dubbingSourcePath(source.id))).toEqual(audio);
    expect((await (await request()).json()).source.id).toBe(source.id);
    await global.deleteItem(item.id);
    expect(readFileSync(global.dubbingSourcePath(source.id))).toEqual(audio);
  } finally {
    pg.close();
    rmSync(root, { recursive: true, force: true });
  }
});
