export const DEFAULT_PREVIEW_OUT = "asset_preview.jpg";
export const DEFAULT_PREVIEW_SIZE = 0.42;
export const MAX_PREVIEW_ITEMS = 36;
export const PREVIEW_JSON_PREFIX = "ASSET_PREVIEW_JSON:";

const RESERVED_WIN_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const hasControlChar = (s) => {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return true;
  return false;
};

export function validatePreviewOut(raw) {
  if (raw === undefined || raw === null) return DEFAULT_PREVIEW_OUT;
  if (typeof raw !== "string") throw new Error("--out must be a filename ending in .jpg or .png");
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|png)$/i.test(trimmed) ||
    RESERVED_WIN_NAMES.test(trimmed)
  ) {
    throw new Error(
      `--out must be a simple filename inside renders/ ending in .jpg or .png (e.g. asset_preview.jpg), got ${JSON.stringify(raw)}`,
    );
  }
  return trimmed;
}

export function validatePreviewSize(raw) {
  if (raw === undefined || raw === null) return DEFAULT_PREVIEW_SIZE;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new Error(`--size must be a number in (0, 4], got ${JSON.stringify(raw)}`);
  }
  const text = typeof raw === "number" ? String(raw) : raw.trim();
  const n = text ? Number(text) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 4) {
    throw new Error(`--size must be a number in (0, 4], got ${JSON.stringify(raw)}`);
  }
  return n;
}

export function validatePreviewLimit(raw) {
  if (raw === undefined || raw === null) return MAX_PREVIEW_ITEMS;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new Error(
      `--limit must be an integer from 1 to ${MAX_PREVIEW_ITEMS}, got ${JSON.stringify(raw)}`,
    );
  }
  const text = typeof raw === "number" ? String(raw) : raw.trim();
  const n = text ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PREVIEW_ITEMS) {
    throw new Error(
      `--limit must be an integer from 1 to ${MAX_PREVIEW_ITEMS}, got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

export function normalizePreviewEntry(raw, defaultKind) {
  if (typeof raw !== "string") throw new Error("Preview asset ID must be a string");
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed) || hasControlChar(trimmed)) {
    throw new Error(`Invalid preview asset ID ${JSON.stringify(raw)}`);
  }
  const m = /^(block|item):(.*)$/i.exec(trimmed);
  let kind;
  let body;
  if (m) {
    kind = m[1].toLowerCase();
    body = m[2];
    if (defaultKind && defaultKind !== kind) {
      throw new Error(`--kind ${defaultKind} contradicts "${trimmed}"`);
    }
  } else if (/^(mob|prop):/i.test(trimmed)) {
    throw new Error(
      `asset preview renders Minecraft blocks and items, not ${JSON.stringify(trimmed)}`,
    );
  } else if (defaultKind === "block" || defaultKind === "item") {
    kind = defaultKind;
    body = trimmed;
  } else {
    throw new Error(
      `Ambiguous asset ID ${JSON.stringify(trimmed)}: prefix with block: or item:, or pass --kind block|item`,
    );
  }
  const colon = body.indexOf(":");
  const ns = colon >= 0 ? body.slice(0, colon) : "minecraft";
  const path = colon >= 0 ? body.slice(colon + 1) : body;
  if (
    !ns ||
    !path ||
    !/^[a-z0-9._-]+$/i.test(ns) ||
    !/^[a-z0-9._/-]+$/i.test(path) ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.endsWith("/")
  ) {
    throw new Error(`Invalid ${kind} ID ${JSON.stringify(raw)}`);
  }
  const id = `${ns}:${path}`;
  return { kind, id, label: `${kind}:${id}` };
}

export function parsePreviewResultFromLog(stdout) {
  if (typeof stdout !== "string") return null;
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith(PREVIEW_JSON_PREFIX)) continue;
    try {
      return JSON.parse(line.slice(PREVIEW_JSON_PREFIX.length));
    } catch {
      return null;
    }
  }
  return null;
}
