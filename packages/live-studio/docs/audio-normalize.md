# Chuẩn hóa âm lượng clip

Normalize đo clip đã trim, loop, fade, duck, pan và key bằng FFmpeg; mặc định −14 LUFS, giới hạn −1 dBTP. Đây là mức mặc định đã giao, không phải chuẩn chung cho mọi nền tảng.

Đổi cùng lượng dB cho toàn bộ key để giữ hình đường âm lượng; đo lại trước khi lưu vì ngưỡng loại khoảng lặng có thể đổi LUFS. Một Undo trả nguyên clip; đổi dữ liệu hoặc vùng chọn trong lúc đo sẽ từ chối áp dụng kết quả cũ.

File đo dùng PCM float để không cắt đỉnh trên 0 dB; đo hết clip kể cả phần ngoài cuối phim, không qua master limiter. Mỗi bước FFmpeg giới hạn 120 giây, file tạm tự dọn; clip dưới 0,4 giây hoặc im lặng có thông báo riêng.

# Nguồn

Codegraph đọc editor-refs/filmcraft, crates/audio-dsp/src/loudness.rs: hàm normalize_gain_db_peak_limited; tham khảo cách giới hạn gain theo true peak, không chép DSP. [CapCut](https://www.capcut.com/features/how-to-normalize-audio-capcut-workflow) có Normalize loudness trong Audio; studio dùng nút đo rồi đặt Volume theo yêu cầu đã chốt, chưa xác nhận bố cục nút này khớp CapCut.

[FFmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm) cung cấp LUFS và true peak; [ebur128.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/ebur128.c) chia histogram 0,1 LU. Bộ đo loudness-worklet vẫn phục vụ đồng hồ live; Normalize dùng cùng FFmpeg với đường xuất để tránh chênh lệch bộ đo.

# Kiểm chứng

Đã bấm thật Normalize, đổi mục tiêu, giữ đường hai key và Undo; WAV đo độc lập: cctv_hiss −14,01 LUFS / −4,92 dBTP, paper_grab −20,79 LUFS / −1,00 dBTP. Ảnh và WAV ở films/sealed-room/renders/audio-normalize-verification, dữ liệu thử đã trả nguyên bản.

Bài thử FFmpeg thật kiểm tra đỉnh float trên 0 dB, snapshot chưa lưu, clip nằm ngoài cuối phim và file dự án không bị sửa bởi phép đo. Gain tuyến tính không nén đỉnh; khi thiếu khoảng trống đến đỉnh, kết quả có thể nhỏ hơn mức LUFS yêu cầu.
