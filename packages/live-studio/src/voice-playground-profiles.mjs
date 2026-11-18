import { createHash } from "node:crypto";
import { basename } from "node:path";

import { matchesCastingVoice, voiceIdentity } from "./voice-playground-casting.mjs";
import { sanitizeRemoteMediaUrl } from "./voice-playground-genvoice.mjs";
import { foldVoiceText, rankVoiceLibrary } from "./voice-playground-recordings.mjs";
import { SAFE_MEDIA_FILE } from "./voice-playground-text.mjs";

const profileId = (voice) =>
  `vpv_${createHash("sha256").update(voiceIdentity(voice)).digest("hex").slice(0, 24)}`;
const title = (profile) => profile.alias || profile.voice.name;
const profileText = ({ voice, alias, description, tags }) => [
  alias || voice.name,
  [voice.name, voice.id].join(" "),
  [
    voice.description,
    voice.accent,
    voice.category,
    voice.useCase,
    voice.language,
    ...(tags ?? []),
  ].join(" "),
  description,
];
const missing = () =>
  Object.assign(new Error("Voice profile not found in this library"), { status: 404 });

export function findVoiceProfiles(profiles, query, creators = []) {
  const {
    q,
    favorite,
    archived = false,
    minRating,
    maxRating,
    tag,
    page = 0,
    pageSize = 30,
    sort = q ? "relevance" : "newest",
  } = query;
  const creatorIds = new Set(creators.map((creator) => creator.id));
  let matches = profiles.filter((profile) => {
    const { voice, rating } = profile;
    return (
      matchesCastingVoice(voice, query, creatorIds) &&
      (favorite === undefined || profile.favorite === favorite) &&
      Boolean(profile.archivedAt) === archived &&
      (rating ?? 0) >= (minRating ?? 0) &&
      (rating ?? 0) <= (maxRating ?? 5) &&
      (!tag || profile.tags?.some((entry) => foldVoiceText(entry) === foldVoiceText(tag)))
    );
  });
  matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (q) matches = rankVoiceLibrary(matches, q, profileText);
  if (sort === "newest") matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === "name") matches.sort((a, b) => title(a).localeCompare(title(b), "vi"));
  if (sort === "rating") matches.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  if (sort === "popular") matches.sort((a, b) => (b.voice.usage1y ?? -1) - (a.voice.usage1y ?? -1));
  if (sort === "rare")
    matches.sort((a, b) => (a.voice.usage1y ?? Infinity) - (b.voice.usage1y ?? Infinity));
  const offset = page * pageSize;
  return {
    profiles: matches.slice(offset, offset + pageSize),
    total: matches.length,
    page,
    pageSize,
    hasMore: offset + pageSize < matches.length,
  };
}

export function createVoiceProfiles({
  scope,
  project,
  metadata,
  shared,
  forScope,
  favoriteVoices,
  retainPreviewFile,
  apiBase,
  emit,
}) {
  const collection = "voice-profiles";
  const decorate = (profile, favorites) => ({
    ...profile,
    scope,
    favorite: favorites.has(voiceIdentity(profile.voice)),
  });
  const favoriteIdentities = () => new Set(favoriteVoices().map(voiceIdentity));
  const resolvePreview = (value) => {
    if (value === undefined || value === "") return value;
    const archived = /^\/api\/voice\/playground\/audio\/([^?]+)\?scope=(project|global)$/.exec(
      value,
    );
    if (archived && SAFE_MEDIA_FILE.test(archived[1])) {
      const [, file, owner] = archived;
      if (scope === "global" && owner === "project")
        throw Object.assign(
          new Error("Save the preview audio to Global or choose a provider preview URL"),
          { status: 400 },
        );
      const assertAvailable = () => {
        if (!forScope(owner).audioFile(file))
          throw Object.assign(new Error("Saved preview audio is unavailable"), { status: 404 });
      };
      if (scope === "project" && owner === "global") {
        shared().mutate("items", (items) => {
          assertAvailable();
          const referenced = items.find(
            (item) => item.audioFile?.toLowerCase() === file.toLowerCase(),
          );
          if (referenced) referenced.retentionPinned = true;
        });
      } else assertAvailable();
      return value;
    }
    const remote = sanitizeRemoteMediaUrl(value, apiBase());
    if (!remote) throw Object.assign(new Error("Invalid provider preview URL"), { status: 400 });
    return remote;
  };
  const listVoiceProfiles = ({ includeGlobal = false } = {}) => {
    const favorites = favoriteIdentities();
    const profiles = metadata()
      .list(collection)
      .map((profile) => decorate(profile, favorites));
    return includeGlobal && scope === "project"
      ? [...profiles, ...forScope("global").listVoiceProfiles()]
      : profiles;
  };
  const getVoiceProfile = (id) => {
    const profile = metadata()
      .list(collection)
      .find((row) => row.id === id);
    return profile ? decorate(profile, favoriteIdentities()) : null;
  };
  const change = (profile, { archived, ...patch }, now) => ({
    ...profile,
    ...patch,
    updatedAt: now,
    ...(patch.tags
      ? { tags: [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))] }
      : {}),
    ...(patch.rights ? { rights: { ...patch.rights, checkedAt: now } } : {}),
    ...(archived === undefined
      ? {}
      : { archivedAt: archived ? (profile.archivedAt ?? now) : undefined }),
  });
  const saveVoiceProfile = (
    { voice, ...patch },
    { copy = false, originProject, previewSource } = {},
  ) => {
    const id = profileId(voice);
    const now = new Date().toISOString();
    const profile = metadata().mutate(collection, (rows) => {
      const index = rows.findIndex((row) => row.id === id);
      if (copy && index >= 0)
        throw Object.assign(new Error("The destination already has a profile for this voice"), {
          status: 409,
        });
      const previewUrl = previewSource
        ? retainPreviewFile(previewSource)
        : resolvePreview(voice.previewUrl);
      const current =
        index >= 0
          ? rows[index]
          : {
              id,
              createdAt: now,
              originProject: originProject ?? (project ? basename(project) : undefined),
            };
      const updated = change(
        {
          ...current,
          voice: {
            ...current.voice,
            ...voice,
            name: voice.name || current.voice?.name || voice.id,
            previewUrl: previewUrl ?? current.voice?.previewUrl,
          },
        },
        patch,
        now,
      );
      if (index >= 0) rows[index] = updated;
      else rows.unshift(updated);
      return updated;
    });
    emit({ type: "voice-profiles" });
    return decorate(profile, favoriteIdentities());
  };
  const patchVoiceProfile = (id, patch) => {
    const profile = metadata().mutate(collection, (rows) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw missing();
      return (rows[index] = change(rows[index], patch, new Date().toISOString()));
    });
    emit({ type: "voice-profiles" });
    return decorate(profile, favoriteIdentities());
  };
  const copyVoiceProfile = (id, destination) => {
    if (destination === scope)
      throw Object.assign(new Error("Choose the other library"), { status: 400 });
    const profile = getVoiceProfile(id);
    if (!profile) throw missing();
    const { voice, alias, description, color, rating, tags, rights, originProject } = profile;
    const localSample =
      destination === "global" &&
      /^\/api\/voice\/playground\/audio\/([^?]+)\?scope=project$/.exec(voice.previewUrl ?? "");
    const previewSource = localSample ? forScope("project").audioFile(localSample[1]) : undefined;
    if (localSample && !previewSource)
      throw Object.assign(new Error("Saved preview audio is unavailable"), { status: 404 });
    return forScope(destination).saveVoiceProfile(
      { voice, alias, description, color, rating, tags, rights },
      { copy: true, originProject, previewSource },
    );
  };
  return {
    listVoiceProfiles,
    getVoiceProfile,
    saveVoiceProfile,
    patchVoiceProfile,
    copyVoiceProfile,
  };
}
