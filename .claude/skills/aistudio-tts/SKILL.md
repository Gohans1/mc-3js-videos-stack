---
name: aistudio-tts
description: Direct and export speech in Google AI Studio's Generate Speech playground. Use for Gemini 3.8 Flash TTS or Flash-Lite TTS, narration and two-speaker dialogue for video, speech blocks, delivery styles, expressions, browsing and auditioning voices, favorites, voice design, remix and replication controls. Use aistudio for chat and History.
---

# aistudio-tts

Run `bun .claude/skills/aistudio-tts/scripts/cli.ts --help` from the repo root. In the examples, `TTS` stands for `bun .claude/skills/aistudio-tts/scripts/cli.ts`.

Use a distinct `--tab tts-<job>` per job and the same label for every step on that job. The CLI reuses the existing [AI Studio Chrome profile](../aistudio/SKILL.md). Default model is `gemini-3.8-flash-tts`. `open --model <id>` selects another TTS model on a fresh tab. An explicit `--account <slot>` is checked against the browser's actual destination. Omit the slot to use the profile's default account.

## Make a take

1. Run `TTS --tab tts-scene open`. Save the screenplay as JSON before opening it in the editor.
2. Run `TTS --tab tts-scene apply scene.json`. To edit interactively, use `start`, `block-add`, `text <block> <file>`, `style <block> <direction>`, `preset <block> <name>`, and `expression <block> [name]`. `status` reads the live editor.
3. Run `TTS --tab tts-scene run --out voice/takes/take-01.wav --timeout 180`. Use another output path for each take. `collect --out <new-path.wav>` reads completed audio from that same tab without submitting again. Keep the tab open through export and review.
4. Listen to the WAV before using it in the film. Check pronunciation, pause length, speaker changes, expression timing, and delivery against the screenplay. Give each block a short acting direction and place vocal tags in the text where the sound should occur.

`scene.json` can specify `temperature` and up to two `voices` by their displayed names. `blocks` are ordered and use `text`, optional `style`, and optional `speaker` to assert the UI's alternating speaker slots.

```json
{
  "temperature": 0.8,
  "voices": ["Fola", "Rami"],
  "blocks": [
    {"speaker": 1, "style": "Quiet, tense, with a deliberate pause", "text": "Đừng mở cửa. <short pause> Nghe đi."},
    {"speaker": 2, "style": "A sudden whisper", "text": "<gasp> Có ai ở bên ngoài."}
  ]
}
```

## Work with voices

- Open `library 1` or `library 2` for a speaker, or `library 3 --block` for the voice used by block 3. The second speaker appears after adding a second block.
- Use `voices` to inspect visible groups and current results or `voices "Fola"` to search. `filter "Use case"` lists options. `filter "Use case" "Storyteller"` picks one. The same syntax applies to Language, Gender, Pitch, and Style. Use the live `All …` option to clear a filter.
- Use `sample "Fola"` to play a catalog sample in the browser, `favorite "Fola" on` to save a favorite, and `voice "Fola"` to assign it. Add `--out fola-sample.wav` to save a public catalog sample locally for listening. Use `library-close` to return to the editor.
- Use `voice-create design`, `voice-create replication` or `voice-create remix "Fola"` to enter the available forms. A paid-key gate is reported as a failed step and stays open for inspection. Use `snapshot` and `ui` for controls the account exposes. Replicate a voice only with the rights and consent to do so. Complete Google's microphone and consent prompts in the browser.

## Inspect and recover

Progress and errors go to stderr. `--json` puts successful structured results on stdout. Exit `2` means invalid input. Exit `1` names the failed step and attempts to capture a screenshot. After an interrupted apply, keep the source JSON and inspect `status` to see what reached the editor. The `audioPhase` field distinguishes generation, streaming, and a ready take.

Use `snapshot` for changing or model-specific UI such as starter templates, playback, voice forms, catalog group expansion, and Get code language selection. `code` prints the active generated snippet. `ui click e42` and `ui fill e43 "text"` use references from a fresh snapshot of the same tab. Read the returned snapshot before the next action. The browser must complete microphone, permission, and consent prompts that live outside the page.

If Google changes a label or page layout, use `map` and `doctor` and follow [the UI repair guide](references/ui-changes.md).
