import { AudioWaveform, ChevronUp, Maximize2, SlidersHorizontal, Sparkles } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createToastManager, Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { studio, useDialogModal } from "../core/store";
import { useVoiceTakes } from "./voice-client";
import {
  type PlaygroundSubTab,
  setPlaygroundInlineOpen,
  setPlaygroundSubTab,
  setPlaygroundWorkbenchOpen,
  setWorkbenchMediumTab,
  useVoicePlayground,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import {
  buildUnifiedEntries,
  nextTabId,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import { VoicePlaygroundComposer } from "./VoicePlaygroundComposer";
import { VoicePlaygroundInspector } from "./VoicePlaygroundInspector";
import { VoicePlaygroundKeyPopover } from "./VoicePlaygroundKeyPopover";
import { VoicePlaygroundLibrary } from "./VoicePlaygroundLibrary";

function usePlaygroundData(enabled: boolean) {
  const pg = useVoicePlayground(enabled);
  const filmTakes = useVoiceTakes();

  const unifiedEntries = useMemo(
    () => buildUnifiedEntries(pg.items, filmTakes, new Set(pg.starredTakeUids)),
    [pg.items, filmTakes, pg.starredTakeUids],
  );

  const selectedEntry: UnifiedPlaygroundEntry | null = useMemo(() => {
    if (!unifiedEntries.length) return null;
    if (pg.selectedUid) {
      const hit = unifiedEntries.find((e) => e.uid === pg.selectedUid);
      if (hit) return hit;
    }
    return unifiedEntries[0] ?? null;
  }, [unifiedEntries, pg.selectedUid]);

  return { pg, filmTakes, unifiedEntries, selectedEntry };
}

const SUB_TAB_IDS = ["create", "library", "inspect"] as const;
type SubTabId = (typeof SUB_TAB_IDS)[number];

function PlaygroundSubTabStrip({
  ariaLabel,
  className,
  buttonClassName,
  activeClassName,
  activeTab,
  libraryCount,
  onSelect,
}: {
  ariaLabel: string;
  className: string;
  buttonClassName: string;
  activeClassName: string;
  activeTab: PlaygroundSubTab;
  libraryCount: number;
  onSelect: (tab: SubTabId) => void;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const effectiveTab: SubTabId = SUB_TAB_IDS.includes(activeTab as SubTabId)
    ? (activeTab as SubTabId)
    : "library";
  const tabs: Array<{ id: SubTabId; label: string }> = [
    { id: "create", label: "Create" },
    { id: "library", label: `Library (${libraryCount})` },
    { id: "inspect", label: "Inspect" },
  ];

  return (
    <div role="tablist" aria-label={ariaLabel} className={className}>
      {tabs.map((tab) => {
        const active = effectiveTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            tabIndex={effectiveTab === tab.id ? 0 : -1}
            aria-selected={active}
            onKeyDown={(e) => {
              const next = nextTabId(SUB_TAB_IDS, effectiveTab, e.key);
              if (!next) return;
              e.preventDefault();
              onSelect(next);
              tabRefs.current[next]?.focus();
            }}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "focus-visible:ring-ring whitespace-nowrap outline-none focus-visible:ring-2",
              buttonClassName,
              active ? activeClassName : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function VoicePlaygroundInline() {
  const { pg, filmTakes, unifiedEntries, selectedEntry } = usePlaygroundData(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const inspectedUid = pg.activeSubTab === "inspect" ? selectedEntry?.uid : null;

  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [pg.activeSubTab, pg.draftVersion, pg.draft.mode, inspectedUid]);

  return (
    <section
      aria-label="GenVoice Voice Playground"
      className="border-hairline bg-backdrop flex flex-col gap-2.5 border-b px-3 py-2.5"
    >
      {/* Compact Header with Discreet Key Popover + Workbench Expand */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="text-primary-text size-3.5" />
          <h4 className="text-foreground text-base font-semibold">Voice Playground</h4>
          <span className="text-muted-foreground text-xs">Eleven v4</span>
        </div>
        <div className="flex items-center gap-1">
          <VoicePlaygroundKeyPopover status={pg.status} busyAction={pg.busyAction} />
          <Tip label="Open full 3-pane Voice Playground Workbench">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPlaygroundWorkbenchOpen(true)}
            >
              <Maximize2 className="size-3" />
              <span>Workbench</span>
            </Button>
          </Tip>
          <Tip label="Collapse inline Playground">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Collapse Voice Playground"
              onClick={() => setPlaygroundInlineOpen(false)}
            >
              <ChevronUp className="size-3.5" />
            </Button>
          </Tip>
        </div>
      </div>

      {/* Sub-Tabs for Compact Sidebar Navigation */}
      <PlaygroundSubTabStrip
        ariaLabel="Voice Playground sidebar sections"
        className="bg-raised-2 grid grid-cols-3 gap-0.5 rounded-md p-0.5 text-xs"
        buttonClassName="rounded px-2 py-1 font-medium transition-colors"
        activeClassName="bg-card text-foreground shadow-xs"
        activeTab={pg.activeSubTab}
        libraryCount={unifiedEntries.length}
        onSelect={setPlaygroundSubTab}
      />

      <div
        ref={panelRef}
        className="max-h-[30rem] scroll-pb-24 overflow-y-auto overscroll-contain pe-0.5"
      >
        <div className={pg.activeSubTab === "create" ? undefined : "hidden"}>
          <VoicePlaygroundComposer
            pg={pg}
            unifiedEntries={unifiedEntries}
            filmTakes={filmTakes}
            compact
          />
        </div>
        {(pg.activeSubTab === "library" || pg.activeSubTab === "remote") && (
          <VoicePlaygroundLibrary
            pg={pg}
            unifiedEntries={unifiedEntries}
            showCloudTab
            onSelectForInspect={() => setPlaygroundSubTab("inspect")}
          />
        )}
        {pg.activeSubTab === "inspect" && (
          <VoicePlaygroundInspector
            key={selectedEntry?.uid ?? "empty"}
            entry={selectedEntry}
            pg={pg}
            filmTakes={filmTakes}
          />
        )}
      </div>
    </section>
  );
}

function WorkbenchFeedback({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const manager = useMemo(() => createToastManager(), []);
  useEffect(
    () =>
      studio.subscribe((next, prev) => {
        if (next.status && next.status !== prev.status) manager.add({ title: next.status });
      }),
    [manager],
  );
  return (
    <Toaster
      toastManager={manager}
      portalContainer={container}
      viewportClassName="bottom-32 sm:bottom-4"
    />
  );
}

function VoicePlaygroundWorkbenchContent() {
  const { pg, filmTakes, unifiedEntries, selectedEntry } = usePlaygroundData(true);
  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const modeTabRef = useRef<HTMLButtonElement>(null);
  const composerPaneRef = useRef<HTMLDivElement>(null);
  const inspectorPaneRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (composerPaneRef.current) composerPaneRef.current.scrollTop = 0;
  }, [pg.draftVersion, pg.draft.mode]);

  useLayoutEffect(() => {
    if (inspectorPaneRef.current) inspectorPaneRef.current.scrollTop = 0;
  }, [selectedEntry?.uid]);

  return (
    <DialogContent
      ref={dialogRef}
      variant="workbench"
      showCloseButton
      initialFocus={() =>
        modeTabRef.current && modeTabRef.current.offsetParent !== null
          ? modeTabRef.current
          : dialogBodyRef.current
      }
      className="flex h-[min(56rem,92dvh)] w-full flex-col overflow-hidden sm:max-w-[min(86rem,96vw)]"
    >
      <TooltipProvider delay={350} closeDelay={100}>
        {/* Top Workbench Bar */}
        <div className="border-primary/25 bg-primary/[0.05] flex flex-none items-center justify-between gap-3 border-b px-4 py-3 pe-11">
          <div className="flex min-w-0 items-center gap-2">
            <AudioWaveform className="text-primary-text size-5 flex-none" />
            <DialogHeader>
              <DialogTitle variant="workbench">Voice Playground</DialogTitle>
              <DialogDescription className="hidden sm:block">
                GenVoice · Create, compare and reuse voices.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex flex-none items-center gap-2">
            <VoicePlaygroundKeyPopover
              status={pg.status}
              busyAction={pg.busyAction}
              showTooltip={false}
            />
          </div>
        </div>

        {/* Narrow (<md) View Switcher */}
        <PlaygroundSubTabStrip
          ariaLabel="Workbench mobile panes"
          className="border-hairline bg-card flex items-center gap-1 border-b px-3 py-1.5 md:hidden"
          buttonClassName="flex-1 rounded-md px-2 py-1 text-sm font-medium transition-colors"
          activeClassName="bg-tint text-primary-text"
          activeTab={pg.activeSubTab}
          libraryCount={unifiedEntries.length}
          onSelect={setPlaygroundSubTab}
        />

        {/* Responsive Body: 3 Panes on xl (>=1280px), 2 Panes on md..lg, Tabbed on <md */}
        <div
          ref={dialogBodyRef}
          tabIndex={-1}
          className="grid min-h-0 flex-1 grid-cols-1 outline-none md:grid-cols-[minmax(22rem,27rem)_1fr] xl:grid-cols-[28rem_minmax(19rem,1fr)_minmax(21rem,25rem)]"
        >
          {/* Column 1: Composer */}
          <div
            ref={composerPaneRef}
            className={cn(
              "border-hairline min-h-0 scroll-pb-24 overflow-y-auto overscroll-contain p-3.5 pb-0 md:border-e",
              pg.activeSubTab !== "create" && "hidden md:block",
            )}
          >
            <VoicePlaygroundComposer
              pg={pg}
              unifiedEntries={unifiedEntries}
              filmTakes={filmTakes}
              modeTabRef={modeTabRef}
            />
          </div>

          {/* Column 2: Unified Library + 24h Cloud Archive */}
          <div
            className={cn(
              "border-hairline flex min-h-0 flex-col gap-2 overflow-hidden p-3.5 xl:border-e",
              pg.activeSubTab === "library" || pg.activeSubTab === "remote"
                ? "flex"
                : "hidden md:flex",
              pg.workbenchMediumTab === "inspect" && "md:hidden xl:flex",
            )}
          >
            <div className="hidden items-center justify-between md:flex xl:hidden">
              <span className="text-foreground text-xs font-semibold">
                Library & AI Takes ({unifiedEntries.length})
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setWorkbenchMediumTab("inspect")}
              >
                <SlidersHorizontal className="size-3" />
                <span>Open Inspector →</span>
              </Button>
            </div>
            <VoicePlaygroundLibrary
              pg={pg}
              unifiedEntries={unifiedEntries}
              showCloudTab
              onSelectForInspect={() => {
                setPlaygroundSubTab("inspect");
                setWorkbenchMediumTab("inspect");
              }}
            />
          </div>

          {/* Column 3: Full Setting Inspector & Template / Swap Remix */}
          <div
            ref={inspectorPaneRef}
            className={cn(
              "bg-surface-subtle/35 min-h-0 overflow-y-auto overscroll-contain p-3.5",
              pg.activeSubTab === "inspect" ? "block" : "hidden md:block",
              pg.workbenchMediumTab !== "inspect" && "md:hidden xl:block",
            )}
          >
            <div className="mb-2 hidden items-center justify-between md:flex xl:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWorkbenchMediumTab("library")}
              >
                ← Back to Library
              </Button>
              <span className="text-muted-foreground text-xs">Inspector</span>
            </div>
            <VoicePlaygroundInspector
              key={selectedEntry?.uid ?? "empty"}
              entry={selectedEntry}
              pg={pg}
              filmTakes={filmTakes}
            />
          </div>
        </div>
      </TooltipProvider>
      <WorkbenchFeedback container={dialogRef} />
    </DialogContent>
  );
}

export function VoicePlaygroundWorkbenchDialog() {
  const isOpen = useVoicePlaygroundSelector((s) => s.workbenchOpen, false);
  useDialogModal("voicePlayground", isOpen);

  return (
    <Dialog open={isOpen} onOpenChange={setPlaygroundWorkbenchOpen}>
      {isOpen && <VoicePlaygroundWorkbenchContent />}
    </Dialog>
  );
}
