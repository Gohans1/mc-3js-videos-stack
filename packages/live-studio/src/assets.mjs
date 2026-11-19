import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expandTemplate } from "../../film-stage/src/openfilm-recipes.ts";
import { NATIVE_LANES, nativeLane, placeTransition } from "./asset-timelines.mjs";
import { PicksFile, PlacedTimeline } from "./contract.ts";
import { openOpenFilm } from "./openfilm.mjs";
import {
  AssetUsageError,
  editPlacedObject,
  pickObjects,
  placedRelOf,
  placeObject,
  timelinePicks,
  timelinePlaced,
  unpickObjects,
} from "./placed-lane.mjs";

export const ASSET_LANES = ["effects", ...Object.keys(NATIVE_LANES), "placed", "picks"];

export function openAssets(project, conf, options = {}) {
  const effects = openOpenFilm(project, conf, options);
  const native = (name) => nativeLane(project, conf, name, options);
  const timeline = (name = "effects") => {
    if (name === "placed") return timelinePlaced(project, conf, options);
    if (name === "picks") return timelinePicks(project);
    if (name !== "effects") return native(name).view();
    const current = effects.view();
    return {
      ...current,
      file: effects.FILE,
      targets: current.data.items.map((it) => `effects:${it.id}`),
    };
  };
  const use = (recipe, input = {}) => {
    if (typeof recipe === "string") {
      return placeObject(project, conf, { ...input, id: recipe, options });
    }
    const from = input.from ?? 0,
      to = input.to ?? from + (recipe.durationMs ?? 3000) / 1000;
    if (!Number.isFinite(from) || from < 0 || !Number.isFinite(to) || to <= from)
      throw new Error("from/to must be finite, nonnegative and to must follow from");
    if (recipe.source === "openfilm") {
      const result = effects.use({ ...input, asset: recipe.upstreamId, from, to });
      const target =
        recipe.kind === "transition"
          ? `transitions:${result.shot}`
          : recipe.kind === "filter"
            ? `adjustment:${result.value.id}`
            : result.item
              ? `effects:${result.item.id}`
              : undefined;
      return {
        ...result,
        ...(target
          ? { target }
          : { targets: (result.items ?? []).map((it) => `effects:${it.id}`) }),
      };
    }
    const { shot, from: _from, to: _to, ...props } = input;
    if (recipe.render === "transition")
      return placeTransition(
        project,
        conf,
        { fx: recipe.transition.id, ...props, len: to - from },
        shot,
        options,
      );
    if (recipe.render === "grade")
      return native("adjustment").append({
        from,
        to,
        ...props,
        name: recipe.title,
        grade: { ...structuredClone(recipe.grade), ...props.grade },
      });
    if (recipe.render === "text") {
      if (recipe.item.kind === "text" && typeof props.text !== "string")
        throw new Error(
          'Text needs --props-file with {"text":"Your words"}; bun run find --show <id> shows this recipe',
        );
      return native("text").append({
        from,
        to,
        ...structuredClone(recipe.item),
        ...props,
      });
    }
    if (recipe.render === "audio") {
      const bed = recipe.sound.kind === "bgm" || input.bed === true;
      const { bed: _, ...controls } = props;
      return native("audio").append(
        {
          gain: 0,
          ...(bed && { fadeIn: 0, fadeOut: 0 }),
          ...controls,
          name: recipe.sound.name,
          ...(bed
            ? { from, to }
            : { at: from, ...(input.to !== undefined && { length: to - from }) }),
        },
        bed ? "beds" : "sfx",
      );
    }
    throw new Error(`No placement for ${recipe.id}; use custom code in src/scene.ts`);
  };
  const change = (target, props, remove = false, extra = {}) => {
    const split = target.indexOf(":"),
      name = split < 0 ? "effects" : target.slice(0, split),
      id = split < 0 ? target : target.slice(split + 1);
    if (name === "placed") {
      return editPlacedObject(project, conf, id, { ...extra, props, remove, options });
    }
    if (extra.from !== undefined) {
      throw new AssetUsageError(
        `--from applies to placed objects only; put "from" inside --props for ${name}`,
        2,
      );
    }
    if (!ASSET_LANES.includes(name) || name === "picks")
      throw new AssetUsageError(
        name === "picks"
          ? "Use bun run asset pick / unpick <id> instead of edit/remove on picks"
          : `Unknown lane ${name}; lanes: ${ASSET_LANES.join(", ")}`,
        2,
      );
    if (name !== "effects") return native(name).change(id, props, remove);
    if (!remove) return effects.edit(id, props);
    const current = effects.read();
    const heard = effects.view();
    if (!current.data.items.some((it) => it.id === id)) throw new Error(`No effect layer ${id}`);
    const data = { ...current.data, items: current.data.items.filter((it) => it.id !== id) };
    const saved = effects.write(current.version, data);
    if (saved.conflict || saved.problems) throw new Error(JSON.stringify(saved));
    return {
      ...saved,
      data: { ...heard.data, items: heard.data.items.filter((it) => it.id !== id) },
    };
  };
  const validate = () => {
    const current = effects.read(),
      bad = effects.check(current.version, current.data);
    if (bad) throw new Error(JSON.stringify(bad));
    const files = [effects.FILE];
    for (const [name, spec] of Object.entries(NATIVE_LANES))
      if (conf[spec.key]) {
        const lane = native(name);
        spec.schema.parse(lane.read().data);
        files.push(lane.file);
      }
    const placedRel = placedRelOf(conf);
    const placedAbs = join(project, placedRel);
    if (existsSync(placedAbs)) {
      PlacedTimeline.parse(JSON.parse(readFileSync(placedAbs, "utf8")));
      files.push(placedAbs);
    }
    const picksAbs = join(project, "pack/picks.json");
    if (existsSync(picksAbs)) {
      PicksFile.parse(JSON.parse(readFileSync(picksAbs, "utf8")));
      files.push(picksAbs);
    }
    return { valid: true, files };
  };
  return {
    timeline,
    use,
    change,
    validate,
    pick: (ids, opts = {}) => pickObjects(project, { ids, ...opts }),
    unpick: (ids, opts = {}) => unpickObjects(project, conf, { ids, ...opts }),
    plan: (recipe, from, to) => {
      if (recipe.render !== "group")
        throw new Error("plan requires a template; bun run find --kind template");
      return expandTemplate({ ...recipe, id: recipe.upstreamId }, from, to);
    },
  };
}
