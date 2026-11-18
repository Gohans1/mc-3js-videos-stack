import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Search,
} from "lucide-react";
import { type CSSProperties, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { Segmented } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { ConfirmDeleteButton, SCOPE_LABEL } from "./lesson-ui";
import { type LessonFile, type LessonScope, type LessonScopeFilter, loadLessons } from "./lessons";
import { parseLessonHeadings } from "./markdown";
import { NewLessonForm } from "./NewLessonForm";
import {
  emptyAreaFoldTarget,
  lessonCardOffsets,
  type LessonColumn,
  type LessonColumnEntry,
  type LessonDeckLayout,
  type LessonTrail,
  resolveDirClick,
} from "./tree";

const FOLD_BLOCKED_SELECTOR =
  "button, a, input, textarea, select, form, header, li, [data-slot='empty'], [role='button'], [role='radio'], [role='radiogroup'], [role='dialog']";

/** Fold back only when clicking genuinely empty blank space below rows/empty-state, never gutters, gaps, or scrollbars. */
export const shouldFoldBlankAreaClick = ({
  detail,
  target,
  section,
  list,
  clientX,
  clientY,
}: {
  detail: number;
  target: EventTarget | null;
  section: HTMLElement | null;
  list: HTMLElement | null;
  clientX: number;
  clientY: number;
}): boolean => {
  if (detail === 0 || !(target instanceof Element) || !section) return false;
  if (target.closest(FOLD_BLOCKED_SELECTOR)) return false;

  if (list) {
    const listRect = list.getBoundingClientRect();
    if (clientX < listRect.left || clientX >= listRect.left + list.clientWidth) return false;
    if (clientY < listRect.top) return false;
    const lastRow = list.lastElementChild;
    if (lastRow) {
      return clientY > lastRow.getBoundingClientRect().bottom;
    }
    return clientY > listRect.top;
  }

  const empty = section.querySelector("[data-slot='empty']");
  if (empty) {
    return clientY > empty.getBoundingClientRect().bottom;
  }
  const header = section.querySelector("header");
  if (header) {
    return clientY > header.getBoundingClientRect().bottom;
  }
  return clientY >= section.getBoundingClientRect().top;
};

/** One Miller deck column holding folder/file rows, header, root filter/search, and empty-area fold click. */
export function LessonColumnView({
  col,
  idx,
  totalCols,
  trail,
  layout,
  activeOpen,
  loaded,
  loadFailed,
  isSearching,
  query,
  setQuery,
  hasProject,
  filesCount,
  filmCount,
  allCount,
  scopedFilesCount,
  activeFilter,
  onChangeFilter,
  showFormHere,
  onToggleForm,
  openForm,
  closeForm,
  nameInputRef,
  newScope,
  setNewScope,
  naming,
  setNaming,
  submitted,
  openExisting,
  setSubmitted,
  errMsg,
  onCreateLesson,
  matchByKey,
  onFocusFolder,
  onFoldTo,
  onSelectDir,
  onSelectFile,
  onDeleteFile,
}: {
  col: LessonColumn;
  idx: number;
  totalCols: number;
  trail: LessonTrail;
  layout: LessonDeckLayout;
  activeOpen: string | null;
  loaded: boolean;
  loadFailed?: boolean;
  isSearching: boolean;
  query: string;
  setQuery: (q: string) => void;
  hasProject: boolean;
  filesCount: number;
  filmCount: number;
  allCount: number;
  scopedFilesCount: number;
  activeFilter: LessonScopeFilter;
  onChangeFilter: (next: LessonScopeFilter) => void;
  showFormHere: boolean;
  onToggleForm: () => void;
  openForm: (scope?: LessonScope, depth?: number, prefixParts?: readonly string[]) => void;
  closeForm: () => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  newScope: LessonScope;
  setNewScope: (s: LessonScope) => void;
  naming: string | null;
  setNaming: (v: string) => void;
  submitted: boolean;
  openExisting?: boolean;
  setSubmitted: (b: boolean) => void;
  errMsg: string | null;
  onCreateLesson: () => void;
  matchByKey: Map<string, { matchLine: number | null; snippet: string | null }>;
  onFocusFolder: (parts: readonly string[], animate: boolean) => void;
  onFoldTo: (parts: readonly string[], animate: boolean) => void;
  onSelectDir: (parts: readonly string[], animate: boolean) => void;
  onSelectFile: (key: string, line: number | null, animate: boolean) => void;
  onDeleteFile: (key: string) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isLeafList = !activeOpen && idx === totalCols - 1;
  const isSideColumn = Boolean(activeOpen) || !isLeafList;
  const isSoleColumn = !activeOpen && totalCols === 1;
  const showDeeperBackCue = layout.showAncestors && !isLeafList;
  const showRootControls = col.depth === 0;
  const compactControls = isSideColumn || layout.mode !== "desktop-stack";
  const sideWidthClass = layout.stickyStepPx === 24 ? "w-44" : "w-48";
  const offsets = lessonCardOffsets(idx, layout);
  const stepped = layout.showAncestors && idx > 0 && layout.mode !== "compact-file";
  const parentParts = col.parts.slice(0, -1);
  const parentName = parentParts.at(-1) ?? "lessons";
  const scopeOptions = [
    { value: "both" as const, label: `All (${filesCount})` },
    { value: "film" as const, label: `This film (${filmCount})` },
    { value: "all" as const, label: `Every film (${allCount})` },
  ];

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      data-lessons-col={col.key}
      aria-label={col.title}
      onClick={(e) => {
        if (
          !shouldFoldBlankAreaClick({
            detail: e.detail,
            target: e.target,
            section: sectionRef.current,
            list: listRef.current,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        ) {
          return;
        }
        const foldTo = emptyAreaFoldTarget(trail, col.depth, isSearching);
        if (!foldTo) return;
        onFoldTo(foldTo, true);
      }}
      style={
        isSoleColumn || !layout.showAncestors
          ? undefined
          : ({
              "--deck-left": `${offsets.stickyLeftPx}px`,
              "--deck-top": stepped ? `${offsets.stepTopPx}px` : "0px",
              "--deck-z": String(idx + 1),
            } as CSSProperties)
      }
      className={cn(
        "flex min-h-0 flex-col self-stretch",
        isSoleColumn
          ? "min-w-0 flex-1"
          : isSideColumn
            ? cn(
                "sticky left-(--deck-left) z-(--deck-z) mt-(--deck-top) flex-none @max-[19rem]/lesson-deck:hidden",
                sideWidthClass,
              )
            : "z-(--deck-z) mt-(--deck-top) min-w-64 flex-1 @max-[19rem]/lesson-deck:mt-0 @max-[19rem]/lesson-deck:min-w-0",
        col.depth % 2 === 1 ? "bg-card" : "bg-background",
        stepped &&
          "shadow-sheet rounded-ss-xl border-s border-t @max-[19rem]/lesson-deck:rounded-none @max-[19rem]/lesson-deck:border-0 @max-[19rem]/lesson-deck:shadow-none",
        stepped && (isLeafList ? "border-primary/45" : "border-border/85"),
        !stepped && !isSoleColumn && "border-border/80 border-e",
      )}
    >
      <header className="border-border/60 flex min-h-10 flex-none items-center gap-1.5 border-b px-2.5 py-1">
        {col.depth > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Back to ${parentName}`}
            title={`Back to ${parentName}`}
            onClick={(e) => onFoldTo(parentParts, e.detail > 0)}
          >
            <ChevronLeft aria-hidden />
          </Button>
        )}
        {showDeeperBackCue ? (
          <button
            type="button"
            onClick={(e) => onFocusFolder(col.parts, e.detail > 0)}
            title={`Focus folder ${col.title}`}
            className="text-foreground hover:bg-muted/70 focus-visible:ring-ring studio-press text-title/[1.3] min-w-0 flex-1 rounded px-1.5 py-0.5 text-start font-semibold wrap-anywhere outline-none focus-visible:ring-2"
          >
            {col.title}
          </button>
        ) : (
          <span className="text-foreground text-title/[1.3] min-w-0 flex-1 font-semibold wrap-anywhere">
            {col.title}
          </span>
        )}
        {!isSearching &&
          (isSoleColumn ? (
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={showFormHere}
              data-new-lesson
              onClick={onToggleForm}
            >
              <Plus aria-hidden data-icon="inline-start" />
              New
            </Button>
          ) : (
            idx === totalCols - 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={col.parts.length ? `New lesson in ${col.parts.join("/")}` : "New lesson"}
                aria-label={
                  col.parts.length ? `New lesson in ${col.parts.join("/")}` : "New lesson"
                }
                aria-expanded={showFormHere}
                data-new-lesson
                onClick={onToggleForm}
              >
                <Plus aria-hidden />
              </Button>
            )
          ))}
      </header>

      {showRootControls && (hasProject || filmCount > 0) && (
        <div className="flex-none px-2.5 pt-2 pb-1">
          {!compactControls && (
            <Segmented<LessonScopeFilter>
              label="Filter lessons by scope"
              animateIndicator={false}
              value={activeFilter}
              className="tabular-nums @max-[19rem]/lesson-deck:hidden [&_[role=radio]]:text-sm"
              items={scopeOptions.map(({ value, label }) => ({ id: value, title: label }))}
              onChange={onChangeFilter}
            />
          )}
          <div
            className={cn(
              "tabular-nums",
              !compactControls && "hidden @max-[19rem]/lesson-deck:block",
            )}
          >
            <Select
              value={activeFilter}
              items={scopeOptions}
              onValueChange={(value) => {
                if (value) onChangeFilter(value);
              }}
            >
              <SelectTrigger
                aria-label="Filter lessons by scope"
                size="readable"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} finalFocus motion="instant">
                <SelectGroup>
                  {scopeOptions.map(({ value, label }) => (
                    <SelectItem key={value} value={value} size="readable">
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {showRootControls && scopedFilesCount > 0 && (
        <div className="flex-none px-2.5 pb-1.5">
          <SearchBox
            name="lessons-search"
            value={query}
            onChange={setQuery}
            label="Search lessons"
            placeholder={`Search ${scopedFilesCount} ${scopedFilesCount === 1 ? "lesson" : "lessons"}…`}
            className="[&_input]:tabular-nums pointer-fine:[&_input]:text-sm"
          />
          <p role="status" className="sr-only">
            {isSearching &&
              (col.entries.length
                ? `${col.entries.length} matching ${col.entries.length === 1 ? "lesson" : "lessons"}`
                : "No matching lessons")}
          </p>
        </div>
      )}

      {showFormHere && (
        <NewLessonForm
          nameInputRef={nameInputRef}
          hasProject={hasProject}
          newScope={newScope}
          setNewScope={setNewScope}
          naming={naming ?? ""}
          setNaming={(val) => {
            setNaming(val);
            if (submitted) setSubmitted(false);
          }}
          showErr={submitted && !!errMsg}
          openExisting={openExisting}
          errMsg={errMsg}
          compact={compactControls}
          onSubmit={onCreateLesson}
          onClose={closeForm}
        />
      )}

      {col.depth === 0 && loadFailed && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <p role="status" className="text-warn-text text-sm/relaxed">
            {loaded ? "Could not refresh lessons." : "Could not load lessons."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              sectionRef.current?.focus({ preventScroll: true });
              void loadLessons();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {col.depth === 0 && !loaded && !loadFailed && (
        <p role="status" className="text-muted-foreground px-3 py-4 text-sm">
          Loading lessons…
        </p>
      )}

      {col.depth === 0 && loaded && !scopedFilesCount && naming === null && (
        <div className="min-h-0 flex-1 px-3 py-4">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenText aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {activeFilter === "film"
                  ? "No lessons for this film yet"
                  : activeFilter === "all" && filesCount > 0
                    ? "No lessons shared across films yet"
                    : "No lessons yet"}
              </EmptyTitle>
              <EmptyDescription>
                {activeFilter === "film"
                  ? "Create a lesson for this film or select All to see lessons from both scopes."
                  : "Create a lesson or use Remember on a note to turn it into a lesson."}
              </EmptyDescription>
            </EmptyHeader>
            {activeFilter === "film" && hasProject && (
              <EmptyContent>
                <Button
                  variant="secondary"
                  size="md"
                  data-new-lesson
                  onClick={() => openForm("film")}
                >
                  New film lesson
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </div>
      )}

      {col.depth === 0 &&
        loaded &&
        scopedFilesCount > 0 &&
        isSearching &&
        col.entries.length === 0 && (
          <div className="min-h-0 flex-1 px-3 py-4">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No matching lessons</EmptyTitle>
                <EmptyDescription className="max-w-full min-w-0 wrap-anywhere">
                  Nothing in your lessons matches “{query.trim()}”.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="secondary" size="md" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        )}

      {col.entries.length > 0 && (
        <ul
          ref={listRef}
          aria-label={col.title}
          data-arrow-scroll
          className="scroll-fade min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1.5 pb-2"
        >
          {col.entries.map((entry) => (
            <LessonColumnRow
              key={entry.key}
              entry={entry}
              isActive={col.activeEntryKey === entry.key}
              compact={compactControls}
              matchMeta={entry.kind === "file" ? (matchByKey.get(entry.file.key) ?? null) : null}
              onSelectDir={(dirParts, animate) =>
                onSelectDir(resolveDirClick(trail, col.depth, dirParts), animate)
              }
              onSelectFile={onSelectFile}
              onDeleteFile={onDeleteFile}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One folder or file row inside a Miller deck column. */
export function LessonColumnRow({
  entry,
  isActive,
  compact,
  matchMeta,
  onSelectDir,
  onSelectFile,
  onDeleteFile,
}: {
  entry: LessonColumnEntry;
  isActive: boolean;
  compact: boolean;
  matchMeta: { matchLine: number | null; snippet: string | null } | null;
  onSelectDir: (parts: readonly string[], animate: boolean) => void;
  onSelectFile: (key: string, line: number | null, animate: boolean) => void;
  onDeleteFile: (key: string) => void;
}) {
  if (entry.kind === "dir") {
    return (
      <li data-ai-lit={entry.isLit || undefined}>
        <button
          type="button"
          data-lesson-row={entry.key}
          aria-current={isActive ? "true" : undefined}
          onClick={(e) => onSelectDir(entry.parts, e.detail > 0)}
          className={cn(
            "focus-visible:ring-ring studio-press group flex w-full items-center gap-2 text-start outline-none focus-visible:ring-2",
            "px-2.5 py-2 pointer-coarse:py-3",
            isActive
              ? "bg-primary/14 border-primary/55 text-foreground ms-1 w-[calc(100%-0.25rem)] rounded-s-lg rounded-e-none border border-e-0 font-semibold"
              : "hover:bg-muted/80 text-foreground rounded-lg",
          )}
        >
          {isActive ? (
            <FolderOpen
              aria-hidden
              size={16}
              strokeWidth={2}
              absoluteStrokeWidth
              className="text-primary flex-none"
            />
          ) : (
            <Folder
              aria-hidden
              size={16}
              strokeWidth={1.5}
              absoluteStrokeWidth
              className="text-muted-foreground flex-none"
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 wrap-anywhere",
              compact ? "text-sm/[1.35]" : "text-base/[1.35]",
              isActive ? "font-semibold" : "font-medium",
            )}
          >
            {entry.name}
          </span>
          {entry.hasChanged && <span className="text-primary-text text-xs">Updated</span>}
          {entry.hasDraft && <span className="text-warn-text text-xs">Draft</span>}
          <span className="text-muted-foreground text-xs tabular-nums">
            {entry.fileCount}
            <span className="sr-only"> {entry.fileCount === 1 ? "lesson" : "lessons"}</span>
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 flex-none",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          />
        </button>
      </li>
    );
  }

  const f: LessonFile = entry.file;
  const heads = parseLessonHeadings(f.text);
  const rules = heads.reduce((n, h) => n + h.bullets, 0);
  const label = matchMeta ? f.path.slice(0, -3) : entry.name.slice(0, -3);

  return (
    <li
      data-ai-lit={entry.isLit || undefined}
      className={cn(
        "group/row flex w-full items-center transition-colors",
        isActive
          ? "bg-primary/14 border-primary/55 ms-1 w-[calc(100%-0.25rem)] rounded-s-lg rounded-e-none border border-e-0"
          : "hover:bg-muted rounded-lg",
      )}
    >
      <button
        type="button"
        data-lesson-row={entry.key}
        aria-current={isActive ? "true" : undefined}
        onClick={(e) => onSelectFile(f.key, matchMeta?.matchLine ?? null, e.detail > 0)}
        className="focus-visible:ring-ring studio-press flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 ps-2.5 pe-1 text-start outline-none focus-visible:ring-2 pointer-coarse:py-3"
      >
        <FileText
          aria-hidden
          size={16}
          strokeWidth={isActive ? 2 : 1.5}
          absoluteStrokeWidth
          className={cn("flex-none", isActive ? "text-primary" : "text-muted-foreground")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span
              className={cn(
                "text-foreground min-w-0 text-balance wrap-anywhere",
                compact ? "text-sm/[1.4]" : "text-base/[1.4]",
                isActive ? "font-semibold" : "font-medium",
              )}
            >
              {label}
            </span>
            <Badge variant={f.scope === "film" ? "lessonFilm" : "lessonAll"} className="flex-none">
              {SCOPE_LABEL[f.scope]}
            </Badge>
          </span>
          {!compact && (
            <span className="text-label text-ui/[1.4] mt-0.5 block truncate tabular-nums">
              {heads.length} {heads.length === 1 ? "section" : "sections"}
              {rules > 0 && ` · ${rules} ${rules === 1 ? "rule" : "rules"}`}
            </span>
          )}
          {entry.isChanged && (
            <span className="text-primary-text mt-0.5 block text-xs">Updated</span>
          )}
          {entry.isDraft && <span className="text-warn-text mt-0.5 block text-xs">Draft</span>}
          {matchMeta?.snippet && (
            <span className="text-primary-text text-ui/[1.45] mt-0.5 block wrap-anywhere tabular-nums">
              L{matchMeta.matchLine}: {matchMeta.snippet}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 flex-none", isActive ? "text-primary" : "text-muted-foreground")}
        />
      </button>
      <ConfirmDeleteButton
        label={`${f.path} (${SCOPE_LABEL[f.scope]})`}
        revealOnRowHover
        onConfirm={() => onDeleteFile(f.key)}
      />
    </li>
  );
}
