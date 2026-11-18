import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { openVoicePlayground as openController } from "../src/voice-playground.mjs";

const roots = [];
const controllers = [];
const openVoicePlayground = (options) => {
  const controller = openController(options);
  controllers.push(controller);
  return controller;
};
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("a project archive copies complete takes to a shared global library and survives reopening", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-scopes-"));
  roots.push(root);
  const project = join(root, "film-a"),
    globalDir = join(root, "global");
  const dir = join(project, "voice", "playground");
  for (const folder of ["audio", "srt", "sources"])
    mkdirSync(join(dir, folder), { recursive: true });
  const item = {
    id: "pg_legacy",
    kind: "voice_changer",
    title: "Take A",
    text: "Hello",
    provider: "elevenlabs",
    audioFile: "pg_legacy.wav",
    srtFile: "pg_legacy.srt",
    favorite: true,
    voiceSettings: { stability: 0.5 },
    voiceChanger: { sourceFile: "src_legacy.wav", sourceLabel: "Original" },
    createdAt: "2026-01-01T00:00:00Z",
  };
  writeFileSync(join(dir, "items.json"), JSON.stringify({ version: 1, items: [item] }));
  writeFileSync(join(dir, "audio", item.audioFile), "audio bytes");
  writeFileSync(join(dir, "srt", item.srtFile), "subtitles");
  writeFileSync(join(dir, "sources", item.voiceChanger.sourceFile), "source bytes");
  const a = openVoicePlayground({ project, globalDir, env: {}, secretsFile: join(root, "none") });
  const b = openVoicePlayground({
    project: join(root, "film-b"),
    globalDir,
    env: {},
    secretsFile: join(root, "none"),
  });
  expect(b.listItems()).toEqual([]);
  const copied = await a.copyToScope(item.id, "global");
  expect(copied.id).not.toBe(item.id);
  expect(copied.voiceSettings).toEqual(item.voiceSettings);
  expect(copied.favorite).toBe(true);
  const global = b.forScope("global");
  expect(global.listItems()).toHaveLength(1);
  expect(b.listItems({ includeGlobal: true }).map((x) => x.scope)).toEqual(["global"]);
  expect(readFileSync(global.audioFile(copied.audioFile), "utf8")).toBe("audio bytes");
  expect(readFileSync(global.srtFile(copied.srtFile), "utf8")).toBe("subtitles");
  expect(
    readFileSync(join(global.storageDir, "sources", copied.voiceChanger.sourceFile), "utf8"),
  ).toBe("source bytes");
  await a.deleteItem(item.id);
  expect(global.getItem(copied.id).title).toBe("Take A");
  const reopened = openVoicePlayground({
    project,
    globalDir,
    env: {},
    secretsFile: join(root, "none"),
  });
  expect(reopened.forScope("global").listItems()).toHaveLength(1);
  await global.copyToScope(copied.id, "project");
  expect(b.listItems()).toHaveLength(1);
  a.close();
  b.close();
  reopened.close();
});

test("global voice favorites retain casting metadata and distinguish providers", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-favs-"));
  roots.push(root);
  const pg = openVoicePlayground({
    project: root,
    globalDir: join(root, "global"),
    env: {},
    secretsFile: join(root, "none"),
  });
  await pg.setVoiceFavorite(
    {
      id: "narrator",
      name: "Old narrator",
      provider: "minimax",
      age: "Elderly",
      accent: "British",
      language: "English",
    },
    true,
  );
  await pg.setVoiceFavorite(
    { id: "narrator", name: "Other narrator", provider: "elevenlabs" },
    true,
  );
  expect(pg.listVoiceFavorites()).toHaveLength(2);
  await pg.setVoiceFavorite({ id: "narrator", provider: "elevenlabs" }, false);
  expect(pg.listVoiceFavorites()[0]).toMatchObject({
    name: "Old narrator",
    age: "Elderly",
    provider: "minimax",
  });
  pg.close();
});

test("expiry in another film preserves Global audio a film uses and removes unused audio", async () => {
  const root = mkdtempSync(join(tmpdir(), "voice-global-expiry-"));
  roots.push(root);
  const globalDir = join(root, "global");
  const take = join(root, "current.wav");
  const trial = join(root, "trial.wav");
  const audio = Buffer.from("the same take audio");
  writeFileSync(take, audio);
  writeFileSync(trial, audio);
  const filmA = openVoicePlayground({
    project: join(root, "film-a"),
    globalDir,
    env: {},
    secretsFile: join(root, "none"),
    voice: {
      read: () => ({ takes: [{ id: "01", file: "01.wav" }] }),
      audioFile: (folder) => (folder === "try" ? trial : take),
    },
  }).forScope("global");
  const filmB = openVoicePlayground({
    project: join(root, "film-b"),
    globalDir,
    env: {},
    secretsFile: join(root, "none"),
  }).forScope("global");
  const old = "2025-01-01T00:00:00Z";
  const save = (id) =>
    filmA.acceptCopy(
      { id, title: id, kind: "tts", archivedAt: old },
      [["audioFile", "audio", audio, "take.wav"]],
      { id },
    );
  const used = await save("used");
  const source = await save("source");
  const preview = await save("preview");
  const spare = await save("spare");
  await filmA.recordUsage({ itemId: used.id, takeId: "01", tryFile: "01_trial.wav" });
  const project = filmA.forScope("project");
  expect(project.readSource({ sourceItemId: source.id }).bytes).toEqual(audio);
  const file =
    process.platform === "win32"
      ? preview.audioFile.replace(/^preview/, "PREVIEW")
      : preview.audioFile;
  project.saveVoiceProfile({
    voice: { id: "preview_actor", previewUrl: `/api/voice/playground/audio/${file}?scope=global` },
  });
  expect(filmB.previewExpiredRecordings()).toMatchObject({
    eligible: [{ id: spare.id }],
    protected: 3,
  });
  expect(filmB.recordingArchivePolicy(spare.id)).toEqual({
    deleteAfter: "2025-01-31T00:00:00.000Z",
  });
  for (const item of [used, source, preview]) {
    expect(filmB.recordingArchivePolicy(item.id)).toEqual({ deleteAfter: null });
  }
  expect(
    (await filmB.purgeExpiredRecordings([used.id, source.id, preview.id, spare.id])).purged,
  ).toEqual([spare.id]);
  expect(filmB.recordingArchivePolicy(spare.id)).toBeNull();
  for (const item of [used, source, preview])
    expect(readFileSync(filmB.audioFile(item.audioFile))).toEqual(audio);
  expect(filmA.listUsage()[0].itemId).toBe(used.id);
});

test("existing film recordings archive globally and comparison snapshots keep their audio after a film swap", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-film-archive-"));
  roots.push(root);
  const project = join(root, "film-a"),
    globalDir = join(root, "global");
  mkdirSync(project, { recursive: true });
  const active = join(project, "01.wav");
  writeFileSync(active, "original recording");
  let take = {
    id: "01",
    file: "01.wav",
    voice: "actor_a",
    model: "eleven_v4",
    text: "A line to keep",
    seconds: 2.5,
    speed: 0.8,
    stability: 0.5,
  };
  const pg = openVoicePlayground({
    project,
    globalDir,
    env: {},
    secretsFile: join(root, "none"),
    voice: { read: () => ({ takes: [take] }), audioFile: () => active },
  });
  const api = playgroundExtensions(pg);
  const response = await api.request("/film-takes/01/copies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "global", voiceName: "Actor A" }),
  });
  expect(response.status).toBe(201);
  const { item: global } = await response.json();
  expect(global).toMatchObject({
    scope: "global",
    text: take.text,
    voiceId: "actor_a",
    voiceSettings: { speed: 0.8, stability: 0.5 },
  });
  expect(global.creditsDeducted).toBeUndefined();
  const snapshot = await pg.archiveFilmTake("01");
  take = { ...take, voice: "actor_b", text: "A new line" };
  writeFileSync(active, "different recording now selected");
  expect(readFileSync(pg.audioFile(snapshot.audioFile), "utf8")).toBe("original recording");
  expect(readFileSync(pg.forScope("global").audioFile(global.audioFile), "utf8")).toBe(
    "original recording",
  );
  expect(pg.getItem(snapshot.id).voiceId).toBe("actor_a");
  const other = openVoicePlayground({
    project: join(root, "film-b"),
    globalDir,
    env: {},
    secretsFile: join(root, "none"),
  });
  expect(other.listItems({ includeGlobal: true }).map((item) => item.id)).toEqual([global.id]);
});

test("templates are editable without generation, copy to Global and stay separate from other projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-templates-"));
  roots.push(root);
  const options = { globalDir: join(root, "global"), env: {}, secretsFile: join(root, "none") };
  const a = openVoicePlayground({ ...options, project: join(root, "a") });
  const b = openVoicePlayground({ ...options, project: join(root, "b") });
  const draft = {
    mode: "tts",
    text: "[happy] Hello",
    modelId: "eleven_v4",
    voiceId: "actor",
    stability: 0.5,
    seedText: "123",
    variations: 3,
  };
  const template = await a.saveTemplate({ title: "Warm narrator", draft });
  expect(a.listItems()).toEqual([]);
  expect(a.listTemplates()).toHaveLength(1);
  expect(b.listTemplates({ includeGlobal: true })).toEqual([]);
  const global = await a.copyTemplateToScope(template.id, "global");
  expect(b.listTemplates({ includeGlobal: true })[0]).toMatchObject({ scope: "global", draft });
  await a.forScope("global").saveTemplate({
    id: global.id,
    title: "Warm narrator v2",
    draft: { ...draft, stability: 1 },
    favorite: true,
  });
  expect(b.listTemplates({ includeGlobal: true })[0]).toMatchObject({
    title: "Warm narrator v2",
    favorite: true,
  });
  expect(a.listTemplates()[0].draft.stability).toBe(0.5);
  a.close();
  b.close();
});

test("in-use marks follow the selected audio, not merely an archived copy", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-used-"));
  roots.push(root);
  const dir = join(root, "voice", "playground");
  mkdirSync(join(dir, "audio"), { recursive: true });
  const active = join(root, "active.wav"),
    trial = join(root, "trial.wav");
  writeFileSync(active, "selected audio");
  writeFileSync(trial, "selected audio");
  writeFileSync(join(dir, "audio", "pg_a.wav"), "selected audio");
  writeFileSync(
    join(dir, "items.json"),
    JSON.stringify({
      items: [
        {
          id: "pg_a",
          audioFile: "pg_a.wav",
          voiceId: "actor",
          provider: "elevenlabs",
          dialogue: {
            speakers: {
              Alex: { voice_id: "actor", voice_name: "Alex voice", model_id: "eleven_v4" },
              Riley: { voice_id: "other", voice_name: "Riley voice", model_id: "eleven_v3" },
            },
          },
        },
      ],
    }),
  );
  const pg = openVoicePlayground({
    project: root,
    globalDir: join(root, "global"),
    env: {},
    secretsFile: join(root, "none"),
    voice: {
      read: () => ({ takes: [{ id: "01", file: "01.wav" }] }),
      audioFile: (kind) => (kind === "takes" ? active : trial),
    },
  });
  expect(pg.listUsage()).toEqual([]);
  await pg.recordUsage({ itemId: "pg_a", takeId: "01", tryFile: "01_trial.wav" });
  expect(pg.listUsage()[0]).toMatchObject({ itemId: "pg_a", takeId: "01", scope: "project" });
  expect(pg.listUsage()[0].voices).toEqual([
    { voiceId: "actor", voiceName: "Alex voice", provider: "elevenlabs" },
    { voiceId: "other", voiceName: "Riley voice", provider: "elevenlabs" },
  ]);
  const usage = await playgroundExtensions(pg).request("/voices/usage");
  expect(usage.status).toBe(200);
  expect((await usage.json()).voices).toEqual([
    expect.objectContaining({ voiceId: "actor", inFilm: 1, recordings: 1, takeIds: ["01"] }),
    expect.objectContaining({ voiceId: "other", inFilm: 1, recordings: 1, takeIds: ["01"] }),
  ]);
  writeFileSync(active, "another take now selected");
  expect(pg.listUsage()).toEqual([]);
  await expect(
    pg.recordUsage({ itemId: "pg_a", takeId: "01", tryFile: "01_trial.wav" }),
  ).rejects.toThrow("selected audio changed");
  pg.close();
});

test("a Voice Changer template saved globally carries its source audio into another project", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-template-source-"));
  roots.push(root);
  const opts = { globalDir: join(root, "global"), env: {}, secretsFile: join(root, "none") };
  const a = openVoicePlayground({ ...opts, project: join(root, "a") });
  const b = openVoicePlayground({ ...opts, project: join(root, "b") });
  const source = a.saveSource({ bytes: Buffer.from("original source"), name: "actor.wav" });
  const template = await a.forScope("global").saveTemplate({
    title: "Character",
    draft: {
      mode: "voice_changer",
      vcSourceKind: "upload",
      vcSourceFile: source.sourceFile,
      voiceId: "actor",
      modelId: "eleven_multilingual_sts_v2",
    },
  });
  const saved = b.listTemplates({ includeGlobal: true })[0];
  expect(saved.id).toBe(template.id);
  const updated = await b.forScope("global").saveTemplate({
    id: saved.id,
    title: "Character revised",
    draft: { ...saved.draft, stability: 0.8 },
  });
  expect(updated.draft.vcSourceFile).toBe(saved.draft.vcSourceFile);
  expect(
    readFileSync(
      join(b.forScope("global").storageDir, "sources", saved.draft.vcSourceFile),
      "utf8",
    ),
  ).toBe("original source");
  b.saveSource({ bytes: Buffer.from("unrelated upload"), name: "other.wav" });
  expect(b.readSource({ sourceFile: saved.draft.vcSourceFile }).bytes.toString()).toBe(
    "original source",
  );
  const local = await b.forScope("global").copyTemplateToScope(saved.id, "project");
  expect(local.scope).toBe("project");
  expect(b.readSource({ sourceFile: local.draft.vcSourceFile }).bytes.toString()).toBe(
    "original source",
  );
  a.close();
  b.close();
});

test("template HTTP routes validate snapshots and keep a Global copy editable from another project", async () => {
  const root = mkdtempSync(join(tmpdir(), "pg-template-http-"));
  roots.push(root);
  const pg = openVoicePlayground({
    project: root,
    globalDir: join(root, "global"),
    env: {},
    secretsFile: join(root, "none"),
  });
  const api = playgroundExtensions(pg);
  const post = (path, body, method = "POST") =>
    api.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await post("/templates", { title: "Invalid", draft: { mode: "tts", text: 42 } })).status,
  ).toBe(400);
  expect((await api.request("/templates?scope=other-project")).status).toBe(400);
  const draft = {
    mode: "tts",
    text: "Hello",
    voiceId: "actor",
    modelId: "eleven_v4",
    seedText: "123",
    speed: 0.9,
  };
  const voicePreviewUrl = "/api/voice/playground/audio/clone-sample.wav?scope=project";
  const created = await post("/templates", {
    title: "Narrator",
    draft: { ...draft, voicePreviewUrl },
  });
  expect(created.status).toBe(201);
  const { template } = await created.json();
  expect(template.draft.voicePreviewUrl).toBe(voicePreviewUrl);
  const copy = await (await post(`/templates/${template.id}/copies`, { scope: "global" })).json();
  expect(copy.template.scope).toBe("global");
  expect(copy.template.draft).toEqual(draft);
  const updated = await post(
    `/templates/${copy.template.id}?scope=global`,
    { favorite: true },
    "PATCH",
  );
  expect((await updated.json()).template).toMatchObject({ favorite: true, draft });
  const list = await (await api.request("/templates?includeGlobal=1")).json();
  expect(list.templates).toHaveLength(2);
  await post(
    "/voice-favorites",
    { favorite: true, voice: { id: "sample", name: "Demo", previewUrl: "" } },
    "PUT",
  );
  expect((await (await api.request("/voice-favorites")).json()).voices[0].id).toBe("sample");
  pg.close();
});
