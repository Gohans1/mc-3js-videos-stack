# Adjust theo shot

## Nguồn đã đối chiếu

Ảnh CapCut do dev gửi: Basic 15 thanh, HSL 8 màu, Curves Luma/RGB và bốn Color wheel. [CapCut LUT](https://www.capcut.com/resource/luts-for-color-grading) xác nhận nhập CUBE/3DL và Intensity; chưa đo được công thức màu riêng của CapCut nên không coi đầu ra giống tuyệt đối.

[Google Filament](https://github.com/google/filament/blob/main/filament/src/ColorGrading.cpp): cân bằng trắng CAT16 và phân vùng sáng. [glfx.js](https://github.com/evanw/glfx.js): unsharp mask; giấy phép nằm trong film-stage/THIRD_PARTY_NOTICES.txt.

[pmndrs postprocessing](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html): LUT 3D nội suy tetrahedral, Gaussian blur, vignette và noise. Intensity cần BlendFunction.NORMAL; mặc định SRC bỏ qua opacity.

[Three.js LUTCubeLoader](https://threejs.org/docs/pages/LUTCubeLoader.html) và [LUT3dlLoader](https://threejs.org/docs/pages/LUT3dlLoader.html): đọc LUT, giữ miền đầu vào và đổi thứ tự kênh. Chấp nhận 2–65 mẫu/kênh; lưới 3DL ba mẫu bị từ chối vì loader đọc nhầm dòng lưới thành RGB.

## Nối vào phim

Shot giữ adjust; film-stage/grade chạy sau hậu kỳ và trước ghép transition, Free camera bỏ qua. sealed-room đã nối cả preview và render; template đã nối renderer nhưng cần shotsTimeline để chỉnh từ UI.

LUT nằm trong assets/public/studio-luts của phim; preset trong thư mục cấu hình live-studio của người dùng và mang theo nguồn LUT để dùng ở phim khác. Không tải LUT lên dịch vụ ngoài.

## Kiểm chứng

sealed-room/lab/grade.ts so pixel GPU với mẫu tham chiếu; Basic sai tối đa một mức màu, LUT 0/50/100% khớp, noise giữ nguyên khi quay lại cùng giờ. renders/adjust-comparison.jpg và renders/adjust-verification lưu ảnh thật.

Đã dùng giao diện thử Exposure, bật/tắt, Apply to all, Reset, Undo, nhập LUT, lưu/mở lại preset và màn hình hẹp; hoàn trả dữ liệu phim sau thử. Chưa có keyframe màu, HSL/Curves/Color wheel hoặc adjustment layer trong bản Basic này.
