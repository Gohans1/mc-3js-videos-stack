# Finishing: motion blur, banding, colour, encode, mux and deliverables

Covers everything between "the picture code is done" and "the files are shipped": the render modes, true motion blur as a render pass, banding, BT.709 colour, encoder settings, the audio mux, splicing, and every deliverable format. Read it before Step 9 (Render and finish) and Step 11 (Deliver), and whenever a render looks different from the Studio.

The numbers here are house defaults with normal ranges. Start from them; change one when a measurement tells you to.

**Contents**

1. [Render modes at a glance](#1-render-modes-at-a-glance)
2. [Motion blur is a render pass](#2-motion-blur-is-a-render-pass)
3. [Banding](#3-banding)
4. [Colour: BT.709 everywhere](#4-colour-bt709-everywhere)
5. [Encoder settings](#5-encoder-settings)
6. [Audio mux](#6-audio-mux)
7. [Chunked renders and splices](#7-chunked-renders-and-splices)
8. [Deliverables](#8-deliverables)
9. [Gates](#9-gates)

---

## 1. Render modes at a glance

In Live Studio (`templates/film` / `packages/live-studio`), `bun run render` captures deterministic WebGL frames via headless Chromium and encodes with ffmpeg; standalone Cinetic Python scripts (`scripts/probe.py`, `scripts/check-sync.py`, `scripts/forensics.py`, `scripts/sheet.py`, `scripts/accumulate.py`) gate and finish the output and exit 1 if a check fails.

| Mode                     | Command                                                                                               | What happens                                                                                                                        | Relative cost |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Stills                   | `AT=0.5,2.0,4.5 bun run render stills`                                                                | captures exact timestamps at full resolution as lossless PNG stills for fast framing and lighting checks                            | seconds       |
| Excerpt / clip           | `FROM=4 TO=8 bun run render clip`                                                                     | renders only the `[FROM, TO]` window so you can iterate on one beat or seam in seconds                                              | ~0.2×         |
| Preview / draft          | `FPS=30 SCALE=0.5 bun run render`                                                                     | half-resolution fast pass for pacing, camera continuity and `python3 scripts/sheet.py --video <mp4>` contact sheets                 | ~0.3×         |
| Sharp master             | `bun run render`                                                                                      | full-resolution H.264 BT.709 render with the mixed soundtrack (`sound.py` / `score.py`), verified by `probe.py` and `check-sync.py` | 1×            |
| Sub-frame shutter master | sharp pass → `python3 scripts/measure-speed.py` → sub-frame capture → `python3 scripts/accumulate.py` | averages sub-frames in 32-bit float and quantises once with ±1 LSB TPDF dither in smooth ramps                                      | 3–8× typical  |
| Contact sheet            | `python3 scripts/sheet.py --video out/film.mp4 --out out/qa/sheet.png`                                | ffmpeg/OpenCV cuts labelled frame tiles directly from any rendered MP4                                                              | seconds       |

### The whole film first

A run delivers a complete film inside its budget, on a busy machine too. The order that guarantees it:

1. **The ending early.** Capture the closing seconds first (`AT=... bun run render stills`): the extruded 3D mark, the lockup landing and its hold must read cleanly before rendering the full timeline.
2. **A whole draft early.** Render a fast half-size pass and cut contact sheets directly from the MP4 with `python3 scripts/sheet.py --video out/draft.mp4 --out out/qa/draft-sheet.png` (or `--frames A-B --every N` for one act) and `bash scripts/grab.sh out/draft.mp4 120,480` for exact full frames.
3. **Targeted excerpts for fixes.** Re-render only the edited `[FROM, TO]` window (`FROM=A TO=B bun run render clip`) while tuning camera curves, optical transitions or directional shutter smear (`film-stage/velocity.ts`).
4. **Master + gates at the end.** Render the full master once, attach the mastered `-14 LUFS / -1.5 dBTP` soundtrack, and run `python3 scripts/probe.py`, `python3 scripts/check-sync.py` and `python3 scripts/forensics.py`.

### Fast by default

Renders on an ordinary workstation are bounded by WebGL frame capture and readback, not H.264 encoding:

| Look or render         | Command                                                     | What makes it fast                                                                                                                |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| New film scaffold      | `bun run new-film <slug>`                                   | clones `templates/film` with workspace links (`film-stage`, `film-kit`, `mc-actor`, `mc-assets`, `live-studio`) ready immediately |
| Spot stills            | `AT=1.0,3.5,8.0 bun run render stills`                      | one headless Chromium session seeks to each timestamp `t` deterministically                                                       |
| Contact sheet from MP4 | `python3 scripts/sheet.py --video out/film.mp4 --every 30`  | extracts frames directly from the rendered video with frame + timestamp labels                                                    |
| Automated frame QA     | `bun run framecheck`                                        | checks black frames, NaN transforms and WebGL errors before full master encoding                                                  |
| Spec & sync gate       | `python3 scripts/probe.py out/film.mp4 --spec 1920x1080@60` | verifies exact resolution, fps, `yuv420p`, `bt709/bt709/bt709/tv` tags and stream duration                                        |

- **GL backend.** Headless Chromium (`chrome-headless-shell`) uses ANGLE/GPU hardware acceleration when available and falls back to SwiftShader (`swangle`) when GPU contexts are unavailable. Keep deterministic shaders (`film-stage/grade.ts`, `transitions.ts`, `velocity.ts`) free of undefined precision tricks so hardware and software GL match within noise.
- **Encoder.** Browser WebGL readback is the bottleneck, not `x264`: `x264 slow` at CRF 14 adds negligible wall time over `veryfast` while keeping dark gradients and fine geometry clean. Use PNG intermediates (or `grade.ts` TPDF dither) whenever dark skies or volumetric pools would band under JPEG q80.
- **Frame rate.** 30 fps halves total frame count compared to 60 fps. Keep sharp camera moves under ~25 px/f at 1080p at 30 fps, enable `film-stage/velocity.ts` directional shutter smear on whip/dive peaks, or run `accumulate.py` float shutter accumulation for ultra-fast moves. Choose 60 fps when fast continuous 3D camera travel demands maximum temporal resolution.

**Spend heavy passes once.**

- **Iterate in Live Studio & short excerpts.** Scrub live in `bun run studio` and render short `FROM/TO` clips during look-dev (`references/review-loop.md` §1).
- **Run full masters in the background** when rendering long 60 fps timelines, and prepare audio credits or delivery notes meanwhile.
- **Re-render only changed act ranges** and splice on clean act boundaries (§7) when fixing a single late shot.

## 2. Motion blur is a render pass

**Blur is a declared policy.** `LOOK.blur` in `timeline.ts` says what the film is: `'crisp'` (the default) renders flat
graphics sharp at any speed, one sample a frame, and only the frames inside a declared `CAMERA_BLUR` range (or `film-stage/velocity.ts` shutter smear peaks) get shutter blur; `'camera'` puts a 180° shutter on every frame moving faster than
about 900-1200 px/s, as a cinema camera would. Declared steps (a snap zoom's jump, a stepped layer, a make-room jump),
flashes, hard seams and act starts always render from one sample in either policy. `measure-speed.py --policy auto`
(the default) reads the declaration from `out/cues.json`, and `--policy crisp|camera` overrides. Defocus is a separate tool (`references/camera.md` §5), never a stand-in for motion blur.

Under the camera policy, anything that moves faster than about 12 px per frame at 60 fps strobes without blur: the eye
sees discrete copies instead of motion. `measure-speed.py` prints the peak speed, so you do not have to guess.

Blur has a ceiling too. Past about 60–80 px/f a 180° shutter smears an element into a streak 40–50+ px long, and the samples that fit in one frame show as stepped copies along it: the "artificial smear" a viewer reads as a glitch. Keep any one element under that speed and redesign faster moves (a cut on the beat, a match cut, a mask wipe, a shorter distance; `references/transitions.md`). Under the camera policy `measure-speed.py` lists the frames over 80 px/f as `too_fast` (a crisp film instead gets the `speed-ceiling` warning for a frame over 3000 px/s for more than 14 f). A frame-filling edge (a wipe, a flood, an iris, a zoom-through) may run 150–300 px/f for a few frames without stepped copies; check it at full size, then waive it with `--accept-fast A-B`.

**Cuts are act boundaries.** An output frame averages sub-frames from a third of a frame before and after its time, so a hard cut inside an act turns its frame into a 50/50 double exposure of the two shots, and on a payoff beat that reads as a glitch. `src/blur.ts` clamps samples inside an act, so a cut at an act boundary stays crisp. `measure-speed.py` renders the hard cuts it can measure with one sample; make every real cut an ACT/shot boundary.

### Why not in the browser

- **`CameraMotionBlur`** (browser DOM layer-stacking) stacks N copies of the scene, each at `opacity(1/N)` with `mix-blend-mode: plus-lighter`, frozen at `f − shutter·i/N + 1`. The shutter therefore sits _ahead_ of the frame instead of centred on it, and every layer is quantised to 8 bits before it is added. You get posterised plateaus in soft gradients, light greys tinted cyan or pink, rings with coloured fringes, and a frame that darkens a little per sample. It also spends N renders on frames that do not move.
- **`HtmlInCanvasMotionBlur`** centres the shutter correctly but accumulates on an 8-bit 2D canvas (`globalAlpha = 1/N`, `lighter`), so it quantises the same way, and it needs Chromium ≥ 149. Sandboxes often ship an older headless shell.

Average outside the browser, in float, and quantise once.

### The pass

The standalone sub-frame shutter pipeline runs four steps, each its own script:

1. **Sharp render** of the film (CRF 12, native colour), used only for optical-flow speed measurement.
2. **`python3 scripts/measure-speed.py sharp.mp4 out/samples.json`** decides the samples per frame (`groups`) from optical flow.
3. **Sub-frame render.** Capture the film at the fractional sub-frame timestamps in `out/samples.json` (`--crf=6 --pixel-format=yuv444p` or lossless PNG).
4. **`python3 scripts/accumulate.py sub.mp4 out/samples.json picture.mp4`** averages each frame's group in float, quantises once (flat fields exact, dither only in smooth ramps; §5) and encodes BT.709 CRF 14.
5. **Mux**, then **`python3 scripts/check-sync.py`** and **`python3 scripts/probe.py`** (§6, §9).

Sub-frame sampling (`sampleTimes`) clamps samples within each act:

```ts
export const SHUTTER = 180; // degrees; measure-speed.py assumes the same
export const sampleTimes = (f: number, n: number): number[] => {
  if (n <= 1 || policyAt(f) === 'crisp' || isDiscrete(f)) return [f]; // the declared policy and steps
  const a = ACTS.find((x) => f >= x.from && f < x.from + x.dur) ?? { from: 0, dur: TOTAL };
  const span = SHUTTER / 360, lo = a.from, hi = a.from + a.dur - 1e-3;
  return Array.from({ length: n }, (_, i) => Math.min(hi, Math.max(lo, f + span * ((i + 0.5) / n - 0.5))));
};
// Sub-frame pass: j-th capture evaluates renderFrame(subs[j].t / FPS)
```

The shutter is centred on the frame (a 180° shutter spans f ± 1/4). Samples are clamped inside the frame's act, so the frame before a cut never averages in the next shot.

### How many samples

```
n = 1                                             if speed < 2 px/f   (renders once)
n = clamp(ceil((shutter/360) · speed / step), 4, 48)   otherwise; shutter 180°, step 3 px (8 at most in a declared film)
```

| Peak speed (px/f) | 2–18 | 30  | 60  | 80  | 120 | ≥ 144    |
| ----------------- | ---- | --- | --- | --- | --- | -------- |
| Samples           | 4    | 7   | 14  | 18  | 27  | 32 (cap) |

Above the cap (144 px/f with a 3 px step), 32 samples can't stay 3 px apart across the shutter. Those frames get a **shorter shutter** instead (`shutters` in the samples JSON, read by `src/blur.ts`), just long enough that the samples stay 3 px apart: a shorter, clean streak rather than a long one with stepped copies. `--no-short-shutter` keeps the full shutter. Either way the move is over the ceiling above and wants a redesign.

### Measuring speed (`measure-speed.py`)

Every over-read costs render time for nothing, so only motion the flow can vouch for counts.

- **Consistent flow only.** Dense Farneback flow is computed both ways; a pixel counts only where following it forward and back returns to the start (within 0.5 px + 10%). Flat interiors, occluded edges and aliased repeats (a grid of look-alike tiles) fail that test; they were what made a raw maximum read 2–3× too fast. The dense speed is the k-th fastest consistent moving pixel (k = max(30 px, 0.1%)), which still catches a small fast object (a spark, a projectile, one word).
- **Consistent tracks, at a high percentile.** Pyramidal Lucas–Kanade corner tracks with a forward-backward error under 1 px count only when at least two neighbours within 64 px move the same way; the 90th percentile of those is the sparse speed, not the maximum. The larger of dense and sparse wins.
- **No one-frame spikes.** A frame more than 1.25× faster than both neighbours stands only when dense and sparse agree within 30% (a peaky whip does; an object entering from off-frame, whose edge the dense flow misreads, does not). Otherwise it takes its faster neighbour.
- **Cuts contribute nothing.** A pair where most pixels change (`--cut-frac 0.5`) and the flow can't explain it (a hard cut, a flash, a full-frame luminance flip) is listed under `cuts` and takes no speed; a whip pan changes most pixels too, but the flow explains it, so it keeps its speed. Smaller unexplained changes are `suspect_cuts`; with `--cues`, those away from act boundaries are flagged, because sub-frames only stay on one side of a cut that is an act boundary.
- **The shutter straddles the frame**, so frame f takes the faster of its incoming and outgoing move, and a **±2 frame temporal max filter** stops the count flickering (4 → 34 → 4 reads as blur strobing on and off).
- **Floors** for ranges you know are fast but flow can't see: `--floor 1210-1260:16`. Flow's blind spots are an edge with no 2D structure (a flat band wiping across the full frame reads about 0) and a small flat object jumping more than about 300 px/f at 1080p (both trackers lose it).
- **Analytic speed**: if the timeline can export true screen velocity, pass `--analytic out/speed.json` (`{"speed": [px/f per frame]}` or `{"ranges": [{"from", "to", "speed"}]}`); the larger of flow and analytic wins.
- **Re-deciding without re-measuring.** Pass an earlier samples JSON instead of a video (`python3 scripts/measure-speed.py out/samples.json out/samples-6x.json --budget 6`) to recompute the groups from its saved speed track.

Measured against the previous robust-maximum version on the same files:

| Film                                                                                               | Frames | Before                               | Now                                                                | What changed                                   |
| -------------------------------------------------------------------------------------------------- | ------ | ------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------- |
| Starter demo, before its landings were slowed (the dome's drop: analytic 98.5 px/f at its fastest) | 540    | 2,531 (4.7×); the drop read 274 px/f | 1,689 (3.1×); the drop reads 98 px/f, the block 166 (analytic 165) | flat-shape and entering-edge misreads gone     |
| A 25 s teaser built on a grid of look-alike tiles                                                  | 1,500  | 18,415 (12.3×), peak 945 px/f        | 7,118 (4.7×), peak 246 px/f                                        | the grid no longer aliases                     |
| Tessel, sharp preview                                                                              | 1,980  | 40,079 (20.2×), peak 2,115 px/f      | 17,987 (9.1×), peak 246 px/f                                       | a genuinely fast film: 315 frames over 80 px/f |
| Tessel, the blurred master itself                                                                  | 1,980  | 33,134 (16.7×), peak 1,880 px/f      | 17,733 (9.0×), peak 394 px/f                                       | smears no longer read as speed                 |

Measuring takes about 1.7× as long as before (backward flow on the frames where it matters): 73 s for the starter's 540 frames, 5 min for 1,500 frames of dense UI. It saves far more than it costs.

### Rules the picture code must follow

- **Every hard cut is an act boundary.** Sub-frames only stay on one side of a cut because `sampleTimes` clamps to the act. A cut inside an act blends the next shot into the last frame of the previous one.
- **Discrete state reads `fd(frame)` (`Math.round`).** Sub-frame sampling evaluates the scene at fractional frames. Any discrete state (stepped glyph scrambles, counters, blinking indicators, instant visibility switches) that reads raw fractional `f` instead of `fd` would disagree across one output frame's samples and ghost at half-opacity. Discrete state always reads `fd`.
- **Grain and noise are keyed to `fd`**, or they average away into mush.
- **Everything is deterministic.** Seeded `random()` only; sub-frames are rendered by several browser tabs in any order.

### Cost

| Film                                                         | Frames | Sub-frames | Ratio | Time on 4 CPUs                                                                             |
| ------------------------------------------------------------ | ------ | ---------- | ----- | ------------------------------------------------------------------------------------------ |
| Starter demo, whole 9 s                                      | 540    | 1,415      | 2.6×  | 273 s end to end: bundle 15, sharp pass 26, measurement 73, sub-frames 66, accumulation 51 |
| Starter demo, act 2 with `--samples-from` and `--budget 2`   | 180    | 396        | 2.2×  | 55 s (48 frames capped at 4 samples, shorter shutter)                                      |
| Tessel master (33 s), measured before the consistency checks | 1,980  | 19,841     | 10.0× | 3,387 s at concurrency 4 (0.17 s per sub-frame, all in)                                    |

Still frames cost one render, so the ratio depends on how much of the film moves and how fast. To save time, cap the total with `--budget`, and re-render only the acts that changed (§7).

### Uniform oversampling

When a renderer seeks `t = frame/fps` uniformly instead of taking an adaptive sub-frame schedule, render at `fps × K` and average uniformly: `python3 scripts/accumulate.py 'frames/*.png' out/picture.mp4 --uniform 4 --in-fps 240`. Each output frame averages the `ceil(K·240/360)` sub-frames centred on it (K = 4 gives 3 samples, 0.25 f apart), clean to roughly 12–18 px/f.

## 3. Banding

Chromium and 8-bit framebuffers quantise CSS/canvas gradients to 256 levels. A ramp that spans only a few code values (a pool of light on ink going 11 → 29, a stone floor going 231 → 247) shows as contour rings, about one per code value. Nothing downstream can fix an already-quantised 8-bit source.

- **In 3D WebGL (`film-stage/grade.ts`):** the final post-processing shader applies **triangular TPDF dither** (`dither: 1 / 255`) in high-precision float right before 8-bit framebuffer output, eliminating sky, fog and vignette banding automatically.
- **In flat plate backdrops:** compute the gradient in float, add ±1 LSB triangular dither, quantise once, and load it as an image:

```json
{
  "size": [1920, 1080],
  "seed": 11,
  "backdrops": [
    {
      "name": "pool-ink",
      "type": "radial",
      "at": [0.5, 0.45],
      "radius": [0.7, 0.6],
      "stops": [
        ["rgba(255,255,255,0.075)", 0],
        ["transparent", 0.7]
      ]
    },
    {
      "name": "table",
      "base": "#E7E8EC",
      "type": "radial",
      "at": [0.5, 0.4],
      "radius": [0.65, 0.6],
      "stops": [
        ["#F7F8FA", 0],
        ["#F7F8FA00", 0.75]
      ]
    },
    {
      "name": "floor",
      "type": "linear",
      "angle": 180,
      "space": "oklab",
      "stops": [
        ["#0B0C0E", 0],
        ["#16181C", 1]
      ]
    }
  ]
}
```

```bash
python3 scripts/dither-gradient.py --spec backdrops.json --out public/fx --preview out/qa/bands
```

```ts
// Load the dithered backdrop texture onto a full-frame Three.js quad or CanvasTexture plate:
const poolPlate = textureLoader.load("/fx/pool-ink.png");
poolPlate.colorSpace = THREE.SRGBColorSpace;
```

- `type` specifies geometry: `radial` is `ellipse RX RY at CX CY` in fractions of the frame; `linear` takes an angle in degrees (180 = top to bottom). `space` is `srgb`, `linear` or `oklab` (the smoothest ramp between two neutrals).
- With `base` the PNG is opaque RGB. Without it, it is RGBA, and the alpha carries the dither (a white pool of light over ink is one alpha step per output level).
- **A dithered plate keeps its dither only at full strength.** At opacity `a` its ±1 LSB becomes ±`a` LSB and 8-bit compositing rounds most of it away; a `multiply`, `soft-light` or `overlay` blend scales it the same way. Bake the strength into the plate (its stops at the alpha it shows at, drawn at opacity 1), and for a light that rises and falls cross-fade two baked plates at their own full strength (`fx/Grounds.ts`), so dither stays intact.
- **Detection:** the `--preview` folder holds a ×12 contrast-stretched copy of each backdrop; bands are obvious there. On renders, the banding sheet from `scripts/forensics.py` does the same stretch on dark frames.
- Slow colour ramps done in gamma sRGB step for a different reason; interpolate colours in OKLCH/OKLab (`lib/color.ts`, `references/brand-and-color.md`).

## 4. Colour: BT.709 everywhere

HD players decode with BT.709. Untagged JPEG/MP4 streams often default to BT.601 (`yuvj420p`, full range, `bt470bg`), so a preview judged on one player differs from the master on another.

| Encode                                                                                  | Colour space                                                       | Why                                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Previews, sharp masters, variants (`bun run render`, ffmpeg encodes)                    | `bt709` (`yuv420p`, TV limited range, all four BT.709 stream tags) | converts to BT.709 limited range and writes the four tags, so every player decodes it identically             |
| Intermediates for sub-frame shutter accumulation (`measure-speed.py` + `accumulate.py`) | full-range capture (`yuvj444p` / lossless PNG)                     | frames stay as captured with no range squeeze before float averaging; `accumulate.py` converts to BT.709 once |
| `accumulate.py`, splices and re-encodes                                                 | explicit ffmpeg BT.709 conversion (below)                          | quantised once, tagged (`probe.py` verifies `bt709/bt709/bt709/tv`)                                           |

Verified on the starter demo: paper, ink and accent pixels decode within 1 code value of their tokens in both the preview and the blurred master. Do not set `setColorSpace('default')` in the config to "match" the intermediates; that would leave every other render untagged BT.601.

- **In your own ffmpeg encodes** (accumulate, splices, re-encodes), convert and tag explicitly:

```bash
-vf scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv \
-pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv
```

Keep the `setparams` step. From ffmpeg 7.1 on, the stream takes its colour tags from the frames, over `-color_primaries` and `-color_trc`, and `scale` sets only the matrix and range on them: without `setparams` the file has no primaries or transfer tag (`probe.py` reports `bt709/None/None/tv` and fails it). It only labels, so on older ffmpeg the file is the same. Planes you quantised yourself and pipe in raw (`-f rawvideo -i -`, as in `accumulate.py`) are already BT.709: put the four tags before `-i` as input options and end `-vf` with `setparams` alone, no `scale`. Unlabelled, ffmpeg 7.1+ inserts its own matrix conversion and the colours shift (on ffmpeg 9, flat `#00C2E0` went from Y 149 to 162).

- **When decoding for QA or stills,** convert with the file's own matrix and accurate rounding, not ffmpeg's implicit conversion: `-vf scale=in_color_matrix=auto:in_range=auto:flags=accurate_rnd+full_chroma_int,format=rgb24`. Measured on a Tessel frame against a PNG still, the explicit path is within 0.2–0.4 code values; the implicit one is off by about 0.6.
- `bt2020-ncl` in ffmpeg/Chromium tags HLG (`arib-std-b67`), which is wrong for SDR graphics. Do not use it.
- `probe.py` fails any file without `bt709/bt709/bt709/tv`.

## 5. Encoder settings

| Stage                      | Format                       | Settings                                                                       | Why                                                  |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Frame capture              | JPEG q95 (starter default)   | `--image-format=png` for dark gradient-heavy shots, fine colour edges or alpha | Default JPEG q80 blocks up soft gradients      |
| Preview                    | H.264 yuv420p                | CRF 20, veryfast                                                               | fast, same tags as the master                        |
| Sharp master               | H.264 yuv420p                | CRF 14, slow                                                                   | transparent quality for flat colour and hairlines    |
| Sharp pass (for measuring) | H.264                        | CRF 12, veryfast                                                               | only read by optical flow                            |
| Sub-frame stream           | H.264 yuv444p                | CRF 6, veryfast                                                                | near-lossless; no extra chroma loss before averaging |
| Blurred master             | H.264 yuv420p (or `--10bit`) | CRF 14, slow, via `accumulate.py`                                              | quantised once, with no swscale dither (see below)   |
| Web loop                   | VP9                          | CRF 32, `-b:v 0`                                                               | about half the size of the H.264 master              |

Stock defaults are JPEG q80, CRF 18 and x264 `medium`; each is visibly worse on flat colour and gradients.

### Compression smear on flat fields

**What it is.** Under a ×25 contrast stretch, a flat field (paper, a solid stage, a flat card) shows horizontal streaks and 16 px blotches of ±1–2 levels that change from frame to frame. At normal contrast it is a faint, dirty shimmer over the background, most visible on a big screen, on pause and in a poster; platform re-encodes make it worse.

**Why it happens.** The float average of a flat field rarely lands on a whole code value (one logo sting's paper sat at 228.31). When ffmpeg's swscale reduced the 16-bit average to 8 bits, it added an 8×8 ordered dither, which turned the paper into a fixed 228/229 checker. x264 kept that fine pattern in some macroblocks and flattened it in others, differently each frame: the patches are the smear. The older rule, dither every pixel the shutter changed, did the same wherever anything moved. Sharp masters don't have it, because Chromium's frames are whole code values already.

**How `accumulate.py` avoids it.**

- It converts to BT.709 limited range itself, in float (within 0.01 of a code value of swscale), and quantises once, straight to the yuv420p planes it pipes to x264. No scale filter runs, so nothing adds a hidden dither.
- Plain rounding puts a flat field on one code value everywhere, moving or fading, and x264 encodes that exactly.
- The ±1 LSB TPDF dither goes only into smooth ramps, where banding can form (a 5×5 neighbourhood that is not flat, with no edge steeper than 8 codes within 9×9). It goes into every frame, with one fixed noise pattern, so a held shot stays identical from frame to frame and x264 keeps the dither instead of smoothing it back into contours. `--dither-mask changed|all` restores the older rules for comparison.
- No x264 tuning is needed. On a dark dithered gradient, `aq-mode=3`, `--tune film|grain` and `deblock -1:-1` each moved the banding error by 3% or less, and `aq-mode=3` cost 66% more bits on the flat sting.
- On that sting, 7–11% of the paper's pixels sat 1–3 levels off before; after, 0.02% or fewer did, and the master came out a third smaller.

**10-bit.** `python3 scripts/accumulate.py ... --10bit` writes `yuv420p10le`, High 10: ramps quantised in quarter steps, the least banding and a smaller file. Use it for masters that will be graded or re-encoded. Ship 8-bit `yuv420p` to the web, because many browsers and phones do not decode High 10.

**Detection.** `forensics.py` runs a `smear` check on 2 frames per second, read from the exact luma plane. It finds flat fields (at least 1% of the frame, every 17×17 neighbourhood within 3 codes, 98% of it within ±2 of one value) and compares their 16 px blocks. Finely textured blocks next to clean ones are smear; all clean (an exact encode) or all textured (even grain) is not. A smeared share of the frame over 0.2 on two or more samples fails, and on one it warns (`--smear-area`, `--no-smear`). It writes `smear.png`, a ×25 stretch around the field's level, next to the JSON. That sting measured 0.29–0.43 before the fix and 0.00 after; a busy 30 s launch film peaks at 0.15. The fix is to re-run the blur with the current `accumulate.py`; with another encoder, use a lower CRF or 10-bit.

For the same reason, the poster is not decoded from the master (§8).

## 6. Audio mux

Render the picture with `--muted` and mux with ffmpeg. Inline browser/muxer AAC encoding leaves 2,048 samples of encoder priming in the stream (42.7 ms, 2.6 frames at 60 fps), so the sound lands late, and late sound reads as sloppy even when nobody can say why.

```bash
ffmpeg -i picture.mp4 -ss <offset> -i public/audio/soundtrack.wav -map 0:v:0 -map 1:a:0 -c:v copy \
  -af apad -c:a aac -b:a 320k -ar 48000 -ac 2 -t <frames/fps> -movflags +faststart out/film.mp4
```

- `-af apad -t` makes the audio exactly as long as the picture: padded with silence if the WAV is short, trimmed if it is long. `-shortest` alone would cut the _picture_ when the WAV is short. A trim cuts the music's ring-out: the picture is timed on the track's bars (`src/music.ts`, written before the timeline) so the film ends where the music decays; a draft rendered before the track was fitted is stale (`forensics.py` audio-end warns when the last 0.25 s sit under 12 dB below the loudest 2 s).
- `-ss <offset>` takes the audio from the matching point for excerpt and per-act renders (`scripts/probe.py` sets it from `--frames` or `--audio-offset`).
- **Check after the encode.** AAC raises peaks by 0.5–1 dB (a WAV at −1.41 dBTP measured −0.5 dBTP after encoding), so `check-sync.py` measures true peak on the decoded MP4 (4× oversampled) and cross-correlates the decoded audio with the WAV at 12%, 45% and 85% of the film. The gates are ≤ 48 samples of lag (1 ms) and ≤ −1 dBTP. The mastering chain that keeps the peak there lives in `references/sound.md`.
- `+faststart` puts the index at the front so web players start before the download finishes.

## 7. Chunked renders and splices

- **Re-render only what changed.** Render act-sized excerpts (`FROM=A TO=B bun run render clip`) starting on clean shot/act boundaries, join lossless-compatible H.264 parts with ffmpeg's concat demuxer (`-c copy`, identical resolution/profile/BT.709 tags, each part starting on an I-frame), and mux the full soundtrack once at the end. Act boundaries are safe splice points by construction because sub-frame shutter samples never cross them.

```bash
FROM=0 TO=10 OUT=out/parts/p1.mp4 bun run render clip
FROM=10 TO=20 OUT=out/parts/p2.mp4 bun run render clip
printf "file '%s'\n" "$PWD"/out/parts/p*.mp4 > out/parts/list.txt
ffmpeg -f concat -safe 0 -i out/parts/list.txt -i public/audio/soundtrack.wav -map 0:v -map 1:a -c:v copy \
  -af apad -c:a aac -b:a 320k -ar 48000 -ac 2 -t <TOTAL_SEC> -movflags +faststart out/film.mp4
python3 scripts/check-sync.py out/film.mp4 public/audio/soundtrack.wav && python3 scripts/probe.py out/film.mp4 --spec 1920x1080@60 --frames <TOTAL>
```

- If you must splice inside an act, cut on a frame where nothing moves (a static seam frame), so the two renders cannot disagree on screen.

## 8. Deliverables

Before shipping deliverables with music or recorded SFX, run `python3 scripts/audio/credits.py` to verify licence records and generate `CREDITS.md` and `CREDITS_description.txt`. Credits never appear burned into the picture (`references/music.md` §8). Keep QA sheets and JSON reports in `out/qa/`, separate from final client deliverables.

| Deliverable       | How                                                                                                     | Spec and budget                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Poster            | `AT=<end_sec> bun run render stills` (lossless PNG directly from WebGL, never decoded from 4:2:0 H.264) | `poster.png` (lossless, full chroma) + `poster.jpg`; design the final frame to work as the poster |
| Web loop, MP4     | `-an -movflags +faststart` + `python3 scripts/forensics.py --loop`                                      | muted, `+faststart`, loop-seam check                                                              |
| Web loop, WebM    | `-c:v libvpx-vp9 -crf 32 -b:v 0`                                                                        | VP9 CRF 32, BT.709 tagged, Opus audio unless muted loop                                           |
| GIF               | ffmpeg `palettegen` + `paletteuse` at 25 fps, 960 px wide                                               | two-pass palette; keep short loops under 8 MB                                                     |
| Alpha for editors | ProRes 4444 `.mov` (`yuva444p10le`) or VP9 alpha `.webm` (`yuva420p`) from transparent PNG frames       | clear alpha background (`renderer.setClearAlpha(0)`)                                              |
| Aspect variants   | dedicated 9:16, 1:1 or 4:5 camera/title framing, never blind center-crops of 16:9                       | each verified with `python3 scripts/probe.py`                                                     |
| Brand palette     | `python3 scripts/palette.py --accent "#..."`                                                            | perceptually uniform OKLCH ink, paper, surface and accent tokens                                  |

- **Poster source.** A frame decoded from an H.264 4:2:0 master softens coloured type edges and carries macroblock artefacts (§5). Always capture the poster directly as a lossless PNG still (`AT=<t> bun run render stills`).
- **Loop seam.** The step from the last frame back to frame 0 must look like the steps around it: seam difference ≤ max(0.4, 1.5× the median of the 8 steps at each end), verified by `python3 scripts/forensics.py out/loop.mp4 --loop`. Design the loop on whole musical bars (`SKILL.md`), and do not duplicate frame 0 as the final frame, which hitches.
- **GIF.** Frame delays are whole hundredths of a second, so 25 fps (4 cs) and 50 fps (2 cs) play at the true rate while 30 fps plays 11% fast. Keep GIFs to short, clean loops at 480–960 px and prefer WebM or MP4 wherever video is supported.
- **Alpha.** Render with transparent WebGL clear alpha (`0`) to PNG frames and encode `-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le` (or VP9 `-pix_fmt yuva420p`). Verify with `python3 scripts/probe.py --vcodec prores --pix-fmt yuva444p10le,yuva444p12le`.
- **Aspect variants** (9:16, 1:1, 4:5) re-frame camera FOV/targets and title safe zones rather than cropping the 16:9 master, so type and hero silhouettes never clip.
- **Sound-off viewing.** Feeds autoplay muted: if the film needs its words, stage them as designed cinema titles (`film-stage/titles.ts`), not generic subtitle bars.
- **Size budgets.** Check with `python3 scripts/probe.py out/film.mp4 --max-mb <MB>`: a web loop in the low single-digit MB; a 30 s 1080p60 master at CRF 14 is typically 20–30 MB.

## 9. Gates

| Check                  | Script                                                                                       | Pass                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Size, fps, frame count | `python3 scripts/probe.py out/film.mp4 --spec 1920x1080@60 --frames N` (or `--dur s`)        | exact size and fps; ±1 frame                                                   |
| Pixel format and tags  | `python3 scripts/probe.py out/film.mp4`                                                      | `yuv420p`; `bt709/bt709/bt709/tv`                                              |
| Audio stream           | `python3 scripts/probe.py out/film.mp4` (`--audio none` for silent loops)                    | AAC, 48 kHz, stereo, length within one frame plus one AAC frame of the picture |
| Sync                   | `python3 scripts/check-sync.py out/film.mp4 public/audio/soundtrack.wav`                     | ≤ 48 samples at every sample point, correlation ≥ 0.5                          |
| True peak              | `python3 scripts/check-sync.py out/film.mp4 public/audio/soundtrack.wav`                     | ≤ −1 dBTP after decode                                                         |
| Loudness               | `python3 scripts/probe.py out/film.mp4 --lufs -14 --tp-max -1` (or `-16` for a sting)        | target ± 1 LUFS integrated (`references/sound.md`)                             |
| Loop seam              | `python3 scripts/forensics.py out/loop.mp4 --loop`                                           | seam ≤ max(0.4, 1.5× median step at the ends)                                  |
| Alpha                  | `python3 scripts/probe.py out/sting.mov --vcodec prores --pix-fmt yuva444p10le,yuva444p12le` | ProRes 4444 with alpha                                                         |

All gate scripts print JSON on stdout (`probe.py` and `check-sync.py` also accept `--json FILE`) and exit 0 on pass, 1 on fail. Pixel-level QA (pops, ghosts, judder, legibility, banding and compression-smear sheets) runs via `python3 scripts/forensics.py`; see `references/review-loop.md` and `references/chromium-rendering.md`.
