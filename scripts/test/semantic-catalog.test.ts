import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importedEntries } from "../imported-catalog";

test("a shared vault override includes mocap in the same catalog used for find and embedding builds", () => {
  const root = mkdtempSync(join(tmpdir(), "semantic-shared-mocap-"));
  try {
    const catalog = join(root, "motion/catalog");
    mkdirSync(catalog, { recursive: true });
    writeFileSync(
      join(catalog, "mixamo.jsonl"),
      JSON.stringify({ ref: "mixamo/shared_fixture", dur: 1, start: "stand", end: "stand" }) + "\n",
    );
    const source = new URL("../find.ts", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        "-e",
        `import {allEntries} from ${JSON.stringify(source)}; console.log(JSON.stringify(allEntries(false,${JSON.stringify(root)}).filter(e=>e.kind==='mocap').map(e=>e.id)))`,
      ],
      {
        env: { ...process.env, MC_VAULT_ROOT: root, MC_VAULT_EXTERNAL: root },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["mixamo/shared_fixture"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
import { assetFromEntry } from "../semantic/catalog";

test("a separate catalog retains its source metadata and resolves assets and previews beside the catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "imported-catalog-"));
  const file = join(root, "assets.json");
  try {
    expect(importedEntries(file)).toEqual([]);
    mkdirSync(join(root, "library/effects/snow"), { recursive: true });
    writeFileSync(join(root, "library/effects/snow/preview.mp4"), "offline-preview");
    writeFileSync(
      file,
      JSON.stringify([
        {
          kind: "asset",
          id: "snow",
          cat: "effect",
          title: "Snow",
          about: "Snow falls",
          src: "openfilm",
          data: {
            file: "library/effects/snow/files/page.html",
            upstreamId: "effects/snow",
            license: "CC0",
          },
        },
      ]),
    );
    const entry = importedEntries(file)[0]!;
    expect(entry.data?.file).toBe(join(root, "library/effects/snow/files/page.html"));
    expect(entry.data?.license).toBe("CC0");
    expect(assetFromEntry(entry).media?.file).toBe(join(root, "library/effects/snow/preview.mp4"));
    writeFileSync(file, '[{"id":"broken"}]');
    expect(() => importedEntries(file)).toThrow(/catalog.*row/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an imported HTML asset embeds its actual local video preview, with poster and text fallbacks", () => {
  const root = mkdtempSync(join(tmpdir(), "semantic-preview-"));
  const folder = join(root, "vault/openfilm/library/transitions/wipe");
  mkdirSync(folder, { recursive: true });
  const entry = {
    kind: "asset",
    id: "of-wipe",
    src: "openfilm",
    cat: "transition",
    title: "Wipe",
    about: "Soft panel slides across",
    data: {
      file: "vault/openfilm/library/transitions/wipe/files/wipe.html",
      upstreamId: "transitions/wipe",
    },
  };
  try {
    writeFileSync(join(folder, "poster.jpg"), "offline-poster");
    expect(assetFromEntry(entry, root).media).toEqual({
      kind: "image",
      file: join(folder, "poster.jpg"),
    });
    writeFileSync(join(folder, "preview.mp4"), "offline-video");
    expect(assetFromEntry(entry, root).media).toEqual({
      kind: "video",
      file: join(folder, "preview.mp4"),
    });
    rmSync(join(folder, "preview.mp4"));
    rmSync(join(folder, "poster.jpg"));
    expect(assetFromEntry(entry, root).media).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
