# AI Studio TTS: Voice Casting, Direction & Production Guide

Empirically verified voice notes, prompting levers, tag hygiene, and production pitfalls for Google AI Studio Generate Speech (`gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`), combining Google's official 3.8 TTS Developer Guide with live session audits. Treat these as tested starting points and guardrails—not a closed voice list. Audition freely, explore the 2,000+ Extended Voice Library, or use Voice Design / Remix when a film calls for a different character.

## Audited Voice Roster (`gemini-3.8-flash-tts`)

Measured directly from exported catalog WAVs (`sample "<Name>" --out ...`) and verified by ear. Use these to shortcut casting when you know the register you want.

| Voice | Catalog Group & UI Label | Heard Gender & Acoustic Profile | Vibe & Best Fit | Notes / Watch-outs |
| --- | --- | --- | --- | --- |
| **Koda** | Commercial Voiceover · *Direct and helpful · Medium-low* | Male · `F0 ~141–144 Hz`, warm (`~59%` 80–250 Hz), crisp clarity | Young-to-mid US male; nimble, engaging explainer / Zack D. Films-style Shorts | Very responsive to pace words in `style` (`brisk` vs `slightly slower`). Strong default for fast-paced Shorts narration. |
| **Cruz** | Professional · *Poised and professional · Deep* | Male · `F0 ~97 Hz`, wide expressive spread (`p10–p90: 75–168 Hz`), bright studio top-end | Deep, close-mic YouTube documentary narrator with natural melodic lift | Holds authority without sounding robotic at brisk documentary pacing (`~160–195 WPM`) when directed away from stiffness. |
| **Rami** | Podcast · *Warm and approachable · Low* | Male · `F0 ~120–121 Hz`, conversational mid-low | Relaxed, friendly storyteller / podcast host | Slightly warmer and looser than `Koda`; solid backup for warmer narrative Shorts or two-speaker banter. |
| **Enzo** | Storyteller · *Crisp and eager · Low* | Male · `F0 ~111–115 Hz` (`85–142 Hz`), clean `-73 dBFS` floor | Eager, articulate late-20s essayist / explainer | Deeper and warmer than `Koda`, slightly brighter and more casual than `Cruz`. |
| **Ludo** | Instructional · *Confident and clear · Low* | Male · `F0 ~104–106 Hz` (`88–130 Hz`), narrower pitch range / flatter LRA | Crisp, steady instructional voice | Clean diction, but sounds slightly older and flatter than `Koda` or `Cruz` unless `style` pushes inflection. |
| **Daro** | Call Center · *Confident and clear · Low* | Male · `F0 ~109–110 Hz`, tight spread | Steady, composed baritone | Leans formal/corporate by default; works better for deadpan or briefing tones. |
| **Elio** | Professional · *Calm and comforting · Medium* | Male · `F0 ~117 Hz`, lighter/brighter (`~20%` low-end warmth) | Soft, gentle calm explainer | Noticeably thinner low end than `Koda`/`Enzo`; fits calm, low-aggression explainers. |
| **Riko** | Storyteller · *Confident and clear · Deep* | Male · `F0 ~91–92 Hz` (`76–126 Hz`), heavy bass-baritone | Very deep, weighty narrator | Narrower melodic swing than `Cruz`; `sample "Riko"` occasionally fails to signal playback in the UI. |
| **Sami** *(trap)* | Storyteller · *Cool and confident · Low* | **Female** · `F0 ~153 Hz` (`122–204 Hz`) | Cool, confident female alto storyteller | Frequently surfaces in low-pitch/Storyteller lists—always audition by ear before assuming gender. |
| **Olin** *(trap)* | Digital Assistant · *Light and precise · Low* | **Female** · `F0 ~128–133 Hz`, warm (`~67%` low-end) | Precise, low-register female voice | Labeled `Low pitch`, actually female on playback. |

### Beyond the Audited Shortlist

- **30 default catalog voices** (`Fola`, `Koda`, `Cruz`, `Enzo`, `Rami`, `Ludo`, `Bodi`, etc.) span 10 use-case groups (`Tutor`, `Commercial Voiceover`, `Instructional`, `Podcast`, `Storyteller`, `Digital Assistant`, `Call Center`, `Concierge`, `Tech Support`, `Professional`). By default each group shows 3 voices behind `View all`—run `voices --all` or search by name (`voices "<query>"`) to see more. Note that the 3.8 playground uses its own default roster rather than legacy 2.5/3.1 names like `Charon`/`Orus`, though some names such as `Achird` and `Zubenelgenubi` still surface under filters.
- **Extended Voice Library**: Over 2,000 regional accents and dialects via search/filters.
- **Voice Design / Remix / Replication**: Available for bespoke character voices when the active profile has a linked paid key (see `SKILL.md`).
- **Casting against a reference track**: Measure the reference voice (`F0` median/spread, warmth, WPM) **and** listen to it directly (`read_file` on WAV), export 3–5 candidate samples with `sample "<Name>" --out <path.wav>`, listen directly to each sample, then run a 10–15s test take on real script lines before locking one voice.
- **CLI filter tip**: Run `filter "Gender"` or `filter "Language"` with no value first to read the exact live option labels before selecting—guessed strings fail if Google renames an option.

## Directing Gemini 3.8 Flash TTS

Gemini 3.8 strictly separates **who**, **how**, and **what**. Never put stage directions inside `text` (unlike older 3.1 prompts); `text` is spoken verbatim except for `<vocal tags>`, `|backchannels|`, and `/IPA/`.

| Layer | Role | Practical Guidance |
| --- | --- | --- |
| `voices` | Identity / timbre | Pick a voice whose natural pitch and warmth already sit near your target—don't force a deep bass to act like a bright tenor. |
| `style` | Block-level acting & pace | Keep concise (~10–18 words): persona + pace + breath/pause cue + ending cadence. Test `style: ""` first as a baseline—3.8 already reads punctuation and context well. |
| `text` | Verbatim spoken script | Clean spoken English (or target language) with natural punctuation; place `<...>` tags and `|...|` only where a non-verbal event belongs. |
| `temperature` | Expressiveness vs stability | `0.60–0.70` for tight, consistent Shorts narration; `~0.75` for long-form documentaries needing melodic lift; `0.80+` for theatrical dialogue. |

### Style Levers & Traps Verified in Production

- **Avoid `"YouTube Shorts"` in `style` when you want normal conversational pace**: Including `"YouTube Shorts"` spiked `Koda` to `182–190 WPM` (`28–29s` on a 90-word script). Removing it and writing `"slightly slower steady conversational pace"` landed right at `~155 WPM` (`34.7s`). Conversely, adding a single word (`"brisk"`) cleanly tightened a `31.4s` read down to `28.3s`.
- **Kill AI uptalk on endings**: Phrases such as `"flat matter-of-fact endings"` or `"grounded falling endings"` prevent rising ad-read cadence at the end of declarative statements.
- **Shift tone mid-scene with multiple blocks**: Instead of cramming conflicting moods into one long `style`, split consecutive turns for the same speaker (e.g., hushed whisper → sudden shout → out-of-breath calm) so each block gets its own `style`. Assign the same voice to both slots (`"voices": ["Cruz", "Cruz"]`) when using multiple blocks for one narrator.
- **Example starting styles (adapt freely)**:
  - *Calm, curious Shorts explainer (~150–165 WPM)*: `"Clear, curious explainer narrator, steady conversational pace, crisp articulation, short natural breaths, flat matter-of-fact endings"` (`temperature: 0.60–0.70`).
  - *Brisk narrative Short*: `"Calm, matter-of-fact documentary narrator, brisk steady storytelling pace, clear articulation, grounded falling endings"` (`temperature: 0.70`).
  - *Engaging long-form documentary*: `"Crisp, brisk YouTube documentary narrator, fast engaging pace, tight pauses, close-mic studio clarity, curious lift on questions, grounded punch on key facts"` (`temperature: 0.75`).

## Inline Vocal Tags, Backchannels & Script Hygiene

- **Vocal tags (`<...>`)**: Always write tags in **English** even for non-English scripts (`<gasp>`, `<sigh>`, `<laugh>`, `<chuckle>`, `<cough>`, `<short pause>`, `<pause>`). Tags trigger once at the exact word position rather than coloring the whole block.
- **Skip `<short pause>` in tight narration/documentaries**: Sprinkling `<short pause>` tags + em-dashes stretched a 50-word documentary test clip by `+3s` (`18.6s -> 21.5s`) and broke conversational momentum. Use plain punctuation (`.` `,`) for natural micro-rhythm and shape longer scene pauses via timeline **Phrase Bricks** instead. Reserve `<...>` tags for expressive acting where the non-verbal sound genuinely belongs.
- **Two-speaker `|backchannel|` pipes**: In two-speaker scenes, wrapping 1–3 words in pipes (`|mhm|`, `|wait, what?|`, `|no way|`) inside Speaker 1's `text` has Speaker 2 overlap naturally without slicing the line into extra turns.
- **Spell numbers, years & acronyms for speech**: Keep display formatting in captions (`GTA 6`, `99`, `2013`, `3D`), but write clean spoken forms in TTS `text` (`GTA six`, `ninety-nine`, `twenty thirteen`, `three-D`).
- **Fix pronunciation via phonetics or `/IPA/`**: For tricky proper nouns or names, either spell phonetically (`Leoneeda`) or use Gemini 3.8's native `/IPA/` syntax (`/liːəˈniːdə/`).
- **Rewrite fast-speech slurs heard on playback**: If a clean phrase blurs at speed (e.g., `"a clinic lay"` sounding like `"clinically"`, or `"rowboat"` sounding like `"robot"`), swap to cleaner words (`"a hospital sat"`, `"a small boat"`) and regenerate rather than trying to EQ around it.

## Generation Strategy & QA Guardrails

- **Shorts (`<= 60s`) — one contiguous pass**: Generate the full narration in a single block so timbre, pitch floor, and room breath stay seamless across every sentence. Align with WhisperX, then slice at true silent troughs (`<= -70 dBFS`) into scene-aligned Phrase Bricks at `rate: 1.0`. Only use formant-preserving Rubber Band R3 within `<= ±5%` when strictly needed.
- **Long-form (`> 60s`) — beat-anchored takes**: Split by scene beats, freeze one invariant `style` + `temperature` across all takes, and use `TTS --tab tts-batch batch manifest.json` to reuse one tab and voice setup in a single process. If a take overruns its slot by `>5–6%`, trim/tighten the script and regenerate instead of aggressively time-stretching.
- **Always listen directly to exported WAVs**: Inspect takes and the final mix directly (`read_file` on WAV). WhisperX logs and `earshot` numbers alone miss subtle mispronunciations and mid-word tail cutoffs.
- **Protect word tails**: Never run aggressive silence-tail trimming (`trimTail`) without checking the final ~300ms RMS; keep safe head/tail buffers and apply `10–15ms` micro-fades on splices.
- **Windows CLI stability**: Prefer `speak` / `batch` (single Bun process) so Chrome stays inside one Windows `exebox` session, and avoid launching heavy CPU WhisperX jobs concurrently with active CDP calls (see `SKILL.md` for `--keepalive` and tab limits).
