import { Columns2, Download, PenLine, RefreshCw } from "lucide-react";
import { Fragment } from "react";

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

import {
  compareLayoutBadge,
  formatCompareAge,
  formatCompareBytes,
} from "../picture/compare-video-model.ts";
import { folderHint, groupVideosByCategory } from "./model.ts";
import { playback } from "./playback.ts";
import { lite, useLite } from "./store.ts";

export function VideoBar() {
  const videos = useLite((s) => s.videos);
  const selectedPath = useLite((s) => s.selectedPath);
  const videoMeta = useLite((s) => s.videoMeta);
  const ratio = useLite((s) => s.film.ratio);
  const refreshing = useLite((s) => s.refreshing);
  const inkTool = useLite((s) => s.inkTool);
  const compose = useLite((s) => s.compose);
  const noteSaving = useLite((s) => s.noteSaving);

  const activeItem = videos.find((v) => v.path === selectedPath) ?? null;
  const matchedMeta = activeItem && videoMeta?.path === activeItem.path ? videoMeta : null;
  const layout = activeItem?.layoutExact
    ? activeItem.layout
    : (matchedMeta?.layout ?? activeItem?.layout);
  const layoutBadge = activeItem && layout ? compareLayoutBadge(activeItem.category, layout) : null;
  const groups = groupVideosByCategory(videos, ratio);
  const selectItems = videos.map((v) => ({ value: v.path, label: v.name }));
  const drawDisabled = !activeItem || compose?.kind === "edit" || noteSaving;

  const handleDownload = () => {
    if (!activeItem) return;
    const link = document.createElement("a");
    link.href = `/api/compare-videos/file?path=${encodeURIComponent(activeItem.path)}&download=1`;
    link.download = activeItem.name;
    link.click();
  };

  const toggleDraw = () => {
    if (drawDisabled) return;
    if (inkTool) {
      lite.setInkTool(null);
      return;
    }
    const wasPlaying = playback.isPlaying;
    if (wasPlaying) playback.pause();
    if (!lite.store.getState().compose) {
      lite.openCreateNote(null, playback.t, wasPlaying, { autoFocus: false });
    }
    lite.setInkTool("pen");
  };

  return (
    <div
      data-lite-video-bar
      role="group"
      aria-label="Video controls"
      className="bg-card/95 border-hairline-subtle flex flex-none items-center gap-1.5 border-b px-2 py-1"
    >
      {videos.length > 0 ? (
        <Select
          items={selectItems}
          disabled={noteSaving}
          value={selectedPath ?? ""}
          onValueChange={(next) => {
            if (typeof next === "string" && next) {
              playback.pause();
              playback.clearPendingSeek();
              lite.selectVideo(next);
            }
          }}
        >
          <SelectTrigger
            size="default"
            aria-label="Choose video"
            className="h-8 min-w-0 flex-1 pointer-coarse:h-8"
          >
            <SelectValue placeholder="Choose video…">
              {activeItem ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Columns2 aria-hidden className="text-primary-text size-3.5 shrink-0" />
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
          <SelectContent align="start" fitContent className="w-[calc(100vw-1rem)] max-w-md">
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
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-5">
                          <span className="truncate font-mono text-xs font-medium">
                            {item.name}
                          </span>
                          <span className="text-muted-foreground text-tag flex min-w-0 items-center gap-1 tabular-nums">
                            {dir && (
                              <>
                                <span className="truncate">{dir}</span>
                                <span>·</span>
                              </>
                            )}
                            <span className="shrink-0">{tag}</span>
                            <span>·</span>
                            <span className="shrink-0">{formatCompareBytes(item.size)}</span>
                            <span>·</span>
                            <span className="shrink-0">{formatCompareAge(item.mtimeMs)}</span>
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
      ) : (
        <div className="text-muted-foreground flex h-8 min-w-0 flex-1 items-center gap-1.5 px-1 text-xs">
          <Columns2 aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">No videos found</span>
        </div>
      )}

      <Button
        type="button"
        variant={inkTool ? "lit" : "quiet"}
        size="phone-bar"
        aria-label={inkTool ? "Stop drawing" : "Draw on frame"}
        aria-pressed={Boolean(inkTool)}
        title={inkTool ? "Stop drawing (D)" : "Draw on frame (D)"}
        disabled={drawDisabled}
        onClick={toggleDraw}
        className="flex-none"
      >
        <PenLine aria-hidden />
      </Button>

      <Button
        type="button"
        variant="quiet"
        size="phone-bar"
        aria-label="Refresh videos and notes"
        title="Refresh videos and notes (R)"
        disabled={refreshing}
        onClick={() => void lite.refreshAll()}
        className="flex-none"
      >
        <RefreshCw aria-hidden className={cn(refreshing && "motion-safe:animate-spin")} />
      </Button>

      <Button
        type="button"
        variant="quiet"
        size="phone-bar"
        aria-label="Download video"
        title="Download video"
        disabled={!activeItem}
        onClick={handleDownload}
        className="flex-none"
      >
        <Download aria-hidden />
      </Button>
    </div>
  );
}
