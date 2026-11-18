import { BookmarkPlus, Check, Headphones, ListPlus, Mars, Star, User, Venus } from "lucide-react";
import { type CSSProperties, useId, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { PlaygroundVoiceOption, PlaygroundVoiceProfile } from "../../src/voice-playground.mjs";
import { listening, subscribeAudition } from "./sound";
import {
  copyPlaygroundProfile,
  patchPlaygroundProfile,
  previewCastingVoice,
  savePlaygroundProfile,
  togglePlaygroundVoiceFavorite,
  toggleSpeechComparisonVoice,
} from "./voice-playground-client";
import { castingAuditionId } from "./voice-playground-view";

export function VoicePlaygroundProfilePanel({
  voice,
  profile: initialProfile,
  preferredScope,
  favorite,
  inComparison,
  onChoose,
  onChange,
}: {
  voice: PlaygroundVoiceOption;
  profile?: PlaygroundVoiceProfile;
  preferredScope: "project" | "global";
  favorite: boolean;
  inComparison: boolean;
  onChoose: (voice: PlaygroundVoiceOption) => void;
  onChange: (profile: PlaygroundVoiceProfile) => void;
}) {
  const id = useId();
  const [profile, setProfile] = useState(initialProfile);
  const [scope, setScope] = useState(preferredScope);
  const [alias, setAlias] = useState(initialProfile?.alias ?? "");
  const [description, setDescription] = useState(initialProfile?.description ?? "");
  const [tags, setTags] = useState(initialProfile?.tags?.join(", ") ?? "");
  const [color, setColor] = useState(initialProfile?.color ?? "");
  const [rating, setRating] = useState(initialProfile?.rating ?? null);
  const [licenseNote, setLicenseNote] = useState(initialProfile?.rights?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const playing =
    useSyncExternalStore(subscribeAudition, listening, listening) === castingAuditionId(voice);
  const name = profile?.alias || voice.name || voice.id;
  const facts = [
    [
      "Source",
      voice.connection === "google"
        ? "Google Gemini"
        : voice.provider === "minimax"
          ? "MiniMax"
          : voice.provider === "capcut"
            ? "CapCut"
            : "ElevenLabs",
    ],
    ["Language", voice.language],
    ["Category", voice.category],
    ["Use case", voice.useCase],
    ["Age", voice.age],
    ["Accent", voice.accent],
    ["Gender", voice.gender],
    ["Emotion", voice.emotion],
  ].filter(([, value]) => value);
  const change = async (
    operation: () => Promise<PlaygroundVoiceProfile>,
    confirmation: string,
    select = true,
  ) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const saved = await operation();
      if (select) {
        setProfile(saved);
        setAlias(saved.alias ?? "");
        setDescription(saved.description ?? "");
        setTags(saved.tags?.join(", ") ?? "");
        setColor(saved.color ?? "");
        setRating(saved.rating ?? null);
        setLicenseNote(saved.rights?.notes ?? "");
      }
      onChange(saved);
      setMessage(confirmation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this voice profile.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      aria-label="Voice details"
      className="bg-card flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-5"
    >
      <div className="flex items-start gap-3">
        <div
          className="text-primary-text flex size-11 shrink-0 items-center justify-center rounded-full bg-(--voice-color)"
          style={{ "--voice-color": profile?.color || "var(--tint)" } as CSSProperties}
        >
          {!profile?.color && <User className="size-5" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-heading-foreground text-lg leading-tight font-semibold break-words">
            <bdi>{name}</bdi>
          </h3>
          <p className="text-muted-foreground text-sm">
            {profile
              ? profile.scope === "global"
                ? "Global profile"
                : "Project profile"
              : "Catalog voice"}
          </p>
          {voice.gender && (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              {voice.gender.toLowerCase() === "female" ? (
                <Venus className="size-3" />
              ) : voice.gender.toLowerCase() === "male" ? (
                <Mars className="size-3" />
              ) : (
                <User className="size-3" />
              )}
              {voice.gender}
            </span>
          )}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="favorite"
          aria-label={favorite ? "Unfavorite voice" : "Favorite voice"}
          aria-pressed={favorite}
          onClick={() => void togglePlaygroundVoiceFavorite(voice, !favorite)}
        >
          <Star className={favorite ? "fill-current" : ""} />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={playing ? "lit" : "secondary"}
          disabled={!voice.previewUrl}
          aria-pressed={playing}
          onClick={() => previewCastingVoice(voice)}
        >
          <Headphones />{" "}
          {playing ? "Pause sample" : voice.previewUrl ? "Play free sample" : "Sample unavailable"}
        </Button>
        {(voice.connection ?? "genvoice") === "genvoice" && (
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={inComparison}
            onClick={() => toggleSpeechComparisonVoice(voice)}
          >
            {inComparison ? <Check /> : <ListPlus />}{" "}
            {inComparison ? "In comparison" : "Add to comparison"}
          </Button>
        )}
        <Button size="sm" onClick={() => onChoose({ ...voice, name })}>
          Use voice
        </Button>
      </div>
      {(profile?.description || voice.description || voice.descriptive) && (
        <p className="text-foreground text-sm leading-relaxed break-words whitespace-pre-wrap">
          {profile?.description || voice.description || voice.descriptive}
        </p>
      )}
      <dl className="border-hairline grid grid-cols-2 gap-x-3 gap-y-3 border-y py-4 text-sm">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="break-words">{value?.replaceAll("_", " ")}</dd>
          </div>
        ))}
        <div>
          <dt className="text-muted-foreground text-xs">Voice rate</dt>
          <dd>
            {typeof voice.rate === "number" && voice.rate > 0
              ? `${voice.rate}× reported`
              : "Unverified"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Character usage · 1 year</dt>
          <dd className="tabular-nums">{voice.usage1y?.toLocaleString() ?? "Unavailable"}</dd>
        </div>
        {typeof voice.clones === "number" && (
          <div>
            <dt className="text-muted-foreground text-xs">Added to voice collections</dt>
            <dd className="tabular-nums">{voice.clones.toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground text-xs">Usage rights</dt>
          <dd>{profile?.rights?.status === "user_confirmed" ? "User confirmed" : "Unverified"}</dd>
        </div>
      </dl>
      <details className="border-hairline border-b pb-3 text-sm">
        <summary className="text-foreground cursor-pointer font-medium">
          Provider details and rights
        </summary>
        <dl className="mt-3 space-y-3">
          <div>
            <dt className="text-muted-foreground text-xs">Provider name</dt>
            <dd>{voice.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Voice ID</dt>
            <dd className="break-all">{voice.id}</dd>
          </div>
          {voice.verifiedLanguages?.length ? (
            <div>
              <dt className="text-muted-foreground text-xs">Verified languages</dt>
              <dd>
                {voice.verifiedLanguages
                  .map((language) => language.name || language.code)
                  .join(", ")}
              </dd>
            </div>
          ) : null}
          {profile?.rights?.evidenceUrl && (
            <dd>
              <a
                className="text-primary-text underline underline-offset-4"
                href={profile.rights.evidenceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Recorded rights evidence
              </a>
            </dd>
          )}
          <div>
            <dt className="text-muted-foreground text-xs">Rights notes</dt>
            <dd>{profile?.rights?.notes || "No rights notes recorded."}</dd>
          </div>
        </dl>
      </details>
      {!profile ? (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            aria-label="Profile scope"
            value={[scope]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "project" || next === "global") setScope(next);
            }}
          >
            <ToggleGroupItem value="project">Project</ToggleGroupItem>
            <ToggleGroupItem value="global">Global</ToggleGroupItem>
          </ToggleGroup>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void change(() => savePlaygroundProfile(voice, scope), "Saved to Shortlist.")
            }
          >
            <BookmarkPlus /> Save to Shortlist
          </Button>
        </div>
      ) : (
        <form
          aria-label="Voice profile settings"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              () =>
                patchPlaygroundProfile(profile, {
                  alias,
                  description,
                  rating,
                  color: color || null,
                  tags: [
                    ...new Set(
                      tags
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    ),
                  ],
                  ...(licenseNote !== (profile.rights?.notes ?? "")
                    ? {
                        rights: {
                          status: "unverified",
                          notes: licenseNote,
                          evidenceUrl: profile.rights?.evidenceUrl,
                        },
                      }
                    : {}),
                }),
              "Profile saved.",
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor={id + "-alias"}>Alias</FieldLabel>
            <Input
              id={id + "-alias"}
              dir="auto"
              maxLength={120}
              value={alias}
              onChange={(event) => setAlias(event.currentTarget.value)}
              placeholder="E.g. Bác Hùng"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id + "-description"}>Description</FieldLabel>
            <Textarea
              id={id + "-description"}
              maxLength={2000}
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id + "-tags"}>Tags</FieldLabel>
            <Input
              id={id + "-tags"}
              value={tags}
              placeholder="Separate with commas"
              onChange={(event) => setTags(event.currentTarget.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Voice rating" className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Button
                  key={star}
                  type="button"
                  size="icon-xs"
                  variant="favorite"
                  aria-label={`${star} stars`}
                  aria-pressed={rating === star}
                  onClick={() => setRating(rating === star ? null : star)}
                >
                  <Star className={star <= (rating ?? 0) ? "fill-current" : ""} />
                </Button>
              ))}
            </div>
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              Color
              <input
                type="color"
                value={color || "#558ad3"}
                className="h-7 w-9 cursor-pointer"
                onChange={(event) => setColor(event.currentTarget.value)}
              />
            </label>
            {color && (
              <Button type="button" size="xs" variant="ghost" onClick={() => setColor("")}>
                Clear color
              </Button>
            )}
          </div>
          <Field>
            <FieldLabel htmlFor={id + "-rights"}>Rights notes</FieldLabel>
            <Textarea
              id={id + "-rights"}
              rows={2}
              maxLength={2000}
              value={licenseNote}
              onChange={(event) => setLicenseNote(event.currentTarget.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Save profile
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void change(
                  () => copyPlaygroundProfile(profile),
                  profile.scope === "global" ? "Copied to Project." : "Copied to Global.",
                  false,
                )
              }
            >
              Copy to {profile.scope === "global" ? "Project" : "Global"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void change(
                  () => patchPlaygroundProfile(profile, { archived: !profile.archivedAt }),
                  profile.archivedAt ? "Profile restored." : "Profile archived.",
                )
              }
            >
              {profile.archivedAt ? "Restore profile" : "Archive profile"}
            </Button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="text-ok-text text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-warn-text text-sm">
          {error}
        </p>
      )}
    </aside>
  );
}
