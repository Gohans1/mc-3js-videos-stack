// PreToolUse guard (.claude/settings.json): the repo's guiding commands are read whole. find puts its hits first and its
// next: lines (what to run next) last, so a pipe through head/tail/grep or a file read in part loses one or the other
const GUIDED =
  /^(?:\w+=\S*\s+)*(?:timeout\s+\S+\s+)?bun\s+(?:run\s+(?:find|help|skills)(?=\s|$)|\S*scripts[/\\]find\.ts(?=\s|$))/;
// stdout into a file: >, >>, 1>, &>; not 2> (stderr) nor >&2
const TO_FILE = /(?:^|\s)(?:1|&)?>>?(?!&)/;

const REASON =
  "Read bun run find / help / skills whole: never pipe them (head, tail, grep, sed, Select-Object...) or send them to a file. find's hits come first and its next: lines (what to run next) last; a cut loses one. Run it bare; for fewer hits use -n N or a filter (--kind, --source...).";

// quoted text and heredoc bodies are data, not commands: blanked before the command is read
const blank = (cmd: string) =>
  cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\n|$)/g, "<<$2$3")
    .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) => `${q[0]}${"_".repeat(q.length - 2)}${q[0]}`);

export function verdict(cmd: string): string | undefined {
  for (const list of blank(cmd).split(/\|\||&&|;|\n/)) {
    const stages = list.split(/\|&?/).map((s) => s.trim());
    const at = stages.findIndex((s) => GUIDED.test(s));
    if (at < 0) continue;
    if (at < stages.length - 1 || TO_FILE.test(stages[at]!)) return REASON;
  }
  return undefined;
}

if (import.meta.main) {
  try {
    const event = JSON.parse(await Bun.stdin.text());
    const why = verdict(String(event?.tool_input?.command ?? ""));
    if (why)
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: why,
          },
        }),
      );
  } catch {
    // an event that doesn't parse is let through: the guard only ever denies what it read
  }
}
