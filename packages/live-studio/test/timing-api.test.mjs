import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApi } from "../src/api.mjs";
import { TimingTimeline } from "../src/contract.ts";
import { openTimelineFile } from "../src/timeline_file.mjs";

test("film timing persists speed and freeze, rejecting overlapping speeds and stale edits", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-timing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "timing.json"), "{}");
  const timing = openTimelineFile(dir, "timing.json", TimingTimeline);
  const app = createApi(
    { timing, keyFiles: [], PUBLIC: join(dir, "public") },
    { page: { dir, html: () => "" }, events: {} },
  );
  const post = (base, data) =>
    app.request("/api/timing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base, data }),
    });
  const before = await (await app.request("/api/timing")).json();
  const data = {
    speeds: [
      {
        from: 5,
        to: 10,
        curve: [
          [0, 1],
          [1, 4],
        ],
        handles: [[1, 4]],
      },
    ],
    freezes: [{ at: 12, duration: 3 }],
  };
  assert.equal((await post(before.version, data)).status, 200);
  assert.deepEqual(timing.read().data, data);
  assert.equal(
    TimingTimeline.safeParse({ speeds: [{ ...data.speeds[0], handles: [] }] }).success,
    false,
  );
  assert.equal((await post(before.version, {})).status, 409);
  const invalid = { speeds: [data.speeds[0], { from: 8, to: 12, rate: 2 }] };
  assert.equal((await post(timing.read().version, invalid)).status, 400);
  assert.deepEqual(timing.read().data, data);
});
