import { zValidator } from "@hono/zod-validator";
import * as z from "zod";

import { formatProtectedPointer, summarizeNotice } from "./edit-protection.mjs";

export const mountCollaboration = (app, named) => {
  app.get("/api/collaboration/:name{.+}", (c) => {
    const file = named(c.req.param("name"));
    if (!file) return c.body(null, 404);
    const lean = c.req.query("lean") === "1" || c.req.query("full") === "0";
    const current = file.read();
    const collab = file.collaboration();
    const rawNotices = Array.isArray(collab?.notices) ? collab.notices : [];
    const docs = [
      ...(current?.data !== undefined ? [current.data] : []),
      ...rawNotices.toReversed().map((n) => n?.incoming),
    ];
    const protectedPaths = Array.isArray(collab?.protected) ? collab.protected : [];
    const notices = rawNotices.map((notice) =>
      summarizeNotice(notice, current?.data !== undefined ? [current.data] : [], { full: !lean }),
    );
    c.header("cache-control", "no-store");
    return c.json({
      ...current,
      ...collab,
      protectedLabels: protectedPaths.map((p) => formatProtectedPointer(p, docs)),
      notices,
    });
  });
  app.post(
    "/api/collaboration/:name{.+}",
    zValidator("json", z.object({ base: z.string(), data: z.unknown() })),
    (c) => {
      const file = named(c.req.param("name"));
      if (!file) return c.body(null, 404);
      const { base, data } = c.req.valid("json");
      const result = file.write(base, data, { actor: "agent" });
      return c.json(result, result.conflict ? 409 : result.problems ? 400 : 200);
    },
  );
};
