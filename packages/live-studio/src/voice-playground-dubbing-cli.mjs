import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function stageDubbingCliSource(input, { request, pg, save, signal }) {
  if (input.sourceScope) {
    const source = pg
      ? await pg.stageDubbingSourceCopy(input.sourceId, input.sourceScope, { signal })
      : (await request("dubbing/sources", "POST", input, false, undefined, signal)).source;
    await save(source);
    return { source };
  }
  if (input.itemId) {
    const source = pg
      ? await pg.stageDubbingRecording(input.itemId, { asset: input.asset, signal })
      : (
          await request(
            "dubbing/sources",
            "POST",
            { itemId: input.itemId, asset: input.asset },
            false,
            undefined,
            signal,
          )
        ).source;
    await save(source);
    return { source };
  }
  const data = Bun.file(resolve(input.file));
  if (!(await data.exists())) throw new Error("Dubbing source file does not exist");
  const file = new File([data], basename(data.name), { lastModified: data.lastModified });
  let source = input.sourceId
    ? pg
      ? pg.getDubbingSource(input.sourceId)
      : (
          await request(
            `dubbing/sources/${encodeURIComponent(input.sourceId)}`,
            "GET",
            undefined,
            false,
            undefined,
            signal,
          )
        ).source
    : pg
      ? await pg.initDubbingSource({
          filename: file.name,
          bytes: file.size,
          lastModified: file.lastModified,
        })
      : (
          await request(
            "dubbing/sources",
            "POST",
            { filename: file.name, bytes: file.size, lastModified: file.lastModified },
            false,
            undefined,
            signal,
          )
        ).source;
  if (
    !source ||
    source.filename !== file.name ||
    source.bytes !== file.size ||
    source.lastModified !== file.lastModified
  )
    throw new Error("Reselect the same original Dubbing file to resume");
  await save(source);
  if (source.phase === "prepared") return { source };
  for (let index = 0; index < Math.ceil(file.size / source.chunkSize); index++) {
    signal.throwIfAborted();
    if (source.uploaded.includes(index)) continue;
    const bytes = file.slice(
      index * source.chunkSize,
      Math.min(file.size, (index + 1) * source.chunkSize),
    );
    source = pg
      ? await pg.appendDubbingSource(source.id, index, bytes)
      : (
          await request(
            `dubbing/sources/${encodeURIComponent(source.id)}/chunks/${index}`,
            "PUT",
            bytes,
            false,
            undefined,
            signal,
          )
        ).source;
    await save(source);
  }
  source = pg
    ? await pg.completeDubbingSource(source.id)
    : (
        await request(
          `dubbing/sources/${encodeURIComponent(source.id)}/complete`,
          "POST",
          undefined,
          false,
          undefined,
          signal,
        )
      ).source;
  await save(source);
  return { source };
}

export function createCliObservationBudget(waitSeconds, checkpoint) {
  const deadline = Date.now() + waitSeconds * 1000;
  const limit = () =>
    new Error(
      `Wait limit reached. Progress saved to ${checkpoint}; resume this checkpoint without another paid submission.`,
    );
  const bounded = async (work) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw limit();
    const signal = AbortSignal.timeout(remaining);
    let abort;
    const expired = new Promise((_, reject) => {
      abort = () => reject(limit());
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([work(signal), expired]);
      if (Date.now() >= deadline) throw limit();
      return result;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  return { run: bounded, deadline, limit };
}

export async function observeDubbingCli(
  receipt,
  {
    request,
    pg,
    save,
    waitSeconds,
    checkpoint,
    budget = createCliObservationBudget(waitSeconds, checkpoint),
  },
) {
  const { deadline, limit, run: bounded } = budget;
  if (!receipt.dubbingId && receipt.command === "dubbing import") {
    const job = pg
      ? await bounded((signal) => pg.importDubbing(receipt.input.taskId, { signal }))
      : (
          await bounded((signal) =>
            request("dubbing/import", "POST", receipt.input, false, receipt.scope, signal),
          )
        ).job;
    receipt.dubbingId = job.id;
    receipt.dubbing = job;
    save();
  }
  if (!receipt.dubbingId) {
    const jobs = pg
      ? pg.listDubbing()
      : (
          await bounded((signal) =>
            request("dubbing", "GET", undefined, false, receipt.scope, signal),
          )
        ).jobs;
    const found = jobs.filter((job) =>
      receipt.command === "dubbing import"
        ? job.taskId === receipt.input?.taskId
        : job.previousJobId === receipt.argument && job.createdAt >= receipt.startedAt,
    );
    if (found.length !== 1)
      throw new Error(
        "No unique saved Dubbing attempt was captured. Use dubbing list/cloud/link; no paid request was repeated.",
      );
    receipt.dubbingId = found[0].id;
    save();
  }
  while (true) {
    let job = pg
      ? pg.getDubbing(receipt.dubbingId)
      : (
          await bounded((signal) =>
            request(
              `dubbing/${encodeURIComponent(receipt.dubbingId)}`,
              "GET",
              undefined,
              false,
              receipt.scope,
              signal,
            ),
          )
        ).job;
    if (!job) throw new Error("Saved Dubbing not found in this library; use dubbing list");
    if (job.taskId && !["completed", "failed", "unavailable"].includes(job.phase))
      job = pg
        ? await bounded((signal) => pg.refreshDubbing(job.id, { signal }))
        : (
            await bounded((signal) =>
              request(
                `dubbing/${encodeURIComponent(job.id)}/refresh`,
                "POST",
                undefined,
                false,
                receipt.scope,
                signal,
              ),
            )
          ).job;
    receipt.dubbing = job;
    save();
    if (job.phase === "completed") return receipt;
    if (["prepared", "upload_interrupted"].includes(job.phase))
      throw new Error(
        `Source kept. Inspect dubbing info ${job.id}, then explicitly run dubbing submit ${job.id} --yes to continue its upload and approve the final charge.`,
      );
    if (job.phase === "uncertain")
      throw new Error(
        "Dubbing response is unconfirmed. Use dubbing cloud/link or refresh later; no paid request was repeated.",
      );
    if (["failed", "unavailable"].includes(job.phase))
      throw new Error(
        job.error || "Dubbing unavailable; its saved source and previous recordings are kept",
      );
    if (Date.now() >= deadline) throw limit();
    await delay(Math.min(500, deadline - Date.now()));
  }
}
