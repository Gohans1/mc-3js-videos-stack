import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { SoundTimeline } from "./contract.ts";
import { openTimelineFile } from "./timeline_file.mjs";
import { voiceIdentity, withVoiceMetadata } from "./voice-playground-casting.mjs";
import {
  SAFE_DUBBING_SOURCE_FILE,
  SAFE_DUBBING_VIDEO_FILE,
} from "./voice-playground-dubbing-contract.ts";
import {
  audioMimeForExt,
  extractAudioTags,
  inside,
  isSafeRemoteId,
  MAX_AUDIO_BYTES,
  nextTmp,
  SAFE_MEDIA_FILE,
  SAFE_SRT_FILE,
  sanitizeRemoteMediaUrl,
  writeAtomic,
} from "./voice-playground-genvoice.mjs";
import { createVoiceProfiles } from "./voice-playground-profiles.mjs";
import { reconcileTemplateDraft } from "./voice-playground-template-recipe.mjs";
import {
  hasProvisionalGenVoiceCharge,
  hasUnverifiedZeroCharge,
  isUnverifiedCloudSpeech,
  recordingAudioFiles,
  recordingRootId,
  withChargeEvidence,
} from "./voice-playground-text.mjs";
import { resizeNarrationBrickForSwap } from "./voice-swap.ts";

export const voiceProjectId = (root) => {
  if (!root) return undefined;
  const path = existsSync(root) ? realpathSync(root) : resolve(root);
  return createHash("sha256")
    .update(process.platform === "win32" ? path.toLowerCase() : path)
    .digest("hex");
};

export function createPlaygroundLibrary({
  archiveTemplateSource,
  scope,
  project,
  storageDir,
  emit,
  getItem,
  mutateStore,
  protectRecording,
  ensureSafeDir,
  shared,
  metadata,
  voice,
  apiBase,
  parentController,
  getController,
  createScope,
  onVoiceChanged,
  audioFavorites,
  cachedVoices,
  onAudioFavoritesChanged,
}) {
  let sibling = parentController;
  const forScope = (nextScope) => {
    if (nextScope !== "global" && nextScope !== "project")
      throw Object.assign(new Error("Choose project or global library"), { status: 400 });
    if (nextScope === scope) return getController();
    sibling ??= createScope(nextScope);
    return sibling;
  };

  const itemId = () => `pg_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const acceptCopy = async (item, files, { id = itemId(), reconcileCloud = false } = {}) => {
    const copy = {
      ...structuredClone(item),
      id,
      scope,
      replacedAudioFiles: undefined,
      copiedFrom: { id: item.id, scope: item.scope ?? "project" },
      updatedAt: new Date().toISOString(),
    };
    if (copy.voiceChanger && item.scope && item.scope !== scope) {
      delete copy.voiceChanger.sourceItemId;
      delete copy.voiceChanger.sourceTakeKind;
      delete copy.voiceChanger.sourceTakeFile;
    }
    const staged = [];
    const promoted = [];
    let archived;
    let changed = false;
    try {
      for (const [field, folder, bytes, original] of files) {
        const destDir = ensureSafeDir(join(storageDir, folder));
        const file = `${field === "sourceFile" || field === "dubbingSourceFile" ? "src_" : ""}${id}${extname(original)}`;
        const dest = join(destDir, file);
        const part = `${dest}.${nextTmp()}.part`;
        staged.push({ field, part, dest });
        await Bun.write(part, bytes);
        if (field === "sourceFile")
          copy.voiceChanger = {
            ...copy.voiceChanger,
            sourceFile: file,
            sourceItemId: undefined,
            sourceTakeKind: undefined,
            sourceTakeFile: undefined,
          };
        else if (field === "dubbingSourceFile" || field === "dubbingResultFile")
          copy.dubbing = {
            ...copy.dubbing,
            [field === "dubbingSourceFile" ? "sourceFile" : "resultFile"]: file,
          };
        else copy[field] = file;
      }
      archived = await mutateStore((items) => {
        const existing = items.find((row) => row.id === id);
        if (existing) return existing;
        const scopeMatch =
          reconcileCloud &&
          copy.kind === "tts" &&
          (copy.connection ?? "genvoice") === "genvoice" &&
          copy.remoteTaskId &&
          !copy.version
            ? items.find(
                (row) =>
                  !row.version &&
                  row.kind === "tts" &&
                  (row.connection ?? "genvoice") === "genvoice" &&
                  row.remoteTaskId === copy.remoteTaskId,
              )
            : undefined;
        const supplementOnly =
          scopeMatch && (!copy.generationRecipe || !isUnverifiedCloudSpeech(scopeMatch));
        const destinationAudio = scopeMatch && getController().audioFile(scopeMatch.audioFile);
        const destinationBytes =
          destinationAudio && statSync(destinationAudio, { throwIfNoEntry: false })?.size;
        const repairAudio =
          scopeMatch &&
          copy.audioFile &&
          (!destinationBytes ||
            (Number.isFinite(scopeMatch.bytes) && scopeMatch.bytes !== destinationBytes) ||
            (scopeMatch.mimeType === "audio/wav" && scopeMatch.durationSeconds === 0));
        const addSubtitles =
          scopeMatch &&
          !scopeMatch.srtFile &&
          !scopeMatch.srtText &&
          (copy.srtFile || copy.srtText);
        const addCharge =
          scopeMatch &&
          (!Number.isFinite(scopeMatch.creditsDeducted) ||
            hasUnverifiedZeroCharge(scopeMatch) ||
            (hasProvisionalGenVoiceCharge(scopeMatch) && copy.creditsSource === "history")) &&
          Number.isFinite(copy.creditsDeducted);
        if (supplementOnly && !addSubtitles && !addCharge && !repairAudio) return scopeMatch;
        for (const { field, part, dest } of staged) {
          if (
            scopeMatch &&
            ((field === "srtFile" && !addSubtitles) ||
              (supplementOnly && field !== "srtFile" && !(field === "audioFile" && repairAudio)))
          )
            continue;
          renameSync(part, dest);
          promoted.push(dest);
        }
        changed = true;
        if (supplementOnly) {
          return (items[items.indexOf(scopeMatch)] = {
            ...scopeMatch,
            ...(repairAudio
              ? {
                  audioFile: copy.audioFile,
                  mimeType: copy.mimeType,
                  bytes: copy.bytes,
                  durationSeconds: copy.durationSeconds,
                  pcmFormatPending: copy.pcmFormatPending,
                  replacedAudioFiles: recordingAudioFiles(scopeMatch),
                }
              : {}),
            ...(addCharge
              ? {
                  creditsDeducted: copy.creditsDeducted,
                  creditsReported: copy.creditsReported,
                  creditsSource: copy.creditsSource,
                }
              : {}),
            ...(addSubtitles
              ? { srtFile: copy.srtFile, srtText: copy.srtText, srtPending: false }
              : {}),
            updatedAt: copy.updatedAt,
          });
        }
        if (scopeMatch) {
          const {
            id,
            title,
            notes,
            description,
            favorite,
            tags,
            rating,
            color,
            rights,
            archivedAt,
            createdAt,
            copiedFrom,
          } = scopeMatch;
          return (items[items.indexOf(scopeMatch)] = {
            ...copy,
            id,
            title,
            notes: notes ?? copy.notes,
            description,
            favorite,
            tags: [...new Set([...(tags ?? []), ...(copy.tags ?? [])])],
            rating,
            color,
            rights,
            archivedAt,
            createdAt,
            copiedFrom,
            retentionTracked: scopeMatch.retentionTracked,
            retentionPinned: scopeMatch.retentionPinned,
            replacedAudioFiles: recordingAudioFiles(scopeMatch),
            creditsDeducted: addCharge ? copy.creditsDeducted : scopeMatch.creditsDeducted,
            creditsReported: addCharge ? copy.creditsReported : scopeMatch.creditsReported,
            creditsSource: addCharge ? copy.creditsSource : scopeMatch.creditsSource,
            srtFile: addSubtitles ? copy.srtFile : scopeMatch.srtFile,
            srtText: addSubtitles ? copy.srtText : scopeMatch.srtText,
          });
        }
        items.unshift(copy);
        return copy;
      });
    } catch (error) {
      for (const file of promoted) rmSync(file, { force: true });
      throw error;
    } finally {
      for (const { part } of staged) rmSync(part, { force: true });
    }
    const itemWithFee = withChargeEvidence(archived);
    if (changed) emit({ type: "item", item: itemWithFee });
    return { ...itemWithFee, scope };
  };
  const mediaFiles = (item) => {
    const files = [];
    for (const [field, folder, file] of [
      ["audioFile", "audio", item.audioFile],
      ["srtFile", "srt", item.srtFile],
      ["sourceFile", "sources", item.voiceChanger?.sourceFile],
      ["dubbingSourceFile", "sources", item.dubbing?.sourceFile],
      ["dubbingResultFile", "video", item.dubbing?.resultFile],
    ]) {
      if (!file) continue;
      const valid =
        field === "srtFile"
          ? SAFE_SRT_FILE
          : field === "dubbingSourceFile"
            ? SAFE_DUBBING_SOURCE_FILE
            : field === "dubbingResultFile"
              ? SAFE_DUBBING_VIDEO_FILE
              : SAFE_MEDIA_FILE;
      const path = join(storageDir, folder, file);
      if (
        !valid.test(file) ||
        !existsSync(path) ||
        lstatSync(path).isSymbolicLink() ||
        !inside(realpathSync(storageDir), realpathSync(path))
      )
        throw new Error("Original media is unavailable; restore it before copying");
      files.push([field, folder, Bun.file(path), file]);
    }
    const legacy = item.voiceChanger;
    if (
      legacy &&
      !legacy.sourceFile &&
      (legacy.sourceItemId || (scope === "project" && legacy.sourceTakeFile))
    ) {
      let source;
      try {
        source = getController().readSource({
          sourceItemId: legacy.sourceItemId,
          sourceTakeKind: scope === "project" ? legacy.sourceTakeKind || "takes" : undefined,
          sourceTakeFile: scope === "project" ? legacy.sourceTakeFile : undefined,
          maxBytes: MAX_AUDIO_BYTES,
          allowOtherScope: false,
        });
      } catch {
        // The recorded result can still be copied if its legacy source is gone.
      }
      if (source) files.push(["sourceFile", "sources", source.bytes, source.name]);
    }
    return files;
  };
  const copyToScope = async (id, destination) => {
    const target = forScope(destination);
    if (target === getController())
      throw Object.assign(new Error("Choose the other library"), { status: 400 });
    if (!getItem(id)) throw Object.assign(new Error("Playground item not found"), { status: 404 });
    const family = getController().listVersions(id);
    const withSources = new Map(family.map((item) => [item.id, item]));
    for (const source of withSources.values()) {
      for (const dependencyId of [
        source.version?.replacement?.id,
        source.version?.parentId,
        source.version?.rootId,
        source.retry?.parentId,
        source.retry?.rootId,
      ]) {
        if (!dependencyId || withSources.has(dependencyId)) continue;
        const dependency = getItem(dependencyId);
        if (dependency) withSources.set(dependencyId, dependency);
      }
    }
    const ids = new Map([...withSources.keys()].map((sourceId) => [sourceId, itemId()]));
    const base = family.find((item) => item.id === recordingRootId(getItem(id))) ?? family[0];
    const copied = new Map();
    const created = [];
    const copyVersion = async (source) => {
      const historyGaps = { ...source.version?.historyGaps };
      if (source.version?.rootId && !ids.has(source.version.rootId))
        historyGaps.root = { id: source.version.rootId, scope };
      if (source.version?.parentId && !ids.has(source.version.parentId))
        historyGaps.parent = { id: source.version.parentId, scope };
      const version = source.version
        ? {
            ...source.version,
            rootId: ids.get(source.version.rootId) ?? ids.get(base.id),
            parentId: ids.get(source.version.parentId),
            ...(source.version.replacement
              ? {
                  replacement: {
                    ...source.version.replacement,
                    id: ids.get(source.version.replacement.id) ?? source.version.replacement.id,
                  },
                }
              : {}),
            ...(Object.keys(historyGaps).length ? { historyGaps } : {}),
          }
        : undefined;
      const retry = source.retry
        ? {
            rootId: ids.get(source.retry.rootId) ?? ids.get(base.id),
            parentId: ids.get(source.retry.parentId),
          }
        : undefined;
      const item = await target.acceptCopy(
        { ...source, ...(version ? { version } : {}), ...(retry ? { retry } : {}) },
        mediaFiles(source),
        { id: ids.get(source.id), reconcileCloud: source.id === base.id },
      );
      if (item.id === ids.get(source.id)) created.push(item.id);
      ids.set(source.id, item.id);
      copied.set(source.id, item);
      return item;
    };
    try {
      await copyVersion(base);
      for (const source of withSources.values())
        if (source.id !== base.id) await copyVersion(source);
      return copied.get(id);
    } catch (error) {
      for (const id of created.reverse()) await target.deleteItem(id);
      throw error;
    }
  };
  const listTemplates = ({ includeGlobal = false, archived = false } = {}) => [
    ...metadata()
      .list("templates")
      .filter((template) => Boolean(template.archivedAt) === archived)
      .map((template) => ({ ...template, scope })),
    ...(includeGlobal && scope === "project" ? forScope("global").listTemplates({ archived }) : []),
  ];
  const getTemplate = (id) => {
    const template = metadata()
      .list("templates")
      .find((item) => item.id === id);
    return template ? { ...template, scope } : null;
  };
  const retainTemplateDraft = (draft) => {
    const preview = draft.voicePreviewUrl;
    if (
      scope === "global" &&
      typeof preview === "string" &&
      preview.startsWith("/api/voice/playground/audio/") &&
      preview.endsWith("?scope=project")
    ) {
      const { voicePreviewUrl: _privatePreview, ...shared } = draft;
      return archiveTemplateSource(shared);
    }
    return archiveTemplateSource(draft);
  };
  const saveTemplate = async ({ id, title, draft, favorite, description, tags, rating }) => {
    const now = new Date().toISOString();
    const retainedDraft = draft ? await retainTemplateDraft(draft) : undefined;
    const template = metadata().mutate("templates", (templates) => {
      const index = id ? templates.findIndex((item) => item.id === id) : -1;
      if (id && index < 0)
        throw Object.assign(new Error("Template not found; save a new template"), { status: 404 });
      const old = index >= 0 ? templates[index] : {};
      const next = {
        ...old,
        id: id ?? `pt_${randomUUID()}`,
        scope,
        title: title ?? old.title,
        draft: structuredClone(
          retainedDraft ? reconcileTemplateDraft(old.draft, retainedDraft) : old.draft,
        ),
        favorite: favorite ?? old.favorite ?? false,
        description: description ?? old.description,
        tags: tags ?? old.tags,
        rating: rating !== undefined ? rating : old.rating,
        createdAt: old.createdAt ?? now,
        updatedAt: now,
      };
      if (index >= 0) templates[index] = next;
      else templates.unshift(next);
      return next;
    });
    emit({ type: "templates" });
    return template;
  };
  const patchTemplates = (ids, { archived, ...changes }) => {
    const result = metadata().mutate("templates", (templates) => {
      const indices = new Map(templates.map(({ id }, index) => [id, index]));
      const now = new Date().toISOString();
      const updated = [],
        missing = [];
      for (const id of new Set(ids)) {
        const index = indices.get(id);
        if (index === undefined) {
          missing.push(id);
          continue;
        }
        const current = templates[index];
        const next = {
          ...current,
          ...changes,
          scope,
          updatedAt: now,
          ...(changes.draft ? { draft: reconcileTemplateDraft(current.draft, changes.draft) } : {}),
        };
        if (archived === true) next.archivedAt ??= now;
        if (archived === false) delete next.archivedAt;
        templates[index] = next;
        updated.push(next);
      }
      return { updated, missing };
    });
    if (result.updated.length) emit({ type: "templates" });
    return result;
  };
  const patchTemplate = async (id, { draft, ...changes }) => {
    if (!getTemplate(id)) return null;
    const retainedDraft = draft ? await retainTemplateDraft(draft) : undefined;
    return (
      patchTemplates([id], { ...changes, ...(retainedDraft ? { draft: retainedDraft } : {}) })
        .updated[0] ?? null
    );
  };
  const deleteTemplate = async (id) => Boolean(await patchTemplate(id, { archived: true }));
  const copyTemplateToScope = async (id, destination) => {
    const template = listTemplates().find((item) => item.id === id);
    if (!template) throw Object.assign(new Error("Template not found"), { status: 404 });
    if (destination === scope)
      throw Object.assign(new Error("Choose the other library"), { status: 400 });
    return forScope(destination).saveTemplate({
      title: template.title,
      draft: template.draft,
      favorite: template.favorite,
      description: template.description,
      tags: template.tags,
      rating: template.rating,
    });
  };
  const audioFingerprint = (file) =>
    file && existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
  const listUsage = () => {
    if (scope === "global") return forScope("project").listUsage();
    const takes = voice?.read()?.takes ?? [];
    return metadata()
      .list("usage")
      .filter((record) => {
        const take = takes.find((take) => take.id === record.takeId);
        return (
          take?.file && audioFingerprint(voice.audioFile("takes", take.file)) === record.audioHash
        );
      });
  };
  const putUsage = (record) =>
    metadata().mutate("usage", (records) => {
      const index = records.findIndex((entry) => entry.takeId === record.takeId);
      if (index >= 0) records.splice(index, 1);
      records.push(record);
    });
  const rememberAlternative = (record) => {
    if (scope === "global") return forScope("project").rememberAlternative(record);
    metadata().mutate("alternatives", (records) => {
      const index = records.findIndex(
        (entry) => entry.takeId === record.takeId && entry.file === record.file,
      );
      if (index >= 0) records.splice(index, 1);
      records.push(record);
    });
  };
  const alternateMatches = ({ takeId, tryFile, itemId, owner, audioHash }) =>
    scope === "global"
      ? forScope("project").alternateMatches({ takeId, tryFile, itemId, owner, audioHash })
      : metadata()
          .list("alternatives")
          .some(
            (row) =>
              row.takeId === takeId &&
              row.file === tryFile &&
              row.itemId === itemId &&
              row.scope === owner &&
              row.audioHash === audioHash,
          );
  const recordUsage = async ({ itemId, takeId, tryFile }) => {
    const item = getItem(itemId);
    const take = voice?.read()?.takes?.find((take) => take.id === takeId);
    if (!item || !take?.file)
      throw Object.assign(new Error("Take unavailable; refresh the library"), { status: 404 });
    const audioHash = audioFingerprint(voice.audioFile("takes", take.file));
    if (!audioHash || audioHash !== audioFingerprint(voice.audioFile("try", tryFile)))
      throw Object.assign(new Error("The selected audio changed; choose this take again"), {
        status: 409,
      });
    if (
      !alternateMatches({ takeId, tryFile, itemId, owner: scope, audioHash }) &&
      audioHash !== audioFingerprint(getController().audioFile(item.audioFile))
    )
      throw Object.assign(new Error("This trial does not match the archived recording"), {
        status: 409,
      });
    protectRecording(itemId);
    forScope("project").putUsage({
      text: item.text,
      modelId: item.modelId,
      voiceSettings: item.voiceSettings,
      voiceName: item.voiceName,
      itemId,
      takeId,
      scope,
      voiceId: item.voiceId,
      provider: item.provider,
      connection: item.connection,
      voices:
        item.voicesUsed ??
        (item.dialogue
          ? Object.values(item.dialogue.speakers).map((speaker) => ({
              voiceId: speaker.voice_id,
              voiceName: speaker.voice_name || speaker.voice_id,
              provider: speaker.provider ?? item.provider,
              connection: item.connection,
            }))
          : [
              {
                voiceId: item.voiceId,
                voiceName: item.voiceName,
                provider: item.provider,
                connection: item.connection,
              },
            ]),
      audioHash,
    });
    emit({ type: "usage" });
    return listUsage();
  };
  const filmVoiceSnapshot = () => {
    if (scope === "global") return forScope("project").filmVoiceSnapshot();
    const snapshot = voice?.read();
    if (!snapshot || !existsSync(join(storageDir, "archive.sqlite"))) return snapshot;
    const usage = listUsage();
    const savedAlternatives = metadata().list("alternatives");
    return {
      ...snapshot,
      takes: (snapshot.takes ?? []).map((take) => {
        const activeHash = take.file && audioFingerprint(voice.audioFile("takes", take.file));
        const alternatives = (take.tries ?? []).map((file) => {
          const saved = savedAlternatives.find(
            (record) => record.takeId === take.id && record.file === file,
          );
          const currentItem = saved && forScope(saved.scope).getItem(saved.itemId);
          const original = file === `${take.id}_orig.wav` || file === `${take.id}_orig.mp3`;
          return {
            file,
            title: currentItem?.title || saved?.title || (original ? "Original" : ""),
            active: Boolean(
              activeHash &&
              activeHash ===
                (saved?.audioHash || (original && audioFingerprint(voice.audioFile("try", file)))),
            ),
          };
        });
        const record = usage.find((record) => record.takeId === take.id);
        if (!record) return { ...take, alternatives };
        return {
          ...take,
          alternatives,
          text: record.text ?? take.text,
          voice: record.voiceId,
          model: record.modelId ?? take.model,
          speed: record.voiceSettings?.speed ?? take.speed,
          stability: record.voiceSettings?.stability ?? take.stability,
          playgroundItemId: record.itemId,
          playgroundScope: record.scope,
        };
      }),
    };
  };
  const applyToFilm = async ({ itemId, takeId }) => {
    if (!voice || !project)
      throw Object.assign(new Error("Choose a film before applying a recording"), { status: 404 });
    const packageFile = join(project, "package.json"),
      editFile = join(project, "src/edit.json");
    const conf = existsSync(packageFile)
      ? (JSON.parse(readFileSync(packageFile, "utf8"))["live-studio"] ?? {})
      : {};
    const edit = existsSync(editFile) ? JSON.parse(readFileSync(editFile, "utf8")) : {};
    const priorBase = (edit.voice?.lines ?? []).map(([s, e]) => ({ s, e }));
    const timeline = conf.soundTimeline
      ? openTimelineFile(project, conf.soundTimeline, SoundTimeline)
      : null;
    const before = timeline?.read();
    const invalid = before && timeline.check(before.version, before.data);
    if (invalid)
      throw new Error(
        `Fix the film timeline before switching audio: ${invalid.problems?.join("; ") || "another edit changed it"}`,
      );
    const promoted = await getController().promoteToFilmTake({ itemId, takeId });
    if (promoted.error) throw Object.assign(new Error(promoted.error), { status: promoted.status });
    const swapped = await voice.useTry({ takeId, tryFile: promoted.tryFile });
    if (swapped.error) throw Object.assign(new Error(swapped.error), { status: swapped.status });
    const spans = swapped.swappedSpans?.length
      ? swapped.swappedSpans
      : swapped.swapped
        ? [swapped.swapped]
        : [];
    const current = timeline?.read();
    if (current && resizeNarrationBrickForSwap(current.data, spans, priorBase)) {
      const written = timeline.write(current.version, current.data);
      if (written.conflict || written.problems)
        throw new Error(
          `The audio switched, but the timeline could not be saved: ${written.problems?.join("; ") || "another edit changed it"}. Refresh the film before continuing`,
        );
    }
    const usage = await recordUsage({ itemId, takeId, tryFile: promoted.tryFile });
    onVoiceChanged?.();
    return { ok: true, tryFile: promoted.tryFile, usage, ...swapped };
  };
  const readFilmTakeSource = (takeId, { voiceName, name } = {}) => {
    const take = filmVoiceSnapshot()?.takes.find((take) => take.id === takeId);
    const file = take?.file && voice?.audioFile("takes", take.file);
    if (!file)
      throw Object.assign(new Error("Film recording unavailable; choose a recorded take"), {
        status: 404,
      });
    const used = forScope("project")
      .listUsage()
      .find((record) => record.takeId === takeId);
    const original = used && forScope(used.scope).getItem(used.itemId);
    const now = new Date().toISOString();
    return {
      file,
      original,
      item: {
        id: `take_${takeId}`,
        kind: "tts",
        scope: "project",
        title: name || `Take ${takeId}: ${String(take.text ?? "").slice(0, 70)}`,
        text: take.text ?? "",
        tags: extractAudioTags(take.text ?? ""),
        voiceId: used?.voiceId ?? take.voice ?? "",
        voiceName: voiceName || used?.voiceName || take.voice || "Voice not recorded",
        modelId: used?.modelId ?? take.model ?? "",
        languageCode: "",
        voiceSettings: used?.voiceSettings ?? {
          ...(typeof take.speed === "number" ? { speed: take.speed } : {}),
          ...(typeof take.stability === "number" ? { stability: take.stability } : {}),
        },
        ...(used?.voices ? { voicesUsed: used.voices } : {}),
        exportTranscript: false,
        mimeType: audioMimeForExt(extname(file)),
        audioFile: take.file,
        bytes: statSync(file).size,
        durationSeconds: take.seconds ?? 0,
        wordTimings: voice.readWordTimings?.("takes", take.file) ?? [],
        provider: used?.provider ?? "elevenlabs",
        favorite: forScope("project").listTakeFavorites().includes(`take:${takeId}`),
        isTemplate: false,
        sourceTakeId: takeId,
        originProject: project ? basename(project) : undefined,
        filmTakeSource: { takeId, project: project ?? "", archivedAt: now },
        createdAt: now,
        updatedAt: now,
      },
    };
  };
  const archiveFilmTake = async (takeId, options) => {
    const { item, file, original } = readFilmTakeSource(takeId, options);
    if (original) {
      const sourceScope = original.scope ?? "project";
      return sourceScope === scope
        ? original
        : forScope(sourceScope).copyToScope(original.id, scope);
    }
    return acceptCopy(item, [["audioFile", "audio", readFileSync(file), file]]);
  };
  const filmRegionSource = (takeId) => {
    const { item, file } = readFilmTakeSource(takeId);
    const bytes = readFileSync(file);
    const recipe = [
      takeId,
      item.text,
      item.voiceId,
      item.modelId,
      item.voiceSettings,
      item.wordTimings,
    ];
    const hash = createHash("sha256")
      .update(bytes)
      .update(JSON.stringify(recipe))
      .digest("hex")
      .slice(0, 24);
    return {
      file,
      bytes,
      item: { ...item, id: `pg_film_${hash}`, title: `${item.title} · film source` },
    };
  };
  const listTakeFavorites = () => metadata().list("take-favorites");
  const setTakeFavorite = async (uid, favorite) => {
    metadata().mutate("take-favorites", (uids) => {
      const index = uids.indexOf(uid);
      if (index >= 0) uids.splice(index, 1);
      if (favorite) uids.push(uid);
    });
    emit({ type: "take-favorites" });
    return listTakeFavorites();
  };
  const listVoiceFavorites = () => {
    const saved = shared()
      .list("voices")
      .map((voice) => ({
        ...voice,
        name: voice.name || voice.id,
        category: voice.category || "saved",
      }));
    const entries = new Map(saved.map((voice) => [voiceIdentity(voice), voice]));
    const audioStars = audioFavorites?.shown().effects ?? [];
    const missing = audioStars.flatMap((star) => {
      const match = /^voice:(?:(minimax|capcut):)?(.+)$/.exec(star);
      if (!isSafeRemoteId(match?.[2])) return [];
      const voice = { id: match[2], provider: match[1] ?? "elevenlabs" };
      return entries.has(voiceIdentity(voice)) ? [] : [voice];
    });
    const combined = [
      ...saved,
      ...missing.map((voice) => ({ name: voice.id, category: "saved", ...voice })),
    ];
    const needsCachedMetadata = (voice) =>
      (voice.connection ?? "genvoice") === "genvoice" &&
      voice.provider === "elevenlabs" &&
      (!voice.creatorId || !voice.language || voice.category === "saved");
    if (!combined.some(needsCachedMetadata)) return combined;
    const catalog = new Map((cachedVoices?.() ?? []).map((voice) => [voice.id, voice]));
    return combined.map((voice) => {
      const cached = needsCachedMetadata(voice) ? catalog.get(voice.id) : undefined;
      return cached ? withVoiceMetadata(voice, { ...cached, language: "en" }) : voice;
    });
  };
  const listCreatorProfiles = () =>
    shared()
      .list("voice-creators")
      .map((record) => ({ favorite: true, ...record }));
  const listCreatorFavorites = () => listCreatorProfiles().filter((record) => record.favorite);
  const saveCreatorProfile = ({ id, ...patch }) =>
    shared().mutate("voice-creators", (creators) => {
      const index = creators.findIndex((creator) => creator.id === id);
      const previous = index < 0 ? undefined : creators.splice(index, 1)[0];
      const creator = { id, favorite: Boolean(previous), ...previous, ...patch };
      creators.unshift(creator);
      return creator;
    });
  const setCreatorFavorite = (input) => {
    saveCreatorProfile(input);
    return listCreatorFavorites();
  };
  const retainPreviewFile = (source) => {
    if (!source || statSync(source).size > MAX_AUDIO_BYTES)
      throw Object.assign(new Error("Saved voice preview is unavailable or too large"), {
        status: 400,
      });
    const bytes = readFileSync(source);
    const fingerprint = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const file = `preview_${fingerprint}${extname(source).toLowerCase()}`;
    const target = join(ensureSafeDir(join(storageDir, "audio")), file);
    if (!existsSync(target)) writeAtomic(target, bytes);
    return `/api/voice/playground/audio/${file}?scope=${scope}`;
  };
  const setVoiceFavorite = async (voice, favorite) => {
    const provider = voice.provider ?? "elevenlabs";
    const connection = voice.connection ?? "genvoice";
    const effectId = `voice:${provider === "elevenlabs" ? "" : `${provider}:`}${voice.id}`;
    const mirrorAudioStar =
      audioFavorites &&
      connection === "genvoice" &&
      audioFavorites.read().effects.includes(effectId) !== favorite;
    const previousStar =
      favorite && listVoiceFavorites().find((row) => voiceIdentity(row) === voiceIdentity(voice));
    shared().mutate("voices", (voices) => {
      const index = voices.findIndex(
        (v) =>
          v.id === voice.id &&
          (v.connection ?? "genvoice") === connection &&
          (v.provider ?? "elevenlabs") === provider,
      );
      const previous = index >= 0 ? voices.splice(index, 1)[0] : previousStar;
      if (favorite) {
        const merged = { ...previous, ...voice, provider };
        voices.unshift({
          ...merged,
          name: merged.name || voice.id,
          category: merged.category || "saved",
          previewUrl: sanitizeRemoteMediaUrl(merged.previewUrl, apiBase()),
        });
      }
    });
    if (mirrorAudioStar) {
      audioFavorites.set({ kind: "effects", id: effectId, on: favorite });
      onAudioFavoritesChanged?.();
    }
    emit({ type: "voice-favorites" });
    return listVoiceFavorites();
  };

  return {
    ...createVoiceProfiles({
      scope,
      project,
      metadata,
      shared,
      forScope,
      favoriteVoices: () => getController().listVoiceFavorites(),
      retainPreviewFile,
      apiBase,
      emit,
    }),
    forScope,
    copyToScope,
    archiveFilmTake,
    filmRegionSource,
    applyToFilm,
    acceptCopy,
    filmVoiceSnapshot,
    listUsage,
    recordUsage,
    rememberAlternative,
    alternateMatches,
    putUsage,
    listTemplates,
    getTemplate,
    patchTemplate,
    patchTemplates,
    saveTemplate,
    deleteTemplate,
    copyTemplateToScope,
    listTakeFavorites,
    setTakeFavorite,
    listVoiceFavorites,
    setVoiceFavorite,
    listCreatorFavorites,
    setCreatorFavorite,
    listCreatorProfiles,
    saveCreatorProfile,
    closeOtherScope: () => {
      if (!parentController) sibling?.close();
    },
  };
}
