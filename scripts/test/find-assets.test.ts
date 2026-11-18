import { expect, test } from "bun:test";
import { join } from "node:path";

import { assetInfo } from "../../packages/live-studio/src/asset-recipes.mjs";
import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { presetEntries, run } from "../find";
import { readAssetCatalog } from "../openfilm/catalog.mjs";
import { LOCAL } from "../vault.mjs";

const entries = [...presetEntries(), ...readAssetCatalog(join(LOCAL, "openfilm"))];
const favorites = favoriteLists(join(import.meta.dir, "no-find-asset-favorites"));
const find = (args: string[]) => run(args, entries, undefined, undefined, favorites);

test("group suggestions keep the selected provider scope", async () => {
  const message = await find(["--kind", "transition", "--source", "builtin", "--group"]).catch(
    (error: Error) => error.message,
  );
  expect(message).toContain("Basic");
  expect(message).not.toContain("fade ");
});

test("sound recipes point at their actual media file rather than a provider name", () => {
  const info = assetInfo({
    kind: "sfx",
    id: "click",
    cat: "clicks",
    title: "Click",
    about: "",
    src: "mixkit",
    secs: 1,
    data: { file: "vault/sound/sfx/clicks/click.wav" },
  });
  expect(info?.sourceFile).toBe("vault/sound/sfx/clicks/click.wav");
});

test("functional discovery includes native and imported transitions without a second search command", async () => {
  const text = await find(["--kind", "transition", "-n", "200"]);
  expect(text).toContain("dissolve");
  expect(text).toContain("of-transitions-");
  expect(text).not.toContain("asset info");
});

test("find show exposes the same creative recipe that asset use accepts", async () => {
  const native = await find(["--show", "text/in/fade"]);
  expect(native).toContain('"text": "Your words"');
  expect(native).toContain("1080px");
  expect(native).toContain("bun run asset use text/in/fade");
  const imported = await find(["--show", "of-effects-snow"]);
  expect(imported).toContain('"source": "openfilm"');
  expect(imported).toContain('"props"');
  expect(imported).toContain("effects/snow/files/");
  expect(imported).not.toContain("asset info");
});

test("compatibility discovery forwards to find output while actions keep JSON", () => {
  const invoke = (file: string, args: string[]) => {
    const result = Bun.spawnSync([process.execPath, file, ...args], {
      cwd: join(import.meta.dir, "../.."),
      timeout: 15000,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString();
  };
  const canonical = invoke("scripts/find.ts", ["--show", "text/in/fade"]);
  const alias = invoke("scripts/asset.mjs", ["info", "text/in/fade"]);
  expect(alias).toBe(canonical);
  expect(
    invoke("scripts/asset.mjs", [
      "list",
      "--kind",
      "transition",
      "--source",
      "openfilm",
      "--group",
      "fade",
      "--limit",
      "1",
      "--offset",
      "1",
    ]),
  ).toBe(
    invoke("scripts/find.ts", [
      "--kind",
      "transition",
      "--source",
      "openfilm",
      "--group",
      "fade",
      "-n",
      "1",
      "--offset",
      "1",
    ]),
  );
  const actions = invoke("scripts/asset.mjs", ["--help"]);
  expect(actions).toContain("bun run find");
  expect(actions).not.toContain("list                         ");
});

test("word result pages report their range and a next command with the same query and filters", async () => {
  const second = await find([
    "fade",
    "--kind",
    "transition",
    "--source",
    "openfilm",
    "-n",
    "1",
    "--offset",
    "1",
  ]);
  expect(second).toContain("entries 2-2");
  expect(second).toContain("bun run find fade --kind transition --source openfilm -n 1 --offset 2");
});

test("source/group filters and pagination use find's normal selection", async () => {
  const first = await find([
    "--kind",
    "transition",
    "--source",
    "openfilm",
    "--group",
    "fade",
    "-n",
    "1",
  ]);
  const second = await find([
    "--kind",
    "transition",
    "--source",
    "openfilm",
    "--group",
    "fade",
    "-n",
    "1",
    "--offset",
    "1",
  ]);
  expect(first).toContain("of-transitions-dissolve");
  expect(second).not.toContain("of-transitions-dissolve");
  expect(second).toContain("of-");
  expect(await find(["--show", "transition/dissolve", "--source", "builtin"])).toContain(
    '"source": "builtin"',
  );
});
