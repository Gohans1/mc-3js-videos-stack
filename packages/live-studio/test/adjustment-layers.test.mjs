import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.mjs";
import { AdjustmentTimeline } from "../src/contract.mjs";
import { openTimelineFile } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-adjustment-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("a shared grade saves independently of shots and rejects stale or invalid layer edits", async () => {
  writeFileSync(join(dir, "adjust.json"), JSON.stringify({ items: [] }));
  const adjustment = openTimelineFile(dir, "adjust.json", AdjustmentTimeline);
  const app = createApi({ adjustment, keyFiles: [], PUBLIC: join(dir, "public") }, { page: { dir, html: () => "" }, events: {} });
  const post = (base, data) => app.request("/api/adjustment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ base, data }) });
  const before = await (await app.request("/api/adjustment")).json();
  const data = { items: [{ id: "look", name: "Warm scene", from: 1, to: 8, track: 0, grade: { basic: { temp: 25 } } }] };
  assert.equal((await post(before.version, data)).status, 200);
  assert.deepEqual(adjustment.read().data, data);
  assert.equal((await post(before.version, { items: [] })).status, 409);
  const base = adjustment.read().version;
  assert.equal((await post(base, { items: [{ ...data.items[0], to: 0 }] })).status, 400);
  assert.equal((await post(base, { items: [data.items[0], data.items[0]] })).status, 400);
  assert.deepEqual(adjustment.read().data, data);
});
