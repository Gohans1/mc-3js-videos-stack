import { expect, spyOn, test } from "bun:test";

import { clearPrefetch, FileRequestError, getFile, prefetchFile } from "../app/core/net.ts";

test("a denied GET fails without retrying or reporting missing data", async () => {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => (++requests === 1 ? new Response(null, { status: 403 }) : Response.json({})),
  });
  try {
    const failure = await getFile(server.url.href).catch((error) => error);
    expect(failure).toBeInstanceOf(FileRequestError);
    expect(failure).toMatchObject({ status: 403 });
    expect(requests).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("clearing a prefetch aborts its unused request and the next read is fresh", async () => {
  const url = "/api/cam";
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  const fetch = spyOn(globalThis, "fetch")
    .mockImplementationOnce((_input, init) => {
      started.resolve(init?.signal);
      return pending.promise;
    })
    .mockResolvedValueOnce(Response.json({ version: "current" }));
  try {
    prefetchFile(url);
    const signal = await started.promise;
    clearPrefetch(url);
    expect(signal?.aborted).toBe(true);
    expect(await (await getFile(url)).json()).toEqual({ version: "current" });
  } finally {
    pending.resolve(Response.json({ version: "stale" }));
    clearPrefetch();
    fetch.mockRestore();
  }
});

test("a speculative read recovers after a transient outage without a second consumer", async () => {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => (++requests <= 3 ? new Response(null, { status: 503 }) : Response.json({})),
  });
  try {
    prefetchFile(server.url.href);
    expect((await getFile(server.url.href)).ok).toBe(true);
    expect(requests).toBe(4);
  } finally {
    clearPrefetch();
    server.stop(true);
  }
}, 9000);

test("a missing prefetched file still returns its real 404 response", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Missing", { status: 404 }),
  });
  try {
    prefetchFile(server.url.href);
    const response = await getFile(server.url.href);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Missing");
  } finally {
    clearPrefetch();
    server.stop(true);
  }
});

test("a slow response is allowed to send its headers before a retry starts", async () => {
  const realTimer = globalThis.setTimeout;
  const deadline = spyOn(globalThis, "setTimeout").mockImplementation((fn, ms, ...args) =>
    realTimer(fn, ms === 15_000 ? 100 : ms, ...args),
  );
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      if (++requests === 1) await Bun.sleep(180);
      return Response.json({ available: true });
    },
  });
  try {
    expect(await (await getFile(server.url.href)).json()).toEqual({ available: true });
    expect(requests).toBe(1);
  } finally {
    deadline.mockRestore();
    server.stop(true);
  }
});

test("a response that already sent data can finish a slow body", async () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(100));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          async start(stream) {
            const bytes = new TextEncoder();
            stream.enqueue(bytes.encode('{"available":'));
            await Bun.sleep(180);
            if (stream.desiredSize === null) return;
            stream.enqueue(bytes.encode("true}"));
            stream.close();
          },
        }),
      ),
  });
  try {
    const response = await getFile(server.url.href);
    expect(await response.json()).toEqual({ available: true });
  } finally {
    timeout.mockRestore();
    server.stop(true);
  }
});
