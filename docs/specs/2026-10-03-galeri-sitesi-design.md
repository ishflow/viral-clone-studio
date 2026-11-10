# Viral Clone — site ve üretim sistemi (tasarım spec'i)

Tarih: 2026-10-03 · Güncelleme: 2026-10-04 (marka, satış sürümünün ekranları, light + mobil, yönetim paneli, site mimarisi) · Durum: tasarım tuvalde bitti, site kuruluyor

Bu belge iki katman taşır:
- **A. Site** (§3, §8, §13–§16): satış sürümünün bütün ekranları. 2026-10-04 planıyla kurulur; hesap, ödeme, e-posta ve üretim **arayüzün arkasında sahte veriyle** çalışır.
- **B. Üretim sistemi** (§4–§7, §9–§12): tarama, şablon hazırlama, `compose`, üretim hattı. Tasarımı aynen geçerli; kurulumu sitenin ardından ayrı planla yapılır ve sahte uygulamaların yerine takılır.

## 1. Amaç

Higgsfield kalitesinde bir site. Kullanıcı galeride bir video görür, "bunu ben de istiyorum" der, kendi ürününün görsellerini yükler, "Clone it"e basar ve birkaç dakika sonra videosunu indirir.

Marka: **Viral Clone** (`viralclone.app`; `viralklon.com` yönlendirme, alan adı henüz alınmadı). Söz: "Same video. Your product." Çağrı: "Seen it? Clone it."

**Ölçüt (sahibin tarifi):** müşteri gördüğünün aynısını bekler. Tasarımdaki her karar buna göre verilir.

"Aynı"nın tanımı: çekim sayısı ve sırası, her çekimin kadrajı ve hareketi, süreler, kesme ritmi, ekrandaki yazıların yeri, stili ve zamanı, müziğin havası ve temposu. Kişi, mekân ve ses birebir kopya değildir; referans videonun görüntüsü, sesi ve müziği çıktıda kullanılmaz.

## 2. Kararlar

| Konu | Karar |
|---|---|
| Kapsam | Tarama, şablon hazırlama, galeri ve üretim tek spec; kurulum iki plan (A site, B üretim sistemi) |
| Tarama kategorisi | Her ürün kategorisi (kategori bağımsız) |
| Tarama kaynağı | TikTok Creative Center "Top Ads" + YouTube Shorts araması |
| Şablona dönüşüm | Otomatik + ön eleme; eşiğin altındakiler yönetimdeki "Inbox" rafında bekler |
| Şablon yapısı | Sahne listesi (çekim çekim); sabit kalıp yok, LLM kurgu kodu yazmaz |
| Galeri kartı | Sistemin kendi ürettiği örnek oynar; örnek yöneticinin onayıyla üretilir |
| Galeri | Ortak, kategoriyle seçilir; kişiye özel olan "My videos" ve kendi yüklediği videolar |
| Kendi videosu | Kullanıcı link verir, 2–5 dakikada yalnız onun gördüğü özel şablon çıkar |
| Ürün girişi | Sadece yükleme: görseller + ürün adı. harici not kütüphanesine bağ yok |
| Hesap | E-posta + şifre ya da Google; e-posta doğrulaması zorunlu |
| Ödeme | **Kredi paketi**, abonelik yok. Fiyat ve paket boyutu yer tutucu (sahip belirler). Ödeme sağlayıcı seçilmedi |
| Ücretsiz video | E-postasını doğrulayan yeni üyeye **bir** ücretsiz video (No talking, Fast) |
| Üretim formu | Biçim No talking / Talking (şablondan gelir), kalite Fast / Best, varyant 1–3, **video dili** (varsayılan English); kredi tahmini + onay |
| Erişim | Hedef internet (`viralclone.app`); bu planda yalnız bu Mac'te çalışır, deploy yok |
| Görsel tasarım | A — Karanlık Sinema, dark + light, masaüstü + mobil; ayrıntı §14 |
| Dil | Arayüz **İngilizce** yazılır; her metin çeviri dosyasındadır; ikinci dil Türkçe |
| Reklam | Site içi reklam, promosyon, "upgrade" kartı yok |
| Yönetim | Ayrı panel: kullanıcılar, gelir, krediler, işler, şablonlar, tarama, ayarlar (§3.8) |
| E-posta | Beş e-posta: doğrulama, şifre sıfırlama, video hazır, iş durdu, ödeme alındı (açık zemin) |

## 3. Ekranlar

Kaynak: tuval "3 · Website" sayfası (masaüstü, dark). "4 · Website · Light", "5 · Mobile · Dark", "6 · Mobile · Light" aynı ekranların türevleridir. Pano adı parantez içinde; yol sitenin adresidir.

### 3.1 Ana sayfa ve kayıt (ziyaretçi)
| Yol | Ekran |
|---|---|
| `/` | Ana sayfa: söz, üç adım, "gördüğün neyse alacağın o", sorular, çağrı (`A-Ana-Sayfa`) |
| `/pricing` | Kredi paketleri, bir videonun kaç kredi tuttuğu, sık sorulanlar (`A-Fiyatlar`) |
| `/login`, `/signup` | Giriş ve kayıt: Google ya da e-posta (`A-Giris`) |
| `/legal/[belge]` | Kullanım şartları, gizlilik, iade, içerik ve telif; metin yer tutucu (`A-Yasal`) |
| `/contact` | İletişim formu + kısa sorular (`A-Iletisim`) |
| bulunamayan yol | 404 (`A-404`) |
| her sayfa | Çerez bildirimi (`A-Cerez`), dil menüsü (`A-Dil-Menusu`), telefonda açılır menü (`A-Menu-*`) |

### 3.2 Hesaba erişim
`/verify-email` (`A-Eposta-Dogrula`) · `/welcome` ilk video ücretsiz (`A-Karsilama`) · `/forgot-password` (`A-Sifre-Unuttum`) · `/forgot-password/sent` (`A-Sifre-Gonderildi`) · `/reset-password` (`A-Sifre-Yeni`).

### 3.3 Galeri ve şablonlar
| Yol | Ekran |
|---|---|
| `/gallery` | Yayınlanmış şablon kartları; kategori ve biçim süzgeci, arama. Durumlar: yükleniyor, sonuç yok (`Main`, `A-Galeri-Yukleniyor`, `A-Galeri-Sonuc-Yok`) |
| `/templates/[id]` | Örnek video, çekim listesi, kaç ürün istediği, "Clone it" (`A-Detay`); kullanıcının özel şablonu (`A-Detay-Ozel`) |
| `/templates/new` | Kendi videonu ekle: link, hazırlık ilerlemesi (`A-Video-Ekle`) |

### 3.4 Video üretimi
| Yol | Ekran |
|---|---|
| `/templates/[id]/generate` | Üretim formu: ürünler (görsel + ad), kalite, varyant, video dili; hatalı alanlar (`A-Form`, `A-Form-Hata`) |
| pencere | Kredi onayı; kredi yetmiyorsa paket alma yolu (`A-Onay`, `A-Onay-Yetersiz`) |
| `/jobs/[id]` | İş takibi (aşamalar canlı), iş durdu (neden + kaldığı yerden devam), sonuç, birden çok varyant (`A-Is-Takibi`, `A-Is-Durdu`, `A-Sonuc`, `A-Sonuc-Varyant`) |
| `/jobs/[id]/compare` | Varyantları yan yana izleme (`A-Karsilastir`) |
| pencere | Video oynatıcı (`A-Oynatici`) |

### 3.5 Videolarım
`/videos`: geçmiş ve süren işler; boş hâl (`A-Uretimlerim`, `A-Uretimlerim-Bos`).

### 3.6 Kredi ve hesap
`/account`: bakiye, kredi hareketleri, profil, arayüz dili, faturalar, çıkış, hesabı sil (`A-Hesap`, `A-Hesap-Sil`) · `/checkout/success` (`A-Odeme-Basarili`) · `/checkout/failed` (`A-Odeme-Basarisiz`) · `/invoices/[id]` yazdırılabilir fatura, A4 (`A-Fatura`).

### 3.7 E-postalar
Doğrulama, şifre sıfırlama, video hazır, iş durdu, ödeme alındı (`E-Dogrulama`, `E-Sifre`, `E-Hazir`, `E-Durdu`, `E-Odeme`). Bu planda gönderilmez; `/dev/emails/[ad]` altında önizlenir.

### 3.8 Yönetim paneli (yalnız yönetici)
Menü: Overview · Users · Revenue · Jobs · Templates · Settings.
| Yol | Ekran |
|---|---|
| `/admin` | Genel bakış: kullanıcı, ödeme yapan, gelir, satılan / harcanan kredi, ücretsiz video, üretim maliyeti, kâr; ilgilenilecekler; son alımlar ve kayıtlar (`A-Admin-Genel`) |
| `/admin/users`, `/admin/users/[id]` | Kullanıcı listesi; kullanıcı detayı: bakiye, alımlar, işler, kredi geçmişi, kredi ekle, engelle (`A-Kullanicilar`, `A-Kullanici-Detay`) |
| `/admin/revenue`, `/admin/revenue/credits` | Alımlar, pakete göre gelir; kredi defteri, kaliteye ve biçime göre harcama (`A-Gelir`, `A-Krediler`) |
| `/admin/jobs` | Bütün işler, duran işin nedeni, yeniden dene, kredi iade (`A-Isler`) |
| `/admin/templates`, `/admin/templates/inbox`, `/admin/templates/[id]`, `/admin/templates/scans` | Şablon listesi; tarama adayları ve yayın bekleyenler; çekim listesini elle düzeltme; tarama geçmişi (`A-Sablonlar`, `A-Gelen`, `A-Gelen-Bos`, `A-Sablon-Duzenle`, `A-Tarama`) |
| `/admin/settings` | Üretim hesabı / anahtar, tarama saatleri, eşikler, günlük tavanlar (`A-Ayarlar`) |

Referans (orijinal) video sadece yönetimde ve kullanıcının kendi yüklediği şablonda görünür. Yayınlanmış galeride yalnız sistemin ürettiği örnek oynar.

Fiyat, paket boyutu, iade koşulu, kredi geçerlilik süresi ve hukuk metinleri yer tutucudur; sahip belirler.

## 4. Şablonun yaşam döngüsü

```
aday ──ön eleme──▶ gelen ──(puan ≥ eşik: otomatik | sahip: elle)──▶ hazırlanıyor
hazırlanıyor ──kontrol geçti──▶ hazır (doğrulanmadı) ──örnek üretildi + "Yayınla"──▶ yayında
hazırlanıyor ──kontrol kaldı──▶ hazırlanamadı (neden yazılı)
kullanıcının yüklediği video ──▶ hazırlanıyor ──▶ özel şablon (deneysel, sadece yükleyene)
```

- **Örnek:** "hazır (doğrulanmadı)" şablonda sahip "Örnek üret"e basar (normal üretim, kredi onaylı) ya da o şablonla yaptığı ilk gerçek üretimi örnek olarak işaretler. sahip bakmadan kredi harcanmaz.
- **Yayınla:** sahip örneği referansla yan yana izler, uygunsa yayınlar. Galeride sadece "yayında" olanlar görünür.
- **Başlangıç verisi:** mevcut iki iş ilk iki şablon olur: `productions/layering-01` (konuşmasız, taslak 006) ve `productions/lashly-01` (konuşmalı, taslak 005). "Hazır (doğrulanmadı)" durumunda başlarlar, eldeki taslaklar örnek olarak eklenir (yeni kredi yok); yayınlamak sahibin kararıdır. `references/_candidates/2026-10-03-secim/` altındaki 10 aday "Gelen"e alınır.

## 5. Sahne listesi (`template.json`)

Şablon, kurgu kodu değil veridir. Hypit'in iki zamanlama biçimine karşılık iki mod vardır; ikisi de serbest uzunlukta çekim listesi taşır.

| Mod | Zaman | Mevcut örnek |
|---|---|---|
| `beats` | Sabit zaman çizelgesi; her çekim ve yazı kare numarasıyla (`at`, `for`) yerleşir. Konuşma yok, müzik var | `layering-01` |
| `speech` | Zamanı konuşma belirler; senaryo bölümleri çekim olur, yazılar ve ürün kartları senaryodaki işaretlere bağlanır, kelime kelime altyazı | `lashly-01` |

Alanlar:

```jsonc
{
  "id": "tpl_…",
  "source": { "kind": "topads | shorts | link | upload", "url": "…", "metrics": { "views": 0, "likes": 0, "ctr_band": "…" } },
  "title": "…", "category": "…", "tags": ["el+ürün", "konuşmasız"],
  "mode": "beats",
  "canvas": { "width": 720, "height": 1280, "fps": 30 },
  "products": { "min": 1, "max": 5 },          // şablonun istediği ürün sayısı
  "people": "none | hands | face",
  "shots": [
    { "id": "s1", "at": 0, "for": 39,           // kare; speech modunda bölüm adı
      "products": ["all"],                       // bu çekimde görünen ürün(ler)
      "still_prompt": "kadraj, mekân, ışık, ürünün duruşu; {product} yer tutucularıyla",
      "motion_prompt": "kamera ve el hareketi",
      "clip_seconds": 4 }
  ],
  "texts": [
    { "id": "t1", "at": 0, "for": 39,
      "box": { "left": 6, "top": 41, "right": 94, "bottom": 45.5 },   // tuvalin yüzdesi
      "style": "hook",
      "copy": "the best {benefit} {category} combo",                  // uyarlanacak kalıp
      "source_copy": "referanstaki özgün yazı" }
  ],
  "styles": { "hook": { "font": "inter", "weight": 600, "size": 27, "align": "center", "fill": "#FFFFFF", "shadows": [] } },
  "audio": { "music": { "prompt": "hava, tempo, enstrüman; sadece enstrümantal", "gain": 0.9 } },
  // sadece speech modunda:
  "script": { "segments": [ { "id": "hook", "lines": "işaretli senaryo kalıbı", "action": "oyunculuk notu", "seconds": 12 } ] },
  "presenter": { "still_prompt": "…", "voice": { "voice_id": "…", "sample_text": "…" } },
  "cards": [ { "selection": "product", "image": "product:1", "box": { } } ],
  "captions": { "style": "word-by-word" }
}
```

Kurallar:
- `still_prompt` ve `motion_prompt` referansı metinle tarif eder. Referans kareleri üretime görsel olarak verilmez; rakip marka adı prompt'a girmez.
- Motorun kuramadığı yapılar (bölünmüş ekran, yeşil perde, çekim içi geçiş efektleri, 60 sn üstü) ön elemede "desteklenmiyor" olarak işaretlenir ve şablona dönüşmez.

## 6. Parçalar

Her parça tek iş yapar ve ötekilerle dosya/tablo üzerinden konuşur.

| Parça | Girdi → çıktı | Bağımlılık |
|---|---|---|
| `scan` | zamanlayıcı → yeni adaylar (meta + video dosyası) | Playwright (Top Ads), `yt-dlp` (Shorts) |
| `template` | aday videosu → puan, sonra `template.json` | `hk transcribe`, `hypit media tile`, LLM |
| `compose` | `template.json` + `fill.json` → `main.svml`, `recipes.svs`, `main.svrun` | yok (saf dönüştürücü) |
| `produce` | şablon + ürün girdisi → mp4 | LLM (uyarlama), `bin/hk`, `bin/magnific.py`, `compose` |
| `web` | ekranlar + API | SQLite, dosyalar |
| `worker` | iş kuyruğunu yürütür | yukarıdakiler |

- **`compose`** tek ve test edilmiş kurgu üreticisidir. Bilinen Hypit 0.2.17 hatalarını bir kez kodlar: çıkış animasyonu yok, `typo:Stroke` yerine iki gölge, satır başına ayrı `Area`.
- **Çeviri (`web`):** arayüzdeki her metin çeviri dosyasından okunur, kodda sabit metin olmaz. Şablon başlığı ve açıklaması gibi LLM'in yazdığı metinler dil başına saklanır. Yerleşimler uzayan metne dayanacak şekilde esnek kurulur.
- **LLM arayüzü** değiştirilebilir: `run(prompt, dosyalar, şema) → JSON`. Şimdi `claude -p` (bu Mac'teki abonelik; API anahtarı yok), satışta Claude API.
- **Yerleşim:** Next.js uygulaması (arayüz + API) ve ayrı bir Node worker süreci; ikisi de `launchd` ile ayakta. Veri `data/` altında ve git dışında: `db.sqlite`, `sources/<id>/`, `templates/<id>/`, `jobs/<id>/`.
- Mevcut `packages/provider-magnific`, `bin/hk`, `bin/magnific.py` olduğu gibi kullanılır.

## 7. Arka plan işleri

### 7.1 Tarama (ücretsiz)
- Günde 3 kez (varsayılan 09:00, 15:00, 21:00; Ayarlar'dan değişir).
- **Top Ads:** ABD, son 7 gün, tüm sektörler; kart başına sektör, marka, beğeni, CTR dilimi, video. Girişsiz ve proxy'siz açıldığı 2026-10-03'te bu Mac'ten doğrulandı.
- **Shorts:** Ayarlar'daki arama listesiyle `yt-dlp` araması; izlenme ve süre gelir.
- Sayısal ön süzgeç (LLM'siz): süre 6–35 sn; Shorts için en az 500.000 izlenme; Top Ads için beğeniye göre sıralı ilk 30 kart. Daha önce görülen video atlanır. Tarama başına en çok 15 aday ön elemeye geçer.
- Kapsam dışı kaynaklar: organik TikTok hashtag/arama (KG IP'de "Page not available"), Instagram Reels (giriş ister).

### 7.2 Ön eleme ve şablon hazırlama (ücretsiz, LLM)
1. Video yazıya dökülür ve kare tablosu çıkarılır.
2. **Ön eleme:** LLM kare tablosu + dökümle 0–100 puan verir: ürün görünürlüğü, yüz/konuşma riski ("AI belli"), çekim sayısı, motorun kurup kuramayacağı. Sonuç adayla birlikte saklanır. Varsayılan eşik 70 (Ayarlar'dan değişir).
3. Puan eşiğin üstündeyse (ya da sahip "galeriye al" derse, ya da kullanıcı kendi videosunu yüklediyse) LLM `template.json` yazar.
4. **Otomatik kontrol:** şema doğrulaması → `compose` örnek dolguyla kurgu üretir → `hk check` → `hk plan`. Geçerse "hazır (doğrulanmadı)", kalırsa "hazırlanamadı" + neden.
- Günlük tavanlar (Ayarlar): ön elemeye giren aday sayısı (varsayılan 45) ve hazırlanan şablon sayısı (varsayılan 10). Amaç abonelik kullanımını sınırlamak.

### 7.3 Üretim (ücretli, onaylı)
1. **Tahmin ve onay:** şablondan hesaplanır, hiçbir ücretli istek gitmeden gösterilir: görsel sayısı, klip sayısı ve toplam saniye, müzik/ses istekleri, varyant çarpanı, tahmini süre. Kullanıcı onaylar.
2. **Uyarlama (LLM):** ürün adı, bilgisi ve görsellerine göre yazı kalıpları, senaryo ve prompt'lar doldurulur → `fill.json`.
3. **Görseller:** her çekim için ilk kare, Nano Banana Pro, yüklenen ürün görselleri referans.
4. **Klipler:** ilk kareden video. Konuşmalı modda sunucu görseli + ses örneğiyle çekim.
5. **Müzik / ses:** Lyria müzik; konuşmalı modda ElevenLabs ses örneği.
6. **Kurgu ve render:** `compose` → `hk check` → `hk plan` → `hk build` → mp4.
- `hk plan`'ın ücretli istek sayısı onaylanan tahmini aşarsa iş durur ve yeniden onay ister.
- Ücretli API adımları paralel (en çok 3), render aynı anda tek.
- **Kalite kademeleri** yapılandırmadır (kademe → model + çözünürlük). Başlangıç: Hızlı = Seedance 2 Mini 720p; Kalite = Seedance 2.5 Pro 1080p. Seedance arıza verirse Kling 3'e geçiş teklif edilir (mevcut `main-kling.svrun` yolu). Kademelerin son hali ilk onaylı gerçek denemeyle kesinleşir.
- **Varyant:** her varyant görselleri ve klipleri yeniden üretir; kredi ve render süresi varyant sayısıyla çarpılır.

## 8. Hesap, kredi, ödeme, anahtar

Satış sürümü (hedef):
- **Müşteri hesabı:** e-posta + şifre ya da Google. E-posta doğrulanınca bir ücretsiz video hakkı açılır. Şifre sıfırlama e-postayla. Hesabı silme: videolar ve şablonlar silinir, kalan kredi yanar, faturalar `[INVOICE RETENTION]` süresince saklanır.
- **Kredi:** paket alınır, bakiye artar; iş onaylanınca tahmin kadar kredi düşer. Duran işi sürdürmek yalnız eksik parça kadar kredi ister. Her hareket kredi defterine yazılır (alım, üretim, ücretsiz video, yöneticinin eklediği, iade).
- **Ödeme:** sağlayıcının kendi ödeme sayfası (kart formu sitede yok). Başarılıysa `/checkout/success` + fatura + e-posta; değilse `/checkout/failed`. Sağlayıcı seçilmedi; vergi ve faturayı sağlayıcının üstlenip üstlenmediği doğrulanmadı.
- **Üretim anahtarı:** müşteri anahtar görmez. Üretim sitenin kendi Magnific + Claude API hesabıyla yapılır; anahtar yalnız yönetimde, sunucu tarafında, gizli değişkende durur. Hiçbir dosyaya, log'a ya da veritabanına yazılmaz.
- **Yönetici:** hesabında yönetici rolü olan kullanıcı `/admin` altını görür; öteki herkese 404.

Bu planda (yerel, sahte veri): giriş gerçek şifre denetlemez (deneme hesabı), ödeme sahte sağlayıcı sayfasından geçer, e-posta gönderilmez, üretim sahte iş yürütücüsüyle ilerler. Ayrıntı §15.

## 9. Hata durumları

| Durum | Davranış |
|---|---|
| Magnific isteği hata verdi | Otomatik tekrar yok. İş "durdu" olur, biten çıktılar saklanır. "Kaldığı yerden devam" sadece eksik adımlar için yeni tahmin + onay ister |
| Gönderim sonucu belirsiz (`MAGNIFIC_SUBMISSION_UNKNOWN`) | Tekrar gönderilmez; kullanıcıya görev listesini kontrol etmesi söylenir |
| Seedance 500 | Kling'e geçiş teklif edilir, maliyet farkı gösterilir |
| Şablon kontrolü kaldı | "Hazırlanamadı" + neden; galeriye girmez |
| Bir tarama kaynağı çöktü | Öteki kaynak sürer; "Gelen"de uyarı |
| LLM geçersiz JSON döndürdü | Bir kez yeniden istenir (ücretsiz); yine geçersizse adım hata verir |
| Günlük LLM tavanı doldu | Kalan adaylar ertesi güne kalır |
| Worker yeniden başladı | Yarım işler kayıtlı adımdan sürer; ücretli adım yeniden gönderilmez |

## 10. Test ve doğrulama

- **`compose` altın örnekleri:** `layering-01` ve `lashly-01` sahne listesine çevrilir; `compose` çıktısı `hk check`'ten geçmeli ve `hk plan`'da özgün kurguyla aynı ücretli istek sayısını vermeli.
- **Birim:** şema doğrulaması, kredi tahmini, sayısal ön süzgeç, tekrar eleme.
- **Uçtan uca, sahte sağlayıcıyla:** hazır medya döndüren sahte Magnific ile şablon → ürün → mp4. Onaysız hiçbir ücretli istek gitmediği sayaçla doğrulanır.
- **Arayüz:** Playwright ile her ekran ve durum.
- **Gerçek kredili deneme:** kademe başına bir kez, sahibin adet + kredi onayıyla.

Kabul ölçütleri:
1. Galeriden şablon seç, ürün yükle, "Üret": mp4 iner. Hızlı kademede 8–15 sn konuşmasız video 10 dk içinde biter.
2. Çıktının çekim sayısı, sırası, süreleri ve yazı zamanları `template.json` ile kare düzeyinde eşleşir. Görsel benzerliği sahip yan yana izleyerek onaylar.
3. Tarama günde 3 kez kendiliğinden çalışır; yeni adaylar "Gelen"e düşer, tekrar yok.
4. Eşiği geçen aday insan eli değmeden "hazır (doğrulanmadı)" olur.
5. Onay penceresi olmadan hiçbir ücretli istek gitmez.
6. Tailscale'deki ikinci cihazdan site açılır ve üretim başlatılır.
7. Kullanıcının yüklediği videodan özel şablon çıkar ve üretim yapılır.

## 11. Kurulum sırası (tek plan, altı aşama)

1. `compose` motoru + iki altın örnek
2. Üretim hattı, iş kuyruğu, sahte sağlayıcı
3. Site: galeri, detay, form, takip, sonuç, Üretimlerim (seçilen görsel tasarımla)
4. Şablon hazırlama, "Gelen", "Kendi videonu ekle"
5. Tarama (Top Ads, Shorts, zamanlayıcı)
6. Ayarlar (anahtar, eşikler, tavanlar) + Tailscale

Her aşamanın sonunda çalışan ve doğrulanabilir bir şey vardır.

## 12. Bilinen sınırlar ve açık noktalar

- **Süre:** 30 sn konuşmalı video yaklaşık 12 dk sürer (render tek başına 5,5 dk, laptopta ölçüldü). 3 varyant render süresini üçe katlar.
- **Konuşan yüz:** "AI belli" riski sürüyor; ön eleme bu videolara düşük puan verir.
- **Kredi karşılığı:** kodda Magnific fiyat tablosu yok. Tahmin penceresi istek sayısı ve klip saniyesini gösterir; kredi rakamı için model başına fiyat tablosu plan aşamasında Magnific fiyat sayfasından doldurulur.
- **Galerinin büyüme hızı:** örnek onayla üretildiği için galeri sahibin onay hızında büyür. Binlerce şablon için ileride "otomatik örnek + günlük kredi tavanı" gerekir.
- **Kling çözünürlüğü:** `bin/magnific.py kling` çözünürlük seçeneği taşımıyor; çıktı çözünürlüğü doğrulanmadı.
- **Videonun dili:** arayüz dili ile videonun içindeki yazı ve konuşmanın dili ayrı şeylerdir. Üretim formunda "video dili" seçimi olup olmayacağı açık (sahibin kararı).

## 13. Kapsam dışı

Bu planda yok: gerçek ödeme sağlayıcı, gerçek kimlik doğrulama ve e-posta gönderimi, bulut render, Hypit ticari lisansı, kendi Claude API hesabı, deploy ve alan adı, ücretli üretim. Bunların hepsi §15'teki arayüzlerin arkasında sahte uygulamayla durur; gerçeği takılınca ekranlar değişmez.
Hiçbir planda yok: site içi reklam / promosyon, abonelik, organik TikTok ve Reels taraması, çıktıların harici bir klasöre otomatik kaydı, referans videonun yayınlanmış galeride gösterilmesi.

## 14. Görsel tasarım: A — Karanlık Sinema (dark + light)

Tuval: https://claude.ai/artifact/21i2pwpf1c5JFSMBzvmyoN. Sayfalar: 1 Logo study · 2 Branding · 3 Website (kaynak: masaüstü, dark) · 4 Website · Light · 5 Mobile · Dark · 6 Mobile · Light. Yerel kopya ve üreteçler: `docs/design/tuval/`, `docs/design/uretec/` (kurallar: `uretec/KURALLAR.md`).

| Belirteç | Dark | Light |
|---|---|---|
| `--bg` zemin | `#0B0C0A` | `#F4F5EE` |
| `--surface` kart | `#151712` | `#FFFFFF` |
| `--raised` seçili / kabarık | `#1C1F17` | `#E8EADF` |
| `--line` ince çizgi | `#23261E` | `#E0E2D7` |
| `--edge` kenar | `#33372B` | `#CBCEBF` |
| `--edge-strong` kontrol kenarı | `#676B5D` | `#80856F` |
| `--text` / `--text-2` / `--text-3` | `#F2F3EC` / `#C9CCBF` / `#A9AC9F` | `#0B0C0A` / `#3E4236` / `#5A5F50` |
| `--accent` lime dolgu (üstü `--on-accent` `#0B0C0A`) | `#C8F03C` | `#C8F03C` |
| `--accent-hover` | `#E0FF7A` | `#B6E01F` |
| `--accent-text` vurgulu yazı, bağlantı | `#C8F03C` | `#456300` |
| `--warn` / `--warn-edge` | `#FF9A6B` / `#5A3A2A` | `#A8400F` / `#E3B7A2` |
| `--scrim` + `--on-scrim` video üstü etiket | `rgba(11,12,10,0.76)` + `#F2F3EC` | aynı |

| Öğe | Değer |
|---|---|
| Başlık yazısı | Bricolage Grotesque 700–800, sıkı harf aralığı |
| Gövde yazısı | Onest 400 / 500 / 600 |
| Yazı basamakları | 13 / 15 / 17 / 20 / 24 / 32 + akışkan başlıklar (`clamp`) |
| Boşluk | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 / 112 |
| Köşe | 8 / 12 / 16 / 24 / tam |
| Kontrol yüksekliği | 44 / 52 / 60 / 72; dokunma hedefi en az 44 |
| İkon | 24'lük ızgara, çizgi 2, yuvarlak uç (`Marka-Ikonlar`) |
| Kart | 9:16 video, üstünde biçim ve süre etiketi, altında başlık + kategori + referans izlenmesi |
| Telefon | Genişlik 390 örnek alınır; üst menü logo + bakiye (ya da "Get started") + menü düğmesi, menü tam ekran açılır; video kartları iki sütun; tablolar kendi kutusunda yana kayar; pencereler alttan tam genişlik |

Kurallar: video ön planda, süsleme yok; aynı anda görünen alanda tek bir lime panel ya da tek bir lime ana düğme (üst menüdeki "Get started" sayılmaz); lime yazı yalnız `--accent-text` ile; durum rengi her zaman bir yazı ve biçimle birlikte verilir.

## 15. Site mimarisi (site)

**Yığın:** Next.js (App Router) + React + TypeScript (strict), Tailwind CSS v4 (tema yalnız §14 belirteç ve basamaklarını taşır), Vitest + Testing Library, Playwright. Paket yöneticisi pnpm. Uygulama `web/` klasöründe; kök `package.json` ve mevcut `bin/`, `packages/` değişmez.

**Klasörler (`web/src`):**
```
app/                    yollar (§3); yalnız sayfa kabuğu, iş mantığı yok
core/                   en alt katman: tasarım belirteçleri, i18n, oturum, yapılandırma; hiçbir şeyi bilmez
shared/ui/              ortak bileşenler: Button, Field, Header (müşteri / ziyaretçi / panel / telefon), Footer, VideoCard, StatusLine, Tile, DataTable, Dialog, Segmented, EmptyState, Skeleton, Icon
shared/lib/             saf yardımcılar (kredi biçimi, tarih, çoğul)
features/<ad>/          gallery, generate, jobs, videos, account, auth, checkout, marketing, admin-*; bir feature ötekini import etmez
data/                   arayüzler (ports) + sahte uygulamalar (fixtures, bellek içi depo)
messages/               en.json (kaynak), tr.json
```
Kural: `features/X` → `features/Y` import edemez; ortak şey `shared` ya da `core`'a iner. `shared` feature bilmez.

**Veri arayüzleri (`data/ports.ts`) ve bu plandaki sahte uygulamalar:**
| Arayüz | İş | Sahte uygulama |
|---|---|---|
| `AuthService` | kayıt, giriş, çıkış, e-posta doğrulama, şifre sıfırlama, oturum | çerezde deneme oturumu; şifre denetlenmez; doğrulama bağlantısı ekranda "bağlantıya tıkladım" düğmesi |
| `TemplateCatalog` | şablon listesi / arama / detay, özel şablon ekleme | 6 gerçek şablon (tuvaldeki görseller) + bellekte özel şablonlar |
| `JobRunner` | tahmin, başlat, durum, devam, varyantlar | zamanla ilerleyen sahte iş; bir sahte şablon "durdu" hâlini gösterir; çıktı örnek video / görsel |
| `CreditLedger` | bakiye, hareketler, harcama, ekleme | bellek içi defter |
| `PaymentGateway` | paketler, ödeme başlat, sonuç | sahte ödeme sayfası: "Pay" / "Decline" |
| `InvoiceStore` | fatura listesi, fatura | bellek içi, yer tutucu değerler |
| `Mailer` | beş e-postayı gönder | göndermez; `/dev/emails` önizlemesi + sunucu log'u |
| `AdminQueries` | panel sayıları, tablolar, kullanıcı / iş / şablon eylemleri | fixtures üzerinde hesaplanır |

Gerçek uygulama (üretim sistemi ve sonrası) aynı arayüzü uygular; hangi uygulamanın takılacağı tek yerde (`data/index.ts`) seçilir. Fiyat, paket ve vergi değerleri yapılandırmadan gelir; yapılandırma boşken arayüz yer tutucuyu gösterir (uydurma rakam yok).

**Tema:** `<html data-theme>`; varsayılan sistem tercihi, kullanıcı Account → Profile'da "Appearance: System / Dark / Light" seçer (çerezde saklanır). **Dil:** çerezdeki `locale` (en / tr); dil menüsü ve Account'tan değişir; kodda sabit metin yok, çoğullar `Intl.PluralRules`.
**Erişilebilirlik:** WCAG 2.2 AA; gerçek `button` / `a` / `label`; klavye ile bütün akış; odak halkası; pencerelerde odak tuzağı; `prefers-reduced-motion`.
**Güvenlik:** form girdileri sunucuda şemayla doğrulanır; `/admin` rol denetimi sunucuda; gizli değer istemciye inmez.

## 16. Site kabul ölçütleri (site)

1. §3'teki her yol açılır ve tuvaldeki panosuyla aynı görünür: masaüstü (1440) ve telefon (390), dark ve light. Karşılaştırma Playwright ekran görüntüsüyle, göz kontrolü.
2. Müşteri yolu baştan sona tıklanır: kayıt → doğrulama → karşılama → galeri → şablon → form → onay → iş takibi → sonuç → videolarım; kredi yetmezse paket alma → ödeme → onaya dönüş.
3. Durumlar görünür: yükleniyor, sonuç yok, boş liste, form hatası, yetersiz kredi, iş durdu, ödeme tamamlanmadı, 404.
4. Yönetim paneli yalnız yönetici oturumunda açılır; kullanıcıya kredi eklemek deftere ve bakiyeye yansır.
5. Arayüz dili English ↔ Türkçe değişir; kodda sabit metin kalmaz. Tema System / Dark / Light değişir.
6. Onay penceresi olmadan kredi düşmez; sahte uygulamalar dışında hiçbir ağ isteği gitmez (ücretli API yok).
7. `pnpm test` ve `pnpm e2e` geçer; `pnpm lint` ve `tsc --noEmit` temiz.
