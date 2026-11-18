import { mkdirSync, renameSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname } from "node:path";

export async function downloadDubbingFile({
  url,
  destination,
  maxBytes,
  fetchImpl,
  checkUrl,
  checkpoint = {},
  save = async () => {},
  onProgress = () => {},
  signal,
}) {
  const part = `${destination}.part`;
  let prior = 0;
  try {
    prior = statSync(part).size;
  } catch {}
  const validator =
    checkpoint.etag && !checkpoint.etag.startsWith("W/")
      ? checkpoint.etag
      : checkpoint.lastModified;
  let resume = checkpoint.url === url && prior > 0 && prior <= maxBytes && Boolean(validator);
  const headers = resume ? { Range: `bytes=${prior}-`, "If-Range": validator } : {};
  const deadline = AbortSignal.timeout(15 * 60_000),
    activeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let currentUrl = url;
  const fetchResponse = async (requestHeaders) => {
    currentUrl = url;
    for (let hop = 0; hop < 4; hop++) {
      activeSignal.throwIfAborted();
      await checkUrl(currentUrl);
      activeSignal.throwIfAborted();
      const response = await fetchImpl(currentUrl, {
        headers: requestHeaders,
        redirect: "manual",
        signal: activeSignal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Media redirect has no destination");
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
      return response;
    }
    throw new Error("Media exceeded redirect limit");
  };
  let response = await fetchResponse(headers);
  if (response.status === 416 && resume) {
    await response.body?.cancel();
    resume = false;
    response = await fetchResponse({});
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Media download failed (HTTP ${response.status})`);
  }
  let received = 0,
    total;
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    if (
      !resume ||
      !range ||
      Number(range[1]) !== prior ||
      Number(range[2]) < prior ||
      Number(range[3]) <= Number(range[2])
    ) {
      await response.body?.cancel();
      throw new Error("Media server returned an invalid partial range");
    }
    const etag = response.headers.get("etag");
    if (checkpoint.etag && etag && checkpoint.etag !== etag) {
      await response.body?.cancel();
      throw new Error("Media changed while resuming; download it again from the beginning");
    }
    received = prior;
    total = Number(range[3]);
  } else {
    const length = response.headers.get("content-length");
    if (length !== null) total = Number(length);
  }
  if (total !== undefined && (!Number.isSafeInteger(total) || total < 1 || total > maxBytes)) {
    await response.body?.cancel();
    throw new Error("Media exceeds its download limit");
  }
  if (!response.body) throw new Error("Media response was empty");
  let state = {
    url,
    phase: "downloading",
    bytes: received,
    total,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type") ?? "",
  };
  await save({ ...state });
  mkdirSync(dirname(destination), { recursive: true });
  const file = await open(part, received ? "a" : "w");
  let checkpointBytes = received;
  try {
    for await (const bytes of response.body) {
      activeSignal.throwIfAborted();
      if (received + bytes.byteLength > maxBytes)
        throw new Error("Media exceeds its download limit");
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset);
        if (!bytesWritten) throw new Error("Could not save downloaded media");
        offset += bytesWritten;
      }
      received += bytes.byteLength;
      onProgress({ bytes: received, total });
      if (received - checkpointBytes >= 8 * 1024 * 1024) {
        state = { ...state, bytes: received };
        await save({ ...state });
        checkpointBytes = received;
      }
    }
    if (received < 1 || (total !== undefined && received !== total))
      throw new Error("Media download was incomplete; resume to continue without generating again");
  } catch (error) {
    await save({ ...state, phase: "interrupted", bytes: received, error: error.message });
    throw error;
  } finally {
    await file.close();
  }
  activeSignal.throwIfAborted();
  renameSync(part, destination);
  state = { ...state, phase: "completed", bytes: received };
  await save({ ...state });
  return { path: destination, bytes: received, url: currentUrl, contentType: state.contentType };
}
