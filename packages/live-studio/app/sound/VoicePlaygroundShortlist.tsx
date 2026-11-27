import { Headphones, Star } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type { PlaygroundVoiceProfile } from "../../src/voice-playground.mjs";
import { listPlaygroundProfiles, previewCastingVoice } from "./voice-playground-client";

export function VoicePlaygroundShortlist({
  selected,
  revision,
  onSelect,
}: {
  selected: PlaygroundVoiceProfile | null;
  revision: number;
  onSelect: (profile: PlaygroundVoiceProfile) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "project" | "global">("all");
  const [archived, setArchived] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [rating, setRating] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("relevance");
  const [page, setPage] = useState(0);
  type ShortlistQueryState =
    | { status: "loading"; results: { profiles: PlaygroundVoiceProfile[]; total: number; hasMore: boolean } }
    | { status: "ready"; results: { profiles: PlaygroundVoiceProfile[]; total: number; hasMore: boolean } }
    | { status: "error"; message: string; results: { profiles: PlaygroundVoiceProfile[]; total: number; hasMore: boolean } };

  const [queryState, setQueryState] = useState<ShortlistQueryState>({
    status: "loading",
    results: { profiles: [], total: 0, hasMore: false },
  });
  const busy = queryState.status === "loading";
  const error = queryState.status === "error" ? queryState.message : "";
  const results = queryState.results;
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setQueryState((prev) => ({ status: "loading", results: prev.results }));
      const params = new URLSearchParams({
        scope: scope === "global" ? "global" : "project",
        includeGlobal: scope === "all" ? "1" : "0",
        archived: archived ? "1" : "0",
        sort,
        page: String(page),
        pageSize: "40",
      });
      if (query.trim()) params.set("q", query.trim());
      if (favorite) params.set("favorite", "1");
      if (rating) params.set("minRating", rating);
      if (tag.trim()) params.set("tag", tag.trim());
      void listPlaygroundProfiles(params, abort.signal)
        .then((nextResults) => {
          if (!abort.signal.aborted) setQueryState({ status: "ready", results: nextResults });
        })
        .catch((cause: unknown) => {
          if (!abort.signal.aborted)
            setQueryState((prev) => ({
              status: "error",
              message: cause instanceof Error ? cause.message : "Could not load Shortlist.",
              results: prev.results,
            }));
        });
    }, 140);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [archived, favorite, page, query, rating, revision, scope, sort, tag]);
  return (
    <section
      aria-label="Shortlisted voices"
      className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          aria-label="Shortlist scope"
          value={[scope]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "all" || next === "project" || next === "global") {
              setScope(next);
              setPage(0);
            }
          }}
        >
          <ToggleGroupItem value="all">All scopes</ToggleGroupItem>
          <ToggleGroupItem value="project">Project</ToggleGroupItem>
          <ToggleGroupItem value="global">Global</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex gap-1">
          <Button
            variant={favorite ? "lit" : "ghost"}
            size="sm"
            aria-pressed={favorite}
            onClick={() => {
              setFavorite(!favorite);
              setPage(0);
            }}
          >
            <Star /> Favorites
          </Button>
          <Button
            variant={archived ? "lit" : "ghost"}
            size="sm"
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived);
              setPage(0);
            }}
          >
            Archive
          </Button>
        </div>
      </div>
      <Input
        type="search"
        aria-label="Search shortlisted voices"
        placeholder="Search aliases, voice names and descriptions"
        value={query}
        maxLength={250}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setPage(0);
        }}
      />
      <div className="grid grid-cols-3 gap-2">
        <Input
          size="sm"
          aria-label="Shortlist tag"
          placeholder="Filter by tag"
          value={tag}
          onChange={(event) => {
            setTag(event.currentTarget.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Minimum voice rating"
          value={rating}
          onChange={(event) => {
            setRating(event.currentTarget.value);
            setPage(0);
          }}
          className="border-hairline bg-card focus-visible:ring-ring rounded-md border px-2 text-sm focus-visible:ring-2"
        >
          <option value="">Any rating</option>
          {[1, 2, 3, 4, 5].map((stars) => (
            <option key={stars} value={stars}>
              {stars}+ stars
            </option>
          ))}
        </select>
        <select
          aria-label="Sort shortlisted voices"
          value={sort}
          onChange={(event) => {
            setSort(event.currentTarget.value);
            setPage(0);
          }}
          className="border-hairline bg-card focus-visible:ring-ring rounded-md border px-2 text-sm focus-visible:ring-2"
        >
          <option value="relevance">Best match</option>
          <option value="newest">Newest</option>
          <option value="rating">Highest rated</option>
          <option value="popular">Most used by provider</option>
          <option value="rare">Least used by provider</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <p className="text-muted-foreground text-xs tabular-nums" role="status">
        {busy
          ? "Searching…"
          : `${results.total.toLocaleString()} ${results.total === 1 ? "profile" : "profiles"}`}
      </p>
      {error && (
        <p className="text-warn-text text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="border-hairline min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
        {results.profiles.map((profile) => {
          const active = selected?.id === profile.id && selected.scope === profile.scope;
          return (
            <div
              key={`${profile.scope}:${profile.id}`}
              className={cn("flex min-w-0 items-center gap-2 px-3 py-2", active && "bg-primary/10")}
            >
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={!profile.voice.previewUrl}
                aria-label={`Free sample for ${profile.alias || profile.voice.name}`}
                onClick={() => previewCastingVoice(profile.voice)}
              >
                <Headphones />
              </Button>
              <Button
                variant="ghost"
                size="row"
                className="min-w-0 flex-1 justify-start text-start"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(profile)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full bg-(--voice-color)"
                    style={{ "--voice-color": profile.color || "var(--tint)" } as CSSProperties}
                  />
                  <span className="min-w-0">
                    <bdi
                      className="block truncate text-sm font-medium"
                      title={profile.alias || profile.voice.name}
                    >
                      {profile.alias || profile.voice.name}
                    </bdi>
                    <span className="text-muted-foreground block truncate text-xs">
                      {profile.scope === "global" ? "Global" : "Project"} ·{" "}
                      {profile.voice.gender || profile.voice.category}
                      {profile.rating ? ` · ${profile.rating}/5` : ""}
                      {profile.tags?.length ? ` · ${profile.tags.join(", ")}` : ""}
                    </span>
                  </span>
                </span>
              </Button>
              {profile.favorite && (
                <Star className="text-primary-text size-3.5 fill-current" aria-label="Favorite" />
              )}
            </div>
          );
        })}
        {!busy && !error && !results.profiles.length && (
          <p className="text-muted-foreground p-5 text-sm">
            {query.trim() || favorite || rating || tag.trim() || scope !== "all"
              ? "No profiles match these filters. Clear a filter to see more voices."
              : archived
                ? "No archived profiles yet."
                : "No shortlisted voices yet. Save a voice from Directory."}
          </p>
        )}
      </div>
      {(page > 0 || results.hasMore) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-xs">Page {page + 1}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !results.hasMore}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
