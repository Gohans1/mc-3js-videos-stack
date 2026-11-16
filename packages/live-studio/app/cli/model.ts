import type { KeyboardEvent } from "react";

import {
  buildCliInvocation,
  type CliArgDef,
  type CliArgValue,
  type CliCategoryId,
  type CliCommand,
  type CliContext,
  type CliEnvDef,
  type CliFlagDef,
  type CliMeta,
  type CliRunRequest,
  type CliSubcommand,
  type CliTemplate,
  isFieldVisible,
  type ResolvedCliSpec,
  resolveSubcommandChain,
  tokenizeWords,
} from "../../src/cli-catalog.ts";

export interface CliCommandDraft {
  commandId: string;
  subcommandPath: string[];
  targetFilm: string;
  args: Record<string, CliArgValue>;
  flags: Record<string, CliArgValue>;
  env: Record<string, CliArgValue>;
}

export interface SelectOptionItem {
  value: string;
  label: string;
}

export function createInitialDraft(
  command: CliCommand,
  context?: CliContext | null,
): CliCommandDraft {
  const firstSub =
    command.subcommandRequired && command.subcommands?.length ? [command.subcommands[0]!.id] : [];
  let subcommandPath = firstSub;
  if (firstSub.length) {
    const firstNode = command.subcommands?.[0];
    if (firstNode?.subcommandRequired && firstNode.subcommands?.length) {
      subcommandPath = [firstNode.id, firstNode.subcommands[0]!.id];
    }
  }

  const targetFilm =
    command.cwdModes.length === 1 && command.cwdModes[0] === "root"
      ? "root"
      : context?.isDemo
        ? (context.films[0] ?? "active")
        : "active";

  const chain = resolveSubcommandChain(command, subcommandPath);
  const args: Record<string, CliArgValue> = {};
  const flags: Record<string, CliArgValue> = {};

  for (const a of chain.argsDef) {
    if (a.default !== undefined) args[a.key] = a.default;
  }
  for (const f of chain.flagsDef) {
    if (f.default !== undefined) flags[f.key] = f.default;
  }

  return {
    commandId: command.id,
    subcommandPath,
    targetFilm,
    args,
    flags,
    env: {},
  };
}

export function draftFromTemplate(template: CliTemplate, command: CliCommand): CliCommandDraft {
  return {
    commandId: command.id,
    subcommandPath: [...template.subcommandPath],
    targetFilm: template.targetFilm || (command.cwdModes.includes("film") ? "active" : "root"),
    args: { ...template.args },
    flags: { ...template.flags },
    env: { ...template.env },
  };
}

export function getFieldOptions(
  def: Pick<CliArgDef | CliFlagDef | CliEnvDef, "options" | "choiceSource">,
  context: CliContext | null,
): SelectOptionItem[] {
  const seen = new Set<string>();
  const out: SelectOptionItem[] = [];
  const push = (val: string) => {
    if (seen.has(val)) return;
    seen.add(val);
    out.push({ value: val, label: val });
  };
  if (def.options) for (const o of def.options) push(o);
  if (def.choiceSource && context?.choices[def.choiceSource]) {
    for (const c of context.choices[def.choiceSource]) push(c);
  }
  return out;
}

export function resolveFieldTextSearch(cmd: CliCommand): string {
  const parts: string[] = [cmd.id, cmd.label, cmd.summary, cmd.target];
  const walkSubs = (subs?: readonly CliSubcommand[]) => {
    if (!subs) return;
    for (const s of subs) {
      parts.push(s.id, s.label, s.summary);
      if (s.flags) for (const f of s.flags) parts.push(f.flag, f.label);
      if (s.args) for (const a of s.args) parts.push(a.key, a.label);
      if (s.env) for (const e of s.env) parts.push(e.key, e.label);
      walkSubs(s.subcommands);
    }
  };
  if (cmd.flags) for (const f of cmd.flags) parts.push(f.flag, f.label);
  if (cmd.args) for (const a of cmd.args) parts.push(a.key, a.label);
  if (cmd.env) for (const e of cmd.env) parts.push(e.key, e.label);
  walkSubs(cmd.subcommands);
  return parts.join(" ").toLowerCase();
}

export function filterCommands(
  commands: readonly CliCommand[],
  query: string,
  category: CliCategoryId | "all",
  searchIndex?: Map<string, string>,
): CliCommand[] {
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  return commands.filter((cmd) => {
    if (category !== "all" && cmd.category !== category) return false;
    if (!terms.length) return true;
    const hay = searchIndex?.get(cmd.id) ?? resolveFieldTextSearch(cmd);
    return terms.every((t) => hay.includes(t));
  });
}

export function filterTemplates(templates: readonly CliTemplate[], query: string): CliTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...templates];
  const terms = q.split(/\s+/).filter(Boolean);
  return templates.filter((tpl) => {
    const hay = `${tpl.name} ${tpl.commandId} ${tpl.subcommandPath.join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function isFieldValueActive(value: CliArgValue, optionalValue?: boolean): boolean {
  if (optionalValue) return value !== undefined && value !== false;
  if (value === undefined || value === null || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function setDraftFieldWithExclusiveClear(
  draft: CliCommandDraft,
  spec: Pick<ResolvedCliSpec, "argsDef" | "flagsDef" | "envDef">,
  bucket: "args" | "flags" | "env",
  key: string,
  value: CliArgValue,
  exclusiveGroup?: string,
  optionalValue?: boolean,
): { next: CliCommandDraft; cleared: string[] } {
  const next: CliCommandDraft = {
    ...draft,
    args: { ...draft.args },
    flags: { ...draft.flags },
    env: { ...draft.env },
  };

  if (value === undefined || value === false || (Array.isArray(value) && value.length === 0)) {
    delete next[bucket][key];
  } else {
    next[bucket][key] = value;
  }

  const cleared: string[] = [];
  const activating = isFieldValueActive(value, optionalValue);
  if (activating && exclusiveGroup) {
    for (const def of spec.argsDef) {
      if (def.exclusiveGroup === exclusiveGroup && !(bucket === "args" && def.key === key)) {
        if (isFieldValueActive(next.args[def.key])) cleared.push(def.label);
        delete next.args[def.key];
      }
    }
    for (const def of spec.flagsDef) {
      if (def.exclusiveGroup === exclusiveGroup && !(bucket === "flags" && def.key === key)) {
        if (isFieldValueActive(next.flags[def.key], def.optionalValue)) cleared.push(def.flag);
        delete next.flags[def.key];
      }
    }
    for (const def of spec.envDef) {
      if (def.exclusiveGroup === exclusiveGroup && !(bucket === "env" && def.key === key)) {
        if (isFieldValueActive(next.env[def.key])) cleared.push(def.key);
        delete next.env[def.key];
      }
    }
  }

  return { next, cleared };
}

export interface ActiveLegoToken {
  id: string;
  bucket: "args" | "flags" | "env";
  key: string;
  text: string;
  removable: boolean;
}

export function listActiveLegoTokens(
  spec: ResolvedCliSpec,
  draft: CliCommandDraft,
): ActiveLegoToken[] {
  const combined: Record<string, CliArgValue> = {
    ...draft.args,
    ...draft.flags,
    ...draft.env,
  };
  const tokens: ActiveLegoToken[] = [];

  for (const def of spec.envDef) {
    if (!isFieldVisible(def.visibleWhen, combined)) continue;
    const raw = draft.env[def.key];
    if (!isFieldValueActive(raw)) continue;
    const val = def.type === "boolean" ? "1" : String(raw).trim();
    tokens.push({
      id: `env:${def.key}`,
      bucket: "env",
      key: def.key,
      text: `${def.key}=${val}`,
      removable: true,
    });
  }

  for (const def of spec.argsDef) {
    if (!isFieldVisible(def.visibleWhen, combined)) continue;
    const raw = draft.args[def.key] ?? def.default;
    if (!isFieldValueActive(raw)) continue;
    const display = Array.isArray(raw) ? raw.join(" ") : String(raw).trim();
    tokens.push({
      id: `args:${def.key}`,
      bucket: "args",
      key: def.key,
      text: display,
      removable: !def.required && draft.args[def.key] !== undefined,
    });
  }

  for (const def of spec.flagsDef) {
    if (!isFieldVisible(def.visibleWhen, combined)) continue;
    const raw = draft.flags[def.key];
    if (!isFieldValueActive(raw, def.optionalValue)) continue;
    let text = def.flag;
    if (def.type !== "boolean") {
      if (def.optionalValue && (raw === true || raw === "" || raw === null)) {
        text = def.flag;
      } else if (def.type === "csv") {
        const csv = Array.isArray(raw) ? raw.join(",") : String(raw).trim();
        if (csv) text = `${def.flag} ${csv}`;
      } else if (def.multi) {
        const list = Array.isArray(raw) ? raw.map(String) : tokenizeWords(String(raw));
        if (list.length) text = `${def.flag} ${list.join(" ")}`;
      } else {
        text = `${def.flag} ${String(raw).trim()}`;
      }
    }
    tokens.push({
      id: `flags:${def.key}`,
      bucket: "flags",
      key: def.key,
      text,
      removable: !def.required,
    });
  }

  return tokens;
}

export function buildTemplatePreviewCommand(
  template: CliTemplate,
  context: CliContext | null,
): { display: string; spec: ResolvedCliSpec | null } {
  try {
    const req: CliRunRequest = {
      commandId: template.commandId,
      subcommandPath: template.subcommandPath,
      args: template.args,
      flags: template.flags,
      env: template.env,
      targetFilm: template.targetFilm,
      mode: "execute",
    };
    const spec = buildCliInvocation(req, context ?? undefined);
    return { display: spec.displayCommand, spec };
  } catch {
    return { display: template.commandId, spec: null };
  }
}

export function formatTargetBadgeText(
  cwdMode: "film" | "root",
  targetFilm: string,
  context: CliContext | null,
  packageDir?: string,
): string {
  if (cwdMode === "root") return packageDir || "repo root";
  if (!targetFilm || targetFilm === "active" || targetFilm === "root") {
    const resolved =
      context?.activeFilm && (!context.isDemo || context.films.includes(context.activeFilm))
        ? context.activeFilm
        : context?.films[0];
    return resolved ? `films/${resolved}` : "active film (none)";
  }
  return `films/${targetFilm}`;
}

export function getCostLabel(meta: CliMeta): string {
  if (meta.cost === "paid") return meta.costHint ? `Paid · ${meta.costHint}` : "Paid API";
  if (meta.cost === "optional-paid")
    return meta.costHint ? `Optional paid · ${meta.costHint}` : "Optional paid";
  return "Free local";
}

export function getEffectLabel(effect: CliMeta["effect"]): string {
  switch (effect) {
    case "read":
      return "Read-only";
    case "write":
      return "Writes files";
    case "install":
      return "Downloads / installs";
    case "destructive":
      return "Destructive / broad write";
    case "daemon":
      return "Long-lived server";
  }
}

export function getSpeedLabel(speed: CliMeta["speed"]): string {
  switch (speed) {
    case "instant":
      return "Instant";
    case "short":
      return "Short run";
    case "long":
      return "Slow / heavy";
  }
}

export function hasNonDefaultMetaWarning(meta: CliMeta): boolean {
  return (
    Boolean(meta.guard?.disabled) ||
    meta.cost !== "free" ||
    meta.effect !== "read" ||
    meta.speed === "long"
  );
}

export interface SaveTemplateTargetPlan {
  items: SelectOptionItem[];
  defaultTarget: string;
}

export function resolveSaveTemplateTargets(opts: {
  initialTargetFilm: string;
  activeFilm: string | null;
  films: readonly string[];
  supportsFilmTarget: boolean;
  supportsRootTarget: boolean;
}): SaveTemplateTargetPlan {
  if (!opts.supportsFilmTarget) {
    return { items: [], defaultTarget: "root" };
  }

  const items: SelectOptionItem[] = [{ value: "active", label: "Follow currently open film" }];
  for (const f of opts.films) {
    items.push({
      value: f,
      label: f === opts.activeFilm ? `Pin to "${f}" (active)` : `Pin to "${f}"`,
    });
  }
  if (
    opts.initialTargetFilm &&
    opts.initialTargetFilm !== "active" &&
    opts.initialTargetFilm !== "root" &&
    !opts.films.includes(opts.initialTargetFilm)
  ) {
    items.push({
      value: opts.initialTargetFilm,
      label: `Pin to "${opts.initialTargetFilm}"`,
    });
  }
  if (opts.supportsRootTarget) {
    items.push({ value: "root", label: "Repo root (monorepo)" });
  }

  const defaultTarget = items.some((item) => item.value === opts.initialTargetFilm)
    ? opts.initialTargetFilm
    : (items[0]?.value ?? "active");
  return { items, defaultTarget };
}

const STOPPED_UNMODIFIED_KEYS = new Set([
  " ",
  "Space",
  "Spacebar",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Delete",
  "Backspace",
  "Enter",
  "=",
  "-",
  "[",
  "]",
]);

export function stopCliHotkeyPropagation(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !e.altKey) {
    if (STOPPED_UNMODIFIED_KEYS.has(e.key) || e.key.length === 1) {
      e.stopPropagation();
    }
    return;
  }
  const target = e.target as { matches?: (selector: string) => boolean } | null;
  const inTextControl =
    typeof target?.matches === "function" && target.matches("pre, input, textarea");
  if (mod && !e.altKey && inTextControl) {
    const lower = e.key.toLowerCase();
    if (lower === "a" || lower === "c" || lower === "v" || lower === "x") {
      e.stopPropagation();
    }
  }
}

export function stopCliTabHotkeyPropagation(e: KeyboardEvent): void {
  const target = e.target as { closest?: (selector: string) => unknown } | null;
  if (typeof target?.closest === "function" && target.closest("[data-cli-tab]")) {
    stopCliHotkeyPropagation(e);
  }
}

export function stopCliInputHotkeyPropagation(e: KeyboardEvent): void {
  if (e.key !== "Escape") e.stopPropagation();
}

export function commitMultiTokens(
  draft: string,
  existing: readonly string[],
  splitCommas?: boolean,
): string[] {
  const raw = draft.trim();
  if (!raw) return [...existing];
  const additions = splitCommas
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : tokenizeWords(raw);
  const next = [...existing];
  for (const a of additions) {
    if (a && !next.includes(a)) next.push(a);
  }
  return next;
}
