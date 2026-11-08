import { expect, test } from "bun:test";
import * as THREE from "three";
import { animate, ANIMS } from "../src/animate";

// A camera 10 m back from what it looks at, down -z
const cam = () => ({ p: new THREE.Vector3(0, 1, 10), l: new THREE.Vector3(0, 1, 0), fov: 50, roll: 0 });
const shots = (anim) => [{ t: 0 }, { t: 2, anim }, { t: 6 }];
const run = (anim, t) => { const c = cam(), black = animate(c, t, shots(anim), 9); return { ...c, black }; };

test("a shot with no animation leaves the camera and the frame alone", () => {
  const c = run(undefined, 3);
  expect(c.p.toArray()).toEqual([0, 1, 10]);
  expect(c.black).toBe(0);
  expect(run({ in: { fx: "nope" } }, 2).black).toBe(0);
});

test("Fade in opens from black and is clear after its length; Fade out ends on black", () => {
  const anim = { in: { fx: "fade", len: 1 }, out: { fx: "fade", len: 0.5 } };
  expect(run(anim, 2).black).toBe(1);
  expect(run(anim, 3).black).toBe(0);
  expect(run(anim, 4).black).toBe(0);
  expect(run(anim, 6 - 1e-6).black).toBeCloseTo(1, 4);
});

test("an In starts back along its way and lands on the keyed camera; an Out goes on along it", () => {
  const anim = { in: { fx: "push", len: 1 }, out: { fx: "push", len: 1 } };
  expect(run(anim, 2).p.z).toBeCloseTo(11.5, 6); // 15% of the 10 m behind
  expect(run(anim, 3).p.z).toBeCloseTo(10, 6);
  expect(run(anim, 4.5).p.z).toBeCloseTo(10, 6);
  expect(run(anim, 6 - 1e-9).p.z).toBeCloseTo(8.5, 4);
  expect(run({ in: { fx: "zoomIn", len: 1 } }, 2).fov).toBeCloseTo(60, 6); // tighter into the frame: starts 20% wider
});

test("an In and an Out longer than the shot share it", () => {
  const anim = { in: { fx: "fade", len: 3 }, out: { fx: "fade", len: 3 } }; // both cut to 2 s of the 4 s shot
  expect(run(anim, 4).black).toBe(0); // the In ends at 4 just as the Out begins
  expect(run(anim, 3).black).toBeCloseTo(0.5, 6);
  expect(run(anim, 5).black).toBeCloseTo(0.5, 6);
});

test("a Combo runs the whole shot from the keyed camera, scaled by k", () => {
  expect(run({ combo: { fx: "push" } }, 2).p.z).toBeCloseTo(10, 6);
  expect(run({ combo: { fx: "push", k: 2 } }, 6 - 1e-9).p.z).toBeCloseTo(7, 4);
  expect(run({ combo: { fx: "panL" } }, 6 - 1e-9).l.x).toBeLessThan(0);
  expect(run({ combo: { fx: "orbitR" } }, 6 - 1e-9).p.x).toBeGreaterThan(0);
});

test("the dolly zoom keeps what it looks at the same size: distance x tan(fov/2) holds", () => {
  const c = run({ combo: { fx: "vertigoIn" } }, 6 - 1e-9), size = (x) => x.p.distanceTo(x.l) * Math.tan(((x.fov / 2) * Math.PI) / 180);
  expect(size(c)).toBeCloseTo(size(cam()), 4);
  expect(c.fov).toBeGreaterThan(50);
});

test("every effect in the catalogue draws, and the same second always draws the same", () => {
  for (const [slot, list] of Object.entries(ANIMS)) {
    expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    for (const fx of list) {
      expect(fx.title && fx.cat && fx.tip).toBeTruthy();
      if (slot !== "combo") expect(fx.len).toBeGreaterThan(0);
      const anim = { [slot]: { fx: fx.id } }, t = slot === "out" ? 5.95 : 2.05;
      const a = run(anim, t), b = run(anim, t);
      expect([a.p.toArray(), a.l.toArray(), a.fov, a.roll, a.black]).toEqual([b.p.toArray(), b.l.toArray(), b.fov, b.roll, b.black]);
      const moved = !a.p.equals(cam().p) || !a.l.equals(cam().l) || a.fov !== 50 || a.roll !== 0 || a.black > 0;
      expect(moved).toBe(true);
    }
  }
});
