# Render: fast drafts, the upload, YouTube's spec

Every flag lives in `bun run render --help` and `bun run deliver --help`. This reference keeps the why and the measured numbers.

## From draft to upload

Inside a film:

```bash
AT=12,30 bun run render stills               # renders/still_<s>s.jpg
bun run render clip                          # renders/draft_video.mp4 and renders/cuts.json
bun run mix renders/draft_video.mp4          # renders/draft.mp4, the draft with its sound
bun run render final                         # renders/final_video.mp4; only when the creator asks
bun run mix renders/final_video.mp4          # renders/final.mp4, the file to upload
bun run deliver                              # against YouTube's spec; exit 0 is ready
bun run deliver --youtube 9-15               # renders/youtube_preview.mp4 and youtube_bands_<s>s.png
```

## Fast, never from scratch

| Job                    | How                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| One stretch changed    | `CHUNKS=3 bun run render clip` redraws that 30 s chunk. A plain `render clip` keeps every chunk whose code, data and settings are unchanged |
| A crash midway         | Run the same command again: it carries on where it stopped. Chrome that draws nothing for 4 minutes is restarted (3 tries)                  |
| Only the sound changed | `bun run mix` alone; no picture is rendered                                                                                                 |
| The final is slow      | 8 sub-frames a frame for motion blur; 30 s at 16 sub-frames took 4.5 minutes on an RTX 2060. A lower `SAMPLES` is faster, blurs less        |
| The GPU                | H.264 is encoded on the GPU (NVENC) through WebCodecs in Chrome. The RTX 2060 has no AV1 encoder, and NVENC makes no B-frames               |

## YouTube's upload spec

Source: support.google.com/youtube/answer/1722171.

| Item           | Value                                                                                          | Made by                       |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Container      | MP4, moov at the start, no edit list                                                           | `mix` when it muxes the final |
| Picture        | H.264 High, 8-bit 4:2:0, BT.709, constant frame rate, a keyframe every 0.5 s                   | `render final`                |
| Landscape size | 1440p by default; `RES=2160` or `RES=1080`                                                     | `render final`                |
| Shorts size    | 1080x1920, at most 3 minutes                                                                   | `render final` at ratio 9:16  |
| Bitrate        | YouTube suggests 16 Mbps for 1440p30; the final uses 32, since NVENC needs more bits than x264 | `render final`                |
| Sound          | AAC stereo 48 kHz at 384 kbps; ffmpeg's AAC lands near 300 kbps, which is normal               | `mix`                         |
| Loudness       | -14 LUFS, true peak -1 dBTP or under; YouTube turns louder videos down, never quieter ones up  | `mix`, `listen`               |

## Why 1440p

An upload of 1440p or more gets YouTube's VP9 or AV1 encode at a higher bitrate, so even 1080p viewers see it sharper. 4K is 2.25 times the pixels to render and after YouTube's re-encode is barely better than 1440p (a creator's VMAF: 99.92 against 99.95).

## Banding after YouTube's re-encode

| Fact                                                        | So                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The film's last pass dithers (film-stage `makeAdjustments`) | The 8-bit upload itself does not band                                                                                 |
| YouTube's re-encode wipes fine dither                       | Measured on a test gradient: grain of ±3 levels is lost, ±8 survives at 1440p 4 Mbps; nothing survives 1080p 1 Mbps   |
| Keeping a gradient smooth                                   | Texture in the scene (dust, noisy fog, blocks with grain), or grain from the Adjustment slider Particles              |
| CAMBI is high on flat Minecraft tile walls                  | A false alarm from neighbouring tile colours; trust only what the re-encode adds, which `deliver --youtube` separates |
