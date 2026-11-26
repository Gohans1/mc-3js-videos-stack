import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  chipNameClashes,
  detectPossibleTruncation,
  formatCopyFailureError,
  formatStoppedRunError,
  offscreen,
  parseTokenCount,
  planUploads,
  resumeVideoVerificationArgs,
  stripBom,
  toSeconds,
  verifyDeliveredVideoTokens,
  verifyVideoChipTokens,
} from "./lib";
import { TEXT } from "./page-map";
import { shouldMigrateChromeDesktop } from "./win32";

// Each case spawns a fresh `bun ask.ts`; on a loaded Windows machine one cold start alone can take ~5 s.
const CLI_TIMEOUT_MS = 60_000;

// AI Studio rewrites clip times when it saves them (0m2s comes back as 2s), so times compare as seconds.
test("toSeconds reads every spelling the video dialog accepts or writes back", () => {
  expect(toSeconds("2s")).toBe(2);
  expect(toSeconds("0m2s")).toBe(2);
  expect(toSeconds("90s")).toBe(90);
  expect(toSeconds("1m30s")).toBe(90);
  expect(toSeconds("1h2m3s")).toBe(3723);
  expect(toSeconds("1.5s")).toBe(1.5);
  expect(toSeconds("2m")).toBe(120);
});

test("toSeconds rejects text that is not a time", () => {
  expect(toSeconds("")).toBeNaN();
  expect(toSeconds("abc")).toBeNaN();
  expect(toSeconds("1m30")).toBeNaN();
});

test("formatStoppedRunError surfaces AI Studio alerts or thought-only output-cap exhaustion", () => {
  expect(formatStoppedRunError("Quota exceeded", true)).toContain("AI Studio says: Quota exceeded");
  const thoughtMsg = formatStoppedRunError("", true);
  expect(thoughtMsg).toContain("stopped after Thoughts with no answer text");
  expect(thoughtMsg).toContain("reduce input size/tokens");
  expect(thoughtMsg).not.toContain("sidebyside");
  expect(formatStoppedRunError("", false)).toContain("AI Studio shows no message");
});

test("formatCopyFailureError appends AI Studio alerts when present", () => {
  expect(formatCopyFailureError(-1, "Quota exceeded: daily limit")).toBe(
    '"Copy as markdown" of turn -1 copied nothing; AI Studio says: Quota exceeded: daily limit',
  );
  expect(formatCopyFailureError(-1, "")).toBe('"Copy as markdown" of turn -1 copied nothing');
});

test("detectPossibleTruncation flags mid-table, unclosed fence, unclosed bold, and trailing mid-clause cuts without false positives", () => {
  expect(detectPossibleTruncation("| Blocker | 00:30.167–00:32.367 (f905–f971) |")).toBeNull();
  expect(detectPossibleTruncation("| Blocker | 00:30.167–00:32.367 (f905–f971)")).toBe(
    "incomplete trailing markdown table row",
  );
  expect(detectPossibleTruncation("```ts\nconst x = 1;")).toBe("unclosed fenced code block");
  expect(detectPossibleTruncation("```ts\nconst x = 1;\n```")).toBeNull();
  expect(detectPossibleTruncation("Summary: **incomplete bold")).toBe(
    "unclosed bold span on final line",
  );
  expect(detectPossibleTruncation("Summary: **done** and `**code**`")).toBeNull();
  expect(detectPossibleTruncation("First, check the framing,")).toBe(
    "ends mid-clause with trailing punctuation",
  );
  expect(detectPossibleTruncation("## Verdict\nAll checks pass.")).toBeNull();
});

test("shouldMigrateChromeDesktop banishes Default-desktop Chrome into isolated desktops without disrupting peer hidden sessions", () => {
  expect(
    shouldMigrateChromeDesktop({
      livePid: 100,
      recordedPid: 100,
      recordedDesktop: "Default",
      currentDesktop: "exebox-ABC",
      show: false,
      hasVisibleOnCurrentDesktop: false,
    }),
  ).toBe(true);
  expect(
    shouldMigrateChromeDesktop({
      livePid: 100,
      recordedPid: undefined,
      recordedDesktop: undefined,
      currentDesktop: "exebox-ABC",
      show: false,
      hasVisibleOnCurrentDesktop: false,
    }),
  ).toBe(false);
  expect(
    shouldMigrateChromeDesktop({
      livePid: 100,
      recordedPid: 99,
      recordedDesktop: "Default",
      currentDesktop: "exebox-ABC",
      show: false,
      hasVisibleOnCurrentDesktop: false,
    }),
  ).toBe(false);
  expect(
    shouldMigrateChromeDesktop({
      livePid: 100,
      recordedPid: 100,
      recordedDesktop: "exebox-PEER",
      currentDesktop: "exebox-ABC",
      show: false,
      hasVisibleOnCurrentDesktop: false,
    }),
  ).toBe(false);
  expect(
    shouldMigrateChromeDesktop({
      livePid: 100,
      recordedPid: 100,
      recordedDesktop: "exebox-ABC",
      currentDesktop: "Default",
      show: true,
      hasVisibleOnCurrentDesktop: false,
    }),
  ).toBe(true);
  expect(
    shouldMigrateChromeDesktop({
      livePid: 100,
      recordedPid: 100,
      recordedDesktop: "Default",
      currentDesktop: "Default",
      show: false,
      hasVisibleOnCurrentDesktop: true,
    }),
  ).toBe(false);
});

test("parseTokenCount parses integers, fractions, and k/M suffixes while rejecting comma-only and negative strings", () => {
  expect(parseTokenCount("13,971 tokens")).toBe(13_971);
  expect(parseTokenCount("209,131 tokens")).toBe(209_131);
  expect(parseTokenCount("38,182 / 1,048,576 tokens")).toBe(38_182);
  expect(parseTokenCount("215.4k tokens")).toBe(215_400);
  expect(parseTokenCount("9.5k")).toBe(9_500);
  expect(parseTokenCount("1.25M")).toBe(1_250_000);
  expect(parseTokenCount("268 IN")).toBe(268);
  expect(parseTokenCount("Tokens: 9.5k IN")).toBe(9_500);
  expect(parseTokenCount("Tokens: 9.5k IN | 4.4k OUT")).toBe(9_500);
  expect(parseTokenCount("Tokens: 4.4k OUT")).toBeNull();
  expect(parseTokenCount(",")).toBeNull();
  expect(parseTokenCount("-5")).toBeNull();
  expect(parseTokenCount("Agentic")).toBeNull();
  expect(parseTokenCount("")).toBeNull();
});

test("TEXT token patterns capture numerator before context cap and support k/M abbreviations", () => {
  expect("38,182 / 1,048,576 tokens".match(TEXT.totalTokens)?.[1]).toBe("38,182");
  expect("215.4k tokens".match(TEXT.totalTokens)?.[1]).toBe("215.4k");
  expect("246,659 tokens".match(TEXT.totalTokens)?.[1]).toBe("246,659");
  expect("Tokens: 9.5k IN | 4.4k OUT".match(TEXT.turnUsageIn)?.[1]).toBe("9.5");
  expect("Tokens: 9.5k IN | 4.4k OUT".match(TEXT.turnUsageIn)?.[2]).toBe("k");
  expect("209.1k tokens".match(TEXT.chipReady)?.[0]).toBe("209.1k tokens");
});

test("a low AI Studio chip cannot approve a 110-second, 24-fps High window", () => {
  const clip = { durationSec: 215.433, sourceFps: 30 };
  const request = { start: 105, end: 215, fps: 24, media: "High" };
  expect(verifyVideoChipTokens(34_841, clip, request).reason).toMatch(/34,841.*332,640/);
  expect(verifyVideoChipTokens(705_153, clip, request)).toEqual({ floor: 332_640, reason: null });
  expect(verifyVideoChipTokens(34_841, { ...clip, sourceFps: 2 }, request).reason).toBeNull();
});

test("a resumed AI Studio video check retains the higher chip floor and original follow-up baseline", () => {
  expect(resumeVideoVerificationArgs(200_000, 45_000)).toBe(" --min-in-tokens 90000");
  expect(
    resumeVideoVerificationArgs(200_000, 45_000, { lastTurnInTokens: null, topTokens: 70_000 }),
  ).toBe(" --min-in-tokens 90000 --previous-tokens none,70000");
});

test("verifyDeliveredVideoTokens flags IN-token and legacy topTokens downgrades at the 45% floor", () => {
  const downgraded1fps = verifyDeliveredVideoTokens({
    expectedVideoTokens: 209_131,
    actualInTokens: 9_500,
    topTokens: 38_182,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(downgraded1fps.ok).toBe(false);
  expect(downgraded1fps.reason).toContain("silently downgraded");

  const legacyDowngrade = verifyDeliveredVideoTokens({
    expectedVideoTokens: 200_000,
    actualInTokens: null,
    topTokens: 38_000,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(legacyDowngrade.ok).toBe(false);
  expect(legacyDowngrade.reason).toContain("38,000 total");

  expect(
    verifyDeliveredVideoTokens({
      expectedVideoTokens: 10_000,
      actualInTokens: 4_499,
      topTokens: 4_600,
      requestedFps: 24,
      hasNonAgenticVideos: true,
    }).ok,
  ).toBe(false);
  expect(
    verifyDeliveredVideoTokens({
      expectedVideoTokens: 10_000,
      actualInTokens: 4_500,
      topTokens: 4_600,
      requestedFps: 24,
      hasNonAgenticVideos: true,
    }).ok,
  ).toBe(true);
});

test("verifyDeliveredVideoTokens fails closed on missing chip count or missing usage meter and enforces follow-up deltas", () => {
  expect(
    verifyDeliveredVideoTokens({
      expectedVideoTokens: 0,
      actualInTokens: 9_500,
      topTokens: 10_000,
      requestedFps: 24,
      hasNonAgenticVideos: true,
    }).ok,
  ).toBe(false);

  expect(
    verifyDeliveredVideoTokens({
      expectedVideoTokens: 1_000,
      actualInTokens: null,
      topTokens: null,
      requestedFps: 24,
      hasNonAgenticVideos: true,
    }).ok,
  ).toBe(false);

  expect(
    verifyDeliveredVideoTokens({
      expectedVideoTokens: 999,
      actualInTokens: 268,
      topTokens: 467,
      requestedFps: 1,
      requestedMedia: "Low",
      hasNonAgenticVideos: true,
    }).ok,
  ).toBe(true);

  const followUpDowngraded = verifyDeliveredVideoTokens({
    expectedVideoTokens: 200_000,
    actualInTokens: 109_500,
    topTokens: 115_000,
    baselineInTokens: 100_000,
    baselineTopTokens: 105_000,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(followUpDowngraded.ok).toBe(false);
  expect(followUpDowngraded.reason).toContain("9,500 IN");

  const followUpClean = verifyDeliveredVideoTokens({
    expectedVideoTokens: 200_000,
    actualInTokens: 302_000,
    topTokens: 310_000,
    baselineInTokens: 100_000,
    baselineTopTokens: 105_000,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(followUpClean.ok).toBe(true);

  const collectFloorFail = verifyDeliveredVideoTokens({
    expectedVideoTokens: 0,
    actualInTokens: 9_500,
    topTokens: 30_000,
    requestedFps: 24,
    hasNonAgenticVideos: false,
    minDeliveredTokens: 90_000,
  });
  expect(collectFloorFail.ok).toBe(false);

  const collectFloorPass = verifyDeliveredVideoTokens({
    expectedVideoTokens: 0,
    actualInTokens: 95_000,
    topTokens: 100_000,
    requestedFps: 24,
    hasNonAgenticVideos: false,
    minDeliveredTokens: 90_000,
  });
  expect(collectFloorPass.ok).toBe(true);
});

test("verifyDeliveredVideoTokens never allows minDeliveredTokens to lower the chip 45% floor", () => {
  const loweredAttempt = verifyDeliveredVideoTokens({
    expectedVideoTokens: 209_131,
    actualInTokens: 9_500,
    topTokens: 15_000,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
    minDeliveredTokens: 5_000,
  });
  expect(loweredAttempt.ok).toBe(false);
  expect(loweredAttempt.reason).toContain("silently downgraded");

  const raisedFail = verifyDeliveredVideoTokens({
    expectedVideoTokens: 10_000,
    actualInTokens: 7_500,
    topTokens: 8_000,
    requestedFps: 24,
    hasNonAgenticVideos: true,
    minDeliveredTokens: 8_000,
  });
  expect(raisedFail.ok).toBe(false);
  expect(raisedFail.reason).toContain("8,000");

  const raisedPass = verifyDeliveredVideoTokens({
    expectedVideoTokens: 10_000,
    actualInTokens: 8_500,
    topTokens: 9_000,
    requestedFps: 24,
    hasNonAgenticVideos: true,
    minDeliveredTokens: 8_000,
  });
  expect(raisedPass.ok).toBe(true);
});

test("verifyDeliveredVideoTokens fails closed when a follow-up baseline cannot be read", () => {
  const missingBaseline = verifyDeliveredVideoTokens({
    expectedVideoTokens: 200_000,
    actualInTokens: 209_500,
    topTokens: 215_000,
    baselineInTokens: null,
    baselineTopTokens: null,
    requireBaseline: true,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(missingBaseline.ok).toBe(false);
  expect(missingBaseline.reason).toContain("prior token baseline");

  const fallbackTopBaselinePass = verifyDeliveredVideoTokens({
    expectedVideoTokens: 200_000,
    actualInTokens: 300_000,
    topTokens: 305_000,
    baselineInTokens: null,
    baselineTopTokens: 100_000,
    requireBaseline: true,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(fallbackTopBaselinePass.ok).toBe(true);

  const missingTotalBaseline = verifyDeliveredVideoTokens({
    expectedVideoTokens: 200_000,
    actualInTokens: null,
    topTokens: 300_000,
    baselineInTokens: 100_000,
    baselineTopTokens: null,
    requireBaseline: true,
    requestedFps: 24,
    requestedMedia: "High",
    hasNonAgenticVideos: true,
  });
  expect(missingTotalBaseline.ok).toBe(false);
});

test(
  "ask.ts rejects invalid --min-in-tokens values with exit 2 before opening Chrome",
  () => {
    const askScript = resolve(import.meta.dir, "ask.ts");
    for (const bad of ["0", "-1", "abc", "99999999999999999999"]) {
      const res = Bun.spawnSync(["bun", askScript, "--collect", `--min-in-tokens=${bad}`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(res.exitCode).toBe(2);
      expect(res.stderr.toString()).toContain("--min-in-tokens must be a positive integer");
    }
  },
  CLI_TIMEOUT_MS,
);

test("planUploads keeps every file serial and in argument order without --batch", () => {
  const files = ["b.png", "clip.mp4", "a.png"];
  expect(planUploads(files, false)).toEqual({ batch: [], serial: ["b.png", "clip.mp4", "a.png"] });
});

test("planUploads sends every non-video file in one batch and keeps videos serial after it with --batch", () => {
  const files = ["ref.mp4", "b.png", "ours.mp4", "a.jpg"];
  expect(planUploads(files, true)).toEqual({
    batch: ["b.png", "a.jpg"],
    serial: ["ref.mp4", "ours.mp4"],
  });
});

// A batch lands in upload-finish order, so its chips are found by name, and " a.jpg " also sits inside "x a.jpg".
test("chipNameClashes reports names that a chip-text search would also find inside another name", () => {
  expect(chipNameClashes(["a.jpg", "x a.jpg", "b.jpg"])).toEqual([["a.jpg", "x a.jpg"]]);
});

test("chipNameClashes finds nothing when no name sits inside another as a whole word", () => {
  expect(chipNameClashes(["p01.jpg", "p011.jpg", "xa.jpg", "a.jpg"])).toEqual([]);
});

test(
  "ask.ts rejects --batch without any non-video file with exit 2 before opening Chrome",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-batch-"));
    const clip = join(dir, "clip.mp4");
    writeFileSync(clip, new Uint8Array(20_000));
    const res = Bun.spawnSync(["bun", resolve(import.meta.dir, "ask.ts"), "--batch", clip, "hi"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(res.exitCode).toBe(2);
    expect(res.stderr.toString()).toContain("--batch needs at least one non-video file");
  },
  CLI_TIMEOUT_MS,
);

test(
  "ask.ts rejects --batch when one file name sits inside another with exit 2 before opening Chrome",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-batch-"));
    const a = join(dir, "a.jpg");
    const xa = join(dir, "x a.jpg");
    writeFileSync(a, "x");
    writeFileSync(xa, "x");
    const res = Bun.spawnSync(["bun", resolve(import.meta.dir, "ask.ts"), "--batch", a, xa, "hi"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(res.exitCode).toBe(2);
    expect(res.stderr.toString()).toContain('"a.jpg" also appears inside "x a.jpg"');
  },
  CLI_TIMEOUT_MS,
);

test(
  "ask.ts rejects a missing --files-from list with exit 2 before opening Chrome",
  () => {
    const res = Bun.spawnSync(
      ["bun", resolve(import.meta.dir, "ask.ts"), "--files-from", "no-such-list.txt", "hi"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr.toString()).toContain("--files-from list not found: no-such-list.txt");
  },
  CLI_TIMEOUT_MS,
);

test(
  "ask.ts reads attachments from --files-from and validates each listed file",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-list-"));
    const present = join(dir, "a.jpg");
    writeFileSync(present, "x");
    const list = join(dir, "list.txt");
    writeFileSync(list, `${present}\r\n\r\n${join(dir, "gone.jpg")}\n`);
    const res = Bun.spawnSync(
      ["bun", resolve(import.meta.dir, "ask.ts"), "--batch", "--files-from", list, "hi"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr.toString()).toContain(`file not found: ${join(dir, "gone.jpg")}`);
  },
  CLI_TIMEOUT_MS,
);

test("offscreen wraps high slot numbers into 2D columns so top never nears Win32's 32767 limit", () => {
  for (let slot = 0; slot < 60; slot++) {
    const pos = offscreen(slot);
    expect(pos.left).toBeLessThanOrEqual(-10_000);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeLessThan(15_000);
  }
  const coords = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(offscreen(i))));
  expect(coords.size).toBe(40);
});

test("stripBom removes a leading UTF-8 BOM without altering inner text", () => {
  expect(stripBom("\uFEFFhello\nworld")).toBe("hello\nworld");
  expect(stripBom("hello\uFEFFworld")).toBe("hello\uFEFFworld");
});

test(
  "studio.ts rejects combining chrome --show and --keepalive with exit 2",
  () => {
    const res = Bun.spawnSync(
      ["bun", resolve(import.meta.dir, "studio.ts"), "chrome", "--show", "--keepalive"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr.toString()).toContain("--show and --keepalive cannot be combined");
  },
  CLI_TIMEOUT_MS,
);
