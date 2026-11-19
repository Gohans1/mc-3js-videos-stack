import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import * as z from "zod";

const TEMPLATES_FILE = join(
  process.env.APPDATA ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "live-studio",
  "ease-templates.json",
);

const roundCurve = (v) => v.map((x) => Math.round(x * 1000) / 1000);

export const BezierCurveSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().finite().min(-2).max(3),
    z.number().min(0).max(1),
    z.number().finite().min(-2).max(3),
  ])
  .transform(roundCurve);

export const EaseTemplateUpload = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80),
  curve: BezierCurveSchema,
  basedOn: z.string().trim().min(1).max(80).optional(),
});

const EaseTemplateEntry = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  curve: BezierCurveSchema,
  basedOn: z.string().trim().min(1).max(80).optional(),
});

const readTemplates = (path) =>
  existsSync(path) ? z.array(EaseTemplateEntry).parse(JSON.parse(readFileSync(path, "utf8"))) : [];

const writeAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
  renameSync(tmp, path);
};

export const openEaseTemplates = (file = TEMPLATES_FILE) => {
  const list = () => readTemplates(file);

  const save = (name, curve, opts = {}) => {
    const parsed = EaseTemplateUpload.parse({
      id: opts.id,
      name,
      curve,
      basedOn: opts.basedOn,
    });
    const all = list();
    const existing = parsed.id ? all.findIndex((item) => item.id === parsed.id) : -1;
    const entry = {
      id: existing >= 0 ? parsed.id : randomUUID(),
      name: parsed.name,
      curve: parsed.curve,
      ...(parsed.basedOn
        ? { basedOn: parsed.basedOn }
        : existing >= 0 && all[existing].basedOn
          ? { basedOn: all[existing].basedOn }
          : {}),
    };
    const next = existing >= 0 ? all.map((x, i) => (i === existing ? entry : x)) : [...all, entry];
    writeAtomic(file, next);
    return entry;
  };

  const remove = (id) => {
    const all = list();
    const next = all.filter((x) => x.id !== id);
    if (next.length !== all.length) writeAtomic(file, next);
    return { ok: true, id };
  };

  return { list, save, remove };
};
