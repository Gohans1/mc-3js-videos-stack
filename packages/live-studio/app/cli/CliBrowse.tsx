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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { CliRunStatusBadge, formatDurationMs } from "./CliConsole";
import {
  buildTemplatePreviewCommand,
  type CliRunError,
  cliRunErrorCopy,
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
  runError?: CliRunError | null;
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

  const categoryLabel = catalog.categories.find(
    (category) => category.id === selectedCategory,
  )?.label;
  const searchAllCategories = Boolean(categoryLabel && filteredBySearch.length);
  const bannerRun = activeRun ?? lastRun;
  const isStoppingBanner = Boolean(bannerRun && stoppingRunId === bannerRun.runId);

  const handleDelete = async (tpl: CliTemplate) => {
    const ok = await onDeleteTemplate(tpl);
    if (!ok) return;
    showUndo(`Deleted “${tpl.name}”`, () => {
      void onRestoreTemplate(tpl);
    });
  };

  const browseAlerts = [
    {
      key: "run",
      title: runError ? cliRunErrorCopy(runError).title : "",
      recovery: runError ? cliRunErrorCopy(runError).recovery : "",
      message: runError?.message,
      onDismiss: onDismissRunError,
    },
    {
      key: "catalog",
      title: "Could not refresh CLI catalog",
      message: catalogError,
      recovery: "Check Studio’s connection, then retry.",
      onRetry: onRetryCatalog,
      onDismiss: onDismissCatalogError,
    },
    {
      key: "templates",
      title: "Template action failed",
      message: templatesError,
      recovery: "Refresh templates, then try the action again.",
      onRetry: onRetryCatalog,
      onDismiss: onDismissTemplatesError,
    },
  ].filter((a): a is typeof a & { message: string } => Boolean(a.message));

  return (
    <div className="font-md flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1 wrap-anywhere">
          <h2 className="text-heading-foreground text-xl leading-tight font-semibold">
            Command library
          </h2>
          <p className="text-muted-foreground min-w-0 text-sm">
            Current film:{" "}
            <span className="text-label font-medium">
              {catalog.context.activeFilm ?? "No film open"}
            </span>
          </p>
        </div>
        {panelControls}
      </div>
      {browseAlerts.map((alert) => (
        <Alert key={alert.key} variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription size="prose" className="wrap-anywhere">
            <span className="block">{alert.message}</span>
            {alert.recovery}
          </AlertDescription>
          {(alert.onRetry || alert.onDismiss) && (
            <div className="col-start-2 flex flex-wrap gap-1">
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
            </div>
          )}
        </Alert>
      ))}

      {bannerRun && (
        <div className="bg-card border-hairline flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border px-2.5 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <CliRunStatusBadge run={bannerRun} isStopping={isStoppingBanner} />
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
          <div className="flex max-w-full flex-wrap items-center gap-1">
            <Button
              variant="secondary"
              size="comfortable"
              data-cli-entry="recent-output"
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
          placeholder="render, --jev, or timeline"
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
          <span className="tabular-nums">All ({filteredBySearch.length})</span>
        </Button>
        {catalog.categories.map((cat) => (
          <Button
            key={cat.id}
            variant="choice"
            size="comfortable"
            aria-pressed={selectedCategory === cat.id}
            onClick={() => onSelectCategory(cat.id)}
          >
            <span className="tabular-nums">
              {cat.label} ({categoryCounts.get(cat.id) ?? 0})
            </span>
          </Button>
        ))}
      </HorizontalScrollRail>

      <div
        data-arrow-scroll
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain"
      >
        <p role="status" className="sr-only">
          {filteredCommands.length} {filteredCommands.length === 1 ? "command" : "commands"}
          {categoryLabel ? ` in ${categoryLabel}` : ""}
        </p>
        {/* Saved Templates */}
        {(!searchQuery.trim() || filteredTemplates.length > 0) && (
          <section aria-label="Saved templates" className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="text-heading-foreground flex items-center gap-1.5 text-lg leading-tight font-semibold">
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
                      ? "Current film"
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
                              className="text-heading-foreground min-w-0 text-base font-medium wrap-anywhere"
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
                              <span className="min-w-0 wrap-anywhere whitespace-normal">
                                {templateTargetLabel}
                              </span>
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

                      {disabledReason && (
                        <p className="text-warn-text text-sm wrap-anywhere">{disabledReason}</p>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Tip label="Delete template">
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
                          variant="secondary"
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
              <EmptyTitle>
                {categoryLabel ? `No matches in ${categoryLabel}` : "No matching CLI commands"}
              </EmptyTitle>
              <EmptyDescription className="wrap-anywhere">
                {searchQuery.trim()
                  ? `No commands match “${searchQuery.trim()}” in this view.`
                  : "Choose another category to browse commands."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="secondary"
                size="comfortable"
                onClick={() => {
                  if (!searchAllCategories) onSearchChange("");
                  onSelectCategory("all");
                }}
              >
                {searchAllCategories ? "Search all categories" : "Clear filters"}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="flex min-w-0 flex-col gap-6">
            {groupedCommands.map(({ category, commands }) => (
              <section
                key={category.id}
                aria-label={category.label}
                className="flex min-w-0 flex-col gap-1.5"
              >
                <div className="flex flex-col gap-0.5 px-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-heading-foreground text-lg leading-tight font-semibold">
                      {category.label}
                    </h3>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {commands.length}
                    </span>
                  </div>
                  <p className="text-muted-foreground max-w-prose text-sm leading-normal text-pretty">
                    {category.description}
                  </p>
                </div>

                <div className="bg-card border-hairline divide-hairline-subtle flex min-w-0 flex-col divide-y overflow-hidden rounded-xl border">
                  {commands.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      data-cli-entry={cmd.id}
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
                              {cmd.subcommands.length}{" "}
                              {cmd.subcommands.length === 1 ? "subcommand" : "subcommands"}
                            </Badge>
                          ) : null}
                        </div>
                        <ChevronRight
                          aria-hidden
                          className="text-muted-foreground size-3.5 shrink-0"
                        />
                      </div>
                      <p className="text-muted-foreground line-clamp-2 max-w-prose text-sm leading-normal text-pretty">
                        {cmd.summary}
                      </p>
                      <CliHazardBadges meta={cmd.meta} compact />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
