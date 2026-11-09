# Easing cho Steve

## Cách dùng

Chọn key moves sau key đầu, mở Easing; Automatic giữ chuyển động cũ, preset hoặc Custom điều khiển đoạn từ key trước tới key đang chọn. Scene đăng ký draw.keyEases bằng edit/path/names và cung cấp các hàm draw.eases tương ứng.

## Nguồn

Codegraph đã đối chiếu Theatre interpolationTripleAtPosition; Exa đã đọc [Blender F-Curve](https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/properties.html). Tái sử dụng film-stage easeOf và bezier-easing; không viết bộ nội suy riêng.

## Kiểm chứng

Đã kéo Custom, Undo một bước, nhập số, tải lại và trả Automatic; ảnh UI/render tại sealed-room/renders/easing-verification. Gait lấy tốc độ từ cùng đường đi; easing không đổi tốc độ phát nguồn mocap.
