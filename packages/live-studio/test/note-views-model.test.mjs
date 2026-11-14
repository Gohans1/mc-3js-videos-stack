import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  boardTransition,
  buildCalendarMonth,
  buildChartStats,
  buildDonutBuckets,
  buildShotFilterOptions,
  buildTimelineLanes,
  calendarStatusBreakdown,
  combineFilteredNotes,
  countNoteFacets,
  EXTRA_NOTE_VIEWS,
  formatShortDate,
  groupNotesByShot,
  isExtraNoteView,
  latestNoteActivityMs,
  latestNoteMonth,
  localDateKey,
  matchesNoteFilters,
  NOTE_VIEWS,
  packTimelineRows,
  PRIMARY_NOTE_VIEWS,
  sortPlacedNotes,
  sortTableItems,
  summarizeNoteThread,
  timelineMinPillPct,
} from "../app/notes/note-views-model.ts";

const makePlaced = (id, t, shot, over = {}) => {
  const n = {
    id,
    at: over.at ?? "2026-11-10T10:00:00.000Z",
    t,
    time: `0:${String(Math.floor(t)).padStart(2, "0")}.000`,
    frame: Math.round(t * 60),
    shot,
    shotName: over.shotName,
    text: over.text ?? `Note ${id}`,
    done: over.done ?? false,
    state: over.state,
    fixes: over.fixes,
    asks: over.asks,
    span: over.span,
  };
  return { n, t, span: over.span ?? null, words: `${n.text}` };
};

describe("note-views-model", () => {
  test("includes all Notion view types", () => {
    assert.deepEqual(NOTE_VIEWS, [
      "cards",
      "board",
      "table",
      "list",
      "gallery",
      "timeline",
      "calendar",
      "feed",
      "chart",
    ]);
  });

  test("combineFilteredNotes preserves check, open, done buckets cleanly", () => {
    const c = makePlaced("c1", 5, 1, { state: "check" });
    const o = makePlaced("o1", 2, 0, { state: "open" });
    const d = makePlaced("d1", 9, 2, { state: "done", done: true });
    const combined = combineFilteredNotes({ check: [c], open: [o], done: [d] });
    assert.deepEqual(
      combined.map((x) => [x.n.id, x.state]),
      [
        ["c1", "check"],
        ["o1", "open"],
        ["d1", "done"],
      ],
    );
  });

  test("boardTransition enforces note-state rules strictly", () => {
    assert.equal(boardTransition("check", "done", false), "approve");
    assert.equal(boardTransition("check", "done", true), null);
    assert.equal(boardTransition("check", "open", false), "feedback");
    assert.equal(boardTransition("done", "open", false), "reopen");
    assert.equal(boardTransition("open", "done", false), null);
    assert.equal(boardTransition("open", "check", false), null);
    assert.equal(boardTransition("done", "check", false), null);
    assert.equal(boardTransition("check", "check", false), null);
  });

  test("groupNotesByShot groups and sorts notes within each shot by time", () => {
    const items = combineFilteredNotes({
      check: [makePlaced("a", 12, 3, { shotName: "door" })],
      open: [makePlaced("b", 4, 1), makePlaced("c", 9, 3, { shotName: "door" })],
      done: [],
    });
    const groups = groupNotesByShot(items);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].shot, 1);
    assert.deepEqual(
      groups[1].items.map((x) => x.n.id),
      ["c", "a"],
    );
  });

  test("sortTableItems sorts deterministically by status, time, and created", () => {
    const items = combineFilteredNotes({
      check: [makePlaced("c", 20, 2, { at: "2026-11-12T10:00:00.000Z" })],
      open: [makePlaced("o", 5, 0, { at: "2026-11-14T10:00:00.000Z" })],
      done: [makePlaced("d", 10, 1, { at: "2026-11-11T10:00:00.000Z", done: true })],
    });
    assert.deepEqual(
      sortTableItems(items, "time", "asc").map((x) => x.n.id),
      ["o", "d", "c"],
    );
    assert.deepEqual(
      sortTableItems(items, "status", "asc").map((x) => x.n.id),
      ["c", "o", "d"],
    );
    assert.deepEqual(
      sortTableItems(items, "created", "desc").map((x) => x.n.id),
      ["o", "c", "d"],
    );
  });

  test("buildTimelineLanes computes spans and extends duration past last note if needed", () => {
    const items = combineFilteredNotes({
      check: [],
      open: [makePlaced("p", 3, 0), makePlaced("r", 10, 2, { span: [10, 24] })],
      done: [],
    });
    const tl = buildTimelineLanes(items, 16);
    assert.equal(tl.duration, 24);
    assert.equal(tl.lanes.length, 2);
    assert.equal(tl.lanes[0].items[0].isRange, false);
    assert.equal(tl.lanes[1].items[0].isRange, true);
  });

  test("calendar helpers generate 6x7 Monday-first month grid with latestNoteMonth", () => {
    const items = combineFilteredNotes({
      check: [makePlaced("n1", 2, 0, { at: "2026-10-15T12:00:00.000Z" })],
      open: [makePlaced("n2", 5, 1, { at: "2026-10-15T14:00:00.000Z" })],
      done: [],
    });
    const latest = latestNoteMonth(items, new Date(2026, 0, 1));
    assert.deepEqual(latest, { year: 2026, month: 9 });
    const cells = buildCalendarMonth(2026, 9, items, new Date(2026, 9, 15));
    assert.equal(cells.length, 42);
    const oct15 = cells.find((c) => c.key === localDateKey("2026-10-15T12:00:00.000Z"));
    assert.ok(oct15);
    assert.equal(oct15.items.length, 2);
    assert.equal(oct15.isToday, true);
  });

  test("buildChartStats aggregates status, asks, shots, and days", () => {
    const items = combineFilteredNotes({
      check: [
        makePlaced("c1", 2, 1, {
          state: "check",
          fixes: [{ what: "Check?", ask: true, at: "2026-11-10T11:00:00Z" }],
        }),
      ],
      open: [makePlaced("o1", 4, 1)],
      done: [makePlaced("d1", 8, 2, { done: true })],
    });
    const stats = buildChartStats(items);
    assert.equal(stats.total, 3);
    assert.deepEqual(stats.counts, { check: 1, open: 1, done: 1 });
    assert.equal(stats.asks, 1);
    assert.equal(stats.byShot[0].label, "Shot 1");
    assert.equal(stats.byShot[0].total, 2);
  });

  test("packTimelineRows stacks nearby notes onto non-overlapping sub-lanes", () => {
    const items = combineFilteredNotes({
      check: [],
      open: [makePlaced("a", 40, 5), makePlaced("b", 40.5, 5), makePlaced("c", 90, 5)],
      done: [],
    });
    const { lanes, duration } = buildTimelineLanes(items, 100);
    const { rows, packed } = packTimelineRows(lanes[0].items, duration, 24);
    assert.equal(rows, 2);
    assert.equal(packed[0].row, 0);
    assert.equal(packed[1].row, 1);
    assert.equal(packed[2].row, 0);
    assert.ok(packed[2].leftPct <= 76);
  });

  test("packTimelineRows never overlaps range pills near film end", () => {
    const items = [
      {
        p: makePlaced("a", 95, 1, { state: "open" }),
        startSec: 95,
        endSec: 98,
        isRange: true,
      },
      {
        p: makePlaced("b", 97, 1, { state: "check" }),
        startSec: 97,
        endSec: 99,
        isRange: true,
      },
    ];
    const { packed } = packTimelineRows(items, 100, 12);
    assert.equal(packed[0].widthPct, 12);
    assert.equal(packed[0].row, 0);
    assert.equal(packed[1].row, 1);
    assert.ok(packed[0].leftPct + packed[0].widthPct <= 100.01);
    assert.ok(packed[1].leftPct + packed[1].widthPct <= 100.01);
  });
});

describe("formatShortDate", () => {
  test("formats valid dates and returns empty string for malformed or empty input", () => {
    assert.match(formatShortDate("2026-11-10T10:00:00.000Z"), /^[A-Z][a-z]{2} \d{1,2}$/);
    assert.equal(formatShortDate(""), "");
    assert.equal(formatShortDate(null), "");
    assert.equal(formatShortDate(undefined), "");
    assert.equal(formatShortDate("not-a-date"), "");
    assert.equal(formatShortDate({ bad: true }), "");
  });
});

describe("timelineMinPillPct", () => {
  test("scales minimum pill percentage inversely with rendered track width and zoom", () => {
    const narrow = timelineMinPillPct(280, 1);
    const zoomed = timelineMinPillPct(560, 2);
    assert.ok(narrow > zoomed);
    assert.ok(zoomed >= 4 && zoomed <= 48);
    assert.equal(timelineMinPillPct(0, 1), 22);
  });
});

describe("buildDonutBuckets", () => {
  const withState = (id, t, shot, state) => ({ ...makePlaced(id, t, shot, { state }), state });

  test("folds shots beyond primary slices into an Other bucket preserving total count", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      withState(`n-${i}`, i * 2 + 1, i + 1, i % 2 === 0 ? "open" : "done"),
    );
    const stats = buildChartStats(items);
    const buckets = buildDonutBuckets(stats.byShot, 5);
    assert.equal(buckets.length, 6);
    assert.equal(buckets.at(-1).key, "shot:other");
    assert.equal(buckets.at(-1).total, 3);
    const sum = buckets.reduce((acc, b) => acc + b.total, 0);
    assert.equal(sum, stats.total);
  });

  test("returns slices directly without Other when shot count fits maxPrimary", () => {
    const items = [withState("a", 1, 1, "open"), withState("b", 2, 2, "done")];
    const stats = buildChartStats(items);
    const buckets = buildDonutBuckets(stats.byShot, 5);
    assert.equal(buckets.length, 2);
  });
});

describe("calendarStatusBreakdown", () => {
  const withState = (id, t, shot, state) => ({ ...makePlaced(id, t, shot, { state }), state });

  test("counts check, open, and done notes for accessible day cell indicators", () => {
    const counts = calendarStatusBreakdown([
      withState("a", 1, 1, "check"),
      withState("b", 2, 1, "open"),
      withState("c", 3, 1, "open"),
      withState("d", 4, 1, "done"),
    ]);
    assert.deepEqual(counts, { check: 1, open: 2, done: 1 });
  });
});

describe("note view switcher partitioning", () => {
  test("limits primary tabs to <=4 and partitions all NOTE_VIEWS with zero gaps", () => {
    assert.ok(PRIMARY_NOTE_VIEWS.length <= 4);
    const merged = [...PRIMARY_NOTE_VIEWS, ...EXTRA_NOTE_VIEWS];
    assert.equal(new Set(merged).size, NOTE_VIEWS.length);
    assert.deepEqual(merged.toSorted(), [...NOTE_VIEWS].toSorted());
    assert.equal(isExtraNoteView("cards"), false);
    assert.equal(isExtraNoteView("table"), true);
    assert.equal(isExtraNoteView("chart"), true);
  });
});

describe("latestNoteActivityMs", () => {
  test("returns the maximum timestamp across note creation, fixes, asks, edits, approval, and learned", () => {
    const base = { at: "2026-11-10T10:00:00.000Z" };
    assert.equal(latestNoteActivityMs(base), Date.parse("2026-11-10T10:00:00.000Z"));

    const afterFixAndAsk = {
      at: "2026-11-10T10:00:00.000Z",
      fixes: [{ what: "Fixed lighting", at: "2026-11-10T11:00:00.000Z" }],
      asks: [{ text: "Left wall still dark", at: "2026-11-10T12:30:00.000Z" }],
    };
    assert.equal(latestNoteActivityMs(afterFixAndAsk), Date.parse("2026-11-10T12:30:00.000Z"));

    const afterLearn = {
      ...afterFixAndAsk,
      approved: "2026-11-10T13:00:00.000Z",
      learned: { what: "Watch wall brightness", scope: "film", at: "2026-11-10T14:15:00.000Z" },
    };
    assert.equal(latestNoteActivityMs(afterLearn), Date.parse("2026-11-10T14:15:00.000Z"));

    const afterEdit = {
      ...afterFixAndAsk,
      edits: [{ was: "Old wording", at: "2026-11-10T15:00:00.000Z" }],
    };
    assert.equal(latestNoteActivityMs(afterEdit), Date.parse("2026-11-10T15:00:00.000Z"));

    assert.equal(latestNoteActivityMs({ at: "not-a-date" }), 0);
  });
});

describe("summarizeNoteThread", () => {
  test("surfaces active fix in check/done and excludes it cleanly from prior history", () => {
    const f1 = { what: "First pass", at: "2026-11-10T11:00:00.000Z" };
    const a1 = { text: "Still clipping", at: "2026-11-10T12:00:00.000Z" };
    const f2 = { what: "Lowered gain", at: "2026-11-10T13:00:00.000Z" };
    const note = {
      text: "Fix door sound",
      at: "2026-11-10T10:00:00.000Z",
      fixes: [f1, f2],
      asks: [a1],
      edits: [{ was: "Door too loud", at: "2026-11-10T10:30:00.000Z" }],
    };
    const checkSummary = summarizeNoteThread(note, "check");
    assert.equal(checkSummary.activeFix, f2);
    assert.equal(checkSummary.activeAsk, null);
    assert.deepEqual(
      checkSummary.prior.map((p) => [p.by, p.text, !!p.reworded]),
      [
        ["creator", "Door too loud", true],
        ["ai", "First pass", false],
        ["creator", "Still clipping", false],
      ],
    );

    const doneSummary = summarizeNoteThread(note, "done");
    assert.equal(doneSummary.activeFix, f2);
    assert.equal(doneSummary.prior.length, 3);
  });

  test("surfaces newer Needs-work ask outside history on open notes and moves superseded fix into prior", () => {
    const f1 = { what: "Adjusted exposure", at: "2026-11-10T11:00:00.000Z" };
    const a1 = { text: "Left wall still too dark", at: "2026-11-10T12:00:00.000Z" };
    const note = {
      text: "Brighten hallway",
      at: "2026-11-10T10:00:00.000Z",
      fixes: [f1],
      asks: [a1],
    };
    const openSummary = summarizeNoteThread(note, "open");
    assert.equal(openSummary.activeAsk, a1);
    assert.equal(openSummary.activeFix, null);
    assert.deepEqual(
      openSummary.prior.map((p) => [p.by, p.text]),
      [["ai", "Adjusted exposure"]],
    );
  });

  test("keeps lastFix as activeFix without duplicating in prior when reopened without a newer ask", () => {
    const f1 = { what: "Retimed walk", at: "2026-11-10T11:00:00.000Z" };
    const note = {
      text: "Sync footsteps",
      at: "2026-11-10T10:00:00.000Z",
      fixes: [f1],
    };
    const reopened = summarizeNoteThread(note, "open");
    assert.equal(reopened.activeAsk, null);
    assert.equal(reopened.activeFix, f1);
    assert.equal(reopened.prior.length, 0);
  });

  test("never drops identical-timestamp earlier entries when filtering active items", () => {
    const ts = "2026-11-10T11:00:00.000Z";
    const f1 = { what: "Fix one", at: ts };
    const f2 = { what: "Fix one", at: ts };
    const note = { text: "Clip", at: "2026-11-10T10:00:00.000Z", fixes: [f1, f2] };
    const res = summarizeNoteThread(note, "check");
    assert.equal(res.activeFix, f2);
    assert.equal(res.prior.length, 1);
    assert.equal(res.prior[0].text, "Fix one");
  });
});

describe("note filter & sort helpers", () => {
  const mk = (id, state, over = {}) => ({
    ...makePlaced(id, over.t ?? 2, over.shot ?? 0, over),
    state,
    span: over.span ?? null,
    n: {
      ...makePlaced(id, over.t ?? 2, over.shot ?? 0, over).n,
      pin: over.pin,
      refs: over.refs,
      freeCam: over.freeCam,
      remember: over.remember,
      learned: over.learned,
      fixes: over.fixes,
      asks: over.asks,
    },
  });

  test("matchesNoteFilters filters by scope shot, explicit shot, and orthogonal facets", () => {
    const pOpenDrawn = mk("n1", "open", {
      shot: 2,
      shotName: "Hallway",
      span: [1, 2],
      pin: { what: "door" },
    });
    const pNeedsWork = mk("n2", "open", {
      shot: 2,
      fixes: [{ what: "Fixed", at: "2026-11-10T11:00:00.000Z" }],
      asks: [{ text: "Still dark", at: "2026-11-10T12:00:00.000Z" }],
      refs: ["ref.png"],
    });
    const pAsk = mk("n3", "check", {
      shot: 4,
      freeCam: true,
      fixes: [{ what: "Which angle?", ask: true, at: "2026-11-10T13:00:00.000Z" }],
      learned: { what: "Keep bright", scope: "film", at: "2026-11-10T14:00:00.000Z" },
    });
    const pReady = mk("n4", "check", {
      shot: 4,
      fixes: [{ what: "Adjusted gamma", at: "2026-11-10T15:00:00.000Z" }],
    });

    assert.equal(
      matchesNoteFilters(pOpenDrawn, { scope: "shot", currentShot: 2, shot: null, facets: [] }),
      true,
    );
    assert.equal(
      matchesNoteFilters(pOpenDrawn, { scope: "shot", currentShot: 4, shot: null, facets: [] }),
      false,
    );
    assert.equal(
      matchesNoteFilters(pNeedsWork, {
        scope: "all",
        currentShot: -1,
        shot: 2,
        facets: ["needsWork", "refs"],
      }),
      true,
    );
    assert.equal(
      matchesNoteFilters(pOpenDrawn, {
        scope: "all",
        currentShot: -1,
        shot: null,
        facets: ["needsWork"],
      }),
      false,
    );
    assert.equal(
      matchesNoteFilters(pAsk, {
        scope: "all",
        currentShot: -1,
        shot: null,
        facets: ["asking", "freeCam", "learned"],
      }),
      true,
    );
    assert.equal(
      matchesNoteFilters(pReady, {
        scope: "all",
        currentShot: -1,
        shot: null,
        facets: ["readyFix"],
      }),
      true,
    );
    assert.equal(
      matchesNoteFilters(pAsk, { scope: "all", currentShot: -1, shot: null, facets: ["readyFix"] }),
      false,
    );
  });

  test("sortPlacedNotes respects film, activity, newest, and oldest orders", () => {
    const a = makePlaced("a", 10, 0, { at: "2026-11-10T09:00:00.000Z" });
    const b = makePlaced("b", 4, 0, {
      at: "2026-11-10T08:00:00.000Z",
      asks: [{ text: "New ask", at: "2026-11-12T10:00:00.000Z" }],
    });
    const c = makePlaced("c", 7, 0, { at: "2026-11-11T09:00:00.000Z" });

    assert.deepEqual(
      sortPlacedNotes([a, b, c], "film").map((x) => x.n.id),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      sortPlacedNotes([a, b, c], "activity").map((x) => x.n.id),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      sortPlacedNotes([a, b, c], "newest").map((x) => x.n.id),
      ["c", "a", "b"],
    );
    assert.deepEqual(
      sortPlacedNotes([a, b, c], "oldest").map((x) => x.n.id),
      ["b", "a", "c"],
    );
  });

  test("buildShotFilterOptions, countNoteFacets, and combineFilteredNotes status slice stay accurate", () => {
    const items = [
      mk("1", "open", { t: 3, shot: 2, shotName: "Room", span: [1, 2] }),
      mk("2", "check", {
        t: 5,
        shot: 0,
        shotName: "Intro",
        fixes: [{ what: "Fixed", at: "2026-11-10T11:00:00.000Z" }],
      }),
      mk("3", "done", { t: 9, shot: 2, shotName: "Room", remember: { scope: "film" } }),
    ];

    const shots = buildShotFilterOptions(items);
    assert.deepEqual(
      shots.map((s) => [s.shot, s.count]),
      [
        [0, 1],
        [2, 2],
      ],
    );

    const counts = countNoteFacets(items);
    assert.equal(counts.drawn, 1);
    assert.equal(counts.readyFix, 1);
    assert.equal(counts.learned, 1);

    const onlyCheck = combineFilteredNotes(
      { check: [items[1]], open: [items[0]], done: [items[2]] },
      "check",
    );
    assert.deepEqual(
      onlyCheck.map((x) => x.n.id),
      ["2"],
    );
  });
});
