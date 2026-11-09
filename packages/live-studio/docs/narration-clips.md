# Voice và thứ tự hàng

Text nằm trên Camera theo hai ảnh CapCut dev gửi; Voice dùng chung hàng và cách vẽ clip audio. Phim khai báo narration thì bỏ hàng transcript Voice cũ, còn phim chưa chuyển vẫn giữ tương thích.

# Dữ liệu

live-studio.soundSources trong package.json ánh xạ tên nguồn sang WAV; audio.json.narration chỉ tên lời dẫn, từng đoạn nằm trong sfx với track, at, start, length và rate. Cắt, dời, tăng tốc hoặc xóa clip cập nhật giờ phụ đề và ducking; mute giữ phụ đề để chỉnh nhưng bỏ ducking.

dialogue giữ compressor 4:1 và limiter 0,35 của lời dẫn cũ, xử lý trước trim để split không đổi lịch sử compressor. Khi có narration, mix.py không trộn thêm nguồn voice cũ; sealed-room giữ track Voice tắt tiếng như cấu hình trước khi chuyển.

# Tham khảo

Đã đối chiếu ảnh CapCut đính kèm 3a6bb149 và 4ad63485, đọc [hướng dẫn voice của CapCut](https://www.capcut.com/resource/how-to-add-voice-in-a-video) bằng Exa và retime của OpenCut classic bằng Codegraph. Dùng bộ xử lý audio hiện có, không dựng DSP hoặc renderer riêng cho Voice.

# Kiểm chứng

Đã thao tác thật: trim hai mép, kéo vị trí, fade, đường Volume, split, Speed 2×, lock, Undo và reload; đã chọn Text trên timeline và thấy khung trên preview. Ảnh nằm trong films/sealed-room/renders, gồm voice-clip-moved-trimmed.png, voice-clip-split.png, voice-clip-speed-ready.png và text-above-camera-selection.png.

Preview so với WAV FFmpeg lệch tối đa 0,01 dB RMS ở 1× và dưới 0,01 dB ở 2×; số đo/WAV nằm trong renders/voice-clip-verification. Test WAV thật kiểm tra compressor sau trim và không trộn Voice hai lần; test phụ đề kiểm tra trim/rate/split/mute/xóa clip.

full_voice.wav dài 107,52 giây nhưng mẫu khác 0 cuối cùng ở 24,4114 giây, nên phần còn lại không có sóng. Không kéo dày sóng giả để lấp khoảng im lặng.
