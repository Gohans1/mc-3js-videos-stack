# Render: fast drafts, the upload, YouTube's spec

Every flag lives in `bun run render --help` and `bun run deliver --help`. This reference keeps the why and the measured numbers.

## From draft to upload

| Finish external footage    | Commands and limits                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find native flags          | Run bun run media ffmpeg list, then use schema export or export --help for the built-in exporter.                                                                                      |
| Export an NLE master       | Run bun run media ffmpeg export --minutes 10 -- renders/final.mp4 --preset prores -o renders/master.mov. See schema export for DNxHR, alpha, and key/fill.                             |
| Check export integrity     | Read native.verified, verification, source_carry, warnings, and unverified. Missing subtitles or tags may appear only as warnings, and source_carry does not compare individual bytes. |
| Export an editing timeline | Native render --export-timeline reads a footage project and writes FCPXML, EDL, or OTIO. Review not_exported and bake shaders and scene code to clips where needed.                    |
| Set time and output        | Use --out and --minutes before -- to configure the job. Pass native arguments after --, use file seconds for timestamps, and set native -o to choose the media file.                   |
| Run additional checks      | Run bun run media qc --contract for loop seams, subtitle and word timing, alpha and key/fill, and delivery packaging. Review each FAIL or UNKNOWN against the intended result.         |
| FFmpeg 9                   | The mixer reads filter graphs through -/filter_complex. FFmpeg 9 removed -filter_complex_script.                                                                                       |

Inside a film:

```bash
bun run render stills --at 12,30               # renders/still_<s>s.jpg
bun run render clip                          # renders/draft_video.mp4 and renders/cuts.json
bun run mix renders/draft_video.mp4          # renders/draft.mp4, the draft with its sound
bun run render final                         # runs the whole-film pops check before encoding renders/final_video.mp4; only when the creator asks
bun run render poster --at 12                  # renders/poster_12s.png: one frame at the upload's size, lossless (thumbnail, detail)
bun run mix renders/final_video.mp4          # renders/final.mp4, the file to upload
bun run deliver                              # project upload profile; exit 0 means its technical checks passed
bun run deliver --youtube 9-15               # file seconds; retains renders/youtube_*/preview.mp4 and CAMBI images
```

Final checks the whole final scene at 30 fps before encoding, including when `--chunks` selects part of the output. Read `renders/pops.json` for findings. A pop, slide, or 10-minute check timeout stops final. Lab pages run through `render stills --entry`; final uses the film scene.

Use `bun run render stills --check pops:20,45` to debug a range, or `--check pops` to scan the full film. `bun run check` validates saved film data offline. See `bun run skills get core --ref review` for contact and reference checks.

## Fast, never from scratch

| Job                        | How                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Warm Chrome shader cache   | Headless Chrome reuses slot-locked GPU shader caches under `renders/.chrome-cache/slot-0..7` so warm renders skip shader recompilation; pass `--fresh-cache` to force a fresh ephemeral profile                                                                                                                                           |
| Batch camera angles        | `--views "corner:px,py,pz,lx,ly,lz,fov;kitchen:..."` (or `--views "@views.json"`) renders every `(view, t)` pair in one Chrome boot to `renders/view_<name>_<s>s.jpg` (`.png` for `poster`), keeping existing `still_*.jpg` and other `view_*.jpg`; works with `--crop`, `--compare`, `--list`, and `--res`                                              |
| Inspect one region         | `--crop x,y,w,h` uses normalized 0–1 coordinates with `render stills` or `poster`, rendering that camera sub-frustum at native pixel density                                                                                                                                                                                                       |
| Before and after           | `--compare` preserves the previous frame in `renders/.prev/` and writes a side-by-side pixel comparison image when a prior still exists                                                                                                                                                                                           |
| Against the reference      | `bun run render stills --ref references/ref.mp4 --at 2.5` (or `poster` for the upload's size) sets each picture beside the reference's exact frame: `renders/vs_<still>.jpg`, luma/saturation percentiles, sharpness ours/reference; `--ref-region x,y,w,h` measures the subject too: sharpness (isolated from burnt-in reference captions), mean rgb and brightness ours/reference. A soft subject in a poster too is DOF or focus, not the draft's size. The reference is filmed with motion blur: on a moving moment add `--samples 8` to the stills |
| A moving moment, blurred   | `bun run render stills --samples 8 --at 12` draws a still with the final's motion blur (not its aperture blur) at the draft's size, `render all`'s stills too; stills and `render clip` default to 1 (omitting `--samples` on `render clip` resets to 1, and 1-sample drafts ignore per-shot `shots.json` `shutter.samples`, which boosts multi-sample `--samples >= 2` / `final` / `poster` renders up to 64). `--samples 1` does not turn off post-DOF (`makeDof` still runs at draft `resolutionScale: 0.35` whenever `cam.json` has `fstop > 0`, while `draft = true` forces `apertureSamples = 1`; only `poster` and `final` run `draft = false`) |
| Sharp frame right before a cut | Multi-sample shutter blur stops at `cut: true` so motion never smears across a cut. If the last pre-cut keyframe ends early before the cut timestamp, the final pre-cut frame's shutter window sits mostly static and pops sharp — extend the moving keyframe right up to the cut (e.g. `cut - 0.001s`) |
| White shirts or skin blooming | Bright key + rim + PMREM environment easily push white clothing or hair HDR luminance past `1.5–3.0`. Pick `explainer-clean` (`4.0`), `outdoor-natural` (`3.8`), or `medical-clinical` (`4.5`) in `LOOKDEV_PROFILES` — or override `bloom.luminanceThreshold` above lit-white irradiance — and drive intentional emissives above that threshold so bright clothes stay halo-free while true glows still bloom |
| Trying a move or a fix     | `bun run render clip --span 40,44` draws just those seconds to `renders/span_40-44.mp4`, in seconds, chunks untouched; `framecheck` and `sheet` read its seconds from its name                                                                                                                                                                     |
| One stretch changed        | `bun run render clip --chunks 3` redraws that 30 s chunk. A plain `render clip` keeps chunks whose built code, timelines, render settings and served picture files are unchanged. |
| Encode fails inside a chunk | Read the chunk number and frame range in the error. Retry the same render flags to resume, or add `--chunks N` to isolate it. Before reviewing a joined draft, check the stale-chunk warning. |
| An asset replaced in place | Rerun `render clip` or `render final` to redraw chunks that read a changed file under `assets/public` or `vault/openfilm/library`. Force affected chunks after external URL or OpenFilm catalog definition changes. |
| Editable effect source     | Reload the preview after editing HTML; restart Studio after editing `_definitions` or the catalog. `bun run find --show <id>` gives source paths and creative controls; `asset --help` explains placement                                                                                                                                        |
| A crash midway             | Run the same command again: it carries on where it stopped. Chrome that draws nothing for 4 minutes is restarted (3 tries)                                                                                                                                                                                                                       |
| Only the sound changed     | Gains, beds and non-narration SFX reuse rendered video via `bun run mix renders/draft_video.mp4` without invalidating chunk `stamp` as long as `narration`, narration Phrase Bricks, `audio.json` `tracks[].id/mute` (or keeping `tracks` omitted), and `choices.json`/`sound_choices.json` stay unchanged (`bun run mix` still muxes sound edits without forcing a re-render, while narration changes affecting mouths need a new picture)                                                                                                                                                                                                                         |
| The final is slow          | 8 sub-frames a frame for motion blur; 30 s at 16 sub-frames took 4.5 minutes on an RTX 2060. A lower `--samples` is faster, blurs less                                                                                                                                                                                                             |
| The GPU                    | H.264 is encoded on the GPU (NVENC) through WebCodecs in Chrome. The RTX 2060 has no AV1 encoder, and NVENC makes no B-frames                                                                                                                                                                                                                    |

## Lookdev, post-processing and Three.js r187 rules

Wire rendering and post through `setupLookdev` (`src/lookdev.ts`) or `film-stage/post` (`createFilmRenderer`, `createPostPipeline`) instead of hand-rolling `WebGLRenderer` + `EffectComposer` + `N8AOPostPass`.

| Layer / Rule | Canonical API & contract |
| --- | --- |
| Renderer (`createFilmRenderer`) | Configures `THREE.PCFShadowMap` (`shadowMap.enabled = true`), `THREE.NoToneMapping` (composer tone-maps), `localClippingEnabled = true`, `preserveDrawingBuffer = true`, and `antialias: false` (composer uses 4x MSAA + SMAA) |
| Post chain (`createPostPipeline`) | `HalfFloatType` `EffectComposer` running `RenderPass` -> persp/ortho `N8AOPostPass` (`HalfFloatType` output, `aoEnabled` per-frame toggle via `syncCamera(cam, { aoEnabled })` for `noAO` sets, auto-switches to an orthographic AO pass on ortho cameras) -> `SMAAEffect` -> optional `makeDof` -> optional `createGodraysPass` -> linear HDR `BloomEffect` + optional `VignetteEffect` -> `ToneMappingEffect` -> `HueSaturationEffect` (placed strictly AFTER tone mapping so `min(color, 1.0)` never clips linear HDR headroom) -> optional `opts.afterToneMap` (`Effect[]`, e.g. `createScreenEffect` presets `cctv`/`vhs-crt`/`night-vision`/`thermal` or POV masks) -> gated TPDF `DitherEffect` (auto-yields when `makeAdjustments` is active, never lifts pure black `0` to `1`), plus lazy `layerAdjust` |
| 12 `LOOKDEV_PROFILES` | `explainer-clean`, `cinematic` (template default), `outdoor-natural`, `neon-night`, `outdoor-vivid`, `medical-clinical`, `xray-cutaway`, `horror-dark`, `documentary-grit`, `warm-nostalgic`, `underwater-deep`, `space-crisp`. Override any pass (`toneMapping`, `bloom`, `vignette`, `ao`, `saturation`, `dither`, `afterToneMap`) via `setupLookdev` / `createPostPipeline`; unknown profile or tone-map names throw loudly |
| Three.js r187 shadows | Never use deprecated `THREE.PCFSoftShadowMap`; use `THREE.PCFShadowMap` and keep `shadow.radius` in `1.5–3.5` (`> 4` produces 5-sample PCF edge grain) |
| Linear HDR custom shaders | Inside `EffectComposer`, custom `ShaderMaterial` / `RawShaderMaterial` outputs MUST remain linear HDR — never include `#include <tonemapping_fragment>` or `#include <colorspace_fragment>` (causes double tone-mapping/sRGB washout). Prefer `film-stage/sky` (`createSkyDome`, `createStudioBackdrop`) and `film-stage/surfaces` (`createWaterSurface`, `createWetGround`, `createHazeLayer`, `createXRayMaterial`, `createVolumetricBeam`, `createCausticsPlane`, `createFlame`) |
| GPU & memory discipline | Never allocate `new THREE.Fog` / `new THREE.FogExp2` per frame (reuse via `createLightingRig` / `applySetLight`), never leak `PMREMGenerator` (use `createEnvironment` / `createSkyEnvironment` / `bakeSceneProbe` / `loadHDREnvironment` or call `.dispose()`), and call `.dispose()` on created lookdev/environment/surface/particle handles. `bun run check` flags these automatically |

## YouTube's upload spec

Source: support.google.com/youtube/answer/1722171.

| Item           | Value                                                                                                                 | Made by                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Container      | MP4 Fast Start. Check A/V sync before changing the edit list. Mix enables Fast Start and preserves the picture clock. |
| Picture        | H.264 High, 8-bit 4:2:0, BT.709, constant frame rate, a keyframe every 0.5 s                                          | `render final`               |
| Landscape size | 1440p by default; `--res 2160` or `--res 1080`                                                                            | `render final`               |
| Shorts size    | 1080x1920, at most 3 minutes                                                                                          | `render final` at ratio 9:16 |
| Bitrate        | YouTube suggests 16 Mbps for 1440p30; the final uses 32, since NVENC needs more bits than x264                        | `render final`               |
| Sound          | AAC stereo 48 kHz at 384 kbps; ffmpeg's AAC lands near 300 kbps, which is normal                                      | `mix`                        |
| Loudness       | -14 LUFS, true peak -1 dBTP or under; YouTube turns louder videos down, never quieter ones up                         | `mix`, `listen`              |

## Why 1440p

1440p is the repo default, without guaranteeing YouTube's VP9/AV1 selection or better pictures than 1080p. 4K has 2.25 times as many pixels; choose by scene detail, render time and inspected output.

## Local compression and banding checks

deliver --youtube uses file seconds and writes a fresh local AV1 preview with a regular sample grid for VFR holds. Choose one preview range per picture format when the source changes resolution, aspect ratio or pixel format.
The local result is an approximation. Inspect the actual rendition to judge YouTube output.

| Fact                                                        | So                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The film's last pass dithers (`createPostPipeline` / `makeAdjustments`) | Reduces 8-bit banding risk without lifting pure black; still inspect the encoded output                                                                                    |
| Local gradient compression test                             | Grain ±3 levels disappeared, ±8 survived at 1440p 4 Mbps; both disappeared at 1080p 1 Mbps. This observation is not a guarantee for other films |
| Keeping a gradient smooth                                   | Texture in the scene (dust, noisy fog, blocks with grain), or grain from the Adjustment slider Particles                                        |
| CAMBI is high on flat Minecraft tile walls                  | A false alarm from neighbouring tile colours; trust only what the re-encode adds, which `deliver --youtube` separates                           |
