# ULI Premiere

Premiere Pro tarzı, Windows için masaüstü video kurgu uygulaması (Electron + WebGL2 + FFmpeg).

## Kurulum

`dist\ULI Premiere Setup 0.1.0.exe` dosyasını çalıştırın. Kurulum Başlat menüsüne ve masaüstüne kısayol ekler; `.ulip` proje dosyalarına çift tıklayınca uygulama açılır. Kurulum dosyası imzasız olduğu için Windows SmartScreen "Bilinmeyen yayımcı" uyarısı gösterebilir: "Ek bilgi" > "Yine de çalıştır".

Kurulum dosyasını yeniden üretmek için: `npm run dist`

Kurmadan çalıştırmak için `ULI Premiere.bat` dosyasına çift tıklayın (geliştirme: `npm start`).

FFmpeg uygulamanın içinde gelir, ayrıca kurmanız gerekmez.

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
- Ayar katmanları, metin (başlık) klipleri, renk fonları
- 27 video geçişi (Dönme, Bulanık Geçiş, Zoom Blur, Whip Pan, Işık Sızıntısı, Glitch dahil) ve 3 ses geçişi; geçiş hizalaması (kesmede ortala/başla/bitir) (Ctrl+D / Ctrl+Shift+D varsayılan geçiş)
- Hız/süre (ters oynatma dahil), kare dondurma

**Ses**
- Klip ses seviyesi ve pan keyframe'leri, iz mikseri (fader, pan, M/S), ana çıkış, ses ölçerleri
- Temel Ses paneli: klibi Diyalog/Müzik/Efekt/Ortam olarak işaretle; ses yüksekliğini hedef LUFS'a otomatik eşle, gürültü/uğultu/sızıltı onarımı, konuşmayı güçlendirme, müziği diyaloğun altında otomatik kısma (ducking)
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
- Proxy, önbellek, otomatik kayıtlar: `%APPDATA%\ULI Premiere`
