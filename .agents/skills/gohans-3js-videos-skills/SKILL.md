---
name: gohans-3js-videos-skills
description: Dùng khi cần biết Stack làm 3js videos của gohans cần những gì. Guide,Workflow làm việc. Curated 64-repository Three.js and 3D video production tech stack with battle-tested libraries and a Before/After reference guide. Planning, building, rendering, reviewing, debugging, or advising on Three.js scenes, 3D explainer or documentary videos, WebCodecs MP4 export, camera math, glTF optimization, post-processing, ambient occlusion, lip-sync, 3D characters, audio loudness normalization, 2.5D parallax, geospatial maps, physics fracture, or Minecraft 3D films
license: MIT
---

# Using References 
## [references/gohans-3js-videos-minecraft](./references/gohans-3js-videos-minecraft.md) (file lớn, đọc từ từ cẩn thận)
Kiến trúc, thư viện & kho tài nguyên(Blocks custom/original; character; sound; articles; gun; structures; vehicles; sci-fi; foods; clothes;physics; animals;natural; items; etc...) tất tần tật liên quan đến lảm video Minecraft
### When Using:
- dev muốn setup minecraft videos project
- dev muốn thêm bất kì điều gì vào scene/project minecraft 
- dev muốn bạn research/tìm hiểu/giải thích thêm về mọi thứ trong minecraft
- khi bạn chuẩn bị tự chế custom bất kì món/công thức/code/etc... gì trong minecraft (nếu trong list không có -> thì hãy tự vẽ custom phù hợp với block-model-renderer

## [references/gohans-separate-agent-review](./references/gohans-separate-agent-review.md) (https://github.com/Gohans1/gohans-skills/blob/main/gohans-3js-videos-skills/references/gohans-separate-agent-review.md)
### When Using
- Chỉ khi dev yêu cầu
- CẤM TỰ TIỆN DÙNG 

## [references/gohans-threejs-stack.md](./references/gohans-threejs-stack.md)
Tất tần tật repo/tools/kiến thức/etc... Phục vụ cho làm videos 3js cho tất cả mọi lĩnh vực
### When Using
- khi dev muốn setup bắt đầu 1 project mới. Hãy `grill-me` nhu cầu của dev để chọn ra tech stack tương ứng
- khi bạn chuẩn bị tự chế custom bất kì công nghệ nào mới trong project

# Overview

# Edit Videos Rules
- làm video bằng 3js, WebGL
- 30fps
- Dùng `codex` CLI để tạo ảnh nếu cần
## Live Preview (live-studio và render draft) (https://github.com/Gohans1/live-studio)
- Nhớ đọc hướng dẫn sử dụng live-studio
- Tailscale: chạy bằng Terminal, không chạy bằng preview của harness
### Using
- góc phải trên cùng màn hình: cho thời gian `mm:ss.sss` để dev tiện xem preview đến đâu feedback đúng thời điểm đó (bản final thì không cần)
- góc trái trên cùng màn hình: là 1 list dạng `Show Subtitles`
Tại đúng từng frame t, list thật dài và chi tiết MỌI thủ thuật/kỹ thuật đang diễn ra thật ở khoảnh khắc đó (ví dụ như: camera move, cut/continuous, zoom/FOV, ease curve, góc máy, đèn/post-FX, cử động nhân vật, repo, SFX/nhạc + edit.json + etc...) xuất hiện nối đuôi chồng lên nhau liên tục. với mục đích dev muốn biết TOÀN BỘ những "gì" đang được áp dụng tại ngay thời điểm frame đó.

- Mọi phim 3js dùng chung 1 studio: https://github.com/Gohans1/live-studio (Desktop\live-studio). KHÔNG copy studio vào phim.
- Phim mới: `node ../live-studio/init.mjs .` → link node_modules/live-studio + 3 file nối (src/live.mjs, src/edit.ts, notes_report.py).
- Luật bắt buộc: đọc node_modules/live-studio/docs/film-contract.md trước khi viết scene.ts/edit.json. Cốt lõi: draw(t) vẽ được giây bất kỳ ngay lập tức (không cộng dồn từng frame).
- Studio tự kiểm tra luật mỗi lần chạy; thiếu tính năng thì thêm hook vào studio, không vá riêng trong phim.
- AGENTS.md của phim phải có 1 dòng trỏ tới film-contract.md.

## Render
- Chỉ render khi có lí do thực sự hợp lý hoặc khi dev trực tiếp cho phép, vì render thường sẽ tốn rất nhiều thời gian.
- chỉ khi nào dev bảo làm final thì mới thực sự render ra video chất lượng cao nhất(lâu) để đăng lên kênh, còn lại thì hãy tối ưu để có thể sửa linh hoạt, gọn, nhẹ, nhanh, cache, hiệu quả,etc... (CỰC KÌ QUAN TRỌNG) ví dụ như sửa cảnh nào thì chỉ render lại đúng cảnh đó, sửa âm thanh thì không xuất lại hình, ko tải tất cả mọi thứ từ đầu cồng kềnh overkill,etc... mà liên phải biết làm mọi thứ nhanh/tiện/tối ưu nhất có thể khi CHƯA CẦN phải render final
- Luôn render ở ổ C (SSD) cho nhanh (rồi thích vứt sang ổ nào khác thì vứt)

### Blender
- CẤM render TOÀN BỘ VIDEO bằng Blender (Cycle, Eeve) vì quá nặng, dev làm thuần video bằng 3js với các model .glb tương ứng đã dc tải về. 
- Các trường hợp cần dùng Blender mà bắt-buộc/đáng để/phải sử dụng (ví dụ: Render cảnh ngắn kịch tính; custom file .blend & .glb; thumbnail videos;etc...) thì cứ thoải mái (nhớ báo trước cho dev)

## Verify/Review
- Làm xong bất kì điều gì, từ nhỏ (1 item/vật dụng nhỏ) hay to (1 scene to) hãy tự mình review lại thật KĨ, chứng kiến tận mắt ở từng góc cạnh, bao quát tất cả,etc...

### Human
- Khi sửa những chi tiết cụ thể -> nói thẳng thời gian `mm:ss` của những chi tiết đó kèm công cụ/tools/repo/etc... Dc sử dụng trong chỗ đó để dev vào check cho nhanh
- Dev chỉ check và feedback qua `live-studio`(Desktop\live-studio) (tailscale) (KHÔNG check qua render), làm đến phần nào thì báo dev vào kiểm tra đến đó (vẫn tiếp tục công việc hiện tại)

## Voice
- Dùng `ElevenLabs` v4 qua `genvoice.pro`. API/tham số/endpoint/etc... research nếu cần

### Audio Tags (research nếu cần)
- Không giới hạn danh sách cố định (*"There is no definitive ElevenLabs Audio Tags list"*): được tự chế vô hạn bằng ngôn ngữ tự nhiên trong ngoặc vuông `[...]`, ví dụ `[out of breath after running up the stairs]`, `[nervous, trying to sound confident]`.
- English Audio Tags only

### Giọng kể Ngôi thứ 3 (Fern / Atrium / Blackfiles)
- Hạng 1 (`Seff Echo - Cinematic Storyteller` — ID: `ZaZosYpkIGmSqOwAlfnk`):** Giọng dẫn chính ưu tiên số 1 (lai `Blackfiles × Atrium`). Phân khúc `PVC` (`professional` người thật thu phòng thu, `~2.5k` lượt dùng cực ít đụng hàng), giọng nam Mỹ trẻ `en-US`, `rate=1`, `notice_period=730` ngày, tắt kiểm duyệt ngầm (`live_moderation_enabled=null`), nhịp gốc chuẩn ngay trên `eleven_v4`.
- Hạng 2 (`Jake – Deep, Smooth, Dramatic` — ID: `ev2kMR9ZJZZsemuogS5u`):
- Hạng 3 (`True - Crime & Horror Narrator` — ID: `tZssYepgGaQmegsMEXjK`):

## SFX
Freesound API v2, CC0 1.0
Mixkit Free Sound Effects
Sonniss GDC Game Audio Archive
...
## Image
Dùng `codex` CLI để tạo ảnh nếu cần

# Inspired:
- Fern: https://www.youtube.com/@fern-tv
- Atrium: https://www.youtube.com/@AtriumExplores
- Primal Space: https://www.youtube.com/@primalspace