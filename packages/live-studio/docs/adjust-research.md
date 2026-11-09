# Adjust theo shot

## Nguồn đã đối chiếu

Ảnh CapCut do dev gửi: Basic 15 thanh, HSL 8 màu, Curves Luma/RGB và bốn Color wheel. [CapCut LUT](https://www.capcut.com/resource/luts-for-color-grading) xác nhận nhập CUBE/3DL và Intensity; chưa đo được công thức màu riêng của CapCut nên không coi đầu ra giống tuyệt đối.

[Google Filament](https://github.com/google/filament/blob/main/filament/src/details/ColorGrading.cpp): cân bằng trắng CAT16 và phân vùng sáng. [glfx.js](https://github.com/evanw/glfx.js): unsharp mask; giấy phép nằm trong film-stage/THIRD_PARTY_NOTICES.txt.

[pmndrs postprocessing](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html): LUT 3D nội suy tetrahedral, Gaussian blur, vignette và noise. Intensity cần BlendFunction.NORMAL; mặc định SRC bỏ qua opacity.

[Three.js LUTCubeLoader](https://threejs.org/docs/pages/LUTCubeLoader.html) và [LUT3dlLoader](https://threejs.org/docs/pages/LUT3dlLoader.html): đọc LUT, giữ miền đầu vào và đổi thứ tự kênh. Chấp nhận 2–65 mẫu/kênh; lưới 3DL ba mẫu bị từ chối vì loader đọc nhầm dòng lưới thành RGB.

[EffectCraft](https://github.com/storytold/effectcraft): vùng HSL có falloff và giảm tác động lên xám. [typescript-cubic-spline](https://github.com/starnutoditopo/typescript-cubic-spline): natural spline cho Luma/RGB; luma chạy trước RGB, đầu mút giữ nguyên ngoài miền.

[enhancer của Yuki Koyama](https://github.com/yuki-koyama/enhancer/blob/master/include/enhancer/enhancer.hpp): LGG tuyến tính cho Primary; Log dùng tonalRanges của Filament, Offset tác động toàn hình. Color wheel có RGB, bão hòa, độ sáng, Intensity và reset; vòng màu đo từ ảnh CapCut c1c52e07.

## Nối vào phim

Shot giữ adjust; film-stage/grade chạy sau hậu kỳ và trước ghép transition, Free camera bỏ qua. sealed-room đã nối cả preview và render; template đã nối renderer nhưng cần shotsTimeline để chỉnh từ UI.

LUT nằm trong assets/public/studio-luts của phim; preset trong thư mục cấu hình live-studio của người dùng và mang theo nguồn LUT để dùng ở phim khác. Không tải LUT lên dịch vụ ngoài.

## Kiểm chứng

sealed-room/lab/grade.ts so pixel GPU với mẫu tham chiếu; Basic sai tối đa một mức màu, LUT 0/50/100% khớp, noise giữ nguyên khi quay lại cùng giờ. renders/adjust-comparison.jpg và renders/adjust-verification lưu ảnh thật.

Đã dùng giao diện thử Exposure, bật/tắt, Apply to all, Reset, Undo, nhập LUT, lưu/mở lại preset và màn hình hẹp; hoàn trả dữ liệu phim sau thử. HSL, Curves, Color wheel đã thử kéo, Esc, bàn phím, reset, bật/tắt, Apply to all/Undo và reload; chưa có keyframe màu hoặc eyedropper.

Lớp Adjust phủ nhiều shot đã có; cách ghép hình và bằng chứng nằm trong [adjustment-layers.md](adjustment-layers.md).

## Khác biệt cần nhớ

Không dùng mã Unity vì nguồn hiện hành mang Unity Companion License; enhancer và EffectCraft dùng MIT. Công thức màu có nguồn kiểm chứng nhưng không khẳng định trùng thuật toán độc quyền của CapCut.

Bản cubic-spline trên npm thiếu types dù GitHub có; dùng typescript-cubic-spline kèm adapter CJS theo [Rolldown](https://rolldown.rs/in-depth/bundling-cjs). Kiểm tra Bun không bắt lỗi interop này, phải mở Curves trong bundle trình duyệt.

CPU profile khi kéo wheel: đoạn tạo LUT dài nhất khoảng 13,7 ms trên máy này; 32³ mẫu, tính lại khi đổi màu. Ảnh panel rộng/hẹp, so sánh render và log GPU nằm trong renders/adjust-verification.
