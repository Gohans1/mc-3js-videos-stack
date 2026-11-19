// @ts-nocheck
// CHECK=motion:<target>,<from>,<to>, built in for every film: how one thing moves between two heard seconds, seen the way an
// animator checks a move in a graph editor and with onion skins, with no film wiring. Writes to renders/:
//   motion_<target>_<from>-<to>_trail.jpg  ghosts of the move from one fixed camera (INSPECT's, else the film's at the middle
//     second), its path drawn over them coloured by speed (blue slow, red fast), a dot every 0.1 s and the time every 0.5 s:
//     dots bunched up = slow, spread out = fast; POP and STOP marks where it jumps or stops dead
//   motion_<target>_<from>-<to>_speed.jpg  speed over time (m/s), each move's peak and how it is eased, the faults marked
//   motion_cam_<from>-<to>_turn.jpg  for cam: how fast it turns and zooms (°/s) against the 7-second panning rule
// and prints the numbers (checks/motion.mjs). target: see target.ts; "cam" gives the graphs only.
import { EDIT } from "live-studio/edit";
import * as THREE from "three";

import { measure, report, turnReport, turns, WIDTH_SECONDS } from "../checks/motion.mjs";
import { canvas } from "./lab";
import { chart, findTarget, hue, label, mark, targetHelp } from "./target";

const HZ = 60,
  GHOSTS = 8;

export const motionCheck =
  (render, cfg, cuts = []) =>
  async (target, from, to) => {
    const { camera, free, look } = render.tools ?? {};
    if (typeof target !== "string" || !(to > from))
      return [
        "ERROR usage: CHECK=motion:<target>,<from s>,<to s> (target: cam, a bone, an object name or label)",
      ];
    const isCam = target === "cam";
    if (!camera) return ["ERROR CHECK=motion requires draw.tools.camera on the film"];
    const obj = findTarget(render.tools, target);
    if (!obj) return [targetHelp(render.tools, target)];
    if (!isCam && !free)
      return ["ERROR CHECK=motion on an object requires draw.tools.free on the film"];

    // one fixed camera for the whole move, so ghosts and the path line up; put back afterwards
    const saved =
      !isCam && free ? { on: free.on, p: free.p.clone(), l: free.l.clone(), fov: free.fov } : null;
    if (!isCam) {
      if (cfg.inspect) {
        const [px, py, pz, lx, ly, lz, fov] = cfg.inspect;
        free.p.set(px, py, pz);
        free.l.set(lx, ly, lz);
        free.fov = fov;
      } else {
        render((from + to) / 2);
        free.p.copy(camera.getWorldPosition(new THREE.Vector3()));
        if (look) free.l.copy(look);
        else camera.getWorldDirection(free.l).add(free.p);
        free.fov = camera.fov;
      }
      free.on = true;
    }

    const samples = [];
    const impulses = [];
    let openImp = null;
    for (let i = 0, n = Math.round((to - from) * HZ); i <= n; i++) {
      const t = from + i / HZ;
      render(t);
      const imp = isCam ? render.tools?.optics?.impulse : undefined;
      if (imp) {
        if (!openImp) openImp = { from: t, to: t, kind: imp };
        else if (openImp.kind === imp) openImp.to = t;
        else {
          impulses.push(openImp);
          openImp = { from: t, to: t, kind: imp };
        }
      } else if (openImp) {
        impulses.push(openImp);
        openImp = null;
      }
      obj.updateWorldMatrix(true, false);
      const wp = obj.getWorldPosition(new THREE.Vector3());
      samples.push({
        t,
        p: wp.toArray(),
        ...(isCam && {
          l: look
            ? look.toArray()
            : camera.getWorldDirection(new THREE.Vector3()).add(wp).toArray(),
          q: obj.getWorldQuaternion(new THREE.Quaternion()).toArray(),
          fov: camera.fov,
          aspect: camera.aspect,
        }),
      });
    }
    if (openImp) impulses.push(openImp);
    const camKeys = isCam ? (cfg.camKeys ?? EDIT?.camera ?? null) : null;
    const m = measure(samples, cuts, impulses);
    const tm = isCam ? turns(samples, cuts, impulses) : null;
    const camFaults = tm
      ? tm.pops.length + (tm.fovPops?.length ?? 0) + (tm.fastPan ? 1 : 0) + (tm.fastFov ? 1 : 0)
      : 0;
    const attrOpts = { worldPos: true, camKeys, timing: cfg.timing ?? null };
    const out = report(target, samples, m, camFaults, attrOpts);
    if (tm) out.push(...turnReport(tm, attrOpts));
    const tag = `motion_${target}_${from}-${to}`;
    const peak = Math.max(m.peak.v, 1e-6);
    const gl = canvas();
    const W = gl.width,
      H = gl.height;
    const legend = (ctx, x, y) => {
      for (let i = 0; i <= 100; i++) {
        ctx.fillStyle = hue(i / 100);
        ctx.fillRect(x + i * 1.6, y, 2, 10);
      }
      ctx.font = "13px Consolas, monospace";
      label(ctx, "0", x, y + 26);
      label(ctx, `${peak.toFixed(2)} m/s`, x + 160, y + 26, "#fff", "right");
    };

    if (!isCam) {
      const onion = document.createElement("canvas");
      onion.width = W;
      onion.height = H;
      const ctx = onion.getContext("2d");
      for (let k = 0; k < GHOSTS; k++) {
        // later ghosts drawn over earlier ones: the faintest pose is the first
        render(from + ((to - from) * k) / (GHOSTS - 1));
        ctx.globalAlpha = k ? 0.45 : 1;
        ctx.drawImage(gl, 0, 0);
      }
      ctx.globalAlpha = 1;
      const xy = (p) => {
        const v = new THREE.Vector3(...p).project(camera);
        return v.z < 1 ? [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H] : null;
      };
      const pts = samples.map((s) => xy(s.p));
      ctx.lineCap = "round";
      for (const [w, dark] of [
        [7, true],
        [3.5, false],
      ])
        for (let i = 1; i < pts.length; i++) {
          if (!pts[i] || !pts[i - 1]) continue;
          ctx.strokeStyle = dark ? "rgba(0,0,0,.7)" : hue(m.speed[i] / peak);
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(...pts[i - 1]);
          ctx.lineTo(...pts[i]);
          ctx.stroke();
        }
      ctx.font = "bold 14px Consolas, monospace";
      samples.forEach((s, i) => {
        if (!pts[i] || i % (HZ / 10)) return;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(...pts[i], 2.5, 0, 7);
        ctx.fill();
        if (i % (HZ / 2) === 0) label(ctx, s.t.toFixed(1), pts[i][0] + 6, pts[i][1] - 6);
      });
      const at = (t) => pts[Math.round((t - from) * HZ)];
      for (const p of m.pops) {
        const q = at(p.t);
        if (q) {
          ctx.strokeStyle = "#ff2d2d";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(...q, 12, 0, 7);
          ctx.stroke();
          label(ctx, `POP ${p.t.toFixed(2)}`, q[0] + 14, q[1] + 18, "#ff6b6b");
        }
      }
      for (const s of m.stops) {
        const q = at(s.t);
        if (q) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 3;
          ctx.strokeRect(q[0] - 9, q[1] - 9, 18, 18);
          label(ctx, `DEAD ${s.kind.toUpperCase()} ${s.t.toFixed(2)}`, q[0] + 14, q[1] + 18);
        }
      }
      ctx.font = "bold 18px Consolas, monospace";
      label(
        ctx,
        `${target}  ${from}-${to} s  peak ${m.peak.v.toFixed(2)} m/s at ${m.peak.t.toFixed(2)}`,
        14,
        28,
      );
      legend(ctx, 14, 40);
      out.push({ still: `${tag}_trail.jpg`, canvas: onion });
    }

    const top = Math.max(0.5, Math.ceil(peak * 1.15 * 2) / 2);
    const c = chart(W, 420, { from, to, top, title: `${target} speed (m/s), ${from}-${to} s` }),
      { g, X, Y } = c;
    for (const cu of m.cuts) mark(c, cu, "#6b7280", "CUT", 2, [2, 3]);
    for (const w of impulses)
      mark(c, w.from, "#a48bff", (w.kind ?? "impulse").toUpperCase(), 2, [2, 3]);
    g.lineWidth = 2.5;
    for (let i = 1; i < samples.length; i++) {
      g.strokeStyle = hue(m.speed[i] / peak);
      g.beginPath();
      g.moveTo(X(samples[i - 1].t), Y(m.speed[i - 1]));
      g.lineTo(X(samples[i].t), Y(m.speed[i]));
      g.stroke();
    }
    for (const mv of m.moves) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(X(mv.peakT), Y(mv.peakV), 4, 0, 7);
      g.fill();
      const peakLabel = `${mv.peakV.toFixed(2)} m/s, ${Math.round(mv.peakAt * 100)}% in`;
      const inset = g.measureText(peakLabel).width / 2 + 8;
      const labelX = Math.max(inset, Math.min(W - inset, X(mv.peakT)));
      label(g, peakLabel, labelX, Y(mv.peakV) - 10, "#fff", "center");
      for (const t of [mv.from, mv.to]) mark(c, t, "rgba(255,255,255,.35)", "", 0, [4, 4]);
    }
    for (const p of m.pops) mark(c, p.t, "#ff2d2d", "POP");
    for (const s of m.stops) mark(c, s.t, "#ffffff", `DEAD ${s.kind.toUpperCase()}`, 1);
    out.push({ still: `${tag}_speed.jpg`, canvas: c.canvas });

    if (tm) {
      // the turn rate a frame width in WIDTH_SECONDS makes, at the widest view the camera has
      const wide = (fov) =>
        (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI;
      const limit = wide(tm.fov.max) / WIDTH_SECONDS;
      const most = Math.max(tm.peak.v, tm.fovPeak.v, limit);
      const k = chart(W, 420, {
        from,
        to,
        top: Math.ceil((most * 1.15) / 5) * 5,
        title: `cam turn (°/s, coloured) and field of view change (°/s, white), ${from}-${to} s`,
      });
      for (const cu of m.cuts) mark(k, cu, "#6b7280", "CUT", 2, [2, 3]);
      for (const w of impulses)
        mark(k, w.from, "#a48bff", (w.kind ?? "impulse").toUpperCase(), 1, [2, 3]);
      k.g.save();
      k.g.strokeStyle = "#ff6b6b";
      k.g.setLineDash([6, 4]);
      k.g.beginPath();
      k.g.moveTo(k.X(from), k.Y(limit));
      k.g.lineTo(k.X(to), k.Y(limit));
      k.g.stroke();
      k.g.restore();
      label(k.g, `${WIDTH_SECONDS}-second rule`, k.X(to) - 4, k.Y(limit) - 6, "#ff6b6b", "right");
      for (const [series, color] of [
        [tm.fovRate, () => "#fff"],
        [tm.speed, (v) => hue(v / Math.max(limit, 1e-6) / 2)],
      ]) {
        k.g.lineWidth = 2.5;
        for (let i = 1; i < samples.length; i++) {
          k.g.strokeStyle = color(series[i]);
          k.g.beginPath();
          k.g.moveTo(k.X(samples[i - 1].t), k.Y(series[i - 1]));
          k.g.lineTo(k.X(samples[i].t), k.Y(series[i]));
          k.g.stroke();
        }
      }
      for (const p of tm.pops) mark(k, p.t, "#ff2d2d", "POP");
      for (const p of tm.fovPops ?? []) mark(k, p.t, "#ff9900", "FOV POP");
      out.push({ still: `${tag}_turn.jpg`, canvas: k.canvas });
    }

    if (saved) {
      Object.assign(free, { on: saved.on, fov: saved.fov });
      free.p.copy(saved.p);
      free.l.copy(saved.l);
    }
    return out;
  };
