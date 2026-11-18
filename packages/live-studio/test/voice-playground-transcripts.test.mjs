import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runVoicePlaygroundCli } from "../src/voice-playground-cli.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

test("a resumed Scribe transcript keeps its text when shared and accepts the original audio later", async () => {
  const project = mkdtempSync(join(tmpdir(), "pg-recovered-transcript-"));
  const audio = wrapPcm16ToWav(Buffer.alloc(32000), 16000);
  const pg = openVoicePlayground({
    project,
    globalDir: join(project, "global"),
    env: { GENVOICE_API_KEY: "fixture" },
    secretsFile: join(project, "no-secrets"),
    configFile: join(project, "no-config"),
    pollIntervalMs: 1,
    fetchImpl: async (_url, init) => {
      if (init?.method === "POST") throw new Error("Resuming must not submit another task");
      return Response.json({
        status: "completed",
        result: { text: "Xin chào.", language_code: "vi", words: [] },
      });
    },
  });
  try {
    const firstJob = pg.resumeSpeechToText({ taskId: "scribe_recoverable" }).job;
    const { item } = await pg.waitForJob(firstJob.id);
    expect(item.audioFile).toBe("");
    const shared = await pg.copyToScope(item.id, "global");
    expect(shared.text).toBe("Xin chào.");
    await pg.patchItem(item.id, { title: "Take I named", rating: 5 });
    const { sourceFile } = pg.saveSource({ bytes: audio, name: "interview.wav" });
    const resumed = pg.resumeSpeechToText({
      taskId: "scribe_recoverable",
      sourceFile,
      languageCode: "vi",
      seed: 0,
    }).job;
    const restored = (await pg.waitForJob(resumed.id)).item;
    expect(restored).toMatchObject({
      id: item.id,
      title: "Take I named",
      rating: 5,
      transcription: { settings: { languageCode: "vi", seed: 0 } },
    });
    expect(readFileSync(pg.audioFile(restored.audioFile))).toEqual(audio);
  } finally {
    pg.close();
    rmSync(project, { recursive: true, force: true });
  }
});

test("an uploaded transcript survives reopening with its original audio, Scribe recipe and reported fee", async () => {
  const project = mkdtempSync(join(tmpdir(), "pg-transcript-"));
  const audio = wrapPcm16ToWav(Buffer.alloc(16000 * 2), 16000);
  let paid = 0;
  const options = {
    project,
    globalDir: join(project, "global"),
    env: { GENVOICE_API_KEY: "fixture" },
    secretsFile: join(project, "no-secrets"),
    configFile: join(project, "no-config"),
    pollIntervalMs: 1,
    fetchImpl: async (_url, init) => {
      if (init?.method === "POST") {
        paid++;
        return Response.json({ task_id: "scribe_saved" });
      }
      return Response.json({
        status: "completed",
        credits_deducted: 12,
        result: {
          text: "Xin chào.",
          language_code: "vi",
          words: [],
          additional_formats: [
            {
              requested_format: "segmented_json",
              file_extension: "json",
              content: '{"segments":[]}',
            },
            { file_extension: "srt", content: "1\n00:00:00,000 --> 00:00:01,000\nXin chào." },
            {
              file_extension: "pdf",
              content: Buffer.from("%PDF-1.7\nProvider fixture").toString("base64"),
              is_base64_encoded: true,
            },
          ],
        },
      });
    },
  };
  let pg = openVoicePlayground(options);
  try {
    const upload = new FormData();
    upload.set("audio", new File([audio], "My Vietnamese interview.wav", { type: "audio/wav" }));
    const staged = await playgroundExtensions(pg).request("/sources", {
      method: "POST",
      body: upload,
    });
    expect(staged.status).toBe(201);
    const { sourceFile } = await staged.json();
    const scratch = await pg.saveTemplate({
      title: "Interview from scratch",
      draft: {
        mode: "stt",
        sttSourceKind: "upload",
        sttSourceFile: sourceFile,
        sttSourceLabel: "My Vietnamese interview.wav",
        sttLanguageCode: "vi",
      },
    });
    expect(pg.readSource({ sourceFile: scratch.draft.sttSourceFile }).bytes).toEqual(audio);
    expect(paid).toBe(0);
    const result = await pg.runSpeechToText({
      sourceFile,
      sourceLabel: "My Vietnamese interview.wav",
      languageCode: "vi",
      diarize: true,
      numSpeakers: 2,
      keyterms: ["Gohans"],
    });
    expect(result.item.kind).toBe("stt");
    pg.close();
    pg = openVoicePlayground(options);
    const item = pg.getItem(result.item.id);
    expect(item.sttResult.text).toBe("Xin chào.");
    expect(item.sttResult.creditsDeducted).toBe(12);
    expect(item.transcription).toMatchObject({
      sourceLabel: "My Vietnamese interview.wav",
      settings: { languageCode: "vi", diarize: true, numSpeakers: 2, keyterms: ["Gohans"] },
    });
    expect(readFileSync(pg.audioFile(item.audioFile))).toEqual(audio);
    expect(item.srtText).toContain("Xin chào.");
    expect(paid).toBe(1);
    const globalCopy = await pg.copyToScope(item.id, "global");
    const recipe = await pg.saveTemplate({
      title: "Vietnamese interview",
      draft: {
        mode: "stt",
        sttSourceKind: "playground",
        sttSourceItemId: item.id,
        sttLanguageCode: "vi",
        sttDiarize: true,
      },
    });
    const globalRecipe = await pg.copyTemplateToScope(recipe.id, "global");
    await pg.deleteItem(item.id);
    expect(readFileSync(pg.forScope("global").audioFile(globalCopy.audioFile))).toEqual(audio);
    const next = openVoicePlayground({ ...options, project: join(project, "next-film") });
    try {
      const template = next
        .forScope("global")
        .listTemplates()
        .find((saved) => saved.id === globalRecipe.id);
      expect(template.draft.sttSourceKind).toBe("upload");
      expect(
        next.forScope("global").readSource({ sourceFile: template.draft.sttSourceFile }).bytes,
      ).toEqual(audio);
      const recovered = await next.runSpeechToText({
        sourceFile: template.draft.sttSourceFile,
        languageCode: template.draft.sttLanguageCode,
      });
      expect(recovered.item.sttResult.text).toBe("Xin chào.");
      expect(readFileSync(next.audioFile(recovered.item.audioFile))).toEqual(audio);
      expect(paid).toBe(2);
    } finally {
      next.close();
    }
    const api = playgroundExtensions(pg);
    for (const mode of ["headless", "server"]) {
      for (const format of ["txt", "srt", "pdf", "segmented_json"]) {
        const out = join(project, `${mode}.${format}`),
          errors = [];
        const code = await runVoicePlaygroundCli(
          [
            "items",
            "export",
            globalCopy.id,
            ...(mode === "headless"
              ? ["--project", project]
              : ["--server", "http://studio.invalid"]),
            "--scope",
            "global",
            "--input",
            JSON.stringify({ format }),
            "--out",
            out,
          ],
          {
            globalDir: options.globalDir,
            controllerOptions: options,
            out() {},
            err(message) {
              errors.push(message);
            },
            fetchImpl: (url, init) => {
              const target = new URL(url);
              return api.request(
                target.pathname.replace("/api/voice/playground", "") + target.search,
                init,
              );
            },
          },
        );
        expect({ code, errors }).toEqual({ code: 0, errors: [] });
        expect(readFileSync(out, "utf8")).toBe(
          format === "txt"
            ? "Xin chào."
            : format === "pdf"
              ? "%PDF-1.7\nProvider fixture"
              : format === "segmented_json"
                ? '{"segments":[]}'
                : globalCopy.srtText,
        );
      }
    }
    expect(paid).toBe(2);
  } finally {
    pg.close();
    rmSync(project, { recursive: true, force: true });
  }
});

test("a FLAC transcription source keeps its real format and bytes in the archive", async () => {
  const project = mkdtempSync(join(tmpdir(), "pg-stt-flac-")),
    file = join(project, "interview.flac");
  let pg;
  try {
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=330:sample_rate=16000",
        "-t",
        "0.2",
        file,
      ],
      { windowsHide: true, timeout: 30000 },
    );
    pg = openVoicePlayground({
      project,
      env: { GENVOICE_API_KEY: "fixture" },
      secretsFile: join(project, "no-key"),
      configFile: join(project, "no-config"),
      pollIntervalMs: 1,
      fetchImpl: async (_url, init) =>
        Response.json(
          init?.method === "POST"
            ? { task_id: "flac_source" }
            : { status: "completed", result: { text: "Interview", language_code: "en" } },
        ),
    });
    const { item } = await pg.runSpeechToText({
      fileBytes: readFileSync(file),
      fileName: "interview.flac",
      mimeType: "audio/flac",
      languageCode: "en",
    });
    expect(item.audioFile.endsWith(".flac")).toBe(true);
    expect(item.mimeType).toBe("audio/flac");
    expect(readFileSync(pg.audioFile(item.audioFile))).toEqual(readFileSync(file));
    expect(item.sttResult.creditsDeducted).toBeUndefined();
  } finally {
    pg?.close();
    rmSync(project, { recursive: true, force: true });
  }
});
