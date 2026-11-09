# Tốc độ, cao độ và đảo tiếng

Clip lưu rate từ 0,1 đến 10, pitch từ −24 đến 24 bán âm, changePitch và reverse. Tốc độ đổi độ dài, giờ key và fade cùng tỷ lệ; start luôn là mép thấp của đoạn nguồn, kể cả khi đảo tiếng.

Trim/split giữ phần nguồn đang nằm dưới mỗi giây timeline; đảo tiếng chỉ đảo đoạn đã chọn, sau khi lặp hoặc trim. Đổi tốc độ mà đè clip bên cạnh sẽ bị từ chối, không tự chuyển track.

Preview, waveform, Normalize và mix.py dùng chung scripts/sound/process.py. Bộ nhớ đệm chỉ giữ cấu hình hiện hành; yêu cầu xử lý chờ 180 ms để một lượt kéo không chạy DSP cho mọi vị trí chuột.

# Công cụ và giấy phép

[Rubber Band chính chủ](https://www.breakfastquay.com/rubberband/) dùng chế độ offline R3 với centre-focus; [hướng dẫn tích hợp](https://breakfastquay.com/rubberband/integration.html) giải thích bù độ trễ và thời lượng. FFmpeg lo trim/loop/reverse; hai tiến trình đều giới hạn 120 giây.

Rubber Band là GPL-2.0-or-later, đang dùng CLI bên ngoài; không đóng gói binary vào kho mã. Khi phân phối sản phẩm kèm công cụ này, phải đối chiếu [điều khoản chính chủ](https://breakfastquay.com/rubberband/license.html).

Máy này cài bản Windows 4.0.0 ở C:/Users/ADMIN/.local/share/live-studio/tools/rubberband-4.0.0; máy khác dùng rubberband trên PATH hoặc biến RUBBERBAND trỏ executable. [Gói tải chính chủ](https://breakfastquay.com/files/releases/rubberband-4.0.0-gpl-executable-windows.zip) có SHA-256 f2d47fc64dbb42f6cc62edf7933ac4fa89d8f0ef8b9cf97b6afc263a7fe05644.

# Đối chiếu

Codegraph đọc OpenCut classic: speed-tab.tsx, audio-stretch.ts và retime/rate.ts; đọc filmcraft/effects/pitch.rs. OpenCut dùng SoundTouch.js, filmcraft có phase vocoder riêng; studio chọn CLI đã có thuật toán chuẩn để cùng dùng cho preview và xuất phim.

Đã xem lại khung CapCut speed-026-c.png: slider, Duration và Change audio pitch; studio thêm Pitch và Reverse audio cho clip tiếng. Audio có ba tab Basic, Voice changer và Speed; Curve/Velocity toàn phim là việc riêng còn tiếp tục.

# Kiểm chứng

Bài thử WAV thật kiểm tra 440 Hz giữ cao độ khi 2×, thành 880 Hz khi bật đổi cao độ hoặc tăng 12 bán âm; đảo đoạn hai tần số đổi đúng thứ tự. Tiếng tại 1–1,2 giây sau 2× nằm ở 0,5–0,6 giây; bản offline 0,5× lệch tối đa 10 ms trong bài thử, tốt hơn R2 thời gian thực đã đo lệch 40 ms.

Đã bấm speed/pitch/reverse trên bed và SFX, chia clip đảo, kéo mép clip 2× có key, từ chối đè hàng và Undo; dữ liệu thử đã trả nguyên bản. Preview và WAV 2× khớp cả bốn số RMS, cùng peak 0,0509; ảnh/WAV/số đo ở films/sealed-room/renders/audio-process-verification.
