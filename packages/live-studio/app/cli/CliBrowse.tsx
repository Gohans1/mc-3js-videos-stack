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
import { type ReactNode, useMemo } from "react";

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
import { TabStage } from "../components/Motion";
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
  panelControls,
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
  panelControls?: ReactNode;
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
    () =>
      filterTemplates(
        templates.filter((template) =>
          ["active", "root", "", catalog.context.activeFilm].includes(template.targetFilm),
        ),
        searchQuery,
      ),
    [templates, searchQuery, catalog.context.activeFilm],
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
    <div
      data-arrow-scroll
      className="font-md flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-heading-foreground text-xl leading-tight font-semibold">
            Command library
          </h2>
          <p className="text-muted-foreground min-w-0 text-sm">
            Current Studio:{" "}
            <span className="text-label font-medium">
              {catalog.context.activeFilm ?? "No film open"}
            </span>
            <span> · {catalog.context.repoName}</span>
          </p>
        </div>
        {panelControls}
      </div>
      {browseAlerts.map((alert) => (
        <Alert key={alert.key} variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.message}</AlertDescription>
          {(alert.onRetry || alert.onDismiss) && (
            <AlertAction>
              {alert.onRetry && (
                <Button variant="ghost" size="comfortable" onClick={alert.onRetry}>
                  <RefreshCw aria-hidden />
                  Retry
                </Button>
              )}
              {alert.onDismiss && (
                <Button variant="ghost" size="comfortable" onClick={alert.onDismiss}>
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
                <span className="text-muted-foreground font-mono text-sm tabular-nums">
                  {formatDurationMs(bannerRun.durationMs)}
                </span>
              )}
            </div>
            <span
              title={bannerRun.displayCommand}
              className="text-muted-foreground truncate font-mono text-sm"
            >
              {bannerRun.displayCommand}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="secondary"
              size="comfortable"
              onClick={() => onOpenCommand(bannerRun.commandId, { focusRunId: bannerRun.runId })}
            >
              Output
            </Button>
            {bannerRun.status === "running" && (
              <Button
                variant="destructive"
                size="comfortable"
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
          placeholder="Find a command, e.g. render or --jev"
          onChange={onSearchChange}
          onEscape={() => onSearchChange("")}
          className="min-w-0 flex-1"
        />
        {onRefreshCatalog && (
          <Tip label="Refresh commands and choices">
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
          variant="choice"
          size="comfortable"
          aria-pressed={selectedCategory === "all"}
          onClick={() => onSelectCategory("all")}
        >
          All ({filteredBySearch.length})
        </Button>
        {catalog.categories.map((cat) => (
          <Button
            key={cat.id}
            variant="choice"
            size="comfortable"
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
            <h3 className="text-heading-foreground flex items-center gap-1.5 text-lg font-semibold">
              <Bookmark aria-hidden className="text-primary-text size-3.5" />
              <span>Saved templates</span>
            </h3>
            <span className="text-muted-foreground text-sm tabular-nums">
              {filteredTemplates.length}
            </span>
          </div>

          {filteredTemplates.length === 0 ? (
            <p className="bg-card border-hairline text-muted-foreground rounded-xl border border-dashed px-3 py-2.5 text-sm">
              Choose a command, set its options, then select{" "}
              <strong className="text-foreground font-medium">Save template</strong> to reuse it
              here.
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
                            className="text-heading-foreground max-w-full truncate text-base font-medium"
                          >
                            {tpl.name}
                          </span>
                          <Badge
                            appearance="text"
                            size="comfortable"
                            variant="tag"
                            title={templateTargetLabel}
                            className="max-w-full min-w-0 shrink"
                          >
                            <span className="min-w-0 truncate">{templateTargetLabel}</span>
                          </Badge>
                          {unavailable && (
                            <Badge
                              appearance="text"
                              size="comfortable"
                              variant="destructive"
                              title={`Command "${tpl.commandId}" is missing from the current CLI catalog`}
                            >
                              Unavailable
                            </Badge>
                          )}
                        </div>
                        <code
                          title={display}
                          className="text-code-foreground truncate font-mono text-sm"
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
                          size="icon-lg"
                          aria-label={`Delete template ${tpl.name}`}
                          onClick={() => void handleDelete(tpl)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </Tip>
                      <Button
                        variant="secondary"
                        size="comfortable"
                        aria-label={`Edit template ${tpl.name}`}
                        title={unavailable ? disabledReason : undefined}
                        disabled={unavailable}
                        onClick={() => onEditTemplate(tpl)}
                      >
                        <SlidersHorizontal aria-hidden />
                        Edit
                      </Button>
                      <Button
                        size="comfortable"
                        aria-label={`${spec?.requiresConfirm ? "Review & run" : "Run"} template ${tpl.name}`}
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
                        {spec?.requiresConfirm ? "Review & run" : "Run"}
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
            <EmptyDescription>No commands match &ldquo;{searchQuery}&rdquo;.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="secondary"
              size="comfortable"
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
        <TabStage
          activeKey={selectedCategory}
          duration={180}
          distance={6}
          className="flex min-w-0 flex-col gap-6"
        >
          {groupedCommands.map(({ category, commands }) => (
            <section
              key={category.id}
              aria-label={category.label}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <div className="flex flex-col gap-0.5 px-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-heading-foreground text-lg font-semibold">
                    {category.label}
                  </h3>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {commands.length}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm leading-normal">
                  {category.description}
                </p>
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
                        <span className="text-code-foreground font-mono text-base font-semibold">
                          {cmd.label}
                        </span>
                        {cmd.subcommands?.length ? (
                          <Badge appearance="text" size="comfortable" variant="tag">
                            {cmd.subcommands.length} sub
                          </Badge>
                        ) : null}
                      </div>
                      <ChevronRight
                        aria-hidden
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                    </div>
                    <p className="text-muted-foreground line-clamp-2 text-sm">{cmd.summary}</p>
                    <CliHazardBadges meta={cmd.meta} compact />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </TabStage>
      )}
    </div>
  );
}
