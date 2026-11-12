import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  filterVoiceTakes,
  findTakeLineIndex,
  parseTakeScript,
  phraseBrickWindows,
  resizeNarrationBrickForSwap,
  shortTryLabel,
  sliceNarrationClip,
  voiceActorTitle,
  voiceClipLabel,
  voiceClipSummary,
} from "../app/sound/voice-view.ts";
import { narrationLines } from "../src/narration.ts";
import { mapTimeline, mapVoice } from "../src/timing-data.mjs";
import { compileTiming } from "../src/timing.mjs";

const TAKES = [
  {
    id: "01",
    t: 4.3,
    text: "[low, quiet, waking up] He opens his eyes.",
    file: "01.mp3",
    seconds: 1.12,
    words: 4,
    aligned: true,
    tries: ["01_1.mp3", "01_2.mp3"],
  },
  {
    id: "02",
    t: 9.2,
    text: "[uneasy, hushed] Bare concrete... on every side.",
    file: "02.mp3",
    seconds: 2.05,
    words: 5,
    aligned: true,
    tries: [],
  },
  {
    id: "03",
    t: 13.2,
    text: "[slow, steady] Bolted to the floor... a steel desk. [whispering] One chair.",
    voice: "ZaZosYpkIGmSqOwAlfnk",
    file: "03.mp3",
    seconds: 3.7,
    words: 10,
    aligned: true,
    tries: [],
  },
];

const VOICE_BASE = [
  {
    s: 4.3,
    e: 5.155,
    text: "He opens his eyes.",
    words: [
      { w: "He", s: 4.3, e: 4.45 },
      { w: "opens", s: 4.48, e: 4.76 },
      { w: "his", s: 4.78, e: 4.91 },
      { w: "eyes.", s: 4.93, e: 5.155 },
    ],
  },
  {
    s: 9.2,
    e: 11.065,
    text: "Bare concrete... on every side.",
    words: [
      { w: "Bare", s: 9.2, e: 9.52 },
      { w: "concrete...", s: 9.55, e: 10.18 },
      { w: "on", s: 10.35, e: 10.5 },
      { w: "every", s: 10.52, e: 10.78 },
      { w: "side.", s: 10.8, e: 11.065 },
    ],
  },
  {
    s: 13.2,
    e: 16.701,
    text: "Bolted to the floor... a steel desk. One chair.",
    words: [
      { w: "Bolted", s: 13.2, e: 13.55 },
      { w: "to", s: 13.56, e: 13.68 },
      { w: "the", s: 13.69, e: 13.8 },
      { w: "floor...", s: 13.82, e: 14.3 },
      { w: "a", s: 14.5, e: 14.58 },
      { w: "steel", s: 14.6, e: 14.92 },
      { w: "desk.", s: 14.95, e: 15.4 },
      { w: "One", s: 15.9, e: 16.2 },
      { w: "chair.", s: 16.22, e: 16.701 },
    ],
  },
];

describe("parseTakeScript & voiceActorTitle", () => {
  test("extracts ElevenLabs [audio tags] in order and strips them from spoken transcript", () => {
    assert.deepEqual(parseTakeScript("[low, quiet, waking up] He opens his eyes."), {
      tags: ["low, quiet, waking up"],
      spoken: "He opens his eyes.",
    });
    assert.deepEqual(
      parseTakeScript("[slow, steady] Bolted to the floor... [whispering] One chair."),
      { tags: ["slow, steady", "whispering"], spoken: "Bolted to the floor... One chair." },
    );
    assert.deepEqual(parseTakeScript("Plain narration without delivery tags."), {
      tags: [],
      spoken: "Plain narration without delivery tags.",
    });
    // Long (>80 char) ElevenLabs acting directions from cell-break (pa_clara) must not leak raw brackets into spoken text
    assert.deepEqual(
      parseTakeScript(
        "[cold, flat automated public-address announcement echoing through a stone fortress] Warning. Reboot forbidden.",
      ),
      {
        tags: ["cold, flat automated public-address announcement echoing through a stone fortress"],
        spoken: "Warning. Reboot forbidden.",
      },
    );
    assert.equal(shortTryLabel("01", "01_orig.mp3"), "Original");
    assert.equal(shortTryLabel("01", "01_2.wav"), "Try 2");
  });

  test("maps known cast voice IDs to readable actor names and shortens unknown IDs", () => {
    assert.equal(voiceActorTitle(undefined), "Seff Echo");
    assert.equal(voiceActorTitle("ZaZosYpkIGmSqOwAlfnk"), "Seff Echo");
    assert.equal(voiceActorTitle("99Hm6N8psCBzc1JwEVR2"), "Riley");
    assert.equal(voiceActorTitle("FyrYFW3P9GUxA348YGWu"), "Madison");
    assert.equal(voiceActorTitle("mJ5wtH88WGlTud22bihm"), "Kathryn");
    assert.equal(voiceActorTitle("no52gq1ZwK7Lmejv1EHz"), "Clara");
    assert.equal(voiceActorTitle("bAq8AI9QURijOtmeFFqT"), "Sigma");
    assert.equal(voiceActorTitle("AbCdEfGhIjKlMnOpQrSt"), "Voice · AbCdEf");
  });

  test("filters voiceover takes by take ID, spoken transcript, acting tags, or actor name", () => {
    assert.deepEqual(
      filterVoiceTakes(TAKES, "concrete").map((t) => t.id),
      ["02"],
    );
    assert.deepEqual(
      filterVoiceTakes(TAKES, "whispering").map((t) => t.id),
      ["03"],
    );
    assert.deepEqual(
      filterVoiceTakes(TAKES, "01").map((t) => t.id),
      ["01"],
    );
    assert.deepEqual(
      filterVoiceTakes(TAKES, "seff echo").map((t) => t.id),
      ["01", "02", "03"],
    );
  });
});

describe("voiceClipSummary, voiceClipLabel & phraseBrickWindows", () => {
  test("labels a single-take phrase brick with take ID and clean spoken text", () => {
    const brick = {
      at: 4.22,
      start: 4.22,
      length: 1.1,
      name: "narration",
      gain: 0,
      dialogue: true,
    };
    assert.equal(voiceClipLabel(brick, 30, VOICE_BASE, TAKES), "01 · He opens his eyes.");

    const summary = voiceClipSummary(brick, 30, VOICE_BASE, TAKES);
    assert.equal(summary.matches.length, 1);
    assert.equal(summary.matches[0].id, "01");
    assert.deepEqual(summary.matches[0].tags, ["low, quiet, waking up"]);
    assert.equal(summary.matches[0].spoken, "He opens his eyes.");
    assert.ok(summary.wpm !== null && summary.wpm > 100);
  });

  test("labels split sub-phrase bricks with the exact sliced words and preserves timing source mapping", () => {
    // Blade split after "steel desk." at 15.6s
    const rightHalf = {
      at: 21.6,
      start: 21.6,
      length: 1.3,
      name: "narration",
      gain: 0,
      __timing: {
        source: { at: 15.6, start: 15.6, name: "narration", gain: 0 },
        duration: 1.3,
        timeline: [],
      },
    };
    assert.equal(voiceClipLabel(rightHalf, 30, VOICE_BASE, TAKES), "03 · One chair.");
    // Slices with fewer than 4 words omit WPM to match timeline.ts paceOf house convention
    const subSummary = voiceClipSummary(rightHalf, 30, VOICE_BASE, TAKES);
    assert.equal(subSummary.wordCount, 2);
    assert.equal(subSummary.wpm, null);

    const threeWordLine = [
      {
        s: 1.0,
        e: 2.2,
        text: "Wait right here.",
        words: [
          { w: "Wait", s: 1.0, e: 1.3 },
          { w: "right", s: 1.4, e: 1.7 },
          { w: "here.", s: 1.8, e: 2.2 },
        ],
      },
    ];
    const threeSummary = voiceClipSummary(
      { at: 1, start: 1, length: 1.5, name: "narration" },
      10,
      threeWordLine,
      [],
    );
    assert.equal(threeSummary.wordCount, 3);
    assert.equal(threeSummary.wpm, null);
  });

  test("summarizes monolithic multi-take narration clips without counting silent B-roll gaps in WPM", () => {
    const full = { at: 0, start: 0, length: 30, name: "narration", gain: 0, dialogue: true };
    assert.equal(
      voiceClipLabel(full, 30, VOICE_BASE, TAKES),
      "Voiceover (3 takes) · He opens his eyes.",
    );

    // VOICE_BASE has 4.045s + 2.135s silent gaps between takes; WPM must measure spoken articulation (~173 WPM), never <130 WPM
    const fullSummary = voiceClipSummary(full, 30, VOICE_BASE, TAKES);
    assert.equal(fullSummary.wordCount, 18);
    assert.ok(
      fullSummary.wpm !== null && fullSummary.wpm >= 150 && fullSummary.wpm <= 220,
      `expected spoken WPM 150..220, got ${fullSummary.wpm}`,
    );

    const silentTail = { at: 20, start: 20, length: 5, name: "narration", gain: 0 };
    assert.equal(voiceClipLabel(silentTail, 30, VOICE_BASE, TAKES), "Voiceover (silence)");

    // Tight adjacent lines must never produce overlapping phrase brick windows
    const tightLines = [
      { s: 4.3, e: 5.15 },
      { s: 5.25, e: 7.0 },
      { s: 10.0, e: 12.4 },
    ];
    const wins = phraseBrickWindows([0, 20], tightLines);
    assert.equal(wins.length, 3);
    for (let i = 0; i < wins.length; i++) {
      assert.ok(wins[i][0] <= tightLines[i].s);
      assert.ok(wins[i][1] >= tightLines[i].e);
      if (i > 0)
        assert.ok(wins[i][0] >= wins[i - 1][1], `window ${i} must not overlap previous window`);
    }
  });

  test("sliceNarrationClip slices in source coordinates without freeze/speed truncation and ignores sibling clips", () => {
    const takes4 = [
      ...TAKES,
      {
        id: "04",
        t: 21.5,
        text: "[low] And at the far end of the room... a heavy steel door.",
        file: "04.mp3",
        seconds: 2.9,
        words: 12,
        aligned: true,
        tries: [],
      },
    ];
    const base4 = [
      ...VOICE_BASE,
      {
        s: 21.5,
        e: 24.177,
        text: "And at the far end of the room... a heavy steel door.",
        words: [
          { w: "And", s: 21.5, e: 21.65 },
          { w: "at", s: 21.67, e: 21.78 },
          { w: "the", s: 21.8, e: 21.9 },
          { w: "far", s: 21.92, e: 22.15 },
          { w: "end", s: 22.18, e: 22.4 },
          { w: "of", s: 22.42, e: 22.52 },
          { w: "the", s: 22.54, e: 22.65 },
          { w: "room...", s: 22.68, e: 23.1 },
          { w: "a", s: 23.3, e: 23.4 },
          { w: "heavy", s: 23.42, e: 23.7 },
          { w: "steel", s: 23.72, e: 23.95 },
          { w: "door.", s: 23.97, e: 24.177 },
        ],
      },
    ];

    // Reproduce sealed-room's exact 4.23x speed + 3s freeze right at 24.375s (198ms after Take 04 ends)
    const clock = compileTiming(
      { speeds: [{ from: 6.5, to: 27, rate: 4.23 }], freezes: [{ at: 24.375, duration: 3 }] },
      30,
    );
    const sourceDoc = {
      narration: "narration",
      beds: [],
      sfx: [
        { at: 0, name: "narration", gain: -1.5, track: "voice" },
        // Sibling duplicate narration brick on another track must NOT pollute slicing of sfx[0]
        { at: 26, start: 4.3, length: 1.0, name: "narration", gain: 0, track: "t2" },
      ],
      tracks: [
        { id: "voice", name: "Voice" },
        { id: "t2", name: "SFX" },
      ],
    };

    const bricks = sliceNarrationClip(sourceDoc.sfx[0], 30, base4);
    assert.equal(bricks.length, 4);
    sourceDoc.sfx.splice(0, 1, ...bricks);

    const projected = mapTimeline("sound", sourceDoc, clock, false, null, { narration: 30 });
    assert.equal(
      voiceClipLabel(projected.sfx[3], 30, base4, takes4),
      "04 · And at the far end of the room... a heavy steel door.",
    );
    const summary04 = voiceClipSummary(projected.sfx[3], 30, base4, takes4);
    assert.equal(summary04.wordCount, 12);
  });

  test("findTakeLineIndex + narrationLines resolves moved/split bricks and returns empty when a brick is deleted", () => {
    const clock = compileTiming({}, 30);
    const bricks = sliceNarrationClip(
      { at: 0, name: "narration", gain: 0, track: "voice" },
      30,
      VOICE_BASE,
    );
    assert.equal(bricks.length, 3);

    // Delete Take 01 brick and move Take 03 brick BEFORE Take 02 brick on the timeline
    const editedDoc = {
      narration: "narration",
      beds: [],
      sfx: [
        { ...bricks[2], at: 2.0 }, // Take 03 moved to 2.0s
        bricks[1], // Take 02 stays around 9.12s
      ],
      tracks: [{ id: "voice", name: "Voice" }],
    };

    const idx01 = findTakeLineIndex("01", VOICE_BASE, TAKES);
    assert.equal(idx01, 0);
    const out01 = mapVoice(narrationLines([VOICE_BASE[idx01]], editedDoc, 30), clock);
    assert.equal(out01.length, 0, "deleted brick 01 must not resolve to brick 02 or 03");

    const idx02 = findTakeLineIndex("02", VOICE_BASE, TAKES);
    const out02 = mapVoice(narrationLines([VOICE_BASE[idx02]], editedDoc, 30), clock);
    assert.equal(out02.length, 1);
    assert.ok(Math.abs(out02[0].s - 9.2) < 0.05, `expected Take 02 near 9.2s, got ${out02[0].s}`);

    const idx03 = findTakeLineIndex("03", VOICE_BASE, TAKES);
    const out03 = mapVoice(narrationLines([VOICE_BASE[idx03]], editedDoc, 30), clock);
    assert.equal(out03.length, 1);
    assert.ok(
      out03[0].s >= 2.0 && out03[0].s < 2.2,
      `expected reordered Take 03 near 2.08s, got ${out03[0].s}`,
    );
  });

  test("resizeNarrationBrickForSwap extends a single-take phrase brick, clamps to neighbor on same track, and ignores monolithic stems", () => {
    const swap = { takeId: "01", prevStart: 4.2, prevEnd: 5.32, nextStart: 4.2, nextEnd: 6.4 };

    // 1. Phrase brick with plenty of room before Take 02 at 9.12s expands cleanly to fit 6.4s
    const roomy = {
      narration: "narration",
      beds: [],
      sfx: [
        {
          at: 4.22,
          start: 4.22,
          length: 1.115,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
        {
          at: 9.12,
          start: 9.12,
          length: 2.045,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
      ],
      tracks: [{ id: "voice", name: "Voice" }],
    };
    assert.equal(resizeNarrationBrickForSwap(roomy, swap, VOICE_BASE), true);
    assert.equal(roomy.sfx[0].start, 4.22);
    assert.equal(roomy.sfx[0].length, 2.18);
    assert.equal(roomy.sfx[1].at, 9.12);

    // 2. Phrase brick with neighbor pulled up to 5.8s on same track clamps at 5.795s so clips never overlap
    const tight = {
      narration: "narration",
      beds: [],
      sfx: [
        {
          at: 4.22,
          start: 4.22,
          length: 1.115,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
        {
          at: 5.8,
          start: 9.12,
          length: 2.045,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
      ],
      tracks: [{ id: "voice", name: "Voice" }],
    };
    assert.equal(resizeNarrationBrickForSwap(tight, swap, VOICE_BASE), true);
    assert.equal(tight.sfx[0].length, 1.575);

    // 3. Monolithic multi-take stem clip is untouched
    const stem = {
      narration: "narration",
      beds: [],
      sfx: [{ at: 0, start: 0, name: "narration", gain: 0, track: "voice" }],
      tracks: [{ id: "voice", name: "Voice" }],
    };
    assert.equal(resizeNarrationBrickForSwap(stem, swap, VOICE_BASE), false);
    assert.equal(stem.sfx[0].length, undefined);

    // 4. Radio-Edit-First multi-span shift: pristine Brick 2 ripples forward in both at & start; hand-dragged Brick 3 keeps at & updates start
    const radioBase = [
      { s: 0.05, e: 0.72, text: "He wakes.", words: [] },
      { s: 1.25, e: 2.0, text: "Bare stone.", words: [] },
      { s: 2.55, e: 3.2, text: "No door.", words: [] },
    ];
    const radioSpans = [
      { takeId: "01", prevStart: 0, prevEnd: 0.8, nextStart: 0, nextEnd: 2.2 },
      { takeId: "02", prevStart: 1.2, prevEnd: 2.1, nextStart: 2.6, nextEnd: 3.5 },
      { takeId: "03", prevStart: 2.5, prevEnd: 3.3, nextStart: 3.9, nextEnd: 4.7 },
    ];
    const radioDoc = {
      narration: "narration",
      beds: [],
      sfx: [
        {
          at: 0,
          start: 0,
          length: 0.8,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
        {
          at: 1.2,
          start: 1.2,
          length: 0.9,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
        {
          at: 6.5,
          start: 2.5,
          length: 0.8,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        }, // hand-dragged to 6.5s!
      ],
      tracks: [{ id: "voice", name: "Voice" }],
    };
    assert.equal(resizeNarrationBrickForSwap(radioDoc, radioSpans, radioBase), true);
    assert.deepEqual(
      radioDoc.sfx.map((c) => ({ at: c.at, start: c.start, length: c.length })),
      [
        { at: 0, start: 0, length: 2.2 },
        { at: 2.6, start: 2.6, length: 0.9 },
        { at: 6.5, start: 3.9, length: 0.8 },
      ],
    );

    // 5. Same-track non-overlap when Take 1 was hand-moved (at=0.8) and shrinks while pristine Brick 2 tries to shift backward,
    // AND when a downstream SFX clip sits closer than origLength!
    const shrinkSpans = [
      { takeId: "01", prevStart: 0, prevEnd: 2.0, nextStart: 0, nextEnd: 1.0 },
      { takeId: "02", prevStart: 3.0, prevEnd: 4.5, nextStart: 1.2, nextEnd: 2.7 },
    ];
    const shrinkDoc = {
      narration: "narration",
      beds: [],
      sfx: [
        {
          at: 0.8,
          start: 0,
          length: 2.0,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        }, // hand-moved to 0.8s!
        {
          at: 3.0,
          start: 3.0,
          length: 1.5,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        }, // pristine at 3.0s
        { at: 3.1, length: 0.4, name: "door_thud", gain: 0, track: "voice" }, // downstream SFX clamps Brick 2
      ],
      tracks: [{ id: "voice", name: "Voice" }],
    };
    assert.equal(resizeNarrationBrickForSwap(shrinkDoc, shrinkSpans, []), true);
    assert.equal(shrinkDoc.sfx[0].at, 0.8);
    assert.equal(shrinkDoc.sfx[0].length, 1.0);
    assert.ok(
      shrinkDoc.sfx[1].at >= shrinkDoc.sfx[0].at + shrinkDoc.sfx[0].length + 0.005,
      `Brick 2 (${shrinkDoc.sfx[1].at}) must not overlap hand-moved Brick 1 ending at ${shrinkDoc.sfx[0].at + shrinkDoc.sfx[0].length}`,
    );
    assert.ok(
      shrinkDoc.sfx[1].at + shrinkDoc.sfx[1].length <= shrinkDoc.sfx[2].at - 0.004,
      `Brick 2 ending at ${shrinkDoc.sfx[1].at + shrinkDoc.sfx[1].length} must clamp before door_thud at ${shrinkDoc.sfx[2].at}`,
    );

    // 6. UI-split Phrase Brick with >0.38s leading breath matches via prevSpokenStart/prevSpokenEnd
    const breathSpan = {
      takeId: "01",
      prevStart: 0,
      prevEnd: 2.2,
      prevSpokenStart: 0.65,
      prevSpokenEnd: 2.0,
      nextStart: 0,
      nextEnd: 1.4,
    };
    const breathDoc = {
      narration: "narration",
      beds: [],
      sfx: [
        {
          at: 0.57,
          start: 0.57,
          length: 1.61,
          name: "narration",
          gain: 0,
          dialogue: true,
          track: "voice",
        },
      ],
      tracks: [{ id: "voice", name: "Voice" }],
    };
    assert.equal(resizeNarrationBrickForSwap(breathDoc, breathSpan, []), true);
    assert.equal(breathDoc.sfx[0].start, 0);
    assert.equal(breathDoc.sfx[0].length, 1.4);
  });

  test("pairLinesWithTakes matches Radio-Edit-First takes by spoken text when a new take is inserted before reassembly, and maps Jake & True voices", () => {
    assert.equal(voiceActorTitle("ev2kMR9ZJZZsemuogS5u"), "Jake");
    assert.equal(voiceActorTitle("tZssYepgGaQmegsMEXjK"), "True");

    // Radio-Edit-First: 00_hook was just generated (aligned: true, omitted t) before assemble.ts rebuilt voiceBase!
    const radioTakes = [
      {
        id: "00_hook",
        text: "[whispering] Nobody ever leaves.",
        voice: "ev2kMR9ZJZZsemuogS5u",
        file: "00_hook.mp3",
        seconds: 1.1,
        words: 3,
        aligned: true,
        tries: [],
      },
      {
        id: "01",
        text: "[low, quiet, waking up] He opens his eyes.",
        file: "01.mp3",
        seconds: 1.12,
        words: 4,
        aligned: true,
        tries: ["01_1.mp3"],
      },
      {
        id: "02",
        text: "[uneasy, hushed] Bare concrete... on every side.",
        voice: "tZssYepgGaQmegsMEXjK",
        file: "02.mp3",
        seconds: 2.05,
        words: 5,
        aligned: true,
        tries: [],
      },
    ];
    const twoLineBase = VOICE_BASE.slice(0, 2);

    assert.equal(
      findTakeLineIndex("00_hook", twoLineBase, radioTakes),
      -1,
      "un-assembled 00_hook must not steal line 0",
    );
    assert.equal(findTakeLineIndex("01", twoLineBase, radioTakes), 0);
    assert.equal(findTakeLineIndex("02", twoLineBase, radioTakes), 1);

    const summary01 = voiceClipSummary(
      { name: "narration", at: 4.2, start: 4.2, length: 1.1 },
      30,
      twoLineBase,
      radioTakes,
    );
    assert.equal(summary01.matches[0]?.id, "01");
    const summary02 = voiceClipSummary(
      { name: "narration", at: 9.1, start: 9.1, length: 2.1 },
      30,
      twoLineBase,
      radioTakes,
    );
    assert.equal(summary02.matches[0]?.id, "02");
    assert.equal(summary02.matches[0]?.voiceTitle, "True");
  });
});
