// The AI's answer on a note (fixed, a question, what it learned); HELP below
import { cliArgs, needFilm } from "./src/cli.mjs";
import {
  collectNewNotesAfterRead,
  formatNewNotesSinceRead,
  markDone,
  resolveNote,
  sendChange,
} from "./src/note-cli.mjs";
import { noteState } from "./src/note-state.mjs";
import { createNotes, noteNumbers, readDeletedNotes, readNoteRows } from "./src/notes.mjs";
import { tell } from "./src/tell.mjs";

const HELP = `The AI's answer on a creator's note; run inside the film. ID: as bun run notes lists it, the id (mw6hr1fm) or the number (3 or #3).
  bun run note done ID "what changed" --after <image>
                                            fixed with an After picture proving the fix (.png, .jpg, .webp).
                                            If the target moved or the note's original angle no longer shows it,
                                            capture from a custom pose (INSPECT=px,py,pz,lx,ly,lz,fov AT=<s> bun run render stills)
                                            and pass --cam px,py,pz,lx,ly,lz[,fov] --t <s> so clicking After flies straight there.
  bun run note done ID "what changed" --no-after "<reason>"
                                            fixed without an After image (e.g. sound-only or non-visual change): must state why.
                                            done ALWAYS requires exactly one of --after or --no-after.
  bun run note ask ID "your question"       not sure what they want: the question waits for their answer the same way
  bun run note learned ID "the rule, where" for a note they asked you to remember (bun run notes lists those): the
                                            lasting rule you drew and where you kept it (this film: src or lessons/,
                                            every film: ../../lessons/, nested .md ok), shown on their note
  bun run note restore NOTE_ID              recover a deleted note using its stable ID from bun run notes --deleted
Options for done (ask also accepts --after, --cam, --t; not --no-after):
  --after <path>                            After proof picture copied into notes/img/ alongside the note's Before shot
  --no-after "<reason>"                     done only: required when omitting --after to explain why no visual After image fits
  --cam px,py,pz,lx,ly,lz[,fov[,roll]]      Custom FreeCam pose for clicking After when the fixed view shifted
  --t <seconds|mm:ss>                       Custom playback second for After when timing/position shifted
If the creator added new notes while you worked on this note, done and ask print them automatically (closest to this moment first).
Read the open notes first: bun run notes (one in full: bun run notes ID; lesson matches return only file names and headings by line — read those files directly for full details).`;
const project = process.env.LIVE_PROJECT ?? process.cwd();
const rawArgs = cliArgs(HELP, null);
needFilm(project);

const VALUE_OPTS = new Set(["--after", "--no-after", "--cam", "--t"]);
const opts = {};
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (/^--?[a-z]/i.test(a)) {
    if (a.includes("=")) {
      console.error(`write ${a.replace("=", " ")}: a space between an option and its value, not =`);
      process.exit(2);
    }
    if (!VALUE_OPTS.has(a)) {
      console.error(
        `unknown option ${a}: supported options are --after, --no-after, --cam, --t (--help for all)`,
      );
      process.exit(2);
    }
    if (i + 1 >= rawArgs.length) {
      console.error(`${a} needs a value (--help for all)`);
      process.exit(2);
    }
    const next = rawArgs[i + 1];
    if (/^--[a-z]/i.test(next)) {
      console.error(`${a} needs a value before ${next} (--help for all)`);
      process.exit(2);
    }
    if (a in opts) {
      console.error(`${a} passed more than once`);
      process.exit(2);
    }
    opts[a] = next;
    i++;
    continue;
  }
  positional.push(a);
}

const [cmd, key, ...words] = positional;
const what = words.join(" ").trim();
// where the change went (note-cli.mjs sendChange): through the open studio, or straight into the file with none running
const HOW = {
  studio: "sent through the running studio",
  file: "written to notes/notes.jsonl, no studio running",
};
if (cmd === "restore") {
  if (!key || words.length || Object.keys(opts).length || !/^[a-z0-9]+$/.test(key)) {
    console.error(
      "Use the note ID shown by bun run notes --deleted (restore takes no --after/--cam options)",
    );
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
if (cmd === "learned" && Object.keys(opts).length) {
  console.error("learned takes no --after/--no-after/--cam/--t options");
  process.exit(2);
}
if (cmd === "ask" && opts["--no-after"] !== undefined) {
  console.error("ask takes no --no-after option");
  process.exit(2);
}
const DO = {
  done: async (id) => {
    const via = await markDone(project, id, what, {
      after: opts["--after"],
      noAfterReason: opts["--no-after"],
      cam: opts["--cam"],
      t: opts["--t"],
    });
    const proof = opts["--after"]
      ? "with after picture"
      : `no after picture (${opts["--no-after"].trim()})`;
    const custom = opts["--cam"] || opts["--t"] ? "; custom after view saved" : "";
    return `waits for the creator's check (${HOW[via]}; ${proof}${custom}): Approve, or Needs work with their words`;
  },
  ask: async (id) =>
    `your question waits for the creator's answer (${HOW[await markDone(project, id, what, { ask: true, after: opts["--after"], cam: opts["--cam"], t: opts["--t"] })]}); it comes back in bun run notes with it`,
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
    if (cmd === "done" || cmd === "ask") {
      const added = collectNewNotesAfterRead(project, id, { consume: true });
      if (added.length) console.log(`\n${formatNewNotesSinceRead(project, id, added)}`);
    }
    console.log("next: bun run notes   the open notes left");
    await tell(project, {
      say: `${SAID[cmd]} note #${num}: ${what}`,
      notes: [id],
    });
  } catch (e) {
    // state refusals point back to bun run notes; missing flags/files stand on their own clear message
    const suffix = /^(this note is done|no such note|note #\d+)/.test(e.message)
      ? ". The notes yours to answer: bun run notes"
      : "";
    console.error(`${e.message}${suffix}`);
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
  const suffix = cmd === "done" ? ' (--after <image> | --no-after "<reason>")' : "";
  console.error(
    `${why}: bun run note ${DO[cmd] ? cmd : "done"} ID "${ARG[cmd] ?? ARG.done}"${suffix} (ID as bun run notes lists it: mw6hr1fm, or 3; --help for all)`,
  );
  process.exit(2);
}
