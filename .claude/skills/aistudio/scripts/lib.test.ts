import { expect, test } from "bun:test";

import {
  detectPossibleTruncation,
  formatCopyFailureError,
  formatStoppedRunError,
  toSeconds,
} from "./lib";
import { shouldMigrateChromeDesktop } from "./win32";

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
  ).toBe(true);
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
