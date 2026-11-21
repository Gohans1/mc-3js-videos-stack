# Khi giao diện AI Studio thay đổi

Selector nằm ở scripts/page-map.ts (ngoại lệ ghi ở phat-trien.md), nên UI đổi thì thường chỉ sửa page-map.ts. Chỉ sửa trong Playground và History; lệnh chạy từ root repo, STUDIO = bun .claude/skills/aistudio/scripts/studio.ts.

## Quy trình sửa

| Bước | Làm gì |
| --- | --- |
| 1. Khám | STUDIO --tab doctor doctor (khoảng 30 giây, không tốn quota). Nó mở từng trạng thái trang và báo từng entry. |
| 2. Đọc kết quả | ✓ khớp candidate đầu; ⚠ chỉ khớp fallback, sửa sớm. ✗ gãy hẳn; · vắng nhưng được phép (entry có optional). |
| 3. Đưa trang về đúng trạng thái | STUDIO open new, open link, model..., hoặc STUDIO ab click để mở picker, dialog, menu như cột where của entry. |
| 4. Nhìn trang | STUDIO ab snapshot -i cho role và tên, STUDIO screenshot x.png để xem bằng mắt. STUDIO ab eval "..." để soi DOM (data-test-id, aria-label, thẻ ms-...). |
| 5. Chọn locator mới | Theo thứ tự bền ở bảng dưới. Thêm vào đầu candidates, giữ cái cũ làm fallback nếu nó còn có thể quay lại. |
| 6. Kiểm lại | STUDIO --tab doctor doctor phải sạch ✗ và ⚠, rồi STUDIO --tab smoke smoke. |
| 7. Ghi bài học | Hành vi mới của trang thì ghi vào bảng bẫy trong phat-trien.md. Chữ đọc từ trang đổi thì sửa TEXT, URL đổi thì sửa URLS trong page-map.ts. |

## Thứ tự locator bền

| Ưu tiên | Kiểu candidate | Ví dụ | Vì sao |
| --- | --- | --- | --- |
| 1 | testId | { testId: "model-name" } | data-test-id là hook test của chính Google, hiếm khi đổi. |
| 2 | role + name | { role: "button", name: "Edit video options" } | Tên đọc cho screen reader, đổi thì người dùng khiếm thị cũng bị ảnh hưởng nên Google ít đổi. Cần UI tiếng Anh. |
| 3 | role + name regex | { role: "button", name: { re: "^(Run\|Stop)$" } } | Khi tên có phần động. |
| 4 | css | { css: "ms-chat-turn" } | Thẻ Angular hoặc class Material, đổi theo mỗi lần Google refactor. Chỉ dùng khi không có ARIA. |

Tên lấy theo thứ tự aria-label, aria-labelledby, label, chữ hiển thị (bỏ icon aria-hidden), title, placeholder, giống agent-browser snapshot. Role phải là role tường minh hoặc có trong bảng implicit của RUNTIME_SOURCE (lib.ts), nên role ngầm khác thấy trong snapshot -i có thể không khớp.

## Mẫu thêm 1 entry vào MAP

| Trường | Ghi gì |
| --- | --- |
| tên key | camelCase, theo việc nó làm (systemInstructions), không theo vị trí. |
| what | 1 câu tả phần tử, kèm điều kỳ quặc nếu có (vd chỉ render khi lượt ở gần màn hình). |
| where | Trạng thái trang mà doctor kiểm: chat, chat-turns, video-chip, video-dialog, model-picker, library, turn-menu, rename-dialog, system-panel. Trạng thái mới thì thêm vào type Where và thêm 1 state trong hàm doctor của studio.ts. |
| candidates | Bền nhất đứng đầu. |
| optional | Chỉ khi phần tử vắng là bình thường; ghi lý do (vd chỉ có khi model có suy nghĩ). |

Phần tử mà tên là dữ liệu (option của dropdown, công tắc tool) thì không thêm vào MAP mà dùng dynamic. Tool mới thì thêm alias vào TOOLS, doctor tự kiểm; tool chỉ có ở 1 số model thì thêm vào TOOLS_SOME_MODELS.

## Khi doctor không tới được 1 trạng thái

| Báo lỗi | Thường là |
| --- | --- |
| new chat page: NOT OK ... prompt box never appeared | promptBox gãy (đăng xuất thì lỗi ghi signed out). Xem ảnh chụp. |
| model picker: did not open | modelName gãy (nút mở picker là button chứa nó). |
| video chip / dialog: covered by cdk-overlay-backdrop | Còn 1 panel hay dialog khác đang mở đè lên. Đóng nó trước. |
| options button stays covered, hoặc options menu did not open | Nút chỉ nhận click khi chuột đang trên lượt, toast có thể che; lượt chỉ có video không có Copy as markdown. Xem openTurnMenu trong lib.ts. |
| turn n never rendered its content | Lượt được ảo hoá; turnBody gãy hoặc showTurn không cuộn tới. |
| dialog không đóng sau Save | Dialog từ chối giá trị; xem chữ trong dialogError. |
| timed out after N s | Đợi 1 trạng thái không tới (chip, History, dialog đổi tên): entry của trạng thái đó gãy hoặc trang chậm. Xem ảnh chụp bước hỏng. |
| page language is ... | Tài khoản Google không để tiếng Anh, mọi tên ARIA sẽ lệch. Đổi ngôn ngữ tài khoản về English. |
