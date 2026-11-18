import { useId } from "react";
import type { ZodIssue } from "zod";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { LessonJevConfig } from "../../src/lesson-config";
import type { InspectorView } from "./inspector-types";

type Setting = { key: keyof LessonJevConfig; label: string; help: string; multiline?: boolean };
const groups: { title: string; hint: string; view: InspectorView; fields: Setting[] }[] = [
  {
    title: "Read lesson files",
    hint: "Changes the Jev input preview.",
    view: "lessons",
    fields: [
      {
        key: "extractMode",
        label: "Content to read",
        help: "Reads headings and the metadata selected below. Full lesson text also includes the body.",
      },
      {
        key: "wordsLimit",
        label: "Characters per file",
        help: "The file path and scope label are added after this limit.",
      },
      {
        key: "frontmatterMode",
        label: "Metadata to include",
        help: "Used when reading headings. Metadata is the block at the top of a Markdown file.",
      },
      {
        key: "filmPrefix",
        label: "This-film input label",
        help: "Placed before each lesson from this film.",
      },
      {
        key: "allPrefix",
        label: "Every-film input label",
        help: "Placed before each shared lesson.",
      },
      {
        key: "dedupe",
        label: "Combine identical inputs",
        help: "Identical lesson inputs share a ranking vote.",
      },
    ],
  },
  {
    title: "Prompts for Jev",
    hint: "Changes the assembled prompt preview. It does not make a call.",
    view: "prompt",
    fields: [
      {
        key: "systemPreamble",
        label: "Extra instructions",
        help: "Prepended to the note prompt. Jev has no separate system-message field.",
        multiline: true,
      },
      {
        key: "wantedTemplate",
        label: "Note prompt",
        help: "{note} inserts the note and its replies.",
        multiline: true,
      },
      {
        key: "choiceInstructions",
        label: "Ranking question",
        help: "Asks Jev which lesson helps most.",
        multiline: true,
      },
      {
        key: "noulInstructionsTemplate",
        label: "Relevance question",
        help: "{index} is the candidate number. Checked after ranking.",
        multiline: true,
      },
      {
        key: "noulYes",
        label: "What counts as relevant",
        help: "The meaning of a yes answer.",
        multiline: true,
      },
      {
        key: "noulNo",
        label: "What counts as unrelated",
        help: "The meaning of a no answer.",
        multiline: true,
      },
    ],
  },
  {
    title: "Select matching lessons",
    hint: "A new Jev run is needed to recompute matches. Requests shows the prepared inputs.",
    view: "requests",
    fields: [
      {
        key: "show",
        label: "Maximum results to check",
        help: "Jev checks relevance for this many top-ranked files.",
      },
      {
        key: "fitNo",
        label: "Minimum relevance",
        help: "Results below this probability are omitted. Range: 0–1.",
      },
      {
        key: "fitYes",
        label: "Confident-match threshold",
        help: "At or above this value, the match is confident. Range: 0–1.",
      },
      {
        key: "choiceMax",
        label: "Candidates per final round",
        help: "Jev accepts up to 255 choices.",
      },
      {
        key: "heat",
        label: "Candidates per qualifying round",
        help: "Used for larger collections. Cannot exceed the final-round limit.",
      },
      {
        key: "keep",
        label: "Winners per qualifying round",
        help: "Must be smaller than the qualifying-round size.",
      },
    ],
  },
  {
    title: "Provider & billing",
    hint: "Changes the next manual run. Editing these fields is free.",
    view: "requests",
    fields: [
      {
        key: "route",
        label: "Provider",
        help: "Auto prefers free OpenCode Zen. Paid OpenRouter can go first if Zen is unavailable or out of quota.",
      },
      { key: "freeModel", label: "Free model ID", help: "Model sent to OpenCode Zen." },
      { key: "paidModel", label: "Paid model ID", help: "Model sent to OpenRouter." },
      {
        key: "spendCap",
        label: "Charge threshold per request (USD)",
        help: "Jev checks each charge after billing and discards responses over this amount. A run can bill several requests.",
      },
    ],
  },
  {
    title: "Note formatting",
    hint: "Formats the note sent to the AI. Lesson labels appear when there’s a match.",
    view: "ai",
    fields: [
      { key: "sectionLabel", label: "Lesson label", help: "Printed before a matched file." },
      {
        key: "sureLabel",
        label: "Confident-match label",
        help: "Leave empty to show no extra label.",
      },
      {
        key: "maybeLabel",
        label: "Uncertain-match label",
        help: "Shown between the relevance thresholds.",
      },
      {
        key: "showLines",
        label: "Show heading line numbers",
        help: "Helps the AI jump to the right line in a lesson.",
      },
      {
        key: "showScope",
        label: "Show film scope",
        help: "Distinguishes this-film lessons from shared lessons.",
      },
      {
        key: "filmLabel",
        label: "This-film output label",
        help: "Shown for lessons local to this film.",
      },
      { key: "allLabel", label: "Every-film output label", help: "Shown for shared lessons." },
      {
        key: "headingsLabel",
        label: "Heading-list introduction",
        help: "Printed between the file path and its headings.",
      },
      {
        key: "footer",
        label: "Instruction after matches",
        help: "Tells the AI what to do with the selected files.",
        multiline: true,
      },
    ],
  },
  {
    title: "Output templates",
    hint: "Changes the exact CLI text. Keep placeholders where you want values inserted.",
    view: "ai",
    fields: [
      {
        key: "fileTemplate",
        label: "Matched file template",
        help: "{section}, {kind}, {path}, {headingsLabel}.",
        multiline: true,
      },
      {
        key: "headingTemplate",
        label: "Heading template",
        help: "{line} includes its trailing space; {head} is the heading.",
        multiline: true,
      },
      {
        key: "emptyTemplate",
        label: "No-match message",
        help: "{default} keeps the normal message; {globalPath} inserts the shared folder.",
        multiline: true,
      },
      {
        key: "errorTemplate",
        label: "No-run or error message",
        help: "{default}, {why}, {globalPath} are available.",
        multiline: true,
      },
    ],
  },
  {
    title: "Remembering a rule",
    hint: "Changes the learn-instruction preview.",
    view: "learn",
    fields: [
      {
        key: "learnTemplate",
        label: "Learn instruction",
        help: "{default} keeps the standard instruction. Also accepts {globalPath}, {filmTopics}, {globalTopics}.",
        multiline: true,
      },
    ],
  },
  {
    title: "Notes CLI calls",
    hint: "Affects bun run notes after saving. Inspector permission stays separate.",
    view: "ai",
    fields: [
      {
        key: "enabled",
        label: "Allow Jev from the notes CLI",
        help: "When off, the CLI only reuses cached matches. Save settings to apply.",
      },
    ],
  },
];
const options: Partial<Record<keyof LessonJevConfig, { value: string; label: string }[]>> = {
  extractMode: [
    { value: "headers", label: "Headings and metadata" },
    { value: "full", label: "Full lesson text" },
  ],
  frontmatterMode: [
    { value: "all", label: "All metadata" },
    { value: "when", label: "Only the when: field" },
    { value: "none", label: "No metadata" },
  ],
  route: [
    { value: "auto", label: "Auto · free preferred" },
    { value: "free", label: "Free only · OpenCode Zen" },
    { value: "paid", label: "Paid only · OpenRouter" },
  ],
};

export function inspectorSettingErrors(issues: readonly ZodIssue[]) {
  const errors: Partial<Record<keyof LessonJevConfig, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as keyof LessonJevConfig;
    if (!key || errors[key]) continue;
    errors[key] =
      issue.code === "invalid_type"
        ? issue.expected === "int"
          ? "Enter a whole number."
          : "Enter a value."
        : issue.code === "too_small" && !issue.message.startsWith("Enter ")
          ? "Enter at least " + issue.minimum + (issue.origin === "string" ? " characters." : ".")
          : issue.code === "too_big" && !issue.message.startsWith("Enter ")
            ? "Use at most " + issue.maximum + (issue.origin === "string" ? " characters." : ".")
            : issue.message;
  }
  return errors;
}

export function revealFocusedFieldError(message: HTMLElement | null) {
  const describedBy = document.activeElement?.getAttribute("aria-describedby");
  if (message && describedBy?.split(" ").includes(message.id))
    message.scrollIntoView({ block: "nearest" });
}

export function InspectorSettings({
  config,
  onChange,
  errors,
}: {
  config: LessonJevConfig;
  errors: Partial<Record<keyof LessonJevConfig, string>>;
  onChange: (
    config: LessonJevConfig,
    key: keyof LessonJevConfig,
    label: string,
    view: InspectorView,
  ) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((group) => (
        <details key={group.title} className="group">
          <summary className="text-foreground focus-visible:ring-ring cursor-pointer rounded-sm py-2 font-medium outline-none focus-visible:ring-2">
            {group.title}
          </summary>
          <p className="text-muted-foreground mb-4 text-sm/relaxed">{group.hint}</p>
          <FieldGroup>
            {group.fields.map((field) => {
              const value = config[field.key],
                fieldId = id + "-" + field.key,
                descriptionId = fieldId + "-hint",
                error = errors[field.key],
                choices = options[field.key];
              const update = (next: string | number | boolean) =>
                onChange({ ...config, [field.key]: next }, field.key, field.label, group.view);
              return (
                <Field key={field.key} data-invalid={Boolean(error) || undefined}>
                  <div className="flex items-start justify-between gap-4">
                    <FieldLabel variant="row" htmlFor={fieldId}>
                      {field.label}
                    </FieldLabel>
                    {typeof value === "boolean" && (
                      <Switch
                        id={fieldId}
                        checked={value}
                        aria-describedby={descriptionId}
                        aria-invalid={Boolean(error) || undefined}
                        onCheckedChange={update}
                      />
                    )}
                  </div>
                  {typeof value === "boolean" ? null : choices ? (
                    <Select
                      value={String(value)}
                      items={choices}
                      onValueChange={(v) => {
                        if (v) update(v);
                      }}
                    >
                      <SelectTrigger
                        size="readable"
                        id={fieldId}
                        className="w-full"
                        aria-describedby={descriptionId}
                        aria-invalid={Boolean(error) || undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} finalFocus motion="instant">
                        <SelectGroup>
                          {choices.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : typeof value === "number" ? (
                    <Input
                      size="md"
                      id={fieldId}
                      type="number"
                      step={field.key.startsWith("fit") || field.key === "spendCap" ? "0.01" : "1"}
                      value={Number.isNaN(value) ? "" : value}
                      aria-describedby={descriptionId}
                      aria-invalid={Boolean(error) || undefined}
                      onChange={(e) => update(e.target.valueAsNumber)}
                      className="max-w-32"
                    />
                  ) : field.multiline ? (
                    <Textarea
                      variant="inspector"
                      id={fieldId}
                      value={value}
                      aria-describedby={descriptionId}
                      aria-invalid={Boolean(error) || undefined}
                      className="max-h-48 overflow-y-auto overscroll-contain"
                      onChange={(e) => update(e.target.value)}
                    />
                  ) : (
                    <Input
                      size="md"
                      id={fieldId}
                      value={value}
                      aria-describedby={descriptionId}
                      aria-invalid={Boolean(error) || undefined}
                      onChange={(e) => update(e.target.value)}
                    />
                  )}
                  <p
                    id={descriptionId}
                    ref={error ? revealFocusedFieldError : undefined}
                    role={error ? "alert" : undefined}
                    className={
                      error
                        ? "text-destructive-text text-sm/relaxed"
                        : "text-muted-foreground text-sm/relaxed"
                    }
                  >
                    {error || field.help}
                  </p>
                </Field>
              );
            })}
          </FieldGroup>
        </details>
      ))}
    </div>
  );
}
