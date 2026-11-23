## Live-studio
- Luôn luôn mở live-studio bằng `bun run studio --detach` (kiểm tra bằng `bun run studio --status`, tắt bằng `bun run studio --stop`) thay vì chạy foreground trong built-in harness hay bị timeout
- live-studio chỉ là live-preview cho con người, mục đích của nó chỉ là để dev có công cụ feedback hiệu quả hơn cho bạn, sinh ra là để match/đuổi-kịp sự sáng tạo của bạn, đừng vì quá gò bó mình vào bất kì format/luật-lệ nào của nó mà mất đi sự tự do và sáng tạo. Nó (KHÔNG phải rào chắn) mà là BÀN ĐẠP(hãy coi nó như thể là starter pack) để bạn dựa vào đó mà vươn đến tiềm năng cao nhất để làm ra VIDEOS đẳng cấp nhất có thể, chứ không phải để gò bó bạn bằng những luật lệ quan liêu cồng kềnh. Bạn là chúa của sự sáng tạo và đẳng cấp, không có gì có thể ngăn cản.
- Trong live-studio chưa có format/luật-lệ/tools/khả-năng/cơ-hội/templates/packages/etc... để bạn làm ra videos đẳng cấp? -> vượt lên trên nó, cứ thoải mái mà custom, nhớ báo cáo lại là được. (ĐỪNG ỷ lại vào đồ có sẵn mà quên mất khả năng sáng tạo tự code 3D đỉnh cao)

## Tổ chức & linh hoạt

- Nếu có thể, các assets tự làm phải tách riêng gọn gàng sẵn ngay trong project film đó. Để sau này dev dễ dàng đẩy vào assets chung
- Trong trường hợp các guide/skills/kiến-thức/kĩ-năng/thông-tin/etc... hướng dẫn làm videos chuẩn chỉ thì dev thường lấy trên mạng về nên có khả năng sẽ conflict với hệ thống cấu trúc hiện tại của project -> Hãy tự biết chọn lọc và áp dụng một cách flexible và hiệu quả nhất
- Tính năng/tools/kĩ thuật/etc... gì CLI không có -> thoải mái tự do sáng tạo custom

# Skills

- Đọc `CAPABILITIES.md` ngay ở thư mục gốc của film này để nắm đủ toàn bộ package exports (`film-stage`, `film-kit`, `mc-actor`, `mc-assets`, `live-studio`), shader, Rapier physics, CLI và repo skills trước khi tự code lại từ đầu
- LUÔN LUÔN dùng SKILL(và CLI): `mc-films` (`../../.claude/skills/mc-films`, chạy `bun run skills get core` và `bun run help`)
- Sound/âm-thanh/SFX/BGM/Voice/Audio/etc...: `earshot`; `real-sound`
