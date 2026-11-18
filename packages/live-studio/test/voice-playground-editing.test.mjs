import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlaygroundEditing } from "../src/voice-playground-editing.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { BUILTIN_GENVOICE_MODELS, openVoicePlayground } from "../src/voice-playground.mjs";
import { openVoice } from "../src/voice.mjs";

const roots = [],
  controllers = [];
afterEach(() => {
  controllers.forEach((pg) => pg.close());
  controllers.length = 0;
  roots.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  roots.length = 0;
});
const open = (dir, options = {}) => {
  const pg = openVoicePlayground({
    project: dir,
    globalDir: join(dir, "global"),
    env: {},
    secretsFile: join(dir, "none"),
    configFile: join(dir, "config"),
    ...options,
  });
  controllers.push(pg);
  return pg;
};

const fixture = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "pg-edit-persistence-"));
  roots.push(dir);
  const pg = open(dir, options),
    pcm = Buffer.alloc(4 * 48000 * 2);
  for (let n = 0; n < 4 * 48000; n++)
    pcm.writeInt16LE(Math.round(6000 * Math.sin((n * 2 * Math.PI * 220) / 48000)), n * 2);
  const audio = wrapPcm16ToWav(pcm, 48000);
  const original = await pg.acceptCopy(
    {
      id: "seed",
      title: "Original",
      text: "One two three",
      kind: "tts",
      voiceId: "actor",
      voiceName: "Actor",
      modelId: "eleven_v4",
      voiceSettings: { stability: 0.5 },
      favorite: true,
      srtText: "1\n00:00:02,000 --> 00:00:03,000\nthree\n",
      wordTimings: [
        { w: "One", s: 0, e: 0.8 },
        { w: "two", s: 1, e: 2 },
        { w: "three", s: 2, e: 3 },
      ],
      durationSeconds: 4,
      createdAt: "2026-01-01T00:00:00Z",
    },
    [["audioFile", "audio", audio, "seed.wav"]],
  );
  return { dir, pg, audio, original };
};

test("opening and previewing a film section leave Recordings alone until a version is saved", async () => {
  const { dir, audio, original } = await fixture();
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 4, takes: [{ id: "01", t: 0, text: original.text }] }),
  );
  const filmAudio = join(dir, "voice/takes/01.wav");
  writeFileSync(filmAudio, audio);
  writeFileSync(
    join(dir, "voice/takes/01.wav.words.json"),
    JSON.stringify({ dur: 4, words: original.wordTimings }),
  );
  const editing = open(dir, { voice: openVoice(dir) });
  const api = playgroundExtensions(editing);
  const edit = { mode: "local", from: 1, to: 2, rate: 2 };
  const post = (path, input) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

  const inspected = await api.request("/film-takes/01/region");
  expect(inspected.status, await inspected.clone().text()).toBe(200);
  const { info, items } = await inspected.json();
  expect(info.durationSeconds).toBeCloseTo(4, 3);
  expect(info.words).toEqual(original.wordTimings);
  expect(items).toEqual([]);
  const query = `?source=${encodeURIComponent(info.id)}`;
  const preview = await post(`/film-takes/01/region-preview${query}`, edit);
  expect(preview.status, await preview.clone().text()).toBe(200);
  expect(preview.headers.get("content-type")).toBe("audio/wav");
  expect(Number(preview.headers.get("x-audio-duration"))).toBeCloseTo(3.5, 3);
  const stale = await post("/film-takes/01/versions?source=stale", edit);
  expect(stale.status).toBe(409);
  expect(editing.listItems().map(({ id }) => id)).toEqual([original.id]);

  const saved = await post(`/film-takes/01/versions${query}`, edit);
  expect(saved.status, await saved.clone().text()).toBe(202);
  const { job } = await saved.json();
  const version = await editing.waitForJob(job.id);
  expect(version.version.parentId).toBe(info.id);
  expect(version.durationSeconds).toBeCloseTo(3.5, 3);
  expect(readFileSync(editing.audioFile(editing.getItem(info.id).audioFile))).toEqual(audio);
  expect(readFileSync(filmAudio)).toEqual(audio);
  const reopened = await api.request("/film-takes/01/region").then((response) => response.json());
  expect(reopened.items.map(({ id }) => id)).toEqual([info.id, version.id]);
}, 60000);

test("local edits retime actual Scribe words and leave stale document exports on the previous version", async () => {
  const { pg, original, audio } = await fixture();
  const transcribed = await pg.acceptCopy(
    {
      ...original,
      wordTimings: undefined,
      sttResult: {
        text: original.text,
        words: [
          { text: " ", start: 1, end: 2, type: "spacing" },
          { text: "three", start: 2, end: 3, speaker_id: "speaker_0" },
        ],
        additional_formats: [{ file_extension: "txt", content: "old export" }],
      },
    },
    [["audioFile", "audio", audio, "transcribed.wav"]],
  );
  const edited = await createPlaygroundEditing({ getController: () => pg }).createVersion(
    transcribed.id,
    { mode: "local", from: 1, to: 2, rate: 2 },
  );
  expect(edited.wordTimings).toEqual([{ w: "three", s: 1.5, e: 2.5, speakerId: "speaker_0" }]);
  expect(edited.sttResult).toBeUndefined();
  expect(pg.getItem(transcribed.id).sttResult.additional_formats).toHaveLength(1);
}, 10000);

test("local versions preserve the original, keep full settings, retime real words/subtitles and survive reopening", async () => {
  const { dir, pg, audio, original } = await fixture();
  const edits = createPlaygroundEditing({ getController: () => pg });
  const edited = await edits.createVersion(original.id, {
    mode: "local",
    from: 1,
    to: 2,
    rate: 2,
    pause: 0.25,
    name: "Faster middle",
  });
  expect(edited).not.toBeNull();
  expect(edited.id).not.toBe(original.id);
  expect(edited.durationSeconds).toBeCloseTo(3.75, 3);
  expect(edited.voiceSettings).toEqual(original.voiceSettings);
  expect(edited.version).toMatchObject({
    rootId: original.id,
    parentId: original.id,
    edit: { mode: "local", from: 1, to: 2, rate: 2, pause: 0.25 },
  });
  expect(edited.wordTimings[2]).toEqual({ w: "three", s: 1.75, e: 2.75 });
  expect(edited.srtText).toContain("00:00:01,750 --> 00:00:02,750");
  expect(readFileSync(pg.audioFile(original.audioFile))).toEqual(audio);
  expect(pg.getItem(original.id).favorite).toBe(true);
  const path = pg.audioFile(edited.audioFile);
  pg.close();
  const reopened = open(dir),
    history = createPlaygroundEditing({ getController: () => reopened }).listVersions(edited.id);
  expect(history.map((item) => item.id)).toEqual([original.id, edited.id]);
  expect(reopened.audioFile(edited.audioFile)).toBe(path);
}, 30000);

test("phrase regeneration waits only for its child job, charges once and invalidates old word alignment", async () => {
  const patch = wrapPcm16ToWav(Buffer.alloc(48000 * 2), 48000);
  const sent = [];
  const { pg, original, audio } = await fixture({
    env: { GENVOICE_API_KEY: "fixture-key" },
    pollIntervalMs: 1,
    maxPollMs: 1000,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (raw, init = {}) => {
      const url = new URL(raw);
      if (url.hostname === "cdn.example.com")
        return new Response(patch, { headers: { "content-type": "audio/wav" } });
      if (url.pathname.endsWith("/models")) return Response.json(BUILTIN_GENVOICE_MODELS);
      if (url.pathname.endsWith("/languages"))
        return Response.json([{ code: "en", name: "English" }]);
      if (url.pathname.endsWith("/default-voices")) return Response.json({ voices: [] });
      if (url.pathname.endsWith("/auth/me")) return Response.json({ credit_balance: 1000 });
      if (init.method === "POST") {
        sent.push(JSON.parse(init.body));
        return Response.json({ id: "replacement_task" });
      }
      if (url.pathname.endsWith("/history/replacement_task"))
        return Response.json({
          id: "replacement_task",
          status: "completed",
          credits_deducted: 7,
          result: { audio_url: "https://cdn.example.com/patch.wav" },
        });
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    },
  });
  const api = playgroundExtensions(pg);
  const response = await api.request(`/items/${original.id}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "regenerate",
      from: 1,
      to: 2,
      replacementText: "[excited] new words",
      fullText: "One [excited] new words three",
      voiceId: "other_actor",
      voiceName: "Other Actor",
      modelId: "eleven_v4",
      fitToSelection: true,
    }),
  });
  expect(response.status).toBe(202);
  const { job } = await response.json();
  await pg.waitForAllJobs();
  expect(job).toMatchObject({
    voiceId: "other_actor",
    voiceName: "Other Actor",
    modelId: "eleven_v4",
  });
  const completed = pg.listJobs().find((item) => item.id === job.id);
  expect(completed.status).toBe("completed");
  const edited = pg.getItem(completed.itemId);
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toBe("[excited] new words");
  expect(edited.text).toBe("One [excited] new words three");
  expect(edited.tags).toEqual(["excited"]);
  expect(edited.creditsDeducted).toBe(7);
  expect(edited.wordTimings).toBeUndefined();
  expect(edited.srtFile).toBeUndefined();
  expect(edited.voicesUsed.map((voice) => voice.voiceId)).toEqual(["actor", "other_actor"]);
  expect(edited.durationSeconds).toBeCloseTo(4, 3);
  expect(readFileSync(pg.audioFile(original.audioFile))).toEqual(audio);
  const copied = await pg.copyToScope(edited.id, "global");
  const recipe = await (await api.request(`/items/${copied.id}/recipe?scope=global`)).json();
  expect(recipe).toMatchObject({
    command: "region resume",
    argument: copied.version.parentId,
    input: { replacementItemId: copied.version.replacement.id, edit: { voiceId: "other_actor" } },
  });
  expect(recipe.input.replacementItemId).not.toBe(edited.version.replacement.id);
  const replay = () =>
    api.request(`/items/${recipe.argument}/versions/resume?scope=global`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipe.input),
    });
  const restored = await Promise.all([replay(), replay()]);
  expect(restored.map(({ status }) => status)).toEqual([202, 202]);
  const jobIds = await Promise.all(
    restored.map(async (response) => (await response.json()).job.id),
  );
  const global = pg.forScope("global");
  await global.waitForAllJobs();
  const replays = global.listJobs().filter(({ id }) => jobIds.includes(id));
  expect(replays.map(({ status }) => status)).toEqual(["completed", "completed"]);
  expect(replays[0].itemId).toBe(replays[1].itemId);
  expect(sent).toHaveLength(1);
}, 10000);

test("region API validates selection before queuing and creates a durable version without a GenVoice key", async () => {
  const { pg, original } = await fixture();
  const api = playgroundExtensions(pg);
  const post = (input) =>
    api.request(`/items/${original.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  expect((await post({ mode: "local", from: 2, to: 1 })).status).toBe(400);
  expect((await post({ mode: "local", from: 0, to: 1, rate: 0 })).status).toBe(400);
  expect((await post({ mode: "local", from: 0, to: 999 })).status).toBe(400);
  expect(pg.listJobs()).toEqual([]);
  const input = { mode: "local", from: 1, to: 2, rate: 2, name: "API version" };
  const response = await post(input);
  expect(response.status).toBe(202);
  const { job } = await response.json();
  expect(job.regionEdit).toMatchObject({ itemId: original.id, input });
  await pg.waitForAllJobs();
  const completed = pg.listJobs().find((item) => item.id === job.id);
  expect(completed.regionEdit).toEqual(job.regionEdit);
  expect(completed.status).toBe("completed");
  expect(pg.getItem(completed.itemId).version.parentId).toBe(original.id);
  const history = await api.request(`/items/${completed.itemId}/versions`);
  expect(history.status).toBe(200);
  expect((await history.json()).items).toHaveLength(2);
  expect((await api.request("/items/unknown/versions")).status).toBe(404);
}, 30000);

test("copying an edited recording to Global carries its complete independent version history", async () => {
  const { pg, original, audio } = await fixture();
  const edited = await pg.startRegionEdit(original.id, { mode: "local", from: 1, to: 2, rate: 2 });
  const version = await pg.waitForJob(edited.job.id);
  const copied = await pg.copyToScope(version.id, "global");
  await pg.deleteItem(original.id);
  await pg.deleteItem(version.id);
  const global = pg.forScope("global");
  const history = global.listVersions(copied.id);
  expect(history).toHaveLength(2);
  expect(history[0].id).toBe(copied.version.rootId);
  expect(copied.version.parentId).toBe(history[0].id);
  expect(readFileSync(global.audioFile(history[0].audioFile))).toEqual(audio);
  expect(history[1].voiceSettings).toEqual(history[0].voiceSettings);
}, 10000);

test.each(["root", "parent"])(
  "a usable version still copies to Global after its %s was explicitly deleted",
  async (removed) => {
    const { pg, original } = await fixture();
    const first = await pg.waitForJob(
      (await pg.startRegionEdit(original.id, { mode: "local", from: 1, to: 2, rate: 2 })).job.id,
    );
    const second = await pg.waitForJob(
      (await pg.startRegionEdit(first.id, { mode: "local", from: 1, to: 2, gainDb: -3 })).job.id,
    );
    const kept = readFileSync(pg.audioFile(second.audioFile)),
      missingId = removed === "root" ? original.id : first.id;
    await pg.deleteItem(missingId);
    const copied = await pg.copyToScope(second.id, "global"),
      global = pg.forScope("global"),
      history = global.listVersions(copied.id);
    expect(history).toHaveLength(2);
    expect(history.some((version) => version.id === copied.version.rootId)).toBe(true);
    expect(
      history.some((version) =>
        Object.values(version.version?.historyGaps ?? {}).some((gap) => gap.id === missingId),
      ),
    ).toBe(true);
    expect(readFileSync(global.audioFile(copied.audioFile))).toEqual(kept);
    expect(
      history.every(
        (version) =>
          !version.version?.parentId ||
          history.some((parent) => parent.id === version.version.parentId),
      ),
    ).toBe(true);
  },
  10000,
);

test("edited word alignment survives film promotion and re-archiving", async () => {
  const { dir, pg, original } = await fixture();
  pg.close();
  const voice = openVoice(dir),
    next = open(dir, { voice });
  const { job } = await next.startRegionEdit(original.id, {
    mode: "local",
    from: 1,
    to: 2,
    rate: 2,
  });
  const edited = await next.waitForJob(job.id);
  const promoted = await next.promoteToFilmTake({ itemId: edited.id, takeId: "01" });
  expect(promoted.ok).toBe(true);
  expect(voice.readWordTimings("try", promoted.tryFile)[2]).toEqual({ w: "three", s: 1.5, e: 2.5 });
  const sidecar = `${voice.audioFile("try", promoted.tryFile)}.words.json`;
  expect(JSON.parse(readFileSync(sidecar, "utf8")).dur).toBeCloseTo(3.5, 3);
  const takeDir = voice.TAKES_DIR;
  mkdirSync(takeDir, { recursive: true });
  writeFileSync(join(takeDir, "01.wav"), readFileSync(next.audioFile(edited.audioFile)));
  writeFileSync(join(takeDir, "01.wav.words.json"), readFileSync(sidecar));
  const readFilm = open(dir, {
    voice: {
      ...voice,
      read: () => ({ takes: [{ id: "01", file: "01.wav", text: original.text, seconds: 3.5 }] }),
    },
  });
  const snapshot = await readFilm.archiveFilmTake("01");
  expect(snapshot.wordTimings).toEqual(edited.wordTimings);
}, 10000);

test("an interrupted phrase edit can finish from the archived replacement without a key or another paid request", async () => {
  const { pg, original, audio } = await fixture();
  const fragment = await pg.acceptCopy(
    {
      ...original,
      title: "Already generated phrase",
      text: "new words",
      voiceId: "other",
      voiceName: "Other",
      creditsDeducted: 7,
    },
    [["audioFile", "audio", audio, "phrase.wav"]],
  );
  const api = playgroundExtensions(pg);
  const response = await api.request(`/items/${original.id}/versions/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      edit: {
        mode: "regenerate",
        from: 1,
        to: 2,
        fullText: "One new words three",
        replacementText: "new words",
        voiceId: "other",
        fitToSelection: true,
      },
      replacementItemId: fragment.id,
    }),
  });
  expect(response.status).toBe(202);
  const { job } = await response.json();
  const result = await pg.waitForJob(job.id);
  expect(result.version.replacement.id).toBe(fragment.id);
  expect(result.creditsDeducted).toBe(0);
  expect(result.version.replacement.creditsDeducted).toBe(7);
  expect(result.durationSeconds).toBeCloseTo(4, 3);
}, 10000);

test("headless film apply keeps the previous recording, resizes its narration brick and marks the chosen version in use", async () => {
  const { dir, pg, original, audio } = await fixture();
  pg.close();
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { soundTimeline: "src/audio.json", sfx: "sound/sfx" } }),
  );
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({
      end: 4,
      takes: [{ id: "01", t: 0, text: original.text }],
      voice: { lines: [[0, 3]], edits: {}, warp: [] },
    }),
  );
  writeFileSync(
    join(dir, "src/audio.json"),
    JSON.stringify({
      narration: "narration",
      beds: [],
      sfx: [{ name: "narration", at: 0, start: 0, length: 3.2, gain: 0 }],
    }),
  );
  writeFileSync(join(dir, "voice/takes/01.wav"), audio);
  writeFileSync(
    join(dir, "voice/takes/01.wav.words.json"),
    JSON.stringify({ dur: 4, words: original.wordTimings }),
  );
  const voice = openVoice(dir, { soundTimeline: "src/audio.json", sfx: "sound/sfx" }),
    next = open(dir, { voice });
  const { job } = await next.startRegionEdit(original.id, {
    mode: "local",
    from: 1,
    to: 2,
    rate: 2,
  });
  const edited = await next.waitForJob(job.id);
  const api = playgroundExtensions(next),
    response = await api.request("/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: edited.id, takeId: "01" }),
    });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(voice.read().takes[0].seconds).toBeCloseTo(3.5, 3);
  expect(voice.read().takes[0].tries).toContain("01_orig.wav");
  expect(JSON.parse(readFileSync(join(dir, "src/audio.json"), "utf8")).sfx[0].length).toBeCloseTo(
    2.7,
    3,
  );
  expect(
    next.listUsage().some((record) => record.itemId === edited.id && record.takeId === "01"),
  ).toBe(true);
  expect(readFileSync(voice.audioFile("try", "01_orig.wav"))).toEqual(audio);
  const versions = next.filmVoiceSnapshot().takes[0].alternatives;
  expect(versions).toEqual(
    expect.arrayContaining([
      { file: "01_orig.wav", title: "Original", active: false },
      expect.objectContaining({ title: edited.title, active: true }),
    ]),
  );
  await voice.useTry({ takeId: "01", tryFile: "01_orig.wav" });
  expect(
    next.filmVoiceSnapshot().takes[0].alternatives.find((version) => version.file === "01_orig.wav")
      .active,
  ).toBe(true);
}, 10000);
