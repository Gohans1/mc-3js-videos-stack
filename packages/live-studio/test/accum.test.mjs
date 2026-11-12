import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// A clip's sub-frames (motion blur) averaged by render/accum.ts in a real browser: test/accum-page.ts paints the pictures
let view, server;
before(async () => {
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./accum-page.ts", import.meta.url))],
    target: "browser",
  });
  const js = built.outputs[0];
  server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/page.js"
        ? new Response(js)
        : new Response('<!doctype html><script type="module" src="/page.js"></script>', {
            headers: { "content-type": "text/html" },
          }),
  });
  view = new Bun.WebView({
    backend: { type: "chrome", argv: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  });
  await view.navigate(server.url.href);
});
after(() => {
  view?.close();
  server?.stop(true);
});
const average = (pictures, mode) =>
  view.evaluate(`average(${JSON.stringify(pictures)}, ${JSON.stringify(mode)})`);

// "shared": in the film's own WebGL context (draw.tools.renderer), "own": a context of its own for a film without one
for (const mode of ["shared", "own"]) {
  test(`${mode}: black and white average to half the light (sRGB 188), as a shutter does, not half the code (128)`, async () => {
    for (const grey of await average([0, 255], mode))
      assert.ok(Math.abs(grey - 188) <= 1, String(grey));
  });

  test(`${mode}: one picture taken 32 times comes back exactly, every step of a ramp kept`, async () => {
    assert.deepEqual(
      await average(Array(32).fill("ramp"), mode),
      Array.from({ length: 64 }, (_, x) => x * 4),
    );
  });
}
