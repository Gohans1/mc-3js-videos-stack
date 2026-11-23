import { Check, ChevronRight, Copy, FolderGit2, RotateCcw } from "lucide-react";
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
import { toast } from "@/components/ui/toast";

import {
  type CliCategory,
  type CliCategoryId,
  type CliCommand,
  type CliContext,
  type ResolvedCliSpec,
} from "../../src/cli-catalog.ts";
import { type CliCommandDraft, formatTargetBadgeText, stopCliHotkeyPropagation } from "./model";

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
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const categoryItems = categories.map((c) => ({ value: c.id, label: c.label }));
  const commandsInCategory = commands.filter((c) => c.category === command.category);
  const commandItems = commandsInCategory.map((c) => ({ value: c.id, label: c.label }));

  const supportsFilm = command.cwdModes.includes("film");
  const supportsRoot = command.cwdModes.includes("root");
  const targetItems: { value: string; label: string }[] = [];
  if (supportsFilm)
    targetItems.push({
      value: "active",
      label: `Current film: ${context?.activeFilm ?? "Unknown film"}`,
    });
  if (supportsRoot) targetItems.push({ value: "root", label: "Repo root" });

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

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(spec.copyCommand);
      setCopied(true);
      toast.add({
        title: "Command copied",
        description:
          context?.copyShell === "powershell"
            ? "Paste into PowerShell. The project folder is included."
            : "Paste into your shell. The project folder is included.",
        timeout: 5000,
      });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      toast.add({
        title: "Could not copy command",
        description: "Allow clipboard access in your browser, then try again.",
        timeout: 0,
      });
    }
  };

  return (
    <section
      aria-label="Command builder chain"
      className="bg-raised-2 border-hairline flex min-w-0 flex-col gap-2 rounded-xl border p-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {targetItems.length <= 1 ? (
          <Badge appearance="text" size="comfortable" variant="tag">
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
            <SelectTrigger size="comfortable" className="max-w-full" aria-label="Target directory">
              <SelectValue>
                {draft.targetFilm === "root"
                  ? "Repo root"
                  : (context?.activeFilm ?? "Current film")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              fitContent
              finalFocus
              className="[--text-ui:0.875rem]"
              onKeyDown={stopCliHotkeyPropagation}
            >
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
          <SelectTrigger size="comfortable" className="max-w-full" aria-label="Command category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            fitContent
            finalFocus
            className="[--text-ui:0.875rem]"
            onKeyDown={stopCliHotkeyPropagation}
          >
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
          <SelectTrigger size="comfortable" className="max-w-full" aria-label="Command">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            fitContent
            finalFocus
            className="[--text-ui:0.875rem]"
            onKeyDown={stopCliHotkeyPropagation}
          >
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
              <SelectTrigger size="comfortable" className="max-w-full" aria-label="Subcommand">
                <SelectValue placeholder="Subcommand…" />
              </SelectTrigger>
              <SelectContent
                fitContent
                finalFocus
                className="[--text-ui:0.875rem]"
                onKeyDown={stopCliHotkeyPropagation}
              >
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
              <SelectTrigger
                size="comfortable"
                className="max-w-full"
                aria-label="Action subcommand"
              >
                <SelectValue placeholder="Action…" />
              </SelectTrigger>
              <SelectContent
                fitContent
                finalFocus
                className="[--text-ui:0.875rem]"
                onKeyDown={stopCliHotkeyPropagation}
              >
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

      <div className="bg-backdrop border-hairline-subtle flex min-w-0 items-start justify-between gap-1.5 rounded-lg border px-2 py-1.5">
        <code
          tabIndex={0}
          aria-label="Command preview"
          role="region"
          className="text-code-foreground focus-visible:ring-ring h-16 min-w-0 flex-1 overflow-auto overscroll-contain font-mono text-base leading-normal font-medium wrap-anywhere select-all focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          {spec.displayCommand}
        </code>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tip label={copied ? "Copied command" : "Copy command with its working directory"}>
            <Button variant="ghost" size="icon-lg" aria-label="Copy command" onClick={copyCommand}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </Tip>
          <Tip label="Reset options">
            <Button variant="ghost" size="icon-lg" aria-label="Reset options" onClick={onReset}>
              <RotateCcw aria-hidden />
            </Button>
          </Tip>
        </div>
      </div>
    </section>
  );
}
