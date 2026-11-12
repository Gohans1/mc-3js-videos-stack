# Render

Lệnh và tuỳ chọn đầy đủ nằm trong bun run render --help và bun run deliver --help. File này chỉ giữ lý do và con số đã đo.

## Luồng

| Bước                            | Lệnh (trong film)                    | Ra                                                  |
| ------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Nháp hình                       | AT=12,30 bun run render stills       | renders/still_<s>s.jpg                              |
| Nháp phim                       | bun run render clip                  | renders/draft_video.mp4                             |
| Tiếng lên nháp                  | bun run mix renders/draft_video.mp4  | renders/draft.mp4                                   |
| Bản upload, chỉ khi creator bảo | bun run render final                 | renders/final_video.mp4                             |
| Tiếng lên bản upload            | bun run mix renders/final_video.mp4  | renders/final.mp4                                   |
| Soi theo spec YouTube           | bun run deliver                      | exit 0 là sẵn sàng                                  |
| Soi sau re-encode của YouTube   | bun run deliver --youtube <từ>-<đến> | renders/youtube_preview.mp4, youtube_bands_<s>s.png |

## Nhanh, không lag

| Việc             | Cách                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Sửa một cảnh     | CHUNKS=3 chỉ render lại chunk 30 s đó; chunk khác giữ nguyên nếu code, data, setting không đổi.                     |
| Crash giữa chừng | Chạy lại đúng lệnh, nó làm tiếp chỗ dừng; Chrome treo 4 phút thì tự khởi động lại.                                  |
| Sửa tiếng        | Chỉ bun run mix, không render hình.                                                                                 |
| Final chậm       | 8 sub-frame mỗi frame; 30 s ở 16 sub-frame mất 4.5 phút trên RTX 2060. SAMPLES nhỏ hơn thì nhanh hơn, blur kém hơn. |
| GPU              | Encode H.264 phần cứng (NVENC) qua WebCodecs trong Chrome. RTX 2060 không có NVENC AV1, NVENC không có B-frame.     |

## Spec YouTube

Nguồn: support.google.com/youtube/answer/1722171.

| Mục           | Giá trị                                                                             | Ai lo                       |
| ------------- | ----------------------------------------------------------------------------------- | --------------------------- |
| Container     | MP4, moov ở đầu file, không edit list                                               | mix.py khi mux final        |
| Hình          | H.264 High, 8-bit 4:2:0, BT.709, frame rate cố định, keyframe mỗi 0.5 s             | render final                |
| Cỡ phim ngang | 1440p mặc định, RES=2160 hoặc 1080                                                  | render final                |
| Cỡ Shorts     | 1080x1920, tối đa 3 phút                                                            | render final khi ratio 9:16 |
| Bitrate       | YouTube khuyên 16 Mbps cho 1440p30; đặt 32 vì NVENC tốn bit hơn x264                | render final                |
| Tiếng         | AAC stereo 48 kHz, 384 kbps; ffmpeg AAC thường ra khoảng 300, bình thường           | mix.py                      |
| Độ to         | -14 LUFS, true peak không quá -1 dBTP; YouTube vặn nhỏ bài to, không vặn to bài nhỏ | mix.py, listen              |

## Vì sao 1440p

Upload từ 1440p trở lên được YouTube encode VP9 hoặc AV1 với bitrate cao hơn, người xem 1080p cũng nét hơn. 4K nhiều gấp 2.25 lần pixel để render mà sau re-encode gần như không hơn 1440p (VMAF creator đo: 99.92 so với 99.95).

## Banding

| Sự thật                                                   | Hệ quả                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pass cuối của film tự dither (film-stage makeAdjustments) | File upload không band vì 8-bit.                                                                   |
| Re-encode của YouTube xoá dither nhẹ                      | Gradient thử: grain ±3 level mất, ±8 sống ở rung 1440p 4 Mbps; rung 1080p 1 Mbps không gì sống.    |
| Cách giữ gradient                                         | Texture trong cảnh (bụi, sương có noise, block có vân) hoặc grain qua Adjustment slider Particles. |
| CAMBI cao trên nền gạch MC phẳng                          | Báo nhầm màu gạch kề nhau; chỉ tin phần re-encode thêm vào, deliver --youtube đã tách sẵn.         |
