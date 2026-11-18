import { ArrowUpRight, Check, Download, Headphones, Star } from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type { DubbingJob } from "../../src/voice-playground-dubbing.mjs";
import { AuditionScrubber } from "./AuditionScrubber";
import {
  listening,
  listenUrl,
  playNativeAudition,
  releaseNativeAudition,
  stopAudition,
  subscribeAudition,
} from "./sound";
import {
  comparePlaygroundEntry,
  selectPlaygroundUid,
  setComposerDraft,
  setPlaygroundFilters,
  setPlaygroundSubTab,
  switchPlaygroundTool,
  toggleUnifiedFavorite,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import {
  DEFAULT_PLAYGROUND_FILTERS,
  recordedFee,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import { VoiceDubbingJobs } from "./VoiceDubbingJobs";
import { VoicePlaygroundJobQueue } from "./VoicePlaygroundJobQueue";
import { SttTranscriptDetails } from "./VoicePlaygroundSecondaryModes";
import { VoicePlaygroundUseTake } from "./VoicePlaygroundUseTake";
import { VoiceRecordingCaptions } from "./VoiceRecordingCaptions";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

export function VoiceRecordingPlayer({ entry }: { entry: UnifiedPlaygroundEntry }) {
  const playing =
    useSyncExternalStore(subscribeAudition, listening, listening) === entry.auditionId;
  if (!entry.audioUrl) return null;
  return (
    <div className="border-hairline bg-surface-subtle flex items-center gap-3 rounded-lg border p-3">
      <Button
        type="button"
        variant={playing ? "lit" : "cover"}
        size="icon-lg"
        aria-label={`${playing ? "Pause" : "Play"} ${entry.title}`}
        onClick={() => listenUrl(entry.auditionId, entry.audioUrl)}
      >
        <VoicePlaybackIcon playing={playing} />
      </Button>
      <AuditionScrubber
        id={entry.auditionId}
        label={entry.title}
        fallbackSeconds={entry.durationSeconds}
        kind="sfx"
        flush
        className="min-w-0 flex-1"
      />
    </div>
  );
}

export function VoiceDubbingMedia({
  entry,
  compactDownloads = false,
}: {
  entry: UnifiedPlaygroundEntry;
  compactDownloads?: boolean;
}) {
  const item = entry.playgroundItem ?? entry.sourceRecording,
    dubbing = item?.dubbing;
  const [view, setView] = useState<"video" | "audio" | "original">(
    dubbing?.resultFile && !item?.version?.edit ? "video" : "audio",
  );
  const media = useRef<HTMLMediaElement | null>(null);
  const attachMedia = useCallback((node: HTMLMediaElement | null) => {
    if (media.current && media.current !== node) releaseNativeAudition(media.current);
    media.current = node;
  }, []);
  if (!item || !dubbing) return <VoiceRecordingPlayer entry={entry} />;
  const asset = (kind: "source" | "result") =>
    `/api/voice/playground/items/${encodeURIComponent(item.id)}/dubbing/${kind}?scope=${item.scope ?? "project"}`;
  const videoAvailable = Boolean(dubbing.resultFile && !item.version?.edit),
    original = view === "original",
    nativeVideo = view === "video" || (original && /\.(mp4|mov)$/i.test(dubbing.sourceFile ?? ""));
  const src = asset(original ? "source" : "result");
  const subtitles = entry.srtFile
      ? `/api/voice/playground/srt/${encodeURIComponent(entry.srtFile)}?scope=${item.scope ?? "project"}`
      : null,
    label = `${original ? "Original" : "Dubbed"} ${nativeVideo ? "video" : "audio"} for ${entry.title}`;
  const downloads = (
    <div className="flex flex-wrap gap-2" aria-label="Dubbing downloads">
      {[
        ["Audio MP3", entry.audioUrl],
        ...(videoAvailable ? [["Dubbed video", asset("result")]] : []),
        ...(dubbing.sourceFile ? [["Original source", asset("source")]] : []),
        ...(subtitles ? [["Subtitles SRT", subtitles]] : []),
      ].map(([name, url]) => (
        <Button
          key={name}
          size="sm"
          variant="secondary"
          render={<a href={url} download aria-label={name} />}
          nativeButton={false}
        >
          <Download />
          {name}
        </Button>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        aria-label="Dubbing media"
        value={[view]}
        onValueChange={(values) => {
          const next = values[0];
          if (next === "video" || next === "audio" || next === "original") {
            media.current?.pause();
            stopAudition();
            setView(next);
          }
        }}
      >
        {videoAvailable && <ToggleGroupItem value="video">Video</ToggleGroupItem>}
        <ToggleGroupItem value="audio">Audio</ToggleGroupItem>
        {dubbing.sourceFile && <ToggleGroupItem value="original">Original</ToggleGroupItem>}
      </ToggleGroup>
      {view === "audio" ? (
        videoAvailable ? (
          <div className="bg-backdrop flex aspect-video flex-col justify-center rounded-lg p-3">
            <VoiceRecordingPlayer entry={entry} />
          </div>
        ) : (
          <VoiceRecordingPlayer entry={entry} />
        )
      ) : nativeVideo ? (
        <video
          key={src}
          ref={attachMedia}
          src={src}
          controls
          preload="metadata"
          aria-label={label}
          onPlay={(event) => playNativeAudition(event.currentTarget)}
          className="bg-backdrop aspect-video w-full rounded-lg"
        >
          {!original && subtitles && (
            <track
              kind="captions"
              src={`${subtitles}&format=vtt`}
              srcLang={dubbing.targetLanguage}
              label={`Dubbed captions (${dubbing.targetLanguage.toUpperCase()})`}
              default
            />
          )}
        </video>
      ) : (
        <audio
          key={src}
          ref={attachMedia}
          src={src}
          controls
          preload="metadata"
          aria-label={label}
          onPlay={(event) => playNativeAudition(event.currentTarget)}
          className="w-full"
        />
      )}
      <p className="text-muted-foreground text-sm">
        {dubbing.sourceLanguage.toUpperCase()} → {dubbing.targetLanguage.toUpperCase()} ·{" "}
        {dubbing.sourceName || "Original source retained"}
      </p>
      {compactDownloads ? (
        <details className="border-hairline rounded-md border p-2.5">
          <summary className="text-foreground focus-visible:outline-ring cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2">
            Download files
          </summary>
          <div className="mt-2">{downloads}</div>
        </details>
      ) : (
        downloads
      )}
      {item.version?.edit && (
        <p className="text-muted-foreground text-sm">
          This version edits the audio. The original dubbed video remains on its earlier version.
        </p>
      )}
    </div>
  );
}

export function VoicePlaygroundResults({
  pg,
  entries,
  selected,
  dubbingJobs = [],
}: {
  pg: VoicePlaygroundClientState;
  entries: readonly UnifiedPlaygroundEntry[];
  selected: UnifiedPlaygroundEntry | null;
  dubbingJobs?: readonly DubbingJob[];
}) {
  const recent = entries
    .filter((entry) => entry.origin === "playground" && entry.audioUrl)
    .slice(0, 8);
  const item = selected?.playgroundItem ?? selected?.sourceRecording;
  const transcript = pg.draft.mode === "stt" ? (item?.sttResult ?? pg.lastSttResult) : null;
  const { mode } = pg.draft;
  const runningJobs = pg.jobs.filter(
    (job) => job.kind === mode && ["pending", "processing", "downloading"].includes(job.status),
  );
  const transcribing = mode === "stt" && (pg.busyAction === "stt" || runningJobs.length > 0);
  const creatingTake = mode !== "stt" && mode !== "dubbing" && runningJobs.length > 0;
  const generationStatus =
    mode === "dialogue"
      ? "Generating dialogue…"
      : mode === "voice_changer"
        ? "Converting audio…"
        : "Generating speech…";
  const resultLabel = selected && selected.uid !== entries[0]?.uid ? "Selected" : "Latest";
  const title = `${resultLabel} ${mode === "stt" ? "transcript" : mode === "dubbing" ? "dub" : "take"}`;
  const emptyMessage = {
    tts: "Generate speech to hear the result and read its captions.",
    dialogue: "Generate dialogue to listen to the full scene.",
    voice_changer: "Convert your source audio to hear it in the selected voice.",
    stt: "Transcribe an audio or video source to read and export the text.",
    dubbing: "Start a dub to listen to it here when it’s ready.",
  }[mode];
  const inUse = selected && pg.usage.some((use) => use.itemId === selected.id);
  return (
    <aside
      aria-label="Results"
      className="border-hairline bg-surface-subtle/30 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain border-s p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-foreground text-lg leading-tight font-semibold">{title}</h3>
        {(transcript ? item?.sttResult : selected?.audioUrl && item) && (
          <Badge variant="secondary">Saved on disk</Badge>
        )}
      </div>
      {transcribing && (
        <p role="status" className="text-muted-foreground mb-4 max-w-prose text-sm">
          Transcription in progress. You can leave this page and check Jobs.
        </p>
      )}
      {creatingTake && (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
          {generationStatus} Follow progress in Jobs.
        </p>
      )}
      {transcript ? (
        <section aria-label="Saved transcription" className="flex flex-col gap-4">
          <div>
            <h4 className="text-foreground text-base leading-snug font-semibold break-words">
              {selected?.title || pg.lastSttResult?.sourceLabel || "Transcription"}
            </h4>
            <p className="text-muted-foreground mt-1 text-sm">
              {item?.scope === "global" ? "Global" : "This project"} · Scribe v2
            </p>
          </div>
          <SttTranscriptDetails
            result={transcript}
            onSendToTts={(text) => {
              switchPlaygroundTool("tts");
              setComposerDraft({ text });
            }}
          />
          {selected?.kind === "stt" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPlaygroundFilters({ ...DEFAULT_PLAYGROUND_FILTERS });
                    selectPlaygroundUid(selected.uid);
                    setPlaygroundSubTab("inspect");
                  }}
                >
                  Open saved transcript
                  <ArrowUpRight />
                </Button>
                <Button
                  variant="favorite"
                  size="icon-sm"
                  aria-label={`Favorite ${selected.title}`}
                  aria-pressed={selected.favorite}
                  onClick={() => void toggleUnifiedFavorite(selected)}
                >
                  <Star className={selected.favorite ? "fill-current" : ""} />
                </Button>
              </div>
              {selected.audioUrl && (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm">Original source audio</p>
                  <VoiceRecordingPlayer entry={selected} />
                </div>
              )}
            </>
          )}
        </section>
      ) : selected?.audioUrl ? (
        <section aria-label="Selected result" className="flex flex-col gap-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="text-foreground text-base leading-snug font-semibold break-words">
                {selected.title}
              </h4>
              <p className="text-muted-foreground mt-1 text-sm">
                {selected.voiceName} · {item?.scope === "global" ? "Global" : "This project"}
              </p>
            </div>
            <Button
              variant="favorite"
              size="icon-sm"
              aria-label={`Favorite ${selected.title}`}
              aria-pressed={selected.favorite}
              onClick={() => void toggleUnifiedFavorite(selected)}
            >
              <Star className={cn(selected.favorite && "fill-current")} />
            </Button>
          </div>
          {inUse && (
            <Badge variant="done">
              <Check />
              In use in this film
            </Badge>
          )}
          {selected.kind === "dubbing" ? (
            <VoiceDubbingMedia key={selected.uid} entry={selected} />
          ) : (
            <>
              <VoiceRecordingPlayer entry={selected} />
              <VoiceRecordingCaptions entry={selected} />
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Actual fee</span>
            <span className="text-foreground font-medium tabular-nums">{recordedFee(item)}</span>
          </div>
          <VoicePlaygroundUseTake entry={selected} secondary />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPlaygroundFilters({ ...DEFAULT_PLAYGROUND_FILTERS });
                selectPlaygroundUid(selected.uid);
                setPlaygroundSubTab("inspect");
              }}
            >
              Details & versions
              <ArrowUpRight />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={pg.compareUids.includes(selected.uid)}
              onClick={() => void comparePlaygroundEntry(selected)}
            >
              Add to compare
            </Button>
          </div>
        </section>
      ) : !transcribing && !creatingTake ? (
        <Empty className="min-h-44 flex-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Headphones />
            </EmptyMedia>
            <EmptyTitle>
              {mode === "stt"
                ? "No transcript yet"
                : mode === "dubbing"
                  ? "No dub yet"
                  : "No take yet"}
            </EmptyTitle>
            <EmptyDescription>{emptyMessage}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <div className="mt-6 flex flex-col gap-4">
        {pg.draft.mode === "dubbing" ? (
          <VoiceDubbingJobs jobs={dubbingJobs} compact />
        ) : (
          <VoicePlaygroundJobQueue jobs={runningJobs} items={pg.items} />
        )}
        {recent.length > 0 && (
          <section aria-label="Recent recordings" className="border-hairline border-t pt-4">
            <h4 className="text-muted-foreground mb-2 text-sm font-medium">Recent recordings</h4>
            <div className="flex flex-col gap-1">
              {recent.map((entry) => (
                <button
                  key={entry.uid}
                  type="button"
                  aria-current={selected?.uid === entry.uid ? "true" : undefined}
                  onClick={() => selectPlaygroundUid(entry.uid)}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-12 items-center gap-3 rounded-md px-2 py-2 text-start outline-none focus-visible:ring-2",
                    selected?.uid === entry.uid
                      ? "bg-primary/10 text-primary-text"
                      : "text-foreground hover:bg-raised-2",
                  )}
                >
                  <Headphones aria-hidden className="size-4 flex-none" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" title={entry.title}>
                      {entry.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {entry.voiceName} ·{" "}
                      {entry.playgroundItem?.scope === "global" ? "Global" : "Project"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
