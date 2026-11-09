# Bộ lọc giọng

Audio có Basic, Voice changer và Speed; ba preset Telephone, Walkie-talkie, Megaphone dùng Strength 0–100 để trộn tiếng gốc và tiếng lọc. Mỗi lần chọn hoặc thả thanh kéo tạo một bước Undo; waveform, preview, Normalize và xuất phim dùng cùng bộ xử lý.

Telephone giới hạn khoảng 300–3400 Hz; Walkie-talkie và Megaphone thêm méo mềm, lọc và tăng vùng rõ tiếng. Đây là preset của studio, không khẳng định trùng thuật toán âm sắc độc quyền của CapCut.

# Nguồn

[ITU P.310](https://www.itu.int/ITU-T/recommendations/rec.aspx?lang=en&rec=9733) mô tả dải thoại hẹp; [Audacity Distortion](https://manual.audacityteam.org/man/distortion.html) hướng dẫn phối méo tiếng với EQ cho bộ đàm. Codegraph đối chiếu filmcraft/crates/audio-dsp/src/effects/special.rs; thực thi bằng highpass, lowpass, equalizer, asoftclip và amix có sẵn trong [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#asoftclip).

Đã mở các khung 35/55/80/110 giây của [video CapCut](https://www.youtube.com/watch?v=fSpl2muLDjI): tab, ô preset, viền chọn xanh và Strength. Studio chỉ đưa vào ba hiệu ứng cần cho phim; không thêm các mục giọng AI hoặc nút tải chưa có chức năng.

# Kiểm chứng

Bài thử WAV đo dải tần, hài méo, thời lượng, Strength 0 và pha trộn 50%; thử trình duyệt bấm ba preset, đổi Strength và Undo trả nguyên dữ liệu. Megaphone 50% cho preview và WAV cùng bảy giá trị RMS, peak 0,0268; ảnh, dữ liệu và WAV ở films/sealed-room/renders/voice-filter-verification.
