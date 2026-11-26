import { AlertCircle, Columns2, RefreshCw, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { onWake, S } from "../core/state";
import { useStudio } from "../core/store";
import { stamp } from "../core/time";
import { seekExact } from "../playback/transport";
import {
  activeCompareVideo,
  compareSpanJumpTarget,
  compareVideoDuration,
  loadCompareVideos,
  retryCompareVideo,
  selectCompareVideo,
  setCompareVideoMode,
} from "./compare-video";
import {
  compareLayoutBadge,
  type CompareVideoItem,
  defaultCompareLayout,
  filmToVideoTime,
  formatCompareAge,
  formatCompareBytes,
} from "./compare-video-model";
import { ComparePlaybackControls } from "./ComparePlaybackControls";

const folderHint = (path: string): string => {
  const parts = path.split("/");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/` : "";
};

const shellQuote = (value: string): string => (/\s/.test(value) ? JSON.stringify(value) : value);

const groupByCategory = (videos: readonly CompareVideoItem[], pairLabel: string) =>
  (
    [
      { category: "compare", label: `Compare (${pairLabel})` },
      { category: "render", label: "Renders" },
      { category: "reference", label: "Reference" },
    ] as const
  )
    .map((g) => ({
      ...g,
      items: videos.filter((v) => v.category === g.category),
    }))
    .filter((g) => g.items.length > 0);

function SpanNotice() {
  const path = useStudio((s) => s.compareVideoPath);
  const meta = useStudio((s) => s.compareVideoMeta);
  const [outside, setOutside] = useState<"before" | "after" | null>(null);

  useEffect(() => {
    const check = () => {
      const item = activeCompareVideo();
      if (!item) {
        setOutside(null);
        return;
      }
      const dur = compareVideoDuration();
      const next = filmToVideoTime(S.t, item.startSec, dur).outside;
      setOutside((prev) => (prev === next ? prev : next));
    };
    check();
    return onWake("rendered", check);
  }, [path, meta?.duration]);

  const item = activeCompareVideo();
  if (!outside || !item) return null;
  const dur = compareVideoDuration();
  const spanLabel =
    outside === "before"
      ? `Starts at ${stamp(item.startSec)}`
      : dur > 0
        ? `Ends at ${stamp(item.startSec + dur)}`
        : "Past video end";
  return (
    <Button
      type="button"
      variant="warn"
      size="xs"
      className="shrink-0"
      onClick={() => {
        const target = compareSpanJumpTarget();
        if (target !== null) seekExact(target);
      }}
      title="Jump playhead into this video's covered time span"
    >
      <span className="tabular-nums">{spanLabel} · Jump</span>
    </Button>
  );
}

export function CompareVideoBar() {
  const videos = useStudio((s) => s.compareVideos);
  const path = useStudio((s) => s.compareVideoPath);
  const meta = useStudio((s) => s.compareVideoMeta);
  const ratio = useStudio((s) => s.ratio);
  const latestNotice = useStudio((s) => s.compareLatestNotice);
  const [refreshing, setRefreshing] = useState(false);

  const activeItem = videos.find((v) => v.path === path) ?? null;
  const matchedMeta = activeItem && meta?.path === activeItem.path ? meta : null;
  const layout = activeItem?.layoutExact
    ? activeItem.layout
    : (matchedMeta?.layout ?? activeItem?.layout);
  const layoutBadge = activeItem && layout ? compareLayoutBadge(activeItem.category, layout) : null;
  const pairLabel = compareLayoutBadge("compare", defaultCompareLayout("compare", ratio));
  const groups = groupByCategory(videos, pairLabel);
  const selectItems = videos.map((v) => ({ value: v.path, label: v.name }));
  const latestItem = latestNotice ? videos.find((v) => v.path === latestNotice) : null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCompareVideos();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      data-compare-video-bar
      role="group"
      aria-label="Compare video controls"
      className="bg-card/95 border-hairline-subtle @container z-3 flex min-h-10 flex-none flex-wrap items-center gap-x-1.5 gap-y-1 border-b px-2.5 py-1"
    >
      <div
        role="group"
        aria-label="Stage view mode"
        className="bg-backdrop/75 border-hairline inline-flex flex-none items-center rounded-md border p-0.5"
      >
        <button
          type="button"
          aria-pressed={false}
          onClick={() => setCompareVideoMode(false)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring text-ui h-6 cursor-pointer rounded-sm px-2 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none"
        >
          Live 3D
        </button>
        <button
          type="button"
          aria-pressed={true}
          className="bg-raised-3 text-heading-foreground ring-hairline-strong focus-visible:ring-ring text-ui inline-flex h-6 items-center gap-1 rounded-sm px-2 font-semibold whitespace-nowrap shadow-xs ring-1 outline-none focus-visible:ring-2"
        >
          <Columns2 aria-hidden className="text-primary-text size-3.5 shrink-0" />
          <span>Compare</span>
        </button>
      </div>

      {videos.length > 0 && (
        <Select
          items={selectItems}
          value={path ?? ""}
          onValueChange={(next) => {
            if (typeof next === "string" && next) selectCompareVideo(next);
          }}
        >
          <SelectTrigger
            size="default"
            aria-label="Compare video file"
            className="max-w-64 min-w-32 shrink"
          >
            <SelectValue placeholder="Choose video…">
              {activeItem ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-xs">{activeItem.name}</span>
                  {layoutBadge && (
                    <Badge variant="tag" className="shrink-0">
                      {layoutBadge}
                    </Badge>
                  )}
                </span>
              ) : (
                "Choose video…"
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" fitContent className="min-w-96">
            {groups.map((group, gi) => (
              <Fragment key={group.category}>
                {gi > 0 && <SelectSeparator />}
                <SelectGroup>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => {
                    const tag = compareLayoutBadge(
                      item.category,
                      item.path === matchedMeta?.path ? matchedMeta.layout : item.layout,
                    );
                    const dir = folderHint(item.path);
                    return (
                      <SelectItem key={item.path} value={item.path}>
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-5">
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-mono text-xs font-medium">
                              {item.name}
                            </span>
                            {dir && (
                              <span className="text-muted-foreground text-tag truncate">{dir}</span>
                            )}
                          </span>
                          <span className="text-muted-foreground text-tag flex shrink-0 items-center gap-1.5 tabular-nums">
                            <span>{tag}</span>
                            <span>·</span>
                            <span>{formatCompareBytes(item.size)}</span>
                            <span>·</span>
                            <span>{formatCompareAge(item.mtimeMs)}</span>
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </Fragment>
            ))}
          </SelectContent>
        </Select>
      )}

      <Tip label="Refresh video list from renders/ and references/">
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label="Refresh video list"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          className="shrink-0"
        >
          <RefreshCw aria-hidden className={cn("size-3.5", refreshing && "animate-spin")} />
        </Button>
      </Tip>

      {latestItem && (
        <Button
          type="button"
          variant="lit"
          size="xs"
          className="shrink-0"
          onClick={() => selectCompareVideo(latestItem.path)}
          title={`Switch to newly built ${latestItem.path}`}
        >
          <Sparkles aria-hidden data-icon="inline-start" />
          <span className="max-w-28 truncate @max-[920px]:max-w-20">New: {latestItem.name}</span>
        </Button>
      )}

      <SpanNotice />

      <ComparePlaybackControls />

      <span className="text-muted-foreground ms-auto hidden truncate text-xs @min-[1160px]:inline">
        {activeItem && matchedMeta && matchedMeta.width > 0
          ? `${matchedMeta.width}×${matchedMeta.height} · Click to pin · Drag to draw`
          : "Click to pin · Drag to draw"}
      </span>

      <Tip label="Back to Live 3D (V)">
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label="Back to Live 3D"
          onClick={() => setCompareVideoMode(false)}
          className="ms-auto shrink-0 @min-[1160px]:ms-0"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      </Tip>
    </div>
  );
}

export function CompareVideoEmpty() {
  const loaded = useStudio((s) => s.compareVideosLoaded);
  const videos = useStudio((s) => s.compareVideos);
  const path = useStudio((s) => s.compareVideoPath);
  const videoError = useStudio((s) => s.compareVideoError);
  const catalogError = useStudio((s) => s.compareCatalogError);
  const ratio = useStudio((s) => s.ratio);
  const canBuild = useStudio((s) => s.compareCanBuild);

  const activeItem = videos.find((v) => v.path === path) ?? null;
  if (activeItem && !videoError) return null;
  const error = videoError ?? catalogError;
  const pairLabel = compareLayoutBadge("compare", defaultCompareLayout("compare", ratio));

  return (
    <div
      data-compare-video-empty
      className="pointer-events-auto absolute inset-0 z-4 grid place-items-center p-4"
    >
      <div className="bg-card/95 border-hairline-strong flex w-full max-w-md flex-col gap-3 rounded-xl border p-5 shadow-lg">
        <div className="flex items-start gap-2.5">
          {error ? (
            <AlertCircle aria-hidden className="text-warn-text mt-0.5 size-5 shrink-0" />
          ) : (
            <Columns2 aria-hidden className="text-primary-text mt-0.5 size-5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground text-sm font-semibold">
              {error
                ? "Could not load compare video"
                : !loaded
                  ? "Scanning project videos…"
                  : "No compare or rendered videos yet"}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
              {error
                ? error
                : !loaded
                  ? "Checking renders/reference/, renders/, and references/."
                  : `Ask your agent to create a ${pairLabel} video in renders/reference/.`}
            </p>
          </div>
        </div>

        {loaded && !error && (
          <code className="bg-backdrop/80 border-hairline-subtle text-label text-tag block rounded-md border px-2.5 py-1.5 font-mono break-all select-all">
            bun run reference sidebyside {shellQuote(canBuild.ref ?? "references/ref.mp4")}{" "}
            {shellQuote(canBuild.ours ?? "renders/draft.mp4")}
          </code>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {error && (
            <Button type="button" size="sm" onClick={() => void retryCompareVideo()}>
              <RefreshCw aria-hidden data-icon="inline-start" />
              Retry
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCompareVideoMode(false)}
          >
            Back to Live 3D
          </Button>
        </div>
      </div>
    </div>
  );
}
