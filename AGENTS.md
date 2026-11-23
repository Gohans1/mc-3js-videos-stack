# Human's Reminder (Above All Rules)

- Thỏa sức sáng tạo, vọc vạch, bay nhảy, làm bất kì điều gì m thích để làm ra 3js videos đẳng cấp nhất
- Khi làm video nào, nhớ đọc AGENTS.md của root project film của nó và tuân thủ
## SYSTEM RULES for AI Agent đang BUILD project
- ưu tiên linh hoạt, ko mất data, thêm sửa xóa các kiểu dễ bảo trì dễ mở rộng dễ tùy biến, best practice, ko trick lỏ ko hack bẩn ko lách luật,
- Tiêu chí là AI first, AI phải dc tự do sáng tạo làm mọi thứ ko gò bó, con người và UI theo sau. Nhưng vẫn phải cực sướng cho người và AI nhé.
- ưu tiên PC(dev dùng màn 1920x1080), tạm thời kệ mobile nhé
- Nếu task có liên quan, thì hãy nhớ để ý là có cần sửa CLI hay docs hay skill hay .md hay help ,etc... nói chung là liên quan đến ghi chú,gợi nhớ, guide, cho AI các kiểu ko nhé, nhớ tuân thủ theo format cấu trúc và cách viết văn của file đó đừng tự ý viết thả rác bừa bãi theo cách viết riêng hay tự chế gì riêng nhé. tự biết là loại tài liệu nào viết cho AI hay viết cho người mà viết cho phù hợp văn phong nhé (tham khảo cách `agent-browser` làm CLI và hệ thống docs trong CLI của nó)
- you own codebase, t giao cho m toàn quyền tự do lựa chọn và quyết định và triển khai bất kì điều gì m muốn/thích, miễn là làm xong việc, và điều đó là tốt nhất cho t và AI trong hiện tại và tương lai.
- cứ tiếp tục công việc đi, t giao cho m toàn quyền đấy. 
- Research nếu cần và nhớ verify kĩ. 

# Bản đồ

| Đường dẫn                               | Nội dung                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| .claude/skills/gohans-3js-videos-skills | Skill dựng phim 3js và MC.                                                                                      |
| .claude/skills/aistudio                 | CLI điều khiển Google AI Studio Playground (/prompts) và History (/library) qua Chrome ẩn (tầng transport).    |
| .claude/skills/analyze-ref-video        | Phân tích & bóc tách video mẫu (ref) theo khung hình thành blueprint để copy/dựng lại (backend-agnostic).      |
| .claude/skills/compare-video            | So sánh REF vs OURS theo khung hình, lọc lỗi ưu tiên & lặp QA đến khi pass (backend-agnostic).                 |
| .claude/skills/channel-dna              | Nhà máy reverse-engineer bất kỳ kênh YouTube Shorts nào thành skill sản xuất riêng (backend-agnostic).          |
| .claude/skills/zack-d-films             | Playbook sản xuất Shorts 3D Minecraft theo DNA thực nghiệm của Zack D. Films.                                   |
| skill-data/core                         | Guide CLI và quy trình; chạy bun run help và bun run skills get core trước khi tự viết lệnh thủ công.           |
| packages/live-studio                    | Studio, timeline, ghi chú, render; cách dùng: bun run skills get core --ref contract.                           |
| packages/film-stage                     | Camera, fade, animate, transitions, titles, grade, velocity.                                                    |
| packages/film-kit                       | Thở, chớp mắt, liếc, giật mình, run tay.                                                                        |
| packages/mc-actor                       | Player, feet, mob, carry.                                                                                       |
| packages/mc-assets                      | Pack, placed, screen, ink, variants.                                                                            |
| packages/clip-catalog                   | Kho mocap.                                                                                                      |
| templates/film                          | Phim mẫu kèm CAPABILITIES.md (bản đồ đầy đủ package exports, acting, VFX, CLI và skills); bun run new-film.    |
| films/                                  | Phim thật.                                                                                                      |
| scripts/                                | Voice, sound, find, asset, review (reference, scenes, qc), media (công cụ local: bun run media list), vault.    |
| INSTALL.md                              | Cài đặt, kho, giấy phép.                                                                                        |
