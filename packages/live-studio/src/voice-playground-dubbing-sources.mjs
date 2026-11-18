import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { DUBBING_CHUNK_BYTES } from "./voice-playground-dubbing-contract.ts";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function createDubbingSources({
  dir,
  store,
  probe,
  chunkSize = DUBBING_CHUNK_BYTES,
  isClosed = () => false,
}) {
  const folder = join(dir, "sources");
  const completions = new Map();
  const requireOpen = () => {
    if (isClosed()) throw new Error("Dubbing workspace closed; resume its saved source upload");
  };
  const list = () => {
    requireOpen();
    return store.list("dubbing-sources");
  };
  const get = (id) => list().find((row) => row.id === id);
  const requireSource = (id) => {
    const source = get(id);
    if (!source) throw fail("Dubbing source not found", 404);
    return source;
  };
  const filePath = (source) =>
    join(folder, `${source.id}${source.extension}${source.phase === "prepared" ? "" : ".part"}`);
  const save = (source) => {
    requireOpen();
    store.mutate("dubbing-sources", (rows) => {
      const index = rows.findIndex((row) => row.id === source.id);
      if (index < 0) rows.unshift(source);
      else rows[index] = source;
    });
    return source;
  };
  const init = async ({ filename, bytes, lastModified, sourceRef }) => {
    const extension = extname(filename ?? "").toLowerCase();
    if (![".mp3", ".wav", ".aac", ".m4a", ".mp4", ".mov"].includes(extension))
      throw fail("Choose a supported audio or video file");
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 2 * 1024 ** 3)
      throw fail("Source size must be between 1 byte and 2 GB");
    const source = {
      id: `dubsrc_${randomUUID()}`,
      filename: basename(filename),
      extension,
      bytes,
      lastModified,
      ...(sourceRef ? { sourceRef } : {}),
      chunkSize,
      uploaded: [],
      phase: "receiving",
      createdAt: new Date().toISOString(),
    };
    mkdirSync(folder, { recursive: true });
    await Bun.write(filePath(source), new Uint8Array());
    return save(source);
  };
  const append = async (id, index, chunk) => {
    const source = requireSource(id),
      total = Math.ceil(source.bytes / source.chunkSize);
    if (source.phase !== "receiving")
      throw fail("Source is already prepared; choose another upload", 409);
    if (!Number.isInteger(index) || index < 0 || index >= total)
      throw fail("Invalid source chunk index");
    const expected = Math.min(source.chunkSize, source.bytes - index * source.chunkSize);
    if (chunk.size !== expected) throw fail("Source chunk size does not match this upload");
    const bytes = new Uint8Array(await chunk.arrayBuffer()),
      file = await open(filePath(source), "r+");
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(
          bytes,
          offset,
          bytes.length - offset,
          index * source.chunkSize + offset,
        );
        if (!bytesWritten) throw new Error("Could not save source chunk");
        offset += bytesWritten;
      }
    } finally {
      await file.close();
    }
    const current = requireSource(id);
    return save({
      ...current,
      uploaded: [...new Set([...current.uploaded, index])].sort((a, b) => a - b),
    });
  };
  const finalize = async (id) => {
    const source = requireSource(id);
    if (source.phase === "prepared") return source;
    const total = Math.ceil(source.bytes / source.chunkSize);
    if (source.uploaded.length !== total)
      throw fail("Source upload has missing chunks; reselect the same file to continue");
    save({ ...source, phase: "verifying" });
    try {
      const info = await probe(filePath(source));
      requireOpen();
      if (!info.hasAudio) throw fail("Choose a source with an audio track");
      if (
        !Number.isFinite(info.durationSeconds) ||
        info.durationSeconds <= 0 ||
        info.durationSeconds > 9000
      )
        throw fail("Dubbing sources must be no longer than 2.5 hours");
      const prepared = {
        ...source,
        phase: "prepared",
        durationSeconds: info.durationSeconds,
        hasVideo: Boolean(info.hasVideo),
      };
      renameSync(filePath(source), filePath(prepared));
      return save(prepared);
    } catch (error) {
      if (isClosed()) throw error;
      save({ ...source, phase: "receiving", error: error.message });
      throw error;
    }
  };
  const complete = (id) => {
    if (completions.has(id)) return completions.get(id);
    const pending = finalize(id).finally(() => completions.delete(id));
    completions.set(id, pending);
    return pending;
  };
  const inspect = async (id, options = {}) => {
    const source = requireSource(id);
    if (source.phase !== "prepared") throw fail("Finish uploading this source first");
    const info = await probe(filePath(source), options);
    requireOpen();
    options.signal?.throwIfAborted();
    if (!info.hasAudio) throw fail("Original Dubbing source has no readable audio track");
    return save({ ...source, hasVideo: Boolean(info.hasVideo) });
  };
  return {
    list,
    get,
    init,
    append,
    complete,
    inspect,
    path: (id) => {
      const source = requireSource(id);
      if (source.phase !== "prepared") throw fail("Finish uploading this source first");
      return filePath(source);
    },
  };
}
