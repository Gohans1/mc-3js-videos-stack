import { expect, test } from "bun:test";

import { verdict } from "../../.claude/hooks/cli-guard";

test("the guiding commands piped or sent to a file are stopped", () => {
  for (const cmd of [
    "bun run find door | head -20",
    "bun run find door 2>&1 | tail -5",
    "cd films/x && bun run find --kind sfx | grep impact",
    "bun scripts/find.ts rain |& less",
    "bun run help | head",
    "bun run skills get core --ref sound | sed -n 1,40p",
    "AT=3 bun run find door > out.txt",
    "bun run find door >> notes.txt",
    "bun run find door | Select-Object -First 5",
  ])
    expect(verdict(cmd), cmd).toBeTruthy();
});

test("the same commands run bare, other commands piped, and the words only quoted or in a heredoc pass", () => {
  for (const cmd of [
    "bun run find door",
    "bun run find door -n 30 2>&1",
    "bun run find door 2>/dev/null",
    "bun run find door || echo failed",
    "bun test scripts/test | tail -5",
    "git log --oneline | head",
    'echo "bun run find door | head"',
    "cat <<'EOF' > note.txt\nbun run find door | head\nEOF",
    "bun run finder | head",
  ])
    expect(verdict(cmd), cmd).toBeUndefined();
});
