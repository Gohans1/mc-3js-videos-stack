import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  DUBBING_CHUNK_BYTES,
  DubbingHistoryQuery,
  DubbingInput,
  DubbingLink,
  DubbingSourceInput,
} from "./voice-playground-dubbing-contract.ts";

const readInput = async (c, schema) => {
  const result = schema.safeParse(await c.req.json());
  if (!result.success)
    throw Object.assign(new Error(result.error.issues[0]?.message ?? "Invalid Dubbing input"), {
      status: 400,
    });
  return result.data;
};
export const streamDubbingFile = async (c, path) => {
  if (!path || !(await Bun.file(path).exists()))
    return c.json({ error: "Dubbing file is unavailable" }, 404);
  const file = Bun.file(path),
    size = file.size;
  const headers = {
    "content-type": file.type || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  if (c.req.query("download") === "1")
    headers["content-disposition"] = `attachment; filename="${path.split(/[\\/]/).at(-1)}"`;
  const range = c.req.header("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1]
      ? Number(match[1])
      : match?.[2]
        ? Math.max(0, size - Number(match[2]))
        : NaN;
    const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start ||
      (match?.[1] === "" && match?.[2] === "0")
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${size}` },
      });
    return new Response(file.slice(start, end + 1).stream(), {
      status: 206,
      headers: {
        ...headers,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      },
    });
  }
  return new Response(file.stream(), { headers: { ...headers, "content-length": String(size) } });
};

export function dubbingRoutes() {
  const app = new Hono();
  app.get("/", (c) =>
    c.json({
      jobs: c
        .get("playground")
        .listDubbing({ includeGlobal: c.req.query("includeGlobal") === "1" }),
    }),
  );
  app.post("/", async (c) =>
    c.json({ job: c.get("playground").prepareDubbing(await readInput(c, DubbingInput)) }, 201),
  );
  app.get("/cloud", async (c) => {
    const parsed = DubbingHistoryQuery.safeParse({
      page: c.req.query("page"),
      pageSize: c.req.query("pageSize"),
    });
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid history page" }, 400);
    return c.json(await c.get("playground").listCloudDubbing(parsed.data));
  });
  app.post("/import", async (c) =>
    c.json(
      {
        job: await c
          .get("playground")
          .importDubbing((await readInput(c, DubbingLink)).taskId, { signal: c.req.raw.signal }),
      },
      201,
    ),
  );
  app.post("/sources", async (c) => {
    const input = await readInput(c, DubbingSourceInput),
      pg = c.get("playground");
    return c.json(
      {
        source:
          "itemId" in input
            ? await pg.stageDubbingRecording(input.itemId, {
                asset: input.asset,
                signal: c.req.raw.signal,
              })
            : "sourceId" in input
              ? await pg.stageDubbingSourceCopy(input.sourceId, input.sourceScope, {
                  signal: c.req.raw.signal,
                })
              : await pg.initDubbingSource(input),
      },
      201,
    );
  });
  app.get("/sources/:id", (c) => {
    const source = c.get("playground").getDubbingSource(c.req.param("id"));
    return source ? c.json({ source }) : c.json({ error: "Dubbing source not found" }, 404);
  });
  app.put(
    "/sources/:id/chunks/:index",
    bodyLimit({
      maxSize: DUBBING_CHUNK_BYTES,
      onError: (c) => c.json({ error: "Dubbing source chunks must be at most 16 MB" }, 413),
    }),
    async (c) =>
      c.json({
        source: await c
          .get("playground")
          .appendDubbingSource(c.req.param("id"), Number(c.req.param("index")), await c.req.blob()),
      }),
  );
  app.post("/sources/:id/complete", async (c) =>
    c.json({ source: await c.get("playground").completeDubbingSource(c.req.param("id")) }),
  );
  app.get("/sources/:id/file", (c) =>
    streamDubbingFile(c, c.get("playground").dubbingSourcePath(c.req.param("id"))),
  );
  app.get("/:id", (c) => {
    const job = c.get("playground").getDubbing(c.req.param("id"));
    return job ? c.json({ job }) : c.json({ error: "Dubbing job not found in this library" }, 404);
  });
  app.post("/:id/submit", (c) =>
    c.json({ job: c.get("playground").submitDubbing(c.req.param("id")) }, 202),
  );
  app.post("/:id/refresh", async (c) =>
    c.json({
      job: await c
        .get("playground")
        .refreshDubbing(c.req.param("id"), { signal: c.req.raw.signal }),
    }),
  );
  app.post("/:id/link", async (c) =>
    c.json({
      job: await c
        .get("playground")
        .linkDubbing(c.req.param("id"), (await readInput(c, DubbingLink)).taskId, {
          signal: c.req.raw.signal,
        }),
    }),
  );
  app.post("/:id/retry", async (c) =>
    c.json(
      {
        job: await c
          .get("playground")
          .retryDubbing(c.req.param("id"), { signal: c.req.raw.signal }),
      },
      202,
    ),
  );
  app.delete("/:id/cloud", async (c) =>
    c.json({ job: await c.get("playground").deleteCloudDubbing(c.req.param("id")) }),
  );
  return app;
}
