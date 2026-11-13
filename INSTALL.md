# Cài đặt

## Công cụ và Tài nguyên

| Mục                        | Nội dung                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Công cụ gốc                | Cài Bun, Node 22, Python 3, FFmpeg kèm ffprobe, curl rồi chạy bun install tại thư mục gốc trên Windows. Python của phim ưu tiên .venv trong thư mục phim, dò nhịp cần uv pip install -r scripts/sound/requirements.txt, còn đổi tốc độ hoặc cao độ cần Rubber Band CLI. |
| Kho tài nguyên             | Chạy bun run setup:vault để tải tài nguyên nhẹ theo scripts/vault-assets.json và scripts/sfx-catalogue.json có kiểm mã băm và định dạng WAV. Tài nguyên nặng nằm tại externalRoot của vault.json, mặc định E:/mc_vault hoặc đổi qua MC_VAULT_EXTERNAL.                  |
| Kho âm thanh và tham chiếu | Chạy bun run setup:sound để dựng kho tệp WAV chuẩn vào vault/sound/bgm và vault/sound/sfx kèm vault/sound/SOURCES.json. Bộ ảnh đối chiếu giao diện CapCut 9.7 và danh mục nằm gọn tại vault/references/capcut/manifest.json.                                            |
| Kho âm thanh Minecraft     | Chạy bun run setup:mc-sound để dựng externalRoot/mc-sound từ Minecraft gốc và các pack trong scripts/mc-sound-packs.json, có kiểm SHA1 và PEAKS.json. setup:vault tự gọi bước này khi externalRoot đã có.                                                               |
| Nối vào phim               | Chạy bun run link để nối vault vào mọi phim và dựng picked.zip, hoặc bun run link ten-phim cho một phim. Trình duyệt xuất hình lấy từ khóa live-studio.chrome trong package.json của phim.                                                                              |

## Bản quyền và Lời dẫn

| Mục       | Nội dung                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bản quyền | Thư mục vault bị Git bỏ qua nên tài sản của Mojang, Mixamo và Mixkit không đi kèm mã nguồn. Giấy phép rig ghi tại packages/mc-actor/assets/CREDITS_CC_BY.txt, còn nguồn WAV ghi tại vault/sound/SOURCES.json và sound/sfx/SOURCES.json.                       |
| Lời dẫn   | Sinh take vào voice/takes và bản thử voice/try bằng scripts/voice/gen.ts, ghép full_voice.wav kèm Phrase Bricks bằng scripts/voice/assemble.ts, và lấy mốc từ bằng scripts/voice/cues.ts. Tệp chưa căn từ dùng scripts/voice/words.py, mix.py chỉ cần ffmpeg. |
