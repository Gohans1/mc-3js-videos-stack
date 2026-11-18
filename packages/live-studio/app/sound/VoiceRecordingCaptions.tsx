import { Captions } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

import { AUDIO_TAG_RE, stripDialogueSpeakerBrackets } from "../../src/voice-playground-text.mjs";
import { auditionProgress, auditionTarget, subscribeAudition } from "./sound";
import { setComposerDraft, switchPlaygroundTool } from "./voice-playground-client";
import type { UnifiedPlaygroundEntry } from "./voice-playground-view";

interface CaptionPart {
  text: string;
  from: number;
  to: number;
}
interface SavedCaptions {
  source: "words" | "cues" | "script";
  text: string;
  parts: CaptionPart[];
}

export function VoiceRecordingCaptions({ entry }: { entry: UnifiedPlaygroundEntry }) {
  const item = entry.playgroundItem ?? entry.sourceRecording;
  const id = item?.id;
  const scope = item?.scope ?? "project";
  const key = id ? `${scope}:${id}` : null;
  const [loaded, setLoaded] = useState<{ key: string; captions: SavedCaptions } | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const activeText = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!id || !key) return;
    const controller = new AbortController();
    fetch(`/api/voice/playground/items/${encodeURIComponent(id)}/captions?scope=${scope}`, {
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? ((await response.json()) as SavedCaptions) : null))
      .then((captions) => {
        if (captions && !controller.signal.aborted) setLoaded({ key, captions });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, key, scope, item?.updatedAt]);

  const captions = loaded?.key === key ? loaded?.captions : undefined;
  const converted = item?.kind === "voice_changer";
  const sourceText = stripDialogueSpeakerBrackets(entry.spoken).replace(AUDIO_TAG_RE, "").trim();
  const plain = converted ? "" : sourceText;
  const sourceLabel = converted ? sourceText.match(/^Source:\s*(.+)$/su)?.[1] : undefined;

  const timed = useMemo(() => {
    const text = (captions?.text || plain).normalize("NFC");
    const ranges = [];
    let cursor = 0;
    for (const part of captions?.parts ?? []) {
      const token = part.text.trim().normalize("NFC");
      if (!token) continue;
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const leading = /^[\p{L}\p{N}]/u.test(token) ? "(?<![\\p{L}\\p{N}])" : "";
      const trailing = /[\p{L}\p{N}]$/u.test(token) ? "(?![\\p{L}\\p{N}])" : "";
      const matcher = new RegExp(leading + escaped + trailing, "giu");
      matcher.lastIndex = cursor;
      const match = matcher.exec(text);
      if (!match) continue;
      ranges.push({ ...part, start: match.index, end: matcher.lastIndex });
      cursor = matcher.lastIndex;
    }
    return { ranges, text };
  }, [captions, plain]);

  const currentPart = useCallback(() => {
    if (auditionTarget() !== entry.auditionId) return -1;
    const time = auditionProgress(entry.durationSeconds).at;
    let low = 0,
      high = timed.ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (timed.ranges[middle]!.from <= time) low = middle + 1;
      else high = middle - 1;
    }
    const part = timed.ranges[high];
    return part && time < part.to ? high : -1;
  }, [entry.auditionId, entry.durationSeconds, timed]);
  const active = useSyncExternalStore(subscribeAudition, currentPart, () => -1);

  useEffect(() => {
    const box = transcript.current;
    const part = activeText.current;
    if (!box || !part) return;
    const visible = box.getBoundingClientRect(),
      word = part.getBoundingClientRect();
    if (word.top < visible.top || word.bottom > visible.bottom)
      box.scrollTop += word.top - visible.top - Math.round(visible.height / 3);
  }, [active]);

  const display = timed.text;
  const selected = timed.ranges[active];
  const missingSrt =
    item?.connection !== "elevenlabs" &&
    item?.connection !== "google" &&
    item?.exportTranscript === true &&
    !item.srtFile &&
    !item.srtText;
  if (!display && !converted && !missingSrt) return null;
  return (
    <section
      aria-label="Transcript"
      className="border-hairline flex min-w-0 flex-col gap-2 border-t pt-4"
    >
      <div className="text-foreground flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Captions className="size-4" aria-hidden /> Transcript
        </h3>
        {display && (
          <span className="text-muted-foreground text-xs">
            {!timed.ranges.length
              ? "Untimed script"
              : captions?.source === "words"
                ? "Word timing"
                : "Line timing"}
          </span>
        )}
      </div>
      {display ? (
        <div ref={transcript} className="max-h-64 min-h-11 overflow-y-auto overscroll-contain">
          <p className="text-foreground max-w-prose text-sm leading-normal break-words whitespace-pre-wrap">
            {selected ? (
              <>
                {display.slice(0, selected.start)}
                <mark
                  ref={activeText}
                  className="bg-primary/20 text-primary-text rounded-sm box-decoration-clone"
                >
                  {display.slice(selected.start, selected.end)}
                </mark>
                {display.slice(selected.end)}
              </>
            ) : (
              display
            )}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No transcript yet.</p>
      )}
      {sourceLabel && (
        <p className="text-muted-foreground text-sm break-words">Source audio · {sourceLabel}</p>
      )}
      {missingSrt && (
        <p className="text-muted-foreground max-w-prose text-sm">
          Audio saved. GenVoice did not return SRT subtitles. Transcription may cost credits.
        </p>
      )}
      {item?.audioFile && item.kind !== "stt" && (missingSrt || captions?.source !== "words") && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            switchPlaygroundTool("stt");
            setComposerDraft({
              sttSourceKind: "playground",
              sttSourceItemId: item.id,
              sttLanguageCode: item.languageCode || "",
              sttGranularity: "word",
            });
          }}
        >
          {converted
            ? "Transcribe converted audio"
            : missingSrt
              ? "Transcribe to create SRT"
              : "Get word timing…"}
        </Button>
      )}
    </section>
  );
}
