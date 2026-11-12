import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";

import { readLUT } from "film-stage/lut";
import * as z from "zod";

import { Grade } from "./contract.ts";

const PRESETS = join(
  process.env.APPDATA ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "live-studio",
  "adjust-presets.json",
);
const Lut = z.object({
  name: z.string(),
  url: z.string().regex(/^\/studio-luts\/[a-f0-9]{64}\.(cube|3dl)$/),
});
export const LutUpload = z.object({
  name: z.string().min(1).max(200),
  source: z
    .string()
    .min(1)
    .max(16 * 1024 * 1024),
});
export const PresetUpload = z.object({ name: z.string().trim().min(1).max(100), grade: Grade });
const Preset = PresetUpload.extend({ id: z.uuid(), source: LutUpload.optional() });
const read = (path, schema) =>
  existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, "utf8"))) : [];
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1) + "\n");
  renameSync(tmp, path);
};

export const openGrades = (publicDir, presetsFile = PRESETS) => {
  const index = join(publicDir, "studio-luts", "index.json");
  const luts = () => read(index, z.array(Lut)),
    presets = () => read(presetsFile, z.array(Preset));
  const addLut = (data) => {
    const { name, source } = LutUpload.parse(data),
      format = extname(name).slice(1).toLowerCase();
    if (format !== "cube" && format !== "3dl") throw new Error("Choose a .cube or .3dl LUT");
    const texture = readLUT(source, format),
      title = texture.name || name;
    texture.dispose();
    const url = `/studio-luts/${createHash("sha256").update(source).digest("hex")}.${format}`,
      all = luts(),
      old = all.find((x) => x.url === url);
    if (old) return old;
    const lut = { name: title, url };
    mkdirSync(dirname(index), { recursive: true });
    writeFileSync(join(publicDir, url), source, { flag: "wx" });
    write(index, [...all, lut]);
    return lut;
  };
  const savePreset = (name, grade) => {
    const next = PresetUpload.parse({ name, grade }),
      all = presets();
    const preset = { ...next, id: randomUUID() };
    if (next.grade.lut) {
      const lut = Lut.parse(next.grade.lut);
      preset.source = {
        name: `preset${extname(lut.url)}`,
        source: readFileSync(join(publicDir, lut.url), "utf8"),
      };
    }
    write(presetsFile, [...all, preset]);
    return { id: preset.id, name: preset.name };
  };
  const applyPreset = (id) => {
    const preset = presets().find((p) => p.id === id);
    if (!preset) throw new Error("This preset no longer exists");
    const grade = structuredClone(preset.grade);
    if (preset.source) grade.lut = { ...grade.lut, ...addLut(preset.source) };
    return grade;
  };
  return {
    addLut,
    savePreset,
    applyPreset,
    list: () => ({ luts: luts(), presets: presets().map(({ id, name }) => ({ id, name })) }),
  };
};
