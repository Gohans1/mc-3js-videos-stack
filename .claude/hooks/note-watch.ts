// PostToolUse (.claude/settings.json): the creator writes notes in the studio while the AI works, and the next: line that
// names them (render, check) is often read cut. After a shell command in or naming a film, the open notes no bun run
// notes has listed are said beside its result, once for each new set of them.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { unreadNotes } from "../../packages/live-studio/src/note-cli.mjs";

type Said = Record<string, string>;
type Note = { id: string; t: number; text: string };

const SHOWN = 5;
const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 119)}…` : s);

// said: the unread ids already named for each film, so the same set is not named again
export function nudge(root: string, cwd: string, command: string, said: Said) {
  const filmsDir = join(root, "films");
  const names = existsSync(filmsDir)
    ? readdirSync(filmsDir).filter((f) => existsSync(join(filmsDir, f, "notes/notes.jsonl")))
    : [];
  const inside = relative(filmsDir, resolve(cwd)).split(/[\\/]/)[0];
  const touched = names.filter(
    (f) =>
      f === inside ||
      new RegExp(`films[\\\\/]${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(command),
  );
  const next = { ...said };
  const lines: string[] = [];
  for (const f of touched) {
    const unread = (unreadNotes(join(filmsDir, f)) as Note[]).toSorted((a, b) => a.t - b.t);
    const key = unread.map((n) => n.id).join(",");
    if (!unread.length || said[f] === key) continue;
    next[f] = key;
    lines.push(
      `films/${f} has ${unread.length} studio note${unread.length > 1 ? "s" : ""} from the creator not read yet (bun run notes lists them): ${unread
        .slice(0, SHOWN)
        .map((n) => `${+n.t.toFixed(2)} s "${clip(String(n.text))}"`)
        .join("; ")}${unread.length > SHOWN ? `; ${unread.length - SHOWN} more` : ""}`,
    );
  }
  return { text: lines.join("\n"), said: next };
}

if (import.meta.main) {
  try {
    const event = JSON.parse(await Bun.stdin.text());
    const root = process.env.CLAUDE_PROJECT_DIR || String(event?.cwd ?? process.cwd());
    const stateFile = join(
      tmpdir(),
      `note-watch-${String(event?.session_id ?? "any").replace(/\W/g, "")}.json`,
    );
    let said: Said = {};
    try {
      said = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {}
    const out = nudge(
      root,
      String(event?.cwd ?? root),
      String(event?.tool_input?.command ?? ""),
      said,
    );
    if (out.text) {
      writeFileSync(stateFile, JSON.stringify(out.said));
      console.log(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: out.text },
        }),
      );
    }
  } catch {
    // a hook that cannot read its event says nothing: the notes stay for bun run notes
  }
}
