// Pure folder-column model and responsive deck layout rules for Lessons, ported from md-phone desktop Miller columns.
import type { LessonFile } from "./lessons";

export const LESSON_DESKTOP_DECK_MIN_W = 420;
export const LESSONS_LIBRARY_WIDTH = 800;

export interface LessonDirEntry {
  kind: "dir";
  key: string;
  name: string;
  parts: string[];
  fileCount: number;
  hasChanged: boolean;
  hasDraft: boolean;
  isLit: boolean;
}

export interface LessonFileEntry {
  kind: "file";
  key: string;
  name: string;
  file: LessonFile;
  isChanged: boolean;
  isDraft: boolean;
  isLit: boolean;
}

export type LessonColumnEntry = LessonDirEntry | LessonFileEntry;

export interface LessonColumn {
  depth: number;
  key: string;
  title: string;
  parts: string[];
  entries: LessonColumnEntry[];
  activeEntryKey: string | null;
}

export interface LessonTrail {
  folderParts: string[];
  columns: LessonColumn[];
  contentKey: string | null;
  contentDepth: number | null;
}

export interface LessonDeckLayout {
  mode: "desktop-stack" | "compact-stack" | "compact-file";
  showAncestors: boolean;
  showListPane: boolean;
  stickyStepPx: number;
  maxStickySteps: number;
  topStepPx: number;
  maxTopSteps: number;
}

const dirKeyOf = (parts: readonly string[]) =>
  parts.length === 0 ? "/" : `dir:${parts.join("/")}`;

const fileEntryKeyOf = (fileKey: string) => `file:${fileKey}`;

const isLessonLit = (file: LessonFile, lit?: Readonly<Record<string, unknown>>) =>
  !!lit && (`lesson:${file.key}` in lit || (file.scope === "all" && `lesson:${file.path}` in lit));

const splitDirAndName = (path: string) => {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return { dirParts: [] as string[], name: path };
  return { dirParts: path.slice(0, slash).split("/"), name: path.slice(slash + 1) };
};

const startsWithParts = (haystack: readonly string[], prefix: readonly string[]) =>
  haystack.length >= prefix.length && prefix.every((part, i) => haystack[i] === part);

const buildColumnEntries = ({
  allFiles,
  folderParts,
  seen,
  edits,
  lit,
}: {
  allFiles: readonly LessonFile[];
  folderParts: readonly string[];
  seen?: Readonly<Record<string, { tag: string }>>;
  edits?: Readonly<Record<string, unknown>>;
  lit?: Readonly<Record<string, unknown>>;
}): LessonColumnEntry[] => {
  const dirs = new Map<string, LessonDirEntry>();
  const directFiles: LessonFileEntry[] = [];

  for (const file of allFiles) {
    const { dirParts, name } = splitDirAndName(file.path);
    if (!startsWithParts(dirParts, folderParts)) continue;

    const isChanged = !!(seen?.[file.key] && seen[file.key]!.tag !== file.tag);
    const isDraft = !!(edits && file.key in edits);
    const isLit = isLessonLit(file, lit);

    if (dirParts.length === folderParts.length) {
      directFiles.push({
        kind: "file",
        key: fileEntryKeyOf(file.key),
        name,
        file,
        isChanged,
        isDraft,
        isLit,
      });
      continue;
    }

    const childName = dirParts[folderParts.length]!;
    const nextParts = [...folderParts, childName];
    const key = dirKeyOf(nextParts);
    const existing = dirs.get(key);
    if (existing) {
      existing.fileCount += 1;
      existing.hasChanged ||= isChanged;
      existing.hasDraft ||= isDraft;
      existing.isLit ||= isLit;
    } else {
      dirs.set(key, {
        kind: "dir",
        key,
        name: childName,
        parts: nextParts,
        fileCount: 1,
        hasChanged: isChanged,
        hasDraft: isDraft,
        isLit,
      });
    }
  }

  const sortedDirs = [...dirs.values()].toSorted((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
  return [...sortedDirs, ...directFiles];
};

const clampFolderParts = (files: readonly LessonFile[], requested: readonly string[]): string[] => {
  const resolved: string[] = [];
  for (const seg of requested) {
    const candidate = [...resolved, seg];
    const exists = files.some((f) => startsWithParts(splitDirAndName(f.path).dirParts, candidate));
    if (!exists) break;
    resolved.push(seg);
  }
  return resolved;
};

/** Builds the ancestor-to-leaf Miller column chain for Lessons navigation. */
export function buildLessonTrail({
  files,
  folder,
  openKey,
  pendingFile,
  seen,
  edits,
  lit,
}: {
  files: readonly LessonFile[];
  folder: readonly string[];
  openKey: string | null;
  pendingFile?: LessonFile | null;
  seen?: Readonly<Record<string, { tag: string }>>;
  edits?: Readonly<Record<string, unknown>>;
  lit?: Readonly<Record<string, unknown>>;
}): LessonTrail {
  const effectiveFiles =
    pendingFile && !files.some((f) => f.key === pendingFile.key) ? [...files, pendingFile] : files;
  const openFile = openKey ? (effectiveFiles.find((f) => f.key === openKey) ?? null) : null;
  const folderParts = openFile
    ? splitDirAndName(openFile.path).dirParts
    : clampFolderParts(effectiveFiles, folder);

  const columns: LessonColumn[] = [];
  for (let depth = 0; depth <= folderParts.length; depth++) {
    const parts = folderParts.slice(0, depth);
    const nextDir = folderParts[depth];
    const activeEntryKey =
      nextDir !== undefined
        ? dirKeyOf([...parts, nextDir])
        : openFile
          ? fileEntryKeyOf(openFile.key)
          : null;
    columns.push({
      depth,
      key: dirKeyOf(parts),
      title: depth === 0 ? "Lessons" : parts.at(-1)!,
      parts,
      entries: buildColumnEntries({
        allFiles: effectiveFiles,
        folderParts: parts,
        seen,
        edits,
        lit,
      }),
      activeEntryKey,
    });
  }

  return {
    folderParts,
    columns,
    contentKey: openFile ? openFile.key : null,
    contentDepth: openFile ? folderParts.length + 1 : null,
  };
}

/** Chooses desktop Miller stack vs compact layout; desktop panels never hide ancestor columns. */
export function layoutLessonDeck({
  columnCount,
  hasContent,
  containerWidth,
  desktop,
}: {
  columnCount: number;
  hasContent: boolean;
  containerWidth: number;
  desktop?: boolean;
}): LessonDeckLayout {
  if (desktop ?? containerWidth >= LESSON_DESKTOP_DECK_MIN_W) {
    return {
      mode: "desktop-stack",
      showAncestors: columnCount > 1 || hasContent,
      showListPane: true,
      stickyStepPx: containerWidth < 720 ? 24 : 28,
      maxStickySteps: 4,
      topStepPx: 4,
      maxTopSteps: 4,
    };
  }
  if (hasContent) {
    return {
      mode: "compact-file",
      showAncestors: false,
      showListPane: false,
      stickyStepPx: 0,
      maxStickySteps: 0,
      topStepPx: 0,
      maxTopSteps: 0,
    };
  }
  return {
    mode: "compact-stack",
    showAncestors: false,
    showListPane: true,
    stickyStepPx: 0,
    maxStickySteps: 0,
    topStepPx: 0,
    maxTopSteps: 0,
  };
}

/** Computes sticky horizontal overlap and vertical step offsets per column depth. */
export function lessonCardOffsets(depth: number, layout: LessonDeckLayout) {
  return {
    stickyLeftPx: Math.min(Math.max(0, depth), layout.maxStickySteps) * layout.stickyStepPx,
    stepTopPx: Math.min(Math.max(0, depth), layout.maxTopSteps) * layout.topStepPx,
  };
}

/** Tapping an already-active subfolder with no open file collapses deeper columns; otherwise opens it. */
export function resolveDirClick(
  trail: LessonTrail,
  colDepth: number,
  dirParts: readonly string[],
): string[] {
  const col = trail.columns[colDepth];
  if (!trail.contentKey && col && col.activeEntryKey === dirKeyOf(dirParts)) {
    return [...col.parts];
  }
  return [...dirParts];
}

/** Resolves the folder to fold back to when clicking empty space inside a column, or null if already leaf. */
export function emptyAreaFoldTarget(
  trail: LessonTrail,
  colDepth: number,
  isSearching = false,
): string[] | null {
  if (isSearching) return trail.contentKey ? [] : null;
  const col = trail.columns[colDepth];
  if (!col) return null;
  if (!trail.contentKey && colDepth >= trail.columns.length - 1) return null;
  return [...col.parts];
}

export interface LessonTrailTransition {
  kind: "none" | "open-right" | "close-right";
  keepColumnCount: number;
  closingContent: boolean;
}

/** Classifies Miller trail changes so transitions animate fold-out vs fold-in coherently. */
export function classifyLessonTrailTransition(
  prev: LessonTrail,
  next: LessonTrail,
): LessonTrailTransition {
  let shared = 0;
  while (
    shared < prev.columns.length &&
    shared < next.columns.length &&
    prev.columns[shared]!.key === next.columns[shared]!.key
  ) {
    shared++;
  }

  if (
    shared === prev.columns.length &&
    shared === next.columns.length &&
    prev.contentKey === next.contentKey
  ) {
    return { kind: "none", keepColumnCount: shared, closingContent: false };
  }

  if (
    !next.contentKey &&
    shared === next.columns.length &&
    (next.columns.length < prev.columns.length || Boolean(prev.contentKey))
  ) {
    return {
      kind: "close-right",
      keepColumnCount: next.columns.length,
      closingContent: Boolean(prev.contentKey),
    };
  }

  return {
    kind: "open-right",
    keepColumnCount: shared,
    closingContent: Boolean(prev.contentKey && !next.contentKey),
  };
}
