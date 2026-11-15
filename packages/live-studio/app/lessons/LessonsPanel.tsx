// The Lessons tab: every lesson file the AI reads before it fixes a note (lessons/*.md at the repo root, shared by every film),
// bringing md-phone's reading/editing feel: Read view with GFM markdown & safe links, painted level-colored editor synced by line,
// Contents outline with bullet counts + clamped eased flyTo, diacritic-insensitive search, clickable diffs, and conflict alerts.
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Eye,
  GitCompare,
  ListTree,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useActivity, useLit } from "../activity/activity";
import { SaveStatus, Segmented } from "../components/inspector";
import { TabStage } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { VirtualList } from "../components/VirtualList";
import { lessonChanges } from "./changes";
import { LessonMarkdownView } from "./LessonMarkdownView";
import {
  keepMine,
  LESSON_NAME,
  lessons,
  type LessonViewMode,
  loadLessons,
  markRead,
  newLesson,
  openLesson,
  setLessonView,
  takePick,
  takeTheirs,
  typeLesson,
  useLessons,
} from "./lessons";
import { filterLessons, findActiveHeading, parseLessonHeadings } from "./markdown";
import { flyTo } from "./motion";

// md-phone's heading colours, one per level (index.css --color-md-h*)
const HEAD = [
  "",
  "text-md-h1",
  "text-md-h2",
  "text-md-h3",
  "text-md-h4",
  "text-md-h5",
  "text-md-h6",
];
const TEXT = "font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere [tab-size:4] p-3";

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

// The AI may write a lesson any moment (bun run note learned): coming back to the page reads them again
const useFresh = () =>
  useEffect(() => {
    void loadLessons();
    const again = () => document.visibilityState === "visible" && void loadLessons();
    addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

export function LessonsPanel() {
  useFresh();
  const open = useLessons((s) => s.open);
  const [jumpTarget, setJumpTarget] = useState<{ path: string; line: number } | null>(null);
  const initialLine = jumpTarget && jumpTarget.path === open ? jumpTarget.line : null;
  return (
    <TabStage
      activeKey={open ? "file" : "list"}
      order={["list", "file"]}
      distance={18}
      duration={200}
      className="flex min-h-0 flex-1 flex-col"
    >
      {open ? (
        <LessonFileView key={open} path={open} initialLine={initialLine} />
      ) : (
        <LessonList
          onOpen={(path, matchLine) => {
            setJumpTarget(matchLine ? { path, line: matchLine } : null);
            openLesson(path);
          }}
        />
      )}
    </TabStage>
  );
}

function LessonList({ onOpen }: { onOpen: (path: string, matchLine: number | null) => void }) {
  const { files, loaded, seen, edits } = useLessons((s) => s),
    lit = useActivity((s) => s.lit);
  const [naming, setNaming] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [query, setQuery] = useState("");
  const hintId = useId(),
    errId = useId();
  const newBtnRef = useRef<HTMLButtonElement>(null),
    nameInputRef = useRef<HTMLInputElement>(null);
  const trimmed = naming?.trim() ?? "";
  const errMsg = !trimmed
    ? "Enter a topic name first."
    : !LESSON_NAME.test(trimmed)
      ? "Letters, digits, - and _ only; / for a folder"
      : null;
  const showErr = submitted && !!errMsg;
  const openForm = () => {
    setSubmitted(false);
    setNaming("");
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };
  const closeForm = (restoreFocus = false) => {
    setNaming(null);
    setSubmitted(false);
    if (restoreFocus) requestAnimationFrame(() => newBtnRef.current?.focus());
  };
  const create = () => {
    if (errMsg) {
      setSubmitted(true);
      nameInputRef.current?.focus();
      return;
    }
    closeForm();
    newLesson(trimmed);
  };
  const filtered = useMemo(() => filterLessons(files, query), [files, query]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-start gap-2 px-3 pt-2 pb-1">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-relaxed text-pretty">
          What the AI reads before it fixes a note, for every film. AI edits stay highlighted until
          marked read.
        </p>
        <Button
          ref={newBtnRef}
          variant="secondary"
          size="md"
          aria-expanded={naming !== null}
          onClick={() => (naming === null ? openForm() : closeForm())}
        >
          <Plus aria-hidden data-icon="inline-start" />
          New
        </Button>
      </div>
      {files.length > 0 && (
        <div className="px-3 pb-1.5">
          <SearchBox
            name="lessons-search"
            value={query}
            onChange={setQuery}
            label="Search lessons"
            placeholder={`Search ${files.length} ${files.length === 1 ? "lesson" : "lessons"}…`}
          />
        </div>
      )}
      <div
        aria-hidden={naming === null}
        inert={naming === null}
        className={cn(
          "grid flex-none transition-all duration-150 ease-out motion-reduce:transition-none",
          naming !== null ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <form
            noValidate
            className="px-3 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <Field data-invalid={showErr || undefined}>
              <div className="flex gap-1.5">
                <Input
                  ref={nameInputRef}
                  aria-label="New lesson file's name"
                  aria-invalid={showErr || undefined}
                  aria-describedby={showErr ? `${hintId} ${errId}` : hintId}
                  placeholder="camera or craft/walk"
                  value={naming ?? ""}
                  onChange={(e) => {
                    setNaming(e.target.value);
                    if (submitted) setSubmitted(false);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") closeForm(true);
                  }}
                />
                <Button type="submit" size="md">
                  Create
                </Button>
              </div>
              <FieldDescription id={hintId}>
                One file per topic: a rule joins its topic's file.
              </FieldDescription>
              {showErr && <FieldError id={errId}>{errMsg}</FieldError>}
            </Field>
          </form>
        </div>
      </div>
      {!loaded && <p className="text-muted-foreground px-3 py-4 text-xs">Reading the lessons…</p>}
      {loaded && !files.length && naming === null && (
        <div className="min-h-0 flex-1 px-3 py-4">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenText aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No lessons yet</EmptyTitle>
              <EmptyDescription>
                The AI writes one when you ask it to Remember a note, or start one with New.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
      {loaded && files.length > 0 && filtered.length === 0 && (
        <div className="min-h-0 flex-1 px-3 py-4">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No matching lessons</EmptyTitle>
              <EmptyDescription>Nothing in your lessons matches “{query.trim()}”.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                Show all lessons
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )}
      {filtered.length > 0 && (
        <VirtualList
          items={filtered}
          getKey={({ file }) => file.path}
          estimateSize={(i) => (filtered[i]?.snippet ? 68 : 52)}
          role="list"
          ariaLabel="Lesson files"
          className="scroll-fade px-1.5 pb-2"
          itemClassName="py-0.5"
          renderItem={({ file: f, matchLine, snippet }) => {
            const heads = parseLessonHeadings(f.text);
            const rules = heads.reduce((n, h) => n + h.bullets, 0);
            const news = seen[f.path] && seen[f.path]!.tag !== f.tag;
            const draft = !!edits[f.path];
            return (
              <button
                type="button"
                data-ai-lit={`lesson:${f.path}` in lit || undefined}
                onClick={() => onOpen(f.path, matchLine)}
                className="hover:bg-muted focus-visible:ring-ring studio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 pointer-coarse:py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ui text-foreground block truncate font-medium">
                    {f.path.slice(0, -3)}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs tabular-nums">
                    {heads.length} {heads.length === 1 ? "section" : "sections"}
                    {rules > 0 && ` · ${rules} ${rules === 1 ? "rule" : "rules"}`}
                    {draft && " · unsaved words"}
                  </span>
                  {snippet && (
                    <span className="text-primary-text mt-0.5 block truncate text-xs">
                      L{matchLine}: {snippet}
                    </span>
                  )}
                </span>
                {news && (
                  <span className="text-primary flex flex-none items-center gap-1 text-xs font-medium">
                    <span aria-hidden className="bg-primary size-1.5 rounded-full" />
                    Changed
                  </span>
                )}
                <ChevronRight aria-hidden className="text-muted-foreground/60 size-3.5 flex-none" />
              </button>
            );
          }}
        />
      )}
    </div>
  );
}

function LessonFileView({ path, initialLine }: { path: string; initialLine: number | null }) {
  const file = useLessons((s) => s.files.find((f) => f.path === path)),
    edit = useLessons((s) => s.edits[path]),
    seen = useLessons((s) => s.seen[path]),
    dir = useLessons((s) => s.dir),
    storedView = useLessons((s) => s.viewByPath[path]),
    lit = useLit(`lesson:${path}`);
  const text = edit?.text ?? file?.text ?? "";
  const news = useMemo(
    () => (file && seen && seen.tag !== file.tag ? lessonChanges(seen.text, file.text) : null),
    [file, seen],
  );
  const view: LessonViewMode =
    storedView ??
    (lessons.getState().pick?.path === path || edit?.conflict
      ? "edit"
      : news?.hunks.length && !initialLine
        ? "changes"
        : "read");
  const [contentsOpen, setContentsOpen] = useState(false);
  const [activeLine, setActiveLine] = useState(1);

  const area = useRef<HTMLTextAreaElement>(null),
    painted = useRef<HTMLPreElement>(null),
    readScroller = useRef<HTMLDivElement>(null),
    editScroller = useRef<HTMLDivElement>(null),
    flyStop = useRef<(() => void) | null>(null);

  const heads = useMemo(() => parseLessonHeadings(text), [text]);
  const lines = useMemo(() => text.split("\n"), [text]);
  const frontEnd = useMemo(() => {
    if (lines[0]?.trimEnd() !== "---") return 0;
    const end = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(l));
    return end === -1 ? 0 : end + 1;
  }, [lines]);
  const depthAt = useMemo(() => new Map(heads.map((h) => [h.line, h.depth])), [heads]);
  const activeHeadLine = useMemo(() => findActiveHeading(heads, activeLine), [heads, activeLine]);

  // Clean up any running flyTo scroll animation on unmount or file switch
  useEffect(() => () => flyStop.current?.(), []);

  // A file just created via New picks its template heading immediately in Edit mode
  useEffect(() => {
    const picked = takePick(path);
    if (picked) {
      setLessonView(path, "edit");
      area.current?.focus({ preventScroll: true });
      area.current?.setSelectionRange(picked[0], picked[1]);
    } else if (initialLine && initialLine > 1) {
      requestAnimationFrame(() => {
        flyStop.current?.();
        flyStop.current = scrollScrollerToLine(readScroller.current, initialLine, false);
        setActiveLine(initialLine);
      });
    }
  }, [path, initialLine]);

  const activeScroller = () => (view === "edit" ? editScroller.current : readScroller.current);

  const switchView = (next: LessonViewMode, jumpLine?: number) => {
    if (next === view && jumpLine === undefined) return;
    flyStop.current?.();
    const keepLine =
      jumpLine ?? (view !== "changes" ? findVisibleLine(activeScroller()) : activeLine);
    setLessonView(path, next);
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

  const flyToHeading = (line: number) => {
    setContentsOpen(false);
    setActiveLine(line);
    if (view === "changes") {
      switchView("read", line);
      return;
    }
    flyStop.current?.();
    flyStop.current = scrollScrollerToLine(activeScroller(), line, true);
  };

  const flyEdge = (toBottom: boolean) => {
    setContentsOpen(false);
    const scroller = activeScroller();
    if (!scroller) return;
    flyStop.current?.();
    flyStop.current = flyTo(scroller, toBottom ? scroller.scrollHeight : 0);
  };

  const goTo = (line: number) => switchView("edit", line);

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

  const effectiveView: LessonViewMode = view === "changes" && !news ? "read" : view;
  const viewItems: { id: LessonViewMode; title: React.ReactNode }[] = [
    {
      id: "read",
      title: (
        <span className="inline-flex items-center gap-1">
          <Eye aria-hidden className="size-3" />
          Read
        </span>
      ),
    },
    {
      id: "edit",
      title: (
        <span className="inline-flex items-center gap-1">
          <Pencil aria-hidden className="size-3" />
          Edit
        </span>
      ),
    },
    ...(news
      ? [
          {
            id: "changes" as const,
            title: (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <GitCompare aria-hidden className="size-3" />
                <span className="text-ok">+{news.added}</span>
                <span className="text-destructive">−{news.removed}</span>
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
        className="flex flex-none items-center gap-1 rounded-md px-1.5 py-1"
      >
        <Button
          variant="ghost"
          size="icon-lg"
          title="Back to lessons"
          aria-label="Back to the lessons"
          onClick={() => openLesson(null)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-ui text-foreground truncate font-medium">{path}</div>
          <div className="text-muted-foreground truncate text-xs" title={`${dir}/${path}`}>
            {edit?.conflict ? (
              <span className="text-warn font-semibold">Not saved: the AI changed it</span>
            ) : edit?.failed ? (
              <span className="text-warn font-semibold">Not saved: {edit.failed}</span>
            ) : (
              <SaveStatus state={edit ? "busy" : null} idleText="Saved" />
            )}
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
          <PopoverContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
            <div className="border-border/80 mb-1.5 flex items-center justify-between gap-1 border-b pb-1.5">
              <span className="text-muted-foreground px-1 text-xs font-medium">
                Contents ({heads.length})
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="xs" onClick={() => flyEdge(false)}>
                  <ArrowUp aria-hidden data-icon="inline-start" />
                  Top
                </Button>
                <Button variant="ghost" size="xs" onClick={() => flyEdge(true)}>
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
                    onClick={() => flyToHeading(h.line)}
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring flex w-full items-baseline gap-2 rounded-sm py-1.5 ps-(--indent) pe-2 text-left text-xs outline-none focus-visible:ring-2",
                      active && "bg-tint ring-primary/35 ring-1 ring-inset",
                    )}
                    style={{ "--indent": `${8 + (h.depth - 1) * 10}px` }}
                  >
                    <span className={cn("min-w-0 flex-1 truncate font-medium", HEAD[h.depth])}>
                      {h.title}
                    </span>
                    {h.bullets > 0 && (
                      <span className="bg-muted text-muted-foreground/80 rounded px-1 text-xs tabular-nums">
                        {h.bullets}
                      </span>
                    )}
                    <span className="text-muted-foreground tabular-nums">{h.line}</span>
                  </button>
                );
              })}
            </nav>
          </PopoverContent>
        </Popover>
      </div>
      <div className="border-border/60 flex flex-none items-center justify-between gap-2 border-b px-3 pb-1.5">
        <Segmented
          label="Lesson view mode"
          value={effectiveView}
          items={viewItems}
          onChange={(v) => switchView(v)}
        />
        <span className="text-muted-foreground text-xs tabular-nums">
          {effectiveView === "read"
            ? `${heads.length} ${heads.length === 1 ? "section" : "sections"}`
            : effectiveView === "edit"
              ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}`
              : `${news?.hunks.length ?? 0} ${news?.hunks.length === 1 ? "change" : "changes"}`}
        </span>
      </div>
      {edit?.conflict && (
        <Alert variant="warn" className="mx-3 mt-2 flex-none">
          <TriangleAlert aria-hidden />
          <AlertTitle>File changed externally</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <span>
                The AI changed this file while you were writing. Keep one version: the other is
                lost.
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="md" onClick={() => keepMine(path)}>
                  Keep mine
                </Button>
                <Button variant="secondary" size="md" onClick={() => takeTheirs(path)}>
                  {edit.conflict.text === null
                    ? "Drop mine (the file was deleted)"
                    : "Use the AI's"}
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <TabStage
        activeKey={effectiveView}
        order={["read", "edit", "changes"]}
        distance={10}
        duration={165}
        className="flex min-h-0 flex-1 flex-col"
      >
        {effectiveView === "changes" && news ? (
          <Changes news={news} goTo={goTo} onRead={() => (markRead(path), switchView("read"))} />
        ) : effectiveView === "read" ? (
          <div
            ref={readScroller}
            onScroll={(e) => setActiveLine(findVisibleLine(e.currentTarget))}
            className="scroll-fade min-h-0 flex-1 overflow-y-auto px-3 py-3"
          >
            <LessonMarkdownView text={text} onJumpEdit={goTo} />
          </div>
        ) : (
          <div
            ref={editScroller}
            onScroll={(e) => setActiveLine(findVisibleLine(e.currentTarget))}
            className="scroll-fade min-h-0 flex-1 overflow-y-auto"
          >
            {/* the painted copy sets the height and draws the words; the textarea over it takes the typing, its own words see-through */}
            <div className="focus-within:ring-ring relative grid rounded-md focus-within:ring-2 focus-within:ring-inset">
              <pre
                ref={painted}
                aria-hidden
                className={cn(TEXT, "text-foreground/90 col-start-1 row-start-1 m-0")}
              >
                {lines.map((l, i) => (
                  <span
                    key={i}
                    data-line={i + 1}
                    className={cn(
                      i < frontEnd && "text-muted-foreground",
                      depthAt.has(i + 1) && ["font-semibold", HEAD[depthAt.get(i + 1)!]],
                    )}
                  >
                    {l}
                    {"\n"}
                  </span>
                ))}{" "}
              </pre>
              <textarea
                ref={area}
                aria-label={`${path}, the lesson's words`}
                spellCheck={false}
                value={text}
                onChange={(e) => typeLesson(path, e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className={cn(
                  TEXT,
                  "caret-foreground selection:bg-primary/30 col-start-1 row-start-1 resize-none overflow-hidden bg-transparent text-transparent outline-none",
                )}
              />
            </div>
          </div>
        )}
      </TabStage>
    </div>
  );
}

function Changes({
  news,
  goTo,
  onRead,
}: {
  news: ReturnType<typeof lessonChanges>;
  goTo: (line: number) => void;
  onRead: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 px-3 pt-2 pb-2">
        <span className="text-muted-foreground flex-1 text-xs">Changed since you last read it</span>
        <Button size="md" onClick={onRead}>
          Mark as read
        </Button>
      </div>
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto pb-2">
        {news.hunks.map((h) => {
          let lineCursor = h.line;
          return (
            <section key={h.line} className="mb-2">
              <button
                type="button"
                onClick={() => goTo(h.line)}
                className="bg-card text-muted-foreground hover:text-foreground focus-visible:ring-ring w-full px-3 py-1.5 text-left text-xs outline-none focus-visible:ring-2"
              >
                Go to line {h.line}
              </button>
              {h.rows.map((r, i) => {
                const targetLine = lineCursor;
                if (r.kind !== "removed") lineCursor++;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goTo(targetLine)}
                    className={cn(
                      "focus-visible:ring-ring flex w-full gap-2 px-3 py-0.5 text-left font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-inset",
                      r.kind === "added" && "bg-ok/12 hover:bg-ok/20",
                      r.kind === "removed" && "bg-destructive/12 hover:bg-destructive/20",
                      r.kind === "same" && "text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <span
                      aria-label={r.kind === "same" ? undefined : r.kind}
                      className={cn(
                        "w-2 flex-none select-none",
                        r.kind === "added" ? "text-ok" : "text-destructive",
                      )}
                    >
                      {r.kind === "added" ? "+" : r.kind === "removed" ? "−" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      {r.parts
                        ? r.parts.map((p, k) =>
                            p.changed ? (
                              <mark
                                key={k}
                                className={cn(
                                  "text-foreground rounded-xs",
                                  r.kind === "added"
                                    ? "bg-ok/35"
                                    : "bg-destructive/35 line-through",
                                )}
                              >
                                {p.text}
                              </mark>
                            ) : (
                              p.text
                            ),
                          )
                        : r.text || " "}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
