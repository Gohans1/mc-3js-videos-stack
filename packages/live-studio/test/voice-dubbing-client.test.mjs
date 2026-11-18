import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stageDubbingUpload } from "../app/sound/voice-dubbing-client";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { openVoicePlayground } from "../src/voice-playground.mjs";

test("browser Dubbing upload resumes a lost acknowledgement from the server's confirmed chunks without generating", async () => {
  const root = mkdtempSync(join(tmpdir(), "dubbing-browser-upload-"));
  const pg = openVoicePlayground({
      dir: root,
      env: {},
      configFile: join(root, "no-config"),
      secretsFile: join(root, "no-secrets"),
      fetchImpl: () => {
        throw Error("Staging must not use GenVoice");
      },
    }),
    api = playgroundExtensions(pg);
  const file = new File([wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000)], "scene.wav", {
    lastModified: 123,
  });
  let saved,
    lost = false,
    chunkRequests = 0;
  const transport = async (path, init) => {
    const response = await api.request(path.replace("/api/voice/playground", ""), init);
    if (path.includes("/chunks/")) {
      chunkRequests++;
      if (!lost) {
        lost = true;
        throw Error("Disconnected after server saved the chunk");
      }
    }
    return response;
  };
  try {
    await expect(
      stageDubbingUpload(file, "project", {
        fetchImpl: transport,
        onProgress: (source) => {
          saved = source;
        },
      }),
    ).rejects.toThrow("Disconnected");
    expect(saved.id).toBeTruthy();
    const source = await stageDubbingUpload(file, "project", {
      fetchImpl: transport,
      sourceId: saved.id,
    });
    expect(source.phase).toBe("prepared");
    expect(chunkRequests).toBe(1);
    expect(readFileSync(pg.dubbingSourcePath(source.id))).toEqual(
      Buffer.from(await file.arrayBuffer()),
    );
    expect(pg.listDubbing()).toEqual([]);
  } finally {
    pg.close();
    rmSync(root, { recursive: true, force: true });
  }
});
