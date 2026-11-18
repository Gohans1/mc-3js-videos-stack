import { foldVoiceText, rankVoiceLibrary } from "./voice-playground-recordings.mjs";

export const voiceIdentity = (voice) =>
  JSON.stringify([voice.connection ?? "genvoice", voice.provider ?? "elevenlabs", voice.id]);

export function withVoiceMetadata(voice, fallback) {
  if (!fallback) return voice;
  const known = Object.fromEntries(
    Object.entries(voice).filter(([, value]) => value != null && value !== ""),
  );
  return {
    ...fallback,
    ...known,
    name: (known.name === voice.id ? fallback.name || known.name : known.name) ?? fallback.name,
    category:
      (known.category === "saved" ? fallback.category || known.category : known.category) ??
      fallback.category,
  };
}

export function matchesCastingVoice(voice, query, creatorIds) {
  const same = (a, b) => foldVoiceText(a) === foldVoiceText(b);
  return (
    (!query.connection || (voice.connection ?? "genvoice") === query.connection) &&
    (!query.provider || (voice.provider ?? "elevenlabs") === query.provider) &&
    (!query.creatorId || voice.creatorId === query.creatorId) &&
    (!query.favoriteCreatorsOnly || creatorIds.has(voice.creatorId)) &&
    (!query.language ||
      same(voice.language, query.language) ||
      voice.verifiedLanguages?.some((entry) => same(entry.code, query.language))) &&
    ["category", "gender", "age", "accent", "useCase", "descriptive"].every(
      (key) => !query[key] || same(voice[key], query[key]),
    )
  );
}

export function findFavoriteVoices(voices, query, creators, profiles) {
  const {
    page = 0,
    pageSize = query.page === undefined ? Math.max(1, voices.length) : 30,
    q,
    minRating,
    maxRating,
  } = query;
  const creatorIds = new Set(
    creators.filter((creator) => creator.favorite).map((creator) => creator.id),
  );
  const aliases = new Map(creators.map(({ id, name }) => [id, name]));
  const profilesByVoice = new Map();
  for (const profile of profiles) {
    if (profile.archivedAt) continue;
    const identity = voiceIdentity(profile.voice);
    const previous = profilesByVoice.get(identity);
    profilesByVoice.set(identity, {
      voice: previous ? withVoiceMetadata(previous.voice, profile.voice) : profile.voice,
      rating: previous?.rating ?? profile.rating,
    });
  }
  let matches = voices.flatMap((favorite) => {
    const profile = profilesByVoice.get(voiceIdentity(favorite));
    const voice = withVoiceMetadata(favorite, profile?.voice);
    if (!matchesCastingVoice(voice, query, creatorIds)) return [];
    const rating = profile?.rating;
    if ((rating ?? 0) < (minRating ?? 0) || (rating ?? 0) > (maxRating ?? 5)) return [];
    const creatorName = aliases.get(voice.creatorId) ?? voice.creatorName;
    return [
      { ...voice, ...(creatorName ? { creatorName } : {}), ...(rating != null ? { rating } : {}) },
    ];
  });
  if (q)
    matches = rankVoiceLibrary(matches, q, (voice) => [
      voice.name,
      [voice.id, voice.creatorId, voice.creatorName].filter(Boolean).join(" "),
      voice.description,
      voice.descriptive,
    ]);
  const offset = page * pageSize;
  return {
    voices: matches.slice(offset, offset + pageSize),
    total: matches.length,
    page,
    pageSize,
    hasMore: offset + pageSize < matches.length,
  };
}
