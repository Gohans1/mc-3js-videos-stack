import { diffLines } from "diff";
import { Copy } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { fillTemplate } from "../../src/lesson-config";
import type { InspectorView, InspectResult } from "./inspector-types";

export function InspectorCode({ children }: { children: string }) {
  return (
    <pre className="bg-backdrop text-foreground border-border max-h-96 overflow-auto overscroll-contain rounded-md border p-3 font-mono text-sm/relaxed wrap-anywhere whitespace-pre-wrap">
      {children}
    </pre>
  );
}
const details = [
  { value: "prompt", label: "Prompts" },
  { value: "learn", label: "Remember prompt" },
  { value: "requests", label: "Requests" },
  { value: "trace", label: "Run trace" },
  { value: "metadata", label: "Metadata" },
];
const titles: Record<InspectorView, string> = {
  ai: "What the AI receives",
  lessons: "Extracted lesson text",
  prompt: "Assembled Jev prompts",
  learn: "Instruction for remembering a rule",
  requests: "Prepared requests",
  trace: "Last Jev run",
  metadata: "Note metadata",
};
export function inspectorPreviewText(result: InspectResult, view: InspectorView): string {
  if (view === "ai") return result.noteOutput;
  if (view === "lessons") return result.pool.map((p) => p.jev).join("\n\n");
  if (view === "learn") return result.learnPrompt;
  if (view === "requests")
    return JSON.stringify(
      {
        provider: result.config.route,
        models: { free: result.config.freeModel, paid: result.config.paidModel },
        ...result.requests,
      },
      null,
      2,
    );
  if (view === "trace")
    return result.ranked
      ? JSON.stringify({ ranked: result.ranked, trace: result.trace }, null, 2)
      : result.cache.cli
        ? "Reused CLI matches. No Jev trace is available for these inputs."
        : "No trace recorded yet. A new Inspector run records its Jev trace here.";
  if (view === "metadata") return JSON.stringify(result.noteInput, null, 2);
  const c = result.config;
  return [
    "Note prompt",
    [c.systemPreamble, fillTemplate(c.wantedTemplate, { note: result.words })]
      .filter(Boolean)
      .join("\n\n"),
    "",
    "Ranking question",
    c.choiceInstructions,
    "",
    "Relevance question",
    c.noulInstructionsTemplate,
    "",
    "Relevant means",
    c.noulYes,
    "",
    "Unrelated means",
    c.noulNo,
  ].join("\n");
}

export function InspectorPreview({
  hasNote,
  canChooseNote,
  allFilesExcluded,
  result,
  previous,
  view,
  onViewChange,
  updating,
  runningJev,
  change,
  error,
  validationError,
  failedRun,
}: {
  hasNote: boolean;
  canChooseNote: boolean;
  allFilesExcluded: boolean;
  result: InspectResult | null;
  previous?: InspectResult;
  view: InspectorView;
  onViewChange: (view: InspectorView) => void;
  updating: boolean;
  runningJev: boolean;
  change: string;
  error: string;
  validationError: string;
  failedRun: boolean;
}) {
  const awaitingNote = view === "ai" && !hasNote;
  const requestPending = updating || runningJev;
  const showPrevious = requestPending || Boolean(error);
  const text = result && !awaitingNote ? inspectorPreviewText(result, view) : "";
  const before =
    previous && !awaitingNote && (view !== "ai" || previous.words.trim())
      ? inspectorPreviewText(previous, view)
      : "";
  const lines = useMemo(
    () => (before ? diffLines(before, text) : [{ value: text, added: false, removed: false }]),
    [before, text],
  );
  const changed = lines
    .filter((p) => p.added)
    .reduce((sum, p) => sum + p.value.trimEnd().split("\n").length, 0);
  const removed = lines.some((part) => part.removed);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const parent = scroller.current,
      target = parent?.querySelector<HTMLElement>("[data-changed=true]");
    if (parent && target && !requestPending)
      parent.scrollTop +=
        target.getBoundingClientRect().top -
        parent.getBoundingClientRect().top -
        parent.clientHeight / 3;
  }, [text, view, requestPending]);
  const copy = () =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.add({ title: "Preview copied" }))
      .catch(() =>
        toast.add({
          title: "Copy failed",
          description: "Select the preview text and copy it manually.",
          type: "error",
        }),
      );
  return (
    <section
      aria-label="Live preview"
      data-inspector-output
      className={cn(
        "bg-backdrop flex min-h-0 min-w-0 flex-col border-t transition-colors duration-150 ease-out motion-reduce:transition-none @min-[700px]/inspector:border-s @min-[700px]/inspector:border-t-0",
        view === "lessons" ? "border-primary/30" : "border-ai/30",
      )}
    >
      <div
        className={cn(
          "flex flex-none flex-col gap-0.5 border-b px-3 py-1 transition-colors duration-150 ease-out motion-reduce:transition-none @min-[700px]/inspector:px-4",
          view === "lessons" ? "border-primary/20 bg-primary/5" : "border-ai/20 bg-ai/5",
        )}
      >
        <h3 className="sr-only">Live preview</h3>
        <div className="scroll-fade-x sideways:flex-nowrap sideways:overflow-x-auto upright:flex-nowrap upright:overflow-x-auto flex flex-wrap items-center gap-2 overscroll-x-contain">
          <ToggleGroup
            variant="segment"
            aria-label="Preview content"
            className="sideways:max-w-none sideways:flex-nowrap upright:max-w-none upright:flex-nowrap max-w-full flex-wrap"
            value={[view]}
            onValueChange={(v) => {
              if (v[0] === "ai" || v[0] === "lessons") onViewChange(v[0]);
            }}
          >
            <ToggleGroupItem value="ai" tone="ai">
              Note for AI
            </ToggleGroupItem>
            <ToggleGroupItem value="lessons" tone="source">
              Extracted lessons
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="sideways:min-w-32 upright:min-w-32 flex min-w-[min(100%,13.5rem)] flex-1 items-center justify-end gap-2">
            <Select
              value={view === "ai" || view === "lessons" ? null : view}
              items={details}
              onValueChange={(v) => {
                if (details.some((d) => d.value === v)) onViewChange(v as InspectorView);
              }}
            >
              <SelectTrigger
                size="readable"
                aria-label="More views"
                className="max-w-44 min-w-0 flex-1"
              >
                <SelectValue placeholder="More views" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {details.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy preview"
              disabled={!text || requestPending || Boolean(error)}
              onClick={copy}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="sr-only">{titles[view]}</p>
          <p
            role="status"
            className="text-muted-foreground text-xs/relaxed tabular-nums @min-[700px]/inspector:text-sm/relaxed"
          >
            {error ? (
              failedRun ? (
                "Jev run failed"
              ) : validationError ? (
                `Preview paused · ${validationError}`
              ) : (
                "Preview paused"
              )
            ) : runningJev ? (
              "Running Jev…"
            ) : updating ? (
              result ? (
                "Updating preview…"
              ) : (
                "Loading preview…"
              )
            ) : awaitingNote ? (
              "Add a note to preview"
            ) : result ? (
              <>
                {before && <span className="sr-only">{change + ". "}</span>}
                {changed > 0 ? (
                  <span className="text-ok-text">{changed} added</span>
                ) : removed ? (
                  "Preview updated"
                ) : before ? (
                  "Output unchanged"
                ) : (
                  "Preview ready"
                )}
              </>
            ) : (
              "Choose a note or write one to begin."
            )}
          </p>
        </div>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={titles[view]}
        aria-busy={requestPending && !error}
        data-inspector-result
        ref={scroller}
        className="focus-visible:outline-ring min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
      >
        {awaitingNote ? (
          <p className="text-muted-foreground text-sm/relaxed">
            {canChooseNote
              ? "Write or choose a note to see what the AI receives."
              : "Write a note to see what the AI receives."}
          </p>
        ) : !result ? (
          <p className="text-muted-foreground text-sm/relaxed">
            The preview uses the real lessons in Deck. Editing here never calls Jev automatically.
          </p>
        ) : (
          <pre className="max-w-[72ch] font-mono text-sm/relaxed wrap-anywhere whitespace-pre-wrap">
            {text
              ? lines
                  .filter((part) => !part.removed)
                  .map((part, i) =>
                    part.added ? (
                      <span key={i} data-changed className="bg-ok/20 text-foreground rounded-sm">
                        {part.value.split(/(?<=\n)/).map((line, index) => (
                          <span key={index}>
                            <span aria-hidden className="text-ok-text select-none">
                              +{" "}
                            </span>
                            {line}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span key={i}>{part.value}</span>
                    ),
                  )
              : allFilesExcluded
                ? "Every lesson file in this scope is excluded. Select Include all in scope or reselect files."
                : "No lesson files in this scope. Choose another scope or add lessons in Deck."}
          </pre>
        )}
      </div>
      <div className="border-border text-label flex flex-none flex-wrap gap-x-3 gap-y-1 border-t px-3 py-1 text-xs/relaxed tabular-nums @min-[700px]/inspector:px-4">
        {result && (
          <span className="hidden @min-[20rem]/inspector:inline">
            Files: <strong className="text-primary-text font-semibold">{result.pool.length}</strong>
          </span>
        )}
        <span
          className={
            !showPrevious && result?.status === "live"
              ? "text-ai-text"
              : !showPrevious && result?.status === "cached"
                ? "text-ok-text"
                : undefined
          }
        >
          {!result
            ? "No result yet"
            : showPrevious
              ? result.status === "dry"
                ? "Previous preview"
                : "Previous result"
              : result.status === "live"
                ? "Live result"
                : result.status === "cached"
                  ? "Cached result · no call"
                  : "Preview · no Jev call"}
        </span>
      </div>
    </section>
  );
}
