# The creator's notes

The creator watches the film in the studio and pins notes to a second, with pictures. The AI reads them, fixes, and answers; the creator approves.

## The note loop

Inside a film:

```bash
bun run notes                                # the open notes, one line each (up to 25; --limit 0 for all, --sort back for creator replies first)
bun run notes 3                              # one in full: where they tapped, the words, actions, version, pictures
bun run notes --shot 3                       # open notes of one shot (up to 25; --help for all flags)
bun run at '#3'                              # where note 3 is heard now, and every row there
                                             # fix it, then look at the new frames (references/review.md)
bun run note done 3 "what changed"           # the note waits for the creator's check
bun run note ask 3 "your question"           # unsure what they want: the question waits the same way
bun run note learned 3 "the rule, where kept"   # for a note they asked you to remember, once the rule is kept
```

## States

| State    | Meaning                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| `open`   | The AI's to work on                                                                                             |
| `check`  | The AI said it is fixed, or asked; the creator looks                                                            |
| `done`   | The creator approved; it takes no fix until they reopen it                                                      |
| Reopened | The creator chose Needs work with words, or changed the note's words: back to `open`, the words join the thread |

A reopened note tags its index line (`[back to you]` or `[back to you: reworded]`, brought to the top with `--sort back`) and heads its detail with why it is back (`BACK TO YOU: the creator answered` or `reworded it after your answer`); its thread reads in the order things happened, so a rewording after your fix shows the words your fix answered. Lists default to the first 25 matching notes and summarize hidden replies and shots (`--limit 0` for all).

`#N` counts every note ever written, the ones the creator deleted too: a number never moves to another note, and answering a deleted one says so. The answer prints `#N id "words"`: check it is the note you meant.

## Lessons: what a note teaches

`bun run notes ID` names the files in `lessons/` (the repo root, every film's) that Jev picks for the note's words and the creator's answers, each with its headings by line: open the lines you need. When the creator asks to remember a note (Remember: this film, or every film), keep the rule where it lasts: in code if it can be (a default, a check that fails), else in `lessons/<topic>.md` for every film or in the film's `src` beside what it rules for this film. Jev finds a lesson file by its path, its `when:` frontmatter line and its headings only, so each rule is a heading that says it. Then `bun run note learned ID "the rule, where"`; the creator sees it on the note.

Never edit `notes/notes.jsonl` by hand. A note keeps the second it was written at; a later Speed or Freeze edit moves where it is heard, and `bun run at '#N'` works that out.
