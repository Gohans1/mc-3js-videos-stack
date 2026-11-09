# Live Studio

Studio xem và chỉnh timeline phim Three.js trên máy tính hoặc điện thoại; người dùng ghim note, AI đọc rồi sửa phim. Timeline hỗ trợ âm thanh, key camera/Steve/đạo cụ, Text, transition, Adjust theo shot và lớp Adjust.

## Chạy

Ở root, dùng bun run new-film <tên>; trong phim chạy bun run studio. Demo: bun run demo -- 4321 trong packages/live-studio; cần Node 22+, Bun, Python và FFmpeg.

Studio dùng chung qua workspace, không chép vào từng phim; [film-contract.md](docs/film-contract.md) quy định cách nối. Truy cập điện thoại qua Tailscale với tên máy trong .live_hosts; không mở dịch vụ trực tiếp ra internet.

## Làm việc với phim

bun run notes [ID] đọc note; bun run note done ID "nội dung" đánh dấu sau khi sửa và kiểm chứng. Không chỉnh notes.jsonl bằng tay.

bun run render stills tạo ảnh nháp; render clip tạo video và SRT, render captions chỉ tạo phụ đề. CHECK và framecheck kiểm chuyển động/hình; tùy chọn nằm trong render.mjs và AGENTS.md root.

## Mã nguồn và kiểm tra

app/ chứa React, Base UI/shadcn, Tailwind và Zustand; src/ là server, render/ dựng nháp, checks/ tính số kiểm tra. Sửa server cần khởi động lại studio; Vite dựng lại giao diện, người dùng bấm New version để tải bản mới.

bun run test, bun run typecheck và bun run lint là ba lệnh kiểm tra. Màu/cỡ chữ lấy từ app/index.css; thành phần dùng variant trong app/components/ui.

[capcut-parity.md](docs/capcut-parity.md) ghi tính năng, thao tác và giới hạn đã kiểm; không coi danh sách là chứng nhận giống CapCut 99%. Thay tính năng phải cập nhật đúng trạng thái và giữ bằng chứng nhìn/nghe/đo thực tế.

## Giấy phép

Mã studio theo [MIT](LICENSE), ngoại trừ các phần bên thứ ba ghi riêng. Limiter chuyển từ FFmpeg n8.1.1 theo LGPL-2.1-or-later, có nguồn gốc và giấy phép trong [app/sound/vendor](app/sound/vendor/README.md); giữ mã nguồn/thông báo khi phân phối.

GL Transitions và mã màu của film-stage có [thông báo riêng](../film-stage/THIRD_PARTY_NOTICES.txt); Mediabunny là MPL-2.0, Lucide/librosa là ISC. Rubber Band R3 dùng bản thực thi ngoài repo, xem [audio-processing.md](docs/audio-processing.md).
