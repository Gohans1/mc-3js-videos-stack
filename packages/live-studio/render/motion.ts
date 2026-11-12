// @ts-nocheck
// CHECK=motion:<target>,<from>,<to>, built in for every film: how one thing moves between two heard seconds, seen the way an
// animator checks a move in a graph editor and with onion skins, with no film wiring. Writes to renders/:
//   motion_<target>_<from>-<to>_trail.jpg  ghosts of the move from one fixed camera (INSPECT's, else the film's at the middle
//     second), its path drawn over them coloured by speed (blue slow, red fast), a dot every 0.1 s and the time every 0.5 s:
//     dots bunched up = slow, spread out = fast; POP and STOP marks where it jumps or stops dead
//   motion_<target>_<from>-<to>_speed.jpg  speed over time (m/s), each move's peak and how it is eased, the faults marked
// and prints the numbers (checks/motion.mjs). target: see target.ts; "cam" gives the graph only.
import * as THREE from "three";

import { measure, report } from "../checks/motion.mjs";
import { canvas } from "./lab";
import { chart, findTarget, hue, label, mark, targetHelp } from "./target";

const HZ = 60,
  GHOSTS = 8;

export const motionCheck =
  (render, cfg, cuts = []) =>
  async (target, from, to) => {
    const { camera, free, look } = render.tools;
    if (typeof target !== "string" || !(to > from))
      return [
        "ERROR usage: CHECK=motion:<target>,<from s>,<to s> (target: cam, a bone, an object name or label)",
      ];
    const isCam = target === "cam";
    const obj = findTarget(render.tools, target);
    if (!obj) return [targetHelp(render.tools, target)];

    // one fixed camera for the whole move, so ghosts and the path line up; put back afterwards
    const saved = { on: free.on, p: free.p.clone(), l: free.l.clone(), fov: free.fov };
    if (!isCam) {
      if (cfg.inspect) {
        const [px, py, pz, lx, ly, lz, fov] = cfg.inspect;
        free.p.set(px, py, pz);
        free.l.set(lx, ly, lz);
        free.fov = fov;
      } else {
        render((from + to) / 2);
        free.p.copy(camera.getWorldPosition(new THREE.Vector3()));
        free.l.copy(look);
        free.fov = camera.fov;
      }
      free.on = true;
    }

    const samples = [];
    for (let i = 0, n = Math.round((to - from) * HZ); i <= n; i++) {
      const t = from + i / HZ;
      render(t);
      obj.updateWorldMatrix(true, false);
      samples.push({ t, p: obj.getWorldPosition(new THREE.Vector3()).toArray() });
    }
    const m = measure(samples, cuts);
    const out = report(target, samples, m);
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
      label(
        g,
        `${mv.peakV.toFixed(2)} m/s, ${Math.round(mv.peakAt * 100)}% in`,
        X(mv.peakT),
        Y(mv.peakV) - 10,
        "#fff",
        "center",
      );
      for (const t of [mv.from, mv.to]) mark(c, t, "rgba(255,255,255,.35)", "", 0, [4, 4]);
    }
    for (const p of m.pops) mark(c, p.t, "#ff2d2d", "POP");
    for (const s of m.stops) mark(c, s.t, "#ffffff", `DEAD ${s.kind.toUpperCase()}`, 1);
    out.push({ still: `${tag}_speed.jpg`, canvas: c.canvas });

    Object.assign(free, { on: saved.on, fov: saved.fov });
    free.p.copy(saved.p);
    free.l.copy(saved.l);
    return out;
  };
