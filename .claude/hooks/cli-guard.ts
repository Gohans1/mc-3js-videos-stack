// PreToolUse guard (.claude/settings.json): the repo's film commands are read whole. Their faults (✖, POP, DEAD STOP),
// the files they wrote and their next: lines sit anywhere in the output, so a pipe through head/tail/grep, a file read
// in part, stderr thrown away or output caught in a variable loses some. --json output (for a script), --help/-h lookups and tee pass.
const NAMES =
  "find|gap|at|check|render|framecheck|qc|notes|note|sheet|pace|deliver|mix|listen|sfx:get|voice:gen|voice:align|voice:lips|voice:assemble|voice:cues|new-film";
// the same commands called by their files, as package.json runs them
const FILES =
  /\S*(?:live-studio[/\\](?:check|render|framecheck|qc|notes|note)\.mjs|scripts[/\\](?:find|gap|at|new_film)\.ts|scripts[/\\]review[/\\](?:sheet\.py|deliver\.py|pace\.ts|qc\.ts)|scripts[/\\]sound[/\\](?:get_sfx|mix|listen)\.py|scripts[/\\]voice[/\\](?:gen|align|lips|assemble|cues)\.ts)/;
// what may come before: a subshell's (, env settings, time, nohup, timeout
const LEAD = String.raw`^[({]?\s*(?:(?:export\s+)?\w+=\S*\s+|time\s+|nohup\s+|timeout\s+(?:-\S+\s+)*\S+\s+)*`;
const GUIDED = new RegExp(
  String.raw`${LEAD}(?:bun\s+run\s+(?:-\S+\s+)*(?:${NAMES})(?=[\s>)}]|$)|\S*(?:bun|node|python3?|py)(?:\.exe)?\s+(?:-\S+\s+)*${FILES.source}(?=[\s>)}]|$))`,
);
// output into a file: >, >>, 1>, &>, *> (PowerShell), and 2> (the errors); not 2>&1 nor >&2
const TO_FILE = /[12&*]?>>?(?!&)/;
const JSON_OUT = /\s--json(?=\s|$)/;
const HELP_FLAG = /(?:^|\s)(?:--help|-h)(?=[\s>)}]|$)/;
const TEE = /^(?:tee|Tee-Object)(?=\s|$)/i;
// PowerShell's $x = <command>: the output caught in a variable
const ASSIGN = /^\$[\w:]+\s*=\s*/;

const REASON =
  "Nothing in this command ran, not even the parts before or after the film command: run them again once it is fixed. Read the repo's film commands whole (find, render, check, framecheck, listen...): never pipe them (head, tail, grep, Select-Object...), send them or their errors to a file, or catch them in a variable. Faults, written files and next: lines sit anywhere; a cut loses them. Narrow with the command's own options (-n, --kind, AT=, CHECK=), or --json (check, at, voice:cues) for a script.";

// quoted text and heredoc bodies are data, not commands: blanked before the command is read
const blank = (cmd: string) =>
  cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\n|$)/g, "<<$2$3")
    .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) => `${q[0]}${"_".repeat(q.length - 2)}${q[0]}`);

const guided = (s: string) => GUIDED.test(s) && !JSON_OUT.test(s) && !HELP_FLAG.test(s);

export function verdict(cmd: string): string | undefined {
  const text = blank(cmd);
  // output caught whole in a variable: $(...), `...`
  for (const m of text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g))
    if (guided((m[1] ?? m[2])!.trim())) return REASON;
  for (const list of text.split(/\|\||&&|;|\n/)) {
    const stages = list.split(/\|&?/).map((s) => s.trim());
    const at = stages.findIndex((s) => guided(s.replace(ASSIGN, "")));
    if (at < 0) continue;
    const stage = stages[at]!,
      rest = stages.slice(at + 1);
    if (ASSIGN.test(stage) || TO_FILE.test(stage)) return REASON;
    if (rest.length && !(rest.length === 1 && TEE.test(rest[0]!))) return REASON;
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
