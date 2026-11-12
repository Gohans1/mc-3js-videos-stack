# Narration

## The voice loop

Inside a film, after writing the takes in `src/edit.json` `"takes"` (English Audio Tags in brackets, such as `[tense, hushed]`):

```bash
bun run voice:gen --dry-run                  # which takes, how many characters, which voice; sends nothing
bun run voice:gen                            # every take with no audio yet, into voice/takes (spends credits)
bun run voice:gen intro_2                    # that take again, replacing its audio
bun run voice:gen --try intro_2 --takes 3    # three new tries in voice/try/intro_2_<n>.mp3, the take kept
bun run voice:assemble                       # full_voice.wav, voice.lines, one Phrase Brick per take in audio.json
bun run voice:cues                           # the heard second of every line, word and gap, and the pace
```

Takes of one voice are generated in story order so neighbours share prosody. Which voice suits which film: the `gohans-3js-videos-skills` skill.

A Phrase Brick moved by hand in the studio is kept by `voice:assemble`; `--clips` rewrites it.

## Reading pace

| `voice:cues` shows        | Meaning                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pace` about 120-160 wpm  | A narrated documentary's pace                                                                                            |
| An `x` after a line's wpm | The narration follows the picture's Speed or Freeze there (`timing.json` `layerKinds.voice`); over about 1.1x words blur |
| A word's seconds          | Heard seconds: where to put a cut, a sound or a title on that word; `bun run at` converts to scene seconds               |
