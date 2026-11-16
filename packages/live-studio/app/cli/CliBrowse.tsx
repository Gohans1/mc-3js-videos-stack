import {
  AlertTriangle,
  Bookmark,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";

import { SearchBox } from "@/components/SearchBox";
import { Tip } from "@/components/Tip";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { showUndo } from "@/components/ui/toast";

import type {
  CliCatalogResponse,
  CliCategoryId,
  CliCommand,
  CliRunSnapshot,
  CliTemplate,
} from "../../src/cli-catalog.ts";
import { HorizontalScrollRail } from "../sound/HorizontalScrollRail";
import { CliHazardBadges } from "./CliBadges";
import { CliRunCompactBadge, formatDurationMs } from "./CliConsole";
import {
  buildTemplatePreviewCommand,
  filterCommands,
  filterTemplates,
  resolveFieldTextSearch,
} from "./model";

export function CliBrowse({
  catalog,
  templates,
  searchQuery,
  selectedCategory,
  activeRun,
  lastRun,
  stoppingRunId = null,
  runError = null,
  catalogError = null,
  templatesError = null,
  onDismissRunError,
  onDismissCatalogError,
  onDismissTemplatesError,
  onRetryCatalog,
  onSearchChange,
  onSelectCategory,
  onRefreshCatalog,
  onOpenCommand,
  onRunTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onRestoreTemplate,
  onStopRun,
}: {
  catalog: CliCatalogResponse;
  templates: readonly CliTemplate[];
  searchQuery: string;
  selectedCategory: CliCategoryId | "all";
  activeRun: CliRunSnapshot | null;
  lastRun: CliRunSnapshot | null;
  stoppingRunId?: string | null;
  runError?: string | null;
  catalogError?: string | null;
  templatesError?: string | null;
  onDismissRunError?: () => void;
  onDismissCatalogError?: () => void;
  onDismissTemplatesError?: () => void;
  onRetryCatalog?: () => void;
  onSearchChange: (q: string) => void;
  onSelectCategory: (cat: CliCategoryId | "all") => void;
  onRefreshCatalog?: () => void;
  onOpenCommand: (commandId: string, opts?: { focusRunId?: string }) => void;
  onRunTemplate: (template: CliTemplate) => void;
  onEditTemplate: (template: CliTemplate) => void;
  onDeleteTemplate: (template: CliTemplate) => Promise<boolean>;
  onRestoreTemplate: (template: CliTemplate) => Promise<boolean>;
  onStopRun: (runId: string) => void;
}) {
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const cmd of catalog.commands) {
      map.set(cmd.id, resolveFieldTextSearch(cmd));
    }
    return map;
  }, [catalog.commands]);

  const filteredBySearch = useMemo(
    () => filterCommands(catalog.commands, searchQuery, "all", searchIndex),
    [catalog.commands, searchQuery, searchIndex],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<CliCategoryId, number>();
    for (const cmd of filteredBySearch) {
      counts.set(cmd.category, (counts.get(cmd.category) ?? 0) + 1);
    }
    return counts;
  }, [filteredBySearch]);

  const filteredTemplates = useMemo(
    () => filterTemplates(templates, searchQuery),
    [templates, searchQuery],
  );

  const filteredCommands = useMemo(
    () =>
      selectedCategory === "all"
        ? filteredBySearch
        : filteredBySearch.filter((cmd) => cmd.category === selectedCategory),
    [filteredBySearch, selectedCategory],
  );

  const groupedCommands = useMemo(() => {
    const byCat = new Map<CliCategoryId, CliCommand[]>();
    for (const cmd of filteredCommands) {
      const list = byCat.get(cmd.category) ?? [];
      list.push(cmd);
      byCat.set(cmd.category, list);
    }
    return catalog.categories
      .map((cat) => ({ category: cat, commands: byCat.get(cat.id) ?? [] }))
      .filter((g) => g.commands.length > 0);
  }, [catalog.categories, filteredCommands]);

  const bannerRun = activeRun ?? lastRun;
  const isStoppingBanner = Boolean(bannerRun && stoppingRunId === bannerRun.runId);

  const handleDelete = async (tpl: CliTemplate) => {
    const ok = await onDeleteTemplate(tpl);
    if (!ok) return;
    showUndo(`Removed template "${tpl.name}"`, () => {
      void onRestoreTemplate(tpl);
    });
  };

  const browseAlerts = [
    { key: "run", title: "Command failed", message: runError, onDismiss: onDismissRunError },
    {
      key: "catalog",
      title: "Could not refresh CLI catalog",
      message: catalogError,
      onRetry: onRetryCatalog,
      onDismiss: onDismissCatalogError,
    },
    {
      key: "templates",
      title: "Template action failed",
      message: templatesError,
      onRetry: onRetryCatalog,
      onDismiss: onDismissTemplatesError,
    },
  ].filter((a): a is typeof a & { message: string } => Boolean(a.message));

  return (
    <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {browseAlerts.map((alert) => (
        <Alert key={alert.key} variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.message}</AlertDescription>
          {(alert.onRetry || alert.onDismiss) && (
            <AlertAction>
              {alert.onRetry && (
                <Button variant="ghost" size="xs" onClick={alert.onRetry}>
                  <RefreshCw aria-hidden />
                  Retry
                </Button>
              )}
              {alert.onDismiss && (
                <Button variant="ghost" size="xs" onClick={alert.onDismiss}>
                  Dismiss
                </Button>
              )}
            </AlertAction>
          )}
        </Alert>
      ))}

      {bannerRun && (
        <div className="bg-card border-hairline flex min-w-0 items-center justify-between gap-2 rounded-xl border px-2.5 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <CliRunCompactBadge
                run={bannerRun}
                isStopping={isStoppingBanner}
                donePrefix="Last · "
              />
              {bannerRun.durationMs !== undefined && (
                <span className="text-tag text-muted-foreground font-mono tabular-nums">
                  {formatDurationMs(bannerRun.durationMs)}
                </span>
              )}
            </div>
            <span
              title={bannerRun.displayCommand}
              className="text-tag text-muted-foreground truncate font-mono"
            >
              {bannerRun.displayCommand}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => onOpenCommand(bannerRun.commandId, { focusRunId: bannerRun.runId })}
            >
              Output
            </Button>
            {bannerRun.status === "running" && (
              <Button
                variant="destructive"
                size="xs"
                disabled={isStoppingBanner}
                onClick={() => onStopRun(bannerRun.runId)}
              >
                {isStoppingBanner ? (
                  <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Square aria-hidden />
                )}
                {isStoppingBanner ? "Stopping…" : "Stop"}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-w-0 items-center gap-1.5">
        <SearchBox
          name="cli-search"
          value={searchQuery}
          label="Search CLI commands"
          placeholder="Search commands, flags, or descriptions…"
          onChange={onSearchChange}
          onEscape={() => onSearchChange("")}
          className="min-w-0 flex-1"
        />
        {onRefreshCatalog && (
          <Tip label="Refresh catalog & choices">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh CLI catalog and dynamic choices"
              onClick={onRefreshCatalog}
            >
              <RefreshCw aria-hidden />
            </Button>
          </Tip>
        )}
      </div>

      <HorizontalScrollRail
        label="CLI categories"
        leftLabel="Scroll CLI categories left"
        rightLabel="Scroll CLI categories right"
        groupRole="group"
        edgesKey={catalog.categories.map((c) => c.id).join(",")}
        className="gap-1"
      >
        <Button
          variant="tab"
          size="xs"
          aria-pressed={selectedCategory === "all"}
          onClick={() => onSelectCategory("all")}
        >
          All ({filteredBySearch.length})
        </Button>
        {catalog.categories.map((cat) => (
          <Button
            key={cat.id}
            variant="tab"
            size="xs"
            aria-pressed={selectedCategory === cat.id}
            onClick={() => onSelectCategory(cat.id)}
          >
            {cat.label} ({categoryCounts.get(cat.id) ?? 0})
          </Button>
        ))}
      </HorizontalScrollRail>

      {/* Saved Templates */}
      {(!searchQuery.trim() || filteredTemplates.length > 0) && (
        <section aria-label="Saved templates" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="text-ui flex items-center gap-1.5 font-semibold">
              <Bookmark aria-hidden className="text-primary-text size-3.5" />
              <span>Saved templates</span>
            </h3>
            <span className="text-tag text-muted-foreground tabular-nums">
              {filteredTemplates.length}
            </span>
          </div>

          {filteredTemplates.length === 0 ? (
            <p className="bg-card border-hairline text-tag text-muted-foreground rounded-xl border border-dashed px-3 py-2.5">
              Configure any command below and click{" "}
              <strong className="text-foreground font-medium">Save template</strong> to pin 1-click
              re-runs here.
            </p>
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              {filteredTemplates.map((tpl) => {
                const { display, spec } = buildTemplatePreviewCommand(tpl, catalog.context);
                const unavailable = !spec;
                const templateTargetLabel = spec?.command.packageDir
                  ? spec.command.packageDir
                  : tpl.targetFilm === "active"
                    ? "active film"
                    : tpl.targetFilm === "root"
                      ? "repo root"
                      : tpl.targetFilm;
                const disabledReason = unavailable
                  ? `Unavailable command: ${tpl.commandId}`
                  : (spec.guardReason ?? spec.validationErrors[0]);
                return (
                  <div
                    key={tpl.id}
                    className="bg-card border-hairline flex min-w-0 flex-col gap-1.5 rounded-xl border p-2.5"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span
                            title={tpl.name}
                            className="text-ui text-foreground max-w-full truncate font-medium"
                          >
                            {tpl.name}
                          </span>
                          <Badge
                            variant="tag"
                            title={templateTargetLabel}
                            className="max-w-full min-w-0 shrink"
                          >
                            <span className="min-w-0 truncate">{templateTargetLabel}</span>
                          </Badge>
                          {unavailable && (
                            <Badge
                              variant="destructive"
                              title={`Command "${tpl.commandId}" is missing from the current CLI catalog`}
                            >
                              Unavailable
                            </Badge>
                          )}
                        </div>
                        <code
                          title={display}
                          className="text-tag text-muted-foreground truncate font-mono"
                        >
                          {display}
                        </code>
                      </div>
                      {spec && <CliHazardBadges meta={spec.meta} compact />}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Tip label="Remove template">
                        <Button
                          variant="remove"
                          size="icon-xs"
                          aria-label={`Delete template ${tpl.name}`}
                          onClick={() => void handleDelete(tpl)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </Tip>
                      <Button
                        variant="secondary"
                        size="xs"
                        aria-label={`Edit template ${tpl.name}`}
                        title={unavailable ? disabledReason : undefined}
                        disabled={unavailable}
                        onClick={() => onEditTemplate(tpl)}
                      >
                        <SlidersHorizontal aria-hidden />
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        aria-label={`${spec?.requiresConfirm ? "Review & Run" : "Run"} template ${tpl.name}`}
                        title={disabledReason}
                        disabled={
                          !spec ||
                          Boolean(activeRun) ||
                          Boolean(spec.guardReason) ||
                          Boolean(spec.validationErrors.length)
                        }
                        onClick={() => onRunTemplate(tpl)}
                      >
                        <Play aria-hidden />
                        {spec?.requiresConfirm ? "Review & Run" : "Run"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Categorized Command Directory */}
      {groupedCommands.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Terminal aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No matching CLI commands</EmptyTitle>
            <EmptyDescription>
              No command, subcommand, or flag matched &ldquo;{searchQuery}&rdquo;.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onSearchChange("");
                onSelectCategory("all");
              }}
            >
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {groupedCommands.map(({ category, commands }) => (
            <section
              key={category.id}
              aria-label={category.label}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <div className="flex flex-col gap-0.5 px-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-ui text-foreground font-semibold">{category.label}</h3>
                  <span className="text-tag text-muted-foreground tabular-nums">
                    {commands.length}
                  </span>
                </div>
                <p className="text-tag text-muted-foreground">{category.description}</p>
              </div>

              <div className="bg-card border-hairline divide-hairline-subtle flex min-w-0 flex-col divide-y overflow-hidden rounded-xl border">
                {commands.map((cmd) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => onOpenCommand(cmd.id)}
                    className="hover:bg-surface-subtle focus-visible:ring-ring flex min-h-11 w-full min-w-0 flex-col gap-1 px-2.5 py-2 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="text-ui text-foreground font-mono font-semibold">
                          {cmd.label}
                        </span>
                        {cmd.subcommands?.length ? (
                          <Badge variant="tag">{cmd.subcommands.length} sub</Badge>
                        ) : null}
                      </div>
                      <ChevronRight
                        aria-hidden
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                    </div>
                    <p className="text-tag text-muted-foreground line-clamp-2">{cmd.summary}</p>
                    <CliHazardBadges meta={cmd.meta} compact />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
