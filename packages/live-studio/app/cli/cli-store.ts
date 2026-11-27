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

export type CliSaveDialogState =
  | { status: "closed" }
  | { status: "open"; error: string | null }
  | { status: "saving" };

export interface CliConfirmPending {
  request: CliRunRequest;
  dialog: CliConfirmRequest;
  openCommandOnStart?: boolean;
  templateToLoad?: CliTemplate;
}

export type CliRunLifecycle =
  | { status: "idle"; error: CliRunError | null }
  | { status: "confirming"; pending: CliConfirmPending }
  | { status: "submitting" }
  | { status: "running"; run: CliRunSnapshot; error: CliRunError | null }
  | { status: "stopping"; run: CliRunSnapshot };

export type CliCatalogState =
  | { status: "idle"; filmQuery: string | null }
  | { status: "loading"; catalog: CliCatalogResponse | null; filmQuery: string | null }
  | { status: "ready"; catalog: CliCatalogResponse; filmQuery: string | null }
  | { status: "error"; catalog: CliCatalogResponse | null; filmQuery: string | null; error: string };

export type CliTemplatesState =
  | { status: "loading"; templates: CliTemplate[] }
  | { status: "ready"; templates: CliTemplate[]; error: string | null };

export interface CliUiState {
  catalogState: CliCatalogState;
  templatesState: CliTemplatesState;
  view: "browse" | "workbench";
  panelMode: "embedded" | "expanded";
  helpOpen: boolean;
  searchQuery: string;
  selectedCategory: CliCategoryId | "all";
  activeCommandId: string;
  drafts: Record<string, CliCommandDraft>;
  editingTemplateId: string | null;
  runState: CliRunLifecycle;
  lastRun: CliRunSnapshot | null;
  hiddenRunId: string | null;
  consoleExpanded: boolean;
  focusConsoleRunId: string | null;
  clearedHint: string | null;
  saveDialog: CliSaveDialogState;
}

export const cliCatalogOf = (s: Pick<CliUiState, "catalogState">): CliCatalogResponse | null =>
  s.catalogState.status === "idle" ? null : s.catalogState.catalog;

export const cliActiveRunOf = (s: Pick<CliUiState, "runState">): CliRunSnapshot | null =>
  s.runState.status === "running" || s.runState.status === "stopping" ? s.runState.run : null;

export const cliStoppingRunIdOf = (s: Pick<CliUiState, "runState">): string | null =>
  s.runState.status === "stopping" ? s.runState.run.runId : null;

export const cliRunErrorOf = (s: Pick<CliUiState, "runState">): CliRunError | null =>
  s.runState.status === "idle" || s.runState.status === "running" ? s.runState.error : null;

const clearRunError = (runState: CliRunLifecycle): CliRunLifecycle =>
  runState.status === "idle"
    ? { status: "idle", error: null }
    : runState.status === "running"
      ? { ...runState, error: null }
      : runState;

export const cliStore = createStore<CliUiState>(() => ({
  catalogState: { status: "idle", filmQuery: null },
  templatesState: { status: "loading", templates: [] },
  view: "browse",
  panelMode: "embedded",
  helpOpen: false,
  searchQuery: "",
  selectedCategory: "all",
  activeCommandId: "find",
  drafts: {},
  editingTemplateId: null,
  runState: { status: "idle", error: null },
  lastRun: null,
  hiddenRunId: null,
  consoleExpanded: false,
  focusConsoleRunId: null,
  clearedHint: null,
  saveDialog: { status: "closed" },
}));

export const useCliStore = <T>(pick: (s: CliUiState) => T) => useStore(cliStore, pick);

type StreamSession =
  | { kind: "idle" }
  | {
      kind: "connected";
      runId: string;
      close: () => void;
      stopTimer: ReturnType<typeof setTimeout> | null;
    };

let streamSession: StreamSession = { kind: "idle" };
let bootPromise: Promise<void> | null = null;
let catalogRequestSeq = 0;

function clearStopFallbackTimer() {
  if (streamSession.kind === "connected" && streamSession.stopTimer !== null) {
    clearTimeout(streamSession.stopTimer);
    streamSession = { ...streamSession, stopTimer: null };
  }
}

function stopStream() {
  if (streamSession.kind === "idle") return;
  const active = streamSession;
  streamSession = { kind: "idle" };
  if (active.stopTimer !== null) clearTimeout(active.stopTimer);
  active.close();
}

function appendChunkToRun(run: CliRunSnapshot, chunk: CliRunChunk): CliRunSnapshot {
  const last = run.output.at(-1);
  if (last && chunk.seq <= last.seq && run.output.some((c) => c.seq === chunk.seq)) return run;
  return { ...run, output: [...run.output, chunk] };
}

function attachRunStream(run: CliRunSnapshot) {
  if (run.status !== "running") return;
  if (streamSession.kind === "connected" && streamSession.runId === run.runId) return;
  stopStream();
  const lastSeq = run.output.length ? run.output.at(-1)!.seq : -1;

  let ended = false;
  const close = openCliRunStream(run.runId, lastSeq, {
    onChunk: (chunk) => {
      cliStore.setState((s) => {
        if (
          (s.runState.status === "running" || s.runState.status === "stopping") &&
          s.runState.run.runId === run.runId
        ) {
          return {
            runState: { ...s.runState, run: appendChunkToRun(s.runState.run, chunk) },
          };
        }
        if (s.lastRun?.runId === run.runId) {
          return { lastRun: appendChunkToRun(s.lastRun, chunk) };
        }
        return {};
      });
    },
    onDone: (payload) => {
      ended = true;
      stopStream();
      cliStore.setState((s) => {
        const activeRun = cliActiveRunOf(s);
        const matchesActive = activeRun?.runId === payload.runId;
        const current = matchesActive ? activeRun : s.lastRun;
        if (!current) return {};
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
          runState: matchesActive ? { status: "idle", error: null } : s.runState,
          lastRun: finished,
        };
      });
    },
    onError: (terminal) => {
      if (terminal) {
        ended = true;
        if (streamSession.kind === "connected" && streamSession.runId === run.runId) {
          stopStream();
        }
      }
      void syncCliRuns();
    },
  });
  if (!ended) {
    streamSession = { kind: "connected", runId: run.runId, close, stopTimer: null };
  } else {
    close();
  }
}

export async function refreshCliCatalog(film?: string | null): Promise<void> {
  const seq = ++catalogRequestSeq;
  cliStore.setState((s) => ({
    catalogState: {
      status: "loading",
      catalog: cliCatalogOf(s),
      filmQuery: s.catalogState.filmQuery,
    },
  }));
  try {
    const catalog = await fetchCliCatalog(film);
    if (seq !== catalogRequestSeq) return;
    cliStore.setState({
      catalogState: {
        status: "ready",
        catalog,
        filmQuery: film ?? null,
      },
    });
  } catch (err) {
    if (seq !== catalogRequestSeq) return;
    const error = err instanceof Error ? err.message : String(err);
    cliStore.setState((s) => ({
      catalogState: {
        status: "error",
        catalog: cliCatalogOf(s),
        filmQuery: s.catalogState.filmQuery,
        error,
      },
    }));
  }
}

export async function refreshCliTemplates(): Promise<void> {
  try {
    const { templates, warning } = await fetchCliTemplatesState();
    cliStore.setState({
      templatesState: { status: "ready", templates, error: warning },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    cliStore.setState((s) => ({
      templatesState: { status: "ready", templates: s.templatesState.templates, error },
    }));
  }
}

export function retryCliPanel(): Promise<void> {
  const film = cliStore.getState().catalogState.filmQuery;
  return Promise.all([refreshCliCatalog(film), refreshCliTemplates(), syncCliRuns()]).then(
    () => undefined,
  );
}

export async function syncCliRuns(): Promise<void> {
  try {
    const { active, last } = await fetchCliRuns();
    cliStore.setState((s) => {
      let nextRunState = s.runState;
      if (active) {
        if (
          active.status === "running" &&
          s.runState.status === "stopping" &&
          s.runState.run.runId === active.runId
        ) {
          nextRunState = { status: "stopping", run: active };
        } else {
          const carriedError =
            s.runState.status === "running" && s.runState.run.runId === active.runId
              ? s.runState.error
              : s.runState.status === "idle" && s.runState.error?.operation === "start"
                ? s.runState.error
                : null;
          nextRunState = { status: "running", run: active, error: carriedError };
        }
      } else if (s.runState.status === "running" || s.runState.status === "stopping") {
        nextRunState = { status: "idle", error: null };
      }
      return {
        runState: nextRunState,
        lastRun: last && last.runId !== s.hiddenRunId ? last : s.lastRun,
      };
    });
    if (active && active.status === "running") {
      attachRunStream(active);
    } else if (!active) {
      stopStream();
    }
  } catch {}
}

export function syncCatalogForTarget(targetFilm: string) {
  const desiredQuery =
    !targetFilm || targetFilm === "active" || targetFilm === "root" ? null : targetFilm;
  if (cliStore.getState().catalogState.filmQuery !== desiredQuery) {
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
  return s.drafts[command.id] ?? createInitialDraft(command, cliCatalogOf(s)?.context);
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
  const draft = s.drafts[commandId] ?? createInitialDraft(cmd, cliCatalogOf(s)?.context);
  cliStore.setState({
    view: "workbench",
    activeCommandId: commandId,
    helpOpen: false,
    editingTemplateId: null,
    clearedHint: null,
    runState: clearRunError(s.runState),
    consoleExpanded: false,
    focusConsoleRunId: opts?.focusRunId ?? null,
    drafts: s.drafts[commandId] ? s.drafts : { ...s.drafts, [commandId]: draft },
  });
  syncCatalogForTarget(draft.targetFilm);
}

export function openTemplateInWorkbench(template: CliTemplate) {
  const cmd = findCliCommand(template.commandId);
  if (!cmd) {
    cliStore.setState((s) => ({
      templatesState: {
        status: "ready",
        templates: s.templatesState.templates,
        error: `Command "${template.commandId}" is not available in the CLI catalog.`,
      },
    }));
    return;
  }
  const draft = draftFromTemplate(template, cmd);
  cliStore.setState((s) => ({
    view: "workbench",
    activeCommandId: cmd.id,
    helpOpen: false,
    editingTemplateId: template.id,
    clearedHint: null,
    runState: clearRunError(s.runState),
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
  const args: Record<string, CliArgValue> = {};
  const flags: Record<string, CliArgValue> = {};
  for (const a of chain.argsDef) {
    if (a.default !== undefined) args[a.key] = a.default;
  }
  for (const f of chain.flagsDef) {
    if (f.default !== undefined) flags[f.key] = f.default;
  }

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
    runState: clearRunError(prev.runState),
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
    runState: clearRunError(prev.runState),
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
  const nextDraft = createInitialDraft(cmd, cliCatalogOf(s)?.context);
  cliStore.setState({
    clearedHint: null,
    runState: clearRunError(s.runState),
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
  const ctx = cliCatalogOf(cliStore.getState())?.context ?? null;
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
  const runStatus = cliStore.getState().runState.status;
  if (runStatus === "submitting" || runStatus === "running" || runStatus === "stopping") return;
  if (opts?.confirmMeta && !request.confirmed) {
    cliStore.setState({
      runState: {
        status: "confirming",
        pending: {
          request,
          dialog: opts.confirmMeta,
          openCommandOnStart: opts.openWorkbench,
          templateToLoad: opts.templateToLoad,
        },
      },
    });
    return;
  }

  cliStore.setState({ runState: { status: "submitting" } });
  let res: Awaited<ReturnType<typeof startCliRun>>;
  try {
    res = await startCliRun(request);
  } catch (err) {
    const error: CliRunError = {
      operation: "start",
      message: err instanceof Error ? err.message : String(err),
    };
    cliStore.setState((s) => {
      if (s.runState.status === "running") {
        return { runState: { status: "running", run: s.runState.run, error } };
      }
      if (s.runState.status === "submitting") {
        return { runState: { status: "idle", error } };
      }
      return {};
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
      cliStore.setState((s) =>
        s.runState.status === "submitting"
          ? {
              runState: {
                status: "confirming",
                pending: {
                  request,
                  dialog,
                  openCommandOnStart: opts?.openWorkbench,
                  templateToLoad: opts?.templateToLoad,
                },
              },
            }
          : {},
      );
      return;
    }
    const error: CliRunError = { operation: "start", message: res.error };
    cliStore.setState((s) => {
      if (s.runState.status === "running") {
        return { runState: { status: "running", run: s.runState.run, error } };
      }
      if (s.runState.status === "submitting") {
        return { runState: { status: "idle", error } };
      }
      return {};
    });
    return;
  }

  if (opts?.templateToLoad) {
    openTemplateInWorkbench(opts.templateToLoad);
  }
  const run = res.run;
  cliStore.setState((s) => ({
    runState: { status: "running", run, error: null },
    consoleExpanded: opts?.openWorkbench ? false : s.consoleExpanded,
    focusConsoleRunId: opts?.openWorkbench ? run.runId : s.focusConsoleRunId,
    view: opts?.openWorkbench ? "workbench" : s.view,
    activeCommandId: opts?.openWorkbench ? request.commandId : s.activeCommandId,
  }));
  attachRunStream(run);
}

export async function stopCurrentRun(runId: string): Promise<void> {
  const cur = cliStore.getState().runState;
  if (cur.status === "stopping" && cur.run.runId === runId) return;
  cliStore.setState((s) => {
    const activeRun = cliActiveRunOf(s);
    if (!activeRun || activeRun.runId !== runId) return {};
    return { runState: { status: "stopping", run: activeRun } };
  });
  let stopped: CliRunSnapshot | null;
  try {
    stopped = await stopCliRun(runId);
  } catch (err) {
    const error: CliRunError = {
      operation: "stop",
      message: err instanceof Error ? err.message : String(err),
    };
    cliStore.setState((s) => {
      if (
        (s.runState.status === "stopping" || s.runState.status === "running") &&
        s.runState.run.runId === runId
      ) {
        return { runState: { status: "running", run: s.runState.run, error } };
      }
      return {};
    });
    return;
  }
  if (!stopped) {
    cliStore.setState((s) =>
      s.runState.status === "stopping" && s.runState.run.runId === runId
        ? { runState: { status: "running", run: s.runState.run, error: null } }
        : {},
    );
    await syncCliRuns();
    return;
  }
  if (stopped.status === "running") {
    cliStore.setState((s) => {
      const activeRun = cliActiveRunOf(s);
      if (!activeRun || activeRun.runId !== runId) return {};
      const merged: CliRunSnapshot = {
        ...stopped,
        output: activeRun.output.length >= stopped.output.length ? activeRun.output : stopped.output,
      };
      return { runState: { status: "stopping", run: merged } };
    });
    const afterStop = cliStore.getState().runState;
    if (afterStop.status !== "stopping" || afterStop.run.runId !== runId) return;
    attachRunStream(stopped);
    clearStopFallbackTimer();
    if (streamSession.kind === "connected" && streamSession.runId === runId) {
      const stopTimer = setTimeout(() => {
        if (streamSession.kind === "connected" && streamSession.stopTimer === stopTimer) {
          streamSession = { ...streamSession, stopTimer: null };
        }
        const rs = cliStore.getState().runState;
        if (rs.status === "stopping" && rs.run.runId === runId) {
          void syncCliRuns();
        }
      }, 2500);
      streamSession = { ...streamSession, stopTimer };
    }
    return;
  }
  if (streamSession.kind === "connected" && streamSession.runId === runId) {
    stopStream();
  }
  cliStore.setState((s) => {
    const activeRun = cliActiveRunOf(s);
    const shouldUpdateLast = activeRun?.runId === runId || !s.lastRun || s.lastRun.runId === runId;
    return {
      runState:
        activeRun?.runId === runId ? { status: "idle", error: null } : s.runState,
      lastRun: shouldUpdateLast ? stopped : s.lastRun,
    };
  });
}

export function dismissCliRunError() {
  cliStore.setState((s) => ({ runState: clearRunError(s.runState) }));
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
  if (cliStore.getState().saveDialog.status === "saving") return null;
  cliStore.setState({ saveDialog: { status: "saving" } });
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
      templatesState: { status: "ready", templates: res.templates, error: null },
      editingTemplateId: res.template.id,
      saveDialog: { status: "closed" },
    });
    return res.template;
  } catch (err) {
    cliStore.setState((s) =>
      s.saveDialog.status === "saving"
        ? {
            saveDialog: {
              status: "open",
              error: err instanceof Error ? err.message : String(err),
            },
          }
        : {},
    );
    return null;
  }
}

export async function removeTemplate(id: string): Promise<boolean> {
  try {
    const next = await deleteCliTemplate(id);
    cliStore.setState((s) => ({
      templatesState: { status: "ready", templates: next, error: null },
      editingTemplateId: s.editingTemplateId === id ? null : s.editingTemplateId,
    }));
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    cliStore.setState((s) => ({
      templatesState: { status: "ready", templates: s.templatesState.templates, error },
    }));
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
    cliStore.setState({
      templatesState: { status: "ready", templates: res.templates, error: null },
    });
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    cliStore.setState((s) => ({
      templatesState: { status: "ready", templates: s.templatesState.templates, error },
    }));
    return false;
  }
}
