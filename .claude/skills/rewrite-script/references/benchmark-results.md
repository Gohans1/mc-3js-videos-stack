# Empirical Verification Benchmark (`N = 5` Real Shorts + 2 Adversarial Evals)

All 5 benchmark runs were executed **strictly read-only** against existing monorepo films (zero edits inside `films/*`; all scratch WAVs, WhisperX alignments, preview MP4s, and extracted frames written to isolated scratch storage) using the locked channel default voice (`Rasalgethi`, `gemini-3.8-flash-tts`, `m1_steady_story`, `t=0.65`, `--backend api`, `post-process.py --preset rasalgethi`, WhisperX GPU alignment).

## 1. `N = 5` Diverse Film Cohort Results (Pass-1 Clean-Room Rewrites)

| Film | Res | Dur | Words (Before→After) | Syl (Before→After) | Burstiness CV | Anti-Copy (4g / c3g / Jacc / ROUGE-L) | Measured Spoken WPM | Actual SPS (span) | Max Untagged Gap | Opening Attack |
|---|---|---|---|---|---|---|---|---|---|---|
| `skydiver-unconscious` | `720x1352` | `34.23s` | `94 → 99` (`+5`) | `128 → 111` (`-17`) | `0.314` | `0 / 0 / 0.122 / 0.159` | `182.6` | `3.50` | `0.455s` | `0.111s` |
| `dreaming-test` | `1080x1920` | `36.23s` | `90 → 103` (`+13`) | `122 → 121` (`-1`) | `0.285` | `0 / 0 / 0.095 / 0.081` | `176.9` | `3.49` | `0.354s` | `0.050s` |
| `girl-joined-navy` | `1080x1920` | `30.50s` | `88 → 89` (`+1`) | `118 → 105` (`-13`) | `0.377` | `0 / 0 / 0.054 / 0.096` | `179.6` | `3.58` | `0.450s` | `0.120s` |
| `food-eat-more` | `1080x1920` | `54.80s` | `141 → 146` (`+5`) | `192 → 179` (`-13`) | `0.409` | `0 / 0 / 0.112 / 0.100` | `166.5` | `3.54` | `0.455s` | `0.140s` |
| `bomb-under-bed` | `720x1352` | `47.13s` | `136 → 135` (`-1`) | `184 → 169` (`-15`) | `0.436` | `0 / 0 / 0.059 / 0.050` | `177.4` | `3.79` | `0.455s` | `0.050s` |

## 2. Key Empirical Findings & Calibrations Applied to This Skill

1. **Empirical `target_sps` Calibration (`3.9 → 3.6 syl/s`):**
   - Across all 5 `Rasalgethi` `m1_steady_story` takes (post-processed), real spoken span rate averaged **`3.58 syl/s`** (`median 3.54`, range `3.49–3.79`).
   - Switching `default target_sps` from guessed `3.9` to empirically calibrated **`3.6 syl/s`** cuts mean duration prediction error from **`9.0%` down to `~2.4%`** and catches tight beats (like `skydiver b2`, `navy b7`, `bomb b9`) **before** generating TTS.
2. **Plain-Language Paradox Proved (`4/5` Films):**
   - On 4 out of 5 films, replacing formal/print words (`unconscious`, `gibberish`, `certainty`, `venomous`, `civilian`, `enlistment`, `ingredients`, `eventually`) with everyday Grade 4–5 English **increased word count (`+1` to `+13` words) while reducing syllable count (`-1` to `-17` syllables)**.
   - Enforcing a rigid `±1 word` rule would have falsely rejected 4 out of 5 cleaner, faster-to-speak scripts.
3. **Anti-Goodhart Originality Distribution (`5/5` Clean-Room):**
   - Genuine Clean-Room 2-Pass rewrites scored **`0`** exact 4-grams, **`0`** lemmatized 3-content-word overlaps, **`0.054–0.122`** full-script Jaccard (`mean 0.088`, ceiling `0.32`), and **`0.050–0.159`** content ROUGE-L F1 (`mean 0.097`, ceiling `0.35`) — zero awkward thesaurus swaps needed.
4. **Spoken Lexicon Calibration (`Zipf >= 4.15` + `-ves` Plural & Irregular Past Stems):**
   - Live testing across 5 genres exposed false positives on concrete Grade 1–4 words (`grass`, `fork`, `shelves`, `glowing`, `sank`, `swore`, `hid`, `lab`, `junk`) at `Zipf >= 4.45`.
   - Lowering the empirical `wordfreq` cutoff to `Zipf >= 4.15` (5,413 everyday roots, zero runtime pip deps) plus `-ves → -f/-fe` and irregular verb stems achieved **0 false positives** while keeping **100% rejection** on hard/jargon words (`clot`, `shear`, `torque`, `inert`, `wary`, `chasm`, `suture`, `plight`, `venomous`, `gibberish`, `enlistment`, `unconscious`, `anticoagulants`).
5. **Direct Ear & Frame Verification Catch (`/w/` Onset Clip & Resolution Scaling):**
   - Direct ear inspection of `girl-joined-navy` and `food-eat-more` caught initial `/w/` glide clipping (`"One"` sounding like `"un"`) caused by a tight `35ms` pre-pad + `10ms` fade-in. Expanding adaptive pre-pad to `45–80ms` (`120ms` max at clip start) with a `6ms` cosine fade-in eliminated the clip completely on re-listening.
   - Dynamic `ffprobe` resolution scaling verified cleanly across both **`720x1352`** (`skydiver-unconscious`, `bomb-under-bed`) and **`1080x1920`** (`dreaming-test`, `girl-joined-navy`, `food-eat-more`) preview MP4s.
6. **Honest Pass-1 Alignment Note (Why 1 Quick Slot-Fill Pass Matters):**
   - Pass-1 rewrites drafted before the `3.6 syl/s` calibration left under-filled long slots (e.g., `food-eat-more b5` `11.85s` slot finishing `1.8s` early -> `2.41s` closing tail, `max_drift 1.88s`), which `audit_alignment.py --strict` accurately caught and reported. Always tune beats whose `fill_ratio` falls outside `0.82–1.05` at `3.6 syl/s` before final render.

## 3. Adversarial Text Evals (`2/2` Verified)

- **`eval_red_fiction.json` (Original comedy skit cloned 1:1):** Correctly FAILED `--strict` with `GATE0_RED_CONTENT_RISK` warning + caught `exact_4gram` (`so he turns the`) and `content_3gram` (`nine gold coin`).
- **`eval_rushed_200wpm.json` (Over-stuffed `235 WPM` / `95 syl` in `12s` source):** Successfully distilled to `175.0 WPM` (`41 syl`, `Jaccard=0.039`, `ROUGE-L=0.074`) and PASSED `audit_rewrite.py --strict` with exit code `0`.
