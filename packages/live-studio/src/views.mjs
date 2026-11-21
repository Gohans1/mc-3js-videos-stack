import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const VIEW_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

const validateEntry = (name, cam, seen, label) => {
  if (typeof name !== "string" || !VIEW_NAME.test(name)) {
    throw new Error(
      `invalid view name ${JSON.stringify(name)} (${label}): use 1-48 chars matching ^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$`,
    );
  }
  const key = name.toLowerCase();
  if (seen.has(key)) {
    throw new Error(`duplicate view name ${JSON.stringify(name)}`);
  }
  seen.add(key);
  if (!Array.isArray(cam) || cam.length !== 7) {
    throw new Error(
      `view ${JSON.stringify(name)} takes 7 numbers px,py,pz,lx,ly,lz,fov, got ${Array.isArray(cam) ? cam.length : typeof cam}`,
    );
  }
  for (let i = 0; i < 7; i++) {
    if (typeof cam[i] !== "number" || !Number.isFinite(cam[i])) {
      throw new Error(
        `view ${JSON.stringify(name)} item ${i + 1} must be a finite number, got ${JSON.stringify(cam[i])}`,
      );
    }
  }
  if (!(cam[6] > 0 && cam[6] < 180)) {
    throw new Error(
      `view ${JSON.stringify(name)} fov must be between 0 and 180 (exclusive), got ${cam[6]}`,
    );
  }
  return { name, cam: cam.slice() };
};

export function parseViews(raw, projectDir = process.cwd()) {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new Error(
      'empty spec; use --views "name:px,py,pz,lx,ly,lz,fov;..." or --views @path/to/views.json',
    );
  }
  const seen = new Set();
  if (text.startsWith("@")) {
    const fileSpec = text.slice(1).trim();
    if (!fileSpec) {
      throw new Error("@ requires a JSON file path, e.g. --views @views.json");
    }
    const filePath = resolve(projectDir, fileSpec);
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`file not found: ${fileSpec}`);
    }
    let data;
    try {
      data = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      throw new Error(`${fileSpec} is not valid JSON (${e.message})`, { cause: e });
    }
    if (Array.isArray(data)) {
      if (!data.length) throw new Error(`${fileSpec} has no views`);
      return data.map((item, idx) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(
            `${fileSpec} item ${idx + 1} must be { "name": "...", "cam": [7 numbers] }`,
          );
        }
        return validateEntry(item.name, item.cam, seen, `${fileSpec} item ${idx + 1}`);
      });
    }
    if (data && typeof data === "object") {
      const entries = Object.entries(data);
      if (!entries.length) throw new Error(`${fileSpec} has no views`);
      return entries.map(([name, cam]) => validateEntry(name, cam, seen, fileSpec));
    }
    throw new Error(
      `${fileSpec} must be a JSON object { name: [7 numbers] } or array [{ name, cam }]`,
    );
  }
  const trimmed = text.replace(/;\s*$/, "");
  if (!trimmed) {
    throw new Error(
      'empty spec; use --views "name:px,py,pz,lx,ly,lz,fov;..." or --views @path/to/views.json',
    );
  }
  return trimmed.split(";").map((rawPart, idx) => {
    const part = rawPart.trim();
    const colon = part.indexOf(":");
    if (colon < 0) {
      throw new Error(
        `item ${idx + 1} (${JSON.stringify(part)}) must be <name>:px,py,pz,lx,ly,lz,fov`,
      );
    }
    const name = part.slice(0, colon).trim();
    const coords = part
      .slice(colon + 1)
      .split(",")
      .map((x) => {
        const t = x.trim();
        return t === "" ? NaN : Number(t);
      });
    return validateEntry(name, coords, seen, `item ${idx + 1}`);
  });
}
