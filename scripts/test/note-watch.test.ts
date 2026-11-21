import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nudge } from "../../.claude/hooks/note-watch";

const repo = () => {
  const root = mkdtempSync(join(tmpdir(), "note-watch-"));
  const film = join(root, "films/cookie");
  mkdirSync(join(film, "notes"), { recursive: true });
  writeFileSync(join(film, "src.txt"), "");
  const note = (id: string, t: number, text: string) => ({
    id,
    t,
    text,
    shot: 1,
    time: "00:01.000",
    at: "2026-11-20T17:43:37.327Z",
  });
  writeFileSync(
    join(film, "notes/notes.jsonl"),
    [
      note("old1", 1, "seen already"),
      note("new1", 3.333, "the glow is too bright"),
      note("new2", 13.6, "he should try several jars"),
    ]
      .map((n) => JSON.stringify(n))
      .join("\n") + "\n",
  );
  writeFileSync(
    join(film, "notes/note-reads.json"),
    JSON.stringify({ byId: {}, lastList: { at: 1, knownIds: ["old1"] } }),
  );
  return { root, film };
};

// the studio cannot tell a running AI that the creator wrote a note; the output that says so is often read cut
test("notes the AI has not listed are said beside a command run in their film, once", () => {
  const { root, film } = repo();
  try {
    const first = nudge(root, film, "bun run render clip", {});
    expect(first.text).toContain(
      "films/cookie has 2 studio notes from the creator not read yet (bun run notes lists them)",
    );
    expect(first.text).toContain('3.33 s "the glow is too bright"');
    expect(first.text).toContain('13.6 s "he should try several jars"');
    expect(nudge(root, film, "bun run check", first.said).text).toBe("");
    // a command naming the film from the repo root counts as its own
    expect(
      nudge(root, root, "cd films/cookie && bun run mix renders/draft_video.mp4", {}).text,
    ).toContain("films/cookie");
    expect(nudge(root, root, "git status", {}).text).toBe("");
    writeFileSync(
      join(film, "notes/note-reads.json"),
      JSON.stringify({ byId: {}, lastList: { at: 2, knownIds: ["old1", "new1", "new2"] } }),
    );
    expect(nudge(root, film, "bun run render clip", {}).text).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
