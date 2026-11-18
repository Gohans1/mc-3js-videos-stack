import { BookOpen, ChevronUp, FolderOpen, Maximize2, Sparkles } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { S } from "../core/state";
import { studio, useDialogModal } from "../core/store";
import { stopAudition } from "./sound";
import { useVoiceTakes } from "./voice-client";
import { useDubbingJobs } from "./voice-dubbing-client";
import {
  cancelCasting,
  changePlaygroundWorkbenchOpen,
  closeRecordingEditor,
  loadPlaygroundUsage,
  openSpeechComparison,
  type PlaygroundSubTab,
  resetComposerDraft,
  searchLiveSharedVoices,
  setPlaygroundFilters,
  setPlaygroundInlineOpen,
  setPlaygroundSubTab,
  setPlaygroundWorkbenchOpen,
  setWorkbenchMediumTab,
  switchPlaygroundTool,
  useVoicePlayground,
  useVoicePlaygroundSelector,
  voicePlaygroundToast,
} from "./voice-playground-client";
import {
  buildUnifiedEntries,
  DEFAULT_PLAYGROUND_FILTERS,
  filterAndSortEntries,
  topLevelPlaygroundJobs,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import { VoiceDubbingCloud } from "./VoiceDubbingCloud";
import { VoiceDubbingJobs } from "./VoiceDubbingJobs";
import { VoicePlaygroundCompare } from "./VoicePlaygroundCompare";
import { VoicePlaygroundComposer } from "./VoicePlaygroundComposer";
import { VoicePlaygroundDubbing } from "./VoicePlaygroundDubbing";
import { VoicePlaygroundHelp } from "./VoicePlaygroundHelp";
import { VoicePlaygroundInspector } from "./VoicePlaygroundInspector";
import { VoicePlaygroundJobQueue } from "./VoicePlaygroundJobQueue";
import { VoicePlaygroundKeyPopover } from "./VoicePlaygroundKeyPopover";
import { VoicePlaygroundLibrary } from "./VoicePlaygroundLibrary";
import { VoicePlaygroundResults, VoiceRecordingPlayer } from "./VoicePlaygroundResults";
import {
  PLAYGROUND_PAGES,
  type PlaygroundPage,
  VoicePlaygroundSidebar,
} from "./VoicePlaygroundSidebar";
import { type PlaygroundVoicesTab, VoicePlaygroundVoices } from "./VoicePlaygroundVoices";
import { VoiceRegionEditorSurface } from "./VoiceRegionEditor";
import { VoiceSpeechBatch } from "./VoiceSpeechBatch";

function usePlaygroundData(enabled: boolean) {
  const pg = useVoicePlayground(enabled);
  const filmTakes = useVoiceTakes();
  useEffect(() => {
    if (enabled) void loadPlaygroundUsage();
  }, [enabled, filmTakes]);

  const unifiedEntries = useMemo(
    () => buildUnifiedEntries(pg.items, filmTakes, new Set(pg.starredTakeUids), pg.templates ?? []),
    [pg.items, filmTakes, pg.starredTakeUids, pg.templates],
  );

  const selectedEntry: UnifiedPlaygroundEntry | null = useMemo(() => {
    const library = ["library", "inspect"].includes(pg.activeSubTab);
    const candidates = library
      ? filterAndSortEntries(
          unifiedEntries.filter(
            (entry) => pg.filters.source !== "all" || entry.origin !== "template",
          ),
          pg.filters,
        )
      : unifiedEntries.filter(
          (entry) => !entry.playgroundItem?.archivedAt && !entry.template?.archivedAt,
        );
    const scoped = candidates.filter(
      (entry) =>
        !pg.libraryScope ||
        pg.libraryScope === "all" ||
        (entry.playgroundItem?.scope ?? entry.template?.scope ?? "project") === pg.libraryScope,
    );
    if (!scoped.length) return null;
    if (pg.selectedUid) {
      const hit = scoped.find((e) => e.uid === pg.selectedUid);
      if (hit) return hit;
    }
    return scoped[0] ?? null;
  }, [unifiedEntries, pg.selectedUid, pg.libraryScope, pg.filters, pg.activeSubTab]);

  return { pg, filmTakes, unifiedEntries, selectedEntry };
}

export function VoicePlaygroundInline() {
  const { pg, selectedEntry } = usePlaygroundData(true);
  const active = pg.jobs.filter((job) => !["completed", "failed"].includes(job.status)).length;
  return (
    <section
      aria-label="GenVoice Voice Playground"
      className="border-hairline bg-backdrop flex flex-col gap-3 border-b px-3 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="text-primary-text size-4" />
          <h4 className="text-foreground text-base font-semibold">Voice Playground</h4>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Collapse Voice Playground"
          onClick={() => setPlaygroundInlineOpen(false)}
        >
          <ChevronUp />
        </Button>
      </div>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Create, compare and edit recordings. Keep the voices and recipes worth using again.
      </p>
      <div className="border-hairline bg-surface-subtle rounded-lg border px-3 py-2">
        <p className="text-foreground text-sm font-medium">
          {pg.draft.voiceName || pg.draft.voiceId || "Choose a voice"}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {PLAYGROUND_PAGES[pg.draft.mode].label} ·{" "}
          {pg.scope === "global" ? "Save to Global" : "Save to this project"}
        </p>
      </div>
      {selectedEntry?.audioUrl && <VoiceRecordingPlayer entry={selectedEntry} />}
      <Button
        type="button"
        variant="secondary"
        aria-label="Open Voice Playground Workbench"
        onClick={() => setPlaygroundWorkbenchOpen(true)}
      >
        <Maximize2 />
        Open Workbench
      </Button>
      {active > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPlaygroundSubTab("jobs");
            setPlaygroundWorkbenchOpen(true);
          }}
        >
          {active} running · View Jobs
        </Button>
      )}
    </section>
  );
}

function WorkbenchFeedback({ container }: { container: HTMLDivElement }) {
  useEffect(
    () =>
      studio.subscribe((next, prev) => {
        if (next.status && next.status !== prev.status) {
          voicePlaygroundToast.add({ title: next.status });
        }
      }),
    [],
  );
  return (
    <Toaster
      toastManager={voicePlaygroundToast}
      portalContainer={container}
      viewportClassName="bottom-36 sm:bottom-24"
      motion="compact"
    />
  );
}

function VoicePlaygroundWorkbenchContent({ isOpen }: { isOpen: boolean }) {
  const { pg, filmTakes, unifiedEntries, selectedEntry } = usePlaygroundData(isOpen);
  const dubbing = useDubbingJobs(isOpen);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [feedbackContainer, setFeedbackContainer] = useState<HTMLDivElement | null>(null);
  const attachDialog = useCallback((node: HTMLDivElement | null) => {
    dialogRef.current = node;
    setFeedbackContainer(node);
  }, []);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const compareHeading = useRef<HTMLHeadingElement>(null);
  const compactLibraryDetailTab = useRef<HTMLButtonElement>(null);
  const compareScroll = useRef<HTMLDivElement>(null);
  const regionReturn = useRef<{ openerId?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("voice-playground:sidebar") !== "collapsed";
    } catch {
      return true;
    }
  });
  const [voicesFavoritesOnly, setVoicesFavoritesOnly] = useState(false);
  const [voicesTab, setVoicesTab] = useState<PlaygroundVoicesTab>("catalog"),
    [cloudTab, setCloudTab] = useState<"speech" | "dubbing">("speech");
  const [openCloudClones, setOpenCloudClones] = useState(false);
  const [comparisonDirectory, setComparisonDirectory] = useState(false);
  const [compactResultsPage, setCompactResultsPage] = useState<PlaygroundPage | null>(null);
  const [compactBatchSetup, setCompactBatchSetup] = useState<string | null>(null);
  const projectName = S.film || "Current project";
  const page: PlaygroundPage =
    pg.activeSubTab === "create"
      ? pg.draft.mode
      : pg.activeSubTab === "remote"
        ? "cloud"
        : pg.activeSubTab === "library" || pg.activeSubTab === "inspect"
          ? pg.filters.source === "templates"
            ? "templates"
            : pg.filters.source === "favorites"
              ? "favorites"
              : pg.filters.source === "archive"
                ? "archive"
                : "recordings"
          : pg.activeSubTab;
  const isCreate = ["tts", "dialogue", "voice_changer", "stt", "dubbing"].includes(page);
  const isLibrary = ["recordings", "templates", "favorites", "archive"].includes(page);
  const showCompactResults = isCreate && compactResultsPage === page;
  const showCompactDetails = isLibrary && pg.workbenchMediumTab === "inspect";
  const showTrailingPane = showCompactResults || showCompactDetails;
  useLayoutEffect(() => {
    if (showCompactDetails && compactLibraryDetailTab.current?.getClientRects().length) {
      compactLibraryDetailTab.current.focus({ preventScroll: true });
    }
  }, [showCompactDetails, page]);
  const modeResults = unifiedEntries.filter(
    (entry) =>
      entry.kind === pg.draft.mode &&
      entry.origin === "playground" &&
      !entry.playgroundItem?.archivedAt,
  );
  const selectedResult =
    selectedEntry?.kind === pg.draft.mode &&
    selectedEntry.audioUrl &&
    !selectedEntry.playgroundItem?.archivedAt
      ? selectedEntry
      : (modeResults[0] ?? null);
  const previousPage = useRef(page);
  useLayoutEffect(() => {
    const changedPage = previousPage.current !== page;
    previousPage.current = page;
    if (!isOpen) return;
    if (pg.regionEditor?.returnToWorkbench) {
      regionReturn.current = { openerId: pg.regionEditor.openerId };
      return;
    }
    if (regionReturn.current) {
      const { openerId } = regionReturn.current;
      regionReturn.current = null;
      const opener = openerId ? document.getElementById(openerId) : null;
      (opener ?? pageHeading.current)?.focus();
    } else if (changedPage) {
      pageHeading.current?.focus({ preventScroll: true });
    }
  }, [pg.regionEditor, page, isOpen]);
  useLayoutEffect(() => {
    if (!isOpen) return;
    stopAudition();
    return stopAudition;
  }, [isOpen, page]);
  const presentation = PLAYGROUND_PAGES[page];
  const cloneJobs = [
    ...new Map(
      (pg.clones ?? []).map((clone) => [clone.remoteId || `${clone.scope}:${clone.id}`, clone]),
    ).values(),
  ];
  const topLevelJobs = topLevelPlaygroundJobs(pg.jobs);
  const running =
    topLevelJobs.filter((job) => !["completed", "failed"].includes(job.status)).length +
    dubbing.jobs.filter((job) =>
      ["uploading", "submitting", "processing", "retrying", "downloading"].includes(job.phase),
    ).length +
    cloneJobs.filter((clone) => ["submitting", "processing"].includes(clone.phase)).length;
  const needsAttention =
    topLevelJobs.filter((job) => job.status === "failed").length +
    dubbing.jobs.filter((job) =>
      ["failed", "uncertain", "download_interrupted", "upload_interrupted"].includes(job.phase),
    ).length;
  const comparisonJobs = pg.recentSpeechBatch
    ? pg.jobs
        .filter((job) => job.batch?.id === pg.recentSpeechBatch)
        .sort(
          (a, b) =>
            (a.batch?.index ?? 0) - (b.batch?.index ?? 0) ||
            (a.batch?.variationIndex ?? 0) - (b.batch?.variationIndex ?? 0),
        )
    : [];
  const comparisonKey = pg.recentSpeechBatch ?? "saved-takes";
  const hasComparison = comparisonJobs.length > 0 || pg.compareUids.length > 0;
  const showCompactBatchSetup = !hasComparison || compactBatchSetup === comparisonKey;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const navigate = (next: PlaygroundPage, viaKeyboard = false) => {
    setCompactResultsPage(null);
    setCompactBatchSetup(null);
    if (viaKeyboard && next === page && !pg.regionEditor) {
      pageHeading.current?.focus({ preventScroll: true });
    }
    if (pg.castingTarget) cancelCasting();
    if (next === "voices") {
      setVoicesFavoritesOnly(false);
      setComparisonDirectory(false);
    }
    if (pg.regionEditor) closeRecordingEditor();
    if (["tts", "dialogue", "voice_changer", "stt", "dubbing"].includes(next)) {
      switchPlaygroundTool(next as typeof pg.draft.mode);
    } else if (["recordings", "templates", "favorites", "archive"].includes(next)) {
      setPlaygroundFilters({
        ...DEFAULT_PLAYGROUND_FILTERS,
        source: next === "templates" || next === "favorites" || next === "archive" ? next : "all",
      });
      setPlaygroundSubTab("library");
    } else setPlaygroundSubTab(next === "cloud" ? "remote" : (next as PlaygroundSubTab));
  };
  const browseComparisonVoices = () => {
    navigate("voices");
    setVoicesTab("catalog");
    setOpenCloudClones(false);
    setComparisonDirectory(true);
    if (pg.status.configured) {
      void searchLiveSharedVoices({
        provider: "elevenlabs",
        sort: "usage_character_count_1y",
        pageSize: 40,
      });
    }
  };
  const close = () => {
    if (pg.regionEditor) closeRecordingEditor();
    setPlaygroundWorkbenchOpen(false);
  };
  return (
    <DialogContent
      ref={attachDialog}
      variant="workbench"
      data-voice-playground
      finalFocus={() => (pg.workbenchOpener?.isConnected ? pg.workbenchOpener : true)}
      showCloseButton={false}
      initialFocus={() =>
        dialogRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? dialogRef.current
      }
      className="flex h-[94dvh] w-[96vw] max-w-none flex-col overflow-hidden sm:max-w-[1840px]"
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Voice Playground</DialogTitle>
        <DialogDescription>
          Create, cast, compare and reuse voices in {projectName} and Global.
        </DialogDescription>
      </DialogHeader>
      <TooltipProvider delay={350} closeDelay={100}>
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={(open) => {
            setSidebarOpen(open);
            try {
              localStorage.setItem("voice-playground:sidebar", open ? "expanded" : "collapsed");
            } catch {}
          }}
          style={{ "--sidebar-width": "var(--voice-sidebar-width)" } as CSSProperties}
          className="relative h-full min-h-0 overflow-hidden [--voice-sidebar-width:13rem] min-[1600px]:[--voice-sidebar-width:14rem]"
        >
          <VoicePlaygroundSidebar
            page={page}
            projectName={projectName}
            running={running}
            needsAttention={needsAttention}
            onNavigate={navigate}
          />
          <SidebarInset className="@container/voice-workbench flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="border-hairline bg-card flex min-h-16 flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">
              <div className="flex min-w-0 max-w-full grow items-start gap-3">
                <SidebarTrigger className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h2
                    ref={pageHeading}
                    tabIndex={-1}
                    className="text-foreground focus-visible:ring-ring rounded-sm text-2xl leading-tight font-semibold tracking-tight wrap-anywhere outline-none focus-visible:ring-2"
                  >
                    {presentation.label}
                  </h2>
                </div>
              </div>
              <div className="ms-auto flex min-w-0 max-w-full flex-none flex-wrap items-center justify-end gap-2">
                <Badge variant="outline" className="max-w-52">
                  <FolderOpen />
                  <span className="truncate" title={projectName}>
                    {projectName}
                  </span>
                </Badge>
                <VoicePlaygroundKeyPopover
                  status={pg.status}
                  busyAction={pg.busyAction}
                  showTooltip={false}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open Voice Playground help"
                  onClick={() => navigate("help")}
                >
                  <BookOpen />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-auto min-h-6 max-w-full wrap-anywhere whitespace-normal"
                  onClick={close}
                >
                  Back to Studio
                </Button>
              </div>
            </header>
            {!pg.regionEditor && isCreate && (
              <div className="border-hairline flex flex-none items-center border-b px-5 py-2 @[64rem]/voice-workbench:hidden">
                <ToggleGroup
                  aria-label="Editor and results"
                  value={[showCompactResults ? "results" : "editor"]}
                  onValueChange={([next]) => {
                    if (next) setCompactResultsPage(next === "results" ? page : null);
                  }}
                >
                  <ToggleGroupItem value="editor">Editor</ToggleGroupItem>
                  <ToggleGroupItem value="results">Results</ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
            {!pg.regionEditor && isLibrary && (
              <div className="border-hairline bg-surface-subtle/20 flex flex-none flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5">
                <div className="flex items-center gap-2">
                  {isLibrary && (
                    <ToggleGroup
                      aria-label="Library view"
                      value={[page]}
                      onValueChange={(values) => {
                        const view = values[0];
                        if (
                          view === "recordings" ||
                          view === "templates" ||
                          view === "favorites" ||
                          view === "archive"
                        )
                          navigate(view);
                      }}
                    >
                      <ToggleGroupItem value="recordings">Recordings</ToggleGroupItem>
                      <ToggleGroupItem value="templates">Templates</ToggleGroupItem>
                      <ToggleGroupItem value="favorites">Favorites</ToggleGroupItem>
                      <ToggleGroupItem value="archive">Archive</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                  {page === "favorites" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setVoicesFavoritesOnly(true);
                        setComparisonDirectory(false);
                        setVoicesTab("catalog");
                        setPlaygroundSubTab("voices");
                      }}
                    >
                      View favorite voices
                    </Button>
                  )}
                  {page === "archive" && (
                    <p className="text-muted-foreground text-sm">
                      Studio may delete unprotected recordings after 30 days. Open a recording to check.
                    </p>
                  )}
                  {pg.compareUids.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => navigate("compare")}>
                      Compare {pg.compareUids.length} takes
                    </Button>
                  )}
                  {page === "templates" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        resetComposerDraft("tts");
                        setPlaygroundSubTab("create");
                      }}
                    >
                      New template
                    </Button>
                  )}
                </div>
              </div>
            )}
            {!pg.regionEditor && isLibrary && (
              <div className="border-hairline flex flex-none border-b px-5 py-2 @[64rem]/voice-workbench:hidden">
                <ToggleGroup
                  variant="pick"
                  aria-label="Library list and details"
                  value={[showCompactDetails ? "inspect" : "library"]}
                  onValueChange={([next]) => {
                    if (next === "inspect" || next === "library") setWorkbenchMediumTab(next);
                  }}
                >
                  <ToggleGroupItem value="library">List</ToggleGroupItem>
                  <ToggleGroupItem ref={compactLibraryDetailTab} value="inspect" data-recording-details="">
                    Details
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
            {pg.regionEditor?.returnToWorkbench ? (
              <VoiceRegionEditorSurface
                key={`${pg.regionEditor.item.id}:${pg.regionEditor.revisionOf ?? ""}`}
                request={pg.regionEditor}
              />
            ) : isCreate || isLibrary ? (
              <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden @[64rem]/voice-workbench:grid-cols-[minmax(0,1fr)_24rem]">
                <div
                  className={cn(
                    "col-start-1 row-start-1 min-h-0 min-w-0 flex-col overflow-hidden",
                    showTrailingPane ? "hidden @[64rem]/voice-workbench:flex" : "flex",
                  )}
                >
                  {isCreate ? (
                    <div className="h-full min-h-0 w-full">
                      {page === "dubbing" ? (
                        <VoicePlaygroundDubbing pg={pg} entries={unifiedEntries} />
                      ) : (
                        <VoicePlaygroundComposer
                          pg={pg}
                          unifiedEntries={unifiedEntries}
                          filmTakes={filmTakes}
                          showModeSwitcher={false}
                          showJobQueue={false}
                          showSttResult={false}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-1 flex-col p-5">
                      <VoicePlaygroundLibrary
                        pg={pg}
                        unifiedEntries={
                          page === "recordings"
                            ? unifiedEntries.filter((entry) => entry.origin !== "template")
                            : unifiedEntries
                        }
                        sidebarNavigation
                        onSelectForInspect={() => setPlaygroundSubTab("inspect")}
                      />
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    "col-start-1 row-start-1 min-h-0 min-w-0 flex-col @[64rem]/voice-workbench:col-start-2",
                    showTrailingPane ? "flex" : "hidden @[64rem]/voice-workbench:flex",
                  )}
                >
                  {isCreate ? (
                    <VoicePlaygroundResults
                      pg={pg}
                      entries={modeResults}
                      selected={selectedResult}
                      dubbingJobs={dubbing.jobs}
                    />
                  ) : (
                    <div className="border-hairline h-full overflow-y-auto overscroll-contain p-5 @[64rem]/voice-workbench:border-s">
                      <VoicePlaygroundInspector
                        key={selectedEntry?.uid ?? "empty"}
                        entry={selectedEntry}
                        pg={pg}
                        filmTakes={filmTakes}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : page === "voices" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {Boolean(pg.compareVoices?.length) && (
                  <div className="border-hairline flex shrink-0 justify-end border-b px-5 py-2">
                    <Button size="sm" variant="secondary" onClick={() => navigate("compare")}>
                      Review {pg.compareVoices?.length} selected{" "}
                      {pg.compareVoices?.length === 1 ? "voice" : "voices"}
                    </Button>
                  </div>
                )}
                <VoicePlaygroundVoices
                  pg={pg}
                  tab={voicesTab}
                  onTabChange={(tab) => {
                    setOpenCloudClones(false);
                    setVoicesTab(tab);
                  }}
                  openCloudClones={openCloudClones}
                  comparisonDirectory={comparisonDirectory}
                  favoritesOnly={voicesFavoritesOnly && !pg.castingTarget}
                  onShowAll={() => setVoicesFavoritesOnly(false)}
                />
              </div>
            ) : page === "compare" ? (
              <>
                {hasComparison && (
                  <div className="border-hairline flex flex-none border-b px-5 py-2 @[64rem]/voice-workbench:hidden">
                    <ToggleGroup
                      variant="pick"
                      aria-label="Comparison view"
                      value={[showCompactBatchSetup ? "setup" : "audition"]}
                      onValueChange={([next]) => {
                        if (!next) return;
                        setCompactBatchSetup(next === "setup" ? comparisonKey : null);
                        compareScroll.current?.scrollTo({ top: 0 });
                      }}
                    >
                      <ToggleGroupItem value="audition">Audition</ToggleGroupItem>
                      <ToggleGroupItem value="setup">Batch setup</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                )}
                <div
                  ref={compareScroll}
                  className="h-full min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"
                >
                  <div
                    className={showCompactBatchSetup ? undefined : "hidden @[64rem]/voice-workbench:block"}
                  >
                    <VoiceSpeechBatch
                      pg={pg}
                      onBrowse={browseComparisonVoices}
                      resultFocus={compareHeading}
                    />
                  </div>
                  <div
                    className={
                      hasComparison && showCompactBatchSetup
                        ? "hidden @[64rem]/voice-workbench:block"
                        : undefined
                    }
                  >
                    {comparisonJobs.length > 0 && pg.compareUids.length > 0 && (
                      <div className="mb-3 flex justify-end">
                        <Button size="sm" variant="secondary" onClick={() => openSpeechComparison()}>
                          Open saved comparison ({pg.compareUids.length})
                        </Button>
                      </div>
                    )}
                    <VoicePlaygroundCompare
                      key={comparisonKey}
                      entries={unifiedEntries.filter((entry) => !entry.playgroundItem?.archivedAt)}
                      uids={comparisonJobs.length > 0 ? [] : pg.compareUids}
                      batchJobs={comparisonJobs}
                      headingRef={compareHeading}
                      onBrowseRecordings={() => navigate("recordings")}
                    />
                  </div>
                </div>
              </>
            ) : page === "jobs" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
                <div className="mx-auto flex max-w-5xl flex-col gap-6">
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCloudTab("speech");
                        navigate("cloud");
                      }}
                    >
                      Cloud recovery
                    </Button>
                  </div>
                  <VoicePlaygroundJobQueue
                    jobs={pg.jobs}
                    items={pg.items}
                    onRecover={() => {
                      setCloudTab("speech");
                      setPlaygroundSubTab("remote");
                    }}
                  />
                  <VoiceDubbingJobs jobs={dubbing.jobs} />
                  {dubbing.error && (
                    <p role="alert" className="text-warn-text text-sm">
                      {dubbing.error}
                    </p>
                  )}
                  <section className="border-hairline flex flex-col gap-3 border-t pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-foreground text-lg leading-tight font-semibold">
                        Personal voices
                      </h3>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setVoicesTab("clones");
                          navigate("voices");
                        }}
                      >
                        Open My voices
                      </Button>
                    </div>
                    {cloneJobs.length ? (
                      cloneJobs.map((clone) => (
                        <div
                          key={`${clone.scope}:${clone.id}`}
                          className="border-hairline flex items-start justify-between gap-3 rounded-lg border p-3"
                        >
                          <div>
                            <p className="text-foreground text-sm font-medium">
                              {clone.displayName || clone.settings.name}
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm">
                              {clone.scope === "global" ? "Global" : "This project"} · {clone.phase}
                            </p>
                          </div>
                          {["submitting", "processing"].includes(clone.phase) && (
                            <span className="text-muted-foreground text-sm tabular-nums">
                              {Math.max(
                                0,
                                Math.floor(
                                  (now - Date.parse(clone.submittedAt || clone.createdAt)) / 1000,
                                ),
                              )}
                              s elapsed
                            </span>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No personal voice submissions. Create one in Voices → My voices.
                      </p>
                    )}
                  </section>
                </div>
              </div>
            ) : page === "cloud" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
                <div className="flex flex-none flex-wrap items-center justify-between gap-3">
                  <ToggleGroup
                    aria-label="Cloud history type"
                    value={[cloudTab]}
                    onValueChange={(values) => {
                      if (values[0] === "speech" || values[0] === "dubbing") setCloudTab(values[0]);
                    }}
                  >
                    <ToggleGroupItem value="speech">Speech &amp; Voice changer · 24h</ToggleGroupItem>
                    <ToggleGroupItem value="dubbing">Dubbing history</ToggleGroupItem>
                  </ToggleGroup>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      navigate("voices");
                      setVoicesTab("clones");
                      setOpenCloudClones(true);
                    }}
                  >
                    Browse cloud voices
                  </Button>
                </div>
                {cloudTab === "dubbing" ? (
                  <VoiceDubbingCloud configured={pg.status.configured} jobs={dubbing.jobs} />
                ) : (
                  <VoicePlaygroundLibrary
                    pg={pg}
                    unifiedEntries={unifiedEntries}
                    sidebarNavigation
                    showCloudTab
                  />
                )}
              </div>
            ) : (
              <VoicePlaygroundHelp />
            )}
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
      {feedbackContainer && <WorkbenchFeedback container={feedbackContainer} />}
    </DialogContent>
  );
}

export function VoicePlaygroundWorkbenchDialog() {
  const isOpen = useVoicePlaygroundSelector((s) => s.workbenchOpen, false);
  const hasOpened = useVoicePlaygroundSelector((s) => s.everOpened, false);
  useDialogModal("voicePlayground", isOpen);

  return (
    <Dialog open={isOpen} onOpenChange={changePlaygroundWorkbenchOpen}>
      {(isOpen || hasOpened) && <VoicePlaygroundWorkbenchContent isOpen={isOpen} />}
    </Dialog>
  );
}
