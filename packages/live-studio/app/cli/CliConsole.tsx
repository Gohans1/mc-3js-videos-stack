import {
  AlertTriangle,
  ArrowDown,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
  Square,
  Terminal,
  Trash2,
  WrapText,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Tip } from "@/components/Tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CliRunSnapshot } from "../../src/cli-catalog.ts";

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function StatusBadge({ run, isStopping }: { run: CliRunSnapshot | null; isStopping?: boolean }) {
  if (!run) {
    return (
      <Badge variant="tag">
        <Terminal aria-hidden />
        Ready
      </Badge>
    );
  }
  if (run.status === "running") {
    return (
      <Badge variant={isStopping ? "check" : "open"}>
        <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
        {isStopping ? "Stopping…" : "Running"}
      </Badge>
    );
  }
  if (run.status === "stopped") {
    return (
      <Badge variant="check">
        <Square aria-hidden />
        Stopped{run.signal ? ` (${run.signal})` : ""}
      </Badge>
    );
  }
  if (run.status === "error") {
    return (
      <Badge variant="destructive">
        <XCircle aria-hidden />
        Failed
      </Badge>
    );
  }
  if (run.exitCode === 0) {
    return (
      <Badge variant="done">
        <CheckCircle2 aria-hidden />
        Exit 0
      </Badge>
    );
  }
  if (run.exitCode === 2) {
    return (
      <Badge variant="check">
        <AlertTriangle aria-hidden />
        Exit 2 · Usage
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle aria-hidden />
      Exit {run.exitCode ?? 1}
    </Badge>
  );
}

/** Compact run status pill shared across the Browse banner and compact workbench tab. */
export function CliRunCompactBadge({
  run,
  isStopping = false,
  donePrefix = "",
  compact = false,
}: {
  run: CliRunSnapshot;
  isStopping?: boolean;
  donePrefix?: string;
  compact?: boolean;
}) {
  if (run.status === "running") {
    return (
      <Badge variant={isStopping ? "check" : "open"}>
        <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
        {isStopping ? (compact ? "Stopping" : "Stopping…") : compact ? "Live" : "Running"}
      </Badge>
    );
  }
  if (run.status === "stopped") {
    return <Badge variant="check">Stopped</Badge>;
  }
  if (run.status === "error") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (run.exitCode === 0) {
    return <Badge variant="done">{donePrefix}Exit 0</Badge>;
  }
  if (run.exitCode === 2) {
    return <Badge variant="check">Exit 2</Badge>;
  }
  return <Badge variant="destructive">Exit {run.exitCode ?? 1}</Badge>;
}

export function buildVerbatimCopyText(run: CliRunSnapshot | null): string {
  if (!run) return "";
  const raw = run.output.map((item) => item.chunk).join("");
  return [raw, run.error].filter(Boolean).join("\n");
}

export function CliConsole({
  run,
  expanded,
  compact = false,
  isStopping = false,
  outputsHint,
  onToggleExpand,
  onStop,
  onClear,
}: {
  run: CliRunSnapshot | null;
  expanded: boolean;
  compact?: boolean;
  isStopping?: boolean;
  outputsHint?: string;
  onToggleExpand: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);
  const [pausedRunId, setPausedRunId] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const isRunning = run?.status === "running";
  const followPaused = Boolean(isRunning && run && pausedRunId === run.runId);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [isRunning, run?.runId]);

  const rawText = useMemo(() => (run ? run.output.map((item) => item.chunk).join("") : ""), [run]);
  const groupedOutput = useMemo(() => {
    if (!run?.output.length) return [];
    const groups: { key: number; stream: "stdout" | "stderr"; text: string }[] = [];
    for (const chunk of run.output) {
      const prev = groups.at(-1);
      if (prev && prev.stream === chunk.stream) prev.text += chunk.chunk;
      else groups.push({ key: chunk.seq, stream: chunk.stream, text: chunk.chunk });
    }
    return groups;
  }, [run]);
  const byteLength = useMemo(() => new TextEncoder().encode(rawText).byteLength, [rawText]);

  const elapsedMs = useMemo(() => {
    if (!run) return 0;
    if (run.durationMs !== undefined && run.status !== "running") return run.durationMs;
    return Math.max(0, nowMs - run.startedAt);
  }, [run, nowMs]);

  useEffect(() => {
    stickRef.current = true;
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.runId]);

  useEffect(() => {
    const el = preRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [rawText, run?.runId]);

  const handleScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    stickRef.current = nearBottom;
    setPausedRunId(nearBottom || !run ? null : run.runId);
  };

  const jumpToBottom = () => {
    const el = preRef.current;
    if (!el) return;
    stickRef.current = true;
    setPausedRunId(null);
    el.scrollTop = el.scrollHeight;
  };

  const copyOutput = async () => {
    const text = buildVerbatimCopyText(run);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in restricted browser context; ignore cleanly
    }
  };

  const hasText = rawText.length > 0 || Boolean(run?.error);

  return (
    <section
      aria-label="AI output console"
      className={cn(
        "bg-card border-hairline flex min-w-0 flex-col overflow-hidden rounded-xl border",
        expanded || compact ? "min-h-0 flex-1" : run ? "min-h-[190px] flex-1" : "flex-none",
      )}
    >
      <div className="border-hairline flex min-w-0 flex-wrap items-center justify-between gap-1.5 border-b px-2.5 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge run={run} isStopping={isStopping} />
          {run && (
            <span className="text-tag text-muted-foreground font-mono tabular-nums">
              {formatDurationMs(elapsedMs)}
            </span>
          )}
          {byteLength > 0 && (
            <span className="text-tag text-muted-foreground font-mono tabular-nums">
              {formatByteSize(byteLength)}
            </span>
          )}
          {run?.truncated && <Badge variant="claim">2 MB cap</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isRunning && (
            <Button variant="destructive" size="xs" disabled={isStopping} onClick={onStop}>
              {isStopping ? (
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Square aria-hidden />
              )}
              {isStopping ? "Stopping…" : "Stop"}
            </Button>
          )}
          <Tip label={wrap ? "Disable line wrap" : "Wrap long lines"}>
            <Button
              variant="quiet"
              size="icon-xs"
              aria-label={wrap ? "Disable line wrap" : "Wrap long lines"}
              aria-pressed={wrap}
              onClick={() => setWrap((w) => !w)}
            >
              <WrapText aria-hidden />
            </Button>
          </Tip>
          <Tip label={copied ? "Copied output" : "Copy verbatim output"}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy verbatim output"
              disabled={!hasText}
              onClick={copyOutput}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </Tip>
          <Tip label={expanded ? "Restore builder" : "Expand output"}>
            <Button
              variant="quiet"
              size="icon-xs"
              aria-label={expanded ? "Restore builder" : "Expand output"}
              aria-pressed={expanded}
              onClick={onToggleExpand}
            >
              {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            </Button>
          </Tip>
          <Tip label="Clear output">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear output"
              disabled={!run || isRunning}
              onClick={onClear}
            >
              <Trash2 aria-hidden />
            </Button>
          </Tip>
        </div>
      </div>

      {run && (
        <div className="bg-surface-subtle border-hairline-subtle flex min-w-0 items-center justify-between gap-2 border-b px-2.5 py-1">
          <span
            className="text-tag text-muted-foreground min-w-0 truncate font-mono"
            title={run.cwd}
          >
            cwd: {run.cwd}
          </span>
          {run.mode === "help" && <Badge variant="tag">--help</Badge>}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {!run ? (
          <div className="text-ui text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
            <p className="text-foreground/80 font-medium">No output captured yet</p>
            <p className="text-tag text-muted-foreground max-w-[30ch]">
              Run this command or click Help to see the exact non-TTY stdout/stderr the AI sees.
            </p>
          </div>
        ) : (
          <pre
            ref={preRef}
            role="region"
            tabIndex={0}
            data-arrow-scroll
            aria-label="Verbatim command output"
            onScroll={handleScroll}
            className={cn(
              "bg-backdrop text-tag focus-visible:ring-ring min-h-0 flex-1 overflow-auto p-2.5 font-mono leading-relaxed outline-none focus-visible:ring-2",
              wrap ? "wrap-break-word whitespace-pre-wrap" : "whitespace-pre",
            )}
          >
            {run.output.length === 0 ? (
              run.status === "running" ? (
                <span className="text-muted-foreground">Waiting for output…</span>
              ) : run.error ? (
                <span className="text-destructive">{run.error}</span>
              ) : (
                <span className="text-muted-foreground">
                  (Command finished with empty stdout/stderr)
                </span>
              )
            ) : (
              groupedOutput.map((group) => (
                <span
                  key={group.key}
                  className={group.stream === "stderr" ? "text-warn-text" : "text-foreground"}
                >
                  {group.text}
                </span>
              ))
            )}
            {run.error && run.output.length > 0 && (
              <span className="text-destructive block pt-1">{run.error}</span>
            )}
          </pre>
        )}

        {isRunning && followPaused && (
          <div className="pointer-events-none absolute right-2 bottom-2">
            <Button
              variant="secondary"
              size="xs"
              className="pointer-events-auto"
              onClick={jumpToBottom}
            >
              <ArrowDown aria-hidden />
              Latest
            </Button>
          </div>
        )}
      </div>

      {outputsHint && (
        <div className="border-hairline flex min-w-0 items-center justify-between gap-2 border-t px-2.5 py-1.5">
          <span
            title={outputsHint}
            className="text-tag text-muted-foreground min-w-0 flex-1 truncate"
          >
            {outputsHint}
          </span>
        </div>
      )}
    </section>
  );
}
