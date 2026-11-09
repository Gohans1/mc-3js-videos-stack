# Mốc nhịp trên clip

Auto mark beats nằm trên thanh timeline: Beats 1 lấy mỗi bốn nhịp, Beats 2 lấy mọi nhịp; None xóa mốc. Menu còn thêm/xóa mốc tại playhead, bấm cờ xanh để nhảy tới và kéo clip/key/Text để hút vào mốc.

beats là giây trong clip, beatMode là 1/2, bpm là tốc độ dò được và beatSource là tên âm đã phân tích. Trim/split giữ cả mốc ngoài khung; đổi tốc độ, đảo tiếng và dời clip giữ mốc theo âm thanh, đổi file xóa mốc cũ.

Mốc của phương án A/B/C/D chỉ hiện khi phương án tương ứng đang phát; kết quả phân tích bị bỏ nếu clip hoặc lựa chọn đổi trong lúc chờ. Đây là gợi ý cắt theo nhịp, không tự cắt phim; nhạc tự do hoặc đảo tiếng có thể cần sửa mốc thủ công.

# Công cụ

[librosa 1.0.0](https://librosa.org/doc/latest/api/generated/librosa.beat.beat_track.html) dùng onset, tương quan tempo và quy hoạch động theo Ellis; Codegraph đã đối chiếu cùng hướng trong filmcraft/crates/audio-dsp/src/remix.rs. Studio gọi thư viện, không tự viết lại thuật toán; giấy phép [ISC](https://github.com/librosa/librosa/blob/1.0.0/LICENSE.md).

Cài scripts/sound/requirements.txt bằng uv pip vào Python của phim; đã kiểm bản 1.0.0 trên Python 3.14. Tiến trình phân tích giới hạn 250 giây, đoạn nguồn được xử lý bằng cùng process.py như preview trước khi dò.

# Đối chiếu và kiểm chứng

Đã xem [CapCut desktop](https://www.youtube.com/watch?v=y1x4we1T52s) tại 25/40/55/76/95 giây: menu None/Beats 1/Beats 2 và cờ xanh ở mép trên clip. Hàng có mốc thêm 10 px chỗ đặt cờ, thân clip vẫn 48 px và cột điều khiển cùng độ cao.

Bài thử WAV 120 BPM tìm đủ các nhịp với sai lệch dưới 50 ms, đoạn im lặng không tạo mốc. Nhạc thật bgm_suspense cho 120,19 BPM, 52 mốc thưa hoặc 207 mốc dày; đã soi bấm, thêm/xóa, snap SFX, kéo ngang/dọc, trim/split, speed/reverse, lock, Undo và reload trong films/sealed-room/renders/beat-verification.
