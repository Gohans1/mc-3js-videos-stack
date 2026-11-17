import assert from "node:assert/strict";
import { test } from "node:test";

test("asset versioning preserves fetch capabilities while rewriting the requested asset", () => {
  const module = new URL("../app/core/boot.ts", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    globalThis.window = { __STUDIO_BOOT: { tags: { '/asset.png': 'stamp' } } };
    globalThis.fetch = Object.assign(async (input) => new Response(String(input)), { preconnect: () => 42 });
    await import(${JSON.stringify(module)});
    assert.equal(globalThis.fetch.preconnect(), 42);
    assert.equal(await (await fetch('/asset.png')).text(), '/asset.png?v=stamp');
  `;
  const result = Bun.spawnSync([process.execPath, "-e", script], { timeout: 5000 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
});
