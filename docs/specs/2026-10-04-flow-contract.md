# Viral Clone — akış sözleşmesi (ürün kuralları, para, hesap, hata)

Tarih: 2026-10-04 · Kaynak: 229 ekranlık tasarım incelemesi, `web/src/data/ports.ts`, `web/src/data/mock/demo-values.ts`.

Bu belge: fiyat, ücretsiz hak, ücret onayı, ödeme ve hata kuralları tek yerde. Tasarım tuvali, site kodu ve motor aynı değerleri buradan alır. Bir değer değişirse önce burası değişir.

**Kararların biçimi.** Her karar `Karar — neden — yanlışsa ne değişir` biçiminde §13'te listeli.

**İkinci inceleme (2026-10-04 akşam).** Üzerine eklenenler `(R2)` gibi işaretli; kararları K19–K29, backend'e düşenleri B15–B20.

**Durum etiketleri.** `KESİN` = sahibin kararı ya da kodda zaten böyle. `ÖNERİ` = öneri, onaylanmadı. `ÖLÇÜM BEKLİYOR` = gerçek maliyet denemesinden sonra kesinleşir.

---

## 1. Ürün kuralları tablosu (tek kaynak)

### 1.1 Kredi paketleri — ÖNERİ, ÖLÇÜM BEKLİYOR

| Paket | Kredi | Fiyat | Yaklaşık video (konuşmasız, Fast, 1 varyant) |
|---|---:|---:|---:|
| Starter | 10 | $19 | 5 |
| Standard | 30 | $54 | 15 |
| Studio | 100 | $169 | 50 |

- Para birimi USD. Abonelik yok (sahip). Tek seferlik satın alma.
- Fiyatlara vergi dahil değil; vergi, ödeme sayfasında ödeme sağlayıcı tarafından eklenir. UI: `Prices are in US dollars. Tax is added at checkout where it applies.`
- "Yaklaşık video" hesabının dayanağı her yerde yazılır: `About 5 videos` altında `No talking · Fast · one variant`.
- Paket adları kodla aynı (`web/src/data/mock/demo-values.ts`: Starter, Standard, Studio).

### 1.2 Video başına kredi — ÖNERİ, ÖLÇÜM BEKLİYOR

| Biçim | Fast (720p) | Best (1080p) |
|---|---:|---:|
| No talking | 2 | 5 |
| Talking | 4 | 8 |

- Bir işin kredisi = tablo değeri × varyant sayısı (1, 2 ya da 3). Şablonun uzunluğu fiyatı değiştirmez.
- **Fiyat sabittir, tahmin değildir.** Onay ekranında görülen kredi, alınan kredidir. Tahmin olan tek şey süredir (`about 7 min`).
- Kendi videonu şablona çevirmek: **1 kredi** (§4).
- Kodda `JOB_COST` konuşmalı için 6 / 12 (demo değeri); sözleşme 4 / 8 der (araştırmanın gerekçesi: konuşmalı Fast'in maliyeti konuşmasız Fast'e yakın).

### 1.3 Desteklenen kapsam

| Konu | Değer | Durum |
|---|---|---|
| Çıktı oranı | Yalnız 9:16 dikey. Başka oran seçeneği gösterilmez. | KESİN |
| Kalite | Fast = 720p, Best = 1080p | KESİN |
| Video uzunluğu | Şablonun uzunluğu (şu an 8–17 sn). Müşteri değiştiremez. | KESİN |
| Varyant | 1–3 | KESİN (kod) |
| Ürün sayısı | Şablon belirler (`Template.products`). | KESİN (kod) |
| Ürün görseli | Ürün başına 1–8 görsel · JPG, PNG ya da WebP · görsel başına en çok 10 MB · kısa kenar en az 600 px | adet KESİN (kod), tür ve boyut ÖNERİ |
| Kendi videosu | mp4 ya da mov · en çok 60 sn · en çok 100 MB · dikey (9:16) | tür ve süre KESİN (tasarım), boyut ÖNERİ |
| Kabul edilen bağlantılar | Herkese açık TikTok, Instagram Reels, YouTube Shorts bağlantısı | ÖNERİ |
| Arayüz dili | English, Türkçe | KESİN (sahip) |
| Video dili (ekran yazısı ve ses) | Yayında: English, Türkçe | ÖNERİ |
| Konuşmalı şablonlar | Motor konuşmalı biçimi kanıtlayana kadar galeride gizli (yönetim ayarı `Show talking templates`, varsayılan kapalı). Bu bir yayın anahtarıdır: tuval ürünü anahtar açıkken gösterir (galeride konuşmalı kart ve süzgeç, fiyat tablosunda konuşmalı satırlar durur). | ÖNERİ |

### 1.4 Süreler ve sınırlar

| Konu | Değer | Durum |
|---|---|---|
| Şifre | En az 8 karakter | ÖNERİ |
| Doğrulama bağlantısı | 24 saat geçerli, bir kez kullanılır | ÖNERİ |
| Şifre sıfırlama bağlantısı | 1 saat geçerli, bir kez kullanılır | ÖNERİ |
| Yeniden gönderme beklemesi | 60 saniye | ÖNERİ |
| Yanlış giriş | 5 yanlış denemeden sonra 15 dakika bekleme | ÖNERİ |
| Oturum | 30 gün; bitince giriş sayfası, sonra kaldığı sayfaya döner | ÖNERİ |
| Form taslağı | İş başlayana kadar ya da 24 saat saklanır (yazılar, seçimler ve yüklenmiş görseller) | ÖNERİ (kodda 30 dk, görseller hariç) |
| Destek yanıtı | 2 iş günü içinde | ÖNERİ |
| Ödeme doğrulama beklemesi | 60 sn otomatik denetim, sonra "gecikti" durumu | ÖNERİ |
| Aynı anda iş | Kullanıcı başına 2 (yönetim ayarı) | ÖNERİ |
| En dar ekran | 320 px: hiçbir sayfa yana taşmaz. 360 px altında telefon üst menüsünde logo yalnız işarettir (yazısız). (R7) | ÖNERİ |
| Kendi videosu | Kullanıcı başına günde 3 (yönetim ayarı) | ÖNERİ |

### 1.5 Kredi geçerliliği, iade, saklama

| Konu | Kural | Durum |
|---|---|---|
| Kredi geçerliliği | Krediler sona ermez. Hesap silinirse kalan kredi silinir. | ÖNERİ |
| Para iadesi | Paketten hiç kredi kullanılmadıysa satın almadan sonraki 14 gün içinde tam iade. Bir kredi bile kullanıldıysa para iadesi yok; kalan krediler geçerli kalır. **Kullanılmış kredi:** teslim edilmiş bir videoya ya da hazırlanmış bir şablona gitmiş kredi. Duran işten geri dönen kredi kullanılmamış sayılır (R3). Yaşam döngüsü §8.1. | ÖNERİ |
| Teslim edilmeyen video | Kredisi otomatik geri gelir (§6). Para iadesi gerekmez. | ÖNERİ |
| Kötü çıktı | Müşteri 7 gün içinde bildirir (Result → `Report a problem`); haklıysa bir ücretsiz yeniden üretim. Karar destekte. | ÖNERİ |
| Ürün görselleri | İş bittikten 30 gün sonra silinir. Bu yüzden 30 günden sonra yeniden üretim yeni görsel yüklemesi ister (§10.1). | ÖNERİ |
| Duran işin parçaları | Biten parçalar ve ürün görselleri işin durduğu günden sonra 30 gün saklanır; müşteri bu sürede devam edebilir. Süre dolunca iş kendiliğinden kapanır, yeni ücret yok (R4). | ÖNERİ |
| Üretilen videolar | My videos'ta 12 ay durur; sonra silinir. Müşteri istediği an silebilir: `Delete`, onayla (§10.1). Silinen videonun kredisi geri dönmez. | ÖNERİ |
| Faturalar | Vergi mevzuatının istediği süre boyunca saklanır (süreyi muhasebeci belirler; metinde sayı yok). | ÖNERİ |
| Hesap silme | Videolar ve görseller silinir, kalan kredi silinir, faturalar yasal süre boyunca kalır. Çalışan iş varken hesap silinemez. | ÖNERİ |
| Çerez | Yayında yalnız zorunlu çerezler (oturum, dil, tema). İzin penceresi yok; bilgilendirme notu ve gizlilik bağlantısı var. Analitik eklenirse izin tercihi yüzeyi şart olur. | ÖNERİ |

### 1.6 Sahibinden beklenen girdiler (yer tutucu olarak kalır)

`[COMPANY NAME]` · `[ADDRESS]` · `[SUPPORT EMAIL]` · vergi numarası. Bunlar sahibin vereceği bilgiler; tasarımda yer tutucu kalmaları doğru. Alan adı satın alınmadı; `viralclone.app` adresinin boş olduğu RDAP ile doğrulanmadı.

Dinamik veri yer tutucuları da kalır: `[BALANCE]` `[BALANCE AFTER]` `[DATE]` `[AMOUNT]` `[INVOICE NUMBER]` `[VIDEO NAME]` `[COUNT]` `[EMAIL]` `[REFERENCE]` `[REASON]` `[NAME]` `[ADMIN NAME]` `[JOB ID]` `[TIME]`.

**Kalkması gereken yer tutucular** (değeri bu belgede var): `[PRICE]` `[CREDITS]` (kural değeri olan yerde) `[CREDIT AMOUNT]` `[CREDIT DIFFERENCE]` `[LINK VALIDITY]` `[MIN LENGTH]` `[RESPONSE TIME]` `[PRODUCT LIMIT]` `[MORE LANGUAGES]` `[INVOICE RETENTION]` `[LEGAL TEXT]`.

### 1.7 Örnek iş (bütün panolarda aynı)

`Fragrance layering recipe` · No talking · 8 sec · 4 products · Fast · 1 variant · English → **2 credits**. Best seçilirse 5; Fast ve 3 varyant seçilirse 6. Fiyat sayfası, form, onay, iş sayfası, e-posta ve yönetim aynı sayıyı gösterir.

---

## 2. Sözlük eki: iki ayrı "geri verme"

| Söz | Anlamı | Nerede |
|---|---|---|
| **returned** (`Credits returned`) | Kredi bakiyeye geri döner. Otomatik. | İş durdu, özel şablon olmadı, ücretsiz video geri geldi |
| **refund** (`Refund`) | Para, ödeme sağlayıcı üzerinden karta geri gider. | Kullanılmamış paket iadesi |

İkisi asla birbirinin yerine kullanılmaz.

---

## 3. Ücretsiz video

- E-postasını doğrulayan her hesaba **bir** ücretsiz video (sahip).
- Kapsam: **bir konuşmasız video, Fast kalite, bir varyant.** Uzunluk ve ürün sayısı sınırı yok (şablon ne diyorsa o). Filigran yok, indirme serbest, kart istenmez.
- Kapsam dışı: Talking, Best, ikinci ve üçüncü varyant, kendi videosunu şablona çevirme. Bunlar kredi ister.
- Ücretsiz iş durursa ücretsiz hak geri gelir (§6 ile aynı kural). Devam etmek hakkı yeniden kullanır (0 kredi); hak o arada başka bir işte kullanıldıysa devam normal fiyattır (§6 madde 10).
- Koşulların UI cümlesi (Welcome `What is free` ve Pricing SSS): `One no-talking video in Fast quality, one variant. No watermark, and you can download it. If the job stops, your free video comes back.`
- Müşterinin kendi şablonundan üretim de ücretsiz hakka girer (konuşmasız, Fast, bir varyant ise); şablonu hazırlamak yine 1 kredidir.
- Gösterim:
  - Gallery kartı: hak duruyorken konuşmasız şablonlarda `Free` etiketi. Ziyaretçi de görür.
  - Template detail: konuşmasız → `Free with your first video`; konuşmalı → `Needs credits · 4 credits`.
  - Generate form: Best ya da birden çok varyant seçilince `Your free video covers Fast quality and one variant. This choice costs 5 credits.`
  - Onay: `Free video · 0 credits`.
  - Hak kullanıldıysa hiçbir yerde `Free` etiketi görünmez; My videos boş hâli `Pick a template` der, "free" demez.
- Home ve Pricing'deki ücretsiz vaat sınırı aynı cümleyle söyler: `Your first video is free: one no-talking video in Fast quality. No card needed.`
- Kötüye kullanım önlemi (backend): doğrulanmış e-posta, kişi başına bir hak, geçici e-posta alan adları reddedilir, IP ve cihaz başına kayıt sınırı.

---

## 4. Kendi videosunu şablona çevirme

Sıra: dosya / bağlantı denetimi (ücretsiz) → ücret ve onay → hazırlanıyor (2–5 dk) → hazır | uymadı | başarısız.

| Adım | Ne olur | Kredi |
|---|---|---|
| Denetim | Tür, boyut, süre, oran; bağlantı açılıyor mu | Yok |
| Reddedildi | Neden ve ne yapılacağı söylenir (§7.2) | Yok |
| Onay | `Preparing this template costs 1 credit.` Bakiye, sonraki bakiye, `Prepare template` | Onayda 1 kredi alınır |
| Yetersiz bakiye | `You need 1 credit.` + `Buy credits` | Yok |
| Hazırlanıyor | Sayfadan çıkılabilir; liste satırı `Preparing` | — |
| Hazır | `Ready · visible only to you` | 1 kredi harcandı |
| Uymadı (ör. bölünmüş ekran) | `This video uses a split screen, and the system can't build that structure yet. Your credit was returned.` | 1 kredi geri döner |
| Başarısız | `We could not prepare this template. Your credit was returned.` + `Try again` | 1 kredi geri döner |
| Günlük sınır | `You reached today's limit for your own videos. Try again tomorrow.` | Yok |

Not: eski pano metni "No credits were spent" idi; kural artık "alındı, geri döndü" olduğu için `Your credit was returned.` olur.

---

## 5. Kredi onayı (üretim)

Onay penceresi şunları gösterir, bu sırayla:

1. Şablon adı ve seçimler: `Fragrance layering recipe · Fast · 1 variant · English`
2. **Final video**: `8 sec · 9:16 · 720p` (öne çıkar)
3. `Credits for this job` **2**
4. `Balance now` `[BALANCE]` · `After this job` `[BALANCE AFTER]`
5. `Estimated time` `about 7 min`
6. Açılır ayrıntı `What we generate`: `5 images · 5 clips (20 sec of footage) · 1 music track. The clips are cut to the template's 8 seconds.`
7. `Cancel` · `Confirm and generate`
8. Alt not (pencerede: `A-Onay` ve `A-Onay-Durumlar`'daki pencere hücreleri): `You are charged when you confirm. A job cannot be cancelled once it starts. If the video is not delivered, the credits come back.` (R5). Formdaki ve diğer panolardaki kısa not (`You are charged when you confirm. If the video is not delivered, the credits come back.`) aynı kalır.

Durumlar:

| Durum | Görünüş | Metin |
|---|---|---|
| Fiyat alınıyor | Satırlar iskelet, onay düğmesi kapalı | `Getting the price…` |
| Fiyat değişti | Uyarı kutusu, eski → yeni (üstü çizili 2, yeni 3), yeniden onay | `Our prices were updated since you opened this. This job is now 3 credits, not 2. Check and confirm again.` (R11: örnek, tarife güncellemesidir; 3 tarife tablosundaki hiçbir değere denk gelmez, kalite değişimi sanılmaz) |
| Bakiye değişti | Uyarı kutusu | `Your balance changed in another tab. Check and confirm again.` |
| Gönderiliyor | Düğme `Starting…`, ikisi de kapalı | `Starting your job. You will not be charged twice.` |
| Ücretsiz video | Kredi satırı `Free video · 0 credits` | `This uses your one free video.` |
| Yetersiz bakiye | Mevcut pano `A-Onay-Yetersiz` | `You need 2 credits and have [BALANCE].` |
| Üretim duraklatıldı | Onay kapalı | `Generation is paused for a short time. Nothing was charged. Try again later.` |
| Başlangıç doğrulanamadı | Onay kapalı, tek eylem | `We could not confirm that your job started. Check My videos before you try again. You are not charged twice.` · `Open My videos` (R6) |

Backend kuralı (kodda var): `start(…, idempotencyKey, confirmed)`; onaylanan ile şimdiki fark ederse hiçbir şey alınmaz (`EstimateChangedError`). Çift tıklama, sekme yenileme ve iki sekme aynı işi iki kez ücretlendirmez.

---

## 6. İş durunca: kredi kuralı

**İlke: müşteri yalnız teslim aldığı video için öder.**

1. Onayda işin kredisi alınır.
2. İş durursa (neden bizim tarafımızda: sağlayıcı ya da sistem), **teslim edilmemiş her videonun kredisi o an bakiyeye geri döner.** Defterde `Credits returned` satırı.
3. Biten parçalar (görseller, klipler, müzik) 30 gün saklanır; iş sayfası son günü söyler: `You can continue until [DATE].` Süre dolunca iş kendiliğinden kapanır (R4).
4. Müşteri üç şeyden birini seçer:

| Seçenek | Ne olur | Kredi |
|---|---|---|
| `Try again` | Yalnız eksik parçalar yeniden üretilir, aynı model | Geri dönen kredi kadar yeniden alınır (onayla) |
| `Continue with the backup model` | Yalnız eksik parçalar yedek modelle üretilir; görüntü biraz farklı olabilir | Aynı tutar. Yedek model için fark alınmaz. |
| `Stop the job here` | İş kapanır. Yarım videonun parçaları silinir; teslim edilmiş varyantlar kalır. | Yeni ücret yok; geri dönen kredi bakiyede kalır |

`Try again` aynı devam onayı penceresini açar (başlık `Try again`, alt satır `The same model generates the 2 missing clips again.`).

`Stop the job here` küçük bir onay ister (`A-Is-Kapat-Onay`): `Close this job? The saved parts are deleted. You can start a new job from the template; you see the price before you confirm.` · `Keep it` · `Close the job` (R12: fiyat kilidi yalnız açık işe aittir; kapatıp yeniden başlatmak yeni iştir, güncel fiyatla). Düğmeler `A-Hesap-Sil` kalıbı: güvenli seçenek `Keep it` geniş ve kenarlı (`--edge-strong`), `Close the job` dar ve `--warn` kenarlı; lime dolgu yok (R9).

Yöneticinin başlattığı `Retry job` müşteriden kredi almaz.

5. Devam onayı penceresi: `Credits returned when it stopped` 2 · `Continuing costs` 2 · `Balance after` `[BALANCE AFTER]` · not: `You never pay more than the price you first confirmed.` · eksik parçalar listesi (`2 clips`). Üç ek hâli (R2), `A-Is-Durumlar` panosunda birer hücre:

| Hâl | Satırlar | Metin / düğmeler |
|---|---|---|
| Ücretsiz iş, hak duruyor | `Returned when it stopped` → `Your free video` · `Continuing costs` → `Free video · 0 credits` · `Balance after` satırı yok | `This uses your one free video.` · `Cancel` · `Confirm and continue` |
| Ücretsiz iş, hak başka işte kullanılmış | Uyarı kutusu + ücretli satırlar (`Continuing costs` 2 · `Balance after`) | `Your free video was used on another job. Continuing this one costs 2 credits.` |
| Yetersiz bakiye (geri dönen kredi başka yerde harcanmış) | `A-Onay-Yetersiz` kalıbı | `You need 2 credits to continue and have [BALANCE].` · `Buy credits` · `Cancel` · not: `The saved parts wait for you until [DATE].` |
6. Otomatik yeniden deneme yok (mevcut tasarım ilkesi; korunur).
7. Çalışan iş iptal edilemez (v1). İş sayfası: `You can leave this page. We email you when it is ready.`
8. Çok varyantlı iş: teslim edilen varyantlar ücretlidir ve indirilebilir; durmuş varyantın kredisi geri döner; yalnız o varyant yeniden üretilebilir (`Generate the missing variant again · 2 credits`).
9. İçerik kuralına uymayan girdi (yetişkin içeriği, izinsiz gerçek kişi vb.): iş durur, kredi geri döner, devam ettirilemez; itiraz yolu `Contact support`.
10. Ücretsiz video ile başlamış iş durursa ücretsiz hak geri gelir; devam etmek hakkı yeniden kullanır (0 kredi, madde 5'teki ilk hâl). Hak o arada başka bir işte kullanıldıysa devam normal fiyattır (ikinci hâl); bakiye yetmezse üçüncü hâl. Ücretsiz müşteri hiçbir yerde `2 credits` cümlesine yönlendirilmez.

Durum metinleri (iş sayfası):

| Durum | Metin |
|---|---|
| Kuyrukta | `In queue. Your job starts when the one before it is done.` · `Position 2` · `Nothing more to do; you can leave this page.` |
| Beklenenden uzun | `This is taking longer than usual. Your job is still running; you do not need to start it again.` |
| Bağlantı yeniden kuruluyor | `Reconnecting… Your job keeps running while this page reconnects.` |
| Üretim duraklatıldı | `Generation is paused for a short time. Your job continues when it is back. Nothing extra is charged.` |
| Durdu | `Two clips could not be generated. The 2 credits for this video are back in your balance. The 5 finished images, 3 clips and the music are saved.` · `You can continue until [DATE].` |
| Kapatıldı | `Job closed. 2 credits were returned. Nothing else was charged.` |
| Kapatıldı · 30 gün doldu | `This job was closed after 30 days. Your 2 credits were returned when it stopped. Nothing else was charged.` |
| Durdu · içerik kuralı | `This job was stopped because the images or text break our content rules. Your 2 credits are back in your balance. This job cannot be continued.` · `Contact support` |
| Durdu · ücretsiz video | `Two clips could not be generated. Your free video is back. The finished parts are saved.` · `You can continue until [DATE].` |
| Varyant bekliyor / üretiliyor | Varyant karosunda durum etiketi: `Waiting` · `Generating` · `Done` · `Stopped` |

`E-Durdu` e-postası aynı kuralı söyler: `Your 2 credits are back in your balance. Open the job to continue or close it.` Alt satır: `Continuing costs 2 credits. You never pay more than the price you first confirmed.` + `The saved parts are kept for 30 days.` Ücretsiz işin e-postası ayrı hâldir ve panoda tweak'siz görünür (R2): `Your free video is back. Open the job to continue or close it.` · alt satır `Continuing is free: it uses your free video again.` + `The saved parts are kept for 30 days.`; `Credits returned` satırı yerine `Returned` → `Your free video`.

---

## 7. Yükleme

### 7.1 Ürün görseli (Generate form)

Şartlar yüklemeden önce görünür: `JPG, PNG or WebP · up to 10 MB each · 1 to 8 images per product`.

| Durum | Görünüş | Metin |
|---|---|---|
| Boş | Bırakma alanı + şartlar | `Drop images here or choose files` |
| Yükleniyor | Küçük resimde ilerleme çubuğu, yüzde | `Uploading… 60%` |
| Yüklendi | Küçük resim + `Replace` · `Remove` | — |
| Başarısız (ağ) | Küçük resimde uyarı | `Upload failed. Check your connection.` · `Try again` · `Remove` |
| Reddedildi | Dosya adıyla uyarı satırı | `photo.heic is not supported. Use JPG, PNG or WebP.` / `photo.png is larger than 10 MB.` / `This file could not be read.` / `You can add up to 8 images per product.` |
| Yükleme sürerken | Formun `Generate` düğmesi kapalı | `Wait for the uploads to finish.` |

Kural: hata yalnız sorunlu dosyayı etkiler; diğer alanlar ve yüklenmiş görseller korunur. Yüklemesi bitmemiş dosyayla iş başlatılamaz.

### 7.2 Kendi videosu (Add your own video)

Şartlar yüklemeden önce: `mp4 or mov · up to 60 sec · up to 100 MB · vertical (9:16)` ve `Public TikTok, Instagram Reels or YouTube Shorts link`.

| Neden | Metin |
|---|---|
| Tür | `This file type is not supported. Use mp4 or mov.` |
| Boyut | `This file is larger than 100 MB.` |
| Süre | `This video is longer than 60 seconds. Trim it and try again.` |
| Oran | `This video is not vertical. Use a 9:16 video.` |
| Bozuk dosya | `This file could not be read. Export it again and retry.` |
| Bağlantı açılmıyor | `We could not open this link. Check that it is correct.` |
| Özel video | `This video is private. Make it public or upload the file.` |
| Silinmiş video | `This video is no longer available.` |
| Desteklenmeyen site | `We can read TikTok, Instagram Reels and YouTube Shorts links. For other sites, upload the file.` |

Hepsinin sonunda: `Nothing was charged.`

---

## 8. Ödeme dönüşü

**Dönüş adresine gelmek başarı sayılmaz.** Kesin durum ödeme sağlayıcının bildirimidir.

| Durum | Sayfa | Metin | Eylem |
|---|---|---|---|
| Doğrulanıyor | `A-Odeme-Dogrulaniyor` | `Confirming your payment…` · `This usually takes a few seconds. Do not pay again.` | — (otomatik) |
| Ödendi | `A-Odeme-Basarili` (mevcut) | `Payment received. 30 credits added.` | `Back to your video` |
| Gecikti | `A-Odeme-Gecikti` | `We are still waiting for the payment provider. If the payment went through, your credits appear on their own and we email you. You do not need to pay again.` | `Check again` · `Contact support` |
| Reddedildi | `A-Odeme-Basarisiz` (mevcut, daraltılır) | `The payment was declined. Nothing was charged.` | `Try another payment method` |
| İptal | `A-Odeme-Durumlar` | `You left the checkout. Nothing was charged.` | `Back to pricing` |
| Oturum süresi doldu | `A-Odeme-Durumlar` | `This checkout expired. Nothing was charged. Start again from pricing.` | `Back to pricing` |

- Her sonuçta kayıtlı form korunur: `Your form is saved.` + `Back to your video`.
- Yenileme kredi eklemez (kodda `complete` checkout başına bir kez işler).
- Ödeme sayfası sağlayıcınındır; ayrı bir özel ödeme sayfası çizilmez. Sağlayıcı adı yazılmaz (`payment provider`); seçim sonraya bırakıldı.
- Fatura adı ve adresi ödeme sayfasında toplanır. Account yalnız ad ve e-posta gösterir. Düzeltme: `Wrong details on an invoice? Contact support.`

### 8.1 Para iadesi durumları (müşteri, Account → Purchases)

| Satır durumu | Görünen | Eylem / metin |
|---|---|---|
| İadeye uygun | `Paid` | `Request a refund` |
| Uygun değil | `Paid` | `Not refundable: credits from this pack were used.` ya da `…: more than 14 days ago.` |
| İstendi | `Refund requested` | `We answer within 2 business days. The 10 credits are held until then.` · `Cancel request` |
| İstek geri alındı | `Paid` (satırın üstünde bildirim) | `Request cancelled. Your 10 credits are available again.` |
| Gönderildi | `Refund sent` | `10 credits were removed. The money is on its way to your payment method; this takes a few days.` |
| İade edildi | `Refunded` | `Refunded on [DATE]. $19 went back to your payment method.` |
| İade olmadı | `Refund failed` | `The refund did not go through. Your 10 credits are back in your balance. Contact support and we sort it out.` · `Contact support` |

Örnek paket her yerde Starter (10 kredi, $19); kredi sayısı ve tutar iade edilen paketinkidir.

**Kilit (R3).** İstek açıkken o paketin kredileri tutulur (kullanılamaz); böylece istek sonuçlanana kadar uygun kalır. Tutulan kredi harcanabilir bakiyeye dahil değildir: `[BALANCE]` her yerde (üst menü, onay penceresi, Account) harcanabilir kredidir. Account'ta bakiyenin altında: `10 more credits are held for a refund request.` Kilit üç yoldan biter: iade gönderilir (krediler silinir), müşteri isteği geri alır (`Cancel request`; krediler serbest), ödeme sağlayıcı iadeyi yapamaz (`Refund failed`; krediler serbest, destek). Yönetimde reddetme yolu yoktur: istek yalnız uygun pakette açılabildiği için her istek onaylanır; iade sayfası bunu söyler: `Every request for an unused pack within 14 days is approved.`

İade sayfası (`A-Yasal-Iade`) ve Pricing SSS aynı tanımı kullanır: `A credit counts as used when a video is delivered or a template is prepared with it. Credits that came back from a stopped job do not count as used.` · `While a request is open, the credits of that pack are held. You can cancel the request and use them again.` · `If a refund does not go through, the credits return to your balance.`

`Request a refund` tek tıkla çalışmaz, küçük bir onay ister (`A-Hesap-Iade-Onay`): `Request a refund for Starter · 10 credits · $19? The 10 credits are held until we answer.` · `Keep the credits` · `Request refund`.

Fatura listesi: boş hâli `No invoices yet.`; indirme hatası `Could not download the invoice. Try again.`

---

## 9. Hesap erişimi

| Durum | Metin |
|---|---|
| Yanlış giriş | `Email or password is not correct.` |
| Çok deneme | `Too many tries. Wait 15 minutes or reset your password.` |
| Google iptal | `Google sign-in was cancelled. Nothing changed.` |
| Google başarısız | `Google sign-in did not work. Try again or use your email.` |
| Kayıt: e-posta kayıtlı | `This email already has an account.` · `Log in` · `Reset password` |
| Kayıt: zayıf şifre | `Use at least 8 characters.` |
| Geçersiz e-posta | `Enter a valid email address.` |
| Yeniden gönderildi | `Sent again. You can send another in 60 seconds.` |
| Doğrulama bağlantısı süresi dolmuş | `This link has expired. Links work for 24 hours.` · `Send a new link` |
| Doğrulama bağlantısı kullanılmış | `Your email is already verified.` · `Log in` |
| Sıfırlama bağlantısı geçersiz | `This reset link no longer works. Links work for 1 hour and only once.` · `Send a new link` |
| Oturum bitti | `You were logged out. Log in to continue where you left off.` |
| Hesap engelli | `This account is blocked. If you think this is a mistake, contact support.` |
| Yetki yok | `You do not have access to this page.` · `Back to gallery` |
| Google ile açılmış hesap | Account: `You sign in with Google. There is no password to change.` |
| E-posta değişikliği | `We sent a link to [EMAIL]. Your email changes after you open it. Until then you log in with the old one.` |
| Profil kaydedildi / hata | `Saved.` / `Could not save. Your changes are still here. Try again.` |

Kural: seçilmiş şablon ve doldurulmuş form, giriş ve doğrulamadan sonra geri gelir (`next` adresi + taslak). Giriş ve "şifremi unuttum" bir e-postanın kayıtlı olup olmadığını söylemez.

---

## 10. Ortak durumlar

| Durum | Metin | Eylem |
|---|---|---|
| Liste yüklenemedi | `Could not load the gallery.` (ya da `your videos`, `your account`, `this list`) | `Try again`; ikinci hatadan sonra `Contact support` |
| Hizmet kullanılamıyor (5xx) | `Something went wrong on our side. Try again in a few minutes.` · alt satır (13 px, `--text-3`): `If you just paid or started a video, check Account or My videos before you try again. You are not charged twice.` (R6: `Nothing was charged.` bu sayfada yazılmaz; sayfa sonucu belirsiz bir ödeme ya da iş başlatma için kullanılmaz: ödeme dönüşü `A-Odeme-Dogrulaniyor` / `A-Odeme-Gecikti`'ye, iş başlatma §5 `Başlangıç doğrulanamadı` hâline gider) | `Try again` · `Contact support` |
| İndirme hazırlanıyor | `Preparing your file…` | — |
| İndirme hatası | `The download did not start. Try again.` | `Try again` · `Contact support` |
| Video oynatılamıyor | `This video cannot be played here. Download it instead.` | `Download` |
| Video artık saklanmıyor | `This video is no longer stored. Videos are kept for 12 months.` · alt satır: `This starts a new job: you add the product images again and confirm the price.` (R4) | `Generate it again` (şablonun formunu açar) |
| Eksik varyant, 30 gün geçmiş | `The product images for this job are no longer stored. Start a new job from the template.` (R4; `Generate the missing variant again` düğmesi yerine) | `Open the template` |
| Destek gönderildi | `Message sent. Reference [REFERENCE]. We answer within 2 business days.` | — |
| Destek gönderilemedi | `Could not send. Your message is still here. Try again.` | `Try again` |
| Sorun bildirildi | `Thanks. We look at it within 2 business days. If the video is wrong, we generate it again at no cost.` | — |

### 10.1 Videoyu silme (R4)

- Giriş: My videos'ta `Done` satırında `Delete` (dokunma hedefi 44 px; satırın ana eylemi `Open` kalır), Result sayfasında ikincil metin bağlantısı `Delete video`. Çalışan ya da durmuş iş silinmez (durmuş iş `Stop the job here` ile kapanır).
- Onay penceresi `A-Video-Sil-Onay` (`A-Hesap-Sil` kalıbı; `A-Is-Kapat-Onay` ile aynı ölçü): `Delete this video?` · `It is removed from My videos and cannot be brought back. Credits are not returned.` · `Keep it` (geniş, kenarlı) · `Delete video` (`--warn` kenarlı). Çok varyantlı işte başlık `Delete these 3 videos?`.
- Sonuç: My videos üstünde bildirim `Video deleted.`; hata hâli `Could not delete the video. Try again.`

`Report a problem` seçenekleri: `The product looks different` · `Text is wrong or cut off` · `The video does not play` · `Something else`. İş kimliği otomatik eklenir.

---

## 11. Vaat: ne aynı kalır, ne değişebilir

Marka sözü `Same video. Your product.` kalır; altına şu ayrım yazılır (Brand essence, Home, Template detail, Generate form):

| Aynı kalır (yapı) | Yeniden çekilir (değişebilir) |
|---|---|
| Çekim sayısı ve sırası | İnsanlar, eller, yüzler |
| Her çekimin uzunluğu ve toplam süre | Mekân ve arka plan ayrıntıları |
| Ekran yazılarının yeri ve zamanı | Ürünün görünüşü: etiket ve küçük yazı biraz farklı çıkabilir |
| Ritim ve kesmeler | Müzik: aynı havada yeni parça; özgün ses asla kullanılmaz |
| 9:16 dikey biçim | Ses (konuşmalı videoda) |

Kısa UI metni: `The structure stays the same: shots, order, timing and on-screen text. People, setting and music are made new around your product.` Görüntülenme ya da satış sözü verilmez. Kendi şablonu için mevcut `experimental` notu kalır.

Konuşmalı video: sunucunun söyledikleri müşterinin yazdığı ürün bilgisinden yazılır; form notu `What the presenter says is written from your product description. Only claims you typed are used.` Bu not ve §3'teki `Needs credits · 4 credits` satırı konuşmalı şablonun sayfalarına aittir; tuvalde örnek sayfalar konuşmasız şablonu gösterdiği için ikisi `Marka-Bilesen-4` panosunda `Talking template` başlığı altında belgelenir. Konuşmalı biçim yayına girecekse üretimden önce metni gösteren onay adımı şarttır; o adım bu turda çizilmez (konuşmalı şablonlar gizli başlar).

---

## 12. Yönetim

- Para ve erişim işlemleri (`Refund`, `Return credits`, `Add credits`, `Block user`, `Unblock user`, `Retry job`) tek tıkla çalışmaz: onay penceresi kullanıcıyı, tutarı / krediyi, etkilenen satın almayı ya da işi, **zorunlu gerekçeyi** ve sonucu gösterir. Alt not: `This action is recorded with your name and the reason.`
- `Retry job` penceresi: iş, eksik parçalar (`2 clips`), `The customer is not charged.`, zorunlu gerekçe. `Continuing costs` ve `Balance after` satırı yoktur.
- Para için söz `refunded` (`Money refunded to customers`), kredi için `returned`.
- **Kim yaptı (R8).** Kredi defteri (`A-Krediler`) ve kullanıcı ayrıntısındaki defter satırı, işlemi yapanı aynı satırda gösterir: `Date` (`[DATE] [TIME]`) · `User` · `Type` · `Change` · `By` · `Related` · `Reason` · `Balance after`. `By`: `System` (otomatik geri dönüş, ücretsiz video), `Customer` (satın alma, harcama), `[ADMIN NAME]` (yönetici işlemi). `Related`: `Job [JOB ID]` ya da `Purchase [INVOICE NUMBER]`. Gelir tablosundaki iade satırı da `By` gösterir. Ayrı işlem günlüğü sayfası yoktur (K16).
- **İade durumları (yönetim, `A-Gelir`):** `Refund requested` (müşteri istedi; eylem `Refund`) → `Refund sent` → `Refunded` | `Refund failed` (eylem `Try the refund again`). Müşteri tarafındaki karşılıkları §8.1.
- Sonuç durumları: `Working…` → `Done` → hata hâlinde `It did not go through. Nothing was changed. Try again.`; yinelenen işlemde `This was already done on [DATE].`
- Ayarlar (Admin · settings) ek alanları: `Jobs per user at the same time` (2) · `Own videos per user per day` (3) · `Free first video` (on) · `Show talking templates` (off) · `Daily spending limit` (sağlayıcı kredisi) · `Warn me at` (80%) · `When the limit is reached` → `Pause new jobs` · `Pause generation now` (anahtar).
- Şablon sürümü: örnek üretildikten sonra çekimler değişirse örnek `Out of date` olur; yeni örnek üretilene kadar şablon yeniden yayınlanamaz. Çalışan işler başladıkları sürümle biter.
- Grafikler: dönem seçimi (mevcut), eksende para birimi (USD), boş hâl `No sales in this period.`, hata hâli `Could not load the chart.` + `Try again`. Grafiğin altındaki tablo aynı veriyi verir. **Tuvalde (R10):** çubuk yükseklikleri örnektir, değerler yer tutucudur; `With data` hücresinin etiketi `With data · example heights`. Sitede grafik yalnız gerçek veriden çizilir. `Marka-Bilesen-3`'teki grafik bileşeni bu sözleşmeyi taşır (eksen ve birim, seçili günün değeri, boş, yükleniyor, hata, altında tablo); eski `[CHART: …]` yer tutucusu ve `No chart is drawn without data: no made-up lines, no sample numbers` cümlesi şuna döner: `On this canvas the bar heights are examples and the values are placeholders. On the site a chart is drawn only from real data.`

---

## 13. Kararlar (hepsi öneri)

| # | Karar | Neden | Yanlışsa |
|---|---|---|---|
| K1 | Paketler 10 / $19, 30 / $54, 100 / $169 | Başlangıç önerisi (maliyet ölçülmedi) | §1.1 + panolarda üç sayı |
| K2 | Video başına 2 / 5 / 4 / 8 kredi, sabit; şablon uzunluğu fiyatı değiştirmez | Müşteri için tek tablo; kodda zaten sabit tablo var | §1.2 tablosu |
| K3 | Fiyat sabit (tahmin değil); onaydaki sayı = alınan sayı | İnceleme P0-04; kod `confirmed` denetimini zaten yapıyor | "Estimated credits" etiketi geri döner |
| K4 | Ücretsiz video: konuşmasız + Fast + 1 varyant; uzunluk ve ürün sınırı yok | 17 sn'lik şablon çelişkisini kuralı sadeleştirerek kapatır; ek görselin maliyeti küçük | Şablona "free" işareti eklenir |
| K5 | Kendi videosu 1 kredi (onayda alınır, olmazsa geri döner) | Mevcut tasarım bunu kredili sayıyor. **Daha basit seçenek:** ücretsiz + günde 3 sınırı (analiz maliyeti kuruşlar); onay akışı tümden kalkar | §4 + bir durum panosu |
| K6 | İş durunca teslim edilmemiş videonun kredisi otomatik geri döner; devam aynı tutarı yeniden alır | Müşteri hizmet hatası için iki kez ödemez (P0-06). Kodda bugün devam, eksik klip payını **ek olarak** alıyor | `costToResume` eski hâline döner, panolarda kredi satırları |
| K7 | Yedek model için fark alınmaz | Tek fiyat; farkı biz üstleniriz | `[CREDIT DIFFERENCE]` geri gelir |
| K8 | Çalışan iş iptal edilemez | Sağlayıcıya gönderilmiş istek geri alınamaz | İptal düğmesi + kural |
| K9 | Krediler sona ermez | Daha az kural, ekran ve e-posta; "abonelik yok" sözüyle uyumlu. Araştırma 12 ay önermişti | Bir satır + bir hatırlatma e-postası |
| K10 | Para iadesi: 14 gün, hiç kullanılmamış paket | Araştırma §4.3 | §1.5 |
| K11 | Görseller 30 gün, videolar 12 ay | Araştırma §4.2; müşteriye söylenebilir net süre | §1.5 |
| K12 | Yalnız zorunlu çerez; izin penceresi yok | Araştırma §4.5; çerez tercihi yüzeyi gerekmez | Tercih penceresi çizilir |
| K13 | Video dili yayında English + Türkçe | Kendimiz denetleyebildiğimiz iki dil | Liste uzar |
| K14 | Konuşmalı şablonlar gizli başlar | Motor konuşmalı biçimi kanıtlamadı; inceleme P0-10 "ilk sürümden çıkarılabilir" diyor | Ayar açılır + metin onayı adımı çizilir |
| K15 | Fatura bilgisini ödeme sağlayıcı toplar | Merchant of record modeli; hesapta adres alanı gerekmez | Account'a fatura bilgisi formu |
| K16 | Yönetim için ayrı işlem günlüğü sayfası yok; gerekçe defter satırında görünür | Tek yönetici; kayıt backend'de tutulur | Bir tablo sayfası |
| K17 | P2 önerileri (27–34) bu turda yapılmaz | İnceleme "ilk sürümü büyütme" diyor | Ayrı plan |
| K18 | Süreler: şifre 8, doğrulama 24 sa, sıfırlama 1 sa, yeniden gönderme 60 sn, destek 2 iş günü, yanlış girişte 15 dk bekleme, kalite bildirimi 7 gün | Yaygın değerler; tek kişilik destek | §1.4, §1.5 |
| K19 | Duran ücretsiz iş ücretsiz devam eder (hak yeniden kullanılır); hak başka işte kullanıldıysa devam normal fiyat | İkinci inceleme R2; ücretsiz müşteri bizim hatamız için ödemez | §6 madde 5 ve 10, üç hücre |
| K20 | Devam için bakiye yetmezse "yetersiz bakiye" penceresi; parçalar bekler | R2; geri dönen kredi başka yerde harcanabilir | Bir hücre |
| K21 | Duran işin parçaları ve görselleri 30 gün saklanır; sonra iş kendiliğinden kapanır | R4; ürün görsellerinin 30 günlük süresiyle aynı sayı, tek kural | §1.5, `You can continue until [DATE].` |
| K22 | Para iadesi yaşam döngüsü: istendi (tutulur, müşteri geri alabilir) → gönderildi → iade edildi \| olmadı (krediler geri). Yönetici reddi yok | R3; kilidin nasıl bittiği üç yolla tanımlı, ret ekranı gerekmez | §8.1 + bir yönetici eylemi (`Decline`) |
| K23 | Duran işten geri dönen kredi "kullanılmamış" sayılır; paket iadeye uygun kalır | R3; bizim hatamız müşterinin iade hakkını bitirmez | §1.5 tanımı sertleşir |
| K24 | Tek video silme: My videos ve Result'ta `Delete`, onayla; kredi geri dönmez | R4; hukuk metni "istediğin an silebilirsin" diyor | Bir pencere + iki giriş noktası |
| K25 | 12 ay sonra `Generate it again` ve 30 gün sonra eksik varyant = yeni iş: görseller yeniden yüklenir, fiyat yeniden onaylanır | R4; görseller 30 günde siliniyor | §10 iki satır |
| K26 | En dar ekran 320 px; 360 altında üst menüde yalnız işaret | R7; marka panosu bu kuralı zaten söylüyor | Telefon panoları yalnız 390'da denetlenir |
| K27 | Genel hata sayfası ücret sözü vermez; belirsiz sonuç "doğrulanıyor / başlatılıyor" hâllerine gider | R6; yanıt kaybolduğunda yanlış güvence vermemek | §10 cümlesi |
| K28 | Yönetici işleminde yapan kişi, saat ve ilgili iş / satın alma defter satırında görünür | R8; onay penceresi "adınla kaydedilir" diyor | İki sütun |
| K29 | Fiyat değişimi örneği 2 → 3 (tarife güncellemesi); kapatılan iş yeniden başlatılırsa güncel fiyat | R11, R12; 5 aynı zamanda Best tarifesiydi, "aynı fiyat" sözü fazla genişti | İki cümle |

---

## 14. Backend'e düşenler (motor ve site veri katmanı)

Bunlar tasarımın varsaydığı, kodda bugün olmayan ya da farklı olan şeyler. Hiçbiri bu turda kodlanmaz.

| # | Konu | Bugün | Sözleşme |
|---|---|---|---|
| B1 | Durunca kredi | `costToResume` eksik klip payını ek olarak alır; geri verme yalnız yönetici eliyle (`refundJob`) | Durunca otomatik geri verme; devam aynı tutarı alır (K6) |
| B2 | Varyant durumu | `JobVariant { id, image, video }`; durum iş düzeyinde | Varyant başına durum (bekliyor / üretiliyor / hazır / durdu) ve varyant başına yeniden üretim |
| B3 | Kuyruk | `JobStatus = running / done / stopped` | `queued` + sıra numarası; "beklenenden uzun" eşiği |
| B4 | Ödeme durumu | `Checkout.status = open / paid / declined` | + `cancelled`, `expired`; dönüşte "doğrulanıyor"; bildirimle kesinleşme |
| B5 | Para iadesi | `PurchaseStatus = paid / not-completed / refunded` | + `refund-requested`; uygunluk (14 gün, kullanılmamış); istek açıkken paketin kredileri tutulur |
| B6 | Kendi videosu ücreti | Ücret yok | 1 kredi, olmazsa geri verme; günlük sınır (`daily-cap` zaten var) |
| B7 | Yükleme | `accept="image/*"`, sınır yok | Tür, boyut, adet denetimi; dosya başına ilerleme ve hata |
| B8 | Taslak | 30 dk, görseller hariç | 24 saat, görseller dahil |
| B9 | Kredi tablosu | Konuşmalı 6 / 12 | 4 / 8 (K2) |
| B10 | Yönetim ayarları | Tarama alanları | §12'deki sekiz alan; üretimi duraklatma |
| B11 | Şablon sürümü | Yok | Örnek sürümü ≠ şablon sürümü ise yayın kapısı |
| B12 | Durma nedeni | 10 kod | + içerik kuralı reddi (devam ettirilemez) |
| B13 | Saklama | Yok | Görsel 30 gün, video 12 ay; süresi dolmuş medya durumu |
| B14 | Giriş | Sahte giriş | Deneme sınırı, bağlantı süreleri, Google hata dalları, e-posta değişikliği doğrulaması |
| B15 | Ücretsiz işte devam | Yok | Duran ücretsiz iş hakkı geri verir; devam hakkı yeniden kullanır; hak başka işte kullanıldıysa devam ücretli; bakiye yetmezse devam başlamaz (K19, K20) |
| B16 | İade yaşam döngüsü | `refunded` tek durum | `refund-requested` → `refund-sent` → `refunded` \| `refund-failed`; müşterinin isteği geri alması; tutulan kredi harcanabilir bakiyeden ayrı; kredi paket başına izlenir, duran işten dönen kredi pakete geri yazılır (K22, K23) |
| B17 | Duran işin süresi | Yok | Durduktan 30 gün sonra otomatik kapanma; iş sayfasında son gün (K21) |
| B18 | Video silme | Yok | Müşterinin tek işi / videoyu silmesi (K24) |
| B19 | Defterde yapan | Yalnız gerekçe | Her defter satırında yapan (`system` / `customer` / yönetici), saat, ilgili iş ya da satın alma kimliği (K28) |
| B20 | Belirsiz başlangıç | `EstimateChangedError` dışında hâl yok | Yanıt kaybolursa aynı `idempotencyKey` ile yeniden sorma; sonuç alınamazsa "başlangıç doğrulanamadı" hâli (K27) |
| B21 | Maliyet ölçümü | Ölçülmedi | İkinci inceleme R1 (P0): en uzun ve en çok çekimli izinli şablonda, başarısız deneme ve yedek model dahil video başına maliyet ölçülür; sonuca göre §1.1 / §1.2 ya da ücretsiz videonun katalog sınırı kesinleşir. Fiyatlar bu ölçümden önce satışa açılmaz (gerçek kredili deneme, yalnız sahip) |

İncelemenin 16 kabul testi (backend ekibiyle birlikte koşulacak) bu maddelerin sınavıdır; uçtan uca testlere eklenir.
