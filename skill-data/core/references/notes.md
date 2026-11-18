# The creator's notes

The creator watches the film in the studio and pins notes to a second, with pictures. The AI reads them, fixes, and answers; the creator approves.

## The note loop

Inside a film:

```bash
bun run notes                                # the open notes, one line each (up to 25; --limit 0 for all, --sort back for creator replies first)
bun run notes 3                              # one in full: where they tapped, the words, actions, version, pictures
bun run notes --shot 3                       # open notes of one shot (up to 25; --help for all flags)
bun run notes --shot 3 --json                # selected notes and total as JSON, without Jev
bun run notes --deleted                     # recoverable deleted notes; --json works here too
bun run note restore mw6hr1fm                # restore by the stable ID from the deleted list
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

In JSON, recordedTime is the saved playback second. Use bun run at ID for the current position after timing edits.

When Studio is closed, run note writes one at a time. With Studio running, the commands send writes through Studio.

Use Jump to frame on a single-note toast and Back to previous frame in the player. Review can copy a link to that note in the same Studio.

Studio shows a toast when a note is answered or approved elsewhere. With AI activity on, the note or its tab lights up, and desktop notices have their own row at the bottom of Studio.

Timeline edits light their tab and the affected track or clip where Studio can identify it. Open AI activity history for the file or command. Sound is optional in Settings and plays only for actions needing attention while Studio is quiet.

## Lessons: what a note teaches

Trong Lessons > AI Inspector, Note for AI hiển thị phần note gửi cho AI, Extracted lessons hiển thị nội dung trích từ Deck và More views mở payload Jev. Preview miễn phí, chọn lại file để khôi phục file đã loại tạm.

Bật Jev calls rồi bấm Run Jev để gửi yêu cầu (tuyến trả phí có thể tính tiền). Save CLI settings lưu cấu hình vào notes/lessons-config.json, tắt Allow Jev from the notes CLI để CLI chỉ dùng cache.

`bun run notes ID` names the files in both this film's `lessons/` and the repo root's `../../lessons/` (every film's, including nested `.md` subfolders) that Jev picks for the note's words and the creator's answers, each with its headings by line: open the lines you need. When the creator asks to remember a note (Remember: this film, or every film), keep the rule where it lasts: in code if it can be (a default, or a check that fails), else in the film's `src` or `lessons/<topic>.md` for this film, and `../../lessons/<topic>.md` for every film (nested `folder/file.md` names using letters, digits, `-` and `_` appear in the studio too). Jev reads paths, frontmatter and headings by default; Inspector controls which content is included. Then `bun run note learned ID "the rule, where"`; the creator sees it on the note.

Never edit `notes/notes.jsonl` by hand. A note keeps the second it was written at; a later Speed or Freeze edit moves where it is heard, and `bun run at '#N'` works that out.
