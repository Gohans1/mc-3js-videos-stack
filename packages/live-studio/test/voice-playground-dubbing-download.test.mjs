import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadDubbingFile } from "../src/voice-playground-dubbing-download.mjs";

test("an interrupted result resumes the same entity into its saved file without buffering the whole media", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-download-")),
    destination = join(root, "result.mp4");
  let checkpoint = {},
    requests = 0;
  const fetchImpl = async (url, init) => {
    requests++;
    if (requests === 1) {
      let reads = 0;
      return new Response(
        new ReadableStream({
          pull(c) {
            if (reads++ === 0) c.enqueue(new TextEncoder().encode("abc"));
            else c.error(new Error("Connection lost"));
          },
        }),
        { headers: { ETag: '"same"', "Content-Length": "6" } },
      );
    }
    expect(init.headers.Range).toBe("bytes=3-");
    expect(init.headers["If-Range"]).toBe('"same"');
    return new Response("def", {
      status: 206,
      headers: { ETag: '"same"', "Content-Range": "bytes 3-5/6", "Content-Length": "3" },
    });
  };
  const options = {
    url: "https://cdn.invalid/result.mp4",
    destination,
    maxBytes: 20,
    fetchImpl,
    checkUrl: async () => {},
    save: async (next) => {
      checkpoint = next;
    },
  };
  try {
    await expect(downloadDubbingFile({ ...options, checkpoint })).rejects.toThrow(
      "Connection lost",
    );
    expect(existsSync(destination)).toBe(false);
    expect(readFileSync(`${destination}.part`, "utf8")).toBe("abc");
    const result = await downloadDubbingFile({ ...options, checkpoint });
    expect(result.bytes).toBe(6);
    expect(readFileSync(destination, "utf8")).toBe("abcdef");
    expect(checkpoint.phase).toBe("completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a server returning a changed full entity replaces the partial file instead of joining incompatible media", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-download-new-")),
    destination = join(root, "result.mp4");
  writeFileSync(`${destination}.part`, "old");
  try {
    await downloadDubbingFile({
      url: "https://cdn.invalid/file",
      destination,
      maxBytes: 20,
      checkpoint: { url: "https://cdn.invalid/file", etag: '"old"' },
      checkUrl: async () => {},
      fetchImpl: async () => new Response("replacement", { headers: { ETag: '"new"' } }),
      save: async () => {},
    });
    expect(readFileSync(destination, "utf8")).toBe("replacement");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an oversized streamed result cannot replace an existing output, and redirects are checked before fetching their targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-download-limits-")),
    destination = join(root, "result.mp4");
  writeFileSync(destination, "previous");
  try {
    await expect(
      downloadDubbingFile({
        url: "https://cdn.invalid/file",
        destination,
        maxBytes: 4,
        checkUrl: async () => {},
        fetchImpl: async () => new Response("oversized"),
        save: async () => {},
      }),
    ).rejects.toThrow("limit");
    expect(readFileSync(destination, "utf8")).toBe("previous");
    let fetches = 0;
    await expect(
      downloadDubbingFile({
        url: "https://cdn.invalid/file",
        destination,
        maxBytes: 4,
        checkUrl: async (url) => {
          if (url.includes("127.0.0.1")) throw new Error("Private target");
        },
        fetchImpl: async () => {
          fetches++;
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/private" },
          });
        },
        save: async () => {},
      }),
    ).rejects.toThrow("Private target");
    expect(fetches).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fully received partial left before a crash recovers from HTTP416 with one free full download", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-full-part-")),
    destination = join(root, "result.mp4");
  const url = "https://cdn.invalid/result.mp4";
  writeFileSync(`${destination}.part`, "abcdef");
  let requests = 0;
  try {
    const result = await downloadDubbingFile({
      url,
      destination,
      maxBytes: 20,
      checkpoint: { url, etag: '"same"' },
      checkUrl: async () => {},
      fetchImpl: async (_, init) => {
        requests++;
        if (init.headers.Range)
          return new Response(null, { status: 416, headers: { "Content-Range": "bytes */6" } });
        return new Response("abcdef", { headers: { ETag: '"same"', "Content-Length": "6" } });
      },
    });
    expect(result.bytes).toBe(6);
    expect(readFileSync(destination, "utf8")).toBe("abcdef");
    expect(requests).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a mismatched resumed range never changes the partial or existing completed media", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-bad-range-")),
    destination = join(root, "result.mp4");
  const url = "https://cdn.invalid/result.mp4";
  writeFileSync(`${destination}.part`, "abc");
  writeFileSync(destination, "previous");
  try {
    await expect(
      downloadDubbingFile({
        url,
        destination,
        maxBytes: 20,
        checkpoint: { url, etag: '"same"' },
        checkUrl: async () => {},
        fetchImpl: async () =>
          new Response("def", {
            status: 206,
            headers: { ETag: '"same"', "Content-Range": "bytes 2-4/6" },
          }),
      }),
    ).rejects.toThrow("invalid partial range");
    expect(readFileSync(`${destination}.part`, "utf8")).toBe("abc");
    expect(readFileSync(destination, "utf8")).toBe("previous");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an expired observer stops before fetching or changing saved media", async () => {
  const root = mkdtempSync(join(tmpdir(), "dub-aborted-")),
    destination = join(root, "result.mp4");
  let fetched = false;
  const abort = new AbortController();
  abort.abort(new Error("Observer deadline"));
  writeFileSync(destination, "previous");
  try {
    await expect(
      downloadDubbingFile({
        url: "https://cdn.invalid/file",
        destination,
        maxBytes: 20,
        signal: abort.signal,
        checkUrl: async () => {},
        fetchImpl: async () => {
          fetched = true;
          return new Response("new");
        },
      }),
    ).rejects.toThrow("Observer deadline");
    expect(fetched).toBe(false);
    expect(readFileSync(destination, "utf8")).toBe("previous");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
