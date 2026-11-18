import { basename } from "node:path";

export async function submitCloneRecord(record, sourcePath, request, save) {
  if (record.phase !== "prepared")
    throw new Error(
      "This clone was already submitted; refresh or link its cloud identity before creating another one",
    );
  const file = Bun.file(sourcePath);
  if (!(await file.exists())) throw new Error("Saved clone source is unavailable");
  const form = new FormData();
  form.set("file", file, basename(sourcePath));
  const settings = record.settings;
  form.set("voice_name", settings.name);
  form.set("language_tag", settings.language);
  form.set("gender", settings.gender);
  form.set("need_noise_reduction", String(settings.noiseReduction));
  form.set("preview_text", settings.previewText);
  let next = { ...record, phase: "submitting", submittedAt: new Date().toISOString() };
  next.attempts = [
    ...(record.attempts ?? []),
    { submittedAt: next.submittedAt, settings: structuredClone(settings) },
  ];
  await save(next);
  try {
    const data = await request("/minimax/voices/clone", { method: "POST", body: form });
    if (typeof data.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(data.id))
      throw new Error(
        "Clone response did not include a usable voice ID; inspect cloud voices before retrying",
      );
    next = {
      ...next,
      remoteId: data.id,
      remoteCreatedAt: data.created_at,
      ...(typeof data.credits_deducted === "number"
        ? { creditsDeducted: data.credits_deducted }
        : {}),
      phase: data.status === "done" ? "ready" : data.status === "failed" ? "failed" : "processing",
    };
    await save(next);
    return next;
  } catch (error) {
    next = {
      ...next,
      phase: error.status >= 400 && error.status < 500 ? "failed" : "uncertain",
      error: error.message,
    };
    await save(next);
    throw error;
  }
}
