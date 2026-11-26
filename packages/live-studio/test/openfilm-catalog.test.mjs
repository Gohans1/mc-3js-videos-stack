import { expect, spyOn, test } from "bun:test";

import { loadOpenFilmCatalog } from "../app/openfilm/render";

test("the catalog can recover from a failed request and reuses successful reads", async () => {
  const recipes = [{ id: "fixture-card", title: "Another card" }];
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json(recipes));
  try {
    await expect(loadOpenFilmCatalog()).rejects.toThrow("HTTP 503");
    const retry = loadOpenFilmCatalog();
    expect(loadOpenFilmCatalog()).toBe(retry);
    expect(await retry).toEqual(recipes);
    expect(await loadOpenFilmCatalog()).toEqual(recipes);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
  }
});
