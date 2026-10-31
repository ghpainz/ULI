# ULI Premiere

Premiere Pro tarzı, Windows için masaüstü video kurgu uygulaması (Electron + WebGL2 + FFmpeg).

## Çalıştırma

`ULI Premiere.bat` dosyasına çift tıklayın. İlk çalıştırmada bağımlılıklar yoksa otomatik kurulur.
Geliştirme için: `npm start`

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

**Efektler ve renk**
- Hareket (konum, ölçek, döndürme, bağlantı noktası), opaklık ve 13 karışım modu — hepsi keyframe'lenebilir
- Program monitöründe sürükleyerek konum/ölçek ayarı
- Lumetri Color: beyaz dengesi, pozlama, kontrast, parlak/gölge/beyaz/siyah, doygunluk, canlılık, .cube LUT, renk tekerlekleri, vinyet
- Efektler: Gauss/Yönlü bulanıklık, keskinleştirme, Ultra Key (yeşil perde), kırpma, çevirme, ayna, mozaik, gürültü, posterleştirme, renk tonu, rengi bırak, siyah-beyaz, ters çevirme, parlaklık/kontrast
- Maskeler: elips, 4 noktalı çokgen ve kalemle bezier eğri; tüy, opaklık, genişleme, ters çevirme, Ekle/Çıkar/Kesişim modları, keyframe'li maske yolu. Opaklığa (klibin bir bölgesini göster) veya tek bir efekte (ör. yalnızca yüzü bulanıklaştır) uygulanır
- Program monitöründe maske düzenleme: köşeyi sürükle, içinden sürükleyip taşı, kalemle tıkla = köşe / tıkla-sürükle = eğri noktası, tutamağı sürükle (Alt ile tutamağı kır), Alt+köşe sürükle = eğri tutamağı çek (çokgeni bezier'e çevirir), Alt+tık = köşe noktasına döndür, Ctrl+tık kenar = nokta ekle, Ctrl+tık köşe = nokta sil, Shift ile elipsi orantılı boyutlandır, Esc ile kalemi iptal et
- Maske takibi: Maske Yolu satırındaki ◀| ◀◀ ▶▶ |▶ düğmeleriyle maskeyi bir kare ya da klip sonuna kadar ileri/geri takip et. "Konum" veya "Konum, Ölçek ve Döndürme" yöntemi; her kareye keyframe yazılır, Durdur ile yarıda kesilebilir, geri alınabilir. Takip kaybolursa maskeyi düzeltip o kareden yeniden başlatın
- Lumetri Kapsamları: Dalga formu (RGB/Luma), RGB Parade, Vektörskop YUV (renk hedefleri ve ten çizgisi), Histogram
- Nested (iç içe) sekanslar: seçili klipleri Klip > İç İçe Yerleştir ile tek klibe çevir veya Proje panelinden bir sekansı zaman çizelgesine sürükle. Nested klibe hareket/opaklık/efekt/hız uygulanabilir, çift tıklayınca içine girilir, istenen derinlikte iç içe olabilir (sekans kendi içine konamaz)
- Ayar katmanları, metin (başlık) klipleri, renk fonları
- 19 video geçişi ve 3 ses geçişi (Ctrl+D / Ctrl+Shift+D varsayılan geçiş)
- Hız/süre (ters oynatma dahil), kare dondurma

**Ses**
- Klip ses seviyesi ve pan keyframe'leri, iz mikseri (fader, pan, M/S), ana çıkış, ses ölçerleri
- Ses efektleri: Yükselt (Amplify), Kompresör, 3 Bantlı Ekolayzer, Yüksek/Alçak Geçiren, Gecikme (Delay), Kanal (sol/sağ doldur, değiştir, mono). Efekt parametreleri sabittir (keyframe yok); nested ses kliplerine doğrudan ses efekti uygulanmaz, efekti iç sekanstaki kliplere uygulayın

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
| M | İşaretçi |
| = / - / \\ | Yakınlaştır / uzaklaştır / sığdır |
| Ctrl+Z / Ctrl+Shift+Z | Geri al / yinele |
| ` | Paneli büyüt |
| F1 | Tüm kısayollar |

Dil: menü çubuğunun sağındaki TR/EN düğmesi veya Tercihler (Ctrl+,).

## Veriler nerede?

- Projeler: `.ulip` dosyaları (JSON) — istediğiniz yere kaydedin
- Proxy, önbellek, otomatik kayıtlar: `%APPDATA%\ULI Premiere`
