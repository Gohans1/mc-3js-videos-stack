# mc-3js-videos-stack
Kho làm phim Minecraft bằng three.js cho YouTube: code dùng chung ở `packages/`, mỗi phim một folder trong `films/`.

- Cài: `bun install` ở root. Kho tài nguyên Minecraft nằm ngoài repo, khai đường dẫn trong `vault.json` rồi `bun run link`; tải gì thì xem INSTALL.md.
- Phim mới: `bun run new-film <tên>`, rồi `cd films/<tên> && bun run studio`.
- Hướng dẫn cho người và AI: AGENTS.md ở root (bản đồ công cụ, lệnh tự kiểm) và AGENTS.md trong từng folder; luật chung ở skill `.claude/skills/gohans-3js-videos-skills`.
- File game của Mojang, rig, clip Mixamo không bao giờ được commit: chúng ở trong kho và được nối vào phim.
