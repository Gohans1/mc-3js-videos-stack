# Render: fast drafts, the upload, YouTube's spec

Every flag lives in `bun run render --help` and `bun run deliver --help`. This reference keeps the why and the measured numbers.

## From draft to upload

| Hoàn thiện footage tùy chọn | Lệnh và giới hạn |
| --- | --- |
| Tìm cờ native | bun run media ffmpeg list; schema export và export --help, không nhập workflow của skill ngoài |
| Master cho NLE | bun run media ffmpeg export --minutes 10 -- renders/final.mp4 --preset prores -o renders/master.mov; DNxHR/alpha/key-fill đọc schema export |
| Bảo toàn đầu ra | Đọc native.verified, verification, source_carry, warnings và unverified; mất subtitle/tag có thể chỉ báo cảnh báo, source_carry không so từng byte |
| Timeline dựng | render --export-timeline trong backend đọc project footage gốc, xuất FCPXML/EDL/OTIO với not_exported; shader và scene code cần bake thành clip |
| Thời gian và file | --out/--minutes trước dấu -- điều khiển job; mọi argv native sau dấu --, timestamp là giây file, native -o chọn file riêng |
| Bộ đo bổ sung | bun run media qc --contract cho loop seam, subtitle/word timing, alpha/key-fill và delivery package; FAIL/UNKNOWN là dữ liệu, không phải lệnh cấm sáng tạo |
| FFmpeg 9 | Mixer đọc graph bằng -/filter_complex theo cú pháp chính chủ; -filter_complex_script cũ đã bị bỏ |

Inside a film:

```bash
AT=12,30 bun run render stills               # renders/still_<s>s.jpg
bun run render clip                          # renders/draft_video.mp4 and renders/cuts.json
bun run mix renders/draft_video.mp4          # renders/draft.mp4, the draft with its sound
bun run render final                         # renders/final_video.mp4; only when the creator asks
AT=12 bun run render poster                  # renders/poster_12s.png: one frame at the upload's size, lossless (thumbnail, detail)
bun run mix renders/final_video.mp4          # renders/final.mp4, the file to upload
bun run deliver                              # project upload profile; exit 0 means its technical checks passed
bun run deliver --youtube 9-15               # file seconds; retains renders/youtube_*/preview.mp4 and CAMBI images
```

## Fast, never from scratch

| Job                    | How                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trying a move or a fix | `SPAN=40,44 bun run render clip` draws just those seconds to `renders/span_40-44.mp4`, in seconds, chunks untouched; `framecheck` and `sheet` read its seconds from its name                 |
| One stretch changed    | `CHUNKS=3 bun run render clip` redraws that 30 s chunk. A plain `render clip` keeps chunks whose built code, timelines and render settings are unchanged |
| An asset replaced in place | Files under `assets/public` and `vault/openfilm/library` are not in the render stamp; force affected chunks with `CHUNKS=N` before inspecting the result |
| Editable effect source | Reload the preview after editing HTML; restart Studio after editing `_definitions` or the catalog. `bun run find --show <id>` gives source paths and creative controls; `asset --help` explains placement |
| A crash midway         | Run the same command again: it carries on where it stopped. Chrome that draws nothing for 4 minutes is restarted (3 tries)                                                                   |
| Only the sound changed | Gains, beds and SFX can reuse the picture with `bun run mix`; narration changes affecting mouths also need a new picture |
| The final is slow      | 8 sub-frames a frame for motion blur; 30 s at 16 sub-frames took 4.5 minutes on an RTX 2060. A lower `SAMPLES` is faster, blurs less                                                         |
| The GPU                | H.264 is encoded on the GPU (NVENC) through WebCodecs in Chrome. The RTX 2060 has no AV1 encoder, and NVENC makes no B-frames                                                                |

## YouTube's upload spec

Source: support.google.com/youtube/answer/1722171.

| Item           | Value                                                                                          | Made by                       |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Container      | MP4 Fast Start; kiểm A/V sync trước khi đổi edit list | Mix tối ưu Fast Start và giữ clock hình. |
| Picture        | H.264 High, 8-bit 4:2:0, BT.709, constant frame rate, a keyframe every 0.5 s                   | `render final`                |
| Landscape size | 1440p by default; `RES=2160` or `RES=1080`                                                     | `render final`                |
| Shorts size    | 1080x1920, at most 3 minutes                                                                   | `render final` at ratio 9:16  |
| Bitrate        | YouTube suggests 16 Mbps for 1440p30; the final uses 32, since NVENC needs more bits than x264 | `render final`                |
| Sound          | AAC stereo 48 kHz at 384 kbps; ffmpeg's AAC lands near 300 kbps, which is normal               | `mix`                         |
| Loudness       | -14 LUFS, true peak -1 dBTP or under; YouTube turns louder videos down, never quieter ones up  | `mix`, `listen`               |

## Why 1440p

1440p is the repo default, without guaranteeing YouTube's VP9/AV1 selection or better pictures than 1080p. 4K has 2.25 times as many pixels; choose by scene detail, render time and inspected output.

## Local compression and banding checks

deliver --youtube uses file seconds and writes a fresh local AV1 preview with a regular sample grid for VFR holds. Choose one preview range per picture format when the source changes resolution, aspect ratio or pixel format.
The local result is an approximation. Inspect the actual rendition to judge YouTube output.

| Fact                                                        | So                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The film's last pass dithers (film-stage `makeAdjustments`) | Reduces 8-bit banding risk; still inspect the encoded output |
| Local gradient compression test | Grain ±3 levels disappeared, ±8 survived at 1440p 4 Mbps; both disappeared at 1080p 1 Mbps. This observation is not a guarantee for other films |
| Keeping a gradient smooth                                   | Texture in the scene (dust, noisy fog, blocks with grain), or grain from the Adjustment slider Particles              |
| CAMBI is high on flat Minecraft tile walls                  | A false alarm from neighbouring tile colours; trust only what the re-encode adds, which `deliver --youtube` separates |
