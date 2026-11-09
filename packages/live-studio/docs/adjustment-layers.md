# Lớp Adjust

## Nguồn

[CapCut](https://www.capcut.com/create/video-color-grading-batch) mô tả lớp màu phủ nhiều clip; đã xem trực tiếp [video desktop](https://www.youtube.com/watch?v=_jHjyc2gI9w) ở 110, 125 và 145 giây. Hàng mỏng màu vàng nằm trên hình, dùng lại Basic/HSL/Curves/Color wheel; màu đo từ video 2023, chưa phải phép đo CapCut 9.7.

Codegraph đã đối chiếu lớp adjustment trong EffectCraft; không chép mã renderer. Dùng bộ màu và [postprocessing](https://pmndrs.github.io/postprocessing/public/docs/file/src/effects/Effect.js.html) đã có, không thêm thư viện.

## Dữ liệu và hình xuất

adjustmentTimeline trỏ tới file items gồm id, name, from, to, track, grade và tracks có lock/hidden. Khoảng tác động gồm from và loại to; các lớp chồng nhau chạy từ hàng dưới lên trên.

makeLayerAdjustments chạy sau transition, chữ và HUD, bỏ qua Free camera; preview và render dùng cùng đường này. GPU sao chép framebuffer, TextureEffect khai báo đầu ra sRGB để EffectPass giải mã; không gắn sRGB vào FramebufferTexture vì copyFramebuffer phát lỗi GL 1282.

LUT được chuẩn bị trước và dùng chung giữa các lớp; mỗi lớp giữ thứ tự detail → color → finish. Lớp rỗng hoặc bị ẩn không thêm lượt vẽ.

## Thao tác đã kiểm chứng

Đã dùng chuột/bàn phím thật thử thêm, kéo từ thư viện, đổi hàng, chọn nhóm cùng Text, trim, Q/W, split, copy/paste, dán thuộc tính, lock/hide, Esc và Undo một bước. Đã mở HSL, Curves, Color wheel cho lớp, kiểm tra lưu/reload và màn hình hẹp.

Hai lớp chồng nhau được so pixel GPU, sai tối đa một mức màu; lớp 3–8 giây cho ảnh bật/tắt giống hoàn toàn tại giây 2 và 8, khác tại giây 3 và 4. Ảnh xuất thật và ảnh giao diện nằm trong films/sealed-room/renders/adjustment-layer-verification; lab/grade.ts kiểm tra GPU, test/adjustment-layers.test.mjs kiểm tra lưu, dữ liệu sai và xung đột phiên bản.

## Giới hạn

Đã nối sealed-room và template; phim khác cần khai báo file và nối renderer trước khi dùng. Chưa có keyframe màu, eyedropper, mặt nạ lớp hoặc cam kết trùng thuật toán màu độc quyền của CapCut.
