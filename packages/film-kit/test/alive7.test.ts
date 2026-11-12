import { expect, test } from "bun:test";

import { blinks } from "../src/blinks";
import { idle } from "../src/idle";
import { fly, jumpArc, MC, mcBody, TPS } from "../src/mcmotion";
import { POSTURE, posture } from "../src/posture";
import { SIGH, sighLength, sighLungs, sighTimes } from "../src/sigh";
import { contacts, gameSteps, STEP, stepSounds } from "../src/steps";
import { TOUCH, touches } from "../src/touch";
import { YAWN, yawnPose, yawns, yawnTimes } from "../src/yawn";

const still = () => ({});

test("mcmotion: the game's jump (1.25 blocks, lands after 12 ticks) and a hit's slide on stone", () => {
  const j = jumpArc();
  expect(j.height).toBeCloseTo(1.2522, 3);
  expect(j.ticks).toBe(12);
  const b = mcBody([0, 0, 0], [{ t: 1, from: [0, -1] }], { end: 5 });
  // pushed away from the attacker (+z), off the ground for a moment, red for 10 ticks, then still
  expect(b(1.2).onGround).toBe(false);
  expect(b(1 + 9 / TPS).red).toBe(true);
  expect(b(1 + 11 / TPS).red).toBe(false);
  const slid = b(4).p[2];
  expect(slid).toBeGreaterThan(2);
  expect(slid).toBeLessThan(4);
  expect(b(4).p[0]).toBeCloseTo(0, 6);
  expect(b.events.some((e) => e.kind === "land")).toBe(true);
});

test("mcmotion: a hit keyed by side follows him; by floor point it does not", () => {
  // after the first hit he is ~3 blocks away; a second hit from his front (-x) must still push him +x
  const ev = [
    { t: 0.5, from: [0, -1] as [number, number] },
    { t: 3, from: [-1, 0] as [number, number] },
  ];
  const b = mcBody([0, 0, 0], ev, { end: 6 });
  expect(b(5.5).p[0]).toBeGreaterThan(1.5);
});

test("mcmotion: death tips him over by the game's formula and he is gone at 20 ticks", () => {
  const b = mcBody([0, 0, 0], [{ t: 1, die: true }], { end: 3 });
  expect(b(1 + 6 / TPS).roll).toBeCloseTo(Math.min(1, Math.sqrt((5 / 20) * 1.6)) * MC.flip, 3);
  expect(b(1 + 19 / TPS).gone).toBe(false);
  expect(b(1 + MC.death / TPS).gone).toBe(true);
  expect(b(1.5).red).toBe(true);
});

test("mcmotion: an arrow sticks where it lands; an item bounces to a stop", () => {
  const a = fly("arrow", [0, 1.5, 0], [0.9, 0.2, 0], { ground: 0 });
  const land = a.landings[0].t;
  expect(a(land + 1).p).toEqual(a(land + 3).p);
  const it = fly("item", [0, 1, 0], [0.05, 0.2, 0], { ground: 0 });
  expect(it(30).p[1]).toBeCloseTo(0, 6);
  expect(it(30).p[0]).toBeCloseTo(it(40).p[0], 6);
});

test("steps: heel strikes from the soles, a step sound each, never the same variant twice in a row", () => {
  // two feet stepping in turn: each swings forward 1.2 m in 0.3 s every 0.8 s and stands still the rest, half a cycle apart
  const sole = (phase: number) => (t: number) => {
    const n = Math.floor((t + phase) / 0.8),
      u = Math.min(1, ((t + phase) % 0.8) / 0.3);
    return [1.2 * (n + u * u * (3 - 2 * u)), u < 1 ? 0.08 * Math.sin(Math.PI * u) : 0, 0] as [
      number,
      number,
      number,
    ];
  };
  const s = contacts({ L: sole(0), R: sole(0.4) }, 8, { ground: 0 });
  expect(s.length).toBeGreaterThan(15);
  expect(s.length).toBeLessThan(22);
  const sounds = stepSounds(s, () => "stone");
  expect(sounds.every((x) => x.event === "block.stone.step" && x.volume === STEP.volume)).toBe(
    true,
  );
  for (let i = 1; i < sounds.length; i++) expect(sounds[i].variant).not.toBe(sounds[i - 1].variant);
  // carpet: its own step plus the block below, quieter and lower
  const carpet = stepSounds(s.slice(0, 1), (_x, y) => (y > -0.5 ? "white_carpet" : "stone"));
  expect(carpet.length).toBe(2);
  expect(carpet[1].volume).toBeCloseTo(STEP.volume * STEP.layered.volume, 6);
  expect(carpet[1].pitch).toBeCloseTo(STEP.layered.pitch, 6);
});

test("steps: the game's own rhythm is one step every 1/0.6 blocks walked", () => {
  const g = gameSteps(
    (t) => t * 4.317,
    () => [0, 0, 0],
    10,
  );
  expect(g.length).toBe(Math.floor((10 * 4.317) / STEP.every));
});

test("yawn: in 5.9 s at the mean pace; eyes shut and head back at the acme; dropped whole if a fright overlaps", () => {
  const y = yawns([{ t: 2 }]);
  const total = YAWN.inhale + YAWN.acme + YAWN.exhale;
  expect(total).toBeCloseTo(5.9, 6);
  const acme = y(2 + YAWN.inhale + YAWN.acme * 0.6)!;
  expect(acme.phase).toBe("acme");
  expect(acme.lids).toBeGreaterThan(0.95);
  expect(yawnPose(acme).head![0]).toBeLessThan(-0.9 * YAWN.neck);
  expect(y(2 + total + YAWN.pause + 0.01)).toBeNull();
  // a tempo stretches every phase; a gasp overlapping it drops it (face and breath together)
  expect(yawns([{ t: 2, tempo: 0.6 }])(2 + YAWN.inhale * 0.6 + 0.1)!.phase).toBe("acme");
  const hit = yawns([{ t: 2 }], { gasps: [{ t: 4 }] });
  expect(hit(3)).toBeNull();
  expect(hit.spans.length).toBe(0);
  // by themselves only while sleepy, about a bout apart
  expect(yawnTimes(600, () => 0).length).toBe(0);
  const sleepy = yawnTimes(600, () => 1);
  expect(sleepy.length).toBeGreaterThan(4);
  expect(sleepy.length).toBeLessThan(14);
});

test("sigh: a second breath on top (2-5 x a normal one), the let-go below rest, about 12 an hour", () => {
  const top = sighLungs(SIGH.first + SIGH.second + SIGH.hold / 2, 0);
  expect(top).toBeGreaterThanOrEqual(2);
  expect(top).toBeLessThanOrEqual(5);
  expect(sighLungs(SIGH.first + SIGH.second + SIGH.hold + SIGH.out, 0)).toBeCloseTo(SIGH.low, 6);
  expect(sighLungs(sighLength(), 0)).toBeCloseTo(0, 6);
  const n = sighTimes(3600 * 4, () => SIGH.rate.rest).length / 4;
  expect(n).toBeGreaterThan(7);
  expect(n).toBeLessThan(17);
});

test("idle: breaths rank gasp > yawn > sigh; an overlapped lower one is dropped", () => {
  const Y = yawns([{ t: 10 }]);
  const life = idle(still, 40, {
    gasps: [{ t: 2 }],
    sighs: [{ t: 2.5 }, { t: 11 }, { t: 25 }],
    yawns: Y,
  });
  const kinds = life.windows.map((w) => w.kind);
  expect(kinds).toEqual(["gasp", "yawn", "sigh"]);
  expect(life.breath(26)).toBe("sigh");
  expect(life.breath(12)).toBe("yawn");
  expect(life.events.some((e) => e.kind === "sigh-out")).toBe(true);
});

test("blinks: none start inside a quiet span (a yawn's own lids)", () => {
  const quiet: [number, number][] = [[5, 12]];
  const b = blinks(60, { quiet });
  expect(b.times.some((t) => t >= 5 && t < 12)).toBe(false);
  expect(b.times.length).toBeGreaterThan(5);
});

test("posture: follows the face's emotion at the face's pace; sad hangs the head, joy lifts it", () => {
  const p = posture([
    { t: 0, mood: "neutral" },
    { t: 5, mood: "sad" },
    { t: 20, mood: "happy" },
  ]);
  expect(p(4).head).toBeUndefined();
  expect(p(15).head![0]).toBeCloseTo(POSTURE.shape.sadness.head![0], 6);
  expect(p(30).head![0]).toBeCloseTo(POSTURE.shape.joy.head![0], 6);
  expect(p.amp(15)).toBeCloseTo(POSTURE.amp.sadness, 6);
  // a change cut short goes on from where it had got to
  const cut = posture([
    { t: 0, mood: "neutral" },
    { t: 5, mood: "sad" },
    { t: 5.2, mood: "neutral" },
  ]);
  expect(cut(5.2).head![0]).toBeGreaterThan(0);
  expect(cut(5.2).head![0]).toBeLessThan(POSTURE.shape.sadness.head![0]);
});

test("touch: about 23 an hour, more when stressed; only with a free hand, and an urge a busy hand meets is not saved up", () => {
  const n = touches(3600 * 3).list.length / 3;
  expect(n).toBeGreaterThan(12);
  expect(n).toBeLessThan(34);
  expect(touches(3600, { rate: () => TOUCH.rate * TOUCH.stress }).list.length).toBeGreaterThan(
    touches(3600).list.length,
  );
  const busy = (t: number) => t >= 100 && t < 300;
  const T = touches(1200, { free: (t) => !busy(t) });
  expect(T.list.some((x) => x.t < 300 && x.end > 100)).toBe(false);
  // right after the busy span nothing piled up fires at once
  expect(T.list.filter((x) => x.t >= 300 && x.t < 301).length).toBe(0);
  // one touch: up in reach, held, back
  const k = touches(30, { keys: [{ t: 5, spot: "chin", side: "L", hold: 2 }], rate: () => 0 });
  expect(k(5 + TOUCH.reach / 2)!.w).toBeGreaterThan(0.3);
  expect(k(5 + TOUCH.reach + 1)!.w).toBe(1);
  expect(k(5 + TOUCH.reach + 2 + TOUCH.back + 0.01)).toBeNull();
  expect(k(6)!.at[0]).toBe(0);
});
