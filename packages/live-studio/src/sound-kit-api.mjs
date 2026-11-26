import { zValidator } from "@hono/zod-validator";

import { findSimilarSounds, recommendCoreSounds } from "./sound-kit-similar.mjs";
import {
  isSafeSoundId,
  KIT_CATEGORIES,
  KIT_CATEGORY_IDS,
  KitAbInputSchema,
  KitBatchInputSchema,
  KitItemInputSchema,
  KitRestoreInputSchema,
  KitUseInputSchema,
  SoundKitCorruptError,
  summarizeSoundKit,
  TASTE_REASONS,
} from "./sound-kit.mjs";

export const mountSoundKit = (
  app,
  { film, soundKit, soundKitSemanticDb, send, fresh, safeErr },
) => {
  const errStatus = (e) => {
    if (e instanceof SoundKitCorruptError) return 409;
    if (
      e?.name === "ZodError" ||
      (typeof e?.message === "string" && e.message.startsWith("Invalid "))
    ) {
      return 400;
    }
    return 500;
  };

  app.get("/api/sound-kit", (c) => {
    const { state, warning } = soundKit.shownWithWarning();
    const safeWarning = warning
      ? safeErr(new Error(warning), "sound-kit file doesn't parse; showing empty kit until fixed")
      : null;
    return fresh(c, {
      categories: KIT_CATEGORIES,
      reasons: TASTE_REASONS,
      summary: summarizeSoundKit(state),
      ...(safeWarning ? { warning: safeWarning } : {}),
      state,
    });
  });

  app.post("/api/sound-kit/item", zValidator("json", KitItemInputSchema), (c) => {
    try {
      const next = soundKit.setItem(c.req.valid("json"));
      send("sound-kit");
      return c.json(next);
    } catch (e) {
      return c.json({ error: safeErr(e, "Could not save sound kit item") }, errStatus(e));
    }
  });

  app.post("/api/sound-kit/batch", zValidator("json", KitBatchInputSchema), (c) => {
    try {
      const body = c.req.valid("json");
      const res = soundKit.batchSet(body.items, { skipExisting: body.skipExisting });
      if (res.added > 0 || res.updated > 0) send("sound-kit");
      return c.json(res);
    } catch (e) {
      return c.json({ error: safeErr(e, "Could not update sound kit batch") }, errStatus(e));
    }
  });

  app.delete("/api/sound-kit/item/:id", (c) => {
    const id = c.req.param("id");
    if (!isSafeSoundId(id)) return c.json({ error: "Invalid sound id" }, 400);
    try {
      const before = soundKit.read();
      const existed = Object.hasOwn(before.items, id) || before.abSlots.includes(id);
      const next = soundKit.removeItem(id);
      if (existed) send("sound-kit");
      return c.json(next);
    } catch (e) {
      return c.json({ error: safeErr(e, "Could not remove sound kit item") }, errStatus(e));
    }
  });

  app.post("/api/sound-kit/ab", zValidator("json", KitAbInputSchema), (c) => {
    try {
      const next = soundKit.updateAb(c.req.valid("json"));
      send("sound-kit");
      return c.json(next);
    } catch (e) {
      return c.json({ error: safeErr(e, "Could not update A/B tray") }, errStatus(e));
    }
  });

  app.post("/api/sound-kit/use", zValidator("json", KitUseInputSchema), (c) => {
    try {
      const body = c.req.valid("json");
      const next = soundKit.recordUse(body);
      if (Object.hasOwn(next.items, body.id)) send("sound-kit");
      return c.json(next);
    } catch (e) {
      return c.json({ error: safeErr(e, "Could not record sound usage") }, errStatus(e));
    }
  });

  app.post("/api/sound-kit/restore", zValidator("json", KitRestoreInputSchema), (c) => {
    try {
      const next = soundKit.restoreSnapshot(c.req.valid("json"));
      send("sound-kit");
      return c.json(next);
    } catch (e) {
      return c.json({ error: safeErr(e, "Could not restore sound kit snapshot") }, errStatus(e));
    }
  });

  app.get("/api/sound-kit/similar", (c) => {
    const name = c.req.query("name")?.trim() ?? "";
    if (!isSafeSoundId(name)) {
      return c.json({ error: "Missing or invalid sound name" }, 400);
    }
    const rawLimit = c.req.query("limit")?.trim();
    let limit = 12;
    if (rawLimit) {
      const limitNum = Number(rawLimit);
      if (!Number.isFinite(limitNum) || limitNum < 1) {
        return c.json({ error: "Invalid limit" }, 400);
      }
      limit = Math.min(40, Math.floor(limitNum));
    }
    const excludeCore = c.req.query("excludeCore") === "1";
    const library = film.sound?.library?.() ?? [];
    const state = soundKit.shown();
    const bannedIds = new Set();
    const excludeIds = new Set();
    for (const item of Object.values(state.items)) {
      if (item.status === "ban") bannedIds.add(item.id);
      else if (excludeCore && item.status === "core") excludeIds.add(item.id);
    }
    const result = findSimilarSounds(name, library, {
      limit,
      bannedIds,
      excludeIds,
      ...(soundKitSemanticDb ? { semanticDb: soundKitSemanticDb } : {}),
    });
    return fresh(c, result);
  });

  app.get("/api/sound-kit/recommend", (c) => {
    const cat = c.req.query("category")?.trim().toLowerCase() ?? "";
    if (cat && !KIT_CATEGORY_IDS.includes(cat)) {
      return c.json({ error: `Unknown category "${cat}"` }, 400);
    }
    const query = c.req.query("q")?.trim() ?? "";
    const rawTop = c.req.query("top")?.trim();
    let topN = 5;
    if (rawTop) {
      const topNum = Number(rawTop);
      if (!Number.isFinite(topNum) || topNum < 1) {
        return c.json({ error: "Invalid top" }, 400);
      }
      topN = Math.min(25, Math.floor(topNum));
    }
    const refSound = c.req.query("ref")?.trim() ?? "";
    if (refSound && !isSafeSoundId(refSound)) {
      return c.json({ error: "Invalid ref sound id" }, 400);
    }
    const rawMin = c.req.query("durMin")?.trim();
    const rawMax = c.req.query("durMax")?.trim();
    let durMin;
    let durMax;
    if (rawMin) {
      const n = Number(rawMin);
      if (!Number.isFinite(n) || n < 0) {
        return c.json({ error: "Invalid durMin" }, 400);
      }
      durMin = n;
    }
    if (rawMax) {
      const n = Number(rawMax);
      if (!Number.isFinite(n) || n < 0) {
        return c.json({ error: "Invalid durMax" }, 400);
      }
      durMax = n;
    }
    if (durMin !== undefined && durMax !== undefined && durMin > durMax) {
      return c.json({ error: "durMin must be <= durMax" }, 400);
    }
    const recentRaw = c.req.query("recent")?.trim() ?? "";
    const recentIds = recentRaw
      ? recentRaw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
    const library = film.sound?.library?.() ?? [];
    const result = recommendCoreSounds(soundKit.shown(), library, {
      category: cat || null,
      query,
      topN,
      durMin,
      durMax,
      ...(refSound ? { refSound } : {}),
      recentIds,
      ...(soundKitSemanticDb ? { semanticDb: soundKitSemanticDb } : {}),
    });
    return fresh(c, result);
  });
};
