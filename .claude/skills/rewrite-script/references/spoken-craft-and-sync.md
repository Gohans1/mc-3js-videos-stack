# Spoken Craft, Kinesic Sync & Syllable Isochrony

## 1. Writing for the Ear (NPR / BBC Broadcast Laws)

Listeners on YouTube Shorts cannot rewind or scan a paragraph. Every line must
click on the first pass:

- **One idea per spoken sentence.** Break nested print clauses (`"while...,
  which..., because..."`) into crisp, forward-moving beats.
- **Short subject-to-verb distance.** Put the actor and action together right
  away (`"His boot clipped her helmet"` beats `"The other diver's leg, moving
  rapidly through the air, made contact with her helmet"`).
- **Everyday spoken vocabulary (Grade 4–6 / CEFR A1–A2).** Prefer concrete,
  high-frequency words (`black out`, `wake up`, `poison`, `sign up`, `fake`)
  over formal or print words (`unconscious`, `venomous`, `enlistment`,
  `gibberish`, `certainty`, `eventually`).
- **Natural contractions & Mouth Edit.** Use `didn't`, `couldn't`, `it's`,
  `won't`. Avoid consonant clusters (`"sixth stretched strap"`) and ambiguous
  pronouns when two people share a scene (`he/he` → name roles: `her dad`,
  `the captain`, `the officer`).
- **Don't Goodhart plain words.** Never replace a simple everyday word (`open`,
  `fall`, `pull`) with an awkward thesaurus word (`unfold`, `descend`, `tug`)
  just to dodge similarity — restructure the sentence instead.

## 2. Viral Shorts Retention Structure

- **Frame-0 Grounded Hook (first 2–3 seconds):** Anchor directly to the opening
  visual and raise an instant concrete stake or curiosity gap. Zero meta intros
  (`"Today we're going to talk about..."`, `"Did you know..."`).
- **Causality Chain (`But / So / Until`):** Connect beats by cause and
  escalation, never flat `"and then... and then..."` lists.
- **Bursty Cadence (`CV >= 0.25`):** Mix short punch lines (`4–7` words) with
  medium explanatory beats (`10–16` words). Uniform 11-word sentences sound
  robotic.
- **Zero See-Say Redundancy:** Anchor the visible action briefly, then explain
  the hidden cause, stakes, or consequence that the picture alone cannot tell.
- **Organic Payoff Echo:** Close cleanly on the final visual beat with no filler
  sign-off (`"Like and subscribe"`, `"Crazy right?"`).

## 3. Why Syllable/Duration Isochrony Beats `±1 Word`

Controlled speech-rate and dubbing research (TACL 2023 *Dubbing in Practice*,
319.57h human dubbing; Tilsen & Tiede 2023 *Speech Communication*) shows:

1. **Word count barely predicts spoken time (`r = 0.279`, `r² = 0.078`).**
   Spoken duration scales with **phonemes and syllables**, not words.
2. **The Plain-Language Paradox:** Turning jargon into Grade-4 English
   *increases* word count while keeping or *reducing* syllable count:
   - `"anticoagulants"` = `1 word / 6 syllables`
   - `"stuff that keeps blood thin"` = `5 words / 5 syllables` (faster AND 10x clearer!)
   - `"unconscious"` (`1w / 3syl`) → `"out cold"` (`2w / 2syl`)
   - `"venomous"` (`1w / 3syl`) → `"deadly"` (`1w / 2syl`) or `"poison"` (`1w / 2syl`)
3. **Bad Source Pacing Trap:** If a source Short crammed 22 words into 5 seconds
   (`264 WPM`), copying `±1 word` copies a flop pace (`180–199 WPM` is a proven
   retention cliff).

### Time-First Syllable Budget Formula

For each visual slot `[slot_start, slot_end]`:

```text
slot_dur         = slot_end - slot_start
usable_slot_sec  = max(0.35, slot_dur - planned_pause_sec)
target_syllables = usable_slot_sec * target_sps
est_spoken_sec   = actual_syllables / target_sps
fill_ratio       = est_spoken_sec / usable_slot_sec
```

- **Default `target_sps`:** `3.6 syl/s` empirically calibrated on `N = 5` Shorts
  for calm matter-of-fact storytelling (`Rasalgethi` `m1_steady_story`,
  measured mean `3.58 syl/s`, `~155–175 WPM`); `4.2–4.4 syl/s` for fast urgent
  narration.
- **Healthy `fill_ratio`:** `0.82–1.05` (allows natural `1.00x` read with zero
  or minimal `atempo` adjustment `<= 1.08x`).
- **Hard WPM Ceiling:** `< 180 WPM` full-script (`<= 4.7 syl/s` peak beat).

## 4. Pause & Tail Hygiene (Continuous Momentum Without Fatigue)

- **Opening Attack:** `<= 0.25s` (target `0.05–0.15s`, `[Hard Stop]`).
- **Routine Inter-Beat Transitions:** `0.12–0.30s` with organic variation.
- **Earned `[SFX_BEAT]` Pause (`sfx_beat_before: true`):** Max 1–2 per Short,
  `0.30–0.55s` (up to `0.75s` only for a real visual shock/SFX impact). Always
  sit on continuous room tone or BGM — never digital `-inf dBFS` silence. When
  running `aistudio-tts` `post-process.py` on an unsliced take with an
  intentional `>260ms` `[SFX_BEAT]`, pass `--no-gap-trim`.
- **Dead-Air Gate:** `> 0.50s` without `sfx_beat_before: true` = FAIL; `> 0.75s`
  anywhere = Hard FAIL.
- **Closing Tail:** Target `0.25–0.75s` (`<= 0.50s` for seamless loops), warn
  `> 0.80s`, Hard FAIL `> 1.00s` or speech overflow `< 0.0s`.

## 5. Kinesic Action-to-Scene Lock & Long-Shot Decomposition

- **Action Anchors (`anchors[]`):** Pin key spoken action phrases within
  `±0.25s` of the on-screen cut or contact frame (slight `-0.10s` verbal lead
  feels sharpest; flag drift `> 0.30s`).
- **Long Unbroken Shots:** If `shots.json` has a single 10–20s shot containing
  multiple visual beats (e.g., reading a menu → brain cutaway → finger raised →
  food arrives → blank page), split it into separate `beats[]` timed to each
  **internal visual event**, not just the outer shot cut.
- **P2 Flow vs P3 Action Lock Tie-Breaker:** On a `1.5s` visual hold between
  actions, do NOT stay silent (breaks P2) and do NOT announce the next shot
  early (breaks P3). Fill the hold with a short cause/stakes bridge, then hit
  the next action phrase right on the cut.

## 6. Display Captions (`after`) vs. Clean-Read TTS (`tts_text`)

Keep on-screen captions crisp and scannable (`45 jars`, `1904`, `$50`, `45%`),
while expanding symbols/numbers in `tts_text` so TTS pronounces them cleanly
without stumbles:
- `45 jars` → `forty-five jars`
- `1904` → `nineteen oh four`
- `45%` → `forty-five percent`
- `$50` → `fifty dollars`
- `6-year-old` → `six-year-old`
- `GTA 6` → `GTA six`
