import { stat } from "node:fs/promises";

export async function uploadDubbingSource(
  path,
  parameters,
  { request, checkpoint = {}, save, signal },
) {
  signal?.throwIfAborted();
  const source = await stat(path);
  if (!source.isFile() || source.size < 1 || source.size > 2 * 1024 ** 3)
    throw new Error("Choose a source file between 1 byte and 2 GB");
  if (checkpoint.phase === "queued") return { taskId: checkpoint.taskId };
  if (["submitting", "uncertain", "rejected"].includes(checkpoint.phase))
    throw new Error(
      "This upload was already submitted. Check Dubbing history before starting another paid request.",
    );
  if (
    checkpoint.source &&
    (checkpoint.source.size !== source.size || checkpoint.source.mtimeMs !== source.mtimeMs)
  )
    throw new Error("The source file changed. Restore the original upload or start a new one.");
  let state = {
    phase: "uploading",
    uploaded: [],
    ...checkpoint,
    source: { size: source.size, mtimeMs: source.mtimeMs },
  };
  const persist = async (patch) => {
    signal?.throwIfAborted();
    state = { ...state, ...patch };
    await save(structuredClone(state));
  };
  if (!state.uploadId) {
    const { data } = await request("/aidubbing/upload/init", { method: "POST", signal });
    if (
      typeof data.upload_id !== "string" ||
      !data.upload_id ||
      !Number.isInteger(data.chunk_size) ||
      data.chunk_size < 1 ||
      data.chunk_size > 100 * 1024 ** 2
    )
      throw new Error("GenVoice returned an invalid Dubbing upload session");
    await persist({ uploadId: data.upload_id, chunkSize: data.chunk_size });
  }
  const total = Math.ceil(source.size / state.chunkSize);
  if (total > 512) throw new Error("GenVoice requested too many chunks for this source file");
  const file = Bun.file(path);
  for (let index = 0; index < total; index++) {
    if (state.uploaded.includes(index)) continue;
    const body = new FormData();
    body.set("upload_id", state.uploadId);
    body.set("index", String(index));
    body.set(
      "chunk",
      file.slice(index * state.chunkSize, Math.min(source.size, (index + 1) * state.chunkSize)),
      parameters.filename,
    );
    await request("/aidubbing/upload/chunk", { method: "POST", body, signal });
    await persist({
      uploaded: [...state.uploaded, index],
      uploadedBytes: Math.min(source.size, (index + 1) * state.chunkSize),
    });
  }
  const body = new FormData();
  for (const [key, value] of Object.entries({
    upload_id: state.uploadId,
    total_chunks: total,
    filename: parameters.filename,
    content_type: parameters.contentType,
    source_language: parameters.sourceLanguage,
    target_language: parameters.targetLanguage,
    provider: parameters.provider,
    voice_id: parameters.voiceId,
  }))
    if (value !== undefined) body.set(key, String(value));
  await persist({ phase: "submitting" });
  try {
    const { data } = await request("/aidubbing/upload/complete", { method: "POST", body, signal });
    const taskId = data.task_id ?? data.id;
    if (typeof taskId !== "string" || !taskId)
      throw new Error("GenVoice returned no Dubbing task ID; check history before trying again");
    await persist({ phase: "queued", taskId });
    return { taskId };
  } catch (error) {
    await persist({
      phase: error.status >= 400 && error.status < 500 ? "rejected" : "uncertain",
      error: error.message,
    });
    throw error;
  }
}
