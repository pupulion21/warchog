# CHOG Clash: riset produksi arena fighting 3D

Tanggal: **23 Oktober 2026, WIB**. Status: riset dan rekomendasi implementasi; **belum ada generation model, rigging berbayar, animasi berbayar, atau perubahan game** dalam tugas ini.

Keputusan pengguna: **arena 3D dengan gerak bebas/mengitari musuh**, dimainkan di **browser desktop dan HP**. Fokus pertama direkomendasikan 1v1, sesuai produk sekarang. Ini memerlukan combat simulation 3D baru; mengganti sprite dengan GLB saja tidak cukup.

## 1. Kesimpulan yang menentukan produksi

1. Source Metropolis berisi **12 fighter**, dengan **13 tampilan/form** karena Mamio mempunyai base dan empowered. Form tambahan tidak otomatis membutuhkan skeleton atau model independen.
2. Mekanik sekarang bisa menjadi referensi: combo tiga pukulan, dua skill, ultimate, projectile, summon, counter, transformation, hitstop, knockback, ronde, training dan PvP. Perhitungan collision, arah, movement, kamera, dan input perlu dirancang ulang untuk arena 3D.
3. Rekomendasi stack: **Babylon.js + TypeScript untuk klien 3D**, **Node/Colyseus untuk authority online**, **Rapier WASM untuk collision/movement yang dipakai bersama di Node dan browser**, **Blender untuk finalisasi asset**, GLB untuk distribusi. Ini rekomendasi berdasarkan kebutuhan dan dokumentasi, **belum hasil benchmark**.
4. Meshy dapat membantu membuat mesh, rig humanoid dan sumber motion. Hasilnya belum layak disebut siap game sebelum lulus pemeriksaan deformasi, clip, prop, skala, export, gameplay, dan perangkat fisik.
5. Mulai dengan satu master rig yang diuji pada dua fighter dan satu arena, lalu uji kasus prop/transformasi. Seluruh roster baru diproduksi setelah alur ini terbukti. Urutan ini mencegah mengulang kesalahan yang sama pada 12 karakter.

Dokumen ini membedakan **teramati dari source**, **kemampuan yang didokumentasikan provider**, dan **usulan desain yang masih perlu prototype**. Tidak ada klaim bahwa semua risiko sudah dibuktikan selesai.

## 2. Bukti project yang diperiksa

Lokasi source: `/home/haikaru/Archverse/Lab/Hackathon/Metropolis/game/chog-clash`.
Workspace riset/output baru: `/home/haikaru/Archverse/Lab/Chogclash`.

| Bukti lokal | Temuan |
|---|---|
| [Indeks aktif Metropolis](../../Hackathon/Metropolis/docs/chog-clash/README.md) | Peta project dan konteks rilis; snapshot rilis 14 Oktober, bukan acceptance 3D |
| [Roster data](../../Hackathon/Metropolis/game/chog-clash/chog-roster.json), [identitas runtime](../../Hackathon/Metropolis/game/chog-clash/chog-roster.js) | 12 ID CHOG, source-kit mapping, empat nama kemampuan/form |
| [Combat bersama](../../Hackathon/Metropolis/game/chog-clash/online/core.mjs) | Simulasi tanpa DOM; input, state, damage, movement, hitstop, snapshot |
| [Kit combat](../../Hackathon/Metropolis/game/chog-clash/online/kit-combat.mjs), [kit individual](../../Hackathon/Metropolis/game/chog-clash/online/kits) | Projectile/summon/counter/transform dan angka move yang benar-benar digunakan |
| [Room server](../../Hackathon/Metropolis/game/chog-clash/server/room.mjs), [klien online](../../Hackathon/Metropolis/game/chog-clash/online/client.mjs) | Authority, prediksi/replay input lokal, reconnect, deduplikasi event |
| [Renderer lama](../../Hackathon/Metropolis/game/chog-clash/game.js) | Canvas 2D; logika presentasi offline dan adapter online |
| [Desain karakter](../../Hackathon/Metropolis/game/chog-clash/tools/chog-art.js), [efek](../../Hackathon/Metropolis/game/chog-clash/tools/chog-effects.js) | Prop CHOG dan interpretasi visual aktual, bukan hanya nama kit warisan |
| [Rebuild asset](../../Hackathon/Metropolis/game/chog-clash/ASSET_REBUILD.md), [provenance](../../Hackathon/Metropolis/game/chog-clash/assets/chog/source-provenance.json) | Referensi, alur asset 2D, batas atribusi |
| [Screenshot roster yang dilihat](../../Hackathon/Metropolis/game/chog-clash/validation/comic-game-roster.png) dan portrait empowered Mamio | Kepala besar, kaki/tangan pendek, aksesori; risiko rigging ditentukan dari gambar nyata |

Working tree source lama sudah memiliki banyak perubahan lokal. HEAD adalah commit upstream lama; **HEAD saja tidak mewakili build CHOG sekarang**. Penelitian ini membaca working tree dan menyimpan hash file penting di [snapshot bukti](evidence/project-baseline.json). Source lama tidak diedit.

### Baseline mekanik sekarang

- Authority server: 60 tick/detik; dua substep physics per tick (120 Hz); snapshot dipublikasikan setiap tiga tick (20 Hz).
- Actor: 200 HP; ronde regulasi 90 detik; posisi horizontal dan tinggi 2D; facing hanya `-1/+1`.
- Basic combo tiga langkah, dua skill dan ultimate per fighter. Trigger sebagian besar move berupa satu ambang waktu `duration × hitAt`, **bukan active window fighting game yang lengkap**.
- Hitstun saat ini 0,42 detik; beberapa hit menyebabkan hitstop 0,045/0,085 detik; setelah hurt selesai terdapat invulnerability 0,9 detik. Ini **angka legacy**, tidak langsung menjadi balance arena baru.
- State visual meliputi idle, walk, run, jump, doublejump, crouch, attack1–3, skill1–2, ultimate, hurt, down. Kode juga mengenal recover/invuln. Adanya nama field/state tidak membuktikan seluruh variasi reaksi telah diimplementasikan.
- Counter Toad bersifat khusus kit. Tidak ditemukan sistem universal block/parry/grab/air-combo/wall-splat sebagai fitur lengkap semua fighter.
- Source menyimpan 52 MP3, 13 atlas fighter, dan lima background arena 2D. Background bukan arena 3D yang bisa diputari.
- Identitas CHOG adalah lapisan presentasi atas kit warisan. Contoh `fenr/wolf` adalah Mamio empowered; itu **bukan instruksi membuat Mamio menjadi hewan berkaki empat**. `edda/tortoise` sekarang tampil sebagai spirit CHOG. Nama lama tidak boleh menjadi prompt asset secara otomatis.

Lihat [timing move](move_timing_baseline.csv) untuk angka hasil pemanggilan modul combat aktual, termasuk kedua form Mamio. Ultimate dan counter memiliki scheduler/aturan khusus; waktu trigger tabel tidak dianggap otomatis sebagai waktu damage.

## 3. Inventaris seluruh roster dan kebutuhan 3D

Semua menggunakan keluarga humanoid CHOG sebagai hipotesis awal. Skeleton bisa dibagikan jika proporsi dan deformasinya kompatibel; kesamaan nama tulang saja belum cukup. Ukuran gameplay/hurtbox harus dinyatakan terpisah dari besar kepala atau aksesori.

| Fighter / kit lama | Prop visual yang sudah ada | Pemetaan kemampuan yang perlu dipertahankan karakternya | Kasus sulit 3D |
|---|---|---|---|
| Yot / arco | Papan/sign | LINK CHAIN; PARTNER PING; COLLAB STOMP; PARTNER SQUAD | Pegangan papan, benturan papan, partner/drone yang tidak menutup pandangan |
| Mamio / fenr | Cape/scarf | SCARF CHAIN; RUSH STEP; GALE KICK; GOLDEN AWAKENING | Base/empowered, varian moveset, cloth sederhana, interrupt transform dan revert saat KO |
| Benja / solan | Megaphone, flag sebagai FX | RALLY CHAIN; RALLY FLAG; CROWD BREAK; FOUNDER RALLY | Leap/slam, shockwave radial, megaphone di tangan/mulut |
| Toad / edda | Staff | STAFF CHAIN; STONE SKIP; TOAD COUNTER; SPIRIT TREAD | Grip staff, skip/bounce projectile, jendela counter dan spirit terpisah |
| PingPingPingPing / naja | Whip/ribbon/patrol tape | RIBBON CHAIN; PATROL TAPE; SIREN SPIN; PING ALERT | Ribbon bersegmen, ground wave, spin 360°, telegraph sebelum eruption |
| Novee / cora | Code bugs | BUG CHAIN; CODE SHOT; DEBUG GUST; BUG SWARM | Spread projectile, swarm instancing, pembatasan target dan overdraw |
| Tonashiro / isolde | Controller dan drone | SIGNAL CHAIN; DRONE PING; DEBUG BREAK; DRONE DROP | Controller dua tangan/IK, drone flight, landing point dan dash hitbox |
| Bigchog / haldor | Keyboard | HEAVY CHAIN; REPLY SHOT; REPLY CLOUD; REPLY STORM | Keycap lob/gravity/splash, keyboard rigid, knockback berat |
| Rogue / zanni | Brush | BRUSH CHAIN; INK SHOT; BRUSH HOOK; INK FINALE | Returning projectile satu hit, pull/cross-up, brush tip dan ink decal |
| Tabsu / mira | Foam bonk | BONK CHAIN; BONK SHOT; BONK BURST; BONK BARRAGE | Bonk impact, burst telegraph, barrage dengan biaya partikel terbatas |
| Venty / nib | Flowers | FLOWER CHAIN; PETAL SHOT; QUICK STEP; FLOWER DELIVERY | Rushdown cepat, behind-target/cross-up, homing yang masih bisa dihindari |
| Cookie / rhea | Microphone | MIC CHAIN; SOUND SHOT; SOUND WELL; CROWD ORBIT | Well berdelay, orbit projectile dalam bidang arena, source suara spatial |

Nama di atas adalah kontrak presentasi saat ini, bukan lore resmi baru. `RUSH STEP` base Mamio di source ternyata melepaskan projectile; nama move tidak selalu menjelaskan mekaniknya. Adaptasi 3D perlu meninjau nama, gerak dan collision bersama-sama, tanpa menganggap label sebagai spesifikasi.

Demikian juga SOUND WELL Cookie saat ini berupa zona berfuse yang meledak sebagai AoE; nama kit lama “gravity well” bukan bukti adanya tarikan fisik. Pull baru untuk Cookie akan menjadi perubahan desain; pull yang sudah ditemukan pada kit adalah milik Rogue.

Daftar produksi per fighter/form tersedia di [roster_3d_inventory.csv](roster_3d_inventory.csv). Asset tambahan di luar tubuh: prop, projectile, summon/spirit, trail, decal, telegraph, ikon/portrait, audio dan metadata. Karena itu total pekerjaan jauh lebih besar dari “12 file model”.

## 4. Pilihan engine dan arsitektur yang direkomendasikan

| Opsi | Kesesuaian untuk project ini | Tradeoff |
|---|---|---|
| **Babylon.js + TypeScript** | Rekomendasi pertama: engine browser, GLB, skeletal blending, particles, tooling; dapat tetap memakai halaman web dan backend Node | Combat state machine, lock-on dan authority tetap harus ditulis; engine bukan sistem fighting siap pakai |
| Three.js + TypeScript | Layak bila kontrol renderer dan ukuran komponen menjadi prioritas; mendukung AnimationMixer, skinning, retarget dan loader kompresi | Lebih banyak sistem game/VFX/tooling dirakit sendiri |
| Godot Web | Editor game yang kuat dan ekspor browser tersedia | Web memakai Compatibility/WebGL2; migrasi logic JS dan integrasi web perlu pekerjaan tambahan |
| Unity Web | Layak secara teknis; dokumentasi Unity 6 kini menyebut dukungan beberapa browser mobile | Migrasi ke C#, ukuran/runtime dan bridge web perlu benchmark tersendiri; tidak dipilih sebagai default project browser JS ini |

Kemampuan Babylon didukung dokumentasi [alur animasi karakter](https://doc.babylonjs.com/features/featuresDeepDive/animation/animatedCharacter), [blending/additive/events](https://doc.babylonjs.com/features/featuresDeepDive/animation/advanced_animations), dan [particles](https://doc.babylonjs.com/features/featuresDeepDive/particles/). Alternatif Three didukung [animation system](https://threejs.org/manual/pages/animation-system.html), [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils), dan [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader). Batas Godot ada di [Web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html); dukungan Unity perlu merujuk [manual Unity 6](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-browsercompatibility.html), bukan artikel lama yang menyebut mobile selalu tidak didukung.

**Susunan yang diusulkan:**

```text
Keyboard / gamepad / touch
        ↓ quantized InputFrame
Shared Combat3D (fixed tick, move definitions, target rules, damage)
        ↔ Rapier world (kinematic actor + stage collision)
        ↔ Node/Colyseus authoritative room (online)
        ↓ state + identified CombatEvents
Presentation adapter
        ├─ Babylon character, animation, sockets
        ├─ Camera + HUD + touch controls
        ├─ VFX + pooled projectiles/summons
        └─ Web Audio buses + voice + music
```

Rapier dipilih sebagai satu implementation collision bersama, bukan menggabungkan physics Babylon/Havok di klien dengan physics lain di server. Gameplay character tetap kinematic: knockback, dash dan jump ditentukan aturan combat. Rigid-body/ragdoll dekoratif tidak menentukan kemenangan. Lihat [character controller Rapier](https://rapier.rs/docs/user_guides/javascript/character_controller/).

**Struktur source usulan**, bukan kode yang sudah dibuat: `shared/combat3d/`, `client3d/{render,animation,camera,vfx,audio,input}/`, `server/`, `content/{fighters,moves,stages}/`, `assets3d/`. Rule definition, damage dan collision dapat diuji headless tanpa renderer.

Pertahankan integrasi akun/lobby/result project lama melalui adapter ketika waktunya implementasi. Rule set dan build hash arena 3D harus baru; klien 2D dan 3D tidak boleh masuk match authority yang sama. Riset ini tidak mengubah escrow, deployment atau jaringan live.

## 5. Desain arena, movement, kamera dan kontrol

### Ruang dan movement

- World: XZ sebagai lantai, Y ke atas; meter sebagai unit. Pilih dan dokumentasikan konvensi handedness/yaw di import adapter. Meshy meminta karakter input rig menghadap +Z; konversi engine harus diuji agar gerak/aim tidak terbalik.
- Movement bebas camera-relative; saat lock-on, fighter menghadap rival dengan strafe maju/mundur/kiri/kanan. Normalisasi diagonal dan clamp analog mencegah kecepatan ekstra.
- Pisahkan `moveYaw`, `facingYaw`, `aimYaw`, `cameraYaw`. Server menerima input world-relative yang dikuantisasi dan memvalidasi kecepatannya; kamera boleh lokal, batas aim/turn tetap authoritative.
- Turning mempunyai batas kecepatan; move menentukan kapan tracking dihentikan. Serangan aktif tidak boleh otomatis berputar 180° mengikuti musuh yang menghindar.
- Collision capsule/pushbox dipisah dari hurtbox. Aktor saling mendorong secara terkontrol; dash tidak menembus tembok atau membuat dua capsule tersangkut.
- Jump/airborne: tetapkan jump height, air control, landing recovery dan apakah double jump/crouch legacy dipertahankan. Nilai pixel/detik lama tidak langsung diubah menjadi meter/detik tanpa tuning.
- Shared dodge/sidestep direkomendasikan untuk dicoba di prototype arena. Distance, recovery dan i-frame adalah **mekanik baru yang belum disetujui final**, bukan fitur yang otomatis sudah dimiliki game.
- Arena awal datar, satu elevasi, tidak ada ring-out/hazard. Definisikan batas dan spawn yang simetris. Slope/ledge, destructible dan environmental damage ditandai ekspansi bersyarat.

### Kamera

- Prototype: kamera third-person yang cukup tinggi agar kaki, telegraph tanah dan dua fighter terbaca; lock-on default 1v1; orbit manual opsional di desktop dan swipe di HP.
- Perhitungkan jarak dua fighter untuk framing/zoom; clamp FOV dan jarak agar karakter tidak menjadi titik. Hindari auto-switch sisi mendadak saat cross-up.
- Spherecast dari titik fokus ke posisi kamera untuk hindari clipping; fade occluder jika perlu. Kamera tidak ikut terpental penuh mengikuti kepala atau ragdoll.
- Shake pendek berbasis impulse, bukan random offset tanpa batas; beri pengaturan reduce shake/flash. Cinematic ultimate tetap menunjukkan telegraph dan tidak menghilangkan kendali kamera lama saat combat berlangsung.
- Uji target tepat di belakang pemain, terjepit dinding, lompat melewati kamera, jarak sangat dekat/jauh, kedua ultimate bersamaan, dan portrait/landscape.

### Input

- Desktop: WASD, mouse orbit/aim, attack, S1/S2/ultimate, jump, dodge dan lock toggle; binding final dapat di-remap. Gamepad memakai stick kiri/kanan, trigger/face button dengan deadzone.
- HP: stick kiri + tombol aksi kanan, auto lock 1v1, camera assist, swipe area terpisah. Jangan mewajibkan dua stik dan delapan tombol yang harus ditekan bersamaan.
- Gesture kamera tidak mengaktifkan attack; multi-touch tetap bekerja saat bergerak + skill + camera. Pointer capture per pointer, tangani `pointercancel`, kehilangan fokus, orientation dan safe area. [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events).
- Input buffer awal usulan 80–120 ms, lalu playtest. Buffered action harus dicek ulang eligibility/cooldown saat dieksekusi dan mempunyai masa kedaluwarsa; tidak menumpuk saat KO/reconnect.
- Crouch/double-jump, universal guard, charge/hold attack dan command input perlu keputusan desain eksplisit. Hindari menambah semua input hanya karena library mempunyai animasinya.

### HUD dan alur match

Health/chip bar, nama fighter, timer, round score, cooldown S1/S2/ultimate, form timer Mamio, lock-on marker dan indikator target harus tetap terbaca pada kamera bergerak. Jika stun/guard/resource baru dipilih, HUD mengikuti rules tersebut. Jangan menaruh informasi penting hanya pada efek kecil di model.

Character select tetap 12 fighter, dengan preview 3D dimuat bertahap; kamera preview dan pose menu tidak mengubah state combat. Flow mencakup loading/retry → Ready kedua pemain → intro → fight → KO/time-up → result → rematch/keluar. Pause offline menghentikan sim; menu/pengaturan online tidak otomatis membekukan server. Hentikan input ketika focus hilang dan jelaskan status reconnect kepada pemain.

## 6. Pipeline model, rigging dan export

### Sebelum generate

1. Tetapkan satu art bible: stylized CHOG, siluet kepala, palet, skala relatif, bentuk mata/mulut, outline, material dan detail belakang. Tentukan prop mana yang wajib.
2. Buat model sheet front/side/back yang konsisten, seluruh tubuh terlihat, rest pose netral; lengan tidak menempel badan, kaki terpisah, tangan tidak menutup wajah.
3. Simpan referensi asli dan keputusan interpretasi; satu gambar depan tidak memberi informasi punggung. Props besar dibuat terpisah dari tubuh agar tidak menyatu dengan telapak/cape.
4. Tentukan skeleton contract dan uji pada dummy/proxy sebelum permintaan berbayar. Jangan membuat 12 skeleton acak lalu berharap seluruh motion bisa ditukar.

### Peran dan batas Meshy

Image-to-3D mendukung `pose_mode: "a-pose"/"t-pose"`; `is_a_t_pose` lama sudah deprecated. Gunakan model identity-preserving dari reference, bukan prompt teks saja untuk seluruh roster. Pilih kualitas/topology melalui perbandingan pilot; Smart Topology bukan jaminan edge loop yang cocok untuk deformasi. [Image-to-3D API](https://docs.meshy.ai/en/api/image-to-3d).

Untuk konfigurasi baru, hindari `model_type: "lowpoly"` legacy yang dijadwalkan berhenti pada 30 Oktober 2026. Jalur Smart Topology/T2 atau model generation standar dipilih berdasarkan hasil pilot, bukan semata nama “low poly”. [Pemberitahuan model dan pricing](https://docs.meshy.ai/en/api/pricing).

Rigging API mensyaratkan model **humanoid bertekstur**, struktur tubuh/anggota badan jelas, GLB menghadap +Z. Dokumentasi API menyebut maksimum 320.000 faces dan menyarankan remesh ≤300.000 bila melampaui; kebutuhan game kita jauh di bawah itu. Web app mempunyai fitur berbeda, jadi jangan menganggap dukungan quadruped web app juga tersedia di jalur MCP/API humanoid. [Rigging API](https://docs.meshy.ai/en/api/rigging).

Hasil rig Meshy dapat menjadi rig final hanya jika lulus contract/deformation test; alternatifnya transfer weight/retarget ke master rig di Blender. Mixamo adalah sumber motion alternatif bila nanti dipilih; auto-rig Mixamo juga sensitif terhadap proporsi ekstrem dan aksesori besar. [Batas Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html).

### Pemeriksaan mesh di Blender

- Hilangkan geometry tak terpakai, permukaan ganda dan artefak; periksa normal, UV, texel density, seam dan transparansi. Tidak perlu memaksa seluruh mesh game watertight seperti model cetak 3D.
- Topology di bahu, siku, panggul, lutut, leher dan tangan harus mendukung pose ekstrem; remesh otomatis dan polycount rendah saja belum membuktikan ini.
- Pisahkan papan/staff/brush/keyboard/mic/controller dari tubuh. Tentukan hand grip, pivot, attachment dan apakah berpindah tangan saat skill.
- Terapkan transform secara terkontrol, cek unit, rest pose dan bind pose. Simpan `.blend` master dan asset export terpisah.
- Tetapkan origin di ground/root, bukan pusat kepala. Tinggi tubuh, contact feet, offset portrait dan radius gameplay masuk metadata.

### Skeleton contract usulan

- Deform hierarchy: `root → pelvis → spine → chest → neck → head`; chain clavicle/upperarm/forearm/hand kiri/kanan; thigh/shin/foot/toe kiri/kanan.
- Root adalah anchor locomotion/gameplay; pelvis untuk body motion. IK controls, pole targets dan helper rig dipakai di Blender lalu dibake saat export; bukan dianggap otomatis runtime-ready.
- Jari minimal sesuai prop dan gaya mitten; cape/scarf/spike memakai sedikit secondary bones jika perlu. Hindari cloth simulation mahal sebagai syarat berjalan di HP.
- Sockets bernama: `hand_r`, `hand_l`, `weapon_grip`, `weapon_tip`, `muzzle`, `head_fx`, `chest_fx`, `foot_l`, `foot_r`, `ground_fx`. Socket tidak harus menjadi deform bone.
- Empat influence per vertex sebagai budget awal; weight dinormalisasi. Banyak bone/influence dan facial morph harus dicek dukungan serta biaya pada target nyata.
- Mamio base/empowered disarankan memakai skeleton sama. Jika mesh/proportions berbeda, swap mesh/form mengikuti authoritative form event; reset blend dan prop dengan benar.

### Wajah dan ekspresi

Untuk CHOG, ekspresi adalah bagian penting identitas. Rencanakan blink, neutral/ready, effort, hurt dan KO; victory/ultimate dapat menambah ekspresi khas. Pilih face atlas/UV swap atau sedikit morph target setelah uji jarak kamera. Mouth animation untuk voice bersifat polish; tidak perlu phoneme rig lengkap sebelum combat terbukti. Kepala besar harus tetap terbaca dari samping/belakang dan tidak menutup telegraph tanah. Expression/morph bersifat visual, tidak mengubah hurtbox tanpa rule eksplisit.

### Deformation acceptance

Periksa rest pose, squat, lunge, tangan terangkat, twist torso, pukulan jauh, staff dua tangan, jatuh, get-up dan KO. Cari shoulder collapse, lutut terbalik, telapak melintir, kaki sliding, cape menembus wajah, dan bone yang tidak ikut mesh. Bandingkan 360° dari jarak kamera gameplay.

### Export dan runtime

Master `.blend`; pertukaran FBX bila tool motion membutuhkannya; runtime **GLB/glTF 2.0** dengan skeleton + named clips + texture. OBJ/STL tidak dipilih sebagai runtime karakter animasi. Bake constraints/IK, set range clip, hilangkan root drift, dan uji hasil import ulang. Perilaku action/NLA berbeda antarversi Blender; gunakan versi exporter yang dikunci dan periksa semua clip, bukan hanya preview pertama. [Blender 4.5 glTF export](https://docs.blender.org/manual/es/4.5/addons/import_export/scene_gltf2.html).

Jalankan [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator), lalu pemeriksaan custom untuk nama clip, unit, socket dan budget. Gunakan [glTF Transform](https://gltf-transform.dev/cli) untuk inspeksi/optimasi yang diuji A/B. **Urutan:** finalisasi model/rig/animation dulu, kemudian kompres runtime; simpan source tak terkompresi. Perubahan skeleton, pruning, quantization atau remesh setelah binding dapat merusak hasil dan harus diverifikasi ulang.

Blender, FFmpeg dan Node tersedia di PATH mesin ini. `gltf-transform` belum ditemukan di PATH; belum dipasang oleh tugas riset ini.

Paket fighter yang diusulkan: `model.glb`, clip bank/overrides, textures, prop GLB, `fighter.manifest.json`, move definitions, audio cue map dan provenance. Manifest menyimpan ID/version, unit/forward axis, skeleton version, relative asset paths/hashes, socket map, nama clip/durasi/loop, LOD/material budget, form mapping dan collider definition ID. File provider mentah dan `.blend` disimpan terpisah dari folder asset runtime. Jangan memasukkan key atau signed download URL ke manifest publik.

## 7. Daftar animasi dan state machine

[animation_requirements.csv](animation_requirements.csv) adalah daftar clip/event produksi dengan scope dan acceptance. **Slot bukan berarti satu permintaan generation per karakter:** beberapa clip dapat dibagikan, diblend, diturunkan dari motion source, atau dibuat manual.

Inventaris berisi **87 slot perencanaan lintas scope**: 33 kebutuhan dasar bersama, 11 kebutuhan khusus karakter, 11 polish dan 32 bersyarat. Ini bukan 87 animasi wajib untuk masing-masing dari 12 fighter; scope dan prioritas tercatat pada setiap baris.

| Kelompok | Kebutuhan |
|---|---|
| Stance | Combat idle loop yang bernapas dan tetap siap; relaxed/low-HP idle opsional |
| Locomotion | Walk/strafe F/B/L/R, run, start/stop, turn L/R; diagonal dapat diblend, lalu ditambah clip diagonal jika hasilnya buruk |
| Air | Jump start, rise/apex/fall, soft/heavy landing; double jump jika dipertahankan; air-hit/launch/tumble jika move mendukung |
| Basic | Attack1/2/3 dengan anticipation, contact dan recovery jelas; chain/cancel window didefinisikan pada data move |
| Skill | S1, S2 dan ultimate; channel/loop/end hanya untuk kemampuan yang memerlukan; cast tidak sama dengan projectile hit |
| React | Light hit empat arah, heavy hit, airborne hit, knockback/stagger; reaksi terpilih dari arah impact relatif terhadap defender |
| Down / KO | Knockdown front/back, ground hold, get-up front/back untuk hidup, KO/final hold untuk kalah; ground hit jika rule mengizinkan |
| Khusus | Toad counter enter/success/fail; Mamio transform/revert dan empowered overrides; Rogue pull, Venty cross-up |
| Match/UI | Intro, victory, defeat/timeout, character-select pose; tidak seluruhnya perlu generation motion baru |
| Bersyarat | Universal block/parry/guard-break, wall-splat, grab/throw, root bind, slow/stun, ring-out dan status elemental |

### Cara menjalankan dan memotong animasi

- Combat state mempunyai priority: result/KO → knockdown → hitstun → kemampuan dengan interrupt rules → locomotion. Perpindahan ditentukan eligibility, bukan menunggu seluruh clip selesai.
- Loop idle/walk/run bersih; locomotion speed sinkron terhadap jarak gerak agar tidak skating. Foot IK dapat menjadi visual polish dengan biaya terukur, bukan menentukan collision.
- Usulan blend: locomotion 80–160 ms; attack masuk 30–70 ms; hit reaction 0–50 ms sesuai kontak; KO tidak kembali ke idle. Ini parameter awal untuk dituning, bukan fakta universal.
- Cegah crossfade panjang menghapus anticipation/contact. Weapon hand tetap terkunci; efek trail dimatikan saat action diinterupsi.
- Gunakan animation time yang berasal dari authoritative action tick/elapsed, bukan reset setiap snapshot. Frame rate renderer berbeda tidak boleh mengubah durasi move.
- Baseline memakai **in-place locomotion**, posisi ditentukan sim. Jika dash/leap memakai root motion, bake displacement menjadi curve authoritative dan hapus displacement ganda dari visual clip. Prinsip pemisahan root/capsule dijelaskan [Epic Root Motion](https://dev.epicgames.com/documentation/en-us/unreal-engine/root-motion-in-unreal-engine).
- Additive head look, flinch kecil dan breathing boleh ditumpuk terbatas; jangan menumpuk transform penuh tanpa masks/weight yang benar.

### Motion provider

Library Meshy yang diambil dari tabel docs pada tanggal riset mempunyai kandidat seperti `0 Idle`, `89 Combat_Stance`, `20 Walk_Fight_Back`, `21 Walk_Fight_Forward`, `7 BeHit_FlyUp`, `178 Hit_Reaction`, `187 Knock_Down`, `156 Stand_Dodge`, `59 Victory_Cheer`. **Ini kandidat nama/ID, belum dinilai preview atau kualitas retarget pada CHOG.** [Animation Library](https://docs.meshy.ai/en/api/animation-library).

Animation API dapat menggabungkan 1–10 action per permintaan; biaya tetap per action. Text-to-motion membuat raw motion terpisah dari model; masih perlu retarget, trim, loop cleanup dan hand/foot correction. Jangan menganggap kalimat “pukul musuh” otomatis menghasilkan hitbox, damage, VFX atau sound. [Animation API](https://docs.meshy.ai/en/api/animation), [Text-to-Motion](https://docs.meshy.ai/en/api/text-to-motion).

## 8. Combat, skill dan collision 3D

### Kontrak move

Setiap move memerlukan: ID/version, actor/form, allowed states, cost/cooldown, startup/active/recovery ticks, animation segment, tracking/turn limit, displacement curve, hit volumes, damage, hitstun, knockback vector, launch/down flags, cancel/buffer window, projectile/summon behavior, VFX/SFX cue dan interruption cleanup.

**Contoh usulan**, bukan angka balance final dan bukan konversi mekanis semua move lama:

```json
{
  "id": "yot.basic_1", "ruleset": "arena3d-prototype-v1",
  "timingTicks": {"startup": 9, "active": 3, "recovery": 9},
  "animation": {"clip": "attack_1", "contactNormalized": 0.43},
  "turnPolicy": {"trackDuringStartup": true, "lockDuringActive": true},
  "hit": {"group": "swing_1", "maxHitsPerTarget": 1,
    "shape": "authored_capsule_sweep", "damage": 6,
    "reaction": "light", "hitstunTicks": 14},
  "presentation": {"windup": "sign_whoosh", "confirmedHit": "impact_light"}
}
```

Hit volumes harus mempunyai geometry lengkap di definition produksi; contoh ini hanya memperlihatkan hubungan timing, visual dan event. Pada 60 Hz, 9+3+9 tick = 350 ms; visual contact sekitar tick ke-9. Timestamp clip disesuaikan agar contact berada di active window.

### Urutan resolution

1. Validasi input/state/cooldown/form; mulai action dan berikan `actionInstanceId`.
2. Pada tick simulation, update displacement, facing dan active hit volumes.
3. Bentuk candidate collision setelah posisi kedua actor diketahui; gunakan swept shape/query agar serangan cepat tidak menembus di antara tick.
4. Cek target/team, hurtbox, invulnerability, guard/counter, obstruction dan hit ledger. Multi-hit memakai interval/kelompok eksplisit.
5. Selesaikan hit simultan sesuai aturan trade/priority sebelum commit KO.
6. Commit damage, stun, knockback, cooldown/resource, projectile destruction dan interrupt secara authoritative.
7. Emit `HitConfirmed` dengan ID, attacker/defender, move, tick, position, normal, reaction dan hasil block/counter/KO.
8. Renderer, audio dan kamera merespons event; gagal menampilkan partikel tidak mengubah damage.

Posisi tulang visual di GPU tidak dijadikan authority server. Hurt/hit volumes dibuat dalam local space karakter dan dapat dibake sebagai curve dari animasi; source data sama dipakai browser dan server. Pisahkan pushbox (menahan tubuh), hurtbox (bisa dipukul), hitbox (penyerang), projectile collider dan stage collider.

### Adaptasi skill yang mudah salah saat pindah dari 2D

- **Projectile:** asal socket ke world, radius, swept path, obstacle collision, lifetime/range, one-hit/spent, ground bounce dan AoE impact. Tentukan apakah tembus shield/actor/terrain.
- **Homing:** angular turn rate dan target acquisition dibatasi; hindari selalu mengenai lawan yang sudah dodge. Rival/target masih valid saat target KO atau lepas lock.
- **Radial AoE:** pakai jarak horizontal, vertical tolerance, line of sight jika diperlukan; indikator tanah harus sesuai radius nyata.
- **Leap/slam:** collision selama terbang dan titik pendaratan authoritative; efek pecahan muncul pada landing, bukan saat tombol ditekan.
- **Barrage/swarm:** banyak visual boleh mewakili beberapa damage event terjadwal; jumlah visual partikel tidak menjadi jumlah hit.
- **Counter Toad:** awal/akhir window, facing cone, projectile eligibility, satu counter per trigger, follow-up, gagal counter dan interruption jelas.
- **Rogue pull:** tentukan sumber gaya/pull, arah mendekat, clamp di dinding dan apakah target menyeberangi caster. Cinematic reposition tidak boleh menabrak arena.
- **Venty cross-up:** server memilih titik di belakang rival yang valid, collision sweep, target facing dan kamera tetap stabil; tidak bebas teleport ke luar batas.
- **Mamio transform:** startup bisa diinterupsi, form state/version, timer, cooldown, mesh/clip overrides, HP/KO handling dan revert; body size tidak berubah diam-diam karena mesh.
- **Summon/spirit/orbit:** entity ownership, target policy, spawn/despawn, active lifetime, source socket, travel, hit cadence, caster hurt/KO persistence dan pool cap.

### Fitur tambahan yang ditelusuri tetapi belum menjadi scope otomatis

Block/guard cone, parry, armor/poise, guard break, grapple/throw/escape, launcher/juggle cap, wall-splat/bounce, elemental status/DoT, charge/channel, ring-out dan hazards semuanya membutuhkan rules dan clip tersendiri. Untuk prototype rekomendasi awal: pertahankan kit khas, coba dodge; universal guard dan sistem tambahan diputuskan setelah dasar movement/combat terasa baik.

## 9. Saat kena hit, knockback, knockdown dan K.O.

**Perbedaannya:** hitstop adalah jeda impact singkat; hitstun adalah lama defender tidak bisa bertindak; knockback adalah perpindahan posisi; knockdown adalah jatuh tetapi bisa hidup; KO adalah hasil HP/round. Kelimanya tidak boleh direpresentasikan hanya dengan satu clip `hurt`.

| Event | Reaksi karakter | Efek / audio | Rules penting |
|---|---|---|---|
| Light hit | Flinch sesuai arah; kembali combat jika hidup | Spark kecil, impact ringan, voice grunt terpilih | Hit ledger satu kali; buffer dibatasi |
| Heavy hit | Stagger lebih jelas + perpindahan sim | Spark lebih besar, bass layer, shake singkat | Batas push di tembok; hindari hitstun loop tanpa aturan |
| Air hit / launch | Air-react → tumble/fall → landing | Air trail ringan, landing thud | Air recovery/juggle hanya jika rule ada |
| Block/counter | Guard recoil / counter strike | Warna/bunyi berbeda, tidak menyerupai clean hit | Tidak memberi clean-hit damage/cue yang salah |
| Knockdown hidup | Jatuh → ground hold → get-up | Dust kontak lantai, cloth/body thud | Wake-up timing dan invuln eksplisit; jangan idle sebelum berdiri |
| KO berdiri/udara | Final fall → settle → ground hold | Final hit accent, KO cue, musik duck | Hanya authority menetapkan hasil; tidak get-up di ronde yang sudah kalah |
| Timeout/draw/double KO | Result sesuai HP/rules, bukan selalu death fall | TIME UP / DRAW / DOUBLE KO | Hentikan skill loop/camera cinematic sesuai kebijakan |

Knockback dihitung dari arah impact terhadap defender di world, bukan selalu `-forward`. Hit reaction dipilih front/back/left/right dari dot/cross relatif actor. Sistem harus menangani musuh menyerang dari samping/belakang, kedua fighter saling hit, dan hit ketika lompat atau transform.

Hitstop usulan dimulai dari legacy 45/85 ms sebagai bahan tuning. Tetapkan satu kebijakan waktu: mana yang pause (aksi/anim/sim) dan mana yang terus berjalan (match wall clock/UI/audio tail). Dalam online, perubahan yang memengaruhi combat harus ditentukan authority, bukan freeze independen tiap klien. Kamera/VFX boleh meredam lokal tanpa mengubah hasil.

Rekomendasi KO awal: animasi authored yang konsisten; ragdoll opsional setelah authority menetapkan KO, bersifat visual dan bisa dimatikan pada low preset. Matikan locomotion, emitter/timer/loop suara milik action yang sudah batal; hindari karakter bangun akibat idle blend atau callback animasi lama.

## 10. VFX: seluruh lapisan yang perlu diproduksi

VFX memakai keluarga grafis komik CHOG: warna karakter, cream/ink outline, spark tegas, motif prop; bukan material realistis berat. Siapkan palet netral untuk hit/block/KO yang terbaca untuk dua karakter dengan warna mirip.

| Lapisan | Contoh | Trigger yang benar |
|---|---|---|
| Anticipation/telegraph | Glow kecil, ground circle/cone, charge | Action start/phase, sebelum damage |
| Release | Muzzle flash, brush arc, windup trail | Projectile spawn/active event |
| Travel | Ribbon, streak, petal/code/drone trails | Entity yang hidup, posisi world per frame |
| Contact | Hit spark, ink splash, sound ring | Confirmed hit dengan contact point/normal |
| Defender | Flash/rim/pulse, hit reaction overlay | Hasil hit/block/counter terpilih |
| Ground | Foot dust, landing ring, slam decal | Kontak lantai authoritative/visual foot contact |
| Persistent | Well, orbit, empowered aura | Instance + lifetime + cleanup |
| Finisher/result | KO accent, victory burst | Round/result event, satu kali |

Siapkan atlas/flipbook spark-smoke, mesh trails/ribbons, simple shockwave rings, ground decals dan shader hit flash. Gunakan bone sockets untuk emitter visual; collider tetap shared data. Billboard lama dapat menjadi prototipe efek, tetapi dari kamera 360° jangan sampai terlihat seperti bidang tipis atau terbalik.

Pakai pooling, instancing dan hard cap. Tier rendah mengurangi partikel, dynamic lights, bloom dan distortion; **telegraph, hit confirm dan lifetime gameplay tetap sama**. GPU particles didokumentasikan Babylon untuk WebGL2; kemampuan harus dideteksi dan kapasitas disesuaikan. Jangan menyalin contoh sejuta partikel sebagai budget HP. [GPU Particles](https://doc.babylonjs.com/features/featuresDeepDive/particles/particle_system/gpu_particles/).

Transparansi/full-screen overdraw, draw calls, shadow dan postprocess perlu profiling terpisah. Preset low tanpa bloom/SSAO/motion blur tetap harus jelas. Rapikan emitter saat pause, interrupt, KO, unload, tab background dan reconnect.

## 11. SFX, voice, music dan audio event

Minimum bank yang direncanakan:

- UI: hover/select/confirm/back/error/ready; lock-on acquire/lost bila tidak mengganggu.
- Movement: footstep berdasarkan permukaan, run, jump takeoff, soft/hard land, dash/evade.
- Attack: cloth/prop swish saat windup, whiff ketika meleset, light/medium/heavy contact, projectile release/travel/impact dan ground impact.
- Defense: guard contact, counter/parry success, armor/guard break hanya bila mechanic dipilih.
- Character: variasi effort/grunt, hurt, knocked down, KO, victory/defeat, ultimate call; kategori tidak perlu semua berupa suara bicara.
- Skill khas: siren Ping, code/glitch Novee, drone Tonashiro, ink Rogue, keyboard Bigchog, soundwave Cookie, flower Venty dan sebagainya.
- Match: intro, round count, FIGHT, low time/HP jika berguna, KO/double KO/time-up/draw/winner, result/rematch.
- Stage/music: ambience per arena, battle loop, tension/final-round layer, result sting.

Untuk SFX pendek gunakan decoded AudioBuffer dengan penjadwalan akurat; musik panjang bisa streaming media element. AudioContext dimulai/resume dari gesture Play/tap; tangani suspended/interrupted saat kembali dari background. [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), [audio untuk game](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games).

Bus: master, music, ambience, SFX, character voice, announcer; masing-masing mute/volume. Batasi voice/concurrency berdasarkan prioritas dan cooldown, variasi sampel untuk repetisi, duck musik ketika announcer/ultimate; hindari clipping dan suara berat yang menumpuk. Simpan master WAV dan metadata lisensi, export format yang benar-benar teruji lintas browser.

Spatial cue mengikuti world/karakter dengan attenuation ringan; announcer/HUD tetap nonspatial. Jangan membuat suara serangan penting hilang total karena kamera jauh. Tampilkan caption untuk cue penting; pemain yang mute tetap menerima telegraph visual.

Gunakan identified events agar sound tidak diputar ulang ketika replay/prediction correction/reconnect. Footstep boleh lokal dari clip contact, tetapi confirmed damage/KO berasal dari authority. Konsep notifies untuk footstep dan particle dapat dirujuk dari [Epic Animation Notifies](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine); implementasinya di stack browser, bukan membutuhkan Unreal.

Audio lama dapat dipakai sebagai baseline jika provenance sesuai; jumlah 52 MP3 tidak berarti foley fighting lengkap atau kualitas akting sudah baik. SFX impact/whiff saat ini juga disintesis di runtime; perlu review dengar dan upgrade tersendiri.

## 12. Networking, prediction dan fairness

Rekomendasi pertama: lanjutkan **client-server authority + local prediction/reconciliation**, adaptasikan state/input ke 3D. Jangan mengklaim project sudah mempunyai full fighting-game rollback hanya karena replay input lokal tersedia. Riot menjelaskan bahwa client-server dan rollback dapat dipadukan, tetapi deterministic state dan engineering tambahan tetap diperlukan. [2XKO: online play](https://2xko.riotgames.com/en-us/news/dev/how-2xko-handles-online-play/).

- InputFrame: sequence/tick, movement vector quantized, aim/facing yang tervalidasi, tombol edge/held dan target intent. Klien tidak boleh mengirim damage, HP atau posisi teleport yang diterima mentah.
- Snapshot: actor transform/velocity, state/action tick/form/timer/cooldown, projectile/summon IDs, rules/result, ack input. Jangan kirim semua transform tulang, ribuan partikel atau waveform audio.
- Local movement/cast dapat diprediksi; HP/result/confirmed hit dari server. Posisi remote memakai interpolation; jangan menunggu 50 ms snapshot baru untuk tiap frame animasi.
- Pertahankan ID event yang stabil; bedakan predicted cast dengan confirmed hit. Correction tidak menggandakan particle/audio/camera impulse atau restart clip dari nol.
- Tentukan input delay/late-input policy dan apakah hit validation memakai rollback/rewind terkontrol. Jangan menambah rewind target saja secara ad hoc tanpa aturan projectile/counter/trade yang konsisten.
- Tangani burst input, stale/future ticks, backlog, tab background, frame stall, reconnect dan timeout. Satu klien lambat tidak boleh membuat match authority ikut berhenti tanpa kebijakan.
- Hash rules/move/physics version, seed, input order dan collision stage. Simpan replay/snapshot cukup untuk investigasi hasil dan regression.
- Rapier JS/WASM mendokumentasikan determinisme lintas platform dengan versi, initial conditions dan ordering yang sama. Ini tidak otomatis menjadikan kode combat kita deterministik: `Math.sin/cos`, RNG, callback order dan scene-derived float harus dikendalikan. [Rapier determinism](https://rapier.rs/docs/user_guides/javascript/determinism/).
- Uji replay Node ↔ Chromium ↔ WebKit pada input yang sama, termasuk collision/wall/dash/swarm. Jika belum identik, jangan menjanjikan full rollback competitive.

Tick awal 60 Hz dan snapshot 20 Hz mengikuti baseline, lalu ukur biaya sim/network baru. Jika 120 Hz collision substep dipertahankan atau diubah, tentukan secara sengaja; FPS render 30 pada HP tidak menurunkan tick combat menjadi 30.

### CPU, training dan alat debugging

AI arena perlu menentukan jarak, sudut, garis pandang, cooldown, approach/strafe/retreat dan dodge opportunity. Arena datar bisa mulai dari steering sederhana; jika obstacle/elevasi bertambah, pilih navigation/pathfinding dan samakan geometri penghalang dengan authority. Tingkat kesulitan mengatur reaction delay dan pilihan move, bukan membaca input pemain sebelum terlihat atau melanggar cooldown.

Training menyediakan dummy idle/guard bila tersedia, rekam-putar input, state reset, frame step, slow visual inspection, collider/trajectory overlay, action startup-active-recovery, input history, hit counter dan damage. Offline training dan online memakai move/rule definitions yang sama; ketidakcocokan ditandai versi. Simpan kasus bug sebagai replay agar koreksi animasi/physics tidak merusak kasus yang sudah benar.

## 13. Budget browser dan asset: target awal, belum benchmark

| Komponen | Low / HP awal | Medium / desktop awal |
|---|---|---|
| Fighter LOD | Sekitar 8–15 ribu triangles | Sekitar 15–30 ribu triangles |
| Material per fighter | 1–2 utama + prop bila perlu | 2–3; extra harus dibenarkan |
| Texture | Atlas 1K, 2K bila terbukti perlu | 2K; jangan default 4K/8K |
| Deform bones | Sasaran 40–70, secondary terbatas | Sama agar clip/asset konsisten |
| Skin weights | Maksimum 4 influence/vertex awal | Sama untuk portabilitas |
| Frame target | Target 60; low fallback 30 untuk visual, sim tetap 60 | Target 60 |
| Initial match download | Hipotesis ≤20–30 MB compressed, dua fighter + satu arena | Ukur bundle dan cache nyata |
| Lighting | Baked/simple light, shadow satu sumber terbatas | Shadow lebih baik, postprocess selektif |
| Camera/postprocess | DPR cap/adaptive, tanpa blur/SSAO | Adaptive berdasarkan GPU |

Angka ini adalah **budget pilot**, bukan batas API atau jaminan semua HP. Tentukan perangkat minimum setelah mengukur FPS, frame P95, memory, input latency, decode/upload hitch dan thermal selama 10–15 menit. Ukur draw calls/overdraw/VRAM; jumlah polygon saja tidak cukup.

Runtime mesh compression (Meshopt/Draco yang diuji), texture GPU compression KTX2/Basis, mipmap dan clip key reduction dapat mengurangi transfer/memory. Jangan menganggap JPEG/WebP transfer kecil berarti VRAM kecil. [GLTFLoader decoders](https://threejs.org/docs/pages/GLTFLoader), [glTF Transform](https://gltf-transform.dev/cli), [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).

Load dua fighter terpilih dan satu arena sebelum Ready; tampilkan progress dan retry. Jangan memaksa semua roster dimuat sebelum match pertama. Versikan manifest/hash cache/service worker agar model dan move definitions tidak tercampur. Dispose skinned meshes, textures, audio loops dan particles saat keluar match; tes rematch berulang untuk mendeteksi leak.

## 14. Biaya Meshy dan pengamanan pekerjaan produksi

Saldo yang **telah diverifikasi lewat MCP sebelum riset**: 1.350 credits, terdiri dari 1.000 monthly dan 350 permanent; reset monthly yang dilaporkan 10 November 2026. Ini snapshot, bukan saldo yang dijamin tetap sama saat produksi.

Harga API yang diperiksa 23 Oktober: Image-to-3D Meshy 7.1 + 2K texture 30 credits; Smart Topology T2/T2.5 + 2K 15; rigging 5; animation 3 **per action**, bukan per batch; remesh 5; text-to-motion Swift 3/Prime 10 untuk raw motion. Biaya apply motion/operasi tambahan perlu diperiksa pada jalur actual sebelum submit. [Pricing resmi](https://docs.meshy.ai/en/api/pricing).

Contoh hitungan aritmetika, **bukan quote produksi final**:

| Skenario | Perhitungan | Credits |
|---|---|---|
| Pilot dua tubuh + rig, 10 action per tubuh | `2 × (30 + 5 + 10×3)` | 130 |
| 12 tubuh + satu rig/tubuh + 10 action/tubuh | `12 × (30 + 5 + 30)` | 780 |
| 12 tubuh + satu rig/tubuh + 20 action/tubuh | `12 × (30 + 5 + 60)` | 1.140 |
| 12 tubuh + satu rig/tubuh + 30 action/tubuh | `12 × (30 + 5 + 90)` | 1.500 |
| Satu tubuh empowered independen + rig + 20 action | `30 + 5 + 60` | Tambahan 95 |

Perhitungan tersebut **belum memasukkan** retry, model-sheet/reference, texture ulang, prop/summon, custom motion, cleanup manual dan QA. Banyak clip dapat di-author/retarget lokal untuk menghemat credit; pengerjaan rig/animasi tetap ada. Rig bersama dan empowered mesh reuse dapat mengurangi request, tetapi keberhasilannya belum dibuktikan. Jangan menghabiskan saldo pada seluruh roster sebelum pilot lulus.

API asset Meshy secara default disimpan paling lama tiga hari dan URL download bertanda tangan akan kedaluwarsa. Setelah generation kelak berhasil, simpan model/texture/rig/clip/thumbnail, metadata task/model/version/options, biaya dan hash ke penyimpanan sendiri. Jangan menjadikan signed URL provider sebagai URL asset game permanen. [Asset retention](https://docs.meshy.ai/en/api/asset-retention).

Jalur yang sudah diuji di mesin: paket MCP resmi 0.6.5, 28 tools, key berasal dari file lokal OpenCode tanpa ditampilkan. Riset ini tidak menjalankan permintaan create/generate. Jalankan MCP hanya untuk operasi yang dibutuhkan dan tutup saat selesai; key tetap di luar repo/client bundle.

Referensi IP CHOG dan asset lama mengikuti provenance project; output AI bukan bukti izin komersial atas karakter pihak lain. Catat izin/provenance untuk CHOG, motion, suara, font dan sampel. Mixamo menyatakan animasinya dapat dipakai dalam game; aturan distribusi asset mentah perlu diperiksa bila kelak asset hendak dijual terpisah. [FAQ Adobe](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html), [aturan asset project](../../Hackathon/Metropolis/game/chog-clash/LICENSE-ASSETS.md).

## 15. Urutan implementasi setelah riset

| Tahap | Deliverable konkret | Syarat selesai |
|---|---|---|
| A — kontrak | Art/skeleton/move/input/camera spec; target device; pilih engine/version | Semua istilah/format/unit konsisten; mekanik tambahan diputuskan |
| B — greybox | Dua capsule, arena kosong, camera/lock-on, movement/jump/dodge percobaan, serangan dummy | Musuh dapat dikelilingi; collision, camera wall dan kontrol HP layak |
| C — pilot asset | Yot + Mamio base direkomendasikan, satu rig contract, basic hit/skill; slot empowered diuji | Deformation, retarget, props, GLB dan memory lolos; tidak batch semua karakter |
| D — combat lengkap pilot | Combo, S1/S2, transform, hurt/knockdown/KO, VFX/SFX event | Contact animasi cocok dengan damage; cancel/interrupt/cleanup konsisten |
| E — kasus khusus | Toad counter/staff, Rogue pull/boomerang, Novee swarm sebagai verifikasi berikutnya | Semua keluarga mechanic punya contoh yang terbukti |
| F — online | Authority 3D, prediction/correction, dedup events, replay/version/reconnect | Dua klien sepakat; tidak ada double-hit/audio atau correction liar |
| G — roster | Adaptasi dan produksi sisa fighter, batch setelah template stabil | Semua form/prop/move punya checklist lengkap |
| H — arena/polish | Satu arena final dahulu, lalu empat lokasi lain; accessibility/quality tiers | Siluet/telegraph jelas; profile perangkat fisik dan playtest manusia lolos |

Yot/Mamio adalah rekomendasi pilot, bukan pilihan yang sudah disetujui pengguna. Proyek dapat menguji dummy lokal sebelum asset berbayar. Estimasi kalender baru dibuat setelah pilot mengukur jumlah koreksi rig dan waktu authoring skill; durasi generation provider bukan durasi menyelesaikan game.

## 16. Checklist cakupan dan verifikasi

Centang berarti **telah dibuktikan pada build 3D**, bukan “sudah disebut di riset”. Seluruh item berikut masih belum dicentang karena belum ada build 3D.

### Asset dan animation

- [ ] Dua belas identitas sesuai reference; detail belakang/prop tercatat; Mamio kedua form.
- [ ] Unit/origin/forward axis/rest pose dan skeleton/clip/socket naming konsisten.
- [ ] Geometry/UV/material dan license/provenance lengkap; file source tersimpan.
- [ ] Weight/skin/hand grip/cape dan pose ekstrem dilihat 360°.
- [ ] Semua clip wajib ada; loop bersih; contact foot/weapon tepat; tidak skating/root drift; ekspresi wajah/eyes/mouth terbaca.
- [ ] Duplicate character/mirror match memakai skeleton instance masing-masing; tidak saling menggerakkan tulang.
- [ ] GLB validation, import ulang, kompresi A/B dan material/normal/alpha sesuai target engine.

### Arena dan combat

- [ ] Movement 360°, lock-on/off, strafe/diagonal/turn/jump/landing; wall/corner tidak tersangkut.
- [ ] Camera close/far/behind/wall/cross-up, ukuran layar dan motion setting.
- [ ] Attack whiff/contact, side/back hit, simultaneous trade, cooldown, cancel/buffer dan interrupt.
- [ ] Projectile sweep/bounce/pierce/block/despawn; range, ground/height tolerance dan collision stage.
- [ ] Seluruh skill khas: counter, pull, cross-up, transform/revert, orbit, swarm, barrage dan summon ownership.
- [ ] Setiap move mempunyai active window/hit ledger yang sesuai; collider debug cocok telegraph.
- [ ] Light/heavy hit, air hit, knockback, knockdown hidup/get-up dan KO akhir berbeda.
- [ ] Double KO, timeout, draw/overtime, round reset/result/rematch; tidak ada callback lama merusak ronde baru.
- [ ] Mekanik opsional (block/parry/armor/grab/wall/status/hazard) diputuskan: dibuat lengkap atau dicatat tidak termasuk versi awal.

### Presentasi dan audio

- [ ] Windup/release/travel/contact/end terhubung event yang benar; VFX tidak menghasilkan damage.
- [ ] Efek di titik kontak/arah yang benar untuk semua sisi; dua ultimate tidak menutup aksi penting.
- [ ] Emitter, projectiles, trails, loops dan voice berhenti saat interrupt/KO/unload sesuai kebijakan.
- [ ] Whiff/hit/block/counter/KO berbeda; mix/concurrency/captions dan mute-volume bekerja.
- [ ] Autoplay unlock, background/resume, headphone/speaker dan silent play diuji di iOS/Android.
- [ ] Reduce shake/flash, alternatif warna, subtitle/cue visual, remap dan touch sizing layak.

### Online, perangkat dan distribusi

- [ ] Authority 3D, input validation, rules/build hash dan local prediction/reconciliation benar.
- [ ] Tidak ada event sound/VFX/hit berganda setelah correction/replay/reconnect.
- [ ] Replay hash/state dicek pada Node, Chromium dan WebKit; determinisme tidak sekadar diasumsikan.
- [ ] Uji RTT 50/100/150/200 ms, jitter dan loss aplikasi secara terpisah; hasilnya dicatat beserta model jaringan.
- [ ] Background/tab stall/disconnect/reconnect/loading gagal/version mismatch punya perilaku yang jelas.
- [ ] Training debug: collider/velocity/action tick, hitstun/hitstop, frame stepping, dummy/record-replay.
- [ ] CPU AI memakai aturan/input yang sama, tidak mengetahui input masa depan atau damage rahasia.
- [ ] Roster pair matrix: 12×12 = 144 pasangan terurut termasuk mirror; form/counter/skill dan arena menjadi dimensi tambahan, bukan dianggap otomatis tercakup oleh 144 startup.
- [ ] Chrome desktop, Safari/WebKit, Android Chrome dan iOS Safari pada perangkat fisik; multi-touch dan gamepad diuji.
- [ ] Target FPS/frame P95/memory/thermal/download tercapai pada low preset; match/rematch 10–15 menit tidak leak.
- [ ] Dua manusia menguji combat feel dan fairness; tes otomatis tidak menggantikan playtest ini.
- [ ] Asset CDN/cache/CORS/version/ready gate bekerja; key tidak ada di bundle; tidak memakai URL Meshy sementara.

## 17. Keputusan tersisa dan batas hasil riset

Sudah dikonfirmasi: arena gerak bebas; browser desktop + HP; riset sebelum generation; roster bersumber Metropolis.

Belum ditetapkan: minimum HP/browser, art/detail belakang final, ukuran arena/skala CHOG, camera style/FOV, movement/jump/double-jump/crouch, universal dodge/guard, apakah semua timing legacy dipertahankan atau di-balance ulang, dan fighter pilot final. Ini dapat diuji dalam greybox; tidak perlu memulai generation untuk menjawabnya.

Belum dibuktikan: keberhasilan auto-rig CHOG aktual, compatibility skeleton hasil Meshy dengan master rig, retarget seluruh sumber motion, kualitas clip/contact, performa GPU perangkat pengguna dan rasa combat online. Tidak ada janji “sekali generate langsung game-ready”.

Pekerjaan riset mencakup domain utama produksi dan memberi acceptance untuk area yang rawan terlewat. Kelengkapan final hanya dapat dinyatakan setelah inventory dan test matrix dijalankan pada build nyata.

## Lampiran: file riset yang dapat dipakai saat produksi

- [roster_3d_inventory.csv](roster_3d_inventory.csv): 13 baris fighter/form, prop, mechanic, socket dan risiko.
- [move_timing_baseline.csv](move_timing_baseline.csv): extraction 78 baris move dari source runtime; bukan frame data baru yang sudah disetujui.
- [animation_requirements.csv](animation_requirements.csv): slot animasi dan event, prioritas, scope dan acceptance.
- [evidence/project-baseline.json](evidence/project-baseline.json): lokasi, hash file, status dan kemampuan baseline.
- [evidence/meshy-animation-library.json](evidence/meshy-animation-library.json): sembilan kandidat dari tabel resmi (656 entri teramati); bukan motion hasil generation.

Semua link eksternal di atas diperiksa untuk riset pada 23 Oktober 2026. Dokumentasi/pricing dapat berubah; periksa ulang sebelum permintaan produksi berbayar. Referensi Epic dipakai untuk konsep animation/root/event, bukan rekomendasi mengganti target browser menjadi Unreal.
