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

export function PortsPanel({
  initialSnapshot = null,
}: {
  initialSnapshot?: PortsSnapshot | null;
} = {}) {
  const [snapshot, setSnapshot] = useState<PortsSnapshot | null>(
    () => initialSnapshot ?? getCachedPortsSnapshot(),
  );
  const [loading, setLoading] = useState(
    () => initialSnapshot === null && getCachedPortsSnapshot() === null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const reqSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<"auto" | "force" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);

  const executeFetch = useCallback((forceRefresh: boolean) => {
    const seq = ++reqSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = forceRefresh ? "force" : "auto";

    void fetchPortsSnapshot({
      refresh: forceRefresh,
      signal: controller.signal,
    }).then(
      (next) => {
        if (controller.signal.aborted || seq !== reqSeqRef.current) return;
        inFlightRef.current = null;
        setCachedPortsSnapshot(next);
        setSnapshot(next);
        setError(null);
        setNow(Date.now());
        setLoading(false);
        setRefreshing(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted || seq !== reqSeqRef.current) return;
        inFlightRef.current = null;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        setRefreshing(false);
      },
    );
  }, []);

  const handleRefresh = useCallback(() => {
    refreshRef.current?.focus();
    setCopyMessage("");
    setRefreshing(true);
    setError(null);
    executeFetch(true);
  }, [executeFetch]);

  useEffect(() => {
    if (initialSnapshot === null) {
      executeFetch(false);
    }
    const onFocusOrVisible = () => {
      if (
        shouldSkipBackgroundRefresh({
          visibilityState: document.visibilityState,
          inFlight: inFlightRef.current,
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
      abortRef.current?.abort();
      inFlightRef.current = null;
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      clearInterval(clockTimer);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, [executeFetch, initialSnapshot]);

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
