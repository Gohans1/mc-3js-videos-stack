import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AdjustmentTimeline, SoundTimeline } from "../src/contract.ts";
import { openFilmResource, OpenFilmTimeline, openOpenFilm } from "../src/openfilm.mjs";

const project = mkdtempSync(join(tmpdir(), "mc-openfilm-native-"));
mkdirSync(join(project, "src/timeline"), { recursive: true });
writeFileSync(join(project, "src/edit.json"), JSON.stringify({ end: 20 }));
writeFileSync(
  join(project, "src/timeline/shots.json"),
  JSON.stringify([{ t: 0 }, { t: 5 }, { t: 10 }]),
);
const conf = {
  shotsTimeline: "src/timeline/shots.json",
  adjustmentTimeline: "src/timeline/adjust.json",
  soundTimeline: "src/timeline/audio.json",
};
const library = openOpenFilm(project, conf);
afterAll(() => rmSync(project, { recursive: true, force: true }));

test("native use writes editable overlays, correct cut IDs, LUT grades and template music", () => {
  expect(library.read().version).not.toBe("");
  const text = library.use({ asset: "text/looks/title", from: 1, to: 3, text: { ".t": "Hello" } });
  expect(text.item.text[".t"]).toBe("Hello");
  expect(OpenFilmTimeline.parse(library.read().data).items).toHaveLength(1);
  library.use({ asset: "motions/move-push-left", shot: 1 });
  expect(JSON.parse(readFileSync(join(project, conf.shotsTimeline), "utf8"))[1].transition.fx).toBe(
    "of:motions/move-push-left",
  );
  library.use({ asset: "filters/warm-film", from: 2, to: 6 });
  const grade = AdjustmentTimeline.parse(
    JSON.parse(readFileSync(join(project, conf.adjustmentTimeline), "utf8")),
  ).items[0];
  expect(grade.grade.lut.url).toMatch(/^\/studio-luts\/[a-f0-9]{64}\.cube$/);
  library.use({ asset: "templates/travel-vlog", from: 0 });
  const audio = SoundTimeline.parse(
    JSON.parse(readFileSync(join(project, conf.soundTimeline), "utf8")),
  );
  expect(audio.beds[0].name).toBe("of-bgm-plucky-light-underscore-f5be3b");
  expect(library.read().data.items.length).toBeGreaterThan(4);
}, 30_000);

test("agent timeline saves reject stale versions and invalid ranges", () => {
  const before = library.read();
  library.use({ asset: "effects/grain", from: 8, to: 9 });
  expect(library.write(before.version, before.data, { actor: "agent" })).toEqual({
    conflict: true,
  });
  expect(
    library.write(library.read().version, {
      items: [{ id: "bad", asset: "effects/grain", from: 5, to: 3 }],
    }).problems.length,
  ).toBeGreaterThan(0);
  expect(
    library.check(library.read().version, {
      items: [{ id: "bad", asset: "not-installed", from: 0, to: 1 }],
    }).problems.length,
  ).toBeGreaterThan(0);
});

test("asset server stops wall-clock animation before source scripts and blocks traversal", async () => {
  const response = openFilmResource(
    new Request("http://localhost/_openfilm/library/effects/grain/files/grain.html"),
  );
  const html = await response.text();
  expect(html.indexOf("window.filmHost=true")).toBeLessThan(html.indexOf("window.film ="));
  expect(
    openFilmResource(new Request("http://localhost/_openfilm/library/%2e%2e%2findex.json")).status,
  ).toBe(400);
});

test("CLI layer edits use heard seconds after a speed change", () => {
  const film = mkdtempSync(join(tmpdir(), "mc-openfilm-clock-"));
  try {
    mkdirSync(join(film, "src/timeline"), { recursive: true });
    writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 10 }));
    const layer = openOpenFilm(film, { timingTimeline: "src/timeline/timing.json" });
    const { item } = layer.use({ asset: "effects/grain", from: 2, to: 6 });
    writeFileSync(
      join(film, "src/timeline/timing.json"),
      JSON.stringify({ speeds: [{ from: 0, to: 10, rate: 2 }] }),
    );
    expect(layer.view().data.items[0]).toMatchObject({ from: 1, to: 3 });
    layer.edit(item.id, { from: 2, to: 4, opacity: 0.5 });
    expect(layer.read().data.items[0]).toMatchObject({ from: 4, to: 8, opacity: 0.5 });
    expect(layer.view().data.items[0]).toMatchObject({ from: 2, to: 4, opacity: 0.5 });
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});
