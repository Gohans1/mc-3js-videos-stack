import { expect, test } from "bun:test";

import { overlayFramePoint, overlayPoint, resolveOpenFilmRecipe } from "../src/openfilm";

test("rotated and translated overlay points map back to the page that was drawn", () => {
  const layer = {
    id: "title",
    width: 200,
    height: 100,
    displayWidth: 200,
    displayHeight: 100,
    frameWidth: 1000,
    frameHeight: 500,
    x: 0.7,
    y: 0.3,
    rotate: 90,
  };
  expect(overlayPoint(layer, 0.7, 0.3)).toEqual([100, 50]);
  const [x, y] = overlayPoint(layer, 0.68, 0.4);
  expect(x).toBeCloseTo(150);
  expect(y).toBeCloseTo(70);
  const scaled = { ...layer, displayWidth: 100, displayHeight: 50 };
  const point = overlayPoint(scaled, 0.69, 0.35);
  expect(point[0]).toBeCloseTo(150);
  expect(point[1]).toBeCloseTo(70);
  const frame = overlayFramePoint(scaled, ...point);
  expect(frame[0]).toBeCloseTo(0.69);
  expect(frame[1]).toBeCloseTo(0.35);
});

test("an AI's local HTML page can render without joining the asset catalog", () => {
  const recipe = resolveOpenFilmRecipe("/titles/own.html", [], 1080, 1920);
  expect(recipe).toMatchObject({
    render: "page",
    url: "/titles/own.html",
    w: 1080,
    h: 1920,
    fit: 1,
  });
  expect(resolveOpenFilmRecipe("https://elsewhere.test/page.html", [])).toBeUndefined();
  expect(resolveOpenFilmRecipe("not-a-known-effect", [])).toBeUndefined();
});
