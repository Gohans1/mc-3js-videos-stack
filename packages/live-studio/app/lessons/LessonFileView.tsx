import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  Eye,
  GitCompare,
  ListTree,
  Pencil,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useLitAny } from "../activity/activity";
import { SaveStatus, Segmented } from "../components/inspector";
import { lessonChanges } from "./changes";
import { ConfirmDeleteButton, HEAD, SCOPE_LABEL, TEXT } from "./lesson-ui";
import { LessonChanges } from "./LessonChanges";
import { LessonMarkdownView } from "./LessonMarkdownView";
import {
  type LessonViewMode,
  markRead,
  openLesson,
  parseLessonKey,
  saveLesson,
  setLessonView,
  takePick,
  typeLesson,
  useLessons,
} from "./lessons";
import { findActiveHeading, parseLessonHeadings } from "./markdown";
import { flyTo } from "./motion";

function findVisibleLine(scroller: HTMLElement | null): number {
  if (!scroller) return 1;
  const nodes = scroller.querySelectorAll<HTMLElement>("[data-line]");
  const baseTop = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const threshold = scroller.scrollTop + 18;
  let active = 1;
  for (const el of nodes) {
    const line = Number(el.dataset.line);
    if (!Number.isFinite(line)) continue;
    const top = el.getBoundingClientRect().top - baseTop;
    if (top <= threshold) active = line;
    else break;
  }
  return active;
}

function scrollScrollerToLine(
  scroller: HTMLElement | null,
  line: number,
  smooth: boolean,
): () => void {
  if (!scroller) return () => {};
  const nodes = [...scroller.querySelectorAll<HTMLElement>("[data-line]")];
  let target: HTMLElement | null = null;
  for (const el of nodes) {
    const n = Number(el.dataset.line);
    if (!Number.isFinite(n)) continue;
    if (n <= line) target = el;
    if (n >= line) {
      if (n === line) target = el;
      break;
    }
  }
  if (!target) return () => {};
  const top =
    target.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    12;
  if (smooth) return flyTo(scroller, top);
  scroller.scrollTop = Math.max(0, top);
  return () => {};
}

/** Reader, painted live editor, Contents navigator, and AI word-diff sheet for one lesson file. */
export function LessonFileView({
  path: key,
  depthPill,
  initialLine,
  showBack = false,
  onBack = () => openLesson(null),
  onDelete,
}: {
  path: string;
  depthPill?: string;
  initialLine: number | null;
  showBack?: boolean;
  onBack?: (animate: boolean) => void;
  onDelete: () => void;
}) {
  const file = useLessons((s) => s.files.find((f) => f.key === key)),
    edit = useLessons((s) => s.edits[key]),
    seen = useLessons((s) => s.seen[key]),
    dir = useLessons((s) => s.dir),
    projectDir = useLessons((s) => s.projectDir),
    preferredView = useLessons((s) => s.preferredView),
    storedView = useLessons((s) => s.viewByPath[key]),
    pickKey = useLessons((s) => s.pick?.key);
  const { scope: fallbackScope, path: fallbackPath } = parseLessonKey(key);
  const scope = file?.scope ?? fallbackScope;
  const displayPath = file?.path ?? fallbackPath;
  const folder = scope === "film" && projectDir ? projectDir : dir;
  const lit = useLitAny([`lesson:${key}`, ...(scope === "all" ? [`lesson:${displayPath}`] : [])]);
  const text = edit?.text ?? file?.text ?? "";
  const news = useMemo(
    () => (file && seen && seen.tag !== file.tag ? lessonChanges(seen.text, file.text) : null),
    [file, seen],
  );
  const view: LessonViewMode = storedView ?? (pickKey === key ? "edit" : preferredView);
  const effectiveView: LessonViewMode = view === "changes" && !news ? preferredView : view;
  const [contentsOpen, setContentsOpen] = useState(false);
  const [activeLine, setActiveLine] = useState(1);

  const area = useRef<HTMLTextAreaElement>(null),
    painted = useRef<HTMLPreElement>(null),
    readScroller = useRef<HTMLDivElement>(null),
    editScroller = useRef<HTMLDivElement>(null),
    flyStop = useRef<(() => void) | null>(null),
    viewRef = useRef(effectiveView);

  const heads = useMemo(() => parseLessonHeadings(text), [text]);
  const lines = useMemo(() => text.replace(/^\uFEFF/, "").split(/\r?\n/), [text]);
  const frontEnd = useMemo(() => {
    if (lines[0]?.trimEnd() !== "---") return 0;
    const end = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(l));
    return end === -1 ? 0 : end + 1;
  }, [lines]);
  const depthAt = useMemo(() => new Map(heads.map((h) => [h.line, h.depth])), [heads]);
  const activeHeadLine = useMemo(() => findActiveHeading(heads, activeLine), [heads, activeLine]);

  // Clean up any running flyTo scroll animation on unmount or file switch
  useEffect(() => () => flyStop.current?.(), []);
  useEffect(() => {
    viewRef.current = effectiveView;
  }, [effectiveView]);

  // A file just created via New picks its template heading immediately in Edit mode
  useEffect(() => {
    const picked = takePick(key);
    if (picked) {
      setLessonView(key, "edit", false);
      area.current?.focus({ preventScroll: true });
      area.current?.setSelectionRange(picked[0], picked[1]);
    } else if (initialLine && initialLine > 1) {
      requestAnimationFrame(() => {
        flyStop.current?.();
        const target = viewRef.current === "edit" ? editScroller.current : readScroller.current;
        flyStop.current = scrollScrollerToLine(target, initialLine, false);
        setActiveLine(initialLine);
      });
    }
  }, [key, initialLine]);

  const activeScroller = () =>
    effectiveView === "edit" ? editScroller.current : readScroller.current;

  const switchView = (next: LessonViewMode, jumpLine?: number, remember = true) => {
    if (next === effectiveView && jumpLine === undefined) return;
    flyStop.current?.();
    const keepLine =
      jumpLine ?? (effectiveView !== "changes" ? findVisibleLine(activeScroller()) : activeLine);
    setLessonView(key, next, remember);
    if (next === "changes") return;
    requestAnimationFrame(() => {
      const target = next === "edit" ? editScroller.current : readScroller.current;
      scrollScrollerToLine(target, keepLine, false);
      setActiveLine(keepLine);
      if (next === "edit" && jumpLine !== undefined) {
        const box = area.current;
        if (!box) return;
        const at = lines.slice(0, jumpLine - 1).reduce((n, l) => n + l.length + 1, 0);
        box.focus({ preventScroll: true });
        box.setSelectionRange(at, at);
      }
    });
  };

  const flyToHeading = (line: number, smooth: boolean) => {
    setContentsOpen(false);
    setActiveLine(line);
    if (effectiveView === "changes") {
      switchView(preferredView, line, false);
      return;
    }
    flyStop.current?.();
    flyStop.current = scrollScrollerToLine(activeScroller(), line, smooth);
  };

  const flyEdge = (toBottom: boolean, smooth: boolean) => {
    setContentsOpen(false);
    const scroller = activeScroller();
    if (!scroller) return;
    flyStop.current?.();
    const target = toBottom ? scroller.scrollHeight : 0;
    if (smooth) flyStop.current = flyTo(scroller, target);
    else scroller.scrollTop = target;
  };

  const goTo = (line: number) => switchView("edit", line, false);

  if (!file && !edit)
    return (
      <div className="min-h-0 flex-1 p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This file is gone</EmptyTitle>
            <EmptyDescription>The lesson file was removed outside the studio.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" size="md" onClick={() => openLesson(null)}>
              Back to the lessons
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );

  const viewItems: { id: LessonViewMode; title: React.ReactNode; ariaLabel?: string }[] = [
    {
      id: "read",
      title: (
        <span className="inline-flex items-center gap-1.5">
          <Eye aria-hidden className="size-3.5" />
          Read
        </span>
      ),
    },
    {
      id: "edit",
      title: (
        <span className="inline-flex items-center gap-1.5">
          <Pencil aria-hidden className="size-3.5" />
          Edit
        </span>
      ),
    },
    ...(news
      ? [
          {
            id: "changes" as const,
            ariaLabel: `Changes (+${news.added}, -${news.removed})`,
            title: (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <GitCompare aria-hidden className="size-3.5" />
                <span className="text-ok-text">+{news.added}</span>
                <span className="text-destructive-text">−{news.removed}</span>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-ai-lit={lit || undefined}
        className="flex flex-none flex-wrap items-start gap-1.5 px-2 py-1.5"
      >
        {showBack && (
          <Button
            variant="ghost"
            size="icon-lg"
            data-lesson-back
            title="Back to lesson list"
            aria-label="Back to lesson list"
            onClick={(e) => onBack(e.detail > 0)}
          >
            <ChevronLeft aria-hidden />
          </Button>
        )}
        <div className="min-w-24 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            {depthPill && (
              <span className="bg-muted text-muted-foreground flex-none rounded px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
                {depthPill}
              </span>
            )}
            <span className="text-foreground min-w-0 text-base/[1.3] font-semibold wrap-anywhere">
              {displayPath}
            </span>
            <Badge variant={scope === "film" ? "lessonFilm" : "lessonAll"} className="flex-none">
              {SCOPE_LABEL[scope]}
            </Badge>
          </div>
          <div
            className="text-muted-foreground text-ui/[1.35] truncate"
            title={folder ? `${folder}/${displayPath}` : displayPath}
          >
            <SaveStatus
              state={edit ? (edit.failed ? "fail" : "busy") : null}
              idleText="Saved"
              failText="Draft"
            />
          </div>
        </div>
        <Popover open={contentsOpen} onOpenChange={setContentsOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                title="Contents"
                aria-label="Contents"
                disabled={!heads.length}
              />
            }
          >
            <ListTree aria-hidden />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            motion="instant"
            className="max-h-[60vh] w-72 overflow-y-auto overscroll-contain"
          >
            <div className="border-border/80 mb-1.5 flex items-center justify-between gap-1 border-b pb-1.5">
              <span className="text-muted-foreground text-ui px-1 font-medium tabular-nums">
                Contents ({heads.length})
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="xs" onClick={(e) => flyEdge(false, e.detail > 0)}>
                  <ArrowUp aria-hidden data-icon="inline-start" />
                  Top
                </Button>
                <Button variant="ghost" size="xs" onClick={(e) => flyEdge(true, e.detail > 0)}>
                  <ArrowDown aria-hidden data-icon="inline-start" />
                  Bottom
                </Button>
              </div>
            </div>
            <nav aria-label="Contents" className="flex flex-col gap-0.5">
              {heads.map((h) => {
                const active = activeHeadLine === h.line;
                return (
                  <button
                    key={h.line}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={(e) => flyToHeading(h.line, e.detail > 0)}
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring studio-press relative flex w-full items-start gap-2 rounded-sm py-1.5 ps-(--indent) pe-2 text-start text-sm/[1.35] outline-none focus-visible:ring-2",
                      active && "bg-primary/12",
                    )}
                    style={{ "--indent": `${26 + (h.depth - 1) * 10}px` }}
                  >
                    {active && (
                      <Check
                        aria-hidden
                        className="text-primary-text absolute start-2 top-2 size-3.5"
                      />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 wrap-anywhere",
                        active ? "font-semibold" : "font-medium",
                        HEAD[h.depth],
                      )}
                    >
                      {h.title}
                    </span>
                    {h.bullets > 0 && (
                      <span className="bg-muted text-label rounded px-1 text-xs tabular-nums">
                        {h.bullets}
                      </span>
                    )}
                    <span className="text-label text-xs tabular-nums">{h.line}</span>
                  </button>
                );
              })}
            </nav>
          </PopoverContent>
        </Popover>
        <ConfirmDeleteButton
          label={`${displayPath} (${SCOPE_LABEL[scope]})`}
          header
          onConfirm={onDelete}
        />
      </div>
      {edit?.failed && (
        <div className="flex flex-none flex-wrap items-center gap-2 px-3 pb-2">
          <p role="status" className="text-warn-text min-w-0 flex-1 text-sm/relaxed wrap-anywhere">
            Could not save the lesson. Your draft is still here.
          </p>
          <Button size="sm" variant="outline" onClick={() => void saveLesson(key)}>
            Retry save
          </Button>
        </div>
      )}
      <div className="border-border/60 flex flex-none flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-3 pb-1.5">
        <Segmented
          label="Lesson view mode"
          animateIndicator={false}
          value={effectiveView}
          className="[&_[role=radio]]:text-sm"
          items={viewItems}
          onChange={(v) => switchView(v)}
        />
        <span className="text-muted-foreground text-ui shrink-0 whitespace-nowrap tabular-nums">
          {effectiveView === "read"
            ? `${heads.length} ${heads.length === 1 ? "section" : "sections"}`
            : effectiveView === "edit"
              ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}`
              : `${news?.hunks.length ?? 0} ${news?.hunks.length === 1 ? "change" : "changes"}`}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {effectiveView === "changes" && news ? (
          <LessonChanges
            news={news}
            goTo={goTo}
            onRead={() => (markRead(key), switchView(preferredView, undefined, false))}
          />
        ) : effectiveView === "read" ? (
          <div
            ref={readScroller}
            onScroll={(e) => setActiveLine(findVisibleLine(e.currentTarget))}
            className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
          >
            <LessonMarkdownView text={text} onJumpEdit={goTo} />
          </div>
        ) : (
          <div
            ref={editScroller}
            onScroll={(e) => setActiveLine(findVisibleLine(e.currentTarget))}
            className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-1"
          >
            {/* the painted copy sets the height and draws the words; the textarea over it takes the typing, its own words see-through */}
            <div className="focus-within:ring-ring relative mx-auto grid w-full max-w-[42rem] grid-cols-[minmax(0,1fr)] rounded-md focus-within:ring-2 focus-within:ring-inset">
              <pre
                ref={painted}
                aria-hidden
                className={cn(TEXT, "text-foreground col-start-1 row-start-1 m-0")}
              >
                {lines.map((l, i) => (
                  <span
                    key={i}
                    data-line={i + 1}
                    className={cn(
                      i < frontEnd && "text-muted-foreground",
                      depthAt.has(i + 1) && HEAD[depthAt.get(i + 1)!],
                    )}
                  >
                    {l}
                    {"\n"}
                  </span>
                ))}{" "}
              </pre>
              <textarea
                ref={area}
                aria-label={`${displayPath} (${SCOPE_LABEL[scope]}), the lesson's words`}
                spellCheck={false}
                value={text}
                onChange={(e) => typeLesson(key, e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className={cn(
                  TEXT,
                  "caret-foreground selection:bg-primary/30 col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent text-transparent outline-none",
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
