import {
  ArrowLeft,
  BookmarkPlus,
  ChevronDown,
  HelpCircle,
  KeyRound,
  Loader2,
  Play,
  ShieldAlert,
  Square,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Segmented } from "@/components/inspector";
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
import { CliBehaviorStrip } from "./CliBadges";
import { CliConsole, CliRunCompactBadge } from "./CliConsole";
import type { CliConfirmRequest } from "./CliDialogs";
import { CliFieldControl } from "./CliFieldControl";
import { CliLegoBar } from "./CliLegoBar";
import { type CliCommandDraft, formatTargetBadgeText, isFieldValueActive } from "./model";

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
  if (input.nextRunId && input.nextRunId !== input.prevRunId) {
    return { nextTab: "output", consumeFocus: false };
  }
  if (input.prevScopeKey !== input.nextScopeKey) {
    return { nextTab: "builder", consumeFocus: false };
  }
  return { nextTab: input.currentTab, consumeFocus: false };
}

export function CliWorkbench({
  catalog,
  command,
  draft,
  editingTemplateName,
  activeRun,
  lastRun,
  stoppingRunId = null,
  consoleExpanded,
  focusConsoleRunId = null,
  initialCompact = false,
  submittingRun,
  runError,
  clearedHint,
  onBack,
  onSelectCategory,
  onSelectCommand,
  onSelectSubcommand,
  onSelectTargetFilm,
  onUpdateField,
  onRemoveToken,
  onReset,
  onRun,
  onStopRun,
  onClearConsole,
  onToggleExpandConsole,
  onConsumeFocusRun,
  onOpenSaveTemplate,
}: {
  catalog: CliCatalogResponse;
  command: CliCommand;
  draft: CliCommandDraft;
  editingTemplateName: string | null;
  activeRun: CliRunSnapshot | null;
  lastRun: CliRunSnapshot | null;
  stoppingRunId?: string | null;
  consoleExpanded: boolean;
  focusConsoleRunId?: string | null;
  initialCompact?: boolean;
  submittingRun: boolean;
  runError: string | null;
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
  onRemoveToken: (bucket: "args" | "flags" | "env", key: string) => void;
  onReset: () => void;
  onRun: (request: CliRunRequest, confirmMeta?: CliConfirmRequest) => void;
  onStopRun: (runId: string) => void;
  onClearConsole: () => void;
  onToggleExpandConsole: () => void;
  onConsumeFocusRun?: () => void;
  onOpenSaveTemplate: () => void;
}) {
  const [openDrawerKey, setOpenDrawerKey] = useState<string | null>(null);
  const [compactPane, setCompactPane] = useState(initialCompact);
  const validationErrorId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const subPathKey = draft.subcommandPath.join("/");
  const drawerScopeKey = `${command.id}:${subPathKey}`;
  const moreOpen = openDrawerKey === drawerScopeKey;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = el.getBoundingClientRect().height < 580;
      setCompactPane((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spec = useMemo(
    () =>
      buildCliInvocation(
        {
          commandId: command.id,
          subcommandPath: draft.subcommandPath,
          args: draft.args,
          flags: draft.flags,
          env: draft.env,
          targetFilm: draft.targetFilm,
          mode: "execute",
        },
        catalog.context,
      ),
    [command.id, draft, catalog.context],
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
    () => ({ ...draft.args, ...draft.flags, ...draft.env }),
    [draft.args, draft.flags, draft.env],
  );

  const visibleArgs = useMemo(
    () => spec.argsDef.filter((a) => isFieldVisible(a.visibleWhen, combinedValues)),
    [spec.argsDef, combinedValues],
  );
  const visibleEnv = useMemo(
    () => spec.envDef.filter((e) => isFieldVisible(e.visibleWhen, combinedValues)),
    [spec.envDef, combinedValues],
  );
  const visibleFlags = useMemo(
    () => spec.flagsDef.filter((f) => isFieldVisible(f.visibleWhen, combinedValues)),
    [spec.flagsDef, combinedValues],
  );
  const commonFlags = useMemo(
    () => visibleFlags.filter((f) => f.tier !== "advanced"),
    [visibleFlags],
  );
  const advancedFlags = useMemo(
    () => visibleFlags.filter((f) => f.tier === "advanced"),
    [visibleFlags],
  );
  const activeAdvancedCount = useMemo(
    () =>
      advancedFlags.filter((f) => isFieldValueActive(draft.flags[f.key], f.optionalValue)).length,
    [advancedFlags, draft.flags],
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
    }
    if (decision.consumeFocus) {
      onConsumeFocusRun?.();
    }
  }, [compactTab, consoleRun?.runId, drawerScopeKey, focusConsoleRunId, onConsumeFocusRun]);

  const thisRunActive = activeRun?.commandId === command.id;
  const otherRunActive = Boolean(activeRun && activeRun.commandId !== command.id);
  const isStoppingThis = Boolean(activeRun && stoppingRunId === activeRun.runId);
  const isStoppingOther = Boolean(otherRunActive && activeRun && stoppingRunId === activeRun.runId);
  const isStoppingConsole = Boolean(consoleRun && stoppingRunId === consoleRun.runId);
  const targetLabel = formatTargetBadgeText(
    spec.cwdMode,
    draft.targetFilm,
    catalog.context,
    command.packageDir,
  );
  const activeLeaf = spec.subcommands.at(-1);
  const activeSummary = activeLeaf?.summary ?? command.summary;

  const canRun =
    !submittingRun && !activeRun && !spec.guardReason && spec.validationErrors.length === 0;
  const canHelp =
    spec.meta.helpMode !== "none" &&
    !submittingRun &&
    !activeRun &&
    helpSpec.validationErrors.length === 0;

  const triggerExecute = () => {
    const req: CliRunRequest = {
      commandId: command.id,
      subcommandPath: draft.subcommandPath,
      args: draft.args,
      flags: draft.flags,
      env: draft.env,
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
    visibleArgs.length === 0 && visibleEnv.length === 0 && visibleFlags.length === 0;

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
      onRemoveToken={onRemoveToken}
      onReset={onReset}
    />
  );

  const builderFieldsContent = (
    <>
      {compactPane && legoBar}

      <p className="text-tag text-muted-foreground px-1">{activeSummary}</p>

      <CliBehaviorStrip
        meta={spec.meta}
        targetLabel={targetLabel}
        missingEnvGroups={spec.missingEnvGroups}
        compact={compactPane}
      />

      {spec.guardReason && (
        <Alert variant="warn">
          <ShieldAlert aria-hidden />
          <AlertTitle>Guarded in Studio</AlertTitle>
          <AlertDescription>
            {spec.guardReason}
            {spec.meta.helpMode !== "none" ? " Help (-h) remains safe to inspect." : ""}
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
        <p className="bg-card border-hairline text-tag text-muted-foreground rounded-xl border px-3 py-2">
          No extra arguments or flags for this command — ready to run directly.
        </p>
      ) : (
        <div key={`${command.id}:${subPathKey}`} className="flex min-w-0 flex-col gap-2.5">
          {visibleArgs.length > 0 && (
            <section aria-label="Positional arguments" className="flex min-w-0 flex-col gap-1.5">
              <h4 className="text-ui px-1 font-semibold">Arguments</h4>
              <div className="bg-card border-hairline flex min-w-0 flex-col gap-3 rounded-xl border p-2.5">
                {visibleArgs.map((arg) => (
                  <CliFieldControl
                    key={`${command.id}:${subPathKey}:arg:${arg.key}`}
                    def={arg}
                    value={draft.args[arg.key] ?? arg.default}
                    context={catalog.context}
                    requiredOverride={isFieldRequired(arg, combinedValues)}
                    onChange={(v) => onUpdateField("args", arg.key, v, spec, arg.exclusiveGroup)}
                  />
                ))}
              </div>
            </section>
          )}

          {visibleEnv.length > 0 && (
            <section aria-label="Environment overrides" className="flex min-w-0 flex-col gap-1.5">
              <h4 className="text-ui px-1 font-semibold">Environment overrides</h4>
              <div className="bg-card border-hairline flex min-w-0 flex-col gap-3 rounded-xl border p-2.5">
                {visibleEnv.map((envDef) => (
                  <CliFieldControl
                    key={`${command.id}:${subPathKey}:env:${envDef.key}`}
                    def={envDef}
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
          )}

          {commonFlags.length > 0 && (
            <section aria-label="Options" className="flex min-w-0 flex-col gap-1.5">
              <h4 className="text-ui px-1 font-semibold">Options</h4>
              <div className="bg-card border-hairline flex min-w-0 flex-col gap-3 rounded-xl border p-2.5">
                {commonFlags.map((flag) => (
                  <CliFieldControl
                    key={`${command.id}:${subPathKey}:flag:${flag.key}`}
                    def={flag}
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
                      aria-label={`More options (${advancedFlags.length})`}
                      className="focus-visible:ring-ring flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left outline-none focus-visible:ring-2 pointer-coarse:min-h-10"
                    />
                  }
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-ui font-semibold">
                      More options ({advancedFlags.length})
                    </span>
                    {activeAdvancedCount > 0 && (
                      <Badge variant="open">{activeAdvancedCount} active</Badge>
                    )}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={
                      moreOpen
                        ? "text-muted-foreground size-4 shrink-0 rotate-180 transition-transform duration-150 motion-reduce:transition-none"
                        : "text-muted-foreground size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none"
                    }
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-hairline flex min-w-0 flex-col gap-3 border-t p-2.5">
                    {advancedFlags.map((flag) => (
                      <CliFieldControl
                        key={`${command.id}:${subPathKey}:adv:${flag.key}`}
                        def={flag}
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
            size="xs"
            onClick={() => onSelectCommand(activeRun.commandId)}
          >
            Open
          </Button>
          <Button
            variant="destructive"
            size="xs"
            disabled={isStoppingOther}
            onClick={() => onStopRun(activeRun.runId)}
          >
            {isStoppingOther ? "Stopping…" : "Stop"}
          </Button>
        </Callout>
      )}

      <div className="flex min-w-0 flex-none flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {thisRunActive && activeRun ? (
            <Button
              variant="destructive"
              size="md"
              disabled={isStoppingThis}
              onClick={() => onStopRun(activeRun.runId)}
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
              size="md"
              variant={
                spec.meta.effect === "destructive"
                  ? "destructive"
                  : spec.requiresConfirm
                    ? "approve"
                    : "default"
              }
              disabled={!canRun}
              aria-describedby={
                !spec.guardReason && spec.validationErrors.length > 0
                  ? validationErrorId
                  : undefined
              }
              onClick={triggerExecute}
              className="flex-1"
            >
              {submittingRun ? (
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : spec.requiresConfirm ? (
                <ShieldAlert aria-hidden />
              ) : (
                <Play aria-hidden />
              )}
              {spec.requiresConfirm ? "Review & Run" : "Run"}
            </Button>
          )}

          {spec.meta.helpMode !== "none" && (
            <Button variant="secondary" size="md" disabled={!canHelp} onClick={triggerHelp}>
              <HelpCircle aria-hidden />
              Help (-h)
            </Button>
          )}
        </div>

        {!spec.guardReason && spec.validationErrors.length > 0 && (
          <p id={validationErrorId} className="text-tag text-warn-text px-0.5">
            {spec.validationErrors[0]}
          </p>
        )}
      </div>
    </>
  );

  const consoleSection = (
    <CliConsole
      run={consoleRun}
      expanded={consoleExpanded}
      compact={compactPane}
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
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      {/* Top navigation & template save bar */}
      <div className="flex min-w-0 flex-none flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onBack}>
            <ArrowLeft aria-hidden />
            All CLI
          </Button>
          {editingTemplateName && (
            <Badge variant="open" title={editingTemplateName} className="max-w-full min-w-0 shrink">
              <span className="min-w-0 truncate">{editingTemplateName}</span>
            </Badge>
          )}
        </div>
        <Button variant="subtle" size="xs" className="shrink-0" onClick={onOpenSaveTemplate}>
          <BookmarkPlus aria-hidden />
          {editingTemplateName ? "Update template" : "Save template"}
        </Button>
      </div>

      {runError && (
        <Alert variant="destructive" className="flex-none">
          <AlertTitle>Execution failed</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      )}

      {consoleExpanded ? (
        consoleSection
      ) : compactPane ? (
        <>
          <Segmented
            label="CLI pane section"
            value={compactTab}
            onChange={setCompactTab}
            className="flex-none [&>button]:flex-1"
            items={[
              { id: "builder", title: "Configure" },
              {
                id: "output",
                title: (
                  <span className="inline-flex items-center gap-1.5">
                    <span>Output</span>
                    {consoleRun && (
                      <CliRunCompactBadge run={consoleRun} isStopping={isStoppingConsole} compact />
                    )}
                  </span>
                ),
              },
            ]}
          />
          {compactTab === "builder" ? (
            <div
              data-arrow-scroll
              className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5"
            >
              {builderFieldsContent}
            </div>
          ) : (
            consoleSection
          )}
          {actionSection}
        </>
      ) : (
        <>
          <div className="flex-none">{legoBar}</div>
          <div
            data-arrow-scroll
            className={cn(
              "flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-0.5",
              consoleRun ? "max-h-[44%] flex-none" : "flex-1",
            )}
          >
            {builderFieldsContent}
          </div>
          {actionSection}
          {consoleSection}
        </>
      )}
    </div>
  );
}
