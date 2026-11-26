import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch as watchFs,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as z from "zod";

import {
  isSafeSoundId,
  KIT_CATEGORIES,
  KIT_CATEGORY_IDS,
  KIT_STATUSES,
  SOUND_ID_RE,
  TASTE_REASONS,
} from "./sound-kit-classify.mjs";

export {
  isSafeSoundId,
  KIT_CATEGORIES,
  KIT_CATEGORY_IDS,
  KIT_STATUSES,
  SOUND_ID_RE,
  TASTE_REASONS,
};

export const SOUND_KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../sound-kit");
export const SOUND_KIT_FILE = join(SOUND_KIT_DIR, "core.json");

const SafeSoundIdSchema = z.string().refine(isSafeSoundId, "Invalid sound id");

export const KitCategorySchema = z.enum([
  "bgm",
  "whoosh",
  "pop-ui",
  "impact",
  "riser",
  "ambience",
  "foley-core",
  "comedy-glitch",
]);
export const KitStatusSchema = z.enum(["inbox", "core", "pass", "ban"]);
export const KitActorSchema = z.enum(["human", "ai"]);

const DEFAULT_ELO = 1500;
const ELO_K = 32;
const MAX_DECISIONS = 200;
const RETRY_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export class SoundKitCorruptError extends Error {
  constructor(message) {
    super(message);
    this.name = "SoundKitCorruptError";
  }
}

export const KitItemSchema = z.object({
  id: SafeSoundIdSchema,
  category: KitCategorySchema,
  status: KitStatusSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(16).default([]),
  note: z.string().trim().max(240).default(""),
  addedBy: KitActorSchema.default("human"),
  tier: z.union([z.literal(0), z.literal(1)]).default(0),
  elo: z.number().finite().min(400).max(3000).default(DEFAULT_ELO),
  wins: z.number().int().nonnegative().default(0),
  losses: z.number().int().nonnegative().default(0),
  picks: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().nullable().default(null),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export const KitItemInputSchema = z.object({
  id: SafeSoundIdSchema,
  category: KitCategorySchema,
  status: KitStatusSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(16).optional(),
  note: z.string().trim().max(240).optional(),
  tier: z.union([z.literal(0), z.literal(1)]).optional(),
  addedBy: KitActorSchema.optional(),
});

export const KitBatchInputSchema = z.object({
  items: z.array(KitItemInputSchema).min(1).max(500),
  skipExisting: z.boolean().default(false),
});

export const KitDecisionSchema = z.object({
  winner: SafeSoundIdSchema,
  rejected: z.array(SafeSoundIdSchema).max(8).default([]),
  category: KitCategorySchema,
  reason: z.string().trim().max(200).default(""),
  context: z.string().trim().max(160).default(""),
  at: z.string().default(() => new Date().toISOString()),
});

export const KitAbResolveSchema = z.object({
  winner: SafeSoundIdSchema,
  rejected: z.array(SafeSoundIdSchema).max(8).default([]),
  category: KitCategorySchema,
  reason: z.string().trim().max(200).default(""),
  context: z.string().trim().max(160).default(""),
  banRejected: z.boolean().default(false),
  clearTray: z.boolean().default(false),
});

export const KitAbInputSchema = z
  .object({
    slots: z.array(SafeSoundIdSchema).max(16).optional(),
    resolve: KitAbResolveSchema.optional(),
  })
  .refine((v) => v.slots !== undefined || v.resolve !== undefined, "Provide slots or resolve");

export const KitUseInputSchema = z.object({
  id: SafeSoundIdSchema,
  category: KitCategorySchema.optional(),
  rejected: z.array(SafeSoundIdSchema).max(8).default([]),
  reason: z.string().trim().max(200).default(""),
  context: z.string().trim().max(160).default(""),
});

export const KitRestoreInputSchema = z
  .object({
    items: z.record(z.string(), KitItemSchema.nullable()).default({}),
    abSlots: z.array(SafeSoundIdSchema).max(4).optional(),
    decisions: z.array(KitDecisionSchema).max(MAX_DECISIONS).optional(),
  })
  .superRefine((val, ctx) => {
    for (const [key, item] of Object.entries(val.items)) {
      if (!isSafeSoundId(key) || (item !== null && key !== item.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid or mismatched sound kit key "${key}"`,
          path: ["items", key],
        });
      }
    }
  });

const SoundKitStateSchema = z
  .object({
    version: z.literal(1).default(1),
    items: z.record(z.string(), KitItemSchema).default({}),
    abSlots: z.array(SafeSoundIdSchema).max(4).default([]),
    decisions: z.array(KitDecisionSchema).max(MAX_DECISIONS).default([]),
  })
  .superRefine((val, ctx) => {
    for (const [key, item] of Object.entries(val.items)) {
      if (!isSafeSoundId(key) || key !== item.id) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid or mismatched sound kit key "${key}"`,
          path: ["items", key],
        });
      }
    }
  });

const emptyState = () => ({
  version: 1,
  items: {},
  abSlots: [],
  decisions: [],
});

const getOwnItem = (items, id) => (Object.hasOwn(items, id) ? items[id] : undefined);

const dedupeTags = (tags) =>
  [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 16);

const dedupeSlots = (slots) => [...new Set(slots.filter(isSafeSoundId))].slice(0, 4);

const sleepSync = (ms) => {
  if (typeof Bun !== "undefined" && typeof Bun.sleepSync === "function") {
    Bun.sleepSync(ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {}
};

const readJsonWithRetry = (file) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(raw);
    } catch (err) {
      if (RETRY_RENAME_CODES.has(err?.code) && attempt < 5) {
        sleepSync(12 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
};

const withFileLock = (file, fn) => {
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5_000;
  let fd = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (err) {
      const code = err?.code;
      const retryable = code === "EEXIST" || RETRY_RENAME_CODES.has(code);
      if (!retryable) throw err;
      if (code === "EEXIST" && attempt > 0 && attempt % 5 === 0) {
        try {
          const st = statSync(lock);
          if (Date.now() - st.mtimeMs > 10_000) {
            rmSync(lock, { force: true });
            continue;
          }
        } catch {}
      }
      if (Date.now() >= deadline) {
        if (code === "EEXIST") {
          try {
            const st = statSync(lock);
            if (Date.now() - st.mtimeMs > 10_000) {
              rmSync(lock, { force: true });
              try {
                fd = openSync(lock, "wx");
                break;
              } catch {}
            }
          } catch {}
        }
        throw err;
      }
      sleepSync(8 + Math.floor(Math.random() * 14));
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (fd !== null) closeSync(fd);
    } catch {}
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        rmSync(lock, { force: true });
        break;
      } catch (err) {
        if (!RETRY_RENAME_CODES.has(err?.code) || attempt === 5) break;
        sleepSync(10 * (attempt + 1));
      }
    }
  }
};

const writeAtomic = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    writeFileSync(tmp, payload, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(tmp, file);
        return;
      } catch (err) {
        if (!RETRY_RENAME_CODES.has(err?.code) || attempt >= 8) throw err;
        sleepSync(15 * (attempt + 1));
      }
    }
  } finally {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {}
  }
};

const applyPairwiseElo = (winnerItem, loserItems) => {
  if (!loserItems.length) return;
  let winDelta = 0;
  const kEach = ELO_K / Math.sqrt(loserItems.length);
  for (const loser of loserItems) {
    const expWin = 1 / (1 + Math.pow(10, (loser.elo - winnerItem.elo) / 400));
    const delta = kEach * (1 - expWin);
    winDelta += delta;
    loser.elo = Number(Math.max(400, loser.elo - delta).toFixed(1));
    loser.losses += 1;
  }
  winnerItem.elo = Number(Math.min(3000, winnerItem.elo + winDelta).toFixed(1));
  winnerItem.wins += 1;
};

const ensureItem = (items, id, category, status, now, actor = "human") => {
  const prev = getOwnItem(items, id);
  if (prev) return prev;
  const created = {
    id,
    category,
    status,
    tags: [],
    note: "",
    addedBy: actor,
    tier: 0,
    elo: DEFAULT_ELO,
    wins: 0,
    losses: 0,
    picks: 0,
    lastUsedAt: null,
    updatedAt: now,
  };
  items[id] = created;
  return created;
};

export const summarizeSoundKit = (state) => {
  const byCategory = Object.fromEntries(
    KIT_CATEGORY_IDS.map((id) => [id, { inbox: 0, core: 0, pass: 0, ban: 0, total: 0 }]),
  );
  const totals = { inbox: 0, core: 0, pass: 0, ban: 0, total: 0 };
  for (const item of Object.values(state.items)) {
    const bucket = byCategory[item.category];
    if (!bucket) continue;
    bucket[item.status] += 1;
    bucket.total += 1;
    totals[item.status] += 1;
    totals.total += 1;
  }
  return {
    totals,
    byCategory,
    abCount: state.abSlots.length,
    decisionCount: state.decisions.length,
  };
};

export const openSoundKit = (file = SOUND_KIT_FILE) => {
  let selfStamp = "";

  const fileStamp = () => {
    try {
      const st = statSync(file);
      return `${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {
      return "";
    }
  };

  const read = () => {
    if (!existsSync(file)) return emptyState();
    let parsedJson;
    try {
      parsedJson = readJsonWithRetry(file);
    } catch (e) {
      throw new SoundKitCorruptError(`sound-kit file is unreadable: ${e.message}`);
    }
    const checked = SoundKitStateSchema.safeParse(parsedJson);
    if (!checked.success) {
      throw new SoundKitCorruptError(
        `sound-kit file has invalid schema: ${checked.error.issues[0]?.message ?? "invalid format"}`,
      );
    }
    const cleanItems = {};
    for (const [k, v] of Object.entries(checked.data.items)) {
      cleanItems[k] = v;
    }
    return {
      version: 1,
      items: cleanItems,
      abSlots: dedupeSlots(checked.data.abSlots),
      decisions: checked.data.decisions.slice(-MAX_DECISIONS),
    };
  };

  const shownWithWarning = () => {
    try {
      return { state: read(), warning: null };
    } catch (e) {
      console.warn(
        `sound-kit: ${file} doesn't parse (${e.message}); showing empty kit until fixed`,
      );
      return {
        state: emptyState(),
        warning: `sound-kit: ${basename(file)} doesn't parse (${e.message}); showing empty kit until fixed`,
      };
    }
  };

  const shown = () => shownWithWarning().state;

  const NO_WRITE = Symbol("no-write");

  const mutate = (fn) =>
    withFileLock(file, () => {
      const state = read();
      const result = fn(state);
      if (result === NO_WRITE) return state;
      writeAtomic(file, state);
      selfStamp = fileStamp();
      return result;
    });

  const applyResolveInPlace = (state, r) => {
    const now = new Date().toISOString();
    const winItem = ensureItem(state.items, r.winner, r.category, "core", now, "human");
    winItem.category = r.category;
    winItem.status = "core";
    winItem.addedBy = "human";
    winItem.updatedAt = now;
    if (r.reason && !winItem.note) winItem.note = r.reason;

    const rejected = [...new Set(r.rejected.filter((id) => id !== r.winner && isSafeSoundId(id)))];
    const loserItems = [];
    for (const id of rejected) {
      const prevRej = getOwnItem(state.items, id);
      const nextStatus = r.banRejected ? "ban" : (prevRej?.status ?? "inbox");
      const item = ensureItem(
        state.items,
        id,
        prevRej?.category ?? r.category,
        nextStatus,
        now,
        "human",
      );
      if (r.banRejected) {
        item.status = "ban";
        item.addedBy = "human";
        if (!item.note && r.reason) {
          item.note = `rejected vs ${r.winner}: ${r.reason}`.slice(0, 240);
        }
      }
      item.updatedAt = now;
      loserItems.push(item);
    }
    applyPairwiseElo(winItem, loserItems);
    state.decisions = [
      ...state.decisions,
      {
        winner: r.winner,
        rejected,
        category: r.category,
        reason: r.reason,
        context: r.context ?? "",
        at: now,
      },
    ].slice(-MAX_DECISIONS);
    if (r.clearTray) {
      state.abSlots = [];
    } else if (r.banRejected && rejected.length) {
      const banSet = new Set(rejected);
      state.abSlots = state.abSlots.filter((id) => !banSet.has(id));
    }
  };

  const setItem = (input) => {
    const parsed = KitItemInputSchema.parse(input);
    return mutate((state) => {
      const prev = getOwnItem(state.items, parsed.id);
      const now = new Date().toISOString();
      const nextStatus = parsed.status ?? prev?.status ?? "inbox";
      state.items[parsed.id] = {
        id: parsed.id,
        category: parsed.category,
        status: nextStatus,
        tags: parsed.tags !== undefined ? dedupeTags(parsed.tags) : (prev?.tags ?? []),
        note: parsed.note !== undefined ? parsed.note : (prev?.note ?? ""),
        addedBy: parsed.addedBy ?? prev?.addedBy ?? "human",
        tier: parsed.tier !== undefined ? parsed.tier : (prev?.tier ?? 0),
        elo: prev?.elo ?? DEFAULT_ELO,
        wins: prev?.wins ?? 0,
        losses: prev?.losses ?? 0,
        picks: prev?.picks ?? 0,
        lastUsedAt: prev?.lastUsedAt ?? null,
        updatedAt: now,
      };
      if (nextStatus === "ban" && state.abSlots.includes(parsed.id)) {
        state.abSlots = state.abSlots.filter((id) => id !== parsed.id);
      }
      return state;
    });
  };

  const batchSet = (items, opts = {}) => {
    const parsed = KitBatchInputSchema.parse({ items, skipExisting: Boolean(opts.skipExisting) });
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const state = mutate((s) => {
      const now = new Date().toISOString();
      const bannedIds = new Set();
      for (const entry of parsed.items) {
        const prev = getOwnItem(s.items, entry.id);
        if (prev && parsed.skipExisting) {
          skipped += 1;
          continue;
        }
        if (prev) updated += 1;
        else added += 1;
        const nextStatus = entry.status ?? prev?.status ?? "inbox";
        s.items[entry.id] = {
          id: entry.id,
          category: entry.category,
          status: nextStatus,
          tags: entry.tags !== undefined ? dedupeTags(entry.tags) : (prev?.tags ?? []),
          note: entry.note !== undefined ? entry.note : (prev?.note ?? ""),
          addedBy: entry.addedBy ?? prev?.addedBy ?? "ai",
          tier: entry.tier !== undefined ? entry.tier : (prev?.tier ?? 0),
          elo: prev?.elo ?? DEFAULT_ELO,
          wins: prev?.wins ?? 0,
          losses: prev?.losses ?? 0,
          picks: prev?.picks ?? 0,
          lastUsedAt: prev?.lastUsedAt ?? null,
          updatedAt: now,
        };
        if (nextStatus === "ban") bannedIds.add(entry.id);
        else bannedIds.delete(entry.id);
      }
      if (bannedIds.size && s.abSlots.length) {
        s.abSlots = s.abSlots.filter((id) => !bannedIds.has(id));
      }
      if (added === 0 && updated === 0) return NO_WRITE;
      return s;
    });
    return { state, added, updated, skipped };
  };

  const removeItems = (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      if (!isSafeSoundId(id)) throw new Error(`Invalid sound id "${id}"`);
    }
    const dropSet = new Set(list);
    if (!existsSync(file)) return emptyState();
    return mutate((state) => {
      let changed = false;
      for (const id of dropSet) {
        if (Object.hasOwn(state.items, id)) {
          delete state.items[id];
          changed = true;
        }
      }
      const nextSlots = state.abSlots.filter((slot) => !dropSet.has(slot));
      if (nextSlots.length !== state.abSlots.length) {
        state.abSlots = nextSlots;
        changed = true;
      }
      return changed ? state : NO_WRITE;
    });
  };

  const removeItem = (id) => removeItems([id]);

  const setAb = (slots) => updateAb({ slots });

  const resolveAb = (resolveInput) => updateAb({ resolve: resolveInput });

  const updateAb = (payload) => {
    const parsed = KitAbInputSchema.parse(payload);
    return mutate((state) => {
      if (parsed.slots !== undefined) state.abSlots = dedupeSlots(parsed.slots);
      if (parsed.resolve) applyResolveInPlace(state, parsed.resolve);
      return state;
    });
  };

  const recordUse = (input) => {
    const parsed = KitUseInputSchema.parse(input);
    if (!parsed.category && !existsSync(file)) return emptyState();
    return mutate((state) => {
      const now = new Date().toISOString();
      const prev = getOwnItem(state.items, parsed.id);
      const category = prev?.category ?? parsed.category;
      if (!category && !prev) return NO_WRITE;
      const item = ensureItem(
        state.items,
        parsed.id,
        category,
        prev?.status ?? "core",
        now,
        "human",
      );
      if (item.status === "inbox" || item.status === "pass") item.status = "core";
      item.picks += 1;
      item.lastUsedAt = now;
      item.updatedAt = now;
      const rejected = [
        ...new Set(parsed.rejected.filter((id) => id !== parsed.id && isSafeSoundId(id))),
      ];
      if (rejected.length) {
        const loserItems = rejected.map((id) => {
          const prevRej = getOwnItem(state.items, id);
          const loser = ensureItem(
            state.items,
            id,
            prevRej?.category ?? item.category,
            prevRej?.status ?? "inbox",
            now,
            "human",
          );
          loser.updatedAt = now;
          return loser;
        });
        applyPairwiseElo(item, loserItems);
        state.decisions = [
          ...state.decisions,
          {
            winner: parsed.id,
            rejected,
            category: item.category,
            reason: parsed.reason,
            context: parsed.context,
            at: now,
          },
        ].slice(-MAX_DECISIONS);
      }
      return state;
    });
  };

  const restoreSnapshot = (input) => {
    const parsed = KitRestoreInputSchema.parse(input);
    return mutate((state) => {
      for (const [id, item] of Object.entries(parsed.items)) {
        if (item === null) delete state.items[id];
        else state.items[id] = { ...item, tags: dedupeTags(item.tags) };
      }
      if (parsed.abSlots !== undefined) {
        state.abSlots = dedupeSlots(parsed.abSlots);
      }
      state.abSlots = state.abSlots.filter((id) => getOwnItem(state.items, id)?.status !== "ban");
      if (parsed.decisions !== undefined) {
        state.decisions = parsed.decisions.slice(-MAX_DECISIONS);
      }
      return state;
    });
  };

  const watch = (onChange) => {
    const dir = dirname(file);
    const parentDir = dirname(dir);
    const dirName = basename(dir).toLowerCase();
    const targetName = basename(file).toLowerCase();
    let timer = null;
    let dirWatcher = null;
    let parentWatcher = null;
    let lastObserved = fileStamp();

    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const nextStamp = fileStamp();
        if (nextStamp && nextStamp === selfStamp) {
          lastObserved = nextStamp;
          return;
        }
        if (nextStamp === lastObserved) return;
        lastObserved = nextStamp;
        onChange();
      }, 80);
    };

    const startDirWatch = () => {
      if (dirWatcher || !existsSync(dir)) return;
      try {
        dirWatcher = watchFs(dir, (_ev, filename) => {
          if (filename && String(filename).toLowerCase() !== targetName) return;
          trigger();
        });
        dirWatcher.on("error", () => {});
        if (parentWatcher) {
          try {
            parentWatcher.close();
          } catch {}
          parentWatcher = null;
        }
      } catch {}
    };

    startDirWatch();
    if (!dirWatcher && existsSync(parentDir)) {
      try {
        parentWatcher = watchFs(parentDir, (_ev, filename) => {
          if (filename && String(filename).toLowerCase() !== dirName) return;
          if (existsSync(dir)) {
            startDirWatch();
            trigger();
          }
        });
        parentWatcher.on("error", () => {});
      } catch {}
    }

    return () => {
      if (timer) clearTimeout(timer);
      try {
        dirWatcher?.close();
      } catch {}
      try {
        parentWatcher?.close();
      } catch {}
    };
  };

  return {
    file,
    read,
    shown,
    shownWithWarning,
    setItem,
    batchSet,
    removeItem,
    removeItems,
    setAb,
    resolveAb,
    updateAb,
    recordUse,
    restoreSnapshot,
    watch,
  };
};
