// @ts-nocheck
import { buildScene, DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { EDIT } from "live-studio/edit";
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from "mediabunny";

import { type OffsettableCamera, withCropViewOffset } from "../src/crop.mjs";
import { chunksOf } from "../src/frame";
import { renderCost } from "../src/render-cost.mjs";
import {
  apertureSamples,
  samplesForMotion,
  shutterBounds,
  shutterSamples,
  shutterTimes,
} from "../src/shutter";
import { renderCutTimes, timingClock } from "../src/timing-state.mjs";
import { makeAccumulator } from "./accum";
import { canvas as glCanvas, config, done, log, post, still } from "./lab";
import { motionCheck } from "./motion";
import { orderCheck } from "./order";
import { probeCheck } from "./probe";
import { seenCheck } from "./seen";
import { textCheck } from "./text";
import { touchCheck } from "./touch";

const FPS = 30;
const shotAt = (t) => SHOTS.filter((s) => t >= s.t).length;

(async () => {
  const cfg = await config();
  const past = (cfg.stills ?? []).filter((s) => s.frame / FPS > DURATION);
  if (past.length) {
    log(
      `ERROR --at ${past.map((s) => s.frame / FPS).join(",")} is past the film's end: it runs 0-${DURATION.toFixed(2)} s`,
    );
    return;
  }
  const ranges = chunksOf(DURATION, cfg.clip?.chunk ?? 30, FPS),
    chunkCount = ranges.length;
  const beyond = (cfg.clip?.only ?? []).filter((i) => i >= chunkCount);
  if (beyond.length) {
    log(
      `ERROR --chunks ${beyond.join(",")} is past the film's end: it has chunks 0-${chunkCount - 1} (${DURATION.toFixed(2)} s, ${cfg.clip.chunk} s each)`,
    );
    return;
  }
  const canvas = glCanvas();
  canvas.width = cfg.W;
  canvas.height = cfg.H;
  const BAR = cfg.draft ? 2 * Math.round(cfg.H * 0.028) : 0;
  const out = document.createElement("canvas");
  out.width = cfg.W;
  out.height = cfg.H + BAR;
  const ctx = out.getContext("2d");
  const t0 = performance.now();
  const render = await buildScene(canvas, cfg.W, cfg.H, cfg.draft, log);
  log(`scene built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  for (const v of render.variants ?? []) if (cfg.choices?.[v.id]?.set) v.set(cfg.choices[v.id].set);
  if (render.transitions) {
    const ids = render.transitions.map((x) => x.id);
    SHOTS.forEach((s, i) => {
      const fx = s.transition?.fx;
      if (i && fx && !ids.includes(fx))
        log(
          `WARN shot ${i}'s transition "${fx}" is none this film has, so that cut plays hard (shots [${i}].transition). Its transitions: bun run find --kind transition, or its own passed to makeTransitions`,
        );
    });
  }
  const cuts = renderCutTimes(
    SHOTS.slice(1).map((s) => s.t),
    EDIT.cam,
  );
  if (cfg.clip)
    await post(
      "/cuts",
      JSON.stringify({
        times: cuts,
        variants: (render.variants ?? []).map((v) => v.id),
      }),
    );
  const builtin = {
    order: orderCheck(render, DURATION, [0, ...cuts]),
    motion: motionCheck(render, cfg, cuts),
    seen: seenCheck(render, cfg),
    touch: touchCheck(render),
    text: textCheck(render, cfg),
    probe: probeCheck(render, cfg, post),
  };
  for (const [name, args] of cfg.checks ?? []) {
    const fn = render.checks?.[name] ?? builtin[name];
    if (!fn) {
      log(
        `ERROR no draw.checks.${name} (the film has: ${Object.keys(render.checks ?? {}).join(", ") || "none"}; built in: ${Object.keys(builtin).join(", ")})`,
      );
      return;
    }
    const t1 = performance.now();
    if (
      builtin[name] &&
      !render.checks?.[name] &&
      typeof args[2] === "number" &&
      args[2] > args[1]
    ) {
      const a = shotAt(args[1]),
        b = shotAt(args[2] - 1e-3);
      log(
        `heard ${args[1]}-${args[2]} s: shot ${a - 1}${b > a ? `-${b - 1}` : ""} (bun run at ${args[1]} names it)`,
      );
    }
    for (const item of [await fn(...args)].flat()) {
      if (typeof item === "string") log(item);
      else {
        await still(item.still, item.canvas, cfg.quality);
        log(`wrote renders/${item.still}`);
      }
    }
    log(`${name} done in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
  }
  if (cfg.inspect) {
    if (!render.tools?.free) {
      log("ERROR --inspect requires draw.tools.free on the film");
      return;
    }
    const [px, py, pz, lx, ly, lz, fov] = cfg.inspect;
    Object.assign(render.tools.free, { on: true, fov });
    render.tools.free.p.set(px, py, pz);
    render.tools.free.l.set(lx, ly, lz);
  }
  const hasViewCams = (cfg.stills ?? []).some((s) => s.cam);
  if (hasViewCams && !render.tools?.free) {
    log("ERROR --views requires draw.tools.free on the film");
    return;
  }

  const S = Math.max(10, Math.round(cfg.H * 0.019)),
    LH = Math.round(S * 1.35),
    PAD = Math.round(S * 0.6),
    GAP = 3,
    TOP = 12;
  const MONO = `${S}px Consolas, monospace`,
    HEAD = `bold ${Math.round(S * 0.9)}px "Segoe UI", sans-serif`,
    TAG = `bold ${Math.round(S * 0.8)}px "Segoe UI", sans-serif`;
  const wrap = (text, width) => {
    const rows = [];
    let cur = "";
    for (const w of text.split(" ")) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(next).width > width) {
        rows.push(cur);
        cur = w;
      } else cur = next;
    }
    return [...rows, cur];
  };
  const drawList = (sections) => {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = MONO;
    const inner = ctx.measureText("0".repeat(36)).width,
      colW = inner + PAD * 2;
    ctx.font = TAG;
    const tagW = ctx.measureText("NEW").width + 6;
    let x = 12,
      y = TOP;
    for (const { head, lines } of sections) {
      ctx.font = MONO;
      const rows = lines.flatMap(({ text, fresh }) =>
        wrap(text, fresh ? inner - tagW - 5 : inner).map((r, i) => ({ r, fresh, first: i === 0 })),
      );
      const h = (rows.length + 1) * LH + PAD;
      if (y + h > cfg.H - 12 && y > TOP) {
        x += colW + GAP;
        y = TOP;
      }
      ctx.fillStyle = "rgba(0,0,0,.62)";
      ctx.beginPath();
      ctx.roundRect(x, y, colW, h, 6);
      ctx.fill();
      let ry = y + PAD / 2 + LH / 2;
      ctx.font = HEAD;
      ctx.fillStyle = "#3AA99F";
      ctx.fillText(head, x + PAD, ry);
      for (const { r, fresh, first } of rows) {
        ry += LH;
        let tx = x + PAD;
        if (fresh) {
          if (first) {
            ctx.font = TAG;
            ctx.fillStyle = "#D0A215";
            ctx.beginPath();
            ctx.roundRect(tx, ry - LH * 0.38, tagW, LH * 0.76, 3);
            ctx.fill();
            ctx.fillStyle = "#100F0F";
            ctx.fillText("NEW", tx + 3, ry);
          }
          tx += tagW + 5;
        }
        ctx.font = MONO;
        ctx.fillStyle = fresh ? "#FFFCF0" : "#CECDC3";
        ctx.fillText(r, tx, ry);
      }
      y += h + GAP;
    }
    ctx.restore();
  };

  let acc = null;
  const whips = { frames: 0, most: 0 };
  const cost = cfg.clip ? renderCost(cuts) : null;
  let drawn = 0;
  const draw = async (frame, samples, viewName = null) => {
    const t = frame / FPS;
    drawn = 0;
    ctx.globalAlpha = 1;
    const i = shotAt(t) - 1;
    const shutter = SHOTS[i]?.shutter;
    const [from, to] = shutterBounds(
      t,
      SHOTS[i]?.t ?? 0,
      SHOTS[i + 1]?.t ?? DURATION,
      timingClock.segments,
      cuts,
    );
    const shotSamples = shutterSamples(samples, shutter);
    let times = shutterTimes(t, FPS, shotSamples, from, to, shutter);
    const pupils = apertureSamples(
      !cfg.draft && render.tools?.apertureSampling ? (shutter?.apertureSamples ?? 1) : 1,
      frame,
    );
    if (times.length === 1 && pupils.length === 1) {
      if (render.renderFrame) await render.renderFrame(t);
      else render(t);
      drawn = 1;
      ctx.drawImage(canvas, 0, 0);
    } else {
      const three = render.tools?.renderer;
      if (!acc) {
        const gl = three?.getContext?.();
        acc = gl
          ? makeAccumulator(gl.drawingBufferWidth, gl.drawingBufferHeight, gl, () =>
              three.resetState(),
            )
          : makeAccumulator(cfg.W, cfg.H);
        log(
          `camera samples: averaged ${gl ? "in the film's own WebGL context" : "in a context of its own (the film shares no draw.tools.renderer: slower)"}`,
        );
      }
      acc.reset();
      const camera = render.tools?.camera;
      let prevPose = null;
      for (let k = 0; k < times.length; k++) {
        for (const aperture of pupils) {
          const options = aperture ? { aperture, layerTime: t } : { layerTime: t };
          if (render.renderFrame) await render.renderFrame(times[k], options);
          else render(times[k], options);
          drawn++;
          acc.add(canvas);
        }
        const e = camera?.matrixWorld?.elements;
        if (k > 1 || !e || times.length < 2 || times.length > shotSamples) continue;
        const look = render.tools?.look;
        const focusDist =
          render.tools?.optics?.focusM ??
          (look ? Math.hypot(e[12] - look.x, e[13] - look.y, e[14] - look.z) : undefined);
        const now = {
          facing: [-e[8], -e[9], -e[10]],
          pos: [e[12], e[13], e[14]],
          focusDist,
        };
        if (k === 0) prevPose = now;
        else {
          const more = samplesForMotion(times.length, prevPose, now, camera.fov, cfg.H);
          if (more > times.length) {
            times = shutterTimes(t, FPS, more, from, to, shutter);
            whips.frames++;
            whips.most = Math.max(whips.most, times.length);
            acc.reset();
            k = -1;
          }
        }
      }
      ctx.drawImage(acc.resolve(), 0, 0);
    }
    if (!cfg.draft) return out;
    const ms = Math.round(t * 1000);
    const label = `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
    const n = shotAt(t),
      shot = SHOTS[n - 1] ?? {},
      about = [shot.size, shot.what].filter((x) => typeof x === "string").join(" · ");
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, cfg.H, cfg.W, BAR);
    const y = cfg.H + BAR / 2,
      F = Math.round(BAR * 0.62);
    ctx.font = `bold ${F}px Consolas, monospace`;
    ctx.fillStyle = "#fff";
    ctx.fillText(label, 14, y);
    const x = 14 + ctx.measureText(label).width + F;
    ctx.font = `${Math.round(F * 0.8)}px Consolas, monospace`;
    ctx.fillStyle = "#b8b6ad";
    let text = `${viewName ? `view ${viewName} · ` : ""}shot ${n - 1}${about ? ` · ${about}` : ""}`;
    while (text.length > 4 && ctx.measureText(text).width > cfg.W - x - 14)
      text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, x, y);
    ctx.restore();
    if (render.describe && cfg.list) drawList(render.describe(t));
    return out;
  };

  const renderStill = async (s) => {
    if (!cfg.crop) {
      await still(s.name, await draw(s.frame, cfg.stillSamples ?? 1, s.view), cfg.quality);
      return;
    }
    const cam = render.tools?.camera;
    if (!cam?.setViewOffset) {
      log("WARN --crop requires draw.tools.camera on the film; rendering uncropped");
      await still(s.name, await draw(s.frame, cfg.stillSamples ?? 1, s.view), cfg.quality);
      return;
    }
    const cameras = new Set<OffsettableCamera>([cam]);
    render.tools?.scene?.traverse((object) => {
      const candidate = object as unknown as Partial<OffsettableCamera>;
      if (typeof candidate.setViewOffset === "function")
        cameras.add(candidate as OffsettableCamera);
    });
    const cropped = await withCropViewOffset([...cameras], cfg.W, cfg.H, cfg.crop, async (view) => {
      const rendered = await draw(s.frame, cfg.stillSamples ?? 1, s.view);
      if (view.outWidth === cfg.W && view.outHeight === cfg.H) return rendered;
      const outCrop = document.createElement("canvas");
      outCrop.width = view.outWidth;
      outCrop.height = view.outHeight + BAR;
      const cctx = outCrop.getContext("2d");
      cctx.drawImage(
        rendered,
        0,
        0,
        view.outWidth,
        view.outHeight,
        0,
        0,
        view.outWidth,
        view.outHeight,
      );
      if (BAR)
        cctx.drawImage(
          rendered,
          0,
          cfg.H,
          view.outWidth,
          BAR,
          0,
          view.outHeight,
          view.outWidth,
          BAR,
        );
      return outCrop;
    });
    await still(s.name, cropped, cfg.quality);
  };

  const free = hasViewCams ? render.tools.free : null;
  const savedFree = free
    ? {
        scalars: Object.fromEntries(Object.entries(free).filter(([k]) => k !== "p" && k !== "l")),
        p: [free.p.x, free.p.y, free.p.z],
        l: [free.l.x, free.l.y, free.l.z],
      }
    : null;
  const restoreFree = () => {
    if (!free || !savedFree) return;
    Object.assign(free, savedFree.scalars);
    free.p.set(...savedFree.p);
    free.l.set(...savedFree.l);
  };
  for (const s of cfg.stills ?? []) {
    if (s.cam && free) {
      const [px, py, pz, lx, ly, lz, fov] = s.cam;
      Object.assign(free, { on: true, fov });
      free.p.set(px, py, pz);
      free.l.set(lx, ly, lz);
    }
    try {
      await renderStill(s);
    } finally {
      if (s.cam) restoreFree();
    }
  }

  const chunks = chunkCount;
  let beat = 0;
  const alive = (f) => {
    if (performance.now() - beat < 5000) return;
    beat = performance.now();
    post("/alive", String(f));
  };
  const encode = async (first, last, bitrate) => {
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });
    const source = new VideoSampleSource({
      codec: "avc",
      bitrate,
      hardwareAcceleration: "prefer-hardware",
      keyFrameInterval: cfg.clip.keyFrameInterval,
    });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();
    let mark = performance.now();
    for (let f = first; f <= last; f++) {
      const sample = new VideoSample(await draw(f, cfg.clip.samples), {
        timestamp: (f - first) / FPS,
        duration: 1 / FPS,
      });
      await source.add(sample);
      sample.close();
      const now = performance.now();
      cost.add(f / FPS, now - mark, drawn);
      mark = now;
      alive(f);
    }
    await output.finalize();
    return output.target.buffer;
  };
  const whipped = () => {
    const said = whips.frames ? ` (${whips.frames} fast-turning frames up to x${whips.most})` : "";
    whips.frames = whips.most = 0;
    return said;
  };
  if (cfg.clip?.span) {
    const started = performance.now(),
      first = cfg.clip.span[0],
      last = Math.min(cfg.clip.span[1], ranges.at(-1)[1]);
    if (first > last) {
      log(
        `ERROR --span starts at frame ${first}, after the film's last (${last}, ${(last / FPS).toFixed(2)} s): give it a second before that`,
      );
      return;
    }
    await post("/span", await encode(first, last, cfg.clip.bitrate));
    log(
      `span: ${last - first + 1} frames x${cfg.clip.samples}${whipped()} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
    );
    const said = cost.line();
    if (said) log(said);
    await done();
    return;
  }
  if (cfg.clip) {
    const todo = cfg.clip.only ?? Array.from({ length: chunks }, (_, i) => i);
    const kept = todo.filter((i) => cfg.clip.unchanged?.includes(i));
    if (kept.length)
      log(
        `${kept.length > 1 ? "chunks" : "chunk"} ${kept.join(", ")}: unchanged since rendered, kept (--chunks ${kept[0]} renders one again anyway)`,
      );
    for (const index of todo.filter((i) => !kept.includes(i))) {
      if (index >= chunks) {
        log(`no chunk ${index}: the film has ${chunks}`);
        continue;
      }
      const started = performance.now(),
        [first, last] = ranges[index];
      await post(`/chunk/${index}`, await encode(first, last, cfg.clip.bitrate));
      log(
        `chunk ${index}: ${last - first + 1} frames x${cfg.clip.samples}${whipped()} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    const said = cost.line();
    if (said) log(said);
  }
  await done(cfg.clip ? chunks : undefined);
})();
