// A note's life, decided in this one place: the studio's server writes with it, the page shows a change with it before the server
// has it, and the CLIs read the state with it.
//   open  --AI: fix (or ask)-->            check   the AI says it is fixed, or asks something; the creator looks
//   check --creator: approve-->            done    only a fix can be approved, a question wants an answer; a done note
//                                                  takes no fix until the creator reopens it
//   check | done --creator: again "words"--> open  needs work: the words join the thread, the note's own words stay
//   any   --creator: text "new words"-->   open    the old words go to edits
// done stays written beside state for scripts that only know it (notes_report.py, older film scripts): true whenever the note is
// not the AI's to work on. Notes from before states: done true is done, else open.
export const STATES = ["open", "check", "done"];
export const noteState = (n) => (STATES.includes(n.state) ? n.state : n.done ? "done" : "open");

const to = (n, state) => {
  n.state = state;
  n.done = state !== "open";
};
const lastFix = (n) => n.fixes?.at(-1);

const STEPS = {
  fix: (n, fix, at) => {
    if (typeof fix?.what !== "string" || !fix.what.trim()) return "a fix says what changed";
    if (noteState(n) === "done")
      return "this note is done, closed by the creator: it is yours again only when they reopen it";
    n.fixes = [...(n.fixes ?? []), { ...fix, at }];
    to(n, "check");
  },
  // a page loaded before states sends done:false for Reopen; an old film script done:true for "fixed"
  done: (n, done, at) =>
    !done
      ? to(n, "open")
      : noteState(n) === "done"
        ? undefined
        : STEPS.fix(n, { what: "marked done" }, at),
  approve: (n, _, at) => {
    if (noteState(n) !== "check") return "nothing to approve: the AI has not answered this note";
    if (lastFix(n)?.ask) return "the AI asked a question here: answer it (again) instead";
    n.approved = at;
    to(n, "done");
  },
  again: (n, text, at) => {
    if (typeof text !== "string" || !text.trim()) return "again takes the creator's words";
    n.asks = [...(n.asks ?? []), { text, at }];
    to(n, "open");
  },
  text: (n, text, at) => {
    if (typeof text !== "string") return "text takes the note's new words";
    if (text !== n.text) n.edits = [...(n.edits ?? []), { at, was: n.text }];
    n.text = text;
    to(n, "open");
  },
  remember: (n, scope, at) => {
    if (scope === null) delete n.remember;
    else if (scope === "film" || scope === "all") n.remember = { scope, at };
    else return 'remember takes "film", "all" or null';
  },
  learned: (n, learned, at) => {
    if (!n.remember) return "the creator never asked to remember this note";
    if (typeof learned?.what !== "string" || !learned.what.trim())
      return "learned says what was kept and where";
    n.learned = { what: learned.what, scope: n.remember.scope, at };
  },
};

// Applies one change ({fix}, {approve}, {again}, {text}, {remember}, {learned} or the old {done}) to the note in place
export const applyChange = (n, change, at = new Date().toISOString()) => {
  const keys = Object.keys(change);
  if (keys.length !== 1 || !STEPS[keys[0]])
    return { ok: false, why: `one of ${Object.keys(STEPS).join(", ")}, got ${keys.join(", ")}` };
  const why = STEPS[keys[0]](n, change[keys[0]], at);
  return why ? { ok: false, why } : { ok: true };
};

// The conversation on a note, oldest first: the creator's note, then each fix or question from the AI and each answer back
export const noteThread = (n) => [
  { by: "creator", text: n.text, at: n.at ?? "" },
  ...[
    ...(n.fixes ?? []).map((f) => ({
      by: "ai",
      text: f.what,
      at: f.at ?? "",
      ask: !!f.ask,
      checkpoint: f.checkpoint,
    })),
    ...(n.asks ?? []).map((a) => ({ by: "creator", text: a.text, at: a.at })),
  ].toSorted((a, b) => (a.at > b.at) - (a.at < b.at)),
];
