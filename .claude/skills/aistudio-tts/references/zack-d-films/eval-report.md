# Zack D. Films Voice Benchmark & Ablation Report (`N = 50`, Pure `gemini-3.8-flash-tts`)

Complete empirical record for the Zack D. Films voice system on **pure `gemini-3.8-flash-tts` only** (zero `gemini-3.8-flash-lite-tts` data; `flash-lite-tts` is banned and rejected by `cli.ts`). Conducted November 26–27, 2026, with all Round 2 pure `flash-tts` takes generated via `cli.ts --backend api` (`POST /v1beta/interactions`, rotating the `~/.config/gmn` key pool).

---

## 1. Ground-Truth Corpus (`N = 50` Verified Narrated Mega-Viral Zack D. Films Shorts)

Selected **47 top-viewed YouTube Shorts** (`31.6M–72.2M` views, median `39.1M`) spanning anatomy/medical, physics/chemistry/danger, dark history, survival, psychology, math/paradox, nature/biology, and wholesome animal rescue, plus **3 local clean reference stems**. Vocals were isolated via `audio-separator` (`UVR-MDX-NET-Inst_HQ_3.onnx`) and standardized to `24 kHz` mono for apples-to-apples spectral/MFCC comparison with Gemini 3.8 Flash TTS native output.

- **Outlier screening:** Two earlier high-view downloads (`0BZ1C83I2R4`, 78M, and `8JK19FOaDNM`, 49M) were excluded as non-narrated SFX/cartoon gag Shorts (`mfccCos < 0.83`, `low < 11%`). All 33 newly downloaded expansion clips (`30.1M–42.6M`) passed objective narrated-voice verification (`mfccCos >= 0.937`, `low_80_250 >= 26.6%`, `speech_ratio >= 0.85`), and the top 30 by views were combined with the verified 20-clip base to lock **`N = 50` pure narrated tracks** (self-consistency median **`79.0%`**, p25 `73.6%`, range `56.9%–90.8%`).

### `N = 20` vs `N = 50` Statistical Stability Check

Expanding the corpus `2.5×` from `N = 20` to `N = 50` confirmed every Zack D. Films acoustic anchor with virtually zero drift (`F0` shifted `-0.14 st`, pitch range `0.02 st`, presence `0.00%`, `LRA 0.00 LU`, `PLR 0.1 dB`) while tightening IQR confidence bounds:

| Metric | `N = 20` Median | **`N = 50` Median** | `N = 50` IQR (`p25–p75`) | `N = 50` Full Range | Drift (`N20 → N50`) |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Pitch Center (`F0`)** | 150.4 Hz | **149.2 Hz** | 143.1–155.4 Hz | 134.2–163.5 Hz | -1.2 Hz (-0.14 st) |
| **Melodic Excursion (`p10–p90`)** | 16.62 st | **16.64 st** | 16.19–17.17 st | 14.00–18.02 st | +0.02 st |
| **Sentence-Ending Pitch Slope** | -4.46 st (`20/20` neg) | **-3.96 st** (`48/50` neg) | -5.62 to -2.87 st | -11.90 to +3.24 st | +0.50 st (`96%` neg) |
| **Spectral Centroid (24 kHz)** | 2,843 Hz | **2,826 Hz** | 2,533–2,976 Hz | 2,316–3,284 Hz | -17 Hz (-0.6%) |
| **Low Chest Band (`80–250 Hz`)** | 42.5% | **44.5%** | 39.0–49.3% | 26.6–61.1% | +2.0% |
| **Presence Band (`2–5 kHz`)** | 1.79% | **1.79%** | 1.46–2.03% | 0.80–3.04% | 0.00% |
| **Inter-Clause Pause Median** | 152.5 ms | **145.0 ms** | 130–174 ms | 105–210 ms | -7.5 ms |
| **Loudness Range (`LRA`)** | 2.15 LU | **2.15 LU** | 1.80–2.50 LU | 1.2–3.9 LU | 0.00 LU |
| **Peak-to-Loudness (`PLR`)** | 11.5 dB | **11.4 dB** | 10.8–12.1 dB | 8.1–12.9 dB | -0.1 dB |
| **Spoken Pace (`WPM`, catalog)** | 175 WPM (`N=5`) | **165.0 WPM** (`N=12` in-corpus) / **168.1 WPM** (`N=84` channel) | 157.7–175.9 WPM (`N=84`) | — | Stabilized ~165–176 WPM |

### Full `N = 50` Corpus Table

| Video ID | Views | Dur | `F0` Med | `p10–p90` Range | End Slope | Centroid | `80–250 Hz` | `2–5 kHz` | Pause Med | `LRA` | `PLR` | Topic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `SGgYDfeHYXA` | 72.2M | 73.3s | 157.3 Hz | 16.2 st | -7.17 st | 3210 Hz | 38.4% | 2.7% | 160 ms | 3.9 LU | 12.7 dB | Flying A Plane With No Pilot |
| `MSPVq-5sbCg` | 71.8M | 37.8s | 161.0 Hz | 16.7 st | -6.92 st | 2984 Hz | 39.6% | 1.9% | 190 ms | 2.3 LU | 11.2 dB | Toucan Gets A Custom Artificial Beak |
| `CRGWDiIgMZ4` | 62.5M | 27.7s | 152.7 Hz | 17.0 st | -5.36 st | 2940 Hz | 39.6% | 1.5% | 180 ms | 2.3 LU | 11.5 dB | How Cookiecutter Sharks Bite Whales |
| `9h2K1ny5REg` | 59.3M | 34.4s | 143.2 Hz | 16.4 st | -6.05 st | 2733 Hz | 43.3% | 1.6% | 140 ms | 1.3 LU | 8.3 dB | Catfish Tricks Another Fish Into Adoption |
| `7i6ok0llYUc` | 58.5M | 36.9s | 149.4 Hz | 15.8 st | -2.12 st | 2843 Hz | 49.9% | 2.0% | 150 ms | 2.3 LU | 12.3 dB | The Simple Experiment About Happiness |
| `yudJI1L8jlI` | 54.2M | 35.4s | 158.7 Hz | 16.4 st | -3.37 st | 3008 Hz | 41.6% | 2.0% | 170 ms | 2.3 LU | 11.5 dB | Eagle Gets A 3D Printed Beak |
| `gyOZv_ckZQU` | 53.2M | 31.3s | 135.6 Hz | 15.4 st | -4.98 st | 2844 Hz | 49.3% | 1.8% | 155 ms | 2.1 LU | 10.8 dB | Why Dobermans Have Cropped Ears |
| `WceU5A63tdI` | 52.7M | 41.3s | 157.7 Hz | 16.7 st | -6.11 st | 3155 Hz | 39.3% | 2.5% | 135 ms | 2.3 LU | 12.1 dB | Can A Moth Remember Its Life As A Caterpillar |
| `W3NlT3SKkmQ` | 51.6M | 30.0s | 141.8 Hz | 16.6 st | -5.68 st | 2316 Hz | 49.3% | 0.8% | 200 ms | 1.8 LU | 11.8 dB | How To Get Water Out Of Your Ear |
| `320fjAdEboQ` | 50.4M | 37.5s | 163.3 Hz | 17.3 st | -3.94 st | 3134 Hz | 31.4% | 1.7% | 110 ms | 2.0 LU | 11.3 dB | Turning Your Yard Into A War Trench |
| `5ZujVDQGBkg` | 48.0M | 26.7s | 140.4 Hz | 16.6 st | -6.02 st | 2521 Hz | 49.5% | 1.3% | 110 ms | 2.1 LU | 11.8 dB | The Fake Wobbly Tire Scam |
| `UgP7_6_i1J4` | 45.3M | 35.6s | 152.6 Hz | 17.2 st | -3.46 st | 2724 Hz | 36.8% | 1.9% | 115 ms | 1.8 LU | 12.8 dB | Why Disney's Castle Looks So Tall |
| `NdKRD1j9juE` | 44.7M | 40.6s | 151.3 Hz | 17.1 st | -5.13 st | 3045 Hz | 40.4% | 2.7% | 170 ms | 2.1 LU | 12.3 dB | He Drifted At Sea For 133 Days |
| `JuMFPaEQUDk` | 44.6M | 30.9s | 160.0 Hz | 17.3 st | -3.33 st | 2992 Hz | 32.4% | 1.6% | 145 ms | 2.2 LU | 11.1 dB | What Is Shark Finning? |
| `bZoR8A2znpo` | 44.0M | 32.5s | 134.2 Hz | 15.6 st | -2.19 st | 2548 Hz | 52.0% | 1.4% | 175 ms | 1.7 LU | 10.8 dB | How They Filmed An Invisible Man In Snow |
| `kmULoxXqhPg` | 43.9M | 33.7s | 144.5 Hz | 17.3 st | -3.38 st | 2954 Hz | 37.1% | 2.0% | 120 ms | 2.0 LU | 9.0 dB | She Faked A Rescue To Clean A Storm Drain |
| `mBXkAN-V4R0` | 42.6M | 25.7s | 159.1 Hz | 16.4 st | -7.14 st | 3067 Hz | 38.7% | 2.2% | 140 ms | 2.0 LU | 11.0 dB | Why Dogs Nails Bleed When You Cut Them |
| `dLQQV73fUI0` | 42.3M | 30.8s | 150.8 Hz | 15.2 st | -2.83 st | 2528 Hz | 45.2% | 1.8% | 180 ms | 1.8 LU | 11.5 dB | How Peter Parker's Spider Bite Was Filmed |
| `IzXhk-n16XE` | 41.8M | 61.6s | 140.1 Hz | 16.4 st | -4.75 st | 2949 Hz | 52.0% | 2.1% | 150 ms | 2.5 LU | 12.1 dB | What Is Plato's Cave |
| `izGBpPSoMoU` | 40.8M | 27.8s | 163.5 Hz | 15.5 st | -3.42 st | 3144 Hz | 44.5% | 2.4% | 140 ms | 2.2 LU | 12.9 dB | This 3D Printer Uses A Mosquito |
| `HC4-katIFCU` | 40.5M | 32.6s | 143.5 Hz | 15.7 st | -3.08 st | 2848 Hz | 47.0% | 2.4% | 170 ms | 1.4 LU | 11.2 dB | This Ant Can Launch With Its Face |
| `ckXySOvPBTc` | 40.1M | 28.4s | 153.6 Hz | 16.6 st | -11.90 st | 2399 Hz | 45.7% | 1.8% | 110 ms | 1.3 LU | 8.7 dB | How Do You Escape An Avalanche |
| `0kUCy60FBeY` | 39.6M | 44.8s | 138.9 Hz | 17.4 st | +0.01 st | 2906 Hz | 45.0% | 2.3% | 130 ms | 3.3 LU | 12.4 dB | The Boy Who Filled A Fence With Nails |
| `VorPD0Q4JtI` | 39.1M | 42.8s | 152.5 Hz | 16.7 st | -3.15 st | 2745 Hz | 39.4% | 1.9% | 180 ms | 3.0 LU | 11.0 dB | What Happens After A Kangaroo Is Born? |
| `fYJyVl6gcKI` | 38.8M | 35.6s | 155.8 Hz | 17.2 st | -6.10 st | 2766 Hz | 36.7% | 2.0% | 110 ms | 2.7 LU | 11.4 dB | How Lobster Traps Actually Work |
| `N1VSv7-h5Xc` | 38.3M | 38.2s | 142.8 Hz | 17.2 st | -4.61 st | 2714 Hz | 49.3% | 1.6% | 180 ms | 2.5 LU | 11.3 dB | He Fell 60 Feet Into A Well |
| `Ko9QQt43SpU` | 38.2M | 42.5s | 146.4 Hz | 16.3 st | -2.35 st | 2998 Hz | 49.2% | 2.1% | 130 ms | 3.5 LU | 12.7 dB | The True Story Of Winnie The Pooh |
| `eD4tv9bdCTg` | 37.9M | 28.3s | 156.6 Hz | 17.7 st | -7.02 st | 2895 Hz | 37.9% | 2.2% | 130 ms | 2.7 LU | 11.6 dB | He Grew 40 Fruits On One Tree |
| `WUfJ7Ph7D44` | 37.9M | 29.5s | 150.8 Hz | 15.8 st | -1.11 st | 2671 Hz | 42.9% | 1.5% | 145 ms | 2.1 LU | 11.4 dB | The Turtle Shelter Built For Tornadoes |
| `FOgGw9BVQV8` | 37.7M | 50.1s | 146.9 Hz | 17.9 st | -1.44 st | 3058 Hz | 44.5% | 1.8% | 110 ms | 2.6 LU | 12.8 dB | How Expectations Change Your Reality |
| `oiet6vWOciM` | 37.3M | 25.8s | 150.4 Hz | 16.5 st | -1.83 st | 2888 Hz | 38.9% | 1.4% | 130 ms | 1.8 LU | 11.7 dB | Japanese Eels Can Escape A Fish's Stomach |
| `FFrTF0ObUT0` | 36.7M | 44.9s | 161.0 Hz | 16.2 st | -4.40 st | 2356 Hz | 46.6% | 1.2% | 130 ms | 2.1 LU | 11.4 dB | His 27-Year Journey Walking Across Continents |
| `nejs3xdNZOM` | 36.3M | 24.3s | 148.7 Hz | 16.5 st | +3.24 st | 3168 Hz | 36.0% | 2.4% | 140 ms | 2.6 LU | 10.5 dB | Why Salt Kills Snails And Slugs |
| `gjR-Z2oSFWI` | 36.2M | 62.4s | 140.7 Hz | 16.7 st | -3.27 st | 2860 Hz | 42.1% | 1.8% | 130 ms | 2.7 LU | 12.5 dB | The Bald Paradox (explained) |
| `XFY7-td3LA8` | 35.8M | 30.8s | 142.7 Hz | 17.6 st | -2.97 st | 2954 Hz | 47.8% | 1.7% | 150 ms | 2.1 LU | 11.9 dB | How Mr. Potato Head Was Invented |
| `XKnmhvNpIvw` | 35.1M | 43.5s | 144.5 Hz | 16.9 st | -5.44 st | 2766 Hz | 45.5% | 1.6% | 180 ms | 2.4 LU | 11.5 dB | How To Extract Your DNA At Home |
| `v8T2cSQF2Lw` | 34.9M | 41.5s | 153.2 Hz | 16.9 st | -5.16 st | 2477 Hz | 41.0% | 1.0% | 130 ms | 1.6 LU | 8.7 dB | The Indestructible Nail Paradox |
| `zZVlkSIn8BY` | 33.6M | 27.9s | 157.1 Hz | 17.7 st | -6.14 st | 2934 Hz | 33.6% | 1.9% | 125 ms | 1.2 LU | 10.4 dB | Why Alcatraz Only Gave Prisoners Hot Showers |
| `5hd8MGDFcu8` | 33.1M | 37.8s | 148.9 Hz | 16.9 st | -5.11 st | 2507 Hz | 51.9% | 1.2% | 180 ms | 2.6 LU | 10.8 dB | Are Boneless Wings Actually Boneless? |
| `oMkomhg6s9o` | 33.0M | 43.1s | 140.4 Hz | 14.8 st | -3.59 st | 2467 Hz | 61.1% | 1.0% | 190 ms | 1.9 LU | 10.4 dB | Google Earth Helped Him Find His Lost Family |
| `pjuluvda0NU` | 33.0M | 37.7s | 154.1 Hz | 16.6 st | -4.08 st | 2444 Hz | 49.7% | 1.3% | 190 ms | 1.7 LU | 11.1 dB | How Actors Made Shopping Carts Popular |
| `4SST3VnvsZc` | 32.7M | 43.4s | 144.9 Hz | 17.2 st | -3.97 st | 2785 Hz | 37.1% | 1.6% | 150 ms | 1.8 LU | 10.8 dB | Can You Turn A Baby Into A Square? |
| `WiseQVjjOrs` | 32.1M | 29.8s | 143.0 Hz | 18.0 st | -6.02 st | 2337 Hz | 42.0% | 1.0% | 135 ms | 1.3 LU | 8.1 dB | The Car That Turned Into Two Cars |
| `NEgarf1vDTU` | 32.1M | 33.0s | 145.3 Hz | 15.7 st | -6.14 st | 2487 Hz | 50.7% | 0.9% | 210 ms | 2.4 LU | 11.6 dB | Maggots Started Falling From Her Ceiling |
| `9NkS2mbuxOI` | 32.0M | 49.5s | 147.3 Hz | 15.7 st | -2.74 st | 2323 Hz | 53.2% | 1.0% | 120 ms | 2.1 LU | 8.2 dB | Does Your Family Tree Outgrow Earth? |
| `QmKa42DgAgw` | 31.9M | 63.4s | 150.6 Hz | 17.2 st | -3.23 st | 2653 Hz | 45.1% | 1.7% | 105 ms | 1.5 LU | 8.8 dB | How Saving Every Month Builds Wealth |
| `HOcn2PYjFNg` | 31.6M | 31.6s | 163.0 Hz | 16.7 st | -4.03 st | 3284 Hz | 26.6% | 3.0% | 150 ms | 2.4 LU | 12.5 dB | What Happens If Mercury Touches Airplane Metal |
| `local_dreaming` | local | 36.3s | 141.2 Hz | 16.5 st | -1.60 st | 2809 Hz | 50.9% | 1.8% | 135 ms | 3.5 LU | 11.9 dB | Dreaming Text Test |
| `local_food` | local | 54.8s | 146.4 Hz | 15.8 st | -2.67 st | 2776 Hz | 52.0% | 1.5% | 210 ms | 2.7 LU | 11.4 dB | Bliss Point Pasta Sauce |
| `local_navy` | local | 30.5s | 134.3 Hz | 14.0 st | -1.91 st | 2502 Hz | 57.8% | 1.2% | 170 ms | 2.2 LU | 12.9 dB | Girl Joined Navy |
| **MEDIAN (`N=50`)** | **39.1M** *(47 YT)* | **35.6s** | **149.2 Hz** | **16.64 st** | **-3.96 st** | **2826 Hz** | **44.5%** | **1.79%** | **145 ms** | **2.15 LU** | **11.4 dB** | **Zack D. Films `N=50` Centroid** |

---

## 2. Full `English (US) + Masculine` Catalog Discovery (`37` Voices)

Filtering `gemini-3.8-flash-tts` with live facet labels `Language = "English (US)"` and `Gender = "Masculine"` returns **37 voices**: **21 new 3.8 voices** (`Arlo`..`Zeno`) plus **16 classic Gemini prebuilt voices** (`Achird`..`Zubenelgenubi`).

- **Catalog anomaly verified live:** `Olin` appears under `Gender = "Masculine"` (`Low pitch`), yet direct playback confirms a female register.
- **Classic preview export quirk:** `sample "<Name>" --out ...` works on all 21 new 3.8 voices on AI Studio web, but fails on the 16 classic voices; on `--backend api`, `/v1beta/voices` exposes no prebuilt preview WAV URLs, so audition via a short `speak` take.

### Screening Summary (`34` Auditioned Voices on `gemini-3.8-flash-tts`)
- **Top Pitch & Timbre Band (`130–167 Hz`, advanced to Round 1 Bake-Off):** `Rasalgethi`, `Zeno`, `Achird`, `Puck`, `Orus`, `Schedar`, `Iapetus`, `Fenrir`, `Koda`, `Varo`, `Mako` (`11` finalists).
- **Eliminated — Too Deep/Heavy (`79–120 Hz`):** `Milo` (`79.6 Hz`), `Neno` (`80.7 Hz`), `Bodi` (`84.2 Hz`), `Jett` (`89.3 Hz`), `Riko` (`91.7 Hz`), `Cruz` (`95.7 Hz`), `Brio` (`100.5 Hz`), `Gero` (`101.2 Hz`), `Knox` (`103.4 Hz`), `Ludo` (`104.2 Hz`), `Daro` (`105.5 Hz`), `Arlo` (`109.5 Hz`), `Enzo` (`109.7 Hz`), `Elio` (`114.1 Hz`), `Finn` (`119.4 Hz`), `Sadachbia` (`119.5 Hz`), `Rami` (`119.7 Hz`).
- **Eliminated — Lower-Mid / Non-Match Timbre (`122–140 Hz`):** `Charon` (`122.3 Hz`), `Umbriel` (`127.4 Hz`), `Zubenelgenubi` (`131.2 Hz`), `Sadaltager` (`133.8 Hz`), `Alnilam` (`139.6 Hz`).
- **Eliminated — Misclassified Gender:** `Olin` (female on playback).

---

## 3. Round 1 — 11-Voice Apples-to-Apples Bake-Off (`gemini-3.8-flash-tts`)

All 11 finalists spoke the exact same 97-word original Zack-style script (*Swallowing Gum Digestion*) on `gemini-3.8-flash-tts` at `temperature: 0.65` with identical concise `R1_Natural` style (`"Clear, curious American explainer narrator, steady conversational pace, crisp articulation, short natural breaths, clean downward declarative endings"`). Top 9 were anonymized as `V1..V9` and scored independently by 2 fresh blind judges against 3 real Zack D. Films `vox.wav` references.

| Rank | Voice (Blind ID) | Catalog Family | `F0` Med | `d` vs `N=50` | Range | End Slope | `mfccCos` | Judge 1 | Judge 2 | **Blind Avg** | Verdict |
| :---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **1** | **`Rasalgethi`** (`V4`) | Classic 3.8 | 145.2 Hz | 0.47 st | 16.2 st | -3.62 st | 0.8383 | 70 | 72 | **71.0** | **#1 Consensus Finalist** — closest F0/range/end-slope DNA |
| **2** | **`Zeno`** (`V5`) | New 3.8 | 144.2 Hz | 0.59 st | 13.4 st | +1.38 st | 0.7885 | 58 | **75** | **66.5** | **#2 Finalist** — Judge 2's #1 vocal tract; cleanest `/t/` |
| **3** | **`Achird`** (`V8`) | Classic 3.8 | 132.5 Hz | 2.05 st | 12.7 st | +0.97 st | 0.8454 | **74** | 56 | **65.0** | **#3 Finalist** — Judge 1's #1 dry vocal-tract weight |
| 4 | `Puck` (`V1`) | Classic 3.8 | 136.8 Hz | 1.50 st | 17.3 st | -0.92 st | 0.8114 | 62 | 64 | **63.0** | Clean & crisp; later jumped to #3 (`80.5`) after post-chain |
| 5 | `Orus` (`V9`) | Classic 3.8 | 151.1 Hz | 0.22 st | 11.9 st | +0.10 st | 0.8227 | 66 | 58 | **62.0** | Mature baritone, warmer chest weight than Zack |
| 6 | `Schedar` (`V3`) | Classic 3.8 | 137.2 Hz | 1.45 st | 14.5 st | +6.70 st | 0.8449 | 54 | 69 | **61.5** | Good pitch wave, slightly older/grittier timbre |
| 7 | `Fenrir` (`V6`) | Classic 3.8 | 157.8 Hz | 0.97 st | 13.2 st | -8.33 st | 0.8408 | 49 | 54 | **51.5** | Too soft/breathy on baseline style |
| 8 | `Koda` (`V2`) | New 3.8 | 137.9 Hz | 1.36 st | 12.3 st | +1.14 st | 0.8815 | 41 | 51 | **46.0** | **Old default overturned** — too soft/audiobook-breathy |
| 9 | `Varo` (`V7`) | New 3.8 | 132.6 Hz | 2.04 st | 13.1 st | -0.71 st | 0.8197 | 46 | 46 | **46.0** | Too chill/laid-back podcast tone |
| — | `Iapetus` *(unblinded)* | Classic 3.8 | 136.0 Hz | 1.60 st | 13.6 st | -2.76 st | 0.8450 | — | — | — | Slightly huskier/older baritone |
| — | `Mako` *(unblinded)* | New 3.8 | 131.6 Hz | 2.17 st | 14.9 st | -2.24 st | 0.8012 | — | — | — | Lower announcer-baritone |

---

## 4. Round 2 — Pure `gemini-3.8-flash-tts` Ablations, 5-Genre Generalization & Blind Ear-Test

All **22 takes** below were generated exclusively on **`gemini-3.8-flash-tts`** via `cli.ts --backend api` (`~/.config/gmn` 19-key pool rotation, zero errors), post-processed with the shipped [post-process.py](post-process.py), and scored against the **`N = 50` Zack D. Films Centroid** (`F0 = 149.2 Hz`, `range = 16.64 st`, `end = -3.96 st`, `pause = 145 ms`, `LRA = 2.15 LU`, `PLR = 11.4 dB`).

### A. Pure `gemini-3.8-flash-tts` Temperature, Style & Voice Matrix (`G1` 97-Word Script)

| Take ID | Voice | Style & Temp | Raw Dur (WPM) | Post Dur (WPM) | Post `F0` (`d` vs `N=50`) | Post Range | Post Pause | Post `I` / `LRA` / `PLR` | Key Finding |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `Ras_R1_t50` | `Rasalgethi` | `R1_Natural`, `t=0.50` | 30.56s (190) | 28.68s (203) | 147.4 Hz (0.20 st) | 13.9 st | 155 ms | -14.4 / 1.7 / 12.9 | Very safe diction, slightly steadier/less expressive wave |
| **`Ras_R1_t65`** | **`Rasalgethi`** | **`R1_Natural`, `t=0.65`** | 29.83s (195) | 27.24s (214) | 133.7 Hz (1.89 st)* | 14.7 st | 150 ms | -14.3 / 1.3 / 12.8 | **Blind #1 tie (`84.0/100`), Judge 2's #1 (`86`), zero slurs (`88.5` artic)** |
| `Ras_R1_t75` | `Rasalgethi` | `R1_Natural`, `t=0.75` | 29.20s (199) | 27.38s (213) | 148.8 Hz (0.04 st) | 16.9 st | 175 ms | -14.2 / 1.1 / 12.7 | **Slur caught by both blind judges (`"steadily"` → `"stedery"`, `67.0/100`)** |
| `Ras_R1_t85` | `Rasalgethi` | `R1_Natural`, `t=0.85` | 29.68s (196) | 27.76s (210) | 146.5 Hz (0.31 st) | 13.7 st | 125 ms | -14.2 / 1.1 / 12.7 | Higher variance, rougher endings (`end +4.31 st` raw) |
| `Ras_Gold_NoShorts_t65` | `Rasalgethi` | 35-word `Goldilocks` NoShorts, `t=0.65` | 30.08s (194) | 28.14s (207) | 141.5 Hz (0.91 st) | 15.9 st | 130 ms | -14.3 / 1.3 / 12.8 | Over-directed 35-word style adds theatrical clause emphasis |
| `Ras_Gold_NoShorts_t70` | `Rasalgethi` | 35-word `Goldilocks` NoShorts, `t=0.70` | 31.95s (182) | 29.97s (194) | 149.3 Hz (0.02 st) | 15.2 st | 175 ms | -14.2 / 1.9 / 12.7 | **#2 acoustically (`38.9%`), yet #7 by ear (`65.0`, `-19 pts` vs `R1_Natural`!) — halting/staged pauses** |
| `Ras_Gold_Shorts_t70` | `Rasalgethi` | 34-word `Goldilocks` + `"Shorts"`, `t=0.70` | 29.80s (195) | 28.07s (207) | 141.2 Hz (0.95 st) | 15.1 st | 180 ms | -14.2 / 1.3 / 12.7 | Adding `"Shorts"` shaved `2.15s` raw (`+13 WPM` faster) & thinned low band (`11.3%`) |
| `Ras_NoStyle_t65` | `Rasalgethi` | Empty `style: ""`, `t=0.65` | 27.74s (210) | 26.12s (223) | 132.0 Hz (2.11 st) | 13.6 st | 120 ms | -14.2 / 1.4 / 12.7 | Baseline without `style`: drops `F0` `-2.1 st`, rushes (`210 WPM` raw), wider raw `LRA 3.7 LU` |
| `Ras_Deadpan_t70` | `Rasalgethi` | `"deadpan-curious"`, `t=0.70` | 28.65s (203) | 26.51s (220) | **121.8 Hz (3.51 st)** | 13.3 st | 190 ms | -14.8 / 1.8 / 13.3 | **Worst acoustic score (`23.5%` post) — `"deadpan"` sinks `F0` `-3.5 st` on pure `flash-tts`!** *(Earlier pure `flash-tts` web deadpan takes also dropped `Rasalgethi` to `110.0 Hz` / `-4.8 st` and `Zeno` to `117.6 Hz` / `-3.5 to -4.4 st`.)* |
| **`Zeno_S3_t70`** | **`Zeno`** | **`S3_Urgent`, `t=0.70`** | 26.74s (218) | 25.33s (230) | **152.6 Hz (0.40 st)** | 15.6 st | 190 ms | -14.3 / 1.5 / 12.8 | **Blind #1 tie (`84.5/100`), unanimous #1 Shorts energy (`Prosody 84.5`, `Polish 87.0`)** |
| `Zeno_R1_t65` | `Zeno` | `R1_Natural`, `t=0.65` | 30.77s (189) | 28.73s (203) | 137.0 Hz (1.47 st) | 15.1 st | 180 ms | -14.5 / 1.7 / 13.0 | Blind #4 (`76.0/100`) — `-8.5 pts` below `Zeno S3`; `Zeno` needs `S3_Urgent` energy |
| `Achird_S3_t70` | `Achird` | `S3_Urgent`, `t=0.70` | 27.26s (214) | 26.83s (217) | **149.2 Hz (0.01 st)** | 13.5 st | 150 ms | -14.5 / 2.3 / 13.1 | **#1 acoustically (`39.5%`), yet #5 by ear (`71.0`, `Polish 56.5`) — loud fast `<260 ms` inhales bypass gap-trim!** |
| `Achird_R1_t65` | `Achird` | `R1_Natural`, `t=0.65` | 29.24s (199) | 26.43s (220) | 143.5 Hz (0.67 st) | 12.6 st | 190 ms | -14.5 / 1.8 / 13.0 | Calmer essayist weight; narrower `12.6 st` range |
| **`Puck_R1_t65`** | **`Puck`** | **`R1_Natural`, `t=0.65`** | 30.45s (191) | 28.34s (205) | 142.6 Hz (0.78 st) | 15.2 st | 180 ms | -14.2 / 1.2 / 12.7 | **Breakout Blind #3 (`80.5/100`)** — bright-reedy formant + high realism (`83.0` avg), tiny finale hitch |

*\*Stochastic take-to-take F0 note: On `gemini-3.8-flash-tts`, identical `Rasalgethi` `R1_Natural` `t=0.65` prompts show natural `±8–15 Hz` (`±1–1.5 st`) take-to-take F0 variance (`145.2 Hz` in Round 1 vs `133.7 Hz` here), yet both scored top-2 by ear. Generating 2 takes via `--backend api` (~6s each) lets you pick the brightest/cleanest take.*

### B. 5-Genre Generalization Check (`Rasalgethi` Recipe A `t=0.65` vs `Zeno` Recipe B `t=0.70`)

Both locked recipes were tested across **5 distinct Zack D. Films genres** (~91–97 words each) on pure `gemini-3.8-flash-tts` and processed through [post-process.py](post-process.py):

| Genre & Script | `Rasalgethi` (`R1_Natural`, `t=0.65`, Post) | `Zeno` (`S3_Urgent`, `t=0.70`, Post) | Generalization Takeaway |
| --- | --- | --- | --- |
| **G1 Anatomy/Medical** (*Swallowing Gum*, 97w) | `27.24s` (214 WPM), `14.7 st`, `-14.3 LUFS / 1.3 LU / 12.8 dB`, `150 ms` pause | `25.33s` (230 WPM), `15.6 st`, `-14.3 LUFS / 1.5 LU / 12.8 dB`, `190 ms` pause | Virtual tie at #1 blind (`84.0` vs `84.5`); `Rasalgethi` cleaner/more organic, `Zeno` faster |
| **G2 Physics/Danger** (*Mercury on Airplane*, 94w) | `32.56s` (173 WPM), `14.6 st`, `-2.49 st` end, `-14.5 LUFS / 1.5 LU / 13.0 dB`, `140 ms` | `30.11s` (187 WPM), `16.8 st`, `-1.48 st` end, `-14.5 LUFS / 1.6 LU / 13.0 dB`, `120 ms` | Both locked into Zack's `168–187 WPM` pocket; `post-process.py` stripped 5–6 inhales cleanly |
| **G3 Dark History** (*Alcatraz Hot Showers*, 97w) | `30.82s` (189 WPM), `13.5 st`, `-1.43 st` end, `-14.2 LUFS / 1.5 LU / 12.7 dB`, `185 ms` | `30.56s` (190 WPM), `15.7 st`, `-14.7 LUFS / 2.1 LU / 13.2 dB`, `120 ms` | Matched `~190 WPM` cadence; `Rasalgethi` kept firm falling closes (`-1.43 st`) |
| **G4 Visceral Nature** (*Japanese Eel*, 91w) | `32.79s` (167 WPM), `15.4 st`, `-14.1 LUFS / 1.5 LU / 12.6 dB`, `130 ms` | `30.16s` (181 WPM), `16.0 st`, `-14.5 LUFS / 1.8 LU / 13.0 dB`, `190 ms` | Zero clipping/slurs; `Rasalgethi` hit exact `167 WPM` channel median (`168.1 WPM`) |
| **G5 Wholesome Rescue** (*Blind Dog & Goose*, 94w) | `28.26s` (200 WPM), `14.2 st`, `-14.3 LUFS / 1.6 LU / 12.8 dB`, `185 ms` | `26.04s` (217 WPM), `15.8 st`, `-2.58 st` end, `-14.4 LUFS / 1.0 LU / 13.1 dB`, `120 ms` | `Rasalgethi` shifts smoothly into warm empathy without sounding cheesy; `Zeno` stays zippy |

### C. Pure `gemini-3.8-flash-tts` 2-Judge Blind Ear-Test (`B1–B8` vs `N = 50` Refs)

Eight anonymized pure `gemini-3.8-flash-tts` takes (`B1..B8`, including `B8` as an **unprocessed RAW control** of `B2`) were evaluated blindly by 2 fresh independent judges (`Flash38 Blind Ear Judge 1` and `Flash38 Blind Ear Judge 2`) against 3 real isolated `N = 50` viral vocals (`oiet6vWOciM` 37.3M, `CRGWDiIgMZ4` 62.5M, `dLQQV73fUI0` 42.3M):

| Rank | Blind ID & Pure `flash-tts` Config | Judge 1 (Timb / Pros / Pol / Artic / Real / **All**) | Judge 2 (Timb / Pros / Pol / Artic / Real / **All**) | **Blind Avg** | Decisive Finding |
| :---: | --- | --- | --- | ---: | --- |
| **1 (tie)** | **`B3` — `Zeno` (`S3_Urgent`, `t=0.70`, + Post)** | 85 / 83 / 87 / 88 / 81 / **84** | 85 / 86 / 87 / 88 / 82 / **85** | **84.5** | **Unanimous #1 Shorts energy** (`Pros 84.5`, `Pol 87.0`); crisp & fast |
| **1 (tie)** | **`B6` — `Rasalgethi` (`R1_Natural`, `t=0.65`, + Post)** | 82 / 80 / 85 / 86 / 80 / **82** | 85 / 85 / 88 / **91** / **88** / **86** | **84.0** | **Virtual tie #1 (`0.5` pt)**; Judge 2's #1 overall, #1 Artic (`88.5`), #1 finished Human Realism (`84.0`) |
| **3** | **`B5` — `Puck` (`R1_Natural`, `t=0.65`, + Post)** | 75 / 79 / 81 / 87 / **88** / **79** | **86** / 80 / 84 / 88 / 78 / **82** | **80.5** | **Unanimous #3 backup** — closest bright/reedy upper-mid edge (`86` J2) & strong realism (`88` J1), minor finale hitch |
| 4 | `B7` — `Zeno` (`R1_Natural`, `t=0.65`, + Post) | 77 / 78 / 79 / 86 / 86 / **77** | 78 / 72 / 78 / 86 / 80 / **75** | **76.0** | Proves `S3_Urgent` lifts `Zeno` **`+8.5` pts** over `R1_Natural` |
| 5 | `B1` — `Achird` (`S3_Urgent`, `t=0.70`, + Post) | 74 / 76 / **58** / 85 / 82 / **71** | 76 / 77 / **55** / 86 / 84 / **71** | **71.0** | **Both judges caught loud `<260 ms` raw inhales** despite #1 acoustic score (`39.5%`) |
| 6 | `B4` — `Rasalgethi` (`R1_Natural`, **`t=0.75`**, + Post) | 73 / 67 / 81 / **54** / 64 / **64** | 80 / 75 / 82 / **58** / 68 / **70** | **67.0** | **Both judges caught `"steadily"` → `"stedery"` L→R slur (`-17.0` pts vs `t=0.65`!)** |
| 7 | `B2` — `Rasalgethi` (35w `Goldilocks`, `t=0.70`, + Post) | 62 / 60 / 74 / 84 / 66 / **63** | 68 / 64 / 76 / 89 / 83 / **67** | **65.0** | **Over-directed 35-word style caused halting pauses (`-19.0` pts vs concise 17w `R1_Natural`!)** |
| 8 | `B8` — `Rasalgethi` (35w `Goldilocks`, `t=0.70`, **RAW**) | 62 / 59 / **46** / 84 / 63 / **56** | 69 / 66 / **50** / 88 / 85 / **64** | **60.0** | **RAW control:** `post-process.py` added **`+27.0` Polish** (`48 → 75`) & **`+5.0` Overall** on the identical recording |

---

## 5. Production Sign-Off & Key Lessons for Future AIs

1. **Locked Recipes Confirmed at `N = 50` (Pure `gemini-3.8-flash-tts`):**
   - **Recipe A (Locked Primary Default):** **`Rasalgethi`** + concise `R1_Natural` (`t=0.65`) + [post-process.py](post-process.py) (`--preset rasalgethi`) — **`84.0/100`** blind avg (Judge 2 #1 at `86`, human producer #1 pick for realistic human inflection, spotless `88.5` articulation, zero slurs).
   - **Recipe B (High-Punch Urgent Alternative):** **`Zeno`** + `S3_Urgent` (`t=0.70`) + [post-process.py](post-process.py) (`--preset zeno`) — **`84.5/100`** blind avg (Judge 1 #1 at `84`, unanimous #1 Shorts energy).
   - **Backup #3 (Bright/Reedy Alternative):** **`Puck`** + `R1_Natural` (`t=0.65`) + [post-process.py](post-process.py) (`--preset rasalgethi`) — **`80.5/100`** blind avg (unanimously overtook `Achird` `71.0`).
2. **Hard Model Policy & API Fallback:** **`gemini-3.8-flash-lite-tts` is banned** and rejected by `cli.ts`. When AI Studio web hits daily quota, switch to `cli.ts --backend api` (`~/.config/gmn` rotating key pool on `gemini-3.8-flash-tts`, zero Chrome needed); if all API keys exhaust quota, **STOP and report** — never switch models.
3. **Why Concise Style & `t=0.65` Win on `gemini-3.8-flash-tts`:** Long 35-word directive stacks (`Goldilocks`, `65.0`) made `Rasalgethi` halt mid-clause (`-19.0 pts` vs 17-word `R1_Natural`), and raising `temperature` from `0.65` (`84.0`) to `0.75` (`67.0`) triggered a clear `"steadily"` → `"stedery"` slur (`-17.0 pts`). Conversely, `Zeno` benefits from `S3_Urgent` (`84.5` vs `76.0` on `R1_Natural`).
4. **Never Cast by Acoustic Numbers Alone:** `Achird_S3_t70` (`#1` acoustically at `39.5%`, `F0 149.2 Hz`) and `Ras_Gold_NoShorts_t70` (`#2` acoustically at `38.9%`, `F0 149.3 Hz`) placed `#5` and `#7` by ear because acoustic stats miss fast `<260 ms` inhales (`Achird`) and halting theatrical phrasing (`Goldilocks`). Always listen directly via `read_file` on WAV before shipping!
5. **Post-Chain Safety Confirmed:** Across all 22 pure `flash-tts` takes (`5` genres), [post-process.py](post-process.py) (`tail_ms=95`, `trim_over_ms=260`, `target_gap_ms=185`, `20 ms` cosine tapers, 2-pass linear EQ/compression) achieved **`I = -14.1 to -14.8 LUFS`**, **`TP = -1.5 to -1.3 dBTP`**, **`LRA = 1.0–2.3 LU`**, **`PLR = 12.6–13.3 dB`**, and **`+27.0` blind Polish points** with zero clipped word tails.
