Làm phim: luật chung ở skill `gohans-3js-videos-skills` (`.claude/skills/`), file này là bản đồ công cụ của monorepo.

Trước khi bắt tay vào làm việc, hãy nên kiểm tra quanh monorepo để tìm kiếm resources có sẵn phù hợp với task hiện tại
Khi hoạt động trong folder nào thì bắt buộc phải đọc AGENTS.md/README.md của folder đó trước (nếu có)
# Monorepo

## Packages
Vì kho/templates/packages là của chung nên hãy cẩn trọng, chỉ ưu tiên động vào khi có lí do chính đáng (ví dụ: có thể dùng chung cho mọi project, templates/packages/etc... mới để sau này AI có nhiều lựa chọn, etc...), ưu tiên 80% videos trong tương lai sẽ cần
### Details
- `packages/`: các bộ template dùng chung cho tất cả project.
- `packages/clip-catalog`: Chứa toàn bộ Animation. Tìm/lọc số lượng lớn animation trong vault bằng Jev AI (System One AI Model) khi cần hoạt ảnh mới cho nhân vật
- `packages/mc-assets`: đạo cụ dùng chung (pack/, block `gohans:*`), màn hình máy tính có chữ (src/screen.ts), chữ in lên giấy (src/ink.ts), đổi kiểu đạo cụ trong studio (src/variants.ts), lấy block từ mod trong vault (pick.py + pack/picks.json của film).
- `packages/live-studio`: studio xem phim, ghi chú, render nháp và các lệnh tự kiểm tra. Luật cho film: docs/film-contract.md.
- `packages/mc-actor`: Mọi thứ về thể xác nhân vật Minecraft Steve
- `packages/film-kit`: chuyển động sinh học cho nhân vật (ngáp, thở dốc, thở dài, liếc mắt, giật mình, run tay, vật lý,etc...)
- `packages/film-stage`: Các góc quay Camera

## Films
Lấy form từ templates/film, có thể custom thoải mái
- `films/project-name`: tạo bằng `bun run new-film <tên>` ở root (copy template, nối studio và vault).

## Cần gì thì tìm ở đâu (đừng tự chế lại)
- Mob (bò, zombie, silverfish... 209 con): `mc-actor/src/mob.ts` loadMob(name). Cấm dựng mob từng khối.
- Đồ cầm trên tay, đặt xuống, ném: `mc-actor/src/carry.ts`.
- Động tác người: `python ../../packages/clip-catalog/catalog.py --jev "mô tả cảnh"`, thử clip bằng `lab/clip.ts` của film.
- Chuyển động sinh học (thở, chớp mắt, liếc, giật mình, run tay): bảng chọn module trong `packages/film-kit/AGENTS.md`.
- Easing, noise, random, spring: dùng `math/*` (pmndrs math, đã có trong template) trước khi tự viết.
- Camera: `film-stage/src/camera.ts` (key, ease, shakeAt). Nhịp cắt và cách máy chuyển động: `film-stage/docs/film-grammar.md`.
- Đèn chập chờn: `film-stage/src/flicker.ts`.
- Lồng tiếng: `scripts/voice/gen.py` (ElevenLabs qua GenVoice), rồi `words.py` (whisperX), rồi `assemble.py`.
- SFX CC0: `python ../../scripts/sound/get_sfx.py find "từ khoá"`. Mix: `scripts/sound/mix.py`.
- Ghi file src/timeline/*.json: `scripts/timeline_fmt.py`.

## Verify (làm xong phải tự kiểm, chạy trong folder film)
- Ảnh: `AT=1,4 bun run render stills`, ghép lưới bằng `python ../../scripts/review/sheet.py` rồi mở ra xem tận mắt. Dải đen dưới ảnh ghi giờ mm:ss.sss và shot đang chạy.
- Ảnh nháp (`bun run render stills`, `CHECK=...`) không ra video, chạy vài giây đến vài phút: cứ chạy thoải mái để tự soi. Render ra video (`bun run render clip`, final) tốn nhiều thời gian: chỉ chạy khi có lí do hoặc dev cho phép.
- Giật, khựng, dừng cái bụp: `CHECK=motion:<target>,<từ s>,<đến s> bun run render stills`. Target: cam, tên xương, handR/handL, nhãn vật.
- Lọt khung, bị che, quá tối: `CHECK=seen:<target>,<từ>,<đến>`.
- Lún vào vật, lơ lửng sát vật: `CHECK=touch:<target>,<từ>,<đến>`. Chỉ dùng cho cảnh đang nghi, quét cả phim sẽ ra nhiều vết lún chân nhỏ.
- Chân trượt trên sàn: `CHECK=slide:<từ>,<đến>`.
- Video đã render: `bun run framecheck` (màn đen, chớp, nhảy hình, nhấp nháy, đứng hình).
- Mỗi lệnh in số và ghi ảnh vào renders/, mở ảnh ra xem trước khi báo xong.
