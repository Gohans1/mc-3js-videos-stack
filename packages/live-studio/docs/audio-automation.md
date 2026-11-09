# Key âm lượng

Key dùng giây trong clip, độc lập start của file và vòng lặp nhạc; trim/split dịch giờ key, giữ phần ngoài khung để kéo dài lại. Đường nối tuyến tính dB, giữ giá trị hai đầu; xóa key cuối giữ âm lượng đang nghe.

Inspector dùng ◁◇▷ có sẵn; kéo kim cương đổi giờ/âm lượng, kéo đường trắng đổi cả đường, nhấp đúp thêm/bỏ key. Một lần kéo là một Undo; Escape hủy khi còn giữ chuột.

Reset clip nền phải ghi fadeIn/fadeOut bằng 0 vì schema bắt buộc hai trường này; đã tái hiện lỗi xóa trường khiến lưu thất bại, sửa và soi lại Reset/Undo.

# Nguồn đã đọc

Codegraph: editor-refs/opencut-classic, audio-state.ts và audio-manager.ts; tham khảo thời gian trong clip, dB và AudioParam, không chép mã. [CapCut](https://www.capcut.com/resource/how-to-add-keyframes-in-capcut) xác nhận key âm lượng; ảnh người dùng và video CapCut lưu trong thư mục capcut-ref dùng để đối chiếu hình.

[Web Audio](https://www.w3.org/TR/webaudio-1.1/) cung cấp exponentialRampToValueAtTime cho đường tuyến tính dB; [FFmpeg aeval](https://ffmpeg.org/ffmpeg-filters.html#aeval) tính cùng đường trên từng mẫu. Chỉ clip có key mới thêm aeval; fade/duck giữ tầng gain riêng.

[Hyperframes](https://github.com/heygen-com/hyperframes/pull/3380) ghi nhận lỗi timestamp sau apad; đã tái hiện máy này xuất 0,25 thay vì 4 giây. Mix.py dùng asetpts=N/SR/TB trước atrim, bài thử WAV kiểm cả độ dài và âm lượng thực tế.

# Kiểm chứng và giới hạn

Đã thao tác thật thêm/xóa/đi key, kéo điểm/đường, key đầu, nhấp đúp, trim/split, Escape, Undo và reload. Ảnh, WAV và số đo nằm ở films/sealed-room/renders/audio-automation-verification; dữ liệu thử đã trả về nguyên bản.

Clip riêng chưa chạm limiter: preview và PCM16 lệch tối đa 0,04 dB ở đoạn trên −80 dBFS, cùng peak 0,0777. Mix 20 giây sau sửa limiter và vị trí mẫu lệch tối đa 0,01 dB mỗi nửa giây, cùng peak 0,45; bằng chứng nằm trong renders/limiter-verification.

Limiter cũ tự viết đã thay bằng bản chuyển TypeScript từ [FFmpeg n8.1.1](https://github.com/FFmpeg/FFmpeg/blob/n8.1.1/libavfilter/af_alimiter.c), kèm nguồn và LGPL trong app/sound/vendor. Bài thử so từng mẫu với FFmpeg tại 44,1/48 kHz, attack/release và stereo; delay đúng của FFmpeg là 239 mẫu ở 48 kHz.

Sai lệch mix trước đây không chỉ do limiter: adelay làm tròn mili giây khiến các lớp tiếng lệch pha. Mix.py dùng adelay theo mẫu 48 kHz, AudioBufferSource bắt đầu tại mẫu gần nhất; đã kiểm trực tiếp OfflineAudioContext và WAV xuất.
