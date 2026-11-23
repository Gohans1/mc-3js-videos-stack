// @ts-nocheck
import * as THREE from "three";

export function footChecks({ perform, steve, now }) {
  const soles = (t) => {
    perform(t);
    return ["L", "R"]
      .map(
        (sd) =>
          `${sd} ${steve
            .soleAt(sd)
            .toArray()
            .map((v) => v.toFixed(3))
            .join(" ")} -> ${
            now.feet[sd]
              ?.toArray()
              .map((v) => v.toFixed(3))
              .join(" ") ?? "pose"
          } ${now.feet.mode(sd)}`,
      )
      .join(" | ");
  };
  return {
    slide: (from, to) => {
      const out = [],
        q = new THREE.Vector3(),
        touch = {},
        sunk = {},
        short = {};
      for (let t = from; t <= to; t += 1 / 60) {
        perform(t);
        for (const sd of ["L", "R"]) {
          steve.soleAt(sd, q);
          const k = touch[sd];
          if (q.y < 0.015) {
            if (!k) touch[sd] = { t, x: q.x, z: q.z, far: 0 };
            else k.far = Math.max(k.far, Math.hypot(q.x - k.x, q.z - k.z));
          } else if (k) {
            if (k.far > 0.02)
              out.push(
                `${k.t.toFixed(2)}-${t.toFixed(2)} ${sd} sole slides ${(k.far * 100).toFixed(0)} cm`,
              );
            touch[sd] = null;
          }
          const aim = now.feet[sd],
            miss = aim ? q.distanceTo(aim) : 0;
          if (miss > 0.03 && !short[sd]) short[sd] = { t, miss };
          else if (short[sd] && miss > 0.03) short[sd].miss = Math.max(short[sd].miss, miss);
          else if (short[sd] && miss <= 0.03) {
            out.push(
              `${short[sd].t.toFixed(2)}-${t.toFixed(2)} ${sd} leg cannot reach its planted sole by ${(short[sd].miss * 100).toFixed(0)} cm`,
            );
            short[sd] = null;
          }
          if (q.y < -0.03 && !sunk[sd]) {
            sunk[sd] = t;
          } else if (q.y >= -0.03 && sunk[sd]) {
            out.push(`${sunk[sd].toFixed(2)}-${t.toFixed(2)} ${sd} sole under the floor`);
            sunk[sd] = 0;
          }
        }
      }
      for (const sd of ["L", "R"]) {
        if (touch[sd]?.far > 0.02)
          out.push(
            `${touch[sd].t.toFixed(2)}-end ${sd} sole slides ${(touch[sd].far * 100).toFixed(0)} cm`,
          );
        if (short[sd])
          out.push(
            `${short[sd].t.toFixed(2)}-end ${sd} leg cannot reach its planted sole by ${(short[sd].miss * 100).toFixed(0)} cm`,
          );
        if (sunk[sd]) out.push(`${sunk[sd].toFixed(2)}-end ${sd} sole under the floor`);
      }
      return out.length ? out : [`${from}-${to}: no sliding, sunk or unreachable sole`];
    },
    trace: (from, to, step) => {
      const out = [];
      for (let t = from; t <= to + 1e-6; t += step) out.push(`${t.toFixed(3)} ${soles(t)}`);
      return out;
    },
  };
}
