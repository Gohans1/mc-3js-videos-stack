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

## Lookdev, Lighting, Sky, Surfaces & Post (Canonical Stack)

Khi dựng phim trong monorepo này, **KHÔNG copy boilerplate `scene.ts`/lighting/composer cũ từ `films/*`** và không tự viết tay `WebGLRenderer`, `EffectComposer`, `N8AOPostPass`, bầu trời hay mặt nước khi đã có sẵn trong `src/lookdev.ts` và `film-stage/*`:

- **`src/lookdev.ts` (`setupLookdev`)**: Hub duy nhất của mỗi phim mới — nối sẵn renderer (`THREE.PCFShadowMap`, `localClippingEnabled: true`, linear HDR), IBL, `LightingRig`, và `EffectComposer` + re-export toàn bộ builder & preset catalog bên dưới.
- **`film-stage/post` & `film-stage/post-meta`**: `createFilmRenderer`, `createPostPipeline` (12 `LOOKDEV_PROFILES` như `explainer-clean`, `cinematic`, `outdoor-natural`, `neon-night`, `xray-cutaway`, `horror-dark`...; chuỗi chuẩn linear HDR -> `ToneMappingEffect` -> `HueSaturationEffect` -> gated TPDF dither; persp/ortho N8AO + `opts.afterToneMap`), `createScreenEffect` (4 `SCREEN_EFFECT_PRESETS`: `cctv`, `vhs-crt`, `night-vision`, `thermal`).
- **`film-stage/lights` & `film-stage/lights-meta`**: 26 `LIGHT_PRESETS`, `key.shadowExtent`, single-set timeline (`lights.json` + `createLightingRig` + `lightsAt`) hoặc multi-set bằng code (`applySetLight` dùng chung 1 `LightingRig`), IBL/probe (`createEnvironment` với 13 `ENVIRONMENT_PRESETS` + `"room"`, `createSkyEnvironment`, `bakeSceneProbe`, `loadHDREnvironment`, `createAreaLight`, `kelvinToHex`, `KELVIN_CHIPS`).
- **`film-stage/sky`, `film-stage/surfaces`, `film-stage/particles`, `film-stage/highlight`**: `createSkyDome` (12 `SKY_PRESETS`), `createStudioBackdrop` (8 `BACKDROP_PRESETS`), `createCloudLayer`, `createStarfield`, `createCelestialDisc`; `createWaterSurface` (8 `WATER_PRESETS`), `createWetGround`, `createHazeLayer`, `createPhysicalMaterial` (29 `MATERIAL_PRESETS`), `createXRayMaterial` (5 `XRAY_PRESETS`), `createVolumetricBeam`, `createCausticsPlane`, `createFlame` (6 `FLAME_PRESETS`); `createParticleField` (8 `PARTICLE_PRESETS`), `createParticleEmitter` (7 `EMITTER_PRESETS`); `createHighlight` & `createOutlineHighlight` (`mode: "outline" | "rim"`, an toàn cho `SkinnedMesh`).
- **`mc-assets/environment`**: Trời, nước, mây Minecraft lấy thẳng từ jar vanilla, cấm tự bịa: `biomeEnvironment` (màu trời, sương, nước, cỏ theo biome; mưa/tuyết mới là cờ dữ liệu), `dayTimeline` (màu và góc mặt trời theo giờ game), `createMinecraftWater` / `createMinecraftLava` (frame theo .mcmeta), `createMinecraftClouds` (mây fancy 12x4x12, trôi về phía tây).
- **`mc-assets/sky`**: Bầu trời và sương mù vanilla cho pipeline của phim, cấm tự vẽ dome: `createMinecraftSky` (đĩa trời, ráng chiều, mặt trời, trăng theo pha, 780 ngôi sao, mưa và bão làm xám, End và Nether), `useVanillaFog` (sương mù như game), `sky.light` và `lightmap` (ánh sáng ngày, đêm, mưa của game cho block; cấm tự đoán cường độ đèn). Lặn nước/lava/tuyết bột: `sky.set({ submerged })`; sét chớp: `sky.set({ flash: true })`.
- **`mc-assets/particles`**: Hạt (particle) vanilla lấy số từ jar 26.3, cấm tự chế khói, bụi, tia lửa: `createMinecraftParticles` với event có sẵn (`blockBreak`, `blockCrack`, `mobDeath`, `explosion` cho TNT/creeper, `firework`, `rocket`, `torch`, `campfire`, `lavaPool`, `hearts`, `villager`, `crit`, `damage`, `totem`, `waterSplash`), `add` cho 44 loại hạt, `emitter` cho hiệu ứng tự sáng tạo; tua tới tua lui vẫn ra đúng hạt, đêm thì truyền `light: sky.light` để hạt tối theo.
- **`mc-assets/weather`**: Mưa và tuyết vanilla lấy số từ jar 26.3, cấm tự vẽ vệt mưa: `createMinecraftWeather` với `height` của mặt đất và `sky`, mưa to nhỏ theo `sky.set({ rain })`, `splashes` cho giọt nước bắn trên đất quanh camera; biome lạnh hay núi cao tự ra tuyết.
- **`mc-assets/screen-effects`**: Lớp phủ màn hình góc nhìn thứ nhất của game: dưới nước (underwater.png trượt theo hướng nhìn), đang cháy hoặc trong lava (2 ngọn lửa); gắn `group` vào camera, mỗi frame `update(t, camera, { underwater, onFire, inLava })`; lặn thì nhân fov camera với `FLUID_FOV_SCALE`.
- **Guardrails tự động (`bun run check`)**: Tự cảnh báo `PCFSoftShadowMap` lỗi thời, `shadow.radius > 4`, rò rỉ `PMREMGenerator`, tạo `new THREE.Fog` mỗi frame, `#include <tonemapping_fragment>` / `#include <colorspace_fragment>` trong custom shader nằm trong `EffectComposer`, `lights.json` chưa nối, và composer tự chế.

## Voice

- **Google AI Studio TTS (`gemini-3.8-flash-tts`)**: Dùng qua skill [aistudio-tts](../aistudio-tts/SKILL.md). Đọc ngay [voice-casting-and-direction.md](../aistudio-tts/references/voice-casting-and-direction.md) để tra list giọng đã test thực tế (`Koda`, `Cruz`, `Enzo`, `Rami`, `Ludo` + bẫy nhãn giới tính `Sami`/`Olin`), cách viết `style`, `<vocal tags>`, `|backchannel|`, `/IPA/` và các bài học sync/QA.
- **ElevenLabs v4 (qua `genvoice.pro`)**: API/tham số/endpoint/etc... research nếu cần (`bun run skills get core --ref voice`).
  - **Audio Tags (`[...]`)**: Không giới hạn danh sách cố định ("There is no definitive ElevenLabs Audio Tags list"): tự chế bằng ngôn ngữ tự nhiên trong ngoặc vuông `[...]`, ví dụ `[out of breath after running up the stairs]`, `[nervous, trying to sound confident]` (English Audio Tags only). Khác với Gemini 3.8 tách riêng `style` + `<...>` vocal tags.

## Image

Dùng `codex` CLI để tạo ảnh nếu cần
