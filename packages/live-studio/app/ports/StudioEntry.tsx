import {
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  GitBranch,
  MapPin,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { describeWorktree, safeHttpUrl, type StudioPort } from "./ports";

interface LinkHealth {
  text: string;
  allowed: boolean | null;
}

export function UrlActionRow({
  label,
  url,
  copyKey,
  copiedKey,
  onCopy,
  health,
  emptyText,
}: {
  label: string;
  url: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, safeUrl: string) => void;
  health?: LinkHealth;
  emptyText: string;
}) {
  const safeUrl = safeHttpUrl(url);
  const copied = copiedKey === copyKey;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <div className="text-ui flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <span className="text-muted-foreground">{label}</span>
          {health && health.allowed !== true && (
            <span className="text-warn-text inline-flex min-w-0 items-start gap-1.5 wrap-anywhere">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {health.text}
            </span>
          )}
        </div>
        {safeUrl && (
          <Tip label={copied ? "Copied" : `Copy ${label.toLowerCase()} URL`}>
            <Button
              variant="secondary"
              size="icon-lg"
              aria-label={copied ? `Copied ${safeUrl}` : `Copy ${safeUrl}`}
              onClick={() => onCopy(copyKey, safeUrl)}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </Tip>
        )}
      </div>
      {safeUrl ? (
        <div className="flex min-w-0 items-start gap-2">
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label.toLowerCase()} ${safeUrl} in new tab`}
            className="text-primary-text focus-visible:ring-ring flex min-w-0 flex-1 items-start gap-1.5 rounded-sm py-1 font-mono text-sm leading-relaxed wrap-anywhere underline decoration-from-font underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            <bdi className="min-w-0">{safeUrl}</bdi>
            <ExternalLink aria-hidden className="mt-1 size-3.5 shrink-0" />
          </a>
        </div>
      ) : (
        <span className="text-warn-text text-sm leading-relaxed">{emptyText}</span>
      )}
    </div>
  );
}

function WorktreeRow({ studio }: { studio: StudioPort }) {
  const wt = describeWorktree(studio);
  if (wt.kind === "matched") {
    return (
      <div className="flex min-w-0 items-start gap-2">
        <GitBranch aria-hidden className="text-muted-foreground mt-1 size-4 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1 text-sm leading-relaxed wrap-anywhere">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p>
              <bdi>{wt.worktreeName}</bdi>
              {wt.isMain && <span className="text-muted-foreground"> · main</span>}
            </p>
            <p className="text-muted-foreground text-ui font-mono">
              <bdi>{wt.branch}</bdi>
            </p>
          </div>
          {wt.inferred && (
            <p className="text-warn-text text-ui">Worktree inferred from the project path</p>
          )}
          <details>
            <summary className="text-muted-foreground focus-visible:ring-ring text-ui w-fit cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:outline-none">
              Folder path
            </summary>
            <p className="text-muted-foreground text-ui pt-1 font-mono">
              <bdi>{wt.path}</bdi>
            </p>
          </details>
        </div>
      </div>
    );
  }
  return (
    <div className="text-warn-text flex min-w-0 items-start gap-2 text-sm leading-relaxed wrap-anywhere">
      <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
      <div className="min-w-0">
        <p>
          {wt.kind === "ambiguous"
            ? `Ambiguous worktree: ${wt.candidates.map((c) => `${c.branch} (${c.name})`).join(", ")}. Check the project folder before opening.`
            : "Worktree unknown. Check the project folder before opening."}
        </p>
        {studio.project && (
          <p className="text-muted-foreground text-ui mt-1 font-mono">
            <bdi>{studio.project}</bdi>
          </p>
        )}
      </div>
    </div>
  );
}

export function StudioEntry({
  studio,
  copiedKey,
  onCopy,
}: {
  studio: StudioPort;
  copiedKey: string | null;
  onCopy: (key: string, safeUrl: string) => void;
}) {
  const notes = studio.notes;
  return (
    <article
      aria-label={`${studio.film ?? "Unknown film"}, port ${studio.port}`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border p-4",
        studio.current
          ? "border-primary/60 bg-tint"
          : studio.status === "ready"
            ? "border-hairline-strong bg-card"
            : "border-warn/40 bg-warn-bg",
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3
            className={cn(
              "font-mono text-xl leading-tight font-semibold tabular-nums",
              studio.current && "text-primary-text",
            )}
          >
            Port {studio.port}
          </h3>
          {studio.current && (
            <span className="text-primary-text inline-flex items-center gap-1.5 text-sm font-medium">
              <MapPin aria-hidden className="size-4" />
              This studio
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="min-w-0 text-base leading-relaxed font-medium wrap-anywhere">
            <bdi>{studio.film ?? "Unknown film"}</bdi>
          </p>
          {studio.ratio && <span className="text-muted-foreground text-ui">{studio.ratio}</span>}
          <span
            className={cn(
              "text-ui ms-auto inline-flex items-center gap-1.5",
              studio.status === "ready" ? "text-ok-text" : "text-warn-text",
            )}
          >
            {studio.status === "ready" ? (
              <CircleCheck aria-hidden className="size-3.5" />
            ) : (
              <TriangleAlert aria-hidden className="size-3.5" />
            )}
            {studio.status === "ready"
              ? "Ready"
              : studio.status === "error"
                ? "Error · refresh to check again"
                : "Unreachable · refresh to check again"}
          </span>
        </div>
      </div>
      <WorktreeRow studio={studio} />
      {notes !== null && notes.total > 0 && (
        <p dir="auto" className="text-ui leading-relaxed tabular-nums">
          <span className="text-muted-foreground">Notes · </span>
          <span className="text-primary-text">{notes.open} open</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-warn-text">{notes.check} check</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-ok-text">{notes.done} done</span>
        </p>
      )}
      <div className="grid min-w-0 gap-3 @min-[800px]:grid-cols-2">
        <UrlActionRow
          label="Local"
          url={studio.localUrl}
          copyKey={`local:${studio.id}`}
          copiedKey={copiedKey}
          onCopy={onCopy}
          emptyText="Unsafe local URL blocked"
        />
        {studio.tailscale.length === 0 ? (
          <p className="text-muted-foreground py-1 text-sm leading-relaxed">No Tailscale route</p>
        ) : (
          studio.tailscale.map((ep) => (
            <UrlActionRow
              key={`${studio.id}:${ep.url}`}
              label="Tailscale"
              url={ep.url}
              copyKey={`ts:${studio.id}:${ep.url}`}
              copiedKey={copiedKey}
              onCopy={onCopy}
              health={{
                allowed: ep.allowed,
                text:
                  ep.allowed === false
                    ? "Host not allowed. Ask AI to enable this link for this film."
                    : "Host access not verified. Use the local link if this one fails.",
              }}
              emptyText="Unsafe Tailscale URL blocked"
            />
          ))
        )}
      </div>
    </article>
  );
}
