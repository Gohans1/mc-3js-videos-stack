import { describe, expect, test } from "bun:test";

import {
  buildLessonTrail,
  classifyLessonTrailTransition,
  emptyAreaFoldTarget,
  layoutLessonDeck,
  LESSON_DESKTOP_DECK_MIN_W,
  lessonCardOffsets,
  resolveDirClick,
} from "../app/lessons/tree";

const sampleFiles = [
  { key: "film:intro/shot.md", scope: "film", path: "intro/shot.md", tag: "1", text: "# Shot" },
  { key: "film:notes.md", scope: "film", path: "notes.md", tag: "2", text: "# Film" },
  { key: "all:craft/ik/foot.md", scope: "all", path: "craft/ik/foot.md", tag: "3", text: "# Foot" },
  { key: "all:craft/walk.md", scope: "all", path: "craft/walk.md", tag: "4", text: "# Walk" },
  { key: "all:1.md", scope: "all", path: "1.md", tag: "5", text: "# One" },
];

describe("buildLessonTrail", () => {
  test("returns single root column with directories sorted before files when nothing is open", () => {
    const trail = buildLessonTrail({ files: sampleFiles, folder: [], openKey: null });

    expect(trail.folderParts).toEqual([]);
    expect(trail.contentKey).toBeNull();
    expect(trail.columns.length).toBe(1);
    const root = trail.columns[0];
    expect(root.depth).toBe(0);
    expect(root.title).toBe("Lessons");
    expect(root.entries.map((e) => (e.kind === "dir" ? `/${e.name}` : e.file.key))).toEqual([
      "/craft",
      "/intro",
      "film:notes.md",
      "all:1.md",
    ]);
    expect(root.entries.find((e) => e.kind === "dir" && e.name === "craft")).toMatchObject({
      kind: "dir",
      fileCount: 2,
    });
  });

  test("keeps ancestor columns visible alongside an opened root note", () => {
    const trail = buildLessonTrail({ files: sampleFiles, folder: [], openKey: "all:1.md" });

    expect(trail.folderParts).toEqual([]);
    expect(trail.contentKey).toBe("all:1.md");
    expect(trail.contentDepth).toBe(1);
    expect(trail.columns.map((c) => c.title)).toEqual(["Lessons"]);
    expect(trail.columns[0].activeEntryKey).toBe("file:all:1.md");
  });

  test("builds full ancestor chain from root down to deeply nested open note", () => {
    const trail = buildLessonTrail({
      files: sampleFiles,
      folder: [],
      openKey: "all:craft/ik/foot.md",
    });

    expect(trail.folderParts).toEqual(["craft", "ik"]);
    expect(trail.contentKey).toBe("all:craft/ik/foot.md");
    expect(trail.contentDepth).toBe(3);
    expect(trail.columns.map((c) => [c.depth, c.title, c.activeEntryKey])).toEqual([
      [0, "Lessons", "dir:craft"],
      [1, "craft", "dir:craft/ik"],
      [2, "ik", "file:all:craft/ik/foot.md"],
    ]);
    expect(
      trail.columns[1].entries.map((e) => (e.kind === "dir" ? `/${e.name}` : e.file.key)),
    ).toEqual(["/ik", "all:craft/walk.md"]);
  });

  test("merges shared folders across film and global scopes while keeping both files distinct", () => {
    const files = [
      { key: "film:craft/walk.md", scope: "film", path: "craft/walk.md", tag: "a", text: "" },
      { key: "all:craft/walk.md", scope: "all", path: "craft/walk.md", tag: "b", text: "" },
    ];
    const trail = buildLessonTrail({ files, folder: ["craft"], openKey: "all:craft/walk.md" });
    expect(trail.columns[1].entries.map((e) => (e.kind === "file" ? e.file.key : e.key))).toEqual([
      "film:craft/walk.md",
      "all:craft/walk.md",
    ]);
    expect(trail.columns[1].activeEntryKey).toBe("file:all:craft/walk.md");
  });

  test("propagates unseen AI change flags and unsaved edit drafts to parent folder entries", () => {
    const trail = buildLessonTrail({
      files: sampleFiles,
      folder: [],
      openKey: null,
      seen: {
        "all:craft/ik/foot.md": { tag: "old", text: "# Old" },
      },
      edits: {
        "film:intro/shot.md": { text: "draft" },
      },
    });
    const craft = trail.columns[0].entries.find((e) => e.kind === "dir" && e.name === "craft");
    const intro = trail.columns[0].entries.find((e) => e.kind === "dir" && e.name === "intro");
    expect(craft).toMatchObject({ hasChanged: true, hasDraft: false });
    expect(intro).toMatchObject({ hasChanged: false, hasDraft: true });
  });

  test("clamps removed folder path cleanly back to existing ancestor", () => {
    const trail = buildLessonTrail({
      files: sampleFiles,
      folder: ["craft", "removed"],
      openKey: null,
    });
    expect(trail.folderParts).toEqual(["craft"]);
    expect(trail.columns.map((c) => c.title)).toEqual(["Lessons", "craft"]);
  });

  test("preserves pending unsaved file folder chain when creating a nested New lesson before save", () => {
    const pending = {
      key: "film:brand/new-tip.md",
      scope: "film",
      path: "brand/new-tip.md",
      tag: "",
      text: "# New Tip",
    };
    const trail = buildLessonTrail({
      files: sampleFiles,
      folder: [],
      openKey: pending.key,
      pendingFile: pending,
    });
    expect(trail.folderParts).toEqual(["brand"]);
    expect(trail.columns.map((c) => c.title)).toEqual(["Lessons", "brand"]);
    expect(trail.columns[1].activeEntryKey).toBe("file:film:brand/new-tip.md");
  });
});

describe("layoutLessonDeck & navigation helpers", () => {
  test("always keeps ancestors beside open notes at desktop widths >= LESSON_DESKTOP_DECK_MIN_W", () => {
    expect(
      layoutLessonDeck({
        columnCount: 1,
        hasContent: true,
        containerWidth: LESSON_DESKTOP_DECK_MIN_W,
      }),
    ).toEqual({
      mode: "desktop-stack",
      showAncestors: true,
      showListPane: true,
      stickyStepPx: 24,
      maxStickySteps: 4,
      topStepPx: 4,
      maxTopSteps: 4,
    });
    expect(
      layoutLessonDeck({
        columnCount: 1,
        hasContent: true,
        containerWidth: 720,
      }),
    ).toEqual({
      mode: "desktop-stack",
      showAncestors: true,
      showListPane: true,
      stickyStepPx: 28,
      maxStickySteps: 4,
      topStepPx: 4,
      maxTopSteps: 4,
    });
  });

  test("switches to compact-file only below deck min width", () => {
    expect(
      layoutLessonDeck({
        columnCount: 2,
        hasContent: true,
        containerWidth: LESSON_DESKTOP_DECK_MIN_W - 1,
      }),
    ).toMatchObject({ mode: "compact-file", showAncestors: false, showListPane: false });
  });

  test("honors explicit desktop flag even when container starts at idle library width (< 420px)", () => {
    expect(
      layoutLessonDeck({
        columnCount: 1,
        hasContent: true,
        containerWidth: 398,
        desktop: true,
      }),
    ).toMatchObject({ mode: "desktop-stack", showAncestors: true, showListPane: true });

    expect(
      layoutLessonDeck({
        columnCount: 2,
        hasContent: true,
        containerWidth: 900,
        desktop: false,
      }),
    ).toMatchObject({ mode: "compact-file", showAncestors: false, showListPane: false });

    expect(
      layoutLessonDeck({
        columnCount: 2,
        hasContent: false,
        containerWidth: 900,
        desktop: false,
      }),
    ).toMatchObject({ mode: "compact-stack", showAncestors: false, showListPane: true });
  });

  test("computes bounded sticky and top offsets from depth", () => {
    const layout = layoutLessonDeck({
      columnCount: 6,
      hasContent: true,
      containerWidth: 720,
    });
    expect(lessonCardOffsets(0, layout)).toEqual({ stickyLeftPx: 0, stepTopPx: 0 });
    expect(lessonCardOffsets(2, layout)).toEqual({ stickyLeftPx: 56, stepTopPx: 8 });
    expect(lessonCardOffsets(7, layout)).toEqual({ stickyLeftPx: 112, stepTopPx: 16 });
  });

  test("resolveDirClick collapses active subfolder on re-tap when no file is open", () => {
    const trail = buildLessonTrail({ files: sampleFiles, folder: ["craft"], openKey: null });
    expect(resolveDirClick(trail, 0, ["craft"])).toEqual([]);
    expect(resolveDirClick(trail, 0, ["intro"])).toEqual(["intro"]);

    const withOpenNote = buildLessonTrail({
      files: sampleFiles,
      folder: ["craft"],
      openKey: "all:craft/walk.md",
    });
    expect(resolveDirClick(withOpenNote, 0, ["craft"])).toEqual(["craft"]);
  });

  test("emptyAreaFoldTarget folds back to the clicked column depth when deeper panels or notes are open", () => {
    const deepTrail = buildLessonTrail({
      files: sampleFiles,
      folder: [],
      openKey: "all:craft/ik/foot.md",
    });
    expect(emptyAreaFoldTarget(deepTrail, 2)).toEqual(["craft", "ik"]);
    expect(emptyAreaFoldTarget(deepTrail, 1)).toEqual(["craft"]);
    expect(emptyAreaFoldTarget(deepTrail, 0)).toEqual([]);

    const folderOnlyTrail = buildLessonTrail({
      files: sampleFiles,
      folder: ["craft", "ik"],
      openKey: null,
    });
    expect(emptyAreaFoldTarget(folderOnlyTrail, 2)).toBeNull();
    expect(emptyAreaFoldTarget(folderOnlyTrail, 1)).toEqual(["craft"]);
    expect(emptyAreaFoldTarget(folderOnlyTrail, 0)).toEqual([]);

    expect(emptyAreaFoldTarget(deepTrail, 0, true)).toEqual([]);
    expect(emptyAreaFoldTarget(folderOnlyTrail, 0, true)).toBeNull();
  });

  test("classifyLessonTrailTransition distinguishes fold-out, fold-in, and no-op transitions", () => {
    const root = buildLessonTrail({ files: sampleFiles, folder: [], openKey: null });
    const craft = buildLessonTrail({ files: sampleFiles, folder: ["craft"], openKey: null });
    const note = buildLessonTrail({
      files: sampleFiles,
      folder: ["craft"],
      openKey: "all:craft/ik/foot.md",
    });

    expect(classifyLessonTrailTransition(root, root)).toEqual({
      kind: "none",
      keepColumnCount: 1,
      closingContent: false,
    });
    expect(classifyLessonTrailTransition(root, craft)).toEqual({
      kind: "open-right",
      keepColumnCount: 1,
      closingContent: false,
    });
    expect(classifyLessonTrailTransition(note, craft)).toEqual({
      kind: "close-right",
      keepColumnCount: 2,
      closingContent: true,
    });
    expect(classifyLessonTrailTransition(note, root)).toEqual({
      kind: "close-right",
      keepColumnCount: 1,
      closingContent: true,
    });
  });
});
