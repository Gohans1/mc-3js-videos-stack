// The AI's answer on a note (fixed, a question, what it learned); HELP below
import { cliArgs, needFilm } from "./src/cli.mjs";
import { markDone, resolveNote, sendChange } from "./src/note-cli.mjs";
import { noteState } from "./src/note-state.mjs";
import { createNotes, noteNumbers, readDeletedNotes, readNoteRows } from "./src/notes.mjs";
import { tell } from "./src/tell.mjs";

const HELP = `The AI's answer on a creator's note; run inside the film. ID: as bun run notes lists it, the id (mw6hr1fm) or the number (3 or #3).
  bun run note done ID "what changed"       fixed: the note waits for the creator's check in the studio (Approve, or
                                            Needs work with words, which brings it back to bun run notes)
  bun run note ask ID "your question"       not sure what they want: the question waits for their answer the same way
  bun run note learned ID "the rule, where"  for a note they asked you to remember (bun run notes lists those): the
                                            lasting rule you drew and where you kept it (this film: src or lessons/,
                                            every film: ../../lessons/, nested .md ok), shown on their note
  bun run note restore NOTE_ID             recover a deleted note using its stable ID from bun run notes --deleted
Read the open notes first: bun run notes (one in full: bun run notes ID; lesson matches return only file names and headings by line — read those files directly for full details).`;
const project = process.env.LIVE_PROJECT ?? process.cwd();
const [cmd, key, ...words] = cliArgs(HELP, null);
needFilm(project);
const what = words.join(" ").trim();
// where the change went (note-cli.mjs sendChange): through the open studio, or straight into the file with none running
const HOW = {
  studio: "sent through the running studio",
  file: "written to notes/notes.jsonl, no studio running",
};
if (cmd === "restore") {
  if (!key || words.length || !/^[a-z0-9]+$/.test(key)) {
    console.error("Use the note ID shown by bun run notes --deleted");
    process.exit(2);
  }
  try {
    const pending = readDeletedNotes(project).some((n) => n?.id === key);
    if (!pending && !readNoteRows(project).some((n) => n?.id === key))
      throw new Error("Use the note ID shown by bun run notes --deleted");
    const action = pending ? HOW[await sendChange(project, key, { restore: true })] : null;
    console.log(`${key}: ${action ? `restored (${action})` : "already in Notes"}`);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  process.exit(0);
}
const DO = {
  done: async (id) =>
    `waits for the creator's check (${HOW[await markDone(project, id, what)]}): Approve, or Needs work with their words`,
  ask: async (id) =>
    `your question waits for the creator's answer (${HOW[await markDone(project, id, what, true)]}); it comes back in bun run notes with it`,
  learned: async (id) =>
    `kept as learned (${HOW[await sendChange(project, id, { learned: { what } })]}); the creator sees it on the note`,
};
// what the studio's activity view says of it (src/tell.mjs)
const SAID = { done: "Fixed", ask: "Asked about", learned: "Learned from" };
const ARG = { done: "what changed", ask: "your question", learned: "the rule, where you kept it" };
if (DO[cmd] && key && what) {
  let id;
  try {
    id = resolveNote(project, key);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  // the note as the AI will see it went: its number and words, so an answer on the wrong note shows at once
  const n = createNotes(project)
      .read()
      .find((x) => x.id === id),
    num = noteNumbers(project).get(id)?.n,
    words = n.text.trim().split(/\s+/).join(" "),
    label = `#${num} ${id} "${words.length > 60 ? `${words.slice(0, 59)}…` : words}"`,
    again = cmd !== "learned" && noteState(n) === "check";
  try {
    console.log(`${label}: ${await DO[cmd](id)}`);
    if (again)
      console.log(
        "a 2nd answer: the creator has not checked your last one yet; they see both on the note",
      );
    console.log("next: bun run notes   the open notes left");
    await tell(project, {
      say: `${SAID[cmd]} note #${num}: ${what}`,
      notes: [id],
    });
  } catch (e) {
    // the note's state refused it (note-state.mjs): nothing was done, as with a wrong word
    console.error(`${e.message}. The notes yours to answer: bun run notes`);
    process.exit(2);
  }
} else {
  const why = !DO[cmd]
    ? cmd
      ? `"${cmd}" is no command here: done, ask, learned or restore`
      : "say done, ask or learned"
    : !key
      ? "which note? its id or number"
      : `${ARG[cmd]}? a few words after the id, not empty`;
  console.error(
    `${why}: bun run note ${DO[cmd] ? cmd : "done"} ID "${ARG[cmd] ?? ARG.done}" (ID as bun run notes lists it: mw6hr1fm, or 3; --help for all)`,
  );
  process.exit(2);
}
