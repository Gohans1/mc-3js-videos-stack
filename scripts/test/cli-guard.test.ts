import { expect, test } from "bun:test";

import { verdict } from "../../.claude/hooks/cli-guard";

test("the guiding commands piped or sent to a file are stopped", () => {
  for (const cmd of [
    "bun run find door | head -20",
    "bun run find foo | head",
    "bun run find door 2>&1 | tail -5",
    "cd films/x && bun run find --kind sfx | grep impact",
    "bun scripts/find.ts rain |& less",
    "LIVE_PROJECT=films/x bun run find door > out.txt",
    "bun run find door >> notes.txt",
    "bun run find door | Select-Object -First 5",
  ])
    expect(verdict(cmd), cmd).toBeTruthy();
});

test("every film command is guarded the same: checks, renders, sound, voice, notes", () => {
  for (const cmd of [
    // a grep that keeps "Head|move" drops the POP and DEAD STOP lines, head drops wrote/next:
    "export MC_VAULT_EXTERNAL='D:/mc_vault'; bun run render stills --check motion:Head,0,11.6 --at 1 2>&1 | grep -E \"Head|move \" | head -30",
    "bun run render stills | tail",
    "bun run render stills | grep -h foo",
    "bun run check 2>&1 | tail -1",
    "bun run check | grep err",
    "bun run check --helpful | head",
    "bun run qc renders/draft.mp4 | tail",
    "bun scripts/review/qc.ts renders/draft.mp4 | grep fail",
    "bun node_modules/live-studio/qc.mjs renders/draft.mp4 | tail",
    "cd films/x && bun run framecheck | grep JUMP",
    "bun run listen > listen.txt",
    "bun run pace | Select-String HOLD",
    "bun run sheet | Select-Object -Last 3",
    "bun run deliver | tail",
    "bun run mix renders/draft_video.mp4 | tail -2",
    "bun run at 12 | head",
    "bun run pace | head",
    "bun run notes | head",
    "bun run notes | grep shot",
    "bun run note done 3 x | tail -1",
    "bun run gap | head",
    "bun run sfx:get find rain | head",
    "bun run voice:gen | tail -3",
    "bun run voice:align | tail",
    "bun run voice:lips | tail -2",
    "bun ../../scripts/voice/lips.ts > lips.log",
    "bun run voice:assemble | tail -1",
    "bun run voice:cues | head",
    "bun run new-film x | tail",
    "bun run render stills 2>&1 | tee log.txt | tail -5",
    'bun run find "--help" | head',
    "bun run render --help && bun run check | tail",
  ])
    expect(verdict(cmd), cmd).toBeTruthy();
});

test("a film command called by its file, its errors thrown away, or its output caught in a variable is stopped", () => {
  for (const cmd of [
    "bun node_modules/live-studio/render.mjs stills | head",
    "bun ../../packages/live-studio/check.mjs | tail -1",
    "python ../../scripts/review/sheet.py renders/draft_video.mp4 shots | tail -3",
    "python -I ../../scripts/sound/mix.py renders/draft_video.mp4 > mix.txt",
    ".venv/Scripts/python.exe ../../scripts/sound/listen.py | head",
    "bun ../../scripts/voice/cues.ts | grep line",
    "bun ../../scripts/at.ts 12 | head",
    "bun run voice:cues 2>/dev/null",
    "bun run find door 2>/dev/null",
    "bun run check 2>$null",
    "bun run render stills *> $null",
    "out=$(bun run at 12)",
    "x=`bun run check`",
    "$r = bun run pace",
    "time LIVE_PROJECT=films/x bun run render stills --at 1 | tail -3",
    "nohup bun run render clip > r.log",
    "bun run --silent check | tail -1",
    "(bun run check) | tail -1",
    "bun run check>out.txt",
  ])
    expect(verdict(cmd), cmd).toBeTruthy();
});

test("static doc commands and --help/-h lookups pass when piped or in compound commands", () => {
  for (const cmd of [
    "bun run help | head",
    "bun packages/live-studio/help.mjs | grep render",
    "bun run skills list | head",
    "bun run skills get core --ref sound | grep -i mix",
    "bun run skills get core --ref sound | sed -n 1,40p",
    "bun packages/live-studio/skills.mjs get core | head -20",
    "bun run render --help | head",
    "bun run check -h | grep json",
    "cd films/x && bun run render --help | head -20",
    "(bun run qc --help) | grep motion",
    "bun node_modules/live-studio/qc.mjs --help | head",
    "bun ../../scripts/review/qc.ts -h | head",
    "bun run render --help>help.txt",
    "out=$(bun run check -h)",
  ])
    expect(verdict(cmd), cmd).toBeUndefined();
});

test("run bare, as JSON for a script, through tee alone, other commands, and words only quoted pass", () => {
  for (const cmd of [
    "bun run find door",
    "bun run find door -n 30 2>&1",
    "bun run find door || echo failed",
    "bun run render stills --check motion:cam,40,48 2>&1",
    "bun run check --json | python -c 'import json,sys; print(json.load(sys.stdin)[\"ok\"])'",
    "bun ../../scripts/voice/cues.ts --json > cues.json",
    "bun run render clip 2>&1 | tee renders/log.txt",
    "bun run studio > studio.log 2>&1",
    "bun run typecheck 2>&1 | tail -5",
    "bun run fetch:sound-raw > fetch.log",
    "bun test scripts/test | tail -5",
    "git log --oneline | head",
    'echo "bun run render | head"',
    "cat <<'EOF' > note.txt\nbun run find door | head\nEOF",
    "bun run finder | head",
    "bun run rendering | head",
  ])
    expect(verdict(cmd), cmd).toBeUndefined();
});

// a stopped compound command ran none of its parts: an AI that saw only the guard thought its edit before the render had run
test("the reason says nothing in the stopped command ran", () => {
  expect(verdict("sed -i s/a/b/ src/scene.ts && bun run render stills | tail")).toStartWith(
    "Nothing in this command ran",
  );
});
