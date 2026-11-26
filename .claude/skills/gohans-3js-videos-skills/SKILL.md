---
name: gohans-3js-videos-skills
description: Dùng khi cần biết Stack làm 3js videos của gohans cần những gì. Guide,Workflow làm việc. Curated Three.js and 3D video production tech stack with battle-tested libraries and a Before/After reference guide. Planning, building, rendering, reviewing, debugging, or advising on Three.js scenes, 3D explainer or documentary videos, WebCodecs MP4 export, camera math, glTF optimization, post-processing, ambient occlusion, lip-sync, 3D characters, audio loudness normalization, 2.5D parallax, geospatial maps, physics fracture, or Minecraft 3D films
license: MIT
---

# Using References

## Review scene dựng theo REF

Khi đã được giao review, render xong scene nào thì so scene đó ngay. Dùng `bun run reference frames <ref> <render>` để xuất JPEG ghép REF/OURS có timecode phim ở 15 fps, tối đa 450 ảnh mỗi list. Gửi từng list qua AI Studio `--batch --files-from` với `gemini-4-hydrogen`, `--thinking High`, `--media High`, rồi lưu report cạnh list và kiểm chứng lỗi trên frame gốc.

Đọc [guide review Gemini](./references/gohans-gemini-review-video.md) để chọn đúng luồng cho scene, âm thanh hoặc cả phim. [Recipe Compare](../compare-video/references/stills-field-audit.md#recipe) có lệnh đóng gói, prompt quét nhanh, prompt từng field và cách xử lý lượt lỗi.

## [references/gohans-3js-videos-minecraft](./references/gohans-3js-videos-minecraft.md) (file lớn, đọc từ từ cẩn thận)

Kiến trúc, thư viện & kho tài nguyên(Blocks custom/original; character; sound; articles; gun; structures; vehicles; sci-fi; foods; clothes;physics; animals;natural; items; etc...) tất tần tật liên quan đến lảm video Minecraft

### When Using:

- dev muốn setup minecraft videos project
- dev muốn thêm bất kì điều gì vào scene/project minecraft
- dev muốn bạn research/tìm hiểu/giải thích thêm về mọi thứ trong minecraft
- khi bạn chuẩn bị tự chế custom bất kì món/công thức/code/etc... gì trong minecraft (nếu trong list không có -> thì hãy tự vẽ custom phù hợp với block-model-renderer

## [references/gohans-threejs-stack.md](./references/gohans-threejs-stack.md)

Tất tần tật repo/tools/kiến thức/etc... Phục vụ cho làm videos 3js cho tất cả mọi lĩnh vực

### When Using

- khi dev muốn setup bắt đầu 1 project mới. Hỏi kĩ từng câu một nhu cầu của dev (kiểu grill-me) để chọn ra tech stack tương ứng
- khi bạn chuẩn bị tự chế custom bất kì công nghệ nào mới trong project

## Voice

- Dùng `ElevenLabs` v4 qua `genvoice.pro`. API/tham số/endpoint/etc... research nếu cần

### Audio Tags (research nếu cần)

- Không giới hạn danh sách cố định ("There is no definitive ElevenLabs Audio Tags list"): được tự chế vô hạn bằng ngôn ngữ tự nhiên trong ngoặc vuông `[...]`, ví dụ `[out of breath after running up the stairs]`, `[nervous, trying to sound confident]`.
- English Audio Tags only

## Image

Dùng `codex` CLI để tạo ảnh nếu cần
