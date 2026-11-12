# The creator's notes

The creator watches the film in the studio and pins notes to a second, with pictures. The AI reads them, fixes, and answers; the creator approves.

## The note loop

Inside a film:

```bash
bun run notes                                # the open notes, one line each, #1 written first
bun run notes 3                              # one in full: where they tapped, the words, actions, version, pictures
bun run notes --shot 3                       # every open note of one shot
bun run at #3                                # where note 3 is heard now, and every row there
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

Never edit `notes/notes.jsonl` by hand. A note keeps the second it was written at; a later Speed or Freeze edit moves where it is heard, and `bun run at #N` works that out.
