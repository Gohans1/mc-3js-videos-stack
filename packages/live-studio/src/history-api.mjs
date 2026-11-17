import { zValidator } from "@hono/zod-validator";
import * as z from "zod";

import { HistoryError } from "./history.mjs";

export const mountHistory = (app, film) => {
  const run = (c, action) => {
    if (!film.history) return c.body(null, 404);
    c.header("cache-control", "no-store");
    try {
      return c.json(action(film.history));
    } catch (error) {
      return c.json({ error: error.message }, error instanceof HistoryError ? error.status : 500);
    }
  };
  app.get("/api/history", (c) =>
    run(c, (history) => {
      const raw = c.req.query("before"),
        before = raw === undefined ? Number.MAX_SAFE_INTEGER : Number(raw);
      if (!Number.isSafeInteger(before) || before < 1)
        throw new HistoryError("Invalid history cursor");
      const revisions = history.list(100, before);
      return {
        project: film.PROJECT,
        revisions,
        current: history.current(),
        next:
          revisions.length === 100 && history.list(1, revisions.at(-1).seq).length
            ? revisions.at(-1).seq
            : null,
        problem: history.problem,
      };
    }),
  );
  app.post(
    "/api/history",
    zValidator("json", z.object({ name: z.string().trim().min(1).max(160) })),
    (c) => run(c, (history) => history.capture(c.req.valid("json").name, "named")),
  );
  app.post(
    "/api/history/restore",
    zValidator(
      "json",
      z.object({ id: z.string().uuid(), base: z.string().regex(/^[a-f0-9]{64}$/) }),
    ),
    (c) =>
      run(c, (history) => {
        const { id, base } = c.req.valid("json");
        return history.restore(id, base);
      }),
  );
};
