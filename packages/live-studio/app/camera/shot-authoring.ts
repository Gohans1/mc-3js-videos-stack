import { ANIMS } from "film-stage/animate";
import { EDIT } from "film/edit";

import { cameraTimesAt } from "../../src/timing-state.mjs";
import { warp } from "../../src/warp.mjs";
import { shotEnd } from "../core/film";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { beatTimes } from "../sound/sound";
import { shotsDoc } from "./shots";

export const CAMERA_RECIPES = [
  { id: "orbit", label: "Gentle orbit", fx: "orbitL", strength: 0.42 },
  { id: "handheld", label: "Handheld close-up", fx: "handheld", strength: 0.45 },
  { id: "push", label: "Slow push", fx: "push", strength: 0.32 },
] as const;
export type CameraRecipe = (typeof CAMERA_RECIPES)[number]["id"];

export const applyCameraRecipe = (shot: number, id: CameraRecipe) => {
  const recipe = CAMERA_RECIPES.find((item) => item.id === id);
  if (!recipe) return;
  const catalogue = S.render?.anims?.combo ?? ANIMS.combo;
  if (!catalogue.some((fx) => fx.id === recipe.fx))
    return say("This film has no " + recipe.label + " animation");
  shotsDoc.edit((rows) => {
    if (!rows[shot]) return;
    const previous = rows[shot].anim;
    rows[shot].anim = {
      ...(typeof previous === "object" ? previous : {}),
      combo: { fx: recipe.fx, k: recipe.strength },
    };
  });
};

export const beatsToCameraHits = (shot: number) => {
  const from = SHOTS_OUT[shot]?.t,
    to = shotEnd(shot);
  if (from === undefined) return;
  const authored = (t: number) =>
    Number(
      warp(EDIT.voice?.warp ?? [], get().timing ? cameraTimesAt(t).camera : t, 1, 0).toFixed(6),
    );
  const times = [
    ...new Set(
      beatTimes()
        .filter((t) => t >= from && t < to)
        .map((t) => authored(Math.max(from, t - 0.045))),
    ),
  ].sort((a, b) => a - b);
  if (!times.length) return say("This shot has no marked audio beats");
  shotsDoc.edit((rows) => {
    const row = rows[shot];
    if (!row) return;
    const previous = Array.isArray(row.hits) ? row.hits : [];
    const hits = times.map((t) => ({
      t,
      source: "beat",
      amount: 0.14,
      max: 1.1,
      decay: 12,
      fovPulse: -1.8,
    }));
    row.hits = [...previous.filter((hit) => hit.source !== "beat"), ...hits].sort(
      (a, b) => a.t - b.t,
    );
  });
  say("Added " + times.length + " camera hits 45 ms ahead of their beats");
};
