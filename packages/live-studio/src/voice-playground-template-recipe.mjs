import {
  PlaygroundDialogue,
  PlaygroundTemplateDraft,
  PlaygroundTts,
  PlaygroundVoiceChanger,
} from "./voice-playground-contract.ts";
import { providerForModel } from "./voice-playground-providers.mjs";
import { recordingRecipe } from "./voice-playground-recordings.mjs";
import { DANGEROUS_KEYS } from "./voice-playground-text.mjs";

const ttsTuning = {
  stability: "stability",
  similarityBoost: "similarity_boost",
  style: "style",
  useSpeakerBoost: "use_speaker_boost",
  speed: "speed",
  pitch: "pitch",
  vol: "vol",
};
const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const settingsToDraft = (settings) =>
  Object.fromEntries(
    Object.entries(ttsTuning).map(([field, setting]) => [field, settings?.[setting]]),
  );
const settingsFromDraft = (draft) =>
  Object.fromEntries(Object.entries(ttsTuning).map(([field, setting]) => [setting, draft[field]]));

export function reconcileTemplateDraft(previous, draft) {
  if (previous?.mode !== "tts" || draft.mode !== "tts") return draft;
  const next = structuredClone(draft);
  const identity = (value) =>
    JSON.stringify([
      value.connection ?? "genvoice",
      value.provider ?? providerForModel(value.modelId),
      value.voiceId,
    ]);
  if (identity(next) !== identity(previous)) {
    for (const field of ["voiceName", "voiceGender", "voicePreviewUrl", "creatorId"])
      if (next[field] === previous[field]) delete next[field];
  }
  const recorded = next.recordedSpeech;
  if (recorded && recorded.modelId !== next.modelId) delete next.recordedSpeech;
  if (!next.recordedSpeech || previous.modelId !== next.modelId) return next;
  for (const [field, key] of Object.entries(ttsTuning)) {
    if (recorded.settings[key] !== previous.recordedSpeech?.settings[key])
      next[field] = recorded.settings[key];
    else if (next[field] !== previous[field]) recorded.settings[key] = next[field];
  }
  if (recorded.normalization !== previous.recordedSpeech?.normalization)
    next.applyTextNormalization = recorded.normalization;
  else if (next.applyTextNormalization !== previous.applyTextNormalization)
    recorded.normalization = next.applyTextNormalization;
  return PlaygroundTemplateDraft.parse(next);
}

export function recordingTemplateDraft(item, getItem) {
  const { command, input } = recordingRecipe(item, getItem);
  if (
    (item.connection ?? "genvoice") !== "genvoice" ||
    !["generate tts", "generate dialogue", "generate voice-changer"].includes(command)
  )
    throw conflict(
      "Choose an original GenVoice Speech, Dialogue or Voice Changer recording with a reusable recipe.",
    );
  const common = {
    title: item.title,
    notes: input.notes,
    connection: "genvoice",
    seedText: input.seed === undefined ? undefined : String(input.seed),
  };
  if (command === "generate dialogue")
    return PlaygroundTemplateDraft.parse({
      ...common,
      mode: "dialogue",
      text: input.text,
      voiceId: item.voiceId,
      voiceName: item.voiceName,
      modelId: item.modelId,
      languageCode: item.languageCode,
      exportTranscript: input.exportTranscript,
      pauseBetweenTurns: input.pause_between_turns,
      speakers: Object.entries(input.speakers).map(([name, speaker]) => ({
        id: name,
        name,
        provider: speaker.provider,
        voiceId: speaker.voice_id,
        voiceName: speaker.voice_name,
        modelId: speaker.model_id ?? "",
        languageCode: speaker.language_code,
        ...settingsToDraft(speaker.voice_settings),
      })),
    });
  if (command === "generate voice-changer")
    return PlaygroundTemplateDraft.parse({
      ...common,
      mode: "voice_changer",
      voiceId: input.voiceId,
      voiceName: input.voiceName,
      modelId: input.modelId,
      removeBackgroundNoise: input.removeBackgroundNoise,
      vcSourceKind: input.sourceFile ? "upload" : input.sourceItemId ? "playground" : "film_take",
      vcSourceFile: input.sourceFile,
      vcSourceItemId: input.sourceItemId,
      vcSourceTakeValue: input.sourceTakeFile && `${input.sourceTakeKind}:${input.sourceTakeFile}`,
      ...settingsToDraft(input.voiceSettings),
    });
  const settings = input.voiceSettings ?? {};
  return PlaygroundTemplateDraft.parse({
    ...common,
    mode: "tts",
    provider: input.provider,
    voiceId: input.voiceId,
    voiceName: input.voiceName,
    voiceGender: input.voiceGender,
    voicePreviewUrl: input.voicePreviewUrl,
    creatorId: input.creatorId,
    modelId: input.modelId,
    languageCode: input.languageCode,
    text: input.text,
    previousText: input.previousText,
    nextText: input.nextText,
    outputFormat: input.outputFormat,
    applyTextNormalization: input.applyTextNormalization,
    exportTranscript: input.exportTranscript,
    sourceTakeId: input.sourceTakeId,
    variations: 1,
    ...settingsToDraft(settings),
    ...(input.preserveSettings
      ? {
          recordedSpeech: {
            modelId: input.modelId,
            settings,
            normalization: input.applyTextNormalization,
          },
        }
      : {}),
  });
}

const recipeInput = (template, command, schema, input) => {
  const validated = schema.safeParse(input);
  if (!validated.success)
    throw conflict(
      `Complete this template before generating: ${validated.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return { command, scope: template.scope, input: validated.data };
};

export function voiceTemplateRecipe(template) {
  const d = template.draft;
  if (d.connection && d.connection !== "genvoice") throw conflict("Choose a GenVoice template.");
  const common = { name: d.title || template.title, notes: d.notes };
  const seed = d.seedText?.trim() ? Number(d.seedText) : undefined;
  if (d.mode === "dialogue") {
    const speakers = d.speakers ?? [];
    const names = speakers.map(({ name }) => name.trim());
    if (
      names.length < 2 ||
      new Set(names).size !== names.length ||
      names.some((name) => !name || DANGEROUS_KEYS.has(name))
    )
      throw conflict("Give at least two Dialogue roles distinct names.");
    return recipeInput(template, "generate dialogue", PlaygroundDialogue, {
      ...common,
      connection: "genvoice",
      text: d.text,
      exportTranscript: d.exportTranscript,
      fromTemplateId: template.id,
      pause_between_turns: d.pauseBetweenTurns,
      speakers: Object.fromEntries(
        speakers.map((speaker, index) => [
          names[index],
          {
            voice_id: speaker.voiceId,
            voice_name: speaker.voiceName,
            provider: speaker.provider,
            model_id: speaker.modelId || undefined,
            language_code: speaker.languageCode,
            voice_settings: settingsFromDraft(speaker),
          },
        ]),
      ),
    });
  }
  if (d.mode === "voice_changer") {
    if (!d.vcSourceFile)
      throw conflict("Save an audio source in this Voice Changer template before generating.");
    return recipeInput(template, "generate voice-changer", PlaygroundVoiceChanger.strict(), {
      ...common,
      sourceFile: d.vcSourceFile,
      voiceId: d.voiceId,
      voiceName: d.voiceName,
      modelId: d.modelId,
      voiceSettings: settingsFromDraft(d),
      removeBackgroundNoise: d.removeBackgroundNoise,
      seed,
    });
  }
  if (d.mode !== "tts") throw conflict("Choose a Speech, Dialogue or Voice Changer template.");
  const recorded = d.recordedSpeech?.modelId === d.modelId ? d.recordedSpeech : undefined;
  return recipeInput(template, "generate tts", PlaygroundTts.strict(), {
    ...common,
    connection: "genvoice",
    provider: d.provider,
    voiceId: d.voiceId,
    voiceName: d.voiceName,
    voiceGender: d.voiceGender,
    voicePreviewUrl: /^https?:\/\//i.test(d.voicePreviewUrl ?? "") ? d.voicePreviewUrl : undefined,
    creatorId: d.creatorId,
    modelId: d.modelId,
    languageCode: d.languageCode,
    text: d.text,
    previousText: d.previousText,
    nextText: d.nextText,
    seed,
    outputFormat: d.outputFormat,
    applyTextNormalization: recorded?.normalization ?? (d.applyTextNormalization || undefined),
    exportTranscript: d.exportTranscript,
    sourceTakeId: d.sourceTakeId,
    fromTemplateId: template.id,
    variations: d.variations,
    voiceSettings: recorded?.settings ?? settingsFromDraft(d),
    ...(recorded ? { preserveSettings: true } : {}),
  });
}
