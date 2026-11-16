import { Check, ChevronRight, Copy, FolderGit2, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { Tip } from "@/components/Tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  type CliCategory,
  type CliCategoryId,
  type CliCommand,
  type CliContext,
  type ResolvedCliSpec,
} from "../../src/cli-catalog.ts";
import {
  type CliCommandDraft,
  formatTargetBadgeText,
  listActiveLegoTokens,
  stopCliHotkeyPropagation,
} from "./model";

const ROOT_SUB_TOKEN = "__cli_root_sub__";

export function CliLegoBar({
  categories,
  commands,
  command,
  spec,
  draft,
  context,
  onSelectCategory,
  onSelectCommand,
  onSelectSubcommand,
  onSelectTargetFilm,
  onRemoveToken,
  onReset,
}: {
  categories: readonly CliCategory[];
  commands: readonly CliCommand[];
  command: CliCommand;
  spec: ResolvedCliSpec;
  draft: CliCommandDraft;
  context: CliContext | null;
  onSelectCategory: (cat: CliCategoryId) => void;
  onSelectCommand: (id: string) => void;
  onSelectSubcommand: (level: number, subId: string) => void;
  onSelectTargetFilm: (target: string) => void;
  onRemoveToken: (bucket: "args" | "flags" | "env", key: string) => void;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const categoryItems = categories.map((c) => ({ value: c.id, label: c.label }));
  const commandsInCategory = commands.filter((c) => c.category === command.category);
  const commandItems = commandsInCategory.map((c) => ({ value: c.id, label: c.label }));

  const supportsFilm = command.cwdModes.includes("film");
  const supportsRoot = command.cwdModes.includes("root");
  const filmChoices = context?.films ?? [];
  const targetItems: { value: string; label: string }[] = [];
  if (supportsFilm) {
    if (!context?.isDemo) {
      targetItems.push({
        value: "active",
        label: context?.activeFilm ? `film: ${context.activeFilm} (active)` : "film: active",
      });
    }
    for (const f of filmChoices) {
      if (!context?.isDemo && f === context?.activeFilm) continue;
      targetItems.push({ value: f, label: `film: ${f}` });
    }
    if (targetItems.length === 0) {
      targetItems.push({ value: "active", label: "film: none found" });
    }
  }
  if (supportsRoot) {
    targetItems.push({ value: "root", label: "repo root" });
  }

  const level1Subs = command.subcommands ?? [];
  const level1Val = draft.subcommandPath[0] ?? "";
  const level1Node = level1Subs.find((s) => s.id === level1Val);
  const level1Items = [
    ...(!command.subcommandRequired && level1Subs.length
      ? [{ value: ROOT_SUB_TOKEN, label: "(default)" }]
      : []),
    ...level1Subs.map((s) => ({ value: s.id, label: s.label })),
  ];

  const level2Subs = level1Node?.subcommands ?? [];
  const level2Val = draft.subcommandPath[1] ?? "";
  const level2Items = [
    ...(!level1Node?.subcommandRequired && level2Subs.length
      ? [{ value: ROOT_SUB_TOKEN, label: "(default)" }]
      : []),
    ...level2Subs.map((s) => ({ value: s.id, label: s.label })),
  ];

  const activeTokens = listActiveLegoTokens(spec, draft);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(spec.displayCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <section
      aria-label="Command builder chain"
      className="bg-raised-2 border-hairline flex min-w-0 flex-col gap-2 rounded-xl border p-2.5"
    >
      {/* Cascading Lego chain */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {targetItems.length <= 1 ? (
          <Badge variant="tag">
            <FolderGit2 aria-hidden />
            {formatTargetBadgeText(spec.cwdMode, draft.targetFilm, context, command.packageDir)}
          </Badge>
        ) : (
          <Select
            items={targetItems}
            value={
              targetItems.some((i) => i.value === draft.targetFilm)
                ? draft.targetFilm
                : targetItems[0]!.value
            }
            onValueChange={(v) => v && onSelectTargetFilm(v)}
          >
            <SelectTrigger size="sm" className="max-w-full" aria-label="Target directory">
              <SelectValue />
            </SelectTrigger>
            <SelectContent onKeyDown={stopCliHotkeyPropagation}>
              {targetItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />

        <Select
          items={categoryItems}
          value={command.category}
          onValueChange={(v) => v && onSelectCategory(v as CliCategoryId)}
        >
          <SelectTrigger size="sm" className="max-w-full" aria-label="Command category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent onKeyDown={stopCliHotkeyPropagation}>
            {categoryItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />

        <Select
          items={commandItems}
          value={command.id}
          onValueChange={(v) => v && onSelectCommand(v)}
        >
          <SelectTrigger size="sm" className="max-w-full" aria-label="Command">
            <SelectValue />
          </SelectTrigger>
          <SelectContent onKeyDown={stopCliHotkeyPropagation}>
            {commandItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {level1Subs.length > 0 && (
          <>
            <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
            <Select
              items={level1Items}
              value={level1Val || (command.subcommandRequired ? "" : ROOT_SUB_TOKEN)}
              onValueChange={(v) => onSelectSubcommand(0, !v || v === ROOT_SUB_TOKEN ? "" : v)}
            >
              <SelectTrigger size="sm" className="max-w-full" aria-label="Subcommand">
                <SelectValue placeholder="Subcommand…" />
              </SelectTrigger>
              <SelectContent onKeyDown={stopCliHotkeyPropagation}>
                {level1Items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {level2Subs.length > 0 && (
          <>
            <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
            <Select
              items={level2Items}
              value={level2Val || (level1Node?.subcommandRequired ? "" : ROOT_SUB_TOKEN)}
              onValueChange={(v) => onSelectSubcommand(1, !v || v === ROOT_SUB_TOKEN ? "" : v)}
            >
              <SelectTrigger size="sm" className="max-w-full" aria-label="Action subcommand">
                <SelectValue placeholder="Action…" />
              </SelectTrigger>
              <SelectContent onKeyDown={stopCliHotkeyPropagation}>
                {level2Items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      {/* Snapped active argument / flag / env pills */}
      {activeTokens.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {activeTokens.map((tok) => (
            <span
              key={tok.id}
              className="bg-tint border-primary/25 text-primary-text text-tag inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono"
            >
              <span className="truncate">{tok.text}</span>
              {tok.removable && (
                <button
                  type="button"
                  aria-label={`Remove ${tok.text}`}
                  onClick={() => onRemoveToken(tok.bucket, tok.key)}
                  className="text-primary-text/80 hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 pointer-coarse:size-10"
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Exact live assembled command */}
      <div className="bg-backdrop border-hairline-subtle flex min-w-0 items-start justify-between gap-1.5 rounded-lg border px-2 py-1.5">
        <code className="text-tag text-foreground min-w-0 flex-1 font-mono break-all select-all">
          {spec.displayCommand}
        </code>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tip label={copied ? "Copied command" : "Copy command"}>
            <Button variant="ghost" size="icon-xs" aria-label="Copy command" onClick={copyCommand}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </Tip>
          <Tip label="Reset options">
            <Button variant="ghost" size="icon-xs" aria-label="Reset options" onClick={onReset}>
              <RotateCcw aria-hidden />
            </Button>
          </Tip>
        </div>
      </div>
    </section>
  );
}
