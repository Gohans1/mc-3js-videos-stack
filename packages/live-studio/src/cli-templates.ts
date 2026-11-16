import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

import { type CliArgValue, type CliTemplate, findCliCommand } from "./cli-catalog.ts";

const MAX_TEMPLATES = 100;

const ArgValueSchema: z.ZodType<CliArgValue> = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(4000)).max(200),
]);

const RecordOfArgsSchema = z.record(z.string().max(120), ArgValueSchema);

export const CliTemplateUpsertSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  name: z
    .string()
    .trim()
    .min(1, "Template name is required")
    .max(80, "Template name must be 80 characters or fewer"),
  commandId: z.string().trim().min(1).max(80),
  subcommandPath: z.array(z.string().min(1).max(60)).max(4).optional().default([]),
  args: RecordOfArgsSchema.optional().default({}),
  flags: RecordOfArgsSchema.optional().default({}),
  env: RecordOfArgsSchema.optional().default({}),
  targetFilm: z.string().trim().min(1).max(120).optional().default("active"),
  pinned: z.boolean().optional(),
});

const StoredTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  commandId: z.string().min(1).max(80),
  subcommandPath: z.array(z.string()).default([]),
  args: RecordOfArgsSchema.default({}),
  flags: RecordOfArgsSchema.default({}),
  env: RecordOfArgsSchema.default({}),
  targetFilm: z.string().default("active"),
  pinned: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const StoredFileSchema = z.object({
  version: z.literal(1),
  templates: z.array(StoredTemplateSchema),
});

export function defaultCliTemplatesFile(): string {
  const base = process.env.APPDATA || process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "live-studio", "cli-templates.json");
}

function readAllStrict(file: string): CliTemplate[] {
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(
      `Malformed cli-templates.json (${(e as Error).message}); refusing to overwrite.`,
      {
        cause: e,
      },
    );
  }
  const arr = Array.isArray(raw) ? raw : StoredFileSchema.parse(raw).templates;
  return z.array(StoredTemplateSchema).parse(arr) as CliTemplate[];
}

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EMFILE"]);

function writeAllAtomic(file: string, templates: CliTemplate[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ version: 1, templates }, null, 2)}\n`, "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, file);
        break;
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : undefined;
        if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= 4) {
          throw error;
        }
        Bun.sleepSync(15 * (attempt + 1));
      }
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function openCliTemplates(file = defaultCliTemplatesFile()) {
  return {
    file,
    listWithWarning(): { templates: CliTemplate[]; warning: string | null } {
      if (!existsSync(file)) return { templates: [], warning: null };
      try {
        return { templates: readAllStrict(file), warning: null };
      } catch (e) {
        const msg = (e as Error).message;
        console.warn(`[cli-templates] ${msg}`);
        return { templates: [], warning: msg };
      }
    },
    list(): CliTemplate[] {
      return this.listWithWarning().templates;
    },
    upsert(input: unknown): { template: CliTemplate; templates: CliTemplate[] } {
      const parsed = CliTemplateUpsertSchema.parse(input);
      if (!findCliCommand(parsed.commandId)) {
        throw new Error(`Unknown CLI command: ${parsed.commandId}`);
      }
      const list = readAllStrict(file);
      const now = Date.now();
      const idx = parsed.id ? list.findIndex((t) => t.id === parsed.id) : -1;
      if (idx < 0 && list.length >= MAX_TEMPLATES) {
        throw new Error(
          `Template limit reached (${MAX_TEMPLATES}). Delete unused templates first.`,
        );
      }
      const id = parsed.id ?? randomUUID().replaceAll("-", "").slice(0, 12);
      const prev = idx >= 0 ? list[idx]! : null;
      const template: CliTemplate = {
        id,
        name: parsed.name,
        commandId: parsed.commandId,
        subcommandPath: parsed.subcommandPath,
        args: parsed.args,
        flags: parsed.flags,
        env: parsed.env,
        targetFilm: parsed.targetFilm,
        ...(parsed.pinned !== undefined
          ? { pinned: parsed.pinned }
          : prev?.pinned !== undefined
            ? { pinned: prev.pinned }
            : {}),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      const next = [...list];
      if (idx >= 0) next[idx] = template;
      else next.unshift(template);
      writeAllAtomic(file, next);
      return { template, templates: next };
    },
    remove(id: string): { removed: boolean; templates: CliTemplate[] } {
      const list = readAllStrict(file);
      const next = list.filter((t) => t.id !== id);
      if (next.length === list.length) return { removed: false, templates: list };
      writeAllAtomic(file, next);
      return { removed: true, templates: next };
    },
  };
}
