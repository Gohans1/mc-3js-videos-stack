import {
  ArrowLeft,
  BookmarkPlus,
  BookOpen,
  ChevronDown,
  KeyRound,
  Loader2,
  Play,
  ShieldAlert,
  Square,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

import { Segmented } from "@/components/inspector";
import { Tip } from "@/components/Tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import {
  buildCliInvocation,
  type CliArgValue,
  type CliCatalogResponse,
  type CliCategoryId,
  type CliCommand,
  type CliRunRequest,
  type CliRunSnapshot,
  isFieldRequired,
  isFieldVisible,
} from "../../src/cli-catalog.ts";
import { CliAccessLabel, CliBehaviorStrip, CliCostLabel } from "./CliBadges";
import { CliConsole } from "./CliConsole";
import { type CliConfirmRequest, CliHelpDialog } from "./CliDialogs";
import { CliFieldControl } from "./CliFieldControl";
import { CliLegoBar } from "./CliLegoBar";
import {
  type CliCommandDraft,
  type CliRunError,
  cliRunErrorCopy,
  formatTargetBadgeText,
  hasFieldValidationError,
  isFieldValueActive,
  resolvePendingInputs,
} from "./model";

export type CliCompactTab = "builder" | "output";

/** Computes compact Configure/Output tab transitions on run start, Browse focus, or scope change. */
export function nextCompactTabForChange(input: {
  currentTab: CliCompactTab;
  prevRunId: string | undefined;
  nextRunId: string | undefined;
  prevScopeKey: string;
  nextScopeKey: string;
  focusConsoleRunId: string | null;
}): { nextTab: CliCompactTab; consumeFocus: boolean } {
  if (input.focusConsoleRunId && input.nextRunId === input.focusConsoleRunId) {
    return { nextTab: "output", consumeFocus: true };
  }
  if (input.prevScopeKey !== input.nextScopeKey) {
    return { nextTab: "builder", consumeFocus: false };
  }
  if (input.nextRunId && input.nextRunId !== input.prevRunId) {
    return { nextTab: "output", consumeFocus: false };
  }
  return { nextTab: input.currentTab, consumeFocus: false };
}

export function CliWorkbench({
  catalog,
  panelControls,
  helpOpen,
  onHelpOpenChange,
  command,
  draft,
  editingTemplateName,
  activeRun,
  lastRun,
  stoppingRunId = null,
  consoleExpanded,
  focusConsoleRunId = null,
  submittingRun,
  runError,
  clearedHint,
  onBack,
  onSelectCategory,
  onSelectCommand,
  onSelectSubcommand,
  onSelectTargetFilm,
  onUpdateField,
  onUpdatePendingInput,
  onReset,
  onRun,
  onStopRun,
  onClearConsole,
  onToggleExpandConsole,
  onConsumeFocusRun,
  onOpenSaveTemplate,
}: {
  catalog: CliCatalogResponse;
  panelControls?: ReactNode;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
  command: CliCommand;
  draft: CliCommandDraft;
  editingTemplateName: string | null;
  activeRun: CliRunSnapshot | null;
  lastRun: CliRunSnapshot | null;
  stoppingRunId?: string | null;
  consoleExpanded: boolean;
  focusConsoleRunId?: string | null;
  submittingRun: boolean;
  runError: CliRunError | null;
  clearedHint: string | null;
  onBack: () => void;
  onSelectCategory: (cat: CliCategoryId) => void;
  onSelectCommand: (id: string) => void;
  onSelectSubcommand: (level: number, subId: string) => void;
  onSelectTargetFilm: (target: string) => void;
  onUpdateField: (
    bucket: "args" | "flags" | "env",
    key: string,
    value: CliArgValue,
    spec: ReturnType<typeof buildCliInvocation>,
    exclusiveGroup?: string,
    optionalValue?: boolean,
  ) => void;
  onReset: () => void;
  onUpdatePendingInput: (key: string, value: string) => void;
  onRun: (request: CliRunRequest, confirmMeta?: CliConfirmRequest) => void;
  onStopRun: (runId: string) => void;
  onClearConsole: () => void;
  onToggleExpandConsole: () => void;
  onConsumeFocusRun?: () => void;
  onOpenSaveTemplate: () => void;
}) {
  const [openDrawerKey, setOpenDrawerKey] = useState<string | null>(null);
  const [widePane, setWidePane] = useState(false);
  const validationErrorId = useId();
  const [validationScopeKey, setValidationScopeKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const guideButtonRef = useRef<HTMLButtonElement>(null);
  const subPathKey = draft.subcommandPath.join("/");
  const drawerScopeKey = `${command.id}:${subPathKey}`;
  const validationAttempted = validationScopeKey === drawerScopeKey;
  const moreOpen = openDrawerKey === drawerScopeKey;
  const pendingInput = (bucket: "args" | "flags" | "env", key: string) => ({
    value: draft.pendingInputs[`${bucket}:${key}`] ?? "",
    onChange: (value: string) => onUpdatePendingInput(`${bucket}:${key}`, value),
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = el.getBoundingClientRect().width >= 832;
      setWidePane((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveDraft = useMemo(() => resolvePendingInputs(command, draft), [command, draft]);
  const spec = useMemo(
    () =>
      buildCliInvocation(
        {
          commandId: command.id,
          subcommandPath: draft.subcommandPath,
          args: effectiveDraft.args,
          flags: effectiveDraft.flags,
          env: effectiveDraft.env,
          targetFilm: draft.targetFilm,
          mode: "execute",
        },
        catalog.context,
      ),
    [command.id, draft.subcommandPath, draft.targetFilm, effectiveDraft, catalog.context],
  );

  const helpSpec = useMemo(
    () =>
      buildCliInvocation(
        {
          commandId: command.id,
          subcommandPath: draft.subcommandPath,
          targetFilm: draft.targetFilm,
          mode: "help",
        },
        catalog.context,
      ),
    [command.id, draft.subcommandPath, draft.targetFilm, catalog.context],
  );

  const combinedValues = useMemo<Record<string, CliArgValue>>(
    () => ({ ...effectiveDraft.args, ...effectiveDraft.flags, ...effectiveDraft.env }),
    [effectiveDraft],
  );

  const visibleArgs = useMemo(
    () => spec.argsDef.filter((a) => isFieldVisible(a.visibleWhen, combinedValues)),
    [spec.argsDef, combinedValues],
  );
  const visibleEnv = useMemo(
    () => spec.envDef.filter((e) => isFieldVisible(e.visibleWhen, combinedValues)),
    [spec.envDef, combinedValues],
  );
  const commonFlags = useMemo(
    () => spec.flagsDef.filter((f) => f.tier !== "advanced"),
    [spec.flagsDef],
  );
  const advancedFlags = useMemo(
    () => spec.flagsDef.filter((f) => f.tier === "advanced"),
    [spec.flagsDef],
  );
  const availableAdvancedFlags = useMemo(
    () => advancedFlags.filter((field) => isFieldVisible(field.visibleWhen, combinedValues)),
    [advancedFlags, combinedValues],
  );
  const activeAdvancedCount = useMemo(
    () =>
      availableAdvancedFlags.filter((f) =>
        isFieldValueActive(effectiveDraft.flags[f.key], f.optionalValue),
      ).length,
    [availableAdvancedFlags, effectiveDraft.flags],
  );

  const consoleRun = useMemo(() => {
    if (activeRun?.commandId === command.id) return activeRun;
    if (lastRun?.commandId === command.id) return lastRun;
    return null;
  }, [activeRun, lastRun, command.id]);

  const [compactTab, setCompactTab] = useState<CliCompactTab>(() =>
    focusConsoleRunId && consoleRun?.runId === focusConsoleRunId ? "output" : "builder",
  );
  const prevRunIdRef = useRef<string | undefined>(consoleRun?.runId);
  const prevScopeRef = useRef<string>(drawerScopeKey);

  useEffect(() => {
    const decision = nextCompactTabForChange({
      currentTab: compactTab,
      prevRunId: prevRunIdRef.current,
      nextRunId: consoleRun?.runId,
      prevScopeKey: prevScopeRef.current,
      nextScopeKey: drawerScopeKey,
      focusConsoleRunId,
    });
    prevRunIdRef.current = consoleRun?.runId;
    prevScopeRef.current = drawerScopeKey;
    if (decision.nextTab !== compactTab) {
      setCompactTab(decision.nextTab);
      if (!widePane && decision.nextTab === "output") {
        requestAnimationFrame(() =>
          containerRef.current
            ?.querySelector<HTMLElement>("[data-cli-output]")
            ?.focus({ preventScroll: true }),
        );
      }
    }
    if (decision.consumeFocus) {
      onConsumeFocusRun?.();
    }
  }, [
    compactTab,
    consoleRun?.runId,
    drawerScopeKey,
    focusConsoleRunId,
    onConsumeFocusRun,
    widePane,
  ]);

  const otherRunActive = Boolean(activeRun && activeRun.commandId !== command.id);
  const isStoppingThis = Boolean(activeRun && stoppingRunId === activeRun.runId);
  const isStoppingConsole = Boolean(consoleRun && stoppingRunId === consoleRun.runId);
  const targetLabel = formatTargetBadgeText(
    spec.cwdMode,
    draft.targetFilm,
    catalog.context,
    command.packageDir,
  );
  const activeLeaf = spec.subcommands.at(-1);
  const activeSummary = activeLeaf?.summary ?? command.summary;

  const canRun = !submittingRun && !activeRun && !spec.guardReason;
  const canHelp =
    spec.meta.helpMode !== "none" &&
    !submittingRun &&
    !activeRun &&
    helpSpec.validationErrors.length === 0;

  const triggerExecute = () => {
    if (spec.validationErrors.length) {
      setValidationScopeKey(drawerScopeKey);
      setCompactTab("builder");
      if (
        availableAdvancedFlags.some((field) =>
          hasFieldValidationError(field, spec.validationErrors),
        )
      ) {
        setOpenDrawerKey(drawerScopeKey);
      }
      requestAnimationFrame(() =>
        containerRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const req: CliRunRequest = {
      commandId: command.id,
      subcommandPath: draft.subcommandPath,
      args: effectiveDraft.args,
      flags: effectiveDraft.flags,
      env: effectiveDraft.env,
      targetFilm: draft.targetFilm,
      mode: "execute",
    };
    const confirmMeta: CliConfirmRequest | undefined = spec.requiresConfirm
      ? {
          title: command.label,
          reason:
            spec.confirmMessage ??
            spec.meta.confirm?.message ??
            "Confirm before executing this CLI action.",
          displayCommand: spec.displayCommand,
          cwd: targetLabel,
          cost: spec.meta.cost,
          effect: spec.meta.effect,
        }
      : undefined;
    onRun(req, confirmMeta);
  };

  const triggerHelp = () => {
    onRun({
      commandId: command.id,
      subcommandPath: draft.subcommandPath,
      targetFilm: draft.targetFilm,
      mode: "help",
    });
  };

  const noFieldsAtAll =
    spec.argsDef.length === 0 && spec.envDef.length === 0 && spec.flagsDef.length === 0;

  const legoBar = (
    <CliLegoBar
      categories={catalog.categories}
      commands={catalog.commands}
      command={command}
      spec={spec}
      draft={draft}
      context={catalog.context}
      onSelectCategory={onSelectCategory}
      onSelectCommand={onSelectCommand}
      onSelectSubcommand={onSelectSubcommand}
      onSelectTargetFilm={onSelectTargetFilm}
      onReset={onReset}
    />
  );

  const builderFieldsContent = (
    <>
      {legoBar}

      <p className="text-label max-w-prose px-1 text-sm leading-normal text-pretty">
        {activeSummary}
      </p>

      {spec.guardReason && (
        <Alert variant="warn">
          <ShieldAlert aria-hidden />
          <AlertTitle>Guarded in Studio</AlertTitle>
          <AlertDescription>
            {spec.guardReason}
            {spec.meta.helpMode !== "none" ? " Open Command guide for available options." : ""}
          </AlertDescription>
        </Alert>
      )}

      {spec.missingEnvGroups.length > 0 && (
        <Alert variant="warn">
          <KeyRound aria-hidden />
          <AlertTitle>Missing API key</AlertTitle>
          <AlertDescription>
            Configure {spec.missingEnvGroups.map((grp) => grp.join(" or ")).join(" and ")} in env or{" "}
            ~/.secrets/*.env for live calls.
          </AlertDescription>
        </Alert>
      )}

      {clearedHint && <Callout variant="ok">{clearedHint}</Callout>}

      {noFieldsAtAll ? (
        <p className="bg-card border-hairline text-muted-foreground rounded-xl border px-3 py-2 text-sm">
          This command needs no extra options. Select Run command to start it.
        </p>
      ) : (
        <div key={`${command.id}:${subPathKey}`} className="flex min-w-0 flex-col gap-2.5">
          {spec.argsDef.length > 0 && (
            <Collapsible open={visibleArgs.length > 0}>
              <CollapsibleContent>
                <section
                  aria-label="Positional arguments"
                  className="flex min-w-0 flex-col gap-1.5"
                >
                  <h3 className="text-heading-foreground px-1 text-base font-semibold">
                    Arguments
                  </h3>
                  <div className="bg-card border-hairline grid min-w-0 grid-cols-1 gap-4 rounded-xl border p-3 @min-[480px]/cli-form:grid-cols-2">
                    {spec.argsDef.map((arg) => (
                      <CliFieldControl
                        key={`${command.id}:${subPathKey}:arg:${arg.key}`}
                        def={arg}
                        pendingInput={pendingInput("args", arg.key)}
                        invalid={
                          validationAttempted && hasFieldValidationError(arg, spec.validationErrors)
                        }
                        errorId={validationErrorId}
                        visible={isFieldVisible(arg.visibleWhen, combinedValues)}
                        value={draft.args[arg.key] ?? arg.default}
                        context={catalog.context}
                        requiredOverride={isFieldRequired(arg, combinedValues)}
                        onChange={(v) =>
                          onUpdateField("args", arg.key, v, spec, arg.exclusiveGroup)
                        }
                      />
                    ))}
                  </div>
                </section>
              </CollapsibleContent>
            </Collapsible>
          )}

          {spec.envDef.length > 0 && (
            <Collapsible open={visibleEnv.length > 0}>
              <CollapsibleContent>
                <section
                  aria-label="Environment overrides"
                  className="flex min-w-0 flex-col gap-1.5"
                >
                  <h3 className="text-heading-foreground px-1 text-base font-semibold">
                    Environment overrides
                  </h3>
                  <div className="bg-card border-hairline grid min-w-0 grid-cols-1 gap-4 rounded-xl border p-3 @min-[480px]/cli-form:grid-cols-2">
                    {spec.envDef.map((envDef) => (
                      <CliFieldControl
                        key={`${command.id}:${subPathKey}:env:${envDef.key}`}
                        def={envDef}
                        pendingInput={pendingInput("env", envDef.key)}
                        invalid={
                          validationAttempted &&
                          hasFieldValidationError(envDef, spec.validationErrors)
                        }
                        errorId={validationErrorId}
                        visible={isFieldVisible(envDef.visibleWhen, combinedValues)}
                        value={draft.env[envDef.key]}
                        context={catalog.context}
                        requiredOverride={isFieldRequired(envDef, combinedValues)}
                        onChange={(v) =>
                          onUpdateField("env", envDef.key, v, spec, envDef.exclusiveGroup)
                        }
                      />
                    ))}
                  </div>
                </section>
              </CollapsibleContent>
            </Collapsible>
          )}

          {commonFlags.length > 0 && (
            <section aria-label="Options" className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-heading-foreground px-1 text-base font-semibold">Options</h3>
              <div className="bg-card border-hairline grid min-w-0 grid-cols-1 gap-4 rounded-xl border p-3 @min-[480px]/cli-form:grid-cols-2">
                {commonFlags.map((flag) => (
                  <CliFieldControl
                    key={`${command.id}:${subPathKey}:flag:${flag.key}`}
                    def={flag}
                    pendingInput={pendingInput("flags", flag.key)}
                    invalid={
                      validationAttempted && hasFieldValidationError(flag, spec.validationErrors)
                    }
                    errorId={validationErrorId}
                    visible={isFieldVisible(flag.visibleWhen, combinedValues)}
                    value={draft.flags[flag.key]}
                    context={catalog.context}
                    requiredOverride={isFieldRequired(flag, combinedValues)}
                    onChange={(v) =>
                      onUpdateField(
                        "flags",
                        flag.key,
                        v,
                        spec,
                        flag.exclusiveGroup,
                        flag.optionalValue,
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {advancedFlags.length > 0 && (
            <Collapsible
              open={moreOpen}
              onOpenChange={(next) => setOpenDrawerKey(next ? drawerScopeKey : null)}
            >
              <div className="bg-card border-hairline rounded-xl border">
                <CollapsibleTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`More options (${availableAdvancedFlags.length})`}
                      className="focus-visible:ring-ring flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left outline-none focus-visible:ring-2 pointer-coarse:min-h-10"
                    />
                  }
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-sm font-semibold">
                      More options ({availableAdvancedFlags.length})
                    </span>
                    {activeAdvancedCount > 0 && (
                      <Badge appearance="text" size="comfortable" variant="open">
                        {activeAdvancedCount} active
                      </Badge>
                    )}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={
                      moreOpen
                        ? "text-muted-foreground size-4 shrink-0 rotate-180"
                        : "text-muted-foreground size-4 shrink-0"
                    }
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-hairline grid min-w-0 grid-cols-1 gap-4 border-t p-3 @min-[480px]/cli-form:grid-cols-2">
                    {advancedFlags.map((flag) => (
                      <CliFieldControl
                        key={`${command.id}:${subPathKey}:adv:${flag.key}`}
                        def={flag}
                        pendingInput={pendingInput("flags", flag.key)}
                        invalid={
                          validationAttempted &&
                          hasFieldValidationError(flag, spec.validationErrors)
                        }
                        errorId={validationErrorId}
                        visible={isFieldVisible(flag.visibleWhen, combinedValues)}
                        value={draft.flags[flag.key]}
                        context={catalog.context}
                        requiredOverride={isFieldRequired(flag, combinedValues)}
                        onChange={(v) =>
                          onUpdateField(
                            "flags",
                            flag.key,
                            v,
                            spec,
                            flag.exclusiveGroup,
                            flag.optionalValue,
                          )
                        }
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}
        </div>
      )}
    </>
  );

  const actionSection = (
    <>
      {otherRunActive && activeRun && (
        <Callout variant="warn">
          <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
          <span title={activeRun.displayCommand} className="min-w-0 flex-1 truncate font-mono">
            Busy: {activeRun.displayCommand}
          </span>
          <Button
            variant="secondary"
            size="comfortable"
            onClick={() => onSelectCommand(activeRun.commandId)}
          >
            Open
          </Button>
        </Callout>
      )}

      <div className="flex min-w-0 flex-none flex-col gap-1">
        {validationAttempted && !spec.guardReason && spec.validationErrors.length > 0 && (
          <p role="alert" id={validationErrorId} className="text-warn-text px-0.5 text-sm">
            {spec.validationErrors[0]}
          </p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {activeRun ? (
            <Button
              variant="destructive"
              size="wrapping"
              disabled={isStoppingThis}
              focusableWhenDisabled
              onClick={() => {
                if (!isStoppingThis) onStopRun(activeRun.runId);
              }}
              className="w-35 max-w-full"
            >
              {isStoppingThis ? (
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Square aria-hidden />
              )}
              {isStoppingThis ? "Stopping…" : "Stop command"}
            </Button>
          ) : (
            <Button
              size="wrapping"
              variant={
                spec.meta.effect === "destructive"
                  ? "destructive"
                  : spec.requiresConfirm
                    ? "approve"
                    : "default"
              }
              disabled={!canRun}
              focusableWhenDisabled
              aria-describedby={
                validationAttempted && !spec.guardReason && spec.validationErrors.length > 0
                  ? validationErrorId
                  : undefined
              }
              onClick={() => {
                if (canRun) triggerExecute();
              }}
              className="w-35 max-w-full"
            >
              {submittingRun ? (
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : spec.requiresConfirm ? (
                <ShieldAlert aria-hidden />
              ) : (
                <Play aria-hidden />
              )}
              {spec.requiresConfirm ? "Review & run" : "Run command"}
            </Button>
          )}

          <Button
            ref={guideButtonRef}
            variant="secondary"
            size="wrapping"
            className="max-w-full"
            onClick={() => onHelpOpenChange(true)}
          >
            <BookOpen aria-hidden />
            Command guide
          </Button>
        </div>
      </div>
    </>
  );

  const outputOnly = consoleExpanded || (!widePane && compactTab === "output");
  const consoleSection = (
    <CliConsole
      run={consoleRun}
      expanded={consoleExpanded}
      compact
      showHeading={widePane || consoleExpanded}
      isStopping={isStoppingConsole}
      outputsHint={spec.meta.outputsHint}
      onToggleExpand={onToggleExpandConsole}
      onStop={() => {
        if (activeRun) onStopRun(activeRun.runId);
      }}
      onClear={onClearConsole}
    />
  );

  return (
    <div
      ref={containerRef}
      data-cli-workbench
      className="font-md @container/cli-workbench flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3"
    >
      <div className="flex min-w-0 flex-none flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="comfortable" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Commands
        </Button>
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
          <Tip label={editingTemplateName ? "Update template" : "Save template"}>
            <Button
              variant="subtle"
              size="wrapping"
              className="max-w-full"
              aria-label={editingTemplateName ? "Update template" : "Save template"}
              onClick={onOpenSaveTemplate}
            >
              <BookmarkPlus aria-hidden />
              <span className="hidden @min-[360px]/cli-workbench:inline">
                {editingTemplateName ? "Update template" : "Save template"}
              </span>
            </Button>
          </Tip>
          {panelControls}
        </div>
      </div>
      <div className={cn("flex min-w-0 flex-none flex-col gap-1", outputOnly && "sr-only")}>
        <h2
          data-cli-command-title
          tabIndex={-1}
          className="text-heading-foreground font-mono text-xl leading-tight font-semibold wrap-anywhere"
        >
          {[command.label, ...spec.subcommands.map((sub) => sub.label)].join(" ")}
        </h2>
      </div>
      {runError && (
        <Alert variant="destructive" className="flex-none">
          <AlertTitle>{cliRunErrorCopy(runError).title}</AlertTitle>
          <AlertDescription size="prose" className="wrap-anywhere">
            <span className="block">{runError.message}</span>
            {cliRunErrorCopy(runError).recovery}
          </AlertDescription>
        </Alert>
      )}
      {!widePane && !consoleExpanded && (
        <Segmented
          label="CLI pane section"
          value={compactTab}
          onChange={setCompactTab}
          tone="accent"
          size="comfortable"
          animateIndicator={false}
          items={[
            { id: "builder", title: "Configure" },
            { id: "output", title: "Output" },
          ]}
        />
      )}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-hidden",
          widePane && !consoleExpanded
            ? "grid grid-cols-[minmax(0,min(54%,42rem))_minmax(0,1fr)] gap-5"
            : "flex flex-col",
        )}
      >
        {consoleExpanded ? (
          consoleSection
        ) : widePane ? (
          <>
            <div
              data-cli-configure
              data-arrow-scroll
              className="@container/cli-form flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain pe-1 [overflow-anchor:none]"
            >
              {builderFieldsContent}
            </div>
            <div
              data-arrow-scroll
              className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain [overflow-anchor:none]"
            >
              <CliBehaviorStrip
                meta={spec.meta}
                targetLabel={targetLabel}
                missingEnvGroups={spec.missingEnvGroups}
              />
              <div className="flex min-h-64 flex-1 flex-col">{consoleSection}</div>
            </div>
          </>
        ) : compactTab === "builder" ? (
          <div
            data-cli-configure
            data-arrow-scroll
            className="@container/cli-form flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pe-1 [overflow-anchor:none]"
          >
            {builderFieldsContent}
            <h3 className="text-heading-foreground border-hairline border-t pt-3 text-base font-semibold">
              Command details
            </h3>
            <CliBehaviorStrip
              meta={spec.meta}
              targetLabel={targetLabel}
              missingEnvGroups={spec.missingEnvGroups}
            />
          </div>
        ) : (
          consoleSection
        )}
      </div>
      {!outputOnly && (
        <footer
          data-cli-actions
          className="border-hairline flex flex-none flex-col gap-2 border-t pt-3"
        >
          <p className="text-label text-sm wrap-anywhere">
            <CliAccessLabel effect={spec.meta.effect} /> · <CliCostLabel cost={spec.meta.cost} /> ·{" "}
            {targetLabel}
          </p>
          {actionSection}
        </footer>
      )}
      <CliHelpDialog
        returnFocusRef={guideButtonRef}
        open={helpOpen}
        spec={spec}
        helpCommand={helpSpec.displayCommand}
        canRunHelp={canHelp}
        onClose={() => onHelpOpenChange(false)}
        onRunHelp={() => {
          onHelpOpenChange(false);
          triggerHelp();
        }}
      />
    </div>
  );
}
