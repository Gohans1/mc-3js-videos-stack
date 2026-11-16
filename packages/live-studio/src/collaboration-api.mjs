import { zValidator } from "@hono/zod-validator";
import * as z from "zod";

export const mountCollaboration = (app, named) => {
  app.get("/api/collaboration/:name{.+}", (c) => {
    const file = named(c.req.param("name"));
    if (!file) return c.body(null, 404);
    c.header("cache-control", "no-store");
    return c.json({ ...file.read(), ...file.collaboration() });
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
