import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mediaPython } from "../media/home.mjs";
import { compareLooks, lookLines } from "../review/look.mjs";

const cli = fileURLToPath(new URL("../review/reference.mjs", import.meta.url));
const mediaDir = fileURLToPath(new URL("../media/", import.meta.url));

test.skipIf(!existsSync(mediaPython("camera")))(
  "a fixed caption does not hide a pan across a softly textured background",
  () => {
    const run = spawnSync(
      mediaPython("camera"),
      [
        "-B",
        "-c",
        `
from collections import deque
import json
import cv2
import numpy as np
from shot_look import STILL_FRAMES, fresh, motion, summary

cv2.setNumThreads(1)
rng = np.random.default_rng(41)
plate = cv2.GaussianBlur(rng.integers(0, 256, (202, 600), dtype=np.uint8), (0, 0), 4)
recent = deque(maxlen=STILL_FRAMES)
acc = fresh(0)
for i in range(30):
    image = plate[:, 3*i:3*i + 360].copy()
    cv2.putText(image, 'A caption stays here', (8, 184), cv2.FONT_HERSHEY_SIMPLEX, 1.2, 245, 3, cv2.LINE_AA)
    recent.append(image)
    acc['frames'] += 1
    if i:
        motion(prev, image, recent, acc)
    prev = image
print(json.dumps(summary(acc)))
`,
      ],
      { cwd: mediaDir, encoding: "utf8", timeout: 120000 },
    );
    expect(run.status, run.stderr || run.error?.message).toBe(0);
    expect(JSON.parse(run.stdout).camera?.dx).toBeCloseTo(-87 / 360, 1);
  },
  150000,
);

test.skipIf(!existsSync(mediaPython("camera")))(
  "locked cameras track a quiet background while a high-contrast subject crosses in opposite directions",
  () => {
    const run = spawnSync(
      mediaPython("camera"),
      [
        "-B",
        "-c",
        `
from collections import deque
import json
import cv2
import numpy as np
from shot_look import STILL_FRAMES, fresh, motion, summary

cv2.setNumThreads(1)
rng = np.random.default_rng(7)
background = rng.integers(117, 134, (202, 360), dtype=np.uint8)
subject = rng.integers(30, 220, (68, 68), dtype=np.uint8)

def measure(start, step):
    recent = deque(maxlen=STILL_FRAMES)
    bins = [fresh(i / 2) for i in range(6)]
    for i in range(45):
        x = start + i * step
        image = background.copy()
        image[54:122, x:x + 68] = subject
        acc = bins[i * 2 // 15]
        acc["frames"] += 1
        recent.append(image)
        if i:
            motion(prev, image, recent, acc)
        prev = image
    return [summary(acc) for acc in bins]

print(json.dumps([measure(30, 3), measure(230, -3)]))
`,
      ],
      { cwd: mediaDir, encoding: "utf8", timeout: 120000 },
    );
    expect(run.status, run.stderr || run.error?.message).toBe(0);
    const [ref, ours] = JSON.parse(run.stdout);
    const [shot] = compareLooks([{ from: 0, to: 3 }], look(ref, ours));
    expect(shot.findings.filter((f) => f.kind === "CAMERA")).toEqual([]);
    expect(shot.findings.map((f) => f.say)).toContainEqual(
      expect.stringMatching(/reference goes right .* in ours left .*: mirrored/),
    );
  },
  150000,
);

test.skipIf(!existsSync(mediaPython("camera")))(
  "reference compare finds a remake panning the other way and darker for going black, without reading the black frames as a still camera",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "reference-look-"));
    try {
      const texture = (name, seed) => {
        const file = join(dir, name);
        const cells = Uint8Array.from({ length: 80 * 45 }, () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return 28 + (seed >>> 25);
        });
        const pixels = Buffer.alloc(640 * 360);
        for (let y = 0; y < 360; y++)
          for (let x = 0; x < 640; x++) pixels[y * 640 + x] = cells[(y >> 3) * 80 + (x >> 3)];
        writeFileSync(file, Buffer.concat([Buffer.from("P5\n640 360\n255\n"), pixels]));
        return file;
      };
      const pan = (file, still, x, extra = "") => {
        const ff = spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-loop",
            "1",
            "-framerate",
            "30",
            "-i",
            still,
            "-filter_threads",
            "1",
            "-vf",
            `crop=320:180:x='${x}':y=60${extra}`,
            "-frames:v",
            "90",
            "-c:v",
            "ffv1",
            "-threads",
            "1",
            file,
          ],
          { encoding: "utf8", timeout: 60000 },
        );
        expect(ff.status, ff.stderr || ff.error?.message).toBe(0);
      };
      pan(join(dir, "ref.mkv"), texture("set.pgm", 7), "n*2.5");
      pan(
        join(dir, "ours.mkv"),
        texture("our-set.pgm", 8),
        "300-n*2.5",
        ",drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='gte(n,45)'",
      );
      const run = spawnSync(
        process.execPath,
        [cli, "compare", join(dir, "ref.mkv"), join(dir, "ours.mkv"), "--out", dir, "--minutes", "3"],
        {
          encoding: "utf8",
          timeout: 210000,
        },
      );
      expect(run.status, run.error?.message || run.stdout + run.stderr).toBe(0);
      const json = run.stdout.match(/next: read (.+?) and /)?.[1];
      const { look } = JSON.parse(readFileSync(json, "utf8"));
      const says = look.shots.flatMap((s) => s.findings.map((f) => `${f.kind} ${f.say}`));
      expect(says).toContainEqual(
        expect.stringMatching(
          /^CAMERA \d+\.\d\d–\d+\.\d\d s: reference pans right .* ours pans left .*: mirrored/,
        ),
      );
      expect(says).toContainEqual(expect.stringMatching(/^LIGHT ours is darker/));
      expect(says.filter((x) => /holds still/.test(x))).toEqual([]);
      expect(readFileSync(json.replace(/json$/, "md"), "utf8")).toMatch(/## Look per shot/);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  },
  340000,
);

const BIN = 0.5;
const quiet = {
  frames: 15,
  camera: { dx: 0, dy: 0, zoom: 1, turn: 0 },
  subject: { dx: 0, dy: 0, share: 0 },
  light: { L: 50, a: 0, b: 0 },
  focus: { centre: 0.8, top: 0.8 },
};
const binAt = (t, over = {}) => ({
  ...quiet,
  t,
  camera: { ...quiet.camera, ...over.camera },
  subject: { ...quiet.subject, ...over.subject },
  light: { ...quiet.light, ...over.light },
  focus: over.focus === null ? null : { ...quiet.focus, ...over.focus },
  ...(over.camera === null ? { camera: null, subject: null } : {}),
});
const video = (to, overAt = () => ({})) =>
  Array.from({ length: Math.round(to / BIN) }, (_, k) => binAt(k * BIN, overAt(k * BIN)));
const during = (from, to, over) => (t) => (t >= from - 1e-9 && t < to - 1e-9 ? over : {});
const look = (ref, ours, scale = 1) => ({ bin: BIN, scale, ref, ours });
const oneShot = [{ from: 0, to: 4 }];

test("a camera panning the other way for over a second is mirrored, with its seconds", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, during(1, 2.5, { camera: { dx: -0.04 } })),
      video(4, during(1, 2.5, { camera: { dx: 0.03 } })),
    ),
  );
  expect(c.findings).toEqual([
    {
      kind: "CAMERA",
      from: 1,
      to: 2.5,
      say: "1.00–2.50 s: reference pans right 12% of the frame, ours pans left 9%: mirrored",
    },
  ]);
});

test("opposite camera rolls are reported in degrees", () => {
  const [shot] = compareLooks(
    oneShot,
    look(
      video(4, () => ({ camera: { turn: 8 } })),
      video(4, () => ({ camera: { turn: -8 } })),
    ),
  );
  expect(shot.findings.map((f) => f.say)).toEqual([
    "0.00–4.00 s: reference rolls counterclockwise 64°, ours rolls clockwise 64°: mirrored",
  ]);
});

test("mirrored motion that reverses direction is reported as two runs", () => {
  const travel = (v) => ({ camera: { dx: v }, subject: { dx: v, share: 0.1 } });
  const [shot] = compareLooks(
    [{ from: 0, to: 2 }],
    look(
      video(2, (t) => travel(t < 1 ? 0.1 : -0.1)),
      video(2, (t) => travel(t < 1 ? -0.1 : 0.1)),
    ),
  );
  expect(shot.findings.map(({ kind, from, to, say }) => [kind, from, to, say])).toEqual([
    [
      "CAMERA",
      0,
      1,
      "0.00–1.00 s: reference pans left 20% of the frame, ours pans right 20%: mirrored",
    ],
    [
      "SUBJECT",
      0,
      1,
      "0.00–1.00 s: what moves in the reference goes right 20% of the frame, in ours left 20%: mirrored",
    ],
    [
      "CAMERA",
      1,
      2,
      "1.00–2.00 s: reference pans right 20% of the frame, ours pans left 20%: mirrored",
    ],
    [
      "SUBJECT",
      1,
      2,
      "1.00–2.00 s: what moves in the reference goes left 20% of the frame, in ours right 20%: mirrored",
    ],
  ]);
});

test("a bin that straddles a cut does not turn a 0.6-second shot into a one-second motion finding", () => {
  const [first] = compareLooks(
    [
      { from: 0, to: 0.6 },
      { from: 0.6, to: 1.5 },
    ],
    look(
      video(1.5, () => ({ camera: { dx: -0.04 } })),
      video(1.5, () => ({ camera: { dx: 0.04 } })),
    ),
  );
  expect(first.findings).toEqual([]);
});

test("half a second of opposite camera motion is too short to call", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, during(1, 1.5, { camera: { dx: -0.04 } })),
      video(4, during(1, 1.5, { camera: { dx: 0.04 } })),
    ),
  );
  expect(c.findings).toEqual([]);
});

test("a reference camera that pushes in while ours holds still says ours holds still", () => {
  const [c] = compareLooks(
    oneShot,
    look(video(4, during(0, 2, { camera: { zoom: 1.05 } })), video(4)),
  );
  expect(c.findings.map((f) => f.say)).toEqual([
    "0.00–2.00 s: reference pushes in 20% of the frame, ours holds still",
  ]);
});

test("a pan and a tilt in the same span report the difference on each axis", () => {
  const [shot] = compareLooks(
    oneShot,
    look(
      video(4, during(0, 2, { camera: { dx: -0.04 } })),
      video(4, during(0, 2, { camera: { dy: 0.04 } })),
    ),
  );
  expect(shot.findings.map((f) => f.say)).toEqual([
    "0.00–2.00 s: reference pans right 16% of the frame, ours has no horizontal pan",
    "0.00–2.00 s: reference has no vertical tilt, ours tilts up 16% of the frame",
  ]);
});

test("a slow drift of a few percent against a still camera is not worth a finding", () => {
  const [c] = compareLooks(
    oneShot,
    look(video(4), video(4, during(1, 2, { camera: { dx: 0.016 } }))),
  );
  expect(c.findings).toEqual([]);
});

test("a shot's camera findings are listed in time order, whatever the axis", () => {
  const ours = video(4, (t) =>
    t < 1.5 ? { camera: { dy: 0.04 } } : t >= 2.5 ? { camera: { dx: 0.04 } } : {},
  );
  const [c] = compareLooks(oneShot, look(video(4), ours));
  expect(c.findings.map((f) => f.from)).toEqual([0, 2.5]);
});

test("cameras moving the same way are not findings, however different their speeds", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, () => ({ camera: { dx: -0.05 } })),
      video(4, () => ({ camera: { dx: -0.02 } })),
    ),
  );
  expect(c.findings).toEqual([]);
});

test("a subject crossing the frame the other way for over a second is mirrored", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, during(0, 2, { subject: { dx: 0.05, share: 0.05 } })),
      video(4, during(0, 2, { subject: { dx: -0.04, dy: 0.01, share: 0.03 } })),
    ),
  );
  expect(c.findings.map((f) => f.say)).toEqual([
    "0.00–2.00 s: what moves in the reference goes right 20% of the frame, in ours left 16%: mirrored",
  ]);
});

test("a subject too small to measure in one of the two is not judged", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, () => ({ subject: { dx: 0.05, share: 0.05 } })),
      video(4, () => ({ subject: { dx: -0.05, share: 0.002 } })),
    ),
  );
  expect(c.findings).toEqual([]);
});

test("only a large difference in the shot's brightness or warmth is a finding", () => {
  const small = compareLooks(
    oneShot,
    look(
      video(4),
      video(4, () => ({ light: { L: 56, b: 5 } })),
    ),
  );
  const big = compareLooks(
    oneShot,
    look(
      video(4),
      video(4, () => ({ light: { L: 64, b: -10 } })),
    ),
  );
  expect(small[0].findings).toEqual([]);
  expect(big[0].findings.map((f) => f.say)).toEqual([
    "ours is brighter by 14 L* (64 against 50)",
    "ours is cooler by 10 b* (-10 against 0)",
  ]);
});

test("a reference whose top third is blurred far more than its centre, against ours sharp all over, is a focus finding", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, () => ({ focus: { centre: 0.8, top: 4 } })),
      video(4, () => ({ focus: { centre: 0.8, top: 0.9 } })),
    ),
  );
  expect(c.findings.map((f) => `${f.kind} ${f.say}`)).toEqual([
    "FOCUS the reference's top third is 5.0x blurrier than its centre (shallow focus), ours 1.1x",
  ]);
});

test("a shot whose top third has no edges to measure blur on is not judged for focus", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, () => ({ focus: null })),
      video(4, () => ({ focus: { top: 4 } })),
    ),
  );
  expect(c.findings).toEqual([]);
});

test("seconds where the reference's camera could not be measured are not read as a still camera", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, during(1, 3, { camera: null })),
      video(4, during(1, 3, { camera: { dx: 0.04 } })),
    ),
  );
  expect(c.findings).toEqual([]);
});

test("an unmeasured half second splits a camera disagreement into runs judged on their own", () => {
  const ref = video(4, (t) =>
    t >= 1 && t < 1.5 ? { camera: null } : t >= 0.5 && t < 3 ? { camera: { dx: -0.04 } } : {},
  );
  const ours = video(4, during(0.5, 3, { camera: { dx: 0.04 } }));
  const [c] = compareLooks(oneShot, look(ref, ours));
  expect(c.findings.map((f) => [f.from, f.to])).toEqual([[1.5, 3]]);
});

test("subjects crossing at right angles are not mirrored", () => {
  const [c] = compareLooks(
    oneShot,
    look(
      video(4, () => ({ subject: { dx: 0.05, share: 0.05 } })),
      video(4, () => ({ subject: { dy: 0.05, share: 0.05 } })),
    ),
  );
  expect(c.findings).toEqual([]);
});

test("a glare in a couple of half seconds does not make a shot's focus shallow", () => {
  const glare = (t) => (t === 1 || t === 2.5 ? { focus: { top: 6 } } : {});
  const [c] = compareLooks(oneShot, look(video(4, glare), video(4)));
  expect(c.findings).toEqual([]);
});

test("the remake's bins are read at the reference's second times the scale", () => {
  const ref = video(4, during(1, 2.5, { camera: { dx: -0.04 } }));
  const ours = video(8, during(2, 5, { camera: { dx: 0.02 } }));
  const [c] = compareLooks(oneShot, look(ref, ours, 2));
  expect(c.findings[0].say).toMatch(
    /^1\.00–2\.50 s: reference pans right 12% of the frame, ours pans left/,
  );
});

test("fitted comparison uses net motion across both remake bins aligned to one reference bin", () => {
  const travel = (dx) => ({ camera: { dx }, subject: { dx, share: 0.1 } });
  const ref = video(2, () => travel(0.05));
  const ours = video(4, (t) => travel(t % 1 === 0 ? -0.05 : 0.1));
  const [shot] = compareLooks([{ from: 0, to: 2 }], look(ref, ours, 2));
  expect(shot.findings).toEqual([]);
});

test("fitted comparison weights partial remake bins when totaling a mirrored pan", () => {
  const ref = video(1, () => ({ camera: { dx: -0.05 } }));
  const ours = video(1.5, () => ({ camera: { dx: 0.02 } }));
  const [shot] = compareLooks([{ from: 0, to: 1 }], look(ref, ours, 1.5));
  expect(shot.findings[0].say).toBe(
    "0.00–1.00 s: reference pans right 10% of the frame, ours pans left 6%: mirrored",
  );
});

test("a shot with no measured frames in one video is skipped with a reason", () => {
  const [c] = compareLooks(oneShot, look(video(4), []));
  expect(c.findings).toEqual([]);
  expect(c.skipped).toBe("no frames measured in ours");
});

test("the report lists the shots with findings and counts the differences it flagged", () => {
  const twoShots = [
    { from: 0, to: 4 },
    { from: 4, to: 8 },
  ];
  const compared = compareLooks(
    twoShots,
    look(
      video(8, during(0, 2, { camera: { dx: -0.04 } })),
      video(8, during(0, 2, { camera: { dx: 0.04 } })),
    ),
  );
  const lines = lookLines(compared);
  expect(lines[0]).toBe("## Look per shot");
  expect(lines).toContain(
    "- shot 1 0.00–4.00 s: CAMERA 0.00–2.00 s: reference pans right 16% of the frame, ours pans left 16%: mirrored",
  );
  expect(lines.some((l) => l.startsWith("- shot 2"))).toBe(false);
  expect(lines.at(-1)).toBe("Look differences flagged in 1 of 2 shots");
});
