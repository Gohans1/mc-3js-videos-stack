# Audio, Vocal Prosody, BGM Routing, SFX Sync & Mastering (Zone 1: Use)

Empirical spoken WPM cliffs, word-count budgets, vocal persona & TTS handoff Bible, emotion- and topic-conditioned BGM routing & ducking, ITU-R BT.1359 SFX frame-sync, room tone, and EBU R128 Shorts mastering targets for Zack D. Films (`statsVersion: 4`). All audio distributions use **`N=62` audio-verified `schema_version: 2`** dossiers (`62/62`); all WPM cliffs use **`N=50` clean mature transcripts** (`1` corrupt truncated caption `YT3OiJbpd-I` at `43.3 WPM` excluded; stratified subsample base: `W=44%, F=24%`). Both Fisher exact `p` and BH-FDR `q` are reported; reliability tiers: `stable >=8`, `tentative 5–7`, `directional <5`.

## 1. Clean Spoken WPM Cliffs & Word-Count Budgets (`N=50` Clean Mature; Base: `W=44%, F=24%`)

- **Tier medians (`N=50` clean):** Winners **`161.3 WPM`** (`n=22`, median `105` words) vs Medians `171 WPM` (`n=16`, `95` words) vs Flops **`173.7 WPM`** (`n=12`, `99` words).

| Spoken WPM Band (`N=50`) | N | Share (%) | Win Rate (%) | Flop Rate (%) | Median Outlier | Median Views | `p (q)` | Pacing Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<130` | 1 (`directional`) | 2% | 100% (`+56pp`) | 0% | 1.99x | 29,919,826 | 1.000 (1.000) | Rare ultra-unhurried read |
| **`130-149`** | 5 (`tentative`) | 10% | **100% (`+56pp`)** | **0%** | **2.36x** | **33,011,153** | 0.137 (0.342) | **Highest-performing calm cadence** (lets visuals & SFX breathe) |
| **`150-164`** | 16 (`stable`) | 32% | **50% (`+6pp`)** | 18.8% | **1.85x** | 21,379,707 | 0.705 (1.000) | **Primary production sweet spot** (`145–165 WPM`) |
| `165-179` | 21 (`stable`) | 42% | 38.1% (`-5.9pp`) | 23.8% | 1.33x | 20,237,105 | 1.000 (1.000) | Upper channel norm; keep `<170` when drafting |
| **`180-199`** | 7 (`tentative`) | 14% | **0% (`-44pp`)** | **57.1%** | **0.47x** | **5,210,784** | **0.011** (0.053) | **Hard Flop cliff — NEVER ship `>=180` WPM** |

| Target Runtime | Spoken Window (`0.7s` Tail) | Ideal Word Count (`145–165 WPM`) | Absolute Hard Ceiling (`<175 WPM`) |
| --- | --- | --- | --- |
| `35s` | `34.3s` | `83–94` words | `100` words |
| **`40s` (core default)** | **`39.3s`** | **`95–108` words** | **`114` words** |
| `44s` | `43.3s` | `105–119` words | `126` words |
| `60s` (stacked breakout) | `59.3s` | `143–163` words | `172` words |

- **Audio-First Re-Timing Law (`PL-006`):** Blueprint timestamps are `Pre-VO Projections` only. Generate/record real VO first, measure real spoken WPM from aligned word timestamps (excluding end hold), and lock shot/flash/SFX timing to the aligned audio clock (`VO-Locked`). If aligned speech creeps toward `175–180 WPM`, cut filler clauses — never speed-ramp human speech unnaturally. *(English is the default output language; if the user explicitly requests another language later, replace EN space-separated WPM with syllable/mora tempo — `3.2–3.8` syl/s sweet spot, `<4.3` syl/s hard ceiling — and mark EN WPM bands `PASS (Language-Adapted)`.)*

## 2. Vocal Persona, Zero-Dead-Air Attack, Contiguous TTS & Prosody Bible (`N=62`)

| Dimension / Value (`N=62` Audio-Verified) | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Delta W-F (pp) | `p (q)` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`voice:calm_matter_of_fact`** | 56 (`stable`) | **90.3%** | 1x | **92%** | 100% | -8 | 0.498 (1.000) |
| `pov:second_person_you` | 32 (`stable`) | 51.6% | 1x | 44% | 47.4% | -3.4 | 1.000 (1.000) |
| `pov:third_person_story` | 19 (`stable`) | 30.6% | 0.94x | 28% | 42.1% | -14.1 | 0.356 (1.000) |
| `pov:omniscient_explainer` | 9 (`stable`) | 14.5% | **4.07x** | 20% | 10.5% | +9.5 | 0.680 (1.000) |
| **`audio:continuous_bgm_plus_vo`** | 48 (`stable`) | **77.4%** | 1.05x | **84%** | 73.7% | **+10.3** | 0.467 (0.935) |
| `audio:shifting_bgm_plus_vo` | 12 (`stable`) | 19.4% | 0.93x | **8%** | **26.3%** | **-18.3** | 0.210 (0.842) |
| **`bgm:tense_pulse_synth`** | 24 (`stable`) | 38.7% | **4.12x** | **52%** | 31.6% | **+20.4** | 0.227 (0.680) |
| `bgm:playful_quirky` / `lofi_ambient` | 16 / 8 (`stable`) | 25.8% / 12.9% | 0.99x / **2.53x** | 16% / 16% | 26.3% / 15.8% | -10.3 / +0.2 | >=0.467 |
| `bgm:mixed_shifting` | 11 (`stable`) | 17.7% | 0.89x | **4%** | **26.3%** | **-22.3** | 0.070 (0.421) |
| `sfx:moderate_punctuated` / `has_sfx_whoosh_or_riser` | 58 / 61 (`stable`) | 93.5% / **98.4%** | 1.03x / — | **96% / 100%** | 94.7% / 94.7% | +1.3 / +5.3 | >=0.432 |
| `has_jl_cut` / `has_pre_impact_silence` | 14 / 1 | 22.6% / 1.6% | — | 24% / 0% | 26.3% / 5.3% | -2.3 / -5.3 | >=0.432 |

- **Vocal Persona, Zero-Dead-Air Attack & Contiguous TTS Rules (`PL-005`):**
  1. **Zero-Dead-Air Opening Attack (`firstSpokenSec <= 0.25s`):** Trim leading silence tightly so the first spoken consonant lands within **`0.00–0.25s`** of Frame 0 (paired with an immediate `-1f` / `0.00s` physical foley transient). Never open a Short with `>=0.5s` of dead air before Word 1.
  2. **Delivery Register, Pitch & Anti-Uptalk:** Clinical, articulate, unhurried medium-low chest voice — flat-to-falling cadence on setup facts, crisp lift ONLY on causal pivots (*"**But**..."*, *"**So**..."*) and concrete anomaly nouns, and a clean downward landing on the final word. Guard against AI **uptalk** (rising pitch on declarative statements) and **movie-trailer slowdown** on the closing sentence.
  3. **Micro-Pause Cadence:** Place `0.15–0.25s` crisp breaths before causal pivots (`But / So / Now`) and a `0.25–0.40s` micro-beat right before the main twist or mechanical impact so the viewer absorbs the visual proof. Avoid `>=0.8s` dead air or equal-spaced gaps.
  4. **Contiguous-Pass TTS Continuity, Leveling & Display-Caption Split:** Generate the full 35–44s script in **one contiguous pass** (never isolated single-sentence chunks whose pitch floor and room tone drift); crossfade any splice over **`10–30ms` at silent troughs**; apply gentle **`2:1–3:1` vocal leveling** (`~3–6 dB` GR) so quiet word tails survive phone speakers; and split **Display Captions** (`GTA 6`, `45°`) from the **Clean-Read VO / TTS Block** (`GTA six`, `forty-five degrees`, zero stage directions). Audition 2–3 full-pass takes on the hook & twist before locking the timeline.

## 3. Emotion- & Topic-Conditioned BGM Routing, Ducking & Law of 2.5 (`N=62`)

Never swap BGM genres mid-Short (`mixed_shifting` `-22.3pp, p=0.070`). Pick **one** continuous low-fatigue bed matched to the emotional driver:

| Emotional Driver (`N=62`) | N | Dominant BGM Mood (`count/n`, outlier, `W/F`) | Secondary / Avoid |
| --- | --- | --- | --- |
| `visceral_shock_danger` | 7 (`tentative`) | **`tense_pulse_synth`** `5/7` (`71.4%`, **`5.01x`**, `W:4/F:1`) | Avoid `mixed_shifting` (`2/7`, `0.26x`, `W:0/F:2`) |
| `curiosity_mystery` | 30 (`stable`) | **`tense_pulse_synth`** `14/30` (`46.7%`, `1.14x`, `W:6/F:4`) | `playful_quirky` `9/30` (`0.97x`); `lofi_ambient` `3/30` (`0.99x`) |
| `empathy_wholesome` | 8 (`stable`) | **`lofi_ambient`** `4/8` (`50%`, **`4.08x`**, `W:3/F:1`) | Avoid `mixed_shifting` (`4/8`, `1.14x`) |
| `humor_absurdity` | 12 (`stable`) | **`playful_quirky`** `6/12` (`50%`, **`2.25x`**, `W:3/F:2`) | Avoid `mixed_shifting` (`3/12`, `0.97x`) |
| `irony_schadenfreude` / `awe_wonder` | 2 / 2 (`directional`) | **`tense_pulse_synth`** (`2/2` `4.33x` irony; `1/2` `4.42x` awe) | Keep bed dry/steady so irony lands cold |

- **Topic shortcuts (`N=62`):** `animals_nature_survival` (`70%` `tense_pulse_synth`, `5.01x`, `W:6/F:1`), `history_weird_true_story` (`71.4%` `tense_pulse_synth`), `hypothetical_what_if` (split `tense_pulse_synth` `4.42x` & `playful_quirky` `4.59x`, both `W:2/F:0`).
- **BGM Ducking & Dynamic Arc:** Keep BGM sitting **`14–18 dB` below VO** during spoken clauses (`-28 to -32 LUFS` bed under `-14 LUFS` VO; carve a gentle `-2 to -4 dB` notch around `1–4 kHz` vocal presence if synth mids compete with speech). Lift BGM smoothly `+3 to +5 dB` (`150–250ms` release) only during unvoiced `>=0.35s` visual breaths/transitions, ducking cleanly (`50–80ms` attack) before the next word.
- **Room Tone & The Law of 2.5:** Never let gaps drop to digital `-inf dBFS` dead silence behind dry VO — lay continuous low-level environment-matched room tone (`-45 to -38 dBFS`, ~`-42 dBFS` typical street hum / indoor air) across the entire Short. Enforce the **Law of 2.5**: never layer more than **2.5 simultaneous active stems** (`1.0 VO` + `1.0 BGM/Room Bed` + `0.5 punctuated SFX accent`) so mobile speakers stay crystal clear.

## 4. ITU-R BT.1359 SFX Sync, 4-Tier Gain Ladder, Mobile Hygiene & Linear EBU R128 Mastering

- **ITU-R BT.1359 SFX Frame-Sync (`sfx:moderate_punctuated` `93.5%`, `has_sfx_whoosh_or_riser` `98.4% / 100% W`):** Per ITU-R BT.1359 human AV-sync limits (`-45ms` audio lead to `+125ms` lag), place sharp physical hits (breaker clunk, curb footstep, latch snap, glass impact) at **`0f` (exact contact frame) or `-1f` (`-33ms` at 30fps)** — never late! Start transition/whip whooshes `2–4f` before the `card_flip`/`push_up`/`whip_pan` midpoint so the transient crests dead-on the swap frame. Fire subtle high-register chimes/pops on `FN-001`/`FN-002` spotlight onset (no slapstick boings unless pure comedy).
- **4-Tier SFX Gain-Staging Ladder, Acoustic Perspective & Anti-Machine-Gun Variation:**
  - **Tier 1 — Hero Physical Hits (`-6 to -9 dB` rel. VO):** Mechanical latches, breakers, impacts. Build hero hits as a **2–3-part composite** (crisp contact transient + low-mid body thump + brief `0.15s` mechanical/electrical tail) rather than a single thin click.
  - **Tier 2 — Transition & Camera Whooshes (`-10 to -14 dB` rel. VO):** `card_flip`, `push_up`, `whip_pan`. Vary texture or pitch (`±1–2` semitones / air vs paper vs cloth) across cues so repeated transitions never sound like identical machine-gun copies.
  - **Tier 3 — Spotlight / UI Accents (`-14 to -18 dB` rel. VO):** Clean `FN-001` chimes and `FN-002` snap ticks (`<0.3s` decay).
  - **Tier 4 — Grounded Foley & Room Tone (`-20 to -26 dB` footsteps; `-45 to -38 dBFS` bed):** Match acoustic distance/reverb to shot scale; during wall/glass `pass_through` moves (`FN-004`), roll exterior ambience smoothly through a **`600–1200 Hz` low-pass filter (LPF)** as the lens enters the interior.
- **Pre-Impact Silence, J/L-Cuts & Outro Hold (`N=62`):** Pre-impact silence vacuums are rare in ZDF (`1.6%`); if used intentionally, duck BGM for `0.15–0.30s` (keeping faint room tone) straight into the `0f` impact. Reserve true `J/L-cuts` strictly for incoming ambient/SFX leading a scene change by `>=0.25s`. Keep `outro_hold_sec` tight at **`0.4–0.9s`** (`0.7s W` median, `0.8s F`), micro-fading the BGM tail without multi-second promo cards (`LjHDUQ7Htvk` `4.0s` = Flop drag).
- **Mobile/Mono Translation, Stem Spectral Hygiene & Fixed Linear Two-Pass `loudnorm` (Stage B Audio Gate):**
  - **Stem Hygiene for Phone Speakers:** High-pass VO and non-sub SFX at **`80–100 Hz`**, de-ess harsh sibilants gently around **`5–9 kHz`**, and keep key punch in **`120–300 Hz`** (body) + **`2–5 kHz`** (consonant/transient cut) since sub-`120 Hz` energy disappears on phone speakers.
  - **EBU R128 s1 Short-Form Targets (replaces invalid broadcast `4–8 LU` LRA on 35s clips):**
    - **Integrated Loudness (`I`):** **`-14.0 LUFS` (±1.0 LU)** (YouTube turns down `>-14 LUFS`, never boosts quieter mixes up).
    - **True Peak (`TP`):** Target **`TP=-1.5 dBTP` pre-encode** so AAC/Opus mux stays strictly **`<= -1.0 dBTP`** (zero inter-sample clipping).
    - **Max Short-Term Loudness (`S_max`, 3s window):** **`<= I + 3.0 LU`** (`<= -11.0 LUFS` at `-14 LUFS` I — zero ear-shock spikes).
    - **Peak-to-Loudness Ratio (`PLR = TP - I`):** Target **`PLR 8–13 dB`** on the final post-encode mux (`final.mp4`), while keeping the pre-encode master **`PLR <= 12.5 dB`** (`(-1.5) - (-14.0) = 12.5 dB`) so linear `loudnorm` never hits its true-peak ceiling.
  - **Guard Against FFmpeg `loudnorm=linear=true` Silent Dynamic Fallback:** FFmpeg silently reverts to pumping `"normalization_type": "dynamic"` whenever EITHER `(target_I - measured_I) + measured_TP > target_TP` (i.e., pre-encode `PLR > 12.5 dB` at `I=-14, TP=-1.5`) OR `measured_LRA > target_LRA`. Apply gentle true-peak/bus limiting BEFORE Pass 1 whenever pre-encode `PLR > 12.5 dB`, set `LRA` above the clip's measured range (`LRA >= ceil(measured_LRA)`, e.g., `LRA=20` or `LRA=50` for pure linear mode), run Pass 1 (`ffmpeg -nostdin -i mix.wav -af "loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json" -f null -`), pass exact `measured_*` + `offset=<target_offset>` + `linear=true:print_format=json` (`-ar 48000`) in Pass 2, and **assert `"normalization_type": "linear"`** in Pass 2's JSON report!
  - **Zero-Token Verification Gates on Final Muxed `final.mp4`:**
    1. Loudness & silence: `ffmpeg -nostdin -v info -i final.mp4 -vn -af "ebur128=peak=true,silencedetect=n=-40dB:d=0.15" -f null -` (assert `I ≈ -14 LUFS`, `TP <= -1.0 dBTP`, `S_max <= I + 3.0 LU`, `PLR 8–13 dB`).
    2. Dual-mono fold-down (preserving BS.1770 2-ch sum on both stereo AND mono renders): `ffmpeg -nostdin -v info -i final.mp4 -vn -af "aformat=channel_layouts=stereo,pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,ebur128=peak=true" -f null -` (assert **`|I_dual_mono - I_stereo| <= 2.5 LU`**).
    3. Phase coherence: `ffmpeg -nostdin -v info -i final.mp4 -vn -af "aphasemeter=video=0,ametadata=mode=print:key=lavfi.aphasemeter.phase" -f null -` (assert **mean `>= +0.25`** with zero sustained negative `< 0` spans; backfill corpus baselines at 0 AI tokens via `channel-dna/scripts/cli.ts mine --channel zack-d-films --probe-audio-only`).
