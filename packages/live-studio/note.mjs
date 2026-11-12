// The AI's answer on a note (fixed, a question, what it learned); HELP below
import { cliArgs, needFilm } from "./src/cli.mjs";
import { markDone, resolveNote, sendChange } from "./src/note-cli.mjs";

const HELP = `The AI's answer on a creator's note; run inside the film. ID: as bun run notes lists it, the id (mw6hr1fm) or the number (3 or #3).
  bun run note done ID "what changed"       fixed: the note waits for the creator's check in the studio (Approve, or
                                            Needs work with words, which brings it back to bun run notes)
  bun run note ask ID "your question"       not sure what they want: the question waits for their answer the same way
  bun run note learned ID "the rule, where"  for a note they asked you to remember (bun run notes lists those): the
                                            lasting rule you drew from it and where you kept it, shown on their note
Read the open notes first: bun run notes (one in full: bun run notes ID).`;
const project = process.env.LIVE_PROJECT ?? process.cwd();
const [cmd, key, ...words] = cliArgs(HELP, null);
needFilm(project);
const what = words.join(" ").trim();
const DO = {
  done: async (id) =>
    `${id} waits for the creator's check (${await markDone(project, id, what)}). Other open notes: bun run notes`,
  ask: async (id) =>
    `${id}: your question waits for the creator's answer (${await markDone(project, id, what, true)}); it comes back in bun run notes with it. Other open notes: bun run notes`,
  learned: async (id) =>
    `${id}: kept as learned (${await sendChange(project, id, { learned: { what } })}); the creator sees it on the note. bun run notes`,
};
const ARG = { done: "what changed", ask: "your question", learned: "the rule, where you kept it" };
if (DO[cmd] && key && what) {
  let id;
  try {
    id = resolveNote(project, key);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  try {
    console.log(await DO[cmd](id));
  } catch (e) {
    console.error(`${e.message}. The notes yours to answer: bun run notes`);
    process.exit(1);
  }
} else {
  const why = !DO[cmd]
    ? cmd
      ? `"${cmd}" is no command here: done, ask or learned`
      : "say done, ask or learned"
    : !key
      ? "which note? its id or number"
      : `${ARG[cmd]}? a few words after the id, not empty`;
  console.error(
    `${why}: bun run note ${DO[cmd] ? cmd : "done"} ID "${ARG[cmd] ?? ARG.done}" (ID as bun run notes lists it: mw6hr1fm, or 3; --help for all)`,
  );
  process.exit(2);
}
