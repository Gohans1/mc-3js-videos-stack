# FFmpeg limiter

ffmpeg-alimiter.ts chuyển phần xử lý mẫu của [af_alimiter.c tại n8.1.1](https://github.com/FFmpeg/FFmpeg/blob/n8.1.1/libavfilter/af_alimiter.c) sang luồng AudioWorklet; bản nguồn gốc và LGPL-2.1-or-later đi kèm. Giữ level=false, asc=false, latency=false, level_in/out=1; không tuyên bố mã này là mã riêng của dự án.

Giữ thư mục này, thông báo bản quyền và source map khi phân phối bản build; người nhận phải có mã nguồn phần LGPL và khả năng thay thế nó. [Quy định FFmpeg](https://www.ffmpeg.org/legal.html) là nguồn đối chiếu trước khi phát hành ứng dụng.

test/brickwall.test.mjs đối chiếu mẫu thực với FFmpeg cho stereo, transient, tín hiệu lớn, release và nhiều kích thước block. Delay bằng floor(attack × sampleRate) − 1, tức 239 mẫu tại 48 kHz với attack 5 ms.
