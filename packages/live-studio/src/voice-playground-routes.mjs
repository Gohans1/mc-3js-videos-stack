import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import {
  PlaygroundArchivePurge,
  PlaygroundCachedVoiceQuery,
  PlaygroundCloneLink,
  PlaygroundClonePatch,
  PlaygroundCloneSettings,
  PlaygroundCreatorFavorite,
  PlaygroundCreatorProfile,
  PlaygroundFavoriteVoiceQuery,
  PlaygroundLocalEdit,
  PlaygroundPromote,
  PlaygroundRecordingBatchPatch,
  PlaygroundRecordingQuery,
  PlaygroundRegionEdit,
  PlaygroundResumeRegion,
  PlaygroundResumeStt,
  PlaygroundTemplateBatchPatch,
  PlaygroundTemplateFromRecording,
  PlaygroundTemplateInput as Template,
  PlaygroundTemplatePatch,
  PlaygroundTemplateQuery,
  PlaygroundTtsBatch,
  PlaygroundVoiceFavorite as VoiceFavorite,
  PlaygroundVoiceFavoritesBatch,
  PlaygroundVoicePreview,
  PlaygroundVoiceProfileInput,
  PlaygroundVoiceProfilePatch,
  PlaygroundVoiceProfileQuery,
  PlaygroundVoiceSearch,
  PlaygroundVoiceUsageQuery,
} from "./voice-playground-contract.ts";
import { dubbingRoutes, streamDubbingFile } from "./voice-playground-dubbing-routes.mjs";
import { findVoiceProfiles } from "./voice-playground-profiles.mjs";
import {
  findVoiceTemplates,
  recordingCaptions,
  recordingRecipe,
} from "./voice-playground-recordings.mjs";

const validate = (schema) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success)
      return c.json({ error: result.error.issues[0]?.message ?? "Invalid input" }, 400);
  });
const libraryQuery = (schema, raw) => {
  const { scope: _scope, ...input } = raw;
  for (const key of ["includeGlobal", "favorite", "archived", "favoriteCreatorsOnly"]) {
    if (input[key] === "1" || input[key] === "true") input[key] = true;
    if (input[key] === "0" || input[key] === "false") input[key] = false;
  }
  for (const key of [
    "minRating",
    "maxRating",
    "minSeconds",
    "maxSeconds",
    "page",
    "pageSize",
    "scanPages",
  ])
    if (input[key]?.trim()) input[key] = Number(input[key]);
  return schema.safeParse(input);
};
export const speechRequestOptions = (c) => ({
  runId: c.req.header("x-voice-playground-run"),
  signal: c.req.raw.signal,
  deadline:
    c.req.header("x-voice-playground-deadline") === undefined
      ? undefined
      : Number(c.req.header("x-voice-playground-deadline")),
});

export function playgroundExtensions(
  controller,
  { favorites, onFavoritesChanged, projectId } = {},
) {
  const app = new Hono();
  app.onError((error, c) =>
    c.json(
      { error: error.message ?? "Unable to complete request; try again" },
      error.status ?? 400,
    ),
  );
  app.use("*", async (c, next) => {
    const scope = c.req.query("scope") ?? "project";
    if (scope !== "project" && scope !== "global")
      return c.json({ error: "Choose project or global library" }, 400);
    if (scope === "project" && projectId) {
      const expected = c.req.header("x-voice-playground-project");
      if (expected && expected !== projectId)
        return c.json(
          {
            error:
              "This checkpoint belongs to a different Studio project. Open the original project and resume again.",
          },
          409,
        );
      c.header("x-voice-playground-project", projectId);
    }
    c.set("playground", controller.forScope(scope));
    await next();
  });
  app.route("/dubbing", dubbingRoutes());
  for (const [path, schema, get] of [
    ["/voices/search", PlaygroundVoiceSearch, (pg, query) => pg.searchCastingVoices(query)],
    ["/voices/usage", PlaygroundVoiceUsageQuery, (pg, query) => pg.rankVoiceUsage(query)],
    ["/voices/cached", PlaygroundCachedVoiceQuery, (pg, query) => pg.searchCachedVoices(query)],
    [
      "/voice-favorite-search",
      PlaygroundFavoriteVoiceQuery,
      (pg, query) => pg.findFavoriteVoices(query),
    ],
  ]) {
    app.get(path, async (c) => {
      const parsed = libraryQuery(schema, c.req.query());
      if (!parsed.success)
        return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid filter" }, 400);
      return c.json(await get(c.get("playground"), parsed.data));
    });
  }
  app.get("/voice-creator-favorites", (c) =>
    c.json({ creators: c.get("playground").listCreatorFavorites() }),
  );
  app.put("/voice-creator-favorites", validate(PlaygroundCreatorFavorite), (c) =>
    c.json({ creators: c.get("playground").setCreatorFavorite(c.req.valid("json")) }),
  );
  app.get("/voice-creators", (c) =>
    c.json({ creators: c.get("playground").listCreatorProfiles() }),
  );
  app.put("/voice-creators", validate(PlaygroundCreatorProfile), (c) =>
    c.json({ creator: c.get("playground").saveCreatorProfile(c.req.valid("json")) }),
  );
  app.put("/voice-favorite-batch", validate(PlaygroundVoiceFavoritesBatch), async (c) =>
    c.json(await c.get("playground").setVoiceFavorites(c.req.valid("json"))),
  );
  app.post("/voices/preview", validate(PlaygroundVoicePreview), async (c) => {
    const { bytes, mimeType } = await c.get("playground").downloadVoicePreview(c.req.valid("json"));
    return new Response(bytes, {
      headers: {
        "content-type": mimeType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.post("/tts/quote", validate(PlaygroundTtsBatch), async (c) =>
    c.json(await c.get("playground").quoteTtsBatch(c.req.valid("json"))),
  );
  app.post("/tts/batch", validate(PlaygroundTtsBatch), async (c) =>
    c.json(
      await c.get("playground").startTtsBatch(c.req.valid("json"), speechRequestOptions(c)),
      202,
    ),
  );
  app.get("/tts/runs/:id", (c) =>
    c.json({ run: c.get("playground").getSpeechRun(c.req.param("id")) }),
  );
  app.get("/tts/receipts/:id", (c) => {
    const receipt = c.get("playground").getSpeechReceipt(c.req.param("id"));
    return receipt
      ? c.json({ receipt })
      : c.json({ error: "No saved receipt for this Speech job" }, 404);
  });
  app.get("/recordings", (c) => {
    const parsed = libraryQuery(PlaygroundRecordingQuery, c.req.query());
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid filter" }, 400);
    const pg = c.get("playground");
    return c.json(pg.findRecordings(parsed.data));
  });
  app.patch("/recordings", validate(PlaygroundRecordingBatchPatch), async (c) => {
    const { ids, patch } = c.req.valid("json");
    return c.json(await c.get("playground").patchItems(ids, patch));
  });
  app.get("/recordings/expired", (c) => c.json(c.get("playground").previewExpiredRecordings()));
  app.get("/recordings/:id/archive-policy", (c) =>
    c.json({ policy: c.get("playground").recordingArchivePolicy(c.req.param("id")) }),
  );
  app.post("/recordings/purge-expired", validate(PlaygroundArchivePurge), async (c) =>
    c.json(await c.get("playground").purgeExpiredRecordings(c.req.valid("json").ids)),
  );
  app.get("/profiles", (c) => {
    const parsed = libraryQuery(PlaygroundVoiceProfileQuery, c.req.query());
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid filter" }, 400);
    const pg = c.get("playground");
    return c.json(
      findVoiceProfiles(pg.listVoiceProfiles(parsed.data), parsed.data, pg.listCreatorFavorites()),
    );
  });
  app.post("/profiles", validate(PlaygroundVoiceProfileInput), (c) =>
    c.json({ profile: c.get("playground").saveVoiceProfile(c.req.valid("json")) }, 201),
  );
  app.get("/profiles/:id", (c) => {
    const profile = c.get("playground").getVoiceProfile(c.req.param("id"));
    return profile
      ? c.json({ profile })
      : c.json({ error: "Voice profile not found in this library" }, 404);
  });
  app.patch("/profiles/:id", validate(PlaygroundVoiceProfilePatch), (c) =>
    c.json({
      profile: c.get("playground").patchVoiceProfile(c.req.param("id"), c.req.valid("json")),
    }),
  );
  app.post(
    "/profiles/:id/copies",
    validate(z.strictObject({ scope: z.enum(["project", "global"]) })),
    (c) =>
      c.json(
        {
          profile: c
            .get("playground")
            .copyVoiceProfile(c.req.param("id"), c.req.valid("json").scope),
        },
        201,
      ),
  );
  app.get("/items/:id/dubbing/:asset", (c) =>
    streamDubbingFile(c, c.get("playground").dubbingAsset(c.req.param("id"), c.req.param("asset"))),
  );
  app.get("/clones", async (c) => {
    const pg = c.get("playground"),
      includeGlobal = c.req.query("includeGlobal") === "1";
    const clones =
      c.req.query("refresh") === "1"
        ? await pg.refreshClones({ includeGlobal })
        : pg.listClones({ includeGlobal });
    return c.json({ clones, favoriteVoices: pg.listVoiceFavorites() });
  });
  app.get("/clones/cloud", async (c) =>
    c.json({ voices: await c.get("playground").listCloudClones() }),
  );
  app.post(
    "/clones",
    bodyLimit({
      maxSize: 85 * 1024 * 1024,
      onError: (c) => c.json({ error: "Voice sample exceeds 80 MB" }, 413),
    }),
    async (c) => {
      const form = await c.req.formData(),
        file = form.get("file");
      if (!(file instanceof File)) return c.json({ error: "Choose a voice sample" }, 400);
      let input;
      try {
        const raw = form.get("settings");
        if (typeof raw !== "string") return c.json({ error: "Send clone settings as JSON" }, 400);
        input = JSON.parse(raw);
      } catch {
        return c.json({ error: "Invalid clone settings JSON" }, 400);
      }
      const parsed = PlaygroundCloneSettings.safeParse(input);
      if (!parsed.success)
        return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid clone settings" }, 400);
      return c.json({ clone: await c.get("playground").createClone(file, parsed.data) }, 202);
    },
  );
  app.post("/clones/adopt", validate(PlaygroundCloneLink), async (c) =>
    c.json({ clone: await c.get("playground").adoptClone(c.req.valid("json")) }, 201),
  );
  app.get("/clones/:id", (c) => {
    const clone = c.get("playground").getClone(c.req.param("id"));
    return clone
      ? c.json({ clone })
      : c.json({ error: "Clone not found in the selected library" }, 404);
  });
  app.patch("/clones/:id", validate(PlaygroundClonePatch), (c) =>
    c.json({ clone: c.get("playground").patchClone(c.req.param("id"), c.req.valid("json")) }),
  );
  app.post("/clones/:id/refresh", async (c) =>
    c.json({
      clone: await c
        .get("playground")
        .refreshClone(c.req.param("id"), { signal: c.req.raw.signal }),
    }),
  );
  app.post("/clones/:id/link", validate(PlaygroundCloneLink), async (c) =>
    c.json({ clone: await c.get("playground").linkClone(c.req.param("id"), c.req.valid("json")) }),
  );
  app.post(
    "/clones/:id/copies",
    validate(z.strictObject({ scope: z.enum(["project", "global"]) })),
    async (c) =>
      c.json(
        {
          clone: await c
            .get("playground")
            .copyCloneToScope(c.req.param("id"), c.req.valid("json").scope),
        },
        201,
      ),
  );
  app.post("/clones/:id/submit", async (c) =>
    c.json({ clone: await c.get("playground").submitClone(c.req.param("id")) }, 202),
  );
  app.post("/clones/:id/retry", async (c) =>
    c.json({ clone: await c.get("playground").retryClone(c.req.param("id")) }, 202),
  );
  app.delete("/clones/:id/cloud", async (c) =>
    c.json({ clone: await c.get("playground").deleteCloudClone(c.req.param("id")) }),
  );
  app.get("/clones/:id/source", async (c) => {
    const path = c.get("playground").cloneSource(c.req.param("id")),
      file = Bun.file(path);
    if (!(await file.exists()))
      return c.json({ error: "Original clone sample is unavailable" }, 404);
    return new Response(file.stream(), {
      headers: {
        "content-type": file.type || "application/octet-stream",
        "content-disposition": `attachment; filename="${path.split(/[\\/]/).at(-1)}"`,
        "cache-control": "no-store",
      },
    });
  });
  app.post(
    "/sources",
    bodyLimit({
      maxSize: 95 * 1024 * 1024,
      onError: (c) => c.json({ error: "Audio upload exceeds 90 MB" }, 413),
    }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("audio");
      if (!(file instanceof File)) return c.json({ error: "Choose an audio file" }, 400);
      return c.json(
        c
          .get("playground")
          .saveSource({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }),
        201,
      );
    },
  );
  app.get("/templates", (c) =>
    c.json({
      templates: c
        .get("playground")
        .listTemplates({ includeGlobal: c.req.query("includeGlobal") === "1" }),
    }),
  );
  app.get("/template-library", (c) => {
    const parsed = libraryQuery(PlaygroundTemplateQuery, c.req.query());
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid filter" }, 400);
    const pg = c.get("playground");
    return c.json(findVoiceTemplates(pg.listTemplates(parsed.data), parsed.data));
  });
  app.get("/templates/:id", (c) => {
    const template = c.get("playground").getTemplate(c.req.param("id"));
    return template
      ? c.json({ template })
      : c.json({ error: "Template not found in this library" }, 404);
  });
  app.get("/templates/:id/recipe", (c) =>
    c.json(c.get("playground").templateRecipe(c.req.param("id"))),
  );
  app.post("/templates/from-recording/:id", validate(PlaygroundTemplateFromRecording), async (c) =>
    c.json(
      {
        template: await c
          .get("playground")
          .saveTemplateFromRecording(c.req.param("id"), c.req.valid("json")),
      },
      201,
    ),
  );
  app.patch("/templates", validate(PlaygroundTemplateBatchPatch), (c) => {
    const { ids, patch } = c.req.valid("json");
    return c.json(c.get("playground").patchTemplates(ids, patch));
  });
  app.patch("/templates/:id", validate(PlaygroundTemplatePatch), async (c) => {
    const template = await c
      .get("playground")
      .patchTemplate(c.req.param("id"), c.req.valid("json"));
    return template
      ? c.json({ template })
      : c.json({ error: "Template not found in this library" }, 404);
  });
  app.post("/stt/jobs/resume", validate(PlaygroundResumeStt), (c) =>
    c.json(c.get("playground").resumeSpeechToText(c.req.valid("json")), 202),
  );
  app.get("/items/:id/region", async (c) =>
    c.json(await c.get("playground").inspectRegion(c.req.param("id"))),
  );
  app.get("/items/:id", (c) => {
    const item = c.get("playground").getItem(c.req.param("id"));
    return item
      ? c.json({ item })
      : c.json({ error: "Recording not found; choose the correct Project/Global scope" }, 404);
  });
  app.get("/items/:id/recipe", (c) => {
    const pg = c.get("playground");
    const item = pg.getItem(c.req.param("id"));
    return item
      ? c.json(recordingRecipe(item, pg.getItem))
      : c.json({ error: "Recording not found in this library" }, 404);
  });
  app.get("/items/:id/media", async (c) =>
    c.json(await c.get("playground").inspectRecordingMedia(c.req.param("id"))),
  );
  app.get("/items/:id/captions", (c) => {
    const pg = c.get("playground");
    const item = pg.getItem(c.req.param("id"));
    return item
      ? c.json(recordingCaptions(item, pg.srtFile))
      : c.json({ error: "Recording not found in this library" }, 404);
  });
  app.post("/items/:id/restore", async (c) => {
    const item = await c.get("playground").patchItem(c.req.param("id"), { archived: false });
    return item ? c.json({ item }) : c.json({ error: "Recording not found in this library" }, 404);
  });
  app.get("/items/:id/versions", (c) =>
    c.json({ items: c.get("playground").listVersions(c.req.param("id")) }),
  );
  app.post("/items/:id/versions", validate(PlaygroundRegionEdit), async (c) =>
    c.json(await c.get("playground").startRegionEdit(c.req.param("id"), c.req.valid("json")), 202),
  );
  app.post("/items/:id/versions/resume", validate(PlaygroundResumeRegion), async (c) =>
    c.json(await c.get("playground").resumeRegionEdit(c.req.param("id"), c.req.valid("json")), 202),
  );
  const regionPreviewResponse = (c, rendered) =>
    c.body(rendered.bytes, 200, {
      "content-type": "audio/wav",
      "x-audio-duration": String(rendered.durationSeconds),
      "x-region-duration": String(rendered.regionSeconds),
      "cache-control": "no-store",
    });
  app.post("/items/:id/region-preview", validate(PlaygroundLocalEdit), async (c) =>
    regionPreviewResponse(
      c,
      await c.get("playground").previewRegion(c.req.param("id"), c.req.valid("json")),
    ),
  );
  app.get("/film-takes/:id/region", async (c) =>
    c.json(await controller.forScope("project").inspectFilmRegion(c.req.param("id"))),
  );
  app.post("/film-takes/:id/region-preview", validate(PlaygroundLocalEdit), async (c) =>
    regionPreviewResponse(
      c,
      await controller
        .forScope("project")
        .previewFilmRegion(c.req.param("id"), c.req.valid("json"), c.req.query("source")),
    ),
  );
  app.post("/film-takes/:id/versions", validate(PlaygroundRegionEdit), async (c) =>
    c.json(
      await controller
        .forScope("project")
        .startFilmRegionEdit(c.req.param("id"), c.req.valid("json"), c.req.query("source")),
      202,
    ),
  );
  app.post(
    "/film-takes/:id/copies",
    validate(
      z.object({
        scope: z.enum(["project", "global"]),
        voiceName: z.string().max(200).optional(),
        name: z.string().max(120).optional(),
      }),
    ),
    async (c) => {
      const { scope, ...input } = c.req.valid("json");
      return c.json(
        { item: await controller.forScope(scope).archiveFilmTake(c.req.param("id"), input) },
        201,
      );
    },
  );
  app.post("/templates", validate(Template), async (c) =>
    c.json({ template: await c.get("playground").saveTemplate(c.req.valid("json")) }, 201),
  );
  app.delete("/templates/:id", async (c) =>
    c.json({ removed: await c.get("playground").deleteTemplate(c.req.param("id")) }),
  );
  app.post(
    "/templates/:id/copies",
    validate(z.object({ scope: z.enum(["project", "global"]) })),
    async (c) =>
      c.json(
        {
          template: await c
            .get("playground")
            .copyTemplateToScope(c.req.param("id"), c.req.valid("json").scope),
        },
        201,
      ),
  );
  app.get("/usage", (c) => c.json({ usage: c.get("playground").listUsage() }));
  app.post("/apply", validate(PlaygroundPromote), async (c) =>
    c.json(await c.get("playground").applyToFilm(c.req.valid("json"))),
  );
  app.post(
    "/usage",
    validate(
      z.object({
        itemId: z.string().max(120),
        takeId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
        tryFile: z.string().regex(/^[A-Za-z0-9_-]{1,120}\.(mp3|wav)$/),
      }),
    ),
    async (c) => c.json({ usage: await c.get("playground").recordUsage(c.req.valid("json")) }),
  );
  app.get("/take-favorites", (c) => c.json({ uids: c.get("playground").listTakeFavorites() }));
  app.put(
    "/take-favorites",
    validate(
      z.object({ uid: z.string().regex(/^take:[A-Za-z0-9_-]{1,120}$/), favorite: z.boolean() }),
    ),
    async (c) => {
      const { uid, favorite } = c.req.valid("json");
      return c.json({ uids: await c.get("playground").setTakeFavorite(uid, favorite) });
    },
  );
  app.get("/voice-favorites", (c) => c.json({ voices: controller.listVoiceFavorites() }));
  app.put("/voice-favorites", validate(VoiceFavorite), async (c) => {
    const { voice, favorite } = c.req.valid("json");
    const voices = await controller.setVoiceFavorite(voice, favorite);
    if (favorites && (!voice.connection || voice.connection === "genvoice")) {
      const key =
        voice.provider === "elevenlabs"
          ? `voice:${voice.id}`
          : `voice:${voice.provider}:${voice.id}`;
      if (favorites.read().effects.includes(key) !== favorite) {
        favorites.set({ kind: "effects", id: key, on: favorite });
        onFavoritesChanged?.();
      }
    }
    return c.json({ voices });
  });
  app.post(
    "/items/:id/copies",
    validate(z.object({ scope: z.enum(["project", "global"]) })),
    async (c) => {
      const item = await c
        .get("playground")
        .copyToScope(c.req.param("id"), c.req.valid("json").scope);
      return c.json({ item }, 201);
    },
  );
  return app;
}
