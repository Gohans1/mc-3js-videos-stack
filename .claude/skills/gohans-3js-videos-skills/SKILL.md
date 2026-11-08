---
name: gohans-3js-videos-skills
description: Dùng khi cần biết Stack làm 3js videos của gohans cần những gì. Guide,Workflow làm việc. Curated Three.js and 3D video production tech stack with battle-tested libraries and a Before/After reference guide. Planning, building, rendering, reviewing, debugging, or advising on Three.js scenes, 3D explainer or documentary videos, WebCodecs MP4 export, camera math, glTF optimization, post-processing, ambient occlusion, lip-sync, 3D characters, audio loudness normalization, 2.5D parallax, geospatial maps, physics fracture, or Minecraft 3D films
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

## [references/gohans-separate-agent-review](./references/gohans-separate-agent-review.md)
### When Using
- Chỉ khi dev yêu cầu
- CẤM TỰ TIỆN DÙNG 

## [references/gohans-threejs-stack.md](./references/gohans-threejs-stack.md)
Tất tần tật repo/tools/kiến thức/etc... Phục vụ cho làm videos 3js cho tất cả mọi lĩnh vực
### When Using
- khi dev muốn setup bắt đầu 1 project mới. Hỏi kĩ từng câu một nhu cầu của dev (kiểu grill-me) để chọn ra tech stack tương ứng
- khi bạn chuẩn bị tự chế custom bất kì công nghệ nào mới trong project

# Overview
- Phim 3js của dev nằm trong monorepo (https://github.com/Gohans1/mc-3js-videos-stack): `packages/` dùng chung, `films/<tên>` mỗi phim, phim mới tạo bằng `bun run new-film <tên>`.
- Đọc AGENTS.md ở root monorepo trước khi làm: bản đồ "cần gì thì tìm ở đâu" và các lệnh tự kiểm nằm ở đó, skill này chỉ giữ luật chung.
- Skill này nằm trong monorepo (`.claude/skills/gohans-3js-videos-skills`, `~/.claude/skills` chỉ là link trỏ vào): đổi code làm skill sai thì sửa skill trong cùng commit.

# Edit Videos Rules
- làm video bằng 3js, WebGL
- 30fps
- Cần động tác người: tìm trong kho clip đã tải sẵn trước (Mixamo, UAL) bằng `packages/clip-catalog/catalog.py --jev`
- Trước khi bắt tay vào làm việc, hãy kiểm tra quanh monorepo để tìm kiếm resources có sẵn phù hợp với task hiện tại
## Live Preview (live-studio và render draft) (`packages/live-studio` trong monorepo)
- Nhớ đọc hướng dẫn sử dụng live-studio (`packages/live-studio/README.md`, `AGENTS.md`)
- Tailscale: chạy bằng Terminal, không chạy bằng preview của harness
### Using
- Đánh dấu `Done` với mỗi note đã sửa mà dev feedback trên app (`bun run note done <ID> "đã sửa gì"`)
- Đọc `packages/live-studio/docs/film-contract.md` trước khi viết scene.ts/edit.json.

## Render
- Render Ảnh nháp (`bun run render stills`, `CHECK=...`) không ra video, chạy từ vài giây đến vài phút: cứ chạy thoải mái để tự soi. Render ra video (`bun run render clip`, final) tốn rất nhiều thời gian: chỉ chạy khi có lí do thực sự hợp lý hoặc dev trực tiếp cho phép.
- chỉ khi nào dev bảo làm final thì mới thực sự render ra video chất lượng cao nhất(lâu) để đăng lên kênh, còn lại thì hãy tối ưu để có thể sửa linh hoạt, gọn, nhẹ, nhanh, cache, hiệu quả,etc... (CỰC KÌ QUAN TRỌNG) ví dụ như sửa cảnh nào thì chỉ render lại đúng cảnh đó (`CHUNKS=`), sửa âm thanh thì không xuất lại hình, ko tải tất cả mọi thứ từ đầu cồng kềnh overkill,etc... mà liên phải biết làm mọi thứ nhanh/tiện/tối ưu nhất có thể khi CHƯA CẦN phải render final
- Luôn render ở ổ C (SSD) cho nhanh (rồi thích vứt sang ổ nào khác thì vứt)

### Blender
- CẤM render TOÀN BỘ VIDEO bằng Blender (Cycle, Eeve) vì quá nặng, dev làm thuần video bằng 3js với các model .glb tương ứng đã dc tải về. 
- Các trường hợp cần dùng Blender mà bắt-buộc/đáng để/phải sử dụng (ví dụ: Render cảnh ngắn kịch tính; custom file .blend & .glb; thumbnail videos;etc...) thì cứ thoải mái (nhớ báo trước cho dev)

## Verify/Review
- Làm xong bất kì điều gì, từ nhỏ (1 item/vật dụng nhỏ) hay to (1 scene to) hãy tự mình review lại thật KĨ, chứng kiến tận mắt ở từng góc cạnh, bao quát tất cả,etc...
- Khi chụp các frame để kiểm tra, hãy biết căn chụp thông minh hiệu quả để bắt được những khoảnh khắc dễ lỗi nhất. (0.16s - 0.25s / 1 frame) 4-6 fps với ảnh lưới
- Lệnh tự kiểm có sẵn (ảnh lưới, giật/khựng, lọt khung, lún vật, trượt chân, lỗi video): mục Verify trong AGENTS.md root monorepo. Ảnh nháp có dải đen dưới hình ghi giờ mm:ss.sss và shot.

### Human
- Khi sửa những chi tiết cụ thể -> nói thẳng thời gian `mm:ss` của những chi tiết đó kèm công cụ/tools/repo/etc... Dc sử dụng trong chỗ đó để dev vào check cho nhanh
- Dev chỉ check và feedback qua `live-studio` của phim (`bun run studio`, qua tailscale) (KHÔNG check qua render), làm đến phần nào thì báo dev vào kiểm tra đến đó (vẫn tiếp tục công việc hiện tại)

## Voice
- Dùng `ElevenLabs` v4 qua `genvoice.pro`. Trong monorepo: `scripts/voice/gen.py` (mặc định Seff Echo). API/tham số/endpoint/etc... research nếu cần

### Audio Tags (research nếu cần)
- Không giới hạn danh sách cố định (*"There is no definitive ElevenLabs Audio Tags list"*): được tự chế vô hạn bằng ngôn ngữ tự nhiên trong ngoặc vuông `[...]`, ví dụ `[out of breath after running up the stairs]`, `[nervous, trying to sound confident]`.
- English Audio Tags only

### Giọng kể Ngôi thứ 3 (Fern / Atrium / Blackfiles)
- Hạng 1 (`Seff Echo - Cinematic Storyteller` — ID: `ZaZosYpkIGmSqOwAlfnk`): Giọng dẫn chính ưu tiên số 1 (lai `Blackfiles × Atrium`). Phân khúc `PVC` (`professional` người thật thu phòng thu, `~2.5k` lượt dùng cực ít đụng hàng), giọng nam Mỹ trẻ `en-US`, `rate=1`, `notice_period=730` ngày, tắt kiểm duyệt ngầm (`live_moderation_enabled=null`), nhịp gốc chuẩn ngay trên `eleven_v4`.
- Hạng 2 (`Jake – Deep, Smooth, Dramatic` — ID: `ev2kMR9ZJZZsemuogS5u`):
- Hạng 3 (`True - Crime & Horror Narrator` — ID: `tZssYepgGaQmegsMEXjK`):

## SFX
- Freesound CC0 1.0: trong monorepo dùng `scripts/sound/get_sfx.py find "từ khoá"` (không cần API key, tự kiểm CC0).
- Nguồn khác khi Freesound thiếu: Mixkit Free Sound Effects, Sonniss GDC Game Audio Archive (đọc giấy phép từng gói).

## Image
Dùng `codex` CLI để tạo ảnh nếu cần

# Inspired:
- Fern: https://www.youtube.com/@fern-tv
- Atrium: https://www.youtube.com/@AtriumExplores
- Primal Space: https://www.youtube.com/@primalspace
