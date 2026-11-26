import { expect, mock, test } from "bun:test";

test("starts both archive requests before either response is available", async () => {
  const client = Promise.withResolvers<Response>();
  const picks = Promise.withResolvers<Response>();
  const fetchArchive = mock((path: Parameters<typeof fetch>[0]) =>
    path === "mc/client_assets.zip" ? client.promise : picks.promise,
  );
  const savedFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(fetchArchive, { preconnect: savedFetch.preconnect });
  try {
    const { readMinecraftArchives } = await import("../src/scene-assets");
    const loading = readMinecraftArchives();
    expect(fetchArchive.mock.calls).toEqual([["mc/client_assets.zip"], ["picked.zip"]]);

    picks.resolve(new Response(Uint8Array.of(3, 4)));
    client.resolve(new Response(Uint8Array.of(1, 2)));
    expect(await loading).toEqual({ jar: Uint8Array.of(1, 2), picked: Uint8Array.of(3, 4) });
  } finally {
    globalThis.fetch = savedFetch;
  }
});
