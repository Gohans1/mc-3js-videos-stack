# mc-3js-videos-stack

Kho làm phim Minecraft bằng Three.js cho YouTube; mã chung ở packages/, mỗi phim trong films/.

## Bắt đầu

Chạy bun install ở root, khai kho tài nguyên trong vault.json rồi bun run link; hướng dẫn tải nằm trong INSTALL.md. Tạo phim bằng bun run new-film <tên>, mở studio bằng bun run studio trong phim.

## Tìm công cụ

AGENTS.md root và từng thư mục là bản đồ công cụ; luật làm phim ở .claude/skills/gohans-3js-videos-skills. [Live Studio](packages/live-studio/README.md) chỉnh timeline, âm thanh, Text, transition và màu; trạng thái từng tính năng ở [CapCut parity](packages/live-studio/docs/capcut-parity.md).

File Mojang, rig và clip Mixamo nằm trong kho ngoài repo, nối vào phim và không commit.
