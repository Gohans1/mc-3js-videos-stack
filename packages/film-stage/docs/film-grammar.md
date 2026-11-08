# Ngữ pháp dựng phim (dùng chung mọi phim)

Mỗi cú cắt, chuyển động, âm thanh phải trả lời được: khán giả cần cảm thấy gì, biết thêm gì. Không trả lời được thì bỏ.

## Thứ tự ưu tiên khi cắt (Walter Murch, In the Blink of an Eye)
- Cảm xúc > câu chuyện > nhịp > hướng mắt > hướng màn hình > không gian 3D. Sai không gian khán giả tha, sai cảm xúc thì không.
- Mỗi shot mới phải đưa thông tin mới (Grammar of the Edit). Không có gì mới thì đừng cắt sang.

## Các kiểu chuyển cảnh và ý nghĩa
- Cắt thẳng (hard cut): mặc định, nghĩa là "bây giờ, tiếp theo". 90% số cắt.
- Smash cut: từ ồn sang im hoặc ngược lại, để gây sốc. Ví dụ flash cut ở hook rồi cắt ngay ra màn đen im lặng.
- Match cut: hai shot giống hình hoặc giống chuyển động, nối hai ý hoặc hai thời điểm.
- J-cut / L-cut: âm thanh của cảnh sau vào trước hình, hoặc âm thanh cảnh trước kéo sang hình sau. Giúp cắt trơn, nên ưu tiên hơn dissolve.
- Dissolve (hòa hình): thời gian trôi hoặc ký ức. Dùng hiếm để giữ nghĩa.
- Fade đen: đóng hoặc mở một chương, không dùng làm keo nối giữa các shot.
- Độ dài fade: dip dưới 0.5 s là một nhịp ngắt, khoảng 1 s đóng một cảnh, 2-3 s đóng một chương, trên 3 s chỉ để kết phim. Hình fade thì tiếng cũng fade theo (Fade out của nhạc nền), hình tối dần mà tiếng cắt cụt là lỗi hay gặp.

## Nhịp (Fern-style 3D documentary, ReelPantry teardown 2026)
- Hook: shot 1.8-2.5 s. Thân bài: 3.5-5 s. Giữ lâu nhất khoảng 8 s cho shot đắt giá.
- Khoảng 46% shot đứng yên. Trước mỗi chương có 1-1.5 s nghỉ: không lời, chỉ nhạc hoặc nền.
- Hết một chuyển động lớn thì giữ thêm một nhịp cho khán giả kịp nhìn.

## Camera
- Mỗi shot một động từ: push-in, pull-back, pan, tilt, orbit. Ba động tác cùng lúc gây chóng mặt.
- Máy quay có quán tính: không bắt đầu hay dừng đột ngột. Không dùng linear cho cả chuyển động (trông như robot).
- Bay qua nhiều key: các đoạn giữa giữ tốc độ đều (`linear`), chỉ làm mượt đoạn đầu và đoạn cuối, nếu không sẽ thành nhiều cú dừng.
- Ease trong cam.json (camera.ts EASES): `out` khi đến nơi cần xem, `in` khi rời đi lấy đà vào cú cắt, `inout` cho chuyển động từ đứng yên đến đứng yên, `expo` cho cú lùi xa để lộ quy mô.
- Push-in chậm khoảng 2-3% khung hình mỗi giây. Camera không được đi trước hành động của nhân vật, phải trễ hơn một chút.
- Giữ năng lượng liền mạch giữa các shot: không cắt từ một cú lao nhanh sang shot đứng yên hẳn.
- Rung máy chỉ khi có va chạm, dưới khoảng 0.6 s, mạnh rồi tắt dần (camera.ts shakeAt).

## Zoom và tốc độ theo ý nghĩa
- Push-in chậm: nhân vật đang nhận ra điều gì đó, căng thẳng, tuyệt vọng. Càng chậm khán giả càng ít nhận ra mà vẫn thấy ngột.
- Lùi xa chậm (pull-back): cô lập, nhỏ bé, lộ quy mô. Dùng cho cảnh mở và cảnh kết.
- Punch-in nhanh (crash zoom): chỉ cho cú sốc, một lần mỗi đoạn, phải có tiếng hit đi kèm, đến nơi là dừng chết rồi giữ ít nhất 1 s. Lạm dụng thì thành hài.
- Shot càng ít thông tin càng ngắn (insert, cận cảnh 2-3 s); shot rộng nhiều chi tiết được giữ lâu hơn (4-6 s). Chữ để đọc giữ khoảng 0.5 s + số ký tự / 13.
- Lời dẫn dài hơn số shot thì thêm một shot mới để đỡ, đừng để shot cuối đứng im quá 8 s.
- Không để vật cản (lưng, tay, đồ vật) che chủ thể; không cho camera đi xuyên vật thể trừ khi đó là ý đồ.

## Âm thanh
- Lời dẫn là số một. Nhạc thấp hơn lời 10-14 dB. Không để nhạc to đều từ đầu đến cuối: tăng ở chỗ trống, lặng ở chỗ quan trọng.
- Nhạc là dấu câu, không phải giấy dán tường: tắt nhạc 0.3-0.5 s trước cú lộ diện, để tiếng động một mình, rồi mới cho nhạc quay lại.
- Mỗi 2-4 phút (mỗi chương) đổi nhạc hoặc đổi năng lượng để khán giả không quen tai.
- Luôn có lớp nền (room tone, tiếng ù) dưới mọi cảnh. Im lặng tuyệt đối chỉ dùng có chủ đích.
- Một nhịp im lặng ngay trước câu quan trọng nhất làm câu đó nặng hơn. Sau cú đánh lớn thì để im.
- Riser bắt đầu 3-4 s trước khoảnh khắc lớn. Tiếng hit hoặc whoosh đặt sớm hơn hình 1 frame (tai nghe nhanh hơn mắt).
- Tiếng va chạm nặng nên có 3 lớp: tiếng bụp đầu, thân, đuôi.
- Chữ nặng đi với tiếng hit nặng, chữ phụ đi với tiếng click nhẹ.
- Bản cuối: YouTube khoảng -14 LUFS, đỉnh không vượt -1 dBTP.

## Nguồn
- Murch rule of six: addaly.com/learn/video-editing/the-rule-of-six
- Grammar of the Edit (Bowen), các kiểu cắt: hsmuniversity.org FILM-220 lesson 3
- Camera có quán tính, mỗi shot một động từ: zuhuri.com/learn/stories/virtual-camera-moves, Blender camera mistakes (CG Boost)
- Bay camera đều ở giữa: vawe.dev/blog/easing
- Âm thanh: krotos.studio, pixflow.net/blog/sound-design-for-film, djordanmedia.com sound design
- Zoom nhanh/chậm: premiumbeat.com/blog/mastering-zoom-and-punch-in, dfirentals.com/news/what-is-a-crash-zoom, hookova.com/blog/crash-zoom
- Thời lượng giữ shot, push 1-4 s: faviovazquez.github.io/showtime/docs/motion-craft.html
- Nhạc làm dấu câu, im lặng trước cú lộ: transom.org, newdocediting, kenjosephmusic
- Độ dài fade, fade bằng keyframe opacity có ease: zooop.ai/glossary/editing/fade-to-black, filmit.io/blog/fade-to-black
