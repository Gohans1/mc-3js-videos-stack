import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApi } from "../src/api.mjs";
import { openFilm } from "../src/film.mjs";

test("the CLI edits and validates a film-local HTML layer without a catalog entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "direct-page-cli-"));
  cpSync(join(import.meta.dir, "fixtures/direct-edit-film"), dir, {
    recursive: true,
    filter: (file) => !file.includes("renders"),
  });
  try {
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [join(import.meta.dir, "../../../scripts/openfilm-use.mjs"), ...args, "--film", dir],
        { encoding: "utf8", timeout: 20000 },
      );
    const used = run("use", "/custom-title.html", "--from", "1", "--to", "4");
    expect(used.stderr).toBe("");
    expect(used.status).toBe(0);
    const checked = run("validate");
    expect(checked.status).toBe(0);
    expect(JSON.parse(checked.stdout).valid).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("a local AI page loads as HTML and its element edits survive timeline save and reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "direct-page-api-"));
  cpSync(join(import.meta.dir, "fixtures/direct-edit-film"), dir, {
    recursive: true,
    filter: (file) => !file.includes("renders"),
  });
  const film = openFilm(dir, { send() {} });
  try {
    const app = createApi(film, {
      page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
      events: new Set(),
      send() {},
    });
    const page = await app.request("/custom-title.html");
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("window.film");
    const compressed = await app.request("/custom-title.html", {
      headers: { "accept-encoding": "br" },
    });
    expect(compressed.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const current = await (await app.request("/api/openfilm")).json();
    current.data.items[0].elements = [
      { selector: "#page-title", text: "Human title ", style: { color: "#00ff00" } },
    ];
    const saved = await app.request("/api/openfilm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: current.version, data: current.data }),
    });
    expect(saved.status).toBe(200);
    const reopened = await (await app.request("/api/openfilm")).json();
    expect(reopened.data.items[0].elements).toEqual(current.data.items[0].elements);
  } finally {
    film.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
