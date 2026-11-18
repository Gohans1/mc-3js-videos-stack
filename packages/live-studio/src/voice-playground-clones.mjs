import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createCloneLibrary } from "./voice-playground-clone-library.mjs";
import { probeVoiceSample } from "./voice-playground-clone-probe.mjs";
import { cloneVoiceOption, visibleCloudClones } from "./voice-playground-clone-view.mjs";
import { extFromDownload, MAX_AUDIO_BYTES } from "./voice-playground-genvoice.mjs";
import { resolveProviderLanguage } from "./voice-playground-providers.mjs";

export function createPlaygroundClones({
  scope,
  projectKey,
  storageDir,
  metadata,
  shared,
  request,
  download,
  apiBase,
  getCatalog,
  getController,
  emit,
  baseFavorites,
  baseSetFavorite,
}) {
  let library;
  const getLibrary = () =>
    (library ??= createCloneLibrary({
      dir: storageDir,
      scope,
      projectKey,
      store: metadata(),
      registry: shared(),
      request,
      probe: probeVoiceSample,
      emit,
      archiveSample: async (url, stem, { signal } = {}) => {
        const media = await download(
          url,
          MAX_AUDIO_BYTES,
          "Clone preview",
          apiBase(),
          undefined,
          signal,
        );
        const audioFile = `${stem}_${randomUUID()}${extFromDownload(media.url, media.contentType, media.bytes)}`;
        mkdirSync(join(storageDir, "audio"), { recursive: true });
        await Bun.write(join(storageDir, "audio", audioFile), media.bytes);
        return { audioFile };
      },
    }));
  const listClones = ({ includeGlobal = false } = {}) => [
    ...getLibrary().list(),
    ...(includeGlobal && scope === "project"
      ? getController().forScope("global").listClones()
      : []),
  ];
  const listVoiceFavorites = () => {
    const owned = listClones({ includeGlobal: true }),
      ids = new Set(owned.map((clone) => clone.remoteId));
    const generic = baseFavorites().filter(
      (voice) =>
        voice.provider !== "minimax" ||
        (!ids.has(voice.id) &&
          visibleCloudClones([voice], shared().list("clone-bindings"), { scope, projectKey })
            .length),
    );
    return [
      ...new Map(
        [
          ...generic,
          ...owned
            .filter((clone) => clone.favorite)
            .map(cloneVoiceOption)
            .filter(Boolean),
        ].map((voice) => [
          `${voice.connection ?? "genvoice"}:${voice.provider ?? "elevenlabs"}:${voice.id}`,
          voice,
        ]),
      ).values(),
    ];
  };
  const setVoiceFavorite = async (voice, favorite) => {
    const owned =
      voice.provider === "minimax"
        ? listClones({ includeGlobal: true }).filter((clone) => clone.remoteId === voice.id)
        : [];
    if (owned.length) {
      for (const clone of owned)
        getController().forScope(clone.scope).patchClone(clone.id, { favorite });
      return listVoiceFavorites();
    }
    if (
      voice.provider === "minimax" &&
      !visibleCloudClones([voice], shared().list("clone-bindings"), { scope, projectKey }).length
    )
      throw Object.assign(
        new Error(
          "This clone belongs to another project. Add it to Global from that project first.",
        ),
        { status: 400 },
      );
    await baseSetFavorite(voice, favorite);
    return listVoiceFavorites();
  };
  const createClone = async (file, input) => {
    const catalog = await getCatalog();
    const language = resolveProviderLanguage(
      "minimax",
      input.language ?? "English",
      catalog,
      catalog.models.find((model) => model.model_id === "speech-2.8-hd"),
    );
    const record = await getLibrary().prepare(file, { ...input, language });
    try {
      return await getLibrary().submit(record.id);
    } catch (error) {
      const saved = getLibrary().get(record.id);
      if (saved && ["failed", "uncertain"].includes(saved.phase)) return saved;
      throw error;
    }
  };
  const copyCloneToScope = async (id, nextScope) => {
    if (nextScope === scope)
      throw Object.assign(new Error("Choose the other library"), { status: 400 });
    return getLibrary().copyTo(id, {
      acceptCopy: (record, files) =>
        getController().forScope(nextScope).acceptCloneCopy(record, files),
    });
  };
  return {
    assertCloneAvailable: (provider, voiceId) => {
      if (provider !== "minimax") return;
      if (
        provider === "minimax" &&
        shared()
          .list("clone-deletions")
          .some((record) => record.remoteId === voiceId)
      )
        throw Object.assign(
          new Error(
            "This cloud voice was deleted. Create a new clone from the saved sample before generating.",
          ),
          { status: 400 },
        );
      const owned = listClones({ includeGlobal: true }).filter(
        (clone) => clone.remoteId === voiceId,
      );
      if (owned.length && !owned.some((clone) => clone.phase === "ready"))
        throw Object.assign(
          new Error(
            "This cloned voice is not ready. Refresh My voices or clones refresh before generating.",
          ),
          { status: 400 },
        );
    },
    listClones,
    createClone,
    copyCloneToScope,
    listVoiceFavorites,
    setVoiceFavorite,
    observeCloneList: (voices) => getLibrary().observeAll(voices),
    refreshClones: async ({ includeGlobal = false } = {}) => {
      const data = await request("/minimax/voices");
      if (!Array.isArray(data.voices)) throw new Error("GenVoice returned no clone list");
      await Promise.all([
        getLibrary().observeAll(data.voices),
        ...(includeGlobal && scope === "project"
          ? [getController().forScope("global").observeCloneList(data.voices)]
          : []),
      ]);
      return listClones({ includeGlobal });
    },
    submitClone: (id) => getLibrary().submit(id),
    getClone: (id) => getLibrary().get(id),
    refreshClone: (id, options) => getLibrary().refresh(id, options),
    listCloudClones: () => getLibrary().cloud(),
    adoptClone: (input) => getLibrary().adopt(input),
    linkClone: (id, input) => getLibrary().link(id, input),
    patchClone: (id, input) => getLibrary().patch(id, input),
    retryClone: (id) => getLibrary().retry(id),
    deleteCloudClone: (id) => getLibrary().removeCloud(id),
    acceptCloneCopy: (record, files) => getLibrary().acceptCopy(record, files),
    cloneSource: (id) => getLibrary().sourcePath(id),
  };
}
