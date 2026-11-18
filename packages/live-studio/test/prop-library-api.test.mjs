import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApi } from "../src/api.mjs";

const setup = (t) => {
  const root = mkdtempSync(join(tmpdir(), "studio-props-"));
  const PROJECT = join(root, "film");
  const vault = join(root, "vault");
  const write = (path, content) => {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = createApi(
    { PROJECT, PUBLIC: join(PROJECT, "assets/public"), LITE: join(PROJECT, "lite") },
    {
      page: { dir: PROJECT, html: () => "", error: () => null },
      events: new Set(),
      send: () => {},
      propVault: vault,
    },
  );
  return { root, app, write };
};

const preview = (scope, path) => "/api/props/preview?" + new URLSearchParams({ scope, path });

test("lists fresh Global and Film props, including nested files and same-stem previews", async (t) => {
  const { app, write } = setup(t);
  const catalog = async () => (await app.request("/api/props")).json();
  assert.deepEqual(await catalog(), { global: [], film: [] });

  write("vault/props/chairs/oak.png", "global image");
  write("film/src/props/chairs/oak.ts", 'throw new Error("preview must never execute source")');
  write("film/src/props/chairs/oak.jpg", "film image");
  write("film/src/props/chairs/oak.glb", "model bytes");
  write("film/src/props/car.ts", "source only");
  write("film/src/props/.private/scrap.png", "private");
  const listed = await catalog();
  assert.deepEqual(
    listed.global.map(({ id, image }) => [id, image.path]),
    [["chairs/oak", "chairs/oak.png"]],
  );
  assert.deepEqual(
    listed.film.map(({ id, source, image, model }) => [id, source, image?.path, model?.path]),
    [
      ["car", "car.ts", undefined, undefined],
      ["chairs/oak", "chairs/oak.ts", "chairs/oak.jpg", "chairs/oak.glb"],
    ],
  );
  write("film/src/props/chairs/oak.jpg", "updated image");
  assert.notEqual((await catalog()).film[1].image.version, listed.film[1].image.version);

  const photo = await app.request(preview("film", "chairs/oak.jpg"));
  assert.equal(photo.headers.get("content-type"), "image/jpeg");
  assert.equal(await photo.text(), "updated image");
  const model = await app.request(preview("film", "chairs/oak.glb"));
  assert.equal(model.headers.get("content-type"), "model/gltf-binary");
  assert.equal(await model.text(), "model bytes");
  const global = await app.request(preview("global", "chairs/oak.png"));
  assert.equal(await global.text(), "global image");
});

test("prop previews only serve supported files beneath the selected library", async (t) => {
  const { app, root, write } = setup(t);
  write("film/src/props/car.ts", "source");
  write("film/src/props/.private/secret.png", "hidden");
  write("film/src/elsewhere/secret.png", "outside");
  symlinkSync(join(root, "film/src/elsewhere"), join(root, "film/src/props/linked"), "junction");
  for (const [scope, path] of [
    ["film", "car.ts"],
    ["film", ".private/secret.png"],
    ["film", "../elsewhere/secret.png"],
    ["film", "linked/secret.png"],
    ["unknown", "car.ts"],
  ]) {
    assert.equal((await app.request(preview(scope, path))).status, 404);
  }
  assert.deepEqual((await (await app.request("/api/props")).json()).film, [
    { id: "car", source: "car.ts" },
  ]);
});
