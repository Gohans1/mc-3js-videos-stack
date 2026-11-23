import { diffArrays, diffWordsWithSpace } from "diff";

export interface ChangePart {
  text: string;
  changed: boolean;
}
export interface ChangeRow {
  kind: "same" | "added" | "removed";
  text: string;
  parts?: ChangePart[];
}
export interface ChangeHunk {
  line: number;
  rows: ChangeRow[];
}

const CONTEXT = 2,
  SHARED = 0.4,
  TIMEOUT_MS = 1000;

const wordParts = (was: string, now: string) => {
  const words = diffWordsWithSpace(was, now);
  const shared = words.reduce((n, w) => (w.added || w.removed ? n : n + w.value.trim().length), 0);
  if (shared < Math.max(was.length, now.length) * SHARED) return null;
  const side = (hide: "added" | "removed", mark: "added" | "removed") =>
    words.flatMap((w): ChangePart[] => (w[hide] ? [] : [{ text: w.value, changed: !!w[mark] }]));
  return { was: side("added", "removed"), now: side("removed", "added") };
};

export const lessonChanges = (before: string, after: string) => {
  const norm = (s: string) => s.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const a = norm(before).split("\n"),
    b = norm(after).split("\n");
  const blocks = diffArrays(a, b, { timeout: TIMEOUT_MS }) ?? [
    { removed: true, added: false, value: a, count: a.length },
    { added: true, removed: false, value: b, count: b.length },
  ];
  const rows: (ChangeRow & { line: number })[] = [];
  let line = 1,
    added = 0,
    removed = 0;
  blocks.forEach((block, k) => {
    if (block.removed) {
      const next = blocks[k + 1],
        instead = next?.added ? next.value : [];
      block.value.forEach((text, i) => {
        const parts = i < instead.length ? wordParts(text, instead[i]!) : null;
        rows.push({ kind: "removed", text, line, ...(parts && { parts: parts.was }) });
      });
      removed += block.value.length;
    } else if (block.added) {
      const prev = blocks[k - 1],
        was = prev?.removed ? prev.value : [];
      block.value.forEach((text, i) => {
        const parts = i < was.length ? wordParts(was[i]!, text) : null;
        rows.push({ kind: "added", text, line: line++, ...(parts && { parts: parts.now }) });
      });
      added += block.value.length;
    } else for (const text of block.value) rows.push({ kind: "same", text, line: line++ });
  });
  const keep = rows.map((r) => r.kind !== "same");
  rows.forEach((r, i) => {
    if (r.kind === "same") return;
    for (let d = 1; d <= CONTEXT; d++) {
      if (rows[i - d]?.kind === "same") keep[i - d] = true;
      if (rows[i + d]?.kind === "same") keep[i + d] = true;
    }
  });
  const hunks: ChangeHunk[] = [];
  rows.forEach(({ line: at, ...row }, i) => {
    if (!keep[i]) return;
    if (i > 0 && keep[i - 1]) hunks.at(-1)!.rows.push(row);
    else hunks.push({ line: at, rows: [row] });
  });
  return { hunks, added, removed };
};
