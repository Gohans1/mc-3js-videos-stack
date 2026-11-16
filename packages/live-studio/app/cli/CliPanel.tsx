import { AlertTriangle, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { TabStage } from "@/components/Motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { type CliCategoryId, findCliCommand } from "../../src/cli-catalog.ts";
import { useDialogModal } from "../core/store";
import {
  clearConsoleRun,
  cliStore,
  commitSaveTemplate,
  consumeFocusConsoleRun,
  dispatchCliRun,
  ensureCliLoaded,
  getOrCreateDraft,
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
import { CliConfirmDialog, CliSaveTemplateDialog } from "./CliDialogs";
import { CliWorkbench } from "./CliWorkbench";
import {
  buildTemplatePreviewCommand,
  formatTargetBadgeText,
  resolvePendingInputs,
  stopCliHotkeyPropagation,
} from "./model";

export function CliPanel() {
  const helpOpen = useCliStore((s) => s.helpOpen);
  const catalog = useCliStore((s) => s.catalog);
  const loadingCatalog = useCliStore((s) => s.loadingCatalog);
  const catalogError = useCliStore((s) => s.catalogError);
  const templates = useCliStore((s) => s.templates);
  const templatesError = useCliStore((s) => s.templatesError);
  const view = useCliStore((s) => s.view);
  const panelMode = useCliStore((s) => s.panelMode);
  const searchQuery = useCliStore((s) => s.searchQuery);
  const selectedCategory = useCliStore((s) => s.selectedCategory);
  const activeCommandId = useCliStore((s) => s.activeCommandId);
  const drafts = useCliStore((s) => s.drafts);
  const editingTemplateId = useCliStore((s) => s.editingTemplateId);
  const activeRun = useCliStore((s) => s.activeRun);
  const lastRun = useCliStore((s) => s.lastRun);
  const stoppingRunId = useCliStore((s) => s.stoppingRunId);
  const consoleExpanded = useCliStore((s) => s.consoleExpanded);
  const focusConsoleRunId = useCliStore((s) => s.focusConsoleRunId);
  const submittingRun = useCliStore((s) => s.submittingRun);
  const runError = useCliStore((s) => s.runError);
  const clearedHint = useCliStore((s) => s.clearedHint);
  const confirmPending = useCliStore((s) => s.confirmPending);
  const saveDialogOpen = useCliStore((s) => s.saveDialogOpen);
  const savingTemplate = useCliStore((s) => s.savingTemplate);
  const saveError = useCliStore((s) => s.saveError);

  useEffect(() => {
    void ensureCliLoaded();
  }, []);

  useDialogModal("cliHelp", helpOpen);
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
            <AlertDescription>{catalogError}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">
            {loadingCatalog ? "Loading repo CLIs…" : "Preparing CLI workbench…"}
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
      env: effectiveDraft.env,
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
      env: tpl.env,
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
      size="comfortable"
      variant="secondary"
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
      data-cli-panel
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          panelMode === "expanded" &&
          !helpOpen &&
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
      <TabStage
        activeKey={`${view}:${panelMode}`}
        order={[`browse:${panelMode}`, `workbench:${panelMode}`]}
        className="relative flex min-h-0 flex-1 flex-col"
      >
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
            onDismissRunError={() => cliStore.setState({ runError: null })}
            onDismissCatalogError={() => cliStore.setState({ catalogError: null })}
            onDismissTemplatesError={() => cliStore.setState({ templatesError: null })}
            onRetryCatalog={() => void retryCliPanel()}
            onSearchChange={(q) => cliStore.setState({ searchQuery: q })}
            onSelectCategory={(cat) => cliStore.setState({ selectedCategory: cat })}
            onRefreshCatalog={() => void retryCliPanel()}
            onOpenCommand={(id, opts) => openCommandWorkbench(id, opts)}
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
            onReset={() => resetCommandDraft(command.id)}
            onUpdatePendingInput={(key, value) => updatePendingInput(command.id, key, value)}
            onRun={(req, confirmMeta) => void dispatchCliRun(req, { confirmMeta })}
            onStopRun={(id) => void stopCurrentRun(id)}
            onClearConsole={() => clearConsoleRun(command.id)}
            onToggleExpandConsole={() =>
              cliStore.setState((s) => ({ consoleExpanded: !s.consoleExpanded }))
            }
            onConsumeFocusRun={() => consumeFocusConsoleRun()}
            onOpenSaveTemplate={() => cliStore.setState({ saveDialogOpen: true, saveError: null })}
          />
        )}
      </TabStage>

      <CliConfirmDialog
        request={confirmPending?.dialog ?? null}
        submitting={submittingRun}
        onCancel={() => cliStore.setState({ confirmPending: null })}
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
        onClose={() => cliStore.setState({ saveDialogOpen: false, saveError: null })}
        onSave={({ name, targetFilm, asNew }) => {
          void commitSaveTemplate({
            id: asNew ? undefined : editingTemplate?.id,
            name,
            targetFilm,
            draft: effectiveDraft,
          });
        }}
      />
    </div>
  );
}
