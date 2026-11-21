import { createStore, useStore } from "zustand";

import {
  buildCliInvocation,
  type CliArgValue,
  type CliCatalogResponse,
  type CliCategoryId,
  type CliCommand,
  type CliRunChunk,
  type CliRunRequest,
  type CliRunSnapshot,
  type CliTemplate,
  findCliCommand,
  resolveSubcommandChain,
} from "../../src/cli-catalog.ts";
import type { CliConfirmRequest } from "./CliDialogs";
import {
  deleteCliTemplate,
  fetchCliCatalog,
  fetchCliRuns,
  fetchCliTemplatesState,
  openCliRunStream,
  saveCliTemplate,
  startCliRun,
  stopCliRun,
} from "./client";
import {
  type CliCommandDraft,
  type CliRunError,
  createInitialDraft,
  draftFromTemplate,
  formatTargetBadgeText,
  setDraftFieldWithExclusiveClear,
} from "./model";

export interface CliUiState {
  catalog: CliCatalogResponse | null;
  catalogFilmQuery: string | null;
  loadingCatalog: boolean;
  catalogError: string | null;
  templates: CliTemplate[];
  templatesLoaded: boolean;
  templatesError: string | null;
  view: "browse" | "workbench";
  panelMode: "embedded" | "expanded";
  helpOpen: boolean;
  searchQuery: string;
  selectedCategory: CliCategoryId | "all";
  activeCommandId: string;
  drafts: Record<string, CliCommandDraft>;
  editingTemplateId: string | null;
  activeRun: CliRunSnapshot | null;
  lastRun: CliRunSnapshot | null;
  hiddenRunId: string | null;
  stoppingRunId: string | null;
  consoleExpanded: boolean;
  focusConsoleRunId: string | null;
  submittingRun: boolean;
  runError: CliRunError | null;
  clearedHint: string | null;
  confirmPending: {
    request: CliRunRequest;
    dialog: CliConfirmRequest;
    openCommandOnStart?: boolean;
    templateToLoad?: CliTemplate;
  } | null;
  saveDialogOpen: boolean;
  savingTemplate: boolean;
  saveError: string | null;
}

export const cliStore = createStore<CliUiState>(() => ({
  catalog: null,
  catalogFilmQuery: null,
  loadingCatalog: false,
  catalogError: null,
  templates: [],
  templatesLoaded: false,
  templatesError: null,
  view: "browse",
  panelMode: "embedded",
  helpOpen: false,
  searchQuery: "",
  selectedCategory: "all",
  activeCommandId: "find",
  drafts: {},
  editingTemplateId: null,
  activeRun: null,
  lastRun: null,
  hiddenRunId: null,
  stoppingRunId: null,
  consoleExpanded: false,
  focusConsoleRunId: null,
  submittingRun: false,
  runError: null,
  clearedHint: null,
  confirmPending: null,
  saveDialogOpen: false,
  savingTemplate: false,
  saveError: null,
}));

export const useCliStore = <T>(pick: (s: CliUiState) => T) => useStore(cliStore, pick);

let closeStream: (() => void) | null = null;
let streamingRunId: string | null = null;
let bootPromise: Promise<void> | null = null;
let stopFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let catalogRequestSeq = 0;

function clearStopFallbackTimer() {
  if (stopFallbackTimer !== null) {
    clearTimeout(stopFallbackTimer);
    stopFallbackTimer = null;
  }
}

function stopStream() {
  clearStopFallbackTimer();
  if (closeStream) {
    closeStream();
    closeStream = null;
  }
  streamingRunId = null;
}

function appendChunkToRun(run: CliRunSnapshot | null, chunk: CliRunChunk): CliRunSnapshot | null {
  if (!run) return null;
  const last = run.output.at(-1);
  if (last && chunk.seq <= last.seq && run.output.some((c) => c.seq === chunk.seq)) return run;
  return { ...run, output: [...run.output, chunk] };
}

function attachRunStream(run: CliRunSnapshot) {
  if (run.status !== "running") return;
  if (streamingRunId === run.runId && closeStream) return;
  stopStream();
  streamingRunId = run.runId;
  const lastSeq = run.output.length ? run.output.at(-1)!.seq : -1;

  closeStream = openCliRunStream(run.runId, lastSeq, {
    onChunk: (chunk) => {
      cliStore.setState((s) => {
        if (s.activeRun?.runId === run.runId) {
          return { activeRun: appendChunkToRun(s.activeRun, chunk) };
        }
        if (s.lastRun?.runId === run.runId) {
          return { lastRun: appendChunkToRun(s.lastRun, chunk) };
        }
        return {};
      });
    },
    onDone: (payload) => {
      clearStopFallbackTimer();
      stopStream();
      cliStore.setState((s) => {
        const current = s.activeRun?.runId === payload.runId ? s.activeRun : s.lastRun;
        if (!current) {
          return {
            activeRun: null,
            stoppingRunId: s.stoppingRunId === payload.runId ? null : s.stoppingRunId,
          };
        }
        const finished: CliRunSnapshot = {
          ...current,
          status: payload.status,
          exitCode: payload.exitCode ?? current.exitCode,
          signal: payload.signal ?? current.signal,
          durationMs: payload.durationMs ?? current.durationMs,
          truncated: payload.truncated ?? current.truncated,
          error: payload.error ?? current.error,
          finishedAt: Date.now(),
        };
        return {
          stoppingRunId: s.stoppingRunId === payload.runId ? null : s.stoppingRunId,
          activeRun: s.activeRun?.runId === payload.runId ? null : s.activeRun,
          lastRun: finished,
        };
      });
    },
    onError: () => {
      // EventSource may reconnect automatically or server may have finished; refresh snapshot cleanly
      void syncCliRuns();
    },
  });
}

export async function refreshCliCatalog(film?: string | null): Promise<void> {
  const seq = ++catalogRequestSeq;
  cliStore.setState({ loadingCatalog: true, catalogError: null });
  try {
    const catalog = await fetchCliCatalog(film);
    if (seq !== catalogRequestSeq) return;
    cliStore.setState({
      catalog,
      catalogFilmQuery: film ?? null,
      loadingCatalog: false,
    });
  } catch (err) {
    if (seq !== catalogRequestSeq) return;
    cliStore.setState({
      loadingCatalog: false,
      catalogError: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function refreshCliTemplates(): Promise<void> {
  try {
    const { templates, warning } = await fetchCliTemplatesState();
    cliStore.setState({ templates, templatesLoaded: true, templatesError: warning });
  } catch (err) {
    cliStore.setState({
      templatesLoaded: true,
      templatesError: err instanceof Error ? err.message : String(err),
    });
  }
}

export function retryCliPanel(): Promise<void> {
  const film = cliStore.getState().catalogFilmQuery;
  return Promise.all([refreshCliCatalog(film), refreshCliTemplates(), syncCliRuns()]).then(
    () => undefined,
  );
}

export async function syncCliRuns(): Promise<void> {
  try {
    const { active, last } = await fetchCliRuns();
    cliStore.setState((s) => ({
      activeRun: active,
      lastRun: last && last.runId !== s.hiddenRunId ? last : s.lastRun,
      stoppingRunId:
        active && active.status === "running" && s.stoppingRunId === active.runId
          ? s.stoppingRunId
          : null,
    }));
    if (active && active.status === "running") {
      attachRunStream(active);
    } else if (!active) {
      stopStream();
    }
  } catch {
    // Ignore transient network failures
  }
}

export function syncCatalogForTarget(targetFilm: string) {
  const desiredQuery =
    !targetFilm || targetFilm === "active" || targetFilm === "root" ? null : targetFilm;
  if (cliStore.getState().catalogFilmQuery !== desiredQuery) {
    void refreshCliCatalog(desiredQuery);
  }
}

export function ensureCliLoaded(): Promise<void> {
  if (!bootPromise) {
    bootPromise = Promise.all([refreshCliCatalog(), refreshCliTemplates(), syncCliRuns()]).then(
      () => undefined,
    );
    return bootPromise;
  }
  return bootPromise.then(() => syncCliRuns());
}

export function getOrCreateDraft(command: CliCommand): CliCommandDraft {
  const s = cliStore.getState();
  return s.drafts[command.id] ?? createInitialDraft(command, s.catalog?.context);
}

export function consumeFocusConsoleRun(runId?: string) {
  cliStore.setState((s) => {
    if (!s.focusConsoleRunId) return {};
    if (runId !== undefined && s.focusConsoleRunId !== runId) return {};
    return { focusConsoleRunId: null };
  });
}

export function openCommandWorkbench(commandId: string, opts?: { focusRunId?: string }) {
  const cmd = findCliCommand(commandId);
  if (!cmd) return;
  const s = cliStore.getState();
  const draft = s.drafts[commandId] ?? createInitialDraft(cmd, s.catalog?.context);
  cliStore.setState({
    view: "workbench",
    activeCommandId: commandId,
    helpOpen: false,
    editingTemplateId: null,
    clearedHint: null,
    runError: null,
    consoleExpanded: false,
    focusConsoleRunId: opts?.focusRunId ?? null,
    drafts: s.drafts[commandId] ? s.drafts : { ...s.drafts, [commandId]: draft },
  });
  syncCatalogForTarget(draft.targetFilm);
}

export function openTemplateInWorkbench(template: CliTemplate) {
  const cmd = findCliCommand(template.commandId);
  if (!cmd) {
    cliStore.setState({
      templatesError: `Command "${template.commandId}" is not available in the CLI catalog.`,
    });
    return;
  }
  const draft = draftFromTemplate(template, cmd);
  cliStore.setState((s) => ({
    view: "workbench",
    activeCommandId: cmd.id,
    helpOpen: false,
    editingTemplateId: template.id,
    clearedHint: null,
    runError: null,
    consoleExpanded: false,
    focusConsoleRunId: null,
    drafts: { ...s.drafts, [cmd.id]: draft },
  }));
  syncCatalogForTarget(draft.targetFilm);
}

export function setActiveCommandSubcommand(level: number, subId: string) {
  const s = cliStore.getState();
  const cmd = findCliCommand(s.activeCommandId);
  if (!cmd) return;
  const current = getOrCreateDraft(cmd);
  const basePath = current.subcommandPath.slice(0, level);
  const nextPath = subId ? [...basePath, subId] : basePath;

  const chain = resolveSubcommandChain(cmd, nextPath);
  // Reset dependent fields cleanly for new subcommand and seed its defaults
  const args: Record<string, CliArgValue> = {};
  const flags: Record<string, CliArgValue> = {};
  for (const a of chain.argsDef) {
    if (a.default !== undefined) args[a.key] = a.default;
  }
  for (const f of chain.flagsDef) {
    if (f.default !== undefined) flags[f.key] = f.default;
  }

  // If moving into a nested node whose first child is required, auto-pick first leaf
  const leaf = chain.subcommands.at(-1);
  if (leaf?.subcommandRequired && leaf.subcommands?.length && nextPath.length === level + 1) {
    nextPath.push(leaf.subcommands[0]!.id);
    const leafChain = resolveSubcommandChain(cmd, nextPath);
    for (const a of leafChain.argsDef) {
      if (a.default !== undefined) args[a.key] = a.default;
    }
    for (const f of leafChain.flagsDef) {
      if (f.default !== undefined) flags[f.key] = f.default;
    }
  }

  cliStore.setState((prev) => ({
    clearedHint: null,
    runError: null,
    drafts: {
      ...prev.drafts,
      [cmd.id]: {
        ...current,
        subcommandPath: nextPath,
        args,
        flags,
        pendingInputs: {},
      },
    },
  }));
}

export function setDraftTargetFilm(commandId: string, targetFilm: string) {
  const cmd = findCliCommand(commandId);
  if (!cmd) return;
  const current = getOrCreateDraft(cmd);
  cliStore.setState((prev) => ({
    drafts: {
      ...prev.drafts,
      [commandId]: { ...current, targetFilm },
    },
  }));
  syncCatalogForTarget(targetFilm);
}

export function updatePendingInput(commandId: string, key: string, value: string) {
  const cmd = findCliCommand(commandId);
  if (!cmd) return;
  const current = getOrCreateDraft(cmd);
  const pendingInputs = { ...current.pendingInputs };
  if (value) pendingInputs[key] = value;
  else delete pendingInputs[key];
  cliStore.setState((prev) => ({
    drafts: { ...prev.drafts, [commandId]: { ...current, pendingInputs } },
  }));
}

export function updateDraftField(
  commandId: string,
  bucket: "args" | "flags",
  key: string,
  value: CliArgValue,
  spec: Parameters<typeof setDraftFieldWithExclusiveClear>[1],
  exclusiveGroup?: string,
  optionalValue?: boolean,
) {
  const cmd = findCliCommand(commandId);
  if (!cmd) return;
  const current = getOrCreateDraft(cmd);
  const { next, cleared } = setDraftFieldWithExclusiveClear(
    current,
    spec,
    bucket,
    key,
    value,
    exclusiveGroup,
    optionalValue,
  );
  cliStore.setState((prev) => ({
    runError: null,
    clearedHint: cleared.length ? `Cleared mutually exclusive ${cleared.join(", ")}` : null,
    drafts: {
      ...prev.drafts,
      [commandId]: next,
    },
  }));
}

export function resetCommandDraft(commandId: string) {
  const cmd = findCliCommand(commandId);
  if (!cmd) return;
  const s = cliStore.getState();
  const nextDraft = createInitialDraft(cmd, s.catalog?.context);
  cliStore.setState({
    clearedHint: null,
    runError: null,
    editingTemplateId: null,
    focusConsoleRunId: null,
    drafts: {
      ...s.drafts,
      [commandId]: nextDraft,
    },
  });
  syncCatalogForTarget(nextDraft.targetFilm);
}

function buildFallbackConfirmDialog(
  request: CliRunRequest,
  reason: string,
  sourceLabel?: string,
): CliConfirmRequest {
  const ctx = cliStore.getState().catalog?.context ?? null;
  try {
    const spec = buildCliInvocation(request, ctx ?? undefined);
    return {
      title: spec.command.label,
      reason,
      displayCommand: spec.displayCommand,
      cwd: formatTargetBadgeText(
        spec.cwdMode,
        request.targetFilm ?? "active",
        ctx,
        spec.command.packageDir,
      ),
      cost: spec.meta.cost,
      effect: spec.meta.effect,
      sourceLabel,
    };
  } catch {
    return {
      title: request.commandId,
      reason,
      displayCommand: `bun run ${request.commandId}`,
      cwd: request.targetFilm === "root" ? "repo root" : "active film",
      cost: "optional-paid",
      effect: "write",
      sourceLabel,
    };
  }
}

export async function dispatchCliRun(
  request: CliRunRequest,
  opts?: {
    confirmMeta?: CliConfirmRequest;
    openWorkbench?: boolean;
    templateToLoad?: CliTemplate;
  },
): Promise<void> {
  if (opts?.confirmMeta && !request.confirmed) {
    cliStore.setState({
      confirmPending: {
        request,
        dialog: opts.confirmMeta,
        openCommandOnStart: opts.openWorkbench,
        templateToLoad: opts.templateToLoad,
      },
    });
    return;
  }

  cliStore.setState({ submittingRun: true, runError: null, confirmPending: null });
  let res: Awaited<ReturnType<typeof startCliRun>>;
  try {
    res = await startCliRun(request);
  } catch (err) {
    cliStore.setState({
      submittingRun: false,
      runError: { operation: "start", message: err instanceof Error ? err.message : String(err) },
    });
    return;
  }
  if (!res.ok) {
    if (res.code === "BUSY") {
      void syncCliRuns();
    }
    if (res.code === "CONFIRM_REQUIRED") {
      const reason = res.confirmMessage ?? res.error;
      const dialog: CliConfirmRequest = opts?.confirmMeta
        ? { ...opts.confirmMeta, reason }
        : buildFallbackConfirmDialog(request, reason, opts?.templateToLoad?.name);
      cliStore.setState({
        submittingRun: false,
        confirmPending: {
          request,
          dialog,
          openCommandOnStart: opts?.openWorkbench,
          templateToLoad: opts?.templateToLoad,
        },
      });
      return;
    }
    cliStore.setState({
      submittingRun: false,
      runError: { operation: "start", message: res.error },
    });
    return;
  }

  if (opts?.templateToLoad) {
    openTemplateInWorkbench(opts.templateToLoad);
  }
  const run = res.run;
  cliStore.setState((s) => ({
    submittingRun: false,
    stoppingRunId: s.stoppingRunId === run.runId ? null : s.stoppingRunId,
    activeRun: run,
    runError: null,
    consoleExpanded: opts?.openWorkbench ? false : s.consoleExpanded,
    focusConsoleRunId: opts?.openWorkbench ? run.runId : s.focusConsoleRunId,
    view: opts?.openWorkbench ? "workbench" : s.view,
    activeCommandId: opts?.openWorkbench ? request.commandId : s.activeCommandId,
  }));
  attachRunStream(run);
}

export async function stopCurrentRun(runId: string): Promise<void> {
  cliStore.setState({ stoppingRunId: runId, runError: null });
  let stopped: CliRunSnapshot | null;
  try {
    stopped = await stopCliRun(runId);
  } catch (err) {
    cliStore.setState({
      stoppingRunId: null,
      runError: { operation: "stop", message: err instanceof Error ? err.message : String(err) },
    });
    return;
  }
  if (!stopped) {
    cliStore.setState((s) => (s.stoppingRunId === runId ? { stoppingRunId: null } : {}));
    await syncCliRuns();
    return;
  }
  if (stopped.status === "running") {
    cliStore.setState((s) => ({
      stoppingRunId: runId,
      activeRun:
        s.activeRun?.runId === runId
          ? {
              ...stopped,
              output:
                s.activeRun.output.length >= stopped.output.length
                  ? s.activeRun.output
                  : stopped.output,
            }
          : s.activeRun,
    }));
    attachRunStream(stopped);
    clearStopFallbackTimer();
    stopFallbackTimer = setTimeout(() => {
      stopFallbackTimer = null;
      if (cliStore.getState().stoppingRunId === runId) {
        void syncCliRuns();
      }
    }, 2500);
    return;
  }
  stopStream();
  cliStore.setState((s) => ({
    stoppingRunId: s.stoppingRunId === runId ? null : s.stoppingRunId,
    activeRun: s.activeRun?.runId === runId ? null : s.activeRun,
    lastRun: stopped,
  }));
}

export function hideConsoleRun(commandId: string) {
  cliStore.setState((s) =>
    s.lastRun?.commandId === commandId ? { lastRun: null, hiddenRunId: s.lastRun.runId } : {},
  );
}

export async function commitSaveTemplate(input: {
  id?: string;
  name: string;
  targetFilm: string;
  draft: CliCommandDraft;
}): Promise<CliTemplate | null> {
  cliStore.setState({ savingTemplate: true, saveError: null });
  try {
    const res = await saveCliTemplate({
      id: input.id,
      name: input.name,
      commandId: input.draft.commandId,
      subcommandPath: input.draft.subcommandPath,
      args: input.draft.args,
      flags: input.draft.flags,
      targetFilm: input.targetFilm,
    });
    cliStore.setState({
      templates: res.templates,
      editingTemplateId: res.template.id,
      saveDialogOpen: false,
      savingTemplate: false,
      saveError: null,
    });
    return res.template;
  } catch (err) {
    cliStore.setState({
      savingTemplate: false,
      saveError: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function removeTemplate(id: string): Promise<boolean> {
  try {
    const next = await deleteCliTemplate(id);
    cliStore.setState((s) => ({
      templates: next,
      templatesError: null,
      editingTemplateId: s.editingTemplateId === id ? null : s.editingTemplateId,
    }));
    return true;
  } catch (err) {
    cliStore.setState({
      templatesError: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function restoreDeletedTemplate(tpl: CliTemplate): Promise<boolean> {
  try {
    const res = await saveCliTemplate({
      id: tpl.id,
      name: tpl.name,
      commandId: tpl.commandId,
      subcommandPath: tpl.subcommandPath,
      args: tpl.args,
      flags: tpl.flags,
      targetFilm: tpl.targetFilm,
      pinned: tpl.pinned,
    });
    cliStore.setState({ templates: res.templates, templatesError: null });
    return true;
  } catch (err) {
    cliStore.setState({
      templatesError: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
