# Nghiên cứu tính năng camera cho Studio 3D và đối chiếu chuyên gia

Tài liệu tổng hợp qua ba vòng đối chiếu từ code dự án hiện tại, năm repo trong editor-refs và hơn ba mươi công cụ quay dựng đầu ngành để lập bản đồ kiểm soát camera toàn diện. Mọi đánh giá bám sát ba ràng buộc cốt lõi là máy tính PC 1920x1080, người dựng nắm toàn quyền camera khi làm việc cùng AI qua tệp JSON phẳng, và hàm vẽ thuần theo thời gian t cho render chia khúc.

## Đã có trên UI hoặc tab khác

| Hạng mục | Vị trí hiện tại | Ghi chú |
| --- | --- | --- |
| Shot và Keyframe cơ bản | CamPanel.tsx | Đổi tên shot, tách hoặc gộp cut, dời thời gian keyframe, kéo thanh FOV 1 độ, Roll, Sway, Hold 1s, bước nhảy KeyNav và chép góc Free Cam. |
| Easing theo nhịp | SpeedPanel.tsx và EasePicker.tsx | Chọn 22 đường cong định sẵn và khung kéo cubic-bezier cho từng đoạn vào keyframe, hiện bị thu gọn mặc định trong CamPanel. |
| Chuyển động và chuyển cảnh | AnimPanel.tsx, TransitionPanel.tsx, animate.ts | Bộ hiệu ứng In, Out, Combo như Push, Crane, Orbit, Whip, Vertigo, Shake cùng Transition kéo thả vào ranh giới cut trên shot. |
| Hậu kỳ màu và dao động ký | AdjustPanel.tsx, Oscilloscope.tsx, Settings.tsx | Tab Adjustment chứa Fisheye, Fringe, Halation, Vignette, Particles, Soften, LUT còn Oscilloscope đo RGB Parade, Waveform, Vectorscope dưới khung hình. |
| Timeline Camera và Speed | CameraTrack.tsx, camrow.ts, FilmSpeedPanel.tsx | Kéo thả keyframe, roll cut, chọn khối, copy/paste kèm fstop/focus/handheld, hít vào playhead/beats/từ thoại, menu chuột phải trên shot block và J/K/L shuttle. |
| Free Camera, PiP và Guides | freecam.ts, pointer.ts, FilmView.tsx, Guides.tsx | Bay WASD và Space/Shift/Q/E, Shift kéo xoay quanh điểm nhìn, cuộn chuột tiến lùi, phím bằng/trừ đổi FOV, PiP góc dưới, lưới 1/3, dấu cộng tâm, khung SMPTE 93/90 và mặt nạ 9:16. |
| HUD thông số và so sánh ảnh | hud.ts, Compare.tsx, still.ts, nightvision.ts | Thanh HUD dưới khung hiện số Shot, mm, fstop, điểm focus, handheld, look, impulse cùng nút soi ảnh gốc bằng phím gạch chéo ngược, xuất PNG/JPEG và Night Vision. |
| Bảo vệ sửa tay và QA CLI | edit-protection.mjs, motion.mjs, seen.mjs, page.ts | Tự giữ vùng người dùng sửa tay khi AI ghi đè JSON nếu có khóa hợp lệ, render sub-frame kẹp ranh cut 180 độ và CLI kiểm tra quy tắc 7 giây, che khuất, tối hay mờ trên 2px. |

## Đang chạy ngầm trong Engine hoặc bị lỗi

| Vấn đề phát hiện | Vị trí trong code | Ảnh hưởng thực tế |
| --- | --- | --- |
| Tiêu cự, Prime và cỡ cảnh bị giấu | film-kit/lens.ts và CamPanel.tsx | Engine đã có PRIME LENSES 14-135mm, shotSize ECU-EWS, frameSubject kèm headroom/thirdX và dollyZoom, nhưng UI chỉ phơi mỗi FOV nguyên và tự xóa mm khi kéo thanh hay gọi saveView. |
| Khẩu độ, lấy nét và rung handheld | lens.ts, camera.ts, handheld.ts | Engine nội suy nghịch đảo 1/fstop, rack focus theo mét hoặc mục tiêu và chạy chín track Camera Shakify CC0 nhưng hoàn toàn vắng bóng trên CamPanel. |
| Lỗi dữ liệu Point neo và splitShot | cam.ts, camera.ts | Type cam.ts cho phép p/l là object neo đối tượng, nhưng cameraAt spread mảng trực tiếp gây crash, còn saveView và splitShot ép tọa độ neo thành điểm cứng làm đứt bám mục tiêu. |
| Lỗi nhân đôi Anim, insertKey và tail | cam.ts, scene.ts | Khi tắt Free Cam, drawnView chụp luôn độ lệch AnimPanel ghi ngược vào cam.json khiến frame sau bị nhân đôi, insertKey không nội suy kênh khi chèn và TAIL 1ms nhỏ hơn SAME nên keyAt hay bỏ sót key cuối shot. |
| Lỗi bước đi bob và công thức Spline | film-stage/camera.ts | Công thức bob nhân t với speed khiến bước chân đi giật lùi lúc camera chậm dần cuối đoạn, còn chuyển sang getPointAt không kèm bảng tra độ dài cung LUT sẽ lệch mốc thời gian các key. |
| Thiếu đồng bộ trường ở Hold, Reset, Paste | cam.ts, FilmSpeedPanel.tsx | Hold 1s chèn trùng điểm làm vồng Catmull-Rom, Paste thiếu bob, holds thiếu roll/wave/bob, resetLens sót fstop/focus/handheld/bob và FilmSpeedPanel che mất CameraEasePanel khi bật timing. |
| Đóng băng đồng hồ camera khi Freeze | timing-state.mjs, scene.ts, camera-speed.mjs | Khi bật freeze hoặc tua chậm trong timing, chữ và lớp adjustment có đồng hồ riêng nhưng camera bị khóa đứng theo giờ cảnh vật nên không thể xoay vòng quanh nhân vật đóng băng. |
| Free Cam tắt sạch quang học và mù sương tuyến tính | scene.ts, transitions.ts, nightvision.ts, campath.ts | Bật Free Cam làm mất roll, DOF, focus, adjust, look, fade, transition và xóa telemetry HUD, nightvision bỏ sót sương THREE.Fog tuyến tính, còn nón campath khóa cứng 0.7 mét và bỏ qua AnimPanel. |
| Lỗi merge mảng và điều khiển UI lẻ | merge-edits.mjs, Slider.tsx, Speed.tsx, camrow.ts | Tệp cam.json và shots.json thiếu id cố định khiến merge-edits coi cả mảng là một khối, Slider thiếu Shift kéo mịn như NumberField, Speed thiếu mức 0.25x và camrow thiếu menu từng viên kim cương hay hít vào ranh shot. |
| Motion blur cứng pha, far 100m và lệch dải FOV | page.ts, scene.ts, freecam.ts, animate.ts | Render motion blur khóa pha tiến 0.5 frame dồn mẫu trượt cut về t mà không có xem thử trong Studio, scene.ts khóa cứng far 100m dễ cắt cảnh rộng và ba nơi chặn dải FOV khác nhau. |

## Đáng làm theo mức ưu tiên

| Ưu tiên | Tính năng và nguồn tham chiếu | Lý do đáng làm cho project |
| --- | --- | --- |
| P0 | Gắn id bền vững cho từng key/shot và hòa giải Human/AI | Cho phép merge-edits.mjs bảo vệ chuẩn xác từng keyframe hay shot do người dùng sửa mà không khóa nhầm hay ghi đè các đoạn khác của AI trong cùng tệp JSON. |
| P0 | Vá dứt điểm drawnView, insertKey, bob, saveView, splitShot và pasteAttrs | Tách delta AnimPanel trước khi lưu góc máy, nội suy đủ kênh khi chèn key, tính bob theo quãng đường tích phân, giữ nguyên neo đối tượng khi cắt shot và tách nhóm Copy Framing, Lens, DOF, Shake. |
| P0 | Phơi đủ tham số Engine trong CamPanel kèm mục đích AI và đổi mm/độ | Mở khóa mm, Prime 14-135, fstop, focus, handheld, bob, Roll 180 độ, tọa độ p/l, giá trị kế thừa, cho gõ trực tiếp mm vào ô FOV với bước 0.1 độ và hiện dòng lý do AI chọn góc máy. |
| P0 | Bấm chọn điểm ngắm, ống hút nét và neo Head/Body/Root kèm View Offset | Dùng raycast look.ts để bấm một chạm đặt hướng nhìn hay điểm nét, đồng thời cho neo p/l theo đầu/thân/gốc với độ lệch không gian nhìn giúp quay qua vai không rung theo cái lắc đầu. |
| P0 | Đường bay Smooth/Linear/Hold/Orbit, chống cong ngược và LUT cung getPointAt | Áp quy tắc triệt tiếp tuyến dây cung của effectcraft chống vồng boomerang cạnh Hold, tránh xoay cắt qua người và dựng bảng tra độ dài cung giữ tốc độ đều chuẩn mốc thời gian. |
| P0 | Tách đồng hồ camera độc lập khi Freeze-frame hoặc Speed-ramp | Cho phép shot chọn chạy camera theo giờ xuất thay vì giờ thế giới như Flashback Mod để quay hiệu ứng đóng băng thời gian quay vòng quanh nhân vật trong hợp đồng thuần t. |
| P0 | Gizmo 3D p/l, hạt từng frame, tia p-l, path thực AnimPanel và né tường BVH | Cho kéo thả chấm 3D, vẽ hạt bước từng frame như objects/path.ts, hiện vùng nét, dùng contact.mjs gap tô đỏ khúc đâm xuyên tường kèm nút đẩy né 1 chạm. |
| P0 | Free Cam WYSIWYG, Lock View, Orbit Pivot Raycast, Walk 1.62m và Axis Cube | Cho phép Free Cam xem thử DOF/Look/Roll/Transition, nhớ lịch sử góc bằng ngoặc vuông, Alt+Click chọn tâm xoay bề mặt, đi bộ tầm mắt 1.62m theo BVH và bấm Axis Cube xem Top/Front/Side. |
| P0 | Khóa keyframe tránh sửa nhầm, nắn trục máy Truck/Pedestal/Dolly và Swap Lens | Thêm nút bảo vệ key đã duyệt, dịch chuyển dọc trục ống kính tại chỗ trong Film View, giữ nguyên cỡ người khi đổi tiêu cự Swap Lens và Copy Relative chép chuyển động tương đối sang cảnh khác. |
| P0 | Menu chuột phải từng keyframe, phím tắt F9 Easy Ease và mở rộng Snap camrow | Bổ sung menu ngữ cảnh trên từng viên kim cương, phím F9/Shift+F9 gắn nhanh easing, hít nam châm đủ ranh SHOTS, inOut, notes, nhảy key bằng ngoặc vuông và cảnh báo cut đè giữa từ thoại. |
| P0 | Phóng to thu nhỏ 2D khung Preview, giảm phân giải Play và nâng cấp Slider | Zoom 10-1600 phần trăm bằng pixels sắc nét gần nhất và kéo chuột giữa soi mắt f/1.4 không chạm FOV, tự hạ phân giải lúc phát, lật gương ngang, Slider Shift kéo mịn và Alt mũi tên dời key từng frame. |
| P1 | Mở mặc định Easing, sửa tab Speed khi timing, tách kênh và Graph Editor đầy đủ | Hiện sẵn bảng đường cong không bị timing che, tự chuyển Speed/Value Graph theo kênh, vẽ bóng mờ Buffer Ghost, hộp Transform Box, Breakdown, Time-Reverse, Equalize và bàn chải Falloff SFM. |
| P1 | Neo Frame Offset trên màn hình, Lookahead thuần t, Fit Box và Vertigo một chạm | Dịch bố cục 1/3 kiểu Recomposer sau LookAt, ngắm đón đầu t+dt, nút chọn cỡ cảnh WS-ECU / Group Fit Box3 từ lens.ts, tạo cặp dolly zoom một chạm và xoay tròn theo hàm arc.ts. |
| P1 | Chế độ 1-Node tại chỗ, Auto-Orient, Auto-Banking và Up-Vector chống lật cực | Quay đầu máy tại chỗ giữ nguyên góc khi chuyển đổi với 2-Node, tự hướng tiếp tuyến, nghiêng cánh theo khúc cua và cung cấp Up-Vector tránh xoay 180 độ khi máy bay thẳng qua đỉnh đầu. |
| P1 | Lớp kiểm tra quang học Viewport (Focus Peaking, Zebras, False Color) và Debug 3D | Tô viền nét Focus Peaking, sọc cháy sáng Zebra, bản đồ IRE False Color cùng chế độ nhìn Clay Lighting-Only, Wireframe, X-Ray giúp đạo diễn soi nét và ánh sáng trực tiếp trên màn 1080p. |
| P1 | Chia đôi 50/50 Viewport, lưới so góc 2x2 và bảng Shotlist tương tác | Bật màn hình đôi một bên nắn đường 3D một bên xem ảnh 1080p sắc nét, ghim 2-4 góc 2x2 để cân nhắc và tổng hợp thông số tiêu cự, tốc độ lia, cỡ cảnh của toàn bộ shot. |
| P1 | Mở HUD cân bằng, Near-Far/Hyperfocal và cảnh báo 7s, 30 độ, 180 độ | Nâng cấp hud.ts hiển thị vùng nét Near-Far, thước cân bằng chân trời, tốc độ lia quy tắc 7 giây từ motion.mjs, cảnh báo lỗi cắt nhảy 30 độ hay lộn trục 180 độ và hiện nút Copy INSPECT. |
| P1 | Chỉnh Shutter Angle/Phase/Timing, kẹp cắt đều và DOF đa mẫu chống lem viền | Mở góc màn trập 0-360 độ, chỉnh kẹp ranh cut không dồn mẫu ở page.ts, hỗ trợ xem thử motion blur 4 mẫu khi tạm dừng và mang bài rung khẩu độ đa mẫu từ skill cinetic vào render xuất cuối. |
| P1 | Lens Shift X/Y, khóa trục FOV Ngang/Dọc, Near/Far từng shot và ẩn nhóm mái nhà | Dùng setViewOffset giữ thẳng cột kiến trúc, giữ góc ngang khi đổi 16:9 sang 9:16, cho phép nâng far vượt 100m, và thêm trường ẩn nhóm mái trên shots.json thay vì tự code cứng trong scene.ts. |
| P1 | Bộ lưới đa khung đồng thời, Passepartout, Safe EBU R95, thước kéo và Onion-Skin | Cho thấy khung 9:16 trong 16:9, vòng 35/50/85mm lồng nhau, làm mờ viền ngoài Passepartout, nối film-kit/safe.ts 3.5/5%, tỷ lệ vàng, Clean Feed và hòa trộn độ mờ trước/sau trong Compare.tsx. |
| P1 | Đánh dấu beat tạo hits/FOV pulse, hoàn chỉnh AnimPanel, Mute, Simplify và Recipes | Chuyển đỉnh beat/SFX thành hits có độ trễ đón nhịp -45ms trên shots.json, mở CurveEditor, độ trễ và lực âm ở AnimPanel, thêm keyframe Mute/nhãn màu, rút gọn key, Rig Rail u(t), ngoại suy và Camera Recipe. |
| P2 | Tay nắm Bezier 3D, vẽ path Trước Đỏ Sau Xanh, sửa PicksSection và Take A/B | Hiện vùng đường bay quanh playhead, kéo tiếp tuyến trên 3D, chỉnh chung FOV/fstop hàng loạt, chiếu song song Orthographic, nhiễu DeSync/Octaves, Minimap radar góc trên, 0.25x Slow-Mo và bộ chọn cam.json Take A/B. |

## Để sau hoặc tùy nhu cầu

| Tính năng | Nguồn tham chiếu | Lý do để sau |
| --- | --- | --- |
| Bộ điều biến F-Curve Stepped, Cycles và Highlight Boost | Blender và Effectcraft | Hiệu ứng giật 12fps hay tăng sáng bokeh đa giác/Anamorphic cần tự viết shader hậu kỳ DOF riêng nên để sau khi xong UI lấy nét chuẩn. |
| Chọn kích cỡ cảm biến Filmback khác 36mm và khóa dải Prime | Unreal và Cine Tracer | Chuẩn 36mm thống nhất giúp người và AI đỡ rối quy đổi tiêu cự khi dựng hàng ngày. |
| Lens Breathing, Shutter Bias và Focus Tracking Lag thuần t | Unreal và Nuke | Tinh chỉnh vi mô sau cùng vì hệ chuyển nét giữa hai key hiện tại kết hợp đường cong đã giải quyết phần lớn nhu cầu. |
| Vùng render khoanh hộp ROI và Pixel Inspector dưới trỏ chuột | Houdini, UE5, OpenFilm | Chế độ giảm phân giải khi Play và Oscilloscope kèm Focus Peaking đã đáp ứng tốt tốc độ lẫn kiểm tra pixel. |
| Tách toàn bộ X Y Z độc lập và ghi bay tay vào keyframe | After Effects và BBS | Tách X/Y/Z phá đường cong không gian mượt sẵn có còn quay chuột trực tiếp cần đồng bộ tiếng và bộ lọc rung phức tạp. |
| Stencil ảnh Storyboard nền và xuất .py sang Blender | Maya và Effectcraft | Ít cấp thiết hơn vì AI đã dựng thẳng bản nháp không gian 3D trong Studio và xuất cuối bằng mediabunny. |
| Bảng màu icon thân máy/lá khẩu và tay cầm Gamepad scouting | OpenFilm và Cine Tracer | Trang trí chọn preset trực quan hoặc điều khiển bằng tay cầm rất hay nhưng đứng sau hiệu suất chuột phím PC. |

## Không nên cài và lý do loại bỏ

| Tính năng bị loại | Nguồn gốc | Lý do không nên cài vào project |
| --- | --- | --- |
| Damping lò xo, Dead Zone, Priority Blend nhớ frame trước | Cinemachine, UE5, Godot Phantom | Vi phạm trực tiếp hợp đồng draw(t) thuần theo thời gian, gây lệch hình khi render chia khúc và trượt kiểm tra CHECK=order. |
| Tự đẩy camera né tường lúc chạy runtime và Auto-Exposure | Game Deoccluder và Godot | Làm máy quay giật nhảy khó đoán và đổi sáng thất thường giữa các khúc render, thay bằng cảnh báo BVH lúc dựng và AdjustPanel. |
| Camera điều khiển bằng Audio-Bus/MIDI trực tiếp và RNG không seed | SFM và UE5 Visualizer | Phá hủy tính tất định từng khung hình khi tua ngược xuôi và chia worker render, mọi nhịp đánh phải nướng thành hits hoặc keyframes tĩnh. |
| Nhân đôi Exposure/ISO, ToneMap, Fringe, Halation, Vignette | SFM, Photographer, NLE 2D | Đã có chủ quyền rõ ràng tại AdjustPanel, grade.ts và edit.json light, nhân đôi sang CamPanel gây xung đột nguồn sự thật. |
| Optical Flow, Auto Reframe, Pixel Tracker, Matchmover, 2D Zoom | CapCut, Resolve, Nuke, Effectcraft | Các công cụ cắt cúp hay giải ngược 3D từ điểm ảnh phẳng 2D hoàn toàn thừa thãi khi Three.js sở hữu tọa độ không gian thật. |
| Biểu thức toán tự do dạng chuỗi JSON và Mạng xương Empty/Null | Aperture, C4D, Blender, UE5 Rail Actor | Tách sự thật ra khỏi tệp cam.json phẳng và đưa chuỗi chưa kiểm kiểu vào JSON làm hỏng xác thực schema lẫn khó cho AI cùng sửa. |
| Đổi sang góc Euler XYZ, lồng clip camera nhiều tầng và tham số Zoom phụ | 3D cổ điển, CapCut, Three.js zoom | Hệ p và l tránh kẹt trục Gimbal Lock tốt hơn Euler, lồng clip phá cấu trúc thời gian phẳng còn camera.zoom gây chồng chéo với mm/FOV. |
| Stereo hai mắt, 360 VR, AR, Timecode SMPTE Drop-Frame, NDI/OSC | Maya, ReplayMod, Mavis, Filmcraft | Dư thừa hoàn toàn cho quy trình một người dựng phim xuất video phẳng 1920x1080 hoặc 1080x1920 trên PC. |
| Velocity Buffer Motion Blur, TAA Warmup, Cull Mask và Xuất dư viền | Godot, UE5 MRQ, Maya Overscan | Motion blur tích lũy đa mẫu tại page.ts chuẩn xác qua độ trong suốt hơn velocity pass, còn render dư pixel ngoài viền lãng phí GPU vô ích. |

## Nguồn tham khảo

C:\Users\ADMIN\Desktop\editor-refs\effectcraft

C:\Users\ADMIN\Desktop\editor-refs\filmcraft

C:\Users\ADMIN\Desktop\editor-refs\opencut-classic

C:\Users\ADMIN\Desktop\editor-refs\openfilm

C:\Users\ADMIN\Desktop\editor-refs\theatre

https://www.capcut.com/tools/keyframe-animation

https://helpx.adobe.com/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/set-keyframes-to-snap.html

https://helpx.adobe.com/after-effects/desktop/work-with-layers/camera-layer/cameras-lights-points-interest.html

https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/animation-keyframes/keyframe-interpolation.html

https://ken-eizo.github.io/after-effects-internals-guide/animation-system/spatial-interpolation/

https://dev.epicgames.com/documentation/unreal-engine/cinematic-cameras-in-unreal-engine?lang=en-US

https://dev.epicgames.com/documentation/unreal-engine/cinematic-rendering-image-quality-settings-in-unreal-engine?lang=en-US

https://docs.blender.org/manual/en/latest/render/cameras.html

https://docs.blender.org/manual/en/latest/editors/3dview/navigate/camera_view.html

https://docs.blender.org/manual/en/latest/animation/motion_paths.html

https://extensions.blender.org/add-ons/add-camera-rigs/

https://help.maxon.net/c4d/en-us/Content/html/OCAMERA.html

https://help.maxon.net/c4d/en-us/Content/html/TMOTIONCAM.html

https://help.maxon.net/c4d/en-us/Content/html/TMORPHCAM-ID_TAGPROPERTIES.html

https://www.sidefx.com/docs/houdini/basics/view.html

https://help.autodesk.com/cloudhelp/2027/ENU/Maya-Basics/files/GUID-C092B9DA-C523-4566-9209-ACCBFAEE8285.htm

https://learn.foundry.com/nuke/current/content/reference_guide/3dnew_nodes/splatrender.html

https://cavalry.studio/docs/nodes/utilities/camera/

https://cavalry.studio/docs/user-interface/menus/window-menu/scene-window/graph-editor/

https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachinePositionComposer.html

https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineRecomposer.html

https://support.apple.com/guide/motion/framing-behavior-motn17c67514/mac

https://flashback-mod.com/camera-keyframes/

https://flashback-mod.com/track-entity-keyframe/

https://flashback-mod.com/timelapse-speed-freeze-keyframes/

https://www.replaymod.com/docs/

https://developer.valvesoftware.com/wiki/Source_Filmmaker

https://docs.godotengine.org/en/stable/classes/class_camera3d.html

https://github.com/yomotsu/camera-controls

https://www.theatrejs.com/docs/latest/manual/sequences

https://threejs.org/docs/pages/PerspectiveCamera.html

https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/DepthOfFieldEffect.js~DepthOfFieldEffect.html

## Tiến độ triển khai

| Đợt | Phạm vi | Trạng thái |
| --- | --- | --- |
| 1 | ID bền vững và hòa giải sửa tay cho keyframe và shot | Qua review và kiểm thử |
| 2 | Lấy mẫu camera, neo, tách shot, Hold, dán thuộc tính và spline | Qua review và kiểm thử |
| 3 | Đồng hồ camera khi Freeze và Speed | Qua review và kiểm thử |
| 4 | CamPanel, lấy nét, chỉnh bố cục và nắn góc | Chờ |
| 5 | Free Cam, đường bay 3D và kiểm tra xuyên tường | Chờ |
| 6 | Timeline, easing, Graph Editor và thao tác keyframe | Chờ |
| 7 | Preview, HUD, Guides, so góc và Shotlist | Chờ |
| 8 | Quang học khi xuất, hiệu ứng, recipe và Take | Chờ |

| Ghi chú đợt 1 | Chi tiết |
| --- | --- |
| Nhận dạng dòng cũ | Giữ ID theo mốc và lịch sử đã biết. Khi thiếu căn cứ tách khóa cũ, giữ bảo vệ toàn file và dùng collab để xác nhận thay đổi có chủ đích. |
| Trùng thời điểm | Giữ thứ tự key cạnh cut khi hòa giải, kể cả lúc khôi phục tail bị ghi đè. |
| Ghi có chủ đích | AI xác nhận riêng từng trường bằng collab. Dòng do người dựng tạo vẫn được giữ khi bản JSON cũ bỏ mất dòng. |

| Ghi chú đợt 2 | Chi tiết |
| --- | --- |
| Đường bay | Smooth dùng chiều dài cung theo từng đoạn. Hold giữ nguyên cho đến key kế tiếp, còn Orbit giữ hướng quanh điểm ngắm. |
| Lưu góc | Lấy mẫu trước AnimPanel và giữ đơn vị mm cùng neo có thể giải được. Dán thuộc tính chia Framing, Lens, DOF, Shake và Speed. |
| Studio | Kiểm tra Orbit, Hold 1s, Split, lưu Free Cam và nhóm Paste bằng Chrome 1920×1080 trên phim thử riêng. |
| Split đúng mốc | Dùng lại key hiện có làm tail. Khi gộp shot, Studio giữ ID gốc. |

| Ghi chú đợt 3 | Chi tiết |
| --- | --- |
| Đồng hồ camera | Shot có thể dùng giờ cảnh hoặc giờ xuất. Chế độ giờ xuất phân bố đường bay theo thời lượng nhìn thấy của shot. |
| Easing trong Studio | Camera vẫn có bảng easing khi timing hoặc Freeze đang bật. |
| Kiểm tra Chrome | Tại hai thời điểm trong Freeze, cảnh đều ở giây 1. Camera đổi vị trí x từ 2,7424 sang 2 khi bật giờ xuất. |
| Freeze đổi mốc | Camera giữ một đường thời gian liên tục qua đoạn giữ khung trong cùng shot. |
| Sửa cut | Split, Roll và Merge quy đổi mốc cut theo giờ cảnh, giữ vị trí hiển thị của các key xung quanh. |
| Keyframe trong Freeze | Camera tiếp tục hiện đồ thị và cho kéo key trên Freeze. Studio báo rõ khi mốc cắt không thể quy đổi về cùng khung. |
| Freeze ở shot khác | Key hiện tại các lần phát lại của cùng cảnh và chỉ có một dòng lưu. Kiểm tra thêm, kéo và xóa trực tiếp trong Chrome. |
| Biên Freeze | Key mới ở cuối Freeze thuộc khung đang chạy tiếp. Dán ở bản chiếu của key mở đầu giữ nguyên mốc gốc. |
| Hold trong Freeze | Khoảng giữ góc kết thúc trong cùng lần phát camera, kể cả khi không có key ở mép Freeze. |
