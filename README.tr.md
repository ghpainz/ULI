# ULI

[English](README.md) | **Türkçe**

Premiere Pro kadar sade, CapCut kadar zengin; Windows için masaüstü video kurgu uygulaması (Electron + WebGL2 + FFmpeg).

## Kurulum

GitHub'daki **Releases** sayfasından `ULI Setup x.y.z.exe` dosyasını indirip çalıştırın (kurulum dosyası depoda değil, Releases'te durur). Kurulum Başlat menüsüne ve masaüstüne kısayol ekler; `.ulip` proje dosyalarına çift tıklayınca uygulama açılır. Kurulum dosyası imzasız olduğu için Windows SmartScreen "Windows bilgisayarınızı korudu" uyarısı gösterebilir: **Ek bilgi** > **Yine de çalıştır**.

FFmpeg uygulamanın içinde gelir, ayrıca kurmanız gerekmez.

## Kaynaktan çalıştırma

Node.js 20+ gerekir.

```
npm install
npm start          # uygulamayı çalıştır (ya da ULI.bat)
npm test           # otomatik uçtan uca testler
npm run dist       # dist\ klasörüne Windows kurulum dosyası üret
```

Testler uygulamayı ayrı, geçici bir veri klasörüyle açar; gerçek ayarlarınıza ve son projelerinize dokunmaz. Test videoları FFmpeg ile üretilir (`tests/.media`).

## Lisans

ULI'nin kaynak kodu [MIT lisansı](LICENSE) ile dağıtılır. Kurulum dosyası FFmpeg (GPL-3.0) ve Electron'u kendi lisanslarıyla içerir; bkz. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Özellikler

**Proje ve medya**
- Video, ses ve görsel içe aktarma (sürükle-bırak, klasör içe aktarma), klasörler (bin), liste/simge görünümü
- Tarayıcının oynatamadığı formatlar (ProRes, DNxHD vb.) için otomatik proxy; elle proxy oluşturma/silme, proxy aç/kapat
- Çevrimdışı medyayı yeniden bağlama (aynı klasördeki diğer dosyaları da otomatik bulur)
- Otomatik kaydetme (varsayılan 3 dk, 20 sürüm) ve kaydederken yedek (.bak)

**Zaman çizelgesi**
- Çoklu video/ses izi, iz kilitleme, gizleme, mute/solo, hedefleme, yeniden boyutlandırma
- Araçlar: Seçim (V), İleri İz Seçimi (A), Ripple (B), Rolling (N), Hız Germe (R), Jilet (C), Slip (Y), Slide (U), Kalem (P), El (H), Yakınlaştırma (Z), Yazı (T)
- Overwrite / Insert (Ctrl ile sürükle), Alt ile çoğaltarak sürükleme, yapıştırma (snap), bağlı seçim
- Ripple Delete, boşluk seçip silme, Lift / Extract, Add Edit, Q/W ripple kırpma, kopyala/yapıştır/araya yapıştır, özellikleri yapıştır
- İşaretçiler, giriş/çıkış noktaları, ses dalga formları, film şeridi küçük resimleri, opaklık/ses seviyesi keyframe çizgileri
- Alt klipler (Ctrl+U): Kaynak monitöründeki giriş/çıkıştan, Proje panelinde seçili medyadan ya da zaman çizelgesindeki klipten alt klip oluştur. Alt klip yalnız kendi aralığını gösterir ve kırpılırken bu aralığın dışına çıkmaz
- Klip işaretçileri: Kaynak monitörü odaktayken M kaynak medyaya işaretçi ekler; işaretçiler zaman çizelgesindeki kliplerin üzerinde de görünür
- Sahne Kesim Algılama (Klip menüsü / sağ tık): seçili kliplerin orijinal görüntüsündeki kesimleri bulur; her kesimde klibi böler, klip işaretçisi ekler ve/veya her sahne için alt klip oluşturur (hassasiyet eşiği ayarlanabilir)
- Çok kameralı kurgu: Proje panelinde en az iki video seçip sağ tık > Çok Kameralı Kaynak Sekans Oluştur. Senkron: ses, giriş noktaları veya klip başı; ses ya sabit bir kaynaktan gelir ya da görüntüyle birlikte değişir. Program monitöründe Çok Kamera Görünümü (Shift+0) solda açıları, sağda programı gösterir; açıya tıklayın veya 1–9 tuşlarına basın: durdurulmuşken klibin açısını değiştirir, oynarken o anda keser (canlı kurgu). Herhangi bir iç içe sekans klibi Klip > Çok Kamera > Etkinleştir ile çok kameralı klibe çevrilebilir (her video izi bir kamera olur)

**Efektler ve renk**
- Hareket (konum, ölçek, döndürme, bağlantı noktası), opaklık ve 13 karışım modu — hepsi keyframe'lenebilir
- Program monitöründe sürükleyerek konum/ölçek ayarı
- Lumetri Color: beyaz dengesi, pozlama, kontrast, parlak/gölge/beyaz/siyah, doygunluk, canlılık, .cube LUT, renk tekerlekleri, vinyet, HSL ikincil düzeltme (yalnız seçilen rengi düzelt, maskeyi göster)
- Önce/Sonra karşılaştırması: Program monitöründeki karşılaştırma düğmesi (sol yarı efektsiz, sağ yarı efektli)
- Efektler: Gauss/Yönlü bulanıklık, keskinleştirme, Ultra Key (yeşil perde), kırpma, çevirme, ayna, mozaik, gürültü, posterleştirme, renk tonu, rengi bırak, siyah-beyaz, ters çevirme, parlaklık/kontrast, Gölge, Parlama, Kontur, Lens Bozulması, Kromatik Sapma, Dalga Çarpıtma, Kenarları Bul, Film Greni
- Efektler paneli: liste veya küçük resim görünümü (her efekt/geçiş/ön ayar örnek bir görsel üzerinde canlı önizlenir, üzerine gelince canlanır), arama, Favoriler (sağ tık > Favorilere Ekle)
- Ön ayarlar: 13 renk görünümü (Sinematik Turkuaz & Turuncu, Altın Saat, Soğuk Mavi, Noir, Mat Film...), 10 stilize görünüm (Vintage, Cyberpunk, Retro VHS, Eski Film, Çizgi Roman, Gece Görüşü...) ve 8 hareket ön ayarı (Elde Kamera, Deprem, Ritim Yakınlaştırma, Yavaş Yakınlaşma/Uzaklaşma, Sinematik Bantlar...). Efekt Kontrolleri'nde efekt başlığına sağ tık > Ön Ayar Olarak Kaydet ile kendi ön ayarlarınızı oluşturun
- Eko / İz Bırakma: hareketli içeriğin arkasında iz bırakır (oynatırken ve dışa aktarırken önceki kareler birikir)
- Hareket efektleri: Kamera Sallanması, Vuruşlu Yakınlaştırma (ritme göre), Ken Burns, Radyal (zoom/dönme) Bulanıklık
- Retro: VHS, Eski Film (sepya, çizik, toz, titreme), Dijital Bozulma (glitch), CRT Ekran, Flaş Işığı
- Işık: Lens Parlaması, Işık Sızıntıları, Bokeh Işıkları, Işık Huzmeleri, Neon Kenarlar, Vinyet
- Çarpıtma ve stil: Şişirme/Balık Gözü, Girdap, Kaleydoskop, Ayna Karoları, Türbülans, Dalgalanma, Çift Ton, Çizgi Film, Yarım Ton, Kabartma, Kurşun Kalem, Renk Haritası (termal, gece görüşü, röntgen...), Sinematik Bantlar
- Hareket bulanıklığı: Efekt Kontrolleri > Hareket > Hareket Bulanıklığı. Keyframe'li konum/ölçek/döndürme hareketini deklanşör açısına göre bulanıklaştırır
- Warp Stabilizer: Efekt Kontrolleri'nde "Analiz Et" ile titrek çekimi sabitler (Konum/Ölçek/Döndürme veya yalnız Konum, yumuşaklık, otomatik kırpma-ölçekleme)
- Maskeler: elips, 4 noktalı çokgen ve kalemle bezier eğri; tüy, opaklık, genişleme, ters çevirme, Ekle/Çıkar/Kesişim modları, keyframe'li maske yolu. Opaklığa (klibin bir bölgesini göster) veya tek bir efekte (ör. yalnızca yüzü bulanıklaştır) uygulanır
- Program monitöründe maske düzenleme: köşeyi sürükle, içinden sürükleyip taşı, kalemle tıkla = köşe / tıkla-sürükle = eğri noktası, tutamağı sürükle (Alt ile tutamağı kır), Alt+köşe sürükle = eğri tutamağı çek (çokgeni bezier'e çevirir), Alt+tık = köşe noktasına döndür, Ctrl+tık kenar = nokta ekle, Ctrl+tık köşe = nokta sil, Shift ile elipsi orantılı boyutlandır, Esc ile kalemi iptal et
- Maske takibi: Maske Yolu satırındaki ◀| ◀◀ ▶▶ |▶ düğmeleriyle maskeyi bir kare ya da klip sonuna kadar ileri/geri takip et. "Konum" veya "Konum, Ölçek ve Döndürme" yöntemi; her kareye keyframe yazılır, Durdur ile yarıda kesilebilir, geri alınabilir. Takip kaybolursa maskeyi düzeltip o kareden yeniden başlatın
- Lumetri eğrileri: Ana/Kırmızı/Yeşil/Mavi eğrileri ve Ton–Doygunluk eğrisi (tıkla = nokta, sürükle = ayarla, çift tık = sil)
- Zaman yeniden eşleme (hız rampası): Efekt Kontrolleri > Zaman Yeniden Eşleme > Hız için keyframe ekleyin; Yavaş Giriş/Çıkış ile yumuşak rampa. Önizleme ve dışa aktarma aynı sonucu verir; bağlı ses klibi de aynı rampayı izler
- Altyazılar: altyazı izi (C1), Altyazılar paneli (metin, zamanlama, stil), SRT/VTT içe-dışa aktarma, dışa aktarırken videoya gömme veya ayrı SRT dosyası (Ctrl+Alt+C: altyazı ekle)
- Lumetri Kapsamları: Dalga formu (RGB/Luma), RGB Parade, Vektörskop YUV (renk hedefleri ve ten çizgisi), Histogram
- Nested (iç içe) sekanslar: seçili klipleri Klip > İç İçe Yerleştir ile tek klibe çevir veya Proje panelinden bir sekansı zaman çizelgesine sürükle. Nested klibe hareket/opaklık/efekt/hız uygulanabilir, çift tıklayınca içine girilir, istenen derinlikte iç içe olabilir (sekans kendi içine konamaz)
- Temel Grafikler paneli: çok katmanlı grafik klipleri (metin, dikdörtgen, elips, çizgi), katman başına giriş/çıkış animasyonu (soluklaşma, kayma, ölçek, zıplama, daktilo, silme), 8 hazır şablon (alt bant, başlık, abone ol, sosyal medya etiketi, alıntı, bölüm başlığı, bitiş kartı)
- Kinetik yazı: grafik metin katmanlarında harf harf animasyonlar (Belirme, Fırlama, Yükselme, Düşme, Bulanıktan Netleşme, Rastgele, Kelime Kelime, Glitch) ve sürekli döngüler (Dalga, Sıçrama, Gökkuşağı, Nabız, Sallanma, Süzülme, Salınım, Titreme). Yeni katmanlar: Emoji, İlerleme Çubuğu, Geri Sayım. 10 yeni şablon (Hareketli Başlık, Kelime Kelime, Neon Tabela, Zıplayan Yazı, Glitch Başlık, Gökkuşağı Yazı, Geri Sayım, İlerleme Çubuğu, Emoji, Beğeni Kalbi)
- Yazı efektleri (Temel Grafikler > Düzenle): neon parlama (renkli ışıma + beyaz çekirdek, Parlama Nabzı döngüsü), 2-3 renkli renk geçişi, 2 ek dış kontur, 3B derinlik, eğri üstünde yazı. Gözat sekmesinde 20 hazır yazı stili (Neon Pembe/Mavi/Yeşil/Mor, Neon Tabela, Ateş, Altın, Krom, Buz, Retro 80'ler, Çizgi Roman, Kalın Kapak Yazısı, 3B Blok, Çift Kontur, Gün Batımı, Okyanus, Glitch RGB, Zarif, Kavisli Başlık, Sade)
- İçinde video olan yazı: "İçinde Video Olan Yazı" şablonu ya da herhangi bir klibin karışım modunu "Şablon Alfa" yapın; alttaki video yalnız yazının içinde görünür ("Siluet Alfa" tersi)
- Ayar katmanları, metin (başlık) klipleri, renk fonları
- 47 video geçişi (Yumuşak Yakınlaşma/Uzaklaşma, Flaş, Mürekkep, Film Yanığı, Kalp/Yıldız/Elmas/Saat silme, Küp Dönüşü, Kapı Açılışı, Dönme, Whip Pan, Glitch dahil) ve 3 ses geçişi; geçiş hizalaması (kesmede ortala/başla/bitir) (Ctrl+D / Ctrl+Shift+D varsayılan geçiş)
- Hız/süre (ters oynatma dahil), kare dondurma

**Ses**
- Klip ses seviyesi ve pan keyframe'leri, iz mikseri (fader, pan, M/S), ana çıkış, ses ölçerleri
- Temel Ses paneli: klibi Diyalog/Müzik/Efekt/Ortam olarak işaretle; ses yüksekliğini hedef LUFS'a otomatik eşle, gürültü/uğultu/sızıltı onarımı, konuşmayı güçlendirme, müziği diyaloğun altında otomatik kısma (ducking)
- Vuruş algılama: müzik klibini seçip Sekans > Vuruşları Algıla; tempo (BPM) bulunur ve her vuruşa işaretçi konur. Vuruşa Göre Otomatik Kes: seçili klipleri vuruşlarda böler veya seçili kliplerden her 1/2/4/8 vuruşta bir değişen ritmik montaj oluşturur
- Ses Değiştirici: Sincap, Helyum, Kalın Ses, Canavar, Robot, Fısıltı, Telefon, Radyo, Megafon, Mağara Yankısı veya özel perde (±12 yarım ton)
- Seslendirme kaydı (Ctrl+Alt+R): mikrofondan oynatma kafasına kayıt
- Sese göre senkron: iki kaydı (ör. kamera sesi ve harici mikrofon) otomatik hizala
- Ses efektleri: Yükselt (Amplify), Kompresör, 3 Bantlı Ekolayzer, Yüksek/Alçak Geçiren, Gecikme (Delay), Kanal (sol/sağ doldur, değiştir, mono), Yankı (Reverb), Uğultu Giderici, Gürültü Azaltıcı (gürültü tabanını otomatik ölçer), De-Esser. Gürültü azaltma ve de-esser önizlemede bir kez işlenip önbelleğe alınır. Efekt parametreleri sabittir (keyframe yok); nested ses kliplerine doğrudan ses efekti uygulanmaz, efekti iç sekanstaki kliplere uygulayın

**Dışa aktarma** (Ctrl+M)
- H.264 / H.265 (NVIDIA NVENC donanım hızlandırma destekli), ProRes 422/HQ/4444, VP9, GIF, PNG dizisi, WAV, MP3, AAC, FLAC
- Dışa aktarma orijinal dosyalardan kare-doğru yapılır; önizlemede gördüğünüz birebir çıktıya gelir
- Tek kare dışa aktarma (Ctrl+Shift+E)

## Önemli kısayollar

| Kısayol | İşlev |
|---|---|
| Space / J K L | Oynat-durdur / geri-dur-ileri (tekrar basınca hızlanır) |
| ← → / Shift+← → | 1 / 5 kare |
| ↑ ↓ | Önceki / sonraki kesme noktası |
| I / O / X | Giriş / çıkış / klibi işaretle |
| , / . | Kaynak monitöründen Insert / Overwrite |
| Ctrl+K / Ctrl+Shift+K | Kesme ekle / tüm izlere |
| Shift+Del | Ripple Delete |
| Q / W | Ripple kırpma |
| Ctrl+R | Hız/Süre |
| M | İşaretçi (Kaynak monitöründe klip işaretçisi) |
| Ctrl+U | Alt klip oluştur |
| Shift+0 / 1–9 | Çok kamera görünümü / açı değiştir |
| = / - / \\ | Yakınlaştır / uzaklaştır / sığdır |
| Ctrl+Z / Ctrl+Shift+Z | Geri al / yinele |
| ` | Paneli büyüt |
| F1 | Tüm kısayollar |

Dil: menü çubuğunun sağındaki TR/EN düğmesi veya Tercihler (Ctrl+,).

## Veriler nerede?

- Projeler: `.ulip` dosyaları (JSON) — istediğiniz yere kaydedin
- Proxy, önbellek, otomatik kayıtlar: `%APPDATA%\ULI`
