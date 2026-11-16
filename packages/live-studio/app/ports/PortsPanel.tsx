import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  GitBranch,
  Network,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import {
  describeWorktree,
  fetchPortsSnapshot,
  formatRelativeScanAge,
  formatScanClock,
  getCachedPortsSnapshot,
  type PortsSnapshot,
  safeHttpUrl,
  setCachedPortsSnapshot,
  shouldSkipBackgroundRefresh,
  sortStudios,
  type StudioPort,
  summarizeSnapshot,
} from "./ports";

const COPY_FEEDBACK_MS = 1800;
const CLOCK_TICK_MS = 30_000;

interface LinkBadge {
  text: string;
  variant: "done" | "check" | "tag";
  title: string;
}

const tailscaleHealthBadge = (allowed: boolean | null): LinkBadge => {
  if (allowed === true) {
    return { text: "OK", variant: "done", title: "Host allowed in .live_hosts" };
  }
  if (allowed === false) {
    return {
      text: "Warn: host not in .live_hosts",
      variant: "check",
      title: "Host is not listed in .live_hosts",
    };
  }
  return { text: ".live_hosts unknown", variant: "tag", title: "Could not verify .live_hosts" };
};

function UrlActionRow({
  label,
  url,
  copyKey,
  copiedKey,
  onCopy,
  badge,
  emptyText,
}: {
  label: string;
  url: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, safeUrl: string) => void;
  badge?: LinkBadge;
  emptyText: string;
}) {
  const safeUrl = safeHttpUrl(url);
  const copied = copiedKey === copyKey;
  return (
    <div className="bg-surface-subtle border-hairline flex flex-col gap-1 rounded-md border px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-label text-xs font-medium">{label}</span>
        {badge && (
          <Badge variant={badge.variant} title={badge.title}>
            {badge.text}
          </Badge>
        )}
      </div>
      {safeUrl ? (
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="text-foreground min-w-0 flex-1 truncate font-mono text-xs"
            title={safeUrl}
          >
            {safeUrl}
          </span>
          <Tip label={copied ? "Copied" : `Copy ${label.toLowerCase()} URL`}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? `Copied ${safeUrl}` : `Copy ${safeUrl}`}
              onClick={() => onCopy(copyKey, safeUrl)}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </Tip>
          <Tip label={`Open ${label.toLowerCase()} URL in new tab`}>
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${safeUrl} in new tab`}
                />
              }
            >
              <ExternalLink aria-hidden />
            </Button>
          </Tip>
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">{emptyText}</span>
      )}
    </div>
  );
}

function WorktreeRow({ studio }: { studio: StudioPort }) {
  const wt = describeWorktree(studio);
  if (wt.kind === "matched") {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5" title={wt.path}>
        <GitBranch aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-label truncate font-mono">{wt.branch}</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span className="truncate">{wt.worktreeName}</span>
        {wt.isMain && <Badge variant="tag">main</Badge>}
        {wt.inferred && <Badge variant="tag">inferred</Badge>}
      </span>
    );
  }
  if (wt.kind === "ambiguous") {
    return (
      <span className="text-warn-text flex min-w-0 items-start gap-1.5">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 wrap-break-word">
          Ambiguous worktree: {wt.candidates.map((c) => `${c.branch} (${c.name})`).join(", ")}
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <GitBranch aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
      <span>Worktree unknown</span>
    </span>
  );
}

function StudioCard({
  studio,
  copiedKey,
  onCopy,
}: {
  studio: StudioPort;
  copiedKey: string | null;
  onCopy: (key: string, safeUrl: string) => void;
}) {
  const tone =
    studio.status === "unreachable" || studio.status === "error"
      ? "check"
      : studio.current
        ? "selected"
        : "default";
  const notes = studio.notes;
  const hasNotes = notes !== null && notes.total > 0;

  return (
    <Card size="sm" tone={tone}>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <CardTitle className="min-w-0">
            <span className="block truncate" title={studio.film ?? "Unknown film"}>
              {studio.film ?? "Unknown film"}
            </span>
          </CardTitle>
          <Badge variant="tag-mono">:{studio.port}</Badge>
          {studio.ratio && <Badge variant="tag-mono">{studio.ratio}</Badge>}
          {studio.current && <Badge variant="open">This studio</Badge>}
          {studio.status === "error" && <Badge variant="check">Error</Badge>}
          {studio.status === "unreachable" && <Badge variant="destructive">Unreachable</Badge>}
        </div>
        <CardDescription>
          <WorktreeRow studio={studio} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {hasNotes && (
            <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
              {notes.open > 0 && <Badge variant="open">{notes.open} open</Badge>}
              {notes.check > 0 && <Badge variant="check">{notes.check} check</Badge>}
              {notes.done > 0 && <Badge variant="done">{notes.done} done</Badge>}
              {notes.open === 0 && notes.check === 0 && notes.done === 0 && (
                <Badge variant="tag">{notes.total} notes</Badge>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <UrlActionRow
              label="Local"
              url={studio.localUrl}
              copyKey={`local:${studio.id}`}
              copiedKey={copiedKey}
              onCopy={onCopy}
              emptyText="Unsafe local URL blocked"
            />
            {studio.tailscale.length === 0 ? (
              <div className="flex items-center justify-between gap-2 px-1 text-xs">
                <span className="text-label font-medium">Tailscale</span>
                <span className="text-muted-foreground">No Tailscale route</span>
              </div>
            ) : (
              studio.tailscale.map((ep) => (
                <UrlActionRow
                  key={`${studio.id}:${ep.url}`}
                  label="Tailscale"
                  url={ep.url}
                  copyKey={`ts:${studio.id}:${ep.url}`}
                  copiedKey={copiedKey}
                  onCopy={onCopy}
                  badge={tailscaleHealthBadge(ep.allowed)}
                  emptyText="Unsafe Tailscale URL blocked"
                />
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const reqSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<"auto" | "force" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!navigator.clipboard?.writeText) {
      toast.add({
        title: "Clipboard unavailable",
        description: "Copy requires localhost or HTTPS.",
        type: "error",
      });
      return;
    }
    void navigator.clipboard
      .writeText(safeUrl)
      .then(() => {
        setCopiedKey(key);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS);
      })
      .catch(() => {
        toast.add({
          title: "Could not copy URL",
          description: safeUrl,
          type: "error",
        });
      });
  }, []);

  const summary = snapshot ? summarizeSnapshot(snapshot) : null;
  const scannedLabel = snapshot ? formatRelativeScanAge(snapshot.scannedAt, now) : "";
  const scanClock = snapshot ? formatScanClock(snapshot.scannedAt) : "";
  const sortedStudios = snapshot ? sortStudios(snapshot.studios) : [];
  const busy = loading || refreshing;

  return (
    <section aria-label="Active studio ports" className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/70 flex flex-none items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ui text-foreground font-medium tabular-nums">
              {summary ? summary.label : "Studio ports"}
            </span>
            {snapshot &&
              (snapshot.tailscale.available ? (
                <Badge variant="done">Tailscale on</Badge>
              ) : (
                <Badge variant="check">Tailscale off</Badge>
              ))}
          </div>
          {scannedLabel && (
            <span className="text-muted-foreground text-xs tabular-nums" title={scanClock}>
              {scannedLabel}
            </span>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={handleRefresh}
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

      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">
        <div className="flex flex-col gap-2.5">
          {error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>Could not scan studio ports</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-2">
                  <span>{error}</span>
                  <div>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={handleRefresh}>
                      Retry
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {loading && !snapshot && (
            <p className="text-muted-foreground py-4 text-xs">Scanning active studios…</p>
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
                <Button variant="secondary" size="sm" disabled={busy} onClick={handleRefresh}>
                  Refresh scan
                </Button>
              </EmptyContent>
            </Empty>
          )}

          {sortedStudios.map((studio) => (
            <StudioCard key={studio.id} studio={studio} copiedKey={copiedKey} onCopy={handleCopy} />
          ))}

          {snapshot && !snapshot.tailscale.available && (
            <Alert variant="warn">
              <TriangleAlert aria-hidden />
              <AlertTitle>Tailscale serve unavailable</AlertTitle>
              <AlertDescription>
                {snapshot.tailscale.error ??
                  "Tailscale status could not be read. Local studio URLs remain active."}
              </AlertDescription>
            </Alert>
          )}

          {snapshot && snapshot.warnings.length > 0 && (
            <Alert variant="warn">
              <TriangleAlert aria-hidden />
              <AlertTitle>Scan warnings</AlertTitle>
              <AlertDescription>
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
              <div className="border-hairline flex flex-col rounded-lg border">
                <CollapsibleTrigger
                  render={<Button variant="ghost" size="sm" />}
                  className="w-full justify-between"
                >
                  <span className="tabular-nums">
                    Other Tailscale routes ({snapshot.tailscale.unmatched.length})
                  </span>
                  <ChevronDown
                    aria-hidden
                    data-icon="inline-end"
                    className={cn(
                      "transition-transform duration-150 motion-reduce:transition-none",
                      unmatchedOpen && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-hairline flex flex-col gap-1.5 border-t p-2">
                    {snapshot.tailscale.unmatched.map((route) => (
                      <UrlActionRow
                        key={`${route.host}:${route.url}:${route.targetPort}`}
                        label={`→ localhost:${route.targetPort}`}
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
