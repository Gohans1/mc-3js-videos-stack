import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { openFavorites } from "./favorites.mjs";
import { openVoiceLibrary } from "./voice-library.mjs";
import { commandSchema, PLAYGROUND_COMMANDS } from "./voice-playground-commands.ts";
import { speechBatchEntries } from "./voice-playground-contract.ts";
import {
  createCliObservationBudget,
  observeDubbingCli,
  stageDubbingCliSource,
} from "./voice-playground-dubbing-cli.mjs";
import {
  audioMimeForExt,
  containerHasAudio,
  sniffContainerMagic,
  writeAtomic,
} from "./voice-playground-genvoice.mjs";
import { voiceProjectId } from "./voice-playground-library.mjs";
import { findVoiceProfiles } from "./voice-playground-profiles.mjs";
import {
  findVoiceTemplates,
  recordingCaptions,
  recordingRecipe,
} from "./voice-playground-recordings.mjs";
import { hasProvisionalGenVoiceCharge, isUnverifiedCloudSpeech } from "./voice-playground-text.mjs";
import { openVoicePlayground } from "./voice-playground.mjs";
import { openVoice } from "./voice.mjs";

const HELP = `Voice Playground for people and AI agents — GenVoice, Project and Global archives.
  bun run voice:playground <command> [ID] [options]
  bun run voice:playground <command> --help     purpose, full input keys and an example
  bun run voice:playground schema <command>    machine-readable JSON Schema, including limits
  bun run voice:playground resume FILE         continue observing/importing a checkpoint; never regenerate

Daily GenVoice workflows:
  Cast: voices search or voices cached → favorites voices (creator/category/profile rating)
  Audition: generate quote → generate batch --yes → items find (batchId or label tag)
  Reuse: items recipe, or templates from-recording → templates recipe → returned generate command
  Audit: voices usage, film usage and items media check actual archive and film data

${PLAYGROUND_COMMANDS.map((command) => `  ${command.name.padEnd(24)} ${command.description}`).join("\n")}

Options:
  --server URL          use an explicitly selected running Studio; recommended while its UI is open
  --project PATH        headless film directory; selects Project unless --scope is explicit
  --scope project|global  defaults to Project in a film/with --server, otherwise Global
  --input-file FILE     JSON input, including every documented setting (UTF-8 BOM accepted)
  --input JSON          small inline JSON; use a file to avoid shell quoting issues
  --yes                 execute a paid/delete command; otherwise it only previews
  --dry-run             preview any write, even with --yes; sends nothing
  --wait SECONDS        one observation budget, 1–1800 (default 900). Timeout preserves progress.
  --checkpoint FILE     save job IDs, actual results and progress here (default: user cache)
  --out FILE            required for voices preview, items export, region preview and clones/dubbing export-source
  --json                JSON stdout (also the default); progress and errors use stderr

No prices or commercial permissions are invented. Missing actual fees remain unknown.
Local tempo/pitch/volume edits are free; phrase regeneration and transcription can spend credits.
Own-voice cloning: clones --help, then schema clones create. Samples need permission, 10–300s, <=80 MB.
Clone submission/retry can spend credits. Lost response: clones list/cloud/link or resume; never blindly recreate.
Cloud deletion/retry affects every copy of the same voice ID; archived recordings and original samples stay local.
Dubbing: source-add saves/probes a source for free; prepare quotes 50 credits/source second, then submit JOB_ID --yes starts it.
Dubbing source limits: 2 GB / 2.5 hours. Models are pinned per provider; MiniMax dubbing uses uniq_id/clone UUID, not its numeric TTS ID.
Dubbing resume never repeats paid completion or retry. Lost acknowledgement: inspect dubbing list/cloud and link the existing task.
Dubbing retry pays the original cost again and creates a separate local version; video, original, audio and subtitles remain archived.
API keys resolve on the server/headless engine; they are never included in help or checkpoints.
Resume checkpoints made with --server in the original Studio project.
Headless Speech allows up to 90 seconds to capture submission acknowledgements before observation.
Do not run headless writes against a project currently being edited in another Studio: use --server.
`;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const usageError = (message) => Object.assign(new Error(message), { exitCode: 2 });
const redact = (input) => ({ ...input, ...("apiKey" in input ? { apiKey: "[redacted]" } : {}) });
const JSON_HEADERS = { "content-type": "application/json" };
const SPEECH_CHECKPOINT_COMMANDS = new Set(["generate tts", "generate batch", "items retry"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasEmptyWav = (item) => item?.mimeType === "audio/wav" && item.durationSeconds === 0;
const isCloudRecording = (item, job) =>
  item?.remoteTaskId &&
  (item.connection ?? job.connection ?? "genvoice") === "genvoice" &&
  ["tts", "dialogue", "voice_changer"].includes(item.kind);
const needsCloudRefresh = (item, requestedTts) =>
  hasEmptyWav(item) ||
  item.cloudRecipeUnverified ||
  (requestedTts && isUnverifiedCloudSpeech(item)) ||
  hasProvisionalGenVoiceCharge(item) ||
  !Number.isFinite(item.creditsDeducted) ||
  ((item.exportTranscript || item.requestedTts?.exportTranscript || item.srtPending) &&
    !item.srtFile &&
    !item.srtText);
const exportFile = async (output, content) => {
  const target = resolve(output),
    part = `${target}.${randomUUID()}.part`;
  try {
    await Bun.write(part, content);
    renameSync(part, target);
  } finally {
    rmSync(part, { force: true });
  }
};

const inlineRecordingExport = (item, format) => {
  if (!item) return undefined;
  if (format === "srt") return item.srtText ?? item.sttResult?.srtText;
  const output = item.sttResult?.additional_formats?.find(
    (value) => value.file_extension === format || value.requested_format === format,
  );
  if (output)
    return output.is_base64_encoded ? Buffer.from(output.content, "base64") : output.content;
  return format === "txt" ? item.sttResult?.text : undefined;
};

export async function runVoicePlaygroundCli(argv, options = {}) {
  const out = options.out ?? ((message) => process.stdout.write(`${message}\n`));
  const err = options.err ?? ((message) => process.stderr.write(`${message}\n`));
  const fetchImpl = options.fetchImpl ?? fetch;
  let controller, receipt, checkpoint, dubbingBudget;
  let observing = true;
  const saveCheckpoint = () => {
    if (!checkpoint || !receipt) return;
    mkdirSync(dirname(checkpoint), { recursive: true });
    receipt.updatedAt = new Date().toISOString();
    writeAtomic(checkpoint, JSON.stringify(receipt, null, 2));
  };
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        yes: { type: "boolean" },
        "dry-run": { type: "boolean" },
        server: { type: "string" },
        project: { type: "string" },
        scope: { type: "string" },
        input: { type: "string" },
        "input-file": { type: "string" },
        wait: { type: "string" },
        checkpoint: { type: "string" },
        out: { type: "string" },
      },
    });
    if (!positionals.length || positionals[0] === "help") {
      out(HELP);
      return 0;
    }
    if (values.server && values.project)
      throw usageError(
        "Use --server for a running Studio or --project for headless work; choose one context",
      );
    const waitSeconds = Number(values.wait ?? 900);
    if (!Number.isFinite(waitSeconds) || waitSeconds < 1 || waitSeconds > 1800)
      throw usageError("--wait takes 1–1800 seconds");
    let server = values.server ? new URL(values.server) : null;
    if (server && (!/^https?:$/.test(server.protocol) || server.username || server.password))
      throw usageError("--server needs an HTTP/HTTPS Studio URL without credentials");
    let project = resolve(values.project ?? process.cwd());
    let scope =
      values.scope ??
      (server || values.project || existsSync(join(project, "src/edit.json"))
        ? "project"
        : "global");
    if (scope !== "project" && scope !== "global")
      throw usageError("--scope takes project or global");
    const request = async (
      path,
      method = "GET",
      input,
      raw = false,
      requestScope = scope,
      signal,
    ) => {
      const url = new URL(`/api/voice/playground/${path}`, server);
      url.searchParams.set("scope", requestScope);
      const init = {
        method,
        signal: signal ?? AbortSignal.timeout(Math.min(waitSeconds * 1000, 900000)),
      };
      if (method === "GET") {
        for (const [key, value] of Object.entries(input ?? {}))
          if (value !== undefined)
            url.searchParams.set(
              key,
              typeof value === "boolean" ? (value ? "1" : "0") : String(value),
            );
      } else if (input instanceof FormData || input instanceof Blob) init.body = input;
      else if (input !== undefined) {
        init.headers = JSON_HEADERS;
        init.body = JSON.stringify(input);
      }
      const scopedReceipt = requestScope === "project" && receipt?.scope === "project";
      const expectedProject =
        scopedReceipt &&
        (receipt.serverProjectId ??
          (positionals[0] === "resume" ? voiceProjectId(receipt.project) : undefined));
      if (expectedProject)
        init.headers = { ...init.headers, "x-voice-playground-project": expectedProject };
      if (
        receipt?.serverRunId &&
        method === "POST" &&
        (path === "tts" ||
          path === "tts/batch" ||
          (path.startsWith("items/") && path.endsWith("/retry")))
      )
        init.headers = {
          ...init.headers,
          "x-voice-playground-run": receipt.serverRunId,
          "x-voice-playground-deadline": String(Date.now() + waitSeconds * 1000),
        };
      const response = await fetchImpl(url, init);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(
            typeof data.error === "string"
              ? data.error
              : `Studio returned ${response.status}; check the selected server and command input`,
          ),
          { status: response.status },
          Number.isFinite(data.creditsDeducted)
            ? { creditsDeducted: data.creditsDeducted, creditsSource: data.creditsSource }
            : {},
        );
      }
      if (scopedReceipt) {
        const projectId = response.headers.get("x-voice-playground-project");
        if (
          (projectId && expectedProject && projectId !== expectedProject) ||
          (receipt.serverProjectId && projectId !== receipt.serverProjectId)
        )
          throw new Error(
            "This checkpoint belongs to a different Studio project. Open the original project and resume again.",
          );
        if (
          projectId &&
          (receipt.serverProjectId !== projectId || receipt.server !== server.origin)
        ) {
          receipt.serverProjectId = projectId;
          receipt.server = server.origin;
          saveCheckpoint();
        }
      }
      return raw ? response : response.json();
    };
    const makeController = () => {
      if (controller) return controller;
      const config = existsSync(join(project, "package.json"))
        ? (readJson(join(project, "package.json"))["live-studio"] ?? {})
        : {};
      controller = openVoicePlayground({
        audioFavorites: options.favorites ?? (options.globalDir ? undefined : openFavorites()),
        cachedVoices: openVoiceLibrary({ project, autoSync: false }).voices,
        ...options.controllerOptions,
        project,
        ...(options.globalDir ? { globalDir: options.globalDir } : {}),
        voice: openVoice(project, config),
        onEvent: (event) => {
          if (
            observing &&
            receipt?.command?.startsWith("dubbing ") &&
            event.type === "dubbing" &&
            (event.job.id === receipt.dubbingId ||
              (receipt.argument && event.job.previousJobId === receipt.argument) ||
              (receipt.command === "dubbing import" && event.job.taskId === receipt.input?.taskId))
          ) {
            receipt.dubbingId = event.job.id;
            receipt.dubbing = event.job;
            saveCheckpoint();
          }
          if (!observing || event.type !== "job" || !receipt) return;
          const previous = receipt.jobs.findIndex((job) => job.id === event.job.id);
          if (previous < 0) receipt.jobs.push(event.job);
          else receipt.jobs[previous] = event.job;
          saveCheckpoint();
        },
      });
      return controller;
    };
    const waitForLocalSpeechSubmission = async () => {
      const pg = makeController().forScope(receipt.scope);
      await createCliObservationBudget(90, checkpoint).run(async (signal) => {
        while (true) {
          signal.throwIfAborted();
          const current = pg.listJobs();
          for (const job of receipt.jobs) {
            const live = current.find((entry) => entry.id === job.id);
            if (live) Object.assign(job, live);
          }
          if (
            !receipt.jobs.some(
              (job) =>
                job.kind === "tts" &&
                (job.connection ?? "genvoice") === "genvoice" &&
                !job.remoteTaskId &&
                !["completed", "failed"].includes(job.status),
            )
          ) {
            saveCheckpoint();
            return;
          }
          await sleep(50);
        }
      });
    };
    const waitForJobs = async (budget = createCliObservationBudget(waitSeconds, checkpoint)) => {
      const { deadline, limit, run: bounded } = budget;
      const studio = (path, method, input) =>
        bounded((signal) => request(path, method, input, false, receipt.scope, signal));
      const recoverCloud = (pg, taskId, kind, recovery = {}) =>
        server
          ? studio("remote-history/import", "POST", { taskId, kind, ...recovery })
          : bounded((signal) => pg.importRemoteTask(taskId, kind, recovery, { signal }));
      const recoveryInput = (job) => {
        if (job.kind === "dialogue")
          return {
            dialogueRecipe:
              job.dialogueRecipe ??
              (receipt.command === "generate dialogue" ? receipt.input : undefined),
            dialogueParentId:
              job.dialogueParentId ??
              (receipt.command === "items retry" ? receipt.argument : undefined),
          };
        if (job.kind !== "tts") return {};
        const requestedTts =
          job.generationRecipe?.requested ??
          (receipt.command === "generate tts"
            ? receipt.input
            : receipt.command === "generate batch" && job.batch
              ? receipt.input && speechBatchEntries(receipt.input)[job.batch.index]
              : undefined);
        return { requestedTts };
      };
      const checkDeadline = () => {
        if (Date.now() >= deadline) throw limit();
      };
      const observedFailures = new Set();
      const refreshedItems = new Set();
      const checkedAudio = new Set();
      const archiveRecoveryJobs = new Set(receipt.archiveRecoveryJobs ?? []);
      while (true) {
        const pg = server ? null : makeController().forScope(receipt.scope);
        const snapshot = server
          ? await studio("items", "GET", { includeGlobal: true, includeArchived: true })
          : {
              items: pg.listItems({ includeArchived: true }),
              jobs: pg.listJobs(),
              archiveIndexMissing: !pg.hasArchiveIndex(),
            };
        for (const child of snapshot.jobs ?? [])
          if (
            child.parentJobId &&
            receipt.jobs.some((job) => job.id === child.parentJobId) &&
            !receipt.jobs.some((job) => job.id === child.id)
          )
            receipt.jobs.push(child);
        if (positionals[0] === "resume" && snapshot.archiveIndexMissing === true) {
          const previousSize = archiveRecoveryJobs.size;
          for (const job of receipt.jobs) archiveRecoveryJobs.add(job.id);
          if (archiveRecoveryJobs.size !== previousSize) {
            receipt.archiveRecoveryJobs = [...archiveRecoveryJobs];
            saveCheckpoint();
          }
        }
        for (const job of [...receipt.jobs].sort(
          (a, b) => Number(a.kind === "region_edit") - Number(b.kind === "region_edit"),
        )) {
          if (observedFailures.has(job.id)) continue;
          const resuming = positionals[0] === "resume";
          if (resuming && job.kind === "tts" && !job.remoteTaskId) {
            const saved = server
              ? await studio(`tts/receipts/${encodeURIComponent(job.id)}`, "GET").then(
                  (result) => result.receipt,
                  () => {
                    checkDeadline();
                    return null;
                  },
                )
              : pg.getSpeechReceipt(job.id);
            if (saved?.remoteTaskId)
              Object.assign(job, {
                remoteTaskId: saved.remoteTaskId,
                ...(saved.itemId ? { itemId: saved.itemId } : {}),
                ...(saved.batch ? { batch: saved.batch } : {}),
                ...(Number.isFinite(saved.creditsDeducted)
                  ? { creditsDeducted: saved.creditsDeducted, creditsSource: saved.creditsSource }
                  : {}),
              });
          }
          const recoverableCloud =
            resuming &&
            (!job.connection || job.connection === "genvoice") &&
            ["dialogue", "tts", "voice_changer"].includes(job.kind) &&
            Boolean(job.remoteTaskId);
          if (job.status === "failed" && !(resuming && job.kind === "stt") && !recoverableCloud)
            continue;
          const latest = snapshot.jobs?.find((candidate) => candidate.id === job.id);
          if (latest) Object.assign(job, latest);
          if (latest && !["completed", "failed"].includes(latest.status)) continue;
          if (job.kind === "stt") {
            if (
              (!latest || latest.status === "failed") &&
              job.status !== "completed" &&
              positionals[0] === "resume"
            ) {
              if (!job.remoteTaskId)
                throw new Error(
                  "The transcription task ID was not captured. Check Cloud transcription history before retrying; nothing was regenerated.",
                );
              const { file: _file, ...settings } = receipt.input ?? {};
              const input = {
                ...settings,
                taskId: job.remoteTaskId,
                ...(job.sourceFile
                  ? { sourceFile: job.sourceFile, sourceLabel: job.sourceLabel }
                  : {}),
              };
              const result = server
                ? await studio("stt/jobs/resume", "POST", input)
                : await pg.resumeSpeechToText(input);
              Object.assign(job, result.job);
              receipt.jobs = receipt.jobs.filter(
                (candidate) => candidate === job || candidate.id !== job.id,
              );
              delete job.error;
              delete job.finishedAt;
              saveCheckpoint();
            }
            if (job.status === "completed" && job.result) {
              receipt.transcriptions = [
                ...(receipt.transcriptions ?? []).filter(
                  (result) => result.taskId !== job.result.taskId,
                ),
                job.result,
              ];
            }
            continue;
          }
          const inScope = (item) => !item.scope || item.scope === receipt.scope;
          const matchesId = (item) => inScope(item) && item.id === (job.itemId ?? job.id);
          const matchesTask = (item) =>
            inScope(item) &&
            !item.copiedFrom &&
            !item.version &&
            job.remoteTaskId &&
            item.remoteTaskId === job.remoteTaskId &&
            item.kind === job.kind;
          let item = snapshot.items?.find(matchesId) ?? snapshot.items?.find(matchesTask);
          const previousItemId = job.itemId;
          const restoreMissingIndex = archiveRecoveryJobs.has(job.id) && recoverableCloud;
          if (resuming && job.itemId && !item && !restoreMissingIndex) {
            job.status = "failed";
            job.error = "This recording is missing from the selected archive";
            receipt.items = receipt.items.filter((saved) => saved.id !== job.itemId);
            observedFailures.add(job.id);
            continue;
          }
          const recovery = resuming ? recoveryInput(job) : {};
          let missingAudio = hasEmptyWav(item);
          if (
            resuming &&
            isCloudRecording(item, job) &&
            item.audioFile &&
            !checkedAudio.has(item.id)
          ) {
            const localFile = server ? null : pg.audioFile(item.audioFile);
            const matchesLength = (length) =>
              length > 0 && (!Number.isFinite(item.bytes) || length === item.bytes);
            const available = server
              ? await bounded((signal) =>
                  request(
                    `audio/${encodeURIComponent(item.audioFile)}`,
                    "HEAD",
                    undefined,
                    true,
                    receipt.scope,
                    signal,
                  ),
                ).then(
                  (response) => {
                    const length = response.headers.get("content-length");
                    return length === null || matchesLength(Number(length));
                  },
                  (error) => {
                    if (error.status === 404) return false;
                    throw error;
                  },
                )
              : Boolean(
                  localFile && matchesLength(statSync(localFile, { throwIfNoEntry: false })?.size),
                );
            missingAudio ||= !available;
            checkedAudio.add(item.id);
          }
          if (
            resuming &&
            isCloudRecording(item, job) &&
            (missingAudio || needsCloudRefresh(item, recovery.requestedTts)) &&
            !refreshedItems.has(item.id)
          ) {
            refreshedItems.add(item.id);
            const { remoteTaskId: taskId, kind } = item;
            const result = await recoverCloud(pg, taskId, kind, recovery).catch((error) => {
              checkDeadline();
              if (missingAudio) {
                job.status = "failed";
                job.error = error.message;
                if (Number.isFinite(error.creditsDeducted)) {
                  job.creditsDeducted = error.creditsDeducted;
                  job.creditsSource = error.creditsSource;
                }
                receipt.items = receipt.items.filter((saved) => saved.id !== item.id);
                observedFailures.add(job.id);
              }
              return null;
            });
            if (observedFailures.has(job.id)) continue;
            if (result?.item?.id === item.id) item = result.item;
          }
          if (
            resuming &&
            !item &&
            (!latest || restoreMissingIndex || (latest.status === "failed" && recoverableCloud))
          ) {
            if (job.kind === "region_edit") {
              if (!receipt.input || !receipt.argument)
                throw new Error(
                  "This checkpoint has no section-edit request; use region resume with the archived replacement instead.",
                );
              let result;
              if (receipt.input.mode === "local")
                result = server
                  ? await studio(
                      `items/${encodeURIComponent(receipt.argument)}/versions`,
                      "POST",
                      receipt.input,
                    )
                  : await pg.startRegionEdit(receipt.argument, receipt.input);
              else {
                const fragment = receipt.replacementItemId
                  ? { id: receipt.replacementItemId }
                  : receipt.items.find((item) =>
                      receipt.jobs.some(
                        (child) => child.kind === "tts" && child.itemId === item.id,
                      ),
                    );
                if (!fragment) {
                  if (
                    receipt.jobs.some((child) => child.kind === "tts" && child.status !== "failed")
                  )
                    continue;
                  throw new Error(
                    "The replacement task ID was not captured. Check Cloud history, import the phrase and use region resume; no paid request was repeated.",
                  );
                }
                const input = { edit: receipt.input, replacementItemId: fragment.id };
                result = server
                  ? await studio(
                      `items/${encodeURIComponent(receipt.argument)}/versions/resume`,
                      "POST",
                      input,
                    )
                  : await pg.resumeRegionEdit(receipt.argument, input);
              }
              Object.assign(job, result.job);
              receipt.jobs = receipt.jobs.filter(
                (candidate) => candidate === job || candidate.id !== job.id,
              );
              saveCheckpoint();
              continue;
            }
            const taskId = job.remoteTaskId;
            if (!taskId) {
              job.status = "failed";
              job.error =
                "Remote task ID missing. Check saved recordings and Cloud history before retrying.";
              observedFailures.add(job.id);
              continue;
            }
            try {
              item = (await recoverCloud(pg, taskId, job.kind, recovery)).item;
              Object.assign(job, { status: "completed", itemId: item.id, progress: 100 });
              delete job.error;
            } catch (error) {
              checkDeadline();
              const waiting =
                /is not ready \(/.test(error.message) &&
                !/is not ready \((failed|canceled|cancelled|error)\)/.test(error.message);
              job.status = waiting ? "processing" : "failed";
              if (!waiting) {
                job.error = error.message;
                observedFailures.add(job.id);
              }
              if (Number.isFinite(error.creditsDeducted)) {
                job.creditsDeducted = error.creditsDeducted;
                job.creditsSource = error.creditsSource;
              }
            }
          }
          if (item) {
            Object.assign(job, { status: "completed", itemId: item.id, progress: 100 });
            if (Number.isFinite(item.creditsDeducted)) {
              job.creditsDeducted = item.creditsDeducted;
              job.creditsSource = item.creditsSource;
            }
            delete job.error;
            receipt.items = [
              ...receipt.items.filter(
                (previous) => previous.id !== item.id && previous.id !== previousItemId,
              ),
              item,
            ];
            if (archiveRecoveryJobs.delete(job.id))
              receipt.archiveRecoveryJobs = [...archiveRecoveryJobs];
          }
        }
        saveCheckpoint();
        if (receipt.jobs.every((job) => job.status === "completed" || job.status === "failed"))
          break;
        checkDeadline();
        await sleep(Math.min(500, deadline - Date.now()));
      }
      saveCheckpoint();
      const failed = receipt.jobs.filter((job) => job.status === "failed");
      if (failed.length) {
        const error = new Error(
          failed[0].error || "Generation failed; inspect the checkpoint before retrying",
        );
        error.failedJobs = failed.map((job) => ({
          id: job.id,
          error: job.error ?? null,
          credits: Number.isFinite(job.creditsDeducted) ? job.creditsDeducted : "not reported",
        }));
        throw error;
      }
      return receipt;
    };
    const waitForClone = async () => {
      const deadline = Date.now() + waitSeconds * 1000;
      const waitLimit = () =>
        new Error(
          `Wait limit reached. Progress saved to ${checkpoint}; resume this checkpoint to observe without another paid submission.`,
        );
      const observeBeforeDeadline = async (observe) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw waitLimit();
        const signal = AbortSignal.timeout(remaining);
        let onAbort;
        const expired = new Promise((_, reject) => {
          onAbort = () => reject(waitLimit());
          signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
          const result = await Promise.race([observe(signal), expired]);
          if (Date.now() >= deadline) throw waitLimit();
          return result;
        } catch (error) {
          if (signal.aborted || Date.now() >= deadline) throw waitLimit();
          throw error;
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      };
      while (true) {
        const pg = server ? null : makeController().forScope(receipt.scope);
        const snapshot = server
          ? await observeBeforeDeadline((signal) =>
              request(
                `clones/${encodeURIComponent(receipt.cloneId)}`,
                "GET",
                undefined,
                false,
                receipt.scope,
                signal,
              ),
            )
          : { clone: pg.getClone(receipt.cloneId) };
        let clone = snapshot.clone;
        if (!clone)
          throw new Error(
            "Saved clone not found. Use clones list in the selected Project/Global library.",
          );
        if (clone.remoteId)
          clone = server
            ? (
                await observeBeforeDeadline((signal) =>
                  request(
                    `clones/${encodeURIComponent(clone.id)}/refresh`,
                    "POST",
                    undefined,
                    false,
                    receipt.scope,
                    signal,
                  ),
                )
              ).clone
            : await observeBeforeDeadline((signal) => pg.refreshClone(clone.id, { signal }));
        receipt.clone = clone;
        saveCheckpoint();
        if (clone.phase === "ready") return receipt;
        if (clone.phase === "prepared")
          throw new Error(
            `Sample saved but not submitted. Review clones info ${clone.id}, then use clones submit ${clone.id} --yes to create it.`,
          );
        if (clone.phase === "uncertain" && !clone.remoteId)
          throw new Error(
            "The clone response was not confirmed. Use clones cloud and clones link to recover its existing identity; do not create another clone automatically.",
          );
        if (["failed", "unavailable"].includes(clone.phase))
          throw new Error(
            clone.error ||
              clone.warning ||
              "Cloud clone unavailable; inspect its saved source and status.",
          );
        if (Date.now() >= deadline) throw waitLimit();
        await sleep(Math.min(1500, Math.max(0, deadline - Date.now())));
      }
    };
    if (positionals[0] === "resume") {
      if (values.help) {
        out(
          "resume FILE\nContinue a Voice Playground checkpoint without generating again.\n--dry-run reads the checkpoint without network requests or writes.\n--wait SECONDS bounds observation (1–1800, default 900).\nCompleted remote tasks are imported; incomplete section edits reuse their saved replacement audio.",
        );
        return 0;
      }
      if (positionals.length !== 2) throw usageError("resume takes one checkpoint file");
      const checkpointFile = resolve(positionals[1]);
      const savedReceipt = readJson(checkpointFile);
      if (savedReceipt.version !== 1 || !Array.isArray(savedReceipt.jobs))
        throw usageError("This is not a Voice Playground checkpoint");
      if (values["dry-run"]) {
        out(
          JSON.stringify({
            preview: true,
            command: "resume",
            checkpoint: checkpointFile,
            jobs: savedReceipt.jobs,
            totalCredits: 0,
          }),
        );
        return 0;
      }
      checkpoint = checkpointFile;
      receipt = savedReceipt;
      server ??= receipt.server ? new URL(receipt.server) : null;
      scope = receipt.scope;
      project = resolve(receipt.project);
      if (receipt.command?.startsWith("dubbing ")) {
        const budget = createCliObservationBudget(waitSeconds, checkpoint);
        if (receipt.command === "dubbing source-add") {
          const result = await budget.run((signal) =>
            stageDubbingCliSource(
              receipt.input.file
                ? { ...receipt.input, sourceId: receipt.dubbingSourceId }
                : receipt.input,
              {
                pg: server ? null : makeController().forScope(scope),
                request,
                signal,
                save: (source) => {
                  receipt.dubbingSourceId = source.id;
                  receipt.source = source;
                  saveCheckpoint();
                },
              },
            ),
          );
          out(JSON.stringify(result));
        } else
          out(
            JSON.stringify(
              await observeDubbingCli(receipt, {
                pg: server ? null : makeController().forScope(scope),
                request,
                save: saveCheckpoint,
                waitSeconds,
                checkpoint,
                budget,
              }),
            ),
          );
        return 0;
      }
      if (receipt.cloneId) {
        out(JSON.stringify(await waitForClone()));
        return 0;
      }
      if (receipt.command?.startsWith("clones ") && !receipt.cloneId)
        throw new Error(
          "Clone identity was not captured. Use clones list/cloud/link before another paid request; nothing was resubmitted.",
        );
      const budget = createCliObservationBudget(waitSeconds, checkpoint);
      const savedRunId = server
        ? receipt.serverRunId
        : SPEECH_CHECKPOINT_COMMANDS.has(receipt.command)
          ? receipt.id
          : undefined;
      if (savedRunId) {
        const run = server
          ? (
              await budget.run((signal) =>
                request(
                  `tts/runs/${encodeURIComponent(savedRunId)}`,
                  "GET",
                  undefined,
                  false,
                  scope,
                  signal,
                ),
              )
            ).run
          : makeController().forScope(scope).getSpeechRun(savedRunId);
        if (run?.jobs.length) {
          const checkpointJobs = new Map(receipt.jobs.map((job) => [job.id, job]));
          receipt.jobs = run.jobs.map((job) => {
            const previous = checkpointJobs.get(job.id);
            checkpointJobs.delete(job.id);
            return { ...previous, ...job };
          });
          receipt.jobs.push(...checkpointJobs.values());
          if (run.batchId) receipt.batchId = run.batchId;
          saveCheckpoint();
        }
      }
      if (!receipt.jobs.length)
        throw new Error(
          "The request stopped before its job ID was captured. Check saved recordings and Cloud history before retrying; nothing was regenerated.",
        );
      out(JSON.stringify(await waitForJobs(budget)));
      return 0;
    }
    const schemaMode = positionals[0] === "schema";
    const words = schemaMode ? positionals.slice(1) : positionals;
    const command = PLAYGROUND_COMMANDS.filter((entry) =>
      entry.name.split(" ").every((word, index) => words[index] === word),
    ).sort((a, b) => b.name.length - a.name.length)[0];
    if (!command && !schemaMode) {
      const children = PLAYGROUND_COMMANDS.filter((entry) =>
        words.every((word, index) => entry.name.split(" ")[index] === word),
      );
      if (children.length) {
        out(
          `${words.join(" ")} commands\n${children.map((entry) => `  ${entry.name.padEnd(26)} ${entry.description}`).join("\n")}\n\nUse <command> --help or schema <command> for complete input fields.`,
        );
        return 0;
      }
    }
    if (!command)
      throw usageError(`Unknown command ${words.join(" ")}; run --help for the command list`);
    const extras = words.slice(command.name.split(" ").length);
    if (schemaMode || values.help) {
      const spec = commandSchema(command);
      if (schemaMode) out(JSON.stringify(spec));
      else
        out(
          `${command.name}${command.argument ? ` ${command.argument}` : ""}\n${command.description}\n\nInput fields:\n${JSON.stringify(spec.input, null, 2)}\n${command.example ? `\nExample --input-file JSON:\n${JSON.stringify(command.example, null, 2)}\n` : ""}\nNext: bun run voice:playground schema ${command.name}\n${command.effect === "paid" || command.effect === "delete" ? "Without --yes this command only previews.\n" : ""}Use --server URL while Studio is open, or --project PATH headlessly. See top-level --help for shared options.`,
        );
      return 0;
    }
    if (extras.length !== (command.argument ? 1 : 0))
      throw usageError(
        `${command.name} ${command.argument ?? ""} takes ${command.argument ? "one ID" : "no positional arguments"}; use --input-file for settings`,
      );
    if (values.input && values["input-file"])
      throw usageError("Choose --input or --input-file, not both");
    let input;
    try {
      input = values["input-file"]
        ? readJson(values["input-file"])
        : values.input
          ? JSON.parse(values.input)
          : {};
    } catch (error) {
      throw usageError(`Cannot read JSON input: ${error.message}; prefer --input-file FILE`);
    }
    const validated = command.input.safeParse(input);
    if (!validated.success)
      throw usageError(
        validated.error.issues
          .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
          .join("; "),
      );
    input = validated.data;
    const paid =
      command.effect === "paid" || (command.name === "region edit" && input.mode === "regenerate");
    if (values["dry-run"] || ((paid || command.effect === "delete") && !values.yes)) {
      out(
        JSON.stringify({
          preview: true,
          command: command.name,
          argument: extras[0] ?? null,
          scope,
          paid,
          input: redact(input),
          totalCredits: paid ? null : 0,
          next: `Repeat with --yes${values["dry-run"] ? " and without --dry-run" : ""} to execute.`,
        }),
      );
      return 0;
    }
    if (
      (command.name === "items export" ||
        command.name === "voices preview" ||
        command.name === "region preview" ||
        command.name === "clones export-source" ||
        command.name === "dubbing export-source") &&
      !values.out
    )
      throw usageError(`${command.name} requires --out FILE`);
    const path = command.path.replace(":id", encodeURIComponent(extras[0] ?? ""));
    const tracksClones = ["clones create", "clones submit", "clones retry"].includes(command.name);
    const tracksDubbing = [
      "dubbing submit",
      "dubbing retry",
      "dubbing import",
      "dubbing refresh",
      "dubbing link",
    ].includes(command.name);
    const tracksDubbingSource = command.name === "dubbing source-add";
    const tracksJobs =
      (paid && !tracksClones && !tracksDubbing) ||
      command.name === "region edit" ||
      command.name === "region resume";
    const tracksServerSpeech = server && SPEECH_CHECKPOINT_COMMANDS.has(command.name);
    if (tracksJobs || tracksClones || tracksDubbing || tracksDubbingSource) {
      const id = randomUUID();
      checkpoint = resolve(
        values.checkpoint ??
          join(homedir(), ".cache", "mc-films", "voice-playground", "runs", `${id}.json`),
      );
      receipt = {
        version: 1,
        id,
        command: command.name,
        server: server?.origin ?? null,
        ...(tracksServerSpeech ? { serverRunId: id } : {}),
        project,
        scope,
        jobs: [],
        items: [],
        argument: extras[0],
        ...(tracksClones && command.argument ? { cloneId: extras[0] } : {}),
        ...(tracksDubbing && !["dubbing retry", "dubbing import"].includes(command.name)
          ? { dubbingId: extras[0] }
          : {}),
        input:
          command.name === "region resume"
            ? input.edit
            : tracksDubbingSource && input.file
              ? { ...input, file: resolve(input.file) }
              : input,
        ...(command.name === "region resume" ? { replacementItemId: input.replacementItemId } : {}),
        startedAt: new Date().toISOString(),
      };
      saveCheckpoint();
      err(`Progress: ${checkpoint}`);
      if (tracksServerSpeech && scope === "project")
        await request(`tts/runs/${encodeURIComponent(id)}`);
      if (tracksDubbing || tracksDubbingSource)
        dubbingBudget = createCliObservationBudget(waitSeconds, checkpoint);
    }
    let result;
    if (tracksDubbingSource) {
      result = await dubbingBudget.run((signal) =>
        stageDubbingCliSource(receipt.input, {
          pg: server ? null : makeController().forScope(scope),
          request,
          signal,
          save: (source) => {
            receipt.dubbingSourceId = source.id;
            receipt.source = source;
            saveCheckpoint();
          },
        }),
      );
    } else if (server) {
      let body = input;
      if (command.name === "clones create") {
        body = new FormData();
        const { file, ...settings } = input;
        body.set("settings", JSON.stringify(settings));
        body.set("file", new File([Bun.file(resolve(file))], basename(file)));
      }
      if (command.name === "sources add" || (command.name === "transcribe" && input.file)) {
        body = new FormData();
        for (const [key, value] of Object.entries(input))
          if (key !== "file" && value !== undefined)
            body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        body.set(
          command.name === "sources add" ? "audio" : "file",
          new File([readFileSync(input.file)], basename(input.file)),
        );
      }
      if (command.name === "voices preview") {
        const response = await request(path, "POST", input, true);
        const bytes = Buffer.from(await response.arrayBuffer());
        const extension = sniffContainerMagic(bytes);
        if (!extension || !(await containerHasAudio(extension, bytes)))
          throw new Error("Voice preview is not an audio file");
        await exportFile(values.out, bytes);
        result = { file: resolve(values.out), mimeType: audioMimeForExt(extension) };
      } else if (
        command.name === "clones export-source" ||
        command.name === "dubbing export-source"
      ) {
        const response = await request(path, "GET", undefined, true);
        await exportFile(values.out, response);
        result = { file: resolve(values.out) };
      } else if (command.name === "region preview") {
        const response = await request(path, command.method, body, true);
        writeFileSync(resolve(values.out), new Uint8Array(await response.arrayBuffer()));
        result = {
          file: resolve(values.out),
          durationSeconds: Number(response.headers.get("x-audio-duration")),
        };
      } else if (command.name === "items export") {
        if (input.format === "source" || input.format === "result") {
          const response = await request(
            `items/${encodeURIComponent(extras[0])}/dubbing/${input.format}`,
            "GET",
            undefined,
            true,
          );
          await exportFile(values.out, response);
          result = { file: resolve(values.out) };
        } else {
          const { item } = await request(path);
          const inline = inlineRecordingExport(item, input.format);
          if (inline !== undefined) {
            await exportFile(values.out, new Response(inline));
            result = { file: resolve(values.out) };
          } else {
            if (!["audio", "srt"].includes(input.format))
              throw new Error(`This transcript has no ${input.format} export`);
            const media = input.format === "srt" ? item.srtFile : item.audioFile;
            if (!media) throw new Error(`This recording has no ${input.format} file`);
            const response = await request(
              `${input.format === "srt" ? "srt" : "audio"}/${encodeURIComponent(media)}`,
              "GET",
              undefined,
              true,
            );
            await exportFile(values.out, response);
            result = { file: resolve(values.out) };
          }
        }
      } else
        result = tracksDubbing
          ? await dubbingBudget.run((signal) =>
              request(path, command.method, body, false, scope, signal),
            )
          : await request(path, command.method, body);
    } else {
      const pg = makeController().forScope(scope),
        id = extras[0];
      switch (command.name) {
        case "dubbing source-info":
          result = { source: pg.getDubbingSource(id) };
          if (!result.source) throw new Error("Dubbing source not found");
          break;
        case "dubbing export-source":
          await exportFile(values.out, Bun.file(pg.dubbingSourcePath(id)));
          result = { file: resolve(values.out) };
          break;
        case "dubbing prepare":
          result = { job: pg.prepareDubbing(input) };
          break;
        case "dubbing list":
          result = { jobs: pg.listDubbing(input) };
          break;
        case "dubbing info":
          result = { job: pg.getDubbing(id) };
          if (!result.job) throw new Error("Dubbing job not found in this library");
          break;
        case "dubbing submit":
          result = { job: pg.submitDubbing(id) };
          break;
        case "dubbing refresh":
          result = { job: await dubbingBudget.run((signal) => pg.refreshDubbing(id, { signal })) };
          break;
        case "dubbing cloud":
          result = await pg.listCloudDubbing(input);
          break;
        case "dubbing import":
          result = {
            job: await dubbingBudget.run((signal) => pg.importDubbing(input.taskId, { signal })),
          };
          break;
        case "dubbing link":
          result = {
            job: await dubbingBudget.run((signal) => pg.linkDubbing(id, input.taskId, { signal })),
          };
          break;
        case "dubbing retry":
          result = { job: await dubbingBudget.run((signal) => pg.retryDubbing(id, { signal })) };
          break;
        case "dubbing delete-cloud":
          result = { job: await pg.deleteCloudDubbing(id) };
          break;
        case "clones list":
          result = {
            clones: input.refresh ? await pg.refreshClones(input) : pg.listClones(input),
            favoriteVoices: pg.listVoiceFavorites(),
          };
          break;
        case "clones info":
          result = { clone: pg.getClone(id) };
          if (!result.clone) throw new Error("Clone not found in the selected library");
          break;
        case "clones cloud":
          result = { voices: await pg.listCloudClones() };
          break;
        case "clones create": {
          const { file, ...settings } = input;
          result = {
            clone: await pg.createClone(
              new File([Bun.file(resolve(file))], basename(file)),
              settings,
            ),
          };
          break;
        }
        case "clones submit":
          result = { clone: await pg.submitClone(id) };
          break;
        case "clones refresh":
          result = { clone: await pg.refreshClone(id) };
          break;
        case "clones adopt":
          result = { clone: await pg.adoptClone(input) };
          break;
        case "clones link":
          result = { clone: await pg.linkClone(id, input) };
          break;
        case "clones update":
          result = { clone: pg.patchClone(id, input) };
          break;
        case "clones copy":
          result = { clone: await pg.copyCloneToScope(id, input.scope) };
          break;
        case "clones retry":
          result = { clone: await pg.retryClone(id) };
          break;
        case "clones delete":
          result = { clone: await pg.deleteCloudClone(id) };
          break;
        case "clones export-source":
          await exportFile(values.out, Bun.file(pg.cloneSource(id)));
          result = { file: resolve(values.out) };
          break;

        case "status":
          result = await pg.getStatus(input);
          break;
        case "config":
          result = await pg.setConfig(input);
          break;
        case "catalog":
          result = await pg.getCatalog(input);
          break;
        case "voices search":
          result = await pg.searchCastingVoices(input);
          break;
        case "voices cached":
          result = pg.searchCachedVoices(input);
          break;
        case "voices usage":
          result = pg.rankVoiceUsage(input);
          break;
        case "voices preview": {
          const { bytes, mimeType } = await pg.downloadVoicePreview(input);
          await exportFile(values.out, new Response(bytes));
          result = { file: resolve(values.out), mimeType };
          break;
        }
        case "profiles list":
          result = findVoiceProfiles(pg.listVoiceProfiles(input), input, pg.listCreatorFavorites());
          break;
        case "profiles info": {
          const profile = pg.getVoiceProfile(id);
          if (!profile)
            throw new Error("Voice profile not found; use profiles list in the correct scope");
          result = { profile };
          break;
        }
        case "profiles save":
          result = { profile: pg.saveVoiceProfile(input) };
          break;
        case "profiles update":
          result = { profile: pg.patchVoiceProfile(id, input) };
          break;
        case "profiles copy":
          result = { profile: pg.copyVoiceProfile(id, input.scope) };
          break;
        case "items list":
          result = { items: pg.listItems(input), jobs: pg.listJobs(input) };
          break;
        case "items find":
          result = pg.findRecordings(input);
          break;
        case "items recipe": {
          const item = pg.getItem(id);
          if (!item)
            throw new Error("Recording not found; choose the correct Project/Global scope");
          result = recordingRecipe(item, pg.getItem);
          break;
        }
        case "items info":
          result = { item: pg.getItem(id) };
          if (!result.item)
            throw new Error("Recording not found; use items list in the correct scope");
          break;
        case "items media":
          result = await pg.inspectRecordingMedia(id);
          break;
        case "items captions": {
          const item = pg.getItem(id);
          if (!item) throw new Error("Recording not found in this library");
          result = recordingCaptions(item, pg.srtFile);
          break;
        }
        case "items update":
          result = { item: await pg.patchItem(id, input) };
          if (!result.item) throw new Error("Recording not found in this library");
          break;
        case "items bulk":
          result = await pg.patchItems(input.ids, input.patch);
          break;
        case "items delete": {
          const item = await pg.patchItem(id, { archived: true });
          if (!item) throw new Error("Recording not found in this library");
          result = { ok: true, archived: true, item };
          break;
        }
        case "items restore":
          result = { item: await pg.patchItem(id, { archived: false }) };
          if (!result.item) throw new Error("Recording not found in this library");
          break;
        case "items expired":
          result = pg.previewExpiredRecordings();
          break;
        case "items purge-expired":
          result = await pg.purgeExpiredRecordings(input.ids);
          break;
        case "items copy":
          result = { item: await pg.copyToScope(id, input.scope) };
          break;
        case "items retry":
          result = await pg.retryItem(id, input, { runId: receipt?.id });
          break;
        case "items export": {
          const item = pg.getItem(id),
            inline = inlineRecordingExport(item, input.format),
            file =
              item &&
              (input.format === "source" || input.format === "result"
                ? pg.dubbingAsset(id, input.format)
                : input.format === "srt"
                  ? pg.srtFile(item.srtFile)
                  : pg.audioFile(item.audioFile));
          if (inline === undefined && !["audio", "srt", "source", "result"].includes(input.format))
            throw new Error(`This transcript has no ${input.format} export`);
          if (!file && inline === undefined)
            throw new Error("Requested recording/export is unavailable");
          if (inline !== undefined) await exportFile(values.out, new Response(inline));
          else await exportFile(values.out, Bun.file(file));
          result = { file: resolve(values.out) };
          break;
        }
        case "sources add":
          result = pg.saveSource({ bytes: readFileSync(input.file), name: basename(input.file) });
          break;
        case "generate tts":
          result = await pg.startTts(input, { runId: receipt?.id });
          break;
        case "generate quote":
          result = await pg.quoteTtsBatch(input);
          break;
        case "generate batch":
          result = await pg.startTtsBatch(input, { runId: receipt?.id });
          break;
        case "generate dialogue":
          result = await pg.startDialogue(input);
          break;
        case "generate voice-changer":
          result = await pg.startVoiceChanger(input);
          break;
        case "transcribe":
          result = pg.startSpeechToText({
            ...input,
            ...(input.file
              ? { fileBytes: readFileSync(input.file), fileName: basename(input.file) }
              : {}),
          });
          break;
        case "history list":
          result = await pg.fetchRemoteHistory(input);
          break;
        case "history import":
          result = await pg.importRemoteTask(input.taskId, input.kind ?? "tts", {
            requestedTts: input.requestedTts,
            dialogueRecipe: input.dialogueRecipe,
            dialogueParentId: input.dialogueParentId,
          });
          break;
        case "templates list":
          result = { templates: pg.listTemplates(input) };
          break;
        case "templates find":
          result = findVoiceTemplates(pg.listTemplates(input), input);
          break;
        case "templates info":
          result = { template: pg.getTemplate(id) };
          if (!result.template) throw new Error("Template not found in this library");
          break;
        case "templates update":
          result = { template: await pg.patchTemplate(id, input) };
          if (!result.template) throw new Error("Template not found in this library");
          break;
        case "templates save":
          result = { template: await pg.saveTemplate(input) };
          break;
        case "templates from-recording":
          result = { template: await pg.saveTemplateFromRecording(id, input) };
          break;
        case "templates recipe":
          result = pg.templateRecipe(id);
          break;
        case "templates bulk":
          result = pg.patchTemplates(input.ids, input.patch);
          break;
        case "templates delete":
          result = { removed: await pg.deleteTemplate(id) };
          break;
        case "templates copy":
          result = { template: await pg.copyTemplateToScope(id, input.scope) };
          break;
        case "favorites voices":
          result = pg.findFavoriteVoices(input);
          break;
        case "favorites voice":
          result = { voices: await pg.setVoiceFavorite(input.voice, input.favorite) };
          break;
        case "favorites voices-set":
          result = await pg.setVoiceFavorites(input);
          break;
        case "favorites creators":
          result = { creators: pg.listCreatorFavorites() };
          break;
        case "favorites creator":
          result = { creators: pg.setCreatorFavorite(input) };
          break;
        case "creators list":
          result = { creators: pg.listCreatorProfiles() };
          break;
        case "creators save":
          result = { creator: pg.saveCreatorProfile(input) };
          break;
        case "favorites takes":
          result = { uids: pg.listTakeFavorites() };
          break;
        case "favorites take":
          result = { uids: await pg.setTakeFavorite(input.uid, input.favorite) };
          break;
        case "film archive":
          result = { item: await pg.archiveFilmTake(id, input) };
          break;
        case "film usage":
          result = { usage: pg.listUsage() };
          break;
        case "film alternatives":
          result = await pg.promoteToFilmTake(input);
          if (result.error) throw new Error(result.error);
          break;
        case "film use":
          result = await pg.applyToFilm(input);
          break;
        case "region info":
          result = await pg.inspectRegion(id);
          break;
        case "region preview": {
          const preview = await pg.previewRegion(id, input);
          writeFileSync(resolve(values.out), preview.bytes);
          result = { file: resolve(values.out), durationSeconds: preview.durationSeconds };
          break;
        }
        case "region edit":
          result = await pg.startRegionEdit(id, input);
          break;
        case "region resume":
          result = await pg.resumeRegionEdit(id, input);
          break;
        case "versions list":
          result = { items: pg.listVersions(id) };
          break;
        default:
          throw new Error("Command is unavailable");
      }
    }
    if (tracksDubbing) {
      receipt.dubbingId = result.job?.id ?? receipt.dubbingId;
      receipt.dubbing = result.job;
      saveCheckpoint();
      result = await observeDubbingCli(receipt, {
        pg: server ? null : makeController().forScope(scope),
        request,
        save: saveCheckpoint,
        waitSeconds,
        checkpoint,
        budget: dubbingBudget,
      });
    }
    if (tracksClones) {
      receipt.cloneId = result.clone?.id ?? receipt.cloneId;
      receipt.clone = result.clone;
      saveCheckpoint();
      if (!receipt.cloneId)
        throw new Error(
          "No saved clone ID returned; inspect clones list/cloud before submitting again.",
        );
      result = await waitForClone();
    }
    if (tracksJobs) {
      if (result.batchId) receipt.batchId = result.batchId;
      receipt.jobs = (result.jobs ?? (result.job ? [result.job] : [])).map((job) => ({ ...job }));
      if (!receipt.jobs.length)
        throw new Error("No job was returned; inspect history before submitting again");
      saveCheckpoint();
      if (!server && SPEECH_CHECKPOINT_COMMANDS.has(command.name))
        await waitForLocalSpeechSubmission();
      result = await waitForJobs();
    }
    out(JSON.stringify(result));
    return 0;
  } catch (error) {
    saveCheckpoint();
    const message = error.message ?? String(error);
    const code =
      error.exitCode ??
      (typeof error.code === "string" && error.code.startsWith("ERR_PARSE_ARGS") ? 2 : 1);
    err(
      JSON.stringify({
        error: message,
        ...(checkpoint ? { checkpoint } : {}),
        ...(error.failedJobs ? { failed: error.failedJobs } : {}),
        next:
          code === 2
            ? "Use command --help or schema <command> to check its input."
            : error.failedJobs
              ? "The provider failed these jobs, not the Studio or the project: read failed[].error, since a provider state (maintenance, quota) fails every retry until it clears. failed[].credits is what each cost; not reported = the provider gave no figure, so read the account balance on its site."
              : "Check the selected project/server and saved progress before retrying.",
      }),
    );
    return code;
  } finally {
    observing = false;
    controller?.close();
  }
}
