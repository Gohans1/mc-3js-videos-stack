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
bun run render final                         # renders/final_video.mp4; only when the creator asks
bun run render poster --at 12                  # renders/poster_12s.png: one frame at the upload's size, lossless (thumbnail, detail)
bun run mix renders/final_video.mp4          # renders/final.mp4, the file to upload
bun run deliver                              # project upload profile; exit 0 means its technical checks passed
bun run deliver --youtube 9-15               # file seconds; retains renders/youtube_*/preview.mp4 and CAMBI images
```

## Fast, never from scratch

| Job                        | How                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Warm Chrome shader cache   | Headless Chrome reuses slot-locked GPU shader caches under `renders/.chrome-cache/slot-0..7` so warm renders skip shader recompilation; pass `--fresh-cache` to force a fresh ephemeral profile                                                                                                                                           |
| Batch camera angles        | `--views "corner:px,py,pz,lx,ly,lz,fov;kitchen:..."` (or `--views @views.json`) renders every `(view, t)` pair in one Chrome boot to `renders/view_<name>_<s>s.jpg` (`.png` for `poster`), keeping existing `still_*.jpg` and other `view_*.jpg`; works with `--crop`, `--compare`, `--list`, and `--res`                                              |
| Inspect one region         | `--crop x,y,w,h` uses normalized 0–1 coordinates with `render stills` or `poster`, rendering that camera sub-frustum at native pixel density                                                                                                                                                                                                       |
| Before and after           | `--compare` preserves the previous frame in `renders/.prev/` and writes a side-by-side pixel comparison image when a prior still exists                                                                                                                                                                                           |
| Against the reference      | `bun run render stills --ref references/ref.mp4 --at 2.5` (or `poster` for the upload's size) sets each picture beside the reference's exact frame: `renders/vs_<still>.jpg`, luma/saturation percentiles, sharpness ours/reference; `--ref-region x,y,w,h` measures the subject too: sharpness, mean rgb and brightness ours/reference. A soft subject in a poster too is DOF or focus, not the draft's size. The reference is filmed with motion blur: on a moving moment add `--samples 8` to the stills |
| A moving moment, blurred   | `bun run render stills --samples 8 --at 12` draws a still with the final's motion blur (not its aperture blur) at the draft's size, `render all`'s stills too; stills stay at 1 by default, the one instant, to check a pose, a contact or where things are |
| Trying a move or a fix     | `bun run render clip --span 40,44` draws just those seconds to `renders/span_40-44.mp4`, in seconds, chunks untouched; `framecheck` and `sheet` read its seconds from its name                                                                                                                                                                     |
| One stretch changed        | `bun run render clip --chunks 3` redraws that 30 s chunk. A plain `render clip` keeps chunks whose built code, timelines and render settings are unchanged                                                                                                                                                                                         |
| An asset replaced in place | Files under `assets/public` and `vault/openfilm/library` are not in the render stamp; force affected chunks with `--chunks N` before inspecting the result                                                                                                                                                                                         |
| Editable effect source     | Reload the preview after editing HTML; restart Studio after editing `_definitions` or the catalog. `bun run find --show <id>` gives source paths and creative controls; `asset --help` explains placement                                                                                                                                        |
| A crash midway             | Run the same command again: it carries on where it stopped. Chrome that draws nothing for 4 minutes is restarted (3 tries)                                                                                                                                                                                                                       |
| Only the sound changed     | Gains, beds and SFX can reuse the picture with `bun run mix`; narration changes affecting mouths also need a new picture                                                                                                                                                                                                                         |
| The final is slow          | 8 sub-frames a frame for motion blur; 30 s at 16 sub-frames took 4.5 minutes on an RTX 2060. A lower `--samples` is faster, blurs less                                                                                                                                                                                                             |
| The GPU                    | H.264 is encoded on the GPU (NVENC) through WebCodecs in Chrome. The RTX 2060 has no AV1 encoder, and NVENC makes no B-frames                                                                                                                                                                                                                    |

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
| The film's last pass dithers (film-stage `makeAdjustments`) | Reduces 8-bit banding risk; still inspect the encoded output                                                                                    |
| Local gradient compression test                             | Grain ±3 levels disappeared, ±8 survived at 1440p 4 Mbps; both disappeared at 1080p 1 Mbps. This observation is not a guarantee for other films |
| Keeping a gradient smooth                                   | Texture in the scene (dust, noisy fog, blocks with grain), or grain from the Adjustment slider Particles                                        |
| CAMBI is high on flat Minecraft tile walls                  | A false alarm from neighbouring tile colours; trust only what the re-encode adds, which `deliver --youtube` separates                           |
