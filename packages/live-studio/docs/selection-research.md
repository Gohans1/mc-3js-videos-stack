# Chọn đối tượng trên preview

## Nguồn

Codegraph: Theatre EditableProxy.tsx và useSelected.tsx dùng đối tượng đăng ký rõ ràng rồi nối lựa chọn trong editor. Exa: [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html), [LineMaterial](https://threejs.org/docs/pages/LineMaterial.html), [TransformControls](https://threejs.org/docs/pages/TransformControls.html); dùng thư viện hiện có, không chép code Theatre.

## Quy tắc

Scene khai báo đối tượng và hàng key tương ứng, không suy từ nhãn tiếng người. Khung chỉ tính mesh đang hiện; raycast dừng ở vật chắn, Ctrl/cmd-click thêm hoặc bỏ lựa chọn.

## Kiểm chứng

Đã bấm Steve trên hình, quét nhiều hàng Props, chọn chung Steve/Props, bỏ chọn và soi cả Draft/Final quality. Khung dùng LineSegments2 giữ độ dày một pixel trên màn hình; ảnh ở sealed-room/renders/selection-verification.

## Còn lại

sealed-room đã nối Steve, chair, drawer, keyboard, screen, silverfish và giấy; Objects dùng dữ liệu placed có sẵn. Nút Save của trình duyệt chưa xác minh tự động được; đã render CLI hai mốc 0 và 29,4 giây, không có khung chọn.

Giường cùng tay kéo cho actor gốc vẫn thuộc task 3D; chưa nối toàn bộ actor của cell-break.
