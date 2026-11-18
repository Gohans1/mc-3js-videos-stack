import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { PIN, writeAssetCatalog } from "../openfilm/catalog.mjs";
import { verifyImport } from "../openfilm/verify.mjs";

test("verification rejects a catalog entry whose editable source was not downloaded", (t) => {
  const home = mkdtempSync(join(tmpdir(), "openfilm-verify-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "library"));
  const item = {
    id: "effects/missing",
    cat: "effect",
    kind: "page",
    src: "missing.html",
    name: { en: "Missing" },
  };
  writeFileSync(join(home, "library/index.json"), JSON.stringify({ items: [item] }));
  writeFileSync(
    join(home, "assets.json"),
    JSON.stringify([
      {
        kind: "asset",
        id: "of-effects-missing",
        data: { upstreamId: item.id, file: "missing.html" },
      },
    ]),
  );
  assert.throws(
    () => verifyImport({ home, vaultSound: join(home, "sound"), log: () => {} }),
    /missing.html/,
  );
});

test("verification requires checksum coverage of every published file, even when a log is missing, partial or padded", (t) => {
  const home = mkdtempSync(join(tmpdir(), "openfilm-checksums-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const library = join(home, "library"),
    id = "stickers/emoji/alien";
  const put = (path, bytes) => {
    const file = join(library, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const item = {
    id,
    kind: "page",
    cat: "sticker",
    group: "faces",
    name: { en: "Alien" },
    src: "emoji.html",
  };
  put("index.json", JSON.stringify({ items: [item] }));
  put(`${id}/files.json`, JSON.stringify(["files/emoji.html", "files/emoji.png", "saved.json"]));
  put(`${id}/files/emoji.html`, '<html><img src="emoji.png"></html>');
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
    "base64",
  );
  put(`${id}/files/emoji.png`, png);
  put(`${id}/saved.json`, "{}");
  writeAssetCatalog([item], library);
  const paths = [
    `${id}/files.json`,
    `${id}/files/emoji.html`,
    `${id}/files/emoji.png`,
    `${id}/saved.json`,
  ];
  const record = (path) => {
    const bytes = readFileSync(join(library, path));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  };
  const records = paths.map(record),
    checkpoint = join(home, "fetch.jsonl");
  const saveLog = (rows) =>
    writeFileSync(checkpoint, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  writeFileSync(
    join(home, "source.json"),
    JSON.stringify({
      commit: PIN,
      sourceHashes: { "index.json": sha(readFileSync(join(library, "index.json"))) },
      downloadedFiles: paths.length,
    }),
  );
  const check = () => verifyImport({ home, vaultSound: join(home, "sound"), log: () => {} });
  saveLog(records);
  assert.equal(check().downloadedFiles, 4);
  put(`${id}/files/emoji.png`, "CORRUPT IMAGE");
  put("unrelated.txt", "unrelated");
  const cases = [
    null,
    records.slice(0, 1),
    Array(4).fill(records[0]),
    [records[0], records[1], records[3], record("unrelated.txt")],
  ];
  for (const rows of cases) {
    if (rows) saveLog(rows);
    else rmSync(checkpoint);
    assert.throws(check, /checksum|checkpoint/i);
  }
  put(`${id}/files/emoji.png`, png);
  saveLog(records);
  assert.equal(check().downloadedFiles, 4);
});

test("verification detects a missing upstream catalog even when all currently listed visual files exist", (t) => {
  const home = mkdtempSync(join(tmpdir(), "openfilm-coverage-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "library"));
  const item = {
    id: "effects/test",
    cat: "effect",
    kind: "page",
    src: "test.html",
    name: { en: "Test" },
  };
  writeFileSync(join(home, "library/index.json"), JSON.stringify({ items: [item] }));
  writeFileSync(join(home, "test.html"), "<html></html>");
  writeFileSync(
    join(home, "assets.json"),
    JSON.stringify([
      { kind: "asset", id: "of-effects-test", data: { upstreamId: item.id, file: "test.html" } },
    ]),
  );
  writeFileSync(
    join(home, "source.json"),
    JSON.stringify({ commit: PIN, sourceHashes: { "audio.json": "expected-original-hash" } }),
  );
  assert.throws(
    () => verifyImport({ home, vaultSound: join(home, "sound"), log: () => {} }),
    /audio.json/,
  );
});
