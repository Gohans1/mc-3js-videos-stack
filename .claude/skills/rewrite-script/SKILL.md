---
name: rewrite-script
description: Rewrite an existing short-form video script (YouTube Shorts, TikTok, Reels, or fixed-picture 3D Minecraft / explainer cuts) into copyright-safe, ultra-plain spoken English locked to real on-screen scenes and viral pacing. Use whenever the user wants to rewrite, adapt, simplify, de-jargon, or re-voice a reference or existing script without copying wording, make every action line match the picture (viết lại script, viết lại kịch bản, khớp cảnh, đơn giản dễ hiểu, không bị dính bản quyền, không khoảng lặng lâu, sửa lời thoại khớp video), or audit rewrite readability, anti-copy scores, syllable pacing, and post-TTS visual anchor drift. For original audio-first scripts with no locked picture, use zack-d-films instead.
---

# Rewrite Script (Fixed-Picture Viral Shorts)

Rewrite an existing narration into fresh, plain, continuous spoken English that
locks directly onto an existing timed picture edit — without thesaurus-spinning
copyright risk, dead air, or rushing past the Shorts retention ceiling.

## Priority Order (3-Tier Enforcement)

Apply strictly in order from top to bottom. Lower tiers NEVER override higher
tiers:

- **Gate 0 — Copyright & YPP Originality Triage (`[Hard Stop]`)**
  - Classify source risk before writing: `green` (factual/science/true event),
    `yellow` (facts mixed with unique framing/metaphors), or `red` (original
    creative fiction/sketch, or 1:1 visual clone + light paraphrase).
  - If `red`, **warn the user explicitly** about derivative-work and YouTube
    Reused/Inauthentic Content (July 2025) risk before rewriting.
  - Draft via **Clean-Room 2-Pass**: extract a neutral Visual-Event + Raw Fact
    Beat Sheet, **hide the original wording**, and write fresh with a new hook
    angle, restructured sentence boundaries, and original everyday metaphors.
    Read [references/copyright-and-ypp.md](references/copyright-and-ypp.md).

- **Priority 1 — Plain Spoken English + True Originality (`[Hard Stop]` / `[Guardrail]`)**
  - Grade 4–6 everyday spoken words anyone understands on first listen. Zero
    textbook/technical jargon unless the object is literally on screen
    (`allow_words`). Plain words beat syllable-counting tricks: replace
    `"anticoagulants"` (1w/6syl) with `"stuff that keeps blood thin"` (5w/5syl),
    never with awkward synonyms.
  - Zero AI slop, zero narrator `!`, zero meta-camera leaks (`"close-up"`,
    `"cut to"`), zero unexpanded TTS symbols (`45%`, `$50`, `1904` go in
    `tts_text` as spoken words).
  - Anti-copy gates: `0` exact 4-word overlaps (`[Hard Stop]`), `0` lemmatized
    3-content-word overlaps (`[Hard Stop]`), lemmatized content Jaccard
    `<= 0.40` per beat (when `shared >= 2`) and `<= 0.32` full script, content
    ROUGE-L F1 `<= 0.35` (excluding `allow_words`).

- **Priority 2 — Continuous Spoken Momentum (`[Hard Stop]` / `[Guardrail]`)**
  - Opening attack: first spoken word starts `<= 0.25s` (`0.05–0.15s` target).
  - Routine inter-beat transitions: `0.12–0.30s` with natural variation (never
    robotic identical gaps).
  - Earned `[SFX_BEAT]` pause (max 1–2 per Short, backed by continuous room
    tone/BGM — never `-inf dBFS` digital silence): `0.30–0.55s` (up to `0.75s`
    only when tagged `sfx_beat_before: true` for a real SFX/visual shock).
  - Unmotivated dead air `> 0.50s` untagged = FAIL; `> 0.75s` anywhere = Hard
    FAIL.
  - Closing tail: target `0.25–0.75s` (`<= 0.50s` for hard loop cuts), warn
    `> 0.80s`, Hard FAIL `> 1.00s` or speech overflow `< 0.0s`.
  - Speaking rate ceiling: sweet spot `145–175 WPM` (`3.5–4.3 syl/s`); Hard
    Guardrail `< 180 WPM` (empirically avoids the `180–199 WPM` Shorts flop
    cliff).

- **Priority 3 — Action-to-Scene Lock (`[Hard Stop]` / `[Guardrail]`)**
  - Read real picture timing (`shots.json`, `cuts.json`, or visual review
    frames). Decompose long unbroken shots (e.g., a 17s single shot with 5
    internal actions) into **internal visual-event beats**, not just shot cuts.
  - Spoken action/reveal anchors land within `±0.25s` of the visual cut or
    contact frame (prefer `-0.10s` slight verbal lead or `0.00s` on-frame; flag
    drift `> 0.30s`).
  - **P2 vs P3 Tie-Breaker:** Never fill a visual hold by spoiling the next
    shot's action early (breaks P3) and never sit in dead air waiting for a cut
    (breaks P2). Fill the hold with a short **causal/stakes bridge** (Zero
    See-Say redundancy), then hit the next action anchor dead-on the cut.

- **Priority 4 — Time-First Syllable/Duration Isochrony (`[Guardrail]`)**
  - **Why not `±1 word` or fixed sentence count:** Speech duration tracks
    **syllables and seconds**, not word count. Simplifying jargon naturally adds
    short words while *reducing* syllables, and locking 1:1 sentence counts
    pushes writers into clause-by-clause paraphrasing while copying bad source
    pacing. Read [references/spoken-craft-and-sync.md](references/spoken-craft-and-sync.md).
  - Budget each beat directly from **`usable_slot_sec = slot_dur - planned_pause`**
    × voice rate (`default 3.6 syl/s` empirically calibrated for calm storytelling
    on `Rasalgethi` `m1_steady_story`, `4.2 syl/s` for urgent voices),
    targeting `fill_ratio` in `0.82–1.05` so a single natural `1.00x` read fits
    (`atempo` guardrail `<= 1.08x`).
  - Unlock sentence count so dense print clauses split into single-idea spoken
    lines with natural burstiness (`CV >= 0.25`). Only pass
    `--strict-word-delta N` when a user explicitly asks for word parity (e.g.,
    locked kinetic typography).

## 5-Step Clean-Room Workflow

### Step 1 — Inspect Picture & Triage Risk
Read the project's `shots.json` (and `text.json` / `edit.json` / `cuts.json` if
present; if only a raw MP4 exists, use `.claude/skills/analyze-ref-video` first).
Record every visual cut AND every major internal action inside long shots.
Classify `content_risk` (`green` / `yellow` / `red`).

### Step 2 — Clean-Room Rewrite & Unified `beats.json`
1. Extract a neutral **Visual-Event + Raw Fact Spine** (what happens on screen,
   exact timestamps, required facts, visible `allow_words`).
2. Put the original script away and write fresh spoken lines for the ear:
   Frame-0 hook grounded in the opening image, `But / So / Until` causality,
   Zero See-Say narration, plain everyday words, and a clean closing echo.
3. Save ONE unified `beats.json` shared by all scripts:

```json
{
  "film": "my-short",
  "total_dur": 34.23,
  "content_risk": "green",
  "target_sps": 3.9,
  "allow_words": ["skydiver", "helmet", "parachute"],
  "beats": [
    {
      "id": "b1",
      "slot_start": 0.05,
      "slot_end": 4.27,
      "scene": "jumps from plane with group; camera rolls to sun",
      "before": "She jumped from a plane with a group of skydivers, but as they fell",
      "after": "One mid-air kick almost ended her life, seconds after leaving the plane.",
      "tts_text": "One mid-air kick almost ended her life, seconds after leaving the plane.",
      "sfx_beat_before": false,
      "anchors": [{ "at": 0.10, "phrase": "leaving the plane", "tolerance_sec": 0.35 }]
    }
  ]
}
```

*(Legacy `"time": "0.05-4.27s"` is still accepted automatically. `tts_text` is
optional and defaults to `after` — use it when Display Captions contain symbols
like `45%` or `1904` that TTS should read as `"forty-five percent"` or
`"nineteen oh four"`.)*

### Step 3 — Run Deterministic Pre-TTS Audit
```bash
python .claude/skills/rewrite-script/scripts/audit_rewrite.py beats.json --strict
```
Fix every `[FAIL]` before generating audio. For human review, inspect the printed
Before/After sync table (or `--format cards` / `--json`). Present the clean
rewrite and plain spoken paragraph to the user for approval before burning TTS
if they asked to review copy first.

### Step 4 — Generate One Contiguous Voice Take & Align
Delegate voice generation and loudness/silence post-processing to
`.claude/skills/aistudio-tts` (generate the **entire** script in ONE contiguous
pass so pitch floor and tone stay uniform; pass `--no-gap-trim` to
`post-process.py` if preserving an intentional `>260ms` unsliced `[SFX_BEAT]`):
- **Production film:** run `bun run voice:align` and `bun run voice:assemble`
  inside the film project.
- **Isolated scratch preview (fixed MP4, read-only on `films/`):** align with
  WhisperX (`scripts/voice/words.py` format), then run the optional hardened
  scratch builder:
  ```bash
  python .claude/skills/rewrite-script/scripts/assemble_scene_locked.py \
    --wav tts_post.wav --words tts_words.json --beats beats.json \
    --out-prefix scratch/preview/film_rw \
    --preview-video films/<name>/renders/draft_video.mp4 --strict
  ```
  It auto-probes real video dimensions via `ffprobe`, matches full caption token
  sequences, applies true cosine fades + subtle room-tone floor, enforces
  `atempo <= 1.08`, and emits `<out-prefix>_assembled.words.json`.

### Step 5 — Verify Post-TTS Alignment, Ears & Frames
Run the standalone post-TTS verifier on **either** production `words.json` or
scratch `*_assembled.words.json`:
```bash
python .claude/skills/rewrite-script/scripts/audit_alignment.py \
  --beats beats.json --words film_rw_assembled.words.json --strict
```
Verify directly with your own ears (listen to the rendered WAV) and eyes
(inspect key action frames from the preview MP4) that pronunciation is clean,
pauses feel natural, and every spoken action lands on its visual beat.

## Skill & Tool Handoff Map (Zero Duplication)

- **Voice generation, presets & `post-process.py`** → `.claude/skills/aistudio-tts`
- **Original Audio-First Shorts (no locked picture)** → `.claude/skills/zack-d-films`
- **Shot extraction from raw reference MP4** → `.claude/skills/analyze-ref-video`
- **Production film voice integration** → `bun run voice:align` / `bun run voice:assemble`
- **Verified multi-film benchmark & SPS calibration** → [references/benchmark-results.md](references/benchmark-results.md)
