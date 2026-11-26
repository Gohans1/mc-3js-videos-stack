import { expect, test } from "bun:test";
import { feel, resolveFace, type ToonWear } from "mc-actor/toon-face";
import { FACE_BLEND, FaceTimeline, toonFaceAt } from "mc-actor/toon-timeline";

test("world-time face keys can hold a preset, use a ramp and release back to the film face", () => {
  const { steve } = FaceTimeline.parse({
    steve: [{ t: 1, face: "smile" }, { t: 3.2, face: "anger", k: 0.6 }, { t: 5, face: null }],
  });
  expect(toonFaceAt(steve, 4)).toEqual(feel("anger", 0.6));
  expect(toonFaceAt(steve, 5)).toBeNull();
  expect(toonFaceAt(steve, 0)).toBeNull();
  expect(toonFaceAt(steve, 1)).toEqual(resolveFace("smile"));
});

test("custom faces and blends sample deterministically on a backwards seek", () => {
  const { cast } = FaceTimeline.parse({
    cast: [{ t: 0, face: "neutral" }, { t: 2, face: "custom/worried-smile", blend: 1 }],
  });
  const custom = { "worried-smile": { from: "smile", brow: { tilt: 12 } } };
  const halfway = toonFaceAt(cast, 2.5, custom);
  expect(toonFaceAt(cast, 3, custom)).toEqual(resolveFace(custom["worried-smile"]));
  expect(toonFaceAt(cast, 2.5, custom)).toEqual(halfway);
  expect(halfway?.brows.L.tilt).toBeCloseTo(6);
});

test("a key without a blend eases in over FACE_BLEND seconds, and blend 0 keeps a hard switch for a cut", () => {
  const { cast } = FaceTimeline.parse({
    cast: [{ t: 0, face: "neutral" }, { t: 1, face: "smile" }, { t: 3, face: "angry", blend: 0 }],
  });
  const from = resolveFace("neutral").mouth.curve,
    to = resolveFace("smile").mouth.curve;
  expect(toonFaceAt(cast, 1 + FACE_BLEND / 4)?.mouth.curve).toBeCloseTo(from + (to - from) * 0.15625);
  expect(toonFaceAt(cast, 1 + FACE_BLEND)).toEqual(resolveFace("smile"));
  expect(toonFaceAt(cast, 3)).toEqual(resolveFace("angry"));
});

test("a removed custom face releases to the original face and cannot break a later blend", () => {
  const { cast } = FaceTimeline.parse({
    cast: [{ t: 0, face: "custom/removed" }, { t: 2, face: "smile", blend: 1 }],
  });
  const missing: string[] = [];
  expect(toonFaceAt(cast, 1, {}, (id) => missing.push(id))).toBeNull();
  expect(missing).toEqual(["removed"]);
  expect(toonFaceAt(cast, 2.5)).toEqual(resolveFace("smile"));
});

test("invalid names, ranges and time order are rejected before saving a timeline", () => {
  const parse = (steve: unknown) => FaceTimeline.safeParse({ steve }).success;
  expect(parse([{ t: 0, face: "angyr" }])).toBe(false);
  expect(parse([{ t: 0, face: "anger", k: 1.1 }])).toBe(false);
  expect(parse([{ t: 2, face: "angry" }, { t: 1, face: "smile" }])).toBe(false);
});

function authoringTypes(wear: ToonWear) {
  wear.set("angry");
  wear.set({ from: "smile", brow: { tilt: 10 } });
  // @ts-expect-error misspelled stock preset
  wear.set("angyr");
}

void authoringTypes;
