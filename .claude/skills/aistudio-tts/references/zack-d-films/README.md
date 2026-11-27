# Zack D. Films Voice System (Google AI Studio / Gemini API 3.8 Flash TTS)

Empirically benchmarked playbook, drop-in templates, and broadcast post-processing chain for recreating the **Zack D. Films** YouTube Shorts narration sound using **pure `gemini-3.8-flash-tts` only** (`gemini-3.8-flash-lite-tts` is **banned** and rejected by `cli.ts`; if AI Studio web hits its daily quota, switch to `--backend api` for rotating `~/.config/gmn` API keys, and STOP/report only if all API keys are also exhausted).

> **Scope & Honest Ceiling (`N = 50` Corpus, Pure `gemini-3.8-flash-tts`):** Every number below comes from isolating and measuring **50 verified narrated mega-viral Zack D. Films Shorts** (`47` YouTube Shorts `31.6M–72.2M` views, median `39.1M`, plus `3` local clean stems; `N=20 → N=50` drift `<0.15 st`), screening **34/37 English (US) Masculine voices**, running **22 pure `gemini-3.8-flash-tts` ablation/multi-genre takes** via `--backend api`, and running **multiple rounds of independent 2-judge blind ear-tests**.
> - **Overall Style, Cadence & Broadcast Polish Match (Pure `flash-tts` + Post-Chain):** **`~84–85%`** (`Zeno S3` `84.5/100`, `Rasalgethi R1` `84.0/100`, `Puck R1` `80.5/100` — up from `46.0` on the older `Koda` default, a **`+38` point jump**).
> - **Honest Remaining Gap (`~14–16` pts to exact real Zack):** Prebuilt stock voices match Zack's pitch pocket, bright-dry close-mic presence, melodic arches, and jump-cut polish closely, but cannot replicate Zack's exact personal vocal-tract formants or hand-edited visual beat micro-timing. Reaching `95–99%` exact human identity requires licensed voice cloning/replication (paid-key gated and subject to consent/rights).

---

## 1. Drop-In Production Recipes (Start Here)

Run all commands from the repo root. For `--backend web`, run **one TTS tab at a time** (keep `<= 2` active Chrome tabs total across sessions). For **`--backend api`** (no Chrome needed, automatic `~/.config/gmn` key-pool rotation, ~6s/take), pass `--backend api` directly with the exact same JSON templates.

### Recipe A — Locked Channel Default (`Rasalgethi` @ `gemini-3.8-flash-tts`, `m1_steady_story`, `t=0.65`)
**Human-approved channel primary pick (shipped on first channel Short `films/dreaming-test/renders/final.mp4`).** Uses Google's recommended concise 9-word Gemini 3.8 `style` cue at `t = 0.65` on full `gemini-3.8-flash-tts`: keeps `Rasalgethi`'s `#1` blind diction (`88.5`) and realism (`84.0`) while eliminating both the bright/rushed course-seller uptalk of `"curious explainer"` (`R1_Natural`, `200–214 WPM` post) and overly heavy horror-whisper reads. Grounded, unhurried `~160–185 WPM` storytelling cadence with clean falling closes.

- **Template:** [templates/rasalgethi-balanced.json](templates/rasalgethi-balanced.json) | **Batch:** [templates/rasalgethi-batch-manifest.json](templates/rasalgethi-batch-manifest.json)
- **Voice:** `Rasalgethi` | **Model:** `gemini-3.8-flash-tts` *(required; `flash-lite-tts` banned)* | **Temperature:** `0.65`
- **Measured Pace:** `~160–185 WPM` post-chain (`m1_steady_story`) — budget **`~85–105` spoken words** for a `30–36s` Short.
- **Channel-Locked Style (`m1_steady_story`):**
  `calm, matter-of-fact storytelling, unhurried steady pace, falling endings`
- **Faster/Brighter Benchmark Variant (`R1_Natural`, `84.0/100` blind tie across 5 genres, `167–214 WPM`):**
  `Clear, curious American explainer narrator, steady conversational pace, crisp articulation, short natural breaths, clean downward declarative endings`

```powershell
# Single take via AI Studio web (required model: gemini-3.8-flash-tts):
bun .claude/skills/aistudio-tts/scripts/cli.ts --tab tts-zdf speak .claude/skills/aistudio-tts/references/zack-d-films/templates/rasalgethi-balanced.json --out voice/raw/zdf_raw.wav --timeout 180 --force

# Drop-in Gemini API key-pool fallback (when AI Studio web hits quota, or for fast zero-Chrome batches; rotates ~/.config/gmn keys on gemini-3.8-flash-tts):
bun .claude/skills/aistudio-tts/scripts/cli.ts --backend api speak .claude/skills/aistudio-tts/references/zack-d-films/templates/rasalgethi-balanced.json --out voice/raw/zdf_raw.wav --force

# Multi-take batch (swap --tab tts-zdf for --backend api when AI Studio web hits quota; never switch to flash-lite):
bun .claude/skills/aistudio-tts/scripts/cli.ts --tab tts-zdf batch .claude/skills/aistudio-tts/references/zack-d-films/templates/rasalgethi-batch-manifest.json --timeout 180 --force
```

### Recipe B — High-Punch Urgent Shorts Alternative (`Zeno` @ `gemini-3.8-flash-tts`, `S3_Urgent`, `t=0.70`)
**Virtual #1 blind tie (`84.5/100` avg; Judge 1's #1 at `84/100`, unanimous #1 Shorts energy: `Prosody 84.5`, `Polish 87.0`).** Best when you want maximum high-retention viral urgency and sharp forward attack (`F0 = 152.6 Hz` post, `0.40 st` from Zack's `149.2 Hz` `N=50` median). Note: unlike `Rasalgethi`, `Zeno` **needs `S3_Urgent`** — putting `Zeno` on concise `R1_Natural` dropped its blind score by `-8.5` points (`76.0`).

- **Template:** [templates/zeno-primary.json](templates/zeno-primary.json)
- **Voice:** `Zeno` | **Model:** `gemini-3.8-flash-tts` | **Temperature:** `0.70`
- **Measured Pace (`5` genres):** `172–218 WPM` raw -> `181–230 WPM` post-chain — budget **`~95–115` spoken words** for a `30–36s` Short, or swap `"Fast, crisp"` for `"Steady brisk"` if you want `~170–185 WPM`.
- **Style:**
  `Fast, crisp, close-mic American male storyteller, dry fascinated urgency, sharp vocal pops on key nouns, tight jump-cut pacing, zero breathiness, firm falling sentence ends`

```powershell
# Web or API (--backend api):
bun .claude/skills/aistudio-tts/scripts/cli.ts --backend api speak .claude/skills/aistudio-tts/references/zack-d-films/templates/zeno-primary.json --out voice/raw/zdf_raw.wav --force
```

### Step 2 — Mandatory Broadcast Post-Chain (`+27.0` Blind Polish Gain)
Raw `gemini-3.8-flash-tts` audio arrives quieter (`-17` to `-22 LUFS`, `PLR 15.5–20.0 dB`) with audible `300–550 ms` breath intakes between sentences. Run [post-process.py](post-process.py) (requires `python` with `numpy`, `soundfile`, and `ffmpeg` on `PATH`) to leave natural `<= 260 ms` clause pauses untouched, tighten oversized breath valleys (`> 260 ms` -> `~185 ms` with `95 ms` sibilant-safe word tails and `20 ms` cosine tapers), and apply 2-pass linear broadcast EQ/compression (verified across all 22 pure `flash-tts` takes: **`I = -14.1 to -14.8 LUFS`**, **`TP = -1.5 to -1.3 dBTP`**, **`LRA = 1.0–2.3 LU`**, **`PLR = 12.6–13.3 dB`**, **`+27.0` blind Polish points** on the identical recording with zero clipped word tails):

```powershell
python .claude/skills/aistudio-tts/references/zack-d-films/post-process.py voice/raw/zdf_raw.wav voice/takes/narr.wav --preset rasalgethi
```
*(Default `--preset` is `rasalgethi`; use `--preset rasalgethi` for `Rasalgethi`/`Puck`/`Achird`, `--preset zeno` for `Zeno`, or `--preset koda` if ever using `Koda`. Pass `--no-gap-trim` if you plan to split Phrase Bricks manually at raw silent troughs instead.)*

---

## 2. Empirical Zack D. Films Vocal DNA (`N = 50` Verified Narrated Viral Shorts)

Measured across **47 isolated top-viral Shorts** (`31.6M–72.2M` views, median `39.1M`, separated with `UVR-MDX-NET-Inst_HQ_3.onnx`) plus **3 local clean stems** (`50/50` verified narrated; `N=20 → N=50` drift `<0.15 st` — see full 50-video table in [eval-report.md](eval-report.md)).

| Acoustic / Prosodic Dimension | `N = 50` Viral Median | IQR (`p25–p75`) / Full Range | Production Implication |
| --- | --- | --- | --- |
| **Pitch Center (`F0` median)** | **`149.2 Hz`** | IQR `143.1–155.4 Hz` (`134.2–163.5 Hz`) | High-baritone / low-tenor US male; never deep bass (`<120 Hz`). |
| **Melodic Excursion (`p10–p90`)** | **`16.64 st`** | IQR `16.19–17.17 st` (`14.0–18.0 st`) | Strongly undulating pitch wave—NOT flat monotone! |
| **Sentence-Ending Pitch Slope** | **`-3.96 st`** | IQR `-5.62 to -2.87 st` (**`48/50` = 96% negative**) | Decisive downward declarative closes; almost zero uptalk. |
| **Spectral Centroid (24 kHz)** | **`2,826 Hz`** | IQR `2,533–2,976 Hz` (`2,316–3,284 Hz`) | Dry close-mic condenser cut with clean upper-mid bite. |
| **Band Balance (`80–250` / `2–5 kHz`)** | **`44.5%` / `1.79%`** | Low IQR `39.0–49.3%` · Pres IQR `1.46–2.03%` | Warm chest foundation + crisp nasal-mask presence, scooped `300–400 Hz` mud. |
| **Inter-Clause Pause Median** | **`145 ms`** | IQR `130–174 ms` (`105–210 ms`) | Hyper-edited jump-cut tightness; virtually zero audible inhales. |
| **Loudness Range (`LRA`)** | **`2.15 LU`** | IQR `1.80–2.50 LU` (`1.2–3.9 LU`) | Tight `3:1` broadcast vocal leveling so quiet tails survive phone speakers. |
| **Peak-to-Loudness (`PLR`)** | **`11.4 dB`** | IQR `10.8–12.1 dB` (`8.1–12.9 dB`) | Punchy transients with healthy headroom—never brickwall-crushed. |
| **Spoken Pace (`WPM`, catalog)** | **`168.1 WPM`** (`N=84`) / **`165.0 WPM`** (`N=12` in-corpus) | IQR `157.7–175.9 WPM` | Brisk & crisp without rushing/blurring (`>=215 WPM` risks consonant slurs). |

---

## 3. Pure `gemini-3.8-flash-tts` Rules, Traps & Pro Tips (Verified by Ablation)

### Critical `style` & `temperature` Traps to Avoid
1. **NEVER use `"deadpan"` in `style`:** Re-verified on pure `gemini-3.8-flash-tts` via API (`Ras_Deadpan_t70` dropped `F0` to **`121.8 Hz`**, **`3.51 st` below Zack**, dead last acoustically at `23.5%`; earlier Round 2 dropped `Zeno` `-4.4 st` too). Use **`"dry, fascinated"`** or **`"clear, curious"`** instead.
2. **Don't over-stuff `style` on `Rasalgethi` (17 words beats 35 words by `+19.0` blind pts!):** On pure `gemini-3.8-flash-tts`, the 35-word `Goldilocks` directive stack (`B2`, `65.0`) caused halting, overly theatrical mid-clause pauses (`"fiber ... from a vegetable"`, `"break down ... in acid"`), whereas concise 17-word `R1_Natural` (`B6`, `84.0`) flowed effortlessly. Match style density to the voice: **`Rasalgethi` & `Puck` shine on concise `R1_Natural`**, while **`Zeno` shines on `S3_Urgent`** (`84.5` vs `76.0` on `R1_Natural`).
3. **Never omit `style` completely (`style: ""`) for Zack Shorts:** Empty `style: ""` on `Rasalgethi` dropped `F0` to `132.0 Hz` (`-2.1 st`), accelerated raw pace to `210 WPM` (`223 WPM` post), and widened raw `LRA` to `3.7 LU` (vs `1.6–2.3 LU` directed).
4. **Watch `"Shorts"` in `style` on `Rasalgethi`:** Adding `"Shorts"` to `Goldilocks` shaved `2.15s` raw (`+13 WPM` faster) and thinned `80–250 Hz` chest warmth from `15.5%` down to `11.3%`. Keep `"steady conversational pace"` on `Rasalgethi`.
5. **Lock `temperature` at `0.65` (`Rasalgethi`/`Puck`) or `0.70` (`Zeno`) — avoid `>= 0.75` for fast Shorts:**
   - **`0.65` (Locked Recipe A):** Sweet spot for `Rasalgethi`/`Puck` — `84.0/100` blind, `88.5` articulation, zero slurs.
   - **`0.70` (Locked Recipe B):** Sweet spot for `Zeno` (`84.5/100`).
   - **`0.50`:** Ultra-safe articulation (`147.4 Hz` on `Rasalgethi`), slightly less expressive (`13.9 st`). Use only if a technical tongue-twister keeps slurring.
   - **`0.75–0.85`:** Directly triggered an L→R consonant slur on `Rasalgethi` (`"steadily"` → `"stedery"`, caught by both blind judges, `-17.0` blind pts!). Avoid `>= 0.75` for fast factual Shorts.

### Practical Workflow Tricks for Future AIs
- **Generate 2 quick takes on `--backend api` to beat stochastic `F0` variance:** Even with identical voice, style, and `t=0.65`, `gemini-3.8-flash-tts` exhibits natural `±8–15 Hz` (`±1–1.5 st`) take-to-take F0 variance. Because `--backend api` rotates the `~/.config/gmn` key pool (~6s/take, zero Chrome), generating 2 takes and picking the brighter/cleaner one by ear is cheap and eliminates unlucky flat takes.
- **Never trust acoustic stats without listening (`read_file` on WAV):** In Round 2, `Achird_S3_t70` (`#1` acoustically at `39.5%`, `F0 149.2 Hz`) and `Ras_Gold_NoShorts_t70` (`#2` acoustically at `38.9%`, `F0 149.3 Hz`) ranked `#5` (`71.0`) and `#7` (`65.0`) in blind ear-tests because acoustic summaries miss fast `<260 ms` audible inhales (`Achird`) and halting theatrical phrasing (`Goldilocks`).
- **Skip `<short pause>` tags & anchor causal pivots cleanly:** Use plain commas (`,`), periods (`.`), and Zack's structural pivots (`"You see,"`, `"Instead,"`, `"But..."`, `"So..."`) — `<short pause>` bloats gaps against Zack's `145 ms` jump-cut DNA.
- **Spell spoken numbers, years & acronyms:** Write `"nineteen oh four"`, `"forty-five"`, `"three-D"`, `"GTA six"` in TTS `text` while keeping numerals in captions. Use phonetics or `/IPA/` for tricky proper nouns, and always check fast cluster endings (`tract`, `fact`, `steadily`, `your gut`) by ear.

---

## 4. When to Choose Each Voice (Quick Picker — Pure `gemini-3.8-flash-tts`)

| Situation | Recommended Voice & Recipe | Why |
| --- | --- | --- |
| **Default Channel Short (Locked Primary)** — calm, grounded storytelling without course-seller uptalk or horror heaviness | **`Rasalgethi`** @ `gemini-3.8-flash-tts` (`rasalgethi-balanced.json`, `m1_steady_story`, `t=0.65`, + `post-process.py`) | Channel producer's locked #1 default (shipped on `films/dreaming-test/renders/final.mp4`); pairs `Rasalgethi`'s #1 diction/realism with concise 9-word unhurried storytelling cadence. *(Use `R1_Natural` only when you specifically want brighter/faster `~200+ WPM` explainer energy.)* |
| **High-punch urgent viral Short** (shock, physics, survival, fast hook) | **`Zeno`** @ `gemini-3.8-flash-tts` (`zeno-primary.json`, `S3_Urgent`, `t=0.70`, + `post-process.py`) | Virtual #1 blind tie (**`84.5/100`**, Judge 1 #1 at `84`), unanimous #1 Shorts energy (`Prosody 84.5`, `Polish 87.0`). Must pair with `S3_Urgent`, not `R1_Natural`. |
| **Bright, slightly reedy Backup #3** | **`Puck`** @ `gemini-3.8-flash-tts` (`R1_Natural`, `t=0.65`, + `post-process.py --preset rasalgethi`) | Unanimous blind #3 (**`80.5/100`**); closest bright-reedy upper-mid color (`86` J2) and strong human feel (`88` J1). Check final clause for micro-hitches. |
| **AI Studio web quota exhausted** | Switch to **`--backend api`** (`~/.config/gmn` key pool on `gemini-3.8-flash-tts`); if all API keys are also exhausted, **STOP & report** (**NEVER** use `flash-lite-tts`) | `--backend api` runs the exact same JSON templates over `/v1beta/interactions` with automatic `~/.config/gmn` key-pool rotation. `gemini-3.8-flash-lite-tts` is banned and rejected by `cli.ts`. |
| **Watch-out / Demoted (#4)** | **`Achird`** (`71.0/100` blind on `S3_Urgent`) | Strong acoustic match (`149.2 Hz`), but takes loud fast `<260 ms` inhales that bypass `post-process.py` gap-trim (`Polish 56.5`). Prefer `Rasalgethi`, `Zeno`, or `Puck`. |
| **Avoid for Zack D. Films** | `Koda`, `Varo`, `Fenrir`, `Cruz`, `Ludo` | `Koda` (`46.0`) & `Varo` (`46.0`) are too soft/audiobook-breathy; `Cruz`/`Ludo` (`96–105 Hz`) are too deep/documentary-heavy for Zack's `149 Hz` register. |

---

## 5. Files in This Pack

- [eval-report.md](eval-report.md) — Full `N = 50` corpus table, `N=20 → N=50` stability check, 34-voice screening, 22 pure `gemini-3.8-flash-tts` ablations & 5-genre matrix, and 2-judge blind ear-test tables.
- [post-process.py](post-process.py) — Production Python/FFmpeg post-TTS script (sibilant-safe gap tightening + 2-pass linear broadcast EQ/compression).
- [test_post_process.py](test_post_process.py) — Behavioral regression tests for `post-process.py` (`python -m unittest discover -s .claude/skills/aistudio-tts/references/zack-d-films -p "test_*.py"`).
- [templates/rasalgethi-balanced.json](templates/rasalgethi-balanced.json) — Ready-to-run `speak` template (`Rasalgethi`, locked Recipe A default).
- [templates/rasalgethi-batch-manifest.json](templates/rasalgethi-batch-manifest.json) — Multi-take `batch` manifest template (`Rasalgethi`).
- [templates/zeno-primary.json](templates/zeno-primary.json) — Ready-to-run `speak` template (`Zeno`, Recipe B high-punch alternative).
- [templates/voice-design-paid-optional.md](templates/voice-design-paid-optional.md) — Optional paid-key `voice-create design` prompt derived from the `N = 50` acoustic DNA.
