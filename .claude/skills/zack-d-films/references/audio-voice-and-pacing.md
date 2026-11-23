# Audio Design, Voiceover Pacing, and BGM Dynamics

Every metric cites its exact source sample (`N=43` transcribed mature Minecraft-friendly Shorts, `N=51` full mature catalog transcripts, or `N=17` stratified deep DNA).

## 1. The Empirical WPM Cliff (Strongest Script-Level Predictor)

Fast auctioneer narration destroys 3D explainer comprehension. Across both the strict Minecraft-friendly cohort (`N=43`) and the full mature catalog (`N=51`), **calmer narration (`~148–162 WPM`) dramatically outperforms fast narration (`175+ WPM`)**:

### Minecraft-Friendly Mature WPM Bands (`N=43`)

| WPM Band | Videos (`N=43`) | Winner % | Flop % | Median Outlier | Median Views | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `<150 WPM` | 6 | **`100.0%`** | **`0.0%`** | **`2.10x`** | **`29.2M`** | **Gold Zone** — crisp pauses let 3D visual reveals land cleanly |
| `150–164 WPM` | 14 | **`42.9%`** | `21.4%` | **`1.57x`** | **`20.5M`** | **Primary Sweet Spot** — energetic yet effortlessly readable |
| `165–179 WPM` | 16 | `31.3%` | `31.3%` | `1.23x` | `13.3M` | **Upper Yellow Zone** — acceptable only for very simple physical visuals |
| **`180+ WPM`** | **7** | **`0.0%`** | **`57.1%`** | **`0.47x`** | **`5.2M`** | **Hard Fail Zone** — zero Winners; viewers cannot read 3D staging at this speed |

### Cross-Check Across Tier Medians (`N=43` MC-Friendly vs `N=51` Full Mature Catalog)

| Tier | MC-Friendly Mature (`N=43`) Median WPM (n) | Full Mature Catalog (`N=51`) Median WPM (n) | Full Mature Median Word Count |
| --- | --- | --- | --- |
| Winner (`Top 20%, >=1.83x`) | **`150.9 WPM`** (`n=17`) | **`159.7 WPM`** (`n=23`) | `103` words |
| Median | `170.6 WPM` (`n=14`) | `171.0 WPM` (`n=16`) | `95` words |
| Flop (`Bottom 20%, <=0.57x`) | **`173.7 WPM`** (`n=12`) | **`173.7 WPM`** (`n=12`) | `99` words |

## 2. Spoken Word-Count Targets by Runtime

Lock your draft script word count **before** recording TTS so natural delivery lands inside **`148–162 WPM`** without artificial speed-up:

| Target Duration | Word Count at `150 WPM` | Word Count at `160 WPM` | Hard Ceiling (`170 WPM`) | Recommended Use |
| --- | --- | --- | --- | --- |
| `35s` | `88` words | `93` words | `99` words | Tight single-mechanism or architecture explainer |
| `40s` | **`100` words** | **`107` words** | `113` words | **Default Zack D. Films Short** (`35–44s` sweet spot) |
| `45s` | `113` words | `120` words | `128` words | Multi-beat contrast or two-step comparison |
| `60s` | **`150` words** | **`160` words** | `170` words | **Epic 55s+ narrative** (`86.7%` Winner tier in `N=270`) |

## 3. Audio Bed Profiles (`N=17` Deep DNA; `n=16` Aurally Verified)

Note: `16/17` dossiers (`6/7` Winners, `6/6` Medians, `4/4` Flops) had verified stereo audio streams during mining; `SGgYDfeHYXA` (Winner) was mined on frame-sampled input with burnt-in captions and no attached audio stream, so its `vo_only_dry` enum is an unverified fallback rather than an observed audio bed.

| Audio Bed Style | Videos (`N=17`) | Share (`N=17`) | Winner % (`n=7` / `n=6` audio-verified) | Flop % (`n=4`) | Median Outlier | When to Use |
| --- | --- | --- | --- | --- | --- | --- |
| `shifting_bgm_plus_vo` | 8 | **`47.1%`** | `28.6%` (`2/7`; `33.3%` of `6`) | `50.0%` | `0.97x` | **Default for multi-act stories** — shift musical tension at the ~50% escalation or ~76% twist (e.g., playful -> tense, chaos -> warm resolution in `7i6ok0llYUc`) |
| `continuous_bgm_plus_vo` | 6 | **`35.3%`** | `28.6%` (`2/7`; `33.3%` of `6`) | `50.0%` | `1.06x` | **Default for clean `35–42s` explainers** — steady, low-profile pulse bed tucked well beneath VO (`-22` to `-18 LUFS` bed under `-14 LUFS` VO) |
| `minimal_ambient_plus_vo` / `music_sfx_no_vo` | 2 (`1` each) | `11.8%` (`12.5%` of `16`) | `28.6%` (`2/7`; `33.3%` of `6`) | `0.0%` | `4.46x` / `7.83x` (directional, `n=1` each) | Verified non-BGM exceptions: underwater ambience + VO (`CRGWDiIgMZ4`) or pure character dialogue + SFX comedy (`0BZ1C83I2R4`) |
| `vo_only_dry` *(unverified fallback)* | 1 | `5.9%` (`0/16` audio-verified) | `14.3%` (`1/7` JSON; unverified) | `0.0%` | `7.76x` (`SGgYDfeHYXA`) | **Not an observed audio recipe** — calibration fallback set only because `SGgYDfeHYXA` lacked an attached audio stream during mining |

## 4. Empirical Audio Sync Rules (`N=17` Deep DNA; `n=16` Aurally Verified)

1. **Zero Dead Pre-Impact Silence (`has_pre_impact_silence`: `0/17` in JSON; `0/16` aurally verified, `0.0%`):**
   - Unlike dramatic documentary channels that cut all audio to zero for 0.5s before every bass drop, Zack D. Films maintains **continuous narrative momentum**. Use natural **`0.25–0.45s` spoken sentence micro-pauses** (letting a bite crunch, door click, or UI pop breathe) rather than dramatic dead-air vacuums.
2. **Keep Clean Beat-Aligned Audio (`has_jl_cut`: `0/7` Winners vs `2/4` Flops in JSON -> `0/6` aurally verified Winners [`0.0%`] vs `2/4` Flops [`50.0%`], `-50.0 pp`):**
   - Because `64.6%` of boundaries are `Continuous [NO CUT]` splines, dialogue and picture naturally flow together without staggered J/L-cut audio bleeds. Align key spoken nouns **directly on top of** their `0.4–0.6s` emissive highlight pulse (`film-stage/highlight`) and tactile SFX hit.
3. **Tactile Foley & UI Punctuation Over Generic Whoosh Spam:**
   - Every visual device earns a crisp, grounded sound: soft whoosh on damped camera whips, crisp card-flip paper/click on `cardFlip`, metallic click/lock on props, subtle chime/tick on floating 3D counters/rulers, and distinct crowd/footstep ambience (`film-kit/steps` `stepSounds`).
4. **Never Leave Silent Outro Dead Air:**
   - Flop `LjHDUQ7Htvk` lingered `~3.0s` on a static silent card after VO ended. End the Short cleanly **`0.4–0.8s`** after the final spoken word and visual punchline settle.

## 5. Production Audio Pipeline (`mc-films`)

1. **Voice Casting & Generation:** Use ElevenLabs v4 (`bun run voice:playground` / `bun run voice:gen`) with clean, conversational, matter-of-fact third-person delivery (calm authority, zero radio-announcer hype). Use English ElevenLabs audio tags sparingly (`[curious]`, `[matter-of-fact]`, `[slight disbelief]`).
2. **Word Timing & Gap Audit:** Run `bun run voice:align` (local WhisperX) -> `bun run voice:cues` to verify exact heard-time WPM (`148–162 WPM`) and natural breathing gaps (`0.25–0.45s` at visual reveals) before animating camera splines.
3. **Lip-Sync:** Run `bun run voice:lips` (local Rhubarb) whenever on-screen characters speak (`mc-actor/player` `mouthAt`).
4. **Sound Design & Mastering:** Source real CC0 recordings (`bun run sfx:get`, `.claude/skills/real-sound`), mix via `bun run mix` (`-14 LUFS` / `-1.5 dBTP` target), run `bun run listen`, and verify audibly with `earshot` before final render.
