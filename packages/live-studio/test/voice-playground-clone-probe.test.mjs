import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeVoiceSample } from "../src/voice-playground-clone-probe.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
test("clone validation inspects the real audio stream and duration rather than a client-supplied number", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-probe-"));
  try {
    const path = join(dir, "source.wav");
    await Bun.write(path, wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 12), 16000));
    expect(await probeVoiceSample(path)).toEqual({ hasAudio: true, durationSeconds: 12 });
    await Bun.write(join(dir, "invalid.wav"), "not audio");
    await expect(probeVoiceSample(join(dir, "invalid.wav"))).rejects.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
