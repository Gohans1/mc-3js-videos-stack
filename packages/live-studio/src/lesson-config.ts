import * as z from "zod";

export const InspectorNoteSchema = z.object({
  id: z.string().max(100, "Choose another note or write a preview note.").optional(),
  text: z.string().max(50_000, "Shorten the note to 50,000 characters or fewer."),
  asks: z
    .array(
      z.object({
        text: z.string().max(10_000, "Shorten each reply to 10,000 characters or fewer."),
        at: z.string().max(100, "Choose a note with valid reply timestamps.").optional(),
      }),
    )
    .max(100, "Keep 100 replies or fewer.")
    .default([]),
});

const prompt = z.string().max(20000);
const label = z.string().max(500);
export const LessonJevConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    wordsLimit: z
      .number()
      .int()
      .min(1, "Enter 1–20,000 characters.")
      .max(20000, "Enter 1–20,000 characters.")
      .default(2000),
    extractMode: z.enum(["headers", "full"]).default("headers"),
    frontmatterMode: z.enum(["all", "when", "none"]).default("all"),
    filmPrefix: label.default("[this film] "),
    allPrefix: label.default("[every film] "),
    scopeFilter: z.enum(["both", "film", "all"]).default("both"),
    dedupe: z.boolean().default(true),
    show: z.number().int().min(1, "Enter 1–50 results.").max(50, "Enter 1–50 results.").default(5),
    fitNo: z.number().min(0).max(1).default(0.3),
    fitYes: z.number().min(0).max(1).default(0.7),
    choiceMax: z.number().int().min(2).max(255).default(255),
    heat: z.number().int().min(2).max(255).default(200),
    keep: z.number().int().min(1).max(254).default(8),
    route: z.enum(["auto", "free", "paid"]).default("auto"),
    freeModel: label.min(1).default("jev-1.13-free"),
    paidModel: label.min(1).default("typesafe/jev-1.14"),
    spendCap: z.number().min(0).max(1).default(0.05),
    systemPreamble: prompt.default(""),
    wantedTemplate: prompt.default(
      "A creator's note on their Minecraft film, for the AI about to fix what it says: {note}",
    ),
    choiceInstructions: prompt.default("Which lesson file helps most to fix what the note says?"),
    noulInstructionsTemplate: prompt.default("Is `entry_{index}` what `wanted` asks for?"),
    noulYes: prompt.default(
      "The file is about what the note asks for or complains of: reading it helps fix this note",
    ),
    noulNo: prompt.default("The file is about something else"),
    sectionLabel: label.default("lesson"),
    maybeLabel: label.default("maybe"),
    sureLabel: label.default(""),
    filmLabel: label.default("this film"),
    allLabel: label.default("every film"),
    showLines: z.boolean().default(true),
    showScope: z.boolean().default(true),
    headingsLabel: label.default(", its headings by line:"),
    footer: prompt.default(
      "lessons above return only the file name and headings by line — read those files directly for the full rules and details.",
    ),
    fileTemplate: prompt.default("{section}{kind}: {path}{headingsLabel}"),
    headingTemplate: prompt.default("  {line}{head}"),
    emptyTemplate: prompt.default("{default}"),
    errorTemplate: prompt.default("{default}"),
    learnTemplate: prompt.default("{default}"),
  })
  .strict()
  .refine((c) => c.keep < c.heat, {
    path: ["keep"],
    message: "Use fewer winners than candidates per qualifying round.",
  })
  .refine((c) => c.heat <= c.choiceMax, {
    path: ["heat"],
    message: "Do not exceed Candidates per final round.",
  })
  .refine((c) => c.fitNo <= c.fitYes, {
    path: ["fitNo"],
    message: "Do not exceed the Confident-match threshold.",
  });

export type LessonJevConfig = z.infer<typeof LessonJevConfigSchema>;
export const DEFAULT_LESSON_JEV_CONFIG = LessonJevConfigSchema.parse({});
export const fillTemplate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) => String(values[name] ?? match));

export const JEV_ENGINE_FIELDS: Record<keyof LessonJevConfig, string> = {
  enabled: "CLI: permit Jev on cache misses. Cached answers remain available when off.",
  wordsLimit: "Characters per file, despite the legacy name; path and scope prefix are extra.",
  extractMode: "headers: frontmatter + ATX headings; full: entire Markdown. Never selects folders.",
  frontmatterMode: "Used in headers mode: all frontmatter lines, only when: lines, or none.",
  filmPrefix: "Prefix sent to Jev for this film in dual scope.",
  allPrefix: "Prefix sent to Jev for every film in dual scope.",
  scopeFilter: "Which lesson files enter Jev's candidate pool.",
  dedupe: "Identical extracted inputs share one Choice vote.",
  show: "Maximum candidates checked by Noul; not a promise that any fit.",
  fitNo: "Fit below this value is omitted.",
  fitYes: "Fit at or above this value is sure; the middle range is maybe.",
  choiceMax: "Maximum candidates in the final Choice (API maximum: 255).",
  heat: "Candidates in each qualifying heat; must be <= choiceMax.",
  keep: "Winners per heat; must be less than heat so the tournament converges.",
  route: "auto: free then paid, quota-exhausted routes last; free/paid: only that provider.",
  freeModel: "Model on OpenCode Zen's /zen/v1/systemone endpoint.",
  paidModel: "Model on OpenRouter's /api/v1/systemone endpoint.",
  spendCap:
    "USD charge threshold per engine request, checked after billing. One run can bill several requests.",
  systemPreamble: "Prepended to wanted inside state. No HTTP system role exists.",
  wantedTemplate: "{note} = note text followed by every ask/reply text, separated by newlines.",
  choiceInstructions: "Choice pick.instructions, shared by heats and final.",
  noulInstructionsTemplate: "{index} = 1-based candidate number in the Noul request.",
  noulYes: "Noul criteria.true.",
  noulNo: "Noul criteria.false.",
  sectionLabel: "CLI label before each chosen file.",
  maybeLabel: "CLI label for uncertain fits.",
  sureLabel: "CLI label for sure fits; empty by default.",
  filmLabel: "CLI scope name for this film.",
  allLabel: "CLI scope name for every film.",
  showLines: "Include heading line numbers in the CLI output.",
  showScope: "Include scope in each CLI file label.",
  headingsLabel: "Text between a file path and its heading list.",
  footer: "Instruction after selected files.",
  fileTemplate: "{section}, {kind} (parenthesized scope/fit), {path}, {headingsLabel}.",
  headingTemplate: "{line} includes a trailing space when enabled; {head} is the ATX heading.",
  emptyTemplate: "{default} is the normal no-fit message; {globalPath} also available.",
  errorTemplate:
    "{default} is the normal failure/no-run message; {why}, {globalPath} also available.",
  learnTemplate:
    "{default} = complete standard learn instruction; {globalPath}, {filmTopics}, {globalTopics} also available.",
};
