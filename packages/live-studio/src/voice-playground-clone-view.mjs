export function visibleCloudClones(voices, bindings, { scope, projectKey }) {
  return voices.filter((voice) => {
    const linked = bindings.filter((binding) => binding.remoteId === voice.id);
    return (
      !linked.length ||
      linked.some(
        (binding) =>
          binding.scope === "global" || (scope === "project" && binding.projectKey === projectKey),
      )
    );
  });
}

export function cloneVoiceOption(record) {
  if (record.phase !== "ready" || !record.remoteId) return null;
  return {
    id: record.remoteId,
    dubbingVoiceId: record.remoteId,
    name: record.displayName ?? record.settings.name,
    provider: "minimax",
    category: "Cloned voice",
    language: record.settings.language,
    gender: record.settings.gender,
    source: "custom",
    ownedClone: { id: record.id, scope: record.scope },
    ...(record.sampleAudioFile && !record.previewStale
      ? {
          previewUrl: `/api/voice/playground/audio/${encodeURIComponent(record.sampleAudioFile)}?scope=${record.scope}`,
        }
      : {}),
  };
}
