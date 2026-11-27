import { ChevronDown, Network, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  fetchPortsSnapshot,
  formatRelativeScanAge,
  formatScanClock,
  getCachedPortsSnapshot,
  type PortsSnapshot,
  setCachedPortsSnapshot,
  shouldSkipBackgroundRefresh,
  sortStudios,
  summarizeSnapshot,
} from "./ports";
import { StudioEntry, UrlActionRow } from "./StudioEntry";

const COPY_FEEDBACK_MS = 1800;
const CLOCK_TICK_MS = 30_000;

type PortsViewState =
  | { status: "loading"; snapshot: null }
  | { status: "ready"; snapshot: PortsSnapshot }
  | { status: "refreshing"; snapshot: PortsSnapshot | null }
  | { status: "error"; snapshot: PortsSnapshot | null; error: string };

type ActivePortsRequest =
  | { kind: "idle"; seq: number }
  | { kind: "auto" | "force"; seq: number; controller: AbortController };

export function PortsPanel({
  initialSnapshot = null,
}: {
  initialSnapshot?: PortsSnapshot | null;
} = {}) {
  const [view, setView] = useState<PortsViewState>(() => {
    const cached = initialSnapshot ?? getCachedPortsSnapshot();
    return cached ? { status: "ready", snapshot: cached } : { status: "loading", snapshot: null };
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const requestRef = useRef<ActivePortsRequest>({ kind: "idle", seq: 0 });
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);

  const executeFetch = useCallback((forceRefresh: boolean) => {
    const prev = requestRef.current;
    if (prev.kind !== "idle") prev.controller.abort();
    const seq = prev.seq + 1;
    const controller = new AbortController();
    requestRef.current = { kind: forceRefresh ? "force" : "auto", seq, controller };

    void fetchPortsSnapshot({
      refresh: forceRefresh,
      signal: controller.signal,
    }).then(
      (next) => {
        if (controller.signal.aborted || requestRef.current.seq !== seq) return;
        requestRef.current = { kind: "idle", seq };
        setCachedPortsSnapshot(next);
        setView({ status: "ready", snapshot: next });
        setNow(Date.now());
      },
      (err: unknown) => {
        if (controller.signal.aborted || requestRef.current.seq !== seq) return;
        requestRef.current = { kind: "idle", seq };
        const message = err instanceof Error ? err.message : String(err);
        setView((current) => ({ status: "error", snapshot: current.snapshot, error: message }));
      },
    );
  }, []);

  const handleRefresh = useCallback(() => {
    refreshRef.current?.focus();
    setCopyMessage("");
    setView((current) => ({ status: "refreshing", snapshot: current.snapshot }));
    executeFetch(true);
  }, [executeFetch]);

  useEffect(() => {
    if (initialSnapshot === null) {
      executeFetch(false);
    }
    const onFocusOrVisible = () => {
      const req = requestRef.current;
      if (
        shouldSkipBackgroundRefresh({
          visibilityState: document.visibilityState,
          inFlight: req.kind === "idle" ? null : req.kind,
        })
      ) {
        return;
      }
      executeFetch(false);
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    const clockTimer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);

    return () => {
      const req = requestRef.current;
      if (req.kind !== "idle") req.controller.abort();
      requestRef.current = { kind: "idle", seq: req.seq + 1 };
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      clearInterval(clockTimer);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, [executeFetch, initialSnapshot]);

  const snapshot = view.snapshot;
  const loading = view.status === "loading";
  const refreshing = view.status === "refreshing";
  const error = view.status === "error" ? view.error : null;

  const handleCopy = useCallback((key: string, safeUrl: string) => {
    setCopyMessage("");
    if (!navigator.clipboard?.writeText) {
      toast.add({
        title: "Clipboard unavailable",
        description:
          "Right-click the link and copy its address, or open this studio on localhost or HTTPS and retry.",
        type: "error",
        timeout: 0,
      });
      return;
    }
    void navigator.clipboard
      .writeText(safeUrl)
      .then(() => {
        setCopiedKey(key);
        setCopyMessage(`Copied ${safeUrl}`);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS);
      })
      .catch(() => {
        toast.add({
          title: "Could not copy URL",
          description:
            "Right-click the link and copy its address, or allow clipboard access and try again.",
          type: "error",
          timeout: 0,
        });
      });
  }, []);

  const summary = snapshot ? summarizeSnapshot(snapshot) : null;
  const scannedLabel = snapshot ? formatRelativeScanAge(snapshot.scannedAt, now) : "";
  const scanClock = snapshot ? formatScanClock(snapshot.scannedAt) : "";
  const sortedStudios = snapshot ? sortStudios(snapshot.studios) : [];
  const busy = loading || refreshing;

  return (
    <section
      aria-label="Active studio ports"
      className="@container flex min-h-0 min-w-0 flex-1 flex-col wrap-anywhere"
    >
      <div role="status" className="sr-only">
        {copyMessage || (refreshing ? "Scanning active studios…" : (summary?.label ?? ""))}
      </div>
      <div className="flex-none px-4 py-3">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
            <h2 className="text-sm leading-relaxed font-semibold">Studio ports</h2>
            <p dir="auto" className="text-muted-foreground text-ui leading-relaxed tabular-nums">
              {summary ? summary.label : "Find an active studio and open its link."}
            </p>
            {scannedLabel && (
              <span
                dir="auto"
                className="text-muted-foreground text-ui leading-relaxed tabular-nums"
                title={scanClock}
              >
                {scannedLabel}
                {snapshot &&
                  (snapshot.tailscale.available ? " · Tailscale on" : " · Tailscale off")}
              </span>
            )}
          </div>
          <Button
            ref={refreshRef}
            className="shrink-0"
            variant="secondary"
            size="md"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) handleRefresh();
            }}
            aria-label="Refresh studio ports"
          >
            <RefreshCw
              aria-hidden
              data-icon="inline-start"
              className={cn(busy && "motion-safe:animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </div>
      <Separator />

      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>Could not scan studio ports</AlertTitle>
              <AlertDescription size="ui">
                <div className="flex flex-col gap-2">
                  <span>{error}</span>
                  <div>
                    <Button variant="secondary" size="md" disabled={busy} onClick={handleRefresh}>
                      Retry
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {loading && !snapshot && (
            <p role="status" className="text-muted-foreground py-5 text-sm leading-relaxed">
              Scanning active studios…
            </p>
          )}

          {snapshot && snapshot.studios.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {snapshot.warnings.length > 0 ? (
                    <TriangleAlert aria-hidden />
                  ) : (
                    <Network aria-hidden />
                  )}
                </EmptyMedia>
                <EmptyTitle>
                  {snapshot.warnings.length > 0
                    ? "Could not list studio ports"
                    : "No active studios found"}
                </EmptyTitle>
                <EmptyDescription>
                  {snapshot.warnings.length > 0
                    ? "Check the scan warnings below and retry."
                    : "Start a live-studio server in a worktree, then refresh to inspect its local and Tailscale links."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="secondary" size="md" disabled={busy} onClick={handleRefresh}>
                  Refresh scan
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {sortedStudios.length > 0 && (
            <div className="flex flex-col gap-4 pt-4">
              {sortedStudios.map((studio) => (
                <StudioEntry
                  key={studio.id}
                  studio={studio}
                  copiedKey={copiedKey}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          )}

          {snapshot && !snapshot.tailscale.available && (
            <Alert variant="warn">
              <TriangleAlert aria-hidden />
              <AlertTitle>Tailscale serve unavailable</AlertTitle>
              <AlertDescription size="ui">
                {snapshot.tailscale.error ??
                  "Tailscale status could not be read. Check that Tailscale is running, then refresh. You can still try a local link."}
              </AlertDescription>
            </Alert>
          )}

          {snapshot && snapshot.warnings.length > 0 && (
            <Alert variant="warn">
              <TriangleAlert aria-hidden />
              <AlertTitle>Scan warnings</AlertTitle>
              <AlertDescription size="ui">
                <ul className="flex flex-col gap-0.5">
                  {snapshot.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {snapshot && snapshot.tailscale.unmatched.length > 0 && (
            <Collapsible open={unmatchedOpen} onOpenChange={setUnmatchedOpen}>
              <div className="flex flex-col">
                <CollapsibleTrigger
                  render={<Button variant="secondary" size="row" />}
                  className="w-full justify-between"
                >
                  <span className="tabular-nums">
                    Other Tailscale routes ({snapshot.tailscale.unmatched.length})
                  </span>
                  <ChevronDown
                    aria-hidden
                    data-icon="inline-end"
                    className={cn(
                      "motion-safe:transition-transform motion-safe:duration-150",
                      unmatchedOpen && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent variant="animated">
                  <div className="flex flex-col gap-4 pt-4">
                    {snapshot.tailscale.unmatched.map((route) => (
                      <UrlActionRow
                        key={`${route.host}:${route.url}:${route.targetPort}`}
                        label={`Forwarded to localhost:${route.targetPort}`}
                        url={route.url}
                        copyKey={`unmatched:${route.url}:${route.targetPort}`}
                        copiedKey={copiedKey}
                        onCopy={handleCopy}
                        emptyText="Unsafe Tailscale URL blocked"
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}
        </div>
      </div>
    </section>
  );
}
