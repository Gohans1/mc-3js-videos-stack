import { AlertTriangle, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import { type CliCategoryId, findCliCommand } from "../../src/cli-catalog.ts";
import { useDialogModal } from "../core/store";
import {
  cliActiveRunOf,
  cliCatalogOf,
  cliRunErrorOf,
  cliStoppingRunIdOf,
  cliStore,
  commitSaveTemplate,
  consumeFocusConsoleRun,
  dispatchCliRun,
  dismissCliRunError,
  ensureCliLoaded,
  getOrCreateDraft,
  hideConsoleRun,
  openCommandWorkbench,
  openTemplateInWorkbench,
  removeTemplate,
  resetCommandDraft,
  restoreDeletedTemplate,
  retryCliPanel,
  setActiveCommandSubcommand,
  setDraftTargetFilm,
  stopCurrentRun,
  updateDraftField,
  updatePendingInput,
  useCliStore,
} from "./cli-store";
import { CliBrowse } from "./CliBrowse";
import { CliRunAnnouncement } from "./CliConsole";
import { CliConfirmDialog, CliResetDialog, CliSaveTemplateDialog } from "./CliDialogs";
import { CliWorkbench } from "./CliWorkbench";
import {
  buildTemplatePreviewCommand,
  formatTargetBadgeText,
  resolvePendingInputs,
  stopCliHotkeyPropagation,
} from "./model";

export function CliPanel() {
  const [resetOpen, setResetOpen] = useState(false);
  const helpOpen = useCliStore((s) => s.helpOpen);
  const catalogState = useCliStore((s) => s.catalogState);
  const catalog = cliCatalogOf({ catalogState });
  const catalogError = catalogState.status === "error" ? catalogState.error : null;
  const templatesState = useCliStore((s) => s.templatesState);
  const templates = templatesState.templates;
  const templatesError = templatesState.status === "ready" ? templatesState.error : null;
  const view = useCliStore((s) => s.view);
  const panelMode = useCliStore((s) => s.panelMode);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousView = useRef(view);
  const browseReturnKey = useRef<string | null>(null);
  const searchQuery = useCliStore((s) => s.searchQuery);
  const selectedCategory = useCliStore((s) => s.selectedCategory);
  const activeCommandId = useCliStore((s) => s.activeCommandId);
  const drafts = useCliStore((s) => s.drafts);
  const editingTemplateId = useCliStore((s) => s.editingTemplateId);
  const runState = useCliStore((s) => s.runState);
  const activeRun = cliActiveRunOf({ runState });
  const lastRun = useCliStore((s) => s.lastRun);
  const stoppingRunId = cliStoppingRunIdOf({ runState });
  const consoleExpanded = useCliStore((s) => s.consoleExpanded);
  const focusConsoleRunId = useCliStore((s) => s.focusConsoleRunId);
  const submittingRun = runState.status === "submitting";
  const runError = cliRunErrorOf({ runState });
  const clearedHint = useCliStore((s) => s.clearedHint);
  const confirmPending = runState.status === "confirming" ? runState.pending : null;
  const saveDialog = useCliStore((s) => s.saveDialog);
  const saveDialogOpen = saveDialog.status !== "closed";
  const savingTemplate = saveDialog.status === "saving";
  const saveError = saveDialog.status === "open" ? saveDialog.error : null;

  useEffect(() => {
    void ensureCliLoaded();
  }, []);

  useLayoutEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    const panel = panelRef.current;
    if (view === "browse") {
      const key = browseReturnKey.current;
      browseReturnKey.current = null;
      const trigger =
        key && panel?.querySelector<HTMLElement>(`[data-cli-entry="${CSS.escape(key)}"]`);
      (trigger || panel?.querySelector<HTMLElement>('input[name="cli-search"]'))?.focus();
      return;
    }
    const output = focusConsoleRunId && panel?.querySelector<HTMLElement>("[data-cli-output]");
    (output || panel?.querySelector<HTMLElement>("[data-cli-command-title]"))?.focus();
  }, [view, focusConsoleRunId]);

  useDialogModal("cliHelp", helpOpen);
  useDialogModal("cliReset", resetOpen);
  useDialogModal("cliConfirm", Boolean(confirmPending));
  useDialogModal("cliTemplate", saveDialogOpen);

  if (!catalog) {
    return (
      <div
        data-cli-panel
        onKeyDown={stopCliHotkeyPropagation}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4"
      >
        {catalogError ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Could not load CLI catalog</AlertTitle>
            <AlertDescription size="prose" className="wrap-anywhere">
              <span className="block">{catalogError}</span>
              Check Studio’s connection, then retry.
            </AlertDescription>
          </Alert>
        ) : (
          <p role="status" className="text-muted-foreground text-sm">
            Loading commands…
          </p>
        )}
        {catalogError && (
          <Button variant="secondary" size="sm" onClick={() => void retryCliPanel()}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        )}
      </div>
    );
  }

  const command = findCliCommand(activeCommandId) ?? catalog.commands[0]!;
  const draft = drafts[command.id] ?? getOrCreateDraft(command);
  const effectiveDraft = resolvePendingInputs(command, draft);
  const editingTemplate = editingTemplateId
    ? (templates.find((t) => t.id === editingTemplateId) ?? null)
    : null;
  const activeSpec = buildTemplatePreviewCommand(
    {
      id: "preview",
      name: command.label,
      commandId: command.id,
      subcommandPath: draft.subcommandPath,
      args: effectiveDraft.args,
      flags: effectiveDraft.flags,
      targetFilm: draft.targetFilm,
      createdAt: 0,
      updatedAt: 0,
    },
    catalog.context,
  );

  const handleSelectCategoryInLego = (cat: CliCategoryId) => {
    const first = catalog.commands.find((c) => c.category === cat);
    if (first) openCommandWorkbench(first.id);
  };

  const handleRunTemplate = (tpl: (typeof templates)[number]) => {
    const { display, spec } = buildTemplatePreviewCommand(tpl, catalog.context);
    const request = {
      commandId: tpl.commandId,
      subcommandPath: tpl.subcommandPath,
      args: tpl.args,
      flags: tpl.flags,
      targetFilm: tpl.targetFilm,
      mode: "execute" as const,
    };
    const confirmMeta = spec?.requiresConfirm
      ? {
          title: spec.command.label,
          reason:
            spec.confirmMessage ??
            spec.meta.confirm?.message ??
            "Confirm before executing this template.",
          displayCommand: display,
          cwd: formatTargetBadgeText(
            spec.cwdMode,
            tpl.targetFilm,
            catalog.context,
            spec.command.packageDir,
          ),
          cost: spec.meta.cost,
          effect: spec.meta.effect,
          sourceLabel: tpl.name,
        }
      : undefined;

    if (!confirmMeta) {
      openTemplateInWorkbench(tpl);
    }
    void dispatchCliRun(request, {
      confirmMeta,
      openWorkbench: true,
      templateToLoad: confirmMeta ? tpl : undefined,
    });
  };

  const panelControls = (
    <Button
      size="wrapping"
      variant="secondary"
      className="max-w-full"
      aria-label={panelMode === "expanded" ? "Restore CLI panel" : "Expand CLI panel"}
      onClick={() =>
        cliStore.setState({ panelMode: panelMode === "expanded" ? "embedded" : "expanded" })
      }
    >
      {panelMode === "expanded" ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      {panelMode === "expanded" ? "Restore" : "Expand"}
    </Button>
  );

  return (
    <div
      ref={panelRef}
      data-cli-panel
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          panelMode === "expanded" &&
          !helpOpen &&
          !resetOpen &&
          !confirmPending &&
          !saveDialogOpen
        ) {
          event.preventDefault();
          event.stopPropagation();
          cliStore.setState({ panelMode: "embedded" });
          return;
        }
        stopCliHotkeyPropagation(event);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <CliRunAnnouncement
        run={activeRun ?? lastRun}
        isStopping={Boolean(activeRun && stoppingRunId === activeRun.runId)}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {view === "browse" ? (
          <CliBrowse
            panelControls={panelControls}
            catalog={catalog}
            templates={templates}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            activeRun={activeRun}
            lastRun={lastRun}
            stoppingRunId={stoppingRunId}
            runError={runError}
            catalogError={catalogError}
            templatesError={templatesError}
            onDismissRunError={dismissCliRunError}
            onDismissCatalogError={() =>
              cliStore.setState((s) =>
                s.catalogState.status === "error"
                  ? {
                      catalogState: s.catalogState.catalog
                        ? {
                            status: "ready",
                            catalog: s.catalogState.catalog,
                            filmQuery: s.catalogState.filmQuery,
                          }
                        : { status: "idle", filmQuery: s.catalogState.filmQuery },
                    }
                  : {},
              )
            }
            onDismissTemplatesError={() =>
              cliStore.setState((s) =>
                s.templatesState.status === "ready"
                  ? { templatesState: { ...s.templatesState, error: null } }
                  : {},
              )
            }
            onRetryCatalog={() => void retryCliPanel()}
            onSearchChange={(q) => cliStore.setState({ searchQuery: q })}
            onSelectCategory={(cat) => cliStore.setState({ selectedCategory: cat })}
            onRefreshCatalog={() => void retryCliPanel()}
            onOpenCommand={(id, opts) => {
              browseReturnKey.current = opts?.focusRunId ? "recent-output" : id;
              openCommandWorkbench(id, opts);
            }}
            onRunTemplate={handleRunTemplate}
            onEditTemplate={(tpl) => openTemplateInWorkbench(tpl)}
            onDeleteTemplate={(tpl) => removeTemplate(tpl.id)}
            onRestoreTemplate={(tpl) => restoreDeletedTemplate(tpl)}
            onStopRun={(id) => void stopCurrentRun(id)}
          />
        ) : (
          <CliWorkbench
            panelControls={panelControls}
            helpOpen={helpOpen}
            onHelpOpenChange={(open) => cliStore.setState({ helpOpen: open })}
            catalog={catalog}
            command={command}
            draft={draft}
            editingTemplateName={editingTemplate?.name ?? null}
            activeRun={activeRun}
            lastRun={lastRun}
            stoppingRunId={stoppingRunId}
            consoleExpanded={consoleExpanded}
            focusConsoleRunId={focusConsoleRunId}
            submittingRun={submittingRun}
            runError={runError}
            clearedHint={clearedHint}
            onBack={() =>
              cliStore.setState({
                view: "browse",
                consoleExpanded: false,
                focusConsoleRunId: null,
              })
            }
            onSelectCategory={handleSelectCategoryInLego}
            onSelectCommand={(id) => openCommandWorkbench(id)}
            onSelectSubcommand={(lvl, subId) => setActiveCommandSubcommand(lvl, subId)}
            onSelectTargetFilm={(target) => setDraftTargetFilm(command.id, target)}
            onUpdateField={(bucket, key, value, spec, exclusiveGroup, optionalValue) =>
              updateDraftField(command.id, bucket, key, value, spec, exclusiveGroup, optionalValue)
            }
            onReset={() => setResetOpen(true)}
            onUpdatePendingInput={(key, value) => updatePendingInput(command.id, key, value)}
            onRun={(req, confirmMeta) => void dispatchCliRun(req, { confirmMeta })}
            onStopRun={(id) => void stopCurrentRun(id)}
            onClearConsole={() => hideConsoleRun(command.id)}
            onToggleExpandConsole={() =>
              cliStore.setState((s) => ({ consoleExpanded: !s.consoleExpanded }))
            }
            onConsumeFocusRun={() => consumeFocusConsoleRun()}
            onOpenSaveTemplate={() =>
              cliStore.setState({ saveDialog: { status: "open", error: null } })
            }
          />
        )}
      </div>

      <CliResetDialog
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          setResetOpen(false);
          resetCommandDraft(command.id);
        }}
        returnFocus={() =>
          panelRef.current?.querySelector<HTMLElement>('[aria-label="Reset options"]') ?? true
        }
      />

      <CliConfirmDialog
        request={confirmPending?.dialog ?? null}
        submitting={submittingRun}
        onCancel={() =>
          cliStore.setState((s) =>
            s.runState.status === "confirming"
              ? { runState: { status: "idle", error: null } }
              : {},
          )
        }
        onConfirm={() => {
          if (!confirmPending) return;
          void dispatchCliRun(
            { ...confirmPending.request, confirmed: true },
            {
              openWorkbench: confirmPending.openCommandOnStart,
              templateToLoad: confirmPending.templateToLoad,
            },
          );
        }}
      />

      <CliSaveTemplateDialog
        open={saveDialogOpen}
        initialName={editingTemplate?.name ?? [command.label, ...draft.subcommandPath].join(" ")}
        initialTargetFilm={editingTemplate?.targetFilm ?? draft.targetFilm}
        activeFilm={catalog.context.activeFilm}
        films={catalog.context.films}
        supportsFilmTarget={command.cwdModes.includes("film")}
        supportsRootTarget={command.cwdModes.includes("root")}
        displayCommand={activeSpec.display}
        editingExisting={Boolean(editingTemplate)}
        saving={savingTemplate}
        saveError={saveError}
        onClose={() => cliStore.setState({ saveDialog: { status: "closed" } })}
        onSave={({ name, targetFilm, asNew }) => {
          void commitSaveTemplate({
            id: asNew ? undefined : editingTemplate?.id,
            name,
            targetFilm,
            draft: effectiveDraft,
          }).then((saved) => {
            if (saved) toast.add({ title: "Template saved" });
          });
        }}
      />
    </div>
  );
}
