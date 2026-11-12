import { expect, test } from "bun:test";

import * as THREE from "three";

import {
  ANIM_CATEGORIES,
  animate,
  ANIMS,
  type CameraOptics,
  fitAnimationLengths,
} from "../src/animate";

// A camera 10 m back from what it looks at, down -z
const cam = () => ({
  p: new THREE.Vector3(0, 1, 10),
  l: new THREE.Vector3(0, 1, 0),
  fov: 50,
  roll: 0,
  optics: undefined as CameraOptics | undefined,
});
const shots = (anim: unknown) => [{ t: 0 }, { t: 2, anim }, { t: 6 }];
const run = (anim: unknown, t: number) => {
  const c = cam(),
    black = animate(c, t, shots(anim), 9);
  return { ...c, black };
};

test("a shot with no animation leaves the camera and the frame alone", () => {
  const c = run(undefined, 3);
  expect(c.p.toArray()).toEqual([0, 1, 10]);
  expect(c.black).toBe(0);
  expect(c.optics).toEqual({
    blur: 0,
    exposure: 0,
    fringe: 0,
    bulge: 0,
    sweep: 0,
    sweepPos: 0.5,
    smearX: 0,
    smearY: 0,
  });
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
  expect(run({ in: { fx: "push", len: 1, k: 2 } }, 2).p.z).toBeCloseTo(13, 6); // k scales In
  expect(run({ out: { fx: "push", len: 1, k: 0.5 } }, 6 - 1e-9).p.z).toBeCloseTo(9.25, 4); // k scales Out
  expect(run({ in: { fx: "fade", len: 1, k: 0.5 } }, 2).black).toBeCloseTo(0.5, 6); // k scales Fade too
});

test("an In and an Out longer than the shot share it", () => {
  const anim = { in: { fx: "fade", len: 3 }, out: { fx: "fade", len: 3 } }; // both cut to 2 s of the 4 s shot
  expect(run(anim, 4).black).toBe(0); // the In ends at 4 just as the Out begins
  expect(run(anim, 3).black).toBeCloseTo(0.5, 6);
  expect(run(anim, 5).black).toBeCloseTo(0.5, 6);
});

test("the inspector can use the renderer's proportional lengths for overlapping entrance and exit effects", () => {
  expect(fitAnimationLengths(3, 1, 2)).toEqual([1.5, 0.5]);
  expect(fitAnimationLengths(3, 0, 2)).toEqual([2, 0]);
  expect(fitAnimationLengths(0.5, 0.5, 4)).toEqual([0.5, 0.5]);
  const anim = { in: { fx: "fade", len: 6 }, out: { fx: "fade", len: 2 } };
  const [entrance, exit] = fitAnimationLengths(6, 2, 4);
  expect(run(anim, 2 + entrance).black).toBe(0);
  expect(run(anim, 6 - exit / 2).black).toBeCloseTo(0.5, 6);
});

test("a Combo runs the whole shot from the keyed camera, scaled by k", () => {
  expect(run({ combo: { fx: "push" } }, 2).p.z).toBeCloseTo(10, 6);
  expect(run({ combo: { fx: "push", k: 2 } }, 6 - 1e-9).p.z).toBeCloseTo(7, 4);
  expect(run({ combo: { fx: "panL" } }, 6 - 1e-9).l.x).toBeLessThan(0);
  expect(run({ combo: { fx: "orbitR" } }, 6 - 1e-9).p.x).toBeGreaterThan(0);
});

test("the dolly zoom keeps what it looks at the same size: distance x tan(fov/2) holds", () => {
  const c = run({ combo: { fx: "vertigoIn" } }, 6 - 1e-9),
    size = (x: { p: THREE.Vector3; l: THREE.Vector3; fov: number }) =>
      x.p.distanceTo(x.l) * Math.tan(((x.fov / 2) * Math.PI) / 180);
  expect(size(c)).toBeCloseTo(size(cam()), 4);
  expect(c.fov).toBeGreaterThan(50);
});

test("Cinetic coordinate animations: Reversal pulls back for anticipation before launching forward", () => {
  const early = run({ out: { fx: "reversal", len: 1 } }, 5.35);
  const end = run({ out: { fx: "reversal", len: 1 } }, 6 - 1e-6);
  expect(early.p.z).toBeGreaterThan(10); // pulled back during anticipation
  expect(early.fov).toBeGreaterThan(50);
  expect(end.p.z).toBeLessThan(10); // launched forward into the cut
  expect(end.fov).toBeLessThan(50);
});

test("Cinetic coordinate animations: WhipDip, ZoomHop, Swing3D, IsoToFlat, and TwoBeatInspect follow their curves", () => {
  // WhipDip widens FOV at mid-whip and returns roll to 0 at landing
  const whipMid = run({ in: { fx: "whipDipL", len: 1 } }, 2.5);
  const whipEnd = run({ in: { fx: "whipDipL", len: 1 } }, 3.0);
  expect(whipMid.fov).toBeGreaterThan(50);
  expect(whipEnd.fov).toBeCloseTo(50, 5);
  expect(whipEnd.roll).toBeCloseTo(0, 5);

  // ZoomHop widens FOV mid-shot and lands back on target FOV at end of shot
  const hopMid = run({ combo: { fx: "zoomHopL" } }, 4.0);
  const hopEnd = run({ combo: { fx: "zoomHopL" } }, 6 - 1e-6);
  expect(hopMid.fov).toBeGreaterThan(55);
  expect(hopEnd.fov).toBeCloseTo(50, 3);
  expect(hopEnd.p.x).toBeLessThan(0);

  // Swing3D covers 94% of the move by 80% duration and drifts the remaining 6%
  const swing80 = run({ combo: { fx: "swing3D" } }, 2 + 4 * 0.8);
  const swing100 = run({ combo: { fx: "swing3D" } }, 6 - 1e-6);
  expect(swing80.p.z).toBeLessThan(10);
  expect(Math.abs(swing100.p.z - swing80.p.z)).toBeLessThan(0.25);

  // TwoBeatInspect zooms in at mid-shot and returns to keyed camera at end of shot
  const inspectMid = run({ combo: { fx: "twoBeatInspect" } }, 4.0);
  const inspectEnd = run({ combo: { fx: "twoBeatInspect" } }, 6 - 1e-6);
  expect(inspectMid.fov).toBeLessThan(35);
  expect(inspectEnd.fov).toBeCloseTo(50, 3);
});

test("Cinetic optical animations populate c.optics (blur, exposure, fringe, bulge, sweep) and black veil", () => {
  expect(run({ out: { fx: "blurThrough", len: 1 } }, 5.9).optics!.blur).toBeGreaterThan(0.5);
  expect(run({ in: { fx: "blurThrough", len: 1 } }, 2.1).optics!.blur).toBeGreaterThan(0.5);
  expect(run({ combo: { fx: "defocusPulse" } }, 4.0).optics!.blur).toBeGreaterThan(0.7);

  const rushOut = run({ out: { fx: "rush", len: 1 } }, 5.95);
  expect(rushOut.optics!.fringe).toBeGreaterThan(0.5);
  expect(rushOut.optics!.blur).toBeGreaterThan(0.15);

  const flashOut = run({ out: { fx: "flashCut", len: 1 } }, 5.95);
  expect(flashOut.optics!.exposure).toBeGreaterThan(0.7);

  const blackDipOut = run({ out: { fx: "blackDip", len: 1 } }, 5.95);
  expect(blackDipOut.black).toBeGreaterThan(0.7);

  const diveOut = run({ out: { fx: "occluderDive", len: 1 } }, 5.95);
  expect(diveOut.optics!.blur).toBeGreaterThan(0.6);
  expect(diveOut.black).toBeGreaterThan(0.5);

  const sweepMid = run({ combo: { fx: "lightSweep" } }, 4.0);
  expect(sweepMid.optics!.sweep).toBeGreaterThan(0.6);
  expect(sweepMid.optics!.sweepPos).toBeCloseTo(0.5, 4);

  const bulgeMid = run({ combo: { fx: "lensBulge" } }, 4.0);
  expect(bulgeMid.optics!.bulge).toBeGreaterThan(0.4);
});

test("a chosen motion curve re-times both base and Cinetic moves, with Linear at constant speed and Out accelerating into the cut", () => {
  const entrance = (curve: string | undefined, t: number) =>
    run({ in: { fx: "push", len: 1, curve } }, t).p.z;
  for (const curve of ["linear", "smooth", "snap", "bounce"] as const) {
    expect(entrance(curve, 2)).toBeCloseTo(11.5, 6); // still starts where the In starts
    expect(entrance(curve, 3)).toBeCloseTo(10, 6); // and lands exactly on the keyed frame
  }
  // Snap arrives sooner than Linear; Smooth holds back longer; Auto keeps the effect's own curve
  expect(entrance("snap", 2.5)).toBeLessThan(entrance("linear", 2.5));
  expect(entrance("smooth", 2.25)).toBeGreaterThan(entrance("linear", 2.25));
  expect(entrance(undefined, 2.5)).toBeLessThan(entrance("linear", 2.5));
  expect(entrance("snap", 2.5)).toBeLessThan(entrance(undefined, 2.5));

  // Linear on Cinetic presets moves at constant rate across quarters (not duplicating Auto's ease)
  const logFov = (curve: string | undefined, t: number) =>
    Math.log(run({ in: { fx: "logZoomIn", len: 1, curve } }, t).fov);
  const d1 = logFov("linear", 2.25) - logFov("linear", 2.0);
  const d2 = logFov("linear", 2.5) - logFov("linear", 2.25);
  const d3 = logFov("linear", 2.75) - logFov("linear", 2.5);
  expect(d1).toBeCloseTo(d2, 5);
  expect(d2).toBeCloseTo(d3, 5);
  expect(logFov("linear", 2.25)).not.toBeCloseTo(logFov(undefined, 2.25), 3);

  const craneCombo = (curve: string | undefined, t: number) =>
    run({ combo: { fx: "craneUp", curve } }, t).p.y;
  expect(craneCombo("linear", 3) - craneCombo("linear", 2)).toBeCloseTo(
    craneCombo("linear", 4) - craneCombo("linear", 3),
    5,
  );
  expect(craneCombo("linear", 3)).not.toBeCloseTo(craneCombo(undefined, 3), 3);

  // On Out (t 5..6), Snap holds near the resting frame first and accelerates into the cut; Bounce winds up from rest into the cut
  const exit = (curve: string, t: number) => run({ out: { fx: "push", len: 1, curve } }, t).p.z;
  expect(exit("snap", 5)).toBeCloseTo(10, 6);
  expect(exit("snap", 6 - 1e-9)).toBeCloseTo(8.5, 4);
  expect(10 - exit("snap", 5.5)).toBeLessThan(10 - exit("linear", 5.5)); // slower pickup in first half
  expect(exit("snap", 5.5) - exit("snap", 6 - 1e-9)).toBeGreaterThan(
    exit("linear", 5.5) - exit("linear", 6 - 1e-9),
  ); // harder snap into cut
  expect(exit("bounce", 5)).toBeCloseTo(10, 6);
  expect(exit("bounce", 6 - 1e-9)).toBeCloseTo(8.5, 4);
  // Smooth ease-in from rest at t = 5 (no sudden jump at 5.02)
  expect(10 - exit("bounce", 5.02)).toBeLessThan(0.05);
});

test("a veil never runs backwards, while 3D dive/whip moves with a veil still re-time their camera motion", () => {
  const samples = (anim: unknown, from: number, to: number) =>
    Array.from({ length: 21 }, (_, i) => run(anim, from + ((to - from) * i) / 20).black);
  for (const fx of ["fade", "blackDip", "occluderDive"]) {
    for (const curve of ["linear", "smooth", "snap", "bounce"] as const) {
      const entrance = samples({ in: { fx, len: 1, curve } }, 2, 3);
      expect(entrance.every((b, i) => i === 0 || b <= entrance[i - 1] + 1e-9)).toBe(true);
      const exit = samples({ out: { fx, len: 1, curve } }, 5, 6 - 1e-9);
      expect(exit.every((b, i) => i === 0 || b >= exit[i - 1] - 1e-9)).toBe(true);
    }
  }
  // Camera movement on blackDip and occluderDive responds to curve while their veil stays monotonic
  expect(run({ in: { fx: "blackDip", len: 1, curve: "snap" } }, 2.3).l.x).not.toBeCloseTo(
    run({ in: { fx: "blackDip", len: 1, curve: "linear" } }, 2.3).l.x,
    3,
  );
  expect(run({ in: { fx: "occluderDive", len: 1, curve: "snap" } }, 2.3).p.z).not.toBeCloseTo(
    run({ in: { fx: "occluderDive", len: 1, curve: "linear" } }, 2.3).p.z,
    3,
  );
});

test("flip mirrors lateral moves, yawed/rolled base cameras, stacked slots and lightSweep direction", () => {
  const slide = run({ combo: { fx: "slideR" } }, 6 - 1e-9);
  const slideFlip = run({ combo: { fx: "slideR", flip: true } }, 6 - 1e-9);
  expect(slide.p.x).toBeGreaterThan(0);
  expect(slideFlip.p.x).toBeCloseTo(-slide.p.x, 6);
  expect(slideFlip.l.x).toBeCloseTo(-slide.l.x, 6);

  const pan = run({ combo: { fx: "panL" } }, 6 - 1e-9),
    panFlip = run({ combo: { fx: "panL", flip: true } }, 6 - 1e-9);
  expect(pan.l.x).toBeLessThan(0);
  expect(panFlip.l.x).toBeCloseTo(-pan.l.x, 6);

  const roll = run({ combo: { fx: "barrelRoll" } }, 4),
    rollFlip = run({ combo: { fx: "barrelRoll", flip: true } }, 4);
  expect(roll.roll).not.toBeCloseTo(0, 3);
  expect(rollFlip.roll).toBeCloseTo(-roll.roll, 6);

  const push = run({ combo: { fx: "push" } }, 4),
    pushFlip = run({ combo: { fx: "push", flip: true } }, 4);
  expect(pushFlip.p.toArray()).toEqual(push.p.toArray());
  expect(pushFlip.fov).toBe(push.fov);

  const entrance = run({ in: { fx: "slideR", len: 1 } }, 2.25),
    entranceFlip = run({ in: { fx: "slideR", len: 1, flip: true } }, 2.25);
  expect(entranceFlip.p.x).toBeCloseTo(-entrance.p.x, 6);

  // A Cinetic move that pans, slides and rolls at once mirrors all of it, while its FOV dip stays
  const whip = run({ in: { fx: "whipDipL", len: 1 } }, 2.4),
    whipFlip = run({ in: { fx: "whipDipL", len: 1, flip: true } }, 2.4);
  expect(whip.l.x).toBeGreaterThan(0);
  expect(whipFlip.l.x).toBeCloseTo(-whip.l.x, 6);
  expect(whipFlip.roll).toBeCloseTo(-whip.roll, 6);
  expect(whipFlip.fov).toBeCloseTo(whip.fov, 6);

  // Off-axis yawed + rolled base camera: lateral delta along base right negates, forward/up delta and base roll stay intact
  const angledBase = () => ({
    p: new THREE.Vector3(4, 2, 8),
    l: new THREE.Vector3(-1, 1.5, 0),
    fov: 50,
    roll: 0.25,
    optics: undefined as CameraOptics | undefined,
  });
  const a0 = angledBase(),
    a1 = angledBase(),
    a2 = angledBase();
  animate(a1, 2.3, shots({ in: { fx: "whipDipL", len: 1 } }), 9);
  animate(a2, 2.3, shots({ in: { fx: "whipDipL", len: 1, flip: true } }), 9);
  const baseRight = a0.l
    .clone()
    .sub(a0.p)
    .normalize()
    .cross(new THREE.Vector3(0, 1, 0))
    .normalize();
  expect(a2.p.clone().sub(a0.p).dot(baseRight)).toBeCloseTo(
    -a1.p.clone().sub(a0.p).dot(baseRight),
    6,
  );
  expect(a2.roll - a0.roll).toBeCloseTo(-(a1.roll - a0.roll), 6);

  // Stacked Combo + In on one shot: flipping only In mirrors only In's contribution on top of Combo
  const comboOnly = run({ combo: { fx: "slideR" } }, 2.3);
  const stacked = run({ combo: { fx: "slideR" }, in: { fx: "panL", len: 1 } }, 2.3);
  const stackedFlip = run({ combo: { fx: "slideR" }, in: { fx: "panL", len: 1, flip: true } }, 2.3);
  expect(stackedFlip.l.x - comboOnly.l.x).toBeCloseTo(-(stacked.l.x - comboOnly.l.x), 5);

  // Light sweep reverses its diagonal sweep direction across the frame when mirrored
  const sweepA = run({ combo: { fx: "lightSweep" } }, 3);
  const sweepB = run({ combo: { fx: "lightSweep", flip: true } }, 3);
  expect(sweepB.optics!.sweepPos).toBeCloseTo(1 - sweepA.optics!.sweepPos, 6);
  expect(sweepB.optics!.sweep).toBeCloseTo(sweepA.optics!.sweep, 6);
});

test("optics scales only the optical part of an effect, not its move, its black veil or its sweep position", () => {
  const full = run({ out: { fx: "blurThrough", len: 1 } }, 5.9);
  const half = run({ out: { fx: "blurThrough", len: 1, optics: 0.5 } }, 5.9);
  const off = run({ out: { fx: "blurThrough", len: 1, optics: 0 } }, 5.9);
  expect(full.optics!.blur).toBeGreaterThan(0.5);
  expect(half.optics!.blur).toBeCloseTo(full.optics!.blur / 2, 6);
  expect(off.optics!.blur).toBe(0);
  expect(half.p.toArray()).toEqual(full.p.toArray());
  expect(half.fov).toBe(full.fov);

  const dive = run({ out: { fx: "occluderDive", len: 1 } }, 5.95);
  const diveOff = run({ out: { fx: "occluderDive", len: 1, optics: 0 } }, 5.95);
  expect(dive.optics!.blur).toBeGreaterThan(0.6);
  expect(diveOff.optics!.blur).toBe(0);
  expect(diveOff.black).toBeCloseTo(dive.black, 6);

  const flash = run({ out: { fx: "flashCut", len: 1 } }, 5.95);
  const flashHalf = run({ out: { fx: "flashCut", len: 1, optics: 0.5 } }, 5.95);
  expect(flashHalf.optics!.exposure).toBeCloseTo(flash.optics!.exposure / 2, 6);

  const sweep = run({ combo: { fx: "lightSweep", optics: 0.25 } }, 4);
  expect(sweep.optics!.sweep).toBeGreaterThan(0.1);
  expect(sweep.optics!.sweepPos).toBeCloseTo(0.5, 6); // where the band is is not brightness
});

test("every paired seam animation in Out has a matching partner in In and vice versa", () => {
  for (const fx of ANIMS.out.filter((x) => x.pair)) {
    expect(ANIMS.in.some((y) => y.id === fx.pair || y.pair === fx.pair)).toBe(true);
  }
  for (const fx of ANIMS.in.filter((x) => x.pair)) {
    expect(ANIMS.out.some((y) => y.id === fx.pair || y.pair === fx.pair)).toBe(true);
  }
});

test("every effect in the catalogue draws, and the same second always draws the same", () => {
  for (const [slot, list] of Object.entries(ANIMS)) {
    expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    for (const fx of list) {
      expect(fx.title && fx.cat && fx.tip).toBeTruthy();
      if (slot !== "combo") expect("len" in fx && fx.len).toBeGreaterThan(0);
      const anim = { [slot]: { fx: fx.id } },
        t = slot === "out" ? 5.95 : 2.05;
      const a = run(anim, t),
        b = run(anim, t);
      expect([a.p.toArray(), a.l.toArray(), a.fov, a.roll, a.black, a.optics]).toEqual([
        b.p.toArray(),
        b.l.toArray(),
        b.fov,
        b.roll,
        b.black,
        b.optics,
      ]);
      const opt = a.optics!;
      const hasOpt = (o: CameraOptics) =>
        o.blur > 0 ||
        o.exposure > 0 ||
        o.fringe > 0 ||
        o.bulge !== 0 ||
        o.sweep > 0 ||
        Math.hypot(o.smearX, o.smearY) > 0;
      const moved =
        !a.p.equals(cam().p) ||
        !a.l.equals(cam().l) ||
        a.fov !== 50 ||
        a.roll !== 0 ||
        a.black > 0 ||
        hasOpt(opt);
      expect(moved).toBe(true);
      const writesOptics = [2.05, 2.42, 4, 5.42, 5.95].some((sample) =>
        hasOpt(run(anim, sample).optics!),
      );
      expect(writesOptics, `${slot}:${fx.id} optics flag`).toBe(
        Boolean((fx as { optics?: boolean }).optics),
      );
      const flippedAnim = { [slot]: { fx: fx.id, flip: true } };
      const changesOnFlip = [2.2, 3, 5.8].some((sample) => {
        const u = run(anim, sample),
          f = run(flippedAnim, sample);
        return (
          u.p.distanceTo(f.p) > 1e-6 ||
          u.l.distanceTo(f.l) > 1e-6 ||
          Math.abs(u.roll - f.roll) > 1e-6 ||
          Math.abs(u.optics!.sweepPos - f.optics!.sweepPos) > 1e-6 ||
          Math.abs(u.optics!.smearX - f.optics!.smearX) > 1e-6
        );
      });
      expect(changesOnFlip, `${slot}:${fx.id} flip flag`).toBe(
        Boolean((fx as { flip?: boolean }).flip),
      );
    }
  }
});

test("Cinetic complete vocabulary: SnapZoom In/Out, CraneDown, ScaleBreathFlip, MacroDive, Living Hold Creep, FigureEight, OversizeLand, and Directional Smear", () => {
  expect(ANIM_CATEGORIES).toEqual(["Move", "Zoom", "Turn", "Lens & Light", "Shake"]);
  for (const list of Object.values(ANIMS)) {
    for (const fx of list)
      expect(ANIM_CATEGORIES).toContain(fx.cat as (typeof ANIM_CATEGORIES)[number]);
  }
  // No orphaned 1-item categories in In or Out
  for (const slot of ["in", "out"] as const) {
    for (const cat of ANIM_CATEGORIES) {
      expect(
        ANIMS[slot].filter((x) => x.cat === cat).length,
        `${slot}:${cat}`,
      ).toBeGreaterThanOrEqual(2);
    }
  }

  // SnapZoom In & Out: 30% build, steep snap jump across u=0.38..0.46 with micro-defocus pulse, 12% glide tail
  const snapInStart = run({ in: { fx: "snapZoomOut", len: 1 } }, 2.0);
  const snapInJump = run({ in: { fx: "snapZoomOut", len: 1 } }, 2.42);
  const snapInEnd = run({ in: { fx: "snapZoomOut", len: 1 } }, 3.0);
  expect(snapInStart.fov).toBeLessThan(35);
  expect(snapInJump.optics!.blur).toBeGreaterThan(0.05);
  expect(snapInEnd.fov).toBeCloseTo(50, 5);
  expect(snapInEnd.optics!.blur).toBe(0);

  const snapOutPre = run({ out: { fx: "snapZoomIn", len: 1 } }, 5.35);
  const snapOutPost = run({ out: { fx: "snapZoomIn", len: 1 } }, 5.5);
  const snapOutEnd = run({ out: { fx: "snapZoomIn", len: 1 } }, 6 - 1e-6);
  // Steep jump covers much more FOV change over 0.15s than the 0.35s build before it
  expect(snapOutPre.fov - snapOutPost.fov).toBeGreaterThan((50 - snapOutPre.fov) * 1.3);
  expect(snapOutEnd.fov).toBeLessThan(35);

  // CraneDown descends on Combo/Out and opens from above on In
  expect(run({ combo: { fx: "craneDown" } }, 6 - 1e-6).p.y).toBeLessThan(1);
  expect(run({ in: { fx: "craneDown", len: 1 } }, 2.0).p.y).toBeGreaterThan(1);
  expect(run({ out: { fx: "craneDown", len: 1 } }, 6 - 1e-6).p.y).toBeLessThan(1);

  // ScaleBreathFlip: symmetric flip across cut (Out pushes tighter, In opens tighter and breathes out to 50)
  expect(run({ out: { fx: "scaleBreathFlip", len: 1 } }, 6 - 1e-6).fov).toBeLessThan(50);
  expect(run({ in: { fx: "scaleBreathFlip", len: 1 } }, 2.0).fov).toBeLessThan(50);
  expect(run({ in: { fx: "scaleBreath", len: 1 } }, 2.0).fov).toBeGreaterThan(50);

  // MacroDive: 4.2x 3D log dive with defocus tail and NO forced black veil
  const macroOut = run({ out: { fx: "macroDive", len: 1 } }, 5.98);
  expect(macroOut.black).toBe(0);
  expect(macroOut.fov).toBeLessThan(20);
  expect(macroOut.optics!.blur).toBeGreaterThan(0.4);

  // Living hold creepIn / creepOut: monotonic one-way drift across the shot
  const creepMid = run({ combo: { fx: "creepIn" } }, 4.0);
  const creepEnd = run({ combo: { fx: "creepIn" } }, 6 - 1e-6);
  expect(creepMid.fov).toBeLessThan(50);
  expect(creepEnd.fov).toBeLessThan(creepMid.fov);
  expect(run({ combo: { fx: "creepOut" } }, 6 - 1e-6).fov).toBeGreaterThan(50);

  // FigureEight seamless loop: smooth X+Y figure-8 drift returning to origin on full cycle
  const fig0 = run({ combo: { fx: "figureEight" } }, 2.0);
  const figMid = run({ combo: { fx: "figureEight" } }, 3.2);
  expect(fig0.p.distanceTo(cam().p)).toBeLessThan(1e-5);
  expect(Math.abs(figMid.p.x)).toBeGreaterThan(0.02);
  expect(Math.abs(figMid.p.y - 1)).toBeGreaterThan(0.01);

  // OversizeLand in IN: starts oversized + soft defocus and lands cleanly on keyed frame
  const over0 = run({ in: { fx: "oversizeLand", len: 1 } }, 2.05);
  const over1 = run({ in: { fx: "oversizeLand", len: 1 } }, 3.0);
  expect(over0.fov).toBeLessThan(42);
  expect(over0.optics!.blur).toBeGreaterThan(0.2);
  expect(over1.fov).toBeCloseTo(50, 5);
  expect(over1.optics!.blur).toBe(0);

  // LightSweep In/Out, ExposureBloom In/Combo default ease vs linear, InsidePullout Out, ImpactKick Out
  expect(run({ in: { fx: "lightSweep", len: 1 } }, 2.4).optics!.sweep).toBeGreaterThan(0.3);
  expect(run({ out: { fx: "lightSweep", len: 1 } }, 5.6).optics!.sweep).toBeGreaterThan(0.3);
  expect(run({ combo: { fx: "exposureBloom" } }, 4.0).optics!.exposure).toBeGreaterThan(0.35);
  expect(run({ in: { fx: "exposureBloom", len: 1 } }, 2.25).optics!.exposure).toBeLessThan(
    run({ in: { fx: "exposureBloom", len: 1, curve: "linear" } }, 2.25).optics!.exposure,
  );
  expect(run({ out: { fx: "insidePullout", len: 1 } }, 6 - 1e-6).fov).toBeGreaterThan(58);
  expect(run({ out: { fx: "impactKick", len: 1 } }, 5.95).p.distanceTo(cam().p)).toBeGreaterThan(
    0.15,
  );

  // Directional shutter smear on fast lateral whips, scaled by optics and negated by flip
  const whip = run({ in: { fx: "whipDipL", len: 1 } }, 2.5);
  const whipHalf = run({ in: { fx: "whipDipL", len: 1, optics: 0.5 } }, 2.5);
  const whipFlip = run({ in: { fx: "whipDipL", len: 1, flip: true } }, 2.5);
  expect(Math.abs(whip.optics!.smearX)).toBeGreaterThan(0.2);
  expect(whipHalf.optics!.smearX).toBeCloseTo(whip.optics!.smearX * 0.5, 6);
  expect(whipFlip.optics!.smearX).toBeCloseTo(-whip.optics!.smearX, 6);

  // Custom cubic-bezier tuple, Cinetic curves (glide, whip, launch), EASES name, and custom film catalogue on animate()
  const customCurve = run({ in: { fx: "push", len: 1, curve: [0.137, 0.758, 0.128, 0.926] } }, 2.3);
  expect(customCurve.p.z).toBeLessThan(
    run({ in: { fx: "push", len: 1, curve: "linear" } }, 2.3).p.z,
  );
  expect(run({ in: { fx: "push", len: 1, curve: "glide" } }, 2.25).p.z).toBeLessThan(
    run({ in: { fx: "push", len: 1, curve: "linear" } }, 2.25).p.z,
  );
  expect(run({ out: { fx: "push", len: 1, curve: "whip" } }, 5.3).p.z).toBeGreaterThan(
    run({ out: { fx: "push", len: 1, curve: "linear" } }, 5.3).p.z,
  );
  expect(run({ in: { fx: "push", len: 1, curve: "xpArrive" } }, 2.2).p.z).toBeLessThan(
    run({ in: { fx: "push", len: 1, curve: "linear" } }, 2.2).p.z,
  );

  const customCat = {
    in: [
      {
        id: "aiSpiral",
        title: "AI Spiral",
        cat: "Custom",
        len: 1,
        apply: (c: ReturnType<typeof cam>, u: number, _t: number, k: number) => {
          c.p.x += (1 - u) * 3 * k;
          c.optics!.smearX = (1 - u) * 0.5;
        },
      },
    ],
    out: [],
    combo: [],
  };
  const customCam = cam();
  animate(customCam, 2.5, shots({ in: { fx: "aiSpiral", len: 1, k: 2 } }), 9, customCat);
  expect(customCam.p.x).toBeCloseTo(3, 5);
  expect(customCam.optics!.smearX).toBeCloseTo(0.25, 5);
});

test("every In, Out and Combo animation decays optical fields to zero at rest boundaries so cuts and mid-shot handoffs never pop", () => {
  const zeroOptics = (o: CameraOptics, label: string) => {
    expect(Math.abs(o.blur), `${label} blur`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(o.exposure), `${label} exposure`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(o.fringe), `${label} fringe`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(o.bulge), `${label} bulge`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(o.sweep), `${label} sweep`).toBeLessThanOrEqual(1e-4);
    expect(Math.hypot(o.smearX, o.smearY), `${label} smear`).toBeLessThanOrEqual(1e-4);
  };
  for (const fx of ANIMS.in) {
    zeroOptics(run({ in: { fx: fx.id, len: 1 } }, 3.0).optics!, `in:${fx.id}@end`);
  }
  for (const fx of ANIMS.out) {
    zeroOptics(run({ out: { fx: fx.id, len: 1 } }, 5.0).optics!, `out:${fx.id}@start`);
  }
  for (const fx of ANIMS.combo) {
    zeroOptics(run({ combo: { fx: fx.id } }, 2.0).optics!, `combo:${fx.id}@start`);
    zeroOptics(run({ combo: { fx: fx.id } }, 6 - 1e-7).optics!, `combo:${fx.id}@end`);
  }
});
