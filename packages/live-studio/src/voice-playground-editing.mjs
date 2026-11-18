import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { oggPeaksAsync } from "./sound.mjs";
import {
  probeAudioDuration,
  renderRegion,
  retimeSrt,
  retimeWords,
} from "./voice-playground-region.mjs";
import { extractAudioTags, recordingRootId, recordingWords } from "./voice-playground-text.mjs";

const cast = (item) =>
  item.voicesUsed?.length
    ? item.voicesUsed
    : item.dialogue
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
        ];

export function createPlaygroundEditing({ getController, synthesizePhrase, filmRegionSource }) {
  const metrics = new Map();
  const requireItem = (id) => {
    const pg = getController(),
      item = pg.getItem(id);
    if (!item?.audioFile || !pg.audioFile(item.audioFile))
      throw Object.assign(new Error("Recording audio is unavailable"), { status: 404 });
    return item;
  };
  const audioMetrics = (source, key = source) => {
    if (!metrics.has(key)) {
      if (metrics.size >= 16) metrics.delete(metrics.keys().next().value);
      const pending = (async () => {
        const durationSeconds = await probeAudioDuration(source);
        const waveform = await oggPeaksAsync(source, Math.max(0.01, durationSeconds / 800));
        return { durationSeconds, waveform };
      })();
      metrics.set(key, pending);
      pending.catch(() => metrics.delete(key));
    }
    return metrics.get(key);
  };
  const inspectSource = async (item, file, key) => ({
    id: item.id,
    title: item.title,
    ...(await audioMetrics(file, key)),
    words: recordingWords(item),
  });
  const inspectRegion = async (id) => {
    const item = requireItem(id);
    return inspectSource(item, getController().audioFile(item.audioFile));
  };
  const assertSelectionBounds = async (file, input, key) => {
    const { durationSeconds } = await audioMetrics(file, key);
    if (!(input.from >= 0 && input.to > input.from && input.to <= durationSeconds + 0.001))
      throw Object.assign(new Error("Choose a region inside the recording"), { status: 400 });
    if (
      input.mode === "regenerate" &&
      input.fitToSelection !== false &&
      input.pause >= input.to - input.from
    )
      throw Object.assign(new Error("Choose a longer region than the added pause"), {
        status: 400,
      });
  };
  const assertSelection = async (id, input) => {
    const item = requireItem(id);
    await assertSelectionBounds(getController().audioFile(item.audioFile), input);
    return item;
  };
  const previewRegion = async (id, input) => {
    const item = await assertSelection(id, input);
    return renderRegion(getController().audioFile(item.audioFile), input);
  };
  const listVersions = (id) => {
    const pg = getController(),
      item = pg.getItem(id);
    if (!item)
      throw Object.assign(new Error("Recording not found in this library"), { status: 404 });
    const rootId = recordingRootId(item);
    return pg
      .listItems({ includeArchived: true })
      .filter((candidate) => recordingRootId(candidate) === rootId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  };
  const inspectFilmRegion = async (takeId) => {
    const { item, file } = filmRegionSource(takeId);
    const info = await inspectSource(item, file, item.id);
    const items = getController().getItem(item.id) ? listVersions(item.id) : [];
    return { info, items };
  };
  const checkedFilmRegion = async (takeId, input, sourceId) => {
    const source = filmRegionSource(takeId);
    if (source.item.id !== sourceId)
      throw Object.assign(
        new Error("The film recording changed. Reopen the section edit to load the current audio."),
        { status: 409 },
      );
    await assertSelectionBounds(source.file, input, source.item.id);
    return source;
  };
  const previewFilmRegion = async (takeId, input, sourceId) => {
    const { file } = await checkedFilmRegion(takeId, input, sourceId);
    return renderRegion(file, input);
  };
  const saveFilmRegionSource = async (takeId, input, sourceId) => {
    const { item, file, bytes } = await checkedFilmRegion(takeId, input, sourceId);
    const pg = getController();
    return (
      pg.getItem(item.id) ??
      pg.acceptCopy(item, [["audioFile", "audio", bytes, file]], { id: item.id })
    );
  };
  const createVersion = async (id, input, { replacementItemId, parentJobId } = {}) => {
    const pg = getController(),
      parent = requireItem(id);
    const edit = {
      mode: input.mode,
      from: input.from,
      to: input.to,
      rate: input.rate ?? 1,
      pitch: input.pitch ?? 0,
      gainDb: input.gainDb ?? 0,
      pause: input.pause ?? 0,
      blendMs: input.blendMs ?? 6,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.mode === "regenerate"
        ? {
            replacementText: input.replacementText,
            fullText: input.fullText,
            fitToSelection: input.fitToSelection !== false,
          }
        : {}),
    };
    const folder = await mkdtemp(join(tmpdir(), "voice-version-"));
    try {
      const source = join(folder, `original${extname(parent.audioFile)}`);
      await copyFile(pg.audioFile(parent.audioFile), source);
      const fragment =
        input.mode === "regenerate"
          ? replacementItemId
            ? requireItem(replacementItemId)
            : await synthesizePhrase({
                ...input,
                parentJobId,
                text: input.replacementText,
                exportTranscript: false,
                name: `${parent.title} · replacement phrase`,
              })
          : undefined;
      const { name: requestedName = "", ...audioEdit } = edit;
      const versionId = `pg_edit_${createHash("sha256")
        .update(JSON.stringify([parent.id, fragment?.id ?? null, audioEdit, requestedName]))
        .digest("hex")
        .slice(0, 24)}`;
      const existing = pg.getItem(versionId);
      if (existing) return existing;
      const rendered = await renderRegion(
        source,
        edit,
        fragment ? { replacement: pg.audioFile(fragment.audioFile) } : undefined,
      );
      const srt =
        parent.srtText ||
        (parent.srtFile && pg.srtFile(parent.srtFile)
          ? readFileSync(pg.srtFile(parent.srtFile), "utf8")
          : "");
      const srtText = !fragment && srt ? retimeSrt(srt, edit) : undefined;
      const fullReplacement =
        fragment && input.from === 0 && input.to >= (await probeAudioDuration(source)) - 0.001;
      const voices = fragment
        ? [
            ...new Map(
              (fullReplacement ? cast(fragment) : [...cast(parent), ...cast(fragment)]).map(
                (voice) => [
                  `${voice.connection ?? "genvoice"}:${voice.provider}:${voice.voiceId}`,
                  voice,
                ],
              ),
            ).values(),
          ]
        : parent.voicesUsed;
      const now = new Date().toISOString();
      return pg.acceptCopy(
        {
          ...structuredClone(parent),
          title: input.name?.trim() || `${parent.title} · edited`,
          createdAt: now,
          updatedAt: now,
          mimeType: "audio/wav",
          bytes: rendered.bytes.length,
          durationSeconds: rendered.durationSeconds,
          favorite: false,
          isTemplate: false,
          templateName: undefined,
          dubbing: parent.dubbing ? { ...parent.dubbing, resultFile: undefined } : undefined,
          ...(fragment
            ? {
                text: input.fullText,
                tags: extractAudioTags(input.fullText),
                exportTranscript: false,
                voicesUsed: voices,
                rights: { status: "unverified" },
              }
            : {}),
          ...(fullReplacement
            ? {
                kind: "tts",
                voiceId: fragment.voiceId,
                voiceName: fragment.voiceName,
                modelId: fragment.modelId,
                connection: fragment.connection,
                speechStyle: fragment.speechStyle,
                voiceSettings: fragment.voiceSettings,
                provider: fragment.provider,
                languageCode: fragment.languageCode,
                previousText: fragment.previousText,
                nextText: fragment.nextText,
                seed: fragment.seed,
                outputFormat: fragment.outputFormat,
                applyTextNormalization: fragment.applyTextNormalization,
                dialogue: undefined,
                voiceChanger: undefined,
                dubbing: undefined,
              }
            : {}),
          srtFile: undefined,
          srtText,
          sttResult: undefined,
          creditsDeducted: fragment && !replacementItemId ? fragment.creditsDeducted : 0,
          actualCost: fragment && !replacementItemId ? fragment.actualCost : undefined,
          providerUsage: fragment && !replacementItemId ? fragment.providerUsage : undefined,
          providerRequestId: undefined,
          charactersUsed: fragment?.charactersUsed,
          remoteTaskId: undefined,
          wordTimings: fragment ? undefined : retimeWords(recordingWords(parent), edit),
          version: {
            rootId: recordingRootId(parent),
            parentId: parent.id,
            edit,
            regionSeconds: rendered.regionSeconds,
            fitRate: rendered.fitRate,
            baseCredits: parent.creditsDeducted,
            sourceRemoteTaskId: parent.remoteTaskId,
            ...(fragment
              ? { replacement: { ...fragment, audioFile: undefined, srtFile: undefined } }
              : {}),
          },
        },
        [
          ["audioFile", "audio", rendered.bytes, "version.wav"],
          ...(srtText ? [["srtFile", "srt", Buffer.from(srtText), "version.srt"]] : []),
        ],
        { id: versionId },
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
  return {
    createVersion,
    listVersions,
    inspectRegion,
    assertSelection,
    previewRegion,
    inspectFilmRegion,
    previewFilmRegion,
    saveFilmRegionSource,
  };
}
