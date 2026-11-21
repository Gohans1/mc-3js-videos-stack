---
name: aistudio
description: Điều khiển Playground chat và History của Google AI Studio (aistudio.google.com) bằng Chrome thật đã đăng nhập, chạy ẩn ngoài màn hình. Dùng để hỏi đáp Gemini (mặc định gemini-4-neon, miễn phí theo gói Pro/Ultra, không tốn API), gửi kèm file (video, ảnh, PDF, audio, text), so sánh nhiều video ở FPS 24, hỏi tiếp trong chat cũ, đợi câu trả lời lâu rồi lấy lại, chạy nhiều chat song song ở nhiều tab, đổi model, thinking level, media resolution, tools, system instructions, đổi tên chat, tìm và đọc lại chat cũ trong History. Use this skill whenever the user mentions AI Studio, Gemini in the browser, gemini-4-neon, asking Gemini about a video/file/PDF/image, comparing videos with Gemini, reading or searching old AI Studio chats, or changing AI Studio chat settings, even if they do not say "skill". Triggers: "hỏi gemini", "gửi video lên ai studio", "so sánh 2 video", "đọc lại chat ai studio", "đổi model ai studio", "aistudio".
---

# aistudio

Bộ đồ nghề cho Playground chat và History của AI Studio: ask.ts gửi prompt và lấy câu trả lời, studio.ts làm mọi việc còn lại. Chạy từ root repo bằng bun.

Khu này dành cho AI dùng skill. Sửa hay mở rộng skill thì đọc references/phat-trien.md.

## Phạm vi

| Được | Không đụng |
| --- | --- |
| Playground chat (/prompts) và History (/library). | Build apps, API keys, Dashboard, usage, billing và mọi khu khác của AI Studio, kể cả qua lệnh ab. |

## Bắt đầu

| Việc | Lệnh |
| --- | --- |
| Xem toàn bộ lệnh | bun .claude/skills/aistudio/scripts/studio.ts --help và ask.ts --help |
| Hỏi 1 câu | bun .claude/skills/aistudio/scripts/ask.ts "câu hỏi" --out answer.md |
| Hỏi kèm file | bun .claude/skills/aistudio/scripts/ask.ts a.mp4 b.pdf c.png "câu hỏi" --out answer.md |
| Trang đang ở đâu, cài đặt gì | bun .claude/skills/aistudio/scripts/studio.ts status |
| Bản đồ mọi nút trên trang | bun .claude/skills/aistudio/scripts/studio.ts map |
| Kiểm tra skill còn khớp UI | bun .claude/skills/aistudio/scripts/studio.ts --tab doctor doctor |

Viết tắt bên dưới: ASK = bun .claude/skills/aistudio/scripts/ask.ts, STUDIO = bun .claude/skills/aistudio/scripts/studio.ts.

## Gửi prompt (ASK)

| Chế độ | Lệnh |
| --- | --- |
| Chat mới, 0 tới n file | ASK [file ...] "prompt". Prompt luôn đứng cuối. |
| Hỏi tiếp chat cũ, có thể kèm file mới | ASK --chat link-hoặc-id [file ...] "prompt" |
| Lấy câu trả lời cuối của chat (đang chạy hay xong r) | ASK --chat link-hoặc-id. Chat đang chạy chỉ lấy được ở đúng tab đang chạy nó: dùng lệnh lấy lại in trong log (đã kèm --tab). |
| Lấy câu trả lời của chat đang mở trong tab (chat chưa có link) | ASK --collect |

| Tuỳ chọn | Mặc định | Ghi chú |
| --- | --- | --- |
| --prompt-file file | không | Prompt dài đọc từ file; khi đó mọi tham số còn lại là file đính kèm. Đã thử 40 nghìn ký tự. |
| -- "prompt" | không | Prompt bắt đầu bằng dấu - thì đặt sau --. |
| --out file.md | in ra stdout | Log luôn ra stderr. |
| --tab nhãn | main | Mỗi tab là 1 cửa sổ riêng, chạy song song được. |
| --model id | gemini-4-neon | Chỉ chat mới. Danh sách: STUDIO models. |
| --thinking | Extra High (chat mới trên gemini-4-neon) | Model khác giữ mức mặc định của trang, muốn chắc thì truyền --thinking. Mỗi model có danh sách riêng (flash-lite chỉ tới High); hỏi tiếp thì giữ của chat. |
| --media | High (chat mới) | Default, Low, Medium, High. |
| --system "text" | giữ nguyên | Thay system instructions ngay trước khi gửi; "" là xoá. |
| --tool tên=on hoặc off | trạng thái đang nhớ | Lặp được, vd --tool search=off. Công tắc Google Search được AI Studio nhớ sang mọi chat mới, nên cần chắc thì luôn truyền; bước run in trạng thái search đã dùng. |
| --fps n | 24 | Chỉ file video, 0 < n ≤ 24. |
| --start 1m10s --end 2m30s | cả video | Chỉ file video, cắt đoạn. AI Studio tự viết lại thời gian (0m2s thành 2s), script so theo số giây. |
| --agentic | tắt | Agentic video understanding. AI Studio ẩn FPS và đoạn cắt khi bật, nên không đi cùng --fps/--start/--end. |
| --run-timeout-min | 60 | Hết giờ script dừng, model vẫn chạy tiếp trong Chrome. |
| --upload-timeout-min | 15 | File lớn thì tăng. |

## Công thức hay dùng

| Việc | Cách |
| --- | --- |
| So sánh 2 video | ASK a.mp4 b.mp4 "so sánh..." --out cmp.md. FPS và đoạn cắt áp cho mọi video trong lệnh, được đọc lại từng video rồi kiểm lại cả 2 trước khi Run. |
| Hỏi đáp thuần text | ASK "câu hỏi" --thinking Low cho nhanh. |
| Đọc PDF, ảnh, audio, text | Đưa file vào trước prompt như video; chỉ video mới có bước cài đặt riêng. |
| Câu trả lời lâu (video dài, Extra High) | Chạy lệnh ở chế độ nền với timeout lớn hơn --run-timeout-min. Hết giờ thì log in sẵn lệnh lấy lại. |
| Hỏi tiếp | Cuối log in link chat và lệnh follow-up; chat mới chưa có link thì in lệnh --collect. Giữ link lại. |
| Nhiều việc cùng lúc | Mỗi việc 1 --tab riêng (vd --tab vid, --tab qa). Không chạy 2 lệnh cùng 1 tab. |
| Tìm chat cũ rồi đọc | STUDIO history --search từ-khoá, rồi STUDIO read link --out chat.md. |
| Có hay không tra web | ASK --tool search=on hoặc search=off "câu hỏi". STUDIO tool search còn đổi luôn mặc định cho chat mới về sau ở mọi tab; tool khác, model, thinking, media chỉ đổi chat đang mở. |
| Đổi cài đặt chat đang mở | STUDIO model id, STUDIO set thinking High, STUDIO set media Low, STUDIO tool search off, STUDIO system "text". |

## Hộp đồ nghề (STUDIO)

| Nhóm | Lệnh | Làm gì |
| --- | --- | --- |
| Tab | tabs | Liệt kê cửa sổ: nhãn, url, tiêu đề. |
| Tab | tab close nhãn | Đóng cửa sổ của tab (từ chối khi đang sinh câu trả lời). Tab tự mở khi lần đầu dùng --tab. |
| Chat | status | url, tài khoản, chat, tiêu đề, số lượt, đang chạy không, cài đặt. |
| Chat | open new [--model id] / open link-hoặc-id | Mở chat mới hoặc chat đã lưu. Chat đang mở sẵn thì không tải lại. |
| Chat | rename "tên" [--description "mô tả"] | Đổi tên chat đã lưu (chat mới chưa có link thì chưa đổi được). |
| Chat | read [link] [--thoughts] [--out file.md] | Cả chat thành markdown, có tên file đính kèm; --thoughts kèm suy nghĩ của model. |
| Cài đặt | models [--search chữ] | Mọi model trong picker: id, tên, mô tả. |
| Cài đặt | model id | Đổi model. |
| Cài đặt | set thinking mức / set media mức | Đổi dropdown, đọc lại để xác nhận. |
| Cài đặt | tool search, url, code, structured, functions, maps (hoặc tên đầy đủ) + on hoặc off | Bật tắt tool. maps chỉ có ở 1 số model. |
| Cài đặt | system ["text"] | Xem hoặc thay system instructions. Chỉ được lưu vào chat khi Run, nên muốn chắc thì dùng ASK --system. |
| History | history [--search chữ] [--limit n] | Chat đã lưu, mới nhất trước, mặc định 20 dòng. |
| Sức khoẻ | doctor [--quick] | Kiểm mọi locator trên UI thật, không tốn quota; --quick bỏ bước upload. Chạy ở tab riêng (--tab doctor) vì nó đi qua chat mới, History và chat gần nhất; cần ít nhất 1 chat đã lưu. |
| Sức khoẻ | smoke | Chạy ASK thật trên video test 2 giây; chạy ở tab riêng (--tab smoke). |
| Cấp thấp | map | Bản đồ page-map.ts, không mở trình duyệt. |
| Cấp thấp | screenshot [file.png] | Chụp tab. |
| Cấp thấp | ab lệnh-agent-browser | Lối thoát: agent-browser đã gắn đúng tab (vd STUDIO ab snapshot -i, STUDIO --tab qa ab get url). |
| Cấp thấp | chrome [--show] | Mở Chrome ẩn; --show đưa cửa sổ ra màn hình để đăng nhập tay. |

Thêm --json vào lệnh in dữ liệu (status, tabs, models, history, read, system, doctor) để lấy JSON. Xong việc thì đóng tab phụ bằng STUDIO tab close nhãn.

## Việc chưa có lệnh

Dùng STUDIO map để biết tên nút, STUDIO ab snapshot -i để thấy trang, rồi STUDIO ab click/fill theo ref, chỉ trong phạm vi ở trên. Việc lặp lại thì thêm lệnh theo references/phat-trien.md.

## Đọc log

| Dấu | Nghĩa |
| --- | --- |
| → [n/N] bước | Bước bắt đầu. |
| ✓ [n/N] bước: ... | Bước xong, kèm bằng chứng đọc lại từ trang. |
| … still ... | Đang đợi, 30 giây báo 1 lần. |
| ✗ [n/N] bước failed: ... | Bước hỏng, kèm lý do và ảnh chụp %TEMP%\aistudio-failed-nhãn-stepN.png. |

Exit 0 là xong và đã xác nhận, 1 là 1 bước hỏng, 2 là sai input (chưa đụng trình duyệt).

## Chế độ ẩn

Chrome chạy ở cổng 9333 với profile riêng, mỗi tab là 1 cửa sổ nằm ngoài màn hình, mở ở chế độ nền. Không chiếm chuột, bàn phím, màn hình, focus hay clipboard Windows. Cửa sổ ẩn không có nút trên taskbar, không có trong Alt+Tab, Windows không tự trao bàn phím cho nó, nên người dùng không bấm nhầm hay gõ nhầm vào được.

| Đánh đổi | Vì sao |
| --- | --- |
| Không dùng headless | Chrome headless tự khai HeadlessChrome trong user agent; Google dễ chặn hoặc đăng xuất. Giả user agent là lách luật nên không làm. |
| Không thu nhỏ cửa sổ | Cửa sổ thu nhỏ làm trang thành hidden, dropdown không mở. Win+D có lúc vẫn thu nhỏ được nó; bước kế tiếp tự mở lại mà không lấy focus. |
| Muốn nhìn tận mắt | STUDIO chrome --show đưa cửa sổ ra màn hình thành cửa sổ thường (có taskbar, click gõ được); lệnh kế tiếp có mở trang trên cùng tab (status, ASK...) đưa nó về chỗ ẩn. |

## Lỗi thường gặp

| Lỗi | Xử lý |
| --- | --- |
| signed out | Nhờ người dùng chạy STUDIO chrome --show và tự đăng nhập trong cửa sổ đó, rồi chạy lại. |
| AI Studio cannot open that chat | Sai id, chat đã xoá hoặc thuộc tài khoản Google khác. |
| still generating | Tab hay chat đang trả lời việc khác. Lấy nó bằng ASK --collect (cùng --tab) hoặc dùng tab khác. |
| the last prompt in this chat has no answer | Chat có thể đang chạy ở tab khác: xem STUDIO tabs trước. Không thì lần chạy trước đã bị dừng, gửi lại bằng --chat. |
| has no ... on this model; it offers: ... | Mức thinking hay media đó không có ở model này. Chọn 1 mức trong danh sách in ra. |
| no ... switch on the page / is disabled right now | Tool đó không có hoặc bị khoá ở model này (vd maps). Đổi model hoặc bỏ tool. |
| already holds N attachment(s) | Lần chạy trước trong tab bỏ dở file đính kèm. Dùng --tab khác hoặc STUDIO open new. |
| tab_locked | Một session agent-browser khác đang giữ cửa sổ đó. Dùng nhãn tab khác. |
| only a saved chat can be renamed | Chat mới có link khoảng 1 phút sau câu trả lời đầu tiên. |
| AI Studio says: ... | Thông báo của chính AI Studio (quota, lỗi server, giá trị video sai). Đọc nguyên văn. |
| Bước nào đó không tìm thấy nút | UI có thể đã đổi: chạy STUDIO doctor rồi theo references/khi-ui-thay-doi.md. |

## Luật dùng

| Luật | Vì sao |
| --- | --- |
| Chỉ Playground và History | Người dùng chỉ cho phép phạm vi này. |
| Mỗi tab 1 lệnh tại 1 thời điểm | Các lệnh trong cùng tab dùng chung 1 trang, không có khoá. |
| Không tải lại hay rời chat đang sinh câu trả lời | Mất câu trả lời đang sinh. |
| Không dùng agent-browser close hay tab new trên Chrome này | close đóng cả Chrome chung; tab new mở tab trong cửa sổ có sẵn làm tab kia bị ẩn. |
| Giữ tài khoản Google ở tiếng Anh | Locator dựa vào tên tiếng Anh của nút. |
| Kiểm chứng câu trả lời quan trọng | Gemini từng bịa chi tiết audio của clip test. |
| ASK chỉ copy lượt Model cuối | Câu trả lời tách nhiều lượt thì STUDIO read để lấy đủ. |
| history chỉ đọc trang đầu của History | Không thấy chat cũ thì dùng --search, đừng kết luận là không có. |
