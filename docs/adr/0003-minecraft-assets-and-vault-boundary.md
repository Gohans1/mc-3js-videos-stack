# ADR 0003: Phân lớp tài sản Minecraft và ranh giới vault cục bộ

## Bối cảnh

Phim cần kết hợp khối gốc Minecraft, gói tài nguyên từ cộng đồng và prop riêng của dự án trong khi không được đẩy tài sản bản quyền lên Git. Việc giải nén lại tệp jar gốc mỗi lần dựng cảnh cũng gây chậm nặng khi xem trước.

## Quyết định

| Hạng mục | Quy tắc |
| --- | --- |
| Thứ tự chồng lớp | Nạp tài sản qua prepareAssets với cache bật sẵn theo thứ tự bộ prop gohans, gói picked.zip rồi tới client_assets.zip gốc. |
| Prop dùng chung | Viết prop dưới không gian tên gohans theo đúng định dạng block model Java vani trong packages/mc-assets/pack để mở được bằng Blockbench và gói tĩnh theo mã. |
| Ranh giới bản quyền | Giữ tài sản Mojang, Mixamo và bản sao MineRender trong vault hoặc thư mục vendor bị Git bỏ qua theo packages/mc-assets/mobs.ts và film-kit-demo/setup.ts. |
| Định nghĩa vật phẩm | Ưu tiên đọc cấu trúc items của Minecraft 1.21.4 trước, chỉ lùi về models/item cũ khi không có tham chiếu tĩnh trong bounds.ts và catalog.ts. |
| Gói WASM cho phim | Script packages/mc-assets/vendor.mjs chép tệp WASM của block-model-renderer cạnh gói trang phim khi cài đặt để trình duyệt nạp được cục bộ. |

## Hệ quả

Kho Git luôn sạch bản quyền và khởi động nhanh hơn nhờ giải nén jar một lần duy nhất. Các phim mới dùng chung bộ prop gohans và quy trình pick thống nhất.
